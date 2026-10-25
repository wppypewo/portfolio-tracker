/**
 * 校正成本：把帳戶的成本基礎直接改成券商帳上的數字。
 * 純函式、不碰 DB 也不抓報價，server action 與表單的即時預覽共用同一份。
 *
 * 為什麼需要：新建帳戶時成本固定等於建立當下的市值
 * （app/accounts/new/actions.ts），既有部位搬進來之後成本與券商對不上。
 *
 * 校正只動 cost_basis_twd / cost_basis_native，股數、報價、已實現損益都不動，
 * 流水的 cashflow_twd 記 0。代價寫在 docs/DESIGN_NOTES.md「設計決策」：
 * 未實現損益改從實際買進成本算起，XIRR / TWR 仍從建帳戶當天的市值算起。
 */

export type CostCorrectionInput = {
  nativeCurrency: string;
  quantity: number;
  currentCostTwd: number;
  currentCostNative: number;
  /** 帳戶最後一次報價的匯率，只在沒有現有成本可推平均匯率時當退路。 */
  lastFxRate: number | null;
  /** 使用者填的原幣總成本。 */
  costNative: number;
  /** 使用者填的 TWD 總成本；null = 留空，由平均成本匯率換算。原幣是 TWD 時忽略。 */
  costTwd: number | null;
};

/** TWD 成本是怎麼決定的，用來組說明文字與流水備註。 */
export type CostFxSource = "native" | "manual" | "average" | "last";

export type CostCorrectionResult =
  | {
      ok: true;
      costTwd: number;
      costNative: number;
      /** TWD 成本 ÷ 原幣成本。 */
      fxUsed: number;
      fxSource: CostFxSource;
    }
  | { ok: false; error: string };

const MAX_COST = 100_000_000_000;

function isPositive(n: number | null): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

/**
 * 現有的平均成本匯率（TWD 成本 ÷ 原幣成本）。
 * 兩個成本任一不是正數就回 null，不回 1：回 1 會把 USD 成本直接當成 TWD。
 */
export function averageCostFx(
  costTwd: number,
  costNative: number,
): number | null {
  if (!isPositive(costTwd) || !isPositive(costNative)) return null;
  return costTwd / costNative;
}

export function resolveCostCorrection(
  input: CostCorrectionInput,
): CostCorrectionResult {
  if (!isPositive(input.quantity)) {
    return { ok: false, error: "目前沒有持有數量，沒有成本可以校正" };
  }
  if (!isPositive(input.costNative)) {
    return { ok: false, error: "總成本需為正數" };
  }
  if (input.costNative > MAX_COST) {
    return { ok: false, error: "總成本超出可接受範圍" };
  }

  // 原幣就是 TWD：兩個成本欄是同一個數字，不存在匯率。
  if (input.nativeCurrency === "TWD") {
    return {
      ok: true,
      costTwd: input.costNative,
      costNative: input.costNative,
      fxUsed: 1,
      fxSource: "native",
    };
  }

  if (input.costTwd != null) {
    if (!isPositive(input.costTwd)) {
      return { ok: false, error: "TWD 總成本需為正數" };
    }
    if (input.costTwd > MAX_COST) {
      return { ok: false, error: "TWD 總成本超出可接受範圍" };
    }
    return {
      ok: true,
      costTwd: input.costTwd,
      costNative: input.costNative,
      fxUsed: input.costTwd / input.costNative,
      fxSource: "manual",
    };
  }

  // TWD 成本留空：沿用帳戶現有的平均成本匯率。校正的是原幣成本，
  // 當初換匯的匯率沒有新資訊，維持原值才不會憑空多出或少掉匯差損益。
  const average = averageCostFx(input.currentCostTwd, input.currentCostNative);
  if (average != null) {
    return {
      ok: true,
      costTwd: input.costNative * average,
      costNative: input.costNative,
      fxUsed: average,
      fxSource: "average",
    };
  }

  if (isPositive(input.lastFxRate)) {
    return {
      ok: true,
      costTwd: input.costNative * input.lastFxRate,
      costNative: input.costNative,
      fxUsed: input.lastFxRate,
      fxSource: "last",
    };
  }

  return {
    ok: false,
    error: "帳戶沒有可用的匯率，請直接填寫 TWD 總成本",
  };
}

const fmt = (n: number, digits: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

/**
 * 流水備註。成本基礎只存在於 accounts，transactions 沒有成本欄，
 * 校正前後的數字只有寫進備註才留得下來。
 */
export function costCorrectionNote(args: {
  nativeCurrency: string;
  beforeTwd: number;
  beforeNative: number;
  afterTwd: number;
  afterNative: number;
  userNote: string | null;
}): string {
  const twd = `TWD ${fmt(args.beforeTwd, 0)} → ${fmt(args.afterTwd, 0)}`;
  const base =
    args.nativeCurrency === "TWD"
      ? `校正成本 ${twd}`
      : `校正成本 ${args.nativeCurrency} ${fmt(args.beforeNative, 2)} → ${fmt(args.afterNative, 2)}（${twd}）`;
  return args.userNote ? `${base} · ${args.userNote}` : base;
}
