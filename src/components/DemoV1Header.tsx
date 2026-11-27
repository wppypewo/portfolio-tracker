import Link from "next/link";
import { PrivacyToggle } from "./PrivacyToggle";
import { SurveyNav } from "./SurveyNav";
import { ThemeToggle } from "./ThemeToggle";

export type DemoActive = "overview" | "decisions" | "history" | "scenario" | "report";

export function DemoV1Header({ active }: { active: DemoActive }) {
  const items: { href: string; label: string; key: DemoActive }[] = [
    { href: "/demo", label: "總覽", key: "overview" },
    { href: "/demo/decisions", label: "日誌", key: "decisions" },
    { href: "/demo/history", label: "歷史", key: "history" },
    { href: "/demo/whatif", label: "情境", key: "scenario" },
    { href: "/demo/report", label: "月報", key: "report" },
  ];
  return (
    <header data-demo-header className="sticky top-0 z-40 border-b border-[var(--c-line-strong)] bg-[var(--c-page)]">
      <div className="mx-auto flex min-h-[var(--header-h)] max-w-[1200px] flex-wrap items-center gap-x-2 px-4 sm:flex-nowrap sm:px-6 lg:px-7">
        <Link href="/demo" className="flex min-h-11 items-center gap-2 font-medium tracking-[-0.02em]">
          StackWorth
          {/* 朱砂框的「樣張」戳記：提醒這一頁的數字是示範資料。框是朱砂、字用內文色，
              淺色主題下朱砂對底只有 3.75:1，不能拿來當字色。 */}
          <span className="border border-dashed border-[var(--c-annot)] px-1.5 py-px font-mono text-[length:var(--fs-micro)] font-medium text-[var(--c-text)]">
            Demo
          </span>
        </Link>
        <SurveyNav
          label="Demo 功能"
          items={items}
          active={active}
          className="scroll-region order-3 -mx-1 flex w-full gap-1 self-stretch overflow-x-auto border-t border-[var(--c-border)] sm:order-none sm:mx-0 sm:ml-4 sm:w-auto sm:border-t-0"
          itemClassName="min-h-11 sm:min-h-[var(--header-h)]"
        />
        <div className="ml-auto flex items-center"><PrivacyToggle /><ThemeToggle /></div>
      </div>
    </header>
  );
}
