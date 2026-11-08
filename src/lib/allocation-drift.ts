/**
 * 配置偏離：各資產類別「實際比例 − 目標比例」。
 *
 * 目標比例加總不是 100 時照比例正規化，與再平衡試算（rebalance.ts）同一個口徑。
 * 不正規化的話，只填了 stock 30、fund 20 的人，實際 70 / 30 會被算成偏離 +40 / +10，
 * 兩類都「超配」，跟試算頁顯示的 +10 / −10 互相矛盾，警示也會天天誤報。
 *
 * cron 的偏離警示（alerts-scan.ts）與警示頁顯示的「目前最大偏離」都用這支，
 * 兩邊數字必須一致，使用者才知道門檻該設多少。
 */

export type ClassDrift = {
  assetClass: string;
  /** 目前實際比例（%） */
  actualPct: number;
  /** 正規化後的目標比例（%），有設目標的類別加總為 100 */
  targetPct: number;
  /** 使用者設定的原始目標比例（%） */
  rawTargetPct: number;
  /** 實際 − 目標（百分點），正數代表超配 */
  driftPp: number;
};

/**
 * 只回傳有設目標（> 0）的類別。沒有市值或沒有任何有效目標時回空陣列。
 * 每筆持倉的市值負數或非數字視為 0，與 rebalance.ts 的 finiteNonNegative 相同。
 * @param holdings 各帳戶的資產類別與市值（TWD）
 * @param targets profiles.allocation_targets 原始值
 */
export function allocationDrifts(
  holdings: readonly { assetClass: string; valueTwd: number }[],
  targets: Record<string, unknown>,
): ClassDrift[] {
  const clean: [string, number][] = [];
  for (const [cls, raw] of Object.entries(targets)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) clean.push([cls, n]);
  }
  const targetSum = clean.reduce((s, [, n]) => s + n, 0);

  const byClass = new Map<string, number>();
  let total = 0;
  for (const h of holdings) {
    const v = Number.isFinite(h.valueTwd) && h.valueTwd > 0 ? h.valueTwd : 0;
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + v);
    total += v;
  }
  if (targetSum <= 0 || total <= 0) return [];

  return clean.map(([cls, raw]) => {
    const actualPct = ((byClass.get(cls) ?? 0) / total) * 100;
    const targetPct = (raw / targetSum) * 100;
    return {
      assetClass: cls,
      actualPct,
      targetPct,
      rawTargetPct: raw,
      driftPp: actualPct - targetPct,
    };
  });
}
