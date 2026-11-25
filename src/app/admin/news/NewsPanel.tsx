"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/survey";
import { fetchHoldingsNews, type NewsResult } from "./actions";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function NewsPanel() {
  const [result, setResult] = useState<NewsResult | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      try {
        setResult(await fetchHoldingsNews());
      } catch {
        // server action 本身逾時或網路斷線時會丟到這裡
        setResult({ ok: false, error: "連線中斷或逾時，再按一次" });
      }
    });

  return (
    <Panel
      title="近 7 天消息"
      sub={result?.ok ? `${fmtTime(result.at)} 查詢 · ${result.model}` : undefined}
      action={
        <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={pending}>
          {pending ? "查詢中…" : result ? "重新查詢" : "查詢"}
        </button>
      }
    >
      <div aria-live="polite">
        {!result && !pending && (
          <p className="text-[length:var(--fs-sm)] text-[var(--c-muted)]">
            按「查詢」開始。每次約 20～40 秒。
          </p>
        )}
        {pending && (
          <p className="text-[length:var(--fs-sm)] text-[var(--c-muted)]">正在搜尋與整理…</p>
        )}
        {!pending && result && !result.ok && (
          <p className="border border-[var(--c-down)] px-3.5 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]">
            {result.error}
          </p>
        )}
        {!pending && result?.ok && (
          <div className="space-y-5">
            <p className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">
              查詢標的：{result.symbols.join("、")}
            </p>
            <div className="whitespace-pre-line text-[length:var(--fs-sm)] leading-relaxed">
              {result.text}
            </div>

            {result.suggestionsDoc && (
              // Google 搜尋建議：條款要求原樣顯示。sandbox 不給 allow-scripts，
              // 只給開新分頁的權限，chip 點下去在新分頁開 Google 搜尋。
              <iframe
                title="Google 搜尋建議"
                srcDoc={result.suggestionsDoc}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="block h-16 w-full border-0"
              />
            )}

            {result.sources.length > 0 && (
              <div>
                <h3 className="text-[length:var(--fs-sm)] font-semibold">來源</h3>
                <ul className="mt-2 space-y-1 text-[length:var(--fs-sm)]">
                  {result.sources.map((s) => (
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

            <p className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">
              AI 依搜尋結果整理，可能有錯或遺漏，請點來源核對。非投資建議。
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
