import type { PriceProvider } from "./types";
import { fetchWithRetry } from "./http";
import { consumeApiQuota } from "@/lib/api-budget";
import { buildTotalReturnSeries } from "@/lib/total-return-series";
import { getCachedTwSplits } from "./finmind-total-return-cached";
import { parseFinmindPrices } from "./finmind-total-return";

/**
 * 台股歷史日 close，已還原分割、不含配息。給績效對照與 What-if 模擬用。
 * 1 小時 cache；失敗回空陣列由呼叫端 fallback。
 *
 * 分割一定要還原：0050 在 2025-06-18 一拆四，原始收盤從 188.65 掉到 47.16。
 * 不還原的話，首頁對照線在那天掉 75%，試算頁用分割前的價格買、分割後的價格估值，
 * 補登到那天以前的投入會只剩四分之一。分割資料抓不到時回空陣列，寧可少一條線，
 * 也不畫錯的線。
 */
export async function fetchTwDailyClose(
  symbol: string,
  startDate: string,
): Promise<{ date: string; close: number }[]> {
  if (!startDate) return [];
  try {
    // 例外會被下面的 catch 收成空陣列，呼叫端本來就有 fallback。
    await consumeApiQuota("finmind");
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(
      symbol,
    )}&start_date=${startDate}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.FINMIND_TOKEN ?? ""}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown };
    const prices = parseFinmindPrices(
      Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [],
    );
    if (prices.length === 0) return [];
    const splits = await getCachedTwSplits(symbol);
    // 只還原分割、不還原配息：維持原本不含配息的口徑（whatif.ts 的假設是配息當作沒發生）。
    return buildTotalReturnSeries(prices, [], splits);
  } catch {
    return [];
  }
}

// 台股：FinMind TaiwanStockPrice。回傳 TWD，免換匯。
// symbol 為台股代號（如 2330）。取期間內最後一筆的 close。
export const finmindProvider: PriceProvider = {
  market: "tw",
  async getQuote(symbol) {
    await consumeApiQuota("finmind");
    const start = new Date(Date.now() - 14 * 86400000)
      .toISOString()
      .slice(0, 10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(
      symbol,
    )}&start_date=${start}`;
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${process.env.FINMIND_TOKEN}` },
    });
    const json = await res.json();
    const rows = json?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`FinMind 找不到台股 ${symbol} 資料（代號是否正確？）`);
    }
    const last = rows[rows.length - 1];
    const price = Number(last.close);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`FinMind ${symbol} close 異常`);
    }
    return {
      unitPrice: price,
      nativeCurrency: "TWD",
      fxToBase: 1,
      asOf: `${last.date}T00:00:00+08:00`,
    };
  },
};
