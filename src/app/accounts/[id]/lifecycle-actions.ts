"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccount, type FormState } from "./action-shared";

async function setStatus(
  accountId: string,
  status: "active" | "archived",
): Promise<FormState> {
  if (!accountId) return { error: "缺少帳戶 ID" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "請先登入" };

  const { error } = await supabase
    .from("accounts")
    .update({ status })
    .eq("id", accountId);
  if (error) {
    console.error(`[setAccountStatus] 更新失敗 code=${error.code ?? "unknown"}`);
    return { error: "操作失敗，資料未變更。請重新整理後再試" };
  }

  revalidatePath("/");
  revalidatePath(`/accounts/${accountId}`);
  return { ok: status === "archived" ? "帳戶已歸檔" : "帳戶已恢復" };
}

export async function archiveAccount(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return setStatus(String(formData.get("accountId") ?? ""), "archived");
}

export async function unarchiveAccount(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return setStatus(String(formData.get("accountId") ?? ""), "active");
}

export async function deleteAccount(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "缺少帳戶 ID" };

  const { supabase, user, error } = await loadAccount(accountId);
  if (error || !user) return { error: error ?? "錯誤" };

  const { error: deleteError } = await supabase
    .from("accounts")
    .delete()
    .eq("id", accountId);
  if (deleteError) {
    console.error(`[deleteAccount] 刪除失敗 code=${deleteError.code ?? "unknown"}`);
    return { error: "刪除失敗，資料未變更。請重新整理後再試" };
  }

  revalidatePath("/");
  redirect("/");
}
