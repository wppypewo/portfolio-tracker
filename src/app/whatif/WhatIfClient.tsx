"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { project, crossMonth, type ProjPoint } from "@/lib/whatif-project";
import { fmtFull as fmtTwd, fmtCompact } from "@/lib/format";
import { Stat, StatStrip, SurveyLabel, Tag, EmptyPlot } from "@/components/survey";
import { ScenarioTab, type ScenarioData } from "./ScenarioTab";
import { RebalanceTab } from "./RebalanceTab";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

const WHATIF_TABS = ["proj", "cf", "scenario", "rebalance"] as const;
type WhatIfTab = (typeof WHATIF_TABS)[number];

const WHATIF_TAB_LABEL: Record<WhatIfTab, string> = {
  proj: "未來推算",
  cf: "回測對照",
  scenario: "壓力與買前檢核",
  rebalance: "再平衡",
};

export type CfRow = {
  label: string;
  sym: string | null;
  color: string;
  finalValue: number;
  returnPct: number;
  actual: boolean;
  skipped: number;
};
export type CounterfactualData = {
  invested: number;
  firstDate: string;
  contributions: number;
  rows: CfRow[];
};

/* ---------- 滑桿 ---------- */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
  hint?: string;
}) {
  const inputId = `projection-${useId().replace(/:/g, "")}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mt-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
        <label htmlFor={inputId} className="text-[length:var(--fs-sm)] font-medium text-[var(--c-text)]">
          {label}
        </label>
        <output htmlFor={inputId} className="whitespace-nowrap text-[length:var(--fs-sm)] font-semibold text-[var(--c-accent)] tnum">
          {fmt ? fmt(value) : value}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        className="proj-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={fmt ? fmt(value) : String(value)}
        aria-describedby={hintId}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--c-accent) ${pct}%, var(--c-surface-soft) ${pct}%)`,
        }}
      />
      {hint && (
        <span id={hintId} className="mt-1.5 block text-[length:var(--fs-micro)] text-[var(--c-faint)]">
          {hint}
        </span>
      )}
    </div>
  );
}

/* ---------- 推算圖（手刻 SVG）---------- */
type Milestone = {
  target: number;
  label: string;
  color: string;
  reached: boolean;
  month: number | null;
};

