import { describe, expect, it } from "vitest";
import { reconcileExpectedTransfers, type DailyTransferTotal } from "./transferExpectation";

const row = (day: string, agentId: number | null, amount: number): DailyTransferTotal => ({ day, agentId, amount });

describe("kutilayotgan o‘tkazmalar", () => {
  it("savdo va jurnaldagi ayni kunlik summani ikki marta sanamaydi", () => {
    expect(reconcileExpectedTransfers(
      [row("2026-10-04", 7, 400_000), row("2026-10-04", 7, 600_000)],
      [],
      [row("2026-10-04", 7, 1_000_000)],
      "2026-10-04",
    )).toEqual({ today: 1_000_000, cumulative: 1_000_000 });
  });

  it("savdo va qarz to‘lovlarini birlashtirib jurnalning jami summasi bilan solishtiradi", () => {
    expect(reconcileExpectedTransfers(
      [row("2026-10-04", 7, 600_000)],
      [row("2026-10-04", 7, 400_000)],
      [row("2026-10-04", 7, 1_200_000)],
      "2026-10-04",
    )).toEqual({ today: 1_200_000, cumulative: 1_200_000 });
  });

  it("jurnalga yakka yozilgan o‘tkazma va boshqa kundagi tushumni saqlaydi", () => {
    expect(reconcileExpectedTransfers(
      [row("2026-10-03", 7, 100_000)],
      [],
      [row("2026-10-04", 7, 250_000), row("2026-10-04", 8, 350_000)],
      "2026-10-04",
    )).toEqual({ today: 600_000, cumulative: 700_000 });
  });

  it("ID bilan bog‘langan bir nechta to‘lovni aynan bir marta sanaydi", () => {
    expect(reconcileExpectedTransfers(
      [row("2026-10-04", 7, 400_000), row("2026-10-04", 7, 600_000)],
      [row("2026-10-04", 7, 200_000)],
      [{ ...row("2026-10-04", 7, 1_200_000), mode: "linked", linkedAmount: 1_200_000 }],
      "2026-10-04",
    )).toEqual({ today: 1_200_000, cumulative: 1_200_000 });
  });

  it("bog‘langan summadan ortiq mustaqil qismni qo‘shadi", () => {
    expect(reconcileExpectedTransfers(
      [row("2026-10-04", 7, 400_000)], [],
      [{ ...row("2026-10-04", 7, 550_000), mode: "linked", linkedAmount: 400_000 }],
      "2026-10-04",
    )).toEqual({ today: 550_000, cumulative: 550_000 });
  });

  it("mustaqil o‘tkazmani manbalarga qo‘shadi, eski yozuvning taxminiy usulini esa saqlaydi", () => {
    expect(reconcileExpectedTransfers(
      [row("2026-10-04", 7, 400_000)], [],
      [
        { ...row("2026-10-04", 7, 100_000), mode: "independent" },
        { ...row("2026-10-04", 7, 400_000), mode: "legacy" },
      ],
      "2026-10-04",
    )).toEqual({ today: 500_000, cumulative: 500_000 });
  });
});
