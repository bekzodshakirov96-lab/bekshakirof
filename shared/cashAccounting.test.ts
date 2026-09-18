import { describe, expect, it } from "vitest";
import {
  ELECTRONIC_PAYMENT_CATEGORY,
  agentSettlementAmount,
  normalizeCashReportEntries,
  summarizeCashAccounting,
} from "./cashAccounting";

describe("cash accounting", () => {
  it("adds cash, Terminal, Click and transfer to the agent settlement", () => {
    expect(agentSettlementAmount({
      type: "income",
      category: "Приход кег",
      cashAmount: 100_000,
      terminalAmount: 200_000,
      clickAmount: 300_000,
      transferAmount: 400_000,
    })).toBe(1_000_000);
  });

  it("counts legacy electronic payments without treating expense cash as agent settlement", () => {
    expect(agentSettlementAmount({
      type: "expense",
      category: "Расход",
      cashAmount: 100_000,
      terminalAmount: 200_000,
      clickAmount: 300_000,
      transferAmount: 400_000,
    })).toBe(900_000);
  });

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

  it("splits legacy mixed expense rows into cash expense and electronic payment movements", () => {
    expect(normalizeCashReportEntries([{
      id: 17,
      type: "expense",
      category: "Расход",
      cashAmount: 10_000,
      terminalAmount: 3_063_000,
      clickAmount: 0,
      transferAmount: 1_785_000,
    }])).toEqual([
      expect.objectContaining({
        reportKey: "17:cash",
        type: "expense",
        category: "Расход",
        cashAmount: 10_000,
        terminalAmount: 0,
        transferAmount: 0,
      }),
      expect.objectContaining({
        reportKey: "17:electronic",
        type: "income",
        category: ELECTRONIC_PAYMENT_CATEGORY,
        cashAmount: 0,
        terminalAmount: 3_063_000,
        transferAmount: 1_785_000,
        isElectronicSplit: true,
      }),
    ]);
  });

  it("keeps regular rows as one report movement", () => {
    expect(normalizeCashReportEntries([{
      id: 3,
      type: "expense",
      category: "Ойлик",
      cashAmount: 500_000,
      terminalAmount: 0,
      clickAmount: 0,
      transferAmount: 0,
    }])).toEqual([
      expect.objectContaining({ reportKey: "3:base", type: "expense", cashAmount: 500_000 }),
    ]);
  });
});
