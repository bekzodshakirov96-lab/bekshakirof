import { eq, sql } from "drizzle-orm";
import { agents, clients, transactions } from "../drizzle/schema";
import { requireDb } from "./db";

const numberSql = (template: TemplateStringsArray, ...params: unknown[]) =>
  sql<number>(template, ...params).mapWith(Number);

export async function getClientFinancialRows() {
  const db = await requireDb();
  return db
    .select({
      id: clients.id,
      code: clients.code,
      name: clients.name,
      phone: clients.phone,
      address: clients.address,
      isActive: clients.isActive,
      agentId: clients.agentId,
      agentName: agents.name,
      openingDebt: clients.openingDebt,
      totalSales: numberSql`coalesce(sum(${transactions.totalAmount}), 0)`,
      cashPaid: numberSql`coalesce(sum(${transactions.cashPayment}), 0)`,
      terminalPaid: numberSql`coalesce(sum(${transactions.terminalPayment}), 0)`,
      clickPaid: numberSql`coalesce(sum(${transactions.clickPayment}), 0)`,
      transactionCount: numberSql`count(${transactions.id})`,
    })
    .from(clients)
    .leftJoin(agents, eq(clients.agentId, agents.id))
    .leftJoin(transactions, eq(transactions.clientId, clients.id))
    .groupBy(
      clients.id,
      clients.code,
      clients.name,
      clients.phone,
      clients.address,
      clients.isActive,
      clients.agentId,
      agents.name,
      clients.openingDebt,
    );
}

export function enrichClientFinancialRows(
  rows: Awaited<ReturnType<typeof getClientFinancialRows>>,
) {
  return rows.map(row => {
    const totalPaid = row.cashPaid + row.terminalPaid + row.clickPaid;
    const currentDebt = row.openingDebt + row.totalSales - totalPaid;
    return { ...row, totalPaid, currentDebt };
  });
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    total: items.length,
    page: safePage,
    pageSize: safePageSize,
    pageCount: Math.max(1, Math.ceil(items.length / safePageSize)),
  };
}

export function normalizeSearch(value?: string) {
  return (value ?? "").trim().toLocaleLowerCase("uz-Latn");
}
