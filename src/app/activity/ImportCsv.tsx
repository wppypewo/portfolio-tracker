"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { importTransactionsCsv, type ImportResult } from "./actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";

// 測繪桌風格的可收合匯入面板，沿用真實的 importTransactionsCsv server action。
export function ImportCsv() {
  const [open, setOpen] = useState(false);
  const panelId = `csv-import-panel-${useId().replace(/:/g, "")}`;
  const [fileName, setFileName] = useState<string | null>(null);
  // 從快速新增的「匯入 CSV」連過來（/activity#csv-import）時直接打開，
  // 不要讓人到了這裡還得再找一次那顆收合鍵。
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === "#csv-import") setOpen(true);
    };
    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, []);
  const [state, action, pending] = useActionState<ImportResult, FormData>(
    importTransactionsCsv,
    undefined,
  );
  // 匯入結果是數字，唸出筆數才有意義，成功句照當下的結果組。
  useActionAnnounce(
    state,
    pending,
    state?.ok
      ? state.imported === 0
        ? `沒有匯入任何資料，跳過 ${state.skipped} 筆`
        : `已匯入 ${state.imported} 筆，跳過 ${state.skipped} 筆`
      : undefined,
  );

  return (
    <div id="csv-import" className="w-full scroll-mt-20 border border-[var(--c-border)] bg-[var(--c-surface)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-11 w-full items-center gap-2 px-4 text-[length:var(--fs-sm)] font-medium text-[var(--c-text)] transition-colors hover:bg-[var(--c-row-hover)]"
      >
        <span
          aria-hidden="true"
          className={`text-[length:var(--fs-micro)] text-[var(--c-muted)] transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        匯入 CSV
        <span className="ml-auto truncate text-[length:var(--fs-micro)] font-normal text-[var(--c-muted)]">
          交易紀錄 · 吃得下匯出檔與中英文欄位
        </span>
      </button>

      {open && (
        <form
          id={panelId}
          action={action}
          encType="multipart/form-data"
          className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4"
        >
          <div className="border-l-2 border-[var(--c-line-strong)] bg-[var(--c-surface-soft)] px-4 py-2.5 text-[length:var(--fs-micro)] leading-relaxed text-[var(--c-muted)]">
            <p className="mb-1.5 font-medium text-[var(--c-text)]">
              支援的欄位（任一即可）
            </p>
            <ul className="flex flex-col gap-1">
              <li>
                <b className="font-medium text-[var(--c-text)]">日期</b> date /
                日期 / 成交日（2026-05-01 / 2026/5/1 / 5/1/2026）
              </li>
              <li>
                <b className="font-medium text-[var(--c-text)]">帳戶</b> account
                / 帳戶 / 標的（須與帳戶名稱一致）
              </li>
              <li>
                <b className="font-medium text-[var(--c-text)]">類型</b> type /
                類型（配息 / 利息 / 買進 / 賣出 / buy / sell）
              </li>
              <li>
                <b className="font-medium text-[var(--c-text)]">金額</b> amount /
                金額，或匯出檔的 Cashflow（自動去除逗號與 NT$）
              </li>
              <li>
                <b className="font-medium text-[var(--c-text)]">備註</b> note /
                備註（選填）
              </li>
              <li className="mt-1.5 border-t border-[var(--c-border-soft)] pt-1.5">
                買賣需要匯出檔才帶得回成本基礎，且只能匯進尚無交易的帳戶；
                配息與利息任何帳戶都可以，同帳戶同時間的重複列會自動跳過。
              </li>
            </ul>
          </div>

          <label className="flex cursor-pointer flex-col items-center gap-2 border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface-soft)] px-4 py-5 text-center text-[length:var(--fs-sm)] text-[var(--c-muted)] transition-colors hover:border-[var(--c-accent)] focus-within:border-[var(--c-accent)]">
            <span aria-hidden="true" className="text-[length:var(--fs-lg)] text-[var(--c-muted)]">⬆</span>
            <span>
              {fileName ? (
                <span className="text-[var(--c-text)]">{fileName}</span>
              ) : (
                <>
                  點擊選擇 CSV 檔案
                </>
              )}
            </span>
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              hidden
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </label>

          {state &&
            (state.ok === false ? (
              <p className="border border-[var(--c-down)] px-4 py-2.5 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {state.error}
              </p>
            ) : state.ok === true ? (
              // 一筆都沒進去時不能用成功的綠色：檔案讀到了，但資料沒有變動
              <div
                className={`border px-4 py-2.5 text-[length:var(--fs-sm)] ${
                  state.imported === 0
                    ? "border-[var(--c-warn)] text-[var(--c-warn)]"
                    : "border-[var(--c-up)] text-[var(--c-up)]"
                }`}
              >
                <div className="tnum">
                  {state.imported === 0
                    ? `沒有匯入任何資料 · 跳過 ${state.skipped} 筆`
                    : `匯入 ${state.imported} 筆 · 跳過 ${state.skipped} 筆`}
                </div>
                {state.errors.length > 0 && (
                  <ul className="mt-1.5 list-disc pl-4 text-[length:var(--fs-micro)] text-[var(--c-down)]">
                    {state.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {state.errors.length > 5 && (
                      <li>… 還有 {state.errors.length - 5} 筆錯誤</li>
                    )}
                  </ul>
                )}
              </div>
            ) : null)}

          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary self-start"
          >
            {pending ? "匯入中…" : "上傳並匯入"}
          </button>
        </form>
      )}
    </div>
  );
}
