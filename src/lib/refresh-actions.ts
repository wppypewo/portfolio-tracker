"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { refreshAccountPrices } from "@/lib/refresh-prices";

// 手動刷新自己的報價（RLS client → 只碰得到自己的帳戶）。
// 冷卻 10 分鐘：以自己 active 非手動帳戶的 max(last_priced_at, updated_at) 判斷，
// 不另存狀態，跨裝置一致，cron 剛跑完也一樣算在冷卻內（避免重複打免費額度）。
// 只看 last_priced_at 不夠：台股（FinMind）寫的是資料日期的 00:00，不是抓取時間，
// 只持有台股的人冷卻永遠判定已過，可以連按把全站共用的每日額度打光。
// updated_at 由 apply_account_mutation 每次寫入時設為 now()，刷新成功一定會動到它；
// 代價是剛交易、調整過的帳戶也會進冷卻，但交易本身已經抓過一次最新報價。

const COOLDOWN_MS = 10 * 60 * 1000;

export type RefreshState =
  | { ok: true; refreshed: number; failed: number }
  | { ok: false; error: string; waitSec?: number };

export async function refreshMyPrices(): Promise<RefreshState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };

  const { data: rows, error: qErr } = await supabase
    .from("accounts")
    .select("last_priced_at,updated_at")
    .neq("price_market", "manual")
    .not("symbol", "is", null)
    .eq("status", "active");
  if (qErr) {
    // 原本直接回 qErr.message，那是 PostgREST 的原文，會把欄位名與 policy 名帶到前端。
    console.error(`[refreshMyPrices] 查詢帳戶失敗 code=${qErr.code ?? "unknown"}`);
    return { ok: false, error: "讀取帳戶失敗，請稍後再試" };
  }
  if (!rows || rows.length === 0)
    return { ok: false, error: "沒有可刷新的帳戶" };

  const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);
  const latest = rows
    .map((r) => Math.max(ms(r.last_priced_at), ms(r.updated_at)))
    .reduce((a, b) => Math.max(a, b), 0);
  const elapsed = Date.now() - latest;
  if (elapsed < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return { ok: false, error: "冷卻中", waitSec };
  }

  const res = await refreshAccountPrices(supabase);
  revalidatePath("/");
  if (res.ok === 0 && res.failed > 0)
    return { ok: false, error: res.errors[0] ?? "全部刷新失敗" };
  return { ok: true, refreshed: res.ok, failed: res.failed };
}
