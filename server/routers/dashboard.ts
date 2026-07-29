import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashEntries, clients, transactions } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { enrichClientFinancialRows, getClientFinancialRows } from "../businessQueries";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const overviewInput = z
  .object({
    from: z.number().int().optional(),
    to: z.number().int().optional(),
  })
  .optional();

export const dashboardRouter = router({
  overview: businessProcedure.input(overviewInput).query(async ({ input }) => {
    const db = await requireDb();
    const fromDate = input?.from ? new Date(input.from) : undefined;
    const toDate = input?.to ? new Date(input.to) : undefined;
    const periodConditions = [
      fromDate ? sql`${transactions.transactionDate} >= ${toMySqlDate(fromDate)}` : undefined,
      toDate ? sql`${transactions.transactionDate} <= ${toMySqlDate(toDate)}` : undefined,
    ].filter(Boolean);
    const periodWhere = periodConditions.length ? and(...periodConditions) : undefined;

    const [transactionTotals] = await db
      .select({
        totalSales: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)`.mapWith(Number),
        cashIncome: sql<number>`coalesce(sum(${transactions.cashPayment}), 0)`.mapWith(Number),
        terminalIncome: sql<number>`coalesce(sum(${transactions.terminalPayment}), 0)`.mapWith(Number),
        clickIncome: sql<number>`coalesce(sum(${transactions.clickPayment}), 0)`.mapWith(Number),
        transferIncome: sql<number>`coalesce(sum(${transactions.transferPayment}), 0)`.mapWith(Number),
        soldQuantity: sql<number>`coalesce(sum(${transactions.quantity}), 0)`.mapWith(Number),
      })
      .from(transactions)
      .where(periodWhere);
    const [clientTotals] = await db
      .select({
        activeClients: sql<number>`coalesce(sum(case when ${clients.isActive} = 1 then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
      })
      .from(clients);

    const clientRows = enrichClientFinancialRows(await getClientFinancialRows());
    const currentDebt = clientRows.reduce((sum, row) => sum + Math.max(0, row.currentDebt), 0);

    const monthlySource = await db
      .select({
        date: transactions.transactionDate,
        sales: transactions.totalAmount,
        cashReceived: transactions.cashPayment,
        terminalReceived: transactions.terminalPayment,
        clickReceived: transactions.clickPayment,
        transferReceived: transactions.transferPayment,
      })
      .from(transactions)
      .orderBy(transactions.transactionDate);
    const monthlyMap = new Map<string, { month: string; sales: number; received: number }>();
    for (const row of monthlySource) {
      const date = new Date(row.date);
      const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const current = monthlyMap.get(month) ?? { month, sales: 0, received: 0 };
      current.sales += Number(row.sales);
      current.received += Number(row.cashReceived) + Number(row.terminalReceived) + Number(row.clickReceived) + Number(row.transferReceived);
      monthlyMap.set(month, current);
    }
    const monthly = Array.from(monthlyMap.values());

    const agentMap = new Map<number, { agentId: number; agentName: string; debt: number }>();
    for (const row of clientRows) {
      if (!row.agentId || !row.agentName) continue;
      const current = agentMap.get(row.agentId) ?? {
        agentId: row.agentId,
        agentName: row.agentName,
        debt: 0,
      };
      current.debt += Math.max(0, row.currentDebt);
      agentMap.set(row.agentId, current);
    }

    const recentTransactions = await db
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        clientName: clients.name,
        agentName: agents.name,
        productName: transactions.productName,
        totalAmount: transactions.totalAmount,
        paid: sql<number>`${transactions.cashPayment} + ${transactions.terminalPayment} + ${transactions.clickPayment} + ${transactions.transferPayment}`.mapWith(
          Number,
        ),
      })
      .from(transactions)
      .leftJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(agents, eq(transactions.agentId, agents.id))
      .orderBy(desc(transactions.transactionDate), desc(transactions.id))
      .limit(6);

    const [cashBalances] = await db
      .select({
        cash:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} else -${cashEntries.cashAmount} end), 0)`.mapWith(
            Number,
          ),
        terminal:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.terminalAmount} else -${cashEntries.terminalAmount} end), 0)`.mapWith(
            Number,
          ),
        click:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.clickAmount} else -${cashEntries.clickAmount} end), 0)`.mapWith(
            Number,
          ),
      })
      .from(cashEntries);

    // Period income/expense from the cash journal. Respects the same date filter as
    // the KPI cards when one is set; otherwise defaults to the current calendar year
    // (this preserves the "yillik kirim/chiqim" figures that used to live on the Kassa page).
    const cashPeriodConditions = fromDate || toDate
      ? [
          fromDate ? sql`${cashEntries.entryDate} >= ${toMySqlDate(fromDate)}` : undefined,
          toDate ? sql`${cashEntries.entryDate} <= ${toMySqlDate(toDate)}` : undefined,
        ].filter(Boolean)
      : [sql`year(${cashEntries.entryDate}) = year(current_date())`];
    const [periodCashFlow] = await db
      .select({
        income:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
            Number,
          ),
        expense:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
            Number,
          ),
      })
      .from(cashEntries)
      .where(and(...cashPeriodConditions));

    const totalReceived =
      transactionTotals.cashIncome + transactionTotals.terminalIncome + transactionTotals.clickIncome + transactionTotals.transferIncome;

    return {
      summary: {
        totalSales: transactionTotals.totalSales,
        totalReceived,
        currentDebt,
        cashIncome: transactionTotals.cashIncome,
        terminalIncome: transactionTotals.terminalIncome,
        clickIncome: transactionTotals.clickIncome,
        transferIncome: transactionTotals.transferIncome,
        activeClients: clientTotals.activeClients,
        soldQuantity: transactionTotals.soldQuantity,
      },
      monthly,
      agentDebt: Array.from(agentMap.values()).sort((a, b) => b.debt - a.debt),
      recentTransactions,
      cashBalances,
      periodCashFlow,
      isFiltered: Boolean(fromDate || toDate),
    };
  }),
});
