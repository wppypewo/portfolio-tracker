import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 有設 MFA 的人，session 必須已升到 AAL2 才算通過；沒設 MFA 的人直接通過。
 *
 * proxy 已經用同一條規則把 AAL1 的人導去 /auth/mfa，這裡是縱深防禦：
 * 用 service_role 刪 auth.users 的 server action 繞過 RLS（mfa_required policy 擋不到），
 * 只靠 proxy 的話，matcher 或公開路徑清單哪天改錯，就變成 AAL1 也能刪帳號。
 *
 * 一定要把 access token 傳給 getAuthenticatorAssuranceLevel：不帶參數時，
 * auth-js 從 cookie 裡的 session.user.factors 判斷「有沒有設 MFA」，
 * 那份 JSON 使用者可以自己改（把 factors 清空，nextLevel 就變 aal1）。
 * 帶 token 時它會用 getUser(jwt) 向 Auth 伺服器驗證 token，factors 也取自伺服器；
 * currentLevel 來自 token 的 aal claim，有簽章，改不了。
 *
 * 查詢失敗回 false（fail closed）：這裡擋的是不可復原的刪除，寧可讓人重試。
 */
export async function mfaSatisfied(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return false;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(
    session.access_token,
  );
  if (error || !data) return false;
  return !(data.nextLevel === "aal2" && data.currentLevel !== "aal2");
}
