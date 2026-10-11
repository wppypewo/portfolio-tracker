"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Panel, EmptyPlot } from "@/components/survey";
import { ImportCsv } from "./ImportCsv";

export type ActRow = {
  id: string;
  type: string;
  accountId: string | null;
  accountName: string | null;
  symbol: string | null;
  market: string | null;
  qty: number | null;
  price: number | null;
  fx: number | null;
  value: number;
  amount: number | null; // cashflow_twd（有號）
  note: string | null;
  date: string; // Taipei YYYY-MM-DD
  time: string; // HH:mm Taipei
};

// 類型樣式：對應真實 DB 的 8 種 type（無 buy；加碼記為 adjust_quantity）。
// 顏色只給帶現金流意義的類型：賣出用跌色、配息與利息用漲色、新建用測量藍；
// 數量與餘額調整是中性操作，用內文色；價格更新最不重要，用 muted。
// 類型之間靠符號與文字區分，不靠顏色——原本三個寫死的 hex 色在淺色主題下對比不足。
const ACT_TYPES: Record<
  string,
  { label: string; color: string; glyph: string }
> = {
  create: { label: "新建帳戶", color: "var(--c-accent)", glyph: "✦" },
  adjust_quantity: { label: "調整數量", color: "var(--c-text)", glyph: "±" },
  adjust_balance: { label: "修改餘額", color: "var(--c-text)", glyph: "≈" },
  adjust_cost: { label: "校正成本", color: "var(--c-text)", glyph: "≡" },
  price_update: { label: "更新價格", color: "var(--c-muted)", glyph: "↻" },
  sell: { label: "賣出", color: "var(--c-down)", glyph: "↘" },
  dividend: { label: "配息", color: "var(--c-up)", glyph: "＄" },
  interest: { label: "利息", color: "var(--c-up)", glyph: "％" },
};
const TYPE_ORDER = [
  "sell",
  "dividend",
  "interest",
  "adjust_quantity",
  "adjust_balance",
  "adjust_cost",
  "price_update",
  "create",
];
const typeMeta = (t: string) =>
  ACT_TYPES[t] ?? { label: t, color: "var(--c-muted)", glyph: "•" };

const fmtTwd = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtNum = (n: number | null, max = 8) =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-US", { maximumFractionDigits: max });
const fmtAmt = (n: number) =>
  (n > 0 ? "+" : n < 0 ? "−" : "") +
  "NT$ " +
  Math.abs(Math.round(n)).toLocaleString("en-US");

function dateLabel(
  iso: string,
  today: string,
  yesterday: string,
): { big: string; sub: string } {
  // 用 Asia/Taipei 取星期，避免受瀏覽器時區影響。
  const wd = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    weekday: "short",
  }).format(new Date(iso + "T12:00:00+08:00"));
  const [, m, d] = iso.split("-");
  const base = `${Number(m)} 月 ${Number(d)} 日 · ${wd}`;
  if (iso === today) return { big: "今天", sub: base };
  if (iso === yesterday) return { big: "昨天", sub: base };
  return { big: base, sub: "" };
}

// 方角類型標記：只有外框與字，不填底色。
function TypeBadge({ type }: { type: string }) {
  const t = typeMeta(type);
  return (
    <span
      className="inline-flex items-center gap-[5px] whitespace-nowrap border px-1.5 py-px text-[length:var(--fs-micro)] font-semibold leading-5"
      style={{ color: t.color, borderColor: t.color }}
    >
      <span aria-hidden="true">{t.glyph}</span>
      {t.label}
    </span>
  );
}

