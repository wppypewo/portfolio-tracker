import { afterEach, describe, expect, it, vi } from "vitest";

// ADMIN_EMAILS 在模組載入時讀一次，所以每個情境都重新載入模組。
async function load(env: string | undefined) {
  vi.resetModules();
  if (env === undefined) vi.stubEnv("ADMIN_EMAILS", undefined as unknown as string);
  else vi.stubEnv("ADMIN_EMAILS", env);
  return import("./admin");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAdmin", () => {
  it("沒設 ADMIN_EMAILS：沒有人是 admin", async () => {
    const { isAdmin, ADMIN_EMAILS } = await load(undefined);
    expect(ADMIN_EMAILS).toEqual([]);
    expect(isAdmin("a@example.com")).toBe(false);
  });

  it("空字串與只有逗號：不會讓空 email 變成 admin", async () => {
    const { isAdmin } = await load(" , ,");
    expect(isAdmin("")).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("逗號分隔、去空白、不分大小寫", async () => {
    const { isAdmin } = await load(" Admin@Example.com , ops@example.com");
    expect(isAdmin("admin@example.com")).toBe(true);
    expect(isAdmin("OPS@EXAMPLE.COM")).toBe(true);
    expect(isAdmin("other@example.com")).toBe(false);
  });

  it("不做子字串比對", async () => {
    const { isAdmin } = await load("admin@example.com");
    expect(isAdmin("min@example.com")).toBe(false);
    expect(isAdmin("admin@example.com.evil")).toBe(false);
  });
});
