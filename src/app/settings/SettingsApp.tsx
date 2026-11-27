"use client";

import Link from "next/link";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  setThemePref,
  useThemePref,
  type ThemePref,
} from "@/components/ThemeToggle";
import {
  setAllocationTargets,
  setConcentrationLimit,
  type FormState as AllocFormState,
} from "@/lib/profile-actions";
import { useActionAnnounce } from "@/components/a11y/use-action-announce";
import { Tag } from "@/components/survey";
import { MfaSetupCard } from "./MfaSetupCard";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { fmtUpdatedAt } from "@/lib/format";
import type { PriceHealth } from "@/lib/price-health";

/* ============================================================
 * Settings 主應用：6 個 section + sticky scroll-spy 側欄
 * 用 callback ref pattern 收集每個 section 的 element 給 scroll-spy 用，
 * 避免 React 19 「render 中 access ref」lint 警告。
 * ============================================================ */

const NAV = [
  { id: "account", label: "帳號" },
  { id: "prefs", label: "偏好" },
  { id: "alloc", label: "配置目標" },
  { id: "security", label: "安全" },
  { id: "notif", label: "通知" },
  { id: "data", label: "資料與匯出" },
] as const;
type NavId = (typeof NAV)[number]["id"];

// 5 個常用資產類別。色值一律引用 globals.css 的 --c-alloc-* token，
// 與儀表板圓環共用同一組定義：先前這裡各自寫死 hex，crypto 甚至是紫色
// (#C58BD6)，與圓環的棕色對不起來，同一個類別在兩頁顯示不同顏色。
const ALLOC_DEFS: { cls: string; label: string; color: string }[] = [
  { cls: "stock", label: "股票", color: "var(--c-accent)" },
  { cls: "fund", label: "基金", color: "var(--c-alloc-fund)" },
  { cls: "crypto", label: "加密貨幣", color: "var(--c-alloc-crypto)" },
  { cls: "precious_metal", label: "貴金屬", color: "var(--c-alloc-metal)" },
  { cls: "liquid_cash", label: "流動資金", color: "var(--c-alloc-cash)" },
];

export type SettingsAppProps = {
  user: { email: string | null; createdAt: string | null };
  isAdmin: boolean;
  initialTargets: Record<string, number>;
  initialConcentrationLimitPct: number;
  priceHealth: PriceHealth;
};

