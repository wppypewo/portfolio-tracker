<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# StackWorth 專案交接文件

這是個人投資組合追蹤工具，已上線運作中。本檔給任何接手的 AI 代理人（Claude Code / Codex CLI / Cursor / Windsurf / Aider 等）看，提供完整脈絡。

## 一、專案基本資料

- **路徑（Windows）**：`D:\ClaudeCode\projects\portfolio-tracker`
- **GitHub**：`github.com/zhuang060329-bit/portfolio-tracker`（public）
- **部署**：`https://portfolio-tracker-two-rho.vercel.app`
- **當前狀態**：上線運作中，目前版本 **v1.2.0**（2026-08-18）。v1.0 原始碼有 32 個 app page/API 入口，測試數量以 `npm run test:unit` 與 `npm run test:integration` 實際輸出為準。各版本變更見 `CHANGELOG.md`
- **完整背景文件**：`docs/StackWorth-專案紀實.pdf`（15 頁，繁中）

## 二、技術棧

| 層 | 選擇 |
|---|---|
| 前端框架 | Next.js 16.3.4（Turbopack；Proxy 取代 Middleware；async cookies、async params） |
| React | 19（useActionState、useSyncExternalStore、Suspense for useSearchParams） |
| 樣式 | Tailwind v4，`@custom-variant dark` 對應 `[data-theme="dark"]` |
| 圖表 | Recharts；首頁儀表板為手刻 SVG |
| 動畫 | CSS keyframes 為主；`motion`、`gsap` 只用在隔離的 client 葉節點（規則見 `.claude/rules/design.md`） |
| 後端 | Supabase（Auth + Postgres + RLS + service-role for cron） |
| 認證 | Email/密碼 + Google OAuth + MFA TOTP（AAL2 強制） |
| 部署 | Vercel Hobby + GitHub auto-deploy |
| 排程 | Vercel Cron 每日 06:00 UTC（= 台北 14:00） |
| 報價 | Twelve Data（美股 + USD/TWD）、FinMind（台股 + 0050 + 歷史匯率）、CoinGecko（加密） |
| 測試 | Vitest（測試數量以 `npm run test` 實際輸出為準） |
| 監控 | Sentry SDK（DSN 未設則 no-op；**動態 import**，見第七節） |

## 三、目錄重點

