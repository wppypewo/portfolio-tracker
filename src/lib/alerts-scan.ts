import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 警示掃描：cron 抓完價後呼叫，掃所有 active alerts 看哪些觸發。
 * 觸發後寫入 notifications；不在這裡發 email（email hook 是另外的事）。
 *
 * 為了避免每天觸發同一個警示產生噪音，我們用 last_triggered_at 做去重：
 * - price_above / price_below：每觸發一次就停掉（active=false）。使用者要再次
 *   收到提醒就要自己重新啟用，避免「突破 X」之後天天提醒。
 * - allocation_drift：24 小時內只觸發一次。配置偏離是慢變數，每天提醒一次足夠。
 */

type AlertRow = {
  id: string;
  user_id: string;
  type: "price_above" | "price_below" | "allocation_drift";
  account_id: string | null;
  threshold: number;
  note: string | null;
  last_triggered_at: string | null;
};

type AccountSlim = {
  id: string;
  name: string;
  asset_class: string;
  price_market: string;
  symbol: string | null;
  quantity: number;
  last_unit_price: number | null;
  last_fx_rate: number;
  manual_value_base: number | null;
  status: string;
};

type ProfileSlim = {
  user_id: string;
  allocation_targets: Record<string, number> | null;
};

function valueOf(a: AccountSlim): number {
  if (a.price_market === "manual") return Number(a.manual_value_base ?? 0);
  const unit = Number(a.last_unit_price ?? 0);
  const fx = Number(a.last_fx_rate ?? 1);
  return Number(a.quantity) * unit * fx;
}

