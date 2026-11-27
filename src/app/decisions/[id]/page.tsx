import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PageHead, Panel, SurveyLabel, Tag } from "@/components/survey";
import { fmtFull, fmtNum } from "@/lib/format";
import { calculateDecisionReviewMetrics } from "@/lib/decision-review-metrics";
import { getUnreadCount } from "@/lib/notifications";
import { fetchAllPages } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { ArchiveToggle } from "./ArchiveToggle";
import { ReviewForm } from "./ReviewForm";

type ReviewRow = {
  hypothesis_outcome: string;
  catalyst_outcome: string;
  risk_outcome: string;
  plan_followed: boolean;
  asset_return_pct: number | null;
  twd_return_pct: number | null;
  fx_effect_pct: number | null;
  max_favorable_excursion_pct: number | null;
  max_adverse_excursion_pct: number | null;
  decision_quality: number;
  reflection: string;
  next_improvement: string;
};

type DecisionRow = {
  id: string;
  account_id: string | null;
  transaction_id: string | null;
  decision_date: string;
  asset_name: string;
  symbol: string | null;
  decision_type: string;
  thesis: string;
  catalysts: string;
  risks: string;
  invalidation_conditions: string;
  expected_holding_months: number;
  target_return_min_pct: number | null;
  target_return_max_pct: number | null;
  max_drawdown_pct: number | null;
  confidence: number;
  review_date: string;
  tags: string[];
  status: string;
  context_snapshot: DecisionSnapshot;
  accounts: { name: string } | null;
  decision_reviews: ReviewRow[] | null;
};

type DecisionSnapshot = {
  captured_at?: string;
  timezone?: string;
  portfolio?: { value_twd?: number; active_account_count?: number };
  account?: {
    name?: string;
    value_twd?: number;
    allocation_pct?: number | null;
    cost_basis_twd?: number;
    unrealized_pnl_twd?: number | null;
    realized_pnl_twd?: number;
    last_priced_at?: string | null;
    status?: string;
  } | null;
  data_gaps?: string[];
};

const typeLabels: Record<string, string> = {
  buy: "買進",
  add: "加碼",
  reduce: "減碼",
  sell: "賣出",
  hold: "續抱",
  avoid: "不採取",
};

export default async function DecisionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
        "id,account_id,transaction_id,decision_date,asset_name,symbol,decision_type,thesis,catalysts,risks,invalidation_conditions,expected_holding_months,target_return_min_pct,target_return_max_pct,max_drawdown_pct,confidence,review_date,tags,status,context_snapshot,accounts(name),decision_reviews(hypothesis_outcome,catalyst_outcome,risk_outcome,plan_followed,asset_return_pct,twd_return_pct,fx_effect_pct,max_favorable_excursion_pct,max_adverse_excursion_pct,decision_quality,reflection,next_improvement)",
      )
      .eq("id", id)
      .single(),
  ]);
  if (!data) notFound();
  const decision = data as unknown as DecisionRow;
  const review = decision.decision_reviews?.[0] ?? null;
  const snapshot = decision.context_snapshot ?? {};
  // 逐頁取：`.limit(2_000)` 會被 PostgREST 的 max-rows（預設 1000）壓成 1000，
  // 也就是約 2.7 年的每日快照。決策檢討期間跨得比這長，指標就是用殘缺序列算的。
  const { data: reviewSnapshots } = decision.account_id
    ? await fetchAllPages<{
        snapshot_date: string;
        unit_price: number | null;
        fx_rate: number | null;
      }>(async (from, to) => {
        const res = await supabase
          .from("account_snapshots")
          .select("snapshot_date,unit_price,fx_rate")
          .eq("account_id", decision.account_id)
          .lte("snapshot_date", decision.review_date)
          .order("snapshot_date", { ascending: true })
          .range(from, to);
        return { data: res.data, error: res.error };
      })
    : { data: [] };
  const suggestedMetrics = calculateDecisionReviewMetrics({
    decisionDate: decision.decision_date,
    reviewDate: decision.review_date,
    snapshots: (reviewSnapshots ?? []).map((row) => ({
      date: row.snapshot_date,
      unitPrice: row.unit_price == null ? null : Number(row.unit_price),
      fxRate: row.fx_rate == null ? null : Number(row.fx_rate),
    })),
  });

  const statusLabel =
    decision.status === "reviewed" ? "已檢討" : decision.status === "archived" ? "已封存" : "追蹤中";

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="decisions" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[920px] px-4 pb-28 pt-8 sm:px-6">
        <Link
          href="/decisions"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] hover:text-[var(--c-accent)]"
        >
          ← 決策日誌
        </Link>
        <PageHead
          className="mt-4"
          label={
            <>
              {typeLabels[decision.decision_type] ?? decision.decision_type}
              <span className="tnum">· {decision.decision_date}</span>
            </>
          }
          title={
            <>
              {decision.asset_name}
              {decision.symbol && (
                <span className="ml-2 font-mono text-[length:var(--fs-lg)] font-medium text-[var(--c-muted)]">
                  {decision.symbol}
                </span>
              )}
            </>
          }
          sub={
            <>
              {decision.accounts?.name ?? "未連結帳戶"} · 信心{" "}
              <span className="tnum">{decision.confidence}/3</span> · 預定檢討{" "}
              <span className="tnum">{decision.review_date}</span>
            </>
          }
          action={
            // 兩種狀態共用同一層外框，ArchiveToggle 才不會在封存／復原後被重新掛載：
            // 重新掛載會把鍵盤焦點丟回頁首，剛按完「封存」就找不到「復原」。
            <div className="flex items-center gap-2">
              {decision.status !== "archived" && (
                <Link href={`/decisions/${decision.id}/edit`} className="btn btn-outline">
                  編輯
                </Link>
              )}
              <ArchiveToggle decisionId={decision.id} archived={decision.status === "archived"} />
            </div>
          }
        />

        {/* 四格論點用 gap-px 透出髮絲線。下行側（失效條件、主要風險）鋪一層 surface-soft，
            讓「看多的理由」與「會錯在哪」一眼分成兩群；這不是警示，所以不用朱砂 */}
        <section className="mt-6 grid gap-px border border-[var(--c-border)] bg-[var(--c-border)] lg:grid-cols-2">
          <TextCell title="投資論點" text={decision.thesis} />
          <TextCell title="失效條件" text={decision.invalidation_conditions} downside />
          <TextCell title="可能催化劑" text={decision.catalysts || "未填寫"} muted={!decision.catalysts} />
          <TextCell title="主要風險" text={decision.risks} downside />
        </section>

        <Panel className="mt-5" title="事前預期" sub={<Tag tone={decision.status === "reviewed" ? "up" : "quiet"}>{statusLabel}</Tag>} flush>
          <dl className="grid grid-cols-2 gap-px bg-[var(--c-border-soft)] sm:grid-cols-3">
            <Metric label="持有期間" value={`${decision.expected_holding_months} 個月`} />
            <Metric label="目標報酬" value={returnRange(decision.target_return_min_pct, decision.target_return_max_pct)} />
            <Metric
              label="可接受跌幅"
              className="col-span-2 sm:col-span-1"
              value={decision.max_drawdown_pct == null ? "未設定" : `${fmtNum(decision.max_drawdown_pct, 2)}%`}
            />
          </dl>
          {decision.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-[var(--c-border-soft)] px-5 py-3">
              {decision.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
        </Panel>

        <SnapshotCard snapshot={snapshot} transactionId={decision.transaction_id} />

        <Panel
          className="mt-5"
          title="事後檢討"
          sub="評估決策流程與證據，不以單次盈虧替代判斷品質。"
        >
          <ReviewForm decisionId={decision.id} initial={review} suggested={suggestedMetrics} />
        </Panel>
      </main>
    </div>
  );
}

