import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mfaSatisfied } from "./mfa-guard";

function fake(opts: {
  session?: { access_token: string } | null;
  aal?: { currentLevel: string | null; nextLevel: string | null } | null;
  error?: { message: string } | null;
}) {
  const getAAL = vi.fn(async () => ({ data: opts.aal ?? null, error: opts.error ?? null }));
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: opts.session === undefined ? { access_token: "tok" } : opts.session },
      }),
      mfa: { getAuthenticatorAssuranceLevel: getAAL },
    },
  } as unknown as Pick<SupabaseClient, "auth">;
  return { client, getAAL };
}

describe("mfaSatisfied", () => {
  it("沒設 MFA（aal1 → aal1）：通過", async () => {
    const { client } = fake({ aal: { currentLevel: "aal1", nextLevel: "aal1" } });
    expect(await mfaSatisfied(client)).toBe(true);
  });

  it("有設 MFA 且已驗證（aal2）：通過", async () => {
    const { client } = fake({ aal: { currentLevel: "aal2", nextLevel: "aal2" } });
    expect(await mfaSatisfied(client)).toBe(true);
  });

  it("有設 MFA 但還在 aal1：擋下", async () => {
    const { client } = fake({ aal: { currentLevel: "aal1", nextLevel: "aal2" } });
    expect(await mfaSatisfied(client)).toBe(false);
  });

  it("token 沒有 aal claim 而帳號有 MFA：擋下", async () => {
    const { client } = fake({ aal: { currentLevel: null, nextLevel: "aal2" } });
    expect(await mfaSatisfied(client)).toBe(false);
  });

  it("把 access token 傳進去，讓 auth-js 向伺服器查 factors，不讀 cookie 裡的 user", async () => {
    const { client, getAAL } = fake({
      session: { access_token: "the-token" },
      aal: { currentLevel: "aal1", nextLevel: "aal1" },
    });
    await mfaSatisfied(client);
    expect(getAAL).toHaveBeenCalledWith("the-token");
  });

  it("沒有 session、查詢出錯或沒回資料：擋下（fail closed）", async () => {
    expect(await mfaSatisfied(fake({ session: null }).client)).toBe(false);
    expect(
      await mfaSatisfied(
        fake({ aal: { currentLevel: "aal2", nextLevel: "aal2" }, error: { message: "x" } })
          .client,
      ),
    ).toBe(false);
    expect(await mfaSatisfied(fake({ aal: null }).client)).toBe(false);
  });
});
