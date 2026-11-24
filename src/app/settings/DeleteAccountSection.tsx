"use client";

import { useActionState, useState } from "react";
import { deleteMyAccount, type FormState } from "@/lib/profile-actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";

/**
 * 刪除使用者帳號區（危險區）。資產帳戶的刪除在各帳戶頁，兩者用「帳號／資產帳戶」分開稱呼。
 *
 * 二次確認用「手打自己的 email」而不是單純再按一次按鈕：這是不可逆且會連鎖
 * 清掉所有資料的操作，按鈕連點防不了誤觸。email 比對在 server action 內做，
 * 這裡的 matched 只用來決定按鈕是否可按。
 */
export function DeleteAccountSection({ email }: { email: string | null }) {
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteMyAccount,
    undefined,
  );
  // 成功會 signOut 後導去 /login，所以只播報失敗。
  useActionAnnounce(state, pending);

  const matched =
    email !== null && typed.trim().toLowerCase() === email.toLowerCase();

  return (
    // 危險區：跌色實線框、不鋪底色，標題直接寫明後果
    <div className="mt-4 border border-[var(--c-down)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[length:var(--fs-md)] font-semibold text-[var(--c-down)]">
            刪除我的 StackWorth 帳號
          </span>
          <span className="mt-0.5 block text-[length:var(--fs-micro)] text-[var(--c-muted)]">
            永久刪除所有資料，無法復原。
          </span>
        </div>
        {!confirm && (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="btn btn-outline-danger whitespace-nowrap"
          >
            刪除帳號
          </button>
        )}
      </div>

      {confirm && (
        <form
          action={action}
          className="mt-4 border-t border-dashed border-[var(--c-down)] pt-4"
        >
          <p className="text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-text)]">
            送出後會立刻刪除下列全部資料，且沒有回收桶：
          </p>
          <ul className="mt-2 list-inside list-[square] space-y-1 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
            <li>所有資產帳戶與持倉、交易紀錄、每日淨值快照</li>
            <li>投資決策與覆盤紀錄</li>
            <li>定期定額計劃與執行紀錄</li>
            <li>警示規則與通知</li>
            <li>個人設定（配置目標、集中度上限）與登入身分</li>
          </ul>
          <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
            想留底的話，先用上方的「匯出全部資料」下載一份 CSV。
          </p>

          <label className="mt-4 block text-[length:var(--fs-sm)] font-medium text-[var(--c-text)]">
            輸入
            <span className="mx-1 break-all font-mono font-semibold text-[var(--c-down)]">
              {email ?? "（此帳號沒有 email）"}
            </span>
            以確認
            <input
              name="confirmEmail"
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="field mt-1.5 block h-11 max-w-sm py-0 font-normal"
            />
          </label>

          {state?.error && (
            <p className="mt-3 border border-[var(--c-down)] px-3.5 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]">
              {state.error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              disabled={pending || !matched}
              className="btn btn-danger"
            >
              {pending ? "刪除中…" : "永久刪除我的帳號"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirm(false);
                setTyped("");
              }}
              className="btn btn-outline"
            >
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
