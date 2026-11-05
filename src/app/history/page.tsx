import { AppHeader } from "@/components/AppHeader";
import { HistoryBridge, Signed } from "@/components/HistoryBridge";
import { PageHead, Panel, Stat, StatStrip, Tag } from "@/components/survey";
import { ASSET_CLASS_LABEL } from "@/lib/dashboard-data";
import {
  fetchAllPages,
  SUPABASE_PAGE_SIZE,
} from "@/lib/supabase/paginate";
import { todayTaipei } from "@/lib/dates";
import { fmtFull, fmtNum } from "@/lib/format";
import {
  attributePortfolioPeriod,
  buildScopeAdjustments,
  replayPortfolioAsOf,
  type AccountStatusEvent,
  type ReplayAccount,
  type ReplaySnapshot,
  type ReplayTransaction,
} from "@/lib/history-replay";
import { getUnreadCount } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

const SNAPSHOT_LIMIT = 10_000;
const STATUS_LIMIT = 5_000;
const TRANSACTION_LIMIT = 5_000;

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

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; date?: string }>;
}) {
  const query = await searchParams;
  const today = todayTaipei();
  const endDate = validDate(query.date) && query.date! <= today ? query.date! : today;
  const monthStart = `${endDate.slice(0, 7)}-01`;
  const requestedStart = validDate(query.from) ? query.from! : monthStart;
  const startDate = requestedStart < endDate ? requestedStart : previousDate(endDate);

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
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("accounts")
      .select("id,name,asset_class,symbol,price_market,created_at")
      .lte("created_at", `${endDate}T23:59:59+08:00`)
      .order("created_at", { ascending: true }),
    // 逐頁取：PostgREST 的 max-rows（Supabase 預設 1000）是硬上限，
    // `.limit(10_000)` 只會拿到 1000 列。原本靠 `length >= LIMIT` 判斷截斷，
    // 在硬上限之下永遠不成立——歷史重播少了一半資料也不會有任何提示。
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("account_snapshots")
        .select(
          "account_id,snapshot_date,quantity,unit_price,fx_rate,value_base,cost_basis_twd,cost_basis_native,realized_pnl_twd,account_status",
        )
        .lte("snapshot_date", endDate)
        // 由新到舊：撞到筆數上限時被砍的是最舊那段（缺口訊息也這樣寫），
        // 期末重播要用的最新資料一定拿得到。下游重播函式都自己排序，不依賴這裡的順序。
        .order("snapshot_date", { ascending: false })
        .order("account_id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }, SUPABASE_PAGE_SIZE, SNAPSHOT_LIMIT),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("account_status_history")
        .select("account_id,status,effective_at,source")
        .lte("effective_at", `${endDate}T23:59:59+08:00`)
        // 由新到舊：撞到筆數上限時被砍的是最舊那段（缺口訊息也這樣寫），
        // 期末重播要用的最新資料一定拿得到。下游重播函式都自己排序，不依賴這裡的順序。
        .order("effective_at", { ascending: false })
        .order("account_id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }, SUPABASE_PAGE_SIZE, STATUS_LIMIT),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("transactions")
        .select("account_id,type,cashflow_twd,realized_pnl,created_at")
        .gt("created_at", `${startDate}T23:59:59+08:00`)
        .lte("created_at", `${endDate}T23:59:59+08:00`)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }, SUPABASE_PAGE_SIZE, TRANSACTION_LIMIT),
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
  const queryTruncated =
    snapshotTruncated || statusTruncated || transactionTruncated;

  const opening = replayPortfolioAsOf({
    targetDate: startDate,
    accounts,
    snapshots,
    statusEvents,
    sourceTruncated: snapshotTruncated || statusTruncated,
  });
  const ending = replayPortfolioAsOf({
    targetDate: endDate,
    accounts,
    snapshots,
    statusEvents,
    sourceTruncated: snapshotTruncated || statusTruncated,
  });
  const scopeAdjustments = buildScopeAdjustments({
    fromExclusive: startDate,
    toInclusive: endDate,
    snapshots,
    statusEvents,
  });
  const attribution = attributePortfolioPeriod({
    opening,
    ending,
    snapshots,
    transactions,
    scopeContributionTwd: scopeAdjustments.contributionTwd,
    scopeWithdrawalTwd: scopeAdjustments.withdrawalTwd,
    scopeGaps: scopeAdjustments.gaps,
  });
  if (queryTruncated && !attribution.gaps.includes("交易或歷程查詢已達筆數上限")) {
    attribution.gaps.push("交易或歷程查詢已達筆數上限");
  }

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="history" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1080px] px-4 pb-28 pt-8 sm:px-6 lg:px-7">
        <PageHead
          label={
            <>
              回放區間 <span className="tnum">{startDate} → {endDate}</span>
            </>
          }
          title="歷史回放"
          sub="只使用指定日期以前已存在的快照；缺資料時保留缺口，不借用今天價格。"
          action={
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <DateInput name="from" label="期初日（不含）" value={startDate} max={previousDate(endDate)} />
              <DateInput name="date" label="回放日" value={endDate} max={today} />
              <button type="submit" className="btn btn-primary btn-fit h-11 sm:h-10">
                回放
              </button>
            </form>
          }
        />

        <StatStrip cols={4} className="mt-6">
          <Stat label="期初淨值" mask value={`NT$ ${fmtFull(opening.totalValueTwd)}`} sub={<span className="tnum">{startDate}</span>} />
          <Stat label="回放淨值" mask value={`NT$ ${fmtFull(ending.totalValueTwd)}`} sub={<span className="tnum">{endDate}</span>} />
          <Stat label="期間投入" mask value={<Signed value={attribution.contributionsTwd} />} />
          <Stat label="期間提領" mask value={<Signed value={-attribution.withdrawalsTwd} />} sub="含配息與利息轉出" />
        </StatStrip>

        <HistoryBridge attribution={attribution} openingDate={startDate} targetDate={endDate} />

        <Panel
          className="mt-6"
          title={
            <>
              <span className="tnum">{endDate}</span> 持倉
            </>
          }
          sub={
            <>
              <span className="tnum">{ending.holdings.length}</span> 個回放帳戶 · 依當日 TWD 估值排序
            </>
          }
          flush
        >
          {ending.holdings.length === 0 ? (
            <p className="px-5 py-10 text-center text-[length:var(--fs-sm)] text-[var(--c-muted)]">該日期沒有可回放的持倉。</p>
          ) : (
            <>
              <p className="scroll-cue px-5 pt-2">左右滑動查看完整欄位</p>
              <div className="scroll-region overflow-x-auto" tabIndex={0} aria-label="歷史持倉表，可水平捲動">
                <table className="w-full min-w-[720px] text-left text-[length:var(--fs-sm)]">
                  <thead className="border-b border-[var(--c-line-strong)] text-[length:var(--fs-micro)] tracking-[0.06em] text-[var(--c-muted)]">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">帳戶</th>
                      <th className="px-3 py-2.5 font-semibold">類別</th>
                      <th className="px-3 py-2.5 text-right font-semibold">數量</th>
                      <th className="px-3 py-2.5 text-right font-semibold">單價</th>
                      <th className="px-3 py-2.5 text-right font-semibold">匯率</th>
                      <th className="px-5 py-2.5 text-right font-semibold">TWD 估值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ending.holdings.map((holding) => (
                      <tr key={holding.accountId} className="border-t border-[var(--c-border-soft)] first:border-t-0">
                        <td className="px-5 py-3">
                          <div className="font-medium">
                            {holding.name}
                            {holding.symbol && <span className="ml-1.5 text-[var(--c-faint)] tnum">{holding.symbol}</span>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-micro)] text-[var(--c-faint)]">
                            <span>
                              快照 <span className="tnum">{holding.snapshotDate}</span>
                            </span>
                            {holding.carriedForward && <Tag>沿用前一筆快照</Tag>}
                            {!holding.statusKnown && <Tag tone="annot">狀態歷程不完整</Tag>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[var(--c-muted)]">{ASSET_CLASS_LABEL[holding.assetClass] ?? holding.assetClass}</td>
                        <td className="amt px-3 py-3 text-right tnum">{fmtNum(holding.quantity, 8)}</td>
                        <td className="px-3 py-3 text-right tnum">{fmtNum(holding.unitPrice, 4)}</td>
                        <td className="px-3 py-3 text-right tnum">{fmtNum(holding.fxRate, 4)}</td>
                        <td className="amt px-5 py-3 text-right font-semibold tnum">NT$ {fmtFull(holding.valueTwd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>

        {attribution.gaps.length > 0 && (
          // 資料缺口是「請注意」的註記，不是虧損：朱砂虛線框＋「注意」字樣，不用跌色
          <section className="mt-6 border border-dashed border-[var(--c-annot)] bg-[var(--c-surface)] px-5 py-4">
            <h2 className="flex items-center gap-2 text-[length:var(--fs-sm)] font-semibold">
              <span className="text-[var(--c-annot-text)]">注意</span>
              資料缺口與限制
            </h2>
            <ul className="mt-2 space-y-1.5 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
              {attribution.gaps.map((gap) => (
                <li key={gap} className="border-l border-dashed border-[var(--c-annot)] pl-2">
                  {gap}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function DateInput({ name, label, value, max }: { name: string; label: string; value: string; max: string }) {
  return (
    <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
      {label}
      <input type="date" name={name} defaultValue={value} max={max} className="field h-11 w-auto py-0 tnum sm:h-10" />
    </label>
  );
}

function validDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) === value;
}

function previousDate(value: string): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function nullableNumber(value: number | null): number | null {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}
