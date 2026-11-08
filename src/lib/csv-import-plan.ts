/**
 * CSV 匯入的規劃層：把已解析的列算成「要寫哪些交易」與「每個帳戶的終態」。
 * 純函式、不碰 DB，方便單元測試；實際寫入在 app/activity/actions.ts。
 *
 * 核心決定：重放已記錄的狀態，不重跑當初的計算。
 * 匯出檔裡「加碼」與「股數調整」都是 adjust_quantity，語意分不出來，
 * 但兩者的終點狀態一樣，照抄 Qty after 與成本基礎就能還原。
 * 反過來若重跑 applyContribution，它會對每一列打一次即時報價，
 * 並用今天的價格把 TWD 換算成股數——匯入 2024 年的買進會算出錯誤股數。
 */

import {
  classifyRow,
  normalizeType,
  parseAmount,
  parseFlexibleDate,
  type ColumnIndex,
  type TxnType,
} from "./csv-import-helpers";
import { unescapeCsvCell } from "./csv";

/**
 * 會改變部位或成本的型別。這些列只允許寫進「還沒有任何交易」的帳戶，
 * 或「只有一筆建立紀錄」的帳戶（那筆建立紀錄會被匯入的歷史取代）。
 */
const POSITION_TYPES: ReadonlySet<TxnType> = new Set<TxnType>([
  "create",
  "adjust_quantity",
  "adjust_balance",
  // 校正成本不動股數，但設定的是成本的絕對值，跟其他部位異動同一條規則。
  "adjust_cost",
  "sell",
]);

export function isPositionType(type: TxnType): boolean {
  return POSITION_TYPES.has(type);
}

/** 一列解析完成的 CSV。數值欄缺漏或無法解析時為 null。 */
export type ImportRow = {
  /** CSV 檔中的列號（1-based，含表頭），只用於錯誤訊息。 */
  lineNo: number;
  accountName: string;
  type: TxnType;
  occurredAt: Date;
  note: string | null;
  /** 金額（TWD）。手寫檔取 amount 欄，匯出檔取 cashflow 欄。 */
  amountTwd: number | null;
  quantityAfter: number | null;
  unitPrice: number | null;
  fxRate: number | null;
  valueBase: number | null;
  realizedPnl: number | null;
  feeTwd: number | null;
  costBasisTwd: number | null;
  costBasisNative: number | null;
};

export type PlanAccount = {
  id: string;
  name: string;
  priceMarket: "us" | "tw" | "crypto" | "manual";
  quantity: number;
  manualValueBase: number | null;
  lastUnitPrice: number | null;
  lastFxRate: number | null;
  realizedPnlTwd: number;
  /** 帳戶在 DB 裡是否已有交易。有的話部位異動列一律退回（見 replaceableCreateId）。 */
  hasExistingTransactions: boolean;
  /**
   * 帳戶唯一一筆交易是 create 時，那筆交易的 id；其他情況為 null。
   * 使用者常先在介面建好帳戶、再匯入歷史，那筆 create 只是「今天投入一次」的占位。
   * 這種帳戶視為全新：匯入至少一筆部位列時，刪掉這筆 create，由匯入的歷史取代，
   * 否則 create 的投入會跟歷史裡的買進重複計入。
   */
  replaceableCreateId: string | null;
  /** 既有交易的 `型別|ISO 時間` 指紋，用於重複偵測。 */
  existingKeys: ReadonlySet<string>;
};

export type PlannedTransaction = {
  account_id: string;
  type: TxnType;
  quantity_after: number | null;
  unit_price: number | null;
  fx_rate: number | null;
  value_after_base: number | null;
  cashflow_twd: number | null;
  realized_pnl: number | null;
  fee_twd: number | null;
  note: string | null;
  created_at: string;
};

export type PlannedAccountPatch = {
  accountId: string;
  patch: Record<string, number | null>;
};

export type ImportPlan = {
  transactions: PlannedTransaction[];
  accountPatches: PlannedAccountPatch[];
  /** 要刪除的 create 交易 id：被匯入歷史取代的占位紀錄。 */
  replacedTransactionIds: string[];
  imported: number;
  skipped: number;
  errors: string[];
};

export function dedupeKey(type: TxnType, occurredAt: Date): string {
  return `${type}|${occurredAt.toISOString()}`;
}

/** 簡易 CSV line parser（支援雙引號跳脫）。 */
export function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        cols.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  cols.push(cur);
  return cols;
}

/** 取一個數值欄。欄位不存在、留空或非數字都回 null，不回 NaN。 */
function numCell(cols: string[], index: number): number | null {
  if (index < 0) return null;
  const raw = (cols[index] ?? "").trim();
  if (!raw) return null;
  const n = parseAmount(raw);
  return Number.isFinite(n) ? n : null;
}

