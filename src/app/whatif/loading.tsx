import { AppHeader } from "@/components/AppHeader";

// 骨架照 page.tsx 的地塊排：返回連結、頁首、分段分頁列、控制欄＋結果欄。
// .sk 是斜線填紋的空地塊，已自帶掃光與 reduced-motion 處理。
export default function WhatIfLoading() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="whatif" authPending />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-7">
        <div className="sk h-4 w-20" />
        <header className="mt-4 mb-6 border-b border-[var(--c-line-strong)] pb-5">
          <div className="sk h-3 w-36" />
          <div className="sk mt-3 h-7 w-32" />
          <div className="sk mt-2.5 h-3 w-80 max-w-full" />
        </header>

        {/* 分頁列 */}
        <div className="sk mb-6 h-11 w-full sm:w-[420px]" />

        {/* 控制欄 + 結果欄，同一個外框，中間一條髮絲線 */}
        <div className="grid grid-cols-1 items-start border border-[var(--c-border)] bg-[var(--c-surface)] min-[880px]:grid-cols-[340px_1fr]">
          <section className="p-5 sm:p-6 min-[880px]:border-r min-[880px]:border-[var(--c-border)]">
            <div className="sk h-5 w-24" />
            <div className="sk mt-2 h-3 w-40" />
            <div className="sk mt-5 h-10 w-full" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="mt-5">
                <div className="flex justify-between">
                  <div className="sk h-3 w-24" />
                  <div className="sk h-3 w-16" />
                </div>
                <div className="sk mt-2.5 h-1.5 w-full" />
              </div>
            ))}
          </section>

          <section className="border-t border-[var(--c-border)] p-5 sm:p-6 min-[880px]:border-t-0">
            <div className="border-b border-[var(--c-line-strong)] pb-5">
              <div className="sk h-3 w-28" />
              <div className="sk mt-3 h-11 w-64 max-w-full" />
              <div className="sk mt-3 h-3 w-64 max-w-full" />
            </div>
            <div className="sk mt-5 h-[280px]" />
            <div className="mt-5 grid grid-cols-2 gap-px border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-[var(--c-surface)] px-4 py-3">
                  <div className="sk h-3 w-16" />
                  <div className="sk mt-2 h-5 w-20" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
