import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAILS } from "./admin";
import { allocationDrifts } from "./allocation-drift";
import { GeminiError, generateJson } from "./gemini";

/**
 * AI 週報：每週一由 cron 呼叫，替 ADMIN_EMAILS 裡的使用者各產生一則 notifications。
 *
 * 只給 admin：Gemini API 條款要求使用者滿 18 歲，也不得把輸出當成財務建議；
 * 對外開放前得先處理年齡與免責的同意流程，現階段只給自己用。
 *
 * 數字一律由程式算好再交給模型，模型只負責把數字寫成句子。
 * 送出去的只有彙整後的金額、比例與帳戶名稱，不送交易明細與備註。
 */

const TAG = "[cron/weekly-brief]";
export const WEEKLY_BRIEF_TYPE = "weekly_brief";

type Env = Record<string, string | undefined>;

export type BriefAccount = {
  id: string;
  name: string;
  asset_class: string;
  price_market: string;
  symbol: string | null;
  quantity: number;
  last_unit_price: number | null;
  last_fx_rate: number;
  manual_value_base: number | null;
};
export type BriefSnapshot = {
  account_id: string;
  snapshot_date: string;
  value_base: number;
};
export type BriefTransaction = {
  account_id: string;
  type: string;
  cashflow_twd: number | null;
};

/** 與 alerts-scan.ts／dashboard-data.ts 相同的市值口徑。 */
function valueOf(a: BriefAccount): number {
  if (a.price_market === "manual") return Number(a.manual_value_base ?? 0);
  const unit = Number(a.last_unit_price ?? 0);
  const fx = Number(a.last_fx_rate ?? 1);
  return Number(a.quantity) * unit * fx;
}

/** YYYY-MM-DD 加減天數。用 UTC 正午運算，避開主機時區與日光節約。 */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isMonday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 1;
}

const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * 把一週的原始資料彙整成要交給模型的摘要。純函式，方便測試。
 *
 * 口徑：
 * - 只算目前 active 的帳戶。本週歸檔的帳戶兩端都不算，避免一端有、一端沒有。
 * - 週初市值取每個帳戶「最晚一筆 ≤ 週初日」的快照；本週新開的帳戶週初記 0，
 *   開戶那筆 create 的 cashflow 會進淨投入，所以兩邊對得起來。
 * - cashflow_twd 是投資人視角：買進為負、配息與賣出為正（contributions.ts、
 *   realized-pnl-cashflow.sql）。淨投入 = −Σcashflow。
 * - 市場變動 = 市值變化 − 淨投入。配息拿回來的錢算在報酬裡，與 XIRR 口徑一致。
 */
