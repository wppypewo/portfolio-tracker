import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { getUnreadCount } from "@/lib/notifications";
import { PageHead, SurveyLabel, EmptyPlot } from "@/components/survey";
import {
  ASSET_CLASS_LABEL,
  MARKET_LABEL,
  valueOf,
  type AccountRow,
} from "@/lib/dashboard-data";
import { fmtFull as fmtTwd } from "@/lib/format";

// 帳戶索引：管理視角（含封存），與總覽持倉表的投資視角互補。
// 未登入會被 proxy 導向 /login。
export default async function AccountsPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data: accounts },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("accounts")
      .select(
        "id,name,asset_class,price_market,symbol,quantity,native_currency,last_unit_price,last_fx_rate,manual_value_base,last_priced_at,cost_basis_twd,realized_pnl_twd,status",
      )
      .order("created_at", { ascending: true }),
  ]);

  const rows = (accounts ?? []) as AccountRow[];
  const active = rows.filter((a) => a.status !== "archived");
  const archived = rows.filter((a) => a.status === "archived");

  const activeTotal = active.reduce((sum, a) => sum + valueOf(a), 0);

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="accounts" userEmail={user?.email} unreadCount={unreadCount} />

      <main id="main" tabIndex={-1} className="mx-auto max-w-[880px] px-4 pb-24 pt-8 sm:px-6 lg:px-7">
        <PageHead
          label={
            <>
              <span className="tnum">{active.length}</span> 個使用中
              {archived.length > 0 && (
                <>
                  {" · "}
                  <span className="tnum">{archived.length}</span> 個已封存
                </>
              )}
            </>
          }
          title="帳戶"
          sub="管理視角：列出全部帳戶與目前市值，封存的收在最下方。"
          action={
            <Link href="/accounts/new" className="btn btn-primary shrink-0">
              ＋ 新增帳戶
            </Link>
          }
        />

        {rows.length === 0 ? (
          <EmptyPlot
            className="mt-6"
            title="還沒有任何帳戶"
            action={
              /* 頁首已經有主按鈕，這裡用外框按鈕，避免同頁兩顆主按鈕 */
              <Link href="/accounts/new" className="btn btn-outline">
                建立第一個帳戶
              </Link>
            }
          >
            先建立第一個資產帳戶，總覽的淨值、趨勢與配置就會開始累積。
          </EmptyPlot>
        ) : (
          <>
            <AccountList rows={active} total={activeTotal} className="mt-6" />
            {archived.length > 0 && (
              <details className="mt-6">
                <summary className="tap-row cursor-pointer select-none text-[length:var(--fs-sm)] text-[var(--c-muted)] hover:text-[var(--c-text)]">
                  已封存（<span className="tnum">{archived.length}</span>）
                </summary>
                <div className="mt-3">
                  <AccountList rows={archived} muted />
                </div>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* 帳戶帳本：名稱 → 類別與市場 → 代號 → 市值（→ 占比）。
   寬螢幕有欄名列；窄螢幕欄名收掉，類別與代號併到名稱下方一行。
   total 只給使用中的清單：封存帳戶的占比沒有意義，也不列合計。 */
function AccountList({
  rows,
  total,
  muted = false,
  className = "",
}: {
  rows: AccountRow[];
  total?: number;
  muted?: boolean;
  className?: string;
}) {
  const showShare = total !== undefined && total > 0;
  const cols = showShare
    ? "sm:grid-cols-[minmax(0,1fr)_8rem_6rem_9.5rem_4.5rem]"
    : "sm:grid-cols-[minmax(0,1fr)_8rem_6rem_9.5rem]";
  return (
    <section className={`border border-[var(--c-border)] bg-[var(--c-surface)] ${className}`}>
      <div
        className={`hidden gap-4 border-b border-[var(--c-line-strong)] px-5 py-2.5 sm:grid ${cols}`}
        aria-hidden="true"
      >
        <SurveyLabel>帳戶</SurveyLabel>
        <SurveyLabel>類別 · 市場</SurveyLabel>
        <SurveyLabel>代號</SurveyLabel>
        <SurveyLabel className="justify-end">市值（TWD）</SurveyLabel>
        {showShare && <SurveyLabel className="justify-end">占比</SurveyLabel>}
      </div>
      {rows.map((a, i) => {
        const value = valueOf(a);
        const meta = `${ASSET_CLASS_LABEL[a.asset_class] ?? a.asset_class} · ${
          MARKET_LABEL[a.price_market] ?? a.price_market
        }`;
        return (
          <Link
            key={a.id}
            href={`/accounts/${a.id}`}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-5 py-3.5 transition-colors hover:bg-[var(--c-row-hover)] ${cols} ${
              i > 0 ? "border-t border-[var(--c-border-soft)]" : ""
            } ${muted ? "text-[var(--c-muted)]" : ""}`}
          >
            <div className="min-w-0">
              <div className="truncate text-[length:var(--fs-md)] font-medium">{a.name}</div>
              <div className="mt-0.5 truncate text-[length:var(--fs-micro)] text-[var(--c-muted)] sm:hidden">
                {meta}
                {a.symbol && <span className="font-mono"> · {a.symbol}</span>}
              </div>
            </div>
            <div className="hidden truncate text-[length:var(--fs-sm)] text-[var(--c-muted)] sm:block">
              {meta}
            </div>
            <div className="hidden truncate font-mono text-[length:var(--fs-sm)] text-[var(--c-muted)] sm:block">
              {a.symbol ?? "—"}
            </div>
            <div className="amt text-right text-[length:var(--fs-md)] font-semibold tnum">
              {fmtTwd(value)}
            </div>
            {showShare && (
              <div className="hidden text-right text-[length:var(--fs-sm)] text-[var(--c-muted)] tnum sm:block">
                {((value / total) * 100).toFixed(1)}%
              </div>
            )}
          </Link>
        );
      })}
      {showShare && (
        <div
          className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-[var(--c-line-strong)] px-5 py-3 ${cols}`}
        >
          <SurveyLabel>合計 · <span className="tnum">{rows.length}</span> 個帳戶</SurveyLabel>
          <div className="hidden sm:block" />
          <div className="hidden sm:block" />
          <div className="amt text-right text-[length:var(--fs-md)] font-semibold tnum">
            NT$ {fmtTwd(total)}
          </div>
          <div className="hidden text-right text-[length:var(--fs-sm)] text-[var(--c-muted)] tnum sm:block">
            100%
          </div>
        </div>
      )}
    </section>
  );
}
