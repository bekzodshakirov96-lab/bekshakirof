export type DailyTransferTotal = {
  day: string;
  agentId: number | null;
  amount: number;
};

export type JournalTransferTotal = DailyTransferTotal & {
  mode?: "legacy" | "linked" | "independent";
  linkedAmount?: number;
};

/** Kunlik jurnal agentning shu kundagi jami o'tkazmasini bildiradi.
 * Savdo/qarz manbalaridagi ayni to'lovni yana bir marta qo'shmaymiz. */
export function reconcileExpectedTransfers(
  sales: DailyTransferTotal[],
  debtPayments: DailyTransferTotal[],
  journal: JournalTransferTotal[],
  today: string,
) {
  const sourceByDay = new Map<string, number>();
  const journalByDay = new Map<string, { legacy: number; linked: number; linkedSource: number; independent: number }>();
  const key = (row: DailyTransferTotal) => `${row.day}:${row.agentId ?? "none"}`;
  for (const row of [...sales, ...debtPayments]) {
    const id = key(row);
    sourceByDay.set(id, (sourceByDay.get(id) ?? 0) + row.amount);
  }
  for (const row of journal) {
    const id = key(row);
    const totals = journalByDay.get(id) ?? { legacy: 0, linked: 0, linkedSource: 0, independent: 0 };
    if (row.mode === "linked") {
      totals.linked += row.amount;
      totals.linkedSource += row.linkedAmount ?? 0;
    } else if (row.mode === "independent") totals.independent += row.amount;
    else totals.legacy += row.amount;
    journalByDay.set(id, totals);
  }

  let todayTotal = 0;
  let cumulative = 0;
  for (const id of Array.from(new Set([...Array.from(sourceByDay.keys()), ...Array.from(journalByDay.keys())]))) {
    const source = sourceByDay.get(id) ?? 0;
    const journal = journalByDay.get(id) ?? { legacy: 0, linked: 0, linkedSource: 0, independent: 0 };
    const amount = source
      + Math.max(0, journal.linked - journal.linkedSource)
      + journal.independent
      + Math.max(0, journal.legacy - Math.max(0, source - journal.linkedSource));
    cumulative += amount;
    if (id.startsWith(`${today}:`)) todayTotal += amount;
  }
  return { today: todayTotal, cumulative };
}
