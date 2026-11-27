import { z } from "zod";
import type { DcaTierConfig } from "@/lib/dca-tiers";

/**
 * 定期定額級距設定（recurring_plans.tier_config）的形狀。
 * 建立計畫的表單與讀回 DB 的值都走這一份：表單送來的是字串，所以數字一律 coerce。
 *
 * 範圍對照 Pine Script 的 input：均線天數 minval 20；門檻與倍數原始碼沒有上下限，
 * 這裡只擋會讓判定失去意義的值（回撤門檻不是負數、倍數不是正數）。
 * 加碼倍數小於 1、減碼倍數大於 1 不擋，那是使用者的策略。
 */

/**
 * 扣款日前幾天決定本期金額的預設值。
 * 券商的定期定額金額要在扣款日之前改好；cron 用「扣款日減這個天數」當天或之前的最後一根收盤判定級距，
 * 與使用者當時看指標面板看到的收盤一致。1 代表扣款日前一天收盤後決定。
 * 2026-11-09 之前存的設定沒有這個欄位，讀回來一律當 1。
 */
export const DEFAULT_DECISION_LEAD_DAYS = 1;
export const MAX_DECISION_LEAD_DAYS = 10;

/** 建立計畫表單固定的級數：回撤 4 級、高於均線 2 級，與指標一致。 */
export const DCA_TIER_FORM_DRAWDOWN_ROWS = 4;
export const DCA_TIER_FORM_PREMIUM_ROWS = 2;

const multiplier = z.coerce
  .number({ error: "倍數必須是數字" })
  .positive("倍數需為正數")
  .max(10, "倍數不得超過 10");

const drawdownStep = z.object({
  pct: z.coerce
    .number({ error: "門檻必須是數字" })
    .lt(0, "門檻必須是負數（例：-10）")
    .gt(-100, "門檻必須大於 -100"),
  multiplier,
});

const premiumStep = z.object({
  pct: z.coerce
    .number({ error: "門檻必須是數字" })
    .positive("門檻必須是正數（例：10）")
    .max(1000, "門檻不得超過 1000"),
  multiplier,
});

const hasUniquePcts = (steps: { pct: number }[]) =>
  new Set(steps.map((step) => step.pct)).size === steps.length;

export const DcaTierConfigSchema = z
  .object({
    maLength: z.coerce
      .number({ error: "均線天數必須是數字" })
      .int("均線天數必須是整數")
      .min(20, "均線天數必須介於 20 到 500 之間")
      .max(500, "均線天數必須介於 20 到 500 之間"),
    drawdown: z
      .array(drawdownStep)
      .min(1, "至少要有一級回撤加碼")
      .max(8, "回撤加碼最多 8 級")
      .refine(hasUniquePcts, { message: "回撤加碼的門檻不能重複" }),
    premium: z
      .array(premiumStep)
      .max(8, "高於均線減碼最多 8 級")
      .refine(hasUniquePcts, { message: "高於均線減碼的門檻不能重複" }),
    // 不是指標本身的參數，是「什麼時候看指標」：只影響 cron 取哪一根收盤。
    decisionLeadDays: z.coerce
      .number({ error: "提前天數必須是數字" })
      .int("提前天數必須是整數")
      .min(0, `提前天數必須介於 0 到 ${MAX_DECISION_LEAD_DAYS} 之間`)
      .max(MAX_DECISION_LEAD_DAYS, `提前天數必須介於 0 到 ${MAX_DECISION_LEAD_DAYS} 之間`)
      .default(DEFAULT_DECISION_LEAD_DAYS),
  })
  // 存進 DB 的順序固定由淺到深，讀的人不必猜；判定本身不依賴順序。
  .transform(
    (config): StoredTierPlanConfig => ({
      maLength: config.maLength,
      drawdown: [...config.drawdown].sort((a, b) => b.pct - a.pct),
      premium: [...config.premium].sort((a, b) => a.pct - b.pct),
      decisionLeadDays: config.decisionLeadDays,
    }),
  );

/** 存在 recurring_plans.tier_config 的內容：指標參數加上決定金額的提前天數。 */
export type StoredTierPlanConfig = DcaTierConfig & { decisionLeadDays: number };

/**
 * 表單欄位名：tierMaLength、tierDdPct1..4、tierDdMult1..4、tierUpPct1..2、tierUpMult1..2、
 * tierLeadDays。tierLeadDays 留空時用預設值（0 是有效值，不能讓空字串 coerce 成 0）。
 */
export function readDcaTierConfigForm(formData: FormData): unknown {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const rows = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => ({
      pct: field(`${prefix}Pct${i + 1}`),
      multiplier: field(`${prefix}Mult${i + 1}`),
    }));

  return {
    maLength: field("tierMaLength"),
    drawdown: rows(DCA_TIER_FORM_DRAWDOWN_ROWS, "tierDd"),
    premium: rows(DCA_TIER_FORM_PREMIUM_ROWS, "tierUp"),
    decisionLeadDays: field("tierLeadDays") || undefined,
  };
}

/** 第一個錯誤的訊息，前面補上是哪一側的第幾級，使用者才知道要改哪一格。 */
export function dcaTierConfigErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "級距設定無效";

  const [side, index] = issue.path;
  if (typeof index !== "number") return issue.message;
  if (side === "drawdown") return `回撤加碼第 ${index + 1} 級：${issue.message}`;
  if (side === "premium") return `高於均線減碼第 ${index + 1} 級：${issue.message}`;
  return issue.message;
}

export type StoredDcaTierConfig =
  | { kind: "none" }
  | { kind: "valid"; config: StoredTierPlanConfig }
  | { kind: "invalid" };

/**
 * 讀回 DB 的 tier_config。null 是固定金額的計畫；格式不對時回 invalid，
 * 由呼叫端顯示設定無效、不套用倍數，不拿預設值頂替。
 */
export function parseStoredDcaTierConfig(value: unknown): StoredDcaTierConfig {
  if (value === null || value === undefined) return { kind: "none" };
  const parsed = DcaTierConfigSchema.safeParse(value);
  return parsed.success
    ? { kind: "valid", config: parsed.data }
    : { kind: "invalid" };
}
