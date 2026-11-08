import { describe, expect, it } from "vitest";
import {
  buildImportPlan,
  dedupeKey,
  isPositionType,
  parseRows,
  type ImportRow,
  type PlanAccount,
} from "./csv-import-plan";
import { hasCostBasisColumns, mapHeader } from "./csv-import-helpers";
import { EXPORT_CSV_HEADER } from "./csv";

function account(over: Partial<PlanAccount> = {}): PlanAccount {
  return {
    id: "acc-1",
    name: "VT",
    priceMarket: "us",
    quantity: 100,
    manualValueBase: null,
    lastUnitPrice: 120,
    lastFxRate: 30,
    realizedPnlTwd: 0,
    hasExistingTransactions: false,
    existingKeys: new Set<string>(),
    replaceableCreateId: null,
    ...over,
  };
}

function accounts(...list: PlanAccount[]): Map<string, PlanAccount> {
  return new Map(list.map((a) => [a.name, a]));
}

let lineCounter = 0;
function row(over: Partial<ImportRow> = {}): ImportRow {
  lineCounter += 1;
  return {
    lineNo: lineCounter,
    accountName: "VT",
    type: "dividend",
    occurredAt: new Date("2026-03-01T02:00:00.000Z"),
    note: null,
    amountTwd: 1200,
    quantityAfter: null,
    unitPrice: null,
    fxRate: null,
    valueBase: null,
    realizedPnl: null,
    feeTwd: null,
    costBasisTwd: null,
    costBasisNative: null,
    ...over,
  };
}

/** 一列完整的買進，欄位比照匯出檔。 */
function buyRow(over: Partial<ImportRow> = {}): ImportRow {
  return row({
    type: "adjust_quantity",
    amountTwd: -50000,
    quantityAfter: 110,
    unitPrice: 125,
    fxRate: 30,
    valueBase: 412500,
    costBasisTwd: 400000,
    costBasisNative: 13333,
    ...over,
  });
}

const WITH_COST = { hasCostBasis: true };
const NO_COST = { hasCostBasis: false };

describe("isPositionType", () => {
  it("五種部位異動為 true，收益與報價更新為 false", () => {
    expect(isPositionType("create")).toBe(true);
    expect(isPositionType("adjust_quantity")).toBe(true);
    expect(isPositionType("adjust_balance")).toBe(true);
    expect(isPositionType("adjust_cost")).toBe(true);
    expect(isPositionType("sell")).toBe(true);
    expect(isPositionType("dividend")).toBe(false);
    expect(isPositionType("interest")).toBe(false);
    expect(isPositionType("price_update")).toBe(false);
  });
});

describe("buildImportPlan：列的取捨", () => {
  it("找不到帳戶就退回並回報列號", () => {
    const plan = buildImportPlan(
      [row({ lineNo: 7, accountName: "不存在" })],
      accounts(account()),
      WITH_COST,
    );
    expect(plan.imported).toBe(0);
    expect(plan.skipped).toBe(1);
    expect(plan.errors[0]).toContain("第 7 列");
    expect(plan.errors[0]).toContain("不存在");
  });

  it("報價更新靜默略過，不計入 skipped 也不產生錯誤訊息", () => {
    const plan = buildImportPlan(
      [row({ type: "price_update" })],
      accounts(account()),
      WITH_COST,
    );
    expect(plan.imported).toBe(0);
    expect(plan.skipped).toBe(0);
    expect(plan.errors).toEqual([]);
    expect(plan.accountPatches).toEqual([]);
  });

  it("沒有成本基礎欄時部位列退回，配息照過", () => {
    const plan = buildImportPlan(
      [buyRow(), row({ amountTwd: 800 })],
      accounts(account()),
      NO_COST,
    );
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.errors[0]).toContain("成本基礎");
    expect(plan.transactions[0].type).toBe("dividend");
  });
});

