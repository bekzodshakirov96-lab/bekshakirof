import { describe, expect, it } from "vitest";
import { commissionPaymentPeriod, commissionSettlementStatus } from "./commissionSettlement";
const payment = { sourceKey: "agent-commission:1:2026-09-01:2026-09-30", description: "edited note", cashAmount: 100000 };
describe("commission settlement ranges", () => {
  it("tracks exact paid amounts even if a journal note changes", () => {
    expect(commissionSettlementStatus([payment], { fromDate: "2026-09-01", toDate: "2026-09-30" })).toEqual({ paidForExactPeriod: 100000, overlappingPeriods: [] });
    expect(commissionPaymentPeriod({ ...payment, description: "Komissiya (2026-10-01 — 2026-10-31)" })).toEqual({ fromDate: "2026-09-01", toDate: "2026-09-30" });
  });
  it("blocks intersecting ranges including a shared boundary", () => {
    expect(commissionSettlementStatus([payment], { fromDate: "2026-09-30", toDate: "2026-10-15" }).overlappingPeriods).toHaveLength(1);
    expect(commissionSettlementStatus([payment], { fromDate: "2026-09-01", toDate: "2026-10-01" }).overlappingPeriods).toHaveLength(1);
  });
  it("allows adjacent ranges and recognizes legacy descriptions", () => {
    expect(commissionSettlementStatus([payment], { fromDate: "2026-10-01", toDate: "2026-10-31" }).overlappingPeriods).toEqual([]);
    expect(commissionSettlementStatus([{ ...payment, sourceKey: "agent-commission:old-id", description: "Komissiya (2026-09-01 — 2026-09-30)" }], { fromDate: "2026-09-01", toDate: "2026-09-30" }).paidForExactPeriod).toBe(100000);
  });
  it("fails closed when an existing commission period cannot be determined", () => {
    expect(commissionSettlementStatus([{ ...payment, sourceKey: "agent-commission:old-id" }], { fromDate: "2026-10-01", toDate: "2026-10-31" }).overlappingPeriods).toHaveLength(1);
  });
});
