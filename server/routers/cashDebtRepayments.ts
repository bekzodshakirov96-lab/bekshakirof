import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashEntries, cashJournalDebts, cashJournalDebtRepayments, cashTransferLinks, employees } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import { tashkentDayRange } from "../businessDay";
import { requireDb } from "../db";
import { router } from "../_core/trpc";
import { CASH_DEBT_REPAYMENT_CATEGORY } from "../../shared/cashAccounting";

const methodSchema = z.enum(["cash", "terminal", "click", "transfer"]);
const paymentFields = {
  debtId: z.number().int().positive(),
  paymentDate: z.number().int().refine(value => Number.isFinite(new Date(value).getTime())),
  amount: z.number().int().positive().max(2_147_483_647),
  method: methodSchema,
  note: z.string().trim().max(1_000).optional(),
  requestId: z.string().uuid(),
};

const methodAmounts = (method: z.infer<typeof methodSchema>, amount: number) => ({
  cashAmount: method === "cash" ? amount : 0,
  terminalAmount: method === "terminal" ? amount : 0,
  clickAmount: method === "click" ? amount : 0,
  transferAmount: method === "transfer" ? amount : 0,
});

const summaryColumns = (paid: ReturnType<typeof paidSubquery>) => ({
  total: count(),
  originalAmount: sql<number>`coalesce(sum(${cashJournalDebts.amount}), 0)`.mapWith(Number),
  repaidAmount: sql<number>`coalesce(sum(coalesce(${paid.paidAmount}, 0)), 0)`.mapWith(Number),
  remainingAmount: sql<number>`coalesce(sum(${cashJournalDebts.amount} - coalesce(${paid.paidAmount}, 0)), 0)`.mapWith(Number),
});

function paidSubquery(db: Awaited<ReturnType<typeof requireDb>>) {
  return db.select({
    debtId: cashJournalDebtRepayments.debtId,
    paidAmount: sql<number>`sum(${cashJournalDebtRepayments.amount})`.mapWith(Number).as("paidAmount"),
  }).from(cashJournalDebtRepayments)
    .where(isNull(cashJournalDebtRepayments.voidedAt))
    .groupBy(cashJournalDebtRepayments.debtId).as("debt_paid");
}

