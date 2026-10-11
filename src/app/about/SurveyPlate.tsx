import type { SeriesPoint } from "@/components/dashboard/DashboardCharts";

/* 介紹頁的主圖：示範資料的淨值線，「量」出來的過程本身就是動畫——
   先畫格線、再描線、再標回撤期間、最後在今天的位置下十字準星。
   每一步都在說明一件事（這段是回撤、這點是現值），不是裝飾。

   刻意不是 client 元件：圖是 SSR 出來的 SVG + HTML，動畫全是 CSS keyframe，
   這張圖不需要任何 JS。

   SVG 用 preserveAspectRatio="none" 撐滿容器，所以線條全加 non-scaling-stroke；
   文字與點標記不放在 SVG 裡（會跟著被壓扁），改成以百分比定位的 HTML 疊在上面，
   手機上字一樣是 10–12px，不會跟著 viewBox 縮小。 */

const VB_W = 1000;
const VB_H = 600;
// 繪圖區（viewBox 座標）。左側留給 Y 軸標籤，底部留給 X 軸標籤。
const PX0 = 110;
const PX1 = 960;
const PY0 = 36;
const PY1 = 530;
const MAX_POINTS = 180;

function downsample(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length <= MAX_POINTS) return series;
  const step = (series.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => series[Math.round(i * step)]);
}

