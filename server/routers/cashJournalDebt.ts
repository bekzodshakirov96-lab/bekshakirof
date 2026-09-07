import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { agents, cashJournalDebts, employees } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

const entrySchema = z.object({
  entryDate: z.number().int().refine(value => Number.isFinite(new Date(value).getTime()), "Sana noto'g'ri."),
  amount: z.number().int().positive().max(2_147_483_647),
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
  byDate: businessProcedure
    .input(z.object({ date: entrySchema.shape.entryDate }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const dayStart = new Date(input.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      return db.select({
        id: cashJournalDebts.id,
        entryDate: cashJournalDebts.entryDate,
        agentId: cashJournalDebts.agentId,
        agentName: agents.name,
        employeeId: cashJournalDebts.employeeId,
        employeeName: employees.name,
        amount: cashJournalDebts.amount,
        description: cashJournalDebts.description,
      })
        .from(cashJournalDebts)
        .leftJoin(agents, eq(cashJournalDebts.agentId, agents.id))
        .leftJoin(employees, eq(cashJournalDebts.employeeId, employees.id))
        .where(and(gte(cashJournalDebts.entryDate, dayStart), lte(cashJournalDebts.entryDate, dayEnd)))
        .orderBy(desc(cashJournalDebts.id));
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
        const entryDate = new Date(input.entryDate);
        await assertPeriodUnlocked(previous.entryDate);
        await assertPeriodUnlocked(entryDate);
        const values = {
          entryDate,
          agentId: input.agentId === undefined ? previous.agentId : input.agentId,
          employeeId: input.employeeId === undefined ? previous.employeeId : input.employeeId,
          amount: input.amount,
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
