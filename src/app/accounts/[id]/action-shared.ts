import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string } | undefined;

export type AccountForAction = {
  id: string;
  user_id: string;
  price_market: "us" | "tw" | "crypto" | "manual";
  symbol: string | null;
  quantity: number;
  native_currency: string;
  last_unit_price: number | null;
  last_fx_rate: number;
  manual_value_base: number | null;
  cost_basis_twd: number;
  cost_basis_native: number;
  realized_pnl_twd: number;
  updated_at: string;
};

export async function loadAccount(accountId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, account: null, error: "請先登入" };
  }

  const { data, error } = await supabase
    .from("accounts")
    .select(
      "id,user_id,price_market,symbol,quantity,native_currency,last_unit_price,last_fx_rate,manual_value_base,cost_basis_twd,cost_basis_native,realized_pnl_twd,updated_at",
    )
    .eq("id", accountId)
    .single();
  if (error || !data) {
    return { supabase, user, account: null, error: "找不到帳戶" };
  }

  return {
    supabase,
    user,
    account: data as AccountForAction,
    error: null,
  };
}

export function actionDone(accountId: string, ok = "已完成"): FormState {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
  return { ok };
}
