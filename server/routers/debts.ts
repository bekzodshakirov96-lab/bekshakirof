import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { agents, clientPayments, clients, containerMovements, transactions } from "../../drizzle/schema";
import { businessProcedure, debtsViewProcedure, requireOwnAgent, salesProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import {
  enrichClientFinancialRows,
  getClientCurrentDebt,
  getClientFinancialRows,
  normalizeSearch,
  paginate,
} from "../businessQueries";
import { normalizeContainerType } from "../containerAccounting";
import { requireDb } from "../db";
import { router } from "../_core/trpc";
import { assertExportRowLimit } from "../reportExport";

const filterFields = {
  search: z.string().max(120).optional(),
  agentId: z.number().int().positive().optional(),
  status: z.enum(["all", "debt", "clear", "credit"]).default("all"),
  minDebt: z.number().int().optional(),
  maxDebt: z.number().int().optional(),
  sortBy: z
    .enum(["code", "name", "agentName", "openingDebt", "totalSales", "totalPaid", "currentDebt"])
    .default("currentDebt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
};

const filterInput = z.object(filterFields).default({
  status: "all",
  sortBy: "currentDebt",
  sortOrder: "desc",
});

const listInput = z.object({
  ...filterFields,
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
}).default({
  status: "all",
  sortBy: "currentDebt",
  sortOrder: "desc",
  page: 1,
  pageSize: 25,
});

type DebtFilterInput = z.infer<typeof filterInput>;

async function loadDebtRows(input: DebtFilterInput) {
  const search = normalizeSearch(input.search);
  return enrichClientFinancialRows(await getClientFinancialRows())
    .filter(row => {
      const matchesSearch =
        !search ||
        row.code.toLocaleLowerCase("uz-Latn").includes(search) ||
        row.name.toLocaleLowerCase("uz-Latn").includes(search) ||
        (row.agentName ?? "").toLocaleLowerCase("uz-Latn").includes(search);
      const matchesAgent = !input.agentId || row.agentId === input.agentId;
      const matchesStatus =
        input.status === "all" ||
        (input.status === "debt" && row.currentDebt > 0) ||
        (input.status === "clear" && row.currentDebt === 0) ||
        (input.status === "credit" && row.currentDebt < 0);
      const matchesMin = input.minDebt === undefined || row.currentDebt >= input.minDebt;
      const matchesMax = input.maxDebt === undefined || row.currentDebt <= input.maxDebt;
      return matchesSearch && matchesAgent && matchesStatus && matchesMin && matchesMax;
    })
    .sort((a, b) => {
      const left = a[input.sortBy] ?? "";
      const right = b[input.sortBy] ?? "";
      const direction = input.sortOrder === "asc" ? 1 : -1;
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), "uz") * direction;
    });
}

function summarizeDebtRows(rows: Awaited<ReturnType<typeof loadDebtRows>>) {
  return {
    clientCount: rows.length,
    debtorCount: rows.filter(row => row.currentDebt > 0).length,
    totalOpeningDebt: rows.reduce((sum, row) => sum + row.openingDebt, 0),
    totalSales: rows.reduce((sum, row) => sum + row.totalSales, 0),
    totalPaid: rows.reduce((sum, row) => sum + row.totalPaid, 0),
    currentDebt: rows.reduce((sum, row) => sum + row.currentDebt, 0),
  };
}

