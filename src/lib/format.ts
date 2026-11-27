// 顯示層格式化（純呈現，無任何計算邏輯）。
// 數字格式的單一來源：同一情境用同一規則，避免「4萬」與「−4,027」混用。
//
// 規則：
// - fmtFull：全位數千分位 → hero 主數字、副指標、表格明細
// - fmtCompact：萬/億緊湊（萬帶 1 位小數避免相鄰刻度塌成同字）→ 只用在圖表上的標籤（軸、高點標記）；畫面上的主要數字一律用 fmtFull
// - fmtUpdatedAt：報價時間，台北時區、人類可讀

export const fmtFull = (n: number) => Math.round(n).toLocaleString("en-US");

// 帶正負號的台幣全位數：「+NT$ 1,234」「−NT$ 1,234」「NT$ 0」。號放在幣別前，用 U+2212。
// 先取整再判號：0.4 元的殘差顯示「NT$ 0」而不是「+NT$ 0」，−0.4 也不會變成「NT$ -0」。
export function fmtSignedTwd(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "NT$ 0";
  return `${r > 0 ? "+" : "−"}NT$ ${Math.abs(r).toLocaleString("en-US")}`;
}

// 帶正負號的百分比（輸入已是百分點）：「+1.52%」「−1.08%」「0.00%」。同樣先取位數再判號，避免「-0.00%」。
export function fmtSignedPct(pct: number, digits = 2): string {
  const s = Math.abs(pct).toFixed(digits);
  if (Number(s) === 0) return `${s}%`;
  return `${pct > 0 ? "+" : "−"}${s}%`;
}

function trimZero(str: string): string {
  return str.replace(/\.?0+$/, "");
}

export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e8) return s + trimZero((a / 1e8).toFixed(2)) + "億";
  if (a >= 1e4) {
    const w = a / 1e4;
    // 千萬級（≥1000 萬）不帶小數：「3,000萬」而非「3000.0萬」；
    // 百萬以下保留 1 位避免相鄰刻度塌成同字
    const str = w >= 1000 ? Math.round(w).toLocaleString("en-US") : w.toFixed(1);
    return s + str + "萬";
  }
  return s + Math.round(a).toLocaleString("en-US");
}

// 最多 max 位小數；null 或非有限值回傳 "—"
export const fmtNum = (n: number | null, max = 8): string =>
  n === null || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-US", { maximumFractionDigits: max });

// last_priced_at（ISO，UTC）→「2026-06-11 14:03」（Asia/Taipei）
export function fmtUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}
