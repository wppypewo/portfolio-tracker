import { beforeEach, describe, expect, it, vi } from "vitest";

// refreshMyPrices 的整合測試（mock Supabase client 層）。
// 涵蓋授權、空集合、冷卻邊界、成功路徑——這層邏輯在 E12 寫入交易化（RPC）
// 之後也不會變；實際寫入路徑的整測排在交易化完成後補。

const getUser = vi.fn();
const selectResult = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        neq: () => ({
          not: () => ({
            eq: () => selectResult(),
          }),
        }),
      }),
    }),
  }),
}));

const refreshAccountPrices = vi.fn();
vi.mock("@/lib/refresh-prices", () => ({
  refreshAccountPrices: (...args: unknown[]) => refreshAccountPrices(...args),
}));

import { refreshMyPrices } from "./refresh-actions";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("refreshMyPrices", () => {
  it("未登入：直接拒絕，不碰刷新邏輯", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await refreshMyPrices();
    expect(r).toEqual({ ok: false, error: "未登入" });
    expect(refreshAccountPrices).not.toHaveBeenCalled();
  });

  it("沒有可刷新的帳戶：回錯誤", async () => {
    selectResult.mockResolvedValue({ data: [], error: null });
    const r = await refreshMyPrices();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("沒有可刷新的帳戶");
  });

  it("冷卻中（最近一次 < 10 分鐘）：回剩餘秒數，不刷新", async () => {
    selectResult.mockResolvedValue({
      data: [
        { last_priced_at: iso(30 * MIN) },
        { last_priced_at: iso(4 * MIN) }, // 取 max：4 分鐘前
      ],
      error: null,
    });
    const r = await refreshMyPrices();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.waitSec).toBeGreaterThan(5 * 60 - 10);
      expect(r.waitSec).toBeLessThanOrEqual(6 * 60);
    }
    expect(refreshAccountPrices).not.toHaveBeenCalled();
  });

  it("台股：last_priced_at 是資料日期，但 updated_at 在 10 分鐘內就要冷卻", async () => {
    selectResult.mockResolvedValue({
      data: [{ last_priced_at: iso(14 * 60 * MIN), updated_at: iso(3 * MIN) }],
      error: null,
    });
    const r = await refreshMyPrices();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("冷卻中");
      expect(r.waitSec).toBeGreaterThan(6 * 60 - 10);
      expect(r.waitSec).toBeLessThanOrEqual(7 * 60);
    }
    expect(refreshAccountPrices).not.toHaveBeenCalled();
  });

  it("冷卻已過：執行刷新並回統計", async () => {
    selectResult.mockResolvedValue({
      data: [{ last_priced_at: iso(11 * MIN) }],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({ ok: 3, failed: 1, errors: ["x"] });
    const r = await refreshMyPrices();
    expect(r).toEqual({ ok: true, refreshed: 3, failed: 1 });
    expect(refreshAccountPrices).toHaveBeenCalledTimes(1);
  });

  it("從未刷新過（last_priced_at 全 null）：視為冷卻已過", async () => {
    selectResult.mockResolvedValue({
      data: [{ last_priced_at: null }],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({ ok: 1, failed: 0, errors: [] });
    const r = await refreshMyPrices();
    expect(r).toEqual({ ok: true, refreshed: 1, failed: 0 });
  });

  it("全數刷新失敗：回第一個錯誤訊息", async () => {
    selectResult.mockResolvedValue({
      data: [{ last_priced_at: iso(20 * MIN) }],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({
      ok: 0,
      failed: 2,
      errors: ["VOO: 上游 429"],
    });
    const r = await refreshMyPrices();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("VOO: 上游 429");
  });
});
