import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DCA_TIER_CONFIG } from "./dca-tiers";
import {
  TIER_SERIES_MAX_AGE_DAYS,
  memoizeSeriesLoader,
  resolveCronTierAmount,
  tierDecisionDate,
} from "./recurring-tier-amount";
import { buildTotalReturnSeries } from "./total-return-series";
import {
  parseFinmindDividends,
  parseFinmindPrices,
  parseFinmindSplits,
} from "./prices/finmind-total-return";
import fixture from "./__fixtures__/finmind-0050.json";

const TW_ACCOUNT = { price_market: "tw", symbol: "0050" };
// 多數測試的排程日與 today 同一天，序列最後一筆在前一天。
const RUN_DATE = "2026-09-30";
// 設定的均線天數下限是 20，所以測試序列一律 20 筆。
const SHORT_CONFIG = { ...DEFAULT_DCA_TIER_CONFIG, maLength: 20 };
/** 前 19 天持平在 100，最後一天是 last。 */
const flatThen = (last: number) => [...Array<number>(19).fill(100), last];

/** 最後一筆落在 lastDate，往前每天一筆。 */
function seriesEnding(lastDate: string, closes: number[]) {
  const last = Date.parse(`${lastDate}T00:00:00Z`);
  return closes.map((close, i) => ({
    date: new Date(last - (closes.length - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    close,
  }));
}

const loaderOf = (lastDate: string, closes: number[]) =>
  vi.fn(async () => ({
    series: seriesEnding(lastDate, closes),
    dividendCount: 0,
  }));

function fixtureSeries() {
  const dividends = parseFinmindDividends(fixture.dividends);
  return {
    series: buildTotalReturnSeries(
      parseFinmindPrices(fixture.prices),
      dividends,
      parseFinmindSplits(fixture.splits),
    ),
    dividendCount: dividends.length,
  };
}

describe("resolveCronTierAmount", () => {
  it("固定金額計劃：不抓序列，回 fixed", async () => {
    const loadSeries = vi.fn();

    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: null, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries,
    });

    expect(result).toEqual({ kind: "fixed" });
    expect(loadSeries).not.toHaveBeenCalled();
  });

  it("0050 在 2026-09-30：基準 8000、×0.8，與帳戶頁預填的 6400 相同", async () => {
    const loadSeries = vi.fn(async () => fixtureSeries());

    const result = await resolveCronTierAmount({
      // Supabase 的 numeric 讀回來是字串。
      plan: { amount_twd: "8000.00", tier_config: DEFAULT_DCA_TIER_CONFIG, next_run_date: "2026-10-01" },
      account: TW_ACCOUNT,
      today: "2026-10-01",
      loadSeries,
    });

    expect(result).toEqual({
      kind: "tiered",
      amount: 6400,
      multiplier: 0.8,
      asOf: "2026-09-30",
    });
    expect(loadSeries).toHaveBeenCalledWith("0050");
  });

  it("回撤加碼：基準 3333、×1.25，取整到百元", async () => {
    const result = await resolveCronTierAmount({
      plan: { amount_twd: 3333, tier_config: SHORT_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: loaderOf("2026-09-29", flatThen(88)),
    });

    expect(result).toEqual({
      kind: "tiered",
      amount: 4200,
      multiplier: 1.25,
      asOf: "2026-09-29",
    });
  });

  it("常態級距也回 tiered：金額是取整後的基準金額", async () => {
    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: SHORT_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: loaderOf("2026-09-29", flatThen(100)),
    });

    expect(result).toEqual({
      kind: "tiered",
      amount: 8000,
      multiplier: 1,
      asOf: "2026-09-29",
    });
  });

  it("取整後不是正數時用基準金額，與帳戶頁一致", async () => {
    const result = await resolveCronTierAmount({
      plan: { amount_twd: 40, tier_config: SHORT_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: loaderOf("2026-09-29", flatThen(100)),
    });

    expect(result).toMatchObject({ kind: "tiered", amount: 40 });
  });

  it("設定格式不對：不抓序列，回錯誤，不拿預設級距頂替", async () => {
    const loadSeries = vi.fn();

    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: { maLength: 200 }, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries,
    });

    expect(result).toEqual({ kind: "error", error: "級距設定格式無效" });
    expect(loadSeries).not.toHaveBeenCalled();
  });

  it.each([
    { price_market: "us", symbol: "VOO" },
    { price_market: "crypto", symbol: "bitcoin" },
    { price_market: "tw", symbol: null },
  ])("非台股帳戶 $price_market/$symbol：不抓序列，回錯誤", async (account) => {
    const loadSeries = vi.fn();

    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: DEFAULT_DCA_TIER_CONFIG, next_run_date: RUN_DATE },
      account,
      today: "2026-09-30",
      loadSeries,
    });

    expect(result).toEqual({ kind: "error", error: "級距加減碼只支援台股帳戶" });
    expect(loadSeries).not.toHaveBeenCalled();
  });

  it("抓序列失敗：回固定句子，原始例外只放在 cause", async () => {
    const cause = new Error("FinMind TaiwanStockSplitPrice 回應 HTTP 402");

    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: DEFAULT_DCA_TIER_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: vi.fn().mockRejectedValue(cause),
    });

    expect(result).toEqual({ kind: "error", error: "抓不到歷史股價", cause });
  });

  it("額度用完：帶出額度的說明", async () => {
    const cause = new Error("台股報價今日的共用額度已用完，明天才會重置");
    cause.name = "ApiBudgetExceededError";

    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: DEFAULT_DCA_TIER_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: vi.fn().mockRejectedValue(cause),
    });

    expect(result).toMatchObject({
      kind: "error",
      error: "台股報價今日的共用額度已用完，明天才會重置",
    });
  });

  it("序列是空的：把判定的錯誤帶出", async () => {
    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: DEFAULT_DCA_TIER_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: async () => ({ series: [], dividendCount: 0 }),
    });

    expect(result).toEqual({ kind: "error", error: "沒有歷史收盤資料" });
  });

  it(`序列最後一筆剛好 ${TIER_SERIES_MAX_AGE_DAYS} 天前仍採用，多一天就不採用`, async () => {
    // 排程日 10-01、預設提前 1 天，決定日是 09-30（與 today 同一天）。
    const plan = { amount_twd: 8000, tier_config: SHORT_CONFIG, next_run_date: "2026-10-01" };
    const closes = flatThen(88);

    // 2026-09-16 到 2026-09-30 是 14 天。
    const atLimit = await resolveCronTierAmount({
      plan,
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: loaderOf("2026-09-16", closes),
    });
    expect(atLimit).toMatchObject({ kind: "tiered", amount: 10000 });

    const tooOld = await resolveCronTierAmount({
      plan,
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: loaderOf("2026-09-15", closes),
    });
    expect(tooOld).toEqual({
      kind: "error",
      error: "歷史股價只到 2026-09-15，超過 14 天沒有更新",
    });
  });

  it("預設提前 1 天：排程日當天的收盤不算，與扣款前看到的指標一致", async () => {
    // 前 20 天持平，排程日當天跌到 88（回撤 12%）。
    // 把當天算進去會是 ×1.25；扣款前能看到的最新一根是 09-29，應是 ×1。
    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: SHORT_CONFIG, next_run_date: "2026-09-30" },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries: loaderOf("2026-09-30", [...Array<number>(20).fill(100), 88]),
    });

    expect(result).toEqual({
      kind: "tiered",
      amount: 8000,
      multiplier: 1,
      asOf: "2026-09-29",
    });
  });

  it("隔天重試仍以排程日為界，不改用重試當天之前的收盤", async () => {
    const result = await resolveCronTierAmount({
      plan: { amount_twd: 8000, tier_config: SHORT_CONFIG, next_run_date: "2026-09-30" },
      account: TW_ACCOUNT,
      today: "2026-10-01",
      loadSeries: loaderOf("2026-10-01", [...Array<number>(20).fill(100), 88, 70]),
    });

    expect(result).toMatchObject({ kind: "tiered", multiplier: 1, asOf: "2026-09-29" });
  });

  it("提前 5 天決定：15 日扣款看 10 日的收盤，之後幾天的漲跌不算", async () => {
    const plan = {
      amount_twd: 8000,
      tier_config: { ...SHORT_CONFIG, decisionLeadDays: 5 },
      next_run_date: "2026-11-15",
    };

    // 11-10 以前持平，11-11 起跌到 88：決定日看不到這段跌幅，應是 ×1。
    const after = await resolveCronTierAmount({
      plan,
      account: TW_ACCOUNT,
      today: "2026-11-16",
      loadSeries: loaderOf("2026-11-13", [...Array<number>(20).fill(100), 88, 88, 88]),
    });
    expect(after).toEqual({ kind: "tiered", amount: 8000, multiplier: 1, asOf: "2026-11-10" });

    // 11-10 當天就跌到 88：使用者收盤後看得到，應是 ×1.25。
    const onDay = await resolveCronTierAmount({
      plan,
      account: TW_ACCOUNT,
      today: "2026-11-16",
      loadSeries: loaderOf("2026-11-13", [...Array<number>(20).fill(100), 88, 90, 90, 90]),
    });
    expect(onDay).toEqual({ kind: "tiered", amount: 10000, multiplier: 1.25, asOf: "2026-11-10" });
  });

  it("新舊以決定日衡量：提前天數加上晚幾天執行，不會被誤判成過舊", async () => {
    // 決定日 11-10，序列最後一筆 10-28（相隔 13 天），today 11-16 已相隔 19 天。
    const result = await resolveCronTierAmount({
      plan: {
        amount_twd: 8000,
        tier_config: { ...SHORT_CONFIG, decisionLeadDays: 5 },
        next_run_date: "2026-11-15",
      },
      account: TW_ACCOUNT,
      today: "2026-11-16",
      loadSeries: loaderOf("2026-10-28", flatThen(100)),
    });

    expect(result).toMatchObject({ kind: "tiered", asOf: "2026-10-28" });
  });

  it.each([0, -8000, "abc"])("基準金額 %s 無效：回錯誤", async (amount) => {
    const loadSeries = vi.fn();

    const result = await resolveCronTierAmount({
      plan: { amount_twd: amount, tier_config: DEFAULT_DCA_TIER_CONFIG, next_run_date: RUN_DATE },
      account: TW_ACCOUNT,
      today: "2026-09-30",
      loadSeries,
    });

    expect(result).toEqual({ kind: "error", error: "定期定額金額無效" });
    expect(loadSeries).not.toHaveBeenCalled();
  });
});

describe("tierDecisionDate", () => {
  it.each([
    ["2026-11-15", 5, "2026-11-10"],
    ["2026-11-15", 0, "2026-11-15"],
    ["2026-03-02", 5, "2026-02-25"],
    ["2027-01-03", 5, "2026-12-29"],
  ])("%s 前 %i 天是 %s", (runDate, leadDays, expected) => {
    expect(tierDecisionDate(runDate, leadDays)).toBe(expected);
  });
});

describe("memoizeSeriesLoader", () => {
  it("同一個代號只抓一次，不同代號各抓一次", async () => {
    const load = vi.fn(async (symbol: string) => `series-${symbol}`);
    const memoized = memoizeSeriesLoader(load);

    expect(await memoized("0050")).toBe("series-0050");
    expect(await memoized("0050")).toBe("series-0050");
    expect(await memoized("006208")).toBe("series-006208");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("失敗也記住：同一次執行不重抓", async () => {
    const load = vi.fn().mockRejectedValue(new Error("boom"));
    const memoized = memoizeSeriesLoader(load);

    await expect(memoized("0050")).rejects.toThrow("boom");
    await expect(memoized("0050")).rejects.toThrow("boom");

    expect(load).toHaveBeenCalledTimes(1);
  });
});
