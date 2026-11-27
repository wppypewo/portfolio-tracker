"use client";

import { useActionState } from "react";
import { createCryptoAccount, type FormState } from "../actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";

export function CryptoForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createCryptoAccount,
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
            placeholder="例：MAX BTC"
            className="field h-11 sm:h-10"
          />
        </label>

        <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
          CoinGecko ID（不是符號）
          <input
            name="symbol"
            required
            placeholder="bitcoin / ethereum / solana"
            className="field h-11 sm:h-10"
          />
          <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">
            到 coingecko.com 搜尋幣種頁面，網址 /coins/ 後面那個 id。
          </span>
        </label>

        <label className="flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
          持有數量
          <input
            name="quantity"
            type="number"
            step="any"
            min="0"
            required
            placeholder="例：0.01"
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
