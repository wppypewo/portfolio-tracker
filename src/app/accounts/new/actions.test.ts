import { beforeEach, describe, expect, it, vi } from "vitest";

// persistCreate 的失敗路徑（經 createManualAccount 進入，不需要抓價）。
// 重點兩件事：資料庫原始訊息不回前端；後兩段 insert 失敗時要刪掉剛建的帳戶。

const RAW = 'new row violates row-level security policy for table "transactions"';

type Result = { data?: unknown; error: { code?: string; message: string } | null };

const accountInsert = vi.fn<() => Result>();
const txInsert = vi.fn<() => Result>();
const snapInsert = vi.fn<() => Result>();
const accountDelete = vi.fn<(id: string) => Result>();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      if (table === "accounts") {
        return {
          insert: () => ({ select: () => ({ single: async () => accountInsert() }) }),
          delete: () => ({ eq: async (_col: string, id: string) => accountDelete(id) }),
        };
      }
      if (table === "transactions") return { insert: async () => txInsert() };
      if (table === "account_snapshots") return { insert: async () => snapInsert() };
      throw new Error(`未預期的表 ${table}`);
    },
  }),
}));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/lib/prices/router", () => ({ getQuote: vi.fn() }));

import { createManualAccount } from "./actions";

function form(): FormData {
  const fd = new FormData();
  fd.set("name", "定存");
  fd.set("balance", "1000");
  return fd;
}

const ok: Result = { error: null };
const fail: Result = { error: { code: "42501", message: RAW } };

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  accountInsert.mockReturnValue({ data: { id: "acc-new" }, error: null });
  txInsert.mockReturnValue(ok);
  snapInsert.mockReturnValue(ok);
  accountDelete.mockReturnValue(ok);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

function loggedText(): string {
  return errorLog.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

describe("createManualAccount 失敗路徑", () => {
  it("三段都成功：redirect，不刪帳戶", async () => {
    await createManualAccount(undefined, form());
    expect(redirect).toHaveBeenCalledWith("/");
    expect(accountDelete).not.toHaveBeenCalled();
  });

  it("建帳戶失敗：回固定訊息，原始訊息不外洩，log 只有 code", async () => {
    accountInsert.mockReturnValue({ data: null, error: { code: "42501", message: RAW } });
    const r = await createManualAccount(undefined, form());
    expect(r?.error).toBe("建立帳戶失敗，資料未變更。請稍後再試");
    expect(r?.error).not.toContain("row-level");
    expect(loggedText()).toContain("code=42501");
    expect(loggedText()).not.toContain("row-level");
    expect(txInsert).not.toHaveBeenCalled();
    expect(accountDelete).not.toHaveBeenCalled();
  });

  it("寫交易失敗：刪掉剛建的帳戶，不寫快照", async () => {
    txInsert.mockReturnValue(fail);
    const r = await createManualAccount(undefined, form());
    expect(accountDelete).toHaveBeenCalledTimes(1);
    expect(accountDelete).toHaveBeenCalledWith("acc-new");
    expect(snapInsert).not.toHaveBeenCalled();
    expect(r?.error).toBe("建立帳戶失敗，資料未變更。請稍後再試");
    expect(loggedText()).not.toContain("row-level");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("寫快照失敗：同樣刪掉剛建的帳戶", async () => {
    snapInsert.mockReturnValue(fail);
    const r = await createManualAccount(undefined, form());
    expect(accountDelete).toHaveBeenCalledWith("acc-new");
    expect(r?.error).toBe("建立帳戶失敗，資料未變更。請稍後再試");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("回滾也失敗：明講要使用者去首頁手動清", async () => {
    txInsert.mockReturnValue(fail);
    accountDelete.mockReturnValue({ error: { code: "57014", message: "canceling statement" } });
    const r = await createManualAccount(undefined, form());
    expect(r?.error).toContain("無法自動清除");
    expect(r?.error).not.toContain("canceling");
    expect(loggedText()).toContain("code=57014");
  });
});
