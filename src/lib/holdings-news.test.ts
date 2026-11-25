import { describe, expect, it } from "vitest";
import {
  buildNewsPrompt,
  groundingSources,
  MAX_SYMBOLS,
  pickHoldings,
  suggestionsDocument,
  type NewsAccount,
} from "./holdings-news";

const a = (over: Partial<NewsAccount>): NewsAccount => ({
  name: "x",
  symbol: "X",
  price_market: "us",
  quantity: 1,
  last_unit_price: 1,
  last_fx_rate: 1,
  ...over,
});

describe("pickHoldings", () => {
  it("依市值排序、略過手動估值與無代號、同代號只留一筆", () => {
    const out = pickHoldings([
      a({ name: "小", symbol: "AAA", last_unit_price: 10 }),
      a({ name: "大", symbol: "BBB", last_unit_price: 100 }),
      a({ name: "重複", symbol: "bbb", last_unit_price: 5 }),
      a({ name: "現金", symbol: null, price_market: "manual" }),
      a({ name: "手動", symbol: "ZZZ", price_market: "manual" }),
      a({ name: "台積電", symbol: "2330", price_market: "tw", last_unit_price: 50 }),
    ]);
    expect(out).toEqual([
      { symbol: "BBB", name: "大", market: "美股" },
      { symbol: "2330", name: "台積電", market: "台股" },
      { symbol: "AAA", name: "小", market: "美股" },
    ]);
  });

  it(`最多 ${MAX_SYMBOLS} 檔`, () => {
    const many = Array.from({ length: 30 }, (_, i) => a({ symbol: `S${i}` }));
    expect(pickHoldings(many)).toHaveLength(MAX_SYMBOLS);
  });
});

it("prompt 不含數量與金額", () => {
  const p = buildNewsPrompt([{ symbol: "VOO", name: "S&P", market: "美股" }], "2026-11-25");
  expect(p).toContain("VOO（S&P，美股）");
  expect(p).toContain("2026-11-25");
});

describe("groundingSources", () => {
  it("只放行 https，去重，沒有標題時用網域", () => {
    const out = groundingSources({
      groundingChunks: [
        { web: { uri: "https://a.example/x", title: "a.example" } },
        { web: { uri: "https://a.example/x", title: "dup" } },
        { web: { uri: "javascript:alert(1)", title: "bad" } },
        { web: { uri: "http://plain.example/", title: "http" } },
        { web: { uri: "https://b.example/y" } },
        {},
      ],
    });
    expect(out).toEqual([
      { uri: "https://a.example/x", title: "a.example" },
      { uri: "https://b.example/y", title: "b.example" },
    ]);
  });
  it("沒有 grounding 回空陣列", () => {
    expect(groundingSources(null)).toEqual([]);
  });
});

describe("suggestionsDocument", () => {
  it("原樣嵌入 renderedContent，只外包文件殼與 base target", () => {
    const html = '<style>.x{}</style><a class="chip" href="https://www.google.com/search?q=a">a</a>';
    const doc = suggestionsDocument(html)!;
    expect(doc).toContain(html);
    expect(doc).toContain('<base target="_blank">');
  });
  it("沒有內容時回 null", () => {
    expect(suggestionsDocument(undefined)).toBeNull();
    expect(suggestionsDocument("")).toBeNull();
  });
});
