import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, employees, positions } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure } from "../access";
import { logAudit } from "../auditLog";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

/**
 * Lavozimlar ma'lumotnomasi — xodim va agentlarga biriktiriladi.
 *
 * Diqqat: bu foydalanuvchi roli (`users.role`) emas. Rol ruxsatlarni belgilaydi
 * va kod ichida qat'iy tekshiriladi; lavozim esa faqat nom bo'lib, hech qanday
 * ruxsat bermaydi.
 */
export const positionsRouter = router({
  /** Tanlash ro'yxati uchun — faqat faol lavozimlar. */
  options: businessProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({ id: positions.id, name: positions.name, isActive: positions.isActive })
      .from(positions)
      .orderBy(asc(positions.name));
    return rows.filter(row => row.isActive).map(({ id, name }) => ({ id, name }));
  }),

  /** Boshqaruv oynasi uchun — nechta xodim/agent ishlatayotgani bilan birga. */
  list: businessProcedure.query(async () => {
    const db = await requireDb();
    const [rows, employeeCounts, agentCounts] = await Promise.all([
      db.select().from(positions).orderBy(asc(positions.name)),
      db
        .select({ positionId: employees.positionId, total: sql<number>`count(${employees.id})`.mapWith(Number) })
        .from(employees)
        .groupBy(employees.positionId),
      db
        .select({ positionId: agents.positionId, total: sql<number>`count(${agents.id})`.mapWith(Number) })
        .from(agents)
        .groupBy(agents.positionId),
    ]);
    const byEmployee = new Map(employeeCounts.map(row => [row.positionId, row.total]));
    const byAgent = new Map(agentCounts.map(row => [row.positionId, row.total]));
    return rows.map(row => ({
      ...row,
      employeeCount: byEmployee.get(row.id) ?? 0,
      agentCount: byAgent.get(row.id) ?? 0,
    }));
  }),

  create: ownerProcedure
    .input(z.object({ name: z.string().trim().min(2).max(180) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [existing] = await db.select({ id: positions.id }).from(positions).where(eq(positions.name, input.name)).limit(1);
      if (existing) throw new Error("Bunday lavozim allaqachon mavjud.");
      return db.transaction(async tx => {
        const [created] = await tx.insert(positions).values({ name: input.name }).$returningId();
        await logAudit(tx, {
          tableName: "positions",
          recordId: created.id,
          action: "create",
          userId: ctx.user.id,
          after: input,
        });
        return { id: created.id };
      });
    }),

  update: ownerProcedure
    .input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(2).max(180), isActive: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select().from(positions).where(eq(positions.id, input.id)).limit(1);
      if (!previous) throw new Error("Lavozim topilmadi.");
      return db.transaction(async tx => {
        await tx.update(positions).set({ name: input.name, isActive: input.isActive }).where(eq(positions.id, input.id));
        const [updated] = await tx.select().from(positions).where(eq(positions.id, input.id)).limit(1);
        await logAudit(tx, {
          tableName: "positions",
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
    const [previous] = await db.select().from(positions).where(eq(positions.id, input.id)).limit(1);
    if (!previous) throw new Error("Lavozim topilmadi.");

    // Ishlatilayotgan lavozimni o'chirish taqiqlanadi: aks holda unga bog'langan
    // xodim/agentlarning lavozimi jimgina yo'qolib qolardi. Buning o'rniga uni
    // "nofaol" qilib qo'yish kerak — eski yozuvlar saqlanadi, yangi tanlovda chiqmaydi.
    const [{ used }] = await db
      .select({ used: sql<number>`count(${employees.id})`.mapWith(Number) })
      .from(employees)
      .where(eq(employees.positionId, input.id));
    const [{ usedByAgents }] = await db
      .select({ usedByAgents: sql<number>`count(${agents.id})`.mapWith(Number) })
      .from(agents)
      .where(eq(agents.positionId, input.id));
    if (used + usedByAgents > 0) {
      throw new Error(
        `Bu lavozim ${used} ta xodim va ${usedByAgents} ta agentga biriktirilgan — o'chirib bo'lmaydi. Uni "nofaol" qiling.`,
      );
    }

    return db.transaction(async tx => {
      await tx.delete(positions).where(eq(positions.id, input.id));
      await logAudit(tx, {
        tableName: "positions",
        recordId: input.id,
        action: "delete",
        userId: ctx.user.id,
        before: previous,
      });
      return { success: true } as const;
    });
  }),
});
