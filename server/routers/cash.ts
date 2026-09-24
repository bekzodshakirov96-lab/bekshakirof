import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashEntries, employees } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import { requireDb } from "../db";
import { assertExportRowLimit } from "../reportExport";
import { router } from "../_core/trpc";
import { cashJournalDebtRouter } from "./cashJournalDebt";
import { createCashReportPageAccumulator, normalizeCashReportEntries, summarizeCashAccounting } from "../../shared/cashAccounting";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export const cashRouter = router({
  journalDebt: cashJournalDebtRouter,
  /** Distinct category names previously used (optionally filtered to one type), most-recent
   * first — powers the "tur" dropdown on the quick Kassa entry form and report filters,
   * without a separate types table. */
  categories: businessProcedure.input(z.object({ type: z.enum(["income", "expense"]).optional() })).query(async ({ input }) => {
    const db = await requireDb();
    const rows = await db
      .select({ category: cashEntries.category, lastUsed: sql<number>`max(${cashEntries.entryDate})`.mapWith(Number) })
      .from(cashEntries)
      .where(input.type ? eq(cashEntries.type, input.type) : undefined)
      .groupBy(cashEntries.category)
      .orderBy(desc(sql`max(${cashEntries.entryDate})`))
      .limit(40);
    return rows.map(row => row.category);
  }),
  /** All entries for one exact calendar day — used by the fast Kassa page (no pagination, a day is small). */
  byDate: businessProcedure.input(z.object({ date: z.number().int() })).query(async ({ input }) => {
    const db = await requireDb();
    const dayStart = new Date(input.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    const rows = await db
      .select({
        id: cashEntries.id,
        entryDate: cashEntries.entryDate,
        type: cashEntries.type,
        category: cashEntries.category,
        agentId: cashEntries.agentId,
        agentName: agents.name,
        employeeId: cashEntries.employeeId,
        employeeName: employees.name,
        description: cashEntries.description,
        cashAmount: cashEntries.cashAmount,
        terminalAmount: cashEntries.terminalAmount,
        clickAmount: cashEntries.clickAmount,
        transferAmount: cashEntries.transferAmount,
      })
      .from(cashEntries)
      .leftJoin(agents, eq(cashEntries.agentId, agents.id))
      .leftJoin(employees, eq(cashEntries.employeeId, employees.id))
      .where(and(gte(cashEntries.entryDate, dayStart), lte(cashEntries.entryDate, dayEnd)))
      .orderBy(desc(cashEntries.id));
    return rows;
  }),
  delete: businessProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [existing] = await db.select().from(cashEntries).where(eq(cashEntries.id, input.id)).limit(1);
      if (!existing) throw new Error("Kassa yozuvi topilmadi yoki allaqachon o‘chirilgan.");
      await assertPeriodUnlocked(existing.entryDate);
      return db.transaction(async tx => {
        await tx.delete(cashEntries).where(eq(cashEntries.id, input.id));
        await logAudit(tx, {
          tableName: "cash_entries",
          recordId: input.id,
          action: "delete",
          userId: ctx.user.id,
          before: existing,
          reason: input.reason ?? null,
        });
        return { success: true } as const;
      });
    }),
  /** Tanlangan sanadan oldingi barcha kunlarning naqd (faqat cashAmount — terminal/click
   * hisobga olinmaydi) qoldig'i — Kunlik jurnalning "Boshlang'ich qoldiq" qatori shundan
   * boshlanadi va har kun avvalgi kunning yakuniy qoldig'i bilan davom etadi. */
  openingBalance: businessProcedure.input(z.object({ date: z.number().int() })).query(async ({ input }) => {
    const db = await requireDb();
    const dayStart = new Date(input.date);
    dayStart.setHours(0, 0, 0, 0);
    const [row] = await db
      .select({
        balance: sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} else -${cashEntries.cashAmount} end), 0)`.mapWith(
          Number,
        ),
      })
      .from(cashEntries)
      .where(sql`${cashEntries.entryDate} < ${toMySqlDate(dayStart)}`);
    return { openingBalance: row.balance };
  }),
  list: businessProcedure
    .input(
      z
        .object({
          type: z.enum(["all", "income", "expense"]).default("all"),
          category: z.string().max(160).optional(),
          agentId: z.number().int().positive().optional(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().min(10).max(100).default(25),
        })
        .default({ type: "all", page: 1, pageSize: 25 }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input.agentId ? eq(cashEntries.agentId, input.agentId) : undefined,
        input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        input.type === "income" ? or(eq(cashEntries.type, "income"), gt(cashEntries.terminalAmount, 0), gt(cashEntries.clickAmount, 0), gt(cashEntries.transferAmount, 0)) : undefined,
        input.type === "expense" ? and(eq(cashEntries.type, "expense"), gt(cashEntries.cashAmount, 0)) : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;
      // Kategoriya qidiruvi bo'lmasa, jami va kanal summalarini DBning o'zida
      // hisoblaymiz. Shunda birinchi sahifa uchun butun tarixni o'qish shart emas.
      const aggregate = !input.category ? (await db.select({
        rawCount: sql<number>`count(*)`.mapWith(Number),
        mixedCount: sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' and ${cashEntries.cashAmount} > 0 and (${cashEntries.terminalAmount} > 0 or ${cashEntries.clickAmount} > 0 or ${cashEntries.transferAmount} > 0) then 1 else 0 end), 0)`.mapWith(Number),
        incomeCount: sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then 1 else 0 end), 0)`.mapWith(Number),
        expenseElectronicCount: sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' and (${cashEntries.terminalAmount} > 0 or ${cashEntries.clickAmount} > 0 or ${cashEntries.transferAmount} > 0) then 1 else 0 end), 0)`.mapWith(Number),
        cashIncome: sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} else 0 end), 0)`.mapWith(Number),
        cashExpense: sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' then ${cashEntries.cashAmount} else 0 end), 0)`.mapWith(Number),
        terminal: sql<number>`coalesce(sum(${cashEntries.terminalAmount}), 0)`.mapWith(Number),
        click: sql<number>`coalesce(sum(${cashEntries.clickAmount}), 0)`.mapWith(Number),
        transfer: sql<number>`coalesce(sum(${cashEntries.transferAmount}), 0)`.mapWith(Number),
      }).from(cashEntries).where(where))[0] : null;
      const selection = {
          id: cashEntries.id,
          entryDate: cashEntries.entryDate,
          type: cashEntries.type,
          category: cashEntries.category,
          agentName: agents.name,
          employeeId: cashEntries.employeeId,
          employeeName: employees.name,
          description: cashEntries.description,
          cashAmount: cashEntries.cashAmount,
          terminalAmount: cashEntries.terminalAmount,
          clickAmount: cashEntries.clickAmount,
          transferAmount: cashEntries.transferAmount,
          source: cashEntries.source,
      };
      const accumulator = createCashReportPageAccumulator<{
        id: number; entryDate: Date; type: "income" | "expense"; category: string; agentName: string | null;
        employeeId: number | null; employeeName: string | null; description: string | null;
        cashAmount: number; terminalAmount: number; clickAmount: number; transferAmount: number;
        source: typeof cashEntries.$inferSelect.source;
      }>({ page: input.page, pageSize: input.pageSize, type: input.type, category: input.category });
      let offset = 0;
      // DBdan bo'laklab o'qish katta tarixda barcha yozuvlarni xotirada ushlamaydi.
      while (true) {
        const batch = await db.select(selection).from(cashEntries)
          .leftJoin(agents, eq(cashEntries.agentId, agents.id))
          .leftJoin(employees, eq(cashEntries.employeeId, employees.id))
          .where(where)
          .orderBy(desc(cashEntries.entryDate), desc(cashEntries.id))
          .limit(250).offset(offset);
        accumulator.add(batch);
        offset += batch.length;
        if (batch.length < 250 || (aggregate && accumulator.result().total >= input.page * input.pageSize)) break;
      }
      const page = accumulator.result();
      const total = aggregate
        ? input.type === "income" ? aggregate.incomeCount + aggregate.expenseElectronicCount
          : input.type === "expense" ? aggregate.rawCount : aggregate.rawCount + aggregate.mixedCount
        : page.total;
      const totals = aggregate ? {
        cashIncome: aggregate.cashIncome,
        cashExpense: input.type === "income" ? 0 : aggregate.cashExpense,
        terminal: input.type === "expense" ? 0 : aggregate.terminal,
        click: input.type === "expense" ? 0 : aggregate.click,
        transfer: input.type === "expense" ? 0 : aggregate.transfer,
      } : page.totals;
      return {
        items: page.items,
        total,
        totals,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
      };
    }),
  exportData: businessProcedure
    .input(
      z.object({
        type: z.enum(["all", "income", "expense"]).default("all"),
        category: z.string().max(160).optional(),
        agentId: z.number().int().positive().optional(),
        from: z.number().int().optional(),
        to: z.number().int().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input.agentId ? eq(cashEntries.agentId, input.agentId) : undefined,
        input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;
      const rawRows = await db
        .select({
          id: cashEntries.id,
          entryDate: cashEntries.entryDate,
          type: cashEntries.type,
          category: cashEntries.category,
          agentName: agents.name,
          employeeId: cashEntries.employeeId,
          employeeName: employees.name,
          description: cashEntries.description,
          cashAmount: cashEntries.cashAmount,
          terminalAmount: cashEntries.terminalAmount,
          clickAmount: cashEntries.clickAmount,
          transferAmount: cashEntries.transferAmount,
        })
        .from(cashEntries)
        .leftJoin(agents, eq(cashEntries.agentId, agents.id))
        .leftJoin(employees, eq(cashEntries.employeeId, employees.id))
        .where(where)
        .orderBy(desc(cashEntries.entryDate), desc(cashEntries.id));
      const rows = normalizeCashReportEntries(rawRows).filter(row =>
        (input.type === "all" || row.type === input.type)
        && (!input.category || row.category.toLocaleLowerCase().includes(input.category.toLocaleLowerCase())),
      );
      assertExportRowLimit(rows.length, { entityLabel: "kassa yozuvi" });
      const accounting = summarizeCashAccounting(rows);
      return { rows, summary: { income: accounting.income, expense: accounting.expense }, generatedAt: Date.now() };
    }),
  create: businessProcedure
    .input(
      z
        .object({
          entryDate: z.number().int(),
          type: z.enum(["income", "expense"]),
          category: z.string().trim().min(2).max(160),
          agentId: z.number().int().positive().optional(),
          employeeId: z.number().int().positive().optional(),
          description: z.string().max(1_000).optional(),
          cashAmount: z.number().int().min(0).default(0),
          terminalAmount: z.number().int().min(0).default(0),
          clickAmount: z.number().int().min(0).default(0),
          transferAmount: z.number().int().min(0).default(0),
        })
        .refine(value => value.cashAmount + value.terminalAmount + value.clickAmount + value.transferAmount > 0, {
          message: "Kamida bitta to‘lov kanali summasi kiritilishi kerak.",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      await assertPeriodUnlocked(new Date(input.entryDate));
      return db.transaction(async tx => {
        const [created] = await tx
          .insert(cashEntries)
          .values({
            sourceKey: `manual:${randomUUID()}`,
            entryDate: new Date(input.entryDate),
            type: input.type,
            category: input.category,
            agentId: input.agentId ?? null,
            employeeId: input.employeeId ?? null,
            description: input.description,
            cashAmount: input.cashAmount,
            terminalAmount: input.terminalAmount,
            clickAmount: input.clickAmount,
            transferAmount: input.transferAmount,
            source: "manual",
            createdBy: ctx.user.id,
          })
          .$returningId();
        await logAudit(tx, {
          tableName: "cash_entries",
          recordId: created.id,
          action: "create",
          userId: ctx.user.id,
          after: {
            entryDate: new Date(input.entryDate),
            type: input.type,
            category: input.category,
            agentId: input.agentId ?? null,
            employeeId: input.employeeId ?? null,
            description: input.description ?? null,
            cashAmount: input.cashAmount,
            terminalAmount: input.terminalAmount,
            clickAmount: input.clickAmount,
            transferAmount: input.transferAmount,
          },
        });
        return { success: true, id: created.id };
      });
    }),
  update: businessProcedure
    .input(
      z
        .object({
          id: z.number().int().positive(),
          entryDate: z.number().int(),
          type: z.enum(["income", "expense"]),
          category: z.string().trim().min(2).max(160),
          agentId: z.number().int().positive().nullable().optional(),
          /** Yuborilmasa (undefined) mavjud qiymat saqlanadi, `null` esa uni tozalaydi —
           * shunda qisman yangilash xodim bog'lanishini bexosdan o'chirib yubormaydi. */
          employeeId: z.number().int().positive().nullable().optional(),
          description: z.string().max(1_000).nullable().optional(),
          cashAmount: z.number().int().min(0),
          terminalAmount: z.number().int().min(0),
          clickAmount: z.number().int().min(0),
          transferAmount: z.number().int().min(0).default(0),
          reason: z.string().trim().max(500).optional(),
        })
        .refine(value => value.cashAmount + value.terminalAmount + value.clickAmount + value.transferAmount > 0, {
          message: "Kamida bitta to‘lov kanali summasi kiritilishi kerak.",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select().from(cashEntries).where(eq(cashEntries.id, input.id)).limit(1);
      if (!previous) throw new Error("Kassa yozuvi topilmadi.");
      await assertPeriodUnlocked(previous.entryDate);
      await assertPeriodUnlocked(new Date(input.entryDate));
      return db.transaction(async tx => {
        await tx
          .update(cashEntries)
          .set({
            entryDate: new Date(input.entryDate),
            type: input.type,
            category: input.category,
            agentId: input.agentId ?? null,
            ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
            description: input.description ?? null,
            cashAmount: input.cashAmount,
            terminalAmount: input.terminalAmount,
            clickAmount: input.clickAmount,
            transferAmount: input.transferAmount,
          })
          .where(eq(cashEntries.id, input.id));
        const [updated] = await tx.select().from(cashEntries).where(eq(cashEntries.id, input.id)).limit(1);
        await logAudit(tx, {
          tableName: "cash_entries",
          recordId: input.id,
          action: "update",
          userId: ctx.user.id,
          before: previous,
          after: updated,
          reason: input.reason ?? null,
        });
        return { success: true };
      });
    }),
});
