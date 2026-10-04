import { describe, expect, it } from "vitest";
import { cashEntries } from "../drizzle/schema";
import { tashkentDayRange, toMySqlDate } from "./businessDay";

describe("Kassa uchun Toshkent kun chegaralari", () => {
  it("server vaqt mintaqasidan qat'i nazar mahalliy yarim tunlarni oladi", () => {
    const { start, end } = tashkentDayRange(Date.parse("2026-10-04T07:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-10-03T19:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-04T18:59:59.999Z");
    expect(tashkentDayRange(Date.parse("2026-10-03T18:59:59.999Z")).start.toISOString())
      .toBe("2026-10-02T19:00:00.000Z");
    expect(tashkentDayRange(Date.parse("2026-10-04T19:00:00.000Z")).start.toISOString())
      .toBe("2026-10-04T19:00:00.000Z");
  });

  it("xom SQL chegarasi Drizzle TIMESTAMP saqlash formati bilan mos keladi", () => {
    const start = tashkentDayRange(Date.parse("2026-10-04T07:00:00.000Z")).start;
    expect(toMySqlDate(start)).toBe("2026-10-03 19:00:00");
    expect(cashEntries.entryDate.mapToDriverValue(start)).toBe("2026-10-03 19:00:00.000");
  });
});
