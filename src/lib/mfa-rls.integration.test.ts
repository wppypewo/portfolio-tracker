import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetAndApply } from "./integration-test-db";

// migration 20261023220000_mfa_aal2_rls 的整合測試：已綁 MFA 的帳號拿 aal1 的 JWT
// 直接打資料庫（等同繞過 proxy 打 PostgREST）時，所有有 RLS 的表都要讀不到、寫不進。
// 執行方式與其他 integration test 相同，見 account-mutation.integration.test.ts 開頭。

const url = process.env.TEST_DATABASE_URL;
const root = join(__dirname, "..", "..");

const MFA_USER = "22222222-2222-2222-2222-222222222222"; // 有 verified factor
const PLAIN_USER = "33333333-3333-3333-3333-333333333333"; // 沒有 factor
const HALF_USER = "44444444-4444-4444-4444-444444444444"; // 只有 unverified factor（設定到一半）
const MFA_ACC = "11111111-1111-1111-1111-111111111111";
const PLAIN_ACC = "55555555-5555-5555-5555-555555555555";
const HALF_ACC = "66666666-6666-6666-6666-666666666666";

// migration 要保護的表；與 migration 裡的清單一致，下面的結構測試會比對兩邊。
const PROTECTED_TABLES = [
  "account_snapshots",
  "account_status_history",
  "accounts",
  "alerts",
  "api_usage",
  "decision_reviews",
  "investment_decisions",
  "notifications",
  "profiles",
  "recurring_plan_runs",
  "recurring_plans",
  "transactions",
];

// test-schema.sql 沒有正式 schema.sql／recurring-plans.sql 的 RLS，這裡照抄補上，
// 讓 restrictive policy 有 permissive policy 可以 AND。
// grant 對應 Supabase 預設把 public 表權限給 authenticated。
const BASE_RLS = `
  alter table profiles enable row level security;
  alter table accounts enable row level security;
  alter table transactions enable row level security;
  alter table account_snapshots enable row level security;
  alter table recurring_plans enable row level security;
  create policy "own profile" on profiles
    for all using (auth.uid() = id) with check (auth.uid() = id);
  create policy "own accounts" on accounts
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy "own transactions" on transactions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy "own snapshots" on account_snapshots
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy "own recurring plans" on recurring_plans
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  grant select, insert, update, delete on all tables in schema public to authenticated;
`;

type Aal = "aal1" | "aal2" | null;

