"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CreateAlertSchema } from "@/lib/schemas/action/create-alert";

export type FormState = { error?: string; ok?: boolean } | undefined;

export async function createAlert(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登入" };

  const result = CreateAlertSchema.safeParse({
    type: fd.get("type"),
    threshold: fd.get("threshold"),
    accountId: fd.get("accountId") || null,
    note: fd.get("note") || null,
  });

  if (!result.success) {
    const firstIssue = result.error.issues[0]?.message ?? "輸入資料無效";
    return { error: firstIssue };
  }

  const { type, threshold, accountId, note } = result.data;

  // alerts 的 RLS 只檢查 user_id，account_id 的 FK 不受 RLS 限制，
  // 所以要自己確認帳戶屬於登入者。這裡用的是使用者的 client，查得到才是自己的。
  if (type !== "allocation_drift" && accountId) {
    const { data: owned } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (!owned) return { error: "找不到這個帳戶" };
  }

  const { error } = await supabase.from("alerts").insert({
    user_id: user.id,
    type,
    account_id: type === "allocation_drift" ? null : accountId,
    threshold,
    note,
  });
  if (error) {
    console.error(`[createAlert] 寫入失敗 code=${error.code ?? "unknown"}`);
    return { error: "建立警示失敗，請稍後再試" };
  }

  revalidatePath("/alerts");
  return { ok: true };
}

export async function deleteAlert(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登入" };
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "缺少提醒識別碼" };
  const { error } = await supabase
    .from("alerts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error(`[deleteAlert] 刪除失敗 code=${error.code ?? "unknown"}`);
    return { error: "刪除提醒失敗，請稍後再試" };
  }
  revalidatePath("/alerts");
  return { ok: true };
}

export async function toggleAlert(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登入" };
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "1";
  if (!id) return { error: "缺少提醒識別碼" };
  const { error } = await supabase
    .from("alerts")
    .update({ active })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error(`[toggleAlert] 更新失敗 code=${error.code ?? "unknown"}`);
    return { error: "更新提醒失敗，請稍後再試" };
  }
  revalidatePath("/alerts");
  return { ok: true };
}

export async function markNotificationRead(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登入" };
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "缺少通知識別碼" };
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    console.error(`[markNotificationRead] 更新失敗 code=${error.code ?? "unknown"}`);
    return { error: "更新通知失敗，請稍後再試" };
  }
  revalidatePath("/notifications");
  revalidatePath("/");
  return { ok: true };
}

export async function markAllNotificationsRead(
  prev: FormState,
  fd: FormData,
): Promise<FormState> {
  // useActionState 會固定傳入前一狀態與 FormData；此動作不需要其中內容。
  void prev;
  void fd;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登入" };
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) {
    console.error(`[markAllNotificationsRead] 更新失敗 code=${error.code ?? "unknown"}`);
    return { error: "更新通知失敗，請稍後再試" };
  }
  revalidatePath("/notifications");
  revalidatePath("/");
  return { ok: true };
}
