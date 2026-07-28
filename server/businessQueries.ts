import { eq, sql } from "drizzle-orm";
import { agents, clientPayments, clients, transactions } from "../drizzle/schema";
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
      // Qarz to'lovlari alohida subquery bilan olinadi — ikkinchi LEFT JOIN
      // qatorlarni ko'paytirib, savdo summalarini ham buzib yuborardi.
      debtPaidCash: numberSql`coalesce((select sum(cp.cashAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
      debtPaidTerminal: numberSql`coalesce((select sum(cp.terminalAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
      debtPaidClick: numberSql`coalesce((select sum(cp.clickAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
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
    /** Savdo paytida to'langan pul. */
    const salePaid = row.cashPaid + row.terminalPaid + row.clickPaid;
    /** Keyinchalik alohida qabul qilingan qarz to'lovlari. */
    const debtPaid = row.debtPaidCash + row.debtPaidTerminal + row.debtPaidClick;
    const totalPaid = salePaid + debtPaid;
    const currentDebt = row.openingDebt + row.totalSales - totalPaid;
    return { ...row, salePaid, debtPaid, totalPaid, currentDebt };
  });
}

/** Bitta mijozning joriy qarzini tez olish — Yangi savdo formasida "qarzni yopish" maydoni uchun. */
export async function getClientCurrentDebt(clientId: number): Promise<number> {
  const db = await requireDb();
  const [row] = await db
    .select({
      openingDebt: clients.openingDebt,
      totalSales: numberSql`coalesce(sum(${transactions.totalAmount}), 0)`,
      salePaid: numberSql`coalesce(sum(${transactions.cashPayment} + ${transactions.terminalPayment} + ${transactions.clickPayment}), 0)`,
      debtPaid: numberSql`coalesce((select sum(cp.cashAmount + cp.terminalAmount + cp.clickAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
    })
    .from(clients)
    .leftJoin(transactions, eq(transactions.clientId, clients.id))
    .where(eq(clients.id, clientId))
    .groupBy(clients.id, clients.openingDebt);
  if (!row) return 0;
  return row.openingDebt + row.totalSales - row.salePaid - row.debtPaid;
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
