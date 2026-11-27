"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Hero, HeroStat } from "./Hero";
import { fmtTwd } from "./DashboardCharts";
import { sign, toneCls } from "./shared";
import { TrendSection } from "./TrendSection";
import { AllocationCard } from "./AllocationCard";
import { MetricsCard } from "./MetricsCard";
import { Holdings } from "./Holdings";
import { StickySummary } from "./StickySummary";
import { AiPanel, type AiBrief } from "./AiPanel";
export type {
  DashSummary,
  AllocTarget,
  Holding,
  DashboardData,
} from "./types";
import type { DashboardData } from "./types";

export function DashboardClient({
  data,
  demo = false,
  ai,
}: {
  data: DashboardData;
  demo?: boolean;
  /** 只有 admin 會傳；undefined 時不顯示 AI 區塊。 */
  ai?: { brief: AiBrief; briefFailed?: boolean };
}) {
  const summary = data.summary;

  /* 資產類別的選取狀態提到這裡，讓資產配置與持倉帳本共用。
     pinned 是點下去釘住的、hovered 是滑過的暫時預覽，顯示時 hover 優先。
     早退在 hook 之後，否則 holdings 為空時 hook 數量會變。 */
  const [pinnedCls, setPinnedCls] = useState<string | null>(null);
  const [hoveredCls, setHoveredCls] = useState<string | null>(null);
  const activeCls = hoveredCls ?? pinnedCls;
  // 精簡摘要要知道 Hero 什麼時候捲出視野。
  const heroRef = useRef<HTMLDivElement>(null);

  if (!demo && data.holdings.length === 0) {
    return <FirstRun archivedCount={data.archivedCount} />;
  }

  const allocation = (
    <AllocationCard
      allocation={data.allocation}
      allocTargets={data.allocTargets}
      total={summary.total}
      pinnedCls={pinnedCls}
      activeCls={activeCls}
      onHover={setHoveredCls}
      onPin={(cls) =>
        setPinnedCls((current) => (current === cls ? null : cls))
      }
    />
  );
  const metricsHasContent = summary.twrShowable || summary.hasIncome;

  /* 三級層級。區分手段是「有沒有容器 + 間距 + 字級」，不是圓角或陰影深淺：
     改版前五個區塊全是同一套 rounded+border+surface，權重一模一樣，
     眼睛沒有進入點（V1）。實測那層 border 對底色只有 1.25:1，
     問題從來不是邊界太弱，而是五個東西都戴著同一頂帽子。

     一級 頂部摘要（Hero + 四格關鍵指標）：無容器，落在 page 背景。
     二級 核心資料（持倉帳本＋資產配置、淨資產趨勢）：唯二保留 surface 容器的區塊。
     三級 輔助（績效指標）：無容器，靠頂部 hairline 分區。
     資產配置原本在三級，v1.2 為了讓類別選取連動持倉列而搬進二級（見下方註解）。 */
  return (
    /* 精簡摘要放在 .ledger 之外：它是 fixed 不佔版面，而 .ledger 的子元素數量
       正好是進場節奏的階數（nth-child），多塞一個進去會把整組延遲往後推。 */
    <>
      <StickySummary s={summary} watch={heroRef} />
      {/* .ledger 是首頁數字改等寬的作用域，規則在 globals.css。 */}
      <div className="ledger flex flex-col">
        <div ref={heroRef}>
          <Hero s={summary} series={data.series} demo={demo} />
        </div>

        {/* 容器底色透出成 1px 分隔線，四格之間有線、外圍沒有框。
            原本這層還包著卡片殼，等於「卡片裡再放四張卡」（V6）。

            負邊距抵銷格子自己的左右內距：這四格屬於一級，左緣要跟 Hero 對齊。
            不抵銷的話量出來是 88px，而 Hero 與三級都在 68px（實測）。
            外緣溢出的部分是格子自身的 page 底色，看不出來；抵銷量恆不大於
            main 的 gutter（16/24/28 對 16/20/20），不會產生水平捲動。 */}
        {/* 幣別在「同單位群組」的最上層宣告一次就好。這四格緊接在 Hero 底下、
            屬於同一個一級摘要區，Hero 的主數字已經用大字寫了 NT$，四格再各自
            冠一次是重複。改版前只有「投入成本」帶 NT$，另外兩個金額沒有，
            於是同一列裡三個同單位的數字長成兩種樣子（V3）。
            去掉而不是補齊，是因為量過寬度：手機半格可用 163px，主格（22px）
            補上 NT$ 後八位數要 198px，會被 truncate 切掉；而且「投入成本」
            目前的最壞情況 162px 本來就只剩 1px 餘裕。去掉之後三格都退回百來 px。
            有共同表頭的地方（持倉表格）改在表頭標一次，規則一致。 */}
        <section className="-mx-4 bg-[var(--c-border)] sm:-mx-5">
          <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <HeroStat
              label="投入成本"
              mask
              value={fmtTwd(summary.totalCost)}
              sub="目前持有部位"
            />
            <HeroStat
              label="未實現損益"
              mask
              value={`${sign(summary.unrealized)}${fmtTwd(Math.abs(summary.unrealized))}`}
              tone={toneCls(summary.unrealized)}
              sub={`${sign(summary.unrealizedPct)}${Math.abs(summary.unrealizedPct).toFixed(1)}%`}
              primary
            />
            <HeroStat
              label="累計已實現"
              value={
                summary.totalRealized === 0
                  ? "—"
                  : `${sign(summary.totalRealized)}${fmtTwd(Math.abs(summary.totalRealized))}`
              }
              mask
              tone={toneCls(summary.totalRealized)}
              sub="賣出與現金收益"
            />
            {summary.xirrShowable && summary.xirr != null ? (
              <HeroStat
                label="年化 XIRR"
                value={`${sign(summary.xirr)}${(Math.abs(summary.xirr) * 100).toFixed(1)}%`}
                tone={toneCls(summary.xirr)}
                sub="資金加權報酬"
              />
            ) : (
              <HeroStat
                label="年化 XIRR"
                value="—"
                sub="現金流跨度未滿 90 天"
              />
            )}
          </div>
        </section>

        {/* 二級起點。與一級之間拉開 36px，是全頁最大的一段間距，
            用留白把「摘要」和「明細」切成兩塊。二級彼此只隔 16px，讀起來成一組。

            資產配置從三級搬上來，跟持倉帳本併成同一張卡：兩者講的是同一批部位，
            一個按帳戶、一個按類別。原本配置在頁尾，實測 1280×800 下持倉表格在
            y 554–951、資產配置在 y 1466–1912，中間隔 515px，視窗要高於約 1360px
            才可能同時看到——把類別選取連動到持倉列的話，效果會落在畫面外。

            並排的斷點是算出來的：表格自身 min-w 760px，配置欄要 344px，
            main 的內容寬是 min(vw,1200)−56。1180px 時內容 1124px 剛好
            760+20+344；再窄就會逼表格長出橫向捲軸，所以以下改成上下堆疊
            （堆疊時配置仍緊接在持倉之後，不再隔著整張趨勢圖）。 */}
        <section className="survey-frame mt-9 border border-[var(--c-border)] bg-[var(--c-surface)] min-[1180px]:grid min-[1180px]:grid-cols-[minmax(760px,1fr)_344px]">
          <div className="flex min-w-0 flex-col">
            <Holdings
              demo={demo}
              fitTable={demo}
              holdings={data.holdings}
              total={summary.total}
              marketLabel={data.marketLabel}
              archivedCount={data.archivedCount}
              showArchived={data.showArchived}
              activeCls={activeCls}
            />
          </div>
          <div className="border-t border-[var(--c-border)] px-4 py-5 sm:px-6 min-[1180px]:border-l min-[1180px]:border-t-0 min-[1180px]:py-6">
            {allocation}
          </div>
        </section>

        <TrendSection
          series={data.series}
          perf={data.perf}
          benchmarks={data.benchmarks}
          hasPerf={data.hasPerf}
          benchNotice={data.benchNotice}
          today={data.today}
        />

        {/* 三級。脫掉容器落回 page 背景，靠頂線分區；與二級之間隔 40px，
            把「這是附註」講清楚。資產配置搬去二級之後這裡只剩績效指標，
            內容欄寬收在 640px：四格數字撐滿 1144px 會稀得讀不成一組。
            /demo 例外：被動收入搬到右欄並排（split），兩欄各約 550px，右半不再空著。 */}
        <section className="mt-10 border-t border-[var(--c-border)] pt-7">
          {/* admin 的 AI 區塊放在績效指標右側：640px 欄寬之外原本是空的。
              併進同一個 section 而不是另開一個，因為 .ledger 的子元素數就是進場節奏的階數。
              窄於 lg 時改成上下排。 */}
          <div
            className={
              ai
                ? "grid gap-y-10 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] lg:gap-x-12"
                : ""
            }
          >
            {metricsHasContent ? (
              <div className={demo ? "" : "max-w-[640px]"}>
                <MetricsCard s={summary} split={demo} />
              </div>
            ) : (
              <p className="text-[length:var(--fs-sm)] text-[var(--c-faint)]">
                TWR、回撤與 Sharpe 會在每日淨值快照滿 30 天後顯示。
              </p>
            )}
            {ai && <AiPanel brief={ai.brief} failed={ai.briefFailed} />}
          </div>
        </section>
  </div>
    </>
  );
}

