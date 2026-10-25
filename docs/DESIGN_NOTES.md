# 設計筆記

StackWorth 的設計決策、取捨與視覺規則。原本分散在給 AI 代理人的交接檔裡，2026-10-25 整理到這裡。
架構概要見 [ARCHITECTURE.md](ARCHITECTURE.md)，資料語意見 [ADR-001](ADR-001-stackworth-v1-data-semantics.md)，
環境變數與部署見 [REFERENCE.md](REFERENCE.md)。

## 設計決策

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
  刻意分成兩個色，朱砂只用在帶文字與虛線引線的「注意」註記。細節見下方「視覺與動畫」
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
  （包括設計文件裡舉例用的）會被當成真的在用而產出 CSS。這行把 markdown 排除掉。
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

## 已知取捨


| 項目 | 為什麼 |
|---|---|
| ~~4 種按鈕風格散在各頁~~ | **2026-09-03 已解決**：`globals.css` 收斂成一套 `.btn` class（`.btn-primary` / `.btn-neutral` / `.btn-danger` / `.btn-outline` / `.btn-outline-danger` / `.btn-ghost`，加 `.btn-sm` / `.btn-lg` / `.btn-icon` / `.btn-fit` 修飾）。行動版列表的整列可點區塊統一為 `.tap-row`。走 CSS class 而不是 React component，是因為按鈕散在 server 與 client component 兩邊，class 兩邊都能用，不必為了樣式把 server component 改成 client |
| AppHeader unreadCount 每頁 fetch | DRY 違規但只是一個 COUNT query，成本低 |
| CSV 匯入的交易寫入與帳戶更新不是原子的 | insert 成功、update 失敗時流水在但餘額沒跟上，且重試會被「帳戶已有交易」擋住。錯誤訊息已提示去看變動紀錄。要做成原子需要新 RPC 與 migration |

## 視覺與動畫

### 定位

StackWorth 是工具型 UI，核心指標是資料可讀性，不是視覺衝擊。

### 設計優先級

數字可讀性 > 資訊密度 > 視覺效果

禁止為了「比較漂亮」犧牲：
- 表格數字對齊
- 財務數值的字重與對比
- 圖表的資訊密度

### 視覺語言：測繪桌 Survey Table（2026-09-26 起）

- 色票：冷紙 #E7EEF0、石墨 #101820、測量藍 #195F7A、朱砂 #D14B32、藍灰 #91A8A8。
  實際值一律走 `globals.css` 的 CSS 變數，兩個主題各自設計、各自量對比
- 母題：製圖格線、十字軸線、測量註記、套準記號、直角／斜角控制項、髮絲線、等寬數字
- 圓角全站 0。斜角（clip-path）只給每頁唯一的主按鈕——clip-path 會裁掉 outline，
  那顆的焦點環改畫成 inset box-shadow
- 顏色慣例：賺綠虧紅（西方慣例），不改。**跌色與朱砂註記是兩個色**：
  跌色是資料，朱砂是「請注意」的註記，朱砂一律搭文字與虛線引線，不單靠顏色
- 字體：IBM Plex Sans（內文、標題）＋ IBM Plex Mono（數字、註記）＋ Noto Sans TC。
  沒有襯線字體
- CSS 變數系統（`globals.css`）維持現有架構：`:root` 是深色，`[data-theme="light"]` 覆寫

### 動畫

允許 `motion`（Motion for React）與 `gsap`，限制如下：

- 只放在隔離的 `"use client"` 葉節點元件裡，server component 不碰
- 同一棵元件樹不混用 GSAP 與 Motion
- 只動 transform 與 opacity，不動 width／height／top／left
- 一律尊重 `prefers-reduced-motion`：位移換成淡入或直接到終點
- 動作必須在說明狀態（哪一列變了、指示線移到哪），不做純裝飾
- 簡單的進場、hover 仍優先用 CSS；`useCountUp.ts`（rAF）與 `useFlipRows.ts`
  （Web Animations API）照舊可用
- **GSAP 的授權是 GreenSock Standard "no charge" License，不是開源授權**（OSI 未認可）。
  免費商用，但不能拿來做與 Webflow 競爭的視覺建站工具；本專案不受影響
- React Bits 可以當素材來源，但要改寫成符合本節規則的版本（tokens、reduced-motion、
  不做游標跟隨之類的裝飾），不整包安裝
- Lenis（平滑捲動）仍然禁止：工具型 UI 不劫持捲動

### 介紹頁例外（`/about`，2026-10-11 起）

公開介紹頁 `/about` 是唯一允許「展示性動作」的頁面，工具頁（含 `/demo`）照舊：

- 允許：主圖描線、註記依序落下、各區塊捲進視野時淡入上移（一次，不重播）
- 實作限 CSS keyframe／transition 加一支 IntersectionObserver（`RevealRoot`），不裝 motion／gsap
- 仍然只動 transform、opacity（描線用 SVG 的 stroke-dashoffset）
- 仍然尊重 `prefers-reduced-motion`：描線直接畫完，位移換成淡入
- 仍然禁止：Lenis、捲動劫持、捲動綁定的逐格播放（scrubbing）、游標跟隨
- 沒有 JS 時內容必須照常顯示（隱藏規則以 `html[data-reveal-ready]` 為前提）
- 頁面上的數字一律取自 `/demo` 同一份資料與計算管線，不另寫行銷用數字

### 禁止

- 禁止套 movie-app 的 cinematic 風格（整頁捲動劇場、Lenis）到這個專案
- 禁止引入新的 UI library，除非另行確認
- 禁止套通用 SaaS 設計（紫藍漸層、glassmorphism、置中 hero、陰影卡片堆疊）
- 圖表以 Recharts（已整合）為主，不引入其他圖表庫；手刻 SVG 可以
- 禁止硬編碼顏色，統一用 CSS 變數
