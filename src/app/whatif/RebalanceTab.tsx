"use client";

import { useMemo, useState } from "react";
import { Panel, SurveyLabel, Tag, EmptyPlot } from "@/components/survey";
import { ASSET_CLASS_LABEL } from "@/lib/dashboard-data";
import { fmtFull } from "@/lib/format";
import { planRebalance } from "@/lib/rebalance";
import type { ScenarioHolding } from "@/lib/scenario";

export type RebalanceData = {
  holdings: ScenarioHolding[];
  allocationTargets: Record<string, number>;
};

const PRESETS = [0, 10_000, 30_000, 50_000, 100_000];

export function RebalanceTab({ data }: { data: RebalanceData }) {
  const [contribution, setContribution] = useState(0);

  const plan = useMemo(
    () =>
      planRebalance({
        holdings: data.holdings,
        targets: data.allocationTargets,
        contributionTwd: contribution,
      }),
    [data.holdings, data.allocationTargets, contribution],
  );

  if (plan.rows.length === 0) {
    return (
      <EmptyPlot>
        {plan.notes[0] ??
          "還沒有可估值的持倉，先到帳戶頁建立帳戶後再回來看再平衡建議。"}
      </EmptyPlot>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel title="這次要投入多少">
        <p className="text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
          只買不賣。賣出會實現損益、計入海外所得，所以這裡算的是「新資金該怎麼分」，
          不是「該賣掉什麼」。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[length:var(--fs-sm)]">
            <span className="text-[var(--c-muted)]">NT$</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={contribution === 0 ? "" : contribution}
              onChange={(e) =>
                setContribution(Math.max(0, Number(e.target.value) || 0))
              }
              placeholder="0"
              className="field h-11 w-[140px] py-0 text-right font-semibold tnum"
            />
          </label>
          {/* 快捷金額：方角分段鈕，跟推算分頁的報酬假設同一套 */}
          <div className="flex flex-wrap border border-[var(--c-border)] bg-[var(--c-surface-soft)]">
            {PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setContribution(v)}
                aria-pressed={contribution === v}
                className={`tap-row min-h-[44px] border-r border-[var(--c-border)] px-3 text-[length:var(--fs-sm)] font-semibold transition-colors last:border-r-0 ${
                  contribution === v
                    ? "bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[inset_0_-2px_0_var(--c-accent)]"
                    : "text-[var(--c-muted)] hover:bg-[var(--c-surface)] hover:text-[var(--c-text)]"
                }`}
              >
                {v === 0 ? "不投入" : <span className="tnum">{(v / 10_000).toLocaleString("en-US")} 萬</span>}
              </button>
            ))}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-px border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-3">
          <Stat label="目前總市值" value={plan.totalTwd} />
          <Stat
            label="補平全部低配需要"
            value={plan.totalShortfallTwd}
            hint={
              contribution > 0 && plan.totalShortfallTwd > contribution
                ? "這次投入不夠補滿"
                : undefined
            }
          />
          <Stat label="未分配餘額" value={plan.unallocatedTwd} />
        </dl>
      </Panel>

      <Panel title="各類別配置" flush>
        <p className="scroll-cue px-5 pt-2">左右滑動查看完整欄位</p>
        <div className="scroll-region overflow-x-auto" tabIndex={0} aria-label="再平衡配置表，可水平捲動">
          <table className="w-full min-w-[640px] text-[length:var(--fs-sm)]">
            <thead className="border-b border-[var(--c-line-strong)] text-left text-[length:var(--fs-micro)] tracking-[0.06em] text-[var(--c-muted)]">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-semibold">類別</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">目標</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">實際</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">偏離</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">差額</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">本次配置</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">投入後</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr
                  key={r.assetClass}
                  className="border-t border-[var(--c-border-soft)] first:border-t-0"
                >
                  <th scope="row" className="px-5 py-3 text-left font-medium">
                    {ASSET_CLASS_LABEL[r.assetClass] ?? r.assetClass}
                    {r.untargeted && (
                      <span className="ml-2">
                        <Tag tone="quiet">未設目標</Tag>
                      </span>
                    )}
                  </th>
                  <td className="tnum px-3 py-3 text-right text-[var(--c-muted)]">
                    {r.targetPct.toFixed(0)}%
                  </td>
                  <td className="tnum px-3 py-3 text-right">{r.actualPct.toFixed(1)}%</td>
                  <td
                    className="tnum px-3 py-3 text-right"
                    style={{ color: driftColor(r.driftPp) }}
                  >
                    {signed(r.driftPp, 1)}pp
                  </td>
                  <td
                    className="amt tnum px-3 py-3 text-right"
                    style={{ color: driftColor(-r.gapTwd) }}
                  >
                    {signedTwd(r.gapTwd)}
                  </td>
                  <td className="amt tnum px-3 py-3 text-right font-semibold">
                    {r.contributionTwd > 0 ? fmtFull(r.contributionTwd) : "—"}
                  </td>
                  <td className="tnum px-5 py-3 text-right text-[var(--c-muted)]">
                    {r.afterPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <aside className="border-t border-[var(--c-border)] pt-3">
        <h3 className="text-[length:var(--fs-micro)] font-semibold tracking-[0.06em] text-[var(--c-muted)]">
          前提與限制
        </h3>
        <ul className="mt-2 list-[square] space-y-1 pl-5 text-[length:var(--fs-micro)] leading-relaxed text-[var(--c-faint)]">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            「差額」是不投入新資金時、要達到目標比例的市值差；「本次配置」則是以投入後的
            總市值為基準重算，兩個數字不一樣是正常的。
          </li>
          <li>未計手續費、稅負、最小交易單位與零股限制。實際下單金額請自行取整。</li>
          <li>
            以資產類別為單位計算，不細分到個別帳戶或標的。同類別內要買哪一檔由你決定。
          </li>
        </ul>
      </aside>
    </div>
  );
}

/* 指標格。投入不夠補滿時不用跌色（這不是虧損），改用朱砂註記：
   標籤列多一條虛線引線與提示字，跟情境分頁的檢核格同一個規則。 */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="bg-[var(--c-surface)] px-4 py-3.5">
      <dt className="flex items-center gap-2">
        <SurveyLabel className="shrink-0">{label}</SurveyLabel>
        {hint && (
          <span aria-hidden="true" className="h-0 min-w-3 flex-1 border-t border-dashed border-[var(--c-annot)]" />
        )}
      </dt>
      <dd className="amt tnum mt-1.5 text-[length:var(--fs-md)] font-semibold">{fmtFull(value)}</dd>
      {hint && (
        <dd className="mt-1 text-[length:var(--fs-micro)] font-semibold text-[var(--c-annot-text)]">{hint}</dd>
      )}
    </div>
  );
}

/* 低配（該補）用漲色、超配用跌色，與全站賺綠虧紅的方向一致：
   綠色代表「這裡要加錢」，紅色代表「這裡已經太多」。 */
function driftColor(v: number): string {
  if (Math.abs(v) < 0.05) return "var(--c-muted)";
  return v > 0 ? "var(--c-down)" : "var(--c-up)";
}

function signed(v: number, digits: number): string {
  if (Math.abs(v) < 0.05) return "0";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}

function signedTwd(v: number): string {
  if (Math.abs(v) < 1) return "—";
  return `${v > 0 ? "+" : "−"}${fmtFull(Math.abs(v))}`;
}
