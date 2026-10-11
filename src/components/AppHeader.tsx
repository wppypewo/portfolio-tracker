import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { PrivacyToggle } from "./PrivacyToggle";
import { MobileNavToggle } from "./MobileNavToggle";
import { DesktopNavMore } from "./DesktopNavMore";
import { SurveyNav } from "./SurveyNav";

type Active =
  | "portfolio"
  | "accounts"
  | "activity"
  | "decisions"
  | "history"
  | "reports"
  | "alerts"
  | "whatif"
  | "settings"
  | null;

export function AppHeader({
  active,
  userEmail,
  unreadCount = 0,
  authPending = false,
}: {
  active: Active;
  userEmail?: string | null;
  unreadCount?: number;
  // 登入狀態尚未確定（loading.tsx 骨架不能自己 fetch user）。
  // 此時右上角渲染等寬佔位，不渲染「登入」按鈕，避免切頁時閃出登入又跳回去。
  authPending?: boolean;
}) {
  const navItems: { href: string; label: string; key: Active }[] = [
    { href: "/", label: "總覽", key: "portfolio" },
    { href: "/accounts", label: "帳戶", key: "accounts" },
    { href: "/activity", label: "活動", key: "activity" },
    { href: "/decisions", label: "日誌", key: "decisions" },
    { href: "/history", label: "歷史", key: "history" },
    { href: "/reports/monthly", label: "月報", key: "reports" },
    { href: "/alerts", label: "提醒", key: "alerts" },
    { href: "/whatif", label: "情境", key: "whatif" },
    { href: "/settings", label: "設定", key: "settings" },
  ];
  const primaryItems = navItems.filter((item) =>
    ["portfolio", "accounts", "activity", "decisions", "whatif"].includes(
      item.key ?? "",
    ),
  );
  const moreItems = navItems.filter((item) =>
    ["history", "reports", "alerts", "settings"].includes(item.key ?? ""),
  );

  const initials = getInitials(userEmail);

  return (
    // 實心桌面色，不半透明、不模糊：導覽列是壓在圖面上方的標題欄，不是毛玻璃。
    <header data-app-header className="sticky top-0 z-40 border-b border-[var(--c-line-strong)] bg-[var(--c-page)]">
      <div className="mx-auto flex h-[var(--header-h)] max-w-[1200px] items-center gap-4 px-4 sm:px-6 lg:px-7">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-[var(--c-text)]"
          aria-label="StackWorth 首頁"
        >
          <RegistrationMark className="text-[var(--c-accent)]" />
          <span className="text-[17px] font-semibold tracking-[-0.025em] sm:text-[18px]">
            StackWorth
          </span>
        </Link>

        <SurveyNav
          label="主要導覽"
          items={primaryItems}
          active={active}
          className="ml-2 hidden h-full items-center gap-1 md:flex"
          itemClassName="h-full"
        >
          <DesktopNavMore items={moreItems} active={active} />
        </SurveyNav>

        <div className="ml-auto flex h-full items-center gap-1 sm:gap-1.5">
          {/* 圖面角落的比例尺註記：所有金額以台幣計。 */}
          <span className="mr-2 hidden font-mono text-[length:var(--fs-micro)] tracking-[0.06em] text-[var(--c-faint)] lg:inline">
            基準 TWD
          </span>
          {userEmail ? (
            <Link
              href="/notifications"
              aria-label={`通知${unreadCount > 0 ? `，${unreadCount} 則未讀` : ""}`}
              title="通知"
              className="touch-target relative inline-flex h-10 w-10 items-center justify-center rounded-[var(--r-control)] text-[var(--c-muted)] hover:bg-[var(--c-surface-soft)] hover:text-[var(--c-text)]"
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center bg-[var(--c-accent)] px-1 font-mono text-[length:var(--fs-micro)] font-semibold leading-none text-[var(--c-btn-strong-text)] tnum">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          ) : authPending ? (
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--r-control)] text-[var(--c-faint)]"
            >
              <BellIcon />
            </span>
          ) : null}

          <PrivacyToggle />
          <div className="hidden md:block">
            <ThemeToggle />
          </div>

          {userEmail ? (
            <Link
              href="/settings"
              title={userEmail}
              aria-label="帳號設定"
              className="touch-target hidden h-8 w-8 items-center justify-center border border-[var(--c-line-strong)] bg-[var(--c-surface)] font-mono text-xs font-medium text-[var(--c-muted)] hover:border-[var(--c-accent)] hover:text-[var(--c-text)] sm:inline-flex"
            >
              {initials}
            </Link>
          ) : authPending ? (
            <span
              aria-hidden="true"
              className="hidden h-8 w-8 items-center justify-center border border-[var(--c-line-strong)] bg-[var(--c-surface)] font-mono text-xs font-medium text-[var(--c-faint)] sm:inline-flex"
            >
              {initials}
            </span>
          ) : null}

          <div className="md:hidden">
            <MobileNavToggle
              items={navItems}
              active={active}
              signedIn={Boolean(userEmail)}
            />
          </div>

          {!userEmail && !authPending && (
            <Link
              href="/login"
              className="btn btn-outline"
            >
              登入
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/* 套準記號：印刷與製圖用來對位的十字圓標，當品牌記號用。
   /methodology 的獨立頁首也用同一個，所以匯出。 */
export function RegistrationMark({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 0.5v15M0.5 8h15" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function getInitials(email?: string | null): string {
  if (!email) return "··";
  const at = email.indexOf("@");
  const name = at > 0 ? email.slice(0, at) : email;
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
