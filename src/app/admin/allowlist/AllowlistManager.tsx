"use client";

import { useActionState, useState } from "react";
import { deleteUser, type FormState } from "@/lib/allowlist-actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";
import { Panel, Tag, EmptyPlot } from "@/components/survey";

export type UserRow = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function DeleteButton({
  userId,
  email,
  isSelf,
}: {
  userId: string;
  email: string;
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteUser,
    undefined,
  );
  // 成功時該列會從清單消失，讀屏使用者不會察覺，所以補一句成功。
  useActionAnnounce(state, pending, "使用者已刪除");
  const [confirm, setConfirm] = useState(false);

  if (isSelf) {
    return (
      <Tag tone="accent">你自己</Tag>
    );
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="btn btn-ghost btn-ghost-danger btn-sm btn-fit underline"
      >
        踢出
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">
        確定踢出 <b>{email}</b> 並刪除所有資料？
      </span>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-danger btn-sm"
      >
        {pending ? "刪除中…" : "確定"}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        className="btn btn-outline btn-sm"
      >
        取消
      </button>
      {state?.error && (
        <span className="text-[length:var(--fs-micro)] text-[var(--c-down)]">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function UsersManager({
  rows,
  currentUserId,
}: {
  rows: UserRow[];
  currentUserId: string;
}) {
  return (
    <Panel title="已註冊使用者" sub={<span className="tnum">共 {rows.length} 人</span>} flush>
      {rows.length === 0 ? (
        <EmptyPlot className="m-5">還沒有人註冊。</EmptyPlot>
      ) : (
        <ul>
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--c-border-soft)] px-5 py-4 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[length:var(--fs-md)] font-medium text-[var(--c-text)]">
                    {r.email}
                  </span>
                  {!r.confirmed && <Tag tone="annot">未驗證</Tag>}
                </div>
                <div className="tnum mt-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
                  註冊 {fmtDate(r.created_at)}
                  <span className="mx-2 text-[var(--c-faint)]">·</span>
                  上次登入 {fmtDate(r.last_sign_in_at)}
                </div>
              </div>
              <DeleteButton
                userId={r.id}
                email={r.email}
                isSelf={r.id === currentUserId}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
