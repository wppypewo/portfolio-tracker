import { describe, expect, it } from "vitest";
import { parseTaipeiDateTime } from "./dates";

// 結果用 toISOString 比對，跟跑測試的機器時區無關。
describe("parseTaipeiDateTime", () => {
  it("datetime-local 的值當成台北時間", () => {
    expect(parseTaipeiDateTime("2026-10-22T21:30").toISOString()).toBe(
      "2026-10-22T13:30:00.000Z",
    );
  });

  it("晚上補記仍落在同一個台北日期", () => {
    const d = parseTaipeiDateTime("2026-10-22T23:59");
    expect(d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })).toBe(
      "2026-10-22",
    );
  });

  it("帶秒數的值也補台北時區", () => {
    expect(parseTaipeiDateTime("2026-10-22T08:00:30").toISOString()).toBe(
      "2026-10-22T00:00:30.000Z",
    );
  });

  it("只有日期時取台北當天 00:00", () => {
    expect(parseTaipeiDateTime("2026-10-22").toISOString()).toBe(
      "2026-10-21T16:00:00.000Z",
    );
  });

  it("已帶時區的字串照原樣解析", () => {
    expect(parseTaipeiDateTime("2026-10-22T21:30Z").toISOString()).toBe(
      "2026-10-22T21:30:00.000Z",
    );
    expect(parseTaipeiDateTime("2026-10-22T21:30+09:00").toISOString()).toBe(
      "2026-10-22T12:30:00.000Z",
    );
  });

  it("無效字串回傳 Invalid Date", () => {
    expect(Number.isNaN(parseTaipeiDateTime("not a date").getTime())).toBe(true);
  });
});
