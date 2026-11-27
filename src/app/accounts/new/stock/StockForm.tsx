"use client";

import { useActionState } from "react";
import { createStockAccount, type FormState } from "../actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";

export function StockForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createStockAccount,
    undefined,
  );
  // 成功會導頁，元件跟著卸載，所以不給成功句；這裡要播報的是失敗。
  useActionAnnounce(state, pending);

  return (
    <form
      action={action}
      className="mt-6 border border-[var(--c-border)] bg-[var(--c-surface)] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
          帳戶名稱
          <input
            name="name"
            required
            placeholder="例：永豐複委託 QQQM"
            className="field h-11 sm:h-10"
          />
        </label>

        <fieldset className="text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
          <legend className="mb-2">市場</legend>
          <div className="flex gap-2">
            <label className="tap-row flex flex-1 cursor-pointer items-center justify-center gap-2 border border-[var(--c-border)] bg-[var(--c-surface-soft)] px-3 py-2.5 text-[length:var(--fs-sm)] font-medium transition-colors hover:border-[var(--c-line-strong)] has-[:checked]:border-[var(--c-accent)] has-[:checked]:bg-[var(--c-accent-soft)] has-[:checked]:text-[var(--c-accent)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--c-accent)]">
              <input type="radio" name="market" value="us" defaultChecked className="sr-only" />
              美股
            </label>
            <label className="tap-row flex flex-1 cursor-pointer items-center justify-center gap-2 border border-[var(--c-border)] bg-[var(--c-surface-soft)] px-3 py-2.5 text-[length:var(--fs-sm)] font-medium transition-colors hover:border-[var(--c-line-strong)] has-[:checked]:border-[var(--c-accent)] has-[:checked]:bg-[var(--c-accent-soft)] has-[:checked]:text-[var(--c-accent)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--c-accent)]">
              <input type="radio" name="market" value="tw" className="sr-only" />
              台股
            </label>
          </div>
        </fieldset>

        <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
          Symbol（美股 ticker 或台股代號）
          <input
            name="symbol"
            required
            placeholder="QQQM 或 2330"
            className="field h-11 sm:h-10"
          />
        </label>

        <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
          持有股數
          <input
            name="quantity"
            type="number"
            step="any"
            min="0"
            required
            placeholder="例：1.37164"
            className="field h-11 sm:h-10"
          />
        </label>

        {state?.error && (
          <p className="border border-[var(--c-down)] px-4 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary mt-1 self-start"
        >
          {pending ? "驗證並建立中…" : "建立帳戶"}
        </button>
      </div>
    </form>
  );
}
