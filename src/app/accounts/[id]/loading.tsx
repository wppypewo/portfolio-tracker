import { AppHeader } from "@/components/AppHeader";

// 骨架照 page.tsx 的地塊排：頁首（身分／估值）、指標帶、趨勢、操作與定期定額、變動記錄。
// .sk 是斜線填紋的空地塊，已自帶掃光與 reduced-motion 處理。
export default function AccountDetailLoading() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="accounts" authPending />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="sk h-4 w-20" />
        <header className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-[var(--c-line-strong)] pb-5">
          <div>
            <div className="sk h-3 w-24" />
            <div className="sk mt-3 h-8 w-64" />
          </div>
          <div className="sk h-11 w-56" />
        </header>
        <div className="sk mt-3 h-3 w-72" />
        <div className="mt-5 grid grid-cols-2 gap-px border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`bg-[var(--c-surface)] px-4 py-3 ${i === 2 ? "col-span-2 sm:col-span-1" : ""}`}>
              <div className="sk h-3 w-16" />
              <div className="sk mt-2.5 h-5 w-28" />
            </div>
          ))}
        </div>
        <section className="mt-6 border border-[var(--c-border)] bg-[var(--c-surface)]">
          <div className="border-b border-[var(--c-border-soft)] px-5 py-3">
            <div className="sk h-4 w-20" />
          </div>
          <div className="p-5">
            <div className="sk h-[260px]" />
          </div>
        </section>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <section key={i}>
              <div className="border-b border-[var(--c-line-strong)] pb-2">
                <div className="sk h-5 w-20" />
              </div>
              <div className="sk mt-3 h-11 w-full" />
              <div className="sk mt-3 h-11 w-full" />
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
