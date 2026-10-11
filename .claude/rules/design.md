# 設計規則

## 定位

StackWorth 是工具型 UI，核心指標是資料可讀性，不是視覺衝擊。

## 設計優先級

數字可讀性 > 資訊密度 > 視覺效果

禁止為了「比較漂亮」犧牲：
- 表格數字對齊
- 財務數值的字重與對比
- 圖表的資訊密度

## 視覺語言：測繪桌 Survey Table（2026-09-26 起）

- 色票：冷紙 #E7EEF0、石墨 #101820、測量藍 #195F7A、朱砂 #D14B32、藍灰 #91A8A8。
  實際值一律走 `globals.css` 的 CSS 變數，兩個主題各自設計、各自量對比
- 母題：製圖格線、十字軸線、測量註記、套準記號、直角／斜角控制項、髮絲線、等寬數字
- 圓角全站 0。斜角（clip-path）只給每頁唯一的主按鈕——clip-path 會裁掉 outline，
  那顆的焦點環改畫成 inset box-shadow
- 顏色慣例：賺綠虧紅（西方慣例），不改。**跌色與朱砂註記是兩個色**：
  跌色是資料，朱砂是「請注意」的註記，朱砂一律搭文字與虛線引線，不單靠顏色
- 字體：IBM Plex Sans（內文、標題）＋ IBM Plex Mono（數字、註記）＋ Noto Sans TC。
  沒有襯線字體
- CSS 變數系統（`globals.css`）維持現有架構：`:root` 是深色，`[data-theme="light"]` 覆寫

## 動畫

允許 `motion`（Motion for React）與 `gsap`，限制如下：

- 只放在隔離的 `"use client"` 葉節點元件裡，server component 不碰
- 同一棵元件樹不混用 GSAP 與 Motion
- 只動 transform 與 opacity，不動 width／height／top／left
- 一律尊重 `prefers-reduced-motion`：位移換成淡入或直接到終點
- 動作必須在說明狀態（哪一列變了、指示線移到哪），不做純裝飾
- 簡單的進場、hover 仍優先用 CSS；`useCountUp.ts`（rAF）與 `useFlipRows.ts`
  （Web Animations API）照舊可用
- **GSAP 的授權是 GreenSock Standard "no charge" License，不是開源授權**（OSI 未認可）。
  免費商用，但不能拿來做與 Webflow 競爭的視覺建站工具；本專案不受影響
- React Bits 可以當素材來源，但要改寫成符合本檔規則的版本（tokens、reduced-motion、
  不做游標跟隨之類的裝飾），不整包安裝
- Lenis（平滑捲動）仍然禁止：工具型 UI 不劫持捲動

## 介紹頁例外（`/about`，2026-10-11 起）

公開介紹頁 `/about` 是唯一允許「展示性動作」的頁面，工具頁（含 `/demo`）照舊：

- 允許：主圖描線、註記依序落下、各區塊捲進視野時淡入上移（一次，不重播）
- 實作限 CSS keyframe／transition 加一支 IntersectionObserver（`RevealRoot`），不裝 motion／gsap
- 仍然只動 transform、opacity（描線用 SVG 的 stroke-dashoffset）
- 仍然尊重 `prefers-reduced-motion`：描線直接畫完，位移換成淡入
- 仍然禁止：Lenis、捲動劫持、捲動綁定的逐格播放（scrubbing）、游標跟隨
- 沒有 JS 時內容必須照常顯示（隱藏規則以 `html[data-reveal-ready]` 為前提）
- 頁面上的數字一律取自 `/demo` 同一份資料與計算管線，不另寫行銷用數字

## 禁止

- 禁止套 movie-app 的 cinematic 風格（整頁捲動劇場、Lenis）到這個專案
- 禁止引入新的 UI library，除非另行確認
- 禁止套通用 SaaS 設計（紫藍漸層、glassmorphism、置中 hero、陰影卡片堆疊）
- 圖表以 Recharts（已整合）為主，不引入其他圖表庫；手刻 SVG 可以
- 禁止硬編碼顏色，統一用 CSS 變數