```
src/
├── app/
│   ├── page.tsx                 ← 首頁（hero + 圖表 + 指標 + holdings）
│   ├── accounts/[id]/           ← 帳戶詳情 + actions（addByAmount, sellQuantity, ...）
│   ├── accounts/new/{stock,crypto,manual}/  ← 新增帳戶（client components）
│   ├── activity/                ← 變動紀錄列表 + CSV 匯入
│   ├── alerts/                  ← 警示 CRUD
│   ├── notifications/           ← 通知中心
│   ├── decisions/               ← 決策日誌 + 檢討
│   ├── history/                 ← 歷史重播 + 報酬歸因
│   ├── reports/monthly/         ← 月報 + 列印輸出
│   ├── whatif/                  ← What-if + 投資組合壓力測試
│   ├── about/                   ← 公開介紹頁（未登入可看；動畫例外見 .claude/rules/design.md）
│   ├── admin/allowlist/         ← Admin 使用者管理
│   ├── auth/{callback,mfa,reset-password,signout}/
│   ├── api/cron/refresh/        ← Vercel cron 入口
│   ├── api/export/csv/          ← 全部交易 CSV
│   ├── api/export/tax-csv/      ← 年度稅務報表
│   ├── login/, settings/
│   ├── fonts/                   ← 自架字體 woff2（由 scripts/build-fonts.py 產生）
│   ├── layout.tsx, loading.tsx, error.tsx, not-found.tsx
│   └── globals.css              ← CSS 變數系統
├── components/
│   ├── AppHeader.tsx            ← 導覽 + 鈴鐺（unreadCount prop）
│   ├── SiteFooter.tsx           ← 全站頁尾（標題欄），掛在 root layout
│   ├── survey.tsx               ← PageHead、Panel、Stat、EmptyPlot 等測繪桌共用元件
│   ├── DemoV1Header.tsx         ← 公開 /demo 專屬導覽（總覽/日誌/歷史/壓力/月報）
│   ├── PortfolioCharts.tsx      ← 帳戶詳情頁用 Recharts 版（AllocationPie, NetWorthLine）
│   ├── NetWorthPanel.tsx        ← 範圍切換（1M/3M/6M/1Y/ALL）+ NetWorthLine
│   ├── QuickAddFab.tsx          ← 首頁右下浮動 + 快速記帳
│   ├── PrivacyToggle.tsx / ThemeToggle.tsx  ← useSyncExternalStore 實作
│   └── dashboard/              ← 首頁儀表板（手刻 SVG 圖表）
│       ├── DashboardClient.tsx, Hero.tsx, Holdings.tsx, MetricsCard.tsx
│       ├── TrendSection.tsx, AllocationCard.tsx, DashboardCharts.tsx
│       ├── chart-data.ts, shared.tsx, types.ts, useCountUp.ts
├── lib/
│   ├── prices/                  ← {twelvedata,finmind,coingecko,fx,router,types,http}.ts
│   ├── xirr.ts, metrics.ts      ← 報酬指標（含測試）
│   ├── whatif.ts                ← Buy-and-hold 模擬（含測試）
│   ├── csv.ts                   ← EXPORT_CSV_HEADER（匯出匯入共用）、escapeCsvCell
│   ├── csv-import-helpers.ts    ← 欄位嗅探、型別別名、列別判定（含測試）
│   ├── csv-import-plan.ts       ← CSV 解析 + 匯入規劃（純函式，含往返測試）
│   ├── alerts-scan.ts           ← cron 內呼叫的警示掃描
│   ├── alert-actions.ts, allowlist-actions.ts, profile-actions.ts
│   ├── contributions.ts         ← applyContribution 共用 helper
│   ├── cost-correction.ts       ← 校正成本的換算與備註（純函式，含測試）
│   ├── dca-tiers.ts             ← 定期定額級距加減碼的判定與金額（純函式，含測試）
│   ├── total-return-series.ts   ← 由股價、除權息、分割重建含息序列（純函式，含測試）
│   ├── dca-tier-status.ts       ← 帳戶頁計劃列要顯示的級距狀態（純函式，含測試）
│   ├── recurring-tier-amount.ts ← cron 執行級距計劃時要帶的本期金額（含測試）
│   ├── notifications.ts         ← getUnreadCount
│   ├── admin.ts                 ← isAdmin(email)
│   ├── dates.ts                 ← todayTaipei()
│   └── supabase/{server,client,service,proxy}.ts
└── proxy.ts                     ← 根 proxy 入口（matcher 排除 static / cron）

supabase/                        ← SQL 檔（執行順序見 supabase/README.md）
├── schema.sql, recurring-plans.sql, cost-basis.sql,
├── realized-pnl-cashflow.sql, batch2-schema.sql,
├── open-signup.sql, alerts.sql

scripts/
└── build-fonts.py               ← 產生 src/app/fonts/（不在建置流程內，見第七節）

docs/
├── StackWorth-專案紀實.pdf      ← 完整背景（小白版）
└── build_pdf.py                 ← 生成腳本（reportlab + 微軟正黑體）

vercel.json                      ← Cron 設定 0 6 * * *
vitest.config.ts                 ← 測試設定（數量以 npm run test 為準）
```

## 四、環境變數

在 Vercel 已設、本機在 `.env.local`：

| 變數 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key |
| `SUPABASE_SECRET_KEY` | cron / admin 用，繞過 RLS（即 service-role 金鑰） |
| `TWELVE_DATA_API_KEY` | 美股報價 + USD/TWD |
| `FINMIND_TOKEN` | 台股 + 歷史匯率 |
| `CRON_SECRET` | Bearer token 驗證 cron 路由 |
| `ADMIN_EMAILS` | 逗號分隔 admin email（未設則無 admin） |
| `SENTRY_DSN`（選用） | 設了才會回報 |
| `API_BUDGET_TWELVEDATA`（選用） | 美股／匯率每日呼叫上限，未設為 500 |
| `API_BUDGET_FINMIND`（選用） | 台股／匯率每日呼叫上限，未設為 500 |
| `API_BUDGET_COINGECKO`（選用） | 加密每日呼叫上限，未設為 500 |

