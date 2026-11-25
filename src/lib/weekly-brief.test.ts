import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWeeklyDigest,
  formatBriefBody,
  isMonday,
  runWeeklyBrief,
  shiftDate,
  type BriefAccount,
} from "./weekly-brief";

const acc = (over: Partial<BriefAccount> & { id: string }): BriefAccount => ({
  name: over.id,
  asset_class: "us_stock",
  price_market: "us",
  symbol: null,
  quantity: 1,
  last_unit_price: 100,
  last_fx_rate: 1,
  manual_value_base: null,
  ...over,
});

describe("日期工具", () => {
  it("shiftDate 跨月、跨年", () => {
    expect(shiftDate("2026-12-01", -1)).toBe("2026-11-30");
    expect(shiftDate("2026-12-28", 7)).toBe("2027-01-04");
  });
  it("isMonday 以日期本身判斷，不受主機時區影響", () => {
    expect(isMonday("2026-11-23")).toBe(true);
    expect(isMonday("2026-11-25")).toBe(false);
  });
});

describe("buildWeeklyDigest", () => {
  const today = "2026-11-23";

  it("市場變動 = 市值變化 − 淨投入；本週有交易的帳戶不列入漲跌排行", () => {
    const d = buildWeeklyDigest({
      today,
      accounts: [
        acc({ id: "a", last_unit_price: 110 }), // 週初 100 → 110，無交易
        acc({ id: "b", quantity: 2, last_unit_price: 100 }), // 週初 100，本週加碼 100
        acc({ id: "c", last_unit_price: 90 }), // 週初 100 → 90
      ],
      snapshots: [
        { account_id: "a", snapshot_date: "2026-11-15", value_base: 90 },
        { account_id: "a", snapshot_date: "2026-11-16", value_base: 100 },
        { account_id: "b", snapshot_date: "2026-11-16", value_base: 100 },
        { account_id: "c", snapshot_date: "2026-11-16", value_base: 100 },
      ],
      transactions: [
        { account_id: "b", type: "adjust_quantity", cashflow_twd: -100 },
        { account_id: "a", type: "price_update", cashflow_twd: 0 },
      ],
      targets: null,
      notificationTypes: [],
    });
    expect(d.period).toEqual({ from: "2026-11-17", to: today });
    expect(d.totalNowTwd).toBe(400);
    expect(d.weekAgoTwd).toBe(300);
    expect(d.netContributedTwd).toBe(100);
    expect(d.marketMoveTwd).toBe(0);
    // a 只有 price_update，仍列入排行；b 有加碼，排除
    expect(d.gainers).toEqual([{ name: "a", symbol: null, changePct: 10 }]);
    expect(d.losers).toEqual([{ name: "c", symbol: null, changePct: -10 }]);
    // price_update 不算使用者操作
    expect(d.userActions).toEqual({ adjust_quantity: 1 });
  });

  it("取最晚一筆 ≤ 週初的快照，週初之後的不算", () => {
    const d = buildWeeklyDigest({
      today,
      accounts: [acc({ id: "a", last_unit_price: 120 })],
      snapshots: [
        { account_id: "a", snapshot_date: "2026-11-14", value_base: 80 },
        { account_id: "a", snapshot_date: "2026-11-16", value_base: 100 },
        { account_id: "a", snapshot_date: "2026-11-20", value_base: 115 },
      ],
      transactions: [],
      targets: null,
      notificationTypes: [],
    });
    expect(d.weekAgoTwd).toBe(100);
    expect(d.gainers).toEqual([{ name: "a", symbol: null, changePct: 20 }]);
  });

  it("沒有任何週初快照時不給比較數字", () => {
    const d = buildWeeklyDigest({
      today,
      accounts: [acc({ id: "a" })],
      snapshots: [],
      transactions: [],
      targets: null,
      notificationTypes: [],
    });
    expect(d.weekAgoTwd).toBeNull();
    expect(d.changeTwd).toBeNull();
    expect(d.marketMoveTwd).toBeNull();
    expect(d.marketMovePct).toBeNull();
  });

  it("配置偏離與警示次數；週報本身不算警示", () => {
    const d = buildWeeklyDigest({
      today,
      accounts: [
        acc({ id: "a", asset_class: "us_stock", last_unit_price: 70 }),
        acc({ id: "b", asset_class: "cash", price_market: "manual", manual_value_base: 30 }),
      ],
      snapshots: [],
      transactions: [],
      targets: { us_stock: 60, cash: 40 },
      notificationTypes: ["allocation_drift", "allocation_drift", "weekly_brief"],
    });
    const us = d.allocation.find((x) => x.assetClass === "us_stock");
    expect(us).toMatchObject({ actualPct: 70, targetPct: 60, driftPp: 10 });
    expect(d.alertsTriggered).toEqual({ allocation_drift: 2 });
  });
});

