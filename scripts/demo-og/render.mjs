// 產生分享圖（1200×630）。用本機 Chrome 無頭模式把 HTML 截圖：字體直接讀 src/app/fonts/ 的 woff2，
// 中文不必另外內嵌進 next/og。不在建置流程內，改了 HTML 才需要手動重跑：
//   node scripts/demo-og/render.mjs          → og.html       → public/og/demo.png（Demo 五頁共用，見 src/lib/demo-metadata.ts）
//   node scripts/demo-og/render.mjs about    → og-about.html → public/og/about.png（介紹頁 /about）
// 曲線是 2026-10-06 從 /demo 趨勢圖（預設 6M）取下的形狀，寫死在 og.html，
// Demo 序列依日期滾動，所以這張圖只示意走勢，不對應任何一天的數字。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? "demo";
const source = name === "demo" ? "og.html" : `og-${name}.html`;
const out = resolve(here, `../../public/og/${name}.png`);
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9800 + Math.floor(Math.random() * 100);
const profile = mkdtempSync(join(tmpdir(), "demo-og-"));
const chrome = spawn(
  chromePath,
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(200);
    }
  }
  if (!targets) throw new Error("Chrome 沒有在 10 秒內開好除錯埠");
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: pathToFileURL(join(here, source)).href });
  await sleep(1500);
  // 字體沒載到就停下，免得悄悄用系統字體產出一張不一樣的圖
  const failed = (
    await send("Runtime.evaluate", {
      expression: "document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family + ' ' + f.weight))",
      awaitPromise: true,
      returnByValue: true,
    })
  ).result.result.value;
  if (failed.length) throw new Error(`字體載入失敗：${failed.join("、")}`);
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`已寫入 ${out}`);
} finally {
  // 等 Chrome 真的退出再刪 profile：kill 之後子行程還會寫幾個檔，直接刪會 ENOTEMPTY
  const exited = chrome.exitCode !== null ? Promise.resolve() : new Promise((r) => chrome.once("exit", r));
  chrome.kill("SIGKILL");
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
