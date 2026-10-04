import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { cashEntries, cashTransferLinks, clientPayments, transactions } from "../../drizzle/schema";
import { tashkentDayRange, toMySqlDate } from "../businessDay";
import { businessProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import { requireDb } from "../db";
import { router } from "../_core/trpc";
import { tashkentBusinessDate } from "../../shared/agentReconciliation";

const sourceSchema = z.object({ kind: z.enum(["transaction", "client_payment"]), id: z.number().int().positive() });

async function getTransferEntry(id: number) {
  const db = await requireDb();
  const [entry] = await db.select().from(cashEntries).where(eq(cashEntries.id, id)).limit(1);
  if (!entry || entry.type !== "income" || entry.transferAmount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "O‘tkazma yozuvi topilmadi." });
  }
  return entry;
}

export const cashTransferLinksRouter = router({
  options: businessProcedure.input(z.object({ cashEntryId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await requireDb();
    const entry = await getTransferEntry(input.cashEntryId);
    const { start, end } = tashkentDayRange(entry.entryDate.getTime());
    const agentCondition = entry.agentId === null ? sql`false` : eq(transactions.agentId, entry.agentId);
    const paymentAgentCondition = entry.agentId === null ? sql`false` : eq(clientPayments.agentId, entry.agentId);
    const [sales, payments, links] = await Promise.all([
      db.select({ id: transactions.id, amount: transactions.transferPayment, label: transactions.productName, agentId: transactions.agentId })
        .from(transactions).where(and(gt(transactions.transferPayment, 0), sql`${transactions.transactionDate} >= ${toMySqlDate(start)}`, sql`${transactions.transactionDate} <= ${toMySqlDate(end)}`, agentCondition))
        .orderBy(transactions.id).limit(500),
      db.select({ id: clientPayments.id, amount: clientPayments.transferAmount, clientId: clientPayments.clientId, agentId: clientPayments.agentId })
        .from(clientPayments).where(and(gt(clientPayments.transferAmount, 0), sql`${clientPayments.paymentDate} >= ${toMySqlDate(start)}`, sql`${clientPayments.paymentDate} <= ${toMySqlDate(end)}`, paymentAgentCondition))
        .orderBy(clientPayments.id).limit(500),
      db.select().from(cashTransferLinks).where(eq(cashTransferLinks.cashEntryId, entry.id)),
    ]);
    const [usedSales, usedPayments] = await Promise.all([
      sales.length ? db.select({ sourceId: cashTransferLinks.transactionId, cashEntryId: cashTransferLinks.cashEntryId })
        .from(cashTransferLinks).where(inArray(cashTransferLinks.transactionId, sales.map(row => row.id))) : Promise.resolve([]),
      payments.length ? db.select({ sourceId: cashTransferLinks.clientPaymentId, cashEntryId: cashTransferLinks.cashEntryId })
        .from(cashTransferLinks).where(inArray(cashTransferLinks.clientPaymentId, payments.map(row => row.id))) : Promise.resolve([]),
    ]);
    const used = new Map([
      ...usedSales.map(row => [`transaction:${row.sourceId}`, row.cashEntryId] as const),
      ...usedPayments.map(row => [`client_payment:${row.sourceId}`, row.cashEntryId] as const),
    ]);
    return {
      entryAmount: entry.transferAmount,
      agentId: entry.agentId,
      mode: links.some(row => row.transactionId !== null || row.clientPaymentId !== null) ? "linked" as const
        : links.length ? "independent" as const : "legacy" as const,
      selected: links.reduce<Array<{ kind: "transaction" | "client_payment"; id: number }>>((result, row) => {
        if (row.transactionId !== null) result.push({ kind: "transaction", id: row.transactionId });
        if (row.clientPaymentId !== null) result.push({ kind: "client_payment", id: row.clientPaymentId });
        return result;
      }, []),
      sources: [
        ...sales.map(row => ({
          kind: "transaction" as const, id: row.id, amount: row.amount,
          label: `Savdo #${row.id} · ${row.label}`,
          available: !used.has(`transaction:${row.id}`) || used.get(`transaction:${row.id}`) === entry.id,
        })),
        ...payments.map(row => ({
          kind: "client_payment" as const, id: row.id, amount: row.amount,
          label: `Qarz to‘lovi #${row.id} · mijoz #${row.clientId}`,
          available: !used.has(`client_payment:${row.id}`) || used.get(`client_payment:${row.id}`) === entry.id,
        })),
      ],
    };
  }),
  save: businessProcedure.input(z.object({
    cashEntryId: z.number().int().positive(),
    mode: z.enum(["legacy", "linked", "independent"]),
    sources: z.array(sourceSchema).max(100),
  })).mutation(async ({ input, ctx }) => {
    if ((input.mode === "linked") !== (input.sources.length > 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Bog‘langan rejimda kamida bitta manbani tanlang." });
    }
    const keys = input.sources.map(item => `${item.kind}:${item.id}`);
    if (new Set(keys).size !== keys.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Bir manba ikki marta tanlangan." });
    const db = await requireDb();
    return db.transaction(async tx => {
      const [entry] = await tx.select().from(cashEntries).where(eq(cashEntries.id, input.cashEntryId)).limit(1).for("update");
      if (!entry || entry.type !== "income" || entry.transferAmount <= 0 || (input.mode === "linked" && entry.agentId === null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "IDga bog‘lash uchun avval o‘tkazma summasi va agentni saqlang." });
      }
      await assertPeriodUnlocked(entry.entryDate);
      const transferDate = tashkentBusinessDate(entry.entryDate);
      const saleIds = input.sources.filter(item => item.kind === "transaction").map(item => item.id);
      const paymentIds = input.sources.filter(item => item.kind === "client_payment").map(item => item.id);
      const [sales, payments, before] = await Promise.all([
        saleIds.length ? tx.select({ id: transactions.id, agentId: transactions.agentId, date: transactions.transactionDate, amount: transactions.transferPayment })
          .from(transactions).where(inArray(transactions.id, saleIds)).for("update") : Promise.resolve([]),
        paymentIds.length ? tx.select({ id: clientPayments.id, agentId: clientPayments.agentId, date: clientPayments.paymentDate, amount: clientPayments.transferAmount })
          .from(clientPayments).where(inArray(clientPayments.id, paymentIds)).for("update") : Promise.resolve([]),
        tx.select().from(cashTransferLinks).where(eq(cashTransferLinks.cashEntryId, entry.id)),
      ]);
      const sources = [...sales, ...payments];
      if (sources.length !== input.sources.length || sources.some(source => source.agentId !== entry.agentId
        || tashkentBusinessDate(source.date) !== transferDate || source.amount <= 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Manbalar agenti, sanasi va o‘tkazma summasini tekshiring." });
      }
      if (sources.reduce((total, source) => total + source.amount, 0) > entry.transferAmount) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bog‘langan to‘lovlar jami jurnal summasidan oshmasligi kerak." });
      }
      const [usedSales, usedPayments] = await Promise.all([
        saleIds.length ? tx.select({ cashEntryId: cashTransferLinks.cashEntryId }).from(cashTransferLinks)
          .where(inArray(cashTransferLinks.transactionId, saleIds)) : Promise.resolve([]),
        paymentIds.length ? tx.select({ cashEntryId: cashTransferLinks.cashEntryId }).from(cashTransferLinks)
          .where(inArray(cashTransferLinks.clientPaymentId, paymentIds)) : Promise.resolve([]),
      ]);
      if ([...usedSales, ...usedPayments].some(link => link.cashEntryId !== entry.id)) {
        throw new TRPCError({ code: "CONFLICT", message: "Tanlangan ID boshqa Kassa yozuviga bog‘langan." });
      }
      await tx.delete(cashTransferLinks).where(eq(cashTransferLinks.cashEntryId, entry.id));
      if (input.mode === "independent") {
        await tx.insert(cashTransferLinks).values({ cashEntryId: entry.id });
      } else if (input.mode === "linked") {
        await tx.insert(cashTransferLinks).values(input.sources.map(source => ({
          cashEntryId: entry.id,
          transactionId: source.kind === "transaction" ? source.id : null,
          clientPaymentId: source.kind === "client_payment" ? source.id : null,
        })));
      }
      await logAudit(tx, {
        tableName: "cash_transfer_links", recordId: entry.id, action: "update", userId: ctx.user.id,
        before: before.map(row => ({ transactionId: row.transactionId, clientPaymentId: row.clientPaymentId })),
        after: { mode: input.mode, sources: input.sources },
      });
      return { success: true } as const;
    });
  }),
});
