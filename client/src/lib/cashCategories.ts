/** Kunlik jurnaldagi doimiy prihod/rasxod toifalari — hali birorta yozuv kiritilmagan
 * bo'lsa ham, filtr va tanlovlarda har doim ko'rinib turishi uchun markazlashtirilgan. */
import { CASH_DEBT_REPAYMENT_CATEGORY } from "../../../shared/cashAccounting";
export const INCOME_CATEGORIES = ["Приход кег", "Приход пет", CASH_DEBT_REPAYMENT_CATEGORY];
export const EXPENSE_CATEGORIES = ["Ойлик", "Обед", "Газ", "Завод", "Расход"];
export const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
