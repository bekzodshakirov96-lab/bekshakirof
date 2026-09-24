import { describe, expect, it } from "vitest";
import { buildAgentDifferenceSummary } from "./agentDifference";

describe("agent difference summary", () => {
  it("keeps net difference and total mismatch separate", () => {
    const result = buildAgentDifferenceSummary(
      [
        { agentId: 1, agentName: "Ali" },
        { agentId: 2, agentName: "Vali" },
      ],
      [
        { agentId: 1, agentName: "Ali", computedAmount: 10_000_000 },
        { agentId: 2, agentName: "Vali", computedAmount: 5_000_000 },
      ],
      [
        { agentId: 1, agentName: "Ali", submittedAmount: 5_000_000 },
        { agentId: 2, agentName: "Vali", submittedAmount: 10_000_000 },
      ],
    );

    expect(result.netDifference).toBe(0);
    expect(result.mismatchTotal).toBe(10_000_000);
    expect(result.deficitTotal).toBe(5_000_000);
    expect(result.excessTotal).toBe(5_000_000);
  });

  it("includes agents that exist in only one source or have no movements", () => {
    const result = buildAgentDifferenceSummary(
      [{ agentId: 3, agentName: "Zero" }],
      [{ agentId: 1, agentName: "Tovar", computedAmount: 700_000 }],
      [{ agentId: 2, agentName: "Kassa", submittedAmount: 200_000 }],
    );

    expect(result.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: 1, difference: 700_000 }),
      expect.objectContaining({ agentId: 2, difference: -200_000 }),
      expect.objectContaining({ agentId: 3, difference: 0 }),
    ]));
  });
});
