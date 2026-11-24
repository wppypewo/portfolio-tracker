"use client";

import { useEffect, useState } from "react";

/**
 * 讓「開／關」的浮層有離場過程：關掉時先留在 DOM 上 exitMs，
 * 標成 closing 讓 CSS 播離場，時間到才卸載。
 *
 * - 進場交給 CSS 的 @starting-style（見 globals.css 的 .presence），
 *   所以這裡只管離場。
 * - 可打斷：離場途中又打開，closing 立刻變回 false，transition 從當下的
 *   opacity／transform 接回終點，不會從零重播。
 * - exitMs 要和 CSS 的 --dur-fast 一致；reduced-motion 時 CSS 仍是淡出，
 *   時長相同，所以不必另外分支。
 */
export function usePresence(open: boolean, exitMs = 120) {
  const [lingering, setLingering] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // 依 prop 變化調整 state 的官方寫法：在 render 期間比對上一次的值。
  if (prevOpen !== open) {
    setPrevOpen(open);
    setLingering(!open);
  }

  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(timer);
  }, [lingering, exitMs]);

  return { mounted: open || lingering, closing: !open && lingering };
}
