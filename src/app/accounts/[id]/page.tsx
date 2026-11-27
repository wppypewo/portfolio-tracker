import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAllPages } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { AccountActions } from "./AccountActions";
import {
  AddRecurringPlanForm,
  RecurringPlanList,
  type Plan,
} from "./RecurringPlans";
import { TieredPlanList } from "./TieredPlanList";
import { TransactionReversal } from "./TransactionReversal";
import { NetWorthPanel } from "@/components/NetWorthPanel";
import { AppHeader } from "@/components/AppHeader";
import { computeXirr } from "@/lib/xirr";
import { getUnreadCount } from "@/lib/notifications";
import { fmtFull as fmtTwd, fmtNum, fmtUpdatedAt } from "@/lib/format";
import { RefreshPricesButton } from "@/components/RefreshPricesButton";
import { Panel, Stat, StatStrip, SurveyLabel } from "@/components/survey";

const MARKET_LABEL: Record<string, string> = {
  us: "美股",
  tw: "台股",
  crypto: "加密貨幣",
  manual: "手動",
};

const TXN_LABEL: Record<string, string> = {
  create: "新建帳戶",
  adjust_quantity: "調整數量",
  adjust_balance: "修改餘額",
  adjust_cost: "校正成本",
  price_update: "更新價格",
  sell: "賣出",
  dividend: "配息",
  interest: "利息",
};

