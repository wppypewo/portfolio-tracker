import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NONCE_HEADER } from "@/lib/csp";
import { SwRegister } from "@/components/SwRegister";
import { LiveAnnouncer } from "@/components/a11y/LiveAnnouncer";
import { SiteFooter } from "@/components/SiteFooter";
import localFont from "next/font/local";
import "./globals.css";

/* 字體自架。檔案由 scripts/build-fonts.py 產生並 commit 進 repo，
   建置流程不需要 Python，也不對外抓字體——建置期抓 Noto Sans TC 失敗
   是這次改動要解決的問題。

   2026-09-26 測繪桌翻新拿掉了 Newsreader：襯線是舊版「帳本」語言的主角，
   新的語言是製圖桌，標題改用 Plex Sans、數字與註記用 Plex Mono。 */

/* 2026-08-18：Space Grotesk → IBM Plex Sans。Space Grotesk 的數字是幾何造型
   （單層 a、無襯線的 1），放在滿頁市值與損益的帳本裡辨識負擔偏高。
   Plex Sans 本來就是為工程與財報介面畫的，數字骨架清楚，與 Noto Sans TC
   的人文骨架也比較搭。上游那條沒人用的 wdth 軸在 build-fonts.py 裡釘死了。 */
const fontSans = localFont({
  src: "./fonts/IBMPlexSans-latin.woff2",
  variable: "--font-sans",
  weight: "100 700",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["system-ui", "sans-serif"],
});

/* 等寬：全站 .tnum 數字、測量註記、軸標與 hero 大數字（Mono 600）。
   IBM Plex Mono 上游沒有變數檔，所以破例收三個靜態字重 400 / 500 / 600，
   三個檔加起來 31.8 KB。字集是可列印 ASCII 加幾個註記符號，不是整個拉丁範圍。 */
const fontFigures = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-400-ascii.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-500-ascii.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-600-ascii.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-figures",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

/* preload 關掉：這個檔 1.68 MB，preload 會讓它跟關鍵 JS 搶頻寬，
   而 display:swap 本來就會先用系統中文字體把字顯示出來。
   adjustFontFallback 也關掉：那個選項只會拿 Arial / Times 的度量去校正，
   對中文字沒有意義，硬套反而會讓 fallback 期間的字級不對。 */
const fontTc = localFont({
  src: "./fonts/NotoSansTC-big5.woff2",
  variable: "--font-tc",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0E151B" },
    { media: "(prefers-color-scheme: light)", color: "#E7EEF0" },
  ],
};

export const metadata: Metadata = {
  title: "StackWorth",
  description: "個人投資組合追蹤工具",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false, nocache: true },
  appleWebApp: {
    capable: true,
    title: "StackWorth",
    statusBarStyle: "default",
  },
};

const themeInit = `(function(){try{
  var pref = localStorage.getItem('themePref') || localStorage.getItem('theme') || 'system';
  if (pref !== 'light' && pref !== 'dark') pref = 'system';
  var resolved = pref === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  document.documentElement.dataset.privacy = localStorage.getItem('privacy') === 'on' ? 'on' : 'off';
}catch(e){
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.themePref = 'system';
  document.documentElement.dataset.privacy = 'off';
}})();`;

/* 讀 nonce 會讓整個 app 變成動態渲染——這是 nonce 型 CSP 的既定代價
   （Next 官方文件明列：static optimization 與 ISR 停用、CDN 不能快取）。
   改動前有 7 個靜態頁：/login、/methodology、/demo/decisions、/demo/whatif、
   /auth/mfa、/auth/reset-password、/_not-found。 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* Next 會自動把 nonce 加到框架 script 與它自己產生的 inline script 上，
     但這支主題初始化 script 是手寫的，不在自動範圍內，要自己掛。
     proxy 沒跑到的路徑（見 proxy.ts 的 matcher）拿不到 x-nonce，
     此時為 undefined，React 不會輸出該屬性。 */
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html
      lang="zh-Hant"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontFigures.variable} ${fontTc.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* 跳至主內容（WCAG 2.4.1 Bypass Blocks，Level A）。
            導覽列每頁有 7 個項目加通知與帳號，鍵盤使用者換頁都要重 tab 一遍。
            平時視覺隱藏，取得焦點才顯示；目標 <main> 帶 tabIndex={-1}，
            否則 Safari 只會捲動而不移動焦點。 */}
        <a href="#main" className="skip-link">
          跳至主內容
        </a>
        <SwRegister />
        {/* 常駐播報區。動作結果要被螢幕閱讀器唸到，live region 必須先存在於
            無障礙樹裡，所以掛在這裡而不是跟訊息一起條件渲染。 */}
        <LiveAnnouncer />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