export const debtsRouter = router({
  /**
   * Mijozning qarz to'lovlari — savdodan alohida qabul qilingan pul.
   * Kassaga ta'sir qilmaydi: faqat mijozning qarz balansini kamaytiradi.
   */
  payments: router({
    byClient: debtsViewProcedure
      .input(z.object({ clientId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        return db
          .select({
            id: clientPayments.id,
            paymentDate: clientPayments.paymentDate,
            cashAmount: clientPayments.cashAmount,
            terminalAmount: clientPayments.terminalAmount,
            clickAmount: clientPayments.clickAmount,
            note: clientPayments.note,
          })
          .from(clientPayments)
          .where(eq(clientPayments.clientId, input.clientId))
          .orderBy(desc(clientPayments.paymentDate), desc(clientPayments.id));
      }),

    create: salesProcedure
      .input(
        z.object({
          clientId: z.number().int().positive(),
          paymentDate: z.number().int(),
          cashAmount: z.number().int().min(0).default(0),
          terminalAmount: z.number().int().min(0).default(0),
          clickAmount: z.number().int().min(0).default(0),
          note: z.string().max(1_000).optional(),
        }).refine(value => value.cashAmount + value.terminalAmount + value.clickAmount > 0, {
          message: "To'lov summasi kiritilmagan.",
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        // Agent faqat o'ziga biriktirilgan mijozdan to'lov qabul qila oladi.
        const [client] = await db
          .select({ id: clients.id, agentId: clients.agentId })
          .from(clients)
          .where(eq(clients.id, input.clientId))
          .limit(1);
        if (!client) throw new Error("Mijoz topilmadi.");
        if (client.agentId !== null) requireOwnAgent(ctx.user.role, ctx.user.agentId, client.agentId);
        await assertPeriodUnlocked(new Date(input.paymentDate));

        return db.transaction(async tx => {
          const [created] = await tx.insert(clientPayments).values({
            clientId: input.clientId,
            agentId: client.agentId,
            paymentDate: new Date(input.paymentDate),
            cashAmount: input.cashAmount,
            terminalAmount: input.terminalAmount,
            clickAmount: input.clickAmount,
            note: input.note?.trim() || null,
            createdBy: ctx.user.id,
          }).$returningId();
          await logAudit(tx, {
            tableName: "client_payments",
            recordId: created.id,
            action: "create",
            userId: ctx.user.id,
            after: {
              clientId: input.clientId,
              agentId: client.agentId,
              cashAmount: input.cashAmount,
              terminalAmount: input.terminalAmount,
              clickAmount: input.clickAmount,
              note: input.note?.trim() || null,
            },
          });
          return { success: true };
        });
      }),

    delete: salesProcedure
      .input(z.object({ id: z.number().int().positive(), reason: z.string().trim().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const [existing] = await db
          .select()
          .from(clientPayments)
          .where(eq(clientPayments.id, input.id))
          .limit(1);
        if (!existing) throw new Error("To'lov topilmadi yoki allaqachon o'chirilgan.");
        const [owner] = await db
          .select({ agentId: clients.agentId })
          .from(clients)
          .where(eq(clients.id, existing.clientId))
          .limit(1);
        if (owner?.agentId != null) requireOwnAgent(ctx.user.role, ctx.user.agentId, owner.agentId);
        await assertPeriodUnlocked(existing.paymentDate);
        return db.transaction(async tx => {
          await tx.delete(clientPayments).where(eq(clientPayments.id, input.id));
          await logAudit(tx, {
            tableName: "client_payments",
            recordId: input.id,
            action: "delete",
            userId: ctx.user.id,
            before: existing,
            reason: input.reason ?? null,
          });
          return { success: true };
        });
      }),
  }),

  /** Bitta mijozning joriy qarzi — Yangi savdo formasidagi "qarzni yopish" maydoni uchun. */
  currentDebt: debtsViewProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => ({ currentDebt: await getClientCurrentDebt(input.clientId) })),
  list: debtsViewProcedure.input(listInput).query(async ({ input }) => {
    const rows = await loadDebtRows(input);
    return {
      ...paginate(rows, input.page, input.pageSize),
      summary: summarizeDebtRows(rows),
    };
  }),
  exportData: businessProcedure.input(filterInput).query(async ({ input }) => {
    const rows = await loadDebtRows(input);
    assertExportRowLimit(rows.length);
    return {
      rows,
      summary: summarizeDebtRows(rows),
      filters: input,
      generatedAt: Date.now(),
    };
  }),
  /** Full ledger for one client — the source data for the "Akt sverka" reconciliation statement:
   * opening balance, every sale/payment in the period with a running balance, container (KEG)
   * issue/return movements with a running net, and the resulting closing balance. */
  clientStatement: debtsViewProcedure
    .input(z.object({ clientId: z.number().int().positive(), from: z.number().int().optional(), to: z.number().int().optional() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const [client] = await db
        .select({
          id: clients.id,
          code: clients.code,
          name: clients.name,
          phone: clients.phone,
          address: clients.address,
          openingDebt: clients.openingDebt,
          agentName: agents.name,
        })
        .from(clients)
        .leftJoin(agents, eq(clients.agentId, agents.id))
        .where(eq(clients.id, input.clientId))
        .limit(1);
      if (!client) throw new Error("Mijoz topilmadi.");

      const fromDate = input.from ? new Date(input.from) : undefined;
      const toDate = input.to ? new Date(input.to) : undefined;

      let openingBalance = client.openingDebt;
      if (fromDate) {
        const priorRows = await db
          .select({ totalAmount: transactions.totalAmount, cashPayment: transactions.cashPayment, terminalPayment: transactions.terminalPayment, clickPayment: transactions.clickPayment })
          .from(transactions)
          .where(and(eq(transactions.clientId, input.clientId), lt(transactions.transactionDate, fromDate)));
        for (const row of priorRows) {
          openingBalance += row.totalAmount - (row.cashPayment + row.terminalPayment + row.clickPayment);
        }
        // Davr boshigacha qabul qilingan qarz to'lovlari ham boshlang'ich qoldiqni kamaytiradi.
        const priorPayments = await db
          .select({ cashAmount: clientPayments.cashAmount, terminalAmount: clientPayments.terminalAmount, clickAmount: clientPayments.clickAmount })
          .from(clientPayments)
          .where(and(eq(clientPayments.clientId, input.clientId), lt(clientPayments.paymentDate, fromDate)));
        for (const row of priorPayments) {
          openingBalance -= row.cashAmount + row.terminalAmount + row.clickAmount;
        }
      }

      const ledgerConditions = [
        eq(transactions.clientId, input.clientId),
        fromDate ? gte(transactions.transactionDate, fromDate) : undefined,
        toDate ? lte(transactions.transactionDate, toDate) : undefined,
      ].filter(Boolean);
      const ledgerRows = await db
        .select({
          id: transactions.id,
          transactionDate: transactions.transactionDate,
          productName: transactions.productName,
          quantity: transactions.quantity,
          unit: transactions.unit,
          totalAmount: transactions.totalAmount,
          cashPayment: transactions.cashPayment,
          terminalPayment: transactions.terminalPayment,
          clickPayment: transactions.clickPayment,
        })
        .from(transactions)
        .where(and(...ledgerConditions))
        .orderBy(asc(transactions.transactionDate), asc(transactions.id));

      const paymentRows = await db
        .select({
          id: clientPayments.id,
          paymentDate: clientPayments.paymentDate,
          cashAmount: clientPayments.cashAmount,
          terminalAmount: clientPayments.terminalAmount,
          clickAmount: clientPayments.clickAmount,
          note: clientPayments.note,
        })
        .from(clientPayments)
        .where(
          and(
            eq(clientPayments.clientId, input.clientId),
            fromDate ? gte(clientPayments.paymentDate, fromDate) : undefined,
            toDate ? lte(clientPayments.paymentDate, toDate) : undefined,
          ),
        );

      // Savdo va qarz to'lovlari bitta vaqt o'qiga qo'yiladi — aks holda
      // yuguruvchi qoldiq noto'g'ri tartibda hisoblanardi.
      type LedgerEntry = {
        id: number;
        transactionDate: Date;
        productName: string;
        quantity: string;
        unit: string;
        totalAmount: number;
        cashPayment: number;
        terminalPayment: number;
        clickPayment: number;
        kind: "sale" | "payment";
      };
      const combined: LedgerEntry[] = [
        ...ledgerRows.map(row => ({ ...row, kind: "sale" as const })),
        ...paymentRows.map(row => ({
          id: row.id,
          transactionDate: row.paymentDate,
          productName: row.note?.trim() || "Qarz to‘lovi",
          quantity: "0",
          unit: "",
          totalAmount: 0,
          cashPayment: row.cashAmount,
          terminalPayment: row.terminalAmount,
          clickPayment: row.clickAmount,
          kind: "payment" as const,
        })),
      ].sort((a, b) => {
        const diff = a.transactionDate.getTime() - b.transactionDate.getTime();
        return diff !== 0 ? diff : a.id - b.id;
      });

      let running = openingBalance;
      const ledger = combined.map(row => {
        const paid = row.cashPayment + row.terminalPayment + row.clickPayment;
        running += row.totalAmount - paid;
        return { ...row, paid, balanceAfter: running };
      });
      const closingBalance = running;

      let openingKeg30 = 0;
      let openingKeg50 = 0;
      if (fromDate) {
        const priorMovements = await db
          .select({ containerType: containerMovements.containerType, movementType: containerMovements.movementType, quantity: containerMovements.quantity })
          .from(containerMovements)
          .where(and(eq(containerMovements.clientId, input.clientId), lt(containerMovements.movementDate, fromDate)));
        for (const row of priorMovements) {
          const delta = row.movementType === "issued" ? row.quantity : -row.quantity;
          const type = normalizeContainerType(row.containerType);
          if (type === "keg_30") openingKeg30 += delta;
          else if (type === "keg_50") openingKeg50 += delta;
        }
      }

      const containerConditions = [
        eq(containerMovements.clientId, input.clientId),
        fromDate ? gte(containerMovements.movementDate, fromDate) : undefined,
        toDate ? lte(containerMovements.movementDate, toDate) : undefined,
      ].filter(Boolean);
      const containerRows = await db
        .select({
          id: containerMovements.id,
          movementDate: containerMovements.movementDate,
          containerType: containerMovements.containerType,
          movementType: containerMovements.movementType,
          quantity: containerMovements.quantity,
        })
        .from(containerMovements)
        .where(and(...containerConditions))
        .orderBy(asc(containerMovements.movementDate), asc(containerMovements.id));

      let runningKeg30 = openingKeg30;
      let runningKeg50 = openingKeg50;
      const containerLedger = containerRows.map(row => {
        const delta = row.movementType === "issued" ? row.quantity : -row.quantity;
        const type = normalizeContainerType(row.containerType);
        if (type === "keg_30") runningKeg30 += delta;
        else if (type === "keg_50") runningKeg50 += delta;
        return { ...row, keg30After: runningKeg30, keg50After: runningKeg50 };
      });

      return {
        client,
        openingBalance,
        ledger,
        closingBalance,
        openingContainer: { keg30: openingKeg30, keg50: openingKeg50 },
        containerLedger,
        closingContainer: { keg30: runningKeg30, keg50: runningKeg50 },
        generatedAt: Date.now(),
      };
    }),
});
