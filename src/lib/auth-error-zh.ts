/**
 * 把 Supabase Auth 的錯誤轉成中文句子。
 *
 * 以前登入、MFA、重設密碼直接顯示 error.message，使用者看到的是
 * "Invalid login credentials" 這類英文。這裡依 AuthError.code 對照
 * （代碼表見 supabase/supabase 的 packages/common/constants/auth-error-codes.ts），
 * 沒對到的一律用呼叫端給的中文 fallback，不把英文原文丟給使用者。
 *
 * 帳密錯誤只說「Email 或密碼不對」，不分是帳號不存在還是密碼錯，
 * 免得登入頁變成查帳號是否存在的工具。
 */
const ZH: Record<string, string> = {
  invalid_credentials: "Email 或密碼不對，請再確認一次",
  email_not_confirmed: "這個 Email 還沒完成驗證，請先點驗證信裡的連結",
  user_already_exists: "這個 Email 無法註冊。如果你已經有帳號，直接登入或重設密碼",
  email_address_invalid: "這個 Email 格式無法使用，請換一個",
  weak_password: "密碼強度不夠，請加長或混用英數與符號",
  same_password: "新密碼不能和目前的密碼一樣",
  over_email_send_rate_limit: "寄信次數太多，請過幾分鐘再試",
  over_request_rate_limit: "嘗試次數太多，請過幾分鐘再試",
  signup_disabled: "目前不開放註冊",
  otp_expired: "連結已過期，請重新申請一次",
  flow_state_expired: "登入流程逾時，請重新登入",
  flow_state_not_found: "登入流程逾時，請重新登入",
  session_expired: "登入已過期，請重新登入",
  session_not_found: "登入已過期，請重新登入",
  reauthentication_needed: "改密碼前需要重新登入一次",
  mfa_verification_failed: "驗證碼不對，請看 App 上最新的 6 位數",
  mfa_challenge_expired: "驗證逾時，請重新輸入驗證碼",
  mfa_factor_not_found: "找不到這組驗證器，請重新整理後再試",
  too_many_enrolled_mfa_factors: "驗證器數量已達上限，先移除舊的再新增",
  request_timeout: "連線逾時，請再試一次",
};

export function authErrorToZh(
  error: { code?: string | null } | null | undefined,
  fallback: string,
): string {
  const code = error?.code ?? "";
  return ZH[code] ?? fallback;
}