describe("buildImportPlan：部位異動只允許寫進全新帳戶", () => {
  it("帳戶已有交易時退回部位列", () => {
    const plan = buildImportPlan(
      [buyRow()],
      accounts(account({ hasExistingTransactions: true })),
      WITH_COST,
    );
    expect(plan.imported).toBe(0);
    expect(plan.skipped).toBe(1);
    expect(plan.errors[0]).toContain("已有交易紀錄");
  });

  it("校正成本設定的是成本的絕對值，帳戶已有交易時一樣退回", () => {
    const plan = buildImportPlan(
      [buyRow({ type: "adjust_cost", amountTwd: 0 })],
      accounts(account({ hasExistingTransactions: true })),
      WITH_COST,
    );
    expect(plan.imported).toBe(0);
    expect(plan.skipped).toBe(1);
    expect(plan.errors[0]).toContain("已有交易紀錄");
  });

  it("同一個已有交易的帳戶，配息仍然匯得進去", () => {
    const plan = buildImportPlan(
      [buyRow(), row({ amountTwd: 900 })],
      accounts(account({ hasExistingTransactions: true })),
      WITH_COST,
    );
    expect(plan.imported).toBe(1);
    expect(plan.transactions[0].type).toBe("dividend");
    expect(plan.skipped).toBe(1);
  });
});

describe("buildImportPlan：只有一筆 create 的帳戶視為全新", () => {
  const CREATE_AT = new Date("2026-11-08T03:00:00.000Z");
  function createOnly(over: Partial<PlanAccount> = {}): PlanAccount {
    return account({
      hasExistingTransactions: true,
      existingKeys: new Set([dedupeKey("create", CREATE_AT)]),
      replaceableCreateId: "tx-create",
      ...over,
    });
  }

  it("部位列照收，那筆 create 列入待刪除", () => {
    const plan = buildImportPlan([buyRow()], accounts(createOnly()), WITH_COST);
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(0);
    expect(plan.replacedTransactionIds).toEqual(["tx-create"]);
    expect(plan.accountPatches[0].patch.quantity).toBe(110);
  });

  it("只有配息時不取代 create", () => {
    const plan = buildImportPlan(
      [row({ amountTwd: 900 })],
      accounts(createOnly()),
      WITH_COST,
    );
    expect(plan.imported).toBe(1);
    expect(plan.replacedTransactionIds).toEqual([]);
    expect(plan.accountPatches[0].patch.quantity).toBeUndefined();
  });

  it("檔案裡同時間的 create 不算重複，否則刪了舊的、新的卻沒寫進去", () => {
    const plan = buildImportPlan(
      [buyRow({ type: "create", occurredAt: CREATE_AT })],
      accounts(createOnly()),
      WITH_COST,
    );
    expect(plan.imported).toBe(1);
    expect(plan.replacedTransactionIds).toEqual(["tx-create"]);
  });

  it("部位列全被退回時不取代 create", () => {
    const plan = buildImportPlan([buyRow()], accounts(createOnly()), NO_COST);
    expect(plan.imported).toBe(0);
    expect(plan.replacedTransactionIds).toEqual([]);
  });

  it("沒有可取代的 create（已有兩筆以上交易）時照舊退回", () => {
    const plan = buildImportPlan(
      [buyRow()],
      accounts(createOnly({ replaceableCreateId: null })),
      WITH_COST,
    );
    expect(plan.imported).toBe(0);
    expect(plan.replacedTransactionIds).toEqual([]);
    expect(plan.errors[0]).toContain("已有交易紀錄");
  });

  it("多個帳戶時只列出有部位列進來的那一個", () => {
    const other = createOnly({ id: "acc-2", name: "0050", replaceableCreateId: "tx-other" });
    const plan = buildImportPlan(
      [buyRow(), row({ accountName: "0050", amountTwd: 300 })],
      accounts(createOnly(), other),
      WITH_COST,
    );
    expect(plan.replacedTransactionIds).toEqual(["tx-create"]);
  });
});

