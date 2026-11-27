import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AppHeader } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { isAdmin } from "@/lib/admin";
import { UsersManager, type UserRow } from "./AllowlistManager";

export default async function AdminUsers() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdmin(user.email)) {
    notFound();
  }

  // 用 service-role 列出所有 auth.users（一般 client 無權讀）
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) {
    // 只記錯誤碼與 HTTP 狀態；原文可能帶內部細節，不送到畫面，也不記 email／user_id
    console.error(
      `[admin/allowlist] listUsers 失敗 code=${error.code ?? "unknown"} status=${error.status ?? "unknown"}`,
    );
  }

  const rows: UserRow[] = (data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "（無 email）",
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    confirmed: !!u.email_confirmed_at,
  }));

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active={null} userEmail={user.email} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/settings"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] transition-colors hover:text-[var(--c-accent)]"
        >
          ← 回設定
        </Link>
        <PageHead
          className="mt-4"
          label="管理"
          title="使用者管理"
          sub="已開放註冊，任何 email 都能建立帳號（須驗證信箱）。從這裡看誰註冊了，必要時可以踢出特定帳號。"
        />

        {error && (
          <p className="mt-6 border border-[var(--c-down)] px-4 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]">
            讀取使用者列表失敗，請稍後重新整理。問題持續的話到伺服器 log 查 [admin/allowlist]。
          </p>
        )}

        <div className="mt-8">
          <UsersManager rows={rows} currentUserId={user.id} />
        </div>
      </main>
    </div>
  );
}