/**
 * 沒有有效帳戶時的首頁。帳戶全都封存的人不是新手，不該叫他「從第一個資產開始」，
 * 改成告訴他帳戶都還在、去哪裡看。CSV 匯入要對得上既有帳戶名稱，
 * 一個帳戶都沒有時按下去只會失敗，所以這裡不放匯入鍵，只說先建帳戶。
 */
function FirstRun({ archivedCount }: { archivedCount: number }) {
  if (archivedCount > 0) {
    return (
      <section className="mx-auto mt-14 max-w-[520px] rounded-[var(--r-card)] border border-[var(--c-border)] bg-[var(--c-surface)] px-6 py-11 text-center sm:px-8">
        <h2 className="text-[length:var(--fs-xl)] font-medium tracking-[-0.02em]">
          <span className="tnum">{archivedCount}</span> 個帳戶都已封存
        </h2>
        <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
          封存的帳戶和紀錄都還在，只是不算進總資產。到帳戶頁按「取消封存」就會回來。
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/?archived=1" className="btn btn-primary">
            查看封存帳戶
          </Link>
          <Link href="/accounts/new" className="btn btn-outline">
            建立新帳戶
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="mx-auto mt-14 max-w-[520px] rounded-[var(--r-card)] border border-[var(--c-border)] bg-[var(--c-surface)] px-6 py-11 text-center sm:px-8">
      <svg
        width="26"
        height="26"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        className="mx-auto text-[var(--c-accent)]"
      >
        <path d="M8 1 L15 8 L8 15 L1 8 Z" />
      </svg>
      <h2 className="mt-4 text-[length:var(--fs-xl)] font-medium tracking-[-0.02em]">
        從第一個資產開始
      </h2>
      <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
        建立帳戶後，這裡會開始累積淨值趨勢、損益、配置與大盤對照。
        已有歷史紀錄的話，先建好同名帳戶，再到「活動紀錄」匯入 CSV。
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/accounts/new"
          className="btn btn-primary"
        >
          建立第一個帳戶
        </Link>
      </div>
    </section>
  );
}