export function SettingsApp({
  user,
  isAdmin,
  initialTargets,
  initialConcentrationLimitPct,
  priceHealth,
}: SettingsAppProps) {
  // 用 ref 收集每個 section 的 DOM element 給 scroll-spy 用。
  // registerEl 包成穩定 callback 才不會被 react-hooks/refs 視作 render-time access。
  const elsRef = useRef<Partial<Record<NavId, HTMLElement | null>>>({});
  const [active, setActive] = useState<NavId>("account");

  const registerEl = useCallback(
    (id: NavId) => (el: HTMLElement | null) => {
      elsRef.current[id] = el;
    },
    [],
  );

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY + 120;
      let cur: NavId = "account";
      for (const n of NAV) {
        const el = elsRef.current[n.id];
        if (el && el.offsetTop <= y) cur = n.id;
      }
      setActive(cur);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const jump = useCallback((id: NavId) => {
    const el = elsRef.current[id];
    if (el) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      window.scrollTo({
        top: el.offsetTop - 84,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr] md:gap-7">
      {/* 側欄 nav */}
      <aside className="md:sticky md:top-20 md:self-start">
        {/* 桌機是一條測站清單：左側 2px 測量藍指示目前所在區段；
            手機收成可換行的方塊，改用外框表示。編號與主體的區段編號一致。 */}
        <nav aria-label="設定區段" className="flex flex-row flex-wrap gap-1.5 md:flex-col md:gap-0 md:border-l md:border-[var(--c-border)]">
          {NAV.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => jump(n.id)}
              aria-current={active === n.id ? "location" : undefined}
              className={`tap-row flex min-h-11 items-center gap-2.5 border px-3 text-left text-[length:var(--fs-sm)] font-medium transition-colors md:border-transparent ${
                active === n.id
                  ? "border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)] md:-ml-px md:shadow-[inset_2px_0_0_var(--c-accent)]"
                  : "border-[var(--c-border)] text-[var(--c-muted)] hover:bg-[var(--c-surface-soft)] hover:text-[var(--c-text)]"
              }`}
            >
              <span aria-hidden="true" className="font-mono text-[length:var(--fs-micro)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              {n.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* 主體 6 個 section */}
      <div className="flex min-w-0 flex-col border border-[var(--c-border)] bg-[var(--c-surface)] p-5 sm:p-7">
        <Section id="account" title="帳號" elRef={registerEl("account")}>
          <AccountInner user={user} />
        </Section>
        <Section
          id="prefs"
          title="偏好"
          desc="外觀與顯示方式，僅影響此裝置。"
          elRef={registerEl("prefs")}
        >
          <PrefsInner />
        </Section>
        <Section
          id="alloc"
          title="配置目標"
          desc="設定各資產類別的目標占比，儀表板會以此標示偏離。"
          elRef={registerEl("alloc")}
        >
          <AllocInner
            initialTargets={initialTargets}
            initialConcentrationLimitPct={initialConcentrationLimitPct}
          />
        </Section>
        <Section
          id="security"
          title="安全"
          desc="保護登入，防止未授權存取。"
          elRef={registerEl("security")}
        >
          <MfaSetupCard />
        </Section>
        <Section
          id="notif"
          title="通知"
          desc="站內警示已啟用；外部通知管道會在完成串接後開放。"
          elRef={registerEl("notif")}
        >
          <NotifInner isAdmin={isAdmin} />
        </Section>
        <Section
          id="data"
          title="資料與匯出"
          desc="下載報表或備份資料。"
          elRef={registerEl("data")}
        >
          <PriceHealthInner health={priceHealth} />
          <DataInner email={user.email} />
        </Section>
        <p className="mt-10 border-t border-[var(--c-border-soft)] pt-5 text-[length:var(--fs-micro)] text-[var(--c-muted)]">
          StackWorth · 以 TWD 為基準幣別
        </p>
      </div>
    </div>
  );
}

/* ---------- 報價健康 ---------- */

function PriceHealthInner({ health }: { health: PriceHealth }) {
  const ok = health.staleAccounts.length === 0 && health.lastPricedAt !== null;
  const none = health.tracked === 0;
  return (
    <div
      className={`mb-5 border px-4 py-3 text-[length:var(--fs-sm)] ${
        none || ok
          ? "border-[var(--c-border)] bg-[var(--c-surface-soft)]"
          : "border-[var(--c-down)] bg-[var(--c-surface)]"
      }`}
    >
      {/* 狀態用字標出來，不只靠顏色 */}
      <div className="flex flex-wrap items-center gap-2 font-medium">
        報價更新狀態
        {none ? (
          <Tag>無追蹤帳戶</Tag>
        ) : ok ? (
          <Tag tone="up">正常</Tag>
        ) : (
          <Tag tone="down">有延遲</Tag>
        )}
      </div>
      <p className="mt-1 text-[var(--c-muted)]">
        {none
          ? "目前沒有追蹤市價的帳戶。"
          : `追蹤 ${health.tracked} 個帳戶 · 最後成功更新 ${
              health.lastPricedAt ? fmtUpdatedAt(health.lastPricedAt) : "—"
            }`}
      </p>
      {!none && health.staleAccounts.length > 0 && (
        <p className="mt-1 text-[var(--c-down)]">
          {health.staleAccounts.join("、")} 超過 36
          小時未更新——排程可能漏跑，快照斷檔會讓日漲跌與 TWR 失真。
          可回總覽按手動刷新補一筆。
        </p>
      )}
    </div>
  );
}

/* ============================================================
 * Section wrapper（用 callback ref，不用 forwardRef）
 * ============================================================ */

function Section({
  id,
  title,
  desc,
  elRef,
  children,
}: {
  id: string;
  title: string;
  desc?: string;
  elRef: (el: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      ref={elRef}
      id={id}
      style={{ scrollMarginTop: 84 }}
      className="mt-10 border-t border-[var(--c-line-strong)] pt-6 first:mt-0 first:border-t-0 first:pt-0"
    >
      <div className="mb-4">
        <h2 className="flex items-baseline gap-2.5 text-[length:var(--fs-lg)] font-medium text-[var(--c-text)]">
          <span aria-hidden="true" className="font-mono text-[length:var(--fs-micro)] font-medium text-[var(--c-accent)]">
            {String(NAV.findIndex((n) => n.id === id) + 1).padStart(2, "0")}
          </span>
          {title}
        </h2>
        {desc && (
          <p className="mt-1 text-[length:var(--fs-sm)] text-[var(--c-muted)]">{desc}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--c-border-soft)] py-3 first-of-type:border-t-0">
      <div className="min-w-0">
        <span className="text-[length:var(--fs-md)] font-medium text-[var(--c-text)]">
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-[length:var(--fs-micro)] text-[var(--c-muted)]">
            {hint}
          </span>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    // 選中的那格：測量藍淡底加底邊 2px，不只靠底色分辨
    <div className="inline-flex border border-[var(--c-border)] bg-[var(--c-surface-soft)]">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`tap-row min-h-10 whitespace-nowrap border-l border-[var(--c-border)] px-4 text-[length:var(--fs-sm)] font-medium transition-colors first:border-l-0 ${
            value === o.v
              ? "bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[inset_0_-2px_0_var(--c-accent)]"
              : "text-[var(--c-muted)] hover:bg-[var(--c-surface)] hover:text-[var(--c-text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ============================================================
 * 1. Account
 * ============================================================ */

function AccountInner({ user }: { user: SettingsAppProps["user"] }) {
  const initials = getInitials(user.email);
  return (
    <>
      <div className="flex items-center gap-4 pb-4">
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center border border-[var(--c-line-strong)] bg-[var(--c-accent-soft)] font-mono text-[length:var(--fs-lg)] font-semibold text-[var(--c-accent)]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[length:var(--fs-md)] font-medium">
            {user.email?.split("@")[0] ?? "—"}
          </div>
          <div className="mt-0.5 truncate text-[length:var(--fs-sm)] text-[var(--c-muted)]">
            {user.email ?? "—"}
          </div>
        </div>
        <Tag tone="accent">個人版</Tag>
      </div>
      {user.createdAt && (
        <Row label="加入時間" hint="首次建立帳戶">
          <span className="tnum text-[length:var(--fs-sm)] text-[var(--c-muted)]">
            {user.createdAt.slice(0, 7)}
          </span>
        </Row>
      )}
      <Row label="登出" hint="結束目前的工作階段">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="btn btn-outline whitespace-nowrap"
          >
            登出
          </button>
        </form>
      </Row>
    </>
  );
}

/* ============================================================
 * 2. Preferences
 * ============================================================ */

function PrefsInner() {
  const pref = useThemePref() ?? "system";

  return (
    <>
      <Row label="外觀主題">
        <Segmented<ThemePref>
          value={pref}
          onChange={(v) => setThemePref(v)}
          options={[
            { v: "light", label: "淺色" },
            { v: "dark", label: "深色" },
            { v: "system", label: "跟隨系統" },
          ]}
        />
      </Row>
      <Row
        label="基準幣別"
        hint="目前所有估值、損益與匯出皆以新台幣計算"
      >
        <Tag>固定 TWD</Tag>
      </Row>
      <Row
        label="數字格式"
        hint="明細保留完整金額；圖表與小空間自動使用萬／億"
      >
        <Tag>依情境自動</Tag>
      </Row>
    </>
  );
}

/* ============================================================
 * 3. Allocation targets
 * ============================================================ */

function AllocInner({
  initialTargets,
  initialConcentrationLimitPct,
}: {
  initialTargets: Record<string, number>;
  initialConcentrationLimitPct: number;
}) {
  const initial = useMemo(() => {
    const out: Record<string, number> = {};
    for (const def of ALLOC_DEFS) {
      out[def.cls] = Number(initialTargets[def.cls] ?? 0);
    }
    return out;
  }, [initialTargets]);

  const [targets, setTargets] = useState<Record<string, number>>(initial);
  const [savedTick, setSavedTick] = useState(false);
  const sum = Object.values(targets).reduce((a, b) => a + Number(b || 0), 0);
  const ok = Math.round(sum) === 100;

  const [state, action, pending] = useActionState<AllocFormState, FormData>(
    setAllocationTargets,
    undefined,
  );
  // 成功時畫面只是靜靜地存好，沒有任何訊息，所以補一句。
  useActionAnnounce(state, pending, "配置目標已儲存");

  function update(cls: string, v: string) {
    const n = v === "" ? 0 : Math.max(0, Math.min(100, Number(v)));
    setTargets((p) => ({ ...p, [cls]: n }));
    setSavedTick(false);
  }

  function reset() {
    setTargets(initial);
    setSavedTick(false);
  }

  return (
    <>
    <form
      action={(fd: FormData) => {
        for (const def of ALLOC_DEFS) {
          fd.set(`target_${def.cls}`, String(targets[def.cls] ?? 0));
        }
        action(fd);
        setSavedTick(true);
      }}
      className="flex flex-col gap-3"
    >
      {ALLOC_DEFS.map((def) => (
        <div
          key={def.cls}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:grid-cols-[auto_80px_1fr_auto]"
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5"
            style={{ background: def.color }}
          />
          <span className="text-[length:var(--fs-sm)] text-[var(--c-text)]">{def.label}</span>
          {/* 比例尺：外框是 100%，填色用 scaleX 伸縮（只動 transform） */}
          <span aria-hidden="true" className="hidden h-2 overflow-hidden border border-[var(--c-border)] sm:block">
            <span
              className="motion-progress block h-full w-full origin-left transition-transform"
              style={{
                transform: `scaleX(${Math.min(100, targets[def.cls] ?? 0) / 100})`,
                background: def.color,
              }}
            />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
            <input
              type="number"
              aria-label={`${def.label}目標配置百分比`}
              min={0}
              max={100}
              value={targets[def.cls] ?? 0}
              onChange={(e) => update(def.cls, e.target.value)}
              className="field tnum h-11 w-[72px] py-0 text-right font-semibold"
            />
            %
          </span>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--c-border-soft)] pt-4">
        <span
          className={`text-[length:var(--fs-sm)] ${
            ok ? "text-[var(--c-up)]" : "text-[var(--c-down)]"
          }`}
        >
          合計 <b className="tnum font-semibold">{Math.round(sum)}%</b>
          {ok
            ? " ✓"
            : `（需為 100%，差 ${
                100 - Math.round(sum) > 0 ? "+" : ""
              }${100 - Math.round(sum)}）`}
        </span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="btn btn-outline whitespace-nowrap"
          >
            還原
          </button>
          <button
            type="submit"
            disabled={!ok || pending}
            className="btn btn-primary whitespace-nowrap"
          >
            {pending ? "儲存中…" : "儲存目標"}
          </button>
          {savedTick && !pending && !state?.error && (
            <span className="text-[length:var(--fs-sm)] font-medium text-[var(--c-up)]">
              ✓ 已儲存
            </span>
          )}
          {state?.error && (
            <span className="text-[length:var(--fs-micro)] text-[var(--c-down)]">
              {state.error}
            </span>
          )}
        </div>
      </div>
    </form>
    <ConcentrationLimitForm initialValue={initialConcentrationLimitPct} />
    </>
  );
}

function ConcentrationLimitForm({ initialValue }: { initialValue: number }) {
  const [saved, setSaved] = useState(false);
  const [state, action, pending] = useActionState<AllocFormState, FormData>(
    setConcentrationLimit,
    undefined,
  );
  useActionAnnounce(state, pending, "集中度上限已儲存");
  return (
    <form
      action={(formData) => {
        setSaved(true);
        action(formData);
      }}
      className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-[var(--c-border-soft)] pt-5"
    >
      <label className="text-[length:var(--fs-md)] font-medium">
        單一持倉集中度上限
        <span className="mt-0.5 block text-[length:var(--fs-micro)] font-normal text-[var(--c-muted)]">
          anti-FOMO 檢核會以此門檻標示買後權重。
        </span>
        <span className="mt-2 inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-[var(--c-muted)]">
          <input
            type="number"
            name="concentrationLimitPct"
            min={0.1}
            max={100}
            step={0.1}
            defaultValue={initialValue}
            className="field tnum h-11 w-[88px] py-0 text-right font-semibold"
          />
          %
        </span>
      </label>
      <div className="flex items-center gap-2">
        {state?.error && <span className="text-[length:var(--fs-micro)] text-[var(--c-down)]">{state.error}</span>}
        {saved && !pending && !state?.error && <span className="text-[length:var(--fs-micro)] font-medium text-[var(--c-up)]">✓ 已儲存</span>}
        <button type="submit" disabled={pending} className="btn btn-outline">
          {pending ? "儲存中…" : "儲存上限"}
        </button>
      </div>
    </form>
  );
}

/* ============================================================
 * 5. Notifications
 * ============================================================ */

function NotifInner({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      <Row label="站內通知" hint="警示觸發後寫入通知中心">
        <Tag tone="up">已啟用</Tag>
      </Row>
      <Row label="Email 通知" hint="尚未串接寄信服務">
        <Tag>尚未開放</Tag>
      </Row>
      <Row label="瀏覽器推播" hint="尚未串接推播服務">
        <Tag>尚未開放</Tag>
      </Row>
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <LinkCard href="/alerts" label="警示設定" />
        <LinkCard href="/notifications" label="通知中心" />
        {isAdmin && (
          <LinkCard href="/admin/allowlist" label="使用者管理（admin）" />
        )}
        {isAdmin && <LinkCard href="/admin/news" label="持股新聞（admin）" />}
      </div>
    </>
  );
}

function LinkCard({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-11 items-center justify-between border border-[var(--c-border)] bg-[var(--c-surface-soft)] px-4 py-3 text-[length:var(--fs-sm)] font-medium text-[var(--c-text)] transition-colors hover:border-[var(--c-line-strong)] hover:text-[var(--c-accent)]"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[var(--c-muted)] group-hover:text-[var(--c-accent)]">
        →
      </span>
    </Link>
  );
}

/* ============================================================
 * 6. Data & export
 * ============================================================ */

function DataInner({ email }: { email: string | null }) {
  const yr = new Date().getFullYear();
  return (
    <>
      <Row
        label="年度稅務報表"
        hint="賣出 / 配息 / 利息整理成 CSV，供海外所得申報參考"
      >
        <form
          action="/api/export/tax-csv"
          method="GET"
          className="flex items-center gap-2.5"
        >
          <select
            name="year"
            aria-label="稅務報表年度"
            defaultValue={yr}
            className="field tnum h-11 w-auto py-0"
          >
            {Array.from({ length: 5 }, (_, i) => yr - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-outline whitespace-nowrap"
          >
            ⤓ 下載 CSV
          </button>
        </form>
      </Row>
      <Row label="匯出全部資料" hint="所有帳戶與交易紀錄（CSV）">
        <a
          href="/api/export/csv"
          download
          className="btn btn-outline whitespace-nowrap"
        >
          ⤓ 匯出
        </a>
      </Row>
      <DeleteAccountSection email={email} />
    </>
  );
}

/* ============================================================
 * helpers
 * ============================================================ */

function getInitials(email: string | null): string {
  if (!email) return "··";
  const at = email.indexOf("@");
  const name = at > 0 ? email.slice(0, at) : email;
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