describe("buildImportPlan：重複偵測", () => {
  it("撞到既有紀錄的指紋就跳過", () => {
    const key = dedupeKey("dividend", new Date("2026-03-01T02:00:00.000Z"));
    const plan = buildImportPlan(
      [row()],
      accounts(account({ existingKeys: new Set([key]) })),
      WITH_COST,
    );
    expect(plan.imported).toBe(0);
    expect(plan.skipped).toBe(1);
    expect(plan.errors[0]).toContain("重複匯入");
  });

  it("同一份檔案內重複的列只留第一筆", () => {
    const at = new Date("2026-03-01T02:00:00.000Z");
    const plan = buildImportPlan(
      [row({ occurredAt: at }), row({ occurredAt: at })],
      accounts(account()),
      WITH_COST,
    );
    expect(plan.imported).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.errors[0]).toContain("檔案內有重複");
  });

  it("時間不同就不算重複", () => {
    const plan = buildImportPlan(
      [
        row({ occurredAt: new Date("2026-03-01T02:00:00.000Z") }),
        row({ occurredAt: new Date("2026-06-01T02:00:00.000Z") }),
      ],
      accounts(account()),
      WITH_COST,
    );
    expect(plan.imported).toBe(2);
    expect(plan.skipped).toBe(0);
  });
});

describe("buildImportPlan：收益列", () => {
  it("金額同時寫進 cashflow 與 realized_pnl，並累加到帳戶", () => {
    const plan = buildImportPlan(
      [row({ amountTwd: 1200 }), row({ type: "interest", amountTwd: 300 })],
      accounts(account({ realizedPnlTwd: 5000 })),
      WITH_COST,
    );
    expect(plan.transactions[0].cashflow_twd).toBe(1200);
    expect(plan.transactions[0].realized_pnl).toBe(1200);
    expect(plan.accountPatches[0].patch.realized_pnl_twd).toBe(6500);
  });

  it("配息不改動部位與成本基礎", () => {
    const plan = buildImportPlan([row()], accounts(account()), WITH_COST);
    const patch = plan.accountPatches[0].patch;
    expect(patch).not.toHaveProperty("quantity");
    expect(patch).not.toHaveProperty("cost_basis_twd");
  });

  it("市值取帳戶當前價，備註帶上原註記", () => {
    const plan = buildImportPlan(
      [row({ amountTwd: 1200, note: "Q1" })],
      accounts(account({ quantity: 100, lastUnitPrice: 120, lastFxRate: 30 })),
      WITH_COST,
    );
    expect(plan.transactions[0].value_after_base).toBe(360000);
    expect(plan.transactions[0].note).toBe("配息 1200 TWD · Q1");
  });

  it("有 realized_pnl 欄時優先採用它而不是金額欄", () => {
    // 匯出檔的配息列 cashflow 與 realized_pnl 相同；手寫檔可能只有金額欄。
    const plan = buildImportPlan(
      [row({ amountTwd: 1200, realizedPnl: 1150 })],
      accounts(account()),
      WITH_COST,
    );
    expect(plan.transactions[0].realized_pnl).toBe(1150);
  });
});

