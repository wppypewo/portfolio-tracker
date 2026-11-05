import {
  type DashboardData,
  type Holding,
  type AllocTarget,
} from "@/components/dashboard/DashboardClient";
import type {
  AllocDatum,
  BenchSeries,
  PerfPoint,
} from "@/components/dashboard/DashboardCharts";
import { computeXirr } from "@/lib/xirr";
import {
  buildTwrSeries,
  computeMaxDrawdown,
  computeSharpe,
  computeTwr,
  forwardFillBenchmarks,
} from "@/lib/metrics";
import { todayTaipei } from "@/lib/dates";

export type AccountRow = {
  id: string;
  name: string;
  asset_class: string;
  price_market: string;
  symbol: string | null;
  quantity: number;
  native_currency: string;
  last_unit_price: number | null;
  last_fx_rate: number;
  manual_value_base: number | null;
  last_priced_at: string | null;
  cost_basis_twd: number;
  realized_pnl_twd: number;
  status: string;
};

export type CashflowRow = { created_at: string; cashflow_twd: number };
export type IncomeRow = {
  created_at: string;
  type: string;
  cashflow_twd: number | null;
};
export type SnapshotRow = {
  account_id: string;
  snapshot_date: string;
  value_base: number;
};
export type DailyClose = { date: string; close: number };
export type FxRate = { date: string; rate: number };

export type DashboardInputs = {
  accounts: AccountRow[];
  includeArchivedHoldings: boolean;
  cfRows: CashflowRow[];
  incomeRows: IncomeRow[];
  allocationTargets: Record<string, number>;
  snapRows: SnapshotRow[];
  bench: {
    tw0050: DailyClose[];
    spy: DailyClose[];
    qqq: DailyClose[];
    btc: DailyClose[];
  };
  fxHistory: FxRate[];
  now?: Date;
  today?: string;
  benchNotice?: string | null;
};

export const ASSET_CLASS_LABEL: Record<string, string> = {
  liquid_cash: "流動資金",
  fund: "基金",
  stock: "股票",
  crypto: "加密貨幣",
  precious_metal: "貴金屬",
  other_investment: "其他投資",
  fixed_asset: "固定資產",
  receivable: "應收款",
  liability: "負債",
};

export const MARKET_LABEL: Record<string, string> = {
  us: "美股",
  tw: "台股",
  crypto: "加密貨幣",
  manual: "手動",
};

const MS_PER_DAY = 86_400_000;

function shiftCalendarDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function taipeiDate(value: string): string {
  return new Date(value).toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });
}

export function valueOf(a: AccountRow): number {
  if (a.price_market === "manual") return Number(a.manual_value_base ?? 0);
  const unit = Number(a.last_unit_price ?? 0);
  const fx = Number(a.last_fx_rate ?? 1);
  return Number(a.quantity) * unit * fx;
}

