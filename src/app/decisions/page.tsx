import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PageHead, Stat, StatStrip, Tag, EmptyPlot } from "@/components/survey";
import { todayTaipei } from "@/lib/dates";
import { getUnreadCount } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

type DecisionRow = {
  id: string;
  decision_date: string;
  asset_name: string;
  symbol: string | null;
  decision_type: string;
  thesis: string;
  confidence: number;
  review_date: string;
  status: string;
  tags: string[];
  accounts: { name: string } | null;
  decision_reviews: { id: string }[] | null;
};

const typeLabels: Record<string, string> = {
  buy: "買進",
  add: "加碼",
  reduce: "減碼",
  sell: "賣出",
  hold: "續抱",
  avoid: "不採取",
};

export default async function DecisionsPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("investment_decisions")
      .select(
        "id,decision_date,asset_name,symbol,decision_type,thesis,confidence,review_date,status,tags,accounts(name),decision_reviews(id)",
      )
      .order("decision_date", { ascending: false }),
  ]);
  const decisions = (data ?? []) as unknown as DecisionRow[];
  const today = todayTaipei();
  const dueCount = decisions.filter(
    (decision) =>
      decision.status === "open" &&
      !decision.decision_reviews?.length &&
      decision.review_date <= today,
  ).length;

  const reviewedCount = decisions.filter((d) => d.decision_reviews?.length).length;

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="decisions" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[920px] px-4 pb-28 pt-8 sm:px-6 lg:px-7">
        <PageHead
          label={`${decisions.length} 筆決策`}
          title="決策日誌"
          sub="保存當下論點、風險與失效條件，再以同一份原始情境檢討。"
          action={
            <Link href="/decisions/new" className="btn btn-primary">
              ＋ 記錄決策
            </Link>
          }
        />

        <StatStrip cols={3} className="mt-6">
          <Stat label="決策總數" value={decisions.length} />
          {/* 待檢討是這頁唯一要人做事的數字，大於 0 時補一行朱砂註記，不只靠顏色 */}
          <Stat
            label="待檢討"
            value={dueCount}
            sub={
              dueCount > 0 ? (
                <span className="border-l border-dashed border-[var(--c-annot)] pl-1.5 text-[var(--c-annot-text)]">
                  檢討日已過，尚未填寫
                </span>
              ) : undefined
            }
          />
          <Stat label="已檢討" value={reviewedCount} className="col-span-2 sm:col-span-1" />
        </StatStrip>

        {decisions.length === 0 ? (
          <EmptyPlot className="mt-5" title="還沒有決策紀錄">
            可從這裡建立，或從活動紀錄連結一筆交易後再填寫。
          </EmptyPlot>
        ) : (
          <section className="mt-5 border border-[var(--c-border)] bg-[var(--c-surface)]">
            {decisions.map((decision, index) => {
              const reviewed = Boolean(decision.decision_reviews?.length);
              const due = decision.status === "open" && !reviewed && decision.review_date <= today;
              return (
                <Link
                  key={decision.id}
                  href={`/decisions/${decision.id}`}
                  className={`block px-5 py-4 transition-colors hover:bg-[var(--c-row-hover)] ${
                    index > 0 ? "border-t border-[var(--c-border)]" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Tag tone="accent">
                      {typeLabels[decision.decision_type] ?? decision.decision_type}
                    </Tag>
                    <span className="text-[length:var(--fs-md)] font-semibold">{decision.asset_name}</span>
                    {decision.symbol && (
                      <span className="font-mono text-[length:var(--fs-micro)] text-[var(--c-muted)]">
                        {decision.symbol}
                      </span>
                    )}
                    <span className="ml-auto text-[length:var(--fs-micro)] text-[var(--c-faint)] tnum">
                      {decision.decision_date}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 max-w-[68ch] text-[length:var(--fs-sm)] leading-6 text-[var(--c-muted)]">
                    {decision.thesis}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
                    <span>
                      信心 <span className="tnum text-[var(--c-text)]">{decision.confidence}/3</span>
                    </span>
                    {decision.accounts?.name && <span>· {decision.accounts.name}</span>}
                    <span>
                      · 檢討日 <span className="tnum text-[var(--c-text)]">{decision.review_date}</span>
                    </span>
                    {/* 到期走朱砂虛線框、已檢討走實線綠框，與 /demo/decisions 同一套 */}
                    <Tag tone={reviewed ? "up" : due ? "annot" : "quiet"}>
                      {decision.status === "archived"
                        ? "已封存"
                        : reviewed
                          ? "已檢討"
                          : due
                            ? "檢討到期"
                            : "追蹤中"}
                    </Tag>
                  </div>
                </Link>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}
