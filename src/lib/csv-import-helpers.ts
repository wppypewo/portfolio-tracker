/**
 * CSV 匯入用的小工具：欄位嗅探、類型別名、日期容錯、列別判定。
 * 抽出來方便單元測試（"use server" 檔不能 export 非 async function）。
 */

/**
 * transactions.type 的完整 enum。
 * 前四個來自 supabase/schema.sql，sell / dividend / interest 由 realized-pnl-cashflow.sql 補上，
 * adjust_cost 由 migrations/20260930120000_adjust_cost_type.sql 補上。
 * 注意「買進」在 DB 裡沒有專屬型別，一律記成 adjust_quantity，
 * 跟手動「股數調整」共用同一個值，靠 note 才分得出來。
 */
export type TxnType =
  | "create"
  | "adjust_quantity"
  | "adjust_balance"
  | "adjust_cost"
  | "price_update"
  | "sell"
  | "dividend"
  | "interest";

export type HeaderKey =
  | "date"
  | "account"
  | "type"
  | "amount"
  | "note"
  | "cashflow"
  | "quantityAfter"
  | "unitPrice"
  | "fxRate"
  | "valueBase"
  | "realizedPnl"
  | "feeTwd"
  | "costBasisTwd"
  | "costBasisNative";

/**
 * 表頭別名。比對前表頭會先 trim + toLowerCase，所以這裡一律小寫。
 * 前五組是原本手寫檔用的欄位，維持原樣不動；
 * 後九組對應 /api/export/csv 的輸出表頭，補上才能把匯出檔讀回來。
 */
export const HEADER_ALIASES: Record<HeaderKey, string[]> = {
  date: ["date", "日期", "成交日", "交易日", "datetime", "時間"],
  account: ["account", "帳戶", "帳戶名稱", "標的", "symbol", "代號"],
  type: ["type", "類型", "類別", "種類"],
  amount: [
    "amount_twd",
    "amount",
    "金額",
    "金額(twd)",
    "金額(ntd)",
    "twd",
    "金額_twd",
  ],
  note: ["note", "備註", "說明", "memo"],
  cashflow: ["cashflow (twd)", "cashflow_twd", "cashflow", "現金流"],
  quantityAfter: ["qty after", "quantity_after", "qty_after", "異動後股數"],
  unitPrice: ["unit price (native)", "unit_price", "unit price", "單價", "成交價"],
  fxRate: ["fx", "fx_rate", "匯率"],
  valueBase: ["value (twd)", "value_after_base", "市值"],
  realizedPnl: ["realized pnl (twd)", "realized_pnl", "已實現損益"],
  feeTwd: ["fee (twd)", "fee_twd", "fee", "手續費"],
  // 冠 Account 是因為這是帳戶當前的成本基礎，不是該筆交易當下的值
  // （transactions 表沒有成本基礎欄，逐筆歷史值不存在）。
  // 不冠 Account 的寫法保留下來，讓手寫檔也能用。
  costBasisTwd: [
    "account cost basis (twd)",
    "cost basis (twd)",
    "cost_basis_twd",
    "成本基礎",
  ],
  costBasisNative: [
    "account cost basis (native)",
    "cost basis (native)",
    "cost_basis_native",
    "成本基礎(原幣)",
  ],
};

