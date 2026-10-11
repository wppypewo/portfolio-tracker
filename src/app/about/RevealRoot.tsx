"use client";

import { useEffect } from "react";

/* 介紹頁的進場觸發。只做一件事：區塊捲進視野時在元素上掛 data-inview，
   動作本身全寫在 globals.css（只動 opacity 與 transform）。

   隱藏規則以 html[data-reveal-ready] 為前提，這個屬性由這裡在掛載後才加上：
   JS 沒跑（或還沒跑）時內容照常顯示，不會整頁空白。
   掛載當下已經在視野裡的區塊直接標成 inview、不播動畫，免得先閃現再消失。
   每個元素只觸發一次，捲回去不會重播——重播是表演，不是說明。 */
export function RevealRoot() {
  useEffect(() => {
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const fold = window.innerHeight * 0.92;
    for (const el of els) {
      if (el.getBoundingClientRect().top < fold) el.dataset.inview = "";
    }
    root.dataset.revealReady = "";

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.inview = "";
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const el of els) if (!("inview" in el.dataset)) io.observe(el);

    return () => {
      io.disconnect();
      delete root.dataset.revealReady;
    };
  }, []);

  return null;
}
