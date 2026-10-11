"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createAlert,
  deleteAlert,
  toggleAlert,
  type FormState,
} from "@/lib/alert-actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";
import { Panel, Tag, EmptyPlot } from "@/components/survey";

export type AlertAccount = {
  id: string;
  name: string;
  symbol: string | null;
  market: string;
  price: number | null;
  ccy: string;
};

export type AlertItem = {
  id: string;
  type: "price_above" | "price_below" | "allocation_drift";
  accountId: string | null;
  threshold: number;
  note: string | null;
  active: boolean;
  lastTriggered: string | null;
  accountName: string | null;
  accountSymbol: string | null;
};

type AlertType = AlertItem["type"];

const TYPES: Record<
  AlertType,
  { label: string; long: string; glyph: string; color: string; desc: string }
> = {
  price_above: {
    label: "突破上界",
    long: "價格突破上界",
    glyph: "↗",
    color: "var(--c-up)",
    desc: "價格漲到設定值時通知",
  },
  price_below: {
    label: "跌破下界",
    long: "價格跌破下界",
    glyph: "↘",
    color: "var(--c-down)",
    desc: "價格跌到設定值時通知",
  },
  allocation_drift: {
    label: "配置偏離",
    long: "配置偏離目標",
    glyph: "⊘",
    // 配置偏離不是漲跌，用測量藍，不另開一個色
    color: "var(--c-accent)",
    desc: "任一類別偏離目標過多時通知",
  },
};

const fmtPrice = (n: number, ccy: string) =>
  (ccy === "USD" ? "US$ " : "NT$ ") +
  Number(n).toLocaleString("en-US", {
    maximumFractionDigits: ccy === "USD" ? 2 : 0,
  });