function textCell(cols: string[], index: number): string | null {
  if (index < 0) return null;
  return unescapeCsvCell((cols[index] ?? "").trim()).trim() || null;
}

/**
 * 逐列解析成 ImportRow。日期、帳戶、型別任一不合格就在這裡退回，
 * 不進入規劃階段。lineNo 是 CSV 檔中的列號（含表頭，1-based）。
 */
export function parseRows(
  lines: string[],
  cols: ColumnIndex,
): { rows: ImportRow[]; errors: string[] } {
  const rows: ImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const lineNo = i + 1;
    const dateStr = (cells[cols.date] ?? "").trim();
    const accountName = unescapeCsvCell((cells[cols.account] ?? "").trim()).trim();
    const typeRaw = (cells[cols.type] ?? "").trim();

    if (!dateStr || !accountName) {
      errors.push(`第 ${lineNo} 列：date / account 為空`);
      continue;
    }
    const type = normalizeType(typeRaw);
    if (!type) {
      errors.push(`第 ${lineNo} 列：type「${typeRaw}」無法辨識`);
      continue;
    }
    const occurredAt = parseFlexibleDate(dateStr);
    if (!occurredAt) {
      errors.push(`第 ${lineNo} 列：date「${dateStr}」格式無效`);
      continue;
    }

    rows.push({
      lineNo,
      accountName,
      type,
      occurredAt,
      note: textCell(cells, cols.note),
      // 手寫檔用 amount，匯出檔沒有這欄、金額寫在 Cashflow (TWD)。
      amountTwd: numCell(cells, cols.amount) ?? numCell(cells, cols.cashflow),
      quantityAfter: numCell(cells, cols.quantityAfter),
      unitPrice: numCell(cells, cols.unitPrice),
      fxRate: numCell(cells, cols.fxRate),
      valueBase: numCell(cells, cols.valueBase),
      realizedPnl: numCell(cells, cols.realizedPnl),
      feeTwd: numCell(cells, cols.feeTwd),
      costBasisTwd: numCell(cells, cols.costBasisTwd),
      costBasisNative: numCell(cells, cols.costBasisNative),
    });
  }

  return { rows, errors };
}

/** 收益列的金額：優先用 realized_pnl 欄，沒有就退回金額欄。 */
function incomeAmount(row: ImportRow): number {
  const explicit = row.realizedPnl;
  if (explicit != null && Number.isFinite(explicit)) return explicit;
  return row.amountTwd ?? 0;
}

/**
 * 收益列的市值：帳戶當前市值，跟原本的手動記帳一致。
 * 配息不改變部位，這欄只是把當下的市值留在流水上。
 */
function currentValue(account: PlanAccount): number {
  if (account.priceMarket === "manual") {
    return Number(account.manualValueBase ?? 0);
  }
  return (
    Number(account.quantity) *
    Number(account.lastUnitPrice ?? 0) *
    Number(account.lastFxRate ?? 1)
  );
}

