import { describe, expect, it } from "vitest";
import { averageCostByProduct, summarizeProfit } from "./costing";

describe("averageCostByProduct", () => {
  it("o'rtacha tortilgan narxni hisoblaydi", () => {
    // 200×48 000 + 150×51 000 = 17 250 000 / 350 = 49 285.7 → 49 286
    const result = averageCostByProduct([
      { productId: 1, quantity: 200, unitCost: 48_000 },
      { productId: 1, quantity: 150, unitCost: 51_000 },
    ]);
    expect(result.get(1)).toBe(49_286);
  });

  it("mahsulotlarni alohida hisoblaydi", () => {
    const result = averageCostByProduct([
      { productId: 1, quantity: 10, unitCost: 1_000 },
      { productId: 2, quantity: 10, unitCost: 5_000 },
    ]);
    expect(result.get(1)).toBe(1_000);
    expect(result.get(2)).toBe(5_000);
  });

  it("narxi kiritilmagan kirimni hisobga olmaydi", () => {
    // Narxsiz 1000 dona o'rtachani pasaytirmasligi kerak.
    const result = averageCostByProduct([
      { productId: 1, quantity: 100, unitCost: 50_000 },
      { productId: 1, quantity: 1_000, unitCost: 0 },
    ]);
    expect(result.get(1)).toBe(50_000);
  });

  it("umuman narxi yo'q mahsulotni qaytarmaydi", () => {
    const result = averageCostByProduct([{ productId: 7, quantity: 100, unitCost: 0 }]);
    expect(result.has(7)).toBe(false);
  });

  it("manfiy yoki nol miqdorni tashlab ketadi", () => {
    const result = averageCostByProduct([
      { productId: 1, quantity: 0, unitCost: 9_000 },
      { productId: 1, quantity: 10, unitCost: 2_000 },
    ]);
    expect(result.get(1)).toBe(2_000);
  });
});

describe("summarizeProfit", () => {
  it("foyda va foizni hisoblaydi", () => {
    const result = summarizeProfit([
      { totalAmount: 135_000, quantity: 2, unitCost: 49_000 },
    ]);
    expect(result.revenue).toBe(135_000);
    expect(result.cost).toBe(98_000);
    expect(result.profit).toBe(37_000);
    expect(result.marginPercent).toBeCloseTo(27.4, 1);
  });

  it("tannarxi noma'lum savdoni foydaga qo'shmaydi, lekin alohida sanaydi", () => {
    const result = summarizeProfit([
      { totalAmount: 100_000, quantity: 1, unitCost: 60_000 },
      { totalAmount: 500_000, quantity: 5, unitCost: 0 },
    ]);
    // Aylanma ikkalasini ham o'z ichiga oladi.
    expect(result.revenue).toBe(600_000);
    // Foyda esa faqat tannarxi ma'lum savdodan.
    expect(result.profit).toBe(40_000);
    expect(result.revenueWithCost).toBe(100_000);
    expect(result.linesWithoutCost).toBe(1);
    expect(result.revenueWithoutCost).toBe(500_000);
    // Foiz tannarxi ma'lum qism bo'yicha: 40 000 / 100 000 = 40%
    expect(result.marginPercent).toBeCloseTo(40, 5);
  });

  it("zarar bo'lsa manfiy foyda qaytaradi", () => {
    const result = summarizeProfit([{ totalAmount: 40_000, quantity: 1, unitCost: 50_000 }]);
    expect(result.profit).toBe(-10_000);
    expect(result.marginPercent).toBeCloseTo(-25, 5);
  });

  it("bo'sh ro'yxatda nolga bo'linmaydi", () => {
    const result = summarizeProfit([]);
    expect(result.profit).toBe(0);
    expect(result.marginPercent).toBe(0);
  });
});