> 三個 `API_BUDGET_*` 的預設值 500 是保守的自訂預算，**不是**各家 API 公布的額度。
> 請依你實際的方案自行設定。填 0 代表完全停用該來源；填錯（負數、小數、非數字）
> 會退回預設值而不是關掉守門。

## 五、開發 / 驗證指令

```bash
cd portfolio-tracker

# 型別
npx tsc --noEmit

# Lint
npx eslint src

# 單元測試
npm run test:unit

# Postgres 整合測試（需要獨立測試資料庫）
TEST_DATABASE_URL=postgresql://... npm run test:integration

# 完整 build（自動跑 tsc）
NEXT_TELEMETRY_DISABLED=1 npx next build

# 本機開發
npm run dev   # Mac 也可用工作區根的 start-dev-portfolio.command（不在本 repo 內）
```

## 六、上線流程

1. 改 code → 跑 lint、typecheck、單元測試、Postgres 整合測試、production build
2. `git commit` → push 功能分支 → 建立 PR
3. Vercel 自動部署（GitHub webhook）
4. 若 schema 變更：先在測試環境驗證 versioned migration，再由使用者核准正式環境套用

## 七、重要設計決策

- **顏色慣例**：賺綠虧紅（西方慣例，非台股紅漲綠跌）— 因為 UI 對國際使用者開放
- **XIRR**：資料 < 30 天不顯示（避免短期波動年化後失真，例 5 天虧 10% 算成 -99% 年化）
- **Total return**：已實現損益 = 0 時不顯示（避免和「未實現」重複）
- **Performance benchmark**：SPY/QQQ 必須 × 當日 USD/TWD 換成 TWD 才能與組合公平比較
- **TWR vs XIRR**：TWR 剔除現金流時機，反映策略；XIRR 是現金流加權，反映實際投入回報
- **What-if 模擬**：只算「投入」（負現金流），buy-and-hold，不考慮配息再投資/交易成本
- **AppHeader unreadCount**：每個 server page 自己 fetch 傳入（保持 sync 元件，避免 client pages 不能 render async server component 的問題）
- **CSS 變數系統**：避免硬編碼顏色，`:root` 是深色、`[data-theme="light"]` 覆寫
- **視覺語言是「測繪桌 Survey Table」**（2026-09-26 起翻新，2026-09-27 併入 main，`2222999`）：
  冷紙底、製圖格線、圓角 0、髮絲線、Plex Mono 等寬數字。跌色（磚紅）與朱砂註記
  刻意分成兩個色，朱砂只用在帶文字與虛線引線的「注意」註記。細節見 `.claude/rules/design.md`
