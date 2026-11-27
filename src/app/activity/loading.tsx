import { AppHeader } from "@/components/AppHeader";

// 骨架照 page.tsx 的地塊排：頁首、篩選鈕、工具列、時間軸帳本＋右側摘要。
// .sk 是斜線填紋的空地塊，已自帶掃光與 reduced-motion 處理。
export default function ActivityLoading() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="activity" authPending />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-[var(--c-line-strong)] pb-5">
          <div>
            <div className="sk h-3 w-20" />
            <div className="sk mt-3 h-7 w-32" />
            <div className="sk mt-2.5 h-3 w-64" />
          </div>
          <div className="sk h-10 w-28" />
        </header>

        {/* 篩選鈕 */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[16, 14, 12, 12, 10].map((w, i) => (
            <div key={i} className="sk h-9" style={{ width: `${w * 6}px` }} />
          ))}
        </div>

        {/* 工具列 */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="sk h-11 flex-1" />
          <div className="sk h-11 sm:w-80" />
        </div>

        {/* 帳本 + 摘要 */}
        <div className="mt-7 flex flex-col gap-8 min-[920px]:grid min-[920px]:grid-cols-[1fr_236px] min-[920px]:gap-10">
          <div className="flex flex-col gap-4">
            {[0, 1].map((g) => (
              <div key={g}>
                <div className="flex items-center justify-between border-b border-[var(--c-line-strong)] pb-2 pt-3 sm:ml-14">
                  <div className="sk h-4 w-32" />
                  <div className="sk h-3 w-24" />
                </div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="grid grid-cols-[40px_1fr] sm:grid-cols-[56px_1fr]">
                    <div className="flex justify-center pt-3">
                      <div className="sk h-6 w-6 sm:h-7 sm:w-7" />
                    </div>
                    <div className="ml-1 border-b border-[var(--c-border-soft)] py-3">
                      <div className="flex items-center gap-3">
                        <div className="sk h-5 w-20" />
                        <div className="sk h-4 w-28" />
                        <div className="sk ml-auto h-4 w-20" />
                      </div>
                      <div className="sk mt-2 h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="sk hidden h-56 min-[920px]:block" />
        </div>
      </main>
    </div>
  );
}
