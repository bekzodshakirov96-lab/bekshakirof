import { and, eq, gt, inArray } from "drizzle-orm";
import { stockMovements } from "../drizzle/schema";
import { averageCostByProduct } from "./costing";
import type { DatabaseTransaction } from "./stockAccounting";

/**
 * Berilgan mahsulotlar uchun joriy o'rtacha tannarxni bazadan hisoblaydi.
 *
 * Faqat narxi kiritilgan ("unitCost > 0") qo'lda kirimlar hisobga olinadi —
 * sotuvdan kelib chiqqan avtomatik chiqimlar va narxsiz kirimlar o'rtachani
 * buzmasligi kerak.
 *
 * Natija sotuv paytida savdo qatoriga nusxalanadi, shuning uchun keyinchalik
 * tannarx o'zgarsa ham eski savdolarning foydasi o'zgarmaydi.
 */
export async function fetchAverageCosts(
  tx: DatabaseTransaction,
  productIds: number[],
): Promise<Map<number, number>> {
  const uniqueIds = productIds.filter(
    (id, index) => Number.isFinite(id) && id > 0 && productIds.indexOf(id) === index,
  );
  if (uniqueIds.length === 0) return new Map();

  const rows = await tx
    .select({
      productId: stockMovements.productId,
      quantity: stockMovements.quantity,
      unitCost: stockMovements.unitCost,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.movementType, "in"),
        gt(stockMovements.unitCost, 0),
        inArray(stockMovements.productId, uniqueIds),
      ),
    );

  return averageCostByProduct(
    rows.map(row => ({
      productId: row.productId,
      quantity: Number(row.quantity),
      unitCost: row.unitCost,
    })),
  );
}
