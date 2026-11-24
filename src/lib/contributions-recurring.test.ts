import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getQuote } from "@/lib/prices/router";
import { executeRecurringPlan } from "./contributions";

vi.mock("@/lib/prices/router", () => ({
  getQuote: vi.fn(),
}));

const quoteMock = vi.mocked(getQuote);
const ACCOUNT = {
  price_market: "us" as const,
  symbol: "VOO",
  status: "active",
};
const EXECUTED_AT = new Date("2026-07-10T02:00:00.000Z");

function clientWithRpc(
  result: { data: unknown; error: { message: string; code?: string } | null },
) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("executeRecurringPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteMock.mockResolvedValue({
      unitPrice: 500,
      nativeCurrency: "USD",
      fxToBase: 32,
      asOf: "2026-07-10T01:59:00.000Z",
    });
  });

  it("只把識別、預期排程日期與報價傳給原子 RPC", async () => {
    const { client, rpc } = clientWithRpc({
      data: [
        {
          executed: true,
          shares_added: "0.625",
          new_quantity: "12.625",
          next_run_date: "2026-08-05",
        },
      ],
      error: null,
    });

    const result = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
      executedAt: EXECUTED_AT,
    });

    expect(rpc).toHaveBeenCalledWith("execute_recurring_plan_mutation", {
      p_plan_id: "plan-1",
      p_expected_run_date: "2026-07-05",
      p_executed_at: EXECUTED_AT.toISOString(),
      p_unit_price: 500,
      p_fx_rate: 32,
      p_priced_at: "2026-07-10T01:59:00.000Z",
      p_source: "cron",
      p_amount_override: null,
      p_fee_override: null,
    });
    expect(result).toEqual({
      ok: true,
      executed: true,
      sharesAdded: 0.625,
      newQty: 12.625,
      nextRunDate: "2026-08-05",
    });
  });

  it("manual 覆寫金額原樣傳給 RPC", async () => {
    const { client, rpc } = clientWithRpc({
      data: [
        {
          executed: true,
          shares_added: "0.9375",
          new_quantity: "12.9375",
          next_run_date: "2026-08-05",
        },
      ],
      error: null,
    });

    await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "manual",
      executedAt: EXECUTED_AT,
      amountOverride: 15000,
    });

    expect(rpc).toHaveBeenCalledWith(
      "execute_recurring_plan_mutation",
      expect.objectContaining({
        p_source: "manual",
        p_amount_override: 15000,
      }),
    );
  });

  it("manual 覆寫手續費原樣傳給 RPC", async () => {
    const { client, rpc } = clientWithRpc({
      data: [
        {
          executed: true,
          shares_added: "0.59375",
          new_quantity: "12.59375",
          next_run_date: "2026-08-05",
        },
      ],
      error: null,
    });

    await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "manual",
      executedAt: EXECUTED_AT,
      feeOverride: 500,
    });

    expect(rpc).toHaveBeenCalledWith(
      "execute_recurring_plan_mutation",
      expect.objectContaining({
        p_source: "manual",
        p_amount_override: null,
        p_fee_override: 500,
      }),
    );
  });

  it("cron 帶覆寫金額在抓價前就被拒絕", async () => {
    const { client, rpc } = clientWithRpc({ data: null, error: null });

    const result = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
      amountOverride: 15000,
    });

    expect(result).toEqual({ ok: false, error: "自動執行不接受覆寫金額" });
    expect(quoteMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cron 帶覆寫手續費在抓價前就被拒絕", async () => {
    const { client, rpc } = clientWithRpc({ data: null, error: null });

    const result = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
      feeOverride: 500,
    });

    expect(result).toEqual({ ok: false, error: "自動執行不接受覆寫手續費" });
    expect(quoteMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cron 的級距金額以 p_amount_override 傳給 RPC", async () => {
    const { client, rpc } = clientWithRpc({
      data: [
        {
          executed: true,
          shares_added: "0.4",
          new_quantity: "12.4",
          next_run_date: "2026-08-05",
        },
      ],
      error: null,
    });

    const result = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
      executedAt: EXECUTED_AT,
      tierAmount: 6400,
    });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "execute_recurring_plan_mutation",
      expect.objectContaining({
        p_source: "cron",
        p_amount_override: 6400,
        p_fee_override: null,
      }),
    );
  });

  it("級距金額只有 cron 能帶，手動執行在抓價前就被拒絕", async () => {
    const { client, rpc } = clientWithRpc({ data: null, error: null });

    const result = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "manual",
      tierAmount: 6400,
    });

    expect(result).toEqual({ ok: false, error: "級距金額只能由自動執行帶入" });
    expect(quoteMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])(
    "級距金額 %s 無效，在抓價前就被拒絕",
    async (tierAmount) => {
      const { client, rpc } = clientWithRpc({ data: null, error: null });

      const result = await executeRecurringPlan({
        supabase: client,
        planId: "plan-1",
        expectedRunDate: "2026-07-05",
        account: ACCOUNT,
        source: "cron",
        tierAmount,
      });

      expect(result).toEqual({ ok: false, error: "級距金額無效" });
      expect(quoteMock).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("stale caller 回傳未執行，不視為錯誤", async () => {
    const { client } = clientWithRpc({
      data: [
        {
          executed: false,
          shares_added: null,
          new_quantity: null,
          next_run_date: "2026-08-05",
        },
      ],
      error: null,
    });

    await expect(
      executeRecurringPlan({
        supabase: client,
        planId: "plan-1",
        expectedRunDate: "2026-07-05",
        account: ACCOUNT,
        source: "manual",
        executedAt: EXECUTED_AT,
      }),
    ).resolves.toEqual({
      ok: true,
      executed: false,
      sharesAdded: null,
      newQty: null,
      nextRunDate: "2026-08-05",
    });
  });

  it("手動或封存帳戶在抓價前拒絕", async () => {
    const { client, rpc } = clientWithRpc({ data: null, error: null });

    const manual = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: { price_market: "manual", symbol: null },
      source: "manual",
    });
    const archived = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: { ...ACCOUNT, status: "archived" },
      source: "cron",
    });

    expect(manual).toEqual({
      ok: false,
      error: "手動帳戶無法執行定期定額",
    });
    expect(archived).toEqual({ ok: false, error: "帳戶已封存" });
    expect(quoteMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("抓價與 RPC 錯誤都回傳可顯示訊息", async () => {
    // 非 P0001：底層錯誤，原文（欄位名、policy 名）不外流，只回固定訊息。
    const { client } = clientWithRpc({
      data: null,
      error: { message: "database unavailable", code: "42501" },
    });
    const rpcError = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
    });
    expect(rpcError).toEqual({
      ok: false,
      error: "定期定額執行失敗，資料未變更。請稍後再試",
    });

    quoteMock.mockRejectedValueOnce(new Error("rate limited"));
    const quoteError = await executeRecurringPlan({
      supabase: client,
      planId: "plan-2",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "manual",
    });
    expect(quoteError).toEqual({
      ok: false,
      error: "抓價失敗：rate limited",
    });
  });

  it("P0001 是 SQL 裡自己寫的說明，原文要顯示給使用者", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { message: "這期已經執行過了", code: "P0001" },
    });

    const result = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
    });

    expect(result).toEqual({ ok: false, error: "這期已經執行過了" });
  });

  it("拒絕無效報價與不完整 RPC 回應", async () => {
    const { client } = clientWithRpc({ data: [], error: null });
    const emptyResult = await executeRecurringPlan({
      supabase: client,
      planId: "plan-1",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "cron",
    });
    expect(emptyResult).toEqual({
      ok: false,
      error: "定期定額執行結果無效",
    });

    quoteMock.mockResolvedValueOnce({
      unitPrice: 0,
      nativeCurrency: "USD",
      fxToBase: 32,
      asOf: "2026-07-10T01:59:00.000Z",
    });
    const invalidQuote = await executeRecurringPlan({
      supabase: client,
      planId: "plan-2",
      expectedRunDate: "2026-07-05",
      account: ACCOUNT,
      source: "manual",
    });
    expect(invalidQuote).toEqual({ ok: false, error: "報價或匯率無效" });
  });
});
