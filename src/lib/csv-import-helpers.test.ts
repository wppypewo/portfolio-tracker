import { describe, expect, it } from "vitest";
import {
  classifyRow,
  findHeaderIndex,
  hasCostBasisColumns,
  HEADER_ALIASES,
  mapHeader,
  missingRequiredColumns,
  normalizeType,
  parseAmount,
  parseFlexibleDate,
  type RowFacts,
} from "./csv-import-helpers";
import { EXPORT_CSV_HEADER } from "./csv";

/**
 * 現行匯出表頭，直接取自 route 用的同一份常數——這裡是兩端脫鉤的防線，
 * 不要改成手寫副本。匯入端會先把表頭轉小寫，測試比照辦理。
 */
const EXPORT_HEADER_V2 = EXPORT_CSV_HEADER.map((h) => h.toLowerCase());

/**
 * 8b 之前的舊表頭：沒有成本基礎兩欄，你手上的舊備份檔仍是這個格式。
 * 由現行表頭減去那兩欄推導，欄位順序自動跟著現行版本走。
 */
const EXPORT_HEADER = EXPORT_HEADER_V2.filter(
  (h) => !h.startsWith("account cost basis"),
);

describe("findHeaderIndex", () => {
  it("找到第一個匹配的別名", () => {
    expect(findHeaderIndex(["日期", "帳戶", "金額"], HEADER_ALIASES.date)).toBe(0);
    expect(findHeaderIndex(["日期", "帳戶", "金額"], HEADER_ALIASES.amount)).toBe(2);
  });

  it("找不到回傳 -1", () => {
    expect(findHeaderIndex(["foo", "bar"], HEADER_ALIASES.date)).toBe(-1);
  });
});

describe("normalizeType", () => {
  it("英文別名", () => {
    expect(normalizeType("dividend")).toBe("dividend");
    expect(normalizeType("DIV")).toBe("dividend");
    expect(normalizeType(" interest ")).toBe("interest");
  });

  it("中文別名", () => {
    expect(normalizeType("配息")).toBe("dividend");
    expect(normalizeType("股息")).toBe("dividend");
    expect(normalizeType("利息")).toBe("interest");
    expect(normalizeType("存款利息")).toBe("interest");
    expect(normalizeType("校正成本")).toBe("adjust_cost");
  });

  it("無法辨識回傳 null", () => {
    // 原本這裡斷言 normalizeType("buy") === null。買賣匯入上線後 buy 是合法輸入，
    // 該斷言已移到下面的「買賣別名」測試，改斷言對應 adjust_quantity。
    expect(normalizeType("")).toBeNull();
    expect(normalizeType("foo")).toBeNull();
    expect(normalizeType("轉帳")).toBeNull();
  });

  it("買賣別名", () => {
    // 買進在 DB 沒有專屬 enum 值，一律對應 adjust_quantity。
    expect(normalizeType("buy")).toBe("adjust_quantity");
    expect(normalizeType("BUY")).toBe("adjust_quantity");
    expect(normalizeType("買進")).toBe("adjust_quantity");
    expect(normalizeType("加碼")).toBe("adjust_quantity");
    expect(normalizeType("sell")).toBe("sell");
    expect(normalizeType("賣出")).toBe("sell");
  });

  it("認得匯出檔寫的 enum 原文", () => {
    expect(normalizeType("adjust_quantity")).toBe("adjust_quantity");
    expect(normalizeType("adjust_balance")).toBe("adjust_balance");
    expect(normalizeType("adjust_cost")).toBe("adjust_cost");
    expect(normalizeType("price_update")).toBe("price_update");
    expect(normalizeType("create")).toBe("create");
    expect(normalizeType("sell")).toBe("sell");
  });
});

describe("parseAmount", () => {
  it("去除千分位逗號", () => {
    expect(parseAmount("1,200")).toBe(1200);
    expect(parseAmount("1,234,567")).toBe(1234567);
  });

  it("去除貨幣符號", () => {
    expect(parseAmount("NT$ 1200")).toBe(1200);
    expect(parseAmount("$ 50.5")).toBe(50.5);
    expect(parseAmount("￥ 100")).toBe(100);
  });

  it("純數字直接 parse", () => {
    expect(parseAmount("100")).toBe(100);
    expect(parseAmount("0.05")).toBe(0.05);
  });
});