export function buildImportPlan(
  rows: ImportRow[],
  accountsByName: Map<string, PlanAccount>,
  opts: { hasCostBasis: boolean },
): ImportPlan {
  const errors: string[] = [];
  let skipped = 0;

  /** 通過所有檢查、待寫入的列，依帳戶分組。 */
  const acceptedByAccount = new Map<string, ImportRow[]>();
  /** 本次檔案內已出現過的指紋，擋同一份檔案裡自己重複的列。 */
  const seenInFile = new Set<string>();

  for (const row of rows) {
    const account = accountsByName.get(row.accountName);
    if (!account) {
      skipped++;
      errors.push(`第 ${row.lineNo} 列：找不到帳戶「${row.accountName}」`);
      continue;
    }

    const verdict = classifyRow(
      {
        type: row.type,
        amountTwd: row.amountTwd,
        quantityAfter: row.quantityAfter,
        valueBase: row.valueBase,
      },
      { hasCostBasis: opts.hasCostBasis },
    );
    if (verdict.kind === "skip") {
      // 本來就不需要重放，不算錯，也不列進錯誤訊息。
      continue;
    }
    if (verdict.kind === "reject") {
      skipped++;
      errors.push(`第 ${row.lineNo} 列：${verdict.reason}`);
      continue;
    }

    // 部位異動會設定絕對狀態。寫進已有歷史的帳戶等於用另一段歷史的終值
    // 覆蓋現況，且錯得很安靜，所以只允許寫進全新的帳戶。
    // 只有一筆 create 的帳戶算全新：那筆 create 會被匯入的歷史取代。
    const replaceable = account.replaceableCreateId != null;
    if (
      isPositionType(row.type) &&
      account.hasExistingTransactions &&
      !replaceable
    ) {
      skipped++;
      errors.push(
        `第 ${row.lineNo} 列：帳戶「${account.name}」已有交易紀錄，` +
          `部位異動只能匯入全新帳戶（或只有建立紀錄的帳戶）；配息與利息不受此限`,
      );
      continue;
    }

    const key = `${account.id}|${dedupeKey(row.type, row.occurredAt)}`;
    // 可取代的帳戶唯一的既有指紋就是那筆 create。它會被刪掉，
    // 不能拿來擋檔案裡同時間的 create，否則刪了舊的、新的又沒寫進去。
    if (
      !replaceable &&
      account.existingKeys.has(dedupeKey(row.type, row.occurredAt))
    ) {
      skipped++;
      errors.push(
        `第 ${row.lineNo} 列：同帳戶同時間已有同型別的紀錄，視為重複匯入`,
      );
      continue;
    }
    if (seenInFile.has(key)) {
      skipped++;
      errors.push(`第 ${row.lineNo} 列：檔案內有重複的列（同帳戶、同時間、同型別）`);
      continue;
    }
    seenInFile.add(key);

    const bucket = acceptedByAccount.get(account.id);
    if (bucket) bucket.push(row);
    else acceptedByAccount.set(account.id, [row]);
  }

  const accountsById = new Map<string, PlanAccount>();
  for (const account of accountsByName.values()) {
    accountsById.set(account.id, account);
  }

  const transactions: PlannedTransaction[] = [];
  const accountPatches: PlannedAccountPatch[] = [];
  const replacedTransactionIds: string[] = [];

  for (const [accountId, bucket] of acceptedByAccount) {
    const account = accountsById.get(accountId);
    if (!account) continue;

    // 依交易時間排序。賣出用平均成本法，順序錯成本就錯；
    // 而且終態取的是「最後一列」，沒排序就會取到檔案裡的最後一列而非時間上的。
    bucket.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    let realizedDelta = 0;
    let lastPositionRow: ImportRow | null = null;

    for (const row of bucket) {
      if (row.type === "dividend" || row.type === "interest") {
        const amount = incomeAmount(row);
        realizedDelta += amount;
        const label = row.type === "dividend" ? "配息" : "利息";
        transactions.push({
          account_id: accountId,
          type: row.type,
          quantity_after: account.quantity,
          unit_price: null,
          fx_rate: null,
          value_after_base: currentValue(account),
          cashflow_twd: amount,
          realized_pnl: amount,
          fee_twd: row.feeTwd,
          note: row.note
            ? `${label} ${amount} TWD · ${row.note}`
            : `${label} ${amount} TWD`,
          created_at: row.occurredAt.toISOString(),
        });
        continue;
      }

      realizedDelta += row.realizedPnl ?? 0;
      lastPositionRow = row;
      transactions.push({
        account_id: accountId,
        type: row.type,
        quantity_after: row.quantityAfter,
        unit_price: row.unitPrice,
        fx_rate: row.fxRate,
        value_after_base: row.valueBase,
        cashflow_twd: row.amountTwd,
        realized_pnl: row.realizedPnl,
        fee_twd: row.feeTwd,
        note: row.note,
        created_at: row.occurredAt.toISOString(),
      });
    }

    const patch: Record<string, number | null> = {
      realized_pnl_twd: Number(account.realizedPnlTwd ?? 0) + realizedDelta,
    };

    if (lastPositionRow && account.replaceableCreateId != null) {
      // 有部位列進來，原本那筆 create 就由匯入的歷史取代。
      // 只有配息、利息時不動它：那筆 create 仍是唯一的部位紀錄。
      replacedTransactionIds.push(account.replaceableCreateId);
    }

    if (lastPositionRow) {
      // 終態取時間上最後一列。成本基礎是帳戶當前值（匯出時每列都印同一個數字），
      // 取最後一列與取任何一列等價，取最後一列是為了語意一致。
      patch.cost_basis_twd = lastPositionRow.costBasisTwd;
      patch.cost_basis_native = lastPositionRow.costBasisNative;
      if (account.priceMarket === "manual") {
        patch.manual_value_base = lastPositionRow.valueBase;
      } else {
        patch.quantity = lastPositionRow.quantityAfter;
        // 帳戶是全新的（部位異動只允許匯進全新或只有 create 的帳戶），沒有報價就顯示為零。
        // 先用最後一列的歷史價填上，下一次刷新報價會蓋成當前價。
        patch.last_unit_price = lastPositionRow.unitPrice;
        patch.last_fx_rate = lastPositionRow.fxRate;
      }
    }

    accountPatches.push({ accountId, patch });
  }

  return {
    transactions,
    accountPatches,
    replacedTransactionIds,
    imported: transactions.length,
    skipped,
    errors,
  };
}
