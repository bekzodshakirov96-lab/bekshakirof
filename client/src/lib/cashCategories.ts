/** Kunlik jurnaldagi doimiy prihod/rasxod toifalari — hali birorta yozuv kiritilmagan
 * bo'lsa ham, filtr va tanlovlarda har doim ko'rinib turishi uchun markazlashtirilgan. */
import { legacyCashCategories, LEGACY_CASH_PROFILE } from "../../../shared/cashCategoryRegistry";
export const INCOME_CATEGORIES = legacyCashCategories(LEGACY_CASH_PROFILE.incomeCategoryIds);
export const EXPENSE_CATEGORIES = legacyCashCategories(LEGACY_CASH_PROFILE.expenseCategoryIds);
export const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
