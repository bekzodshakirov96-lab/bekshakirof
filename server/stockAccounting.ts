import { and, eq } from "drizzle-orm";
import { stockMovements } from "../drizzle/schema";
import type { getDb } from "./db";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Keeps the automatic "out" stock movement for one sale transaction in sync with its
 * current product/quantity. Always deletes the transaction's existing automatic movement
 * first, so this is safe to call on both create and update (idempotent).
 */
export async function reconcileTransactionStock(
  tx: DatabaseTransaction,
  input: {
    transactionId: number;
    movementDate: Date;
    productId: number | null;
    quantity: number;
    createdBy: number | null;
  },
): Promise<void> {
  await tx
    .delete(stockMovements)
    .where(and(eq(stockMovements.transactionId, input.transactionId), eq(stockMovements.isAutomatic, true)));

  if (!input.productId || input.quantity <= 0) return;

  await tx.insert(stockMovements).values({
    productId: input.productId,
    movementType: "out",
    quantity: input.quantity.toFixed(3),
    reason: "Savdo",
    transactionId: input.transactionId,
    isAutomatic: true,
    movementDate: input.movementDate,
    createdBy: input.createdBy,
  });
}
