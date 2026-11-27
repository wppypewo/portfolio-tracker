"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createInvestmentDecision,
  updateInvestmentDecision,
  type DecisionFormState,
} from "../actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";
import { Panel } from "@/components/survey";

type AccountOption = {
  id: string;
  name: string;
  symbol: string | null;
  status: string;
};

type LinkedTransaction = {
  id: string;
  account_id: string;
  type: string;
  created_at: string;
  accounts: { name: string; symbol: string | null } | null;
};

export type DecisionFormInitial = {
  accountId: string;
  decisionDate: string;
  assetName: string;
  symbol: string;
  decisionType: "buy" | "add" | "reduce" | "sell" | "hold" | "avoid";
  thesis: string;
  catalysts: string;
  risks: string;
  invalidationConditions: string;
  expectedHoldingMonths: number;
  targetReturnMinPct: number | null;
  targetReturnMaxPct: number | null;
  maxDrawdownPct: number | null;
  confidence: number;
  reviewDate: string;
  tags: string;
};

// 外觀走 globals.css 的 .field，焦點交給全站的套準記號
const inputClass = "field mt-1.5";

export function DecisionForm({
  accounts,
  linkedTransaction,
  initialDecisionDate,
  initialReviewDate,
  decisionId,
  initial,
}: {
  accounts: AccountOption[];
  linkedTransaction: LinkedTransaction | null;
  initialDecisionDate: string;
  initialReviewDate: string;
  decisionId?: string;
  initial?: DecisionFormInitial;
}) {
  const submitAction = decisionId
    ? updateInvestmentDecision
    : createInvestmentDecision;
  const [state, action, pending] = useActionState<DecisionFormState, FormData>(
    submitAction,
    undefined,
  );
  // 成功會導頁，元件跟著卸載，所以不給成功句；這裡要播報的是失敗。
  useActionAnnounce(state, pending);
  const linkedAccountId = linkedTransaction?.account_id ?? "";
  const linkedName = linkedTransaction?.accounts?.name ?? "已刪除帳戶";

  return (
    <form action={action} className="space-y-5">
      {decisionId && <input type="hidden" name="decisionId" value={decisionId} />}
      {linkedTransaction && (
        <aside className="border-l-2 border-[var(--c-accent)] bg-[var(--c-accent-soft)] px-4 py-3 text-[length:var(--fs-sm)]">
          <div className="font-medium">已連結交易 · {linkedName}</div>
          <div className="mt-1 text-[var(--c-muted)]">
            類型 {linkedTransaction.type} · 交易識別碼{" "}
            <span className="font-mono">{linkedTransaction.id.slice(0, 8)}…</span>
          </div>
          <input type="hidden" name="transactionId" value={linkedTransaction.id} />
          <input type="hidden" name="accountId" value={linkedAccountId} />
        </aside>
      )}

      <FormSection title="決策與標的">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="決策日期" required>
            <input className={inputClass} type="date" name="decisionDate" defaultValue={initial?.decisionDate ?? initialDecisionDate} required />
          </Field>
          <Field label="決策類型" required>
            <select className={inputClass} name="decisionType" defaultValue={initial?.decisionType ?? "buy"} required>
              <option value="buy">買進</option>
              <option value="add">加碼</option>
              <option value="reduce">減碼</option>
              <option value="sell">賣出</option>
              <option value="hold">續抱</option>
              <option value="avoid">不採取</option>
            </select>
          </Field>
          {!linkedTransaction && (
            <Field label="關聯帳戶" hint="可留空；留空時情境快照不含持倉資料。">
              <select className={inputClass} name={decisionId ? undefined : "accountId"} defaultValue={initial?.accountId ?? ""} disabled={Boolean(decisionId)}>
                <option value="">不連結帳戶</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}{account.symbol ? ` · ${account.symbol}` : ""}{account.status === "archived" ? "（已封存）" : ""}
                  </option>
                ))}
              </select>
              {decisionId && <input type="hidden" name="accountId" value={initial?.accountId ?? ""} />}
            </Field>
          )}
          <Field label="標的名稱" required>
            <input className={inputClass} name="assetName" defaultValue={initial?.assetName ?? (linkedName === "已刪除帳戶" ? "" : linkedName)} maxLength={120} required />
          </Field>
          <Field label="代號">
            <input className={inputClass} name="symbol" defaultValue={initial?.symbol ?? linkedTransaction?.accounts?.symbol ?? ""} maxLength={40} autoCapitalize="characters" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="事前論證">
        <Field label="投資論點" hint="寫下可被驗證的主張，不要只寫價格會漲。" required>
          <textarea className={`${inputClass} min-h-28 resize-y`} name="thesis" defaultValue={initial?.thesis ?? ""} maxLength={4000} required />
        </Field>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="可能催化劑">
            <textarea className={`${inputClass} min-h-24 resize-y`} name="catalysts" defaultValue={initial?.catalysts ?? ""} maxLength={3000} />
          </Field>
          <Field label="主要風險" required>
            <textarea className={`${inputClass} min-h-24 resize-y`} name="risks" defaultValue={initial?.risks ?? ""} maxLength={3000} required />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="失效條件" hint="什麼證據出現時，這個論點不再成立？" required>
            <textarea className={`${inputClass} min-h-24 resize-y`} name="invalidationConditions" defaultValue={initial?.invalidationConditions ?? ""} maxLength={3000} required />
          </Field>
        </div>
      </FormSection>

      <FormSection title="預期與檢討">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="預期持有（月）" required>
            <input className={inputClass} type="number" name="expectedHoldingMonths" min={1} max={600} defaultValue={initial?.expectedHoldingMonths ?? 24} required />
          </Field>
          <Field label="目標報酬下限（%）">
            <input className={inputClass} type="number" name="targetReturnMinPct" step="0.1" min={-100} defaultValue={initial?.targetReturnMinPct ?? ""} />
          </Field>
          <Field label="目標報酬上限（%）">
            <input className={inputClass} type="number" name="targetReturnMaxPct" step="0.1" min={-100} defaultValue={initial?.targetReturnMaxPct ?? ""} />
          </Field>
          <Field label="最大可接受跌幅（%）">
            <input className={inputClass} type="number" name="maxDrawdownPct" step="0.1" min={0} max={100} defaultValue={initial?.maxDrawdownPct ?? ""} />
          </Field>
          <Field label="信心程度" required>
            <select className={inputClass} name="confidence" defaultValue={String(initial?.confidence ?? 2)} required>
              <option value="1">1 · 低</option>
              <option value="2">2 · 中</option>
              <option value="3">3 · 高</option>
            </select>
          </Field>
          <Field label="預定檢討日" required>
            <input className={inputClass} type="date" name="reviewDate" defaultValue={initial?.reviewDate ?? initialReviewDate} required />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="標籤" hint="以逗號分隔，最多 12 個。">
            <input className={inputClass} name="tags" defaultValue={initial?.tags ?? ""} maxLength={400} placeholder="長期配置, 估值, 科技" />
          </Field>
        </div>
      </FormSection>

      {state?.error && (
        <p className="border border-[var(--c-down)] px-4 py-3 text-[length:var(--fs-sm)] text-[var(--c-down)]">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        <Link href="/decisions" className="btn btn-outline">
          取消
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "儲存中…" : decisionId ? "儲存修改" : "儲存決策與情境"}
        </button>
      </div>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <Panel title={title}>{children}</Panel>;
}

function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[length:var(--fs-sm)] font-medium">
      {label}
      {/* 必填星號只是視覺提示，欄位本身有 required，輔助技術會自己讀出 */}
      {required && <span aria-hidden="true" className="ml-1 text-[var(--c-accent)]">*</span>}
      {hint && (
        <span className="mt-0.5 block text-[length:var(--fs-micro)] font-normal text-[var(--c-muted)]">
          {hint}
        </span>
      )}
      {children}
    </label>
  );
}
