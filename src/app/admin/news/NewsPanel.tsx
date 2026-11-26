"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/survey";
import { AiChat, GroundingExtras } from "@/components/AiChat";
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

            <GroundingExtras suggestionsDoc={result.suggestionsDoc} sources={result.sources} />

            <p className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">
              AI 依搜尋結果整理，可能有錯或遺漏，請點來源核對。非投資建議。
            </p>

            {/* 重新查詢就換一段新對話：key 換了，舊的問答跟著舊結果一起丟掉。 */}
            <AiChat
              key={result.at}
              mode="news"
              openLabel="追問這些消息"
              title="追問新聞"
              opener={result.text}
              suggestions={["把有日期的消息依時間排一次", "哪幾檔近 7 天沒有找到消息？"]}
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
