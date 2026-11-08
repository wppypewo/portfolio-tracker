import { describe, expect, it } from "vitest";
import {
  buildDashboardData,
  type AccountRow,
  type DashboardInputs,
  type SnapshotRow,
} from "@/lib/dashboard-data";

// 情境化回歸測試：把完整使用者故事（買 / 賣 / 配息 / 匯率 / 封存 / 提領）
// 灌進 buildDashboardData 這條正式計算管線，用人工算定的期望值把行為釘死。
// 與 xirr.test.ts / metrics.test.ts 的「不變量」測試互補——這裡測「具名情境 → 精確數字」，
// 目的是重構 dashboard-data.ts 時，複合情境不會悄悄跑掉。
// 期望值皆為手算後再以本測試實跑校準，非推測。

// ---- 建構輔助：給合理預設，各情境只覆寫關心的欄位 ----

function acct(o: Partial<AccountRow>): AccountRow {
  return {
    id: "a1",
    name: "帳戶",
    asset_class: "stock",
    price_market: "manual",
    symbol: null,
    quantity: 0,
    native_currency: "TWD",
    last_unit_price: null,
    last_fx_rate: 1,
    manual_value_base: 0,
    last_priced_at: null,
    cost_basis_twd: 0,
    realized_pnl_twd: 0,
    status: "active",
    ...o,
  };
}

function inputs(o: Partial<DashboardInputs>): DashboardInputs {
  return {
    accounts: [],
    includeArchivedHoldings: false,
    cfRows: [],
    incomeRows: [],
    allocationTargets: {},
    snapRows: [],
    bench: { tw0050: [], spy: [], qqq: [], btc: [] },
    fxHistory: [],
    now: new Date("2026-07-23T06:00:00Z"),
    today: "2026-07-23",
    ...o,
  };
}

// 從 start（YYYY-MM-DD）起，回傳 n 個連續日曆日字串。
function dateSeq(start: string, n: number): string[] {
  const [y, m, d] = start.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().slice(0, 10),
  );
}

// 單一帳戶、每日一筆的快照序列。
function snaps(accountId: string, start: string, values: number[]): SnapshotRow[] {
  const dates = dateSeq(start, values.length);
  return values.map((value_base, i) => ({
    account_id: accountId,
    snapshot_date: dates[i],
    value_base,
  }));
}

describe("情境：XIRR 90 天門檻與終值口徑", () => {
  it("一年投入 100k、現值 110k → XIRR ≈ 10% 且可顯示", () => {
    const data = buildDashboardData(
      inputs({
        accounts: [
          acct({ manual_value_base: 110_000, cost_basis_twd: 100_000 }),
        ],
        // 投入以負現金流儲存（XIRR 慣例）；管線會在 now 補上 +現值當終值。
        cfRows: [{ created_at: "2025-07-23T06:00:00Z", cashflow_twd: -100_000 }],
      }),
    );
    expect(data.summary.total).toBe(110_000);
    expect(data.summary.unrealized).toBe(10_000);
    expect(data.summary.unrealizedPct).toBeCloseTo(10, 5);
    expect(data.summary.xirr).not.toBeNull();
    expect(data.summary.xirr!).toBeCloseTo(0.1, 2);
    expect(data.summary.xirrShowable).toBe(true);
  });

  it("跨度僅 30 天 → XIRR 有值但不顯示（避免短期年化失真）", () => {
    const data = buildDashboardData(
      inputs({
        accounts: [
          acct({ manual_value_base: 110_000, cost_basis_twd: 100_000 }),
        ],
        cfRows: [{ created_at: "2026-06-23T06:00:00Z", cashflow_twd: -100_000 }],
      }),
    );
    expect(data.summary.xirr).not.toBeNull();
    expect(data.summary.xirrShowable).toBe(false);
  });
});

