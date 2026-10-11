/* 測繪桌的頁面層級元件：頁首、測量標籤、狀態標記、指標帶。
   這支檔刻意不加 "use client"——全部是無狀態的純標記，server 頁面直接用，
   client 元件 import 也照常。dashboard/shared.tsx 的 SurveyLabel 從這裡轉出。 */

/* 測量註記的標籤：前面一個 7px 的 L 形角標，後面是字。
   原本是十字，小字下讀起來像「+」，緊接在帶號金額上方時跟正負號混在一起；
   改成跟 .survey-frame 四角同一個 L 形，不會被讀成任何運算符號。
   記號不帶意義，所以對輔助技術隱藏。
   字仍用 Plex Sans：中文會落到 Noto Sans TC，Mono 只在數字上用。 */
export function SurveyLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[length:var(--fs-micro)] font-semibold tracking-[0.06em] text-[var(--c-muted)] ${className}`}
    >
      <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true" className="shrink-0">
        <path d="M0.5 7V0.5H7" fill="none" stroke="var(--c-accent)" strokeWidth="1" />
      </svg>
      {children}
    </span>
  );
}

/* 一級頁首：測量標籤 → 標題 → 說明，底下一條 line-strong 髮絲線收邊。
   右側 action 放該頁的表單或主按鈕，窄螢幕時換行到標題下方。 */
export function PageHead({
  label,
  title,
  sub,
  action,
  className = "",
}: {
  label?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-[var(--c-line-strong)] pb-5 ${className}`}
    >
      <div className="min-w-0">
        {label && <SurveyLabel>{label}</SurveyLabel>}
        <h1
          className={`font-display text-[length:var(--fs-2xl)] font-semibold leading-tight tracking-[-0.01em] ${
            label ? "mt-2" : ""
          }`}
        >
          {title}
        </h1>
        {sub && (
          <p className="mt-1.5 max-w-2xl text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
            {sub}
          </p>
        )}
      </div>
      {action}
    </header>
  );
}

/* 方角狀態標記。不做膠囊、不做底色塊，靠外框與字表意：
   - up：已完成、正向結果，實線綠框
   - down：跌破、負向結果，實線跌色框（與朱砂註記是兩個色，見 design.md）
   - annot：需要注意（例如檢討到期），朱砂虛線框。字用 --c-annot-text，
     因為淺色主題下朱砂本身對底不到 4.5:1，只能當框色
   - accent：分類（加碼、續抱），測量藍淡底
   - quiet：進行中、沒有要人做的事 */
export type TagTone = "up" | "down" | "annot" | "accent" | "quiet";

const TAG_TONE: Record<TagTone, string> = {
  up: "border-[var(--c-up)] text-[var(--c-up)]",
  down: "border-[var(--c-down)] text-[var(--c-down)]",
  annot: "border-dashed border-[var(--c-annot)] text-[var(--c-annot-text)]",
  accent: "border-transparent bg-[var(--c-accent-soft)] text-[var(--c-accent)]",
  quiet: "border-[var(--c-border)] text-[var(--c-muted)]",
};

export function Tag({
  tone = "quiet",
  children,
}: {
  tone?: TagTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-px text-[length:var(--fs-micro)] font-semibold leading-5 ${TAG_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/* 指標帶：一排等寬格子，格與格之間是 1px 髮絲線（gap-px 透出底下的 border 色），
   跟首頁 hero 下方那排同一個作法。cols 是 sm 以上的欄數，手機固定兩欄。 */
const STRIP_COLS: Record<3 | 4 | 5, string> = {
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

export function StatStrip({
  cols,
  colsClass,
  children,
  className = "",
}: {
  cols: 3 | 4 | 5;
  /* 取代 cols 對應的 sm 欄數 class，給格子在 sm 就排不下的頁面用
     （例：五格金額在 768px 每格只剩約 110px，「NT$ 1,221,841」會斷成兩行）。
     不給就照 cols，既有頁面不受影響。 */
  colsClass?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`grid grid-cols-2 gap-px border border-[var(--c-border)] bg-[var(--c-border)] ${colsClass ?? STRIP_COLS[cols]} ${className}`}
    >
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  mask = false,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  // 金額要跟著隱私模式模糊；百分比與筆數不用
  mask?: boolean;
  className?: string;
}) {
  return (
    <div className={`bg-[var(--c-surface)] px-4 py-3.5 ${className}`}>
      <SurveyLabel>{label}</SurveyLabel>
      <div
        className={`mt-1.5 text-[length:var(--fs-md)] font-semibold tnum ${mask ? "amt" : ""}`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">{sub}</div>
      )}
    </div>
  );
}

/* 帶標題列的區塊框：外框髮絲線、標題列下一條 border-soft，內容預設 p-5。
   flush 時內容貼齊外框，給表格與逐列帳本用（列自己有左右內距）。
   原本是 /demo/history 的區域元件，S3 的登入頁也要用，所以搬到這裡。 */
export function Panel({
  title,
  sub,
  action,
  flush = false,
  className = "",
  children,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`border border-[var(--c-border)] bg-[var(--c-surface)] ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--c-border-soft)] px-5 py-3">
        <h2 className="text-[length:var(--fs-lg)] font-semibold">{title}</h2>
        {sub && <div className="text-[length:var(--fs-micro)] text-[var(--c-faint)]">{sub}</div>}
        {action}
      </div>
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

/* 斜線地塊的填色：與首頁 AllocationCard 的 hatch() 同一個配方。
   那支是 client 元件，server 頁面不能呼叫，所以月報與歷史回放的地塊條從這裡取。 */
export const PARCEL_HATCH =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--c-accent) 55%, transparent) 0 1px, transparent 1px 6px), color-mix(in srgb, var(--c-accent) 12%, transparent)";

/* 空狀態：一塊「還沒測量的圖幅」。虛線外框 + 淡斜線底，跟載入骨架 .sk 同一個語彙
   （斜線＝這塊還沒有資料），差在骨架會掃光、空狀態是靜的。
   原本全站 10 處各寫一份：外框有 border 與 line-strong 兩種、內距從 py-5 到 py-12、
   有的置中有的靠左、有的有底色有的透出格線，同一件事長成四個樣子。
   compact 給清單裡的空列（提醒、定期定額）：靠左、內距小，不搶上方表單。
   title 選填：只有一句話時直接放 children。 */
export function EmptyPlot({
  title,
  children,
  action,
  compact = false,
  className = "",
}: {
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`empty-plot border border-dashed border-[var(--c-line-strong)] ${
        compact ? "px-4 py-4" : "px-6 py-11 text-center"
      } ${className}`}
    >
      {title && <p className="text-[length:var(--fs-md)] font-medium text-[var(--c-text)]">{title}</p>}
      {children && (
        <div
          className={`text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)] ${
            title ? "mt-1" : ""
          } ${compact ? "" : "mx-auto max-w-[46ch]"}`}
        >
          {children}
        </div>
      )}
      {action && <div className={compact ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}
