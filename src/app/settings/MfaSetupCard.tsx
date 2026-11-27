"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { authErrorToZh } from "@/lib/auth-error-zh";
import { useAnnounceValue } from "@/components/a11y/use-action-announce";

/**
 * MFA 設定卡片（StackWorth 風格）。
 * 邏輯沿用既有 MfaSetup（supabase.auth.mfa）；只重寫樣式：
 * - 列「雙因素驗證 (MFA)」一列含 toggle / 已啟用徽章
 * - 開啟 enrollment 後展開 QR + 6 碼驗證 panel
 * - 啟用後顯示綠色「MFA 已啟用」+ 停用按鈕
 */

type Factor = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
};

type Step = "off" | "setup" | "on";

export function MfaSetupCard() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmFactorId, setConfirmFactorId] = useState<string | null>(null);
  const confirmActionRef = useRef<HTMLButtonElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const previousConfirmFactorId = useRef<string | null>(null);
  useAnnounceValue(error, "assertive");
  useAnnounceValue(message, "polite");

  const supabase = createClient();

  async function load() {
    setLoading(true);
    const { data, error: e } = await supabase.auth.mfa.listFactors();
    if (e) setError(authErrorToZh(e, "讀不到驗證器，請重新整理"));
    setFactors((data?.totp ?? []) as Factor[]);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (confirmFactorId) confirmActionRef.current?.focus();
    else if (previousConfirmFactorId.current) confirmTriggerRef.current?.focus();
    previousConfirmFactorId.current = confirmFactorId;
  }, [confirmFactorId]);

  async function startEnroll() {
    setError(null);
    setMessage(null);
    setConfirmFactorId(null);
    setBusy(true);
    const { data, error: e } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `TOTP ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (e || !data) {
      setError(authErrorToZh(e, "啟用失敗，請再試一次"));
      return;
    }
    setEnrollment({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function verify() {
    if (!enrollment) return;
    if (code.length < 6) {
      setError("請輸入 6 位數驗證碼");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    });
    if (e1 || !ch) {
      setBusy(false);
      setError(authErrorToZh(e1, "無法開始驗證，請再試一次"));
      return;
    }
    const { error: e2 } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: ch.id,
      code,
    });
    setBusy(false);
    if (e2) {
      setError(authErrorToZh(e2, "驗證失敗，請再試一次"));
      return;
    }
    setEnrollment(null);
    setCode("");
    setMessage("MFA 已啟用");
    await load();
  }

  async function cancelEnroll() {
    if (!enrollment) return;
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setCode("");
    setMessage("已取消 MFA 設定");
  }

  async function disable(factorId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (e) {
      setError(authErrorToZh(e, "停用失敗，請再試一次"));
      return;
    }
    setConfirmFactorId(null);
    setMessage("MFA 已停用");
    await load();
  }

  const verified = factors.find((f) => f.status === "verified");
  const unverified = factors.find((f) => f.status === "unverified");
  const step: Step = verified
    ? "on"
    : enrollment || unverified
      ? "setup"
      : "off";

  if (loading) {
    return (
      <p className="text-[length:var(--fs-sm)] text-[var(--c-muted)]" role="status">讀取中…</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <span className="text-[length:var(--fs-md)] font-medium text-[var(--c-text)]">
            雙因素驗證 (MFA)
          </span>
          <span className="mt-0.5 block text-[length:var(--fs-micro)] text-[var(--c-muted)]">
            登入時額外要求 Authenticator 6 位數驗證碼
          </span>
        </div>
        <div className="flex-shrink-0">
          {step === "on" ? (
            <span className="inline-flex items-center border border-[var(--c-up)] px-2 py-0.5 font-mono text-[length:var(--fs-micro)] font-semibold text-[var(--c-up)]">
              已啟用
            </span>
          ) : (
            <Toggle
              on={step !== "off"}
              onClick={() => {
                if (step === "off") startEnroll();
                else if (enrollment) cancelEnroll();
                else if (unverified) disable(unverified.id);
              }}
              busy={busy}
            />
          )}
        </div>
      </div>

      {/* Enrollment panel */}
      {enrollment && (
        <div className="mfa-reveal border border-[var(--c-border)] bg-[var(--c-surface-soft)] p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center gap-2">
              <div className="border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrollment.qr}
                  alt="MFA 驗證器設定 QR code"
                  width={120}
                  height={120}
                  className="block h-[120px] w-[120px]"
                />
              </div>
              <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">
                用 Authenticator 掃描
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="mb-2 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
                <span className="font-mono text-[var(--c-accent)]">01</span> 掃描 QR，或手動輸入金鑰：
              </p>
              <code className="mb-4 block select-all break-all border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2.5 font-mono text-[length:var(--fs-md)] font-semibold tracking-[0.08em] text-[var(--c-accent)]">
                {enrollment.secret}
              </code>
              <p className="mb-2 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
                <span className="font-mono text-[var(--c-accent)]">02</span> 輸入 App 顯示的 6 位數驗證碼：
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  aria-label="6 位數驗證碼"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="field tnum h-11 w-[140px] py-0 text-center font-mono text-[length:var(--fs-lg)] font-semibold tracking-[0.3em]"
                />
                <button
                  type="button"
                  onClick={verify}
                  disabled={busy || code.length !== 6}
                  className="btn btn-neutral whitespace-nowrap"
                >
                  {busy ? "驗證中…" : "驗證並啟用"}
                </button>
                <button
                  type="button"
                  onClick={cancelEnroll}
                  disabled={busy}
                  className="btn btn-outline"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 已啟用：顯示 done card */}
      {verified && (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--c-up)] bg-[var(--c-surface-soft)] px-4 py-3">
          <span className="text-[length:var(--fs-sm)] text-[var(--c-text)]">
            MFA 已啟用，下次登入會要求驗證碼。
          </span>
          <div
            className="inline-confirm-shell mfa-inline-confirm"
            data-phase={confirmFactorId === verified.id ? "asking" : "idle"}
            role={confirmFactorId === verified.id ? "group" : undefined}
            aria-label={confirmFactorId === verified.id ? "確認停用 MFA" : undefined}
          >
            {confirmFactorId === verified.id ? (
              <div className="inline-confirm-body flex w-full items-center justify-end gap-1 px-1">
                <button
                  type="button"
                  onClick={() => setConfirmFactorId(null)}
                  disabled={busy}
                  className="btn btn-ghost btn-sm"
                >
                  取消
                </button>
                <button
                  ref={confirmActionRef}
                  type="button"
                  onClick={() => disable(verified.id)}
                  disabled={busy}
                  className="btn btn-danger btn-sm whitespace-nowrap"
                >
                  {busy ? "停用中…" : "確認停用"}
                </button>
              </div>
            ) : (
              <button
                ref={confirmTriggerRef}
                type="button"
                onClick={() => setConfirmFactorId(verified.id)}
                disabled={busy}
                className="btn btn-outline-danger whitespace-nowrap"
              >
                停用 MFA
              </button>
            )}
          </div>
        </div>
      )}

      {/* 卡住的 unverified factor */}
      {unverified && !enrollment && step !== "on" && (
        <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-micro)] text-[var(--c-down)]">
          <span>偵測到上次未完成的 enrollment。</span>
          {confirmFactorId === unverified.id ? (
            <span role="group" aria-label="確認清除未完成的 MFA 設定" className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setConfirmFactorId(null)}
                disabled={busy}
                className="btn btn-ghost btn-sm"
              >
                取消
              </button>
              <button
                ref={confirmActionRef}
                type="button"
                onClick={() => disable(unverified.id)}
                disabled={busy}
                className="btn btn-danger btn-sm"
              >
                {busy ? "清除中…" : "確認清除"}
              </button>
            </span>
          ) : (
            <button
              ref={confirmTriggerRef}
              type="button"
              onClick={() => setConfirmFactorId(unverified.id)}
              className="btn btn-outline-danger btn-sm"
            >
              清除
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="border border-[var(--c-down)] px-4 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]">
          {error}
        </p>
      )}

      <p className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">
        本 app 在登入時會強制 AAL2 升級；啟用後若無法登入，可請 admin 至 Supabase 後台移除 factor。
      </p>

    </div>
  );
}

function Toggle({
  on,
  onClick,
  busy,
}: {
  on: boolean;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "取消 MFA 設定" : "開始設定 MFA"}
      aria-busy={busy}
      onClick={onClick}
      disabled={busy}
      className="touch-target grid h-11 w-11 place-items-center disabled:cursor-wait disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative h-6 w-[42px] border transition-colors ${
          on
            ? "border-[var(--c-up)] bg-[var(--c-up)]"
            : "border-[var(--c-line-strong)] bg-[var(--c-surface-soft)]"
        }`}
      >
        <span
          className={`switch-thumb absolute top-[2px] block h-[18px] w-[18px] transition-transform ${
            on ? "translate-x-[20px] bg-[var(--c-btn-strong-text)]" : "translate-x-[2px] bg-[var(--c-text)]"
          }`}
        />
      </span>
    </button>
  );
}
