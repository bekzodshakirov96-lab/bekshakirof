import { eq, sql } from "drizzle-orm";
import { agents, clientPayments, clients, transactions } from "../drizzle/schema";
import { toCyrillic } from "../shared/translit";
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
      clientType: clients.clientType,
      openingDebt: clients.openingDebt,
      totalSales: numberSql`coalesce(sum(${transactions.totalAmount}), 0)`,
      cashPaid: numberSql`coalesce(sum(${transactions.cashPayment}), 0)`,
      terminalPaid: numberSql`coalesce(sum(${transactions.terminalPayment}), 0)`,
      clickPaid: numberSql`coalesce(sum(${transactions.clickPayment}), 0)`,
      transferPaid: numberSql`coalesce(sum(${transactions.transferPayment}), 0)`,
      transactionCount: numberSql`count(${transactions.id})`,
      // Qarz to'lovlari alohida subquery bilan olinadi — ikkinchi LEFT JOIN
      // qatorlarni ko'paytirib, savdo summalarini ham buzib yuborardi.
      debtPaidCash: numberSql`coalesce((select sum(cp.cashAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
      debtPaidTerminal: numberSql`coalesce((select sum(cp.terminalAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
      debtPaidClick: numberSql`coalesce((select sum(cp.clickAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
      debtPaidTransfer: numberSql`coalesce((select sum(cp.transferAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
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
      clients.clientType,
      clients.openingDebt,
    );
}

export function enrichClientFinancialRows(
  rows: Awaited<ReturnType<typeof getClientFinancialRows>>,
) {
  return rows.map(row => {
    /** Savdo paytida to'langan pul. */
    const salePaid = row.cashPaid + row.terminalPaid + row.clickPaid + row.transferPaid;
    /** Keyinchalik alohida qabul qilingan qarz to'lovlari. */
    const debtPaid = row.debtPaidCash + row.debtPaidTerminal + row.debtPaidClick + row.debtPaidTransfer;
    const totalPaid = salePaid + debtPaid;
    const currentDebt = row.openingDebt + row.totalSales - totalPaid;
    // Kanal bo'yicha ko'rsatiladigan ustunlar (Qarzdorlik jadvali) — savdo va qarz
    // to'lovini birga qo'shib ko'rsatishi kerak, aks holda ustunlar yig'indisi
    // jami to'lovdan kam chiqib, mijoz aslida qancha pul topshirganini yashirib qo'yadi.
    const cashReceived = row.cashPaid + row.debtPaidCash;
    const terminalReceived = row.terminalPaid + row.debtPaidTerminal;
    const clickReceived = row.clickPaid + row.debtPaidClick;
    const transferReceived = row.transferPaid + row.debtPaidTransfer;
    return { ...row, salePaid, debtPaid, totalPaid, currentDebt, cashReceived, terminalReceived, clickReceived, transferReceived };
  });
}

/** Bitta mijozning joriy qarzini tez olish — Yangi savdo formasida "qarzni yopish" maydoni uchun. */
export async function getClientCurrentDebt(clientId: number): Promise<number> {
  const db = await requireDb();
  const [row] = await db
    .select({
      openingDebt: clients.openingDebt,
      totalSales: numberSql`coalesce(sum(${transactions.totalAmount}), 0)`,
      salePaid: numberSql`coalesce(sum(${transactions.cashPayment} + ${transactions.terminalPayment} + ${transactions.clickPayment} + ${transactions.transferPayment}), 0)`,
      debtPaid: numberSql`coalesce((select sum(cp.cashAmount + cp.terminalAmount + cp.clickAmount + cp.transferAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
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

/**
 * Qidiruv matnini solishtirishga tayyorlaydi.
 *
 * Ikkala tomon ham (qidiruv so'zi va bazadagi qiymat) kirillga o'giriladi:
 * `toCyrillic` idempotent bo'lgani uchun kirill matn o'zgarishsiz qoladi, lotin
 * esa kirillga aylanadi — natijada ikkalasi bir alifboda solishtiriladi.
 *
 * Bu ikkita real muammoni yechadi:
 * 1. Interfeys kirill rejimida bo'lganda foydalanuvchi ekranda ko'rgan nomni
 *    (kirill) tersa, bazadagi lotin yozuvi bilan mos kelmay qolardi.
 * 2. Baza tarixan aralash yozilgan ("Sardor Raxim" va "Сардор Рахим" birga) —
 *    endi qaysi alifboda qidirilishidan qat'iy nazar ikkalasi ham topiladi.
 */
export function normalizeSearch(value?: string) {
  return toCyrillic((value ?? "").trim()).toLocaleLowerCase("uz-Latn");
}

/** Bazadan kelgan matnni `normalizeSearch` bilan bir xil ko'rinishga keltiradi. */
export function normalizeSearchable(value?: string | null) {
  return toCyrillic(value ?? "").toLocaleLowerCase("uz-Latn");
}