- **字體自架**：拉丁兩支走 `next/font/local`，繁中走腳本產生的 `@font-face` 切片（見本條末段），
  檔案 commit 在 `src/app/fonts/`，
  由 `scripts/build-fonts.py` 產生（需要 Python + fonttools，**不在建置流程內**，
  Vercel 不需要 Python）。動機是 `next/font/google` 建置時抓 Noto Sans TC 會失敗。
  注意 `next/font/google` 本來就已經自架了，執行期不連 Google，所以這次換的是
  「建置期的外部相依」，不是「執行期的外部相依」。
  取捨（實測）：Google 版把 TC 切成 105 片、瀏覽器按 unicode-range 取用，
  首次進首頁下載 1,137 KB / 17 個請求，逛完全站累計 1,641 KB / 28 個請求；
  `next/font/local` 沒辦法逐檔宣告 unicode-range，改成一包 Big5 常用字
  （5,907 字、1,683 KB、1 個請求），首頁多 546 KB，但之後不再有任何字體請求。
  2026-09-26 起是三支：IBM Plex Sans（變數，拉丁，46.6 KB / 248 字）、
  IBM Plex Mono（上游沒有變數檔，收 400 / 500 / 600 三個靜態字重，
  字集是可列印 ASCII 加 ± · × – — … ← ↑ → ↓ − ≈，各 10.2 / 10.5 / 11.1 KB、108 字）、
  Noto Sans TC（變數，1,683.5 KB / 5,907 字）。Newsreader 襯線已移除。
  Δ（U+0394）上游 Plex Mono 沒有，會掉到 Plex Sans。
  字體角色在 `globals.css` 的 `@theme inline`：`font-display` 是標題、`font-mono` 是數字與註記；
  全站 `.tnum` 一律走 Mono。
  Noto Sans TC 的字集是 Big5 符號區 + 常用字 + 17 個 UI 專用符號（`▸ ✓ ← ↑` 等，其中
  6 個上游 Noto Sans TC 本來就沒有，維持掉到系統字體，與改動前一致）。
  改動 UI 文案後跑 `python scripts/build-fonts.py --audit` 檢查有沒有掉字。
  subset 保留全部 layout features，`tnum` / `lnum` 在，金額欄位對齊不受影響。
  **2026-10-11 起繁中改成切片載入**（使用者核准）：上面「一包 1,683 KB」讓 Lighthouse
  行動版 LCP 落在 11 秒多、效能分數 56。`next/font/local` 宣告不了 unicode-range，
  所以繁中不走 next/font，改由 `scripts/build-fonts.py` 從 `NotoSansTC-big5.woff2`
  切出 `NotoSansTC-ui.woff2`（原始碼字串裡出現的 804 字，去掉註解與測試檔，228 KB）
  與 `NotoSansTC-f00…f10.woff2`（其餘字照 Google Fonts 的常用度分組，每片約 450 字、
  76–189 KB），並產生 `src/app/fonts/noto-sans-tc.css`（`layout.tsx` 引入，
  字族名 `StackWorth TC`，`--font-tc` 定義在 `globals.css`）。
  實測 production build：`/about`、`/demo`、`/login`、`/demo/report` 都只下載 UI 片，
  字體合計 1,761 KB → 306 KB；Lighthouse 行動版 `/about` 效能 56 → 72–80、
  LCP 11.4 → 4.2 秒，`/demo` 56 → 77–78。代價：`noto-sans-tc.css` 列出全部字的
  unicode-range，41 KB（gzip 15.7 KB），是會擋渲染的 CSS；使用者自己輸入的字
  （帳戶名、備註）若不在 UI 片，會多下載對應的常用度切片。
  改了 UI 文案後跑 `python scripts/build-fonts.py --tc-slices` 重切（不需要重新下載上游）；
  沒重切也不會掉字，只是新字落在常用度切片、多一個請求。
  `NotoSansTC-big5.woff2` 不再被網頁引用，留著當切片來源與分享圖（`scripts/demo-og/`）用的整包字。
- **CSV 匯入採「重放狀態」而非「重跑計算」**：匯入的每一列直接照抄檔案裡的
  `Qty after` / `Unit price` / `FX` / `Cashflow` / `Realized PnL` / `Fee`，
  帳戶終態取每個帳戶**時間上**最後一列（匯出檔是由新到舊排序，務必先排序）。
  不要改成重用 `applyContribution`：它對每一列無條件呼叫 `getQuote()`
  （N 列 = N 次即時報價，會撞 API 每日預算），而且用**今天**的價格把 TWD
  換算成股數，匯入歷史買進會算出錯誤股數。
  重放狀態另有一個好處：加碼與股數調整在 DB 裡都是 `adjust_quantity`，
  匯出檔分不出來，但兩者終點狀態一樣，不需要知道當初是哪個操作。
- **匯出的成本基礎是帳戶當前值，不是逐筆歷史值**：`transactions` 表沒有任何
  成本基礎欄位，`cost_basis_twd` / `cost_basis_native` 只存在於 `accounts`。
  所以匯出欄名冠 Account，同一帳戶每列都印同一個數字。匯入取最後一列還原終態。
  代價：手動刪列後再匯入，這個值仍屬於完整歷史，跟保留的子集對不上。