function LedgerRow({
  r,
  i,
  isLast,
}: {
  r: ActRow;
  i: number;
  isLast: boolean;
}) {
  const t = typeMeta(r.type);
  const showAmt = r.amount != null && r.amount !== 0;
  return (
    <div
      className="ledger-row-in grid grid-cols-[40px_1fr] sm:grid-cols-[56px_1fr]"
      style={{ animationDelay: `${Math.min(i * 16, 120)}ms` }}
    >
      {/* 時間軸：一條髮絲線串起方形測站樁，樁框用類型色 */}
      <div className="relative flex justify-center">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--c-border)]" />
        <span
          aria-hidden="true"
          className="relative z-[1] mt-3.5 grid h-6 w-6 place-items-center border bg-[var(--c-page)] text-[length:var(--fs-micro)] font-bold sm:h-7 sm:w-7"
          style={{ color: t.color, borderColor: t.color }}
        >
          {t.glyph}
        </span>
      </div>
      <div
        className={`ml-1 py-3 ${isLast ? "" : "border-b border-[var(--c-border-soft)]"}`}
      >
        <div className="flex flex-col items-start justify-between gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-[11px] gap-y-1">
            <TypeBadge type={r.type} />
            {r.accountId ? (
              <Link
                href={`/accounts/${r.accountId}`}
                className="text-[length:var(--fs-md)] font-semibold hover:text-[var(--c-accent)]"
              >
                {r.accountName}
                {r.symbol && (
                  <span className="ml-[7px] font-mono text-[length:var(--fs-micro)] font-medium text-[var(--c-muted)]">
                    {r.symbol}
                  </span>
                )}
              </Link>
            ) : (
              <span className="text-[length:var(--fs-md)] font-semibold text-[var(--c-faint)]">
                已刪除帳戶
              </span>
            )}
          </div>
          <div className="flex w-full items-baseline justify-between gap-3.5 sm:w-auto sm:justify-end">
            {showAmt && (
              <span
                className={`amt text-[length:var(--fs-md)] font-semibold tnum ${
                  r.amount! > 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"
                }`}
              >
                {fmtAmt(r.amount!)}
              </span>
            )}
            <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">{r.time}</span>
          </div>
        </div>

        {/* 詳情欄：[label value] × N — grid 對齊（D6）*/}
        <div className="mt-2 grid w-fit grid-cols-[auto_auto] gap-x-2 gap-y-1">
          {r.market !== "manual" && r.price != null && (
            <Kv label="單價" value={fmtNum(r.price, 4)} />
          )}
          {r.qty != null && r.qty > 0 && r.market !== "manual" && (
            <Kv label="持有後" value={fmtNum(r.qty, 6)} mask />
          )}
          {r.fx != null && r.fx !== 1 && (
            <Kv label="匯率" value={fmtNum(r.fx, 2)} />
          )}
          <Kv label="市值" value={`NT$ ${fmtTwd(r.value)}`} strong mask />
        </div>

        {r.note && (
          <div className="mt-2 inline-block border-l-2 border-[var(--c-line-strong)] py-0.5 pl-2.5 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
            {r.note}
          </div>
        )}
        <Link
          href={`/decisions/new?transaction=${encodeURIComponent(r.id)}`}
          className="mt-2 flex w-fit text-[length:var(--fs-micro)] font-medium text-[var(--c-accent)] hover:underline"
        >
          連結決策日誌 →
        </Link>
      </div>
    </div>
  );
}

function Kv({
  label,
  value,
  strong,
  mask,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mask?: boolean; // 絕對金額 / 持有數量才遮；單價、匯率為公開行情
}) {
  return (
    <span className="contents">
      <i className="not-italic text-[length:var(--fs-micro)] text-[var(--c-muted)]">{label}</i>
      <b
        className={`tnum text-[length:var(--fs-micro)] ${mask ? "amt " : ""}${
          strong
            ? "font-semibold text-[var(--c-text)]"
            : "font-medium text-[var(--c-muted)]"
        }`}
      >
        {value}
      </b>
    </span>
  );
}

// 篩選鈕：方角外框，按下時換成測量藍淡底 + 藍框。數字用 Mono。
const chipBase =
  "tap-row inline-flex min-h-9 items-center gap-[7px] whitespace-nowrap border px-3 py-1.5 text-[length:var(--fs-sm)] font-medium transition-colors";
