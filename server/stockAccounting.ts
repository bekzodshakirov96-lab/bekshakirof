import { and, eq } from "drizzle-orm";
import { stockMovements } from "../drizzle/schema";
import type { getDb } from "./db";
import { assertInventoryHistoryMutable } from "./inventoryBoundary";

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
  const previous = await tx.select().from(stockMovements)
    .where(and(eq(stockMovements.transactionId, input.transactionId), eq(stockMovements.isAutomatic, true)));
  // Price/name-only sale edits do not rewrite protected warehouse history.
  if (previous.length === 1 && previous[0].productId === input.productId &&
      previous[0].movementType === "out" && Number(previous[0].quantity) === input.quantity &&
      +previous[0].movementDate === +input.movementDate) return;
  await assertInventoryHistoryMutable(tx, [...previous,
    ...(input.productId && input.quantity > 0 ? [{ productId: input.productId, movementDate: input.movementDate }] : []),
  ]);
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
