"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshMyPrices } from "@/lib/refresh-actions";
import { announce } from "@/components/a11y/live-announcer";
import { usePresence } from "@/components/usePresence";

// 手動刷新報價鈕。放在「報價更新於 …」旁邊，總覽 hero 與帳戶詳情頁共用。
// - 進行中：箭頭旋轉、不可再按
// - 結果：按鈕旁短暫顯示一行回饋（成功 2.5 秒、其他 4 秒；淡入淡出）
// - 結束時箭頭把當圈轉完才停，不會停在半途的角度
// - 冷卻中：顯示剩餘分鐘數（伺服器端判斷，見 refresh-actions）

export function RefreshPricesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const msgPresence = usePresence(msgOpen);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // pending 一結束就拿掉 animate-spin，箭頭會從當下角度跳回 0°。
  // 改成另外記 spinning：pending 開始時打開，結束後等這一圈跑完
  // （onAnimationIteration）才關。減少動態效果時 animate-spin 被關掉、
  // 不會有 iteration 事件，所以另設 1 秒（一圈的時長）的保底計時。
  const [spinning, setSpinning] = useState(false);
  if (pending && !spinning) setSpinning(true);
  useEffect(() => {
    if (pending || !spinning) return;
    const t = setTimeout(() => setSpinning(false), 1000);
    return () => clearTimeout(t);
  }, [pending, spinning]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // 這行回饋幾秒就消失，讀屏使用者很可能還沒讀到就沒了，所以同步推去播報中心。
  // 成功只是確認，2.5 秒；冷卻、失敗要讀內容，留 4 秒。
  // 關閉只把 msgOpen 設 false，文字留著讓淡出期間仍看得到。
  function flash(
    text: string,
    tone: "polite" | "assertive" = "polite",
    ms = 4000,
  ) {
    setMsg(text);
    setMsgOpen(true);
    announce(text, tone);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsgOpen(false), ms);
  }

  function onClick() {
    if (pending) return;
    startTransition(async () => {
      const r = await refreshMyPrices();
      if (r.ok) {
        if (r.failed > 0) {
          flash(`已更新 ${r.refreshed} 檔，${r.failed} 檔失敗`);
        } else {
          flash(`已更新 ${r.refreshed} 檔`, "polite", 2500);
        }
        router.refresh();
      } else if (r.waitSec != null) {
        flash(`剛更新過，${Math.ceil(r.waitSec / 60)} 分鐘後可再刷新`);
      } else {
        flash(`刷新失敗：${r.error}`, "assertive");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-label="刷新報價"
        title="刷新報價"
        className="touch-target grid h-8 w-8 place-items-center text-[var(--c-muted)] transition-colors hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)] disabled:pointer-events-none"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
          className={spinning ? "animate-spin" : ""}
          onAnimationIteration={() => {
            if (!pending) setSpinning(false);
          }}
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 1.5v3h-3" />
        </svg>
      </button>
      {msgPresence.mounted && msg && (
        <span
          data-closing={msgPresence.closing || undefined}
          className="pop [--pop-from:translateX(-4px)] whitespace-nowrap text-[length:var(--fs-micro)] text-[var(--c-muted)]"
        >
          {msg}
        </span>
      )}
    </span>
  );
}