- **部位異動只能匯進尚無交易的帳戶**：`create` / `adjust_quantity` /
  `adjust_balance` / `sell` 設定的是絕對狀態，寫進已有歷史的帳戶等於拿另一段
  歷史的終值覆蓋現況，而且錯得很安靜。配息與利息是增量，任何帳戶都可以。
  重複偵測用「同帳戶 + 同時間 + 同型別」指紋，不需要 schema 支援。
- **匯出表頭是 `lib/csv.ts` 的 `EXPORT_CSV_HEADER`**，route 與匯入測試共用同一份。
  兩端曾經默默脫鉤過：匯出寫 `Cashflow (TWD)`、匯入只認 `amount`，
  導致自家匯出檔一列都匯不回來，而當時沒有任何測試會發現。
  改匯出欄位時要連 `HEADER_ALIASES` 一起改，`csv-import-helpers` 的測試會擋。
- **Sentry 走動態 import，不用 `import * as Sentry`**。靜態 import 會把整包 SDK
  拉進「每頁必載」的底座 chunk，而且即使 `NEXT_PUBLIC_SENTRY_DSN` 沒設、
  守門的 `if` 在建置期就是 false，bundler 仍然不會 tree-shake 掉（SDK 有 side effect）。
  改成 `import("@sentry/nextjs").then(...)` 之後，底座由 244.6 KB 降到 168.5 KB gzip，
  每開一頁省 76 KB。代價是 Sentry 非同步載入，瀏覽器剛啟動那一瞬間的錯誤可能漏掉。
  涉及 `src/instrumentation-client.ts` 與 `src/app/error.tsx` 兩處，改回靜態就會退回原狀。
- **`globals.css` 有一行 `@source not "../../**/*.md";`，別刪**。Tailwind v4 的
  自動內容偵測會把 repo 裡的 `.md` 也當成模板掃，於是文件裡隨手寫的 class 名
  （包括 AGENTS.md 舉例用的）會被當成真的在用而產出 CSS。這行把 markdown 排除掉。
- **CSP 由 `src/proxy.ts` 每 request 產生 nonce，政策在 `src/lib/csp.ts`**，
  不放 `next.config.ts`（那裡的 headers 是靜態的，發不出每次不同的 nonce）。
  三件事改之前先看清楚：
  - **`style-src` 只能是 `'self' 'unsafe-inline'`**。全站 40 幾處 `style={{...}}`
    是動態算出來的顏色與寬度，SSR 後是 `style="..."` 屬性，會被 `style-src` 擋。
    而且只要該指令帶了 nonce，瀏覽器就依 CSP3 忽略 `'unsafe-inline'`，
    所以刻意不放 nonce。這不是漏做，是收不了。
  - **不要加 `'strict-dynamic'`**，即使官方範例有。加了 `'self'` 會被忽略，
    而 `/demo`、`/demo/whatif`、`/demo/report` 的初始 HTML 各有一支 Next 內部
    chunk（`useMergedRef`，`next/link` 用）是無 nonce 的 parser-inserted script，
    會被擋掉，那三頁的 `next/link` 就失效。Report-Only 階段以瀏覽器實測確認。
    `src/lib/csp.test.ts` 有一條測試釘住這件事。
  - **用了 nonce = 全站動態渲染**。改動前有 7 個靜態頁，之後 0 個。
    這是 Next 官方文件明列的取捨（ISR 停用、CDN 不能快取）。