export function buildDashboardData(input: DashboardInputs): DashboardData {
  const {
    accounts,
    includeArchivedHoldings,
    cfRows,
    incomeRows,
    allocationTargets: targets,
    snapRows,
    bench,
    fxHistory,
  } = input;

  const today = input.today ?? todayTaipei();
  const now = input.now ?? new Date();
  const activeAccounts = accounts.filter((a) => a.status !== "archived");
  const activeAccountIds = new Set(activeAccounts.map((a) => a.id));
  const archivedCount = accounts.length - activeAccounts.length;
  const holdingAccounts = includeArchivedHoldings ? accounts : activeAccounts;

  // Hero、配置、收入與績效共用 active portfolio；封存切換只影響持倉列表。
  const total = activeAccounts.reduce((sum, a) => sum + valueOf(a), 0);
  const totalCost = activeAccounts.reduce(
    (sum, a) => sum + Number(a.cost_basis_twd ?? 0),
    0,
  );
  const totalRealized = activeAccounts.reduce(
    (sum, a) => sum + Number(a.realized_pnl_twd ?? 0),
    0,
  );
  const totalUnrealized = total - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalUnrealized / totalCost) * 100 : 0;

  // XIRR 的現金流與終值必須使用同一組 active 帳戶。
  const cashflows = cfRows
    .map((r) => ({
      amount: Number(r.cashflow_twd),
      when: new Date(r.created_at),
    }))
    .filter((c) => Number.isFinite(c.amount) && c.amount !== 0);
  if (total > 0) cashflows.push({ amount: total, when: now });
  const xirr = computeXirr(cashflows);
  const xirrSpanDays =
    cashflows.length > 1
      ? (now.getTime() - Math.min(...cashflows.map((c) => c.when.getTime()))) /
        MS_PER_DAY
      : 0;
  const xirrShowable = xirr !== null && xirrSpanDays >= 90;

  const incomeAll = incomeRows.filter((r) => Number(r.cashflow_twd ?? 0) > 0);
  const ytdStart = `${today.slice(0, 4)}-01-01`;
  const rolling12mStart = shiftCalendarDate(today, -365);
  let incomeYtd = 0;
  let incomeRolling12m = 0;
  let dividendAll = 0;
  let interestAll = 0;
  for (const r of incomeAll) {
    const date = taipeiDate(r.created_at);
    const amount = Number(r.cashflow_twd ?? 0);
    if (date >= ytdStart) incomeYtd += amount;
    if (date >= rolling12mStart) incomeRolling12m += amount;
    if (r.type === "dividend") dividendAll += amount;
    else if (r.type === "interest") interestAll += amount;
  }
  const monthlyAvg12m = incomeRolling12m / 12;
  const yieldOnCost = totalCost > 0 ? (incomeRolling12m / totalCost) * 100 : 0;
  const hasIncome = incomeAll.length > 0;
  const latestUpdate = activeAccounts
    .map((a) => a.last_priced_at)
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop();

  const byClass = new Map<string, number>();
  for (const account of activeAccounts) {
    byClass.set(
      account.asset_class,
      (byClass.get(account.asset_class) ?? 0) + valueOf(account),
    );
  }
  const allocation: AllocDatum[] = [...byClass.entries()]
    .filter(([, value]) => value > 0)
    .map(([cls, value]) => ({
      cls,
      label: ASSET_CLASS_LABEL[cls] ?? cls,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const classKeys = Array.from(
    new Set<string>([...byClass.keys(), ...Object.keys(targets)]),
  );
  const allocTargets: AllocTarget[] = classKeys
    .map((cls) => ({
      cls,
      label: ASSET_CLASS_LABEL[cls] ?? cls,
      actual: total > 0 ? ((byClass.get(cls) ?? 0) / total) * 100 : 0,
      target: Number(targets[cls] ?? 0),
    }))
    .sort((a, b) => b.actual + b.target - a.actual - a.target);

  const byAccount = new Map<string, { date: string; value: number }[]>();
  for (const snapshot of snapRows) {
    if (!activeAccountIds.has(snapshot.account_id)) continue;
    const value = Number(snapshot.value_base);
    const rows = byAccount.get(snapshot.account_id) ?? [];
    rows.push({ date: snapshot.snapshot_date, value });
    byAccount.set(snapshot.account_id, rows);
  }
  for (const rows of byAccount.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  // 各帳戶的快照日不一定相同：cron 只替有代號的非手動帳戶寫每日快照，
  // 手動帳戶只在建立或異動當天有一筆，報價失敗的帳戶那天也沒有。
  // 若直接按日相加，缺快照的帳戶那天等於 0，淨值曲線下陷，TWR、回撤、Sharpe 都把它當成虧損。
  // 與 history-replay 同一口徑：每個日期取各帳戶「當天或之前最近一筆」快照，帳戶第一筆快照之前不計入。
  const allDates = [...new Set(
    [...byAccount.values()].flatMap((rows) => rows.map((row) => row.date)),
  )].sort();
  const byDate = new Map<string, number>(allDates.map((date) => [date, 0]));
  for (const rows of byAccount.values()) {
    let index = 0;
    let carried: number | null = null;
    for (const date of allDates) {
      while (index < rows.length && rows[index].date <= date) {
        carried = rows[index].value;
        index++;
      }
      if (carried !== null) byDate.set(date, (byDate.get(date) ?? 0) + carried);
    }
  }
  const lineData = allDates.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
  const hasLine = lineData.length >= 2;

  const accountDay = new Map<string, number | null>();
  for (const [id, rows] of byAccount) {
    if (rows.length < 2) {
      accountDay.set(id, null);
      continue;
    }
    const previous = rows[rows.length - 2].value;
    const latest = rows[rows.length - 1].value;
    accountDay.set(id, previous > 0 ? (latest - previous) / previous : null);
  }

  let dayChange: number | null = null;
  let dayChangePct: number | null = null;
  if (hasLine) {
    const previous = lineData[lineData.length - 2].value;
    const latest = lineData[lineData.length - 1].value;
    dayChange = latest - previous;
    dayChangePct = previous > 0 ? ((latest - previous) / previous) * 100 : null;
  }

  const snapshotsForMetrics = lineData.map((point) => ({
    date: point.date,
    value: point.value,
  }));
  // TWR 使用正數投入、負數取出；XIRR 儲存口徑需在此翻轉一次。
  const cashflowsForMetrics = cfRows
    .filter((row) => Number(row.cashflow_twd) !== 0)
    .map((row) => ({
      date: taipeiDate(row.created_at),
      amount: -Number(row.cashflow_twd),
    }));
  const twrShowable = snapshotsForMetrics.length >= 30;
  const twrAnnShowable = snapshotsForMetrics.length >= 90;
  const twrResult = twrShowable
    ? computeTwr(snapshotsForMetrics, cashflowsForMetrics)
    : null;
  const twrIndexSeries = buildTwrSeries(
    snapshotsForMetrics,
    cashflowsForMetrics,
  );
  // 回撤必須從已排除入金與提領的 TWR 指數計算。
  const drawdown = twrShowable
    ? computeMaxDrawdown(
        twrIndexSeries.map((point) => ({
          date: point.date,
          value: point.index,
        })),
      )
    : null;
  const sharpe = twrShowable
    ? computeSharpe(snapshotsForMetrics, cashflowsForMetrics, 0.015)
    : null;

  const fxSorted = [...fxHistory].sort((a, b) => a.date.localeCompare(b.date));
  function fxAt(date: string): number | null {
    let latest: number | null = null;
    for (const row of fxSorted) {
      if (row.date <= date) latest = row.rate;
      else break;
    }
    return latest;
  }

  const perfMap = new Map<string, PerfPoint>();
  const twrByDate = new Map(twrIndexSeries.map((point) => [point.date, point.index]));
  for (const point of lineData) {
    const index = twrByDate.get(point.date);
    if (index !== undefined) {
      perfMap.set(point.date, { date: point.date, portfolio: index });
    }
  }
  for (const row of bench.tw0050) {
    const existing = perfMap.get(row.date) ?? { date: row.date };
    existing.tw0050 = Number(row.close);
    perfMap.set(row.date, existing);
  }
  for (const row of bench.spy) {
    const fx = fxAt(row.date);
    if (fx === null) continue;
    const existing = perfMap.get(row.date) ?? { date: row.date };
    existing.spy = Number(row.close) * fx;
    perfMap.set(row.date, existing);
  }
  for (const row of bench.qqq) {
    const fx = fxAt(row.date);
    if (fx === null) continue;
    const existing = perfMap.get(row.date) ?? { date: row.date };
    existing.qqq = Number(row.close) * fx;
    perfMap.set(row.date, existing);
  }
  for (const row of bench.btc) {
    const existing = perfMap.get(row.date) ?? { date: row.date };
    existing.btc = Number(row.close);
    perfMap.set(row.date, existing);
  }
  const perfData = [...perfMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  forwardFillBenchmarks(perfData, ["spy", "qqq", "tw0050", "btc"]);

  const benchmarks: BenchSeries[] = [
    { key: "spy", label: "S&P 500", color: "var(--c-bench-spy)", dash: "7 4" },
    { key: "qqq", label: "Nasdaq 100", color: "var(--c-bench-qqq)", dash: "2 4.5" },
    { key: "tw0050", label: "台股 0050", color: "var(--c-bench-0050)", dash: "12 5" },
    { key: "btc", label: "BTC", color: "var(--c-bench-btc)", dash: "8 3 2 3" },
  ];
  const hasPerf =
    perfData.length >= 2 &&
    (bench.tw0050.length > 0 ||
      bench.spy.length > 0 ||
      bench.qqq.length > 0 ||
      bench.btc.length > 0);

  const holdings: Holding[] = holdingAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    symbol: account.symbol,
    market: account.price_market,
    cls: account.asset_class,
    value: valueOf(account),
    cost: Number(account.cost_basis_twd ?? 0),
    realized: Number(account.realized_pnl_twd ?? 0),
    day: accountDay.get(account.id) ?? null,
    status: account.status,
  }));

  return {
    summary: {
      total,
      totalCost,
      unrealized: totalUnrealized,
      unrealizedPct: totalPnlPct,
      totalRealized,
      xirr,
      xirrShowable,
      dayChange,
      dayChangePct,
      accounts: activeAccounts.length,
      lastUpdate: latestUpdate ?? null,
      twrCum: twrResult?.total ?? null,
      twrAnn: twrAnnShowable ? (twrResult?.annualized ?? null) : null,
      maxDrawdown: drawdown?.pct ?? null,
      ddPeak: drawdown?.peakDate ?? null,
      ddTrough: drawdown?.troughDate ?? null,
      sharpe,
      twrShowable,
      twrAnnShowable,
      hasIncome,
      incomeYtd,
      income12m: incomeRolling12m,
      monthlyAvg: monthlyAvg12m,
      yieldOnCost,
      dividendAll,
      interestAll,
    },
    series: lineData,
    perf: perfData,
    benchmarks,
    hasPerf,
    allocation,
    allocTargets,
    holdings,
    marketLabel: MARKET_LABEL,
    today,
    archivedCount,
    showArchived: includeArchivedHoldings,
    benchNotice: input.benchNotice ?? null,
  };
}
