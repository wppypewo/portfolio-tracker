"use client";

import { allocColor, fmtTwd, type AllocDatum } from "./DashboardCharts";
import type { AllocTarget } from "./types";
import { CardHead, sign } from "./shared";
import { squarify, targetBoundary } from "./treemap";

// 偏離多少算「請注意」。與原本甜甜圈清單的第三級門檻相同。
const ATTENTION_PP = 5;

function driftInfo(actual: number, target: number) {
  if (!(target > 0)) return null;
  const raw = actual - target;
  if (!Number.isFinite(raw)) return null;
  const drift = Math.round(raw * 10) / 10;
  const magnitude = Math.abs(drift);
  return {
    text: `${sign(drift)}${magnitude.toFixed(1)}pp`,
    level: magnitude < 1 ? "quiet" : magnitude < ATTENTION_PP ? "normal" : "attention",
  } as const;
}

/* 地塊的斜線填色：一層 45° 細斜線，底下墊一層很淡的同色。
   兩層都由類別色 color-mix 出來，不寫死任何顏色。 */
function hatch(color: string) {
  return `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 55%, transparent) 0 1px, transparent 1px 6px), color-mix(in srgb, ${color} 12%, transparent)`;
}

// 版面在 3:2 的座標系裡算，畫的時候換成百分比，容器用 aspect-[3/2] 鎖住比例，
// 所以座標系的一單位在兩個方向上等長，地塊的長寬比與面積都跟算的一樣。
const W = 150;
const H = 100;
const pctX = (v: number) => `${(v / W) * 100}%`;
const pctY = (v: number) => `${(v / H) * 100}%`;

/* 狀態住在 DashboardClient，因為持倉帳本也要用同一個選取。
   hover 與 click 分成兩個是先前修掉的一個 bug：共用一個 state 時
   onMouseLeave 會把 click 的結果一併清掉，滑鼠使用者永遠釘不住。 */
