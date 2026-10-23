import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuote } from "@/lib/prices/router";
import {
  applyAccountMutation,
  type MutationSnapshot,
} from "@/lib/account-mutation";
import { todayTaipei } from "@/lib/dates";
import type { Market } from "@/lib/prices/types";

export type ContributionAccount = {
  id: string;
  user_id: string;
  price_market: "us" | "tw" | "crypto" | "manual";
  symbol: string | null;
  quantity: number;
  native_currency: string;
  last_unit_price: number | null;
  last_fx_rate: number;
  cost_basis_twd: number;
  cost_basis_native: number;
  /** 有帶就做樂觀鎖比對，見 AccountPatch.expected_updated_at */
  updated_at?: string;
};

export type ContributionResult =
  | { ok: true; sharesAdded: number; newQty: number }
  | { ok: false; error: string };

export async function applyContribution(args: {
  supabase: SupabaseClient;
  userId: string;
  account: ContributionAccount;
  twd: number;
  /** 手續費（TWD），費用內含於 twd。null = 未記錄。 */
  feeTwd: number | null;
  priceOverride: number | null;
  fxOverride: number | null;
  occurredAt: Date;
  noteSuffix: string | null;
}): Promise<ContributionResult> {
  const { supabase, account, twd, priceOverride, fxOverride, occurredAt } = args;
  const feeTwd = args.feeTwd;

  if (account.price_market === "manual" || !account.symbol) {
    return { ok: false, error: "此操作僅限非手動帳戶" };
  }

  let quote;
  try {
    quote = await getQuote(
      account.price_market as Market,
      account.symbol,
      "TWD",
    );
  } catch (error) {
    return { ok: false, error: `抓價失敗：${(error as Error).message}` };
  }

  const priceUsed = priceOverride ?? quote.unitPrice;
  const fxUsed = fxOverride ?? quote.fxToBase;
  const perShareTwd = priceUsed * fxUsed;
  if (!Number.isFinite(perShareTwd) || perShareTwd <= 0) {
    return { ok: false, error: "換算失敗：單位 TWD 為零或無效" };
  }
  // 費用內含：twd 是實際從戶頭出去的錢，扣掉手續費才是買到股票的錢。
  // 成本基礎則含費（證券會計慣例），所以 newCost 加的是 twd 而非 invested。
  const fee = feeTwd ?? 0;
  if (fee >= twd) {
    return { ok: false, error: "手續費不得大於或等於投入金額" };
  }
  const invested = twd - fee;
  const sharesAdded = invested / perShareTwd;
  const newQty = Number(account.quantity) + sharesAdded;
  const newCost = Number(account.cost_basis_twd ?? 0) + twd;
  const nativeAdded = fxUsed > 0 ? twd / fxUsed : 0;
  const newCostNative =
    Number(account.cost_basis_native ?? 0) + nativeAdded;

  const noteParts = [
    fee > 0 ? `加碼 ${twd} TWD（含手續費 ${fee}）` : `加碼 ${twd} TWD`,
  ];
  if (args.noteSuffix) noteParts.push(args.noteSuffix);

  const occurredDate = occurredAt.toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });
  const snapshots: MutationSnapshot[] = [
    {
      snapshot_date: occurredDate,
      quantity: newQty,
      unit_price: priceUsed,
      fx_rate: fxUsed,
      value_base: newQty * priceUsed * fxUsed,
    },
  ];
  if (occurredDate !== todayTaipei()) {
    snapshots.push({
      snapshot_date: todayTaipei(),
      quantity: newQty,
      unit_price: quote.unitPrice,
      fx_rate: quote.fxToBase,
      value_base: newQty * quote.unitPrice * quote.fxToBase,
    });
  }

  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId: account.id,
    patch: {
      quantity: newQty,
      last_unit_price: quote.unitPrice,
      last_fx_rate: quote.fxToBase,
      last_priced_at: quote.asOf,
      cost_basis_twd: newCost,
      cost_basis_native: newCostNative,
      expected_updated_at: account.updated_at,
    },
    transaction: {
      type: "adjust_quantity",
      quantity_after: newQty,
      unit_price: priceUsed,
      fx_rate: fxUsed,
      value_after_base: newQty * priceUsed * fxUsed,
      note: noteParts.join(" · "),
      created_at: occurredAt.toISOString(),
      cashflow_twd: -twd,
      fee_twd: feeTwd,
    },
    snapshots,
  });
  if (mutationError) return { ok: false, error: mutationError };

  return { ok: true, sharesAdded, newQty };
}

export type RecurringExecutionAccount = {
  price_market: "us" | "tw" | "crypto" | "manual";
  symbol: string | null;
  status?: string;
};

