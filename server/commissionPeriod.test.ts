import { describe, expect, it } from "vitest";
import { commissionPeriod } from "./routers/agents";

describe("agent commission payout period", () => {
  it("uses Tashkent day boundaries even when the server runs in another timezone", () => {
    const period = commissionPeriod("2026-09-01 — 2026-09-30");
    expect(period.from.toISOString()).toBe("2026-08-31T19:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-09-30T18:59:59.999Z");
  });

  it.each(["2026-09-31 — 2026-10-01", "2026-10-02 — 2026-10-01", "sentabr 2026"])(
    "rejects an invalid payout period: %s",
    label => expect(() => commissionPeriod(label)).toThrow("Komissiya davri noto‘g‘ri."),
  );
});
