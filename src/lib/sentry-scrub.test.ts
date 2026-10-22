import * as Sentry from "@sentry/nextjs";
import type { Event } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "./sentry-scrub";

describe("scrubSentryEvent", () => {
  it("遮掉 Authorization、cookie 與 API key，其他 header 保留", () => {
    const event: Event = {
      request: {
        method: "GET",
        headers: {
          authorization: "Bearer CRON_SECRET_VALUE",
          cookie: "sb-abc-auth-token=JWT; theme=dark",
          "x-api-key": "KEY",
          "user-agent": "vercel-cron/1.0",
        },
        cookies: { "sb-abc-auth-token": "JWT", theme: "dark" },
      },
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.headers).toEqual({
      authorization: "[Filtered]",
      cookie: "[Filtered]",
      "x-api-key": "[Filtered]",
      "user-agent": "vercel-cron/1.0",
    });
    expect(scrubbed.request?.cookies).toEqual({
      "sb-abc-auth-token": "[Filtered]",
      theme: "[Filtered]",
    });
    expect(scrubbed.request?.method).toBe("GET");
  });

  it("不改動傳入的 event", () => {
    const headers = { authorization: "Bearer CRON_SECRET_VALUE" };
    scrubSentryEvent({ request: { headers } });
    expect(headers.authorization).toBe("Bearer CRON_SECRET_VALUE");
  });

  it("沒有 request 的 event 原樣回傳", () => {
    const event: Event = { message: "plain" };
    expect(scrubSentryEvent(event)).toBe(event);
  });

  // 用真的 SDK 走一次 onRequestError 的路徑：SDK 升版後若改了 request 的放法，這裡會先紅。
  it("掛在 beforeSend 後，captureRequestError 送出的 event 不含憑證", async () => {
    // 秘密值在執行期組出來：SDK 的 ContextLines 會把這個測試檔的原始碼行放進
    // stack frame，寫成完整字面值的話，原始碼本身就會讓斷言誤判外洩。
    const cronSecret = ["cron", "secret", "value"].join("-");
    const jwt = ["jwt", "value"].join("-");
    const bodies: string[] = [];
    Sentry.init({
      dsn: "https://public@o0.ingest.sentry.io/0",
      enabled: true,
      tracesSampleRate: 0,
      beforeSend: scrubSentryEvent,
      transport: () =>
        Sentry.createTransport({ recordDroppedEvent() {} }, async (request) => {
          bodies.push(String(request.body));
          return { statusCode: 200 };
        }),
    });

    Sentry.captureRequestError(
      new Error("boom"),
      {
        path: "/api/cron/refresh",
        method: "GET",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          cookie: `sb-abc-auth-token=${jwt}`,
        },
      },
      {
        routerKind: "App Router",
        routePath: "/api/cron/refresh",
        routeType: "route",
      },
    );
    await Sentry.flush(2000);

    const sent = bodies.join("\n");
    expect(sent).toContain("boom");
    expect(sent).not.toContain(cronSecret);
    expect(sent).not.toContain(jwt);
  });
});