- **Supabase 有 1000 列的硬上限，多筆查詢一律走 `fetchAllPages`**。PostgREST 的
  `db-max-rows` 在 Supabase 預設是 1000，而且是**硬上限不是預設值**：寫
  `.limit(10000)` 會被無聲夾回 1000，沒有 error、沒有 warning、回傳的
  `data.length` 就是 1000。2026-09-04 一次 review 在 12 個查詢裡發現這個問題，
  分三個 commit 修掉。要點：
  - 多筆查詢用 `src/lib/supabase/paginate.ts` 的 `fetchAllPages(page, pageSize, maxRows)`。
    offset 依**實際回傳列數**前進，不是依 `pageSize`——上游把頁長夾小時，
    照 `pageSize` 跳會直接跳過中間的資料。
  - **每個分頁查詢都要有穩定的次要排序**（`.order("id")` 之類）。
    只排 `snapshot_date` 這種會重複的欄位，同值列在頁邊界可能被跳過或重複。
  - **`rows.length >= LIMIT` 偵測不到截斷**。在硬上限之下永遠只會拿到 1000 列，
    LIMIT 設 10,000 時這個判斷恆為 false，「資料不完整」的提示永遠不會亮。
    要用 `fetchAllPages` 回傳的 `truncated` 旗標。`history/page.tsx` 與
    `reports/monthly/page.tsx` 兩處原本就是這樣壞的。
  - **排序方向決定被砍掉的是哪一段**。首頁 `account_snapshots` 是由舊到新排，
    截斷砍掉的是**最新**那段：淨值曲線停在幾個月前，TWR / XIRR / Sharpe / 回撤
    照樣算得出數字，只是全部錯的，畫面上沒有任何徵兆。這是「顯示錯的」，
    不是「顯示少的」。
  - `accounts` / `profiles` / `alerts` / `investment_decisions` **刻意不分頁**：
    個人使用不會接近 1000 列，加分頁只是多幾趟往返。要改成多使用者再回來看。
- **校正成本（`adjust_cost`）只改成本基礎，其他都不動**（2026-09-30 加）。
  起因：新建帳戶時成本固定等於建立當下的市值（`src/app/accounts/new/actions.ts`），
  把既有部位搬進來之後，成本與券商帳上的數字對不上，未實現損益跟著錯。
  建立帳戶那條路這次沒改，校正成本是事後補正的手段。要點：
  - **流水 `cashflow_twd` 記 0**。所以 XIRR / TWR / Sharpe / 回撤不受影響，
    代價是兩組數字的起算點不同：未實現損益從校正後的成本算起，
    XIRR 與 TWR 仍從建立帳戶當天的市值算起。表單說明有寫這件事，別刪。
  - **不抓報價**。流水與當日快照沿用帳戶的 `last_unit_price` / `last_fx_rate`，
    不花 API 每日預算；還沒有報價的帳戶不寫快照（市值會被記成 0）。
  - **外幣帳戶的 TWD 成本留空時，沿用現有的平均成本匯率**
    （`cost_basis_twd ÷ cost_basis_native`），不用最新報價匯率。
    校正的是原幣成本，換匯匯率沒有新資訊，換成最新匯率會憑空多出匯差損益。
    換算邏輯在 `src/lib/cost-correction.ts`，server action 與表單預覽共用。
  - **過去的快照不回填**。`account_snapshots` 在校正日之前的列保留舊成本，
    歷史重播選舊日期時看到的仍是舊成本。
  - **不能撤銷也不能沖銷**。`transactions` 沒有成本欄，校正前的數字只寫在備註，
    RPC 回推不了。`reverse_transaction_mutation` 對它走 else 分支直接拒絕，
    `reversalMode` 回 null 所以 UI 不顯示按鈕。填錯就再校正一次。
    副作用：校正之後，它之前的賣出不再是最新一筆，也就不能撤銷了。
  - **CSV 匯入把它當部位型別**（設定的是成本絕對值），只能匯進尚無交易的帳戶。
  - 需要 `supabase/migrations/20260930120000_adjust_cost_type.sql`（enum 加值），
    **要在程式部署前跑**，順序見 `supabase/README.md`。
