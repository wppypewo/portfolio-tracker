import type { Metadata } from "next";
import Link from "next/link";
import { RegistrationMark } from "@/components/AppHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SurveyLabel } from "@/components/survey";
import { buildDashboardData } from "@/lib/dashboard-data";
import { buildDemoInputs } from "@/lib/demo-data";
import { todayTaipei } from "@/lib/dates";
import { CadastralMap } from "./CadastralMap";
import { RevealRoot } from "./RevealRoot";
import { SurveyPlate } from "./SurveyPlate";

/* 公開的介紹頁。未登入可看（proxy.ts 放行 /about），登入頁與頁尾都有入口。

   這頁是 design.md「介紹頁例外」的唯一適用範圍：允許捲動觸發的進場與描線動畫，
   其他規則照舊——只動 transform／opacity、尊重 reduced-motion、不劫持捲動、
   不做游標跟隨。工具頁不受這個例外影響。

   所有數字都來自 /demo 同一份固定種子資料、走同一條計算管線，
   不在這裡另外寫一組「行銷用」的數字。 */

export const dynamic = "force-dynamic";

const TITLE = "StackWorth — 個人投資組合測繪";
const DESCRIPTION =
  "把台股、美股、加密貨幣與現金折成台幣，畫在同一張圖上。XIRR、TWR、回撤與配置都寫明算法，資料不夠時顯示「—」。";
