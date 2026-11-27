import Link from "next/link";
import { DemoV1Header } from "@/components/DemoV1Header";
import { HistoryBridge, Signed } from "@/components/HistoryBridge";
import { PageHead, Panel, Stat, StatStrip } from "@/components/survey";
import { todayTaipei } from "@/lib/dates";
import { DEMO_EPOCH } from "@/lib/demo-data";
import { demoMetadata } from "@/lib/demo-metadata";
import { buildDemoV1Data } from "@/lib/demo-v1-data";
import { fmtFull } from "@/lib/format";
import {
  attributePortfolioPeriod,
  buildScopeAdjustments,
  replayPortfolioAsOf,
} from "@/lib/history-replay";
import { getMonthBounds } from "@/lib/monthly-report";

export const metadata = demoMetadata("歷史回放", "歷史回放示範：任選期初與回放日，把淨值變動拆成投入、市價、匯率與配息。");

// Demo 資料從 DEMO_EPOCH 開始，期初日（不含）最早只能是它的前一天，那天淨值為 0
const FIRST_OPENING = shiftDays(DEMO_EPOCH, -1);

export default async function DemoHistoryPage({ searchParams }: { searchParams: Promise<{ from?: string; date?: string }> }) {
  const { from, date } = await searchParams;
  const today = todayTaipei();
  const targetDate = date && validDate(date) && date >= DEMO_EPOCH && date <= today ? date : today;
  // 與正式版 /history 相同：沒指定期初日就回放當月，期初日不得晚於回放日前一天
  const requestedStart = from && validDate(from) && from >= FIRST_OPENING ? from : getMonthBounds(targetDate.slice(0, 7))!.openingDate;
  const openingDate = requestedStart < targetDate ? requestedStart : shiftDays(targetDate, -1);
  const data = buildDemoV1Data(today);
  const opening = replayPortfolioAsOf({ targetDate: openingDate, accounts: data.accounts, snapshots: data.snapshots, statusEvents: data.statusEvents });
  const ending = replayPortfolioAsOf({ targetDate: targetDate, accounts: data.accounts, snapshots: data.snapshots, statusEvents: data.statusEvents });
  const scope = buildScopeAdjustments({ fromExclusive: openingDate, toInclusive: targetDate, snapshots: data.snapshots, statusEvents: data.statusEvents });
  const attribution = attributePortfolioPeriod({ opening, ending, snapshots: data.snapshots, transactions: data.transactions, scopeContributionTwd: scope.contributionTwd, scopeWithdrawalTwd: scope.withdrawalTwd, scopeGaps: scope.gaps });
  const presets = rangePresets(today);
  const openingValueOf = new Map(opening.holdings.map((holding) => [holding.accountId, holding.valueTwd]));
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <DemoV1Header active="history" />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-7 lg:pt-8">
        <PageHead
          label={`回放區間 ${openingDate} → ${targetDate}`}
          title="歷史回放"
          sub="日期改變只會選用該日以前的固定快照。"
          action={
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <DateInput name="from" label="期初日（不含）" value={openingDate} min={FIRST_OPENING} max={shiftDays(targetDate, -1)} />
              <DateInput name="date" label="回放日" value={targetDate} min={DEMO_EPOCH} max={today} />
              <button className="h-11 btn btn-primary btn-fit sm:h-10">回放</button>
            </form>
          }
        />
        {/* 區間捷徑：跟總覽淨值圖的區間列同一種分段尺，連到同一頁帶 from／date，
            沒有 client 狀態。選中的樣式對應 dashboard/shared.tsx 的 PICK_ON／PICK_OFF
            （那支是 client 模組，server component 不能直接拿它的字串常數）。 */}
        <nav aria-label="回放區間捷徑" className="hide-scrollbar mt-5 overflow-x-auto">
          <div className="inline-flex divide-x divide-[var(--c-border)] border border-[var(--c-line-strong)]">
            {presets.map((preset) => {
              const on = preset.from === openingDate && targetDate === today;
              return (
                <Link
                  key={preset.label}
                  href={`/demo/history?from=${preset.from}&date=${today}`}
                  aria-current={on ? "true" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center px-3 text-[length:var(--fs-micro)] ${
                    on
                      ? "bg-[var(--c-surface-soft)] font-medium text-[var(--c-accent)]"
                      : "font-medium text-[var(--c-muted)] hover:bg-[var(--c-surface-soft)] hover:text-[var(--c-text)]"
                  }`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <StatStrip cols={4} className="mt-6">
          <Stat label="期初淨值" mask value={`NT$ ${fmtFull(opening.totalValueTwd)}`} sub={<span className="tnum">{openingDate}</span>} />
          <Stat label="回放淨值" mask value={`NT$ ${fmtFull(ending.totalValueTwd)}`} sub={<span className="tnum">{targetDate}</span>} />
          <Stat label="市價效果" mask value={<Signed value={attribution.marketPriceEffectTwd} />} />
          <Stat label="匯率效果" mask value={<Signed value={attribution.fxEffectTwd} />} />
        </StatStrip>
        <HistoryBridge attribution={attribution} openingDate={openingDate} targetDate={targetDate} parcel />
        <Panel className="survey-frame mt-6" title="回放日持倉" sub="條長＝回放日佔比，刻度＝期初佔比" flush>
          {/* 寬螢幕攤成帳本：期初與回放兩欄並排，才能直接橫向比對每個帳戶這段期間的變化。
              窄螢幕收回兩行，期初降成小字附註。欄寬與上方拆解帳的「金額」欄同為 9.5rem。 */}
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_7rem_9.5rem_9.5rem_minmax(0,13rem)] gap-x-5 border-b border-[var(--c-line-strong)] px-5 py-2 text-[length:var(--fs-micro)] font-medium tracking-[0.06em] text-[var(--c-muted)] lg:grid">
            <span>帳戶</span>
            <span>快照日</span>
            <span className="text-right">期初</span>
            <span className="text-right">回放</span>
            <span className="text-right">佔比</span>
          </div>
          {ending.holdings.map((holding, index) => {
            const pct = ending.totalValueTwd > 0 ? (holding.valueTwd / ending.totalValueTwd) * 100 : 0;
            const openingValue = openingValueOf.get(holding.accountId);
            const openingPct = openingValue != null && opening.totalValueTwd > 0 ? (openingValue / opening.totalValueTwd) * 100 : null;
            return (
              <div key={holding.accountId} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_7.5rem] lg:grid-cols-[minmax(0,1fr)_7rem_9.5rem_9.5rem_minmax(0,13rem)] lg:gap-x-5 ${index > 0 ? "border-t border-[var(--c-border-soft)]" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate text-[length:var(--fs-sm)] font-medium">
                    {holding.name}
                    {holding.symbol && <span className="ml-1.5 text-[var(--c-faint)] tnum">{holding.symbol}</span>}
                  </div>
                  <div className="mt-0.5 text-[length:var(--fs-micro)] text-[var(--c-faint)] lg:hidden">
                    快照 <span className="tnum">{holding.snapshotDate}</span>
                    {holding.carriedForward && " · 沿用前一筆快照"}
                    {openingValue != null && (
                      <>
                        {" · 期初 "}
                        <span className="amt tnum">NT$ {fmtFull(openingValue)}</span>
                      </>
                    )}
                  </div>
                  {holding.carriedForward && <div className="mt-0.5 hidden text-[length:var(--fs-micro)] text-[var(--c-faint)] lg:block">沿用前一筆快照</div>}
                </div>
                <div className="hidden text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum lg:block">{holding.snapshotDate}</div>
                <div className="amt hidden text-right text-[length:var(--fs-sm)] text-[var(--c-muted)] tnum lg:block">
                  {openingValue != null ? `NT$ ${fmtFull(openingValue)}` : "—"}
                </div>
                <div className="amt text-right text-[length:var(--fs-md)] font-semibold tnum">NT$ {fmtFull(holding.valueTwd)}</div>
                {/* 配置量尺：跟首頁持倉帳本同一個讀法，細軌上一段實線長度＝佔比。
                    直立刻度標期初佔比，實線超過或沒到刻度就是這段期間的配置漂移。 */}
                <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  <span aria-hidden="true" className="relative h-[3px] flex-1 bg-[var(--c-border-soft)]">
                    <span className="absolute inset-y-0 left-0 bg-[var(--c-accent)]" style={{ width: `${Math.min(pct, 100)}%` }} />
                    {openingPct != null && <span className="absolute -top-[3px] h-[9px] w-px bg-[var(--c-text)]" style={{ left: `${Math.min(openingPct, 100)}%` }} />}
                  </span>
                  <span className="w-12 text-right text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">{pct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </Panel>
        {attribution.gaps.length > 0 && <p className="mt-4 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">資料說明：{attribution.gaps.join("；")}</p>}
      </main>
    </div>
  );
}

function DateInput({ name, label, value, min, max }: { name: string; label: string; value: string; min: string; max: string }) {
  return (
    <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
      {label}
      <input type="date" name={name} defaultValue={value} min={min} max={max} className="field h-11 w-auto py-0 tnum sm:h-10" />
    </label>
  );
}

/** 期初日（不含）＝區間起點的前一天，跟 getMonthBounds 的 openingDate 同一個口徑 */
function rangePresets(today: string): { label: string; from: string }[] {
  const year = Number(today.slice(0, 4));
  const yearAgo = `${year - 1}${today.slice(4)}`.replace("-02-29", "-02-28");
  const atLeastFirst = (value: string) => (value < FIRST_OPENING ? FIRST_OPENING : value);
  return [
    { label: "本月", from: getMonthBounds(today.slice(0, 7))!.openingDate },
    { label: "今年", from: atLeastFirst(`${year - 1}-12-31`) },
    { label: "近一年", from: atLeastFirst(yearAgo) },
    { label: "成立以來", from: FIRST_OPENING },
  ];
}

function shiftDays(value: string, days: number): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) === value;
}
