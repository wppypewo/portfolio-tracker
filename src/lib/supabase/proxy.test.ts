import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 假的 Supabase client：getUser 與 AAL 由各測試設定，不連網路。
const auth = {
  user: null as { id: string } | null,
  aal: null as { currentLevel: string; nextLevel: string } | null,
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: auth.user } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: auth.aal }),
      },
    },
  }),
}));

const { isUnder, isPublicPath, isMfaExemptPath, updateSession } = await import(
  "./proxy"
);

function redirectTarget(res: Response): string | null {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

async function visit(path: string) {
  return updateSession(new NextRequest(`http://localhost${path}`));
}

beforeEach(() => {
  auth.user = null;
  auth.aal = null;
});

describe("isUnder", () => {
  it("prefix 本身與其子路徑算在底下", () => {
    expect(isUnder("/auth", "/auth")).toBe(true);
    expect(isUnder("/auth/callback", "/auth")).toBe(true);
    expect(isUnder("/auth/", "/auth")).toBe(true);
  });

  it("只是字首相同的其他路徑不算", () => {
    expect(isUnder("/authors", "/auth")).toBe(false);
    expect(isUnder("/about-us", "/about")).toBe(false);
    expect(isUnder("/demographics", "/demo")).toBe(false);
    expect(isUnder("/login2", "/login")).toBe(false);
  });
});

describe("isPublicPath / isMfaExemptPath", () => {
  it("現有的公開頁都放行", () => {
    for (const p of [
      "/login",
      "/auth/callback",
      "/auth/mfa",
      "/auth/reset-password",
      "/auth/signout",
      "/demo",
      "/methodology",
      "/about",
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it("受保護頁與字首相同的新路由都不放行", () => {
    for (const p of ["/", "/accounts", "/admin", "/authors", "/about-team", "/demo-admin"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("MFA 例外只有 /auth/mfa、/auth/signout、/login 與其子路徑", () => {
    expect(isMfaExemptPath("/auth/mfa")).toBe(true);
    expect(isMfaExemptPath("/auth/signout")).toBe(true);
    expect(isMfaExemptPath("/login")).toBe(true);
    expect(isMfaExemptPath("/auth/mfa-settings")).toBe(false);
    expect(isMfaExemptPath("/login-history")).toBe(false);
    expect(isMfaExemptPath("/auth/callback")).toBe(false);
  });
});

describe("updateSession", () => {
  it("未登入看 /authors（字首像 /auth）→ 導向 /login", async () => {
    expect(redirectTarget(await visit("/authors"))).toBe("/login");
  });

  it("未登入看 /auth/callback → 放行", async () => {
    expect(redirectTarget(await visit("/auth/callback"))).toBeNull();
  });

  it("未登入看根路徑 → 導向 /about", async () => {
    expect(redirectTarget(await visit("/"))).toBe("/about");
  });

  it("已登入但 AAL1、看 /login-history（字首像 /login）→ 導向 /auth/mfa", async () => {
    auth.user = { id: "u1" };
    auth.aal = { currentLevel: "aal1", nextLevel: "aal2" };
    const res = await visit("/login-history");
    expect(redirectTarget(res)).toBe("/auth/mfa");
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(
      "/login-history",
    );
  });

  it("已登入但 AAL1、看 /auth/mfa → 放行（不迴圈）", async () => {
    auth.user = { id: "u1" };
    auth.aal = { currentLevel: "aal1", nextLevel: "aal2" };
    expect(redirectTarget(await visit("/auth/mfa"))).toBeNull();
  });

  it("已登入且 AAL2 → 放行", async () => {
    auth.user = { id: "u1" };
    auth.aal = { currentLevel: "aal2", nextLevel: "aal2" };
    expect(redirectTarget(await visit("/accounts"))).toBeNull();
  });
});
