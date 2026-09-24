import { describe, expect, it } from "vitest";
import { formatTashkentDate, shiftDateInputValue, tashkentDateInputValue, tashkentDateToTimestamp, tashkentDayBoundary } from "./format";

describe("Toshkent biznes sanasi", () => {
  it("bir vaqtda barcha qurilmalar uchun Toshkent kalendar kunini qaytaradi", () => {
    expect(tashkentDateInputValue(new Date("2026-09-17T19:30:00.000Z"))).toBe("2026-09-18");
  });

  it("sana qiymatini qurilma vaqt mintaqasidan mustaqil vaqtga aylantiradi", () => {
    expect(tashkentDateToTimestamp("2026-09-18")).toBe(Date.parse("2026-09-18T07:00:00.000Z"));
    expect(tashkentDateToTimestamp("2026-02-30")).toBeNaN();
  });

  it("oy va yil chegaralarida kunni to'g'ri suradi", () => {
    expect(shiftDateInputValue("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateInputValue("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("hisobot chegarasiga faqat Toshkent kunidagi yozuvlarni oladi", () => {
    expect(tashkentDayBoundary("2026-09-24")).toBe(Date.parse("2026-09-23T19:00:00.000Z"));
    expect(tashkentDayBoundary("2026-09-24", true)).toBe(Date.parse("2026-09-24T18:59:59.999Z"));
    expect(formatTashkentDate("2026-09-23T19:30:00.000Z")).toBe("24.09.2026");
  });
});
