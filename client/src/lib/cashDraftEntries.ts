import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./cashCategories";
import { ELECTRONIC_PAYMENT_CATEGORY } from "../../../shared/cashAccounting";

export const PAYMENT_CHANNEL_CATEGORY = ELECTRONIC_PAYMENT_CATEGORY;
export const CASH_DRAFT_ENTRY_CATEGORIES = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  PAYMENT_CHANNEL_CATEGORY,
];

export type CashDraftAmounts = {
  amounts: Record<string, string>;
  terminal: string;
  click: string;
  transfer: string;
};

export function cashDraftEntryAmounts(draft: CashDraftAmounts, category: string) {
  if (category === PAYMENT_CHANNEL_CATEGORY) {
    const terminalAmount = Math.round(Number(draft.terminal || 0));
    const clickAmount = Math.round(Number(draft.click || 0));
    const transferAmount = Math.round(Number(draft.transfer || 0));
    if (terminalAmount + clickAmount + transferAmount <= 0) return null;
    return {
      type: "income" as const,
      category,
      cashAmount: 0,
      terminalAmount,
      clickAmount,
      transferAmount,
    };
  }

  const cashAmount = Math.round(Number(draft.amounts[category] || 0));
  if (cashAmount <= 0) return null;
  return {
    type: INCOME_CATEGORIES.includes(category) ? "income" as const : "expense" as const,
    category,
    cashAmount,
    terminalAmount: 0,
    clickAmount: 0,
    transferAmount: 0,
  };
}