export function buildWeeklyDigest(input: {
  today: string;
  accounts: readonly BriefAccount[];
  snapshots: readonly BriefSnapshot[];
  transactions: readonly BriefTransaction[];
  targets: Record<string, unknown> | null;
  notificationTypes: readonly string[];
}) {
  const from = shiftDate(input.today, -6);
  const baseDate = shiftDate(input.today, -7);
  const active = new Set(input.accounts.map((a) => a.id));

  // 每個帳戶取 ≤ baseDate 的最新快照
  const baseline = new Map<string, BriefSnapshot>();
  for (const s of input.snapshots) {
    if (!active.has(s.account_id) || s.snapshot_date > baseDate) continue;
    const prev = baseline.get(s.account_id);
    if (!prev || s.snapshot_date > prev.snapshot_date) baseline.set(s.account_id, s);
  }

  const txByAccount = new Map<string, number>();
  let netContributed = 0;
  const txCounts: Record<string, number> = {};
  for (const t of input.transactions) {
    if (!active.has(t.account_id)) continue;
    const cf = Number(t.cashflow_twd ?? 0);
    if (Number.isFinite(cf)) netContributed -= cf;
    // price_update 是報價更新，不是使用者的操作，不改持有數量
    if (t.type === "price_update") continue;
    txByAccount.set(t.account_id, (txByAccount.get(t.account_id) ?? 0) + 1);
    txCounts[t.type] = (txCounts[t.type] ?? 0) + 1;
  }

  let totalNow = 0;
  let totalBase = 0;
  const movers: { name: string; symbol: string | null; changePct: number }[] = [];
  for (const a of input.accounts) {
    const now = valueOf(a);
    const base = Number(baseline.get(a.id)?.value_base ?? 0);
    if (Number.isFinite(now)) totalNow += now;
    if (Number.isFinite(base)) totalBase += base;
    // 本週有交易的帳戶，市值變化混著加減碼，算漲跌幅沒有意義
    if (!txByAccount.has(a.id) && base > 0 && now > 0) {
      movers.push({
        name: a.name,
        symbol: a.symbol,
        changePct: round(((now - base) / base) * 100, 1),
      });
    }
  }
  movers.sort((x, y) => y.changePct - x.changePct);
  const gainers = movers.filter((m) => m.changePct > 0).slice(0, 3);
  const losers = movers
    .filter((m) => m.changePct < 0)
    .slice(-3)
    .reverse();

  const hasBaseline = baseline.size > 0;
  const change = totalNow - totalBase;
  const marketMove = change - netContributed;

  const drifts = allocationDrifts(
    input.accounts.map((a) => ({ assetClass: a.asset_class, valueTwd: valueOf(a) })),
    input.targets ?? {},
  ).map((d) => ({
    assetClass: d.assetClass,
    actualPct: round(d.actualPct, 1),
    targetPct: round(d.targetPct, 1),
    driftPp: round(d.driftPp, 1),
  }));

  const alerts: Record<string, number> = {};
  for (const type of input.notificationTypes) {
    if (type === WEEKLY_BRIEF_TYPE) continue;
    alerts[type] = (alerts[type] ?? 0) + 1;
  }

  return {
    period: { from, to: input.today },
    accountCount: input.accounts.length,
    totalNowTwd: round(totalNow),
    // 沒有任何週初快照時不給比較，免得模型把「從 0 變成現值」講成大漲
    weekAgoTwd: hasBaseline ? round(totalBase) : null,
    changeTwd: hasBaseline ? round(change) : null,
    netContributedTwd: round(netContributed),
    marketMoveTwd: hasBaseline ? round(marketMove) : null,
    marketMovePct:
      hasBaseline && totalBase > 0 ? round((marketMove / totalBase) * 100, 2) : null,
    gainers,
    losers,
    allocation: drifts,
    userActions: txCounts,
    alertsTriggered: alerts,
  };
}

export type WeeklyDigest = ReturnType<typeof buildWeeklyDigest>;

const SYSTEM = `你替一位個人投資者整理他自己的投資組合週報，用繁體中文（台灣用語）。

規則：
1. 只描述資料裡已有的數字與變化，不得補充資料以外的市場消息、新聞或原因推測。
2. 不得給任何操作建議：不寫買進、賣出、加碼、減碼、持有、再平衡、停損這類動詞的建議句，也不預測價格。
3. 配置偏離只陳述「實際比例與目標差幾個百分點」，不說該怎麼調。
4. 金額用新台幣，千分位，例如 NT$12,345。百分比保留到小數一位。
5. 值是 null 的欄位代表無法比較，直接略過，不要說成 0。
6. headline 一句話，30 字以內。observations 每條 60 字以內，寫最重要的 2～4 件事。
   watch 寫下週值得留意的數字（例如偏離最大的類別、觸發過的警示），沒有就給空陣列。`;

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    observations: { type: "array", items: { type: "string" }, maxItems: 4 },
    watch: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["headline", "observations", "watch"],
};

type BriefOutput = { headline: string; observations: string[]; watch: string[] };

export function formatBriefBody(out: BriefOutput): string {
  const lines = [String(out.headline ?? "").trim(), ""];
  for (const o of out.observations ?? []) lines.push(`・${String(o).trim()}`);
  const watch = (out.watch ?? []).map((w) => String(w).trim()).filter(Boolean);
  if (watch.length > 0) {
    lines.push("", "留意");
    for (const w of watch) lines.push(`・${w}`);
  }
  lines.push("", "AI 依本週數字產生的觀察，非投資建議。");
  return lines.join("\n");
}