/* ---------- 開關（持久化用 server action）---------- */
function Toggle({
  id,
  active,
  label,
}: {
  id: string;
  active: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    toggleAlert,
    undefined,
  );
  useActionAnnounce(state, pending, active ? "提醒已停用" : "提醒已啟用");

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button
        type="submit"
        role="switch"
        aria-checked={active}
        aria-label={`${active ? "停用" : "啟用"}${label}提醒`}
        aria-busy={pending}
        disabled={pending}
        className="touch-target grid h-11 w-11 place-items-center disabled:cursor-wait disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className={`relative h-6 w-[42px] border transition-colors ${
            active
              ? "border-[var(--c-up)] bg-[var(--c-up)]"
              : "border-[var(--c-line-strong)] bg-[var(--c-surface-soft)]"
          }`}
        >
          <span
            className={`switch-thumb absolute left-0.5 top-0.5 h-[18px] w-[18px] transition-transform ${
              active ? "translate-x-[18px] bg-[var(--c-btn-strong-text)]" : "bg-[var(--c-text)]"
            }`}
          />
        </span>
      </button>
    </form>
  );
}

function DeleteAlertControl({ id, label }: { id: string; label: string }) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousAsking = useRef(false);
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteAlert,
    undefined,
  );
  useActionAnnounce(state, pending, "提醒已刪除");

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (previousAsking.current) triggerRef.current?.focus();
    previousAsking.current = asking;
  }, [asking]);

  return (
    <div
      className="inline-confirm-shell"
      data-phase={asking ? "asking" : "idle"}
      role={asking ? "group" : undefined}
      aria-label={asking ? `確認刪除${label}提醒` : undefined}
    >
      {asking ? (
        <form action={action} className="inline-confirm-body flex w-full items-center justify-end gap-1 px-1">
          <input type="hidden" name="id" value={id} />
          <button
            type="button"
            onClick={() => setAsking(false)}
            disabled={pending}
            className="btn btn-ghost btn-sm"
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="submit"
            disabled={pending}
            className="btn btn-danger btn-sm whitespace-nowrap"
          >
            {pending ? "刪除中…" : "確認刪除"}
          </button>
        </form>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          title="刪除"
          aria-label={`刪除${label}提醒`}
          onClick={() => setAsking(true)}
          className="btn btn-ghost btn-ghost-danger btn-icon btn-lg shrink-0"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

/* ---------- 距觸發資訊 ---------- */
function triggerInfo(
  a: AlertItem,
  acc: AlertAccount | undefined,
  currentDrift: number | null,
): { closeness: number; label: string; reached: boolean } {
  if (a.type === "allocation_drift") {
    if (currentDrift == null)
      return { closeness: 0, label: "尚無配置資料", reached: false };
    const reached = currentDrift >= a.threshold;
    return {
      closeness: Math.min(1, currentDrift / a.threshold),
      label: reached ? "已超過門檻" : `目前最大偏離 ${currentDrift.toFixed(1)}%`,
      reached,
    };
  }
  const cur = acc?.price ?? null;
  if (cur == null || cur <= 0)
    return { closeness: 0, label: "等待報價", reached: false };
  if (a.type === "price_above") {
    const reached = cur >= a.threshold;
    const diff = ((a.threshold - cur) / cur) * 100;
    return {
      closeness: Math.min(1, cur / a.threshold),
      label: reached ? "已達標" : `還差 +${diff.toFixed(1)}%`,
      reached,
    };
  }
  const reached = cur <= a.threshold;
  const diff = ((cur - a.threshold) / cur) * 100;
  return {
    closeness: Math.min(1, a.threshold / cur),
    label: reached ? "已達標" : `還差 −${diff.toFixed(1)}%`,
    reached,
  };
}

/* ---------- 條件白話文 ---------- */
function ConditionText({
  type,
  acc,
  threshold,
}: {
  type: AlertType;
  acc: AlertAccount | undefined;
  threshold: string;
}) {
  const t =
    threshold === "" || threshold == null
      ? "—"
      : Number(threshold).toLocaleString("en-US");
  if (type === "allocation_drift")
    return (
      <>
        當任一類別偏離目標 <b className="font-semibold text-[var(--c-text)]">≥ {t}%</b> 時提醒我
      </>
    );
  const name = (
    <b className="font-semibold text-[var(--c-text)]">
      {acc ? acc.symbol || acc.name : "—"}
    </b>
  );
  const unit = acc ? (acc.ccy === "USD" ? "US$ " : "NT$ ") : "";
  return type === "price_above" ? (
    <>
      當 {name} 價格{" "}
      <b className="font-semibold text-[var(--c-up)]">
        ≥ {unit}
        {t}
      </b>{" "}
      時提醒我
    </>
  ) : (
    <>
      當 {name} 價格{" "}
      <b className="font-semibold text-[var(--c-down)]">
        ≤ {unit}
        {t}
      </b>{" "}
      時提醒我
    </>
  );
}

/* ---------- 新增面板 ---------- */
function CreatePanel({ accounts }: { accounts: AlertAccount[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createAlert,
    undefined,
  );
  // createAlert 的 ok 是 boolean，沒有訊息本文，成功句在這裡給。
  useActionAnnounce(state, pending, "警示已新增");
  const [type, setType] = useState<AlertType>("price_above");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const needAccount = type !== "allocation_drift";
  const acc = accounts.find((a) => a.id === accountId);

  // 成功後清空輸入（保留所選類型 / 帳戶）。
  // 用 React 官方「render 期間依結果調整 state」模式（有 guard，避免迴圈），
  // 不放 effect 內，符合 set-state-in-effect 規則。
  const [ackOk, setAckOk] = useState(false);
  if (state?.ok && !ackOk) {
    setAckOk(true);
    setThreshold("");
    setNote("");
  } else if (!state?.ok && ackOk) {
    setAckOk(false);
  }

  return (
    <form action={action}>
      {/* 三張類型卡 */}
      <input type="hidden" name="type" value={type} />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {(Object.keys(TYPES) as AlertType[]).map((k) => {
          const t = TYPES[k];
          const on = type === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setType(k)}
              aria-pressed={on}
              style={{ "--tc": t.color } as React.CSSProperties}
              // 選中：框線換成類型色並加粗成 2px（inset 陰影補 1px，不推擠版面），
              // 所以不只靠顏色分辨；底色維持 surface，不做色塊
              className={`flex flex-col items-start gap-[3px] border p-3.5 text-left transition-[border-color,box-shadow] duration-150 ${
                on
                  ? "border-[var(--tc)] bg-[var(--c-surface)] shadow-[inset_0_0_0_1px_var(--tc)]"
                  : "border-[var(--c-border)] bg-[var(--c-surface-soft)] hover:border-[var(--c-line-strong)]"
              }`}
            >
              <span
                aria-hidden="true"
                className="mb-[5px] grid h-8 w-8 place-items-center border border-current text-[length:var(--fs-lg)]"
                style={{ color: "var(--tc)" }}
              >
                {t.glyph}
              </span>
              <span className="text-[length:var(--fs-sm)] font-semibold">{t.label}</span>
              <span className="text-[length:var(--fs-micro)] leading-[1.35] text-[var(--c-muted)]">
                {t.desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* 表單 */}
      <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {needAccount && (
          <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
            <span>帳戶</span>
            <select
              name="accountId"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="field h-11 py-0"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.symbol ? ` · ${a.symbol}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)]">
          <span className="flex items-baseline gap-2">
            {needAccount ? "目標價格" : "偏離門檻（%）"}
            {needAccount && acc?.price != null && (
              <span className="font-normal text-[var(--c-accent)] tnum">
                現價 {fmtPrice(acc.price, acc.ccy)}
              </span>
            )}
          </span>
          <input
            name="threshold"
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={needAccount ? "例：200" : "例：5"}
            min="0.01"
            step="any"
            required
            className="field h-11 py-0 tnum placeholder:text-[var(--c-faint)]"
          />
        </label>
        <label
          className={`flex flex-col gap-[7px] text-[length:var(--fs-micro)] font-semibold text-[var(--c-muted)] ${needAccount ? "sm:col-span-2" : ""}`}
        >
          <span>備註（選填）</span>
          <input
            name="note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：等回檔加碼"
            className="field h-11 py-0 placeholder:text-[var(--c-faint)]"
          />
        </label>
      </div>

      {/* 即時白話預覽 */}
      <div className="mt-4 flex items-center gap-2.5 border border-dashed border-[var(--c-line-strong)] bg-[var(--c-surface-soft)] px-4 py-3 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
        <span aria-hidden="true" style={{ color: TYPES[type].color }}>
          {TYPES[type].glyph}
        </span>
        <ConditionText type={type} acc={acc} threshold={threshold} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3.5">
        <button
          type="submit"
          disabled={pending || !threshold}
          className="btn btn-primary"
        >
          {pending ? "建立中…" : "＋ 建立提醒"}
        </button>
        {state?.ok && (
          <span className="text-[length:var(--fs-sm)] font-semibold text-[var(--c-up)]">
            ✓ 已新增
          </span>
        )}
        {state?.error && (
          <span className="text-[length:var(--fs-sm)] text-[var(--c-down)]">{state.error}</span>
        )}
        <span className="ml-auto text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          每日抓價後檢查（台北 14:00）· 價格提醒觸發一次後自動停用
        </span>
      </div>
    </form>
  );
}

