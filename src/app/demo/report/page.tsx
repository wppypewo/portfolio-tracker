import type { Metadata } from "next";
import { DemoV1Header } from "@/components/DemoV1Header";
import { PageHead, PARCEL_HATCH, Stat, StatStrip, SurveyLabel } from "@/components/survey";
import { todayTaipei } from "@/lib/dates";
import { DEMO_CONCENTRATION_LIMIT_PCT, DEMO_EPOCH } from "@/lib/demo-data";
import { demoMetadata } from "@/lib/demo-metadata";
import { buildDemoV1Data } from "@/lib/demo-v1-data";
import { fmtFull, fmtNum, fmtSignedPct, fmtSignedTwd } from "@/lib/format";
import { buildMonthlyReport, getMonthBounds } from "@/lib/monthly-report";
import { PrintReportButton } from "@/app/reports/monthly/PrintReportButton";

// 標題帶月份：列印存 PDF 時瀏覽器拿它當預設檔名
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ month?: string }> }): Promise<Metadata> {
  const { month } = await searchParams;
  return demoMetadata(
    `${resolveBounds(month, todayTaipei()).month} 月度投資報告`,
    "月度報告示範：當月淨值變動、報酬歸因、集中度與待檢討決策，可列印存成 PDF。",
  );
}

export default async function DemoReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const today = todayTaipei();
  const { month } = await searchParams;
  const bounds = resolveBounds(month, today);
  const data = buildDemoV1Data(bounds.endDate);
  const report = buildMonthlyReport({ bounds, accounts: data.accounts, snapshots: data.snapshots, statusEvents: data.statusEvents, transactions: data.transactions });
  const newDecisions = data.decisions.filter((decision) => decision.decisionDate >= bounds.startDate && decision.decisionDate <= bounds.endDate);
  const due = data.decisions.filter((decision) => decision.status === "open" && decision.reviewDate <= bounds.endDate);
  const reviewed = data.decisions.filter((decision) => decision.status === "reviewed");
  const effects = [report.attribution.marketPriceEffectTwd, report.attribution.fxEffectTwd, report.attribution.incomeTwd, report.attribution.residualTwd];
  const effectScale = Math.max(...effects.map(Math.abs));
  const overConcentration = report.topConcentrationPct > DEMO_CONCENTRATION_LIMIT_PCT;
  return (
    <div className="report-shell min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <DemoV1Header active="report" />
      <main id="main" tabIndex={-1} className="report-page mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-7 lg:pt-8">
        <PageHead
          className="report-block"
          label="月度報告 · 示範資料"
          title={`${bounds.month} 月度投資報告`}
          sub={<>資料截止 <span className="tnum">{bounds.endDate}</span> 23:59（Asia/Taipei）· 全部為固定示範資料</>}
          action={
            <div className="flex items-end gap-2">
              {/* 欄位與按鈕的高度、樣式同歷史頁的日期欄：手機 44px 觸控高度，.field 在粗指標裝置把字級拉到 16px */}
              <form method="GET" className="no-print flex items-end gap-2">
                <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
                  示範月份
                  <input type="month" name="month" defaultValue={bounds.month} min={DEMO_EPOCH.slice(0, 7)} max={today.slice(0, 7)} className="field h-11 w-auto py-0 tnum sm:h-10" />
                </label>
                <button type="submit" className="btn btn-outline h-11 sm:h-10">產生</button>
              </form>
              <PrintReportButton touchHeight />
            </div>
          }
        />
        {/* 格子各自帶 report-card：列印時整段不被分頁切開，底色也會被列印樣式換成白。
            sm–lg 之間五格放不下完整金額，先排三欄，XIRR 橫跨兩格補滿第二列 */}
        <StatStrip cols={5} colsClass="sm:grid-cols-3 lg:grid-cols-5" className="mt-6">
          <Stat className="report-card" label="期初淨值" mask value={`NT$ ${fmtFull(report.opening.totalValueTwd)}`} />
          <Stat className="report-card" label="期末淨值" mask value={`NT$ ${fmtFull(report.ending.totalValueTwd)}`} />
          <Stat className="report-card" label="淨投入" mask value={fmtSignedTwd(report.netContributionTwd)} />
          <Stat className="report-card" label="當月 TWR" value={report.twr == null ? "資料不足" : fmtSignedPct(report.twr * 100)} />
          <Stat className="report-card col-span-2 lg:col-span-1" label="XIRR 年化" value={report.xirrAnnualized == null ? "資料不足" : fmtSignedPct(report.xirrAnnualized * 100)} />
        </StatStrip>
        <Block className="survey-frame" title="報酬歸因" sub="扣除資金進出後的淨值變動；前三項解釋不到的部分列為未解釋">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Metric label="市價" value={report.attribution.marketPriceEffectTwd} scale={effectScale} />
            <Metric label="匯率" value={report.attribution.fxEffectTwd} scale={effectScale} />
            <Metric label="股息／利息" value={report.attribution.incomeTwd} scale={effectScale} />
            <Metric label="未解釋" value={report.attribution.residualTwd} scale={effectScale} />
          </div>
        </Block>
        {/* 這兩段的內容都短，寬螢幕並排免得各自拉成一條長而空的橫帶；列印時頁寬不到 lg，照舊上下排。 */}
        <div className="lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-6">
          <Block title="決策日誌">
            <div className="grid gap-5 sm:grid-cols-3">
              <TextBlock title="新增決策" value={newDecisions.length} detail={newDecisions.map((decision) => decision.assetName).join("、")} />
              <TextBlock title="到期未檢討" value={due.length} detail={due.map((decision) => decision.assetName).join("、")} />
              <TextBlock title="完成檢討" value={reviewed.length} detail={reviewed.map((decision) => `${decision.assetName} 品質 ${decision.quality}/3`).join("、")} />
            </div>
          </Block>
          <Block title="風險與資料健康">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Figure label="最高單一持倉" value={`${fmtNum(report.topConcentrationPct, 2)}%`} attention={overConcentration} />
              <Figure label="最大回撤" value={report.maxDrawdown ? fmtSignedPct(report.maxDrawdown.pct * 100) : "資料不足"} />
              <Figure label="資料說明" value={<>{report.dataGaps.length}<span className="ml-1 text-[length:var(--fs-sm)] font-normal text-[var(--c-muted)]">項</span></>} />
            </div>
            {/* 朱砂註記：超過情境頁同一個集中度上限才出現。顏色之外有虛線引線與整句文字。 */}
            {overConcentration && (
              <p className="mt-4 flex items-center gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-annot-text)]">
                <span aria-hidden="true" className="h-0 w-5 shrink-0 border-t border-dashed border-[var(--c-annot)]" />
                最高單一持倉高於 {DEMO_CONCENTRATION_LIMIT_PCT}% 集中度上限
              </p>
            )}
            {report.dataGaps.length > 0 && <ul className="mt-3 list-disc pl-5 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">{report.dataGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}
          </Block>
        </div>
        <footer className="report-block mt-6 border-t border-[var(--c-border)] pt-4 text-[length:var(--fs-micro)] leading-5 text-[var(--c-faint)]">此為功能示範，不含真實使用者資料。數字僅用於測試計算與列印流程，不構成投資建議。</footer>
      </main>
    </div>
  );
}