describe.skipIf(!url)("MFA aal2 restrictive RLS (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await resetAndApply(db, root, [
      "supabase/test-schema.sql",
      "supabase/rpc-mutations.sql",
      "supabase/alerts.sql",
      "supabase/migrations/20260718032234_stackworth_v1.sql",
      "supabase/migrations/20260810230000_transaction_fee.sql",
      "supabase/migrations/20260811120000_api_budget.sql",
      "supabase/migrations/20261023220000_mfa_aal2_rls.sql",
    ]);
    await db.query(BASE_RLS);
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(
      "truncate notifications, alerts, account_snapshots, transactions, accounts, profiles, auth.mfa_factors, auth.users cascade",
    );
    await db.query(
      `insert into auth.users (id, email) values
         ($1, 'mfa@example.com'), ($2, 'plain@example.com'), ($3, 'half@example.com')`,
      [MFA_USER, PLAIN_USER, HALF_USER],
    );
    await db.query("insert into profiles (id) values ($1), ($2), ($3)", [
      MFA_USER,
      PLAIN_USER,
      HALF_USER,
    ]);
    await db.query(
      `insert into accounts (id, user_id, name, asset_class, quantity) values
         ($1, $2, 'MFA 帳戶', 'fund', 10),
         ($3, $4, '一般帳戶', 'fund', 10),
         ($5, $6, '設定中帳戶', 'fund', 10)`,
      [MFA_ACC, MFA_USER, PLAIN_ACC, PLAIN_USER, HALF_ACC, HALF_USER],
    );
    await db.query(
      `insert into alerts (user_id, type, account_id, threshold) values ($1, 'price_above', $2, 100)`,
      [MFA_USER, MFA_ACC],
    );
    await db.query(
      `insert into auth.mfa_factors (user_id, status) values ($1, 'verified'), ($2, 'unverified')`,
      [MFA_USER, HALF_USER],
    );
  });

  // 模擬 PostgREST：切到 authenticated、帶上 JWT claims，結束一律 rollback。
  // aal 為 null 代表 claims 裡沒有 aal 欄位。
  async function asUser<T>(userId: string, aal: Aal, fn: () => Promise<T>): Promise<T> {
    const claims: Record<string, string> = { sub: userId, role: "authenticated" };
    if (aal) claims.aal = aal;
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      return await fn();
    } finally {
      await db.query("rollback");
    }
  }

  const ids = async (sql: string) => (await db.query(sql)).rows.map((row) => row.id);

  it("每張有 RLS 的 public 表都有 restrictive 的 mfa_required，涵蓋所有指令", async () => {
    const { rows } = await db.query(
      `select c.relname as table_name,
              pol.permissive,
              array_to_string(pol.roles, ',') as roles,
              pol.cmd,
              pol.qual,
              pol.with_check
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_policies pol
         on pol.schemaname = 'public' and pol.tablename = c.relname and pol.policyname = 'mfa_required'
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       order by c.relname`,
    );
    // 新增有 RLS 的表卻沒進 migration 清單時，這裡會紅
    expect(rows.map((row) => row.table_name)).toEqual(PROTECTED_TABLES);
    for (const row of rows) {
      expect(row.permissive, row.table_name).toBe("RESTRICTIVE");
      expect(row.roles, row.table_name).toBe("authenticated");
      expect(row.cmd, row.table_name).toBe("ALL");
      expect(row.qual, row.table_name).toContain("mfa_satisfied()");
      expect(row.with_check, row.table_name).toContain("mfa_satisfied()");
    }
  });

  it("已綁 MFA、aal1：讀不到自己的帳戶、設定與警示", async () => {
    await asUser(MFA_USER, "aal1", async () => {
      expect(await ids("select id from accounts")).toEqual([]);
      expect(await ids("select id from profiles")).toEqual([]);
      expect(await ids("select id from alerts")).toEqual([]);
    });
  });

  it("已綁 MFA、claims 沒有 aal：視同 aal1", async () => {
    await asUser(MFA_USER, null, async () => {
      expect(await ids("select id from accounts")).toEqual([]);
    });
  });

  it("已綁 MFA、aal1：update 影響 0 列，資料不變", async () => {
    await asUser(MFA_USER, "aal1", async () => {
      const updated = await db.query("update accounts set name = '被改掉' where id = $1", [MFA_ACC]);
      expect(updated.rowCount).toBe(0);
    });
    const { rows } = await db.query("select name from accounts where id = $1", [MFA_ACC]);
    expect(rows[0].name).toBe("MFA 帳戶");
  });

  it("已綁 MFA、aal1：insert 被 RLS 拒絕", async () => {
    await asUser(MFA_USER, "aal1", async () => {
      await expect(
        db.query("insert into notifications (user_id, type, title) values ($1, 'system', 'x')", [
          MFA_USER,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("已綁 MFA、aal1：security invoker 的 RPC 也碰不到自己的帳戶", async () => {
    await asUser(MFA_USER, "aal1", async () => {
      await expect(
        db.query("select apply_account_mutation($1, $2, null, '[]')", [
          MFA_ACC,
          JSON.stringify({ quantity: 99 }),
        ]),
      ).rejects.toThrow(/帳戶不存在或無權限/);
    });
    const { rows } = await db.query("select quantity from accounts where id = $1", [MFA_ACC]);
    expect(Number(rows[0].quantity)).toBe(10);
  });

  it("已綁 MFA、aal2：讀寫照常，仍只看得到自己的列", async () => {
    await asUser(MFA_USER, "aal2", async () => {
      expect(await ids("select id from accounts")).toEqual([MFA_ACC]);
      await db.query("select apply_account_mutation($1, $2, null, '[]')", [
        MFA_ACC,
        JSON.stringify({ quantity: 12 }),
      ]);
      const { rows } = await db.query("select quantity from accounts where id = $1", [MFA_ACC]);
      expect(Number(rows[0].quantity)).toBe(12);
      const inserted = await db.query(
        "insert into notifications (user_id, type, title) values ($1, 'system', 'x') returning id",
        [MFA_USER],
      );
      expect(inserted.rowCount).toBe(1);
    });
  });

  it("沒綁 MFA、aal1：行為不變", async () => {
    await asUser(PLAIN_USER, "aal1", async () => {
      expect(await ids("select id from accounts")).toEqual([PLAIN_ACC]);
      expect(await ids("select id from profiles")).toEqual([PLAIN_USER]);
    });
  });

  it("只有 unverified factor、aal1：不算綁定，行為不變", async () => {
    await asUser(HALF_USER, "aal1", async () => {
      expect(await ids("select id from accounts")).toEqual([HALF_ACC]);
    });
  });

  it("authenticated 不能直接讀 auth.mfa_factors，mfa_satisfied() 靠 security definer 才讀得到", async () => {
    await asUser(MFA_USER, "aal1", async () => {
      await expect(db.query("select 1 from auth.mfa_factors")).rejects.toThrow(/permission denied/);
    });
    await asUser(MFA_USER, "aal1", async () => {
      const { rows } = await db.query("select public.mfa_satisfied() as ok");
      expect(rows[0].ok).toBe(false);
    });
  });

  it("anon 不能呼叫 mfa_satisfied()", async () => {
    await db.query("begin");
    try {
      // 給 schema usage，確保錯誤來自函式權限而不是 schema 權限
      await db.query("grant usage on schema public to anon");
      await db.query("set local role anon");
      await expect(db.query("select public.mfa_satisfied()")).rejects.toThrow(
        /permission denied for function mfa_satisfied/,
      );
    } finally {
      await db.query("rollback");
    }
  });
});
