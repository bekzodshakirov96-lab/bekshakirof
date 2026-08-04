import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashEntries, clientPayments, clients, products, transactions } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure, requireOwnAgent, salesProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import {
  normalizeContainerType,
  reconcileTransactionContainers,
} from "../containerAccounting";
import { summarizeNetProfit, summarizeOperatingExpenses, summarizeProfit } from "../costing";
import { fetchAverageCosts } from "../costingQueries";
import { normalizeSearch, normalizeSearchable } from "../businessQueries";
import { requireDb } from "../db";
import { reconcileTransactionStock } from "../stockAccounting";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Savdo jurnali qidiruvi uchun SQL sharti.
 *
 * SQL `LIKE` ishlatilmaydi, chunki u lotin/kirill farqini bilmaydi: interfeys
 * kirill rejimida bo'lganda foydalanuvchi ekranda ko'rgan nomni tersa, bazadagi
 * lotin yozuvi bilan mos kelmasdi (baza tarixan aralash yozilgan).
 *
 * Buning o'rniga qidiruv avval kichik jadvallar (mijoz, agent va jurnaldagi
 * mahsulot nomlari — o'nlab/yuzlab qator) ustida xotirada bajariladi, so'ng
 * topilgan id/nomlar bo'yicha `IN (...)` sharti quriladi. Shu tariqa
 * transactions jadvalining o'zi to'liq o'qilmaydi va SQL sahifalash saqlanadi.
 */
export type SearchMatches = { clientIds: number[]; agentIds: number[]; productNames: string[] };

/**
 * Qidiruv so'ziga mos keluvchi mijoz/agent id'lari va mahsulot nomlarini ajratadi.
 * Sof funksiya — bazaga bog'liq emas, shuning uchun alohida sinaladi.
 */
export function findSearchMatches(
  rows: {
    clients: Array<{ id: number | null; name: string | null }>;
    agents: Array<{ id: number | null; name: string | null }>;
    productNames: Array<string | null>;
  },
  search: string,
): SearchMatches {
  const hit = (value: string | null) => normalizeSearchable(value).includes(search);
  return {
    clientIds: rows.clients.filter(row => hit(row.name)).flatMap(row => (row.id == null ? [] : [row.id])),
    agentIds: rows.agents.filter(row => hit(row.name)).flatMap(row => (row.id == null ? [] : [row.id])),
    productNames: rows.productNames.flatMap(name => (name != null && hit(name) ? [name] : [])),
  };
}

