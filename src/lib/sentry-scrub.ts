// 送到 Sentry 之前把請求裡的憑證遮掉。
//
// @sentry/nextjs 10.x 的 captureRequestError（onRequestError hook）會把整份
// request headers 與 cookie 原樣放進 event；sendDefaultPii 沒開也一樣，SDK 的
// 遮蔽清單只套用在 span 屬性上。不擋的話，cron 的
// `Authorization: Bearer <CRON_SECRET>` 與 Supabase 的 auth cookie 都會送出去。
import type { Event } from "@sentry/nextjs";

const FILTERED = "[Filtered]";

// header 名稱含這些片段就遮蔽值：涵蓋 authorization、cookie、x-api-key 這類欄位
const SENSITIVE_HEADER = /auth|cookie|token|secret|key|session|password|signature/i;

export function scrubSentryEvent<T extends Event>(event: T): T {
  const request = event.request;
  if (!request) return event;

  return {
    ...event,
    request: {
      ...request,
      ...(request.headers && {
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [
            name,
            SENSITIVE_HEADER.test(name) ? FILTERED : value,
          ]),
        ),
      }),
      // cookie 名稱留著方便除錯，值一律遮掉
      ...(request.cookies && {
        cookies: Object.fromEntries(
          Object.keys(request.cookies).map((name) => [name, FILTERED]),
        ),
      }),
    },
  };
}
