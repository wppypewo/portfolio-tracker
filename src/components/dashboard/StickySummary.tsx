"use client";

import { useEffect, useState, type RefObject } from "react";
import { fmtTwd } from "./DashboardCharts";
import { sign, TONE_TEXT, toneCls } from "./shared";
import type { DashSummary } from "./types";

/**
 * 捲過 Hero 之後浮出的精簡摘要。
 *
 * 動機是量出來的：390×844 下整頁 3.6 屏，而總淨資產在 y 174 就離開視野，
 * 之後看持倉、看趨勢、看配置時都沒有「總數是多少」這個參照。
 *
 * 只做手機。桌機同一份內容約 2.5 屏，而且首屏就能看到持倉與配置兩塊，
 * 再壓一條固定列進去是拿掉可視高度換一個沒那麼缺的東西。
 *
 * 內容與 Hero 重複，所以整條對輔助技術隱藏：讀屏使用者本來就讀得到 Hero，
 * 這裡再報一次只是同一個數字念兩遍。
 */
export function StickySummary({
  s,
  watch,
}: {
  s: DashSummary;
  watch: RefObject<HTMLElement | null>;
}) {
  const [shown, setShown] = useState(false);
  // 站台頁首是 sticky top-0，這條要接在它下緣。頁首高度在手機是兩排、
  // 桌機一排，而且字級可被使用者放大，所以用 ResizeObserver 量而不是寫死。
  const [top, setTop] = useState(0);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const sync = () => setTop(header.getBoundingClientRect().height);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = watch.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShown(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);

  const hasDay = s.dayChange != null && s.dayChangePct != null;

  return (
    /* 實心頁面底色，不用毛玻璃：測繪桌是紙面，浮層就是另一張紙，
       透出底下的製圖格線與數字只會跟這列摘要搶讀。 */
    <div
      aria-hidden="true"
      style={{ top }}
      className={`fixed inset-x-0 z-30 border-b border-[var(--c-line-strong)] bg-[var(--c-page)] transition-opacity duration-(--dur-base) ease-(--ease-state) md:hidden ${
        shown ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-[1200px] items-baseline justify-between gap-3 px-4 py-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[length:var(--fs-micro)] text-[var(--c-faint)]">
            NT$
          </span>
          <span className="amt truncate text-[length:var(--fs-md)] font-semibold tracking-[-0.02em] tnum">
            {fmtTwd(s.total)}
          </span>
        </span>
        {hasDay && (
          <span
            className={`shrink-0 text-[length:var(--fs-micro)] font-semibold tnum ${
              TONE_TEXT[toneCls(s.dayChange!)]
            }`}
          >
            {sign(s.dayChangePct!)}
            {Math.abs(s.dayChangePct!).toFixed(2)}%
            <span className="ml-1.5 font-normal text-[var(--c-faint)]">今日</span>
          </span>
        )}
      </div>
    </div>
  );
}
