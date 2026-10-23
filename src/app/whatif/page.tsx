import Link from "next/link";
import { fetchAllPages } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { getUnreadCount } from "@/lib/notifications";
import { todayTaipei } from "@/lib/dates";
import type { ScenarioHolding } from "@/lib/scenario";
import { fetchUsDailyClose } from "@/lib/prices/twelvedata";
import { fetchUsdTwdHistory } from "@/lib/prices/fx";
import { fetchTwDailyClose } from "@/lib/prices/finmind";
import { simulateBuyAndHold, calculateActualReturnPct, type DailyClose } from "@/lib/whatif";
import {
  WhatIfClient,
  type CfRow,
  type CounterfactualData,
} from "./WhatIfClient";
import type { ScenarioData } from "./ScenarioTab";

export default async function WhatIfPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data: cfRows },
    { data: accs },
    { data: profile },
    { data: recentAdds },
    { data: openDecisions },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("transactions")
        .select("created_at,cashflow_twd")
        .not("cashflow_twd", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }),
    supabase
      .from("accounts")
      .select(
        "id,name,asset_class,price_market,symbol,quantity,native_currency,last_unit_price,last_fx_rate,manual_value_base",
      )
      .eq("status", "active"),
    supabase
      .from("profiles")
      .select("allocation_targets,concentration_limit_pct")
      .single(),
    supabase
      .from("transactions")
      .select("account_id")
      .in("type", ["create", "adjust_quantity"])
      .lt("cashflow_twd", 0)
      .gte("created_at", `${subtractDays(todayTaipei(), 30)}T00:00:00+08:00`),
    supabase
      .from("investment_decisions")
      .select("account_id")
      .eq("status", "open")
      .not("account_id", "is", null),
  ]);

  const cashflows = ((cfRows ?? []) as {
    created_at: string;
    cashflow_twd: number;
  }[])
    .map((r) => ({
      // created_at 由 PostgREST 以 UTC 輸出，直接截字串會把台北清晨 8 點前的現金流算到前一天
      date: new Date(r.created_at).toLocaleDateString("en-CA", {
        timeZone: "Asia/Taipei",
      }),
      amount: Number(r.cashflow_twd),
    }))
    .filter((c) => Number.isFinite(c.amount) && c.amount !== 0);

  const totalInvested = cashflows
    .filter((c) => c.amount < 0)
    .reduce((s, c) => s + Math.abs(c.amount), 0);

  // 目前實際組合估值（= 未來推算的起點本金）
  let actualValue = 0;
  const scenarioHoldings: ScenarioHolding[] = [];
  for (const a of accs ?? []) {
    let valueTwd = 0;
    if (a.price_market === "manual") {
      valueTwd = Number(a.manual_value_base ?? 0);
    } else {
      valueTwd =
        Number(a.quantity) *
        Number(a.last_unit_price ?? 0) *
        Number(a.last_fx_rate ?? 1);
    }
    actualValue += valueTwd;
    scenarioHoldings.push({
      id: a.id,
      name: a.name,
      symbol: a.symbol,
      assetClass: a.asset_class,
      market: a.price_market,
      currency: a.native_currency,
      valueTwd,
    });
  }

  const recentAddsByAccount = countByAccount(recentAdds ?? []);
  const openDecisionsByAccount = countByAccount(openDecisions ?? []);
  const scenario: ScenarioData = {
    holdings: scenarioHoldings,
    allocationTargets:
      ((profile?.allocation_targets ?? {}) as Record<string, number>) || {},
    concentrationLimitPct: Number(profile?.concentration_limit_pct ?? 25),
    recentAddsByAccount,
    openDecisionsByAccount,
  };

  const firstDate = cashflows[0]?.date ?? "";
  const hasData = cashflows.length > 0 && totalInvested > 0 && !!firstDate;

  // 三個 ETF 歷史 close + USD/TWD（換算 SPY/QQQ）
  const [tw0050, spyUsd, qqqUsd, fxHistory] = hasData
    ? await Promise.all([
        fetchTwDailyClose("0050", firstDate),
        fetchUsDailyClose("SPY", firstDate),
        fetchUsDailyClose("QQQ", firstDate),
        fetchUsdTwdHistory(firstDate),
      ])
    : [[], [], [], []];

  const fxSorted = [...fxHistory].sort((a, b) => a.date.localeCompare(b.date));
  function fxAt(date: string): number | null {
    let last: number | null = null;
    for (const r of fxSorted) {
      if (r.date <= date) last = r.rate;
      else break;
    }
    return last;
  }

  const spyTwd: DailyClose[] = spyUsd
    .map((r) => {
      const fx = fxAt(r.date);
      return fx === null ? null : { date: r.date, close: Number(r.close) * fx };
    })
    .filter((x): x is DailyClose => x !== null);
  const qqqTwd: DailyClose[] = qqqUsd
    .map((r) => {
      const fx = fxAt(r.date);
      return fx === null ? null : { date: r.date, close: Number(r.close) * fx };
    })
    .filter((x): x is DailyClose => x !== null);
  const tw0050Prices: DailyClose[] = tw0050.map((r) => ({
    date: r.date,
    close: Number(r.close),
  }));

  let counterfactual: CounterfactualData | null = null;
  if (hasData) {
    const actualReturnPct = calculateActualReturnPct({
      currentValue: actualValue,
      cashflows,
    });
    const sims: CfRow[] = [
      {
        label: "S&P 500",
        sym: "SPY",
        color: "var(--c-alloc-fund)",
        ...resultOf(simulateBuyAndHold(cashflows, spyTwd)),
        actual: false,
      },
      {
        label: "Nasdaq 100",
        sym: "QQQ",
        color: "var(--c-alloc-other)",
        ...resultOf(simulateBuyAndHold(cashflows, qqqTwd)),
        actual: false,
      },
      {
        label: "台股 0050",
        sym: "0050",
        color: "var(--c-alloc-cash)",
        ...resultOf(simulateBuyAndHold(cashflows, tw0050Prices)),
        actual: false,
      },
    ];
    const rows: CfRow[] = [
      ...sims,
      {
        label: "我的實際組合",
        sym: null,
        color: "var(--c-accent)",
        finalValue: actualValue,
        returnPct: actualReturnPct,
        actual: true,
        skipped: 0,
      },
    ].sort((a, b) => b.returnPct - a.returnPct);

    counterfactual = {
      invested: totalInvested,
      firstDate,
      contributions: cashflows.filter((c) => c.amount < 0).length,
      rows,
    };
  }

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="whatif" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-7">
        <Link
          href="/"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] transition-colors hover:text-[var(--c-accent)]"
        >
          ← 回總覽
        </Link>
        <PageHead
          className="mt-4 mb-6"
          label="推算 · 對照 · 壓力測試"
          title="情境推演"
          sub="推算未來淨值、回看 ETF 對照，並測試價格與匯率衝擊下的買後配置。"
        />

        <WhatIfClient
          netWorth={actualValue}
          counterfactual={counterfactual}
          scenario={scenario}
        />
      </main>
    </div>
  );
}

function countByAccount(rows: { account_id: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.account_id) counts[row.account_id] = (counts[row.account_id] ?? 0) + 1;
  }
  return counts;
}

function subtractDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

// 把 simulateBuyAndHold 結果整成 CfRow 需要的欄位
function resultOf(r: {
  finalValue: number;
  returnPct: number;
  skippedCashflows: number;
}): Pick<CfRow, "finalValue" | "returnPct" | "skipped"> {
  return {
    finalValue: r.finalValue,
    returnPct: r.returnPct,
    skipped: r.skippedCashflows,
  };
}
