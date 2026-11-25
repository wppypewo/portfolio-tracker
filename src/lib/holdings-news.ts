import type { GroundingMetadata } from "./gemini";

/**
 * 持股新聞（Gemini＋Google 搜尋 grounding）的純函式部分。
 * 呼叫與權限檢查在 src/app/admin/news/actions.ts。
 *
 * 送給 Google 的只有代號、帳戶名稱與市場，不送數量、市值與成本：
 * 找新聞用不到，送了只是多一份持倉資料留在別人那裡。
 */

export type NewsAccount = {
  name: string;
  symbol: string | null;
  price_market: string;
  quantity: number;
  last_unit_price: number | null;
  last_fx_rate: number;
};

const MARKET_LABEL: Record<string, string> = {
  us: "美股",
  tw: "台股",
  crypto: "加密貨幣",
};

// 一次搜太多檔，模型會每檔只搜一兩句、各檔都寫不深；15 檔是實際持股數的上限附近。
export const MAX_SYMBOLS = 15;

/** 有代號、非手動估值的帳戶，依市值由大到小，同代號只留一筆。 */
export function pickHoldings(accounts: readonly NewsAccount[]) {
  const value = (a: NewsAccount) =>
    Number(a.quantity) * Number(a.last_unit_price ?? 0) * Number(a.last_fx_rate ?? 1);
  const seen = new Set<string>();
  const out: { symbol: string; name: string; market: string }[] = [];
  for (const a of [...accounts].sort((x, y) => value(y) - value(x))) {
    const symbol = a.symbol?.trim();
    if (!symbol || !(a.price_market in MARKET_LABEL)) continue;
    const key = `${a.price_market}:${symbol.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol, name: a.name, market: MARKET_LABEL[a.price_market] });
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

export const NEWS_SYSTEM = `你替一位個人投資者整理他持有標的的近期新聞，用繁體中文（台灣用語）。

規則：
1. 用 Google 搜尋找過去 7 天內、與各標的直接相關的消息：財報、公司或基金公告、配息、成分股或指數調整、法規、重大訴訟。
2. 每檔最多兩則，每則一句話並標出日期（YYYY-MM-DD）。找不到近 7 天的消息就寫「近 7 天沒有找到相關消息」，不要拿更早的新聞充數。
3. 只陳述事實。不給買賣、加減碼建議，不預測價格，不評論該不該持有。
4. 輸出純文字，不用 Markdown 符號。每檔一段，段首寫「代號 名稱」，段與段之間空一行。`;

export function buildNewsPrompt(
  holdings: readonly { symbol: string; name: string; market: string }[],
  today: string,
): string {
  const lines = holdings.map((h) => `- ${h.symbol}（${h.name}，${h.market}）`);
  return `今天是 ${today}（台北時間）。我持有：\n${lines.join("\n")}`;
}

/**
 * 從 grounding 取出來源連結。只放行 https：這些網址會變成頁面上的 <a href>，
 * 擋掉 javascript: 之類的協定。
 */
export function groundingSources(g: GroundingMetadata | null) {
  const out: { uri: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const chunk of g?.groundingChunks ?? []) {
    const uri = chunk.web?.uri;
    if (!uri || seen.has(uri)) continue;
    try {
      if (new URL(uri).protocol !== "https:") continue;
    } catch {
      continue;
    }
    seen.add(uri);
    out.push({ uri, title: chunk.web?.title?.trim() || new URL(uri).hostname });
  }
  return out;
}

/**
 * Search Suggestions 的 HTML 必須原樣顯示（Grounding with Google Search 的條款）。
 * 頁面用不帶 allow-scripts 的 sandbox iframe 裝它：裡面就算混進 script 也不會執行。
 * 只在外面包文件殼與 <base target="_blank">，讓建議 chip 開新分頁，
 * 否則點了會在 iframe 裡導向 google.com，被對方的 X-Frame-Options 擋成空白。
 */
export function suggestionsDocument(renderedContent: string | undefined): string | null {
  if (!renderedContent) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${renderedContent}</body></html>`;
}
