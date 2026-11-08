import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 兩條用 service_role 刪 auth.users 的路徑：admin 刪別人（allowlist-actions）、
// 使用者刪自己（profile-actions）。這兩支繞過 RLS，守門全靠 action 內的檢查，
// 所以每一道檢查都要有測試釘住。

const getUser = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}));

const adminDeleteUser = vi.fn();
const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const isAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ isAdmin: (e: string) => isAdmin(e) }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

import { deleteUser } from "./allowlist-actions";
import { deleteMyAccount } from "./profile-actions";

const ME = { id: "11111111-aaaa", email: "Me@Example.com" };
const OTHER_ID = "22222222-bbbb";

let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: ME } });
  isAdmin.mockReturnValue(true);
  adminDeleteUser.mockResolvedValue({ error: null });
  createServiceClient.mockReturnValue({ auth: { admin: { deleteUser: adminDeleteUser } } });
  signOut.mockResolvedValue({ error: null });
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

describe("deleteUser（admin 刪別人）", () => {
  it("未登入：拒絕，不建 service client", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await deleteUser(undefined, fd({ userId: OTHER_ID }));
    expect(r).toEqual({ error: "需要 admin 權限" });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("非 admin：拒絕，不建 service client", async () => {
    isAdmin.mockReturnValue(false);
    const r = await deleteUser(undefined, fd({ userId: OTHER_ID }));
    expect(r).toEqual({ error: "需要 admin 權限" });
    expect(isAdmin).toHaveBeenCalledWith(ME.email);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("缺 userId（含全空白）：拒絕", async () => {
    const r = await deleteUser(undefined, fd({ userId: "   " }));
    expect(r).toEqual({ error: "缺少 userId" });
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("不能刪自己（前後空白也擋）", async () => {
    const r = await deleteUser(undefined, fd({ userId: ` ${ME.id} ` }));
    expect(r).toEqual({ error: "不能刪除自己" });
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("成功：刪指定的 id，重新驗證 allowlist 頁", async () => {
    const r = await deleteUser(undefined, fd({ userId: OTHER_ID }));
    expect(r).toBeUndefined();
    expect(adminDeleteUser).toHaveBeenCalledWith(OTHER_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/allowlist");
  });

  it("Admin API 失敗：固定訊息，log 不含被刪者 id", async () => {
    adminDeleteUser.mockResolvedValue({ error: { message: `User ${OTHER_ID} not found` } });
    const r = await deleteUser(undefined, fd({ userId: OTHER_ID }));
    expect(r).toEqual({ error: "刪除失敗，資料未變更。請稍後再試" });
    expect(logged()).not.toContain(OTHER_ID);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("service client 初始化失敗：回表單訊息，不丟例外", async () => {
    createServiceClient.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY 未設定");
    });
    const r = await deleteUser(undefined, fd({ userId: OTHER_ID }));
    expect(r?.error).toContain("暫時無法使用");
    expect(r?.error).not.toContain("SUPABASE_SECRET_KEY");
  });
});

describe("deleteMyAccount（使用者刪自己）", () => {
  it("沒填 email：schema 擋下，不碰 auth", async () => {
    const r = await deleteMyAccount(undefined, fd({ confirmEmail: "  " }));
    expect(r?.error).toBe("請輸入你的 email 以確認");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("未登入：拒絕", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await deleteMyAccount(undefined, fd({ confirmEmail: ME.email }));
    expect(r).toEqual({ error: "請先登入" });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("帳號沒有 email：拒絕自助刪除", async () => {
    getUser.mockResolvedValue({ data: { user: { id: ME.id, email: undefined } } });
    const r = await deleteMyAccount(undefined, fd({ confirmEmail: "x@example.com" }));
    expect(r?.error).toContain("沒有 email");
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("email 不符：拒絕", async () => {
    const r = await deleteMyAccount(undefined, fd({ confirmEmail: "other@example.com" }));
    expect(r).toEqual({ error: "輸入的 email 與登入帳號不符" });
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("成功：email 比對不分大小寫、去前後空白；刪的是 session 的 id，不理表單的 userId", async () => {
    await deleteMyAccount(
      undefined,
      fd({ confirmEmail: "  me@example.COM ", userId: OTHER_ID }),
    );
    expect(adminDeleteUser).toHaveBeenCalledTimes(1);
    expect(adminDeleteUser).toHaveBeenCalledWith(ME.id);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("Admin API 失敗：固定訊息，不登出、不導向，log 不含 id 與 email", async () => {
    adminDeleteUser.mockResolvedValue({ error: { message: "db error" } });
    const r = await deleteMyAccount(undefined, fd({ confirmEmail: ME.email }));
    expect(r?.error).toBe("刪除失敗，資料未變更。請稍後再試或聯繫 admin");
    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(logged()).not.toContain(ME.id);
    expect(logged().toLowerCase()).not.toContain(ME.email.toLowerCase());
  });

  it("service client 初始化失敗：回表單訊息", async () => {
    createServiceClient.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY 未設定");
    });
    const r = await deleteMyAccount(undefined, fd({ confirmEmail: ME.email }));
    expect(r).toEqual({ error: "刪除功能暫時無法使用，請聯繫 admin" });
  });
});
