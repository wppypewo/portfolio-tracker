import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeApiQuota } from "@/lib/api-budget";
import { simulateBuyAndHold } from "@/lib/whatif";
import { fetchTwDailyClose } from "./finmind";
import fixture from "../__fixtures__/finmind-0050.json";

vi.mock("@/lib/api-budget", () => ({
  consumeApiQuota: vi.fn(),
}));
// 測試環境沒有 Next 的快取，unstable_cache 直接呼叫原函式。
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

const quotaMock = vi.mocked(consumeApiQuota);

const datasetOf = (url: string) =>
  new URL(url).searchParams.get("dataset") ?? "";
const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status });

function stubFetch(splitResponse: () => Response = () => respond(fixture.splits)) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const dataset = datasetOf(String(input));
    if (dataset === "TaiwanStockPrice") return respond(fixture.prices);
    if (dataset === "TaiwanStockSplitPrice") return splitResponse();
    return respond([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchTwDailyClose：0050 跨 2025-06-18 一拆四", () => {
  beforeEach(() => {
    quotaMock.mockReset();
    quotaMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("分割前的收盤還原到分割後的量級，最後一列等於實際收盤", async () => {
    stubFetch();
    const series = await fetchTwDailyClose("0050", "2025-01-01");

    expect(series).toHaveLength(fixture.prices.length);
    expect(series.at(-1)).toEqual({ date: "2026-09-30", close: 112.05 });
    const ratio = 47.16 / 188.65;
    expect(series[0].close).toBeCloseTo(194.05 * ratio, 6);
    // 06-11～06-17 停牌，分割前最後一個交易日是 06-10；兩天之間不該出現 75% 的斷層。
    const before = series.find((r) => r.date === "2025-06-10")!;
    const after = series.find((r) => r.date === "2025-06-18")!;
    expect(after.close / before.close).toBeGreaterThan(0.8);
  });

  it("試算：分割前投入 10 萬，模擬市值不會只剩四分之一", async () => {
    stubFetch();
    const series = await fetchTwDailyClose("0050", "2025-01-01");
    const sim = simulateBuyAndHold([{ date: "2025-01-02", amount: -100_000 }], series);
    // 用還原後的價格：100000 / (194.05 × 比例) 股 × 112.05
    const expected = (100_000 / (194.05 * (47.16 / 188.65))) * 112.05;
    expect(sim.finalValue).toBeCloseTo(expected, 4);
    expect(sim.returnPct).toBeGreaterThan(1);
  });

  it("分割資料抓不到時回空陣列，不回傳沒還原的序列", async () => {
    stubFetch(() => respond(null, 400));
    await expect(fetchTwDailyClose("0050", "2025-01-01")).resolves.toEqual([]);
  });
});
