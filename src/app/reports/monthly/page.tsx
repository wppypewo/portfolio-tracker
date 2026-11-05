import { AppHeader } from "@/components/AppHeader";
import { PageHead, Panel, Stat, StatStrip, SurveyLabel, Tag } from "@/components/survey";
import { ASSET_CLASS_LABEL } from "@/lib/dashboard-data";
import { todayTaipei } from "@/lib/dates";
import { fmtFull, fmtNum } from "@/lib/format";
import type {
  AccountStatusEvent,
  ReplayAccount,
  ReplaySnapshot,
  ReplayTransaction,
} from "@/lib/history-replay";
import {
  buildMonthlyReport,
  getMonthBounds,
} from "@/lib/monthly-report";
import { getUnreadCount } from "@/lib/notifications";
import {
  fetchAllPages,
  SUPABASE_PAGE_SIZE,
} from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { PrintReportButton } from "./PrintReportButton";

const LIMIT = 10_000;

type AccountRow = {
  id: string;
  name: string;
  asset_class: string;
  symbol: string | null;
  price_market: string;
  created_at: string;
};

type SnapshotRow = {
  account_id: string;
  snapshot_date: string;
  quantity: number;
  unit_price: number | null;
  fx_rate: number | null;
  value_base: number;
  cost_basis_twd: number | null;
  cost_basis_native: number | null;
  realized_pnl_twd: number | null;
  account_status: "active" | "archived" | null;
};

type StatusRow = {
  account_id: string;
  status: "active" | "archived";
  effective_at: string;
  source: "account_create" | "account_update" | "migration_baseline";
};

type TransactionRow = {
  account_id: string;
  type: string;
  cashflow_twd: number | null;
  realized_pnl: number | null;
  created_at: string;
};

type DecisionSummary = {
  id: string;
  asset_name: string;
  decision_type: string;
  decision_date?: string;
  review_date?: string;
};

