import type { Metadata } from "next";
import Link from "next/link";
import { RegistrationMark } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "StackWorth — 指標怎麼算",
  description:
    "StackWorth 各項報酬與風險指標的計算口徑：XIRR、TWR、Sharpe、最大回撤，以及為何有時顯示「—」。",
};

// 公開靜態頁，無需登入。內容口徑對齊 src/lib/metrics.ts 與 src/lib/xirr.ts 的實際實作；
// 任一計算邏輯調整時，此頁需同步。
export default function MethodologyPage() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      {/* 實心頁首，與 AppHeader 同一套：不半透明、不模糊。 */}
      <header className="sticky top-0 z-40 border-b border-[var(--c-line-strong)] bg-[var(--c-page)]">
        <div className="mx-auto flex h-[var(--header-h)] max-w-[1200px] items-center gap-2.5 px-4 sm:px-6 lg:px-7">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-[var(--c-text)]"
            aria-label="StackWorth 首頁"
          >
            <RegistrationMark className="text-[var(--c-accent)]" />
            <span className="text-[length:var(--fs-lg)] font-medium tracking-[-0.025em]">
              StackWorth
            </span>
          </Link>
          <span className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <ThemeToggle />
            <Link
              href="/demo"
              className="btn btn-outline ml-0.5"
            >
              看 Demo
            </Link>
          </span>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-7">
        <PageHead
          label="計算口徑"
          title="指標怎麼算"
          sub={
            <>
              這頁說明 StackWorth 每個報酬與風險數字的來源與口徑。原則只有一條：
              <strong className="font-medium text-[var(--c-text)]">
              當一個數字無法可靠計算時，畫面顯示「—」，而不是猜一個看起來正常的值。
              </strong>
            </>
          }
        />

        <div>
          <Section
            term="XIRR"
            subtitle="金額加權年化報酬率 · 反映「你實際投入的錢」賺了多少"
          >
            <P>
              把每一筆投入視為負現金流（錢離開你的口袋）、每一筆配息與賣出收入視為正現金流，
              最後補上「今天全部賣出可收回的市值」作為一筆正現金流，解出讓這串現金流淨現值為零的年化利率。
            </P>
            <P>
              解法先用 Newton-Raphson 迭代；若迭代結果無法通過殘差檢核（震盪、起點不良、跑滿上限都可能留下假解），
              改用二分法在變號區間求根。無論走哪條路徑，回傳前都會再驗一次
              <Code>|NPV(rate)|</Code> 是否小到相對現金流規模可忽略；通不過就顯示「—」。
            </P>
            <Note>
              資料跨度不足 90 天時不顯示年化 XIRR——短期波動年化後會嚴重失真（例如 5 天虧 10% 會被年化成接近 -100%）。
            </Note>
          </Section>

          <Section
            term="TWR"
            subtitle="時間加權報酬率 · 反映「投資決策本身」的好壞，剔除進出場時機"
          >
            <P>
              把整段期間依每一天的快照切成子期間，每個子期間的成長率＝
              <Code>(當日市值 − 該期間內的淨現金流) ÷ 前一日市值</Code>，再把所有子期間相乘。
              因為把現金流從分子扣掉，加碼或提領本身不會被算成報酬，留下的就是純粹的資產表現。
            </P>
            <P>
              這也是淨值走勢圖的基準：起點設為 100，之後每個子期間乘上成長率。
              XIRR 與 TWR 用相反的現金流慣例是刻意的——XIRR 跟著你的錢包，TWR 跟著投資組合。
            </P>
            <Note>
              快照少於 30 筆不顯示 TWR 總報酬；少於 90 筆不顯示年化 TWR。年化以日曆日換算（
              <Code>365.25 ÷ 實際天數</Code>）。
            </Note>
          </Section>

          <Section
            term="Sharpe"
            subtitle="風險調整後報酬 · 每承擔一單位波動換到多少超額報酬"
          >
            <P>
              先算每個子期間的報酬，並把有斷日的期間換算成等效單日報酬（避免把多日變動當成一天），
              取平均與標準差，減去無風險利率（年化 1.5%，換算成日）後除以日標準差，再乘
              <Code>√365.25</Code> 年化。
            </P>
            <Note>
              有效報酬期間少於 5 段時不顯示——樣本太少的標準差不具參考意義。
              年化尺度用日曆日而非交易日，因為組合含週末仍在交易的加密資產。
            </Note>
          </Section>

          <Section
            term="最大回撤"
            subtitle="從高點到低點的最大跌幅 · 衡量最壞情況下的帳面痛感"
          >
            <P>
              在「現金流調整後的 TWR 指數」上，逐日更新歷史高點，記錄每一點相對其之前高點的跌幅，
              取最深的一次。因為建立在剔除現金流的指數上，
              <strong className="font-medium text-[var(--c-text)]">提領不會被誤判成市場虧損</strong>。
            </P>
            <Note>期間內沒有出現任何回撤（一路創新高）時顯示「—」。</Note>
          </Section>

          <Section term="為什麼會看到「—」" subtitle="這不是壞掉，是刻意的">
            <P>常見原因：</P>
            <ul className="mt-1 list-outside list-[square] pl-5 space-y-2 text-[length:var(--fs-md)] leading-relaxed text-[var(--c-muted)] marker:text-[var(--c-accent)]">
              <Li>資料跨度或快照數量還沒到該指標的門檻（見上方各項）。</Li>
              <Li>求根結果沒通過殘差檢核，代表算出來的數字不可信。</Li>
              <Li>報價來源當天缺資料——缺口以視覺呈現，不用前一日的值硬補一個報酬。</Li>
              <Li>已實現損益為零時不顯示總報酬，避免和未實現損益重複計算。</Li>
            </ul>
          </Section>

          <Section term="資料來源與幣別" subtitle="全部以基準幣別呈現">
            <P>
              美股與 USD/TWD 匯率來自 Twelve Data、台股與歷史匯率來自 FinMind、加密貨幣來自 CoinGecko，
              皆為免費額度並帶冷卻與重試。所有資產統一換算成基準幣別（預設 TWD）；
              大盤對照（SPY/QQQ）也會乘上當日 USD/TWD，才能和組合公平比較。
            </P>
            <Note>顏色慣例：賺為綠、虧為紅（西方慣例）。</Note>
          </Section>
        </div>

        <footer className="mt-12 border-t border-[var(--c-line-strong)] pt-5 text-[length:var(--fs-micro)] leading-relaxed text-[var(--c-faint)]">
          個人財務工具，非投資建議。數字的精確定義以原始碼為準（
          <Code>src/lib/metrics.ts</Code>、<Code>src/lib/xirr.ts</Code>）。
        </footer>
      </main>
    </div>
  );
}

function Section({
  term,
  subtitle,
  children,
}: {
  term: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    // 每節是一格帳本列：左欄術語、右欄內文，窄螢幕疊成一欄。節與節之間一條髮絲線。
    <section className="grid gap-x-8 gap-y-3 border-b border-[var(--c-border-soft)] py-8 sm:grid-cols-[168px_1fr]">
      <div>
        <h2 className="font-display text-[length:var(--fs-xl)] font-medium leading-tight">
          {term}
        </h2>
        <p className="mt-1.5 text-[length:var(--fs-micro)] font-medium leading-relaxed text-[var(--c-muted)]">
          {subtitle}
        </p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[length:var(--fs-md)] leading-relaxed text-[var(--c-muted)]">
      {children}
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    // 門檻說明：左側一條測量藍實線，像圖面邊上的附註欄。不用朱砂——這是規則，不是警示。
    <p className="border-l-2 border-[var(--c-accent)] bg-[var(--c-surface-soft)] px-4 py-2.5 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
      {children}
    </p>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="border border-[var(--c-border-soft)] [box-decoration-break:clone] bg-[var(--c-surface-soft)] px-1 py-px font-mono text-[0.88em] text-[var(--c-text)]">
      {children}
    </code>
  );
}