export type RecurringExecutionResult =
  | {
      ok: true;
      executed: boolean;
      sharesAdded: number | null;
      newQty: number | null;
      nextRunDate: string;
    }
  | { ok: false; error: string };

type RecurringRpcRow = {
  executed: boolean;
  shares_added: number | string | null;
  new_quantity: number | string | null;
  next_run_date: string;
};

// 報價在應用層取得；帳戶增量、流水、快照、ledger 與排程推進由單一 RPC 提交。
// amountOverride / feeOverride 只給 manual 用：本期改用指定值，計劃的預設值不變。
// cron 一律不帶（RPC 端也會拒絕），自動執行維持計劃設定的手續費。
// tierAmount 只給 cron 用：級距計劃依含息序列算出的本期金額
// （recurring-tier-amount.ts）。與 amountOverride 分成兩個參數，是為了讓
// 「cron 不接受人為覆寫」這條規則維持原樣；兩者到 RPC 都是 p_amount_override，
// RPC 只在計劃有 tier_config 時才接受 cron 帶金額。
export async function executeRecurringPlan(args: {
  supabase: SupabaseClient;
  planId: string;
  expectedRunDate: string;
  account: RecurringExecutionAccount;
  source: "cron" | "manual";
  executedAt?: Date;
  amountOverride?: number | null;
  feeOverride?: number | null;
  tierAmount?: number | null;
}): Promise<RecurringExecutionResult> {
  const { supabase, planId, expectedRunDate, account, source } = args;
  const amountOverride = args.amountOverride ?? null;
  const feeOverride = args.feeOverride ?? null;
  const tierAmount = args.tierAmount ?? null;

  if (source === "cron" && amountOverride !== null) {
    return { ok: false, error: "自動執行不接受覆寫金額" };
  }
  if (source === "cron" && feeOverride !== null) {
    return { ok: false, error: "自動執行不接受覆寫手續費" };
  }
  if (source !== "cron" && tierAmount !== null) {
    return { ok: false, error: "級距金額只能由自動執行帶入" };
  }
  if (tierAmount !== null && (!Number.isFinite(tierAmount) || tierAmount <= 0)) {
    return { ok: false, error: "級距金額無效" };
  }

  if (account.status === "archived") {
    return { ok: false, error: "帳戶已歸檔" };
  }
  if (account.price_market === "manual" || !account.symbol) {
    return { ok: false, error: "手動帳戶無法執行定期定額" };
  }

  let quote;
  try {
    quote = await getQuote(
      account.price_market as Market,
      account.symbol,
      "TWD",
    );
  } catch (error) {
    return { ok: false, error: `抓價失敗：${(error as Error).message}` };
  }

  if (
    !Number.isFinite(quote.unitPrice) ||
    quote.unitPrice <= 0 ||
    !Number.isFinite(quote.fxToBase) ||
    quote.fxToBase <= 0
  ) {
    return { ok: false, error: "報價或匯率無效" };
  }

  const executedAt = args.executedAt ?? new Date();
  const { data, error } = await supabase.rpc(
    "execute_recurring_plan_mutation",
    {
      p_plan_id: planId,
      p_expected_run_date: expectedRunDate,
      p_executed_at: executedAt.toISOString(),
      p_unit_price: quote.unitPrice,
      p_fx_rate: quote.fxToBase,
      p_priced_at: quote.asOf,
      p_source: source,
      p_amount_override: amountOverride ?? tierAmount,
      p_fee_override: feeOverride,
    },
  );
  if (error) {
    // 與 reversal-actions.ts 同一套判準：P0001 是 plpgsql raise exception，
    // 訊息是我們自己在 SQL 裡寫的中文說明（為什麼這期不能執行），顯示出來才有用。
    // 其他 SQLSTATE 是底層錯誤，原文會帶出欄位名與 policy 名稱，只印 code 到 log。
    if (error.code === "P0001") return { ok: false, error: error.message };
    console.error(
      `[executeRecurringPlan] RPC 失敗 code=${error.code ?? "unknown"}`,
    );
    return { ok: false, error: "定期定額執行失敗，資料未變更。請稍後再試" };
  }

  const row = (Array.isArray(data) ? data[0] : data) as RecurringRpcRow | null;
  if (!row || typeof row.executed !== "boolean" || !row.next_run_date) {
    return { ok: false, error: "定期定額執行結果無效" };
  }

  return {
    ok: true,
    executed: row.executed,
    sharesAdded:
      row.shares_added == null ? null : Number(row.shares_added),
    newQty: row.new_quantity == null ? null : Number(row.new_quantity),
    nextRunDate: row.next_run_date,
  };
}

export function nextMonthlyAfter(fromIso: string, dayOfMonth: number): string {
  const [year, month] = fromIso.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}