// 分享圖由 scripts/demo-og/render.mjs about 產生（og-about.html → public/og/about.png）。
// 貼到 LINE／Slack 的預覽卡讀的是 og:*，不讀 <title>，所以兩組一起給。
const OG_IMAGE = {
  url: "/og/about.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "StackWorth：把資產攤在製圖桌上，一條一條量清楚。附近 6 個月淨資產走勢圖",
};

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    locale: "zh_TW",
    siteName: "StackWorth",
    images: [OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

const SOURCES = [
  { name: "Twelve Data", scope: "美股、USD/TWD" },
  { name: "FinMind", scope: "台股、0050、歷史匯率" },
  { name: "CoinGecko", scope: "加密貨幣" },
];

const PIPELINE = [
  { k: "抓價", v: "每日台北 14:00 由排程執行；每個來源有每日呼叫上限，用完就停" },
  { k: "快照", v: "每個帳戶每天一筆估值，歷史重播與月報都從這裡讀" },
  { k: "計算", v: "XIRR、TWR、Sharpe、回撤、報酬歸因，同一條管線" },
];

export default function AboutPage() {
  const today = todayTaipei();
  const data = buildDashboardData(buildDemoInputs(today));
  const s = data.summary;
  const signed = (v: number, digits = 1) =>
    `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

  const readouts = [
    {
      key: "XIRR",
      name: "年化 XIRR",
      value: s.xirr != null ? `${signed(s.xirr * 100)}%` : "—",
      tone: s.xirr != null && s.xirr < 0 ? "down" : "up",
      body: "資金加權。每筆投入與提領都當現金流，回答「我的錢實際賺了多少」。",
    },
    {
      key: "TWR",
      name: "TWR 累積",
      value: s.twrCum != null ? `${signed(s.twrCum * 100)}%` : "—",
      tone: s.twrCum != null && s.twrCum < 0 ? "down" : "up",
      body: "時間加權。剔除入金時機，回答「策略本身好不好」。",
    },
    {
      key: "MDD",
      name: "最大回撤",
      value: s.maxDrawdown != null ? `−${Math.abs(s.maxDrawdown * 100).toFixed(1)}%` : "—",
      tone: "down",
      body:
        s.ddPeak && s.ddTrough
          ? `從前高到谷底的最大跌幅。示範組合發生在 ${s.ddPeak} → ${s.ddTrough}。`
          : "從前高到谷底的最大跌幅。",
    },
    {
      key: "SR",
      name: "Sharpe",
      value: s.sharpe != null ? s.sharpe.toFixed(2) : "—",
      tone: "flat",
      body: "每承擔一單位波動，換到多少超額報酬。依實際日曆間隔年化。",
    },
  ] as const;

  const toneCls = { up: "text-[var(--c-up)]", down: "text-[var(--c-down)]", flat: "text-[var(--c-text)]" };

  return (
    <div className="about-page min-h-dvh text-[var(--c-text)]">
      <RevealRoot />
      <header className="mx-auto flex h-[var(--header-h)] max-w-[1200px] items-center gap-4 px-4 sm:px-6 lg:px-7">
        <Link href="/about" className="flex items-center gap-2 text-[var(--c-text)]" aria-label="StackWorth 介紹">
          <RegistrationMark className="text-[var(--c-accent)]" />
          <span className="text-[17px] font-semibold tracking-[-0.025em] sm:text-[18px]">StackWorth</span>
        </Link>
        <nav aria-label="介紹頁" className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href="/methodology"
            className="hidden min-h-11 items-center px-2 text-[length:var(--fs-sm)] text-[var(--c-muted)] hover:text-[var(--c-text)] sm:inline-flex"
          >
            指標怎麼算
          </Link>
          <Link
            href="/demo"
            className="inline-flex min-h-11 items-center px-2 text-[length:var(--fs-sm)] text-[var(--c-muted)] hover:text-[var(--c-text)]"
          >
            示範
          </Link>
          <Link href="/login" className="btn btn-outline btn-sm">
            登入
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6 lg:px-7">
        {/* ── 圖幅 00：主圖 ───────────────────────────────── */}
        <section className="grid gap-10 border-t border-[var(--c-line-strong)] pt-10 sm:pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14 lg:pt-20">
          <div className="about-intro">
            <SurveyLabel>圖號 SW-00 · 個人投資組合測繪</SurveyLabel>
            {/* 斷行寫死在詞組上：交給瀏覽器斷，1440 寬會斷成「…量清／楚。」，
                最後一行只剩一個字。每行最多 5 個字，欄寬最窄（1024）時也放得下。 */}
            <h1 className="about-display mt-5 font-display font-semibold">
              {["把資產攤在", "製圖桌上，", "一條一條", "量清楚。"].map((line) => (
                <span key={line} className="block whitespace-nowrap">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mt-6 max-w-[40ch] text-[length:var(--fs-md)] leading-relaxed text-[var(--c-muted)]">
              StackWorth 把台股、美股、加密貨幣與現金折成台幣，畫在同一張圖上。淨值、配置、XIRR、TWR
              與回撤都寫明算法；資料不夠時顯示「—」，不硬算一個好看的數字。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/demo" className="btn btn-primary btn-lg">
                看示範（免登入）
              </Link>
              <Link href="/login" className="btn btn-outline btn-lg">
                登入
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 border-t border-[var(--c-border)] pt-4 text-[length:var(--fs-micro)]">
              {[
                ["示範淨值", `${(s.total / 10_000).toFixed(1)}萬`],
                ["帳戶", `${s.accounts} 個`],
                ["快照", `${data.series.length} 天`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[var(--c-faint)]">{k}</dt>
                  <dd className="mt-1 font-mono text-[length:var(--fs-md)] text-[var(--c-text)]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <SurveyPlate series={data.series} maxDrawdown={s.maxDrawdown} ddPeak={s.ddPeak} ddTrough={s.ddTrough} />
        </section>

        {/* ── 圖幅 01：量什麼 ─────────────────────────────── */}
        <Sheet
          no="01"
          title="四個數字，各回答一個問題"
          lead="報酬不只一種算法。StackWorth 同時列出資金加權與時間加權，並用回撤與 Sharpe 交代風險；每個數字都可以在「指標怎麼算」查到公式與門檻。"
        >
          <ol className="grid border-l border-t border-[var(--c-border)] sm:grid-cols-2 lg:grid-cols-4">
            {readouts.map((r, i) => (
              <li
                key={r.key}
                data-reveal
                style={{ "--rd": `${i * 70}ms` } as React.CSSProperties}
                className="flex flex-col border-b border-r border-[var(--c-border)] bg-[var(--c-surface)] p-5 sm:p-6"
              >
                <span className="font-mono text-[length:var(--fs-axis)] tracking-[0.12em] text-[var(--c-faint)]">
                  {String(i + 1).padStart(2, "0")} · {r.key}
                </span>
                <span className="mt-3 text-[length:var(--fs-sm)] font-semibold">{r.name}</span>
                <span className={`tnum mt-1 text-[clamp(30px,3.4vw,40px)] font-semibold leading-none tracking-[-0.02em] ${toneCls[r.tone]}`}>
                  {r.value}
                </span>
                <p className="mt-4 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">{r.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[length:var(--fs-micro)] text-[var(--c-faint)]">
            數值取自示範組合（{today}）。
            <Link href="/methodology" className="ml-1 text-[var(--c-accent)] underline underline-offset-4">
              指標怎麼算 →
            </Link>
          </p>
        </Sheet>

        {/* ── 圖幅 02：配置 ───────────────────────────────── */}
        <Sheet
          no="02"
          title="配置畫成地籍圖"
          lead="地塊面積就是實際占比，旁邊列出你設定的目標。偏離超過 5 個百分點的類別標上朱砂「注意」——跟跌色是兩個顏色，一個是資料，一個是提醒。"
        >
          <div data-reveal>
            <CadastralMap allocation={data.allocation} allocTargets={data.allocTargets} />
          </div>
        </Sheet>

        {/* ── 圖幅 03：數字從哪裡來 ───────────────────────── */}
        <Sheet
          no="03"
          title="數字從哪裡來"
          lead="三個報價來源，一個每日排程，一張快照表。歷史重播遇到沒有快照的日子保留缺口，不拿今天的價格補過去。"
        >
          <div data-reveal className="grid gap-px border border-[var(--c-border)] bg-[var(--c-border)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <ul className="flex flex-col bg-[var(--c-surface)]">
              {SOURCES.map((src, i) => (
                <li
                  key={src.name}
                  className="flex items-baseline justify-between gap-4 border-b border-[var(--c-border)] px-5 py-4 last:border-b-0"
                >
                  <span className="font-semibold">{src.name}</span>
                  <span className="text-right text-[length:var(--fs-sm)] text-[var(--c-muted)]">{src.scope}</span>
                  <span className="sr-only">（來源 {i + 1}）</span>
                </li>
              ))}
            </ul>
            <ol className="grid bg-[var(--c-surface)] sm:grid-cols-3">
              {PIPELINE.map((step, i) => (
                <li key={step.k} className="relative border-b border-[var(--c-border)] p-5 sm:border-b-0 sm:border-l first:sm:border-l-0">
                  <span className="font-mono text-[length:var(--fs-axis)] tracking-[0.12em] text-[var(--c-faint)]">
                    STEP {i + 1}
                  </span>
                  <p className="mt-2 font-semibold">{step.k}</p>
                  <p className="mt-1.5 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">{step.v}</p>
                  {/* 流向線：從上一步畫過來。只在並排時出現，手機上下堆疊時順序本身就是流向。 */}
                  <span
                    aria-hidden="true"
                    className="pipe-flow absolute left-0 top-[2.1rem] hidden h-px w-5 -translate-x-1/2 bg-[var(--c-accent)] sm:block"
                    style={{ "--rd": `${200 + i * 160}ms` } as React.CSSProperties}
                  />
                </li>
              ))}
            </ol>
          </div>
        </Sheet>

        {/* ── 圖幅 04：判讀規則 ───────────────────────────── */}
        <Sheet
          no="04"
          title="圖例"
          lead="整個工具只有幾條判讀規則，每一頁都一樣。"
        >
          <dl className="border-t border-[var(--c-line-strong)]">
            {[
              {
                term: "賺綠虧紅",
                mark: (
                  <span className="font-mono">
                    <span className="text-[var(--c-up)]">+1.2%</span>{" "}
                    <span className="text-[var(--c-down)]">−0.8%</span>
                  </span>
                ),
                body: "西方慣例，介面對國際使用者開放，所以不用台股的紅漲綠跌。",
              },
              {
                term: "朱砂＝請注意",
                mark: (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block w-6 border-t border-dashed border-[var(--c-annot)]" />
                    <span className="border border-[var(--c-annot)] px-1.5 font-mono text-[length:var(--fs-micro)] text-[var(--c-annot-text)]">
                      注意
                    </span>
                  </span>
                ),
                body: "只用在讀圖的人該停下來看的地方，一律帶文字與虛線引線，不單靠顏色。",
              },
              {
                term: "「—」＝資料不足",
                mark: <span className="font-mono text-[var(--c-muted)]">XIRR —</span>,
                body: "現金流跨度未滿 90 天不算 XIRR，快照未滿 30 天不算 TWR、回撤與 Sharpe。5 天虧 10% 年化成 −99% 沒有意義。",
              },
              {
                term: "一律折成台幣",
                mark: <span className="font-mono text-[var(--c-muted)]">USD × 匯率</span>,
                body: "美股與加密按當日 USD/TWD 換算；拿 SPY、QQQ 做對照時也先換成台幣，比較才公平。",
              },
              {
                term: "金額可以遮住",
                mark: (
                  <span className="font-mono">
                    <span className="inline-block blur-[0.32em]">1,239,941</span>
                  </span>
                ),
                body: "頁首的眼睛圖示把金額模糊，比例與報酬照常顯示，在公共場合打開也不怕。",
              },
            ].map((row, i) => (
              <div
                key={row.term}
                data-reveal
                style={{ "--rd": `${i * 50}ms` } as React.CSSProperties}
                className="grid gap-x-8 gap-y-2 border-b border-[var(--c-border)] py-5 md:grid-cols-[minmax(0,17rem)_minmax(0,10rem)_minmax(0,1fr)] md:items-baseline"
              >
                {/* 序號放在 dt 裡：dl 底下的 div 只能直接包 dt／dd。 */}
                <dt className="flex items-baseline font-semibold">
                  <span className="w-12 shrink-0 font-mono text-[length:var(--fs-micro)] font-normal text-[var(--c-faint)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {row.term}
                </dt>
                <dd className="text-[length:var(--fs-sm)]" aria-hidden="true">
                  {row.mark}
                </dd>
                <dd className="text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">{row.body}</dd>
              </div>
            ))}
          </dl>
        </Sheet>

        {/* ── 圖幅 05：門鎖 ───────────────────────────────── */}
        <Sheet no="05" title="門鎖" lead="個人財務資料只該給本人看。">
          <ul data-reveal className="grid gap-px border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-3">
            {[
              ["登入", "Email／密碼或 Google 帳號；可加開 TOTP 雙因素驗證，開了之後每次登入都要驗。"],
              ["資料隔離", "資料庫逐列權限（Postgres RLS）：每一列都綁定擁有者，別人的查詢讀不到。"],
              ["金鑰", "報價 API 與資料庫管理金鑰只放在伺服器端，不進瀏覽器。"],
            ].map(([k, v]) => (
              <li key={k} className="bg-[var(--c-surface)] p-5 sm:p-6">
                <p className="font-semibold">{k}</p>
                <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">{v}</p>
              </li>
            ))}
          </ul>
        </Sheet>

        {/* ── 收尾 ──────────────────────────────────────── */}
        <section data-reveal className="mt-20 border-t border-[var(--c-line-strong)] pt-12 sm:mt-28">
          <h2 className="about-display-sm font-display font-semibold">先看示範，再決定。</h2>
          <p className="mt-4 max-w-[46ch] text-[length:var(--fs-md)] leading-relaxed text-[var(--c-muted)]">
            示範是五個用固定種子生成的帳戶，總覽、決策日誌、歷史重播、情境與月報都能操作，不需要註冊。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="btn btn-primary btn-lg">
              看示範（免登入）
            </Link>
            <Link href="/methodology" className="btn btn-outline btn-lg">
              指標怎麼算
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

/* 一個「圖幅」：左欄是圖號與標題，右欄是內容。寬螢幕左欄黏在原地不動是常見手法，
   這裡刻意不做——黏住的標題會跟右欄的捲動搶注意力，工具型頁面不需要。 */
function Sheet({
  no,
  title,
  lead,
  children,
}: {
  no: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`sheet-${no}`} className="mt-20 border-t border-[var(--c-line-strong)] pt-8 sm:mt-28 sm:pt-10">
      <div data-reveal className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <span className="font-mono text-[length:var(--fs-micro)] tracking-[0.12em] text-[var(--c-faint)]">
            圖幅 {no}
          </span>
          <h2 id={`sheet-${no}`} className="about-display-sm mt-2 font-display font-semibold">
            {title}
          </h2>
        </div>
        <p className="max-w-[52ch] text-[length:var(--fs-md)] leading-relaxed text-[var(--c-muted)] lg:pt-7">{lead}</p>
      </div>
      <div className="mt-8 sm:mt-10">{children}</div>
    </section>
  );
}