export const cashDebtRepaymentsRouter = router({
  report: businessProcedure.input(z.object({
    agentId: z.number().int().positive().optional(),
    status: z.enum(["all", "active", "open", "partial", "closed"]).default("all"),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })).query(async ({ input }) => {
    const db = await requireDb();
    const paid = paidSubquery(db);
    const paidAmount = sql<number>`coalesce(${paid.paidAmount}, 0)`;
    const where = and(
      input.agentId ? eq(cashJournalDebts.agentId, input.agentId) : undefined,
      input.status === "active" ? sql`${paidAmount} < ${cashJournalDebts.amount}` : undefined,
      input.status === "open" ? sql`${paidAmount} = 0` : undefined,
      input.status === "partial" ? sql`${paidAmount} > 0 and ${paidAmount} < ${cashJournalDebts.amount}` : undefined,
      input.status === "closed" ? sql`${paidAmount} >= ${cashJournalDebts.amount}` : undefined,
    );
    const [summary] = await db.select(summaryColumns(paid)).from(cashJournalDebts)
      .leftJoin(paid, eq(paid.debtId, cashJournalDebts.id)).where(where);
    const pageCount = Math.max(1, Math.ceil(summary.total / input.pageSize));
    const page = Math.min(input.page, pageCount);
    const items = await db.select({
      id: cashJournalDebts.id,
      entryDate: cashJournalDebts.entryDate,
      agentId: cashJournalDebts.agentId,
      agentName: agents.name,
      employeeId: cashJournalDebts.employeeId,
      employeeName: employees.name,
      amount: cashJournalDebts.amount,
      borrowerName: cashJournalDebts.borrowerName,
      description: cashJournalDebts.description,
      paidAmount: paidAmount.mapWith(Number),
    }).from(cashJournalDebts)
      .leftJoin(paid, eq(paid.debtId, cashJournalDebts.id))
      .leftJoin(agents, eq(cashJournalDebts.agentId, agents.id))
      .leftJoin(employees, eq(cashJournalDebts.employeeId, employees.id))
      .where(where)
      .orderBy(desc(cashJournalDebts.entryDate), desc(cashJournalDebts.id))
      .limit(input.pageSize).offset((page - 1) * input.pageSize);
    return { ...summary, items, page, pageCount };
  }),

  history: businessProcedure.input(z.object({ debtId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await requireDb();
    return db.select().from(cashJournalDebtRepayments)
      .where(eq(cashJournalDebtRepayments.debtId, input.debtId))
      .orderBy(desc(cashJournalDebtRepayments.paymentDate), desc(cashJournalDebtRepayments.id));
  }),

  setBorrower: businessProcedure.input(z.object({
    debtId: z.number().int().positive(),
    borrowerName: z.string().trim().min(2).max(255),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    return db.transaction(async tx => {
      const [debt] = await tx.select().from(cashJournalDebts)
        .where(eq(cashJournalDebts.id, input.debtId)).limit(1).for("update");
      if (!debt) throw new TRPCError({ code: "NOT_FOUND", message: "Kassa qarzi topilmadi." });
      await tx.update(cashJournalDebts).set({ borrowerName: input.borrowerName })
        .where(eq(cashJournalDebts.id, input.debtId));
      await logAudit(tx, { tableName: "cash_journal_debts", recordId: input.debtId,
        action: "update", userId: ctx.user.id, before: debt, after: { ...debt, borrowerName: input.borrowerName } });
      return { success: true };
    });
  }),

  create: businessProcedure.input(z.discriminatedUnion("mode", [
    z.object({ ...paymentFields, mode: z.literal("new") }),
    z.object({ ...paymentFields, mode: z.literal("existing"), cashEntryId: z.number().int().positive() }),
  ])).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const sourceKey = `cash-debt-repayment:${input.requestId}`;
    const paymentDate = new Date(input.paymentDate);
    const amounts = methodAmounts(input.method, input.amount);
    await assertPeriodUnlocked(paymentDate);
    return db.transaction(async tx => {
      const [debt] = await tx.select().from(cashJournalDebts)
        .where(eq(cashJournalDebts.id, input.debtId)).limit(1).for("update");
      if (!debt) throw new TRPCError({ code: "NOT_FOUND", message: "Kassa qarzi topilmadi." });
      const paymentDay = tashkentDayRange(input.paymentDate);
      if (paymentDay.end.getTime() < debt.entryDate.getTime()
        || paymentDay.start.getTime() > tashkentDayRange(Date.now()).end.getTime()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Qaytim sanasi qarzdan oldin yoki kelajakda bo‘lishi mumkin emas." });
      }

      if (input.mode === "new") {
        const [previousCash] = await tx.select({ id: cashEntries.id }).from(cashEntries)
          .where(eq(cashEntries.sourceKey, sourceKey)).limit(1);
        if (previousCash) {
          const [previousPayment] = await tx.select().from(cashJournalDebtRepayments)
            .where(eq(cashJournalDebtRepayments.cashEntryId, previousCash.id)).limit(1);
          if (previousPayment && !previousPayment.voidedAt && previousPayment.debtId === input.debtId
            && previousPayment.amount === input.amount && previousPayment.method === input.method) return { id: previousPayment.id };
          throw new TRPCError({ code: "CONFLICT", message: "Bu so‘rov IDsi boshqa to‘lovda ishlatilgan." });
        }
      } else {
        const [previousPayment] = await tx.select().from(cashJournalDebtRepayments)
          .where(eq(cashJournalDebtRepayments.cashEntryId, input.cashEntryId)).limit(1);
        if (previousPayment) {
          if (!previousPayment.voidedAt && previousPayment.debtId === input.debtId
            && previousPayment.amount === input.amount && previousPayment.method === input.method) return { id: previousPayment.id };
          throw new TRPCError({ code: "CONFLICT", message: "Bu kirim boshqa qaytimga bog‘langan." });
        }
      }
      const [paid] = await tx.select({ amount: sql<number>`coalesce(sum(${cashJournalDebtRepayments.amount}), 0)`.mapWith(Number) })
        .from(cashJournalDebtRepayments).where(and(
          eq(cashJournalDebtRepayments.debtId, input.debtId), isNull(cashJournalDebtRepayments.voidedAt)));
      if (input.amount > debt.amount - paid.amount) throw new TRPCError({
        code: "BAD_REQUEST", message: "Qaytim qarz qoldig‘idan oshmasligi kerak." });

      let cashEntryId: number;
      if (input.mode === "existing") {
        const [entry] = await tx.select().from(cashEntries)
          .where(eq(cashEntries.id, input.cashEntryId)).limit(1).for("update");
        if (!entry || entry.type !== "income" || entry.category !== CASH_DEBT_REPAYMENT_CATEGORY
          || entry.agentId !== debt.agentId || entry.employeeId !== debt.employeeId
          || entry.cashAmount !== amounts.cashAmount || entry.terminalAmount !== amounts.terminalAmount
          || entry.clickAmount !== amounts.clickAmount || entry.transferAmount !== amounts.transferAmount
          || entry.entryDate.getTime() < tashkentDayRange(input.paymentDate).start.getTime()
          || entry.entryDate.getTime() > tashkentDayRange(input.paymentDate).end.getTime()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tanlangan kassa kirimi sana, tur va summa bo‘yicha qaytimga mos kelmaydi." });
        }
        const [assigned] = await tx.select({ id: cashJournalDebtRepayments.id }).from(cashJournalDebtRepayments)
          .where(eq(cashJournalDebtRepayments.cashEntryId, entry.id)).limit(1);
        const [salesLink] = await tx.select({ id: cashTransferLinks.id }).from(cashTransferLinks)
          .where(eq(cashTransferLinks.cashEntryId, entry.id)).limit(1);
        if (assigned || salesLink) throw new TRPCError({ code: "CONFLICT", message: "Bu kirim boshqa operatsiyaga bog‘langan." });
        cashEntryId = entry.id;
      } else {
        const [entry] = await tx.insert(cashEntries).values({
          sourceKey, entryDate: paymentDate, type: "income", category: CASH_DEBT_REPAYMENT_CATEGORY,
          agentId: debt.agentId, employeeId: debt.employeeId,
          description: (input.note || debt.borrowerName || debt.description || `Qarz #${debt.id} qaytimi`).slice(0, 255),
          ...amounts, source: "manual", createdBy: ctx.user.id,
        }).$returningId();
        cashEntryId = entry.id;
        await logAudit(tx, { tableName: "cash_entries", recordId: cashEntryId, action: "create",
          userId: ctx.user.id, after: { sourceKey, type: "income", category: CASH_DEBT_REPAYMENT_CATEGORY, entryDate: paymentDate, ...amounts } });
      }
      const values = {
        debtId: debt.id, paymentDate, amount: input.amount, method: input.method,
        note: input.note || null, cashEntryId, cashEntryCreated: input.mode === "new", createdBy: ctx.user.id,
      };
      const [created] = await tx.insert(cashJournalDebtRepayments).values(values).$returningId();
      await logAudit(tx, { tableName: "cash_journal_debt_repayments", recordId: created.id,
        action: "create", userId: ctx.user.id, after: values });
      return { id: created.id };
    });
  }),

  void: businessProcedure.input(z.object({
    id: z.number().int().positive(), reason: z.string().trim().min(3).max(500),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    return db.transaction(async tx => {
      const [payment] = await tx.select().from(cashJournalDebtRepayments)
        .where(eq(cashJournalDebtRepayments.id, input.id)).limit(1).for("update");
      if (!payment) throw new TRPCError({ code: "NOT_FOUND", message: "Qaytim topilmadi." });
      if (payment.voidedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Qaytim avval bekor qilingan." });
      await assertPeriodUnlocked(payment.paymentDate);
      const [entry] = await tx.select().from(cashEntries)
        .where(eq(cashEntries.id, payment.cashEntryId)).limit(1).for("update");
      if (payment.cashEntryCreated && entry) {
        await tx.update(cashEntries).set({ cashAmount: 0, terminalAmount: 0, clickAmount: 0, transferAmount: 0,
          description: `Bekor qilingan qarz qaytimi #${payment.id}` }).where(eq(cashEntries.id, entry.id));
        await logAudit(tx, { tableName: "cash_entries", recordId: entry.id,
          action: "update", userId: ctx.user.id, before: entry, after: { ...entry, cashAmount: 0,
            terminalAmount: 0, clickAmount: 0, transferAmount: 0 }, reason: input.reason });
      }
      const values = { voidedAt: new Date(), voidedBy: ctx.user.id, voidReason: input.reason };
      await tx.update(cashJournalDebtRepayments).set(values)
        .where(eq(cashJournalDebtRepayments.id, payment.id));
      await logAudit(tx, { tableName: "cash_journal_debt_repayments", recordId: payment.id,
        action: "update", userId: ctx.user.id, before: payment, after: { ...payment, ...values }, reason: input.reason });
      return { success: true };
    });
  }),
});
