import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetAndApply } from "./integration-test-db";

const url = process.env.TEST_DATABASE_URL;
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const MANUAL_ID = "55555555-5555-5555-5555-555555555555";
const USER_ID = "22222222-2222-2222-2222-222222222222";

describe.skipIf(!url)("reverse_transaction_mutation (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await resetAndApply(db, join(__dirname, "..", ".."), [
      "supabase/test-schema.sql",
      "supabase/rpc-mutations.sql",
      "supabase/migrations/20260718032234_stackworth_v1.sql",
      "supabase/migrations/20260810155500_recurring_amount_override.sql",
      "supabase/migrations/20260810230000_transaction_fee.sql",
      "supabase/migrations/20260810234500_transaction_reversal.sql",
      "supabase/migrations/20260818130000_reversal_negative_fee.sql",
      "supabase/migrations/20261023180000_reversal_sell_quantity_guard.sql",
    ]);
  });

  afterAll(async () => {
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
    // 單位 TWD = 50 × 2 = 100。持有 10 股、成本 1000 TWD / 500 原幣。
    await db.query(
      `insert into accounts (
        id, user_id, name, asset_class, price_market, symbol, quantity,
        native_currency, last_unit_price, last_fx_rate, cost_basis_twd,
        cost_basis_native, realized_pnl_twd, status
      ) values ($1, $2, '測試帳戶', 'fund', 'us', 'VOO', 10, 'USD', 50, 2, 1000, 500, 0, 'active')`,
      [ACCOUNT_ID, USER_ID],
    );
    await db.query(
      `insert into accounts (
        id, user_id, name, asset_class, price_market, quantity,
        native_currency, last_fx_rate, manual_value_base, cost_basis_twd,
        cost_basis_native, realized_pnl_twd, status
      ) values ($1, $2, '手動帳戶', 'liquid_cash', 'manual', 0, 'TWD', 1, 8000, 8000, 8000, 0, 'active')`,
      [MANUAL_ID, USER_ID],
    );
  });

  const reverse = (transactionId: string, mode: string) =>
    db.query("select * from reverse_transaction_mutation($1, $2)", [
      transactionId,
      mode,
    ]);

  async function insertTxn(
    over: Partial<{
      account_id: string;
      type: string;
      quantity_after: number;
      unit_price: number | null;
      fx_rate: number | null;
      value_after_base: number;
      cashflow_twd: number | null;
      realized_pnl: number | null;
      fee_twd: number | null;
      created_at: string;
    }> = {},
  ): Promise<string> {
    const row = {
      account_id: ACCOUNT_ID,
      type: "adjust_quantity",
      quantity_after: 10,
      unit_price: 50,
      fx_rate: 2,
      value_after_base: 1000,
      cashflow_twd: null,
      realized_pnl: null,
      fee_twd: null,
      created_at: "2026-07-10T02:00:00.000Z",
      ...over,
    };
    const result = await db.query(
      `insert into transactions (
        user_id, account_id, type, quantity_after, unit_price, fx_rate,
        value_after_base, cashflow_twd, realized_pnl, fee_twd, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        USER_ID,
        row.account_id,
        row.type,
        row.quantity_after,
        row.unit_price,
        row.fx_rate,
        row.value_after_base,
        row.cashflow_twd,
        row.realized_pnl,
        row.fee_twd,
        row.created_at,
      ],
    );
    return result.rows[0].id;
  }

  const accountRow = async (id = ACCOUNT_ID) =>
    (await db.query("select * from accounts where id = $1", [id])).rows[0];

  it("undo 加碼：數量、成本、原幣成本一併退回，流水列真的被刪掉", async () => {
    // 投入 600、手續費 40 → 買到 (600−40)/100 = 5.6 股。
    const id = await insertTxn({
      quantity_after: 15.6,
      cashflow_twd: -600,
      fee_twd: 40,
    });
    await db.query(
      "update accounts set quantity = 15.6, cost_basis_twd = 1600, cost_basis_native = 800 where id = $1",
      [ACCOUNT_ID],
    );

    await reverse(id, "undo");

    const account = await accountRow();
    expect(Number(account.quantity)).toBeCloseTo(10, 8);
    expect(Number(account.cost_basis_twd)).toBe(1000);
    expect(Number(account.cost_basis_native)).toBe(500);
    expect(
      (await db.query("select * from transactions where id = $1", [id])).rowCount,
    ).toBe(0);
  });

  it("undo 賣出：賣出股數由帳戶當下狀態反解，已實現損益一併退回", async () => {
    // 原本 10 股成本 1000。賣 4 股收 500，已實現 500 − 400 = 100。
    const id = await insertTxn({
      type: "sell",
      quantity_after: 6,
      cashflow_twd: 500,
      realized_pnl: 100,
    });
    await db.query(
      "update accounts set quantity = 6, cost_basis_twd = 600, cost_basis_native = 300, realized_pnl_twd = 100 where id = $1",
      [ACCOUNT_ID],
    );

    await reverse(id, "undo");

    const account = await accountRow();
    expect(Number(account.quantity)).toBeCloseTo(10, 8);
    expect(Number(account.cost_basis_twd)).toBe(1000);
    expect(Number(account.cost_basis_native)).toBe(500);
    expect(Number(account.realized_pnl_twd)).toBe(0);
  });

  it("undo 賣出：賣出後補記較早日期的加碼，數量對不上就擋下", async () => {
    // 今天賣 4 股：剩 6 股、成本 600。
    const sold = await insertTxn({
      type: "sell",
      quantity_after: 6,
      cashflow_twd: 500,
      realized_pnl: 100,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    // 之後補記上週加碼 4 股、成本 800：created_at 比賣出早，賣出仍是最新一筆。
    await insertTxn({
      quantity_after: 10,
      cashflow_twd: -800,
      unit_price: 100,
      created_at: "2026-07-03T02:00:00.000Z",
    });
    await db.query(
      "update accounts set quantity = 10, cost_basis_twd = 1400, cost_basis_native = 700, realized_pnl_twd = 100 where id = $1",
      [ACCOUNT_ID],
    );

    // 修正前會反解成 10 × 400 / 1400 = 2.857 股，帳戶變 12.857 股。
    await expect(reverse(sold, "undo")).rejects.toThrow(/改動過持有數量/);
    const account = await accountRow();
    expect(Number(account.quantity)).toBe(10);
    expect(Number(account.cost_basis_twd)).toBe(1400);
    expect(
      (await db.query("select * from transactions where id = $1", [sold]))
        .rowCount,
    ).toBe(1);
  });

  it("undo 修改餘額：退回前一筆餘額", async () => {
    // 餘額從 5000 改成 8000，cashflow 記 −3000。
    const id = await insertTxn({
      account_id: MANUAL_ID,
      type: "adjust_balance",
      quantity_after: 0,
      unit_price: null,
      fx_rate: 1,
      value_after_base: 8000,
      cashflow_twd: -3000,
    });

    await reverse(id, "undo");

    const account = await accountRow(MANUAL_ID);
    expect(Number(account.manual_value_base)).toBe(5000);
    expect(Number(account.cost_basis_twd)).toBe(5000);
  });

  it("undo 定期定額：ledger 刪除、排程日退回該期", async () => {
    await db.query(
      `insert into recurring_plans (
        id, user_id, account_id, amount_twd, fee_twd, day_of_month,
        start_date, next_run_date, last_run_date, active
      ) values ('33333333-3333-3333-3333-333333333333', $1, $2, 600, 40, 5,
        '2026-06-01', '2026-08-05', '2026-07-10', true)`,
      [USER_ID, ACCOUNT_ID],
    );
    const id = await insertTxn({
      quantity_after: 15.6,
      cashflow_twd: -600,
      fee_twd: 40,
    });
    await db.query(
      "update accounts set quantity = 15.6, cost_basis_twd = 1600, cost_basis_native = 800 where id = $1",
      [ACCOUNT_ID],
    );
    await db.query(
      `insert into recurring_plan_runs (
        plan_id, user_id, account_id, scheduled_date, executed_date, executed_at,
        source, amount_twd, shares_added, unit_price, fx_rate, fee_twd, transaction_id
      ) values ('33333333-3333-3333-3333-333333333333', $1, $2, '2026-07-05',
        '2026-07-10', '2026-07-10T02:00:00.000Z', 'cron', 600, 5.6, 50, 2, 40, $3)`,
      [USER_ID, ACCOUNT_ID, id],
    );

    await reverse(id, "undo");

    expect(
      (await db.query("select * from recurring_plan_runs")).rowCount,
    ).toBe(0);
    const plan = (await db.query("select * from recurring_plans")).rows[0];
    expect(plan.next_run_date.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(plan.last_run_date).toBeNull();
  });

  it("reverse 保留原筆並寫一筆反向流水，反向的現金流與手續費都變號", async () => {
    const older = await insertTxn({
      quantity_after: 15.6,
      cashflow_twd: -600,
      fee_twd: 40,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    // 之後還有別的交易，所以 older 不是最新一筆。
    await insertTxn({
      type: "price_update",
      quantity_after: 15.6,
      cashflow_twd: 0,
      created_at: "2026-07-11T02:00:00.000Z",
    });
    await db.query(
      "update accounts set quantity = 15.6, cost_basis_twd = 1600, cost_basis_native = 800 where id = $1",
      [ACCOUNT_ID],
    );

    await reverse(older, "reverse");

    // 原筆還在。
    expect(
      (await db.query("select * from transactions where id = $1", [older]))
        .rowCount,
    ).toBe(1);
    const reversal = (
      await db.query("select * from transactions where reversal_of = $1", [
        older,
      ])
    ).rows[0];
    expect(Number(reversal.cashflow_twd)).toBe(600);
    expect(Number(reversal.fee_twd)).toBe(-40);
    expect(Number(reversal.quantity_after)).toBeCloseTo(10, 8);

    const account = await accountRow();
    expect(Number(account.cost_basis_twd)).toBe(1000);
  });

  it("同一筆不能沖銷兩次", async () => {
    const older = await insertTxn({
      quantity_after: 15.6,
      cashflow_twd: -600,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    await insertTxn({
      type: "price_update",
      quantity_after: 15.6,
      cashflow_twd: 0,
      created_at: "2026-07-11T02:00:00.000Z",
    });
    await db.query(
      "update accounts set quantity = 16, cost_basis_twd = 1600, cost_basis_native = 800 where id = $1",
      [ACCOUNT_ID],
    );

    await reverse(older, "reverse");
    await expect(reverse(older, "reverse")).rejects.toThrow(/已經沖銷過/);
  });

  it("undo 只限最新一筆", async () => {
    const older = await insertTxn({
      quantity_after: 15.6,
      cashflow_twd: -600,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    await insertTxn({
      type: "price_update",
      quantity_after: 15.6,
      cashflow_twd: 0,
      created_at: "2026-07-11T02:00:00.000Z",
    });

    await expect(reverse(older, "undo")).rejects.toThrow(/最新一筆/);
  });

  it("較早的賣出不提供沖銷", async () => {
    const older = await insertTxn({
      type: "sell",
      quantity_after: 6,
      cashflow_twd: 500,
      realized_pnl: 100,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    await insertTxn({
      type: "price_update",
      quantity_after: 6,
      cashflow_twd: 0,
      created_at: "2026-07-11T02:00:00.000Z",
    });

    await expect(reverse(older, "reverse")).rejects.toThrow(/賣出只能撤銷/);
  });

  it("建立帳戶、更新報價、往下調整數量都被拒絕", async () => {
    // created_at 必須各自不同：undo 的「最新一筆」檢查排序是 (created_at, id)，
    // 時間相同的話就由隨機 uuid 決定誰是最新，測試會變成不穩定。
    const created = await insertTxn({
      type: "create",
      cashflow_twd: -1000,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    await expect(reverse(created, "undo")).rejects.toThrow(/建立帳戶/);

    const priced = await insertTxn({
      type: "price_update",
      cashflow_twd: 0,
      created_at: "2026-07-11T02:00:00.000Z",
    });
    await expect(reverse(priced, "undo")).rejects.toThrow(/沒有現金流/);

    const down = await insertTxn({
      quantity_after: 8,
      cashflow_twd: 200,
      created_at: "2026-07-12T02:00:00.000Z",
    });
    await expect(reverse(down, "undo")).rejects.toThrow(/按比例縮放/);
  });

  it("校正成本不能撤銷也不能沖銷：流水沒有校正前的成本", async () => {
    const corrected = await insertTxn({
      type: "adjust_cost",
      cashflow_twd: 0,
      created_at: "2026-07-10T02:00:00.000Z",
    });
    await expect(reverse(corrected, "undo")).rejects.toThrow(/不支援撤銷/);
    await expect(reverse(corrected, "reverse")).rejects.toThrow(/不支援撤銷/);
    const acc = await accountRow();
    expect(Number(acc.cost_basis_twd)).toBe(1000);
    expect(Number(acc.cost_basis_native)).toBe(500);
  });

  it("帳戶狀態對不上時擋下，不寫出負數", async () => {
    const id = await insertTxn({ quantity_after: 15.6, cashflow_twd: -600 });
    // 帳戶只有 10 股 1000 成本，撤銷 600 的加碼會讓數量掉到負的。
    await db.query("update accounts set quantity = 1 where id = $1", [
      ACCOUNT_ID,
    ]);

    await expect(reverse(id, "undo")).rejects.toThrow(/負數/);
    expect(
      (await db.query("select * from transactions where id = $1", [id])).rowCount,
    ).toBe(1);
  });
});
