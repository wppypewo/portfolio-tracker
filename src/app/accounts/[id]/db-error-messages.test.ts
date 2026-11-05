import { beforeEach, describe, expect, it, vi } from "vitest";

// 定期定額計畫與刪帳戶的寫入失敗時，資料庫原始訊息不回前端、log 只留 code。
// PGRST204（migration 沒跑）那條專屬訊息要保留。

const RAW = 'permission denied for table "recurring_plans"';

type Result = { data?: unknown; error: { code?: string; message: string } | null };

const accountSelect = vi.fn<() => Result>();
const planSelect = vi.fn<() => Result>();
const writeResult = vi.fn<() => Result>();

// 每張表回一個萬用鏈：select/eq/single 讀取，insert/update/delete 寫入。
function table(read: () => Result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => read(),
  };
  const write = { eq: async () => writeResult() };
  return {
    ...chain,
    insert: async () => writeResult(),
    update: () => write,
    delete: () => write,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (name: string) =>
      name === "accounts" ? table(accountSelect) : table(planSelect),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createRecurringPlan, deletePlan, togglePlan } from "./recurring-plan-actions";
import { deleteAccount } from "./lifecycle-actions";

let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  accountSelect.mockReturnValue({
    data: { id: "acc-1", price_market: "tw", status: "active", user_id: "u1" },
    error: null,
  });
  planSelect.mockReturnValue({ data: { account_id: "acc-1" }, error: null });
  writeResult.mockReturnValue({ error: { code: "42501", message: RAW } });
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

function expectHidden(r: { error?: string } | undefined) {
  expect(r?.error).toBeTruthy();
  expect(r?.error).not.toContain("permission denied");
  expect(logged()).toContain("code=42501");
  expect(logged()).not.toContain("permission denied");
}

describe("資料庫錯誤不外洩", () => {
  it("createRecurringPlan 寫入失敗", async () => {
    const r = await createRecurringPlan(
      undefined,
      fd({ accountId: "acc-1", amount: "3000", dayOfMonth: "6" }),
    );
    expectHidden(r);
    expect(r?.error).toBe("建立計畫失敗，資料未變更。請稍後再試");
  });

  it("createRecurringPlan 遇 PGRST204 仍給 migration 提示", async () => {
    writeResult.mockReturnValue({ error: { code: "PGRST204", message: "column not found" } });
    const r = await createRecurringPlan(
      undefined,
      fd({
        accountId: "acc-1",
        amount: "3000",
        dayOfMonth: "6",
        tierMode: "tier",
        // 指標預設值（同 dca-tier-config.test.ts 的 tierForm），確保會走到 insert
        tierMaLength: "200",
        tierDdPct1: "-10",
        tierDdMult1: "1.25",
        tierDdPct2: "-20",
        tierDdMult2: "1.5",
        tierDdPct3: "-30",
        tierDdMult3: "1.75",
        tierDdPct4: "-45",
        tierDdMult4: "2",
        tierUpPct1: "10",
        tierUpMult1: "0.9",
        tierUpPct2: "20",
        tierUpMult2: "0.8",
      }),
    );
    expect(writeResult).toHaveBeenCalledTimes(1);
    expect(r?.error).toContain("20260930180000_recurring_tier_config.sql");
  });

  it("togglePlan 更新失敗", async () => {
    const r = await togglePlan(undefined, fd({ planId: "p1", newActive: "false" }));
    expectHidden(r);
    expect(r?.error).toBe("更新計畫失敗，資料未變更。請重新整理後再試");
  });

  it("deletePlan 刪除失敗", async () => {
    const r = await deletePlan(undefined, fd({ planId: "p1" }));
    expectHidden(r);
    expect(r?.error).toBe("刪除計畫失敗，資料未變更。請重新整理後再試");
  });

  it("deleteAccount 刪除失敗", async () => {
    const r = await deleteAccount(undefined, fd({ accountId: "acc-1" }));
    expectHidden(r);
    expect(r?.error).toBe("刪除失敗，資料未變更。請重新整理後再試");
  });
});
