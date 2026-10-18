import { describe, expect, it } from "vitest";
import {
  COMPANY_COLUMNS,
  companyColumnLabel,
  companyCashLabel,
  companyDateSchema,
  companyPreferencesSchema,
  companyPreferencesSaveSchema,
  defaultCompanyPreferences,
  moduleForPath,
} from "./companyPreferences";
import {
  CASH_CATEGORY_DEFINITIONS,
  resolveCashCategoryWrite,
} from "./cashCategoryRegistry";
import {
  agentSettlementAmount,
  summarizeCashAccounting,
} from "./cashAccounting";

describe("company presentation settings", () => {
  it("retains every legacy header and returns independent defaults", () => {
    const a = defaultCompanyPreferences(),
      b = defaultCompanyPreferences();
    a.labels.salary = "Ish haqi";
    a.hiddenModules.push("fastKeg");
    expect(b).toEqual({ labels: {}, hiddenModules: [] });
    for (const [key, definition] of Object.entries(COMPANY_COLUMNS))
      expect(companyColumnLabel(b, key as keyof typeof COMPANY_COLUMNS)).toBe(
        definition.label
      );
    expect(companyPreferencesSchema.parse(b)).toEqual(b);
  });
  it("rejects unknown financial keys, tenant spoofing, duplicate headers and oversized labels", () => {
    for (const labels of [
      { invented: "Yangi" },
      { salary: "x".repeat(41) },
      { salary: "" },
      { salary: "Обед" },
      { stock: "Narxi" },
      { salary: "x\ny" },
    ])
      expect(
        companyPreferencesSchema.safeParse({ labels, hiddenModules: [] })
          .success
      ).toBe(false);
    expect(
      companyPreferencesSchema.safeParse({
        labels: {},
        hiddenModules: ["unknown"],
      }).success
    ).toBe(false);
    expect(
      companyPreferencesSchema.safeParse({
        labels: {},
        hiddenModules: ["fastKeg", "fastKeg"],
      }).success
    ).toBe(false);
    expect(
      companyPreferencesSaveSchema.safeParse({
        expectedRevision: 0,
        preferences: defaultCompanyPreferences(),
        tenantId: "other",
      }).success
    ).toBe(false);
  });
  it("accepts trimmed Uzbek/Cyrillic labels but never changes financial classification", () => {
    const value = companyPreferencesSchema.parse({
      labels: { agent_cash_pet: "  Naqd tushum  ", salary: "Маош" },
      hiddenModules: ["fastKeg"],
    });
    expect(companyCashLabel(value, "Приход пет")).toBe("Naqd tushum");
    expect(companyCashLabel(value, "Old custom category")).toBe(
      "Old custom category"
    );
    expect(
      resolveCashCategoryWrite({
        category: "Naqd tushum",
        categoryId: "agent_cash_pet",
        type: "income",
      })
    ).toEqual({
      category: "Приход пет",
      categoryId: "agent_cash_pet",
      type: "income",
    });
    expect(CASH_CATEGORY_DEFINITIONS.salary.type).toBe("expense");
    const row = {
      category: "Приход пет",
      type: "income" as const,
      cashAmount: 100,
      terminalAmount: 20,
      clickAmount: 30,
      transferAmount: 40,
    };
    expect(agentSettlementAmount(row)).toBe(190);
    expect(summarizeCashAccounting([row]).cashBalance).toBe(100);
  });
  it("only maps optional navigation paths and validates real dates", () => {
    expect(moduleForPath("/tezkor-keg/")).toBe("fastKeg");
    expect(moduleForPath("/sotuv-hisoboti")).toBe("sales");
    for (const path of [
      "/kassa",
      "/qarzdorlik",
      "/mahsulotlar",
      "/firma-sozlamalari",
      "/foydalanuvchilar",
    ])
      expect(moduleForPath(path)).toBeUndefined();
    expect(companyDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(companyDateSchema.safeParse("2028-02-29").success).toBe(true);
  });
});
