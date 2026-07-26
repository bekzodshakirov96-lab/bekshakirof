import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseDistributionWorkbook } from "./excelImport";

function makeWorkbook() {
  const workbook = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);

  add("Agentlar", [
    ["Agentlar"],
    ["№", "Agent", "Telefon", "Izoh"],
    [1, "Akmal Agent", "+998900001122", "Shimoliy hudud"],
    [2, "Akmal Agent", "+998900001133", "Yangilangan"],
  ]);
  add("Mijozlar", [
    ["Mijozlar"],
    ["№", "Kod", "Mijoz", "Agent", "Telefon", "Manzil", "Boshlang‘ich qarz"],
    [1, "M-001", "Baraka Market", "Akmal Agent", "+998901234567", "Toshkent", 750000],
  ]);
  add("Tovarlar", [
    ["Tovarlar"],
    ["№", "Kod", "Nomi", "Birlik", "Narx"],
    [1, "T-001", "Ichimlik", "dona", 12000],
  ]);
  add("Tovar_berish", [
    ["Tovar berish"],
    ["№", "Sana", "Agent", "Mijoz", "Kod", "Tovar", "Birlik", "Miqdor", "Joriy narx", "Sotuv narxi", "Jami", "Naqd", "Terminal", "Izoh"],
    [1, new Date("2026-07-20T00:00:00Z"), "Akmal Agent", "Baraka Market", "T-001", "Ichimlik", "dona", 10, 12000, 12500, 125000, 50000, 25000, "Test"],
  ]);
  add("Kassa", [
    ["Kassa"], [], [], [],
    ["№", "Sana", "Turi", "Kategoriya", "Agent", "Izoh", "Naqd", "Terminal", "Click"],
    [1, new Date("2026-07-20T00:00:00Z"), "Kirim", "Savdo", "Akmal Agent", "Kunlik tushum", 50000, 25000, 10000],
  ]);
  add("Tara_harakati", [
    ["Tara"],
    ["№", "Sana", "Agent", "Mijoz", "Tara", "Harakat", "Miqdor", "Izoh"],
    [1, new Date("2026-07-20T00:00:00Z"), "Akmal Agent", "Baraka Market", "KEG 30L", "Berildi", 3, "Test"],
  ]);

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsm" }) as Buffer;
}

describe("Excel import normalizatsiyasi", () => {
  it("barcha biznes varaqlarini to‘g‘ri parse qiladi va dublikat agentni birlashtiradi", () => {
    const parsed = parseDistributionWorkbook(makeWorkbook());

    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]).toMatchObject({ name: "Akmal Agent", phone: "+998900001133" });
    expect(parsed.clients[0]).toMatchObject({ code: "M-001", openingDebt: 750000 });
    expect(parsed.products[0]).toMatchObject({ code: "T-001", unit: "dona", price: 12000 });
    expect(parsed.transactions[0]).toMatchObject({ quantity: "10.000", totalAmount: 125000, cashPayment: 50000, terminalPayment: 25000 });
    expect(parsed.cashEntries[0]).toMatchObject({ type: "income", cashAmount: 50000, terminalAmount: 25000, clickAmount: 10000 });
    expect(parsed.containerMovements[0]).toMatchObject({ movementType: "issued", containerType: "KEG 30L", quantity: 3 });
    expect(parsed.errors).toEqual([]);
  });

  it("tartib raqami bor, lekin biznes maydonlari bo‘sh shablon qatorlarini xato deb hisoblamaydi", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Agentlar"], ["№", "Agent"], [1, ""]]), "Agentlar");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseDistributionWorkbook(buffer);
    expect(parsed.agents).toHaveLength(0);
    expect(parsed.skippedRows).toBe(0);
  });
});