function ProjectionChart({
  pts,
  milestones,
  height = 280,
}: {
  pts: ProjPoint[];
  milestones: Milestone[];
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const instructionsId = `projection-chart-${useId().replace(/:/g, "")}`;
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  // ResizeObserver（setW 只在 observer callback 觸發，符合 hooks 規則）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padT = 14;
  const padB = 24;
  const padR = 64;
  const H = height;
  const n = pts.length;
  const reachedTargets = milestones
    .filter((m) => m.reached)
    .map((m) => m.target);
  const maxV = Math.max(pts[n - 1].value, ...reachedTargets);
  const hi = maxV * 1.06 || 1;
  const nx = (m: number) => (m / (n - 1)) * (w - padR);
  const ny = (v: number) => padT + (1 - v / hi) * (H - padT - padB);

  const valLine = pts
    .map((p, i) => `${i ? "L" : "M"}${nx(p.m).toFixed(1)},${ny(p.value).toFixed(1)}`)
    .join(" ");
  const area = `${valLine} L${nx(pts[n - 1].m)},${H - padB} L0,${H - padB} Z`;
  const contribLine = pts
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${nx(p.m).toFixed(1)},${ny(p.contributed).toFixed(1)}`,
    )
    .join(" ");

  const years = (n - 1) / 12;
  const step = years > 25 ? 10 : years > 12 ? 5 : years > 6 ? 2 : 1;
  const yearTicks = Array.from(
    { length: Math.floor(years / step) },
    (_, i) => (i + 1) * step,
  ).filter((y) => y <= years + 0.01);

  const setFromClientX = (clientX: number) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const idx = Math.round((x / (w - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };
  const onMove = (e: React.MouseEvent) => setFromClientX(e.clientX);
  const onTouch = (e: React.TouchEvent) => setFromClientX(e.touches[0].clientX);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const current = hover ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, current + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      setHover(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setHover(next);
    }
  };
  const hp = hover != null ? pts[hover] : null;

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      tabIndex={0}
      role="group"
      aria-roledescription="互動圖表"
      aria-label="未來淨值推算圖"
      aria-describedby={instructionsId}
      style={{ touchAction: "pan-y" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onKeyDown={onKeyDown}
    >
      <span id={instructionsId} className="sr-only">
        左右方向鍵逐月檢視，Home 與 End 跳至頭尾，Escape 清除目前選取。
      </span>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        style={{ display: "block", overflow: "visible" }}
      >
        {milestones.map(
          (m, i) =>
            m.reached && (
              <g key={i}>
                <line
                  x1="0"
                  x2={w - padR}
                  y1={ny(m.target)}
                  y2={ny(m.target)}
                  stroke={m.color}
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  opacity="0.55"
                />
                <text
                  x={w - padR + 6}
                  y={ny(m.target) + 4}
                  fontSize={10}
                  fill={m.color}
                >
                  {m.label}
                </text>
              </g>
            ),
        )}
        {/* 平塗淡底，跟首頁淨值圖同一個作法，不做漸層 */}
        <path d={area} fill="var(--c-accent)" fillOpacity="0.07" />
        <path
          d={contribLine}
          fill="none"
          stroke="var(--c-text)"
          strokeWidth="1.4"
          strokeDasharray="4 5"
          opacity="0.35"
        />
        <path
          d={valLine}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth="2"
          strokeLinejoin="miter"
        />
        <line
          x1="0"
          x2={w - padR}
          y1={H - padB}
          y2={H - padB}
          stroke="var(--c-line-strong)"
          strokeWidth="1"
        />
        {yearTicks.map((y) => (
          <text
            key={y}
            x={nx(y * 12)}
            y={H - 6}
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--c-muted)"
            textAnchor="middle"
          >
            {y} 年
          </text>
        ))}
        {hp && (
          <g>
            {/* 十字準線與交點比照首頁淨值圖：虛線、直角標記 */}
            <line
              x1={nx(hp.m)}
              x2={nx(hp.m)}
              y1={padT}
              y2={H - padB}
              stroke="var(--c-muted)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <rect
              x={nx(hp.m) - 4}
              y={ny(hp.value) - 4}
              width="8"
              height="8"
              fill="var(--c-surface)"
              stroke="var(--c-accent)"
              strokeWidth="1.5"
            />
            <rect
              x={nx(hp.m) - 3}
              y={ny(hp.contributed) - 3}
              width="6"
              height="6"
              fill="var(--c-surface)"
              stroke="var(--c-muted)"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1.5 z-[5] -translate-x-1/2 whitespace-nowrap border border-[var(--c-line-strong)] bg-[var(--c-surface)] px-3 py-2"
          style={{ left: Math.min(Math.max(nx(hp.m), 80), w - padR - 80) }}
        >
          <div className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
            第 {Math.floor(hp.m / 12)} 年 {hp.m % 12} 月
          </div>
          <div className="mt-1 flex items-center gap-2 text-[length:var(--fs-micro)]">
            <span className="h-2 w-2 bg-[var(--c-accent)]" />
            <span className="text-[var(--c-muted)]">淨值</span>
            <span className="amt ml-auto font-semibold tnum">
              NT$ {fmtCompact(hp.value)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[length:var(--fs-micro)]">
            <span className="h-2 w-2 bg-[var(--c-muted)]" />
            <span className="text-[var(--c-muted)]">累積投入</span>
            <span className="amt ml-auto font-semibold text-[var(--c-muted)] tnum">
              NT$ {fmtCompact(hp.contributed)}
            </span>
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {hp
          ? `第 ${Math.floor(hp.m / 12)} 年 ${hp.m % 12} 月，預估淨值 ${fmtTwd(hp.value)} 元，累積投入 ${fmtTwd(hp.contributed)} 元`
          : ""}
      </span>
    </div>
  );
}

/* ---------- 未來推算分頁 ---------- */
const PRESETS = [
  { label: "保守", r: 4 },
  { label: "中性", r: 7 },
  { label: "積極", r: 10 },
];

function ProjectionTab({ netWorth }: { netWorth: number }) {
  const [monthly, setMonthly] = useState(40000);
  const [ret, setRet] = useState(7);
  const [years, setYears] = useState(15);
  const [expense, setExpense] = useState(1200000);

  const pts = useMemo(
    () => project({ start: netWorth, monthly, annualReturn: ret, years }),
    [netWorth, monthly, ret, years],
  );
  const final = pts[pts.length - 1].value;
  const contributed = pts[pts.length - 1].contributed;
  const gain = final - contributed;
  const annualWithdraw = final * 0.04;
  const fireTarget = expense * 25;

  const milestones: Milestone[] = useMemo(() => {
    const list = [
      { target: 1e7, label: "1000 萬", color: "var(--c-alloc-fund)" },
      { target: 2e7, label: "2000 萬", color: "var(--c-alloc-cash)" },
      { target: fireTarget, label: "FIRE", color: "var(--c-accent)" },
    ];
    return list
      .map((m) => {
        const cm = crossMonth(pts, m.target);
        return { ...m, reached: cm !== null, month: cm };
      })
      .sort((a, b) => a.target - b.target);
  }, [pts, fireTarget]);

  const monthLabel = (m: number | null) =>
    m == null ? "" : `${Math.floor(m / 12)} 年 ${m % 12} 月`;
  const isPreset = PRESETS.some((p) => p.r === ret);

  return (
    <div className="border border-[var(--c-border)] bg-[var(--c-surface)]">
    <div className="grid grid-cols-1 items-start min-[880px]:grid-cols-[340px_1fr]">
      {/* 控制欄：桌機用右側髮絲線跟結果分開，手機疊在上面 */}
      <section className="p-5 sm:p-6 min-[880px]:sticky min-[880px]:top-[var(--header-h)] min-[880px]:border-r min-[880px]:border-[var(--c-border)]">
        <h2 className="text-[length:var(--fs-lg)] font-semibold">情境設定</h2>
        <p className="mt-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          從目前淨值 <span className="amt tnum">NT$ {fmtCompact(netWorth)}</span> 開始推算
        </p>

        <div className="mt-5">
          <SurveyLabel>報酬假設</SurveyLabel>
          {/* 分段鈕：選中那格測量藍淡底加底邊 2px，跟設定頁的分段鈕同一套 */}
          <div className="mt-2 flex flex-wrap border border-[var(--c-border)] bg-[var(--c-surface-soft)]">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setRet(p.r)}
                aria-pressed={ret === p.r}
                className={`tap-row min-h-[40px] flex-1 whitespace-nowrap border-r border-[var(--c-border)] px-2.5 text-[length:var(--fs-sm)] font-semibold transition-colors ${
                  ret === p.r ? SEG_ON : SEG_OFF
                }`}
              >
                {p.label} <span className="tnum">{p.r}%</span>
              </button>
            ))}
            <label
              className={`tap-row inline-flex min-h-[40px] flex-1 cursor-text items-center justify-center gap-1 whitespace-nowrap px-2.5 text-[length:var(--fs-sm)] font-semibold transition-colors ${
                !isPreset ? SEG_ON : SEG_OFF
              }`}
            >
              自訂
              <input
                type="number"
                value={ret}
                min={-5}
                max={20}
                step={0.5}
                onChange={(e) => {
                  const v = e.target.value === "" ? 0 : Number(e.target.value);
                  setRet(Math.max(-5, Math.min(20, v)));
                }}
                className="w-[42px] border-none bg-transparent text-right font-semibold text-inherit tnum"
              />
              <span aria-hidden="true">%</span>
            </label>
          </div>
        </div>

        <Slider
          label="每月定期投入"
          value={monthly}
          min={0}
          max={150000}
          step={5000}
          onChange={setMonthly}
          fmt={(v) => `NT$ ${v.toLocaleString("en-US")}`}
        />
        <Slider
          label="年化報酬假設"
          value={ret}
          min={-5}
          max={20}
          step={0.5}
          onChange={setRet}
          fmt={(v) => `${v}%`}
          hint="長期股市約 7%（名目，未計通膨）"
        />
        <Slider
          label="投資年數"
          value={years}
          min={1}
          max={40}
          step={1}
          onChange={setYears}
          fmt={(v) => `${v} 年`}
        />
        <Slider
          label="預計年支出（FIRE 目標 = ×25）"
          value={expense}
          min={300000}
          max={3000000}
          step={100000}
          onChange={setExpense}
          fmt={(v) => `NT$ ${fmtCompact(v)}`}
          hint={`FIRE 目標 NT$ ${fmtCompact(fireTarget)}`}
        />
      </section>

      {/* 結果欄 */}
      <section className="border-t border-[var(--c-border)] p-5 sm:p-6 min-[880px]:border-t-0">
        <div className="mb-5 border-b border-[var(--c-line-strong)] pb-5">
          <SurveyLabel>{years} 年後預估淨值</SurveyLabel>
          <span className="amt mt-2 block text-[length:var(--fs-display)] font-medium leading-none tracking-[-0.02em] tnum">
            NT$ {fmtTwd(final)}
          </span>
          <span className="mt-3 block text-[length:var(--fs-sm)] text-[var(--c-muted)]">
            投資獲利{" "}
            <b
              className={`amt font-semibold tnum ${gain >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"}`}
            >
              {sign(gain)}NT$ {fmtCompact(Math.abs(gain))}
            </b>{" "}
            · 累積投入 <span className="amt tnum">NT$ {fmtCompact(contributed)}</span>
          </span>
        </div>

        <ProjectionChart pts={pts} milestones={milestones} height={280} />
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0 w-4 border-t-2 border-[var(--c-accent)]" />
            預估淨值
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0 w-4 border-t-2 border-dashed border-[var(--c-muted)]" />
            累積投入（本金）
          </span>
        </div>

        <StatStrip cols={4} className="mt-5">
          <Stat label="4% 法則年提領" mask value={`NT$ ${fmtCompact(annualWithdraw)}`} />
          <Stat
            label="換算月被動收入"
            mask
            value={
              <span className="text-[var(--c-up)]">NT$ {fmtTwd(annualWithdraw / 12)}</span>
            }
          />
          <Stat label="總投入本金" mask value={`NT$ ${fmtCompact(contributed)}`} />
          <Stat
            label="獲利倍數"
            value={`${contributed > 0 ? (final / contributed).toFixed(2) : "—"}×`}
          />
        </StatStrip>

        <div className="mt-6">
          <h3 className="border-b border-[var(--c-line-strong)] pb-2 text-[length:var(--fs-md)] font-semibold">
            里程碑
          </h3>
          {/* 未達成的列不降透明度，改用淡字與空心方塊；「未達成」三個字本身就是訊號 */}
          {milestones.map((m) => (
            <div
              key={m.label}
              className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 border-b border-[var(--c-border-soft)] py-3 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 border"
                style={{
                  borderColor: m.reached ? m.color : "var(--c-faint)",
                  background: m.reached ? m.color : "transparent",
                }}
              />
              <span className="whitespace-nowrap text-[length:var(--fs-sm)] font-semibold">
                {m.label}
              </span>
              <span className="amt text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
                NT$ {fmtCompact(m.target)}
              </span>
              <span
                className={`whitespace-nowrap text-right text-[length:var(--fs-micro)] tnum ${
                  m.reached ? "text-[var(--c-text)]" : "text-[var(--c-faint)]"
                }`}
              >
                {m.reached ? `約 ${monthLabel(m.month)}達成` : `${years} 年內未達成`}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
    </div>
  );
}

const SEG_ON =
  "bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[inset_0_-2px_0_var(--c-accent)]";
const SEG_OFF =
  "text-[var(--c-muted)] hover:bg-[var(--c-surface)] hover:text-[var(--c-text)]";

/* ---------- 回測對照分頁 ---------- */
function CounterfactualTab({ cf }: { cf: CounterfactualData }) {
  const actual = cf.rows.find((r) => r.actual);
  const maxVal = Math.max(...cf.rows.map((r) => r.finalValue), 1);
  const actualValue = actual?.finalValue ?? 0;

  return (
    <div>
      <section className="mb-7 grid grid-cols-1 gap-px border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-2">
        <div className="bg-[var(--c-surface)] px-5 py-4">
          <SurveyLabel>累積投入</SurveyLabel>
          <span className="amt mt-1.5 block text-[length:var(--fs-xl)] font-medium tnum">
            NT$ {fmtTwd(cf.invested)}
          </span>
          <span className="mt-1 block text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum">
            從 {cf.firstDate} 起 · {cf.contributions} 筆投入
          </span>
        </div>
        <div className="bg-[var(--c-surface)] px-5 py-4">
          <SurveyLabel>目前實際組合</SurveyLabel>
          <span
            className={`amt mt-1.5 block text-[length:var(--fs-xl)] font-medium tnum ${
              (actual?.returnPct ?? 0) >= 0
                ? "text-[var(--c-up)]"
                : "text-[var(--c-down)]"
            }`}
          >
            NT$ {fmtTwd(actualValue)}
          </span>
          <span className="mt-1 block text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum">
            報酬 {sign(actual?.returnPct ?? 0)}
            {Math.abs((actual?.returnPct ?? 0) * 100).toFixed(1)}%
          </span>
        </div>
      </section>

      <section>
        <div className="border-b border-[var(--c-line-strong)] pb-2">
          <h2 className="text-[length:var(--fs-lg)] font-semibold">
            如果當初全買 ETF 並 Buy &amp; Hold
          </h2>
          <p className="mt-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
            用每次投入的當日收盤價買入，之後不賣出、不計成本 — 今天會值多少？
          </p>
        </div>
        <ol className="mt-3 border border-[var(--c-border)] bg-[var(--c-surface)]">
          {cf.rows.map((r, i) => {
            const diff = r.finalValue - actualValue;
            return (
              <li
                key={r.label}
                className={`grid grid-cols-[auto_1fr] items-start gap-4 border-t border-[var(--c-border-soft)] px-5 py-4 first:border-t-0 ${
                  r.actual ? "bg-[var(--c-accent-soft)] shadow-[inset_2px_0_0_var(--c-accent)]" : ""
                }`}
              >
                <div className="w-5 pt-0.5 text-center text-[length:var(--fs-sm)] text-[var(--c-faint)] tnum">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0"
                      style={{ background: r.color }}
                    />
                    <span className="whitespace-nowrap text-[length:var(--fs-md)] font-semibold">
                      {r.label}
                      {r.sym && (
                        <span className="ml-1.5 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)] tnum">
                          {r.sym}
                        </span>
                      )}
                    </span>
                    {r.actual && <Tag tone="accent">實際</Tag>}
                    <span className="amt ml-auto whitespace-nowrap text-[length:var(--fs-md)] font-semibold tnum">
                      NT$ {fmtTwd(r.finalValue)}
                    </span>
                  </div>
                  {/* 長度條用 scaleX，不動 width */}
                  <div className="mt-2.5 h-1.5 overflow-hidden bg-[var(--c-surface-soft)]">
                    <span
                      className="motion-progress block h-full origin-left transition-transform duration-300 ease-out"
                      style={{
                        transform: `scaleX(${r.finalValue / maxVal})`,
                        background: r.color,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[length:var(--fs-micro)] tnum">
                    <span
                      className={
                        r.returnPct >= 0
                          ? "text-[var(--c-up)]"
                          : "text-[var(--c-down)]"
                      }
                    >
                      報酬 {sign(r.returnPct)}
                      {Math.abs(r.returnPct * 100).toFixed(1)}%
                    </span>
                    {!r.actual && (
                      <span
                        className={
                          diff > 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"
                        }
                      >
                        vs 實際 <span className="amt">{sign(diff)}NT$ {fmtCompact(Math.abs(diff))}</span>
                      </span>
                    )}
                    {/* 資料缺口不是虧損，用朱砂註記而不是跌色 */}
                    {r.skipped > 0 && <Tag tone="annot">{r.skipped} 筆投入無價格被跳過</Tag>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 border-t border-[var(--c-border)] pt-3 text-[length:var(--fs-micro)] leading-relaxed text-[var(--c-faint)]">
          假設：投入 = 現金流為負的紀錄；配息/賣出視為未發生（buy-and-hold）；SPY/QQQ
          用當日收盤×匯率；未計交易成本與再投資。過去績效不代表未來。
        </p>
      </section>
    </div>
  );
}

/* ---------- 組合 ---------- */
export function WhatIfClient({
  netWorth,
  counterfactual,
  scenario,
}: {
  netWorth: number;
  counterfactual: CounterfactualData | null;
  scenario: ScenarioData;
}) {
  const [tab, setTab] = useState<WhatIfTab>("proj");
  const tabBase = `whatif-${useId().replace(/:/g, "")}`;

  function onTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: WhatIfTab,
  ) {
    const currentIndex = WHATIF_TABS.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % WHATIF_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + WHATIF_TABS.length) % WHATIF_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = WHATIF_TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = WHATIF_TABS[nextIndex];
    setTab(next);
    document.getElementById(`${tabBase}-tab-${next}`)?.focus();
  }

  return (
    <div>
      {/* 分頁列：方角分段鈕，選中那格淡底加底邊 2px */}
      <div
        role="tablist"
        aria-label="情境推演工具"
        className="mb-6 flex flex-wrap border border-[var(--c-border)] bg-[var(--c-surface-soft)] sm:inline-flex"
      >
        {WHATIF_TABS.map((t) => (
          <button
            key={t}
            id={`${tabBase}-tab-${t}`}
            type="button"
            role="tab"
            onClick={() => setTab(t)}
            onKeyDown={(event) => onTabKeyDown(event, t)}
            aria-selected={tab === t}
            aria-controls={tab === t ? `${tabBase}-panel-${t}` : undefined}
            tabIndex={tab === t ? 0 : -1}
            className={`tap-row min-h-[44px] flex-1 whitespace-nowrap border-r border-[var(--c-border)] px-4 text-[length:var(--fs-sm)] font-semibold transition-colors last:border-r-0 sm:flex-none ${
              tab === t ? SEG_ON : SEG_OFF
            }`}
          >
            {WHATIF_TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div
        id={`${tabBase}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${tabBase}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "proj" ? (
          <ProjectionTab netWorth={netWorth} />
        ) : tab === "scenario" ? (
          <ScenarioTab data={scenario} />
        ) : tab === "rebalance" ? (
          <RebalanceTab
            data={{
              holdings: scenario.holdings,
              allocationTargets: scenario.allocationTargets,
            }}
          />
        ) : counterfactual ? (
          <CounterfactualTab cf={counterfactual} />
        ) : (
          <EmptyPlot>還沒有任何投入紀錄，先到帳戶頁建立帳戶並加碼後再回來看回測對照。</EmptyPlot>
        )}
      </div>
    </div>
  );
}
