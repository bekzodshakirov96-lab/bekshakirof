import { asc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { products } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure } from "../access";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

export const productsRouter = router({
  list: businessProcedure
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
        .orderBy(asc(products.name));
    }),
  updatePrice: businessProcedure
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
  create: businessProcedure
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
      const [created] = await db.insert(products).values(input).$returningId();
      return { id: created.id };
    }),
});
