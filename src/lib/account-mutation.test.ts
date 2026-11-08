import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAccountMutation } from "./account-mutation";

// 只模擬 rpc 回傳的 { error }，驗證哪些錯誤訊息可以到前端
function clientReturning(error: { code?: string; message: string } | null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error }),
  } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyAccountMutation 的錯誤訊息", () => {
  it("成功時回 null", async () => {
    const res = await applyAccountMutation(clientReturning(null), {
      accountId: "a1",
    });
    expect(res).toEqual({ error: null });
  });

  it("P0001（SQL 裡自己寫的說明）原樣回給使用者", async () => {
    const res = await applyAccountMutation(
      clientReturning({
        code: "P0001",
        message: "帳戶剛被其他操作更新，請重新整理後再試一次",
      }),
      { accountId: "a1" },
    );
    expect(res.error).toBe("帳戶剛被其他操作更新，請重新整理後再試一次");
  });

  it("其他 SQLSTATE 不外洩 Postgres 原文，log 只印 code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await applyAccountMutation(
      clientReturning({
        code: "42501",
        message:
          'new row violates row-level security policy for table "accounts"',
      }),
      { accountId: "a1" },
    );
    expect(res.error).not.toMatch(/accounts|policy|row-level/);
    expect(res.error).toBe("寫入失敗，資料未變更。請重新整理後再試");
    expect(log).toHaveBeenCalledWith(
      "[applyAccountMutation] RPC 失敗 code=42501",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("row-level");
  });

  it("沒有 code 的錯誤也不外洩", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await applyAccountMutation(
      clientReturning({ message: 'relation "x" does not exist' }),
      { accountId: "a1" },
    );
    expect(res.error).toBe("寫入失敗，資料未變更。請重新整理後再試");
  });
});
