import Link from "next/link";
import pkg from "../../package.json";

/* 全站頁尾，畫成工程圖右下角的「標題欄」：品名、版次、資料來源、判讀慣例、比例尺（基準幣別）。
   原本每頁停在最後一塊內容後面的空白，沒有收尾，也沒有地方交代數字從哪裡來。
   標題欄本來就是圖紙上回答「這張圖是什麼、誰畫的、怎麼讀」的地方，放這些剛好。

   server component、無互動，放在 root layout 讓每頁都有；列印時藏起來
   （月報列印有自己的頁尾說明）。寬度跟各頁 main 的最寬值（1200px）對齊。 */
const CELLS: { label: string; value: React.ReactNode }[] = [
  { label: "版次", value: <span className="font-mono">v{pkg.version}</span> },
  { label: "報價", value: "Twelve Data · FinMind · CoinGecko" },
  { label: "判讀", value: "賺綠虧紅；「—」＝資料不足、不硬算" },
];

const LINKS = [
  { href: "/about", label: "關於" },
  { href: "/demo", label: "示範" },
  { href: "/methodology", label: "指標怎麼算" },
];

export function SiteFooter() {
  return (
    /* 實心桌面色 + 頂線：多數頁面的外層是實心 --c-page，蓋住了 body 的製圖格線；
       頁尾若透明，格線只在這一條露出來，看起來像接縫。 */
    <footer className="no-print mt-auto border-t border-[var(--c-border)] bg-[var(--c-page)]">
      {/* 手機底部留 96px：首頁的快速記帳鈕固定在右下，不能壓住免責聲明。 */}
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 sm:px-6 sm:pb-10 lg:px-7">
        <div className="grid grid-cols-2 border border-[var(--c-line-strong)] bg-[var(--c-page)] text-[length:var(--fs-micro)] md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_auto]">
          <div className="col-span-2 flex flex-col justify-between gap-2 border-b border-[var(--c-border)] p-3 md:col-span-1 md:border-b-0 md:border-r">
            <p className="flex items-center gap-2 font-semibold text-[var(--c-text)]">
              <CompassMark />
              StackWorth
            </p>
            <p className="text-[var(--c-muted)]">個人投資組合測繪</p>
          </div>
          {CELLS.map((cell, index) => (
            <div
              key={cell.label}
              className={`flex flex-col gap-1.5 border-[var(--c-border)] p-3 ${
                index === 2 ? "col-span-2 border-t md:col-span-1 md:border-t-0 md:border-r" : "border-r"
              } ${index === 1 ? "max-md:border-r-0" : ""}`}
            >
              <span className="font-mono text-[length:var(--fs-axis)] uppercase tracking-[0.12em] text-[var(--c-faint)]">
                {cell.label}
              </span>
              <span className="text-[var(--c-muted)]">{cell.value}</span>
            </div>
          ))}
          <div className="col-span-2 flex items-end border-t border-[var(--c-border)] p-3 md:col-span-1 md:border-t-0">
            <ScaleBar />
          </div>
        </div>
        <nav aria-label="頁尾" className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="underline decoration-[var(--c-line-strong)] underline-offset-4 hover:text-[var(--c-text)] hover:decoration-[var(--c-accent)]"
            >
              {link.label}
            </Link>
          ))}
          <span className="w-full text-[var(--c-faint)] sm:ml-auto sm:w-auto">本工具只呈現計算結果，不構成投資建議。</span>
        </nav>
      </div>
    </footer>
  );
}

/* 指北針：菱形 + 一條軸線，與頁首品牌的十字準星同一個語彙。 */
function CompassMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="text-[var(--c-accent)]">
      <path d="M6 0.5 L8.5 6 L6 11.5 L3.5 6 Z" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M6 0.5 L8.5 6 L3.5 6 Z" fill="currentColor" />
    </svg>
  );
}

/* 比例尺：黑白相間的四段，刻度標的是基準幣別。全站金額都先折成 TWD 才相加、
   才比較，這是讀每一個數字的前提，跟地圖的比例尺是同一類資訊。 */
function ScaleBar() {
  return (
    <figure className="flex flex-col gap-1" aria-label="基準幣別 TWD">
      <svg width="96" height="8" viewBox="0 0 96 8" aria-hidden="true" className="text-[var(--c-text)]">
        <rect x="0.5" y="0.5" width="95" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="0.5" y="0.5" width="24" height="7" fill="currentColor" />
        <rect x="48.5" y="0.5" width="24" height="7" fill="currentColor" />
      </svg>
      <figcaption className="flex justify-between font-mono text-[length:var(--fs-axis)] text-[var(--c-faint)]">
        <span>0</span>
        <span>TWD</span>
      </figcaption>
    </figure>
  );
}
