export type JournalGroupEntry = {
  id: number;
  type: "income" | "expense" | "memo";
  agentId: number | null;
  employeeId: number | null;
  category: string;
  cashAmount: number;
  terminalAmount: number;
  clickAmount: number;
  transferAmount: number;
  amount?: number;
};

export const journalEntryKey = (entry: JournalGroupEntry) => `${entry.type === "memo" ? "debt" : "cash"}:${entry.id}`;

/** Input contains one day's records only. Unassigned entries stay independent. */
export function groupJournalEntries<T extends JournalGroupEntry>(entries: T[]) {
  const groups = new Map<string, { key: string; entries: T[] }>();
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    const key = entry.employeeId != null ? `employee:${entry.employeeId}`
      : entry.agentId != null ? `agent:${entry.agentId}` : journalEntryKey(entry);
    let group = groups.get(key);
    if (!group) { group = { key, entries: [] }; groups.set(key, group); }
    group.entries.push(entry);
  }
  return Array.from(groups.values());
}

export function journalCellTotal(entries: JournalGroupEntry[], field: "amount" | "terminalAmount" | "clickAmount" | "transferAmount") {
  return entries.reduce((sum, entry) => sum + (field === "amount"
    ? entry.type === "memo" ? entry.amount ?? 0 : entry.cashAmount
    : entry.type === "memo" ? 0 : entry[field]), 0);
}
