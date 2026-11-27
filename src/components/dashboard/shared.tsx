"use client";

export const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
export type Tone = "up" | "down" | "flat";
export const toneCls = (n: number): Tone =>
  n > 0 ? "up" : n < 0 ? "down" : "flat";
export const TONE_TEXT: Record<Tone, string> = {
  up: "text-[var(--c-up)]",
  down: "text-[var(--c-down)]",
  flat: "text-[var(--c-muted)]",
};

/* 首頁上「這一個被選中」原本有六種寫法：模式切換換中性底色、區間鈕換 accent 底色
   加 accent 字、手機排序藥丸同時換邊框與底色、桌機表頭只有一個箭頭、圖例鈕靠
   透明度、配置列則是「其他變淡」。同一頁六套語彙，讀者得逐個重學。

   收斂成兩套，依互動的種類分，不依控制項長相分：

   PICK_*  互斥選擇（切換檢視、選區間、選排序欄）——同一組裡永遠恰好一個成立。
   開關    獨立布林（圖例）——各自獨立，可以全開或全關。寫在 TrendSection，
           只有邊框與透明度、不填色，跟 PICK 明顯分開。

   PICK 的選中訊號是「accent 文字 + 字重」，填色只是輔助。這是量出來的：
   四種填色（surface-soft / accent-soft，各對 surface 與 page）對底色只有
   1.03–1.18:1，沒有一個到得了 WCAG 1.4.11 的 3:1，填色本身撐不起訊號。
   填色選 surface-soft 而不是原本區間鈕的 accent-soft，是因為 accent 字疊在
   accent-soft 上實測深色 4.42:1、淺色（在 page 上）4.37:1，兩個主題各有一種
   底色低於 AA 的 4.5:1；疊在 surface-soft 上是 4.87 / 5.11，兩邊都過。 */
export const PICK_ON = "bg-[var(--c-surface-soft)] font-medium text-[var(--c-accent)]";
export const PICK_OFF =
  "font-medium text-[var(--c-muted)] hover:bg-[var(--c-surface-soft)] hover:text-[var(--c-text)]";

export function CardHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    /* 這支只服務三級區塊（資產配置、績效指標）。標題用 --fs-sm 並轉 muted，
       是為了讓它讀起來明顯次於二級的「持倉帳本 / 淨資產趨勢」（--fs-lg）。
       字級差距本身就是層級訊號，不必再靠容器。 */
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[length:var(--fs-sm)] font-medium tracking-[0.01em] text-[var(--c-muted)]">
          {title}
        </h2>
        {sub && (
          <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-[var(--c-muted)]">
            {sub}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

// 測量標籤定義在 components/survey.tsx（server 頁面也要用），這裡轉出給儀表板。
export { SurveyLabel } from "@/components/survey";
