import { describe, expect, it } from "vitest";
import { enrichClientFinancialRows, normalizeSearch, paginate } from "./businessQueries";

describe("moliyaviy hisob-kitoblar", () => {
  it("mijozning jami to‘lovi va joriy qarzini to‘g‘ri hisoblaydi", () => {
    const rows = [{
      id: 1,
      code: "M-001",
      name: "Test mijoz",
      phone: null,
      address: null,
      isActive: true,
      agentId: 2,
      agentName: "Test agent",
      openingDebt: 1_000_000,
      totalSales: 5_000_000,
      cashPaid: 2_000_000,
      terminalPaid: 1_500_000,
      clickPaid: 500_000,
      transactionCount: 3,
    }] as Parameters<typeof enrichClientFinancialRows>[0];

    const [result] = enrichClientFinancialRows(rows);
    expect(result.totalPaid).toBe(4_000_000);
    expect(result.currentDebt).toBe(2_000_000);
  });

  it("pagination chegaralarini xavfsiz saqlaydi", () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(page.items).toEqual([3, 4]);
    expect(page.total).toBe(5);
    expect(page.pageCount).toBe(3);
  });

  it("qidiruv matnini bo‘shliqlardan tozalab kichik harfga o‘tkazadi", () => {
    expect(normalizeSearch("  Akmal SAVDO  ")).toBe("akmal savdo");
  });
});

