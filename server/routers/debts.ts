import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { agents, clients, containerMovements, transactions } from "../../drizzle/schema";
import { businessProcedure, debtsViewProcedure } from "../access";
import {
  enrichClientFinancialRows,
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

      let running = openingBalance;
      const ledger = ledgerRows.map(row => {
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
