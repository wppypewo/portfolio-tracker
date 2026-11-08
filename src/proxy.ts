import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import {
  buildCsp,
  createNonce,
  CSP_REQUEST_HEADER,
  CSP_RESPONSE_HEADER,
  NONCE_HEADER,
} from "@/lib/csp";

// Next 16 的 Proxy（前身為 Middleware）。每個 request 先產生 CSP nonce，
// 再刷新 Supabase session，未登入則導向 /login。
//
// nonce 必須在渲染前就進到 request 標頭裡：Next 從 request 上的
// Content-Security-Policy 解析出 nonce，自動加到框架 script 與自家的 inline
// script 上。手寫的 inline script（layout.tsx 的主題初始化）不在自動範圍內，
// 得自己從 x-nonce 讀出來掛上去。
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const response = await updateSession(request, {
    [NONCE_HEADER]: nonce,
    [CSP_REQUEST_HEADER]: csp,
  });

  // 導向回應也要帶上，否則 /login 這類經過 redirect 的頁面就沒有政策。
  response.headers.set(CSP_RESPONSE_HEADER, csp);
  return response;
}

export const config = {
  // 排除靜態資源、圖檔與 cron route（cron 自己驗 CRON_SECRET）。
  // sw.js / offline.html / manifest 必須公開可達：SW 註冊與 PWA 安裝
  // 都發生在瀏覽器背景 fetch，被 307 到 /login 會整個裝不起來。
  // robots.txt 同理：內容是 Disallow: /，爬蟲被導去 /login 就讀不到。
  // 只排除根目錄這一個檔（加 $），/robots.txt.bak 之類仍要登入。
  // 行為由 proxy.matcher.test.ts 釘住。
  //
  // 這些排除掉的路徑也拿不到 CSP 標頭。offline.html 是純靜態頁、
  // sw.js 由 worker-src 管，影響有限；matcher 本身跟登入導向綁在一起，
  // 為了 CSP 動它風險大於收益。
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|sw\\.js|offline\\.html|manifest\\.webmanifest|robots\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
