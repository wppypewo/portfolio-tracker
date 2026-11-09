import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { PageHead } from "@/components/survey";
import { getUnreadCount } from "@/lib/notifications";
import { allocationDrifts } from "@/lib/allocation-drift";
import {
  AlertsClient,
  type AlertAccount,
  type AlertItem,
} from "./AlertsClient";

type DriftAccount = {
  asset_class: string;
  price_market: string;
  quantity: number;
  last_unit_price: number | null;
  last_fx_rate: number;
  manual_value_base: number | null;
};

function valueOf(a: DriftAccount): number {
  if (a.price_market === "manual") return Number(a.manual_value_base ?? 0);
  const unit = Number(a.last_unit_price ?? 0);
  const fx = Number(a.last_fx_rate ?? 1);
  return Number(a.quantity) * unit * fx;
}

export default async function AlertsPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data: pricedAccounts },
    { data: driftAccounts },
    { data: profile },
    { data: alertRows },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("accounts")
      .select("id,name,symbol,price_market,native_currency,last_unit_price")
      .eq("status", "active")
      .neq("price_market", "manual")
      .order("created_at", { ascending: true }),
    supabase
      .from("accounts")
      .select(
        "asset_class,price_market,quantity,last_unit_price,last_fx_rate,manual_value_base",
      )
      .eq("status", "active"),
    supabase.from("profiles").select("allocation_targets").single(),
    supabase
      .from("alerts")
      .select(
        "id,type,account_id,threshold,note,active,last_triggered_at,created_at,account:accounts(id,name,symbol)",
      )
      .order("active", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const accounts: AlertAccount[] = (
    (pricedAccounts ?? []) as {
      id: string;
      name: string;
      symbol: string | null;
      price_market: string;
      native_currency: string;
      last_unit_price: number | null;
    }[]
  ).map((a) => ({
    id: a.id,
    name: a.name,
    symbol: a.symbol,
    market: a.price_market,
    price: a.last_unit_price != null ? Number(a.last_unit_price) : null,
    ccy: a.native_currency,
  }));

  // 目前最大配置偏離（與 cron 同義：只看有設目標的類別，取 max|actual − target|，
  // 目標加總不是 100 時正規化，見 allocation-drift.ts）
  const targets =
    ((profile?.allocation_targets ?? {}) as Record<string, number>) || {};
  const driftList = (driftAccounts ?? []) as DriftAccount[];
  const drifts = allocationDrifts(
    driftList.map((a) => ({ assetClass: a.asset_class, valueTwd: valueOf(a) })),
    targets,
  );
  const currentDrift: number | null =
    drifts.length > 0 ? Math.max(...drifts.map((d) => Math.abs(d.driftPp))) : null;

  const alerts: AlertItem[] = (
    (alertRows ?? []) as unknown as {
      id: string;
      type: AlertItem["type"];
      account_id: string | null;
      threshold: number;
      note: string | null;
      active: boolean;
      last_triggered_at: string | null;
      account: { id: string; name: string; symbol: string | null } | null;
    }[]
  ).map((a) => ({
    id: a.id,
    type: a.type,
    accountId: a.account_id,
    threshold: Number(a.threshold),
    note: a.note,
    active: a.active,
    lastTriggered: a.last_triggered_at,
    accountName: a.account?.name ?? null,
    accountSymbol: a.account?.symbol ?? null,
  }));

  const activeCount = alerts.filter((a) => a.active).length;

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="alerts" userEmail={user?.email} unreadCount={unreadCount} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[900px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-7">
        <Link
          href="/"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] transition-colors hover:text-[var(--c-accent)]"
        >
          ← 回總覽
        </Link>
        <PageHead
          className="mt-4"
          label="提醒規則"
          title="提醒"
          sub="價格突破 / 跌破，或配置偏離目標時，在通知中心收到提醒。"
          action={
            <div className="text-right">
              <div className="font-mono text-[length:var(--fs-2xl)] font-semibold leading-none text-[var(--c-accent)] tnum">
                {activeCount}
              </div>
              <div className="mt-1.5 text-[length:var(--fs-micro)] tracking-[0.06em] text-[var(--c-muted)]">
                啟用中
              </div>
            </div>
          }
        />

        <div className="mt-6">
          <AlertsClient
            accounts={accounts}
            alerts={alerts}
            currentDrift={currentDrift}
          />
        </div>
      </main>
    </div>
  );
}
