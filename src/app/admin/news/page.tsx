import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { isAdmin } from "@/lib/admin";
import { NewsPanel } from "./NewsPanel";

// server action 跟著這一頁的函式設定跑。搜尋＋生成實測十幾檔約 20～40 秒，留到 60。
export const maxDuration = 60;

export default async function AdminNews() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user.email)) notFound();

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
          title="持股新聞"
          sub="用 Gemini 搭配 Google 搜尋，找持股近 7 天的消息。按一次查一次，結果不儲存；只送代號與帳戶名稱，不送數量與金額。"
        />
        <div className="mt-8">
          <NewsPanel />
        </div>
      </main>
    </div>
  );
}
