import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { getUnreadCount } from "@/lib/notifications";
import { todayTaipei } from "@/lib/dates";
import { ActivityClient, type ActRow } from "./ActivityClient";

type Row = {
  id: string;
  type: string;
  quantity_after: number | null;
  unit_price: number | null;
  fx_rate: number | null;
  value_after_base: number | null;
  cashflow_twd: number | null;
  note: string | null;
  created_at: string;
  account_id: string;
  accounts: {
    id: string;
    name: string;
    price_market: string;
    symbol: string | null;
  } | null;
};

// 用 Asia/Taipei 把 created_at 拆成日期 + 時:分（分組與顯示都要台北時區）
const taipeiDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const taipeiTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function ActivityPage() {
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
      .from("transactions")
      .select(
        "id,type,quantity_after,unit_price,fx_rate,value_after_base,cashflow_twd,note,created_at,account_id,accounts(id,name,price_market,symbol)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const raw = (data ?? []) as unknown as Row[];
  const rows: ActRow[] = raw.map((r) => ({
    id: r.id,
    type: r.type,
    accountId: r.accounts?.id ?? null,
    accountName: r.accounts?.name ?? null,
    symbol: r.accounts?.symbol ?? null,
    market: r.accounts?.price_market ?? null,
    qty: r.quantity_after,
    price: r.unit_price,
    fx: r.fx_rate,
    value: Number(r.value_after_base ?? 0),
    amount: r.cashflow_twd != null ? Number(r.cashflow_twd) : null,
    note: r.note,
    date: taipeiDate(r.created_at),
    time: taipeiTime(r.created_at),
  }));

  const today = todayTaipei();
  const yesterday = new Date(`${today}T00:00:00+08:00`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="activity" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-8">
        <PageHead
          label="變動帳本"
          title="活動紀錄"
          sub={
            <>
              所有帳戶的變動，依時間倒序 · 最近 <span className="tnum">{rows.length}</span> 筆
              {rows.length >= 200 && "（這裡最多列 200 筆，更早的紀錄在「下載 CSV」裡）"}
            </>
          }
          action={
            <a href="/api/export/csv" download className="btn btn-outline shrink-0">
              ⤓ 下載 CSV
            </a>
          }
        />

        <ActivityClient rows={rows} today={today} yesterday={yesterdayStr} />
      </main>
    </div>
  );
}