// 報告的一個段落：方框、標題列底下一條髮絲線。保留 report-block 給列印樣式用。
function Block({ title, sub, className = "", children }: { title: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`report-block mt-6 border border-[var(--c-border)] bg-[var(--c-surface)] ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--c-border-soft)] px-5 py-3">
        <h2 className="text-[length:var(--fs-lg)] font-medium">{title}</h2>
        {sub && <p className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">{sub}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// 歸因只是拆解，不是損益，所以不上漲跌色，只帶號。
// 底下的地塊條以中軸為零：正值往右、負值往左，長度依四項裡絕對值最大者等比，
// 用來一眼比出哪一項主導了這個月的變動。填色是首頁配置地塊同一種斜線。
function Metric({ label, value, scale }: { label: string; value: number; scale: number }) {
  const half = scale > 0 ? (Math.abs(value) / scale) * 50 : 0;
  return (
    <div>
      <SurveyLabel>{label}</SurveyLabel>
      <div className="amt mt-1.5 text-[length:var(--fs-md)] font-semibold tnum">{fmtSignedTwd(value)}</div>
      <span aria-hidden="true" className="relative mt-2 block h-[9px]">
        <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--c-border-soft)]" />
        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--c-line-strong)]" />
        {half > 0 && (
          <span
            className="parcel-grow absolute inset-y-0 border border-[var(--c-accent)]"
            style={{
              [value > 0 ? "left" : "right"]: "50%",
              width: `${Math.max(half, 0.75)}%`,
              background: PARCEL_HATCH,
              // 貼著零軸的那一側當原點，條才會從中軸往外長
              transformOrigin: value > 0 ? "left center" : "right center",
            }}
          />
        )}
      </span>
    </div>
  );
}

function Figure({ label, value, attention = false }: { label: string; value: React.ReactNode; attention?: boolean }) {
  return (
    <div className="flex flex-col">
      <SurveyLabel>{label}</SurveyLabel>
      <div className={`mt-auto pt-1.5 text-[length:var(--fs-xl)] font-semibold tnum ${attention ? "text-[var(--c-annot-text)]" : ""}`}>{value}</div>
    </div>
  );
}

function TextBlock({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <div>
      <SurveyLabel>{title}</SurveyLabel>
      <div className="mt-1.5 text-[length:var(--fs-xl)] font-semibold tnum">{value}<span className="ml-1 text-[length:var(--fs-sm)] font-normal text-[var(--c-muted)]">筆</span></div>
      <p className="mt-1 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">{detail || "無紀錄"}</p>
    </div>
  );
}

/** 不合法、未來或早於 Demo 起始的月份一律回到當月；當月的結束日截在今天 */
function resolveBounds(month: string | undefined, today: string) {
  const currentMonth = today.slice(0, 7);
  let requested = getMonthBounds(month ?? currentMonth);
  if (!requested || requested.startDate > today || requested.month < DEMO_EPOCH.slice(0, 7)) {
    requested = getMonthBounds(currentMonth)!;
  }
  return requested.month === currentMonth ? { ...requested, endDate: today } : requested;
}
