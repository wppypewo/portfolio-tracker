import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetAndApply } from "./integration-test-db";

const url = process.env.TEST_DATABASE_URL;
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const PLAN_ID = "33333333-3333-3333-3333-333333333333";
const PLAN_2_ID = "44444444-4444-4444-4444-444444444444";
const EXECUTED_AT = "2026-07-10T02:00:00.000Z";

describe.skipIf(!url)("execute_recurring_plan_mutation (integration)", () => {
  let db: Client;
  let db2: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await resetAndApply(db, join(__dirname, "..", ".."), [
      "supabase/test-schema.sql",
      "supabase/rpc-mutations.sql",
      "supabase/migrations/20260718032234_stackworth_v1.sql",
      "supabase/migrations/20260810155500_recurring_amount_override.sql",
      "supabase/migrations/20260810230000_transaction_fee.sql",
      "supabase/migrations/20260930180000_recurring_tier_config.sql",
      "supabase/migrations/20260930200000_recurring_cron_tier_amount.sql",
      "supabase/migrations/20261023120000_recurring_next_run_from_schedule.sql",
      "supabase/migrations/20261023200000_recurring_snapshot_cost.sql",
    ]);
    // 第二條連線在 schema 重建之後才接：它只用來驗併發，沒必要讓它經歷
    // 一次 drop schema，也省得去想連線層的快取。
    db2 = new Client({ connectionString: url });
    await db2.connect();
  });

  afterAll(async () => {
    await db2?.end();
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(
      "truncate recurring_plan_runs, recurring_plans, decision_reviews, investment_decisions, account_status_history, account_snapshots, transactions, accounts, profiles, auth.users cascade",
    );
    await db.query(
      "insert into auth.users (id, email) values ($1, 'test@example.com') on conflict (id) do nothing",
      [USER_ID],
    );
    await db.query("insert into profiles (id) values ($1)", [USER_ID]);
    await db.query(
      `insert into accounts (
        id, user_id, name, asset_class, price_market, symbol, quantity,
        native_currency, last_unit_price, last_fx_rate, cost_basis_twd,
        cost_basis_native, status
      ) values ($1, $2, '測試帳戶', 'fund', 'us', 'VOO', 10, 'USD', 50, 2, 1000, 500, 'active')`,
      [ACCOUNT_ID, USER_ID],
    );
    await insertPlan(db, PLAN_ID, 200);
  });

  const execute = (
    client: Client,
    planId = PLAN_ID,
    expectedRunDate = "2026-07-05",
    source = "cron",
    amountOverride: number | null = null,
    feeOverride: number | null = null,
    executedAt = EXECUTED_AT,
  ) =>
    client.query(
      `select * from execute_recurring_plan_mutation(
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )`,
      [
        planId,
        expectedRunDate,
        executedAt,
        50,
        2,
        executedAt,
        source,
        amountOverride,
        feeOverride,
      ],
    );

  it("單次執行將帳戶、流水、快照、ledger 與排程日期一併提交", async () => {
    const result = (await execute(db)).rows[0];
    expect(result.executed).toBe(true);
    expect(Number(result.shares_added)).toBeCloseTo(2, 8);
    expect(Number(result.new_quantity)).toBeCloseTo(12, 8);
    expect(toDate(result.next_run_date)).toBe("2026-08-05");

    const account = (
      await db.query("select * from accounts where id = $1", [ACCOUNT_ID])
    ).rows[0];
    expect(Number(account.quantity)).toBeCloseTo(12, 8);
    expect(Number(account.cost_basis_twd)).toBe(1200);
    expect(Number(account.cost_basis_native)).toBe(600);

    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(Number(transaction.cashflow_twd)).toBe(-200);
    expect(Number(transaction.quantity_after)).toBeCloseTo(12, 8);

    const snapshot = (await db.query("select * from account_snapshots")).rows[0];
    expect(toDate(snapshot.snapshot_date)).toBe("2026-07-10");
    expect(Number(snapshot.value_base)).toBe(1200);
    expect(Number(snapshot.cost_basis_twd)).toBe(1200);
    expect(snapshot.account_status).toBe("active");

    const run = (await db.query("select * from recurring_plan_runs")).rows[0];
    expect(toDate(run.scheduled_date)).toBe("2026-07-05");
    expect(toDate(run.executed_date)).toBe("2026-07-10");
    expect(run.transaction_id).toBe(transaction.id);

    const plan = (
      await db.query("select * from recurring_plans where id = $1", [PLAN_ID])
    ).rows[0];
    expect(toDate(plan.last_run_date)).toBe("2026-07-10");
    expect(toDate(plan.next_run_date)).toBe("2026-08-05");
  });

  it("當天已有刷價寫的快照時，扣款後快照的成本也跟著更新", async () => {
    // 模擬 cron 先刷價：快照不帶成本欄位，由 trigger 補成扣款前的 1000 / 500。
    await db.query(
      `insert into account_snapshots (
        user_id, account_id, snapshot_date, quantity, unit_price, fx_rate, value_base
      ) values ($1, $2, '2026-07-10', 10, 50, 2, 1000)`,
      [USER_ID, ACCOUNT_ID],
    );
    const before = (await db.query("select * from account_snapshots")).rows[0];
    expect(Number(before.cost_basis_twd)).toBe(1000);

    expect((await execute(db)).rows[0].executed).toBe(true);

    const rows = (await db.query("select * from account_snapshots")).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBeCloseTo(12, 8);
    expect(Number(rows[0].value_base)).toBe(1200);
    expect(Number(rows[0].cost_basis_twd)).toBe(1200);
    expect(Number(rows[0].cost_basis_native)).toBe(600);
    expect(Number(rows[0].realized_pnl_twd)).toBe(0);
    expect(rows[0].account_status).toBe("active");
  });

  it("相同 scheduled date 重試只執行一次", async () => {
    const first = (await execute(db)).rows[0];
    const second = (await execute(db)).rows[0];

    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);
    expect(toDate(second.next_run_date)).toBe("2026-08-05");
    expect(await count(db, "recurring_plan_runs")).toBe(1);
    expect(await count(db, "transactions")).toBe(1);
    expect(Number((await accountRow(db)).quantity)).toBeCloseTo(12, 8);
  });

  it("同一 plan 的並行請求由 row lock 與 ledger 唯一鍵收斂為一次", async () => {
    const [left, right] = await Promise.all([execute(db), execute(db2)]);
    const results = [left.rows[0].executed, right.rows[0].executed].sort();

    expect(results).toEqual([false, true]);
    expect(await count(db, "recurring_plan_runs")).toBe(1);
    expect(await count(db, "transactions")).toBe(1);
    expect(Number((await accountRow(db)).quantity)).toBeCloseTo(12, 8);
  });

  it("不同 plan 同帳戶並行時以帳戶 row lock 保留兩筆增量", async () => {
    await insertPlan(db, PLAN_2_ID, 300);
    const [first, second] = await Promise.all([
      execute(db, PLAN_ID),
      execute(db2, PLAN_2_ID),
    ]);

    expect(first.rows[0].executed).toBe(true);
    expect(second.rows[0].executed).toBe(true);
    expect(await count(db, "recurring_plan_runs")).toBe(2);
    expect(await count(db, "transactions")).toBe(2);
    expect(Number((await accountRow(db)).quantity)).toBeCloseTo(15, 8);
    expect(Number((await accountRow(db)).cost_basis_twd)).toBe(1500);
  });

  it("流水失敗時帳戶、ledger、快照與排程推進全部回滾", async () => {
    await db.query(`
      create or replace function fail_recurring_transaction() returns trigger
      language plpgsql as $$
      begin
        if new.note like '%定期定額%' then
          raise exception 'forced transaction failure';
        end if;
        return new;
      end;
      $$;
      create trigger fail_recurring_transaction_trigger
      before insert on transactions
      for each row execute function fail_recurring_transaction();
    `);

    await expect(execute(db)).rejects.toThrow(/forced transaction failure/);

    expect(await count(db, "recurring_plan_runs")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);
    expect(await count(db, "account_snapshots")).toBe(0);
    const account = await accountRow(db);
    expect(Number(account.quantity)).toBeCloseTo(10, 8);
    expect(Number(account.cost_basis_twd)).toBe(1000);
    const plan = (
      await db.query("select * from recurring_plans where id = $1", [PLAN_ID])
    ).rows[0];
    expect(plan.last_run_date).toBeNull();
    expect(toDate(plan.next_run_date)).toBe("2026-07-05");

    await db.query(`
      drop trigger fail_recurring_transaction_trigger on transactions;
      drop function fail_recurring_transaction();
    `);
  });

  it("cron 不可提前執行，manual 可提前執行並推到預定日之後的扣款日", async () => {
    await db.query(
      "update recurring_plans set next_run_date = '2026-07-20' where id = $1",
      [PLAN_ID],
    );

    await expect(execute(db, PLAN_ID, "2026-07-20", "cron")).rejects.toThrow(
      /尚未到執行日/,
    );
    expect(await count(db, "recurring_plan_runs")).toBe(0);

    const manual = (
      await execute(db, PLAN_ID, "2026-07-20", "manual")
    ).rows[0];
    expect(manual.executed).toBe(true);
    expect(toDate(manual.next_run_date)).toBe("2026-08-05");
  });

  // 執行時間都取台北上午 10 點（UTC 02:00），函式以台北日期判斷執行日。
  it("跨月提前手動執行下個月那期，計劃往後推一期而不是卡在同一期", async () => {
    const julyCron = (
      await execute(db, PLAN_ID, "2026-07-05", "cron", null, null, "2026-07-05T02:00:00.000Z")
    ).rows[0];
    expect(julyCron.executed).toBe(true);
    expect(toDate(julyCron.next_run_date)).toBe("2026-08-05");

    // 7/20 先手動執行 8/5 那期：舊版從執行月推算會得到 8/5，計劃永遠停在已執行的這一期。
    const earlyManual = (
      await execute(db, PLAN_ID, "2026-08-05", "manual", null, null, "2026-07-20T02:00:00.000Z")
    ).rows[0];
    expect(earlyManual.executed).toBe(true);
    expect(toDate(earlyManual.next_run_date)).toBe("2026-09-05");

    // 同一期重送只回傳未執行，不會重複扣款。
    const retry = (
      await execute(db, PLAN_ID, "2026-08-05", "manual", null, null, "2026-07-20T02:05:00.000Z")
    ).rows[0];
    expect(retry.executed).toBe(false);
    expect(toDate(retry.next_run_date)).toBe("2026-09-05");

    const septemberCron = (
      await execute(db, PLAN_ID, "2026-09-05", "cron", null, null, "2026-09-05T02:00:00.000Z")
    ).rows[0];
    expect(septemberCron.executed).toBe(true);
    expect(toDate(septemberCron.next_run_date)).toBe("2026-10-05");

    const runs = (
      await db.query(
        "select scheduled_date, executed_date, source from recurring_plan_runs order by scheduled_date",
      )
    ).rows;
    expect(runs.map((run) => toDate(run.scheduled_date))).toEqual([
      "2026-07-05",
      "2026-08-05",
      "2026-09-05",
    ]);
    expect(toDate(runs[1].executed_date)).toBe("2026-07-20");
    expect(runs[1].source).toBe("manual");
    expect(await count(db, "transactions")).toBe(3);
    expect(Number((await accountRow(db)).quantity)).toBeCloseTo(16, 8);
  });

  it("逾期到下個月才補執行，只要還沒過下一個扣款日就不跳期", async () => {
    await db.query(
      "update recurring_plans set day_of_month = 28, next_run_date = '2026-07-28' where id = $1",
      [PLAN_ID],
    );

    // 7/28 那期 8/2 才執行：舊版從執行月加一個月會得到 9/28，跳過 8/28。
    const overdue = (
      await execute(db, PLAN_ID, "2026-07-28", "cron", null, null, "2026-08-02T02:00:00.000Z")
    ).rows[0];
    expect(overdue.executed).toBe(true);
    expect(toDate(overdue.next_run_date)).toBe("2026-08-28");

    const august = (
      await execute(db, PLAN_ID, "2026-08-28", "cron", null, null, "2026-08-28T02:00:00.000Z")
    ).rows[0];
    expect(august.executed).toBe(true);
    expect(toDate(august.next_run_date)).toBe("2026-09-28");
    expect(await count(db, "recurring_plan_runs")).toBe(2);
  });

  it("延誤超過一期時不補齊中間錯過的期數，從執行日之後的扣款日繼續", async () => {
    // 7/5 那期拖到 8/20 才執行：8/5 已經過了，這一期只扣一次，下一期是 9/5。
    const late = (
      await execute(db, PLAN_ID, "2026-07-05", "cron", null, null, "2026-08-20T02:00:00.000Z")
    ).rows[0];
    expect(late.executed).toBe(true);
    expect(toDate(late.next_run_date)).toBe("2026-09-05");
    expect(await count(db, "recurring_plan_runs")).toBe(1);
  });

  it("manual 覆寫金額只影響本期，計劃預設金額不變", async () => {
    // 計劃金額 200，本期改成 500：單位 TWD 為 100，故加 5 股而非 2 股。
    const result = (
      await execute(db, PLAN_ID, "2026-07-05", "manual", 500)
    ).rows[0];
    expect(result.executed).toBe(true);
    expect(Number(result.shares_added)).toBeCloseTo(5, 8);
    expect(Number(result.new_quantity)).toBeCloseTo(15, 8);

    const account = await accountRow(db);
    expect(Number(account.cost_basis_twd)).toBe(1500);
    expect(Number(account.cost_basis_native)).toBe(750);

    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(Number(transaction.cashflow_twd)).toBe(-500);
    expect(transaction.note).toContain("本期調整");

    // ledger 記的是本期真實金額，不是計劃預設值。
    const run = (await db.query("select * from recurring_plan_runs")).rows[0];
    expect(Number(run.amount_twd)).toBe(500);

    const plan = (
      await db.query("select * from recurring_plans where id = $1", [PLAN_ID])
    ).rows[0];
    expect(Number(plan.amount_twd)).toBe(200);
    expect(toDate(plan.next_run_date)).toBe("2026-08-05");
  });

  it("計劃手續費從本期金額扣掉後才換算股數，成本仍記全額", async () => {
    // 單位 TWD = 50 × 2 = 100。計劃 200、手續費 40 → (200 − 40) / 100 = 1.6 股。
    await db.query("delete from recurring_plans where id = $1", [PLAN_ID]);
    await insertPlan(db, PLAN_ID, 200, 40);

    const result = (await execute(db)).rows[0];
    expect(result.executed).toBe(true);
    expect(Number(result.shares_added)).toBeCloseTo(1.6, 8);
    expect(Number(result.new_quantity)).toBeCloseTo(11.6, 8);

    const account = await accountRow(db);
    // 成本含費：1000 + 200，不是 + 160。
    expect(Number(account.cost_basis_twd)).toBe(1200);
    expect(Number(account.cost_basis_native)).toBe(600);

    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(Number(transaction.cashflow_twd)).toBe(-200);
    expect(Number(transaction.fee_twd)).toBe(40);
    expect(transaction.note).toContain("含手續費");

    const run = (await db.query("select * from recurring_plan_runs")).rows[0];
    expect(Number(run.amount_twd)).toBe(200);
    expect(Number(run.fee_twd)).toBe(40);
  });

  it("manual 覆寫手續費只影響本期，計劃預設值不變", async () => {
    await db.query("delete from recurring_plans where id = $1", [PLAN_ID]);
    await insertPlan(db, PLAN_ID, 200, 40);

    // 本期手續費改成 100 → (200 − 100) / 100 = 1 股。
    const result = (
      await execute(db, PLAN_ID, "2026-07-05", "manual", null, 100)
    ).rows[0];
    expect(result.executed).toBe(true);
    expect(Number(result.shares_added)).toBeCloseTo(1, 8);

    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(Number(transaction.fee_twd)).toBe(100);
    expect(transaction.note).toContain("本期調整");

    const plan = (
      await db.query("select * from recurring_plans where id = $1", [PLAN_ID])
    ).rows[0];
    expect(Number(plan.fee_twd)).toBe(40);
  });

  it("手續費不得大於或等於本期金額", async () => {
    await expect(
      execute(db, PLAN_ID, "2026-07-05", "manual", null, 200),
    ).rejects.toThrow(/手續費不得大於或等於本期金額/);
    expect(await count(db, "recurring_plan_runs")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);
  });

  it("cron 不接受覆寫手續費", async () => {
    await expect(
      execute(db, PLAN_ID, "2026-07-05", "cron", null, 40),
    ).rejects.toThrow(/自動執行不接受覆寫手續費/);
    expect(await count(db, "recurring_plan_runs")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);
  });

  it("cron 不接受覆寫金額", async () => {
    await expect(
      execute(db, PLAN_ID, "2026-07-05", "cron", 500),
    ).rejects.toThrow(/自動執行不接受覆寫金額/);
    expect(await count(db, "recurring_plan_runs")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);
  });

  it("cron 可對級距計劃帶本期金額，備註標明級距與基準金額", async () => {
    await setTierConfig(db, PLAN_ID);

    // 基準 200、級距算出 300：單位 TWD 為 100，故加 3 股而非 2 股。
    const result = (
      await execute(db, PLAN_ID, "2026-07-05", "cron", 300)
    ).rows[0];
    expect(result.executed).toBe(true);
    expect(Number(result.shares_added)).toBeCloseTo(3, 8);
    expect(toDate(result.next_run_date)).toBe("2026-08-05");

    const account = await accountRow(db);
    expect(Number(account.cost_basis_twd)).toBe(1300);

    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(Number(transaction.cashflow_twd)).toBe(-300);
    expect(transaction.note).toContain("定期定額(cron·級距，基準 200.00)");

    const run = (await db.query("select * from recurring_plan_runs")).rows[0];
    expect(run.source).toBe("cron");
    expect(Number(run.amount_twd)).toBe(300);

    // 基準金額不因某一期套了級距而改變。
    const plan = (
      await db.query("select * from recurring_plans where id = $1", [PLAN_ID])
    ).rows[0];
    expect(Number(plan.amount_twd)).toBe(200);
  });

  it("級距計劃的 cron 沒帶金額時用基準金額，備註不標級距", async () => {
    await setTierConfig(db, PLAN_ID);

    const result = (await execute(db)).rows[0];
    expect(result.executed).toBe(true);
    expect(Number(result.shares_added)).toBeCloseTo(2, 8);

    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(Number(transaction.cashflow_twd)).toBe(-200);
    expect(transaction.note).toContain("定期定額(cron)");
    expect(transaction.note).not.toContain("級距");
  });

  it("級距計劃的 cron 仍不接受覆寫手續費", async () => {
    await setTierConfig(db, PLAN_ID);

    await expect(
      execute(db, PLAN_ID, "2026-07-05", "cron", 300, 40),
    ).rejects.toThrow(/自動執行不接受覆寫手續費/);
    expect(await count(db, "recurring_plan_runs")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);
  });

  it("級距計劃手動覆寫金額的備註仍是本期調整", async () => {
    await setTierConfig(db, PLAN_ID);

    await execute(db, PLAN_ID, "2026-07-05", "manual", 300);
    const transaction = (await db.query("select * from transactions")).rows[0];
    expect(transaction.note).toContain("本期調整");
    expect(transaction.note).not.toContain("級距");
  });

  it("覆寫金額需為正數且不得超過 1 億", async () => {
    await expect(
      execute(db, PLAN_ID, "2026-07-05", "manual", 0),
    ).rejects.toThrow(/本期金額需為正數/);
    await expect(
      execute(db, PLAN_ID, "2026-07-05", "manual", 100000001),
    ).rejects.toThrow(/不得超過 1 億/);
    expect(await count(db, "recurring_plan_runs")).toBe(0);
    expect(await count(db, "transactions")).toBe(0);

    const plan = (
      await db.query("select * from recurring_plans where id = $1", [PLAN_ID])
    ).rows[0];
    expect(toDate(plan.next_run_date)).toBe("2026-07-05");
  });
});

async function insertPlan(
  client: Client,
  id: string,
  amount: number,
  fee = 0,
) {
  await client.query(
    `insert into recurring_plans (
      id, user_id, account_id, amount_twd, fee_twd, day_of_month,
      start_date, next_run_date, active
    ) values ($1, $2, $3, $4, $5, 5, '2026-07-01', '2026-07-05', true)`,
    [id, USER_ID, ACCOUNT_ID, amount, fee],
  );
}

// 函式只看 tier_config 是不是 null，內容由應用層驗證，這裡放預設級距即可。
async function setTierConfig(client: Client, id: string) {
  await client.query(
    "update recurring_plans set tier_config = $2::jsonb where id = $1",
    [
      id,
      JSON.stringify({
        maLength: 200,
        drawdown: [{ pct: -10, multiplier: 1.25 }],
        premium: [{ pct: 10, multiplier: 0.9 }],
      }),
    ],
  );
}

async function count(client: Client, table: string): Promise<number> {
  const result = await client.query(`select count(*)::int as count from ${table}`);
  return result.rows[0].count;
}

async function accountRow(client: Client) {
  return (
    await client.query("select * from accounts where id = $1", [ACCOUNT_ID])
  ).rows[0];
}

function toDate(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}
