import { SurveyLabel } from "@/components/survey";

/* 登入、重設密碼、MFA 驗證三頁共用的地塊：落在製圖格線上的一塊方角框。
   頂端測量標籤列標出目前在哪一步，底下是標題、說明、內容，footer 是最底一條註記。
   不做陰影浮起，靠 line-strong 外框收邊。刻意不加 "use client"：純標記，三頁都是
   client 元件也照常 import。 */
export function AuthCard({
  label,
  title,
  sub,
  footer,
  children,
}: {
  label: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-[400px] border border-[var(--c-line-strong)] bg-[var(--c-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--c-border-soft)] px-6 py-2.5 sm:px-8">
        <SurveyLabel>{label}</SurveyLabel>
        <span className="text-[length:var(--fs-axis)] tracking-[0.08em] text-[var(--c-faint)] tnum">
          STACKWORTH
        </span>
      </div>
      <div className="px-6 pb-6 pt-5 sm:px-8 sm:pb-8">
        <h1 className="font-display text-[length:var(--fs-2xl)] font-medium leading-tight tracking-[-0.01em]">
          {title}
        </h1>
        {sub && (
          <p className="mt-1.5 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">{sub}</p>
        )}
        {children}
      </div>
      {footer && (
        <div className="border-t border-[var(--c-border-soft)] px-6 py-3 text-[length:var(--fs-micro)] text-[var(--c-faint)] sm:px-8">
          {footer}
        </div>
      )}
    </div>
  );
}

// 三頁共用的外層：垂直置中在格線上。表單是這頁唯一的內容，置中是合理的。
export const AUTH_MAIN =
  "flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:p-6";

export const AUTH_LABEL =
  "flex flex-col gap-2 text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]";

export const AUTH_ERROR =
  "border border-[var(--c-down)] px-4 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]";

export const AUTH_OK =
  "border border-[var(--c-up)] px-4 py-3 text-[length:var(--fs-sm)] text-[var(--c-up)]";