- **定期定額級距加減碼**（2026-09-30 加，只支援台股）。照使用者的 TradingView 指標
  「DCA 七級距加減碼 v2 (含息序列)」算：含息序列的前高回撤決定加碼，
  高於均線的幅度決定減碼，兩者同時成立以回撤為準。要點：
  - **級距設定存在 `recurring_plans.tier_config`（jsonb，可為空）**，null 是固定金額。
    格式由 `src/lib/schemas/domain/dca-tier-config.ts` 把關，讀回來格式不對時顯示錯誤，
    不拿預設值頂替。需要 `supabase/migrations/20260930180000_recurring_tier_config.sql`，
    **要在程式部署前跑**：帳戶頁的查詢帶了這一欄，欄位不存在時整個查詢失敗。
  - **帳戶頁預填「本期金額」，cron 自動套用**（cron 這一段 2026-09-30 加）。
    cron 執行級距計劃前由 `src/lib/recurring-tier-amount.ts` 算出本期金額，
    `executeRecurringPlan` 以 `tierAmount` 帶給 RPC，流水備註寫
    「定期定額(cron·級距，基準 N)」。固定金額計劃的 cron 照舊不接受任何金額，
    手續費覆寫也照舊拒絕；RPC 以 `tier_config is not null` 當最後一道檢查。
    需要 `supabase/migrations/20260930200000_recurring_cron_tier_amount.sql`。
  - **cron 算不出級距就不買，不退回基準金額**。FinMind 失敗、額度用完、設定格式無效、
    序列最後一筆超過 14 天，該期都記成失敗（log 的 `tierFailed`），計劃維持到期、
    隔天重試。理由：回撤 30% 那天剛好抓不到資料、安靜地只買 1 倍，事後從流水看不出來。
    代價：FinMind 連續失敗時計劃會一直不執行，而且只有 Vercel log 看得到，沒有通知。
    這與手動執行不同——帳戶頁算不出級距時，「本期金額」退回基準金額、照樣可以按。
  - **cron 用的是前一個交易日的收盤**。FinMind 文件寫 `TaiwanStockPrice` 週一至五
    17:30 更新，cron 在台北 14:00 跑，所以級距判定與成交價是同一天的收盤。
    14:00 當下是否真的還沒有當日資料沒有實測過。
  - **cron 抓序列不走快取**（`fetchTwTotalReturnSeries(symbol, { fresh: true })`，
    `cache: "no-store"`），同一次執行每個代號只抓一次，每檔扣 3 次 FinMind 額度。
    `fetch` 的 `cache: "no-store"` 與 `next.revalidate` 不能同時給，Next 會兩個都忽略。
  - **金額取整到百元**（`Math.round(base × 倍數 / 100) × 100`，與 Pine Script 相同），
    所以 1 倍時也會取整：基準 3,333 的建議金額是 3,300。
  - **含息序列用 `unstable_cache` 快取一小時**（`src/lib/prices/finmind-total-return-cached.ts`）。
    `fetchTwTotalReturnSeries` 每呼叫一次先扣 3 次 FinMind 額度，裡面 fetch 的
    `revalidate` 擋不掉這個扣減。用 `unstable_cache` 而不是 `"use cache"`，
    是因為後者要開 Cache Components，而全站因 CSP nonce 是動態渲染。
    它是 stale-while-revalidate：過期後第一個請求仍拿到舊序列，所以畫面寫出
    「依 YYYY-MM-DD 收盤」。
  - **抓不到歷史股價不擋頁面**：級距計劃各帶一則朱砂註記，本期金額退回基準金額
    （只有手動執行如此，cron 見上）。
  - **沒有編輯功能**。既有計劃要改成級距，只能刪掉重建。
- **手動帳戶**：不適用 addByAmount；FAB 與部分 query 自動排除
- **服務選擇**：全部用免費額度可運作；個人單用不會撞限

## 八、已知 trade-off（暫不動）

| 項目 | 為什麼 |
|---|---|
| ~~4 種按鈕風格散在各頁~~ | **2026-09-03 已解決**：`globals.css` 收斂成一套 `.btn` class（`.btn-primary` / `.btn-neutral` / `.btn-danger` / `.btn-outline` / `.btn-outline-danger` / `.btn-ghost`，加 `.btn-sm` / `.btn-lg` / `.btn-icon` / `.btn-fit` 修飾）。行動版列表的整列可點區塊統一為 `.tap-row`。走 CSS class 而不是 React component，是因為按鈕散在 server 與 client component 兩邊，class 兩邊都能用，不必為了樣式把 server component 改成 client |
| AppHeader unreadCount 每頁 fetch | DRY 違規但只是一個 COUNT query，成本低 |
| CSV 匯入的交易寫入與帳戶更新不是原子的 | insert 成功、update 失敗時流水在但餘額沒跟上，且重試會被「帳戶已有交易」擋住。錯誤訊息已提示去看變動紀錄。要做成原子需要新 RPC 與 migration |

