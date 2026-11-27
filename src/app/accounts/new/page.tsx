import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { getUnreadCount } from "@/lib/notifications";

export default async function NewAccountIndex() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
  ] = await Promise.all([supabase.auth.getUser(), getUnreadCount()]);

  const items = [
    {
      href: "/accounts/new/stock",
      title: "股票",
      desc: "美股 / 台股，輸入 ticker / 代號自動驗證並抓最新價",
      icon: "▲",
    },
    {
      href: "/accounts/new/crypto",
      title: "加密貨幣",
      desc: "以 CoinGecko id（如 bitcoin）建立，CoinGecko 直接回 TWD",
      icon: "₿",
    },
    {
      href: "/accounts/new/manual",
      title: "其他投資（手動）",
      desc: "直接輸入餘額，不自動抓價（適合銀行存款、保單現金價值等）",
      icon: "$",
    },
  ];

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="accounts" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-4xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        <Link
          href="/accounts"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] hover:text-[var(--c-accent)]"
        >
          ← 帳戶
        </Link>
        <PageHead
          className="mt-4"
          label="新增帳戶"
          title="選擇資產類型"
          sub="流動資金 / 固定資產 / 應收款 / 負債 等其餘類別會在後續版本加入。"
        />
        {/* 三個選項是同一張圖的三個地塊：共用外框，彼此以髮絲線分隔，不各自浮起 */}
        <div className="mt-6 grid border border-[var(--c-border)] bg-[var(--c-surface)] sm:grid-cols-3">
          {items.map((it, i) => (
            <Link
              key={it.href}
              href={it.href}
              className={`group flex items-start gap-4 px-5 py-5 transition-colors hover:bg-[var(--c-row-hover)] sm:flex-col sm:gap-3 ${
                i > 0 ? "border-t border-[var(--c-border)] sm:border-l sm:border-t-0" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center border border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-base font-medium text-[var(--c-accent)]"
              >
                {it.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[length:var(--fs-md)] font-medium">{it.title}</div>
                <div className="mt-1 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
                  {it.desc}
                </div>
              </div>
              <span
                aria-hidden="true"
                className="self-center text-[var(--c-faint)] transition-colors group-hover:text-[var(--c-accent)] sm:self-end"
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