export function findHeaderIndex(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = header.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * 型別別名 → txn_type。
 * 匯出檔寫的是 enum 原文（adjust_quantity、sell…），手寫檔多半寫中文或 buy/sell，
 * 兩邊都要認。買進沒有專屬 enum 值，對應到 adjust_quantity。
 * 別名一律用完整字詞，不收 b / s 這種單字母縮寫——太容易把雜訊誤判成交易。
 */
const TYPE_ALIASES: Record<TxnType, string[]> = {
  create: ["create", "建立", "開戶"],
  adjust_quantity: [
    "adjust_quantity",
    "buy",
    "purchase",
    "買進",
    "買",
    "加碼",
    "股數調整",
  ],
  adjust_balance: ["adjust_balance", "balance", "餘額調整", "修改餘額"],
  adjust_cost: ["adjust_cost", "校正成本", "成本校正"],
  price_update: ["price_update", "price update", "報價更新", "更新報價"],
  sell: ["sell", "sold", "賣出", "賣", "減碼"],
  dividend: ["dividend", "div", "配息", "股息", "息收"],
  interest: ["interest", "int", "利息", "存款利息"],
};

export function normalizeType(raw: string): TxnType | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  for (const [type, aliases] of Object.entries(TYPE_ALIASES) as [
    TxnType,
    string[],
  ][]) {
    if (aliases.includes(s)) return type;
  }
  return null;
}

// 金額欄位可能含千分位逗號、NT$、$、空白等，先洗一次再 Number()
export function parseAmount(raw: string): number {
  const cleaned = raw.trim().replace(/[,\s$NT￥]/g, "");
  return Number(cleaned);
}

// 接受多種日期寫法：ISO 2025-05-01、2025/5/1、5/1/2025、2025.5.1，可帶時間（空白或 T 分隔）。
//
// 結果不能依主機時區而定：舊版直接 new Date()，「2025-05-01 20:00」在 Vercel（UTC）會被當成
// 20:00Z = 台北隔天 04:00，「2025/5/1」在 UTC 與台北主機上也會差 8 小時。規則改成：
//   - 帶時區（Z 或 ±HH:mm，例如本站匯出檔的 created_at）：照原樣。
//   - 有時間、沒時區：視為台北時間。
//   - 只有日期：存成 UTC 00:00（= 台北當天 08:00）。這是舊版在 Vercel 上的結果，
//     重複匯入同一份檔案時，去重鍵（精確到毫秒）才對得上已經匯入過的列。
const YMD_DATE =
  /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const MDY_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
const TAIPEI_OFFSET_MIN = 8 * 60;

function buildDate(
  y: number,
  mo: number,
  d: number,
  time: { h: number; mi: number; sec: number; ms: number } | null,
  tz: string | undefined,
): Date | null {
  // Date.UTC 會把 2/30 進位成 3/2，先確認日期真的存在
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (
    day.getUTCFullYear() !== y ||
    day.getUTCMonth() !== mo - 1 ||
    day.getUTCDate() !== d
  ) {
    return null;
  }
  const t = time ?? { h: 0, mi: 0, sec: 0, ms: 0 };
  if (t.h > 23 || t.mi > 59 || t.sec > 59) return null;

  let offsetMin = 0;
  if (tz && tz.toUpperCase() !== "Z") {
    const m = tz.match(/^([+-])(\d{2}):?(\d{2})$/)!;
    offsetMin = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } else if (!tz && time) {
    offsetMin = TAIPEI_OFFSET_MIN;
  }
  const utcMs = Date.UTC(y, mo - 1, d, t.h, t.mi, t.sec, t.ms);
  return new Date(utcMs - offsetMin * 60_000);
}

export function parseFlexibleDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  const ymd = s.match(YMD_DATE);
  if (ymd) {
    const [, y, mo, d, h, mi, sec, frac, tz] = ymd;
    const time =
      h === undefined
        ? null
        : {
            h: Number(h),
            mi: Number(mi),
            sec: Number(sec ?? 0),
            ms: Number((frac ?? "").slice(0, 3).padEnd(3, "0")),
          };
    // 有時區卻沒時間（例如「2025-05-01Z」）不是合法寫法
    if (tz && !time) return null;
    return buildDate(Number(y), Number(mo), Number(d), time, tz);
  }

  const mdy = s.match(MDY_DATE);
  if (mdy) {
    return buildDate(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]), null, undefined);
  }

  // 其他寫法（例如「May 1, 2025」）交給 Date 解析；沒帶時區時仍依主機時區，結果僅供參考
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 每個欄位在表頭中的位置，找不到為 -1。 */
export type ColumnIndex = Record<HeaderKey, number>;

