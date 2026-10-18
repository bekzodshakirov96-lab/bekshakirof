import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { matrixStockConfigs, products } from "../drizzle/schema";
import type { DatabaseTransaction } from "./stockAccounting";

/** All stock writers take the same product lock as opening confirmation. A
 * confirmed physical count freezes its earlier stock history, including deletes
 * through sales/factory APIs and new backdated manual receipts. */
export async function assertInventoryHistoryMutable(
  tx: DatabaseTransaction,
  movements: { productId: number; movementDate: Date }[]
) {
  const ids = Array.from(new Set(movements.map(row => row.productId))).sort(
    (a, b) => a - b
  );
  for (const id of ids) {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, id))
      .for("update");
    if (!product) throw new Error("Mahsulot topilmadi.");
  }
  for (const id of ids) {
    const [config] = await tx
      .select()
      .from(matrixStockConfigs)
      .where(eq(matrixStockConfigs.productId, id))
      .for("update");
    if (
      config &&
      movements.some(
        row => row.productId === id && row.movementDate < config.effectiveDate
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Bu mahsulotning boshlang'ich qoldig'i tasdiqlangan. Undan oldingi ombor harakatlarini o'zgartirib bo'lmaydi.",
      });
  }
}
