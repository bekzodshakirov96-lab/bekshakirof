import { describe, expect, it } from "vitest";
import { agentSettlementAmount } from "./cashAccounting";
import { summarizeOperatingExpenses } from "../server/costing";
import { CASH_CATEGORY_IDS, LEGACY_CASH_PROFILE, cashCategoryIdFromLegacy, cashCategoryView, cashStorageCategory, legacyCashCategories, resolveCashCategoryWrite } from "./cashCategoryRegistry";

describe("stable cash category identities", () => {
  it("retains the original journal order and every legacy storage token", () => {
    expect(legacyCashCategories(LEGACY_CASH_PROFILE.incomeCategoryIds)).toEqual(["Приход кег", "Приход пет", "Qarz qaytimi"]);
    expect(legacyCashCategories(LEGACY_CASH_PROFILE.expenseCategoryIds)).toEqual(["Ойлик", "Обед", "Газ", "Завод", "Расход"]);
    expect(new Set(CASH_CATEGORY_IDS).size).toBe(CASH_CATEGORY_IDS.length);
    for (const id of CASH_CATEGORY_IDS) expect(cashCategoryIdFromLegacy(cashStorageCategory(id))).toBe(id);
    for (const category of ["salary", "Oylik", " Приход кег ", "Uskuna ijarasi", ""]) expect(cashCategoryIdFromLegacy(category)).toBeNull();
  });
  it("does not change settlement when the display label changes", () => {
    const money = { type: "income" as const, cashAmount: 100, terminalAmount: 200, clickAmount: 300, transferAmount: 400 };
    const renamed = cashCategoryView("agent_cash_keg", { agent_cash_keg: "Chakana tushum" });
    expect(agentSettlementAmount({ ...money, categoryId: renamed.id, category: renamed.label })).toBe(1000);
    expect(agentSettlementAmount({ ...money, categoryId: "debt_repayment", category: "Qaytarilgan qarz" })).toBe(0);
    expect(cashCategoryView("agent_cash_keg").label).toBe("Приход кег");
    expect(cashCategoryView("salary").storageCategory).toBe("Ойлик");
  });
  it("preserves the old settlement mathematics across category/type/channel combinations", () => {
    for (const type of ["income", "expense"] as const) {
      for (const category of [...CASH_CATEGORY_IDS.map(cashStorageCategory), "Zavod", "Ixtiyoriy izoh", " приход кег "]) {
        for (const [cashAmount, terminalAmount, clickAmount, transferAmount] of [[0, 0, 0, 0], [100, 20, 30, 40], [0, 100, 0, 0], [99, 0, 0, 80]]) {
          const old = category === "Qarz qaytimi" ? 0 : (type === "income" && ["Приход кег", "Приход пет"].includes(category) ? cashAmount : 0) + terminalAmount + clickAmount + transferAmount;
          expect(agentSettlementAmount({ type, category, cashAmount, terminalAmount, clickAmount, transferAmount })).toBe(old);
        }
      }
    }
  });
  it("keeps ID writes compatible with old readers and rejects conflicting semantics", () => {
    expect(resolveCashCategoryWrite({ type: "expense", categoryId: "salary", category: "Ish haqi", cashAmount: 100 })).toMatchObject({ category: "Ойлик", cashAmount: 100 });
    expect(() => resolveCashCategoryWrite({ type: "income", categoryId: "salary", category: "Ish haqi" })).toThrow("kirim/chiqim");
    expect(() => resolveCashCategoryWrite({ type: "expense", categoryId: "salary", category: "Газ" })).toThrow("IDsi");
    const old = { type: "expense" as const, category: "Uskuna ijarasi" };
    expect(resolveCashCategoryWrite(old)).toBe(old);
  });
  it("keeps supplier cash payments out of operating expense regardless of display label", () => {
    expect(summarizeOperatingExpenses([
      { categoryId: "supplier_payment", category: "Ta’minotchiga to‘lov", amount: 1000 },
      { category: "  ZAVOD  ", amount: 2000 },
      { categoryId: "salary", category: "Ish haqi", amount: 300 },
      { category: "Yangi ixtiyoriy xarajat", amount: 400 },
    ])).toEqual({ total: 700, excludedGoodsPayments: 3000 });
  });
});
