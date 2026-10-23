import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { resetAndApply } from "./integration-test-db";

// apply_account_mutation 的整合測試：打真 Postgres，驗的是 SQL 本身。
// - 本地：TEST_DATABASE_URL=postgresql://... npx vitest run
// - CI：workflow 起 postgres service 並注入同名環境變數
// - 未設環境變數時整組跳過（單元測試不受影響）
// beforeAll 先把 schema 清空再套最小 schema、既有 RPC 與 v1 migration，
// 測試檔即為 migration 的可執行規格。清空的理由見 integration-test-db.ts。

const url = process.env.TEST_DATABASE_URL;

const ACC = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const USER_2 = "33333333-3333-3333-3333-333333333333";

describe.skipIf(!url)("apply_account_mutation (integration)", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: url });
    await db.connect();
    await resetAndApply(db, join(__dirname, "..", ".."), [
      "supabase/test-schema.sql",
      "supabase/rpc-mutations.sql",
      "supabase/migrations/20260718032234_stackworth_v1.sql",
      "supabase/migrations/20260810230000_transaction_fee.sql",
      "supabase/migrations/20261023210000_account_mutation_stale_guard.sql",
    ]);
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(
      "truncate decision_reviews, investment_decisions, account_status_history, account_snapshots, transactions, accounts, profiles, auth.users cascade",
    );
    await db.query(
      "insert into auth.users (id, email) values ($1, 'test@example.com'), ($2, 'other@example.com')",
      [USER, USER_2],
    );
    await db.query("insert into profiles (id) values ($1), ($2)", [USER, USER_2]);
    await db.query(
      `insert into accounts (id, user_id, name, asset_class, price_market, symbol, quantity, cost_basis_twd)
       values ($1, $2, '測試帳戶', 'fund', 'us', 'VOO', 10, 100000)`,
      [ACC, USER],
    );
  });

  const call = (patch: object, tx: object | null, snaps: object[]) =>
    db.query("select apply_account_mutation($1, $2, $3, $4)", [
      ACC,
      JSON.stringify(patch),
      tx === null ? null : JSON.stringify(tx),
      JSON.stringify(snaps),
    ]);

  it("正常路徑：patch 部分更新 + 流水 + 兩筆快照，user_id 由帳戶擁有者補", async () => {
    await call(
      { quantity: 12, cost_basis_twd: 120000, last_unit_price: 520 },
      {
        type: "adjust_quantity",
        quantity_after: 12,
        unit_price: 520,
        fx_rate: 32,
        value_after_base: 199680,
        note: "加碼 20000 TWD",
        cashflow_twd: -20000,
      },
      [
        { snapshot_date: "2026-07-05", quantity: 12, unit_price: 520, fx_rate: 32, value_base: 199680 },
        { snapshot_date: "2026-07-06", quantity: 12, unit_price: 521, fx_rate: 32, value_base: 200064 },
      ],
    );
    const acc = (await db.query("select * from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(12);
    expect(Number(acc.cost_basis_twd)).toBe(120000);
    expect(acc.symbol).toBe("VOO"); // patch 沒帶的欄位不動
    const tx = (await db.query("select * from transactions")).rows;
    expect(tx).toHaveLength(1);
    expect(tx[0].user_id).toBe(USER);
    expect(Number(tx[0].cashflow_twd)).toBe(-20000);
    const snaps = (await db.query("select * from account_snapshots order by snapshot_date")).rows;
    expect(snaps).toHaveLength(2);
    expect(snaps.every((s) => s.user_id === USER)).toBe(true);
    expect(snaps.every((s) => Number(s.cost_basis_twd) === 120000)).toBe(true);
    expect(snaps.every((s) => s.account_status === "active")).toBe(true);
  });

  it("決策情境快照建立後不可改寫", async () => {
    const decisionId = "55555555-5555-5555-5555-555555555555";
    await db.query(
      `insert into investment_decisions (
        id, user_id, account_id, decision_date, asset_name, decision_type,
        thesis, risks, invalidation_conditions, expected_holding_months,
        confidence, review_date, context_snapshot
      ) values ($1, $2, $3, '2026-07-01', 'VOO', 'buy', '長期配置',
        '估值偏高', '基本面惡化', 24, 2, '2027-01-01', '{"value":1000}')`,
      [decisionId, USER, ACC],
    );

    await expect(
      db.query(
        "update investment_decisions set context_snapshot = '{\"value\":2000}' where id = $1",
        [decisionId],
      ),
    ).rejects.toThrow(/情境快照不可修改/);
  });

  it("RLS 防止跨使用者讀取與修改決策", async () => {
    const ownDecision = "55555555-5555-5555-5555-555555555555";
    const otherDecision = "66666666-6666-6666-6666-666666666666";
    await insertDecision(db, ownDecision, USER, ACC);
    await insertDecision(db, otherDecision, USER_2, null);

    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [USER]);
      const visible = await db.query(
        "select id from investment_decisions order by id",
      );
      expect(visible.rows.map((row) => row.id)).toEqual([ownDecision]);
      const updated = await db.query(
        "update investment_decisions set thesis = '越權修改' where id = $1 returning id",
        [otherDecision],
      );
      expect(updated.rowCount).toBe(0);
    } finally {
      await db.query("rollback");
    }
    const other = await db.query(
      "select thesis from investment_decisions where id = $1",
      [otherDecision],
    );
    expect(other.rows[0].thesis).toBe("長期配置");
  });

  it("decision 與 transaction/account 外鍵刪除時保留日誌並清空關聯", async () => {
    const transactionId = "77777777-7777-7777-7777-777777777777";
    const decisionId = "88888888-8888-8888-8888-888888888888";
    await db.query(
      `insert into transactions (id, user_id, account_id, type, value_after_base)
       values ($1, $2, $3, 'price_update', 100000)`,
      [transactionId, USER, ACC],
    );
    await insertDecision(db, decisionId, USER, ACC, transactionId);
    await db.query("delete from transactions where id = $1", [transactionId]);
    expect(
      (await db.query("select transaction_id from investment_decisions where id = $1", [decisionId])).rows[0]
        .transaction_id,
    ).toBeNull();
    await db.query("delete from accounts where id = $1", [ACC]);
    expect(
      (await db.query("select account_id from investment_decisions where id = $1", [decisionId])).rows[0]
        .account_id,
    ).toBeNull();
  });

  it("save_decision_review 原子寫入檢討並更新決策狀態", async () => {
    const decisionId = "99999999-9999-9999-9999-999999999999";
    await insertDecision(db, decisionId, USER, ACC);
    await db.query("select save_decision_review($1, $2)", [
      decisionId,
      JSON.stringify({
        hypothesis_outcome: "假設部分成立",
        catalyst_outcome: "如期發生",
        risk_outcome: "風險未發生",
        plan_followed: true,
        decision_quality: 3,
        reflection: "流程一致",
        next_improvement: "增加估值比較",
      }),
    ]);
    expect(
      (await db.query("select status from investment_decisions where id = $1", [decisionId])).rows[0]
        .status,
    ).toBe("reviewed");
    expect(
      (await db.query("select count(*)::int as count from decision_reviews where decision_id = $1", [decisionId])).rows[0]
        .count,
    ).toBe(1);
  });

  it("save_decision_review 透過 RLS 拒絕跨使用者檢討", async () => {
    const decisionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await insertDecision(db, decisionId, USER, ACC);
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [USER_2]);
      await expect(
        db.query("select save_decision_review($1, $2)", [
          decisionId,
          JSON.stringify({
            hypothesis_outcome: "越權檢討",
            plan_followed: true,
            decision_quality: 1,
            reflection: "不應寫入",
            next_improvement: "不應寫入",
          }),
        ]),
      ).rejects.toThrow(/不存在或無權限/);
    } finally {
      await db.query("rollback");
    }
    expect(
      (await db.query("select count(*)::int as count from decision_reviews where decision_id = $1", [decisionId])).rows[0]
        .count,
    ).toBe(0);
  });

  it("同日快照重寫：upsert 覆蓋，不產生重複列", async () => {
    await call({}, null, [
      { snapshot_date: "2026-07-06", quantity: 10, unit_price: 520, fx_rate: 32, value_base: 166400 },
    ]);
    await call({}, null, [
      { snapshot_date: "2026-07-06", quantity: 10, unit_price: 525, fx_rate: 32, value_base: 168000 },
    ]);
    const rows = (
      await db.query("select value_base from account_snapshots where snapshot_date = '2026-07-06'")
    ).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].value_base)).toBe(168000);
  });

  it("原子性：流水寫入失敗 → 帳戶 patch 一併回滾", async () => {
    await expect(
      call({ quantity: 999 }, { type: "bogus_type" }, []),
    ).rejects.toThrow(/txn_type/);
    const acc = (await db.query("select quantity from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(10); // 不是 999
  });

  it("sell 語意完整：realized_pnl 與 created_at 寫進流水", async () => {
    await call(
      { quantity: 8, realized_pnl_twd: 1200 },
      {
        type: "sell",
        quantity_after: 8,
        cashflow_twd: 30000,
        realized_pnl: 1200,
        created_at: "2026-07-01T10:00:00+08:00",
        note: "賣出 2 股",
      },
      [],
    );
    const tx = (await db.query("select * from transactions where type = 'sell'")).rows[0];
    expect(Number(tx.realized_pnl)).toBe(1200);
    expect(new Date(tx.created_at).toISOString()).toBe("2026-07-01T02:00:00.000Z");
  });

  it("adjust_cost：只改成本，股數不動，現金流 0，當日快照帶校正後的成本", async () => {
    await call(
      { cost_basis_twd: 88000, cost_basis_native: 2750 },
      {
        type: "adjust_cost",
        quantity_after: 10,
        unit_price: 520,
        fx_rate: 32,
        value_after_base: 166400,
        cashflow_twd: 0,
        note: "校正成本 USD 3,125 → 2,750（TWD 100,000 → 88,000）",
      },
      [{ snapshot_date: "2026-07-06", quantity: 10, unit_price: 520, fx_rate: 32, value_base: 166400 }],
    );
    const acc = (await db.query("select * from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(10); // patch 沒帶股數，不動
    expect(Number(acc.cost_basis_twd)).toBe(88000);
    expect(Number(acc.cost_basis_native)).toBe(2750);
    const tx = (await db.query("select * from transactions")).rows;
    expect(tx).toHaveLength(1);
    expect(tx[0].type).toBe("adjust_cost");
    expect(Number(tx[0].cashflow_twd)).toBe(0);
    const snap = (await db.query("select * from account_snapshots")).rows[0];
    expect(Number(snap.cost_basis_twd)).toBe(88000);
    expect(Number(snap.cost_basis_native)).toBe(2750);
  });

  it("expected_updated_at 相符：照常寫入", async () => {
    const { updated_at } = (
      await db.query("select updated_at::text from accounts where id = $1", [ACC])
    ).rows[0];
    await call({ quantity: 4, expected_updated_at: updated_at }, null, []);
    const acc = (await db.query("select quantity from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(4);
  });

  it("expected_updated_at 不符（讀取後有別的寫入）：raise，帳戶、流水、快照都不動", async () => {
    const { updated_at } = (
      await db.query("select updated_at::text from accounts where id = $1", [ACC])
    ).rows[0];
    // 模擬 cron 定期定額在 server action 讀取之後先寫入：10 → 20 股
    await call({ quantity: 20 }, null, []);

    // server action 用先前讀到的 10 股算出賣 6 股後剩 4 股
    await expect(
      call(
        { quantity: 4, expected_updated_at: updated_at },
        { type: "sell", quantity_after: 4, cashflow_twd: 3000 },
        [{ snapshot_date: "2026-07-05", quantity: 4, unit_price: 500, fx_rate: 32, value_base: 64000 }],
      ),
    ).rejects.toThrow(/帳戶剛被其他操作更新/);

    const acc = (await db.query("select quantity from accounts where id = $1", [ACC])).rows[0];
    expect(Number(acc.quantity)).toBe(20);
    expect((await db.query("select count(*)::int as n from transactions")).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int as n from account_snapshots")).rows[0].n).toBe(0);
  });

  it("不存在的帳戶：raise，不寫任何東西", async () => {
    await expect(
      db.query("select apply_account_mutation($1, '{}', null, '[]')", [
        "99999999-9999-9999-9999-999999999999",
      ]),
    ).rejects.toThrow(/不存在或無權限/);
    expect((await db.query("select count(*)::int as n from transactions")).rows[0].n).toBe(0);
  });
});

async function insertDecision(
  db: Client,
  id: string,
  userId: string,
  accountId: string | null,
  transactionId: string | null = null,
) {
  await db.query(
    `insert into investment_decisions (
      id, user_id, account_id, transaction_id, decision_date, asset_name,
      decision_type, thesis, risks, invalidation_conditions,
      expected_holding_months, confidence, review_date, context_snapshot
    ) values ($1, $2, $3, $4, '2026-07-01', 'VOO', 'buy', '長期配置',
      '估值偏高', '基本面惡化', 24, 2, '2027-01-01', '{"value":1000}')`,
    [id, userId, accountId, transactionId],
  );
}
