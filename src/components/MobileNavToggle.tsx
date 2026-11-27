"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { usePresence } from "./usePresence";

type Item = {
  href: string;
  label: string;
  key:
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
};

export function MobileNavToggle({
  items,
  active,
  signedIn,
}: {
  items: Item[];
  active: Item["key"];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = `mobile-nav-${useId().replace(/:/g, "")}`;
  // 關閉時抽屜先往上收回頁首、遮罩先淡掉，--dur-fast 後才卸載。
  const { mounted, closing } = usePresence(open);

  useEffect(() => {
    if (!open) return;

    const trigger = buttonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const itemsInPanel = focusables();
      if (itemsInPanel.length === 0) return;
      const first = itemsInPanel[0];
      const last = itemsInPanel[itemsInPanel.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "關閉導覽" : "開啟導覽"}
        aria-expanded={open}
        aria-controls={panelId}
        className="btn btn-ghost btn-icon"
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <path d="M6 6l12 12M6 18L18 6" />
          ) : (
            <path d="M3 7h18M3 12h18M3 17h18" />
          )}
        </svg>
      </button>

      {/* 圖示直接換、不做漢堡變叉的變形：按鈕本身不是主角，抽屜從頁首往下展開才是在交代
          「導覽從這裡出來」。收起時往上縮回同一條線。 */}
      {mounted && (
        <>
          <button
            type="button"
            aria-label="關閉導覽"
            onClick={() => setOpen(false)}
            tabIndex={closing ? -1 : undefined}
            aria-hidden={closing || undefined}
            data-closing={closing || undefined}
            className="pop pop-scrim fixed inset-0 top-[var(--header-h)] z-30 bg-[var(--c-scrim)] md:hidden"
          />
          <nav
            ref={panelRef}
            id={panelId}
            inert={closing}
            data-closing={closing || undefined}
            className="pop [--pop-from:translateY(-8px)] safe-bottom fixed left-0 right-0 top-[var(--header-h)] z-40 flex max-h-[calc(100dvh-var(--header-h))] flex-col overflow-y-auto border-b border-[var(--c-line-strong)] bg-[var(--c-page)] px-4 pb-4 pt-1 md:hidden"
            aria-label="主要導覽"
          >
            {/* 圖面索引表：一列一項，左邊等寬編號 01–09，列與列之間一條髮絲線。
                編號是位置提示，不是資料，所以用 faint 色、不加粗。 */}
            <ol className="border-b border-[var(--c-border)]">
              {items.map((item, index) => {
                const isActive = active === item.key;
                return (
                  <li key={item.href} className="border-t border-[var(--c-border)] first:border-t-0">
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-12 items-center gap-4 border-l-2 pl-3 pr-2 text-[length:var(--fs-md)] ${
                        isActive
                          ? "border-l-[var(--c-accent)] bg-[var(--c-accent-soft)] font-medium text-[var(--c-text)]"
                          : "border-l-transparent font-medium text-[var(--c-muted)] hover:bg-[var(--c-row-hover)] hover:text-[var(--c-text)]"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-5 font-mono text-[length:var(--fs-micro)] ${
                          isActive ? "text-[var(--c-accent)]" : "text-[var(--c-faint)]"
                        }`}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">顯示模式</span>
              <ThemeToggle />
            </div>

            {signedIn && (
              <form action="/auth/signout" method="post" className="mt-3">
                <button
                  type="submit"
                  className="btn btn-outline w-full"
                >
                  登出
                </button>
              </form>
            )}
          </nav>
        </>
      )}
    </>
  );
}
