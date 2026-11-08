"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin } from "@/lib/admin";
import { mfaSatisfied } from "@/lib/supabase/mfa-guard";

export type FormState = { error?: string } | undefined;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) {
    return { ok: false as const, error: "需要 admin 權限" };
  }
  // 縱深防禦：proxy 已擋 AAL1，這裡再檢查一次，見 mfa-guard.ts
  if (!(await mfaSatisfied(supabase))) {
    return { ok: false as const, error: "請先完成兩步驟驗證再操作" };
  }
  return { ok: true as const, currentUserId: user.id };
}

// 刪除使用者：呼叫 Supabase Admin API。CASCADE 會清掉該使用者的 profiles / accounts / transactions 等所有資料。
export async function deleteUser(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: auth.error };

  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return { error: "缺少 userId" };
  if (userId === auth.currentUserId) {
    return { error: "不能刪除自己" };
  }

  // 缺 env 時 createServiceClient 會 throw；不接的話 admin 頁直接落到錯誤邊界。
  // 與 profile-actions.ts 的 deleteMyAccount 同一套處理。
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    console.error("[deleteAllowlistUser] service client 初始化失敗");
    return { error: "刪除功能暫時無法使用，請檢查伺服器環境變數" };
  }
  const { error } = await svc.auth.admin.deleteUser(userId);
  if (error) {
    // 不印 userId：admin 操作 log 也不需要把被刪除者的 id 留下來。
    console.error(`[deleteAllowlistUser] admin.deleteUser 失敗`);
    return { error: "刪除失敗，資料未變更。請稍後再試" };
  }

  revalidatePath("/admin/allowlist");
  return undefined;
}
