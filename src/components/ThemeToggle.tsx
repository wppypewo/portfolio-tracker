"use client";

import { useSyncExternalStore } from "react";

/**
 * 主題系統：三態（light / dark / system）。
 * - themePref：使用者選擇的偏好，存 localStorage
 * - resolvedTheme：實際套用的二態（解析 system 後）
 *
 * Header 上的 ThemeToggle 是「快速二態切換」 — 點一下在當前解析後值的反面。
 * Settings 頁的 ThemeSegmented 是三態 segmented control。
 *
 * 都共用同一個 store（localStorage + theme:change event），互相同步。
 */

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function getResolvedSnapshot(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return (
    (document.documentElement.dataset.theme as ResolvedTheme) || "dark"
  );
}

function getPrefSnapshot(): ThemePref {
  if (typeof document === "undefined") return "system";
  return (
    (document.documentElement.dataset.themePref as ThemePref) || "system"
  );
}

function getServerSnapshot(): null {
  return null;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("theme:change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("theme:change", callback);
    window.removeEventListener("storage", callback);
  };
}

export function useResolvedTheme(): ResolvedTheme | null {
  return useSyncExternalStore(subscribe, getResolvedSnapshot, getServerSnapshot);
}

export function useThemePref(): ThemePref | null {
  return useSyncExternalStore(subscribe, getPrefSnapshot, getServerSnapshot);
}

function applyTheme(pref: ThemePref, resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  try {
    localStorage.setItem("themePref", pref);
    localStorage.setItem("theme", resolved);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("theme:change"));
}

// View Transition 的更新是非同步的：點下去到 data-theme 真的改掉之間還有一小段，
// 這段期間再點一次，若照舊讀 data-theme 會算出同一個目標、第二下等於沒按。
// 這裡記住「已經在路上的主題」，下一次切換以它為準。
let pendingTheme: ResolvedTheme | null = null;

export function setThemePref(pref: ThemePref) {
  const resolved: ResolvedTheme =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  // 深淺色切換用 View Transition 整頁交叉淡化（時長、曲線見 globals.css 的
  // ::view-transition-*）。不再對 body 背景做 transition：各元件的顏色各自
  // 過渡，起訖時間不同步，看起來像一塊塊陸續變色。
  // 實際主題沒變（例如 system → 目前就是的那一色）時直接套用，不播動畫。
  // 不支援的瀏覽器直接切換。減少動態效果時照樣淡化：淡入淡出沒有位移。
  const current = pendingTheme ?? document.documentElement.dataset.theme;
  const changed = current !== resolved;
  if (changed && typeof document.startViewTransition === "function") {
    pendingTheme = resolved;
    // 連點時前一段轉場會被跳過，但它的更新仍會先執行；只有最後一個目標落地時才清掉。
    const transition = document.startViewTransition(() => {
      if (pendingTheme === resolved) pendingTheme = null;
      applyTheme(pref, resolved);
    });
    // 被下一次切換跳過時 ready 會 reject（AbortError）；主題照樣套用了，這是預期情況，不要變成未處理的錯誤。
    transition.ready.catch(() => {});
  } else {
    applyTheme(pref, resolved);
  }
}

/**
 * Header 上的快速切換按鈕。點一下在 light ↔ dark 二態之間切換
 * （會把 pref 直接改成那個值，不再回到 system；要回 system 從 Settings）。
 */
export function ThemeToggle() {
  const resolved = useResolvedTheme();

  function toggle() {
    // 以「已經在路上的主題」為準，轉場還沒落地就再點一次也能切回來。
    const now = pendingTheme ?? resolved ?? "dark";
    const next = now === "dark" ? "light" : "dark";
    setThemePref(next);
  }

  // SSR / hydration 前：同尺寸佔位避免 layout shift
  if (resolved === null) {
    return (
      <button
        type="button"
        aria-label="切換顯示模式"
        className="btn btn-ghost btn-icon"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={resolved === "dark" ? "切到淺色" : "切到深色"}
      title={resolved === "dark" ? "切到淺色" : "切到深色"}
      className="btn btn-ghost btn-icon relative"
    >
      {resolved === "dark" ? (
        // 太陽（深色模式時 → 點擊切淺色）
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // 月亮（淺色模式時 → 點擊切深色）
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
