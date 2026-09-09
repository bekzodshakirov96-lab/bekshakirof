import { describe, expect, it } from "vitest";
import { groupJournalEntries, journalCellTotal, journalEntryKey, type JournalGroupEntry } from "./cashJournalGroups";
const row = (id: number, patch: Partial<JournalGroupEntry> = {}): JournalGroupEntry => ({
  id, type: "income", agentId: 7, employeeId: null, category: "Приход пет", cashAmount: 0,
  terminalAmount: 0, clickAmount: 0, transferAmount: 0, ...patch,
});
describe("daily cash journal grouping", () => {
  it("keeps Suxrob's five categories in one row without changing amounts or channel owners", () => {
    const entries = [row(1, { cashAmount: 4150000 }), row(2, { type: "expense", category: "Газ", cashAmount: 82000 }),
      row(3, { type: "expense", category: "Обед", cashAmount: 40000 }),
      row(4, { type: "expense", category: "Ойлик", cashAmount: 180000, terminalAmount: 1220000 }),
      row(5, { category: "Приход кег", cashAmount: 80000 })];
    const groups = groupJournalEntries(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toEqual(entries);
    expect(journalCellTotal(groups[0].entries, "terminalAmount")).toBe(1220000);
    expect(journalCellTotal(groups[0].entries.filter(e => e.category === "Ойлик"), "amount")).toBe(180000);
  });
  it("retains repeated categories as independently editable records", () => {
    const entries = [row(1, { cashAmount: 100 }), row(2, { cashAmount: 200 })];
    const [group] = groupJournalEntries(entries);
    expect(group.entries.map(journalEntryKey)).toEqual(["cash:1", "cash:2"]);
    expect(journalCellTotal(group.entries, "amount")).toBe(300);
    expect(journalCellTotal(group.entries.filter(e => e.id !== 1), "amount")).toBe(200);
  });
  it("separates agent/employee IDs and never merges unassigned entries", () => {
    expect(groupJournalEntries([row(1), row(2, { agentId: null, employeeId: 7 }),
      row(3, { agentId: null }), row(4, { agentId: null }),
      row(3, { agentId: null, type: "memo", amount: 50 })])).toHaveLength(5);
  });
  it("groups cash and debt with colliding IDs without counting debt as cash or channels", () => {
    const [group] = groupJournalEntries([row(1, { cashAmount: 100 }), row(1, { type: "memo", category: "Qarz", amount: 50 })]);
    expect(group.entries.map(journalEntryKey)).toEqual(["cash:1", "debt:1"]);
    expect(journalCellTotal(group.entries.filter(e => e.type === "memo"), "amount")).toBe(50);
    expect(journalCellTotal(group.entries, "terminalAmount")).toBe(0);
  });
  it("keeps display order deterministic without sorting the input in place", () => {
    const entries = [row(9, { agentId: 2 }), row(3), row(1, { agentId: 2 })];
    expect(groupJournalEntries(entries).map(g => g.key)).toEqual(["agent:2", "agent:7"]);
    expect(entries.map(e => e.id)).toEqual([9,3,1]);
  });
});
