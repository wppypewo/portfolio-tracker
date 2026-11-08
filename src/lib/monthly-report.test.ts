import { describe, expect, it } from "vitest";
import { buildMonthlyReport, getMonthBounds, MIN_XIRR_SPAN_DAYS } from "./monthly-report";
import type { ReplayAccount, ReplaySnapshot } from "./history-replay";

describe("getMonthBounds", () => {
  it("正確處理一般月份的月初、月底與期初日", () => {
    expect(getMonthBounds("2026-07")).toEqual({
      month: "2026-07",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      openingDate: "2026-06-30",
    });
  });

  it("正確處理閏年二月", () => {
    expect(getMonthBounds("2024-02")?.endDate).toBe("2024-02-29");
    expect(getMonthBounds("2023-02")?.endDate).toBe("2023-02-28");
  });

  it("拒絕無效月份", () => {
    expect(getMonthBounds("2026-13")).toBeNull();
    expect(getMonthBounds("July")).toBeNull();
  });
});

describe("buildMonthlyReport", () => {
  it("沿用 TWD 現金流符號，投入不會被算成報酬", () => {
    const accounts: ReplayAccount[] = [
      {
        id: "a",
        name: "測試帳戶",
        assetClass: "stock",
        symbol: "AAA",
        priceMarket: "tw",
        createdAt: "2026-06-01T00:00:00+08:00",
      },
    ];
    const snapshots: ReplaySnapshot[] = [
      {
        accountId: "a",
        date: "2026-06-30",
        quantity: 10,
        unitPrice: 100,
        fxRate: 1,
        valueBase: 1000,
        costBasisTwd: 1000,
        costBasisNative: 1000,
        realizedPnlTwd: 0,
        accountStatus: "active",
      },
      {
        accountId: "a",
        date: "2026-07-15",
        quantity: 15,
        unitPrice: 100,
        fxRate: 1,
        valueBase: 1500,
        costBasisTwd: 1500,
        costBasisNative: 1500,
        realizedPnlTwd: 0,
        accountStatus: "active",
      },
      {
        accountId: "a",
        date: "2026-07-31",
        quantity: 15,
        unitPrice: 110,
        fxRate: 1,
        valueBase: 1650,
        costBasisTwd: 1500,
        costBasisNative: 1500,
        realizedPnlTwd: 0,
        accountStatus: "active",
      },
    ];
    const report = buildMonthlyReport({
      bounds: getMonthBounds("2026-07")!,
      accounts,
      snapshots,
      statusEvents: [],
      transactions: [
        {
          accountId: "a",
          type: "adjust_quantity",
          cashflowTwd: -500,
          realizedPnlTwd: null,
          createdAt: "2026-07-15T10:00:00+08:00",
        },
      ],
    });
    expect(report.netContributionTwd).toBe(500);
    expect(report.attribution.marketPriceEffectTwd).toBe(150);
    expect(report.attribution.residualTwd).toBe(0);
    expect(report.twr).toBeCloseTo(0.1, 8);
  });

  describe("XIRR 期間門檻", () => {
    const account: ReplayAccount = {
      id: "a",
      name: "測試帳戶",
      assetClass: "stock",
      symbol: "AAA",
      priceMarket: "tw",
      createdAt: "2025-12-01T00:00:00+08:00",
    };
    const priced = (date: string, unitPrice: number): ReplaySnapshot => ({
      accountId: "a",
      date,
      quantity: 10,
      unitPrice,
      fxRate: 1,
      valueBase: 10 * unitPrice,
      costBasisTwd: 1000,
      costBasisNative: 1000,
      realizedPnlTwd: 0,
      accountStatus: "active",
    });
    const report = (bounds: NonNullable<ReturnType<typeof getMonthBounds>>, snapshots: ReplaySnapshot[]) =>
      buildMonthlyReport({ bounds, accounts: [account], snapshots, statusEvents: [], transactions: [] });

    it(`當月只過了 4 天（少於 ${MIN_XIRR_SPAN_DAYS} 天）不年化`, () => {
      const result = report(
        { ...getMonthBounds("2026-07")!, endDate: "2026-07-04" },
        [priced("2026-06-30", 100), priced("2026-07-04", 101)],
      );
      expect(result.xirrAnnualized).toBeNull();
      expect(result.twr).toBeCloseTo(0.01, 8);
    });

    it("完整的月份照常計算", () => {
      const result = report(getMonthBounds("2026-07")!, [
        priced("2026-06-30", 100),
        priced("2026-07-31", 101),
      ]);
      expect(result.xirrAnnualized).not.toBeNull();
    });

    it("完整的二月（28 天）不會被擋掉", () => {
      const result = report(getMonthBounds("2026-02")!, [
        priced("2026-01-31", 100),
        priced("2026-02-28", 101),
      ]);
      expect(result.xirrAnnualized).not.toBeNull();
    });
  });
});

describe("buildMonthlyReport：輸入順序", () => {
  // 歷史頁與月報頁改成由新到舊查詢（撞上限時砍最舊的），
  // 這裡確認重播、範圍調整、歸因不因快照與狀態歷程的順序而改變結果。
  it("快照與狀態歷程反轉順序，報表完全相同", () => {
    const accounts: ReplayAccount[] = [
      { id: "a", name: "甲", assetClass: "stock", symbol: "AAA", priceMarket: "tw", createdAt: "2026-05-01T00:00:00+08:00" },
      { id: "b", name: "乙", assetClass: "etf", symbol: "BBB", priceMarket: "us", createdAt: "2026-05-01T00:00:00+08:00" },
    ];
    const snap = (accountId: string, date: string, quantity: number, unitPrice: number, fxRate: number): ReplaySnapshot => ({
      accountId, date, quantity, unitPrice, fxRate,
      valueBase: quantity * unitPrice * fxRate,
      costBasisTwd: 1000, costBasisNative: 1000, realizedPnlTwd: 0, accountStatus: null,
    });
    const ascending: ReplaySnapshot[] = [
      snap("a", "2026-06-20", 10, 100, 1),
      snap("b", "2026-06-20", 5, 20, 31),
      snap("a", "2026-06-30", 10, 102, 1),
      snap("b", "2026-06-30", 5, 21, 31.5),
      snap("a", "2026-07-10", 12, 105, 1),
      snap("b", "2026-07-10", 5, 22, 32),
      snap("a", "2026-07-31", 12, 108, 1),
    ];
    const statusAscending = [
      { accountId: "a", status: "active" as const, effectiveAt: "2026-05-01T00:00:00+00:00", source: "account_create" as const },
      { accountId: "b", status: "active" as const, effectiveAt: "2026-05-01T00:00:00+00:00", source: "account_create" as const },
      { accountId: "b", status: "archived" as const, effectiveAt: "2026-07-12T02:00:00+00:00", source: "account_update" as const },
    ];
    const transactions = [
      { accountId: "a", type: "buy", cashflowTwd: -210, realizedPnlTwd: null, createdAt: "2026-07-10T10:00:00+08:00" },
    ];
    const build = (snapshots: ReplaySnapshot[], statusEvents: typeof statusAscending) =>
      buildMonthlyReport({ bounds: getMonthBounds("2026-07")!, accounts, snapshots, statusEvents, transactions });

    const forward = build(ascending, statusAscending);
    const reversed = build([...ascending].reverse(), [...statusAscending].reverse());
    expect(reversed).toEqual(forward);
    // 確認測資真的走到封存與換匯，不是空報表。
    expect(forward.attribution.scopeWithdrawalTwd).toBeGreaterThan(0);
    expect(forward.attribution.fxEffectTwd).not.toBe(0);
  });
});
