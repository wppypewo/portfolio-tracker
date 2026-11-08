import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetAndApply } from "./integration-test-db";

// migration 20261108120000_child_account_owner_fk 的整合測試：
// 子表的 (account_id, user_id) 必須對得上 accounts(id, user_id)。
// 外鍵不受角色影響，所以直接用連線身分（superuser）測，不用切 authenticated。
// 執行方式與其他 integration test 相同，見 account-mutation.integration.test.ts 開頭。

const url = process.env.TEST_DATABASE_URL;
const root = join(__dirname, "..", "..");

const ME = "77777777-7777-7777-7777-777777777777";
const VICTIM = "88888888-8888-8888-8888-888888888888";
const MY_ACC = "99999999-9999-9999-9999-999999999999";
const VICTIM_ACC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const OWNER_FKS = [
  "account_snapshots_account_owner_fkey",
  "account_status_history_account_owner_fkey",
  "alerts_account_owner_fkey",
  "investment_decisions_account_owner_fkey",
  "recurring_plan_runs_account_owner_fkey",
  "recurring_plan_runs_plan_owner_fkey",
  "recurring_plans_account_owner_fkey",
  "transactions_account_owner_fkey",
];

describe.skipIf(!url)("子表帳戶擁有者複合外鍵 (integration)", () => {
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
      "supabase/migrations/20261108120000_child_account_owner_fk.sql",
    ]);
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(
      "truncate investment_decisions, alerts, recurring_plans, account_status_history, account_snapshots, transactions, accounts, profiles, auth.users cascade",
    );
    await db.query(
      `insert into auth.users (id, email) values ($1, 'me@example.com'), ($2, 'victim@example.com')`,
      [ME, VICTIM],
    );
    await db.query(
      `insert into accounts (id, user_id, name, asset_class, quantity) values
         ($1, $2, '我的帳戶', 'fund', 10),
         ($3, $4, '別人的帳戶', 'fund', 10)`,
      [MY_ACC, ME, VICTIM_ACC, VICTIM],
    );
  });

  // 回傳 SQLSTATE；成功回 null。
  async function sqlState(sql: string, params: unknown[]): Promise<string | null> {
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "unknown";
    }
  }

  it("8 條複合外鍵都存在，且以 not valid 建立", async () => {
    const { rows } = await db.query(
      `select conname, convalidated from pg_constraint
        where contype = 'f' and conname like '%_owner_fkey' order by conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual(OWNER_FKS);
    expect(rows.every((r) => r.convalidated === false)).toBe(true);
  });

  it.each([
    [
      "transactions",
      `insert into transactions (user_id, account_id, type) values ($1, $2, 'create')`,
    ],
    [
      "account_snapshots",
      `insert into account_snapshots (user_id, account_id, snapshot_date, quantity, value_base)
         values ($1, $2, '2099-01-01', 1, 1)`,
    ],
    [
      "account_status_history",
      `insert into account_status_history (user_id, account_id, status) values ($1, $2, 'active')`,
    ],
    [
      "recurring_plans",
      `insert into recurring_plans (user_id, account_id, amount_twd, day_of_month, start_date, next_run_date)
         values ($1, $2, 1000, 1, '2026-01-01', '2026-02-01')`,
    ],
    [
      "alerts",
      `insert into alerts (user_id, type, account_id, threshold) values ($1, 'price_above', $2, 100)`,
    ],
  ])("%s：自己的 user_id 配別人的 account_id 被擋下", async (_table, sql) => {
    expect(await sqlState(sql, [ME, VICTIM_ACC])).toBe("23503");
    expect(await sqlState(sql, [ME, MY_ACC])).toBeNull();
  });

  it("把自己的列改指向別人的帳戶也被擋下", async () => {
    await db.query(
      `insert into transactions (user_id, account_id, type) values ($1, $2, 'create')`,
      [ME, MY_ACC],
    );
    expect(
      await sqlState(`update transactions set account_id = $1 where user_id = $2`, [
        VICTIM_ACC,
        ME,
      ]),
    ).toBe("23503");
  });

  it("配置偏離警示 account_id 為 null 不受影響", async () => {
    expect(
      await sqlState(
        `insert into alerts (user_id, type, account_id, threshold) values ($1, 'allocation_drift', null, 5)`,
        [ME],
      ),
    ).toBeNull();
  });

  it("recurring_plan_runs 的 plan 必須與 user_id 同一人", async () => {
    const { rows } = await db.query(
      `insert into recurring_plans (user_id, account_id, amount_twd, day_of_month, start_date, next_run_date)
         values ($1, $2, 1000, 1, '2026-01-01', '2026-02-01') returning id`,
      [VICTIM, VICTIM_ACC],
    );
    const runSql = `insert into recurring_plan_runs
        (plan_id, user_id, account_id, scheduled_date, executed_date, executed_at, source,
         amount_twd, shares_added, unit_price, fx_rate)
      values ($1, $2, $3, '2026-02-01', '2026-02-01', now(), 'cron', 1000, 1, 1, 1)`;
    expect(await sqlState(runSql, [rows[0].id, ME, MY_ACC])).toBe("23503");
    expect(await sqlState(runSql, [rows[0].id, VICTIM, VICTIM_ACC])).toBeNull();
  });

  it("investment_decisions：擋下別人的帳戶；刪自己的帳戶時只清 account_id", async () => {
    const decisionSql = `insert into investment_decisions
        (user_id, account_id, decision_date, asset_name, decision_type, thesis, risks,
         invalidation_conditions, expected_holding_months, confidence, review_date)
      values ($1, $2, '2026-01-01', 'VOO', 'buy', '長期持有', '估值', '跌破均線', 12, 2, '2026-06-01')`;
    expect(await sqlState(decisionSql, [ME, VICTIM_ACC])).toBe("23503");
    expect(await sqlState(decisionSql, [ME, MY_ACC])).toBeNull();

    await db.query("delete from accounts where id = $1", [MY_ACC]);
    const { rows } = await db.query(
      "select user_id, account_id from investment_decisions",
    );
    expect(rows).toEqual([{ user_id: ME, account_id: null }]);
  });

  it("刪帳戶時子表照舊 cascade", async () => {
    await db.query(
      `insert into transactions (user_id, account_id, type) values ($1, $2, 'create')`,
      [ME, MY_ACC],
    );
    await db.query("delete from accounts where id = $1", [MY_ACC]);
    const { rows } = await db.query("select count(*)::int as n from transactions");
    expect(rows[0].n).toBe(0);
  });
});
