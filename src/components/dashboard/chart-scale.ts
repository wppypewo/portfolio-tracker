/**
 * 圖表座標軸刻度。純函式，與 DOM 無關。
 *
 * 改這支的動機：兩張折線圖原本都用 `[0,.25,.5,.75,1].map(t => lo + t*(hi-lo))`，
 * 也就是把資料範圍五等分。刻度因此落在 92.3萬 / 100.4萬 / 108.5萬 / 116.6萬 / 124.7萬
 * 這種位置，間距要現場心算，軸失去「一眼看出高低」的作用。
 * 改成 nice number：刻度一律落在 1 / 2 / 5 × 10^n 的倍數上。
 */

/**
 * 把一個區間長度收斂到「好看的」數字：1、2、5、10 × 10^n。
 *
 * round=false 取不小於 range 的那一級（用來決定整體跨距）；
 * round=true 取最接近的那一級（用來決定刻度間距，容許略小於理想值）。
 */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice: number;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else {
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
  }
  return nice * 10 ** exponent;
}

/** 浮點累加會讓 0.1 級距長出 1.0000000000000002，刻度標籤會露餡。 */
function tidy(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(Math.min(20, decimals)));
}

export type Scale = { lo: number; hi: number; ticks: number[] };

/**
 * 依資料上下限算出刻度與繪圖區的值域。
 *
 * 回傳的 `lo` / `hi` 就是首尾刻度，所以線一定畫在最低與最高格線之間，
 * 不會像原本那樣「軸的兩端各留 12% 空白、但那段空白沒有任何刻度」。
 * 進來前先給 5% 呼吸空間再吸附到刻度上，避免資料極值正好貼齊格線。
 *
 * @param targetCount 期望的刻度數，實際數量會因吸附而略有出入。
 */
export function niceTicks(min: number, max: number, targetCount = 5): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { lo: 0, hi: 1, ticks: [0, 1] };
  }
  if (min > max) [min, max] = [max, min];

  // 全平的序列（每天都同一個值）沒有跨距可分，自己撐開一段。
  if (max - min < Number.EPSILON * Math.max(1, Math.abs(max))) {
    const span = Math.abs(max) > 0 ? Math.abs(max) * 0.05 : 1;
    min -= span;
    max += span;
  }

  const breathe = (max - min) * 0.05;
  const rawLo = min - breathe;
  const rawHi = max + breathe;

  const count = Math.max(2, Math.round(targetCount));
  const span = niceNum(rawHi - rawLo, false);
  const step = niceNum(span / (count - 1), true);
  const lo = Math.floor(rawLo / step) * step;
  const hi = Math.ceil(rawHi / step) * step;

  const ticks: number[] = [];
  // 用索引乘法而不是累加，否則 step 為 0.1 這類值時誤差會累積。
  const total = Math.round((hi - lo) / step);
  for (let i = 0; i <= total; i += 1) ticks.push(tidy(lo + i * step, step));

  return { lo: tidy(lo, step), hi: tidy(hi, step), ticks };
}

/**
 * 挑 X 軸要標日期的資料索引。頭尾一定入選，中間平均分佈。
 *
 * 原本寫死頭／中／尾三個，6 個月的區間等於只有三個定位點，
 * 中間任何一天都無法對回日期。標籤數量改由可用寬度決定。
 */
export function pickTickIndices(length: number, maxLabels: number): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  const slots = Math.max(2, Math.min(Math.floor(maxLabels), length));
  const picked: number[] = [];
  for (let i = 0; i < slots; i += 1) {
    const index = Math.round((i / (slots - 1)) * (length - 1));
    if (picked[picked.length - 1] !== index) picked.push(index);
  }
  return picked;
}

/**
 * 依繪圖區寬度決定塞得下幾個日期標籤。
 *
 * 「02/17」在 10px 字級下約 30px 寬，每 90px 一個中心點還有三倍間隙，
 * 不會相撞。上限 7 個是為了不讓寬螢幕的軸變成密密麻麻的日期帶。
 */
export function labelCapacity(plotWidth: number): number {
  return Math.max(2, Math.min(7, Math.floor(plotWidth / 90)));
}

/**
 * 相鄰刻度差 `step` 時，要幾位小數才分得開。
 * step 0.2 → 1 位、0.05 → 2 位、1 以上 → 0 位。
 * 加 1e-9 是因為 log10(0.1) 可能算成 -0.9999999999999999，floor 後少一位。
 */
function decimalsFor(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

function stepOf(ticks: number[]): number {
  return ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0;
}

/** 純數字刻度（大盤對照的指數軸）要顯示的小數位數。整數刻度維持 0 位。 */
export function tickDecimals(ticks: number[]): number {
  return decimalsFor(stepOf(ticks));
}

function formatAxis(n: number, step: number): string {
  const abs = Math.abs(n);
  const minus = n < 0 ? "−" : "";
  const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
  // 各單位的預設小數位數不變；刻度間距比它細時才加位數。
  const digits = (base: number, unit: number) => Math.max(base, decimalsFor(step / unit));
  if (abs >= 1e8) return minus + trim((abs / 1e8).toFixed(digits(2, 1e8))) + "億";
  if (abs >= 1e4) {
    const wan = abs / 1e4;
    const str =
      wan >= 1000
        ? wan.toLocaleString("en-US", { maximumFractionDigits: digits(0, 1e4) })
        : trim(wan.toFixed(digits(1, 1e4)));
    return minus + str + "萬";
  }
  return minus + trim(abs.toFixed(digits(1, 1)));
}

/**
 * 軸刻度專用的緊湊格式（不知道刻度間距時的預設位數）。
 *
 * 與 `lib/format.ts` 的 `fmtCompact` 差別只在尾隨的 `.0`：那支刻意保留一位小數，
 * 是為了擋「相鄰刻度四捨五入後塌成同一個字串」（見 D2）。這裡把沒有意義的 `.0` 去掉，
 * 讓軸讀起來是「120萬 / 110萬 / 100萬」而不是「120.0萬 / 110.0萬」。
 * fmtCompact 現在只剩走勢圖的高點標籤在用（2026-11-27 起主要數字改顯示全額），不受影響。
 *
 * 畫軸請用 `axisLabeler`：nice number 保證刻度不同值，但不保證四捨五入後字不同。
 * 帳戶在 120 萬上下只動 2,000 元時，step 是 0.05 萬，只留一位會印出兩個「120.1萬」。
 */
export function fmtAxisValue(n: number): string {
  return formatAxis(n, 0);
}

/**
 * 依整組刻度回傳標籤函式，小數位數跟著刻度間距走，保證相鄰標籤不重複。
 * 刻度間距夠大時輸出與 `fmtAxisValue` 完全相同。
 */
export function axisLabeler(ticks: number[]): (n: number) => string {
  const step = stepOf(ticks);
  return (n) => formatAxis(n, step);
}
