"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { refreshAccountPrices } from "@/lib/refresh-prices";
import { createServiceClient } from "@/lib/supabase/service";

// 手動刷新自己的報價（RLS client → 只碰得到自己的帳戶）。
// 冷卻 10 分鐘：取自己 active 非手動帳戶的 max(last_priced_at, updated_at)，
// 再和 app_metadata 記的上次手動刷新時間比，取最晚者。跨裝置一致，
// cron 剛跑完也一樣算在冷卻內（避免重複打免費額度）。
// 只看 last_priced_at 不夠：台股（FinMind）寫的是資料日期的 00:00，不是抓取時間，
// 只持有台股的人冷卻永遠判定已過，可以連按把全站共用的每日額度打光。
// updated_at 由 apply_account_mutation 每次寫入時設為 now()，刷新成功一定會動到它；
// 代價是剛交易、調整過的帳戶也會進冷卻，但交易本身已經抓過一次最新報價。
// 全部報價都失敗時不會有任何寫入，冷卻原本不會開始：上游一直回錯（代號錯、對方故障），
// 每按一次就再扣一次共用額度。所以只要這次有打到上游（成功或失敗），
// 就把時間記在 auth 的 app_metadata，冷卻判斷也一起看它。
// app_metadata 只有 service role 能改，使用者無法自己清掉；GoTrue 逐鍵合併，
// 只送這一個鍵不會蓋掉 provider 等欄位。以前的做法是對帳戶送空 patch 碰 updated_at，
// 副作用是該帳戶已開著的編輯表單送出時會被樂觀鎖擋下（「帳戶剛被其他操作更新」）。

const COOLDOWN_MS = 10 * 60 * 1000;
const ATTEMPT_KEY = "price_refresh_attempted_at";

// 記錄這次手動刷新打過上游的時間。失敗只印 log：刷新本身已經完成，
// 每日額度另有 api-budget 把關，這裡寫不進去最多讓下一次早一點能按。
async function recordAttempt(userId: string): Promise<void> {
  try {
    const svc = createServiceClient();
    const { error } = await svc.auth.admin.updateUserById(userId, {
      app_metadata: { [ATTEMPT_KEY]: new Date().toISOString() },
    });
    if (error) {
      console.error(
        `[refreshMyPrices] 記錄刷新時間失敗 status=${error.status ?? "unknown"}`,
      );
    }
  } catch (e) {
    // createServiceClient 缺 env 時會丟錯；訊息只有 env 名稱，不含值
    console.error(
      `[refreshMyPrices] 記錄刷新時間失敗：${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}

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
    .select("id,last_priced_at,updated_at")
    .neq("price_market", "manual")
    .not("symbol", "is", null)
    .eq("status", "active");
  if (qErr) {
    // 原本直接回 qErr.message，那是 PostgREST 的原文，會把欄位名與 policy 名帶到前端。
    console.error(
      `[refreshMyPrices] 查詢帳戶失敗 code=${qErr.code ?? "unknown"}`,
    );
    return { ok: false, error: "讀取帳戶失敗，請稍後再試" };
  }
  if (!rows || rows.length === 0)
    return { ok: false, error: "沒有可刷新的帳戶" };

  const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);
  const attempted = user.app_metadata?.[ATTEMPT_KEY];
  const latest = rows
    .map((r) => Math.max(ms(r.last_priced_at), ms(r.updated_at)))
    .reduce(
      (a, b) => Math.max(a, b),
      typeof attempted === "string" ? ms(attempted) || 0 : 0,
    );
  const elapsed = Date.now() - latest;
  if (elapsed < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return { ok: false, error: "冷卻中", waitSec };
  }

  const res = await refreshAccountPrices(supabase);
  revalidatePath("/");
  // ok 與 failed 都是 0（例如查帳戶清單失敗）代表沒打上游、沒扣額度，不啟動冷卻。
  if (res.ok + res.failed > 0) await recordAttempt(user.id);
  if (res.ok === 0 && res.failed > 0) {
    return { ok: false, error: res.errors[0] ?? "全部刷新失敗" };
  }
  return { ok: true, refreshed: res.ok, failed: res.failed };
}
