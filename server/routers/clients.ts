import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { clients } from "../../drizzle/schema";
import { clientsViewProcedure, ownerProcedure } from "../access";
import { logAudit } from "../auditLog";
import {
  enrichClientFinancialRows,
  getClientFinancialRows,
  normalizeSearch,
  normalizeSearchable,
  paginate,
} from "../businessQueries";
import { router } from "../_core/trpc";
import { requireDb } from "../db";

/** Filtr sifatida faqat "keg" yoki "savdo" tanlanadi — "both" turidagi mijozlar
 * ikkalasida ham chiqishi kerak, shuning uchun alohida filtr qiymati emas. */
const clientTypeFilterSchema = z.enum(["keg", "savdo"]);
/** Mijoz yozuvining o'zida esa "both" ham bo'lishi mumkin — ikkala kanaldan ham xarid qiladi. */
const clientTypeSchema = z.enum(["keg", "savdo", "both"]);

export const clientsRouter = router({
  options: clientsViewProcedure
    .input(z.object({ type: clientTypeFilterSchema.optional() }).default({}))
    .query(async ({ input, ctx }) => {
      const db = await requireDb();
      // Agent rolidagi foydalanuvchiga faqat o'ziga biriktirilgan mijozlar ko'rsatiladi
      // — aks holda mijoz tanlash ro'yxatida boshqa agentlarning mijozlari ham chiqardi.
      const conditions = [eq(clients.isActive, true)];
      if (ctx.user.role === "agent") conditions.push(eq(clients.agentId, ctx.user.agentId ?? -1));
      // "both" turidagi mijoz har ikkala filtrga ham mos keladi.
      if (input.type) conditions.push(inArray(clients.clientType, [input.type, "both"]));
      return db
        .select({
          id: clients.id,
          code: clients.code,
          name: clients.name,
          agentId: clients.agentId,
        })
        .from(clients)
        .where(and(...conditions))
        .orderBy(asc(clients.name));
    }),
  list: clientsViewProcedure
    .input(
      z
        .object({
          search: z.string().max(120).optional(),
          agentId: z.number().int().positive().optional(),
          type: clientTypeFilterSchema.optional(),
          debtOnly: z.boolean().default(false),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().min(10).max(100).default(25),
        })
        .default({ debtOnly: false, page: 1, pageSize: 25 }),
    )
    .query(async ({ input, ctx }) => {
      const search = normalizeSearch(input.search);
      // Agent uchun so'ralgan agentId e'tiborga olinmaydi — doim o'zinikiga qattiq
      // cheklanadi (aks holda boshqa agentning butun mijozlar ro'yxati ochilardi).
      const effectiveAgentId = ctx.user.role === "agent" ? ctx.user.agentId ?? -1 : input.agentId;
      const rows = enrichClientFinancialRows(await getClientFinancialRows())
        .filter(row => {
          const matchesSearch =
            !search ||
            normalizeSearchable(row.code).includes(search) ||
            normalizeSearchable(row.name).includes(search) ||
            normalizeSearchable(row.phone).includes(search);
          return (
            matchesSearch &&
            (!effectiveAgentId || row.agentId === effectiveAgentId) &&
            (!input.type || row.clientType === input.type || row.clientType === "both") &&
            (!input.debtOnly || row.currentDebt > 0)
          );
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return paginate(rows, input.page, input.pageSize);
    }),
  create: clientsViewProcedure
    .input(
      z.object({
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(2).max(240),
        agentId: z.number().int().positive().optional(),
        phone: z.string().trim().max(64).optional(),
        address: z.string().trim().max(1_000).optional(),
        clientType: clientTypeSchema.optional(),
        openingDebt: z.number().int().min(0).max(9_000_000_000_000).default(0),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      // Agent yangi mijozni doim faqat o'z nomiga yaratadi — boshqa agentga
      // biriktirib qo'ya olmaydi (aks holda kiritilgan agentId'ga ishoniladi).
      const agentId = ctx.user.role === "agent" ? ctx.user.agentId : input.agentId ?? null;
      const [created] = await db
        .insert(clients)
        .values({
          code: input.code,
          name: input.name,
          agentId,
          phone: input.phone,
          address: input.address,
          clientType: input.clientType,
          openingDebt: input.openingDebt,
        })
        .$returningId();
      return { id: created.id };
    }),
  update: ownerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().trim().min(1).max(64),
        name: z.string().trim().min(2).max(240),
        agentId: z.number().int().positive().nullable().optional(),
        phone: z.string().trim().max(64).nullable().optional(),
        address: z.string().trim().max(1_000).nullable().optional(),
        clientType: clientTypeSchema.nullable().optional(),
        openingDebt: z.number().int().min(0).max(9_000_000_000_000),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select().from(clients).where(eq(clients.id, input.id)).limit(1);
      if (!previous) throw new Error("Mijoz topilmadi.");
      return db.transaction(async tx => {
        await tx
          .update(clients)
          .set({
            code: input.code,
            name: input.name,
            agentId: input.agentId ?? null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            clientType: input.clientType ?? null,
            openingDebt: input.openingDebt,
            isActive: input.isActive,
          })
          .where(eq(clients.id, input.id));
        await logAudit(tx, {
          tableName: "clients",
          recordId: input.id,
          action: "update",
          userId: ctx.user.id,
          before: previous,
          after: { ...previous, ...input },
        });
        return { success: true };
      });
    }),
});