describe("情境：封存帳戶只擴充持倉列表，不動總覽口徑", () => {
  const active = acct({
    id: "act",
    asset_class: "stock",
    manual_value_base: 100_000,
    cost_basis_twd: 80_000,
  });
  const archived = acct({
    id: "arc",
    asset_class: "crypto",
    manual_value_base: 50_000,
    cost_basis_twd: 40_000,
    status: "archived",
  });
  const activeSnaps = snaps("act", "2026-07-01", [90_000, 100_000]);
  const archivedSnaps = snaps("arc", "2026-07-01", [45_000, 50_000]);

  const baseline = buildDashboardData(
    inputs({ accounts: [active], snapRows: activeSnaps }),
  );
  const withArchived = buildDashboardData(
    inputs({
      accounts: [active, archived],
      snapRows: [...activeSnaps, ...archivedSnaps],
    }),
  );

  it("總額、成本、配置、淨值序列不受封存帳戶影響", () => {
    expect(withArchived.summary.total).toBe(baseline.summary.total);
    expect(withArchived.summary.total).toBe(100_000);
    expect(withArchived.summary.totalCost).toBe(80_000);
    expect(withArchived.allocation).toEqual(baseline.allocation);
    expect(withArchived.series).toEqual(baseline.series);
  });

  it("封存只反映在 archivedCount 與（開啟時的）持倉列表", () => {
    expect(baseline.archivedCount).toBe(0);
    expect(withArchived.archivedCount).toBe(1);
    expect(withArchived.holdings).toHaveLength(1); // 預設不含封存
    const shown = buildDashboardData(
      inputs({
        accounts: [active, archived],
        snapRows: [...activeSnaps, ...archivedSnaps],
        includeArchivedHoldings: true,
      }),
    );
    expect(shown.holdings).toHaveLength(2);
    expect(shown.summary.total).toBe(100_000); // 開啟封存持倉仍不改總額
  });
});

describe("情境：TWR 隔離現金流，加碼不算報酬", () => {
  it("淨值因加碼 50k 跳升，但 TWR 累積 ≈ 0；零波動時 Sharpe 不顯示", () => {
    // 40 天：前 15 天 100k，第 15 天加碼 50k 後維持 150k。
    const values = [
      ...Array(15).fill(100_000),
      ...Array(25).fill(150_000),
    ];
    const start = "2026-06-01";
    const contributionDate = dateSeq(start, 40)[15];
    const data = buildDashboardData(
      inputs({
        accounts: [acct({ id: "a1", manual_value_base: 150_000 })],
        snapRows: snaps("a1", start, values),
        cfRows: [
          { created_at: `${contributionDate}T06:00:00Z`, cashflow_twd: -50_000 },
        ],
      }),
    );
    expect(data.summary.twrShowable).toBe(true);
    expect(data.summary.twrCum).not.toBeNull();
    expect(data.summary.twrCum!).toBeCloseTo(0, 6);
    expect(data.summary.maxDrawdown).toBeNull(); // 指數全平，無回撤
    expect(data.summary.sharpe).toBeNull(); // 日報酬全 0 → 標準差為 0
  });
});

describe("情境：提領不被誤判成市場虧損", () => {
  it("淨值因提領 30k 下滑，但回撤仍為 null", () => {
    // 40 天：前 20 天 100k，第 20 天提領 30k 後維持 70k。
    const values = [
      ...Array(20).fill(100_000),
      ...Array(20).fill(70_000),
    ];
    const start = "2026-06-01";
    const withdrawalDate = dateSeq(start, 40)[20];
    const data = buildDashboardData(
      inputs({
        accounts: [acct({ id: "a1", manual_value_base: 70_000 })],
        snapRows: snaps("a1", start, values),
        // 提領以正現金流儲存（XIRR 回收慣例）；TWR 端會翻號成負。
        cfRows: [
          { created_at: `${withdrawalDate}T06:00:00Z`, cashflow_twd: 30_000 },
        ],
      }),
    );
    expect(data.summary.twrShowable).toBe(true);
    expect(data.summary.twrCum!).toBeCloseTo(0, 6);
    expect(data.summary.maxDrawdown).toBeNull();
  });
});

