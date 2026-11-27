"use client";

// 儀表板圖表（手刻 SVG）。帳戶詳情頁另用 recharts 版（PortfolioCharts.tsx）。

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { fmtFull, fmtCompact } from "@/lib/format";
import {
  axisLabeler,
  labelCapacity,
  niceTicks,
  pickTickIndices,
  tickDecimals,
} from "./chart-scale";

// 金額格式統一走 lib/format；fmtTwd 別名保留給既有匯入端。
export const fmtTwd = fmtFull;

// 資產類別配色（9 類 + fallback）。
// 色值定義在 globals.css，深淺兩個主題各一組：同一組 hex 在淺色底下對比不足，
// 圓環扇形會分不出來。這裡只引用 token，不放實際色值。
export const ALLOC_COLORS: Record<string, string> = {
  stock: "var(--c-accent)",
  fund: "var(--c-alloc-fund)",
  crypto: "var(--c-alloc-crypto)",
  precious_metal: "var(--c-alloc-metal)",
  liquid_cash: "var(--c-alloc-cash)",
  other_investment: "var(--c-alloc-other)",
  fixed_asset: "var(--c-alloc-fixed)",
  receivable: "var(--c-alloc-receivable)",
  liability: "var(--c-down)",
};
export const allocColor = (cls: string) => ALLOC_COLORS[cls] ?? "var(--c-muted)";

export type SeriesPoint = { date: string; value: number };
export type PerfPoint = {
  date: string;
  portfolio?: number;
  [key: string]: number | string | undefined;
};
export type BenchSeries = {
  key: string;
  label: string;
  color: string;
  dash?: string;
};
export type AllocDatum = {
  cls: string;
  label: string;
  value: number;
  pct: number;
};

/* 圖表寬度：掛載當下先同步量一次，之後交給 ResizeObserver。
   只靠 observer 時，寬度要等它第一次非同步回呼才更新；在某些環境（背景分頁、
   無頭瀏覽器）那一次回呼遲遲不來，圖就停在預設的 720px，右側留一大塊空白。
   useLayoutEffect 在繪製前執行，使用者看不到 720 → 實際寬度的跳動。 */
function useChartWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  setW: (w: number) => void,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = el.getBoundingClientRect().width;
    if (first > 0) setW(first);
    const ro = new ResizeObserver((e) => {
      const next = e[0].contentRect.width;
      if (next > 0) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, setW]);
}

/* 十字準線的軸端讀數：反白小籤，貼在 y 軸與 x 軸上。
   測量儀器的讀數窗，不是浮動卡片，所以沒有陰影、沒有圓角。 */
const AXIS_TAG =
  "tnum pointer-events-none absolute z-[4] whitespace-nowrap bg-[var(--c-text)] px-1 text-[length:var(--fs-axis)] leading-4 text-[var(--c-page)]";

/* 讀數框：髮絲線邊、實底、無陰影。 */
const READOUT =
  "tooltip-pop pointer-events-none absolute top-1.5 z-[5] -translate-x-1/2 whitespace-nowrap border border-[var(--c-line-strong)] bg-[var(--c-surface)] px-2.5 py-1.5";

