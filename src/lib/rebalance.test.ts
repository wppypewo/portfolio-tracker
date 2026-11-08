import { describe, expect, it } from "vitest";
import { planRebalance } from "./rebalance";
import type { ScenarioHolding } from "./scenario";

function holding(assetClass: string, valueTwd: number, id = assetClass): ScenarioHolding {
  return {
    id,
    name: id,
    symbol: null,
    assetClass,
    market: "us",
    currency: "USD",
    valueTwd,
  };
}

const row = (r: ReturnType<typeof planRebalance>, cls: string) =>
  r.rows.find((x) => x.assetClass === cls)!;

describe("planRebalance", () => {
  it("不投入新資金時算出目前偏離多少錢", () => {
    const r = planRebalance({
      holdings: [holding("stock", 700_000), holding("fund", 300_000)],
      targets: { stock: 60, fund: 40 },
    });
    expect(r.totalTwd).toBe(1_000_000);
    expect(row(r, "stock").gapTwd).toBe(-100_000); // 超配 10pp
    expect(row(r, "fund").gapTwd).toBe(100_000);
    expect(row(r, "stock").driftPp).toBe(10);
    expect(row(r, "fund").driftPp).toBe(-10);
  });

  it("缺口以投入後的總額為基準，不是投入前", () => {
    // 這是最容易寫錯的地方：新資金會把分母墊高，
    // 照投入前的目標市值補會補不夠。
    // 總額 1,000,000、投入 200,000 → 投入後 1,200,000。
    // fund 目標 40% → 480,000，現有 300,000 → 缺 180,000。
    // 若照投入前算只會算出缺 100,000。
    const r = planRebalance({
      holdings: [holding("stock", 700_000), holding("fund", 300_000)],
      targets: { stock: 60, fund: 40 },
      contributionTwd: 200_000,
    });
    expect(row(r, "fund").contributionTwd).toBe(180_000);
    expect(row(r, "stock").contributionTwd).toBe(20_000);
    expect(row(r, "fund").afterPct).toBe(40);
    expect(row(r, "stock").afterPct).toBe(60);
    expect(r.unallocatedTwd).toBe(0);
  });

  it("錢不夠補滿時照缺口大小等比例分配", () => {
    const r = planRebalance({
      holdings: [holding("stock", 700_000), holding("fund", 300_000)],
      targets: { stock: 60, fund: 40 },
      contributionTwd: 50_000,
    });
    const total = row(r, "stock").contributionTwd + row(r, "fund").contributionTwd;
    expect(total).toBeCloseTo(50_000, 2);
    // fund 缺得多，拿到的比較多
    expect(row(r, "fund").contributionTwd).toBeGreaterThan(
      row(r, "stock").contributionTwd,
    );
    expect(r.unallocatedTwd).toBe(0);
  });

  it("錢多到補滿還有剩，剩下的照目標比例灑", () => {
    const r = planRebalance({
      holdings: [holding("stock", 600_000), holding("fund", 400_000)],
      targets: { stock: 60, fund: 40 },
      contributionTwd: 100_000,
    });
    // 已經在目標上，所以 100,000 直接照 60/40 分
    expect(row(r, "stock").contributionTwd).toBe(60_000);
    expect(row(r, "fund").contributionTwd).toBe(40_000);
    expect(row(r, "stock").afterPct).toBe(60);
  });

  it("單一標的 100% 的配置也算得出來（VT 定投情境）", () => {
    const r = planRebalance({
      holdings: [holding("fund", 1_000_000)],
      targets: { fund: 100 },
      contributionTwd: 30_000,
    });
    expect(row(r, "fund").contributionTwd).toBe(30_000);
    expect(row(r, "fund").afterPct).toBe(100);
    expect(r.unallocatedTwd).toBe(0);
    expect(r.notes).toHaveLength(0);
  });

  it("目標加總不是 100 時正規化並提出警告", () => {
    const r = planRebalance({
      holdings: [holding("stock", 500_000), holding("fund", 500_000)],
      targets: { stock: 30, fund: 30 },
      contributionTwd: 0,
    });
    expect(r.targetsSumPct).toBe(60);
    expect(r.notes.some((n) => n.includes("不是 100%"))).toBe(true);
    // 正規化後 50/50，兩邊都在目標上
    expect(row(r, "stock").gapTwd).toBe(0);
    expect(row(r, "fund").gapTwd).toBe(0);
  });

  it("有持倉但沒設目標的類別視同 0%，並且提醒只買不賣救不了", () => {
    const r = planRebalance({
      holdings: [holding("stock", 800_000), holding("crypto", 200_000)],
      targets: { stock: 100 },
      contributionTwd: 100_000,
    });
    const crypto = row(r, "crypto");
    expect(crypto.untargeted).toBe(true);
    expect(crypto.targetPct).toBe(0);
    expect(crypto.contributionTwd).toBe(0);
    expect(r.notes.some((n) => n.includes("只買不賣"))).toBe(true);
  });

  it("完全沒設目標時不給建議，只說要去設定", () => {
    const r = planRebalance({
      holdings: [holding("stock", 100_000)],
      targets: {},
      contributionTwd: 10_000,
    });
    expect(r.rows).toHaveLength(0);
    expect(r.unallocatedTwd).toBe(10_000);
    expect(r.notes.some((n) => n.includes("尚未設定"))).toBe(true);
  });

  it("空組合但有投入金額時，直接照目標比例分配", () => {
    const r = planRebalance({
      holdings: [],
      targets: { stock: 70, fund: 30 },
      contributionTwd: 100_000,
    });
    expect(row(r, "stock").contributionTwd).toBe(70_000);
    expect(row(r, "fund").contributionTwd).toBe(30_000);
  });

  it("負數與非數值的市值、投入金額都當成 0，不會產生負分配", () => {
    const r = planRebalance({
      holdings: [holding("stock", -500), holding("fund", Number.NaN)],
      targets: { stock: 50, fund: 50 },
      contributionTwd: -1000,
    });
    expect(r.totalTwd).toBe(0);
    expect(r.contributionTwd).toBe(0);
    for (const x of r.rows) expect(x.contributionTwd).toBe(0);
  });

  it("負數與零的目標值被忽略，不會變成負權重", () => {
    const r = planRebalance({
      holdings: [holding("stock", 500_000), holding("fund", 500_000)],
      targets: { stock: 100, fund: -20, cash: 0 },
      contributionTwd: 0,
    });
    expect(r.targetsSumPct).toBe(100);
    expect(row(r, "fund").untargeted).toBe(true);
    expect(row(r, "stock").gapTwd).toBe(500_000);
  });

  it("分配總額不會超過投入金額", () => {
    const r = planRebalance({
      holdings: [
        holding("stock", 123_456),
        holding("fund", 7_890),
        holding("crypto", 45_678),
      ],
      targets: { stock: 45, fund: 35, crypto: 20 },
      contributionTwd: 33_333,
    });
    const sum = r.rows.reduce((s, x) => s + x.contributionTwd, 0);
    expect(sum).toBeLessThanOrEqual(33_333 + 0.01);
    expect(sum + r.unallocatedTwd).toBeCloseTo(33_333, 1);
  });

  it("目標加總不是 100 時，目標與偏離用正規化後的比例，與差額同口徑", () => {
    // 只填 stock 30、fund 20（加總 50）→ 正規化為 60 / 40。
    // 實際 70 / 30：偏離應為 +10 / −10，而不是對原始值算出的 +40 / +10。
    const r = planRebalance({
      holdings: [holding("stock", 700_000), holding("fund", 300_000)],
      targets: { stock: 30, fund: 20 },
    });
    const stock = row(r, "stock");
    const fund = row(r, "fund");
    expect(stock.targetPct).toBe(60);
    expect(stock.rawTargetPct).toBe(30);
    expect(stock.driftPp).toBe(10);
    expect(fund.driftPp).toBe(-10);
    // 偏離方向與差額方向一致：超配者差額為負
    expect(stock.gapTwd).toBe(-100_000);
    expect(fund.gapTwd).toBe(100_000);
  });
});
