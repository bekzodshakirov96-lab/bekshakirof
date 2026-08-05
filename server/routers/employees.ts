import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { cashEntries, employees } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure } from "../access";
import { logAudit } from "../auditLog";
import { normalizeSearch, normalizeSearchable } from "../businessQueries";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Xodimga berilgan oylik "Ойлик" toifasidagi kassa rasxodi sifatida yoziladi. */
const SALARY_CATEGORY = "Ойлик";

const periodInput = z.object({ from: z.number().int().optional(), to: z.number().int().optional() });

/**
 * Har bir xodim uchun to'langan oylik yig'indisi. Davr berilsa faqat o'sha
 * oraliqdagi to'lovlar, berilmasa butun tarix bo'yicha hisoblanadi.
 */
async function loadSalaryTotals(db: Awaited<ReturnType<typeof requireDb>>, period: { from?: number; to?: number }) {
  const conditions = [
    eq(cashEntries.type, "expense"),
    eq(cashEntries.category, SALARY_CATEGORY),
    period.from ? gte(cashEntries.entryDate, sql`${toMySqlDate(new Date(period.from))}`) : undefined,
    period.to ? lte(cashEntries.entryDate, sql`${toMySqlDate(new Date(period.to))}`) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      employeeId: cashEntries.employeeId,
      paidAmount:
        sql<number>`coalesce(sum(${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} + ${cashEntries.transferAmount}), 0)`.mapWith(
          Number,
        ),
      paymentCount: sql<number>`count(${cashEntries.id})`.mapWith(Number),
      lastPaidAt: sql<string | null>`max(${cashEntries.entryDate})`,
    })
    .from(cashEntries)
    .where(and(...conditions))
    .groupBy(cashEntries.employeeId);

  const byEmployee = new Map<number, { paidAmount: number; paymentCount: number; lastPaidAt: string | null }>();
  for (const row of rows) {
    if (row.employeeId === null) continue;
    byEmployee.set(row.employeeId, {
      paidAmount: row.paidAmount,
      paymentCount: row.paymentCount,
      lastPaidAt: row.lastPaidAt,
    });
  }
  return byEmployee;
}

export const employeesRouter = router({
  /** Kassada oylik yozayotganda xodim tanlash uchun — faqat faol xodimlar. */
  options: businessProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({ id: employees.id, name: employees.name, position: employees.position, isActive: employees.isActive })
      .from(employees)
      .orderBy(asc(employees.name));
    return rows.filter(row => row.isActive).map(({ id, name, position }) => ({ id, name, position }));
  }),

  list: businessProcedure
    .input(
      periodInput
        .extend({
          search: z.string().max(120).optional(),
          status: z.enum(["all", "active", "inactive"]).default("all"),
        })
        .default({ status: "all" }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const [rows, totals] = await Promise.all([
        db.select().from(employees).orderBy(asc(employees.name)),
        loadSalaryTotals(db, input),
      ]);
      const search = normalizeSearch(input.search);
      const items = rows
        .filter(row => {
          const matchesSearch =
            !search ||
            normalizeSearchable(row.name).includes(search) ||
            normalizeSearchable(row.position).includes(search) ||
            normalizeSearchable(row.phone).includes(search);
          const matchesStatus =
            input.status === "all" ||
            (input.status === "active" && row.isActive) ||
            (input.status === "inactive" && !row.isActive);
          return matchesSearch && matchesStatus;
        })
        .map(row => {
          const total = totals.get(row.id);
          return {
            ...row,
            paidAmount: total?.paidAmount ?? 0,
            paymentCount: total?.paymentCount ?? 0,
            lastPaidAt: total?.lastPaidAt ?? null,
          };
        });
      return {
        items,
        totalPaid: items.reduce((sum, row) => sum + row.paidAmount, 0),
        activeCount: items.filter(row => row.isActive).length,
      };
    }),

  /** Bitta xodimning oylik to'lovlari tarixi. */
  payments: businessProcedure
    .input(periodInput.extend({ employeeId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        eq(cashEntries.employeeId, input.employeeId),
        eq(cashEntries.type, "expense"),
        eq(cashEntries.category, SALARY_CATEGORY),
        input.from ? gte(cashEntries.entryDate, sql`${toMySqlDate(new Date(input.from))}`) : undefined,
        input.to ? lte(cashEntries.entryDate, sql`${toMySqlDate(new Date(input.to))}`) : undefined,
      ].filter(Boolean);
      return db
        .select({
          id: cashEntries.id,
          entryDate: cashEntries.entryDate,
          description: cashEntries.description,
          cashAmount: cashEntries.cashAmount,
          terminalAmount: cashEntries.terminalAmount,
          clickAmount: cashEntries.clickAmount,
          transferAmount: cashEntries.transferAmount,
        })
        .from(cashEntries)
        .where(and(...conditions))
        .orderBy(sql`${cashEntries.entryDate} desc`, sql`${cashEntries.id} desc`);
    }),

  create: ownerProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(180),
        position: z.string().trim().max(180).optional(),
        phone: z.string().trim().max(64).optional(),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [created] = await tx
          .insert(employees)
          .values({
            name: input.name,
            position: input.position || null,
            phone: input.phone || null,
            note: input.note || null,
          })
          .$returningId();
        await logAudit(tx, {
          tableName: "employees",
          recordId: created.id,
          action: "create",
          userId: ctx.user.id,
          after: input,
        });
        return { id: created.id };
      });
    }),

  update: ownerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(180),
        position: z.string().trim().max(180).nullable().optional(),
        phone: z.string().trim().max(64).nullable().optional(),
        note: z.string().trim().max(1_000).nullable().optional(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select().from(employees).where(eq(employees.id, input.id)).limit(1);
      if (!previous) throw new Error("Xodim topilmadi.");
      return db.transaction(async tx => {
        await tx
          .update(employees)
          .set({
            name: input.name,
            position: input.position ?? null,
            phone: input.phone ?? null,
            note: input.note ?? null,
            isActive: input.isActive,
          })
          .where(eq(employees.id, input.id));
        const [updated] = await tx.select().from(employees).where(eq(employees.id, input.id)).limit(1);
        await logAudit(tx, {
          tableName: "employees",
          recordId: input.id,
          action: "update",
          userId: ctx.user.id,
          before: previous,
          after: updated,
        });
        return { success: true } as const;
      });
    }),

  delete: ownerProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const [previous] = await db.select().from(employees).where(eq(employees.id, input.id)).limit(1);
    if (!previous) throw new Error("Xodim topilmadi.");

    // Oylik to'langan xodimni o'chirish taqiqlanadi: kassa yozuvidagi bog'lanish
    // yo'qolib, "kimga berilgan" degan ma'lumot yo'qolardi. Buning o'rniga
    // xodimni nofaol qilib qo'yish kerak.
    const [{ paymentCount }] = await db
      .select({ paymentCount: sql<number>`count(${cashEntries.id})`.mapWith(Number) })
      .from(cashEntries)
      .where(eq(cashEntries.employeeId, input.id));
    if (paymentCount > 0) {
      throw new Error(
        `Bu xodimga ${paymentCount} ta oylik to'lovi yozilgan — o'chirib bo'lmaydi. Uni "nofaol" qilib qo'ying.`,
      );
    }

    return db.transaction(async tx => {
      await tx.delete(employees).where(eq(employees.id, input.id));
      await logAudit(tx, {
        tableName: "employees",
        recordId: input.id,
        action: "delete",
        userId: ctx.user.id,
        before: previous,
      });
      return { success: true } as const;
    });
  }),
});
