import { z } from "zod";
import { businessProcedure, ownerProcedure } from "../access";
import { router } from "../_core/trpc";
import { requireDb } from "../db";
import {
  activateMatrixStock,
  addMatrixReceipt,
  inventoryQuantity,
  matrixReceiptHistory,
  matrixStockDay,
  reverseMatrixReceipt,
  setMatrixCell,
  matrixCellVersions,
} from "../matrixInventory";

const date = z.number().int().finite().min(0).max(8_000_000_000_000);
const productId = z.number().int().positive();
export const matrixInventoryRouter = router({
  cellVersions: businessProcedure
    .input(z.object({ date }))
    .query(async ({ input }) =>
      matrixCellVersions(await requireDb(), input.date)
    ),
  day: businessProcedure
    .input(z.object({ date }))
    .query(async ({ input }) => matrixStockDay(await requireDb(), input.date)),
  activate: ownerProcedure
    .input(z.object({ productId, date, openingQuantity: inventoryQuantity }))
    .mutation(async ({ input, ctx }) =>
      activateMatrixStock(await requireDb(), input, ctx.user.id)
    ),
  receipt: businessProcedure
    .input(
      z.object({
        productId,
        date,
        quantity: inventoryQuantity.refine(value => value > 0),
        requestKey: z.string().uuid(),
        note: z.string().trim().max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) =>
      addMatrixReceipt(await requireDb(), input, ctx.user.id)
    ),
  history: businessProcedure
    .input(
      z.object({ productId, date, page: z.number().int().min(1).default(1) })
    )
    .query(async ({ input }) => matrixReceiptHistory(await requireDb(), input)),
  reverseReceipt: businessProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().min(3).max(1000),
      })
    )
    .mutation(async ({ input, ctx }) =>
      reverseMatrixReceipt(
        await requireDb(),
        input.id,
        input.reason,
        ctx.user.id
      )
    ),
  setCell: businessProcedure
    .input(
      z.object({
        date,
        productId,
        agentId: z.number().int().positive(),
        quantity: inventoryQuantity,
        expectedQuantity: inventoryQuantity,
        expectedVersion: z.number().int().min(0),
        requestKey: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) =>
      setMatrixCell(await requireDb(), input, ctx.user.id)
    ),
});
