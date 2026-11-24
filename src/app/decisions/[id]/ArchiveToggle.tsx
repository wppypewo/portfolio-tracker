"use client";

import { useActionState } from "react";
import { setDecisionArchived, type DecisionFormState } from "../actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";

/**
 * 決策頁右上的封存鍵。封存後原位換成「已封存 · 復原」，按錯了當場就能收回；
 * 失敗時把原因寫在鍵旁邊，不再只留在 server log。
 */
export function ArchiveToggle({ decisionId, archived }: { decisionId: string; archived: boolean }) {
  const [state, action, pending] = useActionState<DecisionFormState, FormData>(
    setDecisionArchived,
    undefined,
  );
  useActionAnnounce(state, pending);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="decisionId" value={decisionId} />
      <input type="hidden" name="archived" value={archived ? "false" : "true"} />
      {archived && (
        <span className="text-[length:var(--fs-sm)] text-[var(--c-muted)]">已封存</span>
      )}
      <button type="submit" disabled={pending} className="btn btn-ghost">
        {pending ? "處理中…" : archived ? "復原" : "封存"}
      </button>
      {state?.error && (
        <span role="alert" className="text-[length:var(--fs-micro)] text-[var(--c-down)]">
          {state.error}
        </span>
      )}
    </form>
  );
}
