type DailyAmount = { entryDate: Date; agentId: number; agentName: string };
type TakingAmount = DailyAmount & { computedAmount: number };
type SubmissionAmount = DailyAmount & { submittedAmount: number };

export function tashkentBusinessDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

/** Bir kunda turli vaqtda yozilgan summalarni agent bo'yicha bitta qatorga yig'adi. */
export function buildDailyReconciliation(takings: TakingAmount[], submissions: SubmissionAmount[]) {
  const rows = new Map<string, DailyAmount & { computedAmount: number; submittedAmount: number; farq: number; note: string | null }>();
  const add = (row: DailyAmount, field: "computedAmount" | "submittedAmount", amount: number) => {
    const key = `${tashkentBusinessDate(row.entryDate)}:${row.agentId}`;
    let result = rows.get(key);
    if (!result) {
      result = { ...row, computedAmount: 0, submittedAmount: 0, farq: 0, note: null };
      rows.set(key, result);
    }
    result[field] += amount;
  };
  takings.forEach(row => add(row, "computedAmount", row.computedAmount));
  submissions.forEach(row => add(row, "submittedAmount", row.submittedAmount));
  const result = Array.from(rows.values());
  result.forEach(row => { row.farq = row.computedAmount - row.submittedAmount; });
  return result.sort((a, b) => tashkentBusinessDate(b.entryDate).localeCompare(tashkentBusinessDate(a.entryDate)) || a.agentName.localeCompare(b.agentName) || a.agentId - b.agentId);
}
