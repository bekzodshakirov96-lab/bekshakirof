import { describe, expect, it } from "vitest";
import { enrichClientFinancialRows, normalizeSearch, paginate } from "./businessQueries";

/** Test uchun bitta mijoz qatori — kerakli maydonlarni ustidan yozish mumkin. */
function clientRow(overrides: Record<string, unknown> = {}) {
  return [{
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
    transferPaid: 0,
    transactionCount: 3,
    debtPaidCash: 0,
    debtPaidTerminal: 0,
    debtPaidClick: 0,
    debtPaidTransfer: 0,
    ...overrides,
  }] as Parameters<typeof enrichClientFinancialRows>[0];
}

describe("moliyaviy hisob-kitoblar", () => {
  it("mijozning jami to‘lovi va joriy qarzini to‘g‘ri hisoblaydi", () => {
    const [result] = enrichClientFinancialRows(clientRow());
    expect(result.totalPaid).toBe(4_000_000);
    expect(result.currentDebt).toBe(2_000_000);
  });

  it("alohida qabul qilingan qarz to‘lovi qarzni kamaytiradi", () => {
    // 2 000 000 qarzdan 500 000 to'landi → 1 500 000 qoladi.
    const [result] = enrichClientFinancialRows(clientRow({ debtPaidCash: 500_000 }));
    expect(result.debtPaid).toBe(500_000);
    expect(result.totalPaid).toBe(4_500_000);
    expect(result.currentDebt).toBe(1_500_000);
  });

  it("savdo to‘lovi va qarz to‘lovini alohida ko‘rsatadi", () => {
    const [result] = enrichClientFinancialRows(
      clientRow({ debtPaidTerminal: 300_000, debtPaidClick: 200_000 }),
    );
    expect(result.salePaid).toBe(4_000_000);
    expect(result.debtPaid).toBe(500_000);
  });

  it("bank o‘tkazmasi (Перечисление) ham savdo va qarz to‘lovi hisobiga qo‘shiladi", () => {
    const [result] = enrichClientFinancialRows(
      clientRow({ transferPaid: 400_000, debtPaidTransfer: 100_000 }),
    );
    expect(result.salePaid).toBe(4_400_000);
    expect(result.debtPaid).toBe(100_000);
    expect(result.currentDebt).toBe(1_500_000);
  });

  it("kanal ustunlari savdo va qarz to‘lovini birga ko‘rsatadi (Qarzdorlik jadvali uchun)", () => {
    // Mijoz savdoda 2 000 000 naqd to'lagan, keyin yana 500 000 naqd qarz to'lovi qilgan —
    // jadvaldagi "Naqd" ustuni ikkalasini ham qamrab olishi kerak, faqat savdo qismini emas.
    const [result] = enrichClientFinancialRows(clientRow({ debtPaidCash: 500_000 }));
    expect(result.cashReceived).toBe(2_500_000);
    expect(result.terminalReceived).toBe(1_500_000);
    expect(result.clickReceived).toBe(500_000);
    expect(result.transferReceived).toBe(0);
  });

  it("qarzdan ortiq to‘lov manfiy qarz (avans) beradi", () => {
    const [result] = enrichClientFinancialRows(clientRow({ debtPaidCash: 3_000_000 }));
    expect(result.currentDebt).toBe(-1_000_000);
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

