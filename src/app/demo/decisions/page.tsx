import { DemoV1Header } from "@/components/DemoV1Header";
import { PageHead, Panel, Stat, StatStrip, Tag } from "@/components/survey";
import { todayTaipei } from "@/lib/dates";
import { demoMetadata } from "@/lib/demo-metadata";
import { buildDemoV1Data, type DemoDecision } from "@/lib/demo-v1-data";

export const metadata = demoMetadata("決策日誌", "決策日誌示範：每筆加碼、續抱或不採取都記下理由與檢討日，到期後回頭對照當初的判斷。");

const typeLabel: Record<string, string> = {
  add: "加碼",
  hold: "續抱",
  avoid: "不採取",
};

export default function DemoDecisionsPage() {
  const today = todayTaipei();
  const data = buildDemoV1Data(today);
  const isDue = (decision: (typeof data.decisions)[number]) =>
    decision.status === "open" && decision.reviewDate <= today;
  const dueCount = data.decisions.filter(isDue).length;
  const reviewedCount = data.decisions.filter((decision) => decision.status === "reviewed").length;
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <DemoV1Header active="decisions" />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-7 lg:pt-8">
        <PageHead
          label={`示範資料 · ${data.decisions.length} 筆決策`}
          title="決策日誌"
          sub="固定假資料展示追蹤中、到期與已完成檢討三種狀態。"
        />
        <StatStrip cols={3} className="mt-6 grid-cols-3">
          <Stat label="追蹤中" value={<>{data.decisions.length - dueCount - reviewedCount}<Unit /></>} />
          <Stat label="檢討到期" value={<>{dueCount}<Unit /></>} />
          <Stat label="已檢討" value={<>{reviewedCount}<Unit /></>} />
        </StatStrip>
        <ReviewTimeline decisions={data.decisions} today={today} />
        {/* 窄螢幕每筆一張直向卡；寬螢幕改成帳冊列：標的｜依據與檢討｜檢討狀態。
            三欄並排的卡片會被最長那筆（有檢討的）撐成同高，短的兩張留下大片空白；
            改成一筆一列後列高只跟自己的內容走，檢討日與狀態也落在同一條右側欄線上。
            格線沿用 StatStrip 的 1px 底色透出。 */}
        <section className="survey-frame mt-6 grid gap-px border border-[var(--c-border)] bg-[var(--c-border)]">
          {data.decisions.map((decision) => {
            const due = isDue(decision);
            return (
              <article
                key={decision.id}
                className="grid gap-y-2 bg-[var(--c-surface)] p-5 lg:grid-cols-[9.5rem_minmax(0,1fr)_auto] lg:items-baseline lg:gap-x-8"
              >
                <div className="flex flex-wrap items-center gap-2.5 lg:gap-y-1.5">
                  <Tag tone="accent">{typeLabel[decision.decisionType] ?? decision.decisionType}</Tag>
                  <h2 className="text-[length:var(--fs-md)] font-medium">{decision.assetName}</h2>
                  <span className="ml-auto text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum lg:ml-0 lg:basis-full">{decision.decisionDate}</span>
                </div>
                <div className="pb-2 lg:pb-0">
                  <p className="max-w-[68ch] text-[length:var(--fs-sm)] leading-6 text-[var(--c-muted)]">{decision.thesis}</p>
                  {decision.reflection && (
                    <p className="mt-3 max-w-[68ch] border-l-2 border-[var(--c-line-strong)] pl-3 text-[length:var(--fs-sm)] leading-6 text-[var(--c-muted)]">
                      <span className="font-medium text-[var(--c-text)]">檢討</span>　{decision.reflection}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--c-border-soft)] pt-3 text-[length:var(--fs-micro)] lg:flex-col lg:items-end lg:gap-1.5 lg:border-t-0 lg:pt-0">
                  <span className="text-[var(--c-muted)]">
                    檢討日 <span className="tnum text-[var(--c-text)]">{decision.reviewDate}</span>
                  </span>
                  {/* 到期是唯一要人做事的狀態，走朱砂虛線框；已檢討是結果，走實線綠框 */}
                  <Tag tone={decision.status === "reviewed" ? "up" : due ? "annot" : "quiet"}>
                    {decision.status === "reviewed" ? (
                      <>已檢討 · 品質 <span className="tnum">{decision.quality}/3</span></>
                    ) : due ? "檢討到期" : "追蹤中"}
                  </Tag>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

function Unit() {
  return <span className="ml-1 text-[length:var(--fs-sm)] font-normal text-[var(--c-muted)]">筆</span>;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
function nextMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/* 檢討時程：每筆決策一條測線，從決策日畫到檢討日，縱線是今天。
   已走過的那段是實線、還沒到的那段是虛線，所以「離檢討還多遠」直接讀長度；
   檢討日已到卻還沒檢討的那筆，終點換朱砂空心方塊，帶虛線引線與文字，是頁上唯一要人做事的地方。
   對輔助技術整張當成一張圖，朗讀一句摘要；細節卡片裡都有，不逐點朗讀。 */
function ReviewTimeline({ decisions, today }: { decisions: DemoDecision[]; today: string }) {
  if (decisions.length === 0) return null;
  const firstDate = decisions.reduce((min, d) => (d.decisionDate < min ? d.decisionDate : min), today);
  const lastDate = decisions.reduce((max, d) => (d.reviewDate > max ? d.reviewDate : max), today);
  // 軸從第一個月的 1 號畫到最後一個月的月底，月刻度才落在整齊的位置
  const start = monthStart(firstDate);
  const end = nextMonth(lastDate);
  const span = dayNumber(end) - dayNumber(start);
  const x = (date: string) => ((dayNumber(date) - dayNumber(start)) / span) * 100;
  const months: string[] = [];
  for (let m = start; m < end; m = nextMonth(m)) months.push(m);
  const todayX = x(today);
  const summary = decisions
    .map((d) => {
      const state = d.status === "reviewed" ? "已檢討" : d.reviewDate <= today ? "檢討到期" : "追蹤中";
      return `${d.assetName} ${typeLabel[d.decisionType] ?? d.decisionType}，${d.decisionDate} 決策，${d.reviewDate} 檢討，${state}`;
    })
    .join("；");

  return (
    <Panel className="mt-6" title="檢討時程" sub="實線＝已經過的天數，虛線＝距檢討日還剩的天數" flush>
      <div role="img" aria-label={`今天 ${today}。${summary}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 px-5 pb-4 pt-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <div>
          <div className="h-7" />
          {decisions.map((decision) => (
            // 手機版代號與決策類型上下疊：左欄省下的寬度留給時程，兩側的註記才放得下
            <div key={decision.id} className="flex h-11 flex-col justify-center whitespace-nowrap sm:flex-row sm:items-center sm:justify-start sm:gap-2">
              <span className="text-[length:var(--fs-sm)] font-semibold tnum">{decision.assetName}</span>
              <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">{typeLabel[decision.decisionType] ?? decision.decisionType}</span>
            </div>
          ))}
          <div className="h-6" />
        </div>
        <div className="relative">
          {/* 月刻度：短豎線加月份，與 .survey-frame 的髮絲線同粗 */}
          <div className="relative h-7 border-b border-[var(--c-line-strong)]">
            {months.map((month) => (
              <span key={month} className="absolute bottom-0 flex items-end whitespace-nowrap" style={{ left: `${x(month)}%` }}>
                <span className="h-2 w-px bg-[var(--c-line-strong)]" />
                <span className="mb-1 ml-1 text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum">{Number(month.slice(5, 7))}月</span>
              </span>
            ))}
          </div>
          {decisions.map((decision, index) => {
            const reviewed = decision.status === "reviewed";
            const due = !reviewed && decision.reviewDate <= today;
            const startX = x(decision.decisionDate);
            const reviewX = x(decision.reviewDate);
            // 已檢討的線停在檢討日；還沒檢討的線走到今天為止
            const walkedTo = reviewed ? reviewX : Math.min(reviewX, todayX);
            const flipNote = reviewX > 72;
            return (
              <div key={decision.id} className="relative h-11 border-b border-[var(--c-border-soft)]">
                <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--c-border-soft)]" />
                <span
                  className="parcel-grow absolute top-1/2 h-[2px] -translate-y-1/2 bg-[var(--c-accent)]"
                  style={{
                    left: `${startX}%`,
                    width: `${Math.max(walkedTo - startX, 0)}%`,
                    transformOrigin: "left center",
                    animationDelay: `${120 + index * 90}ms`,
                  }}
                />
                {!reviewed && reviewX > todayX && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 border-t border-dashed border-[var(--c-accent)]"
                    style={{ left: `${todayX}%`, width: `${reviewX - todayX}%` }}
                  />
                )}
                {/* 逾期：檢討日到今天這段改朱砂虛線 */}
                {due && reviewX < todayX && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 border-t border-dashed border-[var(--c-annot)]"
                    style={{ left: `${reviewX}%`, width: `${todayX - reviewX}%` }}
                  />
                )}
                {/* 起點是豎刻度、終點是方塊；刻度疊在最上層，決策與檢討只隔一天時才不會被終點方塊蓋掉 */}
                <span className="absolute top-1/2 z-[2] h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-[var(--c-accent)]" style={{ left: `${startX}%` }} />
                <span
                  className={`absolute top-1/2 z-[1] size-[9px] -translate-x-1/2 -translate-y-1/2 ${
                    reviewed
                      ? "bg-[var(--c-up)]"
                      : due
                        ? "border border-[var(--c-annot)] bg-[var(--c-surface)]"
                        : "border border-[var(--c-accent)] bg-[var(--c-surface)]"
                  }`}
                  style={{ left: `${reviewX}%` }}
                />
                {due && (
                  // 另一側拉到列的邊緣，窄螢幕放不下一行時在「注意 ·」後換行，不會衝出面板
                  <span
                    className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 ${flipNote ? "flex-row-reverse" : ""}`}
                    style={flipNote ? { left: 0, right: `calc(${100 - reviewX}% + 8px)` } : { left: `calc(${reviewX}% + 8px)`, right: 0 }}
                  >
                    <span className="w-4 shrink-0 border-t border-dashed border-[var(--c-annot)]" />
                    <span className={`min-w-0 text-[length:var(--fs-micro)] font-medium leading-tight text-[var(--c-annot-text)] ${flipNote ? "text-right" : ""}`}>
                      <span className="whitespace-nowrap">注意 ·</span> <span className="whitespace-nowrap">檢討到期</span>
                    </span>
                  </span>
                )}
                {reviewed && (
                  // 標在線的上方、對齊終點：檢討日常常緊貼今天，放線上會被縱線切過
                  <span
                    className="absolute top-0.5 whitespace-nowrap text-[length:var(--fs-micro)] text-[var(--c-muted)]"
                    style={{ right: `calc(${100 - reviewX}% + 2px)` }}
                  >
                    已檢討 <span className="tnum">{decision.reviewDate.slice(5)}</span>
                  </span>
                )}
              </div>
            );
          })}
          {/* 今天：穿過所有測線的縱線，日期標在底下，避免跟上方月刻度擠在一起 */}
          <span className="pointer-events-none absolute bottom-6 top-7 w-px bg-[var(--c-text)]" style={{ left: `${todayX}%` }} />
          <div className="relative h-6">
            <span
              className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-[length:var(--fs-micro)] font-semibold tnum"
              style={{ left: `${todayX}%` }}
            >
              今天 {today.slice(5)}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
