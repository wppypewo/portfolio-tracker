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
      "id,name,price_market,quantity,manual_value_base,last_unit_price,last_fx_rate,realized_pnl_twd,updated_at",
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
  const updatedAtById = new Map<string, string>();
  for (const a of relevant) {
    updatedAtById.set(a.id, a.updated_at);
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

  // 寫入交易、刪除被取代的 create、更新帳戶終態，三步在 RPC 裡同一個交易完成
  // （supabase/migrations/20261108180000_import_transactions_csv.sql），任一步失敗整筆回滾。
  // 規劃是在交易外算的，帶上讀到的 updated_at，中間有別的寫入就拒絕，不用舊狀態覆蓋。
  const { error: rpcErr } = await supabase.rpc("import_transactions_csv", {
    p_transactions: plan.transactions,
    p_account_patches: plan.accountPatches.map(({ accountId, patch }) => ({
      account_id: accountId,
      patch: { ...patch, expected_updated_at: updatedAtById.get(accountId) },
    })),
    p_replaced_ids: plan.replacedTransactionIds,
  });
  if (rpcErr) {
    // 與 account-mutation.ts 同一套判準：P0001 是 SQL 裡自己寫的中文說明，可以顯示；
    // 其他 SQLSTATE 可能帶出表名與 policy 名稱，只印 code。
    if (rpcErr.code === "P0001") {
      return { ok: false, error: `${rpcErr.message}（沒有任何資料被匯入）` };
    }
    console.error(
      `[importTransactionsCsv] 匯入 RPC 失敗 code=${rpcErr.code ?? "unknown"}`,
    );
    return { ok: false, error: "匯入失敗，沒有任何資料被匯入。請稍後再試" };
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
