import { inArray } from "drizzle-orm";
import { cashEntries } from "../drizzle/schema";
import { legacyCashCategories, type CashCategoryId } from "../shared/cashCategoryRegistry";

/** The only SQL bridge from stable business IDs to unchanged legacy storage.
 * Keeps existing database collation behavior and never updates historical rows. */
export function cashCategorySql(...ids: CashCategoryId[]) {
  if (!ids.length) throw new Error("Kassa toifasi tanlanmagan.");
  return inArray(cashEntries.category, legacyCashCategories(ids));
}