// Y 軸刻度挑「萬」為單位的整數級距，讓刻度落在 3–6 條之間。
function niceTicks(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const steps = [50_000, 100_000, 200_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
  const range = Math.max(max - min, 1);
  const step = steps.find((s) => range / s <= 5) ?? steps[steps.length - 1];
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(3)}%`;

function nearestIndex(points: SeriesPoint[], date: string | null): number | null {
  if (!date) return null;
  const idx = points.findIndex((p) => p.date >= date);
  return idx === -1 ? points.length - 1 : idx;
}

export function SurveyPlate({
  series,
  maxDrawdown,
  ddPeak,
  ddTrough,
}: {
  series: SeriesPoint[];
  maxDrawdown: number | null;
  ddPeak: string | null;
  ddTrough: string | null;
}) {
  const points = downsample(series);
  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const { lo, hi, ticks } = niceTicks(Math.min(...values), Math.max(...values));
  const x = (i: number) => PX0 + ((PX1 - PX0) * i) / (points.length - 1);
  const y = (v: number) => PY1 - ((PY1 - PY0) * (v - lo)) / (hi - lo);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${PX1},${PY1}L${PX0},${PY1}Z`;

  const last = points[points.length - 1];
  const endX = x(points.length - 1);
  const endY = y(last.value);

  const peakI = nearestIndex(points, ddPeak);
  const troughI = nearestIndex(points, ddTrough);
  const dd =
    maxDrawdown != null && peakI != null && troughI != null && troughI > peakI
      ? { x0: x(peakI), x1: x(troughI) }
      : null;

  // X 軸：每季第一個點標一次「YYYY/MM」，最多 6 個，避免手機上擠在一起。
  const quarterMarks = points
    .map((p, i) => ({ i, date: p.date }))
    .filter((p, idx, arr) => idx === 0 || p.date.slice(0, 7) !== arr[idx - 1].date.slice(0, 7))
    .filter((p) => ["01", "04", "07", "10"].includes(p.date.slice(5, 7)))
    .slice(-6);

  const fmtWan = (v: number) => `${Math.round(v / 10_000)}萬`;

  return (
    <figure className="survey-plate">
      <div className="survey-frame relative aspect-[4/3] border border-[var(--c-line-strong)] bg-[var(--c-surface)] sm:aspect-[16/10]">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <g className="plate-grid">
            {ticks.map((t) => (
              <line
                key={t}
                x1={PX0}
                x2={PX1}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--c-grid)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {quarterMarks.map((m) => (
              <line
                key={m.date}
                x1={x(m.i)}
                x2={x(m.i)}
                y1={PY1}
                y2={PY1 + 8}
                stroke="var(--c-line-strong)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {dd && (
            <g className="plate-mark" style={{ "--d": "1.85s" } as React.CSSProperties}>
              <rect
                x={dd.x0}
                y={PY0}
                width={dd.x1 - dd.x0}
                height={PY1 - PY0}
                fill="var(--c-annot)"
                fillOpacity="0.08"
              />
              {[dd.x0, dd.x1].map((edge) => (
                <line
                  key={edge}
                  x1={edge}
                  x2={edge}
                  y1={PY0}
                  y2={PY1}
                  stroke="var(--c-annot)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}
          <path className="plate-area" d={area} fill="var(--c-accent-soft)" />
          <path
            className="plate-line"
            d={line}
            pathLength={1}
            fill="none"
            stroke="var(--c-accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Y 軸刻度 */}
        <div className="plate-grid pointer-events-none absolute inset-0" aria-hidden="true">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute left-2 -translate-y-1/2 font-mono text-[length:var(--fs-axis)] text-[var(--c-faint)] sm:left-3"
              style={{ top: pct(y(t), VB_H) }}
            >
              {fmtWan(t)}
            </span>
          ))}
          {quarterMarks.map((m, i) => (
            <span
              key={m.date}
              /* 手機寬度放不下 6 個「YYYY/MM」，從最右（今天）往回隔一個藏一個。 */
              className={`absolute -translate-x-1/2 font-mono text-[length:var(--fs-axis)] text-[var(--c-faint)] ${
                (quarterMarks.length - 1 - i) % 2 === 1 ? "max-sm:hidden" : ""
              }`}
              style={{ left: pct(x(m.i), VB_W), top: pct(PY1 + 14, VB_H) }}
            >
              {m.date.slice(0, 7).replace("-", "/")}
            </span>
          ))}
        </div>

        {/* 回撤期間的註記：朱砂框 + 虛線引線，字用 --c-annot-text（淺色主題退回內文色）。
            放在回撤帶的下緣而不是上緣：上緣附近是今天的水平準星線，兩條線會疊在一起。 */}
        {dd && maxDrawdown != null && (
          <div
            className="plate-mark pointer-events-none absolute -translate-y-full"
            style={{ left: pct(dd.x0, VB_W), top: pct(PY1 - 12, VB_H), "--d": "2s" } as React.CSSProperties}
            aria-hidden="true"
          >
            <span className="block whitespace-nowrap border border-[var(--c-annot)] bg-[var(--c-surface)] px-2 py-1 font-mono text-[length:var(--fs-micro)] text-[var(--c-annot-text)]">
              最大回撤 −{Math.abs(maxDrawdown * 100).toFixed(1)}%
              <span className="ml-1.5 hidden text-[var(--c-faint)] sm:inline">TWR 計</span>
            </span>
            <span className="plate-leader block h-4 border-l border-dashed border-[var(--c-annot)]" />
          </div>
        )}

        {/* 今天：十字準星 + 現值。準星線橫跨整個繪圖區，像在圖面上拉了一條量測線。 */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <span
            className="plate-mark plate-cross-v absolute border-l border-dashed border-[var(--c-accent)]"
            style={{ left: pct(endX, VB_W), top: pct(PY0, VB_H), bottom: pct(VB_H - PY1, VB_H), "--d": "2.25s" } as React.CSSProperties}
          />
          <span
            className="plate-mark plate-cross-h absolute border-t border-dashed border-[var(--c-accent)]"
            style={{ top: pct(endY, VB_H), left: pct(PX0, VB_W), right: pct(VB_W - PX1, VB_W), "--d": "2.25s" } as React.CSSProperties}
          />
          <span
            className="plate-mark absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 border-2 border-[var(--c-accent)] bg-[var(--c-surface)]"
            style={{ left: pct(endX, VB_W), top: pct(endY, VB_H), "--d": "2.35s" } as React.CSSProperties}
          />
          <span
            className="plate-mark absolute -translate-x-full whitespace-nowrap bg-[var(--c-btn-strong-bg)] px-2 py-1 font-mono text-[length:var(--fs-micro)] font-semibold text-[var(--c-btn-strong-text)]"
            style={{ left: `calc(${pct(endX, VB_W)} - 10px)`, top: `calc(${pct(endY, VB_H)} + 10px)`, "--d": "2.45s" } as React.CSSProperties}
          >
            NT$ {Math.round(last.value).toLocaleString("en-US")}
          </span>
        </div>
      </div>
      <figcaption className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[length:var(--fs-micro)] text-[var(--c-faint)]">
        <span>示範資料：固定種子生成的五個帳戶，非真實持倉</span>
        <span className="font-mono">
          {points[0].date} → {last.date}
        </span>
      </figcaption>
      {/* 圖本身對輔助技術隱藏，這句把圖在講的事完整說一次。 */}
      <p className="sr-only">
        示範組合的淨值從 {points[0].date} 的 NT$ {Math.round(points[0].value).toLocaleString("en-US")}
        變化到 {last.date} 的 NT$ {Math.round(last.value).toLocaleString("en-US")}
        {dd && maxDrawdown != null
          ? `；以時間加權報酬計，最大回撤為 ${(Math.abs(maxDrawdown) * 100).toFixed(1)}%，期間 ${ddPeak} 到 ${ddTrough}`
          : ""}
        。
      </p>
    </figure>
  );
}
