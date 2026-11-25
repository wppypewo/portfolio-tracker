"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Item = { href: string; label: string; key: string | null };

// 指示線比連結左右各內縮 6px，與原本的 inset-x-1.5 一致
const INSET = 6;
// 橫線以 100px 為基準寬，用 scaleX 伸縮到實際寬度
const BAR_BASE = 100;
const MOVE =
  "transition-transform duration-(--dur-base) ease-(--ease-enter) motion-reduce:transition-none";

/* 導覽列的尺寸線指示器。
   動作說明的是狀態：滑鼠指到或鍵盤 tab 到哪一項，線就量到哪一項；
   離開整條導覽後回到目前所在的頁面。

   原本用 motion 的 layoutId 做，但 Turbopack 沒有把 domMax 切出去，
   /demo 的初始 HTML 直接引用一支 44 KB（gzip）的 motion chunk，每頁都付。
   為了一條線不值得，改成純 CSS transition：只動 transform，
   位置直接寫進 DOM 的 style，不經 React state，指到別項不會重繪整條導覽。
   JS 接手前（SSR、hydration 之前）由目前頁那一項自己畫一條靜態線，
   nav 掛上 data-ready 之後靜態線隱藏，換成可移動的那條。 */
export function SurveyNav({
  items,
  active,
  label,
  className = "",
  itemClassName = "",
  children,
}: {
  items: Item[];
  active: string | null;
  label: string;
  className?: string;
  itemClassName?: string;
  children?: ReactNode;
}) {
  const [pointed, setPointed] = useState<string | null>(null);
  const marked = pointed ?? active;

  const navRef = useRef<HTMLElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const placed = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const rule = ruleRef.current;
    const bar = barRef.current;
    const end = endRef.current;
    if (!nav || !rule || !bar || !end) return;

    const place = () => {
      const link = marked ? linkRefs.current.get(marked) : undefined;
      if (!link) {
        rule.style.opacity = "0";
        return;
      }
      const x = link.offsetLeft + INSET;
      const w = Math.max(link.offsetWidth - INSET * 2, 1);
      const parts = [rule, bar, end];
      // 第一次定位不要有過場，否則線會從左邊界滑進來
      if (!placed.current) parts.forEach((el) => (el.style.transition = "none"));
      rule.style.transform = `translateX(${x}px)`;
      bar.style.transform = `scaleX(${w / BAR_BASE})`;
      end.style.transform = `translateX(${w - 1}px)`;
      rule.style.opacity = "1";
      if (!placed.current) {
        void rule.offsetWidth; // 強制 reflow，讓上面的位置先生效再恢復 transition
        parts.forEach((el) => (el.style.transition = ""));
        placed.current = true;
        nav.dataset.ready = "";
      }
    };

    place();
    // 字體換上、視窗縮放都會改變連結寬度，重量一次
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [marked]);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={`group/survey relative ${className}`}
      onPointerLeave={() => setPointed(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPointed(null);
        }
      }}
    >
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.href}
            ref={(el) => {
              if (!item.key) return;
              if (el) linkRefs.current.set(item.key, el);
              else linkRefs.current.delete(item.key);
            }}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onPointerEnter={() => setPointed(item.key)}
            onFocus={() => setPointed(item.key)}
            className={`relative flex items-center whitespace-nowrap px-2.5 text-[13px] ${
              isActive
                ? "font-semibold text-[var(--c-text)]"
                : "font-medium text-[var(--c-muted)] hover:text-[var(--c-text)]"
            } ${itemClassName}`}
          >
            {item.label}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-x-1.5 bottom-0 h-[2px] bg-[var(--c-accent)] group-data-[ready]/survey:hidden"
              />
            )}
          </Link>
        );
      })}
      {/* 可移動的指示線：外層負責水平位置，橫線用 scaleX 伸縮，兩端各一根 7px 端點刻度 */}
      <span
        ref={ruleRef}
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-0 left-0 h-[7px] w-px opacity-0 ${MOVE}`}
      >
        <span
          ref={barRef}
          className={`absolute bottom-0 left-0 h-[2px] w-[100px] origin-left bg-[var(--c-accent)] ${MOVE}`}
        />
        <span className="absolute bottom-0 left-0 h-[7px] w-px bg-[var(--c-accent)]" />
        <span
          ref={endRef}
          className={`absolute bottom-0 left-0 h-[7px] w-px bg-[var(--c-accent)] ${MOVE}`}
        />
      </span>
      {children}
    </nav>
  );
}
