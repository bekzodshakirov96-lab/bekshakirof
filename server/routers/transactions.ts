import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, clients, products, transactions } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure } from "../access";
import {
  normalizeContainerType,
  reconcileTransactionContainers,
} from "../containerAccounting";
import { requireDb } from "../db";
import { reconcileTransactionStock } from "../stockAccounting";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
import { router } from "../_core/trpc";
import { assertExportRowLimit, MAX_EXPORT_ROWS } from "../reportExport";

const listSchema = z
  .object({
    search: z.string().max(120).optional(),
    agentId: z.number().int().positive().optional(),
    clientId: z.number().int().positive().optional(),
    productId: z.number().int().positive().optional(),
    from: z.number().int().optional(),
    to: z.number().int().optional(),
    sortBy: z
      .enum(["transactionDate", "agentName", "clientName", "productName", "quantity", "totalAmount"])
      .default("transactionDate"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().min(10).max(100).default(25),
  })
  .default({ sortBy: "transactionDate", sortOrder: "desc", page: 1, pageSize: 25 });

export const transactionsRouter = router({
  list: businessProcedure.input(listSchema).query(async ({ input }) => {
    const db = await requireDb();
    const conditions = [
      input.agentId ? eq(transactions.agentId, input.agentId) : undefined,
      input.clientId ? eq(transactions.clientId, input.clientId) : undefined,
      input.productId ? eq(transactions.productId, input.productId) : undefined,
      input.from ? sql`${transactions.transactionDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
      input.to ? sql`${transactions.transactionDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      input.search?.trim()
        ? or(
            like(transactions.productName, `%${input.search.trim()}%`),
            like(clients.name, `%${input.search.trim()}%`),
            like(agents.name, `%${input.search.trim()}%`),
          )
        : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = {
      transactionDate: transactions.transactionDate,
      agentName: agents.name,
      clientName: clients.name,
      productName: transactions.productName,
      quantity: transactions.quantity,
      totalAmount: transactions.totalAmount,
    }[input.sortBy];
    const sortDirection = input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const offset = (input.page - 1) * input.pageSize;
    const items = await db
      .select({
        id: transactions.id,
        transactionDate: transactions.transactionDate,
        agentId: transactions.agentId,
        agentName: agents.name,
        clientId: transactions.clientId,
        clientName: clients.name,
        productId: transactions.productId,
        productName: transactions.productName,
        unit: transactions.unit,
        quantity: transactions.quantity,
        salePrice: transactions.salePrice,
        totalAmount: transactions.totalAmount,
        cashPayment: transactions.cashPayment,
        terminalPayment: transactions.terminalPayment,
        clickPayment: transactions.clickPayment,
        note: transactions.note,
        source: transactions.source,
        issuedContainerType:
          sql<string | null>`(select cm.containerType from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'issued' limit 1)`,
        issuedContainerQuantity:
          sql<number>`coalesce((select sum(cm.quantity) from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'issued'), 0)`.mapWith(
            Number,
          ),
        returnedContainerType:
          sql<string | null>`(select cm.containerType from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'returned' limit 1)`,
        returnedContainerQuantity:
          sql<number>`coalesce((select sum(cm.quantity) from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'returned'), 0)`.mapWith(
            Number,
          ),
      })
      .from(transactions)
      .leftJoin(agents, eq(transactions.agentId, agents.id))
      .leftJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .orderBy(sortDirection, desc(transactions.id))
      .limit(input.pageSize)
      .offset(offset);
    const [totalRow] = await db
      .select({ total: count() })
      .from(transactions)
      .leftJoin(agents, eq(transactions.agentId, agents.id))
      .leftJoin(clients, eq(transactions.clientId, clients.id))
      .where(where);
    return {
      items,
      total: totalRow.total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(totalRow.total / input.pageSize)),
    };
  }),
  exportData: businessProcedure.input(listSchema).query(async ({ input }) => {
    const db = await requireDb();
    const conditions = [
      input.agentId ? eq(transactions.agentId, input.agentId) : undefined,
      input.clientId ? eq(transactions.clientId, input.clientId) : undefined,
      input.productId ? eq(transactions.productId, input.productId) : undefined,
      input.from ? sql`${transactions.transactionDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
      input.to ? sql`${transactions.transactionDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      input.search?.trim()
        ? or(
            like(transactions.productName, `%${input.search.trim()}%`),
            like(clients.name, `%${input.search.trim()}%`),
            like(agents.name, `%${input.search.trim()}%`),
          )
        : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;
    const sortColumn = {
      transactionDate: transactions.transactionDate,
      agentName: agents.name,
      clientName: clients.name,
      productName: transactions.productName,
      quantity: transactions.quantity,
      totalAmount: transactions.totalAmount,
    }[input.sortBy];
    const sortDirection = input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const rows = await db
      .select({
        id: transactions.id,
        transactionDate: transactions.transactionDate,
        agentName: agents.name,
        clientName: clients.name,
        productName: transactions.productName,
        unit: transactions.unit,
        quantity: transactions.quantity,
        salePrice: transactions.salePrice,
        totalAmount: transactions.totalAmount,
        cashPayment: transactions.cashPayment,
        terminalPayment: transactions.terminalPayment,
        clickPayment: transactions.clickPayment,
        note: transactions.note,
        source: transactions.source,
        issuedContainerType:
          sql<string | null>`(select cm.containerType from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'issued' limit 1)`,
        issuedContainerQuantity:
          sql<number>`coalesce((select sum(cm.quantity) from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'issued'), 0)`.mapWith(
            Number,
          ),
        returnedContainerType:
          sql<string | null>`(select cm.containerType from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'returned' limit 1)`,
        returnedContainerQuantity:
          sql<number>`coalesce((select sum(cm.quantity) from container_movements cm where cm.transactionId = ${transactions.id} and cm.movementType = 'returned'), 0)`.mapWith(
            Number,
          ),
      })
      .from(transactions)
      .leftJoin(agents, eq(transactions.agentId, agents.id))
      .leftJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .orderBy(sortDirection, desc(transactions.id))
      .limit(MAX_EXPORT_ROWS + 1);
    assertExportRowLimit(rows.length, { filterHint: "Sana yoki boshqa filterlarni toraytiring." });
    const summary = rows.reduce(
      (result, row) => ({
        rowCount: result.rowCount + 1,
        totalAmount: result.totalAmount + row.totalAmount,
        cashPayment: result.cashPayment + row.cashPayment,
        terminalPayment: result.terminalPayment + row.terminalPayment,
        clickPayment: result.clickPayment + row.clickPayment,
        issuedContainers: result.issuedContainers + row.issuedContainerQuantity,
        returnedContainers: result.returnedContainers + row.returnedContainerQuantity,
      }),
      {
        rowCount: 0,
        totalAmount: 0,
        cashPayment: 0,
        terminalPayment: 0,
        clickPayment: 0,
        issuedContainers: 0,
        returnedContainers: 0,
      },
    );
    return { rows, summary, filters: input, generatedAt: Date.now() };
  }),
  create: businessProcedure
    .input(
      z
        .object({
          transactionDate: z.number().int(),
          agentId: z.number().int().positive(),
          clientId: z.number().int().positive(),
          productId: z.number().int().positive(),
          quantity: z.number().positive().max(1_000_000),
          salePrice: z.number().int().min(0).max(9_000_000_000_000),
          cashPayment: z.number().int().min(0).default(0),
          terminalPayment: z.number().int().min(0).default(0),
          clickPayment: z.number().int().min(0).default(0),
          returnContainerType: z.enum(["keg_30", "keg_50"]).nullable().optional(),
          returnQuantity: z.number().int().min(0).max(1_000_000).default(0),
          note: z.string().max(1_000).optional(),
        })
        .refine(
          value => value.cashPayment + value.terminalPayment + value.clickPayment <= value.quantity * value.salePrice,
          { message: "To‘lov summasi savdo summasidan oshmasligi kerak." },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
        if (!product) throw new Error("Mahsulot topilmadi.");
        if (product.containerType) throw new Error("KEG/tara mahsulotlarini Savdo jurnalida sotib bo‘lmaydi — Tezkor KEG savdosi bo‘limidan foydalaning.");
        const totalAmount = Math.round(input.quantity * input.salePrice);
        const transactionDate = new Date(input.transactionDate);
        const [created] = await tx
          .insert(transactions)
          .values({
            sourceKey: `manual:${randomUUID()}`,
            transactionDate,
            agentId: input.agentId,
            clientId: input.clientId,
            productId: product.id,
            productName: product.name,
            unit: product.unit,
            quantity: input.quantity.toFixed(3),
            currentPrice: product.price,
            salePrice: input.salePrice,
            totalAmount,
            cashPayment: input.cashPayment,
            terminalPayment: input.terminalPayment,
            clickPayment: input.clickPayment,
            note: input.note,
            source: "manual",
            createdBy: ctx.user.id,
          })
          .$returningId();
        const productContainerType = product.containerType ?? normalizeContainerType(product.name);
        const containerImpact = await reconcileTransactionContainers(tx, {
          transactionId: created.id,
          movementDate: transactionDate,
          agentId: input.agentId,
          clientId: input.clientId,
          productContainerType,
          productQuantity: input.quantity,
          containerUnitsPerItem: productContainerType ? product.containerUnitsPerItem || 1 : 0,
          returnContainerType: input.returnContainerType,
          returnQuantity: input.returnQuantity,
          createdBy: ctx.user.id,
          source: "manual",
        });
        await reconcileTransactionStock(tx, {
          transactionId: created.id,
          movementDate: transactionDate,
          productId: product.id,
          quantity: input.quantity,
          createdBy: ctx.user.id,
        });
        return { success: true, totalAmount, containerImpact };
      });
    }),
  /**
   * Quick-sale: one client, several product lines in a single cart, one combined
   * payment (cash/terminal/click) for the whole cart. Payment is filled into lines
   * in order (cash budget first, then terminal, then click) so every line's own
   * payment never exceeds its own line total — debt math stays consistent because
   * client debt is always computed as a live sum across all transactions.
   */
  createMultiple: businessProcedure
    .input(
      z
        .object({
          transactionDate: z.number().int(),
          agentId: z.number().int().positive(),
          clientId: z.number().int().positive(),
          items: z
            .array(
              z.object({
                productId: z.number().int().positive(),
                quantity: z.number().positive().max(1_000_000),
                salePrice: z.number().int().min(0).max(9_000_000_000_000),
                returnContainerType: z.enum(["keg_30", "keg_50"]).nullable().optional(),
                returnQuantity: z.number().int().min(0).max(1_000_000).default(0),
              }),
            )
            .min(1, "Kamida bitta mahsulot tanlang.")
            .max(30, "Bir savdoda 30 tadan ortiq mahsulot bo‘lishi mumkin emas."),
          cashPayment: z.number().int().min(0).default(0),
          terminalPayment: z.number().int().min(0).default(0),
          clickPayment: z.number().int().min(0).default(0),
          note: z.string().max(1_000).optional(),
        })
        .refine(value => {
          const productIds = value.items.map(item => item.productId);
          return new Set(productIds).size === productIds.length;
        }, { message: "Bir mahsulot savatda faqat bir marta bo‘lishi mumkin." })
        .refine(
          value => {
            const cartTotal = value.items.reduce((sum, item) => sum + Math.round(item.quantity * item.salePrice), 0);
            return value.cashPayment + value.terminalPayment + value.clickPayment <= cartTotal;
          },
          { message: "To‘lov summasi savat jamisidan oshmasligi kerak." },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const productRows = await tx
          .select()
          .from(products)
          .where(inArray(products.id, input.items.map(item => item.productId)));
        const productById = new Map(productRows.map(product => [product.id, product]));

        const lineTotals = input.items.map(item => Math.round(item.quantity * item.salePrice));
        let remainingBudget = input.cashPayment + input.terminalPayment + input.clickPayment;
        const lineAllocatedTotal = lineTotals.map(total => {
          const take = Math.min(total, remainingBudget);
          remainingBudget -= take;
          return take;
        });

        let remainingCash = input.cashPayment;
        let remainingTerminal = input.terminalPayment;
        let remainingClick = input.clickPayment;
        const transactionDate = new Date(input.transactionDate);
        let cartTotal = 0;
        const results: Array<{ productName: string; totalAmount: number }> = [];

        for (let i = 0; i < input.items.length; i++) {
          const item = input.items[i];
          const product = productById.get(item.productId);
          if (!product) throw new Error(`Mahsulot topilmadi (ID: ${item.productId}).`);
          if (product.containerType) throw new Error("KEG/tara mahsulotlarini Savdo jurnalida sotib bo‘lmaydi — Tezkor KEG savdosi bo‘limidan foydalaning.");

          let need = lineAllocatedTotal[i];
          const cashTake = Math.min(need, remainingCash);
          need -= cashTake;
          remainingCash -= cashTake;
          const terminalTake = Math.min(need, remainingTerminal);
          need -= terminalTake;
          remainingTerminal -= terminalTake;
          const clickTake = Math.min(need, remainingClick);
          remainingClick -= clickTake;

          const totalAmount = lineTotals[i];
          cartTotal += totalAmount;
          const [created] = await tx
            .insert(transactions)
            .values({
              sourceKey: `manual:${randomUUID()}`,
              transactionDate,
              agentId: input.agentId,
              clientId: input.clientId,
              productId: product.id,
              productName: product.name,
              unit: product.unit,
              quantity: item.quantity.toFixed(3),
              currentPrice: product.price,
              salePrice: item.salePrice,
              totalAmount,
              cashPayment: cashTake,
              terminalPayment: terminalTake,
              clickPayment: clickTake,
              note: input.note,
              source: "manual",
              createdBy: ctx.user.id,
            })
            .$returningId();

          const productContainerType = product.containerType ?? normalizeContainerType(product.name);
          await reconcileTransactionContainers(tx, {
            transactionId: created.id,
            movementDate: transactionDate,
            agentId: input.agentId,
            clientId: input.clientId,
            productContainerType,
            productQuantity: item.quantity,
            containerUnitsPerItem: productContainerType ? product.containerUnitsPerItem || 1 : 0,
            returnContainerType: item.returnContainerType,
            returnQuantity: item.returnQuantity,
            createdBy: ctx.user.id,
            source: "manual",
          });
          await reconcileTransactionStock(tx, {
            transactionId: created.id,
            movementDate: transactionDate,
            productId: product.id,
            quantity: item.quantity,
            createdBy: ctx.user.id,
          });
          results.push({ productName: product.name, totalAmount });
        }

        return { success: true, cartTotal, lineCount: results.length, lines: results } as const;
      });
    }),
  update: businessProcedure
    .input(
      z
        .object({
          id: z.number().int().positive(),
          transactionDate: z.number().int(),
          agentId: z.number().int().positive(),
          clientId: z.number().int().positive(),
          productId: z.number().int().positive(),
          quantity: z.number().positive().max(1_000_000),
          salePrice: z.number().int().min(0).max(9_000_000_000_000),
          cashPayment: z.number().int().min(0),
          terminalPayment: z.number().int().min(0),
          clickPayment: z.number().int().min(0),
          returnContainerType: z.enum(["keg_30", "keg_50"]).nullable().optional(),
          returnQuantity: z.number().int().min(0).max(1_000_000).default(0),
          note: z.string().max(1_000).nullable().optional(),
        })
        .refine(
          value => value.cashPayment + value.terminalPayment + value.clickPayment <= value.quantity * value.salePrice,
          { message: "To‘lov summasi savdo summasidan oshmasligi kerak." },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
        if (!product) throw new Error("Mahsulot topilmadi.");
        if (product.containerType) throw new Error("KEG/tara mahsulotlarini Savdo jurnalida sotib bo‘lmaydi — Tezkor KEG savdosi bo‘limidan foydalaning.");
        const totalAmount = Math.round(input.quantity * input.salePrice);
        const transactionDate = new Date(input.transactionDate);
        await tx
          .update(transactions)
          .set({
            transactionDate,
            agentId: input.agentId,
            clientId: input.clientId,
            productId: product.id,
            productName: product.name,
            unit: product.unit,
            quantity: input.quantity.toFixed(3),
            currentPrice: product.price,
            salePrice: input.salePrice,
            totalAmount,
            cashPayment: input.cashPayment,
            terminalPayment: input.terminalPayment,
            clickPayment: input.clickPayment,
            note: input.note ?? null,
          })
          .where(eq(transactions.id, input.id));
        const productContainerType = product.containerType ?? normalizeContainerType(product.name);
        const containerImpact = await reconcileTransactionContainers(tx, {
          transactionId: input.id,
          movementDate: transactionDate,
          agentId: input.agentId,
          clientId: input.clientId,
          productContainerType,
          productQuantity: input.quantity,
          containerUnitsPerItem: productContainerType ? product.containerUnitsPerItem || 1 : 0,
          returnContainerType: input.returnContainerType,
          returnQuantity: input.returnQuantity,
          createdBy: ctx.user.id,
          source: "manual",
        });
        await reconcileTransactionStock(tx, {
          transactionId: input.id,
          movementDate: transactionDate,
          productId: product.id,
          quantity: input.quantity,
          createdBy: ctx.user.id,
        });
        return { success: true, totalAmount, containerImpact };
      });
    }),
  /** Deletes one transaction. Linked container_movements and stockMovements cascade-delete automatically (FK ON DELETE CASCADE). */
  delete: businessProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [existing] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, input.id)).limit(1);
      if (!existing) {
        throw new Error("Operatsiya topilmadi yoki allaqachon o‘chirilgan.");
      }
      await db.delete(transactions).where(eq(transactions.id, input.id));
      return { success: true } as const;
    }),
  /**
   * Deletes ALL transactions (and their cascaded container_movements). Owner-only —
   * this is destructive and cannot be undone. Client currentDebt is computed live
   * from openingDebt + sales - payments, so it updates correctly with no extra step.
   */
  clearAll: ownerProcedure.mutation(async () => {
    const db = await requireDb();
    const [{ total }] = await db.select({ total: count() }).from(transactions);
    await db.delete(transactions);
    return { success: true, deletedCount: total } as const;
  }),
});