describe("buildImportPlan：部位終態", () => {
  it("終態取時間上最後一列，不是檔案裡的最後一列", () => {
    const early = buyRow({
      occurredAt: new Date("2026-01-05T02:00:00.000Z"),
      quantityAfter: 50,
      costBasisTwd: 180000,
    });
    const late = buyRow({
      occurredAt: new Date("2026-05-05T02:00:00.000Z"),
      quantityAfter: 130,
      costBasisTwd: 470000,
    });
    // 故意把晚的放前面，模擬匯出檔的新到舊排序。
    const plan = buildImportPlan([late, early], accounts(account()), WITH_COST);
    const patch = plan.accountPatches[0].patch;
    expect(patch.quantity).toBe(130);
    expect(patch.cost_basis_twd).toBe(470000);
    // 交易本身依時間由舊到新寫入。
    expect(plan.transactions.map((t) => t.created_at)).toEqual([
      "2026-01-05T02:00:00.000Z",
      "2026-05-05T02:00:00.000Z",
    ]);
  });

  it("最後一列是校正成本：股數照抄、成本取校正後的值、現金流維持 0", () => {
    const plan = buildImportPlan(
      [
        buyRow({
          occurredAt: new Date("2026-01-05T02:00:00.000Z"),
          quantityAfter: 110,
          costBasisTwd: 365000,
          costBasisNative: 12100,
        }),
        buyRow({
          type: "adjust_cost",
          occurredAt: new Date("2026-02-05T02:00:00.000Z"),
          amountTwd: 0,
          quantityAfter: 110,
          costBasisTwd: 365000,
          costBasisNative: 12100,
        }),
      ],
      accounts(account({ realizedPnlTwd: 1000 })),
      WITH_COST,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.transactions.map((t) => t.type)).toEqual([
      "adjust_quantity",
      "adjust_cost",
    ]);
    expect(plan.transactions[1].cashflow_twd).toBe(0);
    const patch = plan.accountPatches[0].patch;
    expect(patch.quantity).toBe(110);
    expect(patch.cost_basis_twd).toBe(365000);
    expect(patch.cost_basis_native).toBe(12100);
    // 校正成本沒有已實現損益，帳戶原值不動。
    expect(patch.realized_pnl_twd).toBe(1000);
  });

  it("賣出的已實現損益累加進帳戶", () => {
    const plan = buildImportPlan(
      [
        buyRow({ occurredAt: new Date("2026-01-05T02:00:00.000Z") }),
        buyRow({
          type: "sell",
          occurredAt: new Date("2026-02-05T02:00:00.000Z"),
          quantityAfter: 60,
          amountTwd: 90000,
          realizedPnl: 12000,
          costBasisTwd: 210000,
        }),
      ],
      accounts(account({ realizedPnlTwd: 1000 })),
      WITH_COST,
    );
    expect(plan.accountPatches[0].patch.realized_pnl_twd).toBe(13000);
    expect(plan.accountPatches[0].patch.quantity).toBe(60);
    expect(plan.accountPatches[0].patch.cost_basis_twd).toBe(210000);
  });

  it("非手動帳戶順便補上最後一列的價格，讓匯入後不會顯示為零", () => {
    const plan = buildImportPlan(
      [buyRow({ unitPrice: 125, fxRate: 30.5 })],
      accounts(account({ lastUnitPrice: null, lastFxRate: null })),
      WITH_COST,
    );
    expect(plan.accountPatches[0].patch.last_unit_price).toBe(125);
    expect(plan.accountPatches[0].patch.last_fx_rate).toBe(30.5);
  });

  it("手動帳戶寫 manual_value_base，不寫 quantity", () => {
    const plan = buildImportPlan(
      [
        buyRow({
          type: "adjust_balance",
          quantityAfter: 0,
          valueBase: 88000,
          costBasisTwd: 88000,
          costBasisNative: 88000,
        }),
      ],
      accounts(account({ priceMarket: "manual", manualValueBase: 50000 })),
      WITH_COST,
    );
    const patch = plan.accountPatches[0].patch;
    expect(patch.manual_value_base).toBe(88000);
    expect(patch).not.toHaveProperty("quantity");
    expect(patch).not.toHaveProperty("last_unit_price");
  });

  it("多個帳戶各自算各自的終態", () => {
    const vt = account({ id: "acc-1", name: "VT" });
    const cash = account({
      id: "acc-2",
      name: "現金",
      priceMarket: "manual",
      manualValueBase: 10000,
    });
    const plan = buildImportPlan(
      [
        buyRow({ accountName: "VT", quantityAfter: 200, costBasisTwd: 600000 }),
        row({ accountName: "現金", type: "interest", amountTwd: 45 }),
      ],
      accounts(vt, cash),
      WITH_COST,
    );
    expect(plan.accountPatches).toHaveLength(2);
    const byId = new Map(plan.accountPatches.map((p) => [p.accountId, p.patch]));
    expect(byId.get("acc-1")!.quantity).toBe(200);
    expect(byId.get("acc-2")!.realized_pnl_twd).toBe(45);
    expect(byId.get("acc-2")).not.toHaveProperty("quantity");
  });
});

