"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorToZh } from "@/lib/auth-error-zh";
import { safeInternalPath } from "@/lib/safe-redirect";
import { useAnnounceValue } from "@/components/a11y/use-action-announce";
import { AUTH_ERROR, AuthCard } from "@/components/AuthCard";

export function MfaVerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeInternalPath(params.get("next"));

  const [factorId, setFactorId] = useState<string | null>(null);
  const [factorName, setFactorName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 驗證失敗的訊息沒有任何 ARIA，讀屏不會唸；推去播報中心。
  useAnnounceValue(error, "assertive");

  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.auth.mfa.listFactors();
      if (e) setError(authErrorToZh(e, "讀不到驗證器，請重新整理"));
      const verified = (data?.totp ?? []).find((f) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setFactorName(verified.friendly_name ?? "TOTP");
      } else {
        router.replace(next);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || code.length < 6) return;
    setBusy(true);
    setError(null);
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({
      factorId,
    });
    if (e1 || !ch) {
      setBusy(false);
      setError(authErrorToZh(e1, "無法開始驗證，請再試一次"));
      return;
    }
    const { error: e2 } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.id,
      code,
    });
    if (e2) {
      setBusy(false);
      setError(authErrorToZh(e2, "驗證失敗，請再試一次"));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <AuthCard
      label="二階段驗證"
      title="驗證碼"
      sub={
        loading
          ? "讀取中…"
          : factorName
            ? `輸入 ${factorName} 產生的 6 位數碼以繼續`
            : "未設定 MFA"
      }
      footer={
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="tap-row text-[length:var(--fs-micro)] text-[var(--c-muted)] underline underline-offset-4 hover:text-[var(--c-text)]"
          >
            登出（換帳號或忘記驗證碼）
          </button>
        </form>
      }
    >
      {factorId && (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <input
            aria-label="6 位數 MFA 驗證碼"
            aria-invalid={error ? true : undefined}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            className="field h-14 py-0 text-center font-mono text-[length:var(--fs-xl)] tracking-[0.4em] tnum placeholder:text-[var(--c-faint)]"
          />
          {error && <p className={AUTH_ERROR}>{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="btn btn-primary btn-lg w-full"
          >
            {busy ? "驗證中…" : "驗證"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
