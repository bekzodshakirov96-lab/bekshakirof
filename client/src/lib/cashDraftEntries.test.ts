import { describe, expect, it } from "vitest";
import { CASH_DRAFT_ENTRY_CATEGORIES, PAYMENT_CHANNEL_CATEGORY, cashDraftEntryAmounts } from "./cashDraftEntries";

describe("cash journal draft entries", () => {
  it("stores electronic channels exactly once when several cash categories are filled", () => {
    const draft = {
      amounts: { "Приход кег": "100000", "Ойлик": "20000", "Газ": "30000" },
      terminal: "400000",
      click: "50000",
      transfer: "60000",
    };
    const entries = CASH_DRAFT_ENTRY_CATEGORIES
      .map(category => cashDraftEntryAmounts(draft, category))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    expect(entries).toHaveLength(4);
    expect(entries.filter(entry => entry.terminalAmount > 0)).toEqual([
      expect.objectContaining({ type: "income", category: PAYMENT_CHANNEL_CATEGORY, terminalAmount: 400000 }),
    ]);
    expect(entries.reduce((sum, entry) => sum + entry.terminalAmount, 0)).toBe(400000);
    expect(entries.reduce((sum, entry) => sum + entry.clickAmount, 0)).toBe(50000);
    expect(entries.reduce((sum, entry) => sum + entry.transferAmount, 0)).toBe(60000);
    expect(entries.filter(entry => entry.type === "expense")).toEqual([
      expect.objectContaining({ category: "Ойлик", cashAmount: 20000, terminalAmount: 0 }),
      expect.objectContaining({ category: "Газ", cashAmount: 30000, terminalAmount: 0 }),
    ]);
  });

  it("contains every persisted column exactly once", () => {
    expect(new Set(CASH_DRAFT_ENTRY_CATEGORIES).size).toBe(CASH_DRAFT_ENTRY_CATEGORIES.length);
  });

  it("creates a channel entry even when no cash category is filled", () => {
    expect(cashDraftEntryAmounts({ amounts: {}, terminal: "1000", click: "", transfer: "" }, PAYMENT_CHANNEL_CATEGORY))
      .toMatchObject({ type: "income", cashAmount: 0, terminalAmount: 1000 });
  });
});
