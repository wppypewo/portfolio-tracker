/* 公開頁（介紹、登入、指標說明、驗證流程）的載入 fallback：一塊空白桌面。

   這幾頁沒有自己的 loading.tsx 時，最近的 Suspense 邊界是根層 loading.tsx，
   它畫的是已登入首頁的骨架，導覽列有「帳戶、活動、基準 TWD」。正式 build 實測
   /about、/login、/methodology 的首段 HTML 都是那份骨架：未登入的訪客會先閃過
   一個不屬於他們的畫面，關掉 JS 時更會一直停在那裡。根層的 UnlessDemo 在 SSR 時
   拿不到路徑，分辨不出這幾頁，所以改由各頁自己的 loading.tsx 擋在前面。
   內容在同一個回應裡緊接著送到，空白一閃比錯的導覽列好。

   沒有 JS 時，串流進來的內容會一直留在 <div hidden id="S:…"> 裡。這幾頁的內容
   本來就整份在 HTML 裡，只差「掀開」，所以在 noscript 裡用 CSS 把那個 div 顯示出來、
   把這塊空白收起來。選擇器不用引號：React 會把 style 內文的引號跳脫。
   id 前綴「S:」是 React 串流的內部約定，哪天改了這條只是失效，不會壞任何東西。
   規則放進 @layer theme：Tailwind preflight 在 @layer base 用 !important 隱藏 [hidden]，
   而 !important 的比較是「越早宣告的 layer 越強、沒有 layer 的最弱」，
   寫在 layer 外或 base 之後都蓋不過它；theme 宣告在 base 之前，才贏得了。
   串流的內容附在 body 最後，排在 root layout 的頁尾後面；body 是 flex 欄，
   用 order 把頁尾排回最下方。 */
const NOSCRIPT_REVEAL =
  "@layer theme{div[hidden][id^=S\\:]{display:block!important}.public-fallback{display:none!important}body>footer{order:1}}";

export function PublicFallback() {
  return (
    <div className="public-fallback min-h-dvh" aria-busy="true">
      <noscript>
        <style>{NOSCRIPT_REVEAL}</style>
      </noscript>
    </div>
  );
}