describe("parseFlexibleDate", () => {
  it("ISO 格式", () => {
    const d = parseFlexibleDate("2025-05-01");
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe("2025-05-01");
  });

  it("斜線格式", () => {
    const d = parseFlexibleDate("2025/5/1");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
  });

  it("m/d/yyyy 格式", () => {
    const d = parseFlexibleDate("5/1/2025");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
  });

  it("無效輸入回 null", () => {
    expect(parseFlexibleDate("not a date")).toBeNull();
    expect(parseFlexibleDate("")).toBeNull();
  });

  it("有時間、沒時區：視為台北時間，不受主機時區影響", () => {
    expect(parseFlexibleDate("2025-05-01 20:00")!.toISOString()).toBe(
      "2025-05-01T12:00:00.000Z",
    );
    expect(parseFlexibleDate("2025/5/1T08:30:15")!.toISOString()).toBe(
      "2025-05-01T00:30:15.000Z",
    );
  });

  it("帶時區：照原樣（本站匯出檔的 created_at）", () => {
    expect(parseFlexibleDate("2026-03-01T02:00:00+00:00")!.toISOString()).toBe(
      "2026-03-01T02:00:00.000Z",
    );
    expect(parseFlexibleDate("2026-03-01T02:00:00.123456Z")!.toISOString()).toBe(
      "2026-03-01T02:00:00.123Z",
    );
    expect(parseFlexibleDate("2026-03-01 10:00+08:00")!.toISOString()).toBe(
      "2026-03-01T02:00:00.000Z",
    );
  });

  it("只有日期：各種寫法都落在 UTC 00:00，與舊版在 Vercel 上的結果相同", () => {
    for (const s of ["2025-05-01", "2025/5/1", "2025.5.1", "5/1/2025"]) {
      expect(parseFlexibleDate(s)!.toISOString()).toBe("2025-05-01T00:00:00.000Z");
    }
  });

  it("不存在的日期或時間回 null", () => {
    expect(parseFlexibleDate("2025-02-30")).toBeNull();
    expect(parseFlexibleDate("2/30/2025")).toBeNull();
    expect(parseFlexibleDate("2025-05-01 24:00")).toBeNull();
  });
});

describe("mapHeader", () => {
  it("對得上匯出檔的每一個欄位", () => {
    const cols = mapHeader(EXPORT_HEADER);
    expect(cols.date).toBe(0);
    expect(cols.account).toBe(1);
    expect(cols.type).toBe(5);
    expect(cols.quantityAfter).toBe(6);
    expect(cols.unitPrice).toBe(7);
    expect(cols.fxRate).toBe(8);
    expect(cols.valueBase).toBe(9);
    expect(cols.cashflow).toBe(10);
    expect(cols.realizedPnl).toBe(11);
    expect(cols.feeTwd).toBe(12);
    expect(cols.note).toBe(13);
  });

  it("帳戶欄優先取 account 而不是 symbol", () => {
    // account 的別名同時含 "account" 與 "symbol"，匯出檔兩欄都有。
    // 取錯會把整份檔案的帳戶比對成代號，全列查無帳戶。
    const cols = mapHeader(EXPORT_HEADER);
    expect(EXPORT_HEADER[cols.account]).toBe("account");
  });

  it("匯出檔沒有 amount 欄", () => {
    // 這正是舊版匯入讀不了自家匯出檔的原因：amount 找不到就直接整份退回。
    expect(mapHeader(EXPORT_HEADER).amount).toBe(-1);
  });

  it("手寫檔仍然對得上", () => {
    const cols = mapHeader(["日期", "帳戶", "類型", "金額", "備註"]);
    expect(cols.date).toBe(0);
    expect(cols.account).toBe(1);
    expect(cols.type).toBe(2);
    expect(cols.amount).toBe(3);
    expect(cols.note).toBe(4);
    expect(cols.cashflow).toBe(-1);
  });
});

describe("missingRequiredColumns", () => {
  it("匯出檔通過（金額由 cashflow 供應）", () => {
    expect(missingRequiredColumns(mapHeader(EXPORT_HEADER))).toEqual([]);
  });

  it("手寫檔通過（金額由 amount 供應）", () => {
    const cols = mapHeader(["date", "account", "type", "amount"]);
    expect(missingRequiredColumns(cols)).toEqual([]);
  });

  it("缺類型與金額時兩者都回報", () => {
    const missing = missingRequiredColumns(mapHeader(["date", "account"]));
    expect(missing).toHaveLength(2);
    expect(missing.join()).toContain("類型");
    expect(missing.join()).toContain("金額");
  });
});

describe("hasCostBasisColumns", () => {
  it("現行匯出檔沒有成本基礎", () => {
    expect(hasCostBasisColumns(mapHeader(EXPORT_HEADER))).toBe(false);
  });

  it("加了成本基礎欄之後為 true", () => {
    const cols = mapHeader(EXPORT_HEADER_V2);
    expect(hasCostBasisColumns(cols)).toBe(true);
    expect(cols.costBasisTwd).toBe(13);
    expect(cols.costBasisNative).toBe(14);
    expect(cols.note).toBe(15);
  });

  it("手寫檔不冠 Account 也認得", () => {
    const cols = mapHeader(["date", "account", "type", "amount", "成本基礎"]);
    expect(hasCostBasisColumns(cols)).toBe(true);
    expect(mapHeader(["cost basis (twd)"]).costBasisTwd).toBe(0);
  });
});

