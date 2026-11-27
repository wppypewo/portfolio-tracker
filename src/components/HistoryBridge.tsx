/* 歷史回放的淨值變動拆解帳，/demo/history 與登入後 /history 共用。
   無狀態純標記，不加 "use client"。 */
import { PARCEL_HATCH, Panel, Tag } from "@/components/survey";
import { fmtFull, fmtNum, fmtSignedTwd } from "@/lib/format";
import type { AttributionResult } from "@/lib/history-replay";

type BridgeRow = { key: string; label: string; note?: string; value: number; total?: boolean; alert?: boolean };

/* 淨值變動拆解：期初 → 各項流量 → 回放淨值，像測量導線一樣逐站累加。
   恆等式照 attributePortfolioPeriod：
   期初 + 投入 + 範圍加入 + 市價 + 匯率 + 收入 + 未解釋 − 提領 − 範圍移出 ＝ 期末。
   每列的條從中軸往左（減）或往右（加）長，長度相對於最大的一項流量——
   刻意不用從 0 起算的瀑布圖，因為流量只有淨值的幾個百分點，照絕對尺度畫會看不見。
   歸因是拆解不是損益，所以條一律測量藍；只有未解釋差額超出容差時換朱砂虛線加「注意」。
   parcel：條改成月報同款的斜線地塊，並從中軸往外長出。目前只有 /demo/history 開，正式版 /history 維持實心條。 */
export function HistoryBridge({
  attribution: a,
  openingDate,
  targetDate,
  parcel = false,
}: {
  attribution: AttributionResult;
  openingDate: string;
  targetDate: string;
  parcel?: boolean;
}) {
  const flows: BridgeRow[] = [
    { key: "contrib", label: "期間投入", value: a.contributionsTwd },
    ...(a.scopeContributionTwd !== 0 ? [{ key: "scope-in", label: "範圍加入", note: "帳戶納入組合", value: a.scopeContributionTwd }] : []),
    { key: "market", label: "市價效果", value: a.marketPriceEffectTwd },
    { key: "fx", label: "匯率效果", value: a.fxEffectTwd },
    { key: "income", label: "股息／利息", value: a.incomeTwd },
    { key: "withdraw", label: "期間提領", note: "含配息與利息轉出", value: -a.withdrawalsTwd },
    ...(a.scopeWithdrawalTwd !== 0 ? [{ key: "scope-out", label: "範圍移出", note: "帳戶移出組合", value: -a.scopeWithdrawalTwd }] : []),
    { key: "residual", label: "未解釋差額", value: a.residualTwd, alert: !a.reconciled },
  ];
  const rows: BridgeRow[] = [
    { key: "open", label: "期初淨值", note: openingDate, value: a.openingValueTwd, total: true },
    ...flows,
    { key: "end", label: "回放淨值", note: targetDate, value: a.endingValueTwd, total: true },
  ];
  const scale = Math.max(...flows.map((row) => Math.abs(row.value)), 1);
  return (
    <Panel
      className="mt-6"
      title="淨值變動拆解"
      sub={<Tag tone={a.reconciled ? "up" : "annot"}>{a.reconciled ? "對帳在容差內" : "有待解釋差額"}</Tag>}
      flush
    >
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,11rem)_minmax(0,1fr)_9.5rem] gap-x-5 border-b border-[var(--c-line-strong)] px-5 py-2 text-[length:var(--fs-micro)] font-medium tracking-[0.06em] text-[var(--c-muted)] sm:grid">
        <span>項目</span>
        <span className="flex justify-between">
          <span>減</span>
          <span>加</span>
        </span>
        <span className="text-right">金額</span>
      </div>
      <dl>
        {rows.map((row) => {
          const width = row.total ? 0 : (Math.abs(row.value) / scale) * 50;
          const negative = row.value < 0;
          return (
            <div
              key={row.key}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1.5 px-5 py-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_9.5rem] ${
                row.key === "end" ? "border-t border-[var(--c-line-strong)]" : row.key === "open" ? "" : "border-t border-[var(--c-border-soft)]"
              }`}
            >
              <dt className="min-w-0">
                <span className={`text-[length:var(--fs-sm)] ${row.total ? "font-semibold" : ""}`}>{row.label}</span>
                {row.note && <span className="ml-2 text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum">{row.note}</span>}
                {row.alert && (
                  <span className="ml-2 text-[length:var(--fs-micro)] font-semibold text-[var(--c-annot-text)]">注意</span>
                )}
              </dt>
              <dd className={`amt text-right tnum sm:order-last ${row.total ? "text-[length:var(--fs-md)] font-semibold" : "text-[length:var(--fs-sm)]"} ${row.alert ? "text-[var(--c-annot-text)]" : ""}`}>
                {row.total ? `NT$ ${fmtFull(row.value)}` : <Signed value={row.value} />}
              </dd>
              {/* 中軸量尺：總額列只畫軸，不畫條 */}
              <div aria-hidden="true" className="relative col-span-2 h-2.5 sm:col-span-1">
                <span className="absolute inset-y-[-6px] left-1/2 w-px bg-[var(--c-line-strong)]" />
                {width > 0 && (
                  <span
                    className={`absolute inset-y-0 ${
                      row.alert
                        ? "border border-dashed border-[var(--c-annot)]"
                        : parcel
                          ? "border border-[var(--c-accent)]"
                          : "bg-[var(--c-accent)]"
                    } ${parcel ? "parcel-grow" : ""}`}
                    style={{
                      ...(negative ? { right: "50%", width: `${width}%` } : { left: "50%", width: `${Math.max(width, 0.4)}%` }),
                      ...(parcel && {
                        ...(row.alert ? {} : { background: PARCEL_HATCH }),
                        // 貼著中軸的那一側當原點，條才會從零往外長
                        transformOrigin: negative ? "right center" : "left center",
                      }),
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </dl>
      <p className="border-t border-[var(--c-border-soft)] px-5 py-3 text-[length:var(--fs-micro)] leading-5 text-[var(--c-faint)]">
        條長相對於最大的一項流量，不是淨值的絕對比例。已實現損益 <span className="amt tnum">{fmtSignedTwd(a.realizedPnlMemoTwd)}</span> 只作備忘，不重複加總；
        相對容差 <span className="amt tnum">NT$ {fmtNum(a.toleranceTwd, 2)}</span>（對帳規模的 0.1%）。
      </p>
    </Panel>
  );
}

// 帶正負號的金額。只有號與數字，顏色由呼叫端決定——歸因效果是拆解不是損益，不上漲跌色。
export function Signed({ value }: { value: number }) {
  return <>{fmtSignedTwd(value)}</>;
}
