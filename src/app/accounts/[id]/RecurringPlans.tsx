"use client";

import { useActionState, useId, useState } from "react";
import {
  createRecurringPlan,
  deletePlan,
  togglePlan,
  type FormState,
} from "./actions";
import { executePlan } from "./recurring-execution-action";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";
import { SurveyLabel, Tag, EmptyPlot } from "@/components/survey";
import { DEFAULT_DCA_TIER_CONFIG } from "@/lib/dca-tiers";
import type { DcaTierStatus } from "@/lib/dca-tier-status";

export type Plan = {
  id: string;
  amount_twd: number;
  /** 每期固定手續費。舊資料在 migration 前沒有這欄，讀到 null 一律當 0。 */
  fee_twd: number | null;
  day_of_month: number;
  start_date: string;
  next_run_date: string;
  last_run_date: string | null;
  active: boolean;
  note: string | null;
  /**
   * 級距加減碼設定（jsonb）。null 是固定金額的計畫。
   * 這裡只拿來判斷「是不是級距計畫」，內容由 server 端解析後算成 DcaTierStatus 傳進來。
   */
  tier_config: unknown;
};

/** 計畫 id → 級距狀態。只有級距計畫才有。 */
export type PlanTierStatuses = Record<string, DcaTierStatus>;

const fmtTwd = (value: number) =>
  value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });

// 帶正負號的百分比。負號用 U+2212，與 lib/format.ts 的 fmtCompact 一致。
const fmtSignedPct = (value: number) => {
  const abs = Math.abs(value).toFixed(2);
  if (Number(abs) === 0) return "0.00%";
  return `${value < 0 ? "−" : "+"}${abs}%`;
};

// 定期定額區塊的控制項高度。小螢幕 44px（WCAG 2.5.5 舒適觸控值），
// sm 以上是滑鼠操作，收到 34px 以免這排在桌機變得笨重。
// 這排按鈕原本只有 28-30px，手指點「暫停」很容易誤中旁邊的「刪除」。
const controlH = "h-11 sm:h-[34px]";

// 新增計劃表單是堆疊的完整欄位，桌機給到 38px 與 app 其他表單接近，
// 不套用上面那排行內控制項的 34px。
const controlFieldH = "h-11 sm:h-[38px]";