export function mapHeader(header: string[]): ColumnIndex {
  const out = {} as ColumnIndex;
  for (const key of Object.keys(HEADER_ALIASES) as HeaderKey[]) {
    out[key] = findHeaderIndex(header, HEADER_ALIASES[key]);
  }
  return out;
}

/**
 * 必要欄位：日期、帳戶、類型，加上金額擇一。
 * 金額接受 amount（手寫檔）或 cashflow（匯出檔）——匯出檔沒有 amount 欄，
 * 這是舊版匯入完全讀不了自家匯出檔的原因。
 * 回傳缺少欄位的中文說明，空陣列代表通過。
 */
export function missingRequiredColumns(cols: ColumnIndex): string[] {
  const missing: string[] = [];
  if (cols.date < 0) missing.push("日期（date / Datetime）");
  if (cols.account < 0) missing.push("帳戶（account / Account）");
  if (cols.type < 0) missing.push("類型（type / Type）");
  if (cols.amount < 0 && cols.cashflow < 0) {
    missing.push("金額（amount / Cashflow (TWD)）");
  }
  return missing;
}

/**
 * 檔案有沒有帶成本基礎。沒有的話部位異動列還原不出正確的成本，
 * 只能匯配息與利息（見 classifyRow）。
 */
export function hasCostBasisColumns(cols: ColumnIndex): boolean {
  return cols.costBasisTwd >= 0;
}

export type RowFacts = {
  type: TxnType;
  /** 金額（TWD）。手寫檔取 amount 欄，匯出檔取 cashflow 欄。 */
  amountTwd: number | null;
  quantityAfter: number | null;
  valueBase: number | null;
};

export type RowVerdict =
  | { kind: "apply" }
  | { kind: "skip"; reason: string }
  | { kind: "reject"; reason: string };

/**
 * 判斷一列該不該重放。
 *
 * skip 與 reject 的差別：skip 是這列本來就不需要重放（不算錯，不列入錯誤訊息）；
 * reject 是這列想重放但資料不足（計入 skipped 並回報原因）。
 *
 * 重放的是「已記錄的狀態」而不是重跑一次加碼／賣出的計算：
 * 匯出檔裡加碼與股數調整都是 adjust_quantity，語意分不出來，但終點狀態一樣，
 * 照抄 Qty after 與成本基礎就能還原，不必知道當初是哪個操作。
 */
export function classifyRow(
  row: RowFacts,
  opts: { hasCostBasis: boolean },
): RowVerdict {
  if (row.type === "price_update") {
    return { kind: "skip", reason: "報價更新不改變部位或成本" };
  }

  if (row.type === "dividend" || row.type === "interest") {
    if (
      row.amountTwd == null ||
      !Number.isFinite(row.amountTwd) ||
      row.amountTwd <= 0
    ) {
      return { kind: "reject", reason: "配息／利息的金額須為正數" };
    }
    return { kind: "apply" };
  }

  // 以下都會改變部位或成本，沒有成本基礎欄就還原不了。
  if (!opts.hasCostBasis) {
    return {
      kind: "reject",
      reason:
        "檔案缺少成本基礎欄（Cost basis (TWD)），部位異動無法還原；此檔只能匯入配息與利息",
    };
  }

  // 手動帳戶的狀態載體是市值不是股數（adjust_balance 的 quantity_after 恆為 0）。
  if (row.type === "adjust_balance") {
    if (
      row.valueBase == null ||
      !Number.isFinite(row.valueBase) ||
      row.valueBase < 0
    ) {
      return { kind: "reject", reason: "餘額調整缺少有效的市值（Value (TWD)）" };
    }
    return { kind: "apply" };
  }

  if (
    row.quantityAfter == null ||
    !Number.isFinite(row.quantityAfter) ||
    row.quantityAfter < 0
  ) {
    return { kind: "reject", reason: "缺少有效的異動後股數（Qty after）" };
  }
  return { kind: "apply" };
}
