"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/paginate";
import {
  hasCostBasisColumns,
  mapHeader,
  missingRequiredColumns,
} from "@/lib/csv-import-helpers";
import {
  buildImportPlan,
  dedupeKey,
  parseCsvLine,
  parseRows,
  type PlanAccount,
} from "@/lib/csv-import-plan";

export type ImportResult =
  | {
      ok: true;
      imported: number;
      skipped: number;
      errors: string[];
    }
  | { ok: false; error: string }
  | undefined;

/**
 * CSV 匯入：支援全部八種交易型別，欄位可中英文，也吃得下 /api/export/csv 的匯出檔。
 *
 * 必要欄位（含別名）：date / account / type，加上金額擇一（amount 或 Cashflow (TWD)）。
 * 其餘欄位有就用、沒有就退回較保守的行為。
 *
 * 兩條規則值得先知道：
 * 1. 部位異動（買進 / 賣出 / 餘額調整 / 校正成本 / 建立）只能匯進「還沒有任何交易」的帳戶。
 *    這些列設定的是絕對狀態，寫進已有歷史的帳戶等於拿另一段歷史的終值覆蓋現況。
 *    配息與利息是增量，不受此限，行為與先前完全相同。
 * 2. 同帳戶、同時間、同型別視為重複，直接跳過並回報，避免同一份檔案匯兩次
 *    把部位變成兩倍。
 */
export async function importTransactionsCsv(
  _prev: ImportResult,
  formData: FormData,
): Promise<ImportResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "請選擇 CSV 檔" };
  }
  if (file.size > 1024 * 1024) {
    return { ok: false, error: "檔案超過 1 MB" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "請先登入" };

  const text = (await file.text()).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { ok: false, error: "CSV 沒有資料列" };

  const header = parseCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/^"|"$/g, ""),
  );
  const cols = mapHeader(header);
  const missing = missingRequiredColumns(cols);
  if (missing.length > 0) {
    return { ok: false, error: `CSV 缺少必要欄位：${missing.join("、")}` };
  }
  const hasCostBasis = hasCostBasisColumns(cols);

  const { rows, errors: parseErrors } = parseRows(lines, cols);

  const { data: accountRows, error: accErr } = await supabase
    .from("accounts")
    .select(
      "id,name,price_market,quantity,manual_value_base,last_unit_price,last_fx_rate,realized_pnl_twd",
    );
  if (accErr) {
    console.error(
      `[importTransactionsCsv] 查詢帳戶失敗 code=${accErr.code ?? "unknown"}`,
    );
    return { ok: false, error: "讀取帳戶失敗，請稍後再試" };
  }

  const referenced = new Set(rows.map((r) => r.accountName));
  const relevant = (accountRows ?? []).filter((a) =>
    referenced.has(a.name.trim()),
  );

  const history = await loadHistory(
    supabase,
    relevant.map((a) => a.id),
  );
  if (history === null) {
    return { ok: false, error: "讀取既有交易失敗，請稍後再試" };
  }

  const accountsByName = new Map<string, PlanAccount>();
  for (const a of relevant) {
    const seen = history.get(a.id);
    accountsByName.set(a.name.trim(), {
      id: a.id,
      name: a.name.trim(),
      priceMarket: a.price_market,
      quantity: Number(a.quantity ?? 0),
      manualValueBase:
        a.manual_value_base == null ? null : Number(a.manual_value_base),
      lastUnitPrice:
        a.last_unit_price == null ? null : Number(a.last_unit_price),
      lastFxRate: a.last_fx_rate == null ? null : Number(a.last_fx_rate),
      realizedPnlTwd: Number(a.realized_pnl_twd ?? 0),
      hasExistingTransactions: (seen?.count ?? 0) > 0,
      existingKeys: seen?.keys ?? new Set<string>(),
      // 唯一一筆交易是 create 才可取代；有第二筆就是真的有歷史，照舊退回部位列。
      replaceableCreateId:
        seen && seen.count === 1 && seen.createIds.length === 1
          ? seen.createIds[0]
          : null,
    });
  }

  const plan = buildImportPlan(rows, accountsByName, { hasCostBasis });
  const errors = [...parseErrors, ...plan.errors];
  const skipped = parseErrors.length + plan.skipped;

  if (plan.transactions.length === 0) {
    return { ok: true, imported: 0, skipped, errors };
  }

  const { error: insErr } = await supabase.from("transactions").insert(
    plan.transactions.map((t) => ({ ...t, user_id: user.id })),
  );
  if (insErr) {
    console.error(
      `[importTransactionsCsv] 寫入交易失敗 code=${insErr.code ?? "unknown"}`,
    );
    return { ok: false, error: "寫入交易失敗，沒有任何資料被匯入" };
  }

  // 被匯入歷史取代的 create 占位紀錄。先寫新交易再刪舊的：
  // 刪除失敗時投入會重複計入，但資料都還在；反過來先刪，寫入失敗就丟了那筆 create。
  // 加上 type = create 條件，萬一 id 對不上也不會刪到別種交易；
  // 要求回傳刪除的列，RLS 擋下時 delete 不會報錯、只會刪 0 列，必須自己比對筆數。
  if (plan.replacedTransactionIds.length > 0) {
    const { data: deleted, error: delErr } = await supabase
      .from("transactions")
      .delete()
      .in("id", plan.replacedTransactionIds)
      .eq("type", "create")
      .select("id");
    if (delErr || (deleted ?? []).length !== plan.replacedTransactionIds.length) {
      console.error(
        `[importTransactionsCsv] 刪除被取代的建立紀錄失敗 code=${delErr?.code ?? "count-mismatch"}`,
      );
      return {
        ok: false,
        error:
          "交易已寫入，但帳戶原本的建立紀錄沒有刪除，投入金額會重複計算，帳戶餘額也尚未更新。" +
          "請到變動紀錄確認，不要重複匯入",
      };
    }
  }

  // 交易已經寫進去了，接著才更新帳戶終態。兩者不在同一個 transaction 裡：
  // 這裡若失敗，流水在、帳戶餘額沒跟上，而且重試會被「帳戶已有交易」擋住。
  // 訊息必須講清楚，讓使用者知道要去看變動紀錄而不是重按一次。
  for (const { accountId, patch } of plan.accountPatches) {
    const { error: updErr } = await supabase
      .from("accounts")
      .update(patch)
      .eq("id", accountId);
    if (updErr) {
      console.error(
        `[importTransactionsCsv] 更新帳戶失敗 code=${updErr.code ?? "unknown"}`,
      );
      return {
        ok: false,
        error:
          "交易已寫入但帳戶餘額更新失敗。請到變動紀錄確認已匯入的內容，不要重複匯入",
      };
    }
  }

  revalidatePath("/activity");
  revalidatePath("/");

  return { ok: true, imported: plan.imported, skipped, errors };
}