describe("情境：收入的期間分類與股息/利息拆分", () => {
  it("YTD、近 12 月、股息、利息各自歸位（today = 2026-07-23）", () => {
    const data = buildDashboardData(
      inputs({
        accounts: [acct({ manual_value_base: 100_000, cost_basis_twd: 100_000 })],
        incomeRows: [
          // 今年、12 月內、股息
          { created_at: "2026-03-01T06:00:00Z", type: "dividend", cashflow_twd: 5_000 },
          // 去年、12 月外、股息
          { created_at: "2024-01-01T06:00:00Z", type: "dividend", cashflow_twd: 3_000 },
          // 去年、12 月內、利息
          { created_at: "2025-10-01T06:00:00Z", type: "interest", cashflow_twd: 1_000 },
        ],
      }),
    );
    expect(data.summary.hasIncome).toBe(true);
    expect(data.summary.incomeYtd).toBe(5_000);
    expect(data.summary.income12m).toBe(6_000);
    expect(data.summary.dividendAll).toBe(8_000);
    expect(data.summary.interestAll).toBe(1_000);
    expect(data.summary.monthlyAvg).toBeCloseTo(500, 5);
    expect(data.summary.yieldOnCost).toBeCloseTo(6, 5);
  });
});

describe("情境：手動帳戶沒有每日快照", () => {
  // cron 只替有代號的非手動帳戶寫每日快照；手動帳戶只有建立當天一筆。
  // 曲線與 TWR 要沿用手動帳戶最近一筆快照，不能把沒快照的日子當成 0。
  it("價格不動時，曲線維持 200k、TWR ≈ 0、無回撤", () => {
    const start = "2026-06-01";
    const data = buildDashboardData(
      inputs({
        accounts: [
          acct({ id: "s", price_market: "tw", symbol: "0050", quantity: 1000, last_unit_price: 100, cost_basis_twd: 100_000 }),
          acct({ id: "m", manual_value_base: 100_000, cost_basis_twd: 100_000 }),
        ],
        snapRows: [
          ...snaps("s", start, Array(40).fill(100_000)),
          { account_id: "m", snapshot_date: start, value_base: 100_000 },
        ],
        cfRows: [
          { created_at: "2026-06-01T02:00:00Z", cashflow_twd: -100_000 },
          { created_at: "2026-06-01T03:00:00Z", cashflow_twd: -100_000 },
        ],
      }),
    );
    expect(data.series).toHaveLength(40);
    expect(data.series.every((point) => point.value === 200_000)).toBe(true);
    expect(data.summary.dayChange).toBe(0);
    expect(data.summary.twrCum).toBeCloseTo(0, 10);
    expect(data.summary.maxDrawdown).toBeNull();
  });

  it("帳戶第一筆快照之前不計入，加入當天的投入由 TWR 扣除", () => {
    const data = buildDashboardData(
      inputs({
        accounts: [
          acct({ id: "s", price_market: "tw", symbol: "0050", quantity: 1000, last_unit_price: 100, cost_basis_twd: 100_000 }),
          acct({ id: "m", manual_value_base: 50_000, cost_basis_twd: 50_000 }),
        ],
        snapRows: [
          ...snaps("s", "2026-06-01", Array(40).fill(100_000)),
          { account_id: "m", snapshot_date: "2026-06-11", value_base: 50_000 },
        ],
        cfRows: [
          { created_at: "2026-06-01T02:00:00Z", cashflow_twd: -100_000 },
          { created_at: "2026-06-11T02:00:00Z", cashflow_twd: -50_000 },
        ],
      }),
    );
    expect(data.series[9].value).toBe(100_000);
    expect(data.series[10].value).toBe(150_000);
    expect(data.series.at(-1)!.value).toBe(150_000);
    expect(data.summary.twrCum).toBeCloseTo(0, 10);
    expect(data.summary.maxDrawdown).toBeNull();
  });
});