## 九、使用者操作（程式碼無法代勞）

部署後仍待使用者完成：

1. **必做**：到 Supabase SQL Editor 跑 `supabase/alerts.sql`（alerts + notifications 兩張表）
2. **選做**：要 email 警示就在 Vercel 加 `RESEND_API_KEY`，告知 AI 接 Resend SDK 到 `alerts-scan.ts`
3. **例行**：每年 5 月報稅前到 `/settings` 下載年度稅務報表 CSV
4. **待辦：把 CSP 從只回報改成實際攔截**。目前 `src/lib/csp.ts` 的
   `CSP_ENFORCE = false`，發的是 `Content-Security-Policy-Report-Only`，
   瀏覽器照常渲染、只在 console 記違規。
   **公開頁已在 2026-09-03 用 production build 實測完畢**——`/demo`、`/demo/whatif`、
   `/demo/report`、`/demo/history`、`/login` 走一遍，console 沒有任何
   `Refused to …` 或 `[Report Only] Refused …`。
   **剩下的只有你能做**：登入、`/settings` 的 MFA QR、Google OAuth 這三段要真實帳號。
   那三段 console 也乾淨之後，把 `CSP_ENFORCE` 翻成 `true`。
   翻的時候 `csp.test.ts` 會有兩條測試轉紅，那是刻意的提醒，一併更新即可。

   > 實測時 console 會有一則 `An unknown error occurred when fetching the script.`，
   > 那是 service worker 註冊失敗，**不是 CSP**：同一支 `/sw.js` 用 `fetch()` 拿得到 200，
   > 而且 `sw.js` 被 proxy matcher 排除、根本沒有 CSP 標頭。在瀏覽器沙箱裡才會出現。

## 十、未做但討論過的功能（按曾認可的優先級）

| 優先 | 項目 | 工作量 |
|---|---|---|
| 高 | Email 警示（接 Resend） | 小 |
| 中 | DRIP 自動再投資（配息觸發加碼） | 小 |
| 中 | 被動收入面板再拆細（月/季/年） | 小 |
| 中 | 多基準幣別（EUR/USD as base — 使用者 2026/6 月可能搬歐洲） | 中 |
| 中 | 匿名 read-only 分享連結 | 中 |
| 低 | 券商 CSV 格式自動辨識（富邦/永豐/Binance/MAX） | 大（需真實 sample） |
| 低 | 自動同步券商持倉（Binance/Coinbase API key） | 大 |
| 低 | 匯率歷史 snapshot（修 cost basis 累積誤差） | 中 |

## 十一、開發約定

- 每個改動獨立 commit（使用者要求可回滾）
- Commit message 用繁中，簡短說明動機 + 做了什麼 + 驗證結果
- 重大 schema 變更必須提醒「請到 Supabase 跑 supabase/X.sql」
- 不擅自做使用者沒明說的決定；遇到設計方向選擇先問
- 不可逆操作（刪檔、覆寫、rebase --force）執行前先確認
- 跑 build / test 失敗就停下來修，不要 push 失敗的東西
- **`package.json` 加 `overrides` 時，一併寫下它的退場條件**（2026-09-03 加）。
  這裡曾有一條 `overrides.next.postcss = "8.5.10"`，寫下當時是資安修補；
  等 `next` 自己帶的 postcss 超過那個版本之後，同一條就變成把相依壓回舊版。
  override 沒有到期日，`npm audit` 也不會提醒——只能靠升級時順手複查。
  該條已於 2026-09-03 隨 Next 16.3.4 升級刪除。

## 十二、近期 commit 歷程（最新在前）

執行 `git log --oneline -20` 看完整紀錄。每個 commit 訊息寫了動機與驗證結果。
完整開發階段見 `docs/StackWorth-專案紀實.pdf` 第 6 章。