export async function scanAlerts(supabase: SupabaseClient) {
  let triggered = 0;
  const errors: string[] = [];

  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("id,user_id,type,account_id,threshold,note,last_triggered_at")
    .eq("active", true);
  if (error) {
    // queryFailed 讓「查詢掛掉」與「今天沒有任何警示要觸發」在監控端分得開，
    // 兩者原本都是 triggered=0。error.message 是 Postgres 原文，只回 code。
    return {
      triggered: 0,
      queryFailed: true,
      errors: [`查詢警示失敗 code=${error.code ?? "unknown"}`],
    };
  }

  // 預先抓所有可能需要的帳戶與 profile 一次
  const accountIds = new Set<string>();
  const userIds = new Set<string>();
  for (const a of (alerts ?? []) as AlertRow[]) {
    if (a.account_id) accountIds.add(a.account_id);
    userIds.add(a.user_id);
  }

  const { data: accountsRaw } = accountIds.size
    ? await supabase
        .from("accounts")
        .select(
          "id,name,asset_class,price_market,symbol,quantity,last_unit_price,last_fx_rate,manual_value_base,status,user_id",
        )
        .in("id", [...accountIds])
    : { data: [] };
  const accountsMap = new Map<string, AccountSlim & { user_id: string }>();
  for (const a of (accountsRaw ?? []) as (AccountSlim & {
    user_id: string;
  })[]) {
    accountsMap.set(a.id, a);
  }

  // 為 allocation_drift 抓每位使用者的目標 + 全部 active 帳戶
  const driftUserIds = (alerts ?? [])
    .filter((a) => a.type === "allocation_drift")
    .map((a) => a.user_id);
  const uniqDriftUsers = [...new Set(driftUserIds)];

  const profilesMap = new Map<string, ProfileSlim>();
  const userAccountsMap = new Map<string, AccountSlim[]>();
  if (uniqDriftUsers.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id,allocation_targets")
      .in("user_id", uniqDriftUsers);
    for (const p of (profiles ?? []) as ProfileSlim[]) {
      profilesMap.set(p.user_id, p);
    }
    const { data: userAccounts } = await supabase
      .from("accounts")
      .select(
        "id,name,asset_class,price_market,symbol,quantity,last_unit_price,last_fx_rate,manual_value_base,status,user_id",
      )
      .in("user_id", uniqDriftUsers)
      .eq("status", "active");
    for (const a of (userAccounts ?? []) as (AccountSlim & {
      user_id: string;
    })[]) {
      const arr = userAccountsMap.get(a.user_id) ?? [];
      arr.push(a);
      userAccountsMap.set(a.user_id, arr);
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  for (const alert of (alerts ?? []) as AlertRow[]) {
    try {
      let didTrigger = false;
      let title = "";
      let body = "";

      if (alert.type === "price_above" || alert.type === "price_below") {
        if (!alert.account_id) continue;
        const acc = accountsMap.get(alert.account_id);
        if (!acc) continue;
        // cron 用 service role 繞過 RLS，alerts.account_id 又只有 FK 沒有擁有者檢查：
        // 指向別人帳戶的警示會把對方的帳戶名稱與現價寫進自己的通知。
        if (acc.user_id !== alert.user_id) {
          errors.push(`alert ${alert.id}: 帳戶擁有者不符，略過`);
          continue;
        }
        if (acc.price_market === "manual") continue;
        const price = Number(acc.last_unit_price ?? 0);
        if (!Number.isFinite(price) || price <= 0) continue;

        if (alert.type === "price_above" && price >= alert.threshold) {
          didTrigger = true;
          title = `${acc.name} 突破 ${alert.threshold}`;
          body = `現價 ${price}，已達警示上界 ${alert.threshold}。`;
        } else if (alert.type === "price_below" && price <= alert.threshold) {
          didTrigger = true;
          title = `${acc.name} 跌破 ${alert.threshold}`;
          body = `現價 ${price}，已跌至警示下界 ${alert.threshold}。`;
        }

        if (didTrigger) {
          const { error: insertError } = await supabase
            .from("notifications")
            .insert({
              user_id: alert.user_id,
              alert_id: alert.id,
              type: alert.type,
              title,
              body,
            });
          // 通知沒寫進去就先別停用：停用後使用者永遠收不到這次觸發。
          if (insertError) {
            errors.push(
              `alert ${alert.id}: 寫入通知失敗 code=${insertError.code ?? "unknown"}`,
            );
            continue;
          }
          // 價格警示觸發後關閉，避免天天重發
          await supabase
            .from("alerts")
            .update({ active: false, last_triggered_at: nowIso })
            .eq("id", alert.id);
          triggered++;
        }
      } else if (alert.type === "allocation_drift") {
        // 24 小時內若已觸發就跳過
        if (alert.last_triggered_at && alert.last_triggered_at > dayAgo) {
          continue;
        }
        const profile = profilesMap.get(alert.user_id);
        const targets = profile?.allocation_targets ?? {};
        const accounts = userAccountsMap.get(alert.user_id) ?? [];
        const total = accounts.reduce((s, a) => s + valueOf(a), 0);
        if (total <= 0) continue;
        const byClass = new Map<string, number>();
        for (const a of accounts) {
          byClass.set(
            a.asset_class,
            (byClass.get(a.asset_class) ?? 0) + valueOf(a),
          );
        }
        const breaches: string[] = [];
        for (const [cls, tgt] of Object.entries(targets)) {
          const tNum = Number(tgt);
          if (!Number.isFinite(tNum) || tNum <= 0) continue;
          const actual = ((byClass.get(cls) ?? 0) / total) * 100;
          const drift = actual - tNum;
          if (Math.abs(drift) >= alert.threshold) {
            const sign = drift > 0 ? "+" : "−";
            breaches.push(`${cls}: 實際 ${actual.toFixed(1)}% (${sign}${Math.abs(drift).toFixed(1)}%)`);
          }
        }
        if (breaches.length > 0) {
          title = `配置偏離 > ${alert.threshold}%`;
          body = breaches.join("\n");
          const { error: insertError } = await supabase
            .from("notifications")
            .insert({
              user_id: alert.user_id,
              alert_id: alert.id,
              type: alert.type,
              title,
              body,
            });
          if (insertError) {
            errors.push(
              `alert ${alert.id}: 寫入通知失敗 code=${insertError.code ?? "unknown"}`,
            );
            continue;
          }
          await supabase
            .from("alerts")
            .update({ last_triggered_at: nowIso })
            .eq("id", alert.id);
          triggered++;
        }
      }
    } catch (e) {
      errors.push(`alert ${alert.id}: ${(e as Error).message}`);
    }
  }

  return { triggered, queryFailed: false, errors };
}
