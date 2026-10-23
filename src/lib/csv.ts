/**
 * /api/export/csv 的表頭。放在這裡而不是 route 內，是為了讓匯入端的測試
 * 能直接對著它斷言——route.ts 不能加額外的具名匯出（Next 會擋）。
 *
 * 匯出與匯入曾經默默脫鉤過：匯出寫 Cashflow (TWD)，匯入只認 amount，
 * 於是自家匯出檔一列都匯不回來，而且沒有任何測試會發現。
 * 改欄位時請連 HEADER_ALIASES 一起改，csv-import-helpers 的測試會擋住漏改。
 */
export const EXPORT_CSV_HEADER = [
  "Datetime",
  "Account",
  "Market",
  "Symbol",
  "Native",
  "Type",
  "Qty after",
  "Unit price (native)",
  "FX",
  "Value (TWD)",
  "Cashflow (TWD)",
  "Realized PnL (TWD)",
  "Fee (TWD)",
  "Account cost basis (TWD)",
  "Account cost basis (native)",
  "Note",
] as const;

export function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";

  let cell = String(value);
  // \r 開頭與 \t 同理：試算表會吃掉前導空白字元，接著的 = 仍被當成公式。
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;

  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }

  return cell;
}