type RunResult = {
  ran: boolean;
  reason?: "not_monday" | "no_key" | "no_admin";
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

/**
 * cron 進入點。不是週一、沒有 key 或沒有 admin 都直接回 ran=false，不打任何 API。
 * 同一週已經寫過週報（重跑 cron、手動觸發）就跳過，避免重複扣費與重複通知。
 */
export async function runWeeklyBrief(
  supabase: SupabaseClient,
  opts: {
    today: string;
    env?: Env;
    fetchImpl?: typeof fetch;
    adminEmails?: readonly string[];
  },
): Promise<RunResult> {
  const result: RunResult = { ran: false, sent: 0, skipped: 0, failed: 0, errors: [] };
  const env = opts.env ?? process.env;
  const admins = opts.adminEmails ?? ADMIN_EMAILS;

  if (!isMonday(opts.today)) return { ...result, reason: "not_monday" };
  if (!String(env.GEMINI_API_KEY ?? "").trim()) return { ...result, reason: "no_key" };
  if (admins.length === 0) return { ...result, reason: "no_admin" };
  result.ran = true;

  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (usersError) {
    result.failed++;
    result.errors.push(`listUsers 失敗 status=${usersError.status ?? "unknown"}`);
    return result;
  }
  const targets = (users?.users ?? []).filter(
    (u) => u.email && admins.includes(u.email.toLowerCase()),
  );

  const from = shiftDate(opts.today, -6);
  // 台北日的 00:00；Postgres 會把帶時區的字串換成 UTC 比較
  const sinceIso = `${from}T00:00:00+08:00`;

  for (const user of targets) {
    try {
      const { data: existing, error: dupError } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", WEEKLY_BRIEF_TYPE)
        .gte("created_at", sinceIso)
        .limit(1);
      if (dupError) {
        result.failed++;
        result.errors.push(`查週報去重失敗 code=${dupError.code ?? "unknown"}`);
        continue;
      }
      if ((existing ?? []).length > 0) {
        result.skipped++;
        continue;
      }

      const [accounts, snapshots, transactions, profile, notes] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id,name,asset_class,price_market,symbol,quantity,last_unit_price,last_fx_rate,manual_value_base",
          )
          .eq("user_id", user.id)
          .eq("status", "active"),
        // 週初前一週的快照就夠找出「最晚一筆 ≤ 週初」，不必整段歷史
        supabase
          .from("account_snapshots")
          .select("account_id,snapshot_date,value_base")
          .eq("user_id", user.id)
          .gte("snapshot_date", shiftDate(opts.today, -14))
          .lte("snapshot_date", shiftDate(opts.today, -7)),
        supabase
          .from("transactions")
          .select("account_id,type,cashflow_twd")
          .eq("user_id", user.id)
          .gte("created_at", sinceIso),
        // profiles 的主鍵是 id（= auth.users.id），沒有 user_id 欄位
        supabase.from("profiles").select("allocation_targets").eq("id", user.id),
        supabase
          .from("notifications")
          .select("type")
          .eq("user_id", user.id)
          .gte("created_at", sinceIso),
      ]);
      const failedQuery = [accounts, snapshots, transactions, profile, notes].find(
        (r) => r.error,
      );
      if (failedQuery) {
        result.failed++;
        result.errors.push(`讀取週報資料失敗 code=${failedQuery.error?.code ?? "unknown"}`);
        continue;
      }
      if ((accounts.data ?? []).length === 0) {
        result.skipped++;
        continue;
      }

      const digest = buildWeeklyDigest({
        today: opts.today,
        accounts: accounts.data as BriefAccount[],
        snapshots: snapshots.data as BriefSnapshot[],
        transactions: transactions.data as BriefTransaction[],
        targets:
          ((profile.data ?? [])[0] as { allocation_targets?: Record<string, unknown> })
            ?.allocation_targets ?? null,
        notificationTypes: ((notes.data ?? []) as { type: string }[]).map((n) => n.type),
      });

      const { value } = await generateJson<BriefOutput>({
        system: SYSTEM,
        prompt: `本週資料（JSON）：\n${JSON.stringify(digest)}`,
        schema: SCHEMA,
        thinking: "low",
        maxOutputTokens: 2048,
        env,
        fetchImpl: opts.fetchImpl,
      });

      const { error: insertError } = await supabase.from("notifications").insert({
        user_id: user.id,
        type: WEEKLY_BRIEF_TYPE,
        title: `本週投資組合週報（${digest.period.from}～${digest.period.to}）`,
        body: formatBriefBody(value),
      });
      if (insertError) {
        result.failed++;
        result.errors.push(`寫入週報失敗 code=${insertError.code ?? "unknown"}`);
        continue;
      }
      result.sent++;
    } catch (error) {
      result.failed++;
      // GeminiError 的訊息是自己寫的固定字串，可以回報；其他例外只進 log。
      if (error instanceof GeminiError) {
        result.errors.push(`Gemini status=${error.status}`);
      } else {
        console.error(`${TAG} 例外`, error);
        result.errors.push("產生週報失敗");
      }
    }
  }
  return result;
}