/* ---------- 警示卡 ---------- */
function AlertCard({
  a,
  accounts,
  currentDrift,
}: {
  a: AlertItem;
  accounts: AlertAccount[];
  currentDrift: number | null;
}) {
  const t = TYPES[a.type];
  const acc = a.accountId
    ? accounts.find((x) => x.id === a.accountId)
    : undefined;
  const info = triggerInfo(a, acc, currentDrift);
  const unit = acc ? (acc.ccy === "USD" ? "US$ " : "NT$ ") : "";
  const accLabel = acc
    ? acc.symbol || acc.name
    : a.accountSymbol || a.accountName || "—";

  return (
    // 帳本列：列與列之間一條 border-soft，Panel 外框收邊。
    // 停用列不再整列降透明度（降完內文對比掉到 4.5:1 以下），
    // 改成圖示轉灰＋右側「已停用」標記
    <div className="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-[var(--c-border-soft)] px-5 py-4 first:border-t-0 sm:grid-cols-[auto_1fr_auto] sm:gap-4">
      <span
        aria-hidden="true"
        className="grid h-10 w-10 place-items-center border border-current text-[length:var(--fs-lg)]"
        style={{ color: a.active ? t.color : "var(--c-faint)" }}
      >
        {t.glyph}
      </span>

      <div className="min-w-0">
        <div className="flex flex-col items-start justify-between gap-[3px] sm:flex-row sm:items-baseline sm:gap-3">
          <span className="text-[length:var(--fs-md)] font-medium tnum">
            {a.type === "allocation_drift" ? (
              <>
                任一類別偏離目標{" "}
                <b className="font-bold">≥ {a.threshold}%</b>
              </>
            ) : (
              <>
                {accLabel} {a.type === "price_above" ? "≥" : "≤"}{" "}
                <b className="font-bold">
                  {unit}
                  {Number(a.threshold).toLocaleString("en-US")}
                </b>
              </>
            )}
          </span>
          <span
            className="whitespace-nowrap text-[length:var(--fs-micro)] font-semibold"
            style={{ color: a.active ? t.color : "var(--c-muted)" }}
          >
            {t.long}
          </span>
        </div>

        {/* 距觸發進度條 */}
        <div className="mt-2.5 flex items-center gap-[11px]">
          {/* 刻度尺：底軌是髮絲框，填充用 scaleX 而不是 width，只動 transform */}
          <div className="h-1.5 flex-1 overflow-hidden border border-[var(--c-border)] bg-[var(--c-surface-soft)]">
            <span
              className="motion-progress block h-full w-full origin-left transition-transform duration-300 ease-out"
              style={{
                transform: `scaleX(${info.closeness.toFixed(3)})`,
                background: info.reached ? t.color : "var(--c-line-strong)",
              }}
            />
          </div>
          <span
            className={`whitespace-nowrap text-[length:var(--fs-micro)] tnum ${
              info.reached ? "font-semibold" : "text-[var(--c-muted)]"
            }`}
            style={info.reached ? { color: t.color } : {}}
          >
            {info.label}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          {acc?.price != null && (
            <span className="tnum">現價 {fmtPrice(acc.price, acc.ccy)}</span>
          )}
          {a.note && <span>· {a.note}</span>}
          {a.lastTriggered && (
            <span>
              · 上次觸發{" "}
              {new Date(a.lastTriggered).toLocaleDateString("en-CA")}
            </span>
          )}
        </div>
      </div>

      <div className="col-start-2 flex items-center justify-end gap-2 sm:col-start-3">
        {!a.active && <Tag>已停用</Tag>}
        <Toggle id={a.id} active={a.active} label={accLabel} />
        <DeleteAlertControl id={a.id} label={accLabel} />
      </div>
    </div>
  );
}

