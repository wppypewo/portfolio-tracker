import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scanAlerts } from "./alerts-scan";

type Row = Record<string, unknown>;

// 只實作 scanAlerts 用到的鏈式呼叫：select / eq / in / insert / update，
// await 時依表名回傳預先放好的資料。insert / update 記到 calls 供斷言。
function fakeSupabase(
  tables: Record<string, Row[]>,
  opts: { insertError?: { code: string } } = {},
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
        if (op === "update") return resolve({ error: null });
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
});
