import { DemoV1Header, type DemoActive } from "./DemoV1Header";

const skeleton = "sk";

const STAT_COLS: Record<3 | 4 | 5, string> = {
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
};

/* Demo 子頁的載入骨架：頁首、數字列、一塊主面板，導覽停在要去的那一頁。
   /demo/loading.tsx 是總覽的骨架，而 loading.js 的 Suspense 邊界會包住底下所有子路由，
   子頁沒有自己的 loading 時，切頁瞬間會閃到總覽骨架、導覽亮在「總覽」。
   數字列的欄數跟各頁 StatStrip 相同（五格是月報：sm–lg 三欄、最後一格橫跨兩格）；情境頁先是規則面板，不帶數字列。 */
export function DemoPageSkeleton({ active, stats }: { active: DemoActive; stats?: 3 | 4 | 5 }) {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <DemoV1Header active={active} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-7 lg:pt-8">
        <p role="status" className="sr-only">載入中</p>
        <div className="border-b border-[var(--c-line-strong)] pb-5">
          <div className={`h-3 w-40 ${skeleton}`} />
          <div className={`mt-3 h-8 w-[min(64vw,280px)] ${skeleton}`} />
          <div className={`mt-3 h-4 w-[min(80vw,420px)] ${skeleton}`} />
        </div>
        {stats && (
          <section className={`mt-6 grid gap-px border border-[var(--c-border)] bg-[var(--c-border)] ${STAT_COLS[stats]}`}>
            {Array.from({ length: stats }, (_, index) => (
              <div key={index} className={`bg-[var(--c-surface)] px-4 py-4 sm:px-5 sm:py-5 ${stats === 5 && index === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
                <div className={`h-3 w-16 ${skeleton}`} />
                <div className={`mt-2 h-6 w-24 ${skeleton}`} />
              </div>
            ))}
          </section>
        )}
        <section className="mt-6 border border-[var(--c-border)] bg-[var(--c-surface)] p-5 sm:p-6">
          <div className={`h-5 w-28 ${skeleton}`} />
          <div className={`mt-2 h-3 w-48 ${skeleton}`} />
          <div className={`mt-4 h-[280px] ${skeleton} opacity-50`} />
        </section>
      </main>
    </div>
  );
}

const panel = "border border-[var(--c-border)] bg-[var(--c-surface)] p-5 sm:p-6";

/* 總覽的載入骨架（原本寫在 demo/loading.tsx）。刻意渲染 DemoV1Header（而非根 loading.tsx 的已登入版
   AppHeader），避免公開訪客在載入瞬間閃到「登入」導覽再跳成 DEMO 版。 */
export function DemoOverviewSkeleton() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <DemoV1Header active="overview" />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-7 lg:pt-8">
        <div className={`mb-3 h-3 w-[min(80vw,420px)] ${skeleton}`} />
        <div className="flex flex-col gap-5">
          <section className="border-b border-[var(--c-border)] pb-7 pt-4 sm:pb-8 sm:pt-7">
            <div className={`h-3 w-20 ${skeleton}`} />
            <div className={`mt-3 h-14 w-[min(72vw,360px)] ${skeleton}`} />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <div className={`h-4 w-44 ${skeleton}`} />
              <div className={`h-4 w-36 ${skeleton}`} />
            </div>
          </section>

          <section className="border border-[var(--c-border)] bg-[var(--c-border)]">
            <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="bg-[var(--c-surface)] px-4 py-4 sm:px-5 sm:py-5"
                >
                  <div className={`h-3 w-16 ${skeleton}`} />
                  <div className={`mt-2 h-6 w-24 ${skeleton}`} />
                  <div className={`mt-2 h-3 w-20 ${skeleton}`} />
                </div>
              ))}
            </div>
          </section>

          <section className={panel}>
            <div className={`h-5 w-28 ${skeleton}`} />
            <div className={`mt-2 h-3 w-48 ${skeleton}`} />
            <div className={`mt-4 h-[280px] ${skeleton} opacity-50`} />
          </section>
        </div>
      </main>
    </div>
  );
}
