/** Never infer a count from its amount: zero may be a real count, and a channel
 * confirmation used to create a default zero without anyone counting cash. */
export function hasRecordedCashCount(
  row: { actualCash: number; cashCountedAt: Date | null },
  auditAfterValues: Array<string | null>,
): boolean {
  if (row.cashCountedAt) return true;
  for (const text of auditAfterValues) {
    if (!text) continue;
    try {
      const after: unknown = JSON.parse(text);
      if (after && typeof after === "object" && "actualCash" in after
        && typeof after.actualCash === "number" && Number.isFinite(after.actualCash)) {
        // Values are newest first. A newer contradictory explicit count must
        // not be overridden by an older matching audit event.
        return after.actualCash === row.actualCash;
      }
    } catch { /* An invalid old audit event is not proof of a count. */ }
  }
  return false;
}
