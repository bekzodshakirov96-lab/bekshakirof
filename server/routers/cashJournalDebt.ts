import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashJournalDebts, cashJournalDebtRepayments, employees } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import { requireDb } from "../db";
import { tashkentDayRange } from "../businessDay";
import { router } from "../_core/trpc";
import { cashDebtRepaymentsRouter } from "./cashDebtRepayments";

const entrySchema = z.object({
  entryDate: z.number().int().refine(value => Number.isFinite(new Date(value).getTime()), "Sana noto'g'ri."),
  amount: z.number().int().positive().max(2_147_483_647),
  borrowerName: z.string().trim().max(255).nullable().optional(),
  agentId: z.number().int().positive().nullable().optional(),
  employeeId: z.number().int().positive().nullable().optional(),
  description: z.string().trim().max(1_000).nullable().optional(),
});

function singlePayee(value: { agentId?: number | null; employeeId?: number | null }) {
  return value.agentId == null || value.employeeId == null;
}

const payeeMessage = "Qarz eslatmasida agent yoki xodimdan faqat bittasini tanlang.";

/** Mustaqil eslatmalar: ushbu router kassa, savdo va mijoz to'lovlari jadvallariga yozmaydi. */
export const cashJournalDebtRouter = router({
  repayments: cashDebtRepaymentsRouter,
  report: businessProcedure
    .input(z.object({
      agentId: z.number().int().positive().optional(),
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const where = input.agentId ? eq(cashJournalDebts.agentId, input.agentId) : undefined;
      const [summary] = await db.select({
        total: count(),
        totalAmount: sql<number>`coalesce(sum(${cashJournalDebts.amount}), 0)`.mapWith(Number),
      }).from(cashJournalDebts).where(where);
      const pageCount = Math.max(1, Math.ceil(summary.total / input.pageSize));
      const page = Math.min(input.page, pageCount);
      const items = await db.select({
        id: cashJournalDebts.id, entryDate: cashJournalDebts.entryDate,
        agentId: cashJournalDebts.agentId, agentName: agents.name,
        employeeId: cashJournalDebts.employeeId, employeeName: employees.name,
        amount: cashJournalDebts.amount, borrowerName: cashJournalDebts.borrowerName, description: cashJournalDebts.description,
      }).from(cashJournalDebts)
        .leftJoin(agents, eq(cashJournalDebts.agentId, agents.id))
        .leftJoin(employees, eq(cashJournalDebts.employeeId, employees.id))
        .where(where)
        .orderBy(desc(cashJournalDebts.entryDate), desc(cashJournalDebts.id))
        .limit(input.pageSize).offset((page - 1) * input.pageSize);
      return { items, ...summary, page, pageCount };
    }),
  byDate: businessProcedure
    .input(z.object({ date: entrySchema.shape.entryDate }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const { start: dayStart, end: dayEnd } = tashkentDayRange(input.date);
      const rows = await db.select({
        id: cashJournalDebts.id,
        entryDate: cashJournalDebts.entryDate,
        agentId: cashJournalDebts.agentId,
        agentName: agents.name,
        employeeId: cashJournalDebts.employeeId,
        employeeName: employees.name,
        amount: cashJournalDebts.amount, borrowerName: cashJournalDebts.borrowerName,
        description: cashJournalDebts.description,
      })
        .from(cashJournalDebts)
        .leftJoin(agents, eq(cashJournalDebts.agentId, agents.id))
        .leftJoin(employees, eq(cashJournalDebts.employeeId, employees.id))
        .where(and(gte(cashJournalDebts.entryDate, dayStart), lte(cashJournalDebts.entryDate, dayEnd)))
        .orderBy(desc(cashJournalDebts.id));
      const repayments = rows.length ? await db.select({ debtId: cashJournalDebtRepayments.debtId })
        .from(cashJournalDebtRepayments)
        .where(inArray(cashJournalDebtRepayments.debtId, rows.map(row => row.id))) : [];
      const linked = new Set(repayments.map(row => row.debtId));
      return rows.map(row => ({ ...row, hasRepayment: linked.has(row.id) }));
    }),

  create: businessProcedure
    .input(entrySchema.refine(singlePayee, { message: payeeMessage }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const entryDate = new Date(input.entryDate);
      await assertPeriodUnlocked(entryDate);
      return db.transaction(async tx => {
        const values = {
          entryDate,
          agentId: input.agentId ?? null,
          employeeId: input.employeeId ?? null,
          amount: input.amount,
          borrowerName: input.borrowerName || null,
          description: input.description || null,
          createdBy: ctx.user.id,
        };
        const [created] = await tx.insert(cashJournalDebts).values(values).$returningId();
        await logAudit(tx, {
          tableName: "cash_journal_debts", recordId: created.id, action: "create", userId: ctx.user.id,
          after: values,
        });
        return { id: created.id };
      });
    }),

  update: businessProcedure
    .input(entrySchema.extend({ id: z.number().int().positive() }).refine(singlePayee, { message: payeeMessage }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [previous] = await tx.select().from(cashJournalDebts).where(eq(cashJournalDebts.id, input.id)).limit(1).for("update");
        if (!previous) throw new TRPCError({ code: "NOT_FOUND", message: "Qarz eslatmasi topilmadi." });
        const [repayment] = await tx.select({ id: cashJournalDebtRepayments.id }).from(cashJournalDebtRepayments)
          .where(eq(cashJournalDebtRepayments.debtId, input.id)).limit(1);
        if (repayment) throw new TRPCError({ code: "BAD_REQUEST", message: "Qaytim mavjud qarzning summasi yoki sanasini o‘zgartirib bo‘lmaydi." });
        const entryDate = new Date(input.entryDate);
        await assertPeriodUnlocked(previous.entryDate);
        await assertPeriodUnlocked(entryDate);
        const values = {
          entryDate,
          agentId: input.agentId === undefined ? previous.agentId : input.agentId,
          employeeId: input.employeeId === undefined ? previous.employeeId : input.employeeId,
          amount: input.amount,
          borrowerName: input.borrowerName === undefined ? previous.borrowerName : input.borrowerName || null,
          description: input.description === undefined ? previous.description : input.description || null,
          updatedAt: new Date(),
        };
        if (!singlePayee(values)) throw new TRPCError({ code: "BAD_REQUEST", message: payeeMessage });
        await tx.update(cashJournalDebts).set(values).where(eq(cashJournalDebts.id, input.id));
        await logAudit(tx, {
          tableName: "cash_journal_debts", recordId: input.id, action: "update", userId: ctx.user.id,
          before: previous, after: { ...previous, ...values },
        });
        return { success: true };
      });
    }),

  delete: businessProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [previous] = await tx.select().from(cashJournalDebts).where(eq(cashJournalDebts.id, input.id)).limit(1).for("update");
        if (!previous) throw new TRPCError({ code: "NOT_FOUND", message: "Qarz eslatmasi topilmadi." });
        const [repayment] = await tx.select({ id: cashJournalDebtRepayments.id }).from(cashJournalDebtRepayments)
          .where(eq(cashJournalDebtRepayments.debtId, input.id)).limit(1);
        if (repayment) throw new TRPCError({ code: "BAD_REQUEST", message: "Qaytim tarixi mavjud qarzni o‘chirib bo‘lmaydi." });
        await assertPeriodUnlocked(previous.entryDate);
        await tx.delete(cashJournalDebts).where(eq(cashJournalDebts.id, input.id));
        await logAudit(tx, {
          tableName: "cash_journal_debts", recordId: input.id, action: "delete", userId: ctx.user.id,
          before: previous,
        });
        return { success: true };
      });
    }),
});