/* 全站唯一一顆彩色 emoji 原本在這裡。emoji 的字形由作業系統決定，
   顏色不吃 currentColor，hover 變紅時只有外框跟著變、圖示本身不變，
   而且各平台長得不一樣。改成跟 AppHeader 同一套 inline SVG。 */
function TrashIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M10 4h4" />
      <path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/* ---------- 列表標題 ---------- */
function ListHead({
  on,
  label,
  count,
}: {
  on: boolean;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--c-line-strong)] pb-2 text-[length:var(--fs-sm)] font-semibold">
      <span
        aria-hidden="true"
        className={`h-2 w-2 ${on ? "bg-[var(--c-up)]" : "border border-[var(--c-faint)]"}`}
      />
      <span className={on ? "" : "text-[var(--c-muted)]"}>{label}</span>
      <span className="font-mono text-[length:var(--fs-micro)] font-normal text-[var(--c-muted)] tnum">
        {count}
      </span>
    </div>
  );
}

/* ---------- 組合 ---------- */
export function AlertsClient({
  accounts,
  alerts,
  currentDrift,
}: {
  accounts: AlertAccount[];
  alerts: AlertItem[];
  currentDrift: number | null;
}) {
  const active = alerts.filter((a) => a.active);
  const paused = alerts.filter((a) => !a.active);

  return (
    <div className="flex flex-col gap-8">
      <Panel title="新增提醒">
        <CreatePanel accounts={accounts} />
      </Panel>

      <section>
        <ListHead on label="啟用中" count={active.length} />
        {active.length === 0 ? (
          <EmptyPlot compact className="mt-3">
            目前沒有啟用中的提醒。上方選一種類型、填門檻就能建立。
          </EmptyPlot>
        ) : (
          <div className="mt-3 border border-[var(--c-border)] bg-[var(--c-surface)]">
            {active.map((a) => (
              <AlertCard
                key={a.id}
                a={a}
                accounts={accounts}
                currentDrift={currentDrift}
              />
            ))}
          </div>
        )}
      </section>

      {paused.length > 0 && (
        <section>
          <ListHead on={false} label="已停用" count={paused.length} />
          <div className="mt-3 border border-[var(--c-border)] bg-[var(--c-surface)]">
            {paused.map((a) => (
              <AlertCard
                key={a.id}
                a={a}
                accounts={accounts}
                currentDrift={currentDrift}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