type ReviewSummary = {
  reviewed_at: string;
  decision_quality: number;
  reflection: string;
  investment_decisions: { asset_name: string } | null;
};

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const today = todayTaipei();
  const currentMonth = today.slice(0, 7);
  let bounds = getMonthBounds(month ?? currentMonth);
  if (!bounds || bounds.startDate > today) bounds = getMonthBounds(currentMonth)!;
  if (bounds.month === currentMonth) bounds = { ...bounds, endDate: today };

  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data: accountData },
    { data: snapshotData, truncated: snapshotTruncated },
    { data: statusData, truncated: statusTruncated },
    { data: transactionData, truncated: transactionTruncated },
    { data: newDecisionData },
    { data: dueDecisionData },
    { data: reviewData },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("accounts")
      .select("id,name,asset_class,symbol,price_market,created_at")
      .lte("created_at", `${bounds.endDate}T23:59:59+08:00`)
      .order("created_at", { ascending: true }),
    // 逐頁取：`.limit(10_000)` 會被 PostgREST 的 max-rows（預設 1000）壓回去，
    // 而原本的截斷判定 `length >= LIMIT` 在硬上限之下永遠不成立——
    // 月報少算了幾個月的快照也不會標示「資料不完整」。
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("account_snapshots")
        .select("account_id,snapshot_date,quantity,unit_price,fx_rate,value_base,cost_basis_twd,cost_basis_native,realized_pnl_twd,account_status")
        .lte("snapshot_date", bounds.endDate)
        // 由新到舊：撞到筆數上限時被砍的是最舊那段（缺口訊息也這樣寫），
        // 期末重播要用的最新資料一定拿得到。下游重播函式都自己排序，不依賴這裡的順序。
        .order("snapshot_date", { ascending: false })
        .order("account_id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }, SUPABASE_PAGE_SIZE, LIMIT),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("account_status_history")
        .select("account_id,status,effective_at,source")
        .lte("effective_at", `${bounds.endDate}T23:59:59+08:00`)
        // 由新到舊：撞到筆數上限時被砍的是最舊那段（缺口訊息也這樣寫），
        // 期末重播要用的最新資料一定拿得到。下游重播函式都自己排序，不依賴這裡的順序。
        .order("effective_at", { ascending: false })
        .order("account_id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }, SUPABASE_PAGE_SIZE, LIMIT),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("transactions")
        .select("account_id,type,cashflow_twd,realized_pnl,created_at")
        .gt("created_at", `${bounds.openingDate}T23:59:59+08:00`)
        .lte("created_at", `${bounds.endDate}T23:59:59+08:00`)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }, SUPABASE_PAGE_SIZE, LIMIT),
    supabase
      .from("investment_decisions")
      .select("id,asset_name,decision_type,decision_date")
      .gte("decision_date", bounds.startDate)
      .lte("decision_date", bounds.endDate)
      .order("decision_date", { ascending: true }),
    supabase
      .from("investment_decisions")
      .select("id,asset_name,decision_type,review_date")
      .eq("status", "open")
      .gte("review_date", bounds.startDate)
      .lte("review_date", bounds.endDate)
      .order("review_date", { ascending: true }),
    supabase
      .from("decision_reviews")
      .select("reviewed_at,decision_quality,reflection,investment_decisions(asset_name)")
      .gte("reviewed_at", `${bounds.startDate}T00:00:00+08:00`)
      .lte("reviewed_at", `${bounds.endDate}T23:59:59+08:00`)
      .order("reviewed_at", { ascending: true }),
  ]);

  const accounts = ((accountData ?? []) as AccountRow[]).map<ReplayAccount>((account) => ({
    id: account.id,
    name: account.name,
    assetClass: account.asset_class,
    symbol: account.symbol,
    priceMarket: account.price_market,
    createdAt: account.created_at,
  }));
  const snapshots = ((snapshotData ?? []) as SnapshotRow[]).map<ReplaySnapshot>((snapshot) => ({
    accountId: snapshot.account_id,
    date: snapshot.snapshot_date,
    quantity: Number(snapshot.quantity),
    unitPrice: nullableNumber(snapshot.unit_price),
    fxRate: nullableNumber(snapshot.fx_rate),
    valueBase: Number(snapshot.value_base),
    costBasisTwd: nullableNumber(snapshot.cost_basis_twd),
    costBasisNative: nullableNumber(snapshot.cost_basis_native),
    realizedPnlTwd: nullableNumber(snapshot.realized_pnl_twd),
    accountStatus: snapshot.account_status,
  }));
  const statusEvents = ((statusData ?? []) as StatusRow[]).map<AccountStatusEvent>((event) => ({
    accountId: event.account_id,
    status: event.status,
    effectiveAt: event.effective_at,
    source: event.source,
  }));
  const transactions = ((transactionData ?? []) as TransactionRow[]).map<ReplayTransaction>((transaction) => ({
    accountId: transaction.account_id,
    type: transaction.type,
    cashflowTwd: nullableNumber(transaction.cashflow_twd),
    realizedPnlTwd: nullableNumber(transaction.realized_pnl),
    createdAt: transaction.created_at,
  }));
  const sourceTruncated =
    snapshotTruncated || statusTruncated || transactionTruncated;
  const report = buildMonthlyReport({
    bounds,
    accounts,
    snapshots,
    statusEvents,
    transactions,
    sourceTruncated,
  });
  if (sourceTruncated) report.dataGaps.push("資料查詢已達 10,000 筆上限");

  const newDecisions = (newDecisionData ?? []) as DecisionSummary[];
  const dueDecisions = (dueDecisionData ?? []) as DecisionSummary[];
  const reviews = (reviewData ?? []) as unknown as ReviewSummary[];
  const generatedAt = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  });

  return (
    <div className="report-shell min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="reports" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="report-page mx-auto max-w-[1040px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-7">
        <PageHead
          className="report-block"
          label="月度報告"
          title={`${bounds.month} 月度投資報告`}
          sub={
            <>
              資料區間 <span className="tnum">{bounds.startDate}</span> 至 <span className="tnum">{bounds.endDate}</span>
              {" · "}產生時間 <span className="tnum">{generatedAt}</span>（Asia/Taipei）
            </>
          }
          action={
            <div className="flex items-end gap-2">
              <form method="GET" className="no-print flex items-end gap-2">
                <label className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">
                  報告月份
                  <input type="month" name="month" defaultValue={bounds.month} max={currentMonth} className="mt-1 block h-10 border border-[var(--c-line-strong)] px-3 text-[length:var(--fs-sm)] tnum" />
                </label>
                <button type="submit" className="btn btn-outline h-10">產生</button>
              </form>
              <PrintReportButton />
            </div>
          }
        />

        {/* 格子各自帶 report-card：列印時整段不被分頁切開，底色也會被列印樣式換成白 */}
        <StatStrip cols={5} className="mt-6">
          <Stat className="report-card" label="期初淨值" mask value={`NT$ ${fmtFull(report.opening.totalValueTwd)}`} />
          <Stat className="report-card" label="期末淨值" mask value={`NT$ ${fmtFull(report.ending.totalValueTwd)}`} />
          <Stat className="report-card" label="淨投入" mask value={`${report.netContributionTwd > 0 ? "+" : ""}NT$ ${fmtFull(report.netContributionTwd)}`} />
          <Stat className="report-card" label="當月 TWR" value={formatPercent(report.twr)} />
          <Stat className="report-card col-span-2 sm:col-span-1" label="XIRR 年化" value={formatPercent(report.xirrAnnualized)} />
        </StatStrip>

        <Panel className="report-block mt-6" title="報酬歸因" sub="扣除資金進出後的淨值變動；前三項解釋不到的部分列為未解釋">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <ReportMetric label="市價效果" value={report.attribution.marketPriceEffectTwd} />
            <ReportMetric label="匯率效果" value={report.attribution.fxEffectTwd} />
            <ReportMetric label="股息與利息" value={report.attribution.incomeTwd} />
            <ReportMetric label="未解釋差額" value={report.attribution.residualTwd} note={report.attribution.reconciled ? undefined : "超出容差"} />
          </dl>
          <p className="mt-4 border-t border-[var(--c-border-soft)] pt-3 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
            對帳狀態：{report.attribution.reconciled ? "相對容差內" : "超出相對容差"} · 容差 <span className="amt tnum">NT$ {fmtNum(report.attribution.toleranceTwd, 2)}</span> · 已實現損益 <span className="amt tnum">NT$ {fmtFull(report.attribution.realizedPnlMemoTwd)}</span>
          </p>
        </Panel>

        <div className="report-block mt-6 grid gap-6 lg:grid-cols-2">
          <Panel title="資產配置變化" flush>
            <table className="w-full text-[length:var(--fs-sm)]">
              <thead className="border-b border-[var(--c-line-strong)] text-left text-[length:var(--fs-micro)] tracking-[0.06em] text-[var(--c-muted)]">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-semibold">類別</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">期初</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">期末</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">變動</th>
                </tr>
              </thead>
              <tbody>
                {allocationRows(report.openingAllocation, report.endingAllocation).map((row) => (
                  <tr key={row.key} className="border-t border-[var(--c-border-soft)] first:border-t-0">
                    <th scope="row" className="px-5 py-2.5 text-left font-medium">{ASSET_CLASS_LABEL[row.key] ?? row.key}</th>
                    <td className="px-3 py-2.5 text-right tnum text-[var(--c-muted)]">{fmtNum(row.opening, 2)}%</td>
                    <td className="px-3 py-2.5 text-right tnum">{fmtNum(row.ending, 2)}%</td>
                    <td className="px-5 py-2.5 text-right tnum">{row.change > 0 ? "+" : ""}{fmtNum(row.change, 2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="風險與來源">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <TextMetric label="最大回撤" value={report.maxDrawdown ? `${(report.maxDrawdown.pct * 100).toFixed(2)}%` : "資料不足"} />
              <TextMetric label="最高單一持倉" value={`${fmtNum(report.topConcentrationPct, 2)}%`} />
              <TextMetric label="最大上漲來源" value={sourceText(report.largestPositiveSource)} mask />
              <TextMetric label="最大下跌來源" value={sourceText(report.largestNegativeSource)} mask />
            </dl>
          </Panel>
        </div>

        <Panel className="report-block mt-6" title="投資決策">
          <div className="grid gap-5 md:grid-cols-3">
            <DecisionList title="本月新增" rows={newDecisions.map((decision) => ({ id: decision.id, text: `${decision.decision_date} · ${decision.asset_name}` }))} />
            <DecisionList title="本月到期未檢討" rows={dueDecisions.map((decision) => ({ id: decision.id, text: `${decision.review_date} · ${decision.asset_name}` }))} />
            <DecisionList title="本月完成檢討" rows={reviews.map((review) => ({ id: `${review.reviewed_at}-${review.investment_decisions?.asset_name ?? "deleted"}`, text: `${review.investment_decisions?.asset_name ?? "已刪除決策"} · 品質 ${review.decision_quality}/3 · ${review.reflection}` }))} />
          </div>
        </Panel>

        <Panel className="report-block mt-6" title="資料健康狀態">
          <div className="flex flex-wrap items-center gap-3 text-[length:var(--fs-sm)]">
            {/* 缺口不是虧損，用朱砂註記而不是跌色 */}
            <Tag tone={report.dataGaps.length === 0 ? "up" : "annot"}>
              {report.dataGaps.length === 0 ? "未發現缺口" : `${report.dataGaps.length} 項缺口`}
            </Tag>
            <span className="text-[var(--c-muted)]">
              期末持倉 <span className="tnum">{report.ending.holdings.length}</span> · 快照資料 <span className="tnum">{snapshots.length}</span> 筆
            </span>
          </div>
          {report.dataGaps.length > 0 && <ul className="mt-3 list-[square] space-y-1.5 pl-5 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">{report.dataGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}
        </Panel>

        <footer className="report-block mt-7 border-t border-[var(--c-border)] pt-4 text-[length:var(--fs-micro)] leading-5 text-[var(--c-faint)]">
          本報告依 StackWorth 中已記錄的帳戶、交易與快照計算，可能受缺失價格、缺失現金流、報價延遲與歷史欄位不足影響。內容僅供個人紀錄與檢討，不構成投資、稅務或法律建議。過去績效不代表未來結果。
        </footer>
      </main>
    </div>
  );
}

// 歸因只是拆解，不是損益，所以不上漲跌色、只帶號（與 /demo/report 同一規則）。
// 超出對帳容差時加朱砂註記：虛線引線＋文字，不單靠顏色。
function ReportMetric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-2">
        <SurveyLabel className="shrink-0">{label}</SurveyLabel>
        {note && <span aria-hidden="true" className="h-0 min-w-3 flex-1 border-t border-dashed border-[var(--c-annot)]" />}
      </dt>
      <dd className="amt mt-1.5 text-[length:var(--fs-md)] font-semibold tnum">
        {value > 0 ? "+" : value < 0 ? "−" : ""}NT$ {fmtFull(Math.abs(value))}
      </dd>
      {note && <dd className="mt-1 text-[length:var(--fs-micro)] font-semibold text-[var(--c-annot-text)]">{note}</dd>}
    </div>
  );
}

function TextMetric({ label, value, mask = false }: { label: string; value: string; mask?: boolean }) {
  return (
    <div>
      <dt><SurveyLabel>{label}</SurveyLabel></dt>
      <dd className={`mt-1.5 text-[length:var(--fs-sm)] font-semibold tnum ${mask ? "amt" : ""}`}>{value}</dd>
    </div>
  );
}

function DecisionList({ title, rows }: { title: string; rows: { id: string; text: string }[] }) {
  return (
    <div>
      <h3 className="flex items-baseline justify-between gap-2 border-b border-[var(--c-border-soft)] pb-1.5">
        <SurveyLabel>{title}</SurveyLabel>
        <span className="text-[length:var(--fs-md)] font-semibold tnum">{rows.length}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[length:var(--fs-micro)] text-[var(--c-faint)]">無紀錄</p>
      ) : (
        <ul className="mt-2 space-y-2 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
          {rows.map((row) => <li key={row.id} className="line-clamp-3">{row.text}</li>)}
        </ul>
      )}
    </div>
  );
}

function allocationRows(opening: Record<string, number>, ending: Record<string, number>) {
  return [...new Set([...Object.keys(opening), ...Object.keys(ending)])].sort().map((key) => ({ key, opening: opening[key] ?? 0, ending: ending[key] ?? 0, change: (ending[key] ?? 0) - (opening[key] ?? 0) }));
}

function sourceText(source: { name: string; impactTwd: number } | null): string {
  return source ? `${source.name} · ${source.impactTwd > 0 ? "+" : ""}NT$ ${fmtFull(source.impactTwd)}` : "無可辨識來源";
}

function formatPercent(value: number | null): string {
  return value == null ? "資料不足" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function nullableNumber(value: number | null): number | null {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}
