import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getQuote } from "@/lib/prices/router";
import { applyContribution, type ContributionAccount } from "./contributions";

vi.mock("@/lib/prices/router", () => ({
  getQuote: vi.fn(),
}));

const quoteMock = vi.mocked(getQuote);

// 每股 TWD = 500 × 32 = 16000，讓下面的股數都是可以心算驗證的數。
const ACCOUNT: ContributionAccount = {
  id: "acc-1",
  user_id: "user-1",
  price_market: "us",
  symbol: "VOO",
  quantity: 10,
  native_currency: "USD",
  last_unit_price: 500,
  last_fx_rate: 32,
  cost_basis_twd: 100_000,
  cost_basis_native: 3_125,
};
const OCCURRED_AT = new Date("2026-07-10T02:00:00.000Z");

function clientWithRpc() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function mutationArgs(rpc: ReturnType<typeof vi.fn>) {
  const [name, args] = rpc.mock.calls[0];
  expect(name).toBe("apply_account_mutation");
  return args as {
    p_account_patch: Record<string, number>;
    p_transaction: Record<string, unknown>;
  };
}

describe("applyContribution 手續費（費用內含）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteMock.mockResolvedValue({
      unitPrice: 500,
      nativeCurrency: "USD",
      fxToBase: 32,
      asOf: "2026-07-10T01:59:00.000Z",
    });
  });

  it("手續費從投入金額扣掉後才換算股數，成本基礎仍記全額", async () => {
    const { client, rpc } = clientWithRpc();

    const result = await applyContribution({
      supabase: client,
      userId: "user-1",
      account: ACCOUNT,
      twd: 50_000,
      feeTwd: 500,
      priceOverride: null,
      fxOverride: null,
      occurredAt: OCCURRED_AT,
      noteSuffix: null,
    });

    // (50000 − 500) / 16000
    expect(result).toEqual({
      ok: true,
      sharesAdded: 3.09375,
      newQty: 13.09375,
    });

    const args = mutationArgs(rpc);
    expect(args.p_account_patch.quantity).toBe(13.09375);
    // 成本含費：100000 + 50000，不是 + 49500。
    expect(args.p_account_patch.cost_basis_twd).toBe(150_000);
    expect(args.p_account_patch.cost_basis_native).toBe(3_125 + 50_000 / 32);
    // XIRR 用的現金流是實際付出去的錢，不受手續費拆分影響。
    expect(args.p_transaction.cashflow_twd).toBe(-50_000);
    expect(args.p_transaction.fee_twd).toBe(500);
    expect(args.p_transaction.note).toContain("含手續費 500");
  });

  it("沒填手續費時股數與加欄位前完全相同，且 fee_twd 記 null 而非 0", async () => {
    const { client, rpc } = clientWithRpc();

    const result = await applyContribution({
      supabase: client,
      userId: "user-1",
      account: ACCOUNT,
      twd: 50_000,
      feeTwd: null,
      priceOverride: null,
      fxOverride: null,
      occurredAt: OCCURRED_AT,
      noteSuffix: null,
    });

    // 50000 / 16000，與加手續費欄位之前的行為一致。
    expect(result).toEqual({ ok: true, sharesAdded: 3.125, newQty: 13.125 });

    const args = mutationArgs(rpc);
    // null 表示「未記錄」；填 0 會謊稱這筆交易沒有手續費。
    expect(args.p_transaction.fee_twd).toBeNull();
    expect(args.p_transaction.note).not.toContain("含手續費");
  });

  it("帳戶帶 updated_at 時一併送出 expected_updated_at，讓 RPC 擋掉讀取後的併發寫入", async () => {
    const { client, rpc } = clientWithRpc();
    const updatedAt = "2026-07-10T01:00:00.123456+00:00";

    await applyContribution({
      supabase: client,
      userId: "user-1",
      account: { ...ACCOUNT, updated_at: updatedAt },
      twd: 50_000,
      feeTwd: null,
      priceOverride: null,
      fxOverride: null,
      occurredAt: OCCURRED_AT,
      noteSuffix: null,
    });

    const args = mutationArgs(rpc) as unknown as {
      p_account_patch: Record<string, unknown>;
    };
    // 原字串照送，微秒不能被 Date 截掉，否則永遠比對不上
    expect(args.p_account_patch.expected_updated_at).toBe(updatedAt);
  });

  it("手續費吃掉整筆金額時拒絕，不寫任何東西", async () => {
    const { client, rpc } = clientWithRpc();

    const result = await applyContribution({
      supabase: client,
      userId: "user-1",
      account: ACCOUNT,
      twd: 500,
      feeTwd: 500,
      priceOverride: null,
      fxOverride: null,
      occurredAt: OCCURRED_AT,
      noteSuffix: null,
    });

    expect(result).toEqual({
      ok: false,
      error: "手續費不得大於或等於投入金額",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
