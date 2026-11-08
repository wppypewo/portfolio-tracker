"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { mfaSatisfied } from "@/lib/supabase/mfa-guard";
import { DeleteMyAccountSchema } from "@/lib/schemas/action/delete-my-account";
import {
  SetAllocationTargetsSchema,
  SetConcentrationLimitSchema,
} from "@/lib/schemas/action/set-allocation-targets";

export type FormState = { error?: string } | undefined;

// 儲存使用者的資產配置目標到 profiles.allocation_targets (jsonb)
// 表單欄位命名：target_<asset_class>，值為百分比 0-100；"" 或 "0" 表示清除該類別目標
export async function setAllocationTargets(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const rawEntries: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && key.startsWith("target_")) {
      rawEntries[key.slice("target_".length)] = value;
    }
  }

  const result = SetAllocationTargetsSchema.safeParse(rawEntries);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const targets: Record<string, number> = {};
  for (const [cls, val] of Object.entries(result.data)) {
    if (val !== 0) targets[cls] = val; // 0 視為「不設目標」，從 jsonb 移除
  }

  const { error } = await supabase
    .from("profiles")
    .update({ allocation_targets: targets })
    .eq("id", user.id);
  if (error) {
    console.error(
      `[setAllocationTargets] 更新失敗 code=${error.code ?? "unknown"}`,
    );
    return { error: "儲存目標配置失敗，請稍後再試" };
  }

  revalidatePath("/");
  return undefined;
}

export async function setConcentrationLimit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = SetConcentrationLimitSchema.safeParse({
    concentrationLimitPct: formData.get("concentrationLimitPct"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("profiles")
    .update({ concentration_limit_pct: parsed.data.concentrationLimitPct })
    .eq("id", user.id);
  if (error) return { error: "無法儲存集中度上限" };

  revalidatePath("/settings");
  revalidatePath("/whatif");
  return undefined;
}

/**
 * 使用者自行刪除帳戶。不可逆。
 *
 * 刪 auth.users 那一列，其餘資料靠 FK on delete cascade 連鎖清除：
 * profiles / accounts / transactions / account_snapshots / account_status_history /
 * investment_decisions（連帶 decision_reviews）/ recurring_plans（連帶 recurring_plan_runs）/
 * alerts / notifications。
 *
 * 刪 auth.users 需要 service-role，RLS 繞不過去，所以這裡用 service client；
 * 但目標 id 一律取自 session，不接受表單傳入的 userId，避免變成任意刪除的入口。
 * admin 那支 deleteUser（allowlist-actions）維持「不能刪自己」的限制不動。
 */
export async function deleteMyAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = DeleteMyAccountSchema.safeParse({
    confirmEmail: formData.get("confirmEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "輸入資料無效" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };
  if (!user.email) return { error: "此帳號沒有 email，無法自助刪除，請聯繫 admin" };

  if (parsed.data.confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
    return { error: "輸入的 email 與登入帳號不符" };
  }

  // 縱深防禦：proxy 已擋 AAL1，這裡再檢查一次，見 mfa-guard.ts
  if (!(await mfaSatisfied(supabase))) {
    return { error: "請先完成兩步驟驗證再刪除帳號" };
  }

  // createServiceClient 在缺 env 時會 throw。放著不接的話 server action 直接炸掉，
  // 使用者看到的是錯誤邊界而不是表單內的訊息，所以在這裡收成 FormState。
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    console.error("[deleteMyAccount] service client 初始化失敗");
    return { error: "刪除功能暫時無法使用，請聯繫 admin" };
  }

  const { error } = await svc.auth.admin.deleteUser(user.id);
  if (error) {
    // 不把底層訊息回給 client，也不把 user id / email 寫進 log。
    console.error("[deleteMyAccount] admin.deleteUser 失敗");
    return { error: "刪除失敗，資料未變更。請稍後再試或聯繫 admin" };
  }

  // 使用者已不存在，走 local scope 只清本機 cookie，不再打一次必然失敗的撤銷 API。
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
