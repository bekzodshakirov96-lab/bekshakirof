import { describe, expect, it } from "vitest";
import { buildDailyReconciliation, tashkentBusinessDate } from "./agentReconciliation";

describe("kunlik agent solishtirish", () => {
  it("bir biznes kunidagi turli vaqtli yozuvlarni bitta agent qatoriga yig'adi", () => {
    const taking = [
      { entryDate: new Date("2026-09-23T19:30:00Z"), agentId: 1, agentName: "Dilshod", computedAmount: 100 },
      { entryDate: new Date("2026-09-24T07:00:00Z"), agentId: 1, agentName: "Dilshod", computedAmount: 50 },
    ];
    const submitted = [
      { entryDate: new Date("2026-09-24T18:00:00Z"), agentId: 1, agentName: "Dilshod", submittedAmount: 200 },
    ];
    const rows = buildDailyReconciliation(taking, submitted);
    expect(rows).toHaveLength(1);
    expect(tashkentBusinessDate(rows[0].entryDate)).toBe("2026-09-24");
    expect(rows[0]).toMatchObject({ computedAmount: 150, submittedAmount: 200, farq: -50 });
  });

  it("faqat topshirilgan kunni va kamomadni alohida ko'rsatadi", () => {
    const rows = buildDailyReconciliation(
      [{ entryDate: new Date("2026-09-24T07:00:00Z"), agentId: 2, agentName: "Doston", computedAmount: 100 }],
      [{ entryDate: new Date("2026-09-25T07:00:00Z"), agentId: 2, agentName: "Doston", submittedAmount: 40 }],
    );
    expect(rows.map(row => row.farq)).toEqual([-40, 100]);
  });
});
