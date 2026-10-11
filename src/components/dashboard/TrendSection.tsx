"use client";

import { useMemo, useState } from "react";
import {
  BenchChart,
  TrendChart,
  type BenchSeries,
  type PerfPoint,
  type SeriesPoint,
} from "./DashboardCharts";
import { RANGES, sliceByRange, sliceToCommonStart } from "./chart-data";
import { PICK_OFF, PICK_ON, sign, TONE_TEXT, toneCls } from "./shared";

export function TrendSection({
  series,
  perf,
  benchmarks,
  hasPerf,
  benchNotice,
  today,
}: {
  series: SeriesPoint[];
  perf: PerfPoint[];
  benchmarks: BenchSeries[];
  hasPerf: boolean;
  benchNotice?: string | null;
  today: string;
}) {
  const [range, setRange] = useState("6M");
  const [mode, setMode] = useState<"value" | "bench">("value");
  const [active, setActive] = useState<Record<string, boolean>>(() => ({
    portfolio: true,
    ...Object.fromEntries(
      benchmarks.map((benchmark, index) => [benchmark.key, index !== 1]),
    ),
  }));

  const sliced = useMemo(
    () => sliceByRange(series, range, today),
    [series, range, today],
  );
  const perfInRange = useMemo(
    () => sliceByRange(perf, range, today),
    [perf, range, today],
  );
  const perfSliced = useMemo(() => {
    const keys = [
      "portfolio",
      ...benchmarks
        .filter((benchmark) => active[benchmark.key])
        .map((benchmark) => benchmark.key),
    ];
    return sliceToCommonStart(perfInRange, keys);
  }, [perfInRange, benchmarks, active]);

  const enoughValue = sliced.length >= 2;
  const enoughBench = perfSliced.length >= 2;
  const change = enoughValue
    ? sliced[sliced.length - 1].value - sliced[0].value
    : 0;

  return (
    /* 二級容器。與上方持倉帳本只隔 16px：兩者同級，讀起來要成一組。
       survey-frame 的角標畫在框外，所以這裡不能 overflow-hidden。 */
    <section className="survey-frame mt-4 border border-[var(--c-border)] bg-[var(--c-surface)]">
      <div className="flex flex-col gap-4 px-4 pb-2 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6">
        <div>
          <h2 className="text-[length:var(--fs-lg)] font-semibold tracking-[-0.015em]">
            {mode === "value" ? "淨資產趨勢" : "績效對照"}
          </h2>
          <p className="mt-1 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
            {mode === "value" ? (
              enoughValue ? (
                <>
                  區間變化{" "}
                  <span className={TONE_TEXT[toneCls(change)]}>
                    <span className="amt font-medium">
                      {sign(change)}NT${" "}
                      {Math.abs(Math.round(change)).toLocaleString("en-US")}
                    </span>
                  </span>
                </>
              ) : (
                "此區間快照不足兩天"
              )
            ) : (
              "啟用線採共同起點 100，SPY／QQQ 已換算 TWD"
            )}
          </p>
        </div>

        {/* 控制項集中在圖表右上：區間（量哪一段）與模式（量什麼）都是讀這張圖的前提，
            原本區間列放在圖下方左側、模式在右上，同一張圖的兩組控制分在對角，
            視線要繞一圈。手機上這組會換到標題下方，仍在圖之前。 */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {/* 區間列是一條分段控制，讀起來像尺上的刻度格。
              外層負責水平捲動，內層 inline-flex 才不會被撐滿而把框拉長。 */}
          <div className="hide-scrollbar max-w-full overflow-x-auto">
            <div role="group" aria-label="區間" className="inline-flex divide-x divide-[var(--c-border)] border border-[var(--c-line-strong)]">
              {RANGES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={range === item.key}
                  onClick={() => setRange(item.key)}
                  /* 區間鈕是主圖表上最常按的控制項：觸控固定 44×44，
                     滑鼠（pointer: fine）收到 36px，跟旁邊的模式鈕同高，兩組並排才對得齊。 */
                  className={`tnum min-h-11 min-w-11 shrink-0 px-2.5 text-[length:var(--fs-micro)] pointer-fine:min-h-9 pointer-fine:min-w-10 ${
                    range === item.key ? PICK_ON : PICK_OFF
                  }`}
                >
                  {item.key}
                </button>
              ))}
            </div>
          </div>

        {hasPerf && (
          /* 分段控制：一條髮絲線框住，段與段之間是分隔線，不再是「底座裡放藥丸」。 */
          <div role="group" aria-label="圖表模式" className="inline-flex self-start divide-x divide-[var(--c-border)] border border-[var(--c-line-strong)]">
            {(["value", "bench"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mode === item}
                onClick={() => setMode(item)}
                className={`tap-row min-h-9 whitespace-nowrap px-3 text-[length:var(--fs-sm)] ${
                  mode === item ? PICK_ON : PICK_OFF
                }`}
              >
                {item === "value" ? "淨值" : "大盤對照"}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {mode === "value" ? (
        enoughValue ? (
          <TrendChart key={range} data={sliced} height={280} />
        ) : (
          <ChartEmpty>此區間快照不足兩天。</ChartEmpty>
        )
      ) : enoughBench ? (
        <BenchChart
          key={`${range}-${perfSliced[0].date}`}
          data={perfSliced}
          series={benchmarks}
          height={280}
          active={active}
        />
      ) : (
        <ChartEmpty>啟用的線沒有共同起算資料。</ChartEmpty>
      )}

      {mode === "bench" && benchNotice && (
        <p
          className="px-4 text-[length:var(--fs-micro)] text-[var(--c-faint)] sm:px-6"
          role="status"
        >
          {benchNotice}
        </p>
      )}

      {mode === "bench" ? (
        <div className="mt-2 border-t border-[var(--c-border)] px-4 py-3 sm:px-6">
          <div className="hide-scrollbar flex gap-1.5 overflow-x-auto pb-1">
            <LegendButton
              on={active.portfolio}
              color="var(--c-accent)"
              label="我的組合"
              onClick={() =>
                setActive((current) => ({
                  ...current,
                  portfolio: !current.portfolio,
                }))
              }
            />
            {benchmarks.map((benchmark) => (
              <LegendButton
                key={benchmark.key}
                on={active[benchmark.key]}
                color={benchmark.color}
                dash={benchmark.dash}
                label={benchmark.label}
                onClick={() =>
                  setActive((current) => ({
                    ...current,
                    [benchmark.key]: !current[benchmark.key],
                  }))
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="h-3" aria-hidden="true" />
      )}
    </section>
  );
}

function LegendButton({
  on,
  color,
  label,
  onClick,
  dash,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
  dash?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      /* 開關語彙：實線／虛線邊框 + 文字深淺，刻意不填色。填色是 PICK_ON 的專屬訊號，
         留給「互斥選擇」用；圖例是各自獨立的布林，兩者不該長得像。
         關閉時只把色線樣本調淡，文字改 muted 而不是整顆降透明度：
         整顆 opacity-45 會讓字掉到 2.9:1（淺）／3.7:1（深），muted 在兩個主題都過 4.5:1。 */
      className={`tap-row inline-flex min-h-9 shrink-0 items-center gap-1.5 border px-2.5 text-[length:var(--fs-micro)] font-medium hover:bg-[var(--c-surface-soft)] ${
        on
          ? "border-[var(--c-line-strong)] text-[var(--c-text)]"
          : "border-dashed border-[var(--c-border)] text-[var(--c-muted)]"
      }`}
    >
      <svg
        width="20"
        height="8"
        aria-hidden="true"
        className={`shrink-0 ${on ? "" : "opacity-35"}`}
      >
        <line
          x1="1"
          y1="4"
          x2="19"
          y2="4"
          stroke={color}
          strokeWidth={dash ? 1.5 : 2.25}
          strokeDasharray={dash}
          strokeLinecap="butt"
        />
      </svg>
      {label}
    </button>
  );
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[280px] items-center justify-center px-4 text-center text-sm text-[var(--c-faint)]">
      {children}
    </div>
  );
}
