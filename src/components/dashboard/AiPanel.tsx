"use client";

import Link from "next/link";
import { CardHead } from "./shared";

/** 最新一份 AI 週報。由首頁 server 端從 notifications 取出，沒有就是 null。 */
export type AiBrief = { title: string; body: string | null } | null;

/**
 * 首頁的 admin 專用 AI 區塊：最新週報全文＋持股新聞入口。
 * 只有 ADMIN_EMAILS 的帳號會拿到這個區塊（判斷在 src/app/page.tsx），
 * /admin/news 本身也會再擋一次，這裡只是入口。
 *
 * 放在三級（績效指標右側）而不是頂部：週報是文字摘要，不是帳上的數字，
 * 依設計筆記「數字可讀性 > 資訊密度 > 視覺效果」，不該擠進一級摘要。
 */
export function AiPanel({ brief }: { brief: AiBrief }) {
  return (
    <div className="min-w-0">
      <CardHead title="AI 摘要（admin）" sub="Gemini 產生，非投資建議" />

      <div className="border-t border-[var(--c-border)] pt-3.5">
        <h3 className="text-[length:var(--fs-sm)] font-semibold">
          {brief ? brief.title : "AI 週報"}
        </h3>
        {brief?.body ? (
          // 週報本文是 formatBriefBody 排好的純文字，用換行分段，不解析成 HTML。
          <p className="mt-2 whitespace-pre-line text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-text)]">
            {brief.body}
          </p>
        ) : (
          <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
            還沒有週報。每週一台北時間 14:00 的排程會產生一份，寫進通知中心。
          </p>
        )}
        <Link
          href="/notifications"
          className="mt-2 inline-flex min-h-6 items-center text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)] hover:text-[var(--c-text)]"
        >
          通知中心
        </Link>
      </div>

      <div className="mt-5 border-t border-[var(--c-border)] pt-3.5">
        <h3 className="text-[length:var(--fs-sm)] font-semibold">持股新聞</h3>
        <p className="mt-2 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
          用 Google 搜尋整理持股近 7 天的消息。按下才查詢，結果不保存。
        </p>
        <Link href="/admin/news" className="btn btn-outline btn-sm mt-3">
          查持股新聞
        </Link>
      </div>
    </div>
  );
}
