import { describe, expect, it } from "vitest";
import { hasRecordedCashCount } from "./cashCountStatus";
describe("actual cash count provenance", () => {
  it("does not infer a count from a channel-created default zero", () => {
    expect(hasRecordedCashCount({ actualCash: 0, cashCountedAt: null }, ['{"terminalConfirmed":100}'])).toBe(false);
  });
  it("retains explicit historical counts including zero without rewriting history", () => {
    for (const amount of [0, 500000]) expect(hasRecordedCashCount({ actualCash: amount, cashCountedAt: null },
      ['{"clickConfirmed":100}', JSON.stringify({ actualCash: amount })])).toBe(true);
  });
  it("requires confirmation for unknown or contradictory legacy values", () => {
    expect(hasRecordedCashCount({ actualCash: 100, cashCountedAt: null }, [])).toBe(false);
    expect(hasRecordedCashCount({ actualCash: 100, cashCountedAt: null }, ['{"actualCash":200}', '{"actualCash":100}'])).toBe(false);
  });
  it("accepts the explicit new marker", () => {
    expect(hasRecordedCashCount({ actualCash: 0, cashCountedAt: new Date() }, [])).toBe(true);
  });
});
