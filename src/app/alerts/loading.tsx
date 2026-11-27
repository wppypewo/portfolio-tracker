import { AppHeader } from "@/components/AppHeader";

// 骨架照 page.tsx 的地塊排：返回連結、頁首、新增面板、啟用中帳本。
// .sk 是斜線填紋的空地塊，已自帶掃光與 reduced-motion 處理。
export default function AlertsLoading() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="alerts" authPending />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[900px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-7">
        <div className="sk h-4 w-20" />
        <header className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-[var(--c-line-strong)] pb-5">
          <div>
            <div className="sk h-3 w-20" />
            <div className="sk mt-3 h-7 w-24" />
            <div className="sk mt-2.5 h-3 w-72" />
          </div>
          <div className="sk h-10 w-12" />
        </header>

        {/* 新增面板 */}
        <section className="mt-8 border border-[var(--c-border)] bg-[var(--c-surface)]">
          <div className="border-b border-[var(--c-border-soft)] px-5 py-3">
            <div className="sk h-4 w-20" />
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="sk h-24" />
              ))}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sk h-11" />
              <div className="sk h-11" />
            </div>
            <div className="sk mt-4 h-12" />
            <div className="sk mt-5 h-11 w-28" />
          </div>
        </section>

        {/* 啟用中帳本 */}
        <section className="mt-8">
          <div className="border-b border-[var(--c-line-strong)] pb-2">
            <div className="sk h-4 w-20" />
          </div>
          <div className="mt-3 border border-[var(--c-border)] bg-[var(--c-surface)]">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-[var(--c-border-soft)] px-5 py-4 first:border-t-0"
              >
                <div className="sk h-10 w-10 shrink-0" />
                <div className="flex-1">
                  <div className="sk h-4 w-48" />
                  <div className="sk mt-2.5 h-1.5 w-full" />
                  <div className="sk mt-2 h-3 w-32" />
                </div>
                <div className="sk h-11 w-24 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
