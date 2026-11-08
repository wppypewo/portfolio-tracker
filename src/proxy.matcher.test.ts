import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "./proxy";

// 驗 proxy 的 matcher：哪些路徑會進 proxy（要登入、會被 307 到 /login），
// 哪些直接當靜態檔回。matcher 跟登入導向綁在一起，改它時靠這份測試確認
// 沒有把需要登入的頁面意外放出去。
function 進proxy(path: string) {
  return unstable_doesMiddlewareMatch({ config, url: `https://example.test${path}` });
}

describe("proxy matcher", () => {
  it("robots.txt 不進 proxy：爬蟲要能讀到 Disallow，而不是被導去 /login", () => {
    expect(進proxy("/robots.txt")).toBe(false);
  });

  it.each(["/sw.js", "/offline.html", "/manifest.webmanifest", "/icon.svg", "/og/cover.png", "/favicon.ico", "/api/cron/refresh"])(
    "既有排除項維持不進 proxy：%s",
    (path) => {
      expect(進proxy(path)).toBe(false);
    },
  );

  it.each(["/", "/accounts", "/login", "/admin", "/api/export", "/robots.txt.bak", "/robots", "/foo/robots.txt"])(
    "頁面與 API 照常進 proxy：%s",
    (path) => {
      expect(進proxy(path)).toBe(true);
    },
  );
});
