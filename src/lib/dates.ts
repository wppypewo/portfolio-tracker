// 回傳 Asia/Taipei 時區的今日 YYYY-MM-DD（用 en-CA locale 取得 ISO 格式日期字串）。
export function todayTaipei(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

// 表單 datetime-local 送來的是不帶時區的「YYYY-MM-DDTHH:mm」，使用者填的是台北時間。
// 直接 new Date() 會依主機時區解析：Vercel 是 UTC，晚上補記的時間會整筆晚 8 小時、跨到隔天。
// 沒帶時區的字串補上 +08:00；已帶時區（Z 或 ±HH:mm）的照原樣解析。
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

export function parseTaipeiDateTime(input: string): Date {
  if (!NAIVE_DATETIME.test(input)) return new Date(input);
  const withTime = input.includes("T") ? input : `${input}T00:00`;
  return new Date(`${withTime}+08:00`);
}
