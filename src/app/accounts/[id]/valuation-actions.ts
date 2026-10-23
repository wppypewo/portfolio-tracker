"use server";

import { getQuote } from "@/lib/prices/router";
import { applyAccountMutation } from "@/lib/account-mutation";
import { parseTaipeiDateTime, todayTaipei } from "@/lib/dates";
import type { Market } from "@/lib/prices/types";
import { applyContribution } from "@/lib/contributions";
import { AddByAmountSchema } from "@/lib/schemas/action/add-by-amount";
import { AdjustCostBasisSchema } from "@/lib/schemas/action/adjust-cost-basis";
import {
  costCorrectionNote,
  resolveCostCorrection,
} from "@/lib/cost-correction";
import {
  actionDone,
  loadAccount,
  type FormState,
} from "./action-shared";

export async function updatePrice(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "缺少帳戶 ID" };

  const { supabase, user, account, error } = await loadAccount(accountId);
  if (error || !account || !user) return { error: error ?? "錯誤" };
  if (account.price_market === "manual" || !account.symbol) {
    return { error: "手動帳戶無需更新價格" };
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

  const quantity = Number(account.quantity);
  const valueBase = quantity * quote.unitPrice * quote.fxToBase;
  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId,
    patch: {
      last_unit_price: quote.unitPrice,
      last_fx_rate: quote.fxToBase,
      last_priced_at: quote.asOf,
    },
    transaction: {
      type: "price_update",
      quantity_after: quantity,
      unit_price: quote.unitPrice,
      fx_rate: quote.fxToBase,
      value_after_base: valueBase,
      cashflow_twd: 0,
    },
    snapshots: [
      {
        snapshot_date: todayTaipei(),
        quantity,
        unit_price: quote.unitPrice,
        fx_rate: quote.fxToBase,
        value_base: valueBase,
      },
    ],
  });
  if (mutationError) return { error: mutationError };

  return actionDone(accountId, "已更新報價");
}

export async function adjustQuantity(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const accountId = String(formData.get("accountId") ?? "");
  const newQuantity = Number(formData.get("quantity"));
  if (!accountId) return { error: "缺少帳戶 ID" };
  if (!Number.isFinite(newQuantity) || newQuantity < 0) {
    return { error: "數量需為非負數" };
  }

  const { supabase, user, account, error } = await loadAccount(accountId);
  if (error || !account || !user) return { error: error ?? "錯誤" };
  if (account.price_market === "manual" || !account.symbol) {
    return { error: "此操作僅限非手動帳戶" };
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

  const oldQuantity = Number(account.quantity);
  const oldCostTwd = Number(account.cost_basis_twd ?? 0);
  const oldCostNative = Number(account.cost_basis_native ?? 0);
  let newCostTwd = oldCostTwd;
  let newCostNative = oldCostNative;

  // 覆寫數量依平均成本法調整成本；增加部分按當前報價視為新投入。
  if (newQuantity > oldQuantity) {
    const added = newQuantity - oldQuantity;
    newCostTwd = oldCostTwd + added * quote.unitPrice * quote.fxToBase;
    newCostNative = oldCostNative + added * quote.unitPrice;
  } else if (newQuantity < oldQuantity && oldQuantity > 0) {
    const ratio = newQuantity / oldQuantity;
    newCostTwd = oldCostTwd * ratio;
    newCostNative = oldCostNative * ratio;
  }

  const valueBase = newQuantity * quote.unitPrice * quote.fxToBase;
  const cashflowTwd =
    -(newQuantity - oldQuantity) * quote.unitPrice * quote.fxToBase;
  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId,
    patch: {
      quantity: newQuantity,
      last_unit_price: quote.unitPrice,
      last_fx_rate: quote.fxToBase,
      last_priced_at: quote.asOf,
      cost_basis_twd: newCostTwd,
      cost_basis_native: newCostNative,
      expected_updated_at: account.updated_at,
    },
    transaction: {
      type: "adjust_quantity",
      quantity_after: newQuantity,
      unit_price: quote.unitPrice,
      fx_rate: quote.fxToBase,
      value_after_base: valueBase,
      cashflow_twd: cashflowTwd,
    },
    snapshots: [
      {
        snapshot_date: todayTaipei(),
        quantity: newQuantity,
        unit_price: quote.unitPrice,
        fx_rate: quote.fxToBase,
        value_base: valueBase,
      },
    ],
  });
  if (mutationError) return { error: mutationError };

  return actionDone(accountId, "已覆寫持有數量");
}

/**
 * 校正成本：只改成本基礎，股數、報價、已實現損益都不動。
 *
 * 刻意不抓報價：這個操作跟市價無關，流水與當日快照沿用帳戶上次的報價，
 * 不花 API 每日預算，報價 API 掛掉時也照樣能校正。
 * 現金流記 0，所以 XIRR / TWR / Sharpe 不受影響（取捨見 AGENTS.md 第七節）。
 */
