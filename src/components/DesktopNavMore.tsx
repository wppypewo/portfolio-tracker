"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePresence } from "./usePresence";

type NavItem = {
  href: string;
  label: string;
  key: string | null;
};

export function DesktopNavMore({
  items,
  active,
}: {
  items: NavItem[];
  active: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `desktop-more-${useId().replace(/:/g, "")}`;
  const groupActive = items.some((item) => item.key === active);
  const { mounted, closing } = usePresence(open);

  useEffect(() => {
    if (!open) return;
    const links = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);
    links()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const choices = links();
      if (choices.length === 0) return;
      event.preventDefault();
      const current = choices.indexOf(document.activeElement as HTMLAnchorElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      choices[(current + delta + choices.length) % choices.length]?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex h-full items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-full items-center gap-1 px-2.5 text-[length:var(--fs-sm)] font-medium ${
          groupActive
            ? "text-[var(--c-text)] after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:bg-[var(--c-accent)]"
            : "text-[var(--c-muted)] hover:text-[var(--c-text)]"
        }`}
      >
        更多
        <svg
          viewBox="0 0 16 16"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          aria-hidden="true"
          // 箭頭翻面跟選單展開同一節奏，交代「這顆鈕現在是收起用的」。
          className={`transition-transform duration-(--dur-base) ease-(--ease-enter) motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {/* 從觸發鈕下緣、靠右的角落長出來，收起時縮回同一角。 */}
      {mounted && (
        <nav
          ref={panelRef}
          id={panelId}
          aria-label="更多功能"
          inert={closing}
          data-closing={closing || undefined}
          className="pop origin-top-right [--pop-from:translateY(-4px)_scale(0.98)] absolute right-0 top-[calc(100%+1px)] z-50 w-44 border border-[var(--c-line-strong)] bg-[var(--c-surface)] shadow-[var(--c-shadow)]"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              onClick={() => setOpen(false)}
              // 每列一條髮絲線分隔，像圖面的圖例欄；目前頁在左緣加 2px 測量藍刻度。
              className={`touch-target flex min-h-10 items-center border-b border-l-2 border-b-[var(--c-border)] px-3 text-[length:var(--fs-sm)] last:border-b-0 ${
                active === item.key
                  ? "border-l-[var(--c-accent)] bg-[var(--c-accent-soft)] font-medium text-[var(--c-text)]"
                  : "border-l-transparent font-medium text-[var(--c-muted)] hover:bg-[var(--c-row-hover)] hover:text-[var(--c-text)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
