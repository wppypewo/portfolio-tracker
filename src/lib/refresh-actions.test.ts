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

const updateUserById = vi.fn();
const createServiceClient = vi.fn(() => ({ auth: { admin: { updateUserById } } }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// 帳戶列不該再被碰：mock 起來確認沒人呼叫
const applyAccountMutation = vi.fn();
vi.mock("@/lib/account-mutation", () => ({
  applyAccountMutation: (...args: unknown[]) => applyAccountMutation(...args),
}));

import { refreshMyPrices } from "./refresh-actions";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1", app_metadata: {} } } });
  updateUserById.mockResolvedValue({ data: {}, error: null });
  applyAccountMutation.mockResolvedValue({ error: null });
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

  it("全數刷新失敗：把嘗試時間記進 app_metadata，不碰帳戶列", async () => {
    // 沒有這一步，全數失敗時沒有任何寫入，下一次按刷新冷卻判定已過，
    // 又會再扣一次全站共用的每日額度。
    selectResult.mockResolvedValue({
      data: [
        { id: "acc-1", last_priced_at: iso(20 * MIN), updated_at: iso(20 * MIN) },
        { id: "acc-2", last_priced_at: null, updated_at: iso(30 * MIN) },
      ],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({
      ok: 0,
      failed: 2,
      errors: ["VOO: Twelve Data 找不到 VOO 的報價"],
    });
    const before = Date.now();
    await refreshMyPrices();
    expect(updateUserById).toHaveBeenCalledTimes(1);
    const [uid, attrs] = updateUserById.mock.calls[0];
    expect(uid).toBe("u1");
    // 只送這一個鍵：GoTrue 逐鍵合併，不會蓋掉 provider 等欄位
    expect(Object.keys(attrs)).toEqual(["app_metadata"]);
    expect(Object.keys(attrs.app_metadata)).toEqual(["price_refresh_attempted_at"]);
    expect(Date.parse(attrs.app_metadata.price_refresh_attempted_at)).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(applyAccountMutation).not.toHaveBeenCalled();
  });

  it("部分成功也記嘗試時間", async () => {
    selectResult.mockResolvedValue({
      data: [{ id: "acc-1", last_priced_at: null, updated_at: iso(20 * MIN) }],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({ ok: 1, failed: 1, errors: ["X: 失敗"] });
    const r = await refreshMyPrices();
    expect(r).toEqual({ ok: true, refreshed: 1, failed: 1 });
    expect(updateUserById).toHaveBeenCalledTimes(1);
    expect(applyAccountMutation).not.toHaveBeenCalled();
  });

  it("app_metadata 記的上次刷新在 10 分鐘內：冷卻中（帳戶時間都很舊也一樣）", async () => {
    getUser.mockResolvedValue({
      data: {
        user: { id: "u1", app_metadata: { price_refresh_attempted_at: iso(2 * MIN) } },
      },
    });
    selectResult.mockResolvedValue({
      data: [{ id: "acc-1", last_priced_at: iso(60 * MIN), updated_at: iso(60 * MIN) }],
      error: null,
    });
    const r = await refreshMyPrices();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("冷卻中");
      expect(r.waitSec).toBeGreaterThan(8 * 60 - 10);
      expect(r.waitSec).toBeLessThanOrEqual(8 * 60);
    }
    expect(refreshAccountPrices).not.toHaveBeenCalled();
  });

  it("app_metadata 記的時間已超過 10 分鐘或格式不對：不擋", async () => {
    for (const v of [iso(11 * MIN), "not-a-date", 12345]) {
      vi.clearAllMocks();
      updateUserById.mockResolvedValue({ data: {}, error: null });
      getUser.mockResolvedValue({
        data: { user: { id: "u1", app_metadata: { price_refresh_attempted_at: v } } },
      });
      selectResult.mockResolvedValue({
        data: [{ id: "acc-1", last_priced_at: null, updated_at: iso(60 * MIN) }],
        error: null,
      });
      refreshAccountPrices.mockResolvedValue({ ok: 1, failed: 0, errors: [] });
      const r = await refreshMyPrices();
      expect(r).toEqual({ ok: true, refreshed: 1, failed: 0 });
    }
  });

  it("記錄時間失敗（API 錯誤或缺 env）時仍回原本的抓價結果", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    selectResult.mockResolvedValue({
      data: [{ id: "acc-1", last_priced_at: null, updated_at: iso(20 * MIN) }],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({
      ok: 0,
      failed: 1,
      errors: ["0050: FinMind 找不到台股 0050 資料（代號是否正確？）"],
    });

    updateUserById.mockResolvedValue({ data: null, error: { status: 500, message: "x" } });
    expect(await refreshMyPrices()).toEqual({
      ok: false,
      error: "0050: FinMind 找不到台股 0050 資料（代號是否正確？）",
    });

    createServiceClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SECRET_KEY 未設定");
    });
    expect(await refreshMyPrices()).toEqual({
      ok: false,
      error: "0050: FinMind 找不到台股 0050 資料（代號是否正確？）",
    });
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it("查詢帳戶清單失敗（failed=0）：沒有扣額度，不記時間也不碰帳戶", async () => {
    selectResult.mockResolvedValue({
      data: [{ id: "acc-1", last_priced_at: null, updated_at: iso(20 * MIN) }],
      error: null,
    });
    refreshAccountPrices.mockResolvedValue({
      ok: 0,
      failed: 0,
      queryFailed: true,
      errors: ["查詢帳戶清單失敗 code=XX000"],
    });
    await refreshMyPrices();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(applyAccountMutation).not.toHaveBeenCalled();
  });
});