function PlanRow({
  plan,
  tier,
  tierPending,
}: {
  plan: Plan;
  tier?: DcaTierStatus;
  tierPending: boolean;
}) {
  const amountFieldId = useId();
  const feeFieldId = useId();
  const planAmount = Number(plan.amount_twd);
  const planFee = Number(plan.fee_twd ?? 0);
  const tiered = plan.tier_config != null;
  // 含息序列還在抓：建議金額未定，先鎖住執行，免得用基準金額送出去。
  const awaitingTier = tiered && tierPending;
  const suggested = tier?.ok ? tier.suggestedAmount : null;
  const amountDefault = suggested ?? planAmount;
  const [execState, execAction, execPending] = useActionState<FormState, FormData>(
    executePlan,
    undefined,
  );
  const [toggleState, toggleAction, togglePending] = useActionState<
    FormState,
    FormData
  >(togglePlan, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState<
    FormState,
    FormData
  >(deletePlan, undefined);

  // 這三支成功時都回 ok 字串（已執行本期定期定額／計畫已暫停／計畫已刪除），
  // hook 直接沿用，不另外給成功句。
  useActionAnnounce(execState, execPending);
  useActionAnnounce(toggleState, togglePending);
  useActionAnnounce(deleteState, deletePending);

  const error =
    execState?.error || toggleState?.error || deleteState?.error;
  const success = execState?.ok || toggleState?.ok || deleteState?.ok;

  return (
    <div
      className={`border border-[var(--c-border)] p-4 ${
        plan.active
          ? "bg-[var(--c-surface)]"
          : "bg-[var(--c-surface-soft)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-sm)] font-medium tnum">
            每月 {plan.day_of_month} 日{" "}
            <span className="text-[var(--c-muted)]">·</span>{" "}
            {tiered && "基準 "}
            <span className="amt">NT$ {fmtTwd(planAmount)}</span>
            {planFee > 0 && (
              <span className="ml-1.5 text-[length:var(--fs-micro)] font-normal text-[var(--c-muted)]">
                （含手續費 NT$ {fmtTwd(planFee)}）
              </span>
            )}
          </div>
          <div className="mt-1 text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
            下次{" "}
            <span className="text-[var(--c-text)]">{plan.next_run_date}</span>
            {plan.last_run_date && (
              <>
                <span className="mx-1 text-[var(--c-faint)]">·</span>
                上次 {plan.last_run_date}
              </>
            )}
            {!plan.active && (
              <span className="ml-2 inline-block border border-[var(--c-line-strong)] px-1.5 py-px text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                已暫停
              </span>
            )}
          </div>
          {plan.note && (
            <div className="mt-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
              備註：{plan.note}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            action={execAction}
            className="flex basis-full items-center gap-1.5 sm:basis-auto"
          >
            <input type="hidden" name="planId" value={plan.id} />
            <label htmlFor={amountFieldId} className="sr-only">
              {suggested !== null
                ? "本期金額（TWD），已預填級距建議金額，留空則用基準金額"
                : "本期金額（TWD），留空沿用計劃金額"}
            </label>
            <div className="relative flex-1 sm:flex-none">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[length:var(--fs-micro)] text-[var(--c-faint)]"
              >
                NT$
              </span>
              <input
                // 排程日一推進就重新掛載，把金額重設回計劃預設值。
                // 否則 defaultValue 只在掛載時生效，上期打的覆寫金額會留在框裡，
                // 下期不小心直接送出就沿用了上期的加減碼決定。
                // 級距計畫的預設值是建議金額，收盤更新後建議金額變了也要重新掛載。
                key={`${plan.next_run_date}:${amountDefault}`}
                id={amountFieldId}
                name="amount"
                type="number"
                step="any"
                // 金額欄位是 numeric(20,2)，RPC 也先 round 到 2 位才驗證正數。
                // min 設 0 會讓 0 通過瀏覽器驗證、白跑一趟 server 才被擋。
                min="0.01"
                disabled={!plan.active || awaitingTier}
                defaultValue={amountDefault}
                className={`${controlH} field w-full py-0 pl-9 pr-2 text-right tnum disabled:opacity-40 sm:w-[118px]`}
              />
            </div>
            <label htmlFor={feeFieldId} className="sr-only">
              本期手續費（TWD），留空沿用計劃設定
            </label>
            <div className="relative flex-1 sm:flex-none">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[length:var(--fs-micro)] text-[var(--c-faint)]"
              >
                費
              </span>
              <input
                // 與金額欄同理：排程日推進就重新掛載，避免上期的手續費留在框裡。
                key={plan.next_run_date}
                id={feeFieldId}
                name="fee"
                type="number"
                step="any"
                min="0"
                disabled={!plan.active || awaitingTier}
                defaultValue={planFee}
                className={`${controlH} field w-full py-0 pl-7 pr-2 text-right tnum disabled:opacity-40 sm:w-[86px]`}
              />
            </div>
            <button
              type="submit"
              disabled={execPending || !plan.active || awaitingTier}
              className={`${controlH} btn btn-neutral btn-sm btn-fit shrink-0`}
            >
              {execPending ? "執行中…" : "立即執行"}
            </button>
          </form>
          <form action={toggleAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <input
              type="hidden"
              name="newActive"
              value={plan.active ? "false" : "true"}
            />
            <button
              type="submit"
              disabled={togglePending}
              className={`${controlH} btn btn-outline btn-sm btn-fit`}
            >
              {plan.active ? "暫停" : "啟用"}
            </button>
          </form>
          <form action={deleteAction}>
            <input type="hidden" name="planId" value={plan.id} />
            <button
              type="submit"
              disabled={deletePending}
              className={`${controlH} btn btn-ghost btn-ghost-danger btn-sm btn-fit underline`}
            >
              刪除
            </button>
          </form>
        </div>
      </div>
      {tiered && (
        <TierStrip
          plan={plan}
          planAmount={planAmount}
          tier={tier}
          pending={tierPending}
        />
      )}
      {error && (
        <p className="mt-3 border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
          {error}
        </p>
      )}
      {success && !error && (
        <p className="mt-3 border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
          {success}
        </p>
      )}
    </div>
  );
}

/* 朱砂註記：虛線引線加「注意」兩字，不單靠顏色（design.md）。 */
function TierNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 border-l border-dashed border-[var(--c-annot)] pl-2 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
      <span className="font-semibold text-[var(--c-annot-text)]">注意</span>{" "}
      {children}
    </p>
  );
}

const tierTermClass = "text-[length:var(--fs-micro)] text-[var(--c-muted)]";
const tierValueClass = "mt-0.5 text-[length:var(--fs-sm)] font-medium tnum";

/* 級距計畫列下方的狀態帶，內容對應 TradingView 指標右上角那張表：
   前高回撤、高於均線、目前級距、倍數、本期金額。 */
function TierStrip({
  plan,
  planAmount,
  tier,
  pending,
}: {
  plan: Plan;
  planAmount: number;
  tier?: DcaTierStatus;
  pending: boolean;
}) {
  const baseText = `NT$ ${fmtTwd(planAmount)}`;
  // 手動執行算不出級距時退回基準金額，cron 則是該期不買（recurring-tier-amount.ts）。
  // 兩邊行為不同，所以要寫出來。
  const cronSkipText = plan.active
    ? "自動執行時如果還是算不出級距，當天不會買入，隔天再試。"
    : "";

  return (
    <div className="mt-3 border-t border-[var(--c-border)] pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SurveyLabel>級距加減碼</SurveyLabel>
        {tier?.ok && (
          <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
            依 {tier.asOf} 收盤
            <span className="mx-1 text-[var(--c-faint)]">·</span>
            除權息 {tier.dividendCount} 筆
          </span>
        )}
      </div>

      {pending ? (
        <p className="mt-2 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          正在抓歷史股價計算級距…
        </p>
      ) : !tier ? (
        <TierNote>
          這個帳戶算不出級距，本期金額是基準金額 {baseText}。{cronSkipText}
        </TierNote>
      ) : !tier.ok ? (
        <TierNote>
          {tier.error}，這次沒有套用級距，本期金額是基準金額 {baseText}。
          {cronSkipText}
        </TierNote>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <div>
              <dt className={tierTermClass}>前高回撤</dt>
              <dd className={tierValueClass}>{fmtSignedPct(tier.drawdownPct)}</dd>
            </div>
            <div>
              <dt className={tierTermClass}>高於 {tier.maLength}MA</dt>
              <dd className={tierValueClass}>
                {tier.maPremiumPct === null
                  ? "資料不足"
                  : fmtSignedPct(tier.maPremiumPct)}
              </dd>
            </div>
            <div>
              <dt className={tierTermClass}>目前級距</dt>
              <dd className="mt-0.5">
                <Tag tone={tier.tierKind === "base" ? "quiet" : "accent"}>
                  {tier.tierLabel}
                </Tag>
              </dd>
            </div>
            <div>
              <dt className={tierTermClass}>倍數</dt>
              <dd className={tierValueClass}>×{tier.multiplier.toFixed(2)}</dd>
            </div>
          </dl>

          {tier.suggestedAmount !== null ? (
            <p className="mt-2 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
              本期建議{" "}
              <span className="font-semibold text-[var(--c-text)] tnum">
                NT$ {fmtTwd(tier.suggestedAmount)}
              </span>
              （
              <span className="tnum">
                {fmtTwd(planAmount)} × {tier.multiplier.toFixed(2)}
              </span>
              ，取整到百元），已填入本期金額。
              {plan.active && (
                <>
                  <span className="tnum">{plan.next_run_date}</span>{" "}
                  自動執行時會用當時最新的收盤（通常是前一個交易日）重算級距，金額可能與這裡不同；算不出級距時當天不買，隔天再試。
                </>
              )}
            </p>
          ) : (
            <TierNote>
              基準金額乘上倍數、取整到百元後是 0，本期金額維持基準金額 {baseText}。
            </TierNote>
          )}
          {tier.maPremiumPct === null && (
            <TierNote>
              交易日數不到 {tier.maLength} 天，算不出均線，這次只判斷回撤加碼、不會減碼。
            </TierNote>
          )}
          {tier.dividendCount === 0 && (
            <TierNote>
              沒有抓到除權息資料，回撤與均線是用未還原的股價算的。
            </TierNote>
          )}
        </>
      )}
    </div>
  );
}

const tierModeLabelClass =
  "tap-row flex flex-1 cursor-pointer items-center justify-center gap-2 border border-[var(--c-border)] bg-[var(--c-surface-soft)] px-3 py-2.5 text-[length:var(--fs-sm)] font-medium transition-colors hover:border-[var(--c-line-strong)] has-[:checked]:border-[var(--c-accent)] has-[:checked]:bg-[var(--c-accent-soft)] has-[:checked]:text-[var(--c-accent)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--c-accent)]";

/* 一側的級距表：每列是「第 N 級、門檻、倍數」。
   欄名只是視覺上的表頭，每個輸入框另有自己的 aria-label。 */
function TierRows({
  legend,
  side,
  fieldPrefix,
  steps,
  pctMin,
  pctMax,
}: {
  legend: string;
  side: string;
  fieldPrefix: "tierDd" | "tierUp";
  steps: { pct: number; multiplier: number }[];
  pctMin: string;
  pctMax: string;
}) {
  return (
    <fieldset className="border border-[var(--c-border)] px-3 pb-3 pt-2">
      <legend className="px-1 text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
        {legend}
      </legend>
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-2 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
        <span aria-hidden="true" />
        <span aria-hidden="true">門檻（%）</span>
        <span aria-hidden="true">倍數</span>
        {steps.map((step, i) => (
          <div key={i} className="contents">
            <span className="tnum">第 {i + 1} 級</span>
            <input
              name={`${fieldPrefix}Pct${i + 1}`}
              type="number"
              step="any"
              min={pctMin}
              max={pctMax}
              required
              defaultValue={step.pct}
              aria-label={`${side}第 ${i + 1} 級門檻（%）`}
              className={`field ${controlFieldH} py-0 text-right tnum`}
            />
            <input
              name={`${fieldPrefix}Mult${i + 1}`}
              type="number"
              step="any"
              min="0.01"
              max="10"
              required
              defaultValue={step.multiplier}
              aria-label={`${side}第 ${i + 1} 級倍數`}
              className={`field ${controlFieldH} py-0 text-right tnum`}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/* 級距參數。預設值就是指標的那一組（DEFAULT_DCA_TIER_CONFIG），
   欄位名與 lib/schemas/domain/dca-tier-config.ts 的 readDcaTierConfigForm 對應。 */
function TierConfigFields() {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)] sm:max-w-[calc(50%-0.375rem)]">
        均線天數（20-500）
        <input
          name="tierMaLength"
          type="number"
          min="20"
          max="500"
          step="1"
          required
          defaultValue={DEFAULT_DCA_TIER_CONFIG.maLength}
          className={`field ${controlFieldH} py-0`}
        />
      </label>
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <TierRows
          legend="回撤加碼（相對前高，填負數）"
          side="回撤加碼"
          fieldPrefix="tierDd"
          steps={DEFAULT_DCA_TIER_CONFIG.drawdown}
          pctMin="-99.99"
          pctMax="-0.01"
        />
        <TierRows
          legend="高於均線減碼（填正數）"
          side="高於均線減碼"
          fieldPrefix="tierUp"
          steps={DEFAULT_DCA_TIER_CONFIG.premium}
          pctMin="0.01"
          pctMax="1000"
        />
      </div>
      <p className="text-[length:var(--fs-micro)] font-normal leading-5 text-[var(--c-muted)]">
        {
          "預設值與 TradingView 指標「DCA 七級距加減碼 v2 (含息序列)」相同。上面的「每次金額」是 1 倍時的基準金額，建議金額取整到百元；回撤與高於均線同時成立時以回撤為準。排程日的自動執行會用當時最新的收盤（通常是前一個交易日）重算級距後買入；算不出級距時當天不買，隔天再試。"
        }
      </p>
    </div>
  );
}

export function AddRecurringPlanForm({
  accountId,
  tierAvailable,
}: {
  accountId: string;
  /** 只有台股帳戶有含息序列的資料來源，其他市場不顯示級距選項。 */
  tierAvailable: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createRecurringPlan,
    undefined,
  );
  const [tierMode, setTierMode] = useState<"fixed" | "tier">("fixed");
  // createRecurringPlan 成功時回 ok:「定期定額計畫已建立」。
  useActionAnnounce(state, pending);

  return (
    <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
      <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
        新增定期定額計劃
      </summary>
      <form
        action={action}
        className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4"
      >
        <input type="hidden" name="accountId" value={accountId} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
            每次金額（TWD）
            <input
              name="amount"
              type="number"
              step="any"
              min="0"
              required
              placeholder="例：10000"
              className={`field ${controlFieldH} py-0`}
            />
          </label>
          <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
            每期手續費（TWD，留空 = 0）
            <input
              name="fee"
              type="number"
              step="any"
              min="0"
              placeholder="例：500"
              className={`field ${controlFieldH} py-0`}
            />
            <span className="font-normal text-[var(--c-muted)]">
              內含於每次金額，扣掉後才換算股數。
            </span>
          </label>
          <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
            每月幾日扣款（1-28）
            <input
              name="dayOfMonth"
              type="number"
              min="1"
              max="28"
              required
              defaultValue="5"
              className={`field ${controlFieldH} py-0`}
            />
          </label>
        </div>
        <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
          起始日期（留空 = 今天）
          <input
            name="startDate"
            type="date"
            className={`field ${controlFieldH} py-0`}
          />
        </label>
        <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
          備註（選填）
          <input
            name="note"
            type="text"
            placeholder="例：薪資自動撥入"
            className={`field ${controlFieldH} py-0`}
          />
        </label>
        {tierAvailable && (
          <>
            <fieldset className="text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              <legend className="mb-[7px]">金額模式</legend>
              <div className="flex gap-2">
                <label className={tierModeLabelClass}>
                  <input
                    type="radio"
                    name="tierMode"
                    value="fixed"
                    checked={tierMode === "fixed"}
                    onChange={() => setTierMode("fixed")}
                    className="sr-only"
                  />
                  固定金額
                </label>
                <label className={tierModeLabelClass}>
                  <input
                    type="radio"
                    name="tierMode"
                    value="tier"
                    checked={tierMode === "tier"}
                    onChange={() => setTierMode("tier")}
                    className="sr-only"
                  />
                  依級距加減碼
                </label>
              </div>
            </fieldset>
            {tierMode === "tier" && <TierConfigFields />}
          </>
        )}
        {state?.error && (
          <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className={`${controlFieldH} btn btn-neutral btn-fit self-start`}
        >
          {pending ? "建立中…" : "建立計劃"}
        </button>
      </form>
    </details>
  );
}

/**
 * 計畫清單。與建立表單拆開，是因為級距計畫的清單要等含息序列（包在 Suspense 裡），
 * 表單不必跟著等。
 */
export function RecurringPlanList({
  plans,
  tiers,
  tiersPending = false,
}: {
  plans: Plan[];
  tiers?: PlanTierStatuses;
  /** true 代表級距狀態還在算（Suspense 的 fallback）。 */
  tiersPending?: boolean;
}) {
  if (plans.length === 0) {
    return (
      <EmptyPlot compact>尚無定期定額計劃。展開下方表單建立第一個。</EmptyPlot>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {plans.map((plan) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          tier={tiers?.[plan.id]}
          tierPending={tiersPending}
        />
      ))}
    </div>
  );
}
