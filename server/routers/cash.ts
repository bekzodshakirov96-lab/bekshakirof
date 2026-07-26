import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashEntries } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { requireDb } from "../db";
import { assertExportRowLimit } from "../reportExport";
import { router } from "../_core/trpc";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export const cashRouter = router({
  /** Distinct category names previously used for this type, most-recent first — powers the
   * "tur" autocomplete/dropdown on the quick Kassa entry form without a separate types table. */
  categories: businessProcedure.input(z.object({ type: z.enum(["income", "expense"]) })).query(async ({ input }) => {
    const db = await requireDb();
    const rows = await db
      .select({ category: cashEntries.category, lastUsed: sql<number>`max(${cashEntries.entryDate})`.mapWith(Number) })
      .from(cashEntries)
      .where(eq(cashEntries.type, input.type))
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
        description: cashEntries.description,
        cashAmount: cashEntries.cashAmount,
        terminalAmount: cashEntries.terminalAmount,
        clickAmount: cashEntries.clickAmount,
      })
      .from(cashEntries)
      .leftJoin(agents, eq(cashEntries.agentId, agents.id))
      .where(and(gte(cashEntries.entryDate, dayStart), lte(cashEntries.entryDate, dayEnd)))
      .orderBy(desc(cashEntries.id));
    return rows;
  }),
  delete: businessProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const db = await requireDb();
    await db.delete(cashEntries).where(eq(cashEntries.id, input.id));
    return { success: true } as const;
  }),
  summary: businessProcedure.query(async () => {
    const db = await requireDb();
    const [row] = await db
      .select({
        cashBalance:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} else -${cashEntries.cashAmount} end), 0)`.mapWith(
            Number,
          ),
        terminalBalance:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.terminalAmount} else -${cashEntries.terminalAmount} end), 0)`.mapWith(
            Number,
          ),
        clickBalance:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.clickAmount} else -${cashEntries.clickAmount} end), 0)`.mapWith(
            Number,
          ),
        yearlyIncome:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' and year(${cashEntries.entryDate}) = year(current_date()) then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
            Number,
          ),
        yearlyExpense:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' and year(${cashEntries.entryDate}) = year(current_date()) then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
            Number,
          ),
      })
      .from(cashEntries);
    return row;
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
        input.type !== "all" ? eq(cashEntries.type, input.type) : undefined,
        input.category ? like(cashEntries.category, `%${input.category}%`) : undefined,
        input.agentId ? eq(cashEntries.agentId, input.agentId) : undefined,
        input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;
      const items = await db
        .select({
          id: cashEntries.id,
          entryDate: cashEntries.entryDate,
          type: cashEntries.type,
          category: cashEntries.category,
          agentName: agents.name,
          description: cashEntries.description,
          cashAmount: cashEntries.cashAmount,
          terminalAmount: cashEntries.terminalAmount,
          clickAmount: cashEntries.clickAmount,
          source: cashEntries.source,
        })
        .from(cashEntries)
        .leftJoin(agents, eq(cashEntries.agentId, agents.id))
        .where(where)
        .orderBy(desc(cashEntries.entryDate), desc(cashEntries.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [totalRow] = await db.select({ total: count() }).from(cashEntries).where(where);
      return {
        items,
        total: totalRow.total,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(totalRow.total / input.pageSize)),
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
        input.type !== "all" ? eq(cashEntries.type, input.type) : undefined,
        input.category ? like(cashEntries.category, `%${input.category}%`) : undefined,
        input.agentId ? eq(cashEntries.agentId, input.agentId) : undefined,
        input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;
      const [{ total }] = await db.select({ total: count() }).from(cashEntries).where(where);
      assertExportRowLimit(total, { entityLabel: "kassa yozuvi" });
      const rows = await db
        .select({
          id: cashEntries.id,
          entryDate: cashEntries.entryDate,
          type: cashEntries.type,
          category: cashEntries.category,
          agentName: agents.name,
          description: cashEntries.description,
          cashAmount: cashEntries.cashAmount,
          terminalAmount: cashEntries.terminalAmount,
          clickAmount: cashEntries.clickAmount,
        })
        .from(cashEntries)
        .leftJoin(agents, eq(cashEntries.agentId, agents.id))
        .where(where)
        .orderBy(desc(cashEntries.entryDate), desc(cashEntries.id));
      const summary = rows.reduce(
        (acc, row) => {
          const total = row.cashAmount + row.terminalAmount + row.clickAmount;
          if (row.type === "income") acc.income += total; else acc.expense += total;
          return acc;
        },
        { income: 0, expense: 0 },
      );
      return { rows, summary, generatedAt: Date.now() };
    }),
  create: businessProcedure
    .input(
      z
        .object({
          entryDate: z.number().int(),
          type: z.enum(["income", "expense"]),
          category: z.string().trim().min(2).max(160),
          agentId: z.number().int().positive().optional(),
          description: z.string().max(1_000).optional(),
          cashAmount: z.number().int().min(0).default(0),
          terminalAmount: z.number().int().min(0).default(0),
          clickAmount: z.number().int().min(0).default(0),
        })
        .refine(value => value.cashAmount + value.terminalAmount + value.clickAmount > 0, {
          message: "Kamida bitta to‘lov kanali summasi kiritilishi kerak.",
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      await db.insert(cashEntries).values({
        sourceKey: `manual:${randomUUID()}`,
        entryDate: new Date(input.entryDate),
        type: input.type,
        category: input.category,
        agentId: input.agentId ?? null,
        description: input.description,
        cashAmount: input.cashAmount,
        terminalAmount: input.terminalAmount,
        clickAmount: input.clickAmount,
        source: "manual",
        createdBy: ctx.user.id,
      });
      return { success: true };
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
          description: z.string().max(1_000).nullable().optional(),
          cashAmount: z.number().int().min(0),
          terminalAmount: z.number().int().min(0),
          clickAmount: z.number().int().min(0),
        })
        .refine(value => value.cashAmount + value.terminalAmount + value.clickAmount > 0, {
          message: "Kamida bitta to‘lov kanali summasi kiritilishi kerak.",
        }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db
        .update(cashEntries)
        .set({
          entryDate: new Date(input.entryDate),
          type: input.type,
          category: input.category,
          agentId: input.agentId ?? null,
          description: input.description ?? null,
          cashAmount: input.cashAmount,
          terminalAmount: input.terminalAmount,
          clickAmount: input.clickAmount,
        })
        .where(eq(cashEntries.id, input.id));
      return { success: true };
    }),
});
