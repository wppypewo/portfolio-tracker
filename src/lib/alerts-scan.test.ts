import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scanAlerts } from "./alerts-scan";

type Row = Record<string, unknown>;

// 只實作 scanAlerts 用到的鏈式呼叫：select / eq / in / insert / update，
// await 時依表名回傳預先放好的資料。insert / update 記到 calls 供斷言。
function fakeSupabase(
  tables: Record<string, Row[]>,
  opts: { insertError?: { code: string }; updateError?: { code: string } } = {},
) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const from = (table: string) => {
    let op = "select";
    let payload: unknown;
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      insert: (p: unknown) => {
        op = "insert";
        payload = p;
        return builder;
      },
      update: (p: unknown) => {
        op = "update";
        payload = p;
        return builder;
      },
      then: (resolve: (v: unknown) => void) => {
        calls.push({ table, op, payload });
        if (op === "insert") return resolve({ error: opts.insertError ?? null });
        if (op === "update") return resolve({ error: opts.updateError ?? null });
        return resolve({ data: tables[table] ?? [], error: null });
      },
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const account = (userId: string) => ({
  id: "acc-1",
  name: "別人的帳戶",
  asset_class: "us_stock",
  price_market: "us",
  symbol: "VOO",
  quantity: 1,
  last_unit_price: 500,
  last_fx_rate: 32,
  manual_value_base: null,
  status: "active",
  user_id: userId,
});

const priceAlert = {
  id: "alert-1",
  user_id: "me",
  type: "price_above",
  account_id: "acc-1",
  threshold: 100,
  note: null,
  last_triggered_at: null,
};

describe("scanAlerts", () => {
  it("價格警示指向別人的帳戶時不寫通知、不停用", async () => {
    const { client, calls } = fakeSupabase({
      alerts: [priceAlert],
      accounts: [account("someone-else")],
    });

    const result = await scanAlerts(client);

    expect(result.triggered).toBe(0);
    expect(result.errors[0]).toMatch(/擁有者不符/);
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("自己的帳戶照常觸發：寫通知並停用警示", async () => {
    const { client, calls } = fakeSupabase({
      alerts: [priceAlert],
      accounts: [account("me")],
    });

    const result = await scanAlerts(client);

    expect(result.triggered).toBe(1);
    expect(calls.map((c) => `${c.table}:${c.op}`)).toContain("notifications:insert");
    expect(calls.map((c) => `${c.table}:${c.op}`)).toContain("alerts:update");
  });

  it("通知寫入失敗時不停用警示，錯誤回報 code", async () => {
    const { client, calls } = fakeSupabase(
      { alerts: [priceAlert], accounts: [account("me")] },
      { insertError: { code: "42501" } },
    );

    const result = await scanAlerts(client);

    expect(result.triggered).toBe(0);
    expect(result.errors[0]).toMatch(/寫入通知失敗 code=42501/);
    expect(calls.some((c) => c.table === "alerts" && c.op === "update")).toBe(false);
  });

  it("配置偏離的通知寫入失敗時不更新 last_triggered_at", async () => {
    const { client, calls } = fakeSupabase(
      {
        alerts: [
          { ...priceAlert, type: "allocation_drift", account_id: null, threshold: 5 },
        ],
        profiles: [{ user_id: "me", allocation_targets: { us_stock: 50 } }],
        accounts: [account("me")],
      },
      { insertError: { code: "500" } },
    );

    const result = await scanAlerts(client);

    expect(result.triggered).toBe(0);
    expect(calls.some((c) => c.table === "alerts" && c.op === "update")).toBe(false);
  });

  describe("配置偏離每天提醒一次", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const driftAlert = (lastTriggeredAt: string) => ({
      ...priceAlert,
      type: "allocation_drift",
      account_id: null,
      threshold: 5,
      last_triggered_at: lastTriggeredAt,
    });
    const tables = (lastTriggeredAt: string) => ({
      alerts: [driftAlert(lastTriggeredAt)],
      profiles: [{ user_id: "me", allocation_targets: { us_stock: 50 } }],
      accounts: [account("me")],
    });

    it("前一天觸發過、相隔不到 24 小時，今天仍然提醒", async () => {
      // cron 排在 06:00 UTC，Hobby 方案在那個小時內浮動：
      // 昨天 06:50 跑、今天 06:20 跑，只隔 23.5 小時。
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-06T06:20:00Z"));
      const { client, calls } = fakeSupabase(tables("2026-11-05T06:50:00Z"));

      const result = await scanAlerts(client);

      expect(result.triggered).toBe(1);
      expect(calls.map((c) => `${c.table}:${c.op}`)).toContain("notifications:insert");
    });

    it("同一個台北日已經觸發過就不再提醒", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-06T06:20:00Z"));
      const { client, calls } = fakeSupabase(tables("2026-11-06T06:05:00Z"));

      const result = await scanAlerts(client);

      expect(result.triggered).toBe(0);
      expect(calls.some((c) => c.op === "insert")).toBe(false);
    });

    it("以台北日切換：UTC 同一天、台北已跨日時照常提醒", async () => {
      // 2026-11-05T15:30Z 是台北 11-05 23:30；2026-11-05T16:30Z 是台北 11-06 00:30。
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-05T16:30:00Z"));
      const { client } = fakeSupabase(tables("2026-11-05T15:30:00Z"));

      const result = await scanAlerts(client);

      expect(result.triggered).toBe(1);
    });
  });

  it("價格警示停用失敗時回報錯誤（通知已寫入仍算觸發）", async () => {
    const { client } = fakeSupabase(
      { alerts: [priceAlert], accounts: [account("me")] },
      { updateError: { code: "40001" } },
    );

    const result = await scanAlerts(client);

    expect(result.triggered).toBe(1);
    expect(result.errors[0]).toMatch(/停用警示失敗 code=40001/);
  });

  it("配置偏離更新觸發時間失敗時回報錯誤", async () => {
    const { client } = fakeSupabase(
      {
        alerts: [
          { ...priceAlert, type: "allocation_drift", account_id: null, threshold: 5 },
        ],
        profiles: [{ user_id: "me", allocation_targets: { us_stock: 50 } }],
        accounts: [account("me")],
      },
      { updateError: { code: "40001" } },
    );

    const result = await scanAlerts(client);

    expect(result.triggered).toBe(1);
    expect(result.errors[0]).toMatch(/更新觸發時間失敗 code=40001/);
  });
});
