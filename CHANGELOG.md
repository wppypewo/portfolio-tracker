# Changelog

本檔記錄 StackWorth 的重要變更。格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本遵循 [語意化版本](https://semver.org/lang/zh-TW/)。

日期為台北時間（Asia/Taipei）。

## [Unreleased]

> 以下改動已完成並通過四道關卡，2026-09-03 分成 6 個 commit
> （`7f5a323`、`3eca6e8`、`a6c86c9`、`7889d53`、`bc40425`、`6c2260b`），
> 已由 `optimize/2026-09-03` 快轉合併進 `main` 並推送。尚未發版號。

### Added
- **公開介紹頁 `/about`**（2026-10-11，分支 `claude/focused-shannon-v4f1p4`）。未登入可看，
  登入頁與全站頁尾都有入口。主圖是示範資料的淨值線，描線後依序標出回撤期間與今日現值；
  其下是四個指標、地籍式配置圖、資料來源與排程、判讀圖例、安全說明。數字全取自 `/demo`
  同一份資料與計算管線。動畫只在這頁，規則見 `.claude/rules/design.md`「介紹頁例外」。
- **全站頁尾**（2026-10-11）：工程圖標題欄樣式，列版次、報價來源、判讀慣例、基準幣別，列印時隱藏。
- **定期定額級距加減碼**（2026-09-30，分支 `feat/dca-tiers`，尚未合併，只支援台股）。
  建立定期定額計劃時可選「依級距加減碼」，參數預設與 TradingView 指標
  「DCA 七級距加減碼 v2 (含息序列)」相同（200 日均線；回撤 10 / 20 / 30 / 45% 對應
  1.25 / 1.5 / 1.75 / 2 倍；高於均線 10 / 20% 對應 0.9 / 0.8 倍）。計劃列顯示前高回撤、
  高於均線幅度、目前級距與倍數，並把「本期金額」預填成建議金額（取整到百元）。
  排程的自動執行（cron）也依級距買入：用當時最新的收盤重算倍數，流水備註寫
  「定期定額(cron·級距，基準 N)」；算不出級距（FinMind 失敗、額度用完、設定格式無效、
  資料超過 14 天沒更新）時該期不買，隔天重試。固定金額計劃的行為不變。
  **需要先跑 `supabase/migrations/20260930180000_recurring_tier_config.sql`**，再部署程式；
  cron 套用級距另需 `supabase/migrations/20260930200000_recurring_cron_tier_amount.sql`
  （沒跑的話級距計劃的自動執行會被拒絕、隔天重試，不會買錯金額）。
- **校正成本**（2026-09-30，分支 `feat/adjust-cost`，尚未合併）。帳戶頁「增減股數」下方
  多一個表單，把成本基礎直接改成券商帳上的總成本，股數、報價、已實現損益都不動。
  新建帳戶時成本等於建立當下的市值，既有部位搬進來之後與券商對不上，這是補正的手段。
  新交易型別 `adjust_cost`，流水現金流記 0：XIRR / TWR 不變，未實現損益改從校正後的
  成本算起。外幣帳戶的 TWD 成本可留空（沿用現有平均成本匯率）或手填。
  這筆紀錄不能撤銷；CSV 匯出匯入認得這個型別。
  **需要先跑 `supabase/migrations/20260930120000_adjust_cost_type.sql`**，再部署程式。

### Security
- **CSP 由 `src/proxy.ts` 每 request 產生 nonce**，政策集中在 `src/lib/csp.ts`。
  目前是 `Content-Security-Policy-Report-Only`，開關是 `CSP_ENFORCE`。
  公開頁（`/demo`、`/demo/whatif`、`/demo/report`、`/demo/history`、`/login`）
  已用 production build 在真實瀏覽器實測，console 零違規；登入後的頁面、
  `/settings` 的 MFA QR、Google OAuth 三段需要真實帳號，尚未測。
- `upgrade-insecure-requests` 改成只在 `CSP_ENFORCE` 為 true 時送出。
  它在 Report-Only 政策裡依規範無效，Chrome 每次載入都會印一則假警報。
- **Next.js 16.2.11 → 16.3.4**、`eslint-config-next` 同步升級，
  `react-dom` 19.2.7 → 19.2.8（原本與 `react` 不同步）。
  `npm audit` 由 8 個 high 降到 **0 vulnerabilities**。
- 移除 `package.json` 的 `overrides.next.postcss = "8.5.10"`。寫下當時是資安修補，
  但 `next@16.3.4` 自帶 `postcss@8.5.23`，這條 override 已經變成把相依壓回舊版。

### Changed
- **繁中字體改成切片載入**（2026-10-11）：每頁 1,683 KB → 228 KB（UI 用字一片，其餘 11 片按需下載）。
  Lighthouse 行動版 `/about` 效能 56 → 72–80、LCP 11.4 → 4.2 秒。做法與代價見 AGENTS.md 字體一節。
- 未登入的訪客打開根網址改導向 `/about`（原本導向 `/login`），其他受保護頁面照舊導向登入頁。
- 公開頁（about／login／methodology／auth）載入時不再先閃出已登入首頁的骨架；關掉 JS 也看得到內容。
- 首頁淨資產趨勢（2026-10-11）：區間切換（1M…ALL）從圖下方左側移到右上，與淨值／大盤對照並排。
- 空狀態收斂成 `EmptyPlot`（2026-10-11，`src/components/survey.tsx`），10 處統一外觀。
- 原本只在 Demo 生效的三項修正延伸到登入後頁面（2026-10-11）：黏頂頁首下的 scroll-padding、
  強制色彩模式的選中狀態與量尺、深色主題列印月報的墨色。
- **按鈕統一成 `.btn` 系統**（`globals.css` + 39 個元件）。原本各處自行拼
  Tailwind utility，尺寸、圓角、focus ring、disabled 樣式互不一致；
  現在收斂成 `.btn` 加 `--primary` / `--ghost` / `--danger` 等修飾子，
  行動版觸控目標一律 ≥ 44px。顏色全部走 CSS 變數，沒有新增硬編碼色值。
- **Sentry 改成動態 import**（`instrumentation-client.ts`、`app/error.tsx`）。
  `import * as Sentry` 會把整包 SDK 拉進每頁必載的底座 chunk，
  即使 DSN 沒設也 tree-shake 不掉（SDK 有 side effect）。
  每頁必載底座 244.6 KB gzip → **165.9 KB gzip**。
  代價是 Sentry 非同步載入，瀏覽器剛啟動那一瞬間的錯誤可能來不及捕捉。

### Fixed
- **定期定額扣款日的快照成本停在扣款前**（2026-10-23，分支 `fix/cron-snapshot-cost`）。cron 先刷價、
  用扣款前的成本寫好當天快照，接著定期定額 RPC 的 `on conflict` 只更新股數、價格與市值；快照 trigger
  只補 null 欄位，所以成本不會修正。例：10 股成本 1,000，扣款 200 買 2 股後，當天快照是 12 股、成本 1,000，
  /history 那天的未實現損益多算 200。改成寫入與衝突更新都帶成本、已實現損益與帳戶狀態。
  **需要跑 `supabase/migrations/20261023200000_recurring_snapshot_cost.sql`**；已寫錯的歷史快照不會自動修正。
- **定期定額跨月提前手動執行後卡住、逾期補執行跳期**（2026-10-23，分支
  `fix/recurring-cross-month-next-run`，尚未合併）。下一期原本從「執行日的下個月」推算：
  10/20 手動執行 11/5 那期時，下一期算出來還是 11/5，之後每次執行都撞到已執行的同一期，
  計劃永久停住；10/28 那期拖到 11/2 才執行時，下一期跳到 12/28，少扣 11/28。改成
  「晚於本期預定日與實際執行日兩者的第一個扣款日」，準時執行的結果不變。延誤超過一期
  仍不補齊中間的期數。**需要跑 `supabase/migrations/20261023120000_recurring_next_run_from_schedule.sql`**，
  程式不用改；已經卡住的計劃要另外修，SQL 見 `supabase/README.md`。

## [1.2.0] - 2026-08-18

首頁總覽的視覺層級與互動整輪重做。只動呈現，資料模型、計算口徑、
路由與後端行為皆未變動；`xirr` / `metrics` / `whatif` 一行未改，測試數值不變。
字體替換會連帶影響全站的拉丁字，其餘改動的作用域都在首頁。

### Changed
- **拉丁字體 Space Grotesk → IBM Plex Sans**，數字另配 IBM Plex Mono（400/500/600
  三個靜態字重，上游無變數檔），襯線 Newsreader 保留。等寬只作用在首頁（`.ledger`
  作用域），其他頁的數字仍是 Plex Sans。字體變數命名為 `--font-figures` 而非
  `--font-mono`，避開 Tailwind `font-mono` utility 讀的同名變數——全站三處
  `font-mono`（error 頁、MFA 密鑰、`/methodology` 行內 code）用的字集含符號，
  改到只收數字的子集會掉字。拉丁字體總量 25.8 → 72.8 KB（Noto Sans TC 仍是 1,683 KB）。
- **字級收成 8 級尺標**（`--fs-axis` 10 至 `--fs-display` clamp(40,7vw,64)），
  取代首頁原本 15 個散落的 px 值。定義成自訂變數而非 Tailwind `@theme`，
  後者會改動全站 316 處 `text-*` utility。
- **首頁改成三級視覺層級**：一級摘要（Hero + 四格）落在頁面底色、二級核心資料
  （持倉帳本＋資產配置、淨資產趨勢）保留卡片容器、三級輔助（績效指標）靠 hairline 分區。
  改版前五個區塊同一套 rounded+border+surface，權重一致，沒有進入點。
- **資產配置從三級搬到二級，與持倉帳本並排**（≥1180px；再窄則上下堆疊）。
  斷點取決於表格自身的 760px 最小寬與配置欄的 344px。改版前兩者相距 515px，
  視窗要高於約 1360px 才可能同時看到。
- **幣別標示規則統一**：同單位群組的最上層宣告一次。一級摘要由 Hero 宣告，
  四格不再各自冠 NT$；持倉表格改在表頭標一次（改版前整張表沒有任何幣別標示，
  而美股列的市值是換算後的台幣）。手機持倉卡片沒有表頭，維持逐列標示。
- **「選中」語彙收斂成兩套**：互斥選擇（模式切換、區間、排序）統一為 accent 文字 +
  字重 + 淡填色；獨立開關（圖例）只用邊框與透明度、不填色。填色不再用 accent-soft
  ——accent 文字疊在其上實測深色 4.42:1、淺色 4.37:1，兩個主題各有一種底色低於
  AA 的 4.5:1；改疊 surface-soft 為 4.87 / 5.11。
- **排序在桌機與手機講同一套**：手機藥丸原本寫「名稱」「損益」、桌機表頭寫「帳戶」
  「未實現」，改成逐字相同；藥丸列補可見的「排序」標籤與 `role="group"`。
- **首頁五個區塊改為依序進場**（40ms 一階、單個 0.28s，440ms 結束），取代原本整頁
  一次淡入。`prefers-reduced-motion` 下沿用既有的逐項處理，位移拿掉、淡入保留。
- **手機持倉卡密度**：133 → 106px（桌機同一筆 71px），欄位一個沒少，收的是間距。

### Added
- **圖表刻度改用 nice number**（`chart-scale.ts`，純函式 + 28 條測試）：刻度落在
  1/2/5 × 10ⁿ 的倍數，取代原本把資料範圍五等分（會產生 92.3萬 / 100.4萬 這種刻度）。
  X 軸日期標籤數量改由可用寬度決定，不再固定頭／中／尾三個。
- **格線色 `--c-grid`**：原本用 `--c-border`，對卡片底色只有 1.25:1，實測等同看不見，
  Y 軸標籤浮在空中。壓到約 1.6:1。
- **列 hover 色 `--c-row-hover`**：原本沿用 `--c-surface-soft`，對底色只有 1.073:1。
  拉到約 1.245:1。
- **資產類別選取連動持倉列**：滑過或釘住某一類，對應的持倉列以內嵌 accent 直條標記
  （不採「其他列變淡」，那會讓要讀的數字不能讀）。
- **手機捲過 Hero 後浮出精簡摘要**：顯示總額與今日變化。整頁在 390×844 下有 3.6 屏，
  而總淨資產在 y 174 就離開視野。桌機不做。

### Fixed
- 資產配置的類別列 hover 與 click 共用同一個 state，`onMouseLeave` 無條件清空，
  導致滑鼠使用者永遠釘不住任何一類，而 `aria-pressed` 宣告了一個不存在的持久狀態。
  拆成 pinned 與 hovered，`aria-pressed` 只反映前者。
- 圓環中心數字在千萬級會壓到圓環上：孔徑 96px，而 26px 下四位數萬的字串量到 104px。
  字級降一級後上限 88px。
- 持倉表格欄寬與資訊量相反：「配置」拿到 243px（全表最寬）卻只裝得下 93px 內容，
  會被截斷的「帳戶」只有 218px。改用 colgroup 明寫。
- 持倉表格的配置長條原本軌道固定 48px，最大部位 39.4%，實測填色 2.8–18.9px，
  最小的一格是個 2.8px 的點。軌道改成撐滿欄寬後為 7–47.7px。
- `/methodology` 連結「指標怎麼算」高度只有 17px，低於 WCAG 2.5.8（AA）的 24×24。
- **沖銷帶手續費的交易會失敗**。`20260810230000_transaction_fee.sql` 給 `fee_twd` 加的是
  `check (fee_twd is null or fee_twd >= 0)`，而 45 分鐘後的
  `20260810234500_transaction_reversal.sql` 沖銷時寫的是 `-v_txn.fee_twd`，兩者矛盾。
  結果是「沖銷較早的一筆」只要原始交易記過手續費就整筆 rollback。這在 v1.1.0
  上線當天就存在。放寬約束成 `fee_twd is null or fee_twd >= 0 or reversal_of is not null`：
  沖銷列是 contra entry，`cashflow_twd` 與 `realized_pnl` 早就是負的，手續費跟著變號才一致。

### Internal
- **CI 的 Gate 4（Postgres 整合測試）修好**。自 2026-08-12（v1.1.0 發版當天）起每一次都紅，
  錯誤是 `42723 function "execute_recurring_plan_mutation" already exists with same argument
  types`：三支整合測試共用同一個 Postgres 卻不清 schema，而 migration 改函式簽名用的是
  `drop <舊簽名>` + `create <新簽名>`，前一支留下的新簽名不在後一支的 drop 清單裡。
  各檔 `beforeEach` 的 `truncate` 只清資料表、清不掉函式。改成套 SQL 前先
  `drop schema public / auth cascade` 再重建。修好之後才浮出上面那條沖銷手續費的 bug——
  那條測試案例一直都在，只是從來沒真正跑過。

### Migration
- **必跑**：`supabase/migrations/20260818130000_reversal_negative_fee.sql`。
  不跑的話「沖銷較早的一筆」對記過手續費的交易仍然會失敗。
  既有部署若已完成 1–13，只需執行這一支。執行順序見 `supabase/README.md`。

## [1.1.0] - 2026-08-12

以可用性、無障礙與安全性為主的一輪。沒有破壞性變更，既有資料與計算口徑不變。

### Added
- 交易手續費（費用內含）：買賣可記錄手續費，計入成本基礎與已實現損益。
- 撤銷最新一筆交易 / 沖銷較早的交易：最新一筆可直接撤銷，較早的以反向沖銷處理，保留稽核軌跡。
- 使用者可自行刪除帳戶。
- 定期定額可覆寫單次執行金額（不影響後續期數）。
- `/whatif` 再平衡分頁：把配置偏離的百分點換算成「該補多少錢」。
- CSV 匯入支援買賣與完整往返：匯出的檔案可以原樣匯回。匯出新增
  `Account cost basis (TWD)` 與 `(native)` 兩欄，兩邊共用同一份表頭常數避免漂移。
  沒有成本基礎欄位的舊檔會拒收持倉列、只匯入收益列；以 `型別|時間` 指紋擋重複匯入。
- 免費報價 API 全域每日預算：Twelve Data / FinMind / CoinGecko 各自設上限，
  避免免費額度被單日耗盡。需設 `API_BUDGET_*` 環境變數（未設時採保守預設值）。
- Holdings 排序過渡（FLIP）：按排序鍵時列滑到新位置。以 Web Animations API 手寫，
  零新依賴；只由排序觸發，背景刷新報價造成的重排不會動畫。
- XIRR 求根新增二分法 fallback：Newton-Raphson 未通過殘差檢核時，改以二分法在 NPV 變號區間求根，結果仍須通過同一條殘差檢核，通不過一律回 `null`。減少「明明有解卻顯示 —」的情況，且不改動任何既有可解案例的數值。（`src/lib/xirr.ts`）
- `/methodology` 指標說明頁：公開靜態頁，說明 XIRR、TWR、Sharpe、最大回撤的計算口徑與「為何有時顯示 —」。
- `SECURITY.md`：安全性回報流程與支援版本說明。
- 本 `CHANGELOG.md`。
- `/demo` 專屬載入骨架（`src/app/demo/loading.tsx`）：改用 `DemoV1Header`，避免公開訪客載入瞬間閃到已登入版導覽。

### Security
- **Content-Security-Policy（目前為 Report-Only）**：每個 request 產生 nonce，
  由 `src/proxy.ts` 發出。`object-src 'none'`、`base-uri 'self'`、`frame-ancestors 'none'`、
  `form-action 'self'`，`connect-src` 只放行自身與 Supabase（有設 Sentry 才加）。
  刻意不加 `'strict-dynamic'`——實測會讓 `'self'` 被忽略而打壞 `/demo` 三頁的
  parser-inserted chunk。`style-src` 保留 `'unsafe-inline'` 且不帶 nonce，
  因為全站有動態 `style` 屬性，而同指令帶 nonce 會使 `'unsafe-inline'` 失效。
  **尚未強制執行**：`src/lib/csp.ts` 的 `CSP_ENFORCE` 仍為 `false`，翻成 `true` 前
  需先開站確認 console 無違規。副作用：使用 nonce 後全站改為動態渲染，
  原本 7 個靜態頁不再被 CDN 快取。
- 刷新報價的查詢錯誤不再把 PostgREST 原文丟給前端，改回固定訊息並只在伺服器端記 code。
- Next.js 升至 16.2.11：涵蓋 App Router Proxy bypass（Turbopack 單語系）、Server Actions SSRF/DoS、cache confusion、Image Optimization SVG DoS、未授權 Server Function 端點揭露等一系列 advisory。
- `npm audit fix`（非破壞性）清除 brace-expansion、fast-uri、js-yaml、vite 等建置/測試鏈的傳遞漏洞。剩餘 2 項為 Next 自帶 bundled sharp（<0.35）之 libvips CVE，唯一「修法」是把 Next 降級至 14.2.35 並重新引入上述 Proxy bypass，故不採用；本專案不對不受信任影像做 Image Optimization，殘餘風險低。

### Fixed
- 切頁時右上角會閃出「登入」，以及新增帳戶的三個子頁一直顯示「登入」。
- 刷新報價後淨資產會先掉到 0 再爬回來：count-up 改為從目前顯示值過渡，時長 1100ms → 450ms。
- 首頁總淨資產數字頂端被裁掉：`truncate` 帶的 `overflow:hidden` 配上 `leading-[0.92]`，
  行框比字框矮，上緣溢出約 2.65px。改用 `whitespace-nowrap`，垂直排版未動。
- `min-h-screen` 全數改為 `min-h-dvh`（38 處）：iOS Safari 以收合前的視窗高度計算 `100vh`，
  短頁面會出現幽靈捲動。
- 淺色模式漲跌色未達 WCAG AA；資產類別色票改走 CSS 變數並補上淺色組；
  快速記帳的無市價警示在淺色模式看不見。
- 定期定額：金額框殘留、重複文案、窄螢幕排版；本期金額 min 改為 `0.01`。
- `/methodology` 加入 Proxy 公開白名單：先前只放行 `/login`、`/auth`、`/demo`，公開 Demo 訪客點「指標怎麼算」會被導向登入頁。

### Changed
- **無障礙**：
  - 加上「跳至主內容」連結（WCAG 2.4.1 Level A）。
  - 建立全域 `:focus-visible` 基準，補回三處被移除的焦點指示。
  - 首頁 `h1` 改為語意標題（`sr-only` 的「投資組合總覽」），金額降級成 `div`——
    原本標題內容是會變動的數字，頁面等於沒有穩定的名字。
  - 動作結果改由常駐 live region 播報。
  - 觸控目標放大到 44px（WCAG 2.5.5 AAA）：主圖表區間鈕、刪除提醒鈕、定期定額區塊；
    刪除提醒鈕的 emoji 一併換成 inline SVG。
  - `prefers-reduced-motion` 改為只關位移與縮放，保留淡入與顏色回饋，
    取代原本把所有動畫壓成 0.01ms 的粗暴寫法。
  - `--c-faint` 文字色提高對比至 WCAG AA：亮色 2.6:1 → 4.70:1、暗色 3.66:1 → 5.58:1，仍低於各自 `--c-muted` 以保留層級。
- **效能**：三支字體改自架，移除建置期對 Google Fonts 的相依；
  recharts 改 `next/dynamic`，移出帳戶詳情頁的初始載入。
- 加上 MIT 授權。

### Removed
- 未被任何檔案引用的 `src/components/AllocationTargets.tsx`（設定頁的目標配置由 `SettingsApp` 直接接 `setAllocationTargets` action）。
- Windows 專用的 dev server 啟動器（`start-dev.bat`、`start-dev-min.vbs`），開發已全面移到 macOS。

### Migration
本版新增四個 migration，套用順序即檔名順序：

- `20260810155500_recurring_amount_override.sql`（定期定額單次金額覆寫）
- `20260810230000_transaction_fee.sql`（交易手續費）
- `20260810234500_transaction_reversal.sql`（撤銷 / 沖銷）
- `20260811120000_api_budget.sql`（報價 API 每日預算）

請先在測試資料庫執行。

## [1.0.0] - 2026-07-18

首個標記版本。線上運作於 Vercel + Supabase（單一使用者）。

### 核心功能
- 多市場、多幣別投資組合追蹤：美股 ETF（Twelve Data）、台股（FinMind）、加密貨幣（CoinGecko）、手動資產，統一以 TWD 呈現。
- 單一計算管線 `buildDashboardData`（純函式）同時供正式頁與公開 `/demo` 使用；demo 資料為每日決定性生成，非 mockup。
- 報酬指標：XIRR 與 TWR 並列，採相反現金流慣例；XIRR solver 以殘差驗證把關。
- 風險指標：以現金流調整後的 TWR 指數計算最大回撤（提領不計為虧損）；Sharpe 將不規則快照區間換算等效單日報酬並以日曆日年化。
- 帳戶寫入路徑收斂至原子 Postgres RPC（`apply_account_mutation`）；定期定額以 ledger 為底、`(plan_id, scheduled_date)` 唯一鍵保證冪等（`execute_recurring_plan_mutation`）。
- 投資決策日誌、as-of 歷史重播與報酬歸因、可疊加 shock 的 What-if 壓力測試、可選月份投資報告與 print-to-PDF。
- 警示、通知中心、CSV 匯入、全交易與年度稅務 CSV 匯出。

### 安全與驗證
- 每個 server action 輸入先過 Zod schema；其下為 Supabase RLS 與 TOTP MFA（AAL2）。
- CI 五道 gate：lint、typecheck、單元測試、真 Postgres 整合測試、production build。
- 日曆日換算明訂 `Asia/Taipei`，避免 Vercel UTC 造成快照日位移。

### Migration
- 需先套用 `supabase/migrations/20260718032234_stackworth_v1.sql` 才能使用新的需登入頁面（決策日誌、歷史重播、月報）。請先在測試資料庫執行；本版本沒有直接修改 production。

[Unreleased]: https://github.com/zhuang060329-bit/portfolio-tracker/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/zhuang060329-bit/portfolio-tracker/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/zhuang060329-bit/portfolio-tracker/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/zhuang060329-bit/portfolio-tracker/releases/tag/v1.0.0