const chipOn = "border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-text)]";
const chipOff =
  "border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-muted)] hover:border-[var(--c-line-strong)] hover:text-[var(--c-text)]";

export function ActivityClient({
  rows,
  today,
  yesterday,
}: {
  rows: ActRow[];
  today: string;
  yesterday: string;
}) {
  const [active, setActive] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.type] = (c[r.type] ?? 0) + 1;
    return c;
  }, [rows]);

  const toggle = (type: string) =>
    setActive((prev) => {
      const n = new Set(prev);
      if (n.has(type)) n.delete(type);
      else n.add(type);
      return n;
    });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (active.size && !active.has(r.type)) return false;
      if (term) {
        const hay = `${r.accountName ?? ""} ${r.symbol ?? ""} ${
          typeMeta(r.type).label
        } ${r.note ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, active, q]);

  // 依日期分組（rows 已依時間倒序，連續同日歸一組）
  const groups = useMemo(() => {
    const out: { date: string; items: ActRow[] }[] = [];
    let cur: { date: string; items: ActRow[] } | null = null;
    for (const r of filtered) {
      if (!cur || cur.date !== r.date) {
        cur = { date: r.date, items: [] };
        out.push(cur);
      }
      cur.items.push(r);
    }
    return out;
  }, [filtered]);

  // 「顯示中摘要」：依目前篩選（chips/搜尋）即時彙總現金流，填寬螢幕右側欄（D5）。
  const summary = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const r of filtered) {
      const a = r.amount ?? 0;
      if (a > 0) inflow += a;
      else if (a < 0) outflow += a;
    }
    const dates = filtered.map((r) => r.date); // 已依時間倒序
    return {
      count: filtered.length,
      net: inflow + outflow,
      inflow,
      outflow,
      earliest: dates.length ? dates[dates.length - 1] : null,
      latest: dates.length ? dates[0] : null,
    };
  }, [filtered]);

  return (
    <>
      {/* 類型篩選（兼統計）*/}
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="活動類型篩選">
        <button
          type="button"
          onClick={() => setActive(new Set())}
          aria-pressed={active.size === 0}
          className={`${chipBase} ${active.size === 0 ? chipOn : chipOff}`}
        >
          全部
          <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
            {rows.length}
          </span>
        </button>
        {TYPE_ORDER.filter((t) => counts[t]).map((t) => {
          const meta = typeMeta(t);
          const on = active.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              aria-pressed={on}
              className={`${chipBase} ${on ? chipOn : chipOff}`}
            >
              <span aria-hidden="true" style={{ color: meta.color }}>
                {meta.glyph}
              </span>
              {meta.label}
              <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
                {counts[t]}
              </span>
            </button>
          );
        })}
      </div>

      {/* 工具列：搜尋 + 匯入 */}
      <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[length:var(--fs-md)] text-[var(--c-faint)]"
          >
            ⌕
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜尋活動紀錄"
            placeholder="搜尋帳戶、類型或備註…"
            className="field h-11 py-0 pl-10 pr-11 placeholder:text-[var(--c-faint)]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="清除搜尋"
              className="touch-target absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-[length:var(--fs-md)] text-[var(--c-muted)] hover:bg-[var(--c-row-hover)] hover:text-[var(--c-text)]"
            >
              ×
            </button>
          )}
        </div>
        <div className="shrink-0 sm:w-80">
          <ImportCsv />
        </div>
      </div>

      {/* 時間軸帳本 */}
      {groups.length === 0 ? (
        <EmptyPlot
          className="mt-8"
          action={
            rows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActive(new Set());
                  setQ("");
                }}
                className="btn btn-outline btn-sm"
              >
                清除篩選
              </button>
            )
          }
        >
          {rows.length === 0
            ? "還沒有任何變動。建立帳戶或執行操作後，這裡會出現記錄。"
            : "沒有符合條件的紀錄。"}
        </EmptyPlot>
      ) : (
        <div className="mt-7 flex flex-col gap-8 min-[920px]:grid min-[920px]:grid-cols-[1fr_236px] min-[920px]:items-start min-[920px]:gap-10">
          <div className="min-w-0">
          {groups.map((g) => {
            const lab = dateLabel(g.date, today, yesterday);
            const dayNet = g.items.reduce((s, r) => s + (r.amount ?? 0), 0);
            return (
              <section key={g.date} className="mb-4">
                {/* 日期列：一條 line-strong 髮絲線收邊，當作這一天的基準線 */}
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--c-line-strong)] pb-2 pt-3 sm:ml-14">
                  <div className="flex items-baseline gap-2.5 whitespace-nowrap">
                    <h2 className="font-display text-[length:var(--fs-md)] font-semibold">
                      {lab.big}
                    </h2>
                    {lab.sub && (
                      <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
                        {lab.sub}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3.5 whitespace-nowrap">
                    <span className="text-[length:var(--fs-micro)] text-[var(--c-muted)] tnum">
                      {g.items.length} 筆
                    </span>
                    {dayNet !== 0 && (
                      <span
                        className={`amt text-[length:var(--fs-micro)] font-semibold tnum ${
                          dayNet > 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"
                        }`}
                      >
                        淨現金流 {fmtAmt(dayNet)}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  {g.items.map((r, i) => (
                    <LedgerRow
                      key={r.id}
                      r={r}
                      i={i}
                      isLast={i === g.items.length - 1}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          </div>
          <SummaryRail s={summary} />
        </div>
      )}
    </>
  );
}

/* ---------- 顯示中摘要欄（依目前篩選即時彙總，填寬螢幕右側 D5）---------- */
function SummaryRail({
  s,
}: {
  s: {
    count: number;
    net: number;
    inflow: number;
    outflow: number;
    earliest: string | null;
    latest: string | null;
  };
}) {
  const period =
    s.earliest && s.latest
      ? s.earliest === s.latest
        ? s.earliest
        : `${s.earliest} – ${s.latest}`
      : "—";
  return (
    <aside className="min-[920px]:sticky min-[920px]:top-[84px]">
      <Panel title="顯示中摘要" sub="依目前篩選即時計算" flush>
        <dl className="flex flex-col px-5 py-2">
          <RailRow k="筆數" v={`${s.count} 筆`} />
          <RailRow
            k="淨現金流"
            v={fmtAmt(s.net)}
            mask
            vClass={
              s.net > 0
                ? "text-[var(--c-up)]"
                : s.net < 0
                  ? "text-[var(--c-down)]"
                  : "text-[var(--c-text)]"
            }
          />
          <RailRow
            k="流入"
            v={s.inflow > 0 ? fmtAmt(s.inflow) : "—"}
            mask={s.inflow > 0}
            vClass={s.inflow > 0 ? "text-[var(--c-up)]" : "text-[var(--c-faint)]"}
          />
          <RailRow
            k="流出"
            v={s.outflow < 0 ? fmtAmt(s.outflow) : "—"}
            mask={s.outflow < 0}
            vClass={s.outflow < 0 ? "text-[var(--c-down)]" : "text-[var(--c-faint)]"}
          />
          <RailRow k="期間" v={period} small />
        </dl>
      </Panel>
    </aside>
  );
}

function RailRow({
  k,
  v,
  vClass = "text-[var(--c-text)]",
  small,
  mask,
}: {
  k: string;
  v: string;
  vClass?: string;
  small?: boolean;
  mask?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--c-border-soft)] py-2 last:border-b-0">
      <dt className="text-[length:var(--fs-micro)] text-[var(--c-muted)]">{k}</dt>
      <dd
        className={`tnum font-medium ${mask ? "amt " : ""}${
          small ? "text-[length:var(--fs-micro)]" : "text-[length:var(--fs-sm)]"
        } ${vClass}`}
      >
        {v}
      </dd>
    </div>
  );
}
