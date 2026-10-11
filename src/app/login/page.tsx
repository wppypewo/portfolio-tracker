"use client";

import Link from "next/link";
import { useState } from "react";
import { useAnnounceValue } from "@/components/a11y/use-action-announce";
import { createClient } from "@/lib/supabase/client";
import { AUTH_ERROR, AUTH_LABEL, AUTH_MAIN, AUTH_OK, AuthCard } from "@/components/AuthCard";

type Mode = "signIn" | "signUp" | "reset";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 全站播報收斂到同一個常駐 live region，所以底下那塊成功訊息的
  // role="status" / aria-live 也一併移除，避免同一句被唸兩次。
  useAnnounceValue(error, "assertive");
  useAnnounceValue(message, "polite");

  const supabase = createClient();

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setMessage(null);
  }

  async function signInGoogle() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (e) {
      setLoading(false);
      setError(`Google 登入失敗：${e.message}`);
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "signUp") {
      const { error: e1 } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setLoading(false);
      if (e1) {
        setError(e1.message);
      } else {
        // 保留在 signUp mode 顯示成功訊息，使用者讀完自己按「返回登入」
        setMessage(
          `驗證信已寄到 ${email}\n` +
            `請打開信箱，點信中的「Confirm your mail」連結完成註冊。\n` +
            `信可能會在 1-2 分鐘內到，也可能跑去垃圾信件夾。`,
        );
        setPassword("");
      }
    } else if (mode === "reset") {
      const { error: e2 } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      setLoading(false);
      if (e2) {
        setError(e2.message);
      } else {
        setMessage(
          `若 ${email} 為已註冊帳號，重設密碼信已寄出。\n` +
            `打開信箱點連結後即可設定新密碼。`,
        );
      }
    } else {
      const { error: e3 } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (e3) {
        setLoading(false);
        setError(e3.message);
      } else {
        // 這裡刻意用整頁重載，不是 router.push()。
        // signInWithPassword 剛把 Supabase session cookie 寫進瀏覽器，
        // client 端導航拿到的 RSC payload 可能還是舊 session 算出來的；
        // 硬導向能保證 server component 重新讀一次 cookie。
        // eslint-config-next 16.3.4 起會對這行出 warning，這裡是有意為之。
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/";
      }
    }
  }

  const modeLabel = mode === "signUp" ? "建立帳號" : mode === "reset" ? "重設密碼" : "登入";
  const linkCls =
    "tap-row text-[length:var(--fs-micro)] text-[var(--c-muted)] underline underline-offset-4 hover:text-[var(--c-text)]";

  return (
    <main id="main" tabIndex={-1} className={AUTH_MAIN}>
      <AuthCard
        label={modeLabel}
        title="StackWorth"
        sub={
          mode === "signUp"
            ? "用 Google 或 Email 建立新帳號"
            : mode === "reset"
              ? "輸入註冊時的 Email，我們寄重設連結給你"
              : "登入以管理你的資產"
        }
        footer="首次註冊需點擊驗證信中的連結才能登入。"
      >
        {mode !== "reset" && (
          <>
            <button
              type="button"
              onClick={signInGoogle}
              disabled={loading}
              className="btn btn-primary btn-lg mt-6 w-full"
            >
              {loading ? "處理中…" : "使用 Google 登入"}
            </button>
            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-[var(--c-border)]" />
              <span className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">或 Email</span>
              <div className="h-px flex-1 bg-[var(--c-border)]" />
            </div>
          </>
        )}

        <form
          onSubmit={submitEmail}
          className={`flex flex-col gap-4 ${mode === "reset" ? "mt-6" : ""}`}
        >
          <label className={AUTH_LABEL}>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="field h-11 py-0 placeholder:text-[var(--c-faint)]"
            />
          </label>
          {mode !== "reset" && (
            <label className={AUTH_LABEL}>
              密碼
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signUp" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signUp" ? "至少 8 個字元" : ""}
                className="field h-11 py-0 placeholder:text-[var(--c-faint)]"
              />
            </label>
          )}
          {error && (
            <p className={AUTH_ERROR}>
              {error}
            </p>
          )}
          {message && (
            <div className={AUTH_OK}>
              <div className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true" className="mt-[3px] shrink-0"><path d="M3 8l3.5 3.5 6.5-7"/></svg>
                <p className="whitespace-pre-line leading-snug">{message}</p>
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="btn btn-neutral btn-lg w-full"
          >
            {loading
              ? "處理中…"
              : mode === "signUp"
                ? "建立帳號"
                : mode === "reset"
                  ? "寄出重設信"
                  : "Email 登入"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4">
          {mode === "signIn" && (
            <>
              <button type="button" onClick={() => switchMode("signUp")} className={linkCls}>
                首次使用？建立帳號
              </button>
              <button type="button" onClick={() => switchMode("reset")} className={linkCls}>
                忘記密碼？
              </button>
            </>
          )}
          {mode === "signUp" && (
            <button type="button" onClick={() => switchMode("signIn")} className={linkCls}>
              已有帳號？登入
            </button>
          )}
          {mode === "reset" && (
            <button type="button" onClick={() => switchMode("signIn")} className={linkCls}>
              ← 返回登入
            </button>
          )}
        </div>
      </AuthCard>
      {/* 未登入的訪客原本只看得到這張表單，示範與介紹頁都公開但沒有入口。
          放在卡片外：它們不是登入流程的一步，是給還沒決定的人看的。 */}
      <p className="mt-4 flex w-full max-w-[400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
        <span>還沒決定要不要用？</span>
        <span className="flex gap-4">
          <Link href="/demo" className={linkCls}>
            看示範（免登入）
          </Link>
          <Link href="/about" className={linkCls}>
            認識 StackWorth
          </Link>
        </span>
      </p>
    </main>
  );
}