/* ---------- 淨值圖（描繪動畫 + 十字準線）---------- */
export function TrendChart({
  data,
  height = 300,
}: {
  data: SeriesPoint[];
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [len, setLen] = useState(0);

  useChartWidth(wrapRef, setW);
  // 描繪動畫：掛載後（非同步）觸發 stroke-dashoffset → 0。
  // 切換區間時由父層的 key 重新掛載本元件來重播。
  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 40);
    return () => clearTimeout(t);
  }, []);

  const padT = 16;
  const padB = 30;
  const padL = 52;
  const padR = 16;
  const H = height;
  const vals = data.map((d) => d.value);
  // 值域交給 niceTicks 決定：刻度落在整數，首尾刻度就是值域端點。
  // 原本是 min/max 上下各推 12% 當留白，那段留白沒有刻度，等於白白吃掉
  // 兩成的繪圖高度，線的振幅被壓扁。
  const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
  // 小數位數跟著刻度間距走，區間窄時相鄰標籤才不會四捨五入成同一個字
  const axisLabel = axisLabeler(ticks);
  const nx = (i: number) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const ny = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const line = data
    .map((d, i) => `${i ? "L" : "M"}${nx(i).toFixed(1)},${ny(d.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${nx(data.length - 1)},${H - padB} L${nx(0)},${
    H - padB
  } Z`;

  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength());
  }, [line]);

  const setFromClientX = useCallback(
    (clientX: number) => {
      if (!wrapRef.current || data.length < 2) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      let idx = Math.round(((x - padL) / (w - padL - padR)) * (data.length - 1));
      idx = Math.max(0, Math.min(data.length - 1, idx));
      setHover(idx);
    },
    [w, data.length],
  );
  const onMove = useCallback(
    (e: React.MouseEvent) => setFromClientX(e.clientX),
    [setFromClientX],
  );
  // 觸控 scrubbing：touch-action pan-y 讓水平滑動歸圖表、垂直保留給頁面捲動
  const onTouch = useCallback(
    (e: React.TouchEvent) => setFromClientX(e.touches[0].clientX),
    [setFromClientX],
  );
  // 鍵盤逐日移動；Home/End 跳頭尾
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (data.length < 2) return;
      const cur = hover ?? data.length - 1;
      let next: number | null = null;
      if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
      else if (e.key === "ArrowRight") next = Math.min(data.length - 1, cur + 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = data.length - 1;
      else if (e.key === "Escape") {
        setHover(null);
        return;
      }
      if (next !== null) {
        e.preventDefault();
        setHover(next);
      }
    },
    [hover, data.length],
  );

  const hi_ =
    hover != null && Number.isFinite(hover) && hover < data.length
      ? data[hover]
      : null;

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ touchAction: "pan-y" }}
      tabIndex={0}
      role="group"
      aria-roledescription="互動圖表"
      aria-label="淨資產趨勢圖。左右方向鍵逐日檢視，Home/End 跳至頭尾。"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onKeyDown={onKeyDown}
    >
      {/* server 端還量不到容器寬，w 先是預設的 720；max-width 讓 hydration 前的圖縮進容器，
          不把手機頁面撐出橫向捲動（實測 375 寬時頁面被撐到 737）。高度不跟著縮，hydration 後不跳版。 */}
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        style={{ display: "block", overflow: "visible", maxWidth: "100%" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={w - padR}
              y1={ny(t)}
              y2={ny(t)}
              stroke="var(--c-grid)"
              strokeWidth="1"
            />
            {/* 基線對齊格線中央。原本是 y = ny(t) - 4 把字擺在格線「上方」，
                最高那條的標籤落在 y=12，貼著 SVG 頂緣，而且字與格線沒有對齊，
                讀者得自己判斷這個數字屬於哪條線。 */}
            <text
              x={padL - 8}
              y={ny(t)}
              className="amt tnum text-[length:var(--fs-axis)]"
              fill="var(--c-faint)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {axisLabel(t)}
            </text>
          </g>
        ))}
        {data.length >= 3 &&
          pickTickIndices(data.length, labelCapacity(w - padL - padR)).map(
            (di, i, all) => (
              <text
                key={di}
                x={nx(di)}
                y={H - 8}
                className="text-[length:var(--fs-axis)]"
                fill="var(--c-faint)"
                textAnchor={
                  i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"
                }
              >
                {data[di].date.slice(5).replace("-", "/")}
              </text>
            ),
          )}
        <path
          className="chart-reveal"
          d={area}
          fill="var(--c-accent)"
          fillOpacity="0.07"
          opacity={drawn ? 1 : 0}
          style={{ transition: "opacity .34s ease" }}
        />
        <path
          ref={pathRef}
          className="chart-reveal"
          d={line}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth="2"
          strokeLinecap="butt"
          strokeLinejoin="miter"
          strokeMiterlimit={2}
          style={{
            strokeDasharray: len,
            strokeDashoffset: drawn ? 0 : len,
            transition: "stroke-dashoffset .34s cubic-bezier(.4,0,.2,1)",
          }}
        />
        {/* 十字準線：垂直線對到日期、水平線對到數值，兩端在軸上各有一個讀數籤。
            只有髮絲線，交點一個空心方框；不畫圓點，全站控制項與標記都是直角。 */}
        {hi_ && (
          <g>
            <line
              x1={nx(hover!)}
              x2={nx(hover!)}
              y1={padT}
              y2={H - padB}
              stroke="var(--c-muted)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <line
              x1={padL}
              x2={w - padR}
              y1={ny(hi_.value)}
              y2={ny(hi_.value)}
              stroke="var(--c-muted)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <rect
              x={nx(hover!) - 4}
              y={ny(hi_.value) - 4}
              width="8"
              height="8"
              fill="var(--c-surface)"
              stroke="var(--c-accent)"
              strokeWidth="1.5"
            />
          </g>
        )}
        {!hi_ && (
          <rect
            className="chart-reveal"
            x={nx(data.length - 1) - 3}
            y={ny(data[data.length - 1].value) - 3}
            width="6"
            height="6"
            fill="var(--c-accent)"
            opacity={drawn ? 1 : 0}
            style={{ transition: "opacity .34s ease" }}
          />
        )}
      </svg>
      {hi_ && (
        <>
          <span
            aria-hidden="true"
            className={`${AXIS_TAG} amt -translate-x-full -translate-y-1/2`}
            style={{ left: padL - 3, top: ny(hi_.value) }}
          >
            {fmtCompact(hi_.value)}
          </span>
          <span
            aria-hidden="true"
            className={`${AXIS_TAG} -translate-x-1/2`}
            style={{
              left: Math.min(Math.max(nx(hover!), padL + 32), w - padR - 32),
              top: H - 20,
            }}
          >
            {hi_.date}
          </span>
          <div
            className={READOUT}
            style={{ left: Math.min(Math.max(nx(hover!), 70), w - 70) }}
          >
            <div className="amt tnum text-[length:var(--fs-md)] font-semibold">
              NT$ {fmtTwd(hi_.value)}
            </div>
          </div>
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {hi_ ? `${hi_.date}，淨資產 ${fmtTwd(hi_.value)} 元` : ""}
      </span>
    </div>
  );
}

