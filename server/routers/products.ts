import { asc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agentTakingEntries, products, transactions } from "../../drizzle/schema";
import { ownerProcedure, productsViewProcedure, skladProcedure } from "../access";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

export const productsRouter = router({
  list: productsViewProcedure
    .input(z.object({ search: z.string().max(120).optional() }).default({}))
    .query(async ({ input }) => {
      const db = await requireDb();
      const search = input.search?.trim();
      return db
        .select()
        .from(products)
        .where(
          search
            ? or(like(products.name, `%${search}%`), like(products.code, `%${search}%`))
            : undefined,
        )
        .orderBy(asc(products.sortOrder), asc(products.name));
    }),
  /** Bitta mahsulotni ro'yxatda bir pog'ona yuqoriga/pastga suradi — qo'shni
   * mahsulot bilan sortOrder qiymatlarini almashtiradi. */
  reorder: skladProcedure
    .input(z.object({ id: z.number().int().positive(), direction: z.enum(["up", "down"]) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const ordered = await db.select({ id: products.id, sortOrder: products.sortOrder }).from(products).orderBy(asc(products.sortOrder), asc(products.name));
      const index = ordered.findIndex(row => row.id === input.id);
      if (index === -1) throw new Error("Mahsulot topilmadi.");
      const swapIndex = input.direction === "up" ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= ordered.length) return { success: true };
      const current = ordered[index];
      const neighbor = ordered[swapIndex];
      await db.update(products).set({ sortOrder: neighbor.sortOrder }).where(eq(products.id, current.id));
      await db.update(products).set({ sortOrder: current.sortOrder }).where(eq(products.id, neighbor.id));
      return { success: true };
    }),
  updatePrice: skladProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        price: z.number().int().min(0).max(9_000_000_000_000),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(products).set({ price: input.price }).where(eq(products.id, input.id));
      return { success: true };
    }),
  /**
   * Renames a product and backfills the name everywhere it was denormalized (transactions,
   * agent taking entries), so every section reflects the new name immediately — not just
   * future records. Price/quantity history is untouched; only the display name text changes.
   */
  rename: skladProcedure
    .input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(2).max(240) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.transaction(async tx => {
        const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, input.id)).limit(1);
        if (!product) throw new Error("Mahsulot topilmadi.");
        await tx.update(products).set({ name: input.name }).where(eq(products.id, input.id));
        await tx.update(transactions).set({ productName: input.name }).where(eq(transactions.productId, input.id));
        await tx.update(agentTakingEntries).set({ productName: input.name }).where(eq(agentTakingEntries.productId, input.id));
      });
      return { success: true };
    }),
  updateContainerMeta: ownerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        containerType: z.enum(["keg_30", "keg_50"]).nullable(),
        containerUnitsPerItem: z.number().int().min(1).max(100).default(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db
        .update(products)
        .set({
          containerType: input.containerType,
          containerUnitsPerItem: input.containerType ? input.containerUnitsPerItem : 1,
        })
        .where(eq(products.id, input.id));
      return { success: true };
    }),
  create: skladProcedure
    .input(
      z.object({
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(2).max(240),
        unit: z.string().trim().min(1).max(64),
        price: z.number().int().min(0).max(9_000_000_000_000),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [{ maxOrder }] = await db.select({ maxOrder: sql<number>`coalesce(max(${products.sortOrder}), 0)`.mapWith(Number) }).from(products);
      const [created] = await db.insert(products).values({ ...input, sortOrder: maxOrder + 1 }).$returningId();
      return { id: created.id };
    }),
});
