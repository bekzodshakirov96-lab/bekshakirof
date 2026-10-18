/** Stable business identities. Storage aliases are a compatibility boundary,
 * never a company's editable display labels. No historical rows are rewritten. */
export const CASH_CATEGORY_IDS = [
  "agent_cash_keg", "agent_cash_pet", "debt_repayment", "salary", "meals",
  "fuel", "supplier_payment", "other_expense", "electronic_collection",
] as const;
export type CashCategoryId = typeof CASH_CATEGORY_IDS[number];
type Definition = {
  label: string;
  storageCategory: string;
  type: "income" | "expense";
  agentCashSettlement: boolean;
  goodsPayment: boolean;
};
const definitions = {
  agent_cash_keg: { label: "Приход кег", storageCategory: "Приход кег", type: "income", agentCashSettlement: true, goodsPayment: false },
  agent_cash_pet: { label: "Приход пет", storageCategory: "Приход пет", type: "income", agentCashSettlement: true, goodsPayment: false },
  debt_repayment: { label: "Qarz qaytimi", storageCategory: "Qarz qaytimi", type: "income", agentCashSettlement: false, goodsPayment: false },
  salary: { label: "Ойлик", storageCategory: "Ойлик", type: "expense", agentCashSettlement: false, goodsPayment: false },
  meals: { label: "Обед", storageCategory: "Обед", type: "expense", agentCashSettlement: false, goodsPayment: false },
  fuel: { label: "Газ", storageCategory: "Газ", type: "expense", agentCashSettlement: false, goodsPayment: false },
  supplier_payment: { label: "Завод", storageCategory: "Завод", type: "expense", agentCashSettlement: false, goodsPayment: true },
  other_expense: { label: "Расход", storageCategory: "Расход", type: "expense", agentCashSettlement: false, goodsPayment: false },
  electronic_collection: { label: "Elektron to‘lovlar", storageCategory: "Elektron to‘lovlar", type: "income", agentCashSettlement: false, goodsPayment: false },
} as const satisfies Record<CashCategoryId, Definition>;
export const CASH_CATEGORY_DEFINITIONS = Object.freeze(Object.fromEntries(
  CASH_CATEGORY_IDS.map(id => [id, Object.freeze(definitions[id])]),
)) as { readonly [Id in CashCategoryId]: Readonly<typeof definitions[Id]> };

export const LEGACY_CASH_PROFILE = Object.freeze({
  id: "legacy_beverage_v1",
  incomeCategoryIds: Object.freeze(["agent_cash_keg", "agent_cash_pet", "debt_repayment"] as const),
  expenseCategoryIds: Object.freeze(["salary", "meals", "fuel", "supplier_payment", "other_expense"] as const),
});

export function cashStorageCategory<Id extends CashCategoryId>(id: Id): typeof definitions[Id]["storageCategory"] {
  return CASH_CATEGORY_DEFINITIONS[id].storageCategory;
}
export function legacyCashCategories(ids: readonly CashCategoryId[]): string[] {
  return ids.map(cashStorageCategory);
}
/** Exact matching retains historical JS rules. Do not guess Latin translations,
 * trim, or turn unknown historical/custom labels into a financial category. */
export function cashCategoryIdFromLegacy(category: string): CashCategoryId | null {
  return CASH_CATEGORY_IDS.find(id => cashStorageCategory(id) === category) ?? null;
}
export type CashCategoryReference = { category: string; categoryId?: CashCategoryId | null };
export function cashCategoryIdOf(value: CashCategoryReference): CashCategoryId | null {
  return value.categoryId ?? cashCategoryIdFromLegacy(value.category);
}
export function isCashCategory(value: CashCategoryReference, id: CashCategoryId): boolean {
  return cashCategoryIdOf(value) === id;
}
/** Returns a fresh view; one firm's labels cannot mutate another firm's defaults. */
export function cashCategoryView(id: CashCategoryId, labels: Partial<Record<CashCategoryId, string>> = {}) {
  return { id, ...CASH_CATEGORY_DEFINITIONS[id], label: labels[id] ?? CASH_CATEGORY_DEFINITIONS[id].label };
}
/** Phase one writes the same legacy storage token even when a caller uses an ID.
 * Old readers, imports and historical rows therefore remain compatible. */
export function resolveCashCategoryWrite<T extends { category: string; type: "income" | "expense"; categoryId?: CashCategoryId }>(value: T): T {
  if (!value.categoryId) return value;
  const definition = CASH_CATEGORY_DEFINITIONS[value.categoryId];
  if (definition.type !== value.type) throw new Error("Kassa toifasi va kirim/chiqim turi mos emas.");
  const existingId = cashCategoryIdFromLegacy(value.category);
  if (existingId && existingId !== value.categoryId) throw new Error("Kassa toifasining nomi va IDsi mos emas.");
  return { ...value, category: definition.storageCategory };
}

// Profit reports historically accept only these aliases, case-insensitively.
export const LEGACY_GOODS_PAYMENT_ALIASES = Object.freeze([cashStorageCategory("supplier_payment"), "Zavod", "Tovar uchun to'lov"]);
export function isGoodsPaymentReference(value: CashCategoryReference): boolean {
  if (value.categoryId) return CASH_CATEGORY_DEFINITIONS[value.categoryId].goodsPayment;
  const legacy = value.category.trim().toLowerCase();
  return LEGACY_GOODS_PAYMENT_ALIASES.some(alias => alias.toLowerCase() === legacy);
}
