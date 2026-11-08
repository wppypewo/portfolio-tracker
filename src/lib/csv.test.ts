import { describe, expect, it } from "vitest";
import { escapeCsvCell, unescapeCsvCell } from "./csv";

describe("escapeCsvCell", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd", "\tformula"])(
    "neutralizes spreadsheet formulas in %s",
    (value) => {
      expect(escapeCsvCell(value)).toBe(`'${value}`);
    },
  );

  it("neutralizes formulas behind a leading carriage return", () => {
    // 含 \r 所以還會被引號包住；重點是 ' 在最前面。
    expect(escapeCsvCell("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("quotes commas, line breaks, and quotes", () => {
    expect(escapeCsvCell('A, "B"\nC')).toBe('"A, ""B""\nC"');
  });

  it("preserves ordinary text and empty values", () => {
    expect(escapeCsvCell("台股帳戶")).toBe("台股帳戶");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });
});

describe("unescapeCsvCell", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-現金", "@cmd", "\tformula"])(
    "還原 escapeCsvCell 加上的前導單引號：%s",
    (value) => {
      expect(unescapeCsvCell(`'${value}`)).toBe(value);
    },
  );

  it("其他以單引號開頭的文字原樣保留", () => {
    expect(unescapeCsvCell("'95 年存的")).toBe("'95 年存的");
    expect(unescapeCsvCell("台股帳戶")).toBe("台股帳戶");
  });
});
