import { describe, expect, it } from "vitest";
import { calculateFastKegRow, summarizeFastKegRows } from "./fastKeg";

const pricing = {
  keg30Price: 120_000,
  keg50Price: 180_000,
  keg30UnitsPerItem: 1,
  keg50UnitsPerItem: 1,
};

describe("Tezkor KEG jonli hisoblari", () => {
  it("KEG 30/50 savdosi, qaytgan tara, kassa va yakuniy qarzni bir qatorda hisoblaydi", () => {
    const result = calculateFastKegRow(
      { keg30: 2, keg50: 3, returned30: 1, returned50: 2, cash: 400_000 },
      { currentDebt: 900_000, currentKeg30Balance: 4, currentKeg50Balance: 5 },
      pricing,
    );

    expect(result.saleAmount).toBe(780_000);
    expect(result.endingDebt).toBe(1_280_000);
    expect(result.endingKeg30Balance).toBe(5);
    expect(result.endingKeg50Balance).toBe(6);
    expect(result.netKeg30).toBe(1);
    expect(result.netKeg50).toBe(1);
  });

  it("KEG 30 va KEG 50 tara qoldiqlarini o‘zaro aralashtirmaydi", () => {
    const result = calculateFastKegRow(
      { keg30: 0, keg50: 1, returned30: 2, returned50: 0, cash: 0 },
      { currentDebt: 0, currentKeg30Balance: 2, currentKeg50Balance: 0 },
      pricing,
    );

    expect(result.endingKeg30Balance).toBe(0);
    expect(result.endingKeg50Balance).toBe(1);
  });

  it("faqat kassa kiritilganda savdo yoki tara yaratmasdan qarzni kamaytiradi", () => {
    const result = calculateFastKegRow(
      { keg30: 0, keg50: 0, returned30: 0, returned50: 0, cash: 250_000 },
      { currentDebt: 700_000, currentKeg30Balance: 3, currentKeg50Balance: 2 },
      { keg30Price: 0, keg50Price: 0, keg30UnitsPerItem: 1, keg50UnitsPerItem: 1 },
    );

    expect(result.saleAmount).toBe(0);
    expect(result.endingDebt).toBe(450_000);
    expect(result.endingKeg30Balance).toBe(3);
    expect(result.endingKeg50Balance).toBe(2);
  });

  it("mahsulot tara koeffitsiyentini berilgan tara soniga qo‘llaydi", () => {
    const result = calculateFastKegRow(
      { keg30: 3, keg50: 0, returned30: 1, returned50: 0, cash: 0 },
      { currentDebt: 0, currentKeg30Balance: 0, currentKeg50Balance: 0 },
      { ...pricing, keg30UnitsPerItem: 2 },
    );

    expect(result.issued30).toBe(6);
    expect(result.endingKeg30Balance).toBe(5);
    expect(result.saleAmount).toBe(360_000);
  });

  it("bir nechta tanlangan mijozning KEG, tara, kassa, savdo va qarzini jamlaydi", () => {
    const summary = summarizeFastKegRows([
      { keg30: 2, keg50: 1, returned30: 1, returned50: 0, cash: 100, saleAmount: 500, endingDebt: 900 },
      { keg30: 0, keg50: 3, returned30: 0, returned50: 2, cash: 200, saleAmount: 700, endingDebt: 1_200 },
    ]);

    expect(summary).toEqual({
      clientCount: 2,
      keg30: 2,
      keg50: 4,
      returned30: 1,
      returned50: 2,
      cash: 300,
      saleAmount: 1_200,
      endingDebt: 2_100,
    });
  });
});
