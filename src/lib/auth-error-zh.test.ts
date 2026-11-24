import { describe, expect, it } from "vitest";
import { authErrorToZh } from "./auth-error-zh";

describe("authErrorToZh", () => {
  it("認得的代碼轉成中文", () => {
    expect(authErrorToZh({ code: "invalid_credentials" }, "登入失敗")).toBe(
      "Email 或密碼不對，請再確認一次",
    );
  });

  it("不認得或沒有代碼時用呼叫端的中文 fallback，不回英文原文", () => {
    expect(authErrorToZh({ code: "unexpected_failure" }, "登入失敗，請稍後再試")).toBe(
      "登入失敗，請稍後再試",
    );
    expect(authErrorToZh({}, "登入失敗")).toBe("登入失敗");
    expect(authErrorToZh(null, "登入失敗")).toBe("登入失敗");
  });
});
