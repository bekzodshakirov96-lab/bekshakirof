export type CommissionPeriod = { fromDate: string; toDate: string };
export type CommissionPayment = { sourceKey: string; description: string | null; cashAmount: number };

/** The immutable source key takes precedence over editable journal descriptions.
 * Older generated payments encoded the same range in their description. */
export function commissionPaymentPeriod(payment: CommissionPayment): CommissionPeriod | null {
  const key = /^agent-commission:\d+:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(payment.sourceKey);
  const legacy = /^Komissiya \((\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2})\)$/.exec(payment.description ?? "");
  const match = key ?? legacy;
  return match ? { fromDate: match[1], toDate: match[2] } : null;
}

export function commissionSettlementStatus(payments: CommissionPayment[], requested: CommissionPeriod) {
  let paidForExactPeriod = 0;
  const overlappingPeriods: string[] = [];
  for (const payment of payments) {
    const period = commissionPaymentPeriod(payment);
    if (!period) {
      overlappingPeriods.push("Sanasi aniqlanmagan oldingi komissiya");
    } else if (period.fromDate === requested.fromDate && period.toDate === requested.toDate) {
      paidForExactPeriod += payment.cashAmount;
    } else if (period.fromDate <= requested.toDate && period.toDate >= requested.fromDate) {
      overlappingPeriods.push(`${period.fromDate} — ${period.toDate}`);
    }
  }
  return { paidForExactPeriod, overlappingPeriods: Array.from(new Set(overlappingPeriods)) };
}
