import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { agents, cashEntries, clients, products, transactions } from "../drizzle/schema";
import { enrichClientFinancialRows, getClientFinancialRows } from "../server/businessQueries";
import { requireDb } from "../server/db";
import { parseDistributionWorkbook } from "../server/excelImport";

const workbookPath = process.argv[2];
if (!workbookPath) {
  throw new Error("Excel fayl yo‘li ko‘rsatilmagan");
}

const parsed = parseDistributionWorkbook(await readFile(workbookPath));
const db = await requireDb();

const workbookTotals = parsed.transactions.reduce(
  (totals, row) => ({
    sales: totals.sales + row.totalAmount,
    cash: totals.cash + row.cashPayment,
    terminal: totals.terminal + row.terminalPayment,
    click: totals.click + row.clickPayment,
  }),
  { sales: 0, cash: 0, terminal: 0, click: 0 },
);

const [databaseTotals] = await db
  .select({
    sales: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)`.mapWith(Number),
    cash: sql<number>`coalesce(sum(${transactions.cashPayment}), 0)`.mapWith(Number),
    terminal: sql<number>`coalesce(sum(${transactions.terminalPayment}), 0)`.mapWith(Number),
    click: sql<number>`coalesce(sum(${transactions.clickPayment}), 0)`.mapWith(Number),
  })
  .from(transactions);

const [databaseCounts] = await db
  .select({
    agents: sql<number>`(select count(*) from ${agents})`.mapWith(Number),
    clients: sql<number>`(select count(*) from ${clients})`.mapWith(Number),
    products: sql<number>`(select count(*) from ${products})`.mapWith(Number),
    transactions: sql<number>`(select count(*) from ${transactions})`.mapWith(Number),
    cashEntries: sql<number>`(select count(*) from ${cashEntries})`.mapWith(Number),
  })
  .from(sql`(select 1) as verification_source`);

const debtRows = enrichClientFinancialRows(await getClientFinancialRows());
const databaseDebt = debtRows.reduce((sum, row) => sum + Math.max(0, row.currentDebt), 0);

const expectedCounts = {
  agents: parsed.agents.length,
  clients: parsed.clients.length,
  products: parsed.products.length,
  transactions: parsed.transactions.length,
  cashEntries: parsed.cashEntries.length,
};

const numericMatches = Object.fromEntries(
  Object.entries(workbookTotals).map(([key, value]) => [
    key,
    value === databaseTotals[key as keyof typeof databaseTotals],
  ]),
);
const countMatches = Object.fromEntries(
  Object.entries(expectedCounts).map(([key, value]) => [
    key,
    value === databaseCounts[key as keyof typeof databaseCounts],
  ]),
);

console.log(
  JSON.stringify(
    {
      workbook: { counts: expectedCounts, totals: workbookTotals },
      database: { counts: databaseCounts, totals: databaseTotals, currentDebt: databaseDebt },
      matches: { counts: countMatches, totals: numericMatches },
      parser: { skippedRows: parsed.skippedRows, errors: parsed.errors },
    },
    null,
    2,
  ),
);
