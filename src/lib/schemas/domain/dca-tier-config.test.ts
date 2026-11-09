import { describe, expect, it } from "vitest";
import { DEFAULT_DCA_TIER_CONFIG } from "@/lib/dca-tiers";
import {
  DEFAULT_DECISION_LEAD_DAYS,
  DcaTierConfigSchema,
  dcaTierConfigErrorMessage,
  parseStoredDcaTierConfig,
  readDcaTierConfigForm,
} from "./dca-tier-config";

/** 指標預設值的表單內容；overrides 蓋掉個別欄位。 */
function tierForm(overrides: Record<string, string> = {}): FormData {
  const fields: Record<string, string> = {
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
    tierLeadDays: "1",
    ...overrides,
  };
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
}

/** 指標預設值存進 DB 後的樣子：多了決定金額的提前天數。 */
const STORED_DEFAULT = {
  ...DEFAULT_DCA_TIER_CONFIG,
  decisionLeadDays: DEFAULT_DECISION_LEAD_DAYS,
};

const parseForm = (overrides?: Record<string, string>) =>
  DcaTierConfigSchema.safeParse(readDcaTierConfigForm(tierForm(overrides)));

const errorOf = (overrides: Record<string, string>) => {
  const parsed = parseForm(overrides);
  if (parsed.success) throw new Error("應該驗證失敗");
  return dcaTierConfigErrorMessage(parsed.error);
};

describe("DcaTierConfigSchema：表單輸入", () => {
  it("指標預設值的表單字串解析後等於 DEFAULT_DCA_TIER_CONFIG", () => {
    const parsed = parseForm();
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(STORED_DEFAULT);
  });

  it("級距順序亂填時，存成由淺到深", () => {
    const parsed = parseForm({
      tierDdPct1: "-45",
      tierDdMult1: "2",
      tierDdPct4: "-10",
      tierDdMult4: "1.25",
      tierUpPct1: "20",
      tierUpMult1: "0.8",
      tierUpPct2: "10",
      tierUpMult2: "0.9",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(STORED_DEFAULT);
  });

  it("回撤門檻填正數或 0 時拒絕，訊息指出是第幾級", () => {
    expect(errorOf({ tierDdPct2: "20" })).toBe(
      "回撤加碼第 2 級：門檻必須是負數（例：-10）",
    );
    expect(errorOf({ tierDdPct1: "0" })).toBe(
      "回撤加碼第 1 級：門檻必須是負數（例：-10）",
    );
  });

  it("欄位留空時拒絕（空字串會被 coerce 成 0）", () => {
    expect(errorOf({ tierDdPct3: "" })).toBe(
      "回撤加碼第 3 級：門檻必須是負數（例：-10）",
    );
    expect(errorOf({ tierUpMult1: "" })).toBe("高於均線減碼第 1 級：倍數需為正數");
  });

  it("回撤門檻不得到 -100", () => {
    expect(errorOf({ tierDdPct4: "-100" })).toBe(
      "回撤加碼第 4 級：門檻必須大於 -100",
    );
  });

  it("高於均線門檻填負數時拒絕", () => {
    expect(errorOf({ tierUpPct2: "-20" })).toBe(
      "高於均線減碼第 2 級：門檻必須是正數（例：10）",
    );
  });

  it("倍數必須是 0 到 10 之間的正數", () => {
    expect(errorOf({ tierDdMult1: "0" })).toBe("回撤加碼第 1 級：倍數需為正數");
    expect(errorOf({ tierDdMult1: "-1" })).toBe("回撤加碼第 1 級：倍數需為正數");
    expect(errorOf({ tierDdMult1: "10.5" })).toBe(
      "回撤加碼第 1 級：倍數不得超過 10",
    );
    expect(errorOf({ tierUpMult2: "abc" })).toBe(
      "高於均線減碼第 2 級：倍數必須是數字",
    );
  });

  it("同一側的門檻不能重複", () => {
    expect(errorOf({ tierDdPct2: "-10" })).toBe("回撤加碼的門檻不能重複");
    expect(errorOf({ tierUpPct2: "10" })).toBe("高於均線減碼的門檻不能重複");
  });

  it("提前天數：0 到 10 的整數，留空用預設值", () => {
    for (const [value, expected] of [
      ["5", 5],
      ["0", 0],
      ["10", 10],
      ["", DEFAULT_DECISION_LEAD_DAYS],
    ] as const) {
      const parsed = parseForm({ tierLeadDays: value });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.decisionLeadDays).toBe(expected);
    }
    expect(errorOf({ tierLeadDays: "11" })).toBe("提前天數必須介於 0 到 10 之間");
    expect(errorOf({ tierLeadDays: "-1" })).toBe("提前天數必須介於 0 到 10 之間");
    expect(errorOf({ tierLeadDays: "1.5" })).toBe("提前天數必須是整數");
  });

  it("均線天數必須是 20 到 500 的整數", () => {
    expect(errorOf({ tierMaLength: "19" })).toBe("均線天數必須介於 20 到 500 之間");
    expect(errorOf({ tierMaLength: "501" })).toBe(
      "均線天數必須介於 20 到 500 之間",
    );
    expect(errorOf({ tierMaLength: "200.5" })).toBe("均線天數必須是整數");
    expect(parseForm({ tierMaLength: "20" }).success).toBe(true);
    expect(parseForm({ tierMaLength: "500" }).success).toBe(true);
  });
});

describe("parseStoredDcaTierConfig：讀回 DB 的值", () => {
  it("null 是固定金額的計畫", () => {
    expect(parseStoredDcaTierConfig(null)).toEqual({ kind: "none" });
    expect(parseStoredDcaTierConfig(undefined)).toEqual({ kind: "none" });
  });

  it("存進去的設定讀得回來", () => {
    const config = { ...DEFAULT_DCA_TIER_CONFIG, decisionLeadDays: 5 };
    expect(parseStoredDcaTierConfig(config)).toEqual({ kind: "valid", config });
  });

  it("2026-11-09 前存的設定沒有提前天數：讀回來當 1", () => {
    expect(parseStoredDcaTierConfig(DEFAULT_DCA_TIER_CONFIG)).toEqual({
      kind: "valid",
      config: STORED_DEFAULT,
    });
  });

  it("沒有減碼級距的設定也算有效", () => {
    const config = { ...STORED_DEFAULT, premium: [] };
    expect(parseStoredDcaTierConfig(config)).toEqual({ kind: "valid", config });
  });

  it("格式不對時回 invalid，不拿預設值頂替", () => {
    for (const bad of [
      {},
      { maLength: 200 },
      { maLength: 200, drawdown: [], premium: [] },
      { ...DEFAULT_DCA_TIER_CONFIG, drawdown: [{ pct: 10, multiplier: 1.25 }] },
      { ...DEFAULT_DCA_TIER_CONFIG, maLength: 5 },
      "200",
      [],
    ]) {
      expect(parseStoredDcaTierConfig(bad)).toEqual({ kind: "invalid" });
    }
  });
});
