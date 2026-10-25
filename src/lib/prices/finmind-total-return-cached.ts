// 僅供伺服器端使用（裡面會經 api-budget 用到 service client）。嚴禁在前端 import 此檔。
import { unstable_cache } from "next/cache";
import { fetchTwTotalReturnSeries } from "./finmind-total-return";

/**
 * 含息序列的快取版，給帳戶頁用。
 *
 * fetchTwTotalReturnSeries 每呼叫一次就先扣 3 次 FinMind 額度，
 * 而它裡面的 fetch 雖然有 `next: { revalidate: 3600 }`，擋掉的只是 HTTP 請求，
 * 額度照扣。帳戶頁每開一次、每送一次表單都會重新渲染，不包這一層的話
 * 逛十次帳戶頁就是 30 次額度（預設每日 500）。
 *
 * 快取的是「重建好的序列」，key 是代號，一小時內同一個代號只扣一次。
 * 失敗（含額度用完）會往上丟，不會被快取，下一次請求會重試。
 *
 * 用 unstable_cache 而不是 "use cache"：後者要開 Cache Components，
 * 這個專案沒開（全站因 CSP nonce 是動態渲染，見 docs/DESIGN_NOTES.md「設計決策」）。
 * 回呼裡不能碰 cookies / headers；consumeApiQuota 用的是 service client，不讀 cookie。
 */
export const getCachedTwTotalReturnSeries = unstable_cache(
  (symbol: string) => fetchTwTotalReturnSeries(symbol),
  ["tw-total-return-series"],
  { revalidate: 3600 },
);
