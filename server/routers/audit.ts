import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { appSettings, auditLog, users } from "../../drizzle/schema";
import { ownerProcedure } from "../access";
import { PERIOD_LOCK_KEY } from "../auditLog";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

const TABLE_LABELS: Record<string, string> = {
  transactions: "Savdo",
  cash_entries: "Kassa yozuvi",
  client_payments: "Qarz to‘lovi",
  kassa_daily_actuals: "Haqiqiy naqd",
  users: "Foydalanuvchi",
};

export const auditRouter = router({
  list: ownerProcedure
    .input(
      z.object({
        tableName: z.string().max(64).optional(),
        action: z.enum(["create", "update", "delete"]).optional(),
        userId: z.number().int().positive().optional(),
        from: z.number().int().optional(),
        to: z.number().int().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().min(10).max(100).default(50),
      }).default({ page: 1, pageSize: 50 }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [
        input.tableName ? eq(auditLog.tableName, input.tableName) : undefined,
        input.action ? eq(auditLog.action, input.action) : undefined,
        input.userId ? eq(auditLog.userId, input.userId) : undefined,
        input.from ? gte(auditLog.createdAt, new Date(input.from)) : undefined,
        input.to ? lte(auditLog.createdAt, new Date(input.to)) : undefined,
      ].filter(Boolean);
      const where = conditions.length ? and(...conditions) : undefined;

      const items = await db
        .select({
          id: auditLog.id,
          tableName: auditLog.tableName,
          recordId: auditLog.recordId,
          action: auditLog.action,
          userName: users.name,
          userEmail: users.email,
          beforeData: auditLog.beforeData,
          afterData: auditLog.afterData,
          reason: auditLog.reason,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const [totalRow] = await db.select({ total: count() }).from(auditLog).where(where);
      return {
        items: items.map(row => ({ ...row, tableLabel: TABLE_LABELS[row.tableName] ?? row.tableName })),
        total: totalRow.total,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(totalRow.total / input.pageSize)),
      };
    }),

  /** Filtrlar uchun — tarixda uchragan jadvallar va foydalanuvchilar ro'yxati. */
  filterOptions: ownerProcedure.query(async () => {
    const db = await requireDb();
    const tables = await db
      .selectDistinct({ tableName: auditLog.tableName })
      .from(auditLog);
    const actors = await db
      .selectDistinct({ id: users.id, name: users.name })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.userId, users.id));
    return {
      tables: tables.map(row => ({ value: row.tableName, label: TABLE_LABELS[row.tableName] ?? row.tableName })),
      users: actors,
    };
  }),

  /** Davr qulfi sanasi — bu sanadan oldingi moliyaviy yozuvlar o'zgartirilmaydi. */
  periodLock: router({
    get: ownerProcedure.query(async () => {
      const db = await requireDb();
      const [row] = await db
        .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
        .from(appSettings)
        .where(eq(appSettings.key, PERIOD_LOCK_KEY))
        .limit(1);
      return { lockDate: row?.value ?? null, updatedAt: row?.updatedAt ?? null };
    }),
    set: ownerProcedure
      .input(z.object({ lockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }))
      .mutation(async ({ input, ctx }) => {
        const db = await requireDb();
        await db
          .insert(appSettings)
          .values({ key: PERIOD_LOCK_KEY, value: input.lockDate, updatedBy: ctx.user.id })
          .onDuplicateKeyUpdate({ set: { value: input.lockDate, updatedBy: ctx.user.id, updatedAt: sql`now()` } });
        return { success: true };
      }),
  }),
});
