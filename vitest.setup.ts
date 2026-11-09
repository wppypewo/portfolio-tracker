// Next 的 node 執行期在載入任何模組前，會把 AsyncLocalStorage 掛到 globalThis
// （next/dist/server/node-environment-baseline.js）。vitest 不會跑那段，
// 少了它 Next 改用會丟 Invariant 的假實作：CI 的 Node 20 上 import src/proxy.ts
// 就失敗（proxy.matcher.test.ts）。這裡照 Next 的做法先補上。
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as { AsyncLocalStorage?: unknown };
if (typeof g.AsyncLocalStorage !== "function") {
  g.AsyncLocalStorage = AsyncLocalStorage;
}
