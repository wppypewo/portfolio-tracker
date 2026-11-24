"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  DecisionReviewSchema,
  InvestmentDecisionSchema,
  parseDecisionTags,
} from "@/lib/schemas/action/investment-decision";

export type DecisionFormState = { error?: string; ok?: string } | undefined;

type AccountContext = {
  id: string;
  name: string;
  asset_class: string;
  price_market: string;
  symbol: string | null;
  quantity: number;
  native_currency: string;
  last_unit_price: number | null;
  last_fx_rate: number;
  manual_value_base: number | null;
  last_priced_at: string | null;
  cost_basis_twd: number;
  realized_pnl_twd: number;
  status: string;
};

type TransactionContext = {
  id: string;
  account_id: string;
  type: string;
  quantity_after: number | null;
  unit_price: number | null;
  fx_rate: number | null;
  value_after_base: number | null;
  cashflow_twd: number | null;
  created_at: string;
};

const accountColumns =
  "id,name,asset_class,price_market,symbol,quantity,native_currency,last_unit_price,last_fx_rate,manual_value_base,last_priced_at,cost_basis_twd,realized_pnl_twd,status";

export async function createInvestmentDecision(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const parsed = InvestmentDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  let linkedTransaction: TransactionContext | null = null;
  if (parsed.data.transactionId) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "id,account_id,type,quantity_after,unit_price,fx_rate,value_after_base,cashflow_twd,created_at",
      )
      .eq("id", parsed.data.transactionId)
      .single();
    if (error || !data) return { error: "找不到可連結的交易" };
    linkedTransaction = data as TransactionContext;
  }

  const accountId = linkedTransaction?.account_id ?? parsed.data.accountId ?? null;
  if (
    linkedTransaction &&
    parsed.data.accountId &&
    linkedTransaction.account_id !== parsed.data.accountId
  ) {
    return { error: "交易與所選帳戶不一致" };
  }

  const { data: accountRows, error: accountsError } = await supabase
    .from("accounts")
    .select(accountColumns)
    .order("created_at", { ascending: true });
  if (accountsError) return { error: "無法讀取帳戶情境，請稍後再試" };

  const accounts = (accountRows ?? []) as AccountContext[];
  const selectedAccount = accountId
    ? accounts.find((account) => account.id === accountId) ?? null
    : null;
  if (accountId && !selectedAccount) return { error: "找不到所選帳戶" };

  const activeAccounts = accounts.filter((account) => account.status !== "archived");
  const portfolioValueTwd = activeAccounts.reduce(
    (sum, account) => sum + accountValueTwd(account),
    0,
  );
  const selectedValueTwd = selectedAccount ? accountValueTwd(selectedAccount) : null;
  const gaps: string[] = [];
  if (!selectedAccount) gaps.push("未連結帳戶，無法保存持倉與配置快照");
  if (selectedAccount && selectedAccount.last_unit_price == null && selectedAccount.price_market !== "manual") {
    gaps.push("帳戶缺少最新單價");
  }
  if (selectedAccount && !selectedAccount.last_priced_at) {
    gaps.push("帳戶缺少可辨識的報價時間");
  }

  const contextSnapshot = {
    schema_version: 1,
    captured_at: new Date().toISOString(),
    timezone: "Asia/Taipei",
    base_currency: "TWD",
    portfolio: {
      active_account_count: activeAccounts.length,
      value_twd: portfolioValueTwd,
    },
    account: selectedAccount
      ? {
          id: selectedAccount.id,
          name: selectedAccount.name,
          asset_class: selectedAccount.asset_class,
          price_market: selectedAccount.price_market,
          symbol: selectedAccount.symbol,
          quantity: Number(selectedAccount.quantity),
          native_currency: selectedAccount.native_currency,
          unit_price: numberOrNull(selectedAccount.last_unit_price),
          fx_rate: Number(selectedAccount.last_fx_rate),
          value_twd: selectedValueTwd,
          allocation_pct:
            selectedValueTwd != null && portfolioValueTwd > 0
              ? (selectedValueTwd / portfolioValueTwd) * 100
              : null,
          cost_basis_twd: Number(selectedAccount.cost_basis_twd),
          unrealized_pnl_twd:
            selectedValueTwd == null
              ? null
              : selectedValueTwd - Number(selectedAccount.cost_basis_twd),
          realized_pnl_twd: Number(selectedAccount.realized_pnl_twd),
          last_priced_at: selectedAccount.last_priced_at,
          status: selectedAccount.status,
        }
      : null,
    source_transaction: linkedTransaction,
    data_gaps: gaps,
  };

  const { data: created, error } = await supabase
    .from("investment_decisions")
    .insert({
      user_id: user.id,
      account_id: accountId,
      transaction_id: parsed.data.transactionId ?? null,
      decision_date: parsed.data.decisionDate,
      asset_name: parsed.data.assetName,
      symbol: parsed.data.symbol || null,
      decision_type: parsed.data.decisionType,
      thesis: parsed.data.thesis,
      catalysts: parsed.data.catalysts,
      risks: parsed.data.risks,
      invalidation_conditions: parsed.data.invalidationConditions,
      expected_holding_months: parsed.data.expectedHoldingMonths,
      target_return_min_pct: parsed.data.targetReturnMinPct ?? null,
      target_return_max_pct: parsed.data.targetReturnMaxPct ?? null,
      max_drawdown_pct: parsed.data.maxDrawdownPct ?? null,
      confidence: parsed.data.confidence,
      review_date: parsed.data.reviewDate,
      tags: parseDecisionTags(parsed.data.tags),
      context_snapshot: contextSnapshot,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("createInvestmentDecision failed", { code: error?.code });
    return { error: "無法儲存決策，請確認資料庫已套用 v1 migration" };
  }

  revalidatePath("/decisions");
  redirect(`/decisions/${created.id}`);
}

