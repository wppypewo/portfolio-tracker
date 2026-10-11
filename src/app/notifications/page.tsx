import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PageHead, Tag, type TagTone, EmptyPlot } from "@/components/survey";
import { getUnreadCount } from "@/lib/notifications";
import {
  MarkAllNotificationsReadButton,
  MarkNotificationReadButton,
} from "./NotificationActions";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  price_above: "價格突破",
  price_below: "價格跌破",
  allocation_drift: "配置偏離",
  system: "系統",
};

const TYPE_TONE: Record<string, TagTone> = {
  price_above: "up",
  price_below: "down",
  allocation_drift: "accent",
  system: "quiet",
};

// 這是 server component，不指定時區會用主機時區（Vercel 是 UTC）。
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function NotificationsPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("notifications")
      .select("id,type,title,body,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const rows = (data ?? []) as Row[];
  const unreadInList = rows.filter((r) => !r.read_at).length;

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active={null} userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] transition-colors hover:text-[var(--c-accent)]"
        >
          ← 回總覽
        </Link>
        <PageHead
          className="mt-4"
          label="通知中心"
          title="通知"
          sub={
            <>
              提醒觸發紀錄，最近 200 筆
              {unreadInList > 0 && (
                <span className="text-[var(--c-text)]">
                  {" "}· 未讀 <span className="tnum">{unreadInList}</span>
                </span>
              )}
            </>
          }
          action={unreadInList > 0 ? <MarkAllNotificationsReadButton /> : undefined}
        />

        {rows.length === 0 ? (
          <EmptyPlot className="mt-6" title="還沒有任何通知">
            先到{" "}
            <Link
              href="/alerts"
              className="text-[var(--c-accent)] underline underline-offset-4"
            >
              提醒
            </Link>
            {" "}建立規則，每日抓價後觸發就會出現在這裡。
          </EmptyPlot>
        ) : (
          <ul className="mt-6 border border-[var(--c-border)] bg-[var(--c-surface)]">
            {rows.map((r) => (
              // 已讀列不整列降透明度（會把內文壓到對比不足），改成標題轉灰、
              // 未讀列左側一條測量藍實線＋「未讀」字樣
              <li
                key={r.id}
                className={`border-t border-[var(--c-border-soft)] px-5 py-4 first:border-t-0 ${
                  r.read_at ? "" : "shadow-[inset_2px_0_0_var(--c-accent)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag tone={TYPE_TONE[r.type] ?? "quiet"}>
                        {TYPE_LABEL[r.type] ?? r.type}
                      </Tag>
                      <span
                        className={`text-[length:var(--fs-sm)] font-semibold ${
                          r.read_at ? "text-[var(--c-muted)]" : ""
                        }`}
                      >
                        {r.title}
                      </span>
                      {!r.read_at && (
                        <span className="text-[length:var(--fs-micro)] font-semibold text-[var(--c-accent)]">
                          未讀
                        </span>
                      )}
                    </div>
                    {r.body && (
                      <p className="mt-1.5 whitespace-pre-line text-[length:var(--fs-sm)] text-[var(--c-muted)]">
                        {r.body}
                      </p>
                    )}
                    <p className="mt-1.5 font-mono text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
                      {fmtTime(r.created_at)}
                    </p>
                  </div>
                  {!r.read_at && (
                    <MarkNotificationReadButton id={r.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