function TextCell({
  title,
  text,
  downside = false,
  muted = false,
}: {
  title: string;
  text: string;
  downside?: boolean;
  muted?: boolean;
}) {
  return (
    <article className={`p-5 ${downside ? "bg-[var(--c-surface-soft)]" : "bg-[var(--c-surface)]"}`}>
      <h2>
        <SurveyLabel>{title}</SurveyLabel>
      </h2>
      <p
        className={`mt-2 max-w-[68ch] whitespace-pre-wrap text-[length:var(--fs-md)] leading-7 ${
          muted ? "text-[var(--c-faint)]" : ""
        }`}
      >
        {text}
      </p>
    </article>
  );
}

/* 指標格：外層 dl 用 gap-px 透出 border-soft 當格線，格子自己鋪 surface。
   div 包 dt/dd 在 HTML 規範裡是 dl 允許的分組寫法 */
function Metric({
  label,
  value,
  mask = false,
  className = "",
}: {
  label: string;
  value: string;
  mask?: boolean;
  className?: string;
}) {
  return (
    <div className={`bg-[var(--c-surface)] px-5 py-3 ${className}`}>
      <dt>
        <SurveyLabel>{label}</SurveyLabel>
      </dt>
      <dd className={`mt-1.5 text-[length:var(--fs-md)] font-semibold tnum ${mask ? "amt" : ""}`}>{value}</dd>
    </div>
  );
}

function SnapshotCard({ snapshot, transactionId }: { snapshot: DecisionSnapshot; transactionId: string | null }) {
  const account = snapshot.account;
  return (
    <Panel
      className="mt-5"
      title="建立時情境"
      sub={
        <>
          不可變快照 ·{" "}
          <span className="tnum">
            {snapshot.captured_at
              ? new Date(snapshot.captured_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
              : "時間缺失"}
          </span>
          {transactionId && (
            <Link href="/activity" className="ml-3 text-[var(--c-accent)] hover:underline">
              查看關聯活動 →
            </Link>
          )}
        </>
      }
      flush
    >
      <dl className="grid grid-cols-2 gap-px bg-[var(--c-border-soft)] sm:grid-cols-4">
        <Metric label="組合估值" mask value={`NT$ ${fmtFull(Number(snapshot.portfolio?.value_twd ?? 0))}`} />
        <Metric
          label="帳戶估值"
          mask={account?.value_twd != null}
          value={account?.value_twd == null ? "資料不足" : `NT$ ${fmtFull(Number(account.value_twd))}`}
        />
        <Metric
          label="配置比重"
          value={account?.allocation_pct == null ? "資料不足" : `${fmtNum(account.allocation_pct, 2)}%`}
        />
        <Metric
          label="未實現損益"
          mask={account?.unrealized_pnl_twd != null}
          value={account?.unrealized_pnl_twd == null ? "資料不足" : `NT$ ${fmtFull(account.unrealized_pnl_twd)}`}
        />
      </dl>
      {snapshot.data_gaps && snapshot.data_gaps.length > 0 && (
        /* 資料缺口會讓檢討指標失準，是「請注意」，所以走朱砂虛線框加文字 */
        <div className="m-5 border border-dashed border-[var(--c-annot)] px-4 py-3 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
          <div className="font-medium text-[var(--c-annot-text)]">注意 · 資料缺口</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {snapshot.data_gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function returnRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "未設定";
  if (min != null && max != null) return `${fmtNum(min, 2)}% ～ ${fmtNum(max, 2)}%`;
  return `${fmtNum(min ?? max, 2)}%`;
}