describe("formatBriefBody", () => {
  it("附上非投資建議聲明；watch 為空時不印「留意」", () => {
    const body = formatBriefBody({ headline: "本週持平", observations: ["一"], watch: [] });
    expect(body).toContain("・一");
    expect(body).not.toContain("留意");
    expect(body.endsWith("非投資建議。")).toBe(true);
  });
});

// 依表名與操作回傳資料的假 Supabase。只實作 runWeeklyBrief 用到的鏈式方法。
function fakeSupabase(opts: {
  users: { id: string; email: string }[];
  existingBrief?: boolean;
}) {
  const inserts: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let op = "select";
    let selectCols = "";
    let payload: Record<string, unknown> | undefined;
    const b = {
      select: (cols: string) => {
        selectCols = cols;
        return b;
      },
      eq: () => b,
      gte: () => b,
      lte: () => b,
      limit: () => b,
      insert: (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return b;
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "insert") {
          inserts.push(payload!);
          return resolve({ error: null });
        }
        if (table === "notifications" && selectCols === "id") {
          return resolve({ data: opts.existingBrief ? [{ id: "n1" }] : [], error: null });
        }
        if (table === "accounts") return resolve({ data: [acc({ id: "a" })], error: null });
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };
  const client = {
    from,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: opts.users }, error: null }),
      },
    },
  } as unknown as SupabaseClient;
  return { client, inserts };
}

const geminiOk = () =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "思考中", thought: true },
                { text: JSON.stringify({ headline: "持平", observations: ["x"], watch: [] }) },
              ],
            },
          },
        ],
        modelVersion: "gemini-test",
      }),
      { status: 200 },
    ),
  );

describe("runWeeklyBrief", () => {
  const env = { GEMINI_API_KEY: "test-key" };
  const monday = "2026-11-23";

  it("不是週一就不打 API", async () => {
    const fetchImpl = geminiOk();
    const { client } = fakeSupabase({ users: [] });
    const r = await runWeeklyBrief(client, {
      today: "2026-11-24",
      env,
      fetchImpl,
      adminEmails: ["me@example.com"],
    });
    expect(r).toMatchObject({ ran: false, reason: "not_monday" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("沒有 key 就略過", async () => {
    const { client } = fakeSupabase({ users: [] });
    const r = await runWeeklyBrief(client, {
      today: monday,
      env: {},
      adminEmails: ["me@example.com"],
    });
    expect(r).toMatchObject({ ran: false, reason: "no_key" });
  });

  it("只寫給 ADMIN_EMAILS，email 大小寫不拘", async () => {
    const fetchImpl = geminiOk();
    const { client, inserts } = fakeSupabase({
      users: [
        { id: "u-admin", email: "Me@Example.com" },
        { id: "u-other", email: "other@example.com" },
      ],
    });
    const r = await runWeeklyBrief(client, {
      today: monday,
      env,
      fetchImpl,
      adminEmails: ["me@example.com"],
    });
    expect(r).toMatchObject({ ran: true, sent: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ user_id: "u-admin", type: "weekly_brief" });
    expect(String(inserts[0].body)).toContain("非投資建議");
    expect(String(inserts[0].body)).not.toContain("思考中");
    // key 走標頭，不進網址
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
  });

  it("本週已有週報就跳過，不重複扣費", async () => {
    const fetchImpl = geminiOk();
    const { client, inserts } = fakeSupabase({
      users: [{ id: "u-admin", email: "me@example.com" }],
      existingBrief: true,
    });
    const r = await runWeeklyBrief(client, {
      today: monday,
      env,
      fetchImpl,
      adminEmails: ["me@example.com"],
    });
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("Gemini 截斷（MAX_TOKENS）不寫通知，錯誤只帶狀態碼", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] }), {
        status: 200,
      }),
    );
    const { client, inserts } = fakeSupabase({
      users: [{ id: "u-admin", email: "me@example.com" }],
    });
    const r = await runWeeklyBrief(client, {
      today: monday,
      env,
      fetchImpl,
      adminEmails: ["me@example.com"],
    });
    expect(r).toMatchObject({ sent: 0, failed: 1, errors: ["Gemini status=502"] });
    expect(inserts).toHaveLength(0);
  });
});