export async function adjustCostBasis(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = AdjustCostBasisSchema.safeParse({
    accountId: String(formData.get("accountId") ?? ""),
    costNative: formData.get("costNative"),
    costTwd: String(formData.get("costTwd") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const { accountId, costNative, costTwd, note } = parsed.data;
  const { supabase, user, account, error } = await loadAccount(accountId);
  if (error || !account || !user) return { error: error ?? "錯誤" };
  if (account.price_market === "manual" || !account.symbol) {
    return { error: "此操作僅限非手動帳戶" };
  }

  const quantity = Number(account.quantity);
  const oldCostTwd = Number(account.cost_basis_twd ?? 0);
  const oldCostNative = Number(account.cost_basis_native ?? 0);
  const lastFx =
    account.last_fx_rate == null ? null : Number(account.last_fx_rate);
  const resolved = resolveCostCorrection({
    nativeCurrency: account.native_currency,
    quantity,
    currentCostTwd: oldCostTwd,
    currentCostNative: oldCostNative,
    lastFxRate: lastFx,
    costNative,
    costTwd,
  });
  if (!resolved.ok) return { error: resolved.error };

  const unitPrice =
    account.last_unit_price == null ? null : Number(account.last_unit_price);
  const fxRate = lastFx ?? 1;
  const valueBase = quantity * (unitPrice ?? 0) * fxRate;
  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId,
    patch: {
      cost_basis_twd: resolved.costTwd,
      cost_basis_native: resolved.costNative,
      expected_updated_at: account.updated_at,
    },
    transaction: {
      type: "adjust_cost",
      quantity_after: quantity,
      unit_price: unitPrice,
      fx_rate: fxRate,
      value_after_base: valueBase,
      cashflow_twd: 0,
      note: costCorrectionNote({
        nativeCurrency: account.native_currency,
        beforeTwd: oldCostTwd,
        beforeNative: oldCostNative,
        afterTwd: resolved.costTwd,
        afterNative: resolved.costNative,
        userNote: note,
      }),
    },
    // 還沒有報價的帳戶不寫快照：市值會被記成 0，淨值曲線當天憑空掉一截。
    // 快照的成本欄由 RPC 取帳戶更新後的值，這裡不必帶。
    snapshots:
      unitPrice == null
        ? []
        : [
            {
              snapshot_date: todayTaipei(),
              quantity,
              unit_price: unitPrice,
              fx_rate: fxRate,
              value_base: valueBase,
            },
          ],
  });
  if (mutationError) return { error: mutationError };

  return actionDone(accountId, "已校正成本");
}

export async function addByAmount(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = AddByAmountSchema.safeParse({
    accountId: String(formData.get("accountId") ?? ""),
    twd: formData.get("twd"),
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
    twd,
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

  const result = await applyContribution({
    supabase,
    userId: user.id,
    account,
    twd,
    feeTwd,
    priceOverride,
    fxOverride,
    occurredAt,
    noteSuffix: note,
  });
  if (!result.ok) return { error: result.error };

  return actionDone(
    accountId,
    `已加碼，購入 ${result.sharesAdded.toFixed(4)} 股`,
  );
}

export async function adjustBalance(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const accountId = String(formData.get("accountId") ?? "");
  const newBalance = Number(formData.get("balance"));
  if (!accountId) return { error: "缺少帳戶 ID" };
  if (!Number.isFinite(newBalance) || newBalance < 0) {
    return { error: "餘額需為非負數" };
  }

  const { supabase, user, account, error } = await loadAccount(accountId);
  if (error || !account || !user) return { error: error ?? "錯誤" };
  if (account.price_market !== "manual") {
    return { error: "此操作僅限手動帳戶" };
  }

  const oldBalance = Number(account.manual_value_base ?? 0);
  const { error: mutationError } = await applyAccountMutation(supabase, {
    accountId,
    patch: {
      manual_value_base: newBalance,
      cost_basis_twd: newBalance,
      cost_basis_native: newBalance,
      expected_updated_at: account.updated_at,
    },
    transaction: {
      type: "adjust_balance",
      quantity_after: 0,
      unit_price: null,
      fx_rate: 1,
      value_after_base: newBalance,
      cashflow_twd: -(newBalance - oldBalance),
    },
    snapshots: [
      {
        snapshot_date: todayTaipei(),
        quantity: 0,
        unit_price: null,
        fx_rate: 1,
        value_base: newBalance,
      },
    ],
  });
  if (mutationError) return { error: mutationError };

  return actionDone(accountId, "已更新餘額");
}
