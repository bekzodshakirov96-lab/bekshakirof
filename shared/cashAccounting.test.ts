import { describe, expect, it } from "vitest";
import { summarizeCashAccounting } from "./cashAccounting";

describe("cash accounting", () => {
  it("treats Terminal and Click as income even when legacy data attached them to an expense row", () => {
    expect(summarizeCashAccounting([
      { type: "expense", cashAmount: 100_000, terminalAmount: 400_000, clickAmount: 50_000, transferAmount: 25_000 },
    ])).toEqual({
      income: 450_000,
      expense: 100_000,
      cashBalance: -100_000,
      terminal: 400_000,
      click: 50_000,
      transfer: 25_000,
    });
  });

  it("keeps pending transfers out of realized income and physical cash", () => {
    expect(summarizeCashAccounting([
      { type: "income", cashAmount: 200_000, terminalAmount: 30_000, clickAmount: 20_000, transferAmount: 500_000 },
    ])).toMatchObject({ income: 250_000, expense: 0, cashBalance: 200_000, transfer: 500_000 });
  });
});
