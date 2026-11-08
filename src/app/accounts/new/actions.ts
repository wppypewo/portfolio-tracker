"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getQuote } from "@/lib/prices/router";
import { todayTaipei } from "@/lib/dates";
import {
  CreateStockAccountSchema,
  CreateCryptoAccountSchema,
  CreateManualAccountSchema,
} from "@/lib/schemas/action/create-account";

export type FormState = { error?: string } | undefined;

// 共用：取已登入使用者，未登入回錯。
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null as null, error: "請先登入" };
  }
  return { supabase, user, error: null as null };
}

// 共用：寫入 accounts → transactions → account_snapshots 三表。
// 任一步失敗回傳 error 訊息。成功則 redirect 不回傳。
async function persistCreate(args: {
  name: string;
  assetClass: "stock" | "crypto" | "other_investment";
  priceMarket: "us" | "tw" | "crypto" | "manual";
  symbol: string | null;
  quantity: number;
  nativeCurrency: string;
  unitPrice: number | null;
  fxToBase: number;
  manualValueBase: number | null;
  lastPricedAt: string | null;
  valueBase: number;
}): Promise<FormState> {
  const { supabase, user, error: userErr } = await requireUser();
  if (userErr || !user) return { error: userErr ?? "未登入" };

  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .insert({
      user_id: user.id,
      name: args.name,
      asset_class: args.assetClass,
      price_market: args.priceMarket,
      symbol: args.symbol,
      quantity: args.quantity,
      native_currency: args.nativeCurrency,
      last_unit_price: args.unitPrice,
      last_fx_rate: args.fxToBase,
      manual_value_base: args.manualValueBase,
      last_priced_at: args.lastPricedAt,
      cost_basis_twd: args.valueBase, // 建立時：成本 = 當下市值
      cost_basis_native:
        args.manualValueBase ??
        (args.unitPrice != null ? args.quantity * args.unitPrice : args.valueBase),
    })
    .select("id")
    .single();
  // 資料庫原始訊息可能帶出表名、欄位、限制名稱，只記 code，前端給固定訊息。
  // 與 alert-actions.ts、activity/actions.ts 同一套做法。
  if (accErr || !account) {
    console.error(`[createAccount] 建立帳戶失敗 code=${accErr?.code ?? "unknown"}`);
    return { error: "建立帳戶失敗，資料未變更。請稍後再試" };
  }

  const { error: txErr } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: account.id,
    type: "create",
    quantity_after: args.quantity,
    unit_price: args.unitPrice,
    fx_rate: args.fxToBase,
    value_after_base: args.valueBase,
    cashflow_twd: -args.valueBase, // 建立帳戶 = 一次性投入：負現金流
  });
  if (txErr) {
    return rollbackCreatedAccount(supabase, account.id, "transactions", txErr.code);
  }

  const { error: snapErr } = await supabase.from("account_snapshots").insert({
    user_id: user.id,
    account_id: account.id,
    snapshot_date: todayTaipei(),
    quantity: args.quantity,
    unit_price: args.unitPrice,
    fx_rate: args.fxToBase,
    value_base: args.valueBase,
  });
  if (snapErr) {
    return rollbackCreatedAccount(supabase, account.id, "account_snapshots", snapErr.code);
  }

  redirect("/");
}

// 三段 insert 不在同一個 transaction 裡。後兩段失敗時，帳戶列已經寫進去了：
// 沒有 create 交易的帳戶會讓成本與現金流對不起來，使用者看到失敗訊息再按一次
// 還會多出一個同名帳戶。這裡把剛建的帳戶刪掉；transactions 與 account_snapshots
// 對 accounts 都是 on delete cascade（supabase/schema.sql），已寫入的部分一起清掉。
// 刪除本身也可能失敗，那時明講要使用者去首頁確認，不要讓人以為什麼都沒留下。
async function rollbackCreatedAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  stage: "transactions" | "account_snapshots",
  code: string | undefined,
): Promise<FormState> {
  console.error(`[createAccount] 寫入 ${stage} 失敗 code=${code ?? "unknown"}`);
  const { error: delErr } = await supabase
    .from("accounts")
    .delete()
    .eq("id", accountId);
  if (delErr) {
    console.error(`[createAccount] 回滾帳戶失敗 code=${delErr.code ?? "unknown"}`);
    return {
      error: "建立帳戶未完成，且無法自動清除。請到首頁確認是否出現不完整的帳戶並手動刪除",
    };
  }
  return { error: "建立帳戶失敗，資料未變更。請稍後再試" };
}

// ===== 股票（美股/台股）=====
export async function createStockAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = CreateStockAccountSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    market: String(formData.get("market") ?? ""),
    symbol: String(formData.get("symbol") ?? ""),
    quantity: String(formData.get("quantity") ?? ""),
  });
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "輸入資料無效" };
  }
  const { name, market, symbol, quantity: qty } = result.data;

  // 即時抓一次價格驗證 symbol 正確。
  let quote;
  try {
    quote = await getQuote(market, symbol, "TWD");
  } catch (e) {
    return { error: `找不到 ${symbol} 的價格：${(e as Error).message}` };
  }

  return persistCreate({
    name,
    assetClass: "stock",
    priceMarket: market,
    symbol,
    quantity: qty,
    nativeCurrency: quote.nativeCurrency,
    unitPrice: quote.unitPrice,
    fxToBase: quote.fxToBase,
    manualValueBase: null,
    lastPricedAt: quote.asOf,
    valueBase: qty * quote.unitPrice * quote.fxToBase,
  });
}

// ===== 加密貨幣 =====
export async function createCryptoAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = CreateCryptoAccountSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    symbol: String(formData.get("symbol") ?? ""),
    quantity: String(formData.get("quantity") ?? ""),
  });
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "輸入資料無效" };
  }
  const { name, symbol, quantity: qty } = result.data;

  let quote;
  try {
    quote = await getQuote("crypto", symbol, "TWD");
  } catch (e) {
    return { error: `找不到 ${symbol} 的價格：${(e as Error).message}` };
  }

  return persistCreate({
    name,
    assetClass: "crypto",
    priceMarket: "crypto",
    symbol,
    quantity: qty,
    nativeCurrency: quote.nativeCurrency,
    unitPrice: quote.unitPrice,
    fxToBase: quote.fxToBase,
    manualValueBase: null,
    lastPricedAt: quote.asOf,
    valueBase: qty * quote.unitPrice * quote.fxToBase,
  });
}

// ===== 其他投資（manual）=====
export async function createManualAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = CreateManualAccountSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    balance: String(formData.get("balance") ?? ""),
  });
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "輸入資料無效" };
  }
  const { name, balance } = result.data;

  return persistCreate({
    name,
    assetClass: "other_investment",
    priceMarket: "manual",
    symbol: null,
    quantity: 0,
    nativeCurrency: "TWD",
    unitPrice: null,
    fxToBase: 1,
    manualValueBase: balance,
    lastPricedAt: null,
    valueBase: balance,
  });
}
