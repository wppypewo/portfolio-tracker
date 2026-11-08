import type { ScenarioHolding } from "./scenario";

/**
 * 再平衡試算：把「偏離幾個百分點」換算成「該補多少錢」。
 *
 * 只買不賣。理由有二：賣出會實現損益，台灣的海外所得要計入最低稅負制；
 * 而定期定額本來就有新資金進來，用新資金補低配的類別不必動到既有部位。
 * 所以這裡回答的是「這筆錢該怎麼分」，不是「該賣掉什麼」。
 */

export type RebalanceRow = {
  assetClass: string;
  /**
   * 目標比例（已正規化，各類加總為 100）。目標加總不是 100 時，
   * 「偏離」「差額」「本次配置」都以正規化後的比例計算，這裡跟著用同一個口徑。
   */
  targetPct: number;
  /** 使用者在設定頁填的原始目標比例（未正規化） */
  rawTargetPct: number;
  /** 目前實際比例 */
  actualPct: number;
  /** 實際 − 目標，正數代表超配 */
  driftPp: number;
  currentTwd: number;
  /** 若不投入新資金，達到目標所需的市值 */
  targetTwd: number;
  /** targetTwd − currentTwd。正數代表缺口，負數代表超額 */
  gapTwd: number;
  /** 本次投入分配到這一類的金額 */
  contributionTwd: number;
  /** 投入後的比例 */
  afterPct: number;
  /** 這一類沒有設定目標 */
  untargeted: boolean;
};

export type RebalanceResult = {
  totalTwd: number;
  contributionTwd: number;
  rows: RebalanceRow[];
  /** 目標比例加總。不是 100 時代表設定不完整 */
  targetsSumPct: number;
  /** 補完所有缺口後仍未分配的金額 */
  unallocatedTwd: number;
  /** 把所有低配類別補到目標所需的總金額 */
  totalShortfallTwd: number;
  notes: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function planRebalance({
  holdings,
  targets,
  contributionTwd = 0,
}: {
  holdings: ScenarioHolding[];
  targets: Record<string, number>;
  contributionTwd?: number;
}): RebalanceResult {
  const contribution = finiteNonNegative(contributionTwd);

  const byClass = new Map<string, number>();
  for (const h of holdings) {
    const v = finiteNonNegative(h.valueTwd);
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + v);
  }

  const cleanTargets: Record<string, number> = {};
  for (const [cls, raw] of Object.entries(targets)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) cleanTargets[cls] = n;
  }

  const totalTwd = [...byClass.values()].reduce((s, v) => s + v, 0);
  const targetsSumPct = Object.values(cleanTargets).reduce((s, v) => s + v, 0);
  const classes = [...new Set([...byClass.keys(), ...Object.keys(cleanTargets)])];

  const notes: string[] = [];
  const empty: RebalanceResult = {
    totalTwd,
    contributionTwd: contribution,
    rows: [],
    targetsSumPct,
    unallocatedTwd: contribution,
    totalShortfallTwd: 0,
    notes,
  };

  if (targetsSumPct <= 0) {
    notes.push("尚未設定任何配置目標，到設定頁填好目標比例後這裡才算得出缺口。");
    return empty;
  }
  if (totalTwd <= 0 && contribution <= 0) {
    notes.push("目前沒有可估值的持倉，也沒有輸入投入金額。");
    return empty;
  }

  /* 目標比例加總不是 100 時照比例正規化，否則「目標市值」會失真：
     例如只填了 stock 60，剩下 40 沒分配，直接乘 60% 會把總額算成 60%。
     正規化後至少各類別之間的相對關係是使用者的本意。 */
  if (Math.round(targetsSumPct) !== 100) {
    notes.push(
      `目標比例加總為 ${round2(targetsSumPct)}%，不是 100%。已按比例正規化後計算，建議回設定頁補齊。`,
    );
  }
  const weight = (cls: string) => (cleanTargets[cls] ?? 0) / targetsSumPct;

  const untargeted = classes.filter(
    (c) => !(cleanTargets[c] > 0) && (byClass.get(c) ?? 0) > 0,
  );
  if (untargeted.length > 0) {
    notes.push(
      "有持倉的類別沒有設定目標，視同目標 0%。只買不賣的前提下無法降低它們的比重。",
    );
  }

  const finalTotal = totalTwd + contribution;

  /* 缺口以「投入後的總額」為基準算，不是投入前。
     以投入前算會低估：新資金會把分母墊高，補到舊目標值仍然不夠。 */
  const need = new Map<string, number>();
  let needSum = 0;
  for (const cls of classes) {
    const idealFinal = weight(cls) * finalTotal;
    const shortfall = Math.max(0, idealFinal - (byClass.get(cls) ?? 0));
    need.set(cls, shortfall);
    needSum += shortfall;
  }

  const alloc = new Map<string, number>();
  if (contribution <= 0 || needSum <= 0) {
    for (const cls of classes) alloc.set(cls, 0);
  } else if (needSum <= contribution) {
    // 錢夠補滿所有缺口，剩下的照目標比例灑出去
    const leftover = contribution - needSum;
    for (const cls of classes) {
      alloc.set(cls, (need.get(cls) ?? 0) + leftover * weight(cls));
    }
  } else {
    // 錢不夠，照缺口大小等比例分配，優先補最缺的
    for (const cls of classes) {
      alloc.set(cls, (contribution * (need.get(cls) ?? 0)) / needSum);
    }
  }

  const allocated = [...alloc.values()].reduce((s, v) => s + v, 0);

  const rows: RebalanceRow[] = classes
    .map((cls) => {
      const currentTwd = byClass.get(cls) ?? 0;
      const contributionForClass = alloc.get(cls) ?? 0;
      const afterValue = currentTwd + contributionForClass;
      const rawTargetPct = cleanTargets[cls] ?? 0;
      const targetPct = weight(cls) * 100;
      const actualPct = totalTwd > 0 ? (currentTwd / totalTwd) * 100 : 0;
      return {
        assetClass: cls,
        targetPct: round2(targetPct),
        rawTargetPct,
        actualPct: round2(actualPct),
        driftPp: round2(actualPct - targetPct),
        currentTwd: round2(currentTwd),
        // 不投入新資金時的目標市值，用來回答「現在偏離多少錢」
        targetTwd: round2(weight(cls) * totalTwd),
        gapTwd: round2(weight(cls) * totalTwd - currentTwd),
        contributionTwd: round2(contributionForClass),
        afterPct: finalTotal > 0 ? round2((afterValue / finalTotal) * 100) : 0,
        untargeted: !(rawTargetPct > 0),
      };
    })
    .sort((a, b) => b.gapTwd - a.gapTwd || a.assetClass.localeCompare(b.assetClass));

  return {
    totalTwd: round2(totalTwd),
    contributionTwd: round2(contribution),
    rows,
    targetsSumPct: round2(targetsSumPct),
    unallocatedTwd: round2(Math.max(0, contribution - allocated)),
    totalShortfallTwd: round2(needSum),
    notes,
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}