export async function saveDecisionReview(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const decisionId = z.string().uuid().safeParse(formData.get("decisionId"));
  if (!decisionId.success) return { error: "決策識別碼無效" };

  const parsed = DecisionReviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const review = {
    hypothesis_outcome: parsed.data.hypothesisOutcome,
    catalyst_outcome: parsed.data.catalystOutcome,
    risk_outcome: parsed.data.riskOutcome,
    plan_followed: parsed.data.planFollowed,
    asset_return_pct: parsed.data.assetReturnPct ?? null,
    twd_return_pct: parsed.data.twdReturnPct ?? null,
    fx_effect_pct: parsed.data.fxEffectPct ?? null,
    max_favorable_excursion_pct: parsed.data.maxFavorableExcursionPct ?? null,
    max_adverse_excursion_pct: parsed.data.maxAdverseExcursionPct ?? null,
    decision_quality: parsed.data.decisionQuality,
    reflection: parsed.data.reflection,
    next_improvement: parsed.data.nextImprovement,
  };
  const { error } = await supabase.rpc("save_decision_review", {
    p_decision_id: decisionId.data,
    p_review: review,
  });
  if (error) {
    console.error("saveDecisionReview failed", { code: error.code });
    return { error: "無法儲存檢討，請稍後再試" };
  }

  revalidatePath("/decisions");
  revalidatePath(`/decisions/${decisionId.data}`);
  return { ok: "檢討已儲存" };
}

export async function updateInvestmentDecision(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const decisionId = z.string().uuid().safeParse(formData.get("decisionId"));
  if (!decisionId.success) return { error: "決策識別碼無效" };
  const parsed = InvestmentDecisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { data: existing, error: existingError } = await supabase
    .from("investment_decisions")
    .select("id")
    .eq("id", decisionId.data)
    .eq("user_id", user.id)
    .single();
  if (existingError || !existing) return { error: "找不到可編輯的決策" };

  const { data: updated, error } = await supabase
    .from("investment_decisions")
    .update({
      decision_date: parsed.data.decisionDate,
      asset_name: parsed.data.assetName,
      symbol: parsed.data.symbol || null,
      decision_type: parsed.data.decisionType,
      thesis: parsed.data.thesis,
      catalysts: parsed.data.catalysts,
      risks: parsed.data.risks,
      invalidation_conditions: parsed.data.invalidationConditions,
      expected_holding_months: parsed.data.expectedHoldingMonths,
      target_return_min_pct: parsed.data.targetReturnMinPct ?? null,
      target_return_max_pct: parsed.data.targetReturnMaxPct ?? null,
      max_drawdown_pct: parsed.data.maxDrawdownPct ?? null,
      confidence: parsed.data.confidence,
      review_date: parsed.data.reviewDate,
      tags: parseDecisionTags(parsed.data.tags),
    })
    .eq("id", decisionId.data)
    .eq("user_id", user.id)
    .select("id")
    .single();
  if (error || !updated) {
    console.error("updateInvestmentDecision failed", { code: error?.code });
    return { error: "無法更新決策；原始情境未變更，請稍後再試" };
  }

  revalidatePath("/decisions");
  revalidatePath(`/decisions/${decisionId.data}`);
  redirect(`/decisions/${decisionId.data}`);
}

/**
 * 封存或取消封存一筆決策。archived=true 封存，false 復原。
 *
 * 復原時要放回封存前的狀態：已經寫過檢討的回到 reviewed，沒寫過的回到 open。
 * 狀態只看 decision_reviews 有沒有那一列，跟 submit_decision_review RPC 的判斷一致。
 * 以前封存是單向的，按錯就再也不能編輯；失敗也只寫 log，畫面不說。
 */
export async function setDecisionArchived(
  _previous: DecisionFormState,
  formData: FormData,
): Promise<DecisionFormState> {
  const decisionId = z.string().uuid().safeParse(formData.get("decisionId"));
  if (!decisionId.success) return { error: "找不到這筆決策，重新整理再試一次" };
  const archive = formData.get("archived") === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "登入已過期，請重新登入" };

  let status: "archived" | "open" | "reviewed" = "archived";
  if (!archive) {
    const { data: review, error: reviewError } = await supabase
      .from("decision_reviews")
      .select("id")
      .eq("decision_id", decisionId.data)
      .eq("user_id", user.id)
      .maybeSingle();
    if (reviewError) {
      console.error("setDecisionArchived review lookup failed", { code: reviewError.code });
      return { error: "復原失敗，資料沒有變動。請稍後再試" };
    }
    status = review ? "reviewed" : "open";
  }

  const { error } = await supabase
    .from("investment_decisions")
    .update({ status })
    .eq("id", decisionId.data)
    .eq("user_id", user.id);
  if (error) {
    console.error("setDecisionArchived failed", { code: error.code });
    return { error: `${archive ? "封存" : "復原"}失敗，資料沒有變動。請稍後再試` };
  }
  revalidatePath("/decisions");
  revalidatePath(`/decisions/${decisionId.data}`);
  return { ok: archive ? "決策已封存" : "決策已復原" };
}

function accountValueTwd(account: AccountContext): number {
  if (account.price_market === "manual") {
    return Number(account.manual_value_base ?? 0);
  }
  return (
    Number(account.quantity) *
    Number(account.last_unit_price ?? 0) *
    Number(account.last_fx_rate ?? 1)
  );
}

function numberOrNull(value: number | null): number | null {
  return value == null ? null : Number(value);
}
