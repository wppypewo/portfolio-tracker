"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  addByAmount,
  adjustBalance,
  adjustCostBasis,
  adjustQuantity,
  archiveAccount,
  deleteAccount,
  recordDividend,
  recordInterest,
  sellQuantity,
  unarchiveAccount,
  updatePrice,
  type FormState,
} from "./actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";
import { averageCostFx, resolveCostCorrection } from "@/lib/cost-correction";

type Props = {
  accountId: string;
  market: "us" | "tw" | "crypto" | "manual";
  currentQty: number;
  currentBalance: number;
  currentPrice: number;
  currentFx: number;
  nativeCurrency: string;
  currentCost: number;
  currentCostNative: number;
  status: "active" | "archived";
};

const fmtNative = (n: number, digits: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits });

const fmtShares = (n: number) =>
  Number.isFinite(n) && n > 0
    ? n.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : "—";

const fmtTwd = (n: number) =>
  n.toLocaleString("zh-TW", { maximumFractionDigits: 0 });

const pnlClass = (n: number) =>
  n > 0 ? "text-[var(--c-up)]" : n < 0 ? "text-[var(--c-down)]" : "text-[var(--c-muted)]";
const pnlSign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

export function AccountActions({
  accountId,
  market,
  currentQty,
  currentBalance,
  currentPrice,
  currentFx,
  nativeCurrency,
  currentCost,
  currentCostNative,
  status,
}: Props) {
  const isManual = market === "manual";
  const isArchived = status === "archived";

  const [updateState, updateAction, updatePending] = useActionState<FormState, FormData>(
    updatePrice,
    undefined,
  );
  const [addState, addAction, addPending] = useActionState<FormState, FormData>(
    addByAmount,
    undefined,
  );
  const [sellState, sellAction, sellPending] = useActionState<FormState, FormData>(
    sellQuantity,
    undefined,
  );
  const [divState, divAction, divPending] = useActionState<FormState, FormData>(
    recordDividend,
    undefined,
  );
  const [intState, intAction, intPending] = useActionState<FormState, FormData>(
    recordInterest,
    undefined,
  );
  const [qtyState, qtyAction, qtyPending] = useActionState<FormState, FormData>(
    adjustQuantity,
    undefined,
  );
  const [costState, costAction, costPending] = useActionState<FormState, FormData>(
    adjustCostBasis,
    undefined,
  );
  const [balState, balAction, balPending] = useActionState<FormState, FormData>(
    adjustBalance,
    undefined,
  );
  const [delState, delAction, delPending] = useActionState<FormState, FormData>(
    deleteAccount,
    undefined,
  );
  const [archState, archAction, archPending] = useActionState<FormState, FormData>(
    isArchived ? unarchiveAccount : archiveAccount,
    undefined,
  );

  /* 這幾支 action 成功時只做 revalidatePath、不回訊息，畫面靠重新渲染反映結果。
     視覺上看得出來，讀屏使用者沒有任何線索，所以成功句在這裡補。
     歸檔／恢復自己會回 ok 字串，hook 會優先用那個。 */
  useActionAnnounce(updateState, updatePending, "報價已更新");
  useActionAnnounce(addState, addPending, "加碼已記錄");
  useActionAnnounce(sellState, sellPending, "賣出已記錄");
  useActionAnnounce(divState, divPending, "配息已記錄");
  useActionAnnounce(intState, intPending, "利息已記錄");
  useActionAnnounce(qtyState, qtyPending, "股數已調整");
  useActionAnnounce(costState, costPending, "成本已校正");
  useActionAnnounce(balState, balPending, "餘額已修改");
  useActionAnnounce(delState, delPending);
  useActionAnnounce(archState, archPending);

  const [confirmDelete, setConfirmDelete] = useState(false);

  // === 加碼預覽 ===
  const [twd, setTwd] = useState("");
  const [buyFee, setBuyFee] = useState("");
  const [priceOverride, setPriceOverride] = useState("");
  const [fxOverride, setFxOverride] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const today = new Date();
  const todayDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const isBackdating = occurredAt !== "" && occurredAt.slice(0, 10) < todayDate;
  const [note, setNote] = useState("");
  // 六欄都是受控欄位，送出後 React 不會自動重設。不清的話再按一次就重複記一筆加碼。
  // 失敗時保留輸入，讓使用者改完重送。
  const addWasPending = useRef(false);
  useEffect(() => {
    if (addWasPending.current && !addPending && addState?.ok) {
      setTwd("");
      setBuyFee("");
      setPriceOverride("");
      setFxOverride("");
      setOccurredAt("");
      setNote("");
    }
    addWasPending.current = addPending;
  }, [addPending, addState]);
  const twdN = Number(twd);
  const priceN = priceOverride ? Number(priceOverride) : currentPrice;
  const fxN = fxOverride ? Number(fxOverride) : currentFx;
  const perShareTwd = priceN * fxN;
  // 費用內含：投入金額扣掉手續費才是買到股票的錢。
  const buyFeeN = buyFee ? Number(buyFee) : 0;
  const buyInvested =
    Number.isFinite(buyFeeN) && buyFeeN > 0 ? twdN - buyFeeN : twdN;
  const previewShares =
    Number.isFinite(buyInvested) && buyInvested > 0 && perShareTwd > 0
      ? buyInvested / perShareTwd
      : 0;
  const previewNewTotal = currentQty + previewShares;

  // === 賣出預覽 ===
  const [sellQtyStr, setSellQtyStr] = useState("");
  const [proceedsStr, setProceedsStr] = useState("");
  const [sellFee, setSellFee] = useState("");
  const [sellPriceOv, setSellPriceOv] = useState("");
  const [sellFxOv, setSellFxOv] = useState("");
  // 同加碼：這五欄受控，成功後要自己清。成交時間與備註是非受控欄位，React 會重設。
  const sellWasPending = useRef(false);
  useEffect(() => {
    if (sellWasPending.current && !sellPending && sellState?.ok) {
      setSellQtyStr("");
      setProceedsStr("");
      setSellFee("");
      setSellPriceOv("");
      setSellFxOv("");
    }
    sellWasPending.current = sellPending;
  }, [sellPending, sellState]);
  const sellQtyN = Number(sellQtyStr);
  const sellPriceN = sellPriceOv ? Number(sellPriceOv) : currentPrice;
  const sellFxN = sellFxOv ? Number(sellFxOv) : currentFx;
  const sellFeeN = sellFee ? Number(sellFee) : 0;
  // 自行填「實收金額」時該數字已是淨額，手續費不再扣一次，否則會低估收入。
  const defaultProceeds =
    sellQtyN > 0
      ? sellQtyN * sellPriceN * sellFxN - (Number.isFinite(sellFeeN) ? sellFeeN : 0)
      : 0;
  const proceedsPreview = proceedsStr ? Number(proceedsStr) : defaultProceeds;
  const allocatedCost =
    currentQty > 0 && sellQtyN > 0 ? currentCost * (sellQtyN / currentQty) : 0;
  const realizedPnlPreview =
    Number.isFinite(proceedsPreview) && sellQtyN > 0 && sellQtyN <= currentQty
      ? proceedsPreview - allocatedCost
      : 0;

  // === 校正成本預覽 ===
  // 跟 server action 用同一支純函式，預覽的數字就是送出後會寫進去的數字。
  const [costNativeStr, setCostNativeStr] = useState("");
  const [costTwdStr, setCostTwdStr] = useState("");
  // 這兩欄是受控欄位，送出後 React 不會自動重設。不清的話預覽會留著已經寫入的數字，
  // 再按一次就多一筆相同的校正紀錄。失敗時保留輸入，讓使用者改完重送。
  const costWasPending = useRef(false);
  useEffect(() => {
    if (costWasPending.current && !costPending && costState?.ok) {
      setCostNativeStr("");
      setCostTwdStr("");
    }
    costWasPending.current = costPending;
  }, [costPending, costState]);
  const isTwdNative = nativeCurrency === "TWD";
  const costAvgFx = averageCostFx(currentCost, currentCostNative);
  const costPreview =
    costNativeStr.trim() === ""
      ? null
      : resolveCostCorrection({
          nativeCurrency,
          quantity: currentQty,
          currentCostTwd: currentCost,
          currentCostNative,
          lastFxRate: currentFx,
          costNative: Number(costNativeStr),
          costTwd: costTwdStr.trim() === "" ? null : Number(costTwdStr),
        });
  const costPreviewPnl =
    costPreview?.ok === true
      ? currentQty * currentPrice * currentFx - costPreview.costTwd
      : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* === 更新價格 === */}
      {!isManual && (
        <form action={updateAction} className="flex items-center gap-3">
          <input type="hidden" name="accountId" value={accountId} />
          <button
            type="submit"
            disabled={updatePending}
            className="btn btn-primary"
          >
            {updatePending ? "抓最新價中…" : "更新價格"}
          </button>
          {updateState?.error && (
            <span className="text-[length:var(--fs-micro)] text-[var(--c-down)]">{updateState.error}</span>
          )}
          {updateState?.ok && (
            <span className="text-[length:var(--fs-micro)] text-[var(--c-up)]">✓ {updateState.ok}</span>
          )}
        </form>
      )}

      {/* === 加碼買入 === */}
      {!isManual && (
        <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
            加碼買入（依 TWD 金額自動換算股數）
          </summary>
          <form action={addAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
            <input type="hidden" name="accountId" value={accountId} />

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              投入金額（TWD）
              <input
                name="twd"
                type="number"
                step="any"
                min="0"
                required
                value={twd}
                onChange={(e) => setTwd(e.target.value)}
                placeholder="例：50000"
                className="field"
              />
              <span className="font-normal text-[var(--c-muted)]">
                實際從戶頭扣掉的總金額，含手續費。
              </span>
            </label>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              手續費（TWD，選填）
              <input
                name="feeTwd"
                type="number"
                step="any"
                min="0"
                value={buyFee}
                onChange={(e) => setBuyFee(e.target.value)}
                placeholder="例：500"
                className="field"
              />
              <span className="font-normal text-[var(--c-muted)]">
                從投入金額中扣除後才換算股數；成本基礎仍記全額。留空 = 不記錄。
              </span>
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                成交價（{nativeCurrency}，留空 = 市價 {currentPrice || "—"}）
                <input
                  name="priceOverride"
                  type="number"
                  step="any"
                  min="0"
                  value={priceOverride}
                  onChange={(e) => setPriceOverride(e.target.value)}
                  placeholder={currentPrice ? String(currentPrice) : ""}
                  className="field"
                />
                {isBackdating && !priceOverride && (
                  <span className="border-l border-dashed border-[var(--c-annot)] pl-1.5 font-normal text-[var(--c-annot-text)]">
                    回填歷史記錄建議填寫當時成交價，否則快照將使用今日價格。
                  </span>
                )}
              </label>

              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                匯率 ({nativeCurrency}/TWD，留空 = 目前 {currentFx})
                <input
                  name="fxOverride"
                  type="number"
                  step="any"
                  min="0"
                  value={fxOverride}
                  onChange={(e) => setFxOverride(e.target.value)}
                  placeholder={String(currentFx)}
                  disabled={currentFx === 1}
                  className="field tnum disabled:text-[var(--c-faint)]"
                />
              </label>
            </div>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              加入時間（留空 = 現在）
              <input
                name="occurredAt"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="field"
              />
              {/* 補登只寫當天與今天的快照，限制說明見 docs/DESIGN_NOTES.md「已知取捨」 */}
              {isBackdating && (
                <span className="border-l border-dashed border-[var(--c-annot)] pl-1.5 font-normal text-[var(--c-annot-text)]">
                  補登只會更新當天與今天的快照，中間幾天的走勢仍是補登前的股數，可能顯示一段假的下跌。
                </span>
              )}
            </label>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              備註（選填）
              <input
                name="note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例：5/30 永豐定額"
                className="field"
              />
            </label>

            <div className="border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface-soft)] px-3.5 py-2.5 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
              預估加入股數：
              <span className="ml-1 font-semibold tnum text-[var(--c-text)]">
                {fmtShares(previewShares)}
              </span>
              <span className="mx-2 text-[var(--c-faint)]">·</span>
              加入後總持有：
              <span className="ml-1 font-semibold tnum text-[var(--c-text)]">
                {fmtShares(previewNewTotal)}
              </span>
              {buyFeeN > 0 && (
                <div className="mt-1 text-[var(--c-faint)]">
                  實際買進金額 NT$ {fmtTwd(buyInvested)}（已扣手續費 NT${" "}
                  {fmtTwd(buyFeeN)}），成本基礎仍記 NT$ {fmtTwd(twdN)}
                </div>
              )}
            </div>

            {addState?.error && (
              <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {addState.error}
              </p>
            )}
            {addState?.ok && (
              <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
                ✓ {addState.ok}
              </p>
            )}
            <button
              type="submit"
              disabled={addPending}
              className="btn btn-neutral self-start"
            >
              {addPending ? "送出中…" : "確認加碼"}
            </button>
          </form>
        </details>
      )}

      {/* === 賣出（含已實現損益計算）=== */}
      {!isManual && (
        <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
            賣出（記錄已實現損益）
          </summary>
          <form action={sellAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
            <input type="hidden" name="accountId" value={accountId} />

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              賣出股數（目前持有 {fmtShares(currentQty)}）
              <input
                name="sellQty"
                type="number"
                step="any"
                min="0"
                max={currentQty}
                required
                value={sellQtyStr}
                onChange={(e) => setSellQtyStr(e.target.value)}
                placeholder="例：0.5"
                className="field"
              />
            </label>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              實收金額（TWD，留空 = 股數 × 市價 × FX − 手續費）
              <input
                name="proceedsTwd"
                type="number"
                step="any"
                min="0"
                value={proceedsStr}
                onChange={(e) => setProceedsStr(e.target.value)}
                placeholder={defaultProceeds > 0 ? String(Math.round(defaultProceeds)) : ""}
                className="field"
              />
              <span className="font-normal text-[var(--c-muted)]">
                券商實際匯入帳戶金額（扣完手續費）。留空就用市場估算。
              </span>
            </label>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              手續費（TWD，選填）
              <input
                name="feeTwd"
                type="number"
                step="any"
                min="0"
                value={sellFee}
                onChange={(e) => setSellFee(e.target.value)}
                placeholder="例：500"
                className="field"
              />
              <span className="font-normal text-[var(--c-muted)]">
                只在「實收金額」留空時從估算值扣除；自行填實收金額時視為已扣過，僅記錄。
              </span>
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                成交價 ({nativeCurrency}, 留空 = 市價)
                <input
                  name="priceOverride"
                  type="number"
                  step="any"
                  min="0"
                  value={sellPriceOv}
                  onChange={(e) => setSellPriceOv(e.target.value)}
                  placeholder={currentPrice ? String(currentPrice) : ""}
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                匯率 (留空 = 目前 {currentFx})
                <input
                  name="fxOverride"
                  type="number"
                  step="any"
                  min="0"
                  value={sellFxOv}
                  onChange={(e) => setSellFxOv(e.target.value)}
                  placeholder={String(currentFx)}
                  disabled={currentFx === 1}
                  className="field tnum disabled:text-[var(--c-faint)]"
                />
              </label>
            </div>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              成交時間（留空 = 現在）
              <input
                name="occurredAt"
                type="datetime-local"
                className="field"
              />
            </label>

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              備註（選填）
              <input
                name="note"
                type="text"
                placeholder="例：6/15 部分獲利了結"
                className="field"
              />
            </label>

            <div className="border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface-soft)] px-3.5 py-2.5 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
              <div>
                預估實收：
                <span className="amt ml-1 font-semibold tnum text-[var(--c-text)]">
                  NT$ {fmtTwd(proceedsPreview)}
                </span>
              </div>
              <div className="mt-1">
                被賣部位的成本：
                <span className="amt ml-1 tnum text-[var(--c-text)]">
                  NT$ {fmtTwd(allocatedCost)}
                </span>
              </div>
              <div className="mt-1">
                預估已實現損益：
                <span
                  className={`amt ml-1 font-semibold tnum ${pnlClass(realizedPnlPreview)}`}
                >
                  {pnlSign(realizedPnlPreview)}NT$ {fmtTwd(Math.abs(realizedPnlPreview))}
                </span>
              </div>
            </div>

            {sellState?.error && (
              <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {sellState.error}
              </p>
            )}
            {sellState?.ok && (
              <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
                ✓ {sellState.ok}
              </p>
            )}
            <button
              type="submit"
              disabled={sellPending}
              className="btn btn-neutral self-start"
            >
              {sellPending ? "送出中…" : "確認賣出"}
            </button>
          </form>
        </details>
      )}

      {/* === 配息（非手動）=== */}
      {!isManual && (
        <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
            記錄配息
          </summary>
          <form action={divAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
            <input type="hidden" name="accountId" value={accountId} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                金額（TWD）
                <input
                  name="amount"
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="例：1200"
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                配發日（留空 = 現在）
                <input
                  name="occurredAt"
                  type="datetime-local"
                  className="field"
                />
              </label>
            </div>
            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              備註（選填）
              <input
                name="note"
                type="text"
                placeholder="例：Q2 季配"
                className="field"
              />
            </label>
            {divState?.error && (
              <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {divState.error}
              </p>
            )}
            {divState?.ok && (
              <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
                ✓ {divState.ok}
              </p>
            )}
            <button
              type="submit"
              disabled={divPending}
              className="btn btn-neutral self-start"
            >
              {divPending ? "送出中…" : "記錄配息"}
            </button>
          </form>
        </details>
      )}

      {/* === 利息（所有帳戶都可記錄）=== */}
      <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
        <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
          記錄利息
        </summary>
        <form action={intAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
          <input type="hidden" name="accountId" value={accountId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              金額（TWD）
              <input
                name="amount"
                type="number"
                step="any"
                min="0"
                required
                placeholder="例：50"
                className="field"
              />
            </label>
            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              入帳日（留空 = 現在）
              <input
                name="occurredAt"
                type="datetime-local"
                className="field"
              />
            </label>
          </div>
          <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
            備註（選填）
            <input
              name="note"
              type="text"
              placeholder="例：玉山活儲 6 月利息"
              className="field"
            />
          </label>
          {intState?.error && (
            <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
              {intState.error}
            </p>
          )}
          {intState?.ok && (
            <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
              ✓ {intState.ok}
            </p>
          )}
          <button
            type="submit"
            disabled={intPending}
            className="btn btn-neutral self-start"
          >
            {intPending ? "送出中…" : "記錄利息"}
          </button>
        </form>
      </details>

      {/* === 增減股數（覆寫總量）=== */}
      {!isManual && (
        <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
            增減股數 / 數量（直接覆寫總持有）
          </summary>
          <form action={qtyAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
            <input type="hidden" name="accountId" value={accountId} />
            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              新的持有數量（會同時重新抓價並寫入快照）
              <input
                name="quantity"
                type="number"
                step="any"
                min="0"
                required
                defaultValue={currentQty}
                className="field"
              />
              <span className="font-normal text-[var(--c-muted)]">
                注意：這只是「校正持有數」，不算真實買賣交易。要精準損益請走「賣出」。
              </span>
            </label>
            {qtyState?.error && (
              <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {qtyState.error}
              </p>
            )}
            {qtyState?.ok && (
              <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
                ✓ {qtyState.ok}
              </p>
            )}
            <button
              type="submit"
              disabled={qtyPending}
              className="btn btn-neutral self-start"
            >
              {qtyPending ? "套用中…" : "套用"}
            </button>
          </form>
        </details>
      )}

      {/* === 校正成本（只改成本基礎，不動股數與現金流）=== */}
      {!isManual && (
        <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
            校正成本（對齊券商的總成本，不改股數）
          </summary>
          <form action={costAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
            <input type="hidden" name="accountId" value={accountId} />

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              總成本（{nativeCurrency}，目前 {fmtNative(currentCostNative, isTwdNative ? 0 : 2)}）
              <input
                name="costNative"
                type="number"
                step="any"
                min="0"
                required
                value={costNativeStr}
                onChange={(e) => setCostNativeStr(e.target.value)}
                placeholder={currentCostNative > 0 ? String(currentCostNative) : ""}
                className="field"
              />
              <span className="font-normal text-[var(--c-muted)]">
                填券商顯示的總成本，不是均價。
              </span>
            </label>

            {!isTwdNative && (
              <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
                TWD 總成本（選填，目前 {fmtTwd(currentCost)}）
                <input
                  name="costTwd"
                  type="number"
                  step="any"
                  min="0"
                  value={costTwdStr}
                  onChange={(e) => setCostTwdStr(e.target.value)}
                  className="field"
                />
                <span className="font-normal text-[var(--c-muted)]">
                  {costAvgFx != null
                    ? `留空 = 沿用目前的平均成本匯率 ${fmtNative(costAvgFx, 4)} 換算。`
                    : `留空 = 用最後報價匯率 ${currentFx} 換算。`}
                </span>
              </label>
            )}

            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              備註（選填）
              <input
                name="note"
                type="text"
                maxLength={200}
                placeholder="例：依券商 9/30 庫存"
                className="field"
              />
            </label>

            <div className="border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface-soft)] px-3.5 py-2.5 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
              {costPreview?.ok === true ? (
                <>
                  校正後均價：
                  <span className="ml-1 font-semibold tnum text-[var(--c-text)]">
                    {nativeCurrency} {fmtNative(costPreview.costNative / currentQty, 6)}
                  </span>
                  <span className="mx-2 text-[var(--c-faint)]">·</span>
                  TWD 成本：
                  <span className="ml-1 font-semibold tnum text-[var(--c-text)]">
                    NT$ {fmtTwd(costPreview.costTwd)}
                  </span>
                  <span className="mx-2 text-[var(--c-faint)]">·</span>
                  未實現損益：
                  <span className={`ml-1 font-semibold tnum ${pnlClass(costPreviewPnl)}`}>
                    {pnlSign(costPreviewPnl)}NT$ {fmtTwd(Math.abs(costPreviewPnl))}
                  </span>
                </>
              ) : costPreview ? (
                costPreview.error
              ) : (
                "填入總成本後顯示校正後的均價與未實現損益。"
              )}
              <div className="mt-1 text-[var(--c-faint)]">
                只改成本，股數與現金流不動：未實現損益改從這個成本算起，XIRR 與 TWR
                仍從建立帳戶當天的市值算起。這筆紀錄不能撤銷，填錯時再校正一次。
              </div>
            </div>

            {costState?.error && (
              <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {costState.error}
              </p>
            )}
            {costState?.ok && (
              <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
                ✓ {costState.ok}
              </p>
            )}
            <button
              type="submit"
              disabled={costPending}
              className="btn btn-neutral self-start"
            >
              {costPending ? "套用中…" : "校正成本"}
            </button>
          </form>
        </details>
      )}

      {/* === 修改餘額（manual）=== */}
      {isManual && (
        <details className="border border-[var(--c-border)] bg-[var(--c-surface)]">
          <summary className="cursor-pointer select-none px-4 py-3 text-[length:var(--fs-sm)] font-medium transition-colors hover:bg-[var(--c-row-hover)]">
            修改餘額
          </summary>
          <form action={balAction} className="flex flex-col gap-3 border-t border-[var(--c-border)] p-4">
            <input type="hidden" name="accountId" value={accountId} />
            <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
              新餘額（TWD）
              <input
                name="balance"
                type="number"
                step="any"
                min="0"
                required
                defaultValue={currentBalance}
                className="field"
              />
            </label>
            {balState?.error && (
              <p className="border border-[var(--c-down)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-down)]">
                {balState.error}
              </p>
            )}
            {balState?.ok && (
              <p className="border border-[var(--c-up)] px-3 py-2 text-[length:var(--fs-sm)] text-[var(--c-up)]">
                ✓ {balState.ok}
              </p>
            )}
            <button
              type="submit"
              disabled={balPending}
              className="btn btn-neutral self-start"
            >
              {balPending ? "套用中…" : "套用"}
            </button>
          </form>
        </details>
      )}

      {/* === 歸檔 / 取消歸檔 === */}
      <form action={archAction} className="mt-2 flex items-center gap-3">
        <input type="hidden" name="accountId" value={accountId} />
        <button
          type="submit"
          disabled={archPending}
          className="btn btn-ghost btn-sm btn-fit underline disabled:opacity-50"
        >
          {archPending
            ? "處理中…"
            : isArchived
              ? "取消歸檔（恢復顯示）"
              : "歸檔此帳戶（不再抓價、不計入總值）"}
        </button>
        {archState?.error && (
          <span className="text-[length:var(--fs-micro)] text-[var(--c-down)]">{archState.error}</span>
        )}
      </form>

      {/* === 刪除 === */}
      <form action={delAction} className="flex items-center gap-3">
        <input type="hidden" name="accountId" value={accountId} />
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="btn btn-ghost btn-ghost-danger btn-sm btn-fit underline"
          >
            刪除帳戶
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-micro)]">
            <span className="text-[var(--c-down)]">
              將永久刪除此帳戶與其全部交易紀錄、每日快照，無法復原；
              歷史績效曲線也會同步失去這段資料。若只是不想在總覽看到，
              上方「封存」會保留所有紀錄。
            </span>
            <button
              type="submit"
              disabled={delPending}
              className="btn btn-danger btn-sm"
            >
              {delPending ? "刪除中…" : "我了解，永久刪除"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="btn btn-outline btn-sm"
            >
              取消
            </button>
          </div>
        )}
        {delState?.error && <span className="text-[length:var(--fs-micro)] text-[var(--c-down)]">{delState.error}</span>}
      </form>
    </div>
  );
}