export async function buildSearchCondition(db: Awaited<ReturnType<typeof requireDb>>, rawSearch?: string) {
  const search = normalizeSearch(rawSearch);
  if (!search) return undefined;

  const [clientRows, agentRows, productNameRows] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients),
    db.select({ id: agents.id, name: agents.name }).from(agents),
    db.selectDistinct({ productName: transactions.productName }).from(transactions),
  ]);

  const matched = findSearchMatches(
    { clients: clientRows, agents: agentRows, productNames: productNameRows.map(row => row.productName) },
    search,
  );

  const conditions = [
    matched.clientIds.length ? inArray(transactions.clientId, matched.clientIds) : undefined,
    matched.agentIds.length ? inArray(transactions.agentId, matched.agentIds) : undefined,
    matched.productNames.length ? inArray(transactions.productName, matched.productNames) : undefined,
  ].filter(Boolean);

  // Hech narsa topilmasa `undefined` qaytarib bo'lmaydi — u "filtrsiz" degani
  // bo'lib, qidiruvga javob bermagan holda butun jurnalni qaytarib yuborardi.
  // Shuning uchun hech qachon rost bo'lmaydigan shart qaytariladi.
  if (conditions.length === 0) return sql`1 = 0`;
  return or(...conditions);
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
  /**
   * Tanlangan filter bo'yicha foyda hisobi: aylanma − sotilgan tovar tannarxi.
   *
   * `list` faqat joriy sahifani qaytaradi, foyda esa butun tanlov bo'yicha
   * kerak — shuning uchun alohida so'rov. Tannarxi kiritilmagan savdolar
   * alohida sanaladi, chunki ular foydani to'liq ko'rsatmaydi.
   */
  profitSummary: businessProcedure.input(listSchema).query(async ({ input }) => {
    const db = await requireDb();
    const conditions = [
      input.agentId ? eq(transactions.agentId, input.agentId) : undefined,
      input.clientId ? eq(transactions.clientId, input.clientId) : undefined,
      input.productId ? eq(transactions.productId, input.productId) : undefined,
      input.from ? sql`${transactions.transactionDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
      input.to ? sql`${transactions.transactionDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      await buildSearchCondition(db, input.search),
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db
      .select({
        totalAmount: transactions.totalAmount,
        quantity: transactions.quantity,
        unitCost: transactions.unitCost,
      })
      .from(transactions)
      .leftJoin(agents, eq(transactions.agentId, agents.id))
      .leftJoin(clients, eq(transactions.clientId, clients.id))
      .where(where);

    const profit = summarizeProfit(
      rows.map(row => ({
        totalAmount: row.totalAmount,
        quantity: Number(row.quantity),
        unitCost: row.unitCost,
      })),
    );

    // Operatsion xarajatlar faqat sana bo'yicha ma'noga ega: ish haqi, ijara va
    // gaz bitta agent yoki mijozga bo'linmaydi. Shu sababli agent/mijoz/mahsulot
    // filtri qo'yilganda sof foyda ko'rsatilmaydi.
    const hasNonDateFilter = Boolean(input.agentId || input.clientId || input.productId || input.search?.trim());
    if (hasNonDateFilter) {
      return { ...summarizeNetProfit(profit, { total: 0, excludedGoodsPayments: 0 }), expensesApplicable: false };
    }

    const expenseRows = await db
      .select({
        category: cashEntries.category,
        amount: sql<number>`${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount}`,
      })
      .from(cashEntries)
      .where(
        and(
          eq(cashEntries.type, "expense"),
          input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ),
      );

    const expenses = summarizeOperatingExpenses(
      expenseRows.map(row => ({ category: row.category, amount: Number(row.amount) })),
    );
    return { ...summarizeNetProfit(profit, expenses), expensesApplicable: true };
  }),
  list: businessProcedure.input(listSchema).query(async ({ input }) => {
    const db = await requireDb();
    const conditions = [
      input.agentId ? eq(transactions.agentId, input.agentId) : undefined,
      input.clientId ? eq(transactions.clientId, input.clientId) : undefined,
      input.productId ? eq(transactions.productId, input.productId) : undefined,
      input.from ? sql`${transactions.transactionDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
      input.to ? sql`${transactions.transactionDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      await buildSearchCondition(db, input.search),
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
        transferPayment: transactions.transferPayment,
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
      await buildSearchCondition(db, input.search),
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
        transferPayment: transactions.transferPayment,
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
        transferPayment: result.transferPayment + row.transferPayment,
        issuedContainers: result.issuedContainers + row.issuedContainerQuantity,
        returnedContainers: result.returnedContainers + row.returnedContainerQuantity,
      }),
      {
        rowCount: 0,
        totalAmount: 0,
        cashPayment: 0,
        terminalPayment: 0,
        clickPayment: 0,
        transferPayment: 0,
        issuedContainers: 0,
        returnedContainers: 0,
      },
    );
    return { rows, summary, filters: input, generatedAt: Date.now() };
  }),
  create: salesProcedure
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
          transferPayment: z.number().int().min(0).default(0),
          returnContainerType: z.enum(["keg_30", "keg_50"]).nullable().optional(),
          returnQuantity: z.number().int().min(0).max(1_000_000).default(0),
          note: z.string().max(1_000).optional(),
        })
        .refine(
          value => value.cashPayment + value.terminalPayment + value.clickPayment + value.transferPayment <= value.quantity * value.salePrice,
          { message: "To‘lov summasi savdo summasidan oshmasligi kerak." },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      requireOwnAgent(ctx.user.role, ctx.user.agentId, input.agentId);
      await assertPeriodUnlocked(new Date(input.transactionDate));
      const db = await requireDb();
      const [client] = await db.select({ agentId: clients.agentId }).from(clients).where(eq(clients.id, input.clientId)).limit(1);
      if (!client) throw new Error("Mijoz topilmadi.");
      if (client.agentId !== input.agentId) throw new Error("Bu mijoz ko‘rsatilgan agentga biriktirilmagan.");
      return db.transaction(async tx => {
        const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
        if (!product) throw new Error("Mahsulot topilmadi.");
        if (product.containerType) throw new Error("KEG/tara mahsulotlarini Savdo jurnalida sotib bo‘lmaydi — Tezkor KEG savdosi bo‘limidan foydalaning.");
        const totalAmount = Math.round(input.quantity * input.salePrice);
        const transactionDate = new Date(input.transactionDate);
        const unitCosts = await fetchAverageCosts(tx, [product.id]);
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
            unitCost: unitCosts.get(product.id) ?? 0,
            totalAmount,
            cashPayment: input.cashPayment,
            terminalPayment: input.terminalPayment,
            clickPayment: input.clickPayment,
            transferPayment: input.transferPayment,
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
        await logAudit(tx, {
          tableName: "transactions",
          recordId: created.id,
          action: "create",
          userId: ctx.user.id,
          after: { clientId: input.clientId, agentId: input.agentId, productName: product.name, quantity: input.quantity, salePrice: input.salePrice, totalAmount, cashPayment: input.cashPayment, terminalPayment: input.terminalPayment, clickPayment: input.clickPayment, transferPayment: input.transferPayment },
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
  createMultiple: salesProcedure
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
          transferPayment: z.number().int().min(0).default(0),
          /** Savdo summasidan tashqari, shu mijozning eski qarzini yopish uchun qo'shimcha
           * naqd pul — alohida `client_payments` yozuvi sifatida saqlanadi, savat jamisiga
           * cheklanmaydi. */
          debtPaymentAmount: z.number().int().min(0).default(0),
          note: z.string().max(1_000).optional(),
        })
        .refine(value => {
          const productIds = value.items.map(item => item.productId);
          return new Set(productIds).size === productIds.length;
        }, { message: "Bir mahsulot savatda faqat bir marta bo‘lishi mumkin." }),
      // To'lov savat jamisidan oshishi endi taqiqlanmaydi — ortiqcha qism pastda
      // avtomatik ravishda mijozning eski qarzini yopishga yo'naltiriladi (qaysi
      // kanaldan kelgan bo'lsa, o'sha kanalga yozilgan holda).
    )
    .mutation(async ({ input, ctx }) => {
      requireOwnAgent(ctx.user.role, ctx.user.agentId, input.agentId);
      await assertPeriodUnlocked(new Date(input.transactionDate));
      const db = await requireDb();
      const [client] = await db.select({ agentId: clients.agentId }).from(clients).where(eq(clients.id, input.clientId)).limit(1);
      if (!client) throw new Error("Mijoz topilmadi.");
      if (client.agentId !== input.agentId) throw new Error("Bu mijoz ko‘rsatilgan agentga biriktirilmagan.");
      return db.transaction(async tx => {
        const productRows = await tx
          .select()
          .from(products)
          .where(inArray(products.id, input.items.map(item => item.productId)));
        const productById = new Map(productRows.map(product => [product.id, product]));

        const lineTotals = input.items.map(item => Math.round(item.quantity * item.salePrice));
        let remainingBudget = input.cashPayment + input.terminalPayment + input.clickPayment + input.transferPayment;
        const lineAllocatedTotal = lineTotals.map(total => {
          const take = Math.min(total, remainingBudget);
          remainingBudget -= take;
          return take;
        });

        let remainingCash = input.cashPayment;
        let remainingTerminal = input.terminalPayment;
        let remainingClick = input.clickPayment;
        let remainingTransfer = input.transferPayment;
        const transactionDate = new Date(input.transactionDate);
        // Tannarx nusxasi savatdagi barcha mahsulotlar uchun bir marta olinadi.
        const unitCosts = await fetchAverageCosts(tx, input.items.map(item => item.productId));
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
          need -= clickTake;
          remainingClick -= clickTake;
          const transferTake = Math.min(need, remainingTransfer);
          remainingTransfer -= transferTake;

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
              unitCost: unitCosts.get(product.id) ?? 0,
              totalAmount,
              cashPayment: cashTake,
              terminalPayment: terminalTake,
              clickPayment: clickTake,
              transferPayment: transferTake,
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
          await logAudit(tx, {
            tableName: "transactions",
            recordId: created.id,
            action: "create",
            userId: ctx.user.id,
            after: { clientId: input.clientId, agentId: input.agentId, productName: product.name, quantity: item.quantity, salePrice: item.salePrice, totalAmount, cashPayment: cashTake, terminalPayment: terminalTake, clickPayment: clickTake, transferPayment: transferTake },
          });
          results.push({ productName: product.name, totalAmount });
        }

        // Savatga yetmagan (line-by-line taqsimlangandan keyin ortib qolgan) har bir kanal
        // summasi — mijoz savdo narxidan ko'proq pul topshirgani uchun avtomatik ravishda
        // eski qarzni yopishga yo'naltiriladi, aynan qaysi kanaldan kelgan bo'lsa o'sha
        // kanalga yozilgan holda (Kutilayotgan kassa panelidagi hisob to'g'ri qolishi uchun).
        const overpaidCash = remainingCash;
        const overpaidTerminal = remainingTerminal;
        const overpaidClick = remainingClick;
        const overpaidTransfer = remainingTransfer;
        const totalDebtCash = input.debtPaymentAmount + overpaidCash;
        const totalDebtPayment = totalDebtCash + overpaidTerminal + overpaidClick + overpaidTransfer;

        if (totalDebtPayment > 0) {
          const [createdPayment] = await tx.insert(clientPayments).values({
            clientId: input.clientId,
            agentId: input.agentId,
            paymentDate: transactionDate,
            cashAmount: totalDebtCash,
            terminalAmount: overpaidTerminal,
            clickAmount: overpaidClick,
            transferAmount: overpaidTransfer,
            note:
              overpaidCash + overpaidTerminal + overpaidClick + overpaidTransfer > 0
                ? "Yangi savdo orqali qabul qilingan qo‘shimcha to‘lov (savdo narxidan ortiqcha qismi avtomatik eski qarzga yozildi)"
                : "Yangi savdo orqali qabul qilingan qo‘shimcha to‘lov (eski qarz)",
            createdBy: ctx.user.id,
          }).$returningId();
          await logAudit(tx, {
            tableName: "client_payments",
            recordId: createdPayment.id,
            action: "create",
            userId: ctx.user.id,
            after: {
              clientId: input.clientId,
              agentId: input.agentId,
              cashAmount: totalDebtCash,
              terminalAmount: overpaidTerminal,
              clickAmount: overpaidClick,
              transferAmount: overpaidTransfer,
              source: "Yangi savdo",
            },
          });
        }

        return {
          success: true,
          cartTotal,
          lineCount: results.length,
          lines: results,
          debtPaymentAmount: totalDebtPayment,
        } as const;
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
          transferPayment: z.number().int().min(0).default(0),
          returnContainerType: z.enum(["keg_30", "keg_50"]).nullable().optional(),
          returnQuantity: z.number().int().min(0).max(1_000_000).default(0),
          note: z.string().max(1_000).nullable().optional(),
          reason: z.string().trim().max(500).optional(),
        })
        .refine(
          value => value.cashPayment + value.terminalPayment + value.clickPayment + value.transferPayment <= value.quantity * value.salePrice,
          { message: "To‘lov summasi savdo summasidan oshmasligi kerak." },
        ),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select().from(transactions).where(eq(transactions.id, input.id)).limit(1);
      if (!previous) throw new Error("Operatsiya topilmadi.");
      // Eski ham, yangi ham qulflangan davrga tushmasligi kerak — aks holda yozuvni
      // qulflangan kundan chiqarib yoki qulflangan kunga kiritib qo'yish mumkin bo'lardi.
      await assertPeriodUnlocked(previous.transactionDate);
      await assertPeriodUnlocked(new Date(input.transactionDate));
      return db.transaction(async tx => {
        const [product] = await tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
        if (!product) throw new Error("Mahsulot topilmadi.");
        if (product.containerType) throw new Error("KEG/tara mahsulotlarini Savdo jurnalida sotib bo‘lmaydi — Tezkor KEG savdosi bo‘limidan foydalaning.");
        const totalAmount = Math.round(input.quantity * input.salePrice);
        const transactionDate = new Date(input.transactionDate);
        // Tahrirlashda mahsulot almashtirilgan bo'lishi mumkin — tannarx qaytadan olinadi.
        const unitCosts = await fetchAverageCosts(tx, [product.id]);
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
            unitCost: unitCosts.get(product.id) ?? 0,
            totalAmount,
            cashPayment: input.cashPayment,
            terminalPayment: input.terminalPayment,
            clickPayment: input.clickPayment,
            transferPayment: input.transferPayment,
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
        const [updated] = await tx.select().from(transactions).where(eq(transactions.id, input.id)).limit(1);
        await logAudit(tx, {
          tableName: "transactions",
          recordId: input.id,
          action: "update",
          userId: ctx.user.id,
          before: previous,
          after: updated,
          reason: input.reason ?? null,
        });
        return { success: true, totalAmount, containerImpact };
      });
    }),
  /** Deletes one transaction. Linked container_movements and stockMovements cascade-delete automatically (FK ON DELETE CASCADE). */
  delete: businessProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [existing] = await db.select().from(transactions).where(eq(transactions.id, input.id)).limit(1);
      if (!existing) {
        throw new Error("Operatsiya topilmadi yoki allaqachon o‘chirilgan.");
      }
      await assertPeriodUnlocked(existing.transactionDate);
      return db.transaction(async tx => {
        await tx.delete(transactions).where(eq(transactions.id, input.id));
        await logAudit(tx, {
          tableName: "transactions",
          recordId: input.id,
          action: "delete",
          userId: ctx.user.id,
          before: existing,
          reason: input.reason ?? null,
        });
        return { success: true } as const;
      });
    }),
});