/* ---------- 大盤對照多線圖（區間起點 = 100）---------- */
export function BenchChart({
  data,
  series,
  height = 300,
  active,
}: {
  data: PerfPoint[];
  series: BenchSeries[];
  height?: number;
  active: Record<string, boolean>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useChartWidth(wrapRef, setW);
  // 淡入動畫：掛載後（非同步）觸發。切換區間由父層 key 重播。
  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 40);
    return () => clearTimeout(t);
  }, []);

  const padT = 16;
  const padB = 30;
  const padL = 52;
  const padR = 16;
  const H = height;
  const keys = ["portfolio", ...series.map((s) => s.key)].filter(
    (k) => active[k],
  );

  // 真實資料是稀疏的（組合只在快照日有值、benchmark 只在交易日有值），
  // 所以 normalize 時用「區間內第一個有值」當基準，缺值點標 null 並在連線時跨接。
  const norm: Record<string, (number | null)[]> = {};
  for (const k of keys) {
    let base: number | null = null;
    for (const d of data) {
      const v = d[k];
      if (typeof v === "number") {
        base = v;
        break;
      }
    }
    norm[k] = data.map((d) => {
      const v = d[k];
      return base && base > 0 && typeof v === "number" ? (v / base) * 100 : null;
    });
  }

  const all = keys.flatMap((k) =>
    norm[k].filter((v): v is number => v != null),
  );
  const { lo, hi, ticks } = niceTicks(
    all.length ? Math.min(...all) : 95,
    all.length ? Math.max(...all) : 105,
  );
  // 指數在 100 上下只動零點幾時 step 會是 0.2、0.5，toFixed(0) 會印出重複的整數
  const tickDigits = tickDecimals(ticks);
  const nx = (i: number) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const ny = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const colorOf = (k: string) =>
    k === "portfolio"
      ? "var(--c-accent)"
      : (series.find((s) => s.key === k)?.color ?? "var(--c-muted)");
  const dashOf = (k: string) =>
    k === "portfolio" ? undefined : series.find((s) => s.key === k)?.dash;

  // 實線段：只連相鄰都有值的點，null 點不跨接。
  const solidPathOf = (k: string) => {
    let d = "";
    let lastI: number | null = null;
    norm[k].forEach((v, i) => {
      if (v == null) { lastI = null; return; }
      d += `${lastI === null ? "M" : "L"}${nx(i).toFixed(1)},${ny(v).toFixed(1)} `;
      lastI = i;
    });
    return d.trim();
  };

  // 橋接虛線：跨越 null 空缺，連接缺口兩端點，讓使用者看出資料有斷層。
  const gapPathOf = (k: string) => {
    let d = "";
    let lastNonNull: { i: number; v: number } | null = null;
    let inGap = false;
    norm[k].forEach((v, i) => {
      if (v != null) {
        if (inGap && lastNonNull != null) {
          d += `M${nx(lastNonNull.i).toFixed(1)},${ny(lastNonNull.v).toFixed(1)} L${nx(i).toFixed(1)},${ny(v).toFixed(1)} `;
          inGap = false;
        }
        lastNonNull = { i, v };
      } else {
        if (lastNonNull != null) inGap = true;
      }
    });
    return d.trim();
  };

  const setFromClientX = (clientX: number) => {
    if (!wrapRef.current || data.length < 2) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const idx = Math.round(
      ((clientX - rect.left - padL) / (w - padL - padR)) * (data.length - 1),
    );
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  };
  const onMove = (e: React.MouseEvent) => setFromClientX(e.clientX);
  const onTouch = (e: React.TouchEvent) => setFromClientX(e.touches[0].clientX);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (data.length < 2) return;
    const cur = hover ?? data.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowRight") next = Math.min(data.length - 1, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = data.length - 1;
    else if (e.key === "Escape") {
      setHover(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setHover(next);
    }
  };
  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ touchAction: "pan-y" }}
      tabIndex={0}
      role="group"
      aria-roledescription="互動圖表"
      aria-label="組合與大盤對照圖。左右方向鍵逐日檢視，Home/End 跳至頭尾。"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onKeyDown={onKeyDown}
    >
      {/* max-width 的原因同 TrendChart */}
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        style={{ display: "block", overflow: "visible", maxWidth: "100%" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={w - padR}
              y1={ny(t)}
              y2={ny(t)}
              stroke="var(--c-grid)"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={ny(t)}
              className="tnum text-[length:var(--fs-axis)]"
              fill="var(--c-faint)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {t.toFixed(tickDigits)}
            </text>
          </g>
        ))}
        {/* 起點 100 是這張圖的判讀基準，畫實一點讓「贏了大盤還輸了」一眼看出。 */}
        {lo < 100 && hi > 100 && (
          <line
            x1={padL}
            x2={w - padR}
            y1={ny(100)}
            y2={ny(100)}
            stroke="var(--c-line-strong)"
            strokeWidth="1"
          />
        )}
        {data.length > 1 &&
          pickTickIndices(data.length, labelCapacity(w - padL - padR)).map(
            (di, i, all) => {
              const sameYear =
                data[0].date.slice(0, 4) ===
                data[data.length - 1].date.slice(0, 4);
              const date = data[di].date;
              const label =
                sameYear || i === 0 || i === all.length - 1
                  ? date.slice(5).replace("-", "/")
                  : date.slice(0, 7).replace("-", "/");
              return (
                <text
                  key={di}
                  x={nx(di)}
                  y={H - 8}
                  className="text-[length:var(--fs-axis)]"
                  fill="var(--c-faint)"
                  textAnchor={
                    i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"
                  }
                >
                  {label}
                </text>
              );
            },
          )}
        {keys.map((k) => (
          <path
            key={k}
            className="chart-reveal"
            d={solidPathOf(k)}
            fill="none"
            stroke={colorOf(k)}
            strokeWidth={k === "portfolio" ? 2.25 : 1.5}
            strokeDasharray={dashOf(k)}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            strokeMiterlimit={2}
            opacity={drawn ? (k === "portfolio" ? 1 : 0.72) : 0}
            style={{ transition: "opacity .34s ease" }}
          />
        ))}
        {keys.map((k) => {
          const gd = gapPathOf(k);
          if (!gd) return null;
          return (
            <path
              key={`gap-${k}`}
              className="chart-reveal"
              d={gd}
              fill="none"
              stroke={colorOf(k)}
              strokeWidth={k === "portfolio" ? 1.5 : 1.2}
              strokeDasharray="2 4"
              strokeLinecap="butt"
              opacity={drawn ? 0.35 : 0}
              style={{ transition: "opacity .34s ease" }}
            />
          );
        })}
        {hover != null && hover < data.length && (
          <line
            x1={nx(hover)}
            x2={nx(hover)}
            y1={padT}
            y2={H - padB}
            stroke="var(--c-muted)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}
        {hover != null && hover < data.length &&
          keys.map((k) => {
            const v = norm[k][hover];
            if (v == null) return null;
            return (
              <rect
                key={k}
                x={nx(hover) - 3.5}
                y={ny(v) - 3.5}
                width="7"
                height="7"
                fill="var(--c-surface)"
                stroke={colorOf(k)}
                strokeWidth="1.5"
              />
            );
          })}
      </svg>
      {hover != null && hover < data.length && (
        <span
          aria-hidden="true"
          className={`${AXIS_TAG} -translate-x-1/2`}
          style={{
            left: Math.min(Math.max(nx(hover), padL + 32), w - padR - 32),
            top: H - 20,
          }}
        >
          {data[hover].date}
        </span>
      )}
      {hover != null && hover < data.length && (
        <div
          className={READOUT}
          style={{ left: Math.min(Math.max(nx(hover), 90), w - 90) }}
        >
          {keys.map((k) => {
            const v = norm[k][hover];
            if (v == null) return null;
            return (
              <div
                key={k}
                className="flex items-center gap-2 text-[length:var(--fs-micro)] leading-5"
              >
                <span
                  className="h-[7px] w-[7px] shrink-0"
                  style={{ background: colorOf(k) }}
                />
                <span className="text-[var(--c-muted)]">
                  {k === "portfolio"
                    ? "我的組合"
                    : (series.find((s) => s.key === k)?.label ?? k)}
                </span>
                <span
                  className="ml-auto pl-3 font-semibold tnum"
                  style={{ color: v >= 100 ? "var(--c-up)" : "var(--c-down)" }}
                >
                  {v >= 100 ? "+" : "−"}
                  {Math.abs(v - 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {hover != null && hover < data.length
          ? `${data[hover].date}，${keys
              .map((key) => {
                const value = norm[key][hover];
                if (value == null) return null;
                const label =
                  key === "portfolio"
                    ? "我的組合"
                    : (series.find((item) => item.key === key)?.label ?? key);
                return `${label} ${value >= 100 ? "上漲" : "下跌"} ${Math.abs(value - 100).toFixed(1)}%`;
              })
              .filter(Boolean)
              .join("，")}`
          : ""}
      </span>
    </div>
  );
}
