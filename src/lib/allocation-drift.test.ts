import { describe, expect, it } from "vitest";
import { allocationDrifts } from "./allocation-drift";
import { planRebalance } from "./rebalance";

const h = (assetClass: string, valueTwd: number) => ({
  id: `${assetClass}-${valueTwd}`,
  name: assetClass,
  symbol: null,
  assetClass,
  market: "TW",
  currency: "TWD",
  valueTwd,
});

describe("allocationDrifts", () => {
  it("目標加總 100 時就是實際 − 目標", () => {
    const d = allocationDrifts([h("stock", 700), h("fund", 300)], { stock: 60, fund: 40 });
    expect(d.map((x) => [x.assetClass, Math.round(x.driftPp)])).toEqual([
      ["stock", 10],
      ["fund", -10],
    ]);
  });

  it("目標加總不是 100 時正規化，原始值留在 rawTargetPct", () => {
    const d = allocationDrifts([h("stock", 700), h("fund", 300)], { stock: 30, fund: 20 });
    const stock = d.find((x) => x.assetClass === "stock")!;
    expect(stock.targetPct).toBeCloseTo(60);
    expect(stock.rawTargetPct).toBe(30);
    expect(stock.driftPp).toBeCloseTo(10);
  });

  it("與再平衡試算的偏離同一個數字", () => {
    const holdings = [h("stock", 700_000), h("fund", 300_000), h("crypto", 50_000)];
    const targets = { stock: 30, fund: 20 };
    const d = allocationDrifts(holdings, targets);
    const r = planRebalance({ holdings, targets });
    for (const x of d) {
      const row = r.rows.find((rr) => rr.assetClass === x.assetClass)!;
      expect(x.driftPp).toBeCloseTo(row.driftPp, 2);
    }
  });

  it("目標為 0、負數或非數字的類別不列入，也不計入加總", () => {
    const d = allocationDrifts([h("stock", 100)], { stock: 50, fund: 0, gold: -5, x: "abc" });
    expect(d).toHaveLength(1);
    expect(d[0].targetPct).toBeCloseTo(100);
  });

  it("負值與非數字市值逐筆視為 0", () => {
    const d = allocationDrifts(
      [h("stock", 100), h("stock", -40), h("fund", Number.NaN), h("fund", 100)],
      { stock: 50, fund: 50 },
    );
    expect(d.map((x) => Math.round(x.actualPct))).toEqual([50, 50]);
  });

  it("沒有市值或沒有有效目標時回空陣列", () => {
    expect(allocationDrifts([], { stock: 50 })).toEqual([]);
    expect(allocationDrifts([h("stock", 100)], {})).toEqual([]);
  });
});
