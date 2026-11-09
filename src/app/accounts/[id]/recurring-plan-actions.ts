"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayTaipei } from "@/lib/dates";
import { firstMonthlyRunDate } from "@/lib/recurring-plan-schedule";
import { CreateRecurringPlanSchema } from "@/lib/schemas/action/create-recurring-plan";
import {
  DcaTierConfigSchema,
  dcaTierConfigErrorMessage,
  readDcaTierConfigForm,
  type StoredTierPlanConfig,
} from "@/lib/schemas/domain/dca-tier-config";
import type { FormState } from "./action-shared";

export async function createRecurringPlan(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = CreateRecurringPlanSchema.safeParse({
    accountId: String(formData.get("accountId") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    // 留空 = 0，代表這個計劃沒有手續費。
    fee: String(formData.get("fee") ?? "").trim() || 0,
    dayOfMonth: String(formData.get("dayOfMonth") ?? ""),
    startDate: String(formData.get("startDate") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const { accountId, amount, fee, dayOfMonth, startDate, note } = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id,price_market,status")
    .eq("id", accountId)
    .single();
  if (accountError || !account) return { error: "找不到帳戶" };
  if (account.status === "archived") return { error: "帳戶已歸檔" };
  if (account.price_market === "manual") {
    return { error: "手動帳戶無法設定定期定額" };
  }

  // 級距加減碼：表單選了才讀那組欄位。固定金額的計畫完全不帶 tier_config 這個 key，
  // 所以資料庫還沒跑 20260930180000_recurring_tier_config.sql 時，固定金額照樣建得起來。
  let tierConfig: StoredTierPlanConfig | null = null;
  if (String(formData.get("tierMode") ?? "") === "tier") {
    // 含息序列只接了 FinMind，美股與加密沒有資料來源。
    if (account.price_market !== "tw") {
      return { error: "級距加減碼目前只支援台股帳戶" };
    }
    const tierParsed = DcaTierConfigSchema.safeParse(
      readDcaTierConfigForm(formData),
    );
    if (!tierParsed.success) {
      return { error: dcaTierConfigErrorMessage(tierParsed.error) };
    }
    tierConfig = tierParsed.data;
  }

  const startDateFinal = startDate ?? todayTaipei();
  const { error: insertError } = await supabase.from("recurring_plans").insert({
    user_id: user.id,
    account_id: accountId,
    amount_twd: amount,
    fee_twd: fee,
    day_of_month: dayOfMonth,
    start_date: startDateFinal,
    next_run_date: firstMonthlyRunDate(startDateFinal, dayOfMonth),
    active: true,
    note,
    ...(tierConfig ? { tier_config: tierConfig } : {}),
  });
  if (insertError) {
    // PGRST204：PostgREST 的 schema cache 裡沒有這個欄位，也就是 migration 還沒跑。
    if (tierConfig && insertError.code === "PGRST204") {
      return {
        error:
          "資料庫還沒有級距設定的欄位，請先套用 supabase/migrations/20260930180000_recurring_tier_config.sql",
      };
    }
    console.error(`[createRecurringPlan] 寫入失敗 code=${insertError.code ?? "unknown"}`);
    return { error: "建立計畫失敗，資料未變更。請稍後再試" };
  }

  revalidatePath(`/accounts/${accountId}`);
  return { ok: "定期定額計畫已建立" };
}

export async function togglePlan(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = String(formData.get("planId") ?? "");
  const active = String(formData.get("newActive") ?? "") === "true";
  if (!planId) return { error: "缺少計劃 ID" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: plan, error: planError } = await supabase
    .from("recurring_plans")
    .select("account_id")
    .eq("id", planId)
    .single();
  if (planError || !plan) return { error: "找不到計劃" };

  const { error: updateError } = await supabase
    .from("recurring_plans")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (updateError) {
    console.error(`[togglePlan] 更新失敗 code=${updateError.code ?? "unknown"}`);
    return { error: "更新計畫失敗，資料未變更。請重新整理後再試" };
  }

  revalidatePath(`/accounts/${plan.account_id}`);
  return { ok: active ? "計畫已啟用" : "計畫已暫停" };
}

export async function deletePlan(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = String(formData.get("planId") ?? "");
  if (!planId) return { error: "缺少計劃 ID" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: plan, error: planError } = await supabase
    .from("recurring_plans")
    .select("account_id")
    .eq("id", planId)
    .single();
  if (planError || !plan) return { error: "找不到計劃" };

  const { error: deleteError } = await supabase
    .from("recurring_plans")
    .delete()
    .eq("id", planId);
  if (deleteError) {
    console.error(`[deletePlan] 刪除失敗 code=${deleteError.code ?? "unknown"}`);
    return { error: "刪除計畫失敗，資料未變更。請重新整理後再試" };
  }

  revalidatePath(`/accounts/${plan.account_id}`);
  return { ok: "計畫已刪除" };
}