export function AllocationCard({
  allocation,
  allocTargets,
  total,
  pinnedCls,
  activeCls,
  onHover,
  onPin,
}: {
  allocation: AllocDatum[];
  allocTargets: AllocTarget[];
  total: number;
  pinnedCls: string | null;
  activeCls: string | null;
  onHover: (cls: string | null) => void;
  onPin: (cls: string) => void;
}) {
  const selected = activeCls
    ? allocation.find((item) => item.cls === activeCls)
    : null;
  const targetOf = new Map(allocTargets.map((t) => [t.cls, t]));
  const rects = squarify(
    allocation.map((d) => d.value),
    { x: 0, y: 0, w: W, h: H },
  );
  const ariaLabel = `資產配置地塊圖：${allocation
    .map((d) => `${d.label} ${d.pct.toFixed(1)}%`)
    .join("、")}`;

  return (
    <div>
      <CardHead title="資產配置" sub="地塊面積＝實際比例，虛線＝目標邊界" />
      {/* 地塊圖與清單只在 640–1179px 之間並排。≥1180px 時本卡被塞進 344px 的窄欄
          （見 DashboardClient 的並排斷點），上下堆疊。
          寫成 sm:max-[1180px] 區間而不是 sm 疊 min-[1180px]：後者實測被 sm 蓋過。
          上界寫 1180 而不是 1179，是因為 Tailwind v4 把 max-[N] 編成
          `not (min-width: N)`，是嚴格小於；寫 1179 時視窗剛好 1179px 會掉進縫裡。 */}
      <div className="grid grid-cols-1 gap-5 sm:max-[1180px]:grid-cols-2 sm:max-[1180px]:items-start sm:max-[1180px]:gap-7">
        <div>
          {/* 讀數列：原本甜甜圈中間那個孔的內容。沒有選取時是總額，
              滑過或釘住一類時換成該類。 */}
          <div className="mb-2 flex min-h-5 items-baseline justify-between gap-3 text-[length:var(--fs-micro)]">
            <span className="text-[var(--c-muted)]">
              {selected ? selected.label : `總資產 · ${allocation.length} 類`}
            </span>
            <span className="font-semibold tnum">
              {selected && <span className="mr-2">{selected.pct.toFixed(1)}%</span>}
              <span className="amt">
                NT$ {fmtTwd(selected ? selected.value : total)}
              </span>
            </span>
          </div>

          {/* 地塊本身只給指標裝置用，鍵盤與讀屏走下面的清單（同一組 hover／pin），
              免得每一類有兩個 tab 停駐點。整張圖用 role="img" 給一句總述。 */}
          <div role="img" aria-label={ariaLabel} className="relative aspect-[3/2] w-full">
            {allocation.map((d, i) => {
              const r = rects[i];
              if (!(r.w > 0 && r.h > 0)) return null;
              const color = allocColor(d.cls);
              const t = targetOf.get(d.cls);
              const drift = t ? driftInfo(t.actual, t.target) : null;
              const boundary = t ? targetBoundary(r, t.actual, t.target) : null;
              const attention = drift?.level === "attention";
              const dim = activeCls != null && activeCls !== d.cls;
              // 名稱要多大的地塊才放得下：以窄欄約 300px 寬估，一單位約 2px。
              const showLabel = r.w >= 26 && r.h >= 16;
              const showPct = showLabel && r.h >= 22;
              return (
                <div
                  key={d.cls}
                  aria-hidden="true"
                  className={`absolute p-px transition-opacity duration-(--dur-state) ease-(--ease-state) ${dim ? "opacity-40" : ""}`}
                  style={{
                    left: pctX(r.x),
                    top: pctY(r.y),
                    width: pctX(r.w),
                    height: pctY(r.h),
                  }}
                  onMouseEnter={() => onHover(d.cls)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onPin(d.cls)}
                >
                  <div
                    className="relative h-full w-full overflow-hidden border"
                    style={{ borderColor: color, background: hatch(color) }}
                  >
                    {boundary && (
                      <span
                        className={`absolute border-dashed ${
                          boundary.axis === "x" ? "inset-y-0 border-l" : "inset-x-0 border-t"
                        }`}
                        style={{
                          [boundary.axis === "x" ? "left" : "top"]: `${boundary.at * 100}%`,
                          borderColor: attention ? "var(--c-annot)" : "var(--c-muted)",
                        }}
                      />
                    )}
                    {showLabel && (
                      <span className="absolute left-1.5 top-1.5 flex flex-col items-start gap-0.5 leading-none">
                        <span
                          className={`bg-[var(--c-surface)] px-1 py-0.5 text-[length:var(--fs-micro)] ${
                            pinnedCls === d.cls
                              ? "font-medium text-[var(--c-accent)]"
                              : "font-medium text-[var(--c-text)]"
                          }`}
                        >
                          {d.label}
                        </span>
                        {showPct && (
                          <span className="bg-[var(--c-surface)] px-1 py-0.5 text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
                            {d.pct.toFixed(1)}%
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex w-full flex-col">
          <div
            aria-hidden="true"
            className="grid grid-cols-[10px_minmax(0,1fr)_auto_58px] gap-2.5 border-b border-[var(--c-line-strong)] px-1.5 pb-1.5 text-[length:var(--fs-micro)] font-medium tracking-[0.06em] text-[var(--c-muted)]"
          >
            <span />
            <span>類別</span>
            <span className="text-right">實際／目標</span>
            <span className="text-right">偏離</span>
          </div>
          {allocTargets.map((item) => {
            const drift = driftInfo(item.actual, item.target);
            const attention = drift?.level === "attention";
            const color = allocColor(item.cls);
            return (
              <button
                key={item.cls}
                type="button"
                /* 只反映釘住的狀態。hover 是預覽，報成 pressed 會讓讀屏使用者
                   聽到一個他沒有做過的選擇。 */
                aria-pressed={pinnedCls === item.cls}
                aria-label={`${item.label}：實際 ${item.actual.toFixed(1)}%${
                  item.target > 0 ? `、目標 ${item.target.toFixed(0)}%` : ""
                }${drift ? `、偏離 ${drift.text}${attention ? "，超過 5pp" : ""}` : ""}`}
                className={`grid min-h-11 w-full grid-cols-[10px_minmax(0,1fr)_auto_58px] items-center gap-2.5 border-b border-[var(--c-border-soft)] px-1.5 text-left transition-opacity duration-(--dur-state) ease-(--ease-state) ${
                  activeCls && activeCls !== item.cls ? "opacity-40" : ""
                }`}
                onMouseEnter={() => onHover(item.cls)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(item.cls)}
                onBlur={() => onHover(null)}
                onClick={() => onPin(item.cls)}
              >
                <span
                  className="h-2.5 w-2.5 border"
                  style={{ borderColor: color, background: hatch(color) }}
                />
                {/* 需要注意的那一類：名稱後面拉一條朱砂虛線引線到偏離值，
                    偏離值本身加粗。顏色之外還有引線與字重兩個訊號。 */}
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`min-w-0 break-words text-[length:var(--fs-sm)] ${
                      pinnedCls === item.cls ? "font-medium text-[var(--c-accent)]" : ""
                    }`}
                  >
                    {item.label}
                  </span>
                  {attention && (
                    <span
                      aria-hidden="true"
                      className="h-0 min-w-4 flex-1 border-t border-dashed border-[var(--c-annot)]"
                    />
                  )}
                </span>
                <span className="text-right text-[length:var(--fs-sm)] tnum">
                  {item.actual.toFixed(1)}%
                  <span className="text-[var(--c-faint)]">
                    {" "}／{item.target > 0 ? `${item.target.toFixed(0)}%` : "—"}
                  </span>
                </span>
                <span
                  className={`flex items-center justify-end gap-1 text-right text-[length:var(--fs-micro)] tnum ${
                    !drift
                      ? "text-[var(--c-faint)]"
                      : attention
                        ? "font-medium text-[var(--c-annot-text)]"
                        : drift.level === "normal"
                          ? "font-medium text-[var(--c-muted)]"
                          : "text-[var(--c-faint)]"
                  }`}
                >
                  {attention && (
                    <span
                      aria-hidden="true"
                      className="h-[7px] w-px bg-[var(--c-annot)]"
                    />
                  )}
                  {drift ? drift.text : "—"}
                </span>
              </button>
            );
          })}
          <p className="mt-2 text-[length:var(--fs-micro)] leading-5 text-[var(--c-faint)]">
            虛線外側是超出目標的部分；偏離超過 {ATTENTION_PP}pp 的類別以朱砂引線標出。
          </p>
        </div>
      </div>
    </div>
  );
}
