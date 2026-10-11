import type { AllocDatum } from "@/components/dashboard/DashboardCharts";
import type { AllocTarget } from "@/components/dashboard/types";
import { squarify } from "@/components/dashboard/treemap";

/* 介紹頁的地籍圖：首頁 AllocationCard 的靜態版，沒有 hover 與釘選，
   只負責讓第一次看的人讀懂「面積＝比例、虛線外側＝超出目標」。
   AllocationCard 是 client 元件（帶互動），這裡是 server 元件，
   所以類別色與斜線配方各寫一份；兩邊都只引用 globals.css 的變數，改色只改一處。 */

const CLASS_COLOR: Record<string, string> = {
  stock: "var(--c-accent)",
  fund: "var(--c-alloc-fund)",
  crypto: "var(--c-alloc-crypto)",
  precious_metal: "var(--c-alloc-metal)",
  liquid_cash: "var(--c-alloc-cash)",
  other_investment: "var(--c-alloc-other)",
  fixed_asset: "var(--c-alloc-fixed)",
  receivable: "var(--c-alloc-receivable)",
};
const colorOf = (cls: string) => CLASS_COLOR[cls] ?? "var(--c-muted)";
const hatch = (c: string) =>
  `repeating-linear-gradient(135deg, color-mix(in srgb, ${c} 55%, transparent) 0 1px, transparent 1px 6px), color-mix(in srgb, ${c} 12%, transparent)`;

const W = 150;
const H = 100;
const ATTENTION_PP = 5;

export function CadastralMap({
  allocation,
  allocTargets,
}: {
  allocation: AllocDatum[];
  allocTargets: AllocTarget[];
}) {
  const rects = squarify(
    allocation.map((d) => d.value),
    { x: 0, y: 0, w: W, h: H },
  );
  const targetOf = new Map(allocTargets.map((t) => [t.cls, t.target]));

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-start md:gap-10">
      <div
        role="img"
        aria-label={`示範組合的資產配置：${allocation.map((d) => `${d.label} ${d.pct.toFixed(1)}%`).join("、")}`}
        className="survey-frame relative aspect-[3/2] border border-[var(--c-line-strong)] bg-[var(--c-surface)]"
      >
        {allocation.map((d, i) => {
          const r = rects[i];
          if (!r || r.w <= 0) return null;
          const color = colorOf(d.cls);
          return (
            <div
              key={d.cls}
              className="cad-parcel absolute border p-1.5 sm:p-2"
              style={
                {
                  left: `${(r.x / W) * 100}%`,
                  top: `${(r.y / H) * 100}%`,
                  width: `${(r.w / W) * 100}%`,
                  height: `${(r.h / H) * 100}%`,
                  borderColor: color,
                  background: hatch(color),
                  "--i": i,
                } as React.CSSProperties
              }
            >
              {r.w > 22 && r.h > 14 && (
                <span className="inline-flex flex-col bg-[var(--c-surface)] px-1 py-0.5 leading-tight">
                  <span className="whitespace-nowrap text-[length:var(--fs-micro)] font-semibold">{d.label}</span>
                  <span className="font-mono text-[length:var(--fs-axis)] text-[var(--c-muted)]">
                    {d.pct.toFixed(1)}%
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <table className="w-full text-[length:var(--fs-sm)]">
        <caption className="sr-only">各類別的實際占比、目標與偏離</caption>
        <thead>
          <tr className="border-b border-[var(--c-line-strong)] text-left text-[length:var(--fs-micro)] text-[var(--c-faint)]">
            <th scope="col" className="py-2 font-medium">類別</th>
            <th scope="col" className="py-2 text-right font-medium">實際</th>
            <th scope="col" className="py-2 text-right font-medium">目標</th>
            <th scope="col" className="py-2 text-right font-medium">偏離</th>
          </tr>
        </thead>
        <tbody>
          {allocation.map((d) => {
            const target = targetOf.get(d.cls) ?? 0;
            const drift = target > 0 ? Math.round((d.pct - target) * 10) / 10 : null;
            const attention = drift != null && Math.abs(drift) >= ATTENTION_PP;
            return (
              <tr key={d.cls} className="border-b border-[var(--c-border)]">
                <th scope="row" className="py-2.5 text-left font-normal">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 border"
                      style={{ borderColor: colorOf(d.cls), background: hatch(colorOf(d.cls)) }}
                    />
                    {d.label}
                  </span>
                </th>
                <td className="tnum py-2.5 text-right">{d.pct.toFixed(1)}%</td>
                <td className="tnum py-2.5 text-right text-[var(--c-muted)]">{target > 0 ? `${target}%` : "—"}</td>
                <td className="tnum py-2.5 text-right text-[var(--c-muted)]">
                  {drift == null ? "—" : `${drift > 0 ? "+" : drift < 0 ? "−" : ""}${Math.abs(drift).toFixed(1)}pp`}
                  {attention && <span className="ml-1 text-[var(--c-annot-text)]">注意</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
