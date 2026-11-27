import { AppHeader } from "@/components/AppHeader";
import { UnlessDemo } from "@/components/DemoSkeleton";

const skeleton = "sk rounded-[var(--r-control)]";
const panel =
  "overflow-hidden rounded-[var(--r-card)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 sm:p-6";

// 這一層包住整個 app，Demo 路徑改用 Demo 自己的骨架，原因見 DemoSkeleton
export default function RootLoading() {
  return (
    <UnlessDemo>
      <HomeLoading />
    </UnlessDemo>
  );
}

function HomeLoading() {
  return (
    <div className="min-h-dvh bg-[var(--c-page)] text-[var(--c-text)]">
      <AppHeader active="portfolio" authPending />
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:px-7 lg:pt-8">
        <div className="flex flex-col gap-5">
          <section className="border-b border-[var(--c-border)] pb-7 pt-4 sm:pb-8 sm:pt-7">
            <div className={`h-3 w-20 ${skeleton}`} />
            <div className={`mt-3 h-14 w-[min(72vw,360px)] ${skeleton}`} />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-4">
              <div className={`h-4 w-44 ${skeleton}`} />
              <div className={`h-4 w-36 ${skeleton}`} />
            </div>
          </section>

          <section className="overflow-hidden rounded-[var(--r-card)] border border-[var(--c-border)] bg-[var(--c-border)]">
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

          <section className="overflow-hidden rounded-[var(--r-card)] border border-[var(--c-border)] bg-[var(--c-surface)]">
            <div className="flex items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
              <div>
                <div className={`h-5 w-28 ${skeleton}`} />
                <div className={`mt-2 h-3 w-32 ${skeleton}`} />
              </div>
              <div className={`h-10 w-24 ${skeleton}`} />
            </div>
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-t border-[var(--c-border)] px-4 py-4 sm:px-6"
              >
                <div className={`h-2 w-2 ${skeleton}`} />
                <div className={`h-4 w-32 ${skeleton}`} />
                <div className={`ml-auto h-4 w-24 ${skeleton}`} />
              </div>
            ))}
          </section>

          <section className={panel}>
            <div className={`h-5 w-28 ${skeleton}`} />
            <div className={`mt-2 h-3 w-48 ${skeleton}`} />
            <div className={`mt-4 h-[280px] ${skeleton} opacity-50`} />
          </section>

          <div className="grid grid-cols-1 gap-3 min-[920px]:grid-cols-2">
            {[0, 1].map((index) => (
              <section key={index} className={panel}>
                <div className={`h-5 w-28 ${skeleton}`} />
                <div className={`mt-4 h-[188px] ${skeleton} opacity-50`} />
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
