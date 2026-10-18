import { describe, expect, it } from "vitest";
import {
  COMPANY_TEMPLATES,
  companyTemplatePreferences,
  templateApplySchema,
} from "./companyTemplates";
import {
  companyPreferencesSchema,
  defaultCompanyPreferences,
} from "./companyPreferences";
import {
  cashStorageCategory,
  resolveCashCategoryWrite,
} from "./cashCategoryRegistry";

describe("versioned company activity templates", () => {
  it("produces valid independent settings without product, stock, unit or money defaults", () => {
    for (const template of COMPANY_TEMPLATES) {
      const a = companyTemplatePreferences(template.id);
      expect(companyPreferencesSchema.safeParse(a).success).toBe(true);
      a.labels.product = "Test mutation";
      a.hiddenModules.push("employees");
      expect(companyTemplatePreferences(template.id).labels.product).not.toBe(
        "Test mutation"
      );
      expect(
        companyTemplatePreferences(template.id).hiddenModules
      ).not.toContain("employees");
      expect(Object.keys(a).sort()).toEqual(["hiddenModules", "labels"]);
    }
  });
  it("keeps the current beverage profile exact and gives the other activities distinct navigation", () => {
    expect(companyTemplatePreferences("beverages_keg")).toEqual(
      defaultCompanyPreferences()
    );
    expect(companyTemplatePreferences("wholesale").hiddenModules).toContain(
      "agentMatrix"
    );
    expect(
      companyTemplatePreferences("agent_distribution").hiddenModules
    ).not.toContain("agentMatrix");
    expect(
      companyTemplatePreferences("agent_distribution").hiddenModules
    ).toContain("sales");
  });
  it("retains cash storage and financial direction even when presentation names change", () => {
    for (const template of COMPANY_TEMPLATES) {
      const preferences = companyTemplatePreferences(template.id);
      expect(
        resolveCashCategoryWrite({
          categoryId: "agent_cash_keg",
          category: preferences.labels.agent_cash_keg ?? "Приход кег",
          type: "income",
        }).category
      ).toBe(cashStorageCategory("agent_cash_keg"));
      expect(
        resolveCashCategoryWrite({
          categoryId: "salary",
          category: preferences.labels.salary ?? "Ойлик",
          type: "expense",
        }).category
      ).toBe(cashStorageCategory("salary"));
    }
    expect(() => companyTemplatePreferences("wholesale", 2)).toThrow(
      "versiyasi"
    );
  });
  it("rejects injected templates, tenant IDs, backdates and malformed idempotency keys", () => {
    const input = {
      templateId: "wholesale",
      requestKey: "10000000-0000-4000-8000-000000000000",
    };
    expect(templateApplySchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { ...input, templateId: "custom" },
      { ...input, tenantId: "other" },
      { ...input, effectiveDate: "2020-01-01" },
      { ...input, preferences: {} },
      { ...input, requestKey: "repeat" },
    ])
      expect(templateApplySchema.safeParse(bad).success).toBe(false);
  });
});
