"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askAi, type AiChatMessage } from "@/lib/ai-chat-actions";
// 只取型別：ai-chat.ts 會連帶 import 週報與 Gemini 的伺服器端程式，不該進前端 bundle。
import type { AiChatMode } from "@/lib/ai-chat";

// 與 src/lib/ai-chat.ts 的 MAX_MESSAGE 相同；伺服器會再擋一次，這裡只是讓輸入框先限制住。
const MAX_MESSAGE = 4_000;

type Source = { uri: string; title: string };
type Entry =
  | { role: "user"; text: string }
  | {
      role: "model";
      text: string;
      signature: string | null;
      truncated: boolean;
      sources: Source[];
      suggestionsDoc: string | null;
    };

/**
 * 新聞搜尋的附帶資訊：Google 搜尋建議與來源連結。新聞頁與新聞追問共用。
 * 搜尋建議依 grounding 條款必須原樣顯示；sandbox 不給 allow-scripts，
 * 只給開新分頁的權限，chip 點下去在新分頁開 Google 搜尋。
 */
export function GroundingExtras({
  suggestionsDoc,
  sources,
  compact = false,
}: {
  suggestionsDoc: string | null;
  sources: Source[];
  /** 對話裡的每輪來源用小一級的標題，免得蓋過新聞頁本身的「來源」。 */
  compact?: boolean;
}) {
  const Heading = compact ? "h4" : "h3";
  return (
    <>
      {suggestionsDoc && (
        <iframe
          title="Google 搜尋建議"
          srcDoc={suggestionsDoc}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="block h-16 w-full border-0"
        />
      )}
      {sources.length > 0 && (
        <div>
          <Heading
            className={
              compact
                ? "text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]"
                : "text-[length:var(--fs-sm)] font-medium"
            }
          >
            來源
          </Heading>
          <ul className={`${compact ? "mt-1.5" : "mt-2"} space-y-1 text-[length:var(--fs-sm)]`}>
            {sources.map((s) => (
              <li key={s.uri}>
                <a
                  href={s.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--c-accent)] underline underline-offset-2"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const PENDING_TEXT: Record<AiChatMode, string> = {
  brief: "AI 回覆中…",
  free: "AI 回覆中…",
  // 新聞追問每輪都重新搜尋，比一般回覆慢得多，先講清楚免得以為卡住。
  news: "搜尋與整理中，約 20～40 秒…",
};

/**
 * 頁面上的 AI 對話。對話只存在這個元件的 state：不寫 DB、不寫 localStorage，
 * 重新整理就消失。每一輪把整段問答送給 server action，數字由伺服器重新讀，不從這裡送。
 *
 * 預設收合成一顆按鈕：首頁的 AI 區塊在三級位置，沒要用時不該佔掉版面。
 */
export function AiChat({
  mode,
  openLabel,
  title,
  opener,
  suggestions = [],
  ask = askAi,
}: {
  mode: AiChatMode;
  /** 收合時按鈕上的字。 */
  openLabel: string;
  title: string;
  /** 新聞模式：頁面上已顯示的那份整理，當成第一則模型回覆送出，但不重複顯示。 */
  opener?: string;
  /** 還沒問過時顯示的範例問題，點了直接送出。 */
  suggestions?: string[];
  /** 預設是真的 server action；測試或開發檢查時可以換成假的，不打 Gemini。 */
  ask?: typeof askAi;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turnsLeft, setTurnsLeft] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 新回覆出現時捲到看得見的位置；用 nearest，已在畫面內就不動，避免頁面亂跳。
  useEffect(() => {
    lastRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, pending]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || pending) return;
    const before = entries;
    const next: Entry[] = [...entries, { role: "user", text }];
    setEntries(next);
    setDraft("");
    setError(null);

    const messages: AiChatMessage[] = [
      ...(opener ? [{ role: "model" as const, text: opener }] : []),
      ...next.map((e) =>
        e.role === "model" && e.signature
          ? { role: e.role, text: e.text, signature: e.signature }
          : { role: e.role, text: e.text },
      ),
    ];

    startTransition(async () => {
      let res;
      try {
        res = await ask({ mode, messages });
      } catch {
        // server action 本身逾時或網路斷線時會丟到這裡
        res = { ok: false as const, error: "連線中斷或逾時，再送一次" };
      }
      if (!res.ok) {
        // 沒送成功就把問題放回輸入框，不讓使用者重打
        setEntries(before);
        setDraft(text);
        setError(`沒有送出：${res.error}`);
        inputRef.current?.focus();
        return;
      }
      setEntries([
        ...next,
        {
          role: "model",
          text: res.text,
          signature: res.signature,
          truncated: res.truncated,
          sources: res.sources,
          suggestionsDoc: res.suggestionsDoc,
        },
      ]);
      setTurnsLeft(res.turnsLeft);
      inputRef.current?.focus();
    });
  };

  const reset = () => {
    setEntries([]);
    setDraft("");
    setError(null);
    setTurnsLeft(null);
    inputRef.current?.focus();
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-sm mt-3" onClick={() => setOpen(true)}>
        {openLabel}
      </button>
    );
  }

  const exhausted = turnsLeft === 0;

  return (
    <div className="mt-4 border-t border-[var(--c-border-soft)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[length:var(--fs-sm)] font-medium">{title}</h4>
        {entries.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={pending}>
            清空對話
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <ol className="mt-3 space-y-4" aria-live="polite" aria-busy={pending}>
          {entries.map((e, i) => (
            <li key={i} ref={i === entries.length - 1 ? lastRef : undefined}>
              <p className="text-[length:var(--fs-micro)] font-medium text-[var(--c-faint)]">
                {e.role === "user" ? "你" : "AI"}
              </p>
              {e.role === "user" ? (
                <p className="mt-1 whitespace-pre-line border-l-2 border-[var(--c-line-strong)] pl-3 text-[length:var(--fs-sm)] leading-relaxed">
                  {e.text}
                </p>
              ) : (
                <div className="mt-1 space-y-3">
                  {/* 回覆是要求模型輸出的純文字，用換行分段，不解析成 HTML。 */}
                  <p className="whitespace-pre-line text-[length:var(--fs-sm)] leading-relaxed">
                    {e.text}
                  </p>
                  {e.truncated && (
                    <p className="text-[length:var(--fs-micro)] text-[var(--c-warn)]">
                      回覆超過長度上限，後面被截掉了。可以請它「接著說」或把問題縮小。
                    </p>
                  )}
                  <GroundingExtras suggestionsDoc={e.suggestionsDoc} sources={e.sources} compact />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {pending && (
        <p className="mt-3 text-[length:var(--fs-sm)] text-[var(--c-muted)]" role="status">
          {PENDING_TEXT[mode]}
        </p>
      )}

      {error && (
        <p className="mt-3 border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
          {error}
        </p>
      )}

      {entries.length === 0 && suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => send(s)}
              disabled={pending}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label className="sr-only" htmlFor={`ai-chat-${mode}`}>
          {title}
        </label>
        <textarea
          id={`ai-chat-${mode}`}
          ref={inputRef}
          className="field min-h-[4.5rem] resize-y"
          rows={2}
          maxLength={MAX_MESSAGE}
          value={draft}
          disabled={exhausted}
          placeholder={exhausted ? "已到對話上限，清空後重新開始" : "輸入問題，Enter 送出、Shift+Enter 換行"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 注音、拼音選字時的 Enter 是確認選字，不能當成送出
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">
            {turnsLeft != null ? `還能問 ${turnsLeft} 輪` : "最多 20 輪"}
            {draft.length > MAX_MESSAGE * 0.8 && ` · ${draft.length}／${MAX_MESSAGE} 字`}
          </p>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={pending || exhausted || !draft.trim()}
          >
            {pending ? "回覆中…" : "送出"}
          </button>
        </div>
      </form>

      <p className="mt-3 text-[length:var(--fs-micro)] text-[var(--c-faint)]">
        AI 回覆可能有錯，非投資建議。對話只留在這個頁面，重新整理就會消失。
      </p>
    </div>
  );
}
