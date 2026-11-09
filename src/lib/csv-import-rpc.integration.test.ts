import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetAndApply } from "./integration-test-db";

// import_transactions_csv 的整合測試：打真 Postgres，驗的是 SQL 本身。
// 未設 TEST_DATABASE_URL 時整組跳過，做法與 account-mutation.integration.test.ts 相同。

const url = process.env.TEST_DATABASE_URL;

const ACC = "11111111-1111-1111-1111-111111111111";
const ACC_2 = "44444444-4444-4444-4444-444444444444";
const USER = "22222222-2222-2222-2222-222222222222";
const CREATE_TX = "55555555-5555-5555-5555-555555555555";

describe.skipIf(!url)("import_transactions_csv (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await resetAndApply(db, join(__dirname, "..", ".."), [
      "supabase/test-schema.sql",
      "supabase/rpc-mutations.sql",
      "supabase/migrations/20260718032234_stackworth_v1.sql",
      "supabase/migrations/20260810230000_transaction_fee.sql",
      "supabase/migrations/20261108180000_import_transactions_csv.sql",
    ]);
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(
      "truncate account_snapshots, transactions, accounts, profiles, auth.users cascade",
    );
    await db.query("insert into auth.users (id, email) values ($1, 'test@example.com')", [USER]);
    await db.query("insert into profiles (id) values ($1)", [USER]);
    await db.query(
      `insert into accounts (id, user_id, name, asset_class, price_market, symbol, quantity, cost_basis_twd)
       values ($1, $3, 'VT', 'fund', 'us', 'VT', 10, 36000),
              ($2, $3, '0050', 'fund', 'tw', '0050', 0, 0)`,
      [ACC, ACC_2, USER],
    );
    // 介面建帳戶時寫的那筆 create：今天一次投入 36000。
    await db.query(
      `insert into transactions (id, user_id, account_id, type, quantity_after, value_after_base, cashflow_twd)
       values ($1, $2, $3, 'create', 10, 36000, -36000)`,
      [CREATE_TX, USER, ACC],
    );
  });

  const buy = (accountId: string, createdAt: string, qty: number, cashflow: number) => ({
    account_id: accountId,
    type: "adjust_quantity",
    quantity_after: qty,
    unit_price: 120,
    fx_rate: 30,
    value_after_base: qty * 3600,
    cashflow_twd: cashflow,
    realized_pnl: null,
    fee_twd: null,
    note: null,
    created_at: createdAt,
  });

  const call = (txs: object[], patches: object[], replaced: string[]) =>
    db.query("select import_transactions_csv($1, $2, $3)", [
      JSON.stringify(txs),
      JSON.stringify(patches),
      replaced,
    ]);

  const updatedAt = async (id: string) =>
    (await db.query("select updated_at from accounts where id = $1", [id])).rows[0]
      .updated_at as Date;

  it("正常路徑：寫交易、刪掉被取代的 create、更新帳戶，投入只算一次", async () => {
    await call(
      [buy(ACC, "2024-01-02T02:00:00Z", 5, -18000), buy(ACC, "2024-06-03T02:00:00Z", 12, -25200)],
      [
        {
          account_id: ACC,
          patch: {
            quantity: 12,
            cost_basis_twd: 43200,
            realized_pnl_twd: 0,
            expected_updated_at: (await updatedAt(ACC)).toISOString(),
          },
        },
      ],
      [CREATE_TX],
    );
    const tx = (await db.query("select type, cashflow_twd, user_id from transactions order by created_at")).rows;
    expect(tx.map((t) => t.type)).toEqual(["adjust_quantity", "adjust_quantity"]);
    expect(tx.every((t) => t.user_id === USER)).toBe(true);
    const total = tx.reduce((s, t) => s + Number(t.cashflow_twd), 0);
    expect(total).toBe(-43200);
    const acc = (await db.query("select quantity, cost_basis_twd from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(12);
    expect(Number(acc.cost_basis_twd)).toBe(43200);
  });

  it("帳戶更新失敗時整筆回滾：交易沒寫、create 還在", async () => {
    // cost_basis_twd 是 not null，寫 null 會在最後一步失敗。
    await expect(
      call(
        [buy(ACC, "2024-01-02T02:00:00Z", 5, -18000)],
        [{ account_id: ACC, patch: { quantity: 5, cost_basis_twd: null } }],
        [CREATE_TX],
      ),
    ).rejects.toThrow();
    const tx = (await db.query("select id, type from transactions")).rows;
    expect(tx).toEqual([{ id: CREATE_TX, type: "create" }]);
    const acc = (await db.query("select quantity from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(10);
  });

  it("讀取後帳戶被別的操作更新過就拒絕，什麼都不寫", async () => {
    const stale = (await updatedAt(ACC)).toISOString();
    await db.query("update accounts set quantity = 11, updated_at = now() + interval '1 second' where id = $1", [ACC]);
    await expect(
      call(
        [buy(ACC, "2024-01-02T02:00:00Z", 5, -18000)],
        [{ account_id: ACC, patch: { quantity: 5, expected_updated_at: stale } }],
        [CREATE_TX],
      ),
    ).rejects.toThrow(/剛被其他操作更新/);
    expect((await db.query("select count(*)::int as n from transactions")).rows[0].n).toBe(1);
  });

  it("要刪的 create 已不存在就拒絕，不寫入交易", async () => {
    await db.query("delete from transactions where id = $1", [CREATE_TX]);
    await expect(
      call(
        [buy(ACC, "2024-01-02T02:00:00Z", 5, -18000)],
        [{ account_id: ACC, patch: { quantity: 5 } }],
        [CREATE_TX],
      ),
    ).rejects.toThrow(/建立紀錄已變動/);
    expect((await db.query("select count(*)::int as n from transactions")).rows[0].n).toBe(0);
  });

  it("id 指到別種交易時不刪，整筆拒絕", async () => {
    await db.query("update transactions set type = 'adjust_quantity' where id = $1", [CREATE_TX]);
    await expect(
      call([buy(ACC, "2024-01-02T02:00:00Z", 5, -18000)], [], [CREATE_TX]),
    ).rejects.toThrow(/建立紀錄已變動/);
    expect((await db.query("select count(*)::int as n from transactions")).rows[0].n).toBe(1);
  });

  it("patch 裡出現的 null 照寫 null，沒出現的鍵不動", async () => {
    await db.query(
      "update accounts set last_unit_price = 99, last_fx_rate = 31 where id = $1",
      [ACC_2],
    );
    await call(
      [buy(ACC_2, "2024-01-02T02:00:00Z", 3, -10800)],
      [{ account_id: ACC_2, patch: { quantity: 3, last_unit_price: null } }],
      [],
    );
    const acc = (await db.query("select quantity, last_unit_price, last_fx_rate from accounts where id = $1", [ACC_2])).rows[0];
    expect(Number(acc.quantity)).toBe(3);
    expect(acc.last_unit_price).toBeNull();
    expect(Number(acc.last_fx_rate)).toBe(31);
  });
});
