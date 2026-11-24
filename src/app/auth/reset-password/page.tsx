"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorToZh } from "@/lib/auth-error-zh";
import { useAnnounceValue } from "@/components/a11y/use-action-announce";
import { AUTH_ERROR, AUTH_LABEL, AUTH_MAIN, AUTH_OK, AuthCard } from "@/components/AuthCard";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAnnounceValue(error, "assertive");
  const [success, setSuccess] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    // Supabase 在跳轉回來後會於 onAuthStateChange 觸發 PASSWORD_RECOVERY event；
    // 我們也檢查目前是否有 session（recovery type）才允許設定新密碼。
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // 初次掛載也檢查一次（重整或直接連 URL 時）
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("密碼至少 8 個字元");
      return;
    }
    if (password !== confirm) {
      setError("兩次輸入不一致");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: e1 } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (e1) {
      setError(authErrorToZh(e1, "密碼更新失敗，請再試一次"));
      return;
    }
    setSuccess(true);
    // 2 秒後導向首頁（已自動登入）
    setTimeout(() => router.replace("/"), 2000);
  }

  return (
    <main id="main" tabIndex={-1} className={AUTH_MAIN}>
      <AuthCard label="重設密碼" title="設定新密碼">
        {!ready ? (
          <p className="mt-4 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
            驗證連結中…
            <br />
            若一直停在這頁，可能連結已過期或無效，請回
            <a
              href="/login"
              className="mx-1 underline underline-offset-4 hover:text-[var(--c-text)]"
            >
              登入頁
            </a>
            重新點「忘記密碼？」。
          </p>
        ) : success ? (
          <p className={`mt-5 ${AUTH_OK}`}>密碼已更新，即將導向首頁…</p>
        ) : (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <label className={AUTH_LABEL}>
              新密碼
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 個字元"
                className="field h-11 py-0 placeholder:text-[var(--c-faint)]"
              />
            </label>
            <label className={AUTH_LABEL}>
              再次確認
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="field h-11 py-0"
              />
            </label>
            {error && <p className={AUTH_ERROR}>{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary btn-lg w-full"
            >
              {busy ? "更新中…" : "更新密碼"}
            </button>
          </form>
        )}
      </AuthCard>
    </main>
  );
}
