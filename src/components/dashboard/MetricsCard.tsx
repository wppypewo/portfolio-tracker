"use client";

import { fmtTwd } from "./DashboardCharts";
import type { DashSummary } from "./types";
import { CardHead, sign, toneCls, TONE_TEXT, type Tone } from "./shared";

/* split：寬螢幕（lg）時被動收入改成右欄的帳本，與四格指標並排。
   目前只有 /demo 開；正式首頁維持上下排、欄寬 640px。 */
export function MetricsCard({ s, split = false }: { s: DashSummary; split?: boolean }) {
  const metrics =
    s.twrShowable && s.twrCum != null
      ? [
          {
            label: "TWR 累積",
            value: `${sign(s.twrCum)}${(Math.abs(s.twrCum) * 100).toFixed(1)}%`,
            tone: toneCls(s.twrCum),
            hint: "已排除入金與提領",
          },
          s.twrAnnShowable && s.twrAnn != null
            ? {
                label: "TWR 年化",
                value: `${sign(s.twrAnn)}${(Math.abs(s.twrAnn) * 100).toFixed(1)}%`,
                tone: toneCls(s.twrAnn),
                hint: "快照跨度滿 90 天",
              }
            : {
                label: "TWR 年化",
                value: "—",
                tone: "flat" as Tone,
                hint: "快照跨度未滿 90 天",
              },
          s.maxDrawdown != null
            ? {
                label: "最大回撤",
                value: `−${(Math.abs(s.maxDrawdown) * 100).toFixed(1)}%`,
                tone: "down" as Tone,
                hint:
                  s.ddPeak && s.ddTrough
                    ? `${s.ddPeak} → ${s.ddTrough}`
                    : "已排除現金流",
              }
            : {
                label: "最大回撤",
                value: "—",
                tone: "flat" as Tone,
                hint: "尚無回撤",
              },
          s.sharpe != null
            ? {
                label: "Sharpe",
                value: s.sharpe.toFixed(2),
                tone: s.sharpe > 1 ? ("up" as Tone) : ("flat" as Tone),
                hint: "依實際日曆間隔年化",
              }
            : {
                label: "Sharpe",
                value: "—",
                tone: "flat" as Tone,
                hint: "樣本不足或波動為零",
              },
        ]
      : null;

  return (
    <div className={split && s.hasIncome ? "lg:grid lg:grid-cols-2 lg:gap-x-10" : ""}>
      <div>
        <CardHead
          title="績效指標"
          sub="基於每日淨值快照"
          action={
            <a
              href="/methodology"
              target="_blank"
              rel="noopener noreferrer"
              /* 這條連結原本只有 11px 字、沒有垂直內距，實測高度 17px，
                 低於 WCAG 2.5.8（AA）的 24×24。補 min-h-6 撐到 24px；
                 寬度本來就有 70px 有餘。周圍的鈕是 36–44px，這裡是行內文字連結，
                 取 AA 的下限而不是跟著長成一顆鈕。 */
              className="mt-0.5 inline-flex min-h-6 shrink-0 items-center gap-1 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)] hover:text-[var(--c-text)]"
            >
              指標怎麼算
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </a>
          }
        />
        {/* 去掉圓角外框：這裡原本是「卡片裡再放一個盒子」（V6），兩層圓角兩層邊。
            現在三級本身沒有容器，四格之間只留底色透出的 1px 分隔線。 */}
        <div className="grid grid-cols-2 gap-px bg-[var(--c-border)]">
          {(metrics ?? [
            { label: "TWR 累積", value: "—", tone: "flat" as Tone, hint: "快照未滿 30 天" },
            { label: "TWR 年化", value: "—", tone: "flat" as Tone, hint: "快照未滿 30 天" },
            { label: "最大回撤", value: "—", tone: "flat" as Tone, hint: "快照未滿 30 天" },
            { label: "Sharpe", value: "—", tone: "flat" as Tone, hint: "快照未滿 30 天" },
          ]).map((metric, index) => (
            /* 沒有外框之後，內距只留在分隔線那一側，格子內容才會與區段左右緣切齊。 */
            <div
              key={metric.label}
              className={`bg-[var(--c-page)] py-3 ${index % 2 === 0 ? "pr-4" : "pl-4"}`}
            >
              <div className="text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
                {metric.label}
              </div>
              <div
                className={`mt-2 text-[length:var(--fs-xl)] font-semibold tracking-[-0.025em] tnum ${TONE_TEXT[metric.tone]}`}
              >
                {metric.value}
              </div>
              <div className="mt-1 min-h-[16px] text-[length:var(--fs-micro)] leading-4 text-[var(--c-faint)]">
                {metric.hint}
              </div>
            </div>
          ))}
        </div>
      </div>

      {s.hasIncome && split && <IncomeLedger s={s} />}
      {s.hasIncome && !split && (
        <div className="mt-5 border-t border-[var(--c-border)] pt-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-[length:var(--fs-sm)] font-medium">被動收入</span>
            <span className="text-[length:var(--fs-micro)] font-semibold text-[var(--c-accent)] tnum">
              配息率 {s.yieldOnCost.toFixed(2)}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <IncomeStat label="今年累積" value={`NT$ ${fmtTwd(s.incomeYtd)}`} up />
            <IncomeStat label="近 12 月" value={`NT$ ${fmtTwd(s.income12m)}`} up />
            <IncomeStat label="月均" value={`NT$ ${fmtTwd(s.monthlyAvg)}`} />
          </div>
          <p className="mt-3 text-[length:var(--fs-micro)] text-[var(--c-faint)]">
            累計配息 <span className="amt">NT$ {fmtTwd(s.dividendAll)}</span> · 利息{" "}
            <span className="amt">NT$ {fmtTwd(s.interestAll)}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/* 被動收入的帳本版：五列同一把尺，金額右對齊、全額不縮寫，
   列高刻意與左邊四格指標的總高相近，兩欄底緣才會大致對齊。 */
function IncomeLedger({ s }: { s: DashSummary }) {
  const rows: { label: string; value: number; up?: boolean }[] = [
    { label: "今年累積", value: s.incomeYtd, up: true },
    { label: "近 12 月", value: s.income12m, up: true },
    { label: "月均", value: s.monthlyAvg },
    { label: "累計配息", value: s.dividendAll },
    { label: "累計利息", value: s.interestAll },
  ];
  return (
    <div className="mt-8 border-t border-[var(--c-border)] pt-6 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
      <CardHead
        title="被動收入"
        sub="股息與利息，折合台幣"
        action={
          <span className="mt-0.5 shrink-0 text-[length:var(--fs-micro)] font-semibold text-[var(--c-accent)] tnum">
            配息率 {s.yieldOnCost.toFixed(2)}%
          </span>
        }
      />
      <dl className="divide-y divide-[var(--c-border)]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">{row.label}</dt>
            <dd
              className={`amt text-[length:var(--fs-md)] font-semibold tnum ${row.up ? "text-[var(--c-up)]" : ""}`}
            >
              NT$ {fmtTwd(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function IncomeStat({
  label,
  value,
  up,
}: {
  label: string;
  value: string;
  up?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">{label}</span>
      <span
        className={`amt truncate text-[length:var(--fs-sm)] font-semibold tnum sm:text-[length:var(--fs-md)] ${up ? "text-[var(--c-up)]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