/** 單一帳戶的既有交易摘要。 */
type AccountHistory = {
  /** `型別|ISO 時間` 指紋。 */
  keys: Set<string>;
  /** 交易筆數。指紋會合併同時間同型別的列，不能拿 keys.size 當筆數。 */
  count: number;
  /** create 交易的 id。 */
  createIds: string[];
};

/**
 * 撈出這些帳戶既有交易的指紋，供重複偵測與「帳戶是否全新」判斷。
 * 查詢失敗回 null——寧可整份退回，也不要因為查不到而把重複偵測整個關掉。
 */
async function loadHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountIds: string[],
): Promise<Map<string, AccountHistory> | null> {
  const byAccount = new Map<string, AccountHistory>();
  if (accountIds.length === 0) return byAccount;

  // 逐頁取。原本寫 .limit(20000)，但 PostgREST 的 max-rows（Supabase 預設
  // 1000）是硬上限，limit 開再大也會被壓回去——交易破千筆之後這裡只看得到
  // 一部分歷史，重複偵測會漏判、放行重複交易，而且完全沒有徵兆。
  // 分頁必須有穩定排序，否則翻頁邊界會漏列；這裡沒有語意上的排序需求，用 id。
  const { data, error } = await fetchAllPages(async (from, to) => {
    const res = await supabase
      .from("transactions")
      .select("id,account_id,type,created_at")
      .in("account_id", accountIds)
      .order("id", { ascending: true })
      .range(from, to);
    return { data: res.data, error: res.error };
  });
  if (error) {
    console.error(
      `[importTransactionsCsv] 查詢既有交易失敗 code=${error.code ?? "unknown"}`,
    );
    return null;
  }

  for (const t of data ?? []) {
    const h = byAccount.get(t.account_id) ?? {
      keys: new Set<string>(),
      count: 0,
      createIds: [],
    };
    h.keys.add(dedupeKey(t.type, new Date(t.created_at)));
    h.count += 1;
    if (t.type === "create") h.createIds.push(t.id);
    byAccount.set(t.account_id, h);
  }
  return byAccount;
}
