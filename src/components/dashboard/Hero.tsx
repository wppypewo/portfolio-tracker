"use client";

import { useState } from "react";
import { Sparkline, type SeriesPoint } from "./DashboardCharts";
import { fmtUpdatedAt } from "@/lib/format";
import { RefreshPricesButton } from "@/components/RefreshPricesButton";
import type { DashSummary } from "./types";
import { sign, SurveyLabel, TONE_TEXT, type Tone } from "./shared";

export function Hero({
  s,
  series,
  demo,
}: {
  s: DashSummary;
  series: SeriesPoint[];
  demo?: boolean;
}) {
  const recent = series.slice(-30);
  const hasDay = s.dayChange != null && s.dayChangePct != null;
  const change30 =
    recent.length >= 2 ? recent[recent.length - 1].value - recent[0].value : 0;
  const up30 = change30 >= 0;

  // 刷新報價後總額換值：不做 count-up（儀表板要克制，數字滾動也難讀），
  // 只在換值那一刻給數字一層 640ms 褪去的淡底，告訴使用者「這裡變了」。
  // 漲跌方向已經寫在下面的日變動，閃色用中性的 accent-soft，不分紅綠。
  // 首次渲染不閃；key 改變讓 span 重掛，連續刷新也會重播。
  const total = Math.round(s.total);
  const [prevTotal, setPrevTotal] = useState(total);
  const [flashKey, setFlashKey] = useState(0);
  if (prevTotal !== total) {
    setPrevTotal(total);
    setFlashKey((k) => k + 1);
  }

  return (
    <section className="grid grid-cols-1 gap-6 border-b border-[var(--c-border)] pb-7 pt-4 sm:grid-cols-[minmax(0,1fr)_190px] sm:items-end sm:gap-8 sm:pb-8 sm:pt-7">
      <div className="min-w-0">
        {/* 原本的 h1 內容就是金額本身，讀屏使用者按標題鍵跳到頁首會聽到一串數字，
            而且金額每次刷新報價都變，頁面等於沒有穩定的名字。
            金額降級成 div，標題另外用 sr-only 給。sr-only 是 clip-path 不是
            display:none，元素仍留在無障礙樹裡，而 CardHead 用 h2，層級接得上。 */}
        <h1 className="sr-only">投資組合總覽</h1>
        <SurveyLabel>總淨資產</SurveyLabel>
        <div className="mt-3 flex min-w-0 items-baseline gap-2 font-mono">
          <span className="shrink-0 text-[length:var(--fs-sm)] font-medium text-[var(--c-faint)] sm:text-[length:var(--fs-md)]">
            NT$
          </span>
          {/* 這裡原本用 truncate，數字的頂端會被切掉（Newsreader 時期：
              leading-[0.92] 的行框比字框矮，overflow:hidden 裁到數字上緣）。
              改用 whitespace-nowrap：保留不換行，但不裁切。

              2026-09-26 換成 Plex Mono 600。Mono 數字墨水高 0.71em、
              逗號也佔滿 0.6em，字寬變寬的是標點不是數字（fontTools 實測）。
              375px 下字級 40px、可用寬度約 305px：九位數 999,999,999 約 290px
              （含 NT$），十位數以上會溢出到右側——個人資產不太會到，先不處理。
              tracking 收到 -0.02em：等寬字再收緊就會黏在一起。 */}
          {/* 尺寸線：數字底下一條兩端帶刻度的髮絲線，量的就是這個數字的寬度。
              用 border 畫而不是 SVG，寬度自動跟著數字走，不必量字。 */}
          <span className="relative min-w-0">
            <span
              key={flashKey}
              className={`amt whitespace-nowrap text-[length:var(--fs-display)] font-semibold leading-[0.92] tracking-[-0.02em] tnum ${flashKey ? "value-flash" : ""}`}
            >
              {total.toLocaleString("en-US")}
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-3 left-0 right-0 h-[7px] border-x border-b border-[var(--c-line-strong)]"
            />
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-2 text-[length:var(--fs-sm)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
          {hasDay && (
            <span className={`font-semibold tnum ${TONE_TEXT[s.dayChange! >= 0 ? "up" : "down"]}`}>
              <span className="amt">
                {sign(s.dayChange!)}NT${" "}
                {Math.abs(Math.round(s.dayChange!)).toLocaleString("en-US")}
              </span>
              <span className="ml-1.5">
                {sign(s.dayChangePct!)}
                {Math.abs(s.dayChangePct!).toFixed(2)}%
              </span>
              <span className="ml-2 font-normal text-[var(--c-faint)]">今日</span>
            </span>
          )}
          <span className="flex flex-wrap items-center gap-1 text-[var(--c-muted)]">
            報價 {s.lastUpdate ? fmtUpdatedAt(s.lastUpdate) : "—"}
            <span className="text-[var(--c-faint)]">·</span>
            {s.accounts} 個帳戶
            {!demo && <RefreshPricesButton />}
          </span>
        </div>
      </div>

      {recent.length >= 2 && (
        <div className="border-t border-[var(--c-border)] pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <SurveyLabel>近 30 日</SurveyLabel>
            <span
              className={`amt text-[length:var(--fs-micro)] font-semibold tnum ${up30 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"}`}
            >
              {sign(change30)}NT${" "}
              {Math.abs(Math.round(change30)).toLocaleString("en-US")}
            </span>
          </div>
          <Sparkline data={recent} w={164} h={42} up={up30} />
        </div>
      )}
    </section>
  );
}

export function HeroStat({
  label,
  value,
  tone,
  sub,
  primary,
  mask,
}: {
  label: string;
  value: string;
  tone?: Tone;
  sub?: string;
  primary?: boolean;
  mask?: boolean;
}) {
  return (
    /* 底色跟著頁面而不是卡片：這四格屬於一級摘要區，不再是卡片內容。
       仍需要明確的底色，因為父層用自身底色透出當分隔線。 */
    <div className="min-w-0 bg-[var(--c-page)] px-4 py-4 sm:px-5 sm:py-[18px]">
      <SurveyLabel>{label}</SurveyLabel>
      {/* 手機降一級。實測 390 寬時半格可用 163px，而「NT$ 1,075,921」在
          22px 等寬下要 164px——差 1px 就被 truncate 切成「NT$ 1,075...」。
          等寬數字比原本的 sans 寬，這是換字體帶進來的，改前 20px sans 沒事。
          18px 下同一串只要 141px，八位數的組合也還有餘裕。
          桌機半格約 255px，維持 22 / 26 不動。 */}
      <div
        className={`mt-2 truncate ${primary ? "text-[length:var(--fs-xl)] sm:text-[length:var(--fs-2xl)]" : "text-[length:var(--fs-lg)] sm:text-[length:var(--fs-xl)]"} font-semibold tracking-[-0.025em] tnum ${
          tone ? TONE_TEXT[tone] : ""
        } ${mask ? "amt" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[length:var(--fs-micro)] text-[var(--c-faint)]">{sub}</div>}
    </div>
  );
}