describe("匯出與匯入的表頭必須對得上", () => {
  // 這組斷言是 8a 的核心：兩端曾經默默脫鉤，讓自家匯出檔一列都匯不回來。
  // EXPORT_HEADER_V2 直接取自 route 用的常數，改匯出欄位漏改別名就會紅在這裡。
  it("現行匯出檔的必要欄位齊全，且帶得出成本基礎", () => {
    const cols = mapHeader(EXPORT_HEADER_V2);
    expect(missingRequiredColumns(cols)).toEqual([]);
    expect(hasCostBasisColumns(cols)).toBe(true);
  });

  it("每個匯出欄位都對得上一個匯入欄位鍵", () => {
    const cols = mapHeader(EXPORT_HEADER_V2);
    const mapped = new Set(Object.values(cols).filter((i) => i >= 0));
    // market / symbol / native 是匯入端用不到的欄位，其餘都應該被認領。
    // symbol 雖然在 account 的別名裡，但 account 欄先命中，所以它落在未認領這邊。
    const unclaimed = EXPORT_HEADER_V2.filter((_, i) => !mapped.has(i));
    expect(unclaimed).toEqual(["market", "symbol", "native"]);
  });
});

describe("classifyRow", () => {
  const withCost = { hasCostBasis: true };
  const noCost = { hasCostBasis: false };
  function row(over: Partial<RowFacts>): RowFacts {
    return {
      type: "dividend",
      amountTwd: null,
      quantityAfter: null,
      valueBase: null,
      ...over,
    };
  }

  it("報價更新一律略過，不算錯", () => {
    const v = classifyRow(row({ type: "price_update" }), withCost);
    expect(v.kind).toBe("skip");
  });

  it("配息有正金額就重放", () => {
    expect(classifyRow(row({ amountTwd: 1200 }), withCost).kind).toBe("apply");
    expect(classifyRow(row({ type: "interest", amountTwd: 30 }), noCost).kind).toBe(
      "apply",
    );
  });

  it("配息金額為零或負數要退回", () => {
    expect(classifyRow(row({ amountTwd: 0 }), withCost).kind).toBe("reject");
    expect(classifyRow(row({ amountTwd: -50 }), withCost).kind).toBe("reject");
    expect(classifyRow(row({ amountTwd: null }), withCost).kind).toBe("reject");
  });

  it("沒有成本基礎欄時，部位異動列全部退回，配息不受影響", () => {
    for (const type of [
      "create",
      "adjust_quantity",
      "sell",
      "adjust_balance",
      "adjust_cost",
    ] as const) {
      const v = classifyRow(row({ type, quantityAfter: 10, valueBase: 100 }), noCost);
      expect(v.kind).toBe("reject");
      expect(v.kind === "reject" && v.reason).toContain("成本基礎");
    }
    expect(classifyRow(row({ amountTwd: 1 }), noCost).kind).toBe("apply");
  });

  it("有成本基礎欄時，買賣看異動後股數", () => {
    expect(
      classifyRow(row({ type: "adjust_quantity", quantityAfter: 12.5 }), withCost).kind,
    ).toBe("apply");
    // 賣光了是合法終點，股數 0 不能當成缺值。
    expect(classifyRow(row({ type: "sell", quantityAfter: 0 }), withCost).kind).toBe(
      "apply",
    );
    expect(classifyRow(row({ type: "sell", quantityAfter: null }), withCost).kind).toBe(
      "reject",
    );
    expect(classifyRow(row({ type: "sell", quantityAfter: -1 }), withCost).kind).toBe(
      "reject",
    );
  });

  it("校正成本跟買賣同一條路：看異動後股數", () => {
    // 校正成本不動股數，quantity_after 記的是當下持有數，匯出檔一定有值。
    expect(
      classifyRow(row({ type: "adjust_cost", amountTwd: 0, quantityAfter: 10 }), withCost)
        .kind,
    ).toBe("apply");
    expect(
      classifyRow(row({ type: "adjust_cost", amountTwd: 0, quantityAfter: null }), withCost)
        .kind,
    ).toBe("reject");
  });

  it("餘額調整看市值，不看股數", () => {
    // 手動帳戶的 quantity_after 恆為 0，狀態記在 value_after_base。
    expect(
      classifyRow(
        row({ type: "adjust_balance", quantityAfter: 0, valueBase: 50000 }),
        withCost,
      ).kind,
    ).toBe("apply");
    expect(
      classifyRow(
        row({ type: "adjust_balance", quantityAfter: 0, valueBase: null }),
        withCost,
      ).kind,
    ).toBe("reject");
  });
});
