import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, products, stockMovements, transactions } from "../../drizzle/schema";
import { skladProcedure } from "../access";
import { requireDb } from "../db";
import { assertExportRowLimit } from "../reportExport";
import { router } from "../_core/trpc";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export const stockRouter = router({
  /** Current stock per active product: running sum of in/out movements, never a cached column. */
  list: skladProcedure.query(async () => {
    const db = await requireDb();
    const productRows = await db.select().from(products).where(eq(products.isActive, true)).orderBy(asc(products.name));
    const balanceRows = await db
      .select({
        productId: stockMovements.productId,
        currentStock:
          sql<number>`coalesce(sum(case when ${stockMovements.movementType} = 'in' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`.mapWith(
            Number,
          ),
      })
      .from(stockMovements)
      .groupBy(stockMovements.productId);
    const balanceByProduct = new Map(balanceRows.map(row => [row.productId, row.currentStock]));
    return productRows.map(product => {
      const currentStock = balanceByProduct.get(product.id) ?? 0;
      return {
        id: product.id,
        name: product.name,
        unit: product.unit,
        currentStock,
        minStockLevel: product.minStockLevel,
        isLow: product.minStockLevel > 0 && currentStock < product.minStockLevel,
      };
    });
  }),
  /** Movement history — all products or one, optionally date/agent-filtered. Agent is only
   * present on sale-driven ("out") movements, resolved via the linked transaction. */
  movements: skladProcedure
    .input(
      z.object({
        productId: z.number().int().positive().optional(),
        agentId: z.number().int().positive().optional(),
        from: z.number().int().optional(),
        to: z.number().int().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().min(10).max(100).default(25),
      }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input.productId ? eq(stockMovements.productId, input.productId) : undefined,
        input.agentId ? eq(transactions.agentId, input.agentId) : undefined,
        input.from ? sql`${stockMovements.movementDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${stockMovements.movementDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;
      const items = await db
        .select({
          id: stockMovements.id,
          productId: stockMovements.productId,
          productName: products.name,
          unit: products.unit,
          movementType: stockMovements.movementType,
          quantity: stockMovements.quantity,
          reason: stockMovements.reason,
          isAutomatic: stockMovements.isAutomatic,
          movementDate: stockMovements.movementDate,
          note: stockMovements.note,
          agentName: agents.name,
        })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(transactions, eq(stockMovements.transactionId, transactions.id))
        .leftJoin(agents, eq(transactions.agentId, agents.id))
        .where(where)
        .orderBy(desc(stockMovements.movementDate), desc(stockMovements.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(stockMovements)
        .leftJoin(transactions, eq(stockMovements.transactionId, transactions.id))
        .where(where);
      return { items, total, page: input.page, pageCount: Math.max(1, Math.ceil(total / input.pageSize)) };
    }),
  /** Manual kirim — production/purchase receipt, or any other stock increase not tied to a sale. */
  stockIn: skladProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().positive().max(1_000_000),
        movementDate: z.number().int(),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      await db.insert(stockMovements).values({
        productId: input.productId,
        movementType: "in",
        quantity: input.quantity.toFixed(3),
        reason: "Qo'lda kirim",
        isAutomatic: false,
        movementDate: new Date(input.movementDate),
        note: input.note,
        createdBy: ctx.user.id,
      });
      return { success: true };
    }),
  /** Same as stockIn but for several products at once (e.g. one delivery covering multiple items) — one shared date/note, one atomic insert. */
  stockInBatch: skladProcedure
    .input(
      z.object({
        movementDate: z.number().int(),
        note: z.string().trim().max(1_000).optional(),
        items: z
          .array(
            z.object({
              productId: z.number().int().positive(),
              quantity: z.number().positive().max(1_000_000),
              /** Bitta dona tannarxi — foyda hisobi shu narxga tayanadi.
               * Ixtiyoriy: kiritilmasa, bu kirim o'rtacha tannarxga qo'shilmaydi. */
              unitCost: z.number().int().min(0).max(1_000_000_000).optional(),
            }),
          )
          .min(1, "Kamida bitta mahsulot tanlang.")
          .max(50, "Bir vaqtda 50 tadan ortiq mahsulot kiritib bo'lmaydi.")
          .refine(items => new Set(items.map(item => item.productId)).size === items.length, {
            message: "Bir mahsulot ro'yxatda faqat bir marta bo'lishi mumkin.",
          }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const movementDate = new Date(input.movementDate);
      await db.transaction(async tx => {
        for (const item of input.items) {
          await tx.insert(stockMovements).values({
            productId: item.productId,
            movementType: "in",
            quantity: item.quantity.toFixed(3),
            unitCost: item.unitCost ?? 0,
            reason: "Qo'lda kirim",
            isAutomatic: false,
            movementDate,
            note: input.note,
            createdBy: ctx.user.id,
          });
        }
      });
      return { success: true, count: input.items.length };
    }),
  /** Manual chiqim — waste, damage, internal use. Sale-driven decreases happen automatically via reconcileTransactionStock. */
  stockOut: skladProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().positive().max(1_000_000),
        movementDate: z.number().int(),
        reason: z.string().trim().min(2).max(255),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      await db.insert(stockMovements).values({
        productId: input.productId,
        movementType: "out",
        quantity: input.quantity.toFixed(3),
        reason: input.reason,
        isAutomatic: false,
        movementDate: new Date(input.movementDate),
        note: input.note,
        createdBy: ctx.user.id,
      });
      return { success: true };
    }),
  /** Deletes a manual movement. Automatic (sale-linked) movements can't be deleted directly — edit/delete the transaction instead. */
  deleteMovement: skladProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [existing] = await db
      .select({ id: stockMovements.id, isAutomatic: stockMovements.isAutomatic })
      .from(stockMovements)
      .where(eq(stockMovements.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Harakat topilmadi yoki allaqachon o'chirilgan.");
    if (existing.isAutomatic) throw new Error("Savdo orqali yaratilgan yozuvni shu yerdan o'chirib bo'lmaydi — tegishli operatsiyani Savdo jurnalidan o'chiring.");
    await db.delete(stockMovements).where(eq(stockMovements.id, input.id));
    return { success: true };
  }),
  setMinLevel: skladProcedure
    .input(z.object({ id: z.number().int().positive(), minStockLevel: z.number().int().min(0).max(1_000_000) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(products).set({ minStockLevel: input.minStockLevel }).where(eq(products.id, input.id));
      return { success: true };
    }),
  /** Per-product kirim/chiqim totals for a period, plus each product's current (all-time) ending stock. */
  report: skladProcedure
    .input(z.object({ from: z.number().int().optional(), to: z.number().int().optional(), productId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const periodConditions = [
        input.from ? sql`${stockMovements.movementDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${stockMovements.movementDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const periodWhere = periodConditions.length ? and(...periodConditions) : undefined;

      const productRows = await db
        .select()
        .from(products)
        .where(input.productId ? eq(products.id, input.productId) : eq(products.isActive, true))
        .orderBy(asc(products.name));

      const periodRows = await db
        .select({
          productId: stockMovements.productId,
          inTotal: sql<number>`coalesce(sum(case when ${stockMovements.movementType} = 'in' then ${stockMovements.quantity} else 0 end), 0)`.mapWith(Number),
          outTotal: sql<number>`coalesce(sum(case when ${stockMovements.movementType} = 'out' then ${stockMovements.quantity} else 0 end), 0)`.mapWith(Number),
        })
        .from(stockMovements)
        .where(periodWhere)
        .groupBy(stockMovements.productId);
      const periodByProduct = new Map(periodRows.map(row => [row.productId, row]));

      const balanceRows = await db
        .select({
          productId: stockMovements.productId,
          currentStock:
            sql<number>`coalesce(sum(case when ${stockMovements.movementType} = 'in' then ${stockMovements.quantity} else -${stockMovements.quantity} end), 0)`.mapWith(
              Number,
            ),
        })
        .from(stockMovements)
        .groupBy(stockMovements.productId);
      const balanceByProduct = new Map(balanceRows.map(row => [row.productId, row.currentStock]));

      const rows = productRows.map(product => {
        const period = periodByProduct.get(product.id);
        const inTotal = period?.inTotal ?? 0;
        const outTotal = period?.outTotal ?? 0;
        return {
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          inTotal,
          outTotal,
          net: inTotal - outTotal,
          currentStock: balanceByProduct.get(product.id) ?? 0,
        };
      });

      return {
        rows,
        summary: {
          totalIn: rows.reduce((sum, row) => sum + row.inTotal, 0),
          totalOut: rows.reduce((sum, row) => sum + row.outTotal, 0),
        },
      };
    }),
  /** Full (non-paginated) movement list for Excel/PDF export, guarded by the row limit. */
  exportData: skladProcedure
    .input(
      z.object({
        productId: z.number().int().positive().optional(),
        agentId: z.number().int().positive().optional(),
        movementType: z.enum(["all", "in", "out"]).default("all"),
        from: z.number().int().optional(),
        to: z.number().int().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input.productId ? eq(stockMovements.productId, input.productId) : undefined,
        input.agentId ? eq(transactions.agentId, input.agentId) : undefined,
        input.movementType !== "all" ? eq(stockMovements.movementType, input.movementType) : undefined,
        input.from ? sql`${stockMovements.movementDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${stockMovements.movementDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;
      const [{ total }] = await db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(stockMovements)
        .leftJoin(transactions, eq(stockMovements.transactionId, transactions.id))
        .where(where);
      assertExportRowLimit(total, { entityLabel: "sklad harakati" });
      const rows = await db
        .select({
          id: stockMovements.id,
          productName: products.name,
          unit: products.unit,
          movementType: stockMovements.movementType,
          quantity: stockMovements.quantity,
          reason: stockMovements.reason,
          isAutomatic: stockMovements.isAutomatic,
          movementDate: stockMovements.movementDate,
          note: stockMovements.note,
          agentName: agents.name,
        })
        .from(stockMovements)
        .leftJoin(products, eq(stockMovements.productId, products.id))
        .leftJoin(transactions, eq(stockMovements.transactionId, transactions.id))
        .leftJoin(agents, eq(transactions.agentId, agents.id))
        .where(where)
        .orderBy(desc(stockMovements.movementDate), desc(stockMovements.id));
      return { rows, generatedAt: Date.now() };
    }),
});
