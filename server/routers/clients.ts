import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { clients } from "../../drizzle/schema";
import { clientsViewProcedure, ownerProcedure } from "../access";
import {
  enrichClientFinancialRows,
  getClientFinancialRows,
  normalizeSearch,
  paginate,
} from "../businessQueries";
import { router } from "../_core/trpc";
import { requireDb } from "../db";

export const clientsRouter = router({
  options: clientsViewProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select({
        id: clients.id,
        code: clients.code,
        name: clients.name,
        agentId: clients.agentId,
      })
      .from(clients)
      .where(eq(clients.isActive, true))
      .orderBy(asc(clients.name));
  }),
  list: clientsViewProcedure
    .input(
      z
        .object({
          search: z.string().max(120).optional(),
          agentId: z.number().int().positive().optional(),
          debtOnly: z.boolean().default(false),
          page: z.number().int().positive().default(1),
          pageSize: z.number().int().min(10).max(100).default(25),
        })
        .default({ debtOnly: false, page: 1, pageSize: 25 }),
    )
    .query(async ({ input }) => {
      const search = normalizeSearch(input.search);
      const rows = enrichClientFinancialRows(await getClientFinancialRows())
        .filter(row => {
          const matchesSearch =
            !search ||
            row.code.toLocaleLowerCase("uz-Latn").includes(search) ||
            row.name.toLocaleLowerCase("uz-Latn").includes(search) ||
            (row.phone ?? "").toLocaleLowerCase("uz-Latn").includes(search);
          return (
            matchesSearch &&
            (!input.agentId || row.agentId === input.agentId) &&
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
        openingDebt: z.number().int().min(0).max(9_000_000_000_000).default(0),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [created] = await db
        .insert(clients)
        .values({
          code: input.code,
          name: input.name,
          agentId: input.agentId ?? null,
          phone: input.phone,
          address: input.address,
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
        openingDebt: z.number().int().min(0).max(9_000_000_000_000),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db
        .update(clients)
        .set({
          code: input.code,
          name: input.name,
          agentId: input.agentId ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          openingDebt: input.openingDebt,
          isActive: input.isActive,
        })
        .where(eq(clients.id, input.id));
      return { success: true };
    }),
});