type TxnRow = {
  id: string;
  type: string;
  quantity_after: number | null;
  unit_price: number | null;
  fx_rate: number | null;
  value_after_base: number | null;
  realized_pnl: number | null;
  cashflow_twd: number | null;
  reversal_of: string | null;
  created_at: string;
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

type Market = "us" | "tw" | "crypto" | "manual";

export default async function AccountDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    unreadCount,
    { data: account },
    { data: txns },
    { data: plansData, error: plansError },
    { data: snapsData },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getUnreadCount(),
    supabase
      .from("accounts")
      .select(
        "id,name,asset_class,price_market,symbol,quantity,native_currency,last_unit_price,last_fx_rate,manual_value_base,last_priced_at,created_at,cost_basis_twd,cost_basis_native,realized_pnl_twd,status",
      )
      .eq("id", id)
      .single(),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("transactions")
        .select(
          "id,type,quantity_after,unit_price,fx_rate,value_after_base,realized_pnl,cashflow_twd,fee_twd,reversal_of,note,created_at",
        )
        .eq("account_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      return { data: res.data, error: res.error };
    }),
    supabase
      .from("recurring_plans")
      .select(
        "id,amount_twd,fee_twd,day_of_month,start_date,next_run_date,last_run_date,active,note,tier_config",
      )
      .eq("account_id", id)
      .order("active", { ascending: false })
      .order("next_run_date", { ascending: true }),
    fetchAllPages(async (from, to) => {
      const res = await supabase
        .from("account_snapshots")
        .select("snapshot_date,value_base")
        .eq("account_id", id)
        .order("snapshot_date", { ascending: true })
        .range(from, to);
      return { data: res.data, error: res.error };
    }),
  ]);
  if (!account) notFound();
  const plans = (plansData ?? []) as Plan[];
  // 級距要用含息序列算，資料來源只有 FinMind（台股）。沒有級距計畫就不抓。
  const tierSymbol =
    account.price_market === "tw" &&
    account.symbol &&
    plans.some((plan) => plan.tier_config != null)
      ? String(account.symbol)
      : null;
  const lineData = ((snapsData ?? []) as {
    snapshot_date: string;
    value_base: number;
  }[]).map((s) => ({ date: s.snapshot_date, value: Number(s.value_base) }));
  const hasTrend = lineData.length >= 2;

  const isManual = account.price_market === "manual";
  const valueBase = isManual
    ? Number(account.manual_value_base ?? 0)
    : Number(account.quantity) *
      Number(account.last_unit_price ?? 0) *
      Number(account.last_fx_rate ?? 1);
  const cost = Number(account.cost_basis_twd ?? 0);
  const costNative = Number(account.cost_basis_native ?? 0);
  const realized = Number(account.realized_pnl_twd ?? 0);
  const pnl = valueBase - cost;
  const totalReturn = pnl + realized;
  const pct = cost > 0 ? ((valueBase - cost) / cost) * 100 : 0;

  // FX 拆解 PnL：當原幣成本 ≠ TWD 成本（即 avg_cost_fx ≠ 1，例如美股 USD）才有意義
  const avgCostFx = costNative > 0 ? cost / costNative : 1;
  const hasFxComponent =
    !isManual &&
    Number.isFinite(avgCostFx) &&
    Math.abs(avgCostFx - 1) > 0.0001 &&
    Number(account.quantity) > 0;
  const curPrice = Number(account.last_unit_price ?? 0);
  const curFx = Number(account.last_fx_rate ?? 1);
  const avgCostNative = Number(account.quantity) > 0 ? costNative / Number(account.quantity) : 0;
  const marketPnl = hasFxComponent
    ? Number(account.quantity) * (curPrice - avgCostNative) * avgCostFx
    : 0;
  const fxPnl = hasFxComponent
    ? Number(account.quantity) * curPrice * (curFx - avgCostFx)
    : 0;
  const tone = (n: number) =>
    n > 0 ? "text-[var(--c-up)]" : n < 0 ? "text-[var(--c-down)]" : "text-[var(--c-muted)]";
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  const pnlClass = tone(pnl);
  const pnlSign = sign(pnl);

  // 已經被沖銷過的原始交易，不再提供第二次更正入口。
  const reversedIds = new Set(
    ((txns ?? []) as TxnRow[])
      .map((t) => t.reversal_of)
      .filter((v): v is string => v !== null),
  );

  // 本帳戶 XIRR
  const accountCashflows = ((txns ?? []) as {
    cashflow_twd: number | null;
    created_at: string;
  }[])
    .map((t) => ({
      amount: Number(t.cashflow_twd),
      when: new Date(t.created_at),
    }))
    .filter((c) => Number.isFinite(c.amount) && c.amount !== 0);
  const now = new Date();
  if (valueBase > 0) {
    accountCashflows.push({ amount: valueBase, when: now });
  }
  const accountXirr = computeXirr(accountCashflows);
  // 跨度不足 30 天就不顯示年化（避免短期波動年化後失真）
  const accountXirrSpan =
    accountCashflows.length > 1
      ? (now.getTime() -
          Math.min(...accountCashflows.map((c) => c.when.getTime()))) /
        86_400_000
      : 0;
  const accountXirrShowable = accountXirr !== null && accountXirrSpan >= 30;

  // 指標帶的格數只能是 3 或 5：已實現為 0 時不列「已實現／總報酬」（避免和未實現重複），
  // XIRR 那格一律保留，算不出或未滿 30 天就寫原因，不讓格數變成 2 或 4。
  const xirrValue = accountXirrShowable && accountXirr !== null ? (
    <span className={tone(accountXirr)}>
      {sign(accountXirr)}
      {Math.abs(accountXirr * 100).toFixed(2)}%
    </span>
  ) : (
    <span className="text-[var(--c-faint)]">—</span>
  );
  const xirrSub =
    accountXirr === null
      ? "現金流不足以計算"
      : accountXirrShowable
        ? "現金流加權"
        : "資料未滿 30 天，暫不年化";

  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="accounts" userEmail={user?.email} unreadCount={unreadCount} />

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/"
          className="text-[length:var(--fs-sm)] text-[var(--c-muted)] transition-colors hover:text-[var(--c-accent)]"
        >
          ← 回總覽
        </Link>

        {account.status === "archived" && (
          <p className="mt-4 border-l border-dashed border-[var(--c-annot)] pl-2 text-[length:var(--fs-sm)] text-[var(--c-annot-text)]">
            此帳戶已封存：系統不會再自動抓價，總覽的總值也不算它。要恢復，按頁面下方的「取消封存」。
          </p>
        )}

        {/* === 帳戶 header：左邊是身分，右邊是目前估值 === */}
        <header className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-[var(--c-line-strong)] pb-5">
          <div className="min-w-0">
            <SurveyLabel>
              {MARKET_LABEL[account.price_market] ?? account.price_market}
              {account.symbol ? ` · ${account.symbol}` : ""}
            </SurveyLabel>
            <h1 className="mt-2 font-display text-[length:var(--fs-2xl)] font-medium leading-tight tracking-[-0.01em]">
              {account.name}
            </h1>
          </div>
          <div className="sm:text-right">
            <SurveyLabel>目前估值</SurveyLabel>
            <p className="mt-1.5 flex items-baseline gap-2 font-mono tnum sm:justify-end">
              <span className="text-[length:var(--fs-md)] font-medium text-[var(--c-muted)]">NT$</span>
              <span className="amt text-[clamp(32px,5vw,44px)] font-semibold leading-none tracking-[-0.02em]">
                {fmtTwd(valueBase)}
              </span>
            </p>
          </div>
        </header>

        {/* 報價來源一行：更新時間、刷新鈕、數量 × 單價 × 匯率 */}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
          <span>
            報價更新於{" "}
            <span className="text-[var(--c-text)]">
              {account.last_priced_at ? fmtUpdatedAt(account.last_priced_at) : "—"}
            </span>
          </span>
          {!isManual && <RefreshPricesButton />}
          {!isManual && (
            <span>
              <span aria-hidden="true" className="mr-2 text-[var(--c-faint)]">·</span>
              <span className="amt">{fmtNum(Number(account.quantity), 8)}</span> ×{" "}
              {account.native_currency} {fmtNum(account.last_unit_price, 4)}
              {Number(account.last_fx_rate) !== 1 && (
                <> × 匯率 {fmtNum(Number(account.last_fx_rate), 4)}</>
              )}
            </span>
          )}
        </p>

        {!isManual && cost > 0 && (
          <StatStrip cols={realized !== 0 ? 5 : 3} className="mt-5">
            <Stat label="成本" value={`NT$ ${fmtTwd(cost)}`} mask />
            <Stat
              label="未實現"
              mask
              value={
                <span className={pnlClass}>
                  {pnlSign}NT$ {fmtTwd(Math.abs(pnl))}
                </span>
              }
              sub={
                <span className={`tnum ${pnlClass}`}>
                  {pnlSign}
                  {Math.abs(pct).toFixed(2)}%
                </span>
              }
            />
            {realized !== 0 && (
              <>
                <Stat
                  label="已實現"
                  mask
                  value={
                    <span className={tone(realized)}>
                      {sign(realized)}NT$ {fmtTwd(Math.abs(realized))}
                    </span>
                  }
                />
                <Stat
                  label="總報酬"
                  mask
                  value={
                    <span className={tone(totalReturn)}>
                      {sign(totalReturn)}NT$ {fmtTwd(Math.abs(totalReturn))}
                    </span>
                  }
                  sub="未實現＋已實現"
                />
              </>
            )}
            <Stat
              label="年化 XIRR"
              value={xirrValue}
              sub={xirrSub}
              // 3 格與 5 格都是奇數，手機兩欄時最後一格會落單，跨兩欄補滿
              className="col-span-2 sm:col-span-1"
            />
          </StatStrip>
        )}

        {hasFxComponent && (
          <p className="mt-3 text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
            未實現拆解{" "}
            <span className={`amt ml-1 ${tone(marketPnl)}`}>
              {sign(marketPnl)}
              {fmtTwd(Math.abs(marketPnl))}
            </span>{" "}
            標的
            <span aria-hidden="true" className="mx-2 text-[var(--c-faint)]">+</span>
            <span className={`amt ${tone(fxPnl)}`}>
              {sign(fxPnl)}
              {fmtTwd(Math.abs(fxPnl))}
            </span>{" "}
            匯率
            <span className="ml-2 text-[var(--c-faint)]">
              （平均成本匯率 {avgCostFx.toFixed(4)} → 現在 {curFx.toFixed(4)}）
            </span>
          </p>
        )}

        {/* === 單一帳戶趨勢 === */}
        {hasTrend && (
          <Panel title="帳戶趨勢" sub="此帳戶每日估值" className="mt-6">
            <div className="amt-chart">
              <NetWorthPanel data={lineData} />
            </div>
          </Panel>
        )}

        {/* === 操作與定期定額：兩欄並排，窄螢幕堆疊 === */}
        <div className={`mt-8 grid gap-8 ${!isManual ? "lg:grid-cols-2" : ""}`}>
          <section>
            <SectionHead title="操作" />
            <div className="mt-3">
              <AccountActions
                accountId={account.id}
                market={account.price_market as Market}
                currentQty={Number(account.quantity)}
                currentBalance={Number(account.manual_value_base ?? 0)}
                currentPrice={Number(account.last_unit_price ?? 0)}
                currentFx={Number(account.last_fx_rate ?? 1)}
                nativeCurrency={account.native_currency}
                currentCost={cost}
                currentCostNative={costNative}
                status={(account.status as "active" | "archived") ?? "active"}
              />
            </div>
          </section>

          {/* === Recurring plans（非手動才顯示） === */}
          {!isManual && (
            <section>
              <SectionHead title="定期定額" />
              {/* 這段在講「立即執行」怎麼用；封存帳戶沒有這顆鍵，說明也不出現 */}
              {account.status !== "archived" && (
              <p className="mt-2 text-[length:var(--fs-micro)] leading-5 text-[var(--c-muted)]">
                「立即執行」會依當下市價換算股數買入，並把下次執行日推到下個月。執行前可改「本期金額」加碼或減碼，只影響這一次；計劃的每月金額與自動執行維持不變。級距計劃會把「本期金額」預填成依回撤與均線算出的建議金額，自動執行時也依級距買入。
              </p>
              )}
              <div className="mt-3 flex flex-col gap-3">
                {plansError ? (
                  // 查詢失敗時 plans 是空的，不能讓畫面說成「尚無計劃」。
                  <p className="border border-dashed border-[var(--c-annot)] px-4 py-3 text-[length:var(--fs-sm)] leading-6 text-[var(--c-muted)]">
                    <span className="font-medium text-[var(--c-annot-text)]">
                      注意
                    </span>{" "}
                    讀不到定期定額計劃，資料沒有變動。重新整理再試一次。
                  </p>
                ) : account.status === "archived" ? (
                  // 封存帳戶不能執行，也就不必等級距的含息序列
                  <RecurringPlanList plans={plans} archived />
                ) : tierSymbol ? (
                  <Suspense
                    fallback={<RecurringPlanList plans={plans} tiersPending />}
                  >
                    <TieredPlanList plans={plans} symbol={tierSymbol} />
                  </Suspense>
                ) : (
                  <RecurringPlanList plans={plans} />
                )}
                {/* 封存帳戶送出新計畫會被 server 擋下（帳戶已封存），乾脆不給填 */}
                {account.status === "archived" ? (
                  <p className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">
                    封存中的帳戶不能新增或執行定期定額；取消封存後就能使用。
                  </p>
                ) : (
                  <AddRecurringPlanForm
                    accountId={account.id}
                    tierAvailable={account.price_market === "tw"}
                  />
                )}
              </div>
            </section>
          )}
        </div>

        {/* === 變動記錄 === */}
        <Panel title="變動記錄" sub={`${(txns ?? []).length} 筆，由新到舊`} flush className="mt-8">
          <p className="scroll-cue px-5 pt-2">左右滑動查看完整欄位</p>
          <div
            className="scroll-region overflow-x-auto"
            tabIndex={0}
            aria-label="帳戶變動記錄，可水平捲動"
          >
            <table className="w-full min-w-[760px] border-collapse text-[length:var(--fs-sm)]">
              <thead>
                <tr className="border-b border-[var(--c-line-strong)] text-[length:var(--fs-micro)] font-medium tracking-[0.06em] text-[var(--c-muted)]">
                  <th scope="col" className="whitespace-nowrap px-5 py-2.5 text-left">類型</th>
                  <th scope="col" className="px-3 py-2.5 text-right">持有後</th>
                  <th scope="col" className="px-3 py-2.5 text-right">單價</th>
                  <th scope="col" className="px-3 py-2.5 text-right">匯率</th>
                  <th scope="col" className="px-3 py-2.5 text-right">市值（TWD）</th>
                  <th scope="col" className="px-3 py-2.5 text-right">現金流</th>
                  <th scope="col" className="px-3 py-2.5 text-right">已實現</th>
                  <th scope="col" className="px-3 py-2.5 text-left">時間</th>
                  <th scope="col" className="px-5 py-2.5 text-right">更正</th>
                </tr>
              </thead>
              <tbody>
                {(txns ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-10 text-center text-[var(--c-muted)]"
                    >
                      無變動記錄
                    </td>
                  </tr>
                )}
                {(txns as TxnRow[] | null ?? []).map((t, index) => {
                  const cf = t.cashflow_twd === null ? null : Number(t.cashflow_twd);
                  const rp =
                    t.realized_pnl === null ? null : Number(t.realized_pnl);
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-[var(--c-border-soft)] first:border-t-0 hover:bg-[var(--c-row-hover)]"
                    >
                      <td className="whitespace-nowrap px-5 py-3 font-medium">
                        {TXN_LABEL[t.type] ?? t.type}
                      </td>
                      <td className="amt px-3 py-3 text-right tnum">
                        {fmtNum(t.quantity_after, 8)}
                      </td>
                      <td className="px-3 py-3 text-right tnum">
                        {fmtNum(t.unit_price, 4)}
                      </td>
                      <td className="px-3 py-3 text-right tnum text-[var(--c-muted)]">
                        {fmtNum(t.fx_rate, 4)}
                      </td>
                      <td className="amt px-3 py-3 text-right font-semibold tnum">
                        {fmtTwd(Number(t.value_after_base ?? 0))}
                      </td>
                      <td
                        className={`amt px-3 py-3 text-right tnum ${cf === null ? "text-[var(--c-faint)]" : cf > 0 ? "text-[var(--c-up)]" : cf < 0 ? "text-[var(--c-down)]" : "text-[var(--c-muted)]"}`}
                      >
                        {cf === null
                          ? "—"
                          : `${cf > 0 ? "+" : cf < 0 ? "−" : ""}${fmtTwd(Math.abs(cf))}`}
                      </td>
                      <td
                        className={`amt px-3 py-3 text-right tnum ${rp === null || rp === 0 ? "text-[var(--c-faint)]" : rp > 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"}`}
                      >
                        {rp === null || rp === 0
                          ? "—"
                          : `${rp > 0 ? "+" : "−"}${fmtTwd(Math.abs(rp))}`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[var(--c-muted)] tnum">
                        {fmtTime(t.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right text-[length:var(--fs-micro)]">
                        <TransactionReversal
                          accountId={id}
                          target={{
                            id: t.id,
                            type: t.type,
                            cashflow_twd: t.cashflow_twd,
                            isReversal: t.reversal_of !== null,
                            alreadyReversed: reversedIds.has(t.id),
                            // txns 以 created_at 由新到舊排序，第 0 列就是最新一筆。
                            isLatest: index === 0,
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    </div>
  );
}

// 操作與定期定額的段落標題：底下一條髮絲線，不加外框。
// 裡面的 details 自己有框，外面再包一層 Panel 會變成框中框。
function SectionHead({ title }: { title: string }) {
  return (
    <h2 className="border-b border-[var(--c-line-strong)] pb-2 text-[length:var(--fs-lg)] font-medium">
      {title}
    </h2>
  );
}
