"use server";

import { getQuote } from "@/lib/prices/router";
import {
  applyAccountMutation,
  type MutationSnapshot,
} from "@/lib/account-mutation";
import { parseTaipeiDateTime, todayTaipei } from "@/lib/dates";
import type { Market } from "@/lib/prices/types";
import { SellQuantitySchema } from "@/lib/schemas/action/sell-quantity";
import { RecordIncomeSchema } from "@/lib/schemas/action/record-income";
import {
  actionDone,
  loadAccount,
  type FormState,
} from "./action-shared";

export async function sellQuantity(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = SellQuantitySchema.safeParse({
    accountId: String(formData.get("accountId") ?? ""),
    sellQty: formData.get("sellQty"),
    proceedsTwd: String(formData.get("proceedsTwd") ?? "").trim() || null,
    feeTwd: String(formData.get("feeTwd") ?? "").trim() || null,
    priceOverride:
      String(formData.get("priceOverride") ?? "").trim() || null,
    fxOverride: String(formData.get("fxOverride") ?? "").trim() || null,
    occurredAt: String(formData.get("occurredAt") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const {
    accountId,
    sellQty,
    proceedsTwd,
    feeTwd,
    priceOverride,
    fxOverride,
    occurredAt: occurredAtInput,
    note,
  } = parsed.data;
  const occurredAt = occurredAtInput
    ? parseTaipeiDateTime(occurredAtInput)
    : new Date();
  const { supabase, user, account, error } = await loadAccount(accountId);
  if (error || !account || !user) return { error: error ?? "錯誤" };
  if (account.price_market === "manual" || !account.symbol) {
    return { error: "此操作僅限非手動帳戶（手動帳戶用『修改餘額』）" };
  }

  const oldQuantity = Number(account.quantity);
  if (sellQty > oldQuantity) {
    return { error: `賣出股數超過持有（目前 ${oldQuantity}）` };
  }

  let quote;
  try {
    quote = await getQuote(
      account.price_market as Market,
      account.symbol,
      "TWD",
    );
  } catch (caught) {
    return { error: `抓價失敗：${(caught as Error).message}` };
  }

  const priceUsed = priceOverride ?? quote.unitPrice;
  const fxUsed = fxOverride ?? quote.fxToBase;
  // proceedsTwd 的語意是「券商實際匯入的淨額」（表單提示已如此寫），所以手續費
  // 只在留空、由成交價自動估算時才扣。自行填收入時視為已扣過，重複扣會低估收入；
  // 那種情況下 feeTwd 只入帳留底，不參與計算。
  const fee = feeTwd ?? 0;
  const proceeds = proceedsTwd ?? sellQty * priceUsed * fxUsed - fee;
  if (!Number.isFinite(proceeds) || proceeds < 0) {
    return { error: "收入需為非負數（手續費可能已超過成交金額）" };
  }

  // 賣出採平均成本法分配成本，已實現損益以實際收入減被分配成本。
  const oldCostTwd = Number(account.cost_basis_twd ?? 0);
  const oldCostNative = Number(account.cost_basis_native ?? 0);
  const ratio = oldQuantity > 0 ? sellQty / oldQuantity : 0;
  const allocatedCost = oldCostTwd * ratio;
  const realizedPnl = proceeds - allocatedCost;
  const newQuantity = oldQuantity - sellQty;
  const newCostTwd = oldCostTwd - allocatedCost;
  const newCostNative = oldCostNative * (1 - ratio);
  const newRealizedTotal =
    Number(account.realized_pnl_twd ?? 0) + realizedPnl;

  const noteParts = [
    fee > 0
      ? `賣出 ${sellQty} 股，收入 ${Math.round(proceeds)} TWD（手續費 ${fee}）`
      : `賣出 ${sellQty} 股，收入 ${Math.round(proceeds)} TWD`,
  ];
  if (note) noteParts.push(note);

  // 回填交易日快照；若交易日非今天，再以最新報價補今天快照。
  const occurredDate = occurredAt.toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });
  const snapshots: MutationSnapshot[] = [
    {
      snapshot_date: occurredDate,
      quantity: newQuantity,
      unit_price: priceUsed,
      fx_rate: fxUsed,
      value_base: newQuantity * priceUsed * fxUsed,
    },
  ];
  if (occurredDate !== todayTaipei()) {
    snapshots.push({
      snapshot_date: todayTaipei(),
      quantity: newQuantity,
      unit_price: quote.unitPrice,
      fx_rate: quote.fxToBase,
      value_base: newQuantity * quote.unitPrice * quote.fxToBase,
    });
  }

  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId,
    patch: {
      quantity: newQuantity,
      cost_basis_twd: newCostTwd,
      cost_basis_native: newCostNative,
      realized_pnl_twd: newRealizedTotal,
      last_unit_price: quote.unitPrice,
      last_fx_rate: quote.fxToBase,
      last_priced_at: quote.asOf,
      expected_updated_at: account.updated_at,
    },
    transaction: {
      type: "sell",
      quantity_after: newQuantity,
      unit_price: priceUsed,
      fx_rate: fxUsed,
      value_after_base: newQuantity * quote.unitPrice * quote.fxToBase,
      realized_pnl: realizedPnl,
      cashflow_twd: proceeds,
      fee_twd: feeTwd,
      note: noteParts.join(" · "),
      created_at: occurredAt.toISOString(),
    },
    snapshots,
  });
  if (mutationError) return { error: mutationError };

  return actionDone(accountId, "已記錄賣出");
}

async function recordIncome(
  formData: FormData,
  type: "dividend" | "interest",
): Promise<FormState> {
  const parsed = RecordIncomeSchema.safeParse({
    accountId: String(formData.get("accountId") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    occurredAt: String(formData.get("occurredAt") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const {
    accountId,
    amount,
    occurredAt: occurredAtInput,
    note,
  } = parsed.data;
  const occurredAt = occurredAtInput
    ? parseTaipeiDateTime(occurredAtInput)
    : new Date();
  const { supabase, user, account, error } = await loadAccount(accountId);
  if (error || !account || !user) return { error: error ?? "錯誤" };

  const newRealizedTotal =
    Number(account.realized_pnl_twd ?? 0) + amount;
  const currentValue =
    account.price_market === "manual"
      ? Number(account.manual_value_base ?? 0)
      : Number(account.quantity) *
        Number(account.last_unit_price ?? 0) *
        Number(account.last_fx_rate ?? 1);
  const label = type === "dividend" ? "配息" : "利息";
  const noteParts = [`${label} ${amount} TWD`];
  if (note) noteParts.push(note);

  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId,
    patch: {
      realized_pnl_twd: newRealizedTotal,
      expected_updated_at: account.updated_at,
    },
    transaction: {
      type,
      quantity_after: Number(account.quantity),
      unit_price: null,
      fx_rate: null,
      value_after_base: currentValue,
      realized_pnl: amount,
      cashflow_twd: amount,
      note: noteParts.join(" · "),
      created_at: occurredAt.toISOString(),
    },
  });
  if (mutationError) return { error: mutationError };

  return actionDone(accountId, `已記錄${label}`);
}

export async function recordDividend(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return recordIncome(formData, "dividend");
}

export async function recordInterest(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return recordIncome(formData, "interest");
}