/**
 * 往返測試：照 /api/export/csv 的方式組一份匯出檔，走完整條匯入管線，
 * 檢查算出來的帳戶終態等於匯出當下的狀態。
 *
 * 沒有 DB 也沒有跑起來的站台，這是目前能做到最接近端對端的驗證。
 * 它涵蓋不到的部分：實際的 insert / update 是否成功、RLS 是否放行。
 */
describe("往返：匯出檔 → 匯入 → 帳戶終態", () => {
  /** 匯出時帳戶的當前狀態，也是匯入後應該回到的狀態。 */
  const FINAL = {
    quantity: 60,
    costBasisTwd: 218942.31,
    costBasisNative: 7298.08,
    realizedTotal: 18200,
  };

  /**
   * 組一列匯出格式的 CSV。欄位順序比照 EXPORT_CSV_HEADER。
   * 成本基礎兩欄刻意每列都填同一個值——匯出是從 accounts join 出來的當前值，
   * 不是該筆交易當下的值，這正是決策 (A) 的形狀。
   */
  function exportLine(over: {
    at: string;
    type: string;
    qtyAfter?: number | "";
    unitPrice?: number | "";
    fx?: number | "";
    value?: number | "";
    cashflow?: number | "";
    realized?: number | "";
    fee?: number | "";
    note?: string;
  }): string {
    return [
      over.at,
      "VT",
      "us",
      "VT",
      "USD",
      over.type,
      over.qtyAfter ?? "",
      over.unitPrice ?? "",
      over.fx ?? "",
      over.value ?? "",
      over.cashflow ?? "",
      over.realized ?? "",
      over.fee ?? "",
      FINAL.costBasisTwd,
      FINAL.costBasisNative,
      over.note ?? "",
    ].join(",");
  }

  // 匯出是 created_at 由新到舊，所以檔案裡最上面是最晚的那筆。
  const EXPORT_LINES = [
    EXPORT_CSV_HEADER.join(","),
    exportLine({
      at: "2026-06-10T02:00:00.000Z",
      type: "sell",
      qtyAfter: 60,
      unitPrice: 130,
      fx: 30,
      value: 234000,
      cashflow: 273000,
      realized: 17000,
      fee: 30,
      note: "賣出 70 股",
    }),
    exportLine({
      at: "2026-05-05T02:00:00.000Z",
      type: "adjust_quantity",
      qtyAfter: 130,
      unitPrice: 125,
      fx: 30.5,
      value: 495625,
      cashflow: -114375,
      note: "加碼 114375 TWD",
    }),
    exportLine({
      at: "2026-03-01T02:00:00.000Z",
      type: "dividend",
      qtyAfter: 100,
      value: 360000,
      cashflow: 1200,
      realized: 1200,
    }),
    exportLine({
      at: "2026-01-05T02:00:00.000Z",
      type: "create",
      qtyAfter: 100,
      unitPrice: 120,
      fx: 30,
      value: 360000,
      cashflow: -360000,
    }),
  ];

  /** 匯入的目標：一個全新的空帳戶。 */
  function freshTarget(): Map<string, PlanAccount> {
    return accounts(
      account({
        quantity: 0,
        lastUnitPrice: null,
        lastFxRate: null,
        realizedPnlTwd: 0,
        hasExistingTransactions: false,
      }),
    );
  }

  it("表頭認得，成本基礎帶得回來", () => {
    const cols = mapHeader(EXPORT_CSV_HEADER.map((h) => h.toLowerCase()));
    expect(hasCostBasisColumns(cols)).toBe(true);
    const { rows, errors } = parseRows(EXPORT_LINES, cols);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
  });

  it("四列全部匯入，終態回到匯出當下的狀態", () => {
    const cols = mapHeader(EXPORT_CSV_HEADER.map((h) => h.toLowerCase()));
    const { rows } = parseRows(EXPORT_LINES, cols);
    const plan = buildImportPlan(rows, freshTarget(), { hasCostBasis: true });

    expect(plan.errors).toEqual([]);
    expect(plan.skipped).toBe(0);
    expect(plan.imported).toBe(4);

    const patch = plan.accountPatches[0].patch;
    expect(patch.quantity).toBe(FINAL.quantity);
    expect(patch.cost_basis_twd).toBe(FINAL.costBasisTwd);
    expect(patch.cost_basis_native).toBe(FINAL.costBasisNative);
    expect(patch.realized_pnl_twd).toBe(FINAL.realizedTotal);
  });

  it("匯出是新到舊，寫入時排回舊到新", () => {
    const cols = mapHeader(EXPORT_CSV_HEADER.map((h) => h.toLowerCase()));
    const { rows } = parseRows(EXPORT_LINES, cols);
    const plan = buildImportPlan(rows, freshTarget(), { hasCostBasis: true });
    expect(plan.transactions.map((t) => t.type)).toEqual([
      "create",
      "dividend",
      "adjust_quantity",
      "sell",
    ]);
  });

  it("手續費與備註原封帶過去", () => {
    const cols = mapHeader(EXPORT_CSV_HEADER.map((h) => h.toLowerCase()));
    const { rows } = parseRows(EXPORT_LINES, cols);
    const plan = buildImportPlan(rows, freshTarget(), { hasCostBasis: true });
    const sell = plan.transactions.find((t) => t.type === "sell")!;
    expect(sell.fee_twd).toBe(30);
    expect(sell.note).toBe("賣出 70 股");
    expect(sell.cashflow_twd).toBe(273000);
    expect(sell.realized_pnl).toBe(17000);
  });

  it("同一份檔案匯第二次會被指紋整份擋下", () => {
    const cols = mapHeader(EXPORT_CSV_HEADER.map((h) => h.toLowerCase()));
    const { rows } = parseRows(EXPORT_LINES, cols);
    const first = buildImportPlan(rows, freshTarget(), { hasCostBasis: true });

    // 模擬第一次匯入之後的帳戶：有交易了，指紋也記下來了。
    const after = accounts(
      account({
        quantity: FINAL.quantity,
        realizedPnlTwd: FINAL.realizedTotal,
        hasExistingTransactions: true,
        existingKeys: new Set(
          first.transactions.map((t) =>
            dedupeKey(t.type, new Date(t.created_at)),
          ),
        ),
      }),
    );
    const second = buildImportPlan(rows, after, { hasCostBasis: true });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(4);
  });

  it("8b 之前的舊備份檔：配息進得去，部位列全退回", () => {
    // 舊檔沒有成本基礎兩欄，其餘欄位順序不變。
    const legacyHeader = EXPORT_CSV_HEADER.map((h) => h.toLowerCase()).filter(
      (h) => !h.startsWith("account cost basis"),
    );
    const legacyLines = EXPORT_LINES.slice(1).map((line) => {
      const cells = line.split(",");
      return [...cells.slice(0, 13), cells[15]].join(",");
    });
    const cols = mapHeader(legacyHeader);
    expect(hasCostBasisColumns(cols)).toBe(false);

    const { rows } = parseRows([legacyHeader.join(","), ...legacyLines], cols);
    const plan = buildImportPlan(rows, freshTarget(), { hasCostBasis: false });
    expect(plan.imported).toBe(1);
    expect(plan.transactions[0].type).toBe("dividend");
    expect(plan.skipped).toBe(3);
    expect(plan.errors.every((e) => e.includes("成本基礎"))).toBe(true);
  });
});

describe("parseRows：自家匯出檔的防公式前綴", () => {
  it("帳戶名稱與備註去掉匯出時加的前導單引號", () => {
    const cols = mapHeader(EXPORT_CSV_HEADER.map((h) => h.toLowerCase()));
    const line = [
      "2026-01-02T00:00:00Z",
      "'-現金部位",
      "manual",
      "",
      "TWD",
      "create",
      "1",
      "1",
      "1",
      "1000",
      "1000",
      "0",
      "0",
      "1000",
      "1000",
      "'=加碼",
    ].join(",");
    const { rows, errors } = parseRows([EXPORT_CSV_HEADER.join(","), line], cols);
    expect(errors).toEqual([]);
    expect(rows[0].accountName).toBe("-現金部位");
    expect(rows[0].note).toBe("=加碼");
  });
});
