import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { agents } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure } from "../access";
import {
  enrichClientFinancialRows,
  getClientFinancialRows,
  normalizeSearch,
  paginate,
} from "../businessQueries";
import { requireDb } from "../db";
import { assertExportRowLimit } from "../reportExport";
import { router } from "../_core/trpc";

const agentFilterFields = {
  search: z.string().max(120).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  debtStatus: z.enum(["all", "debt", "clear"]).default("all"),
  sortBy: z
    .enum(["name", "clientCount", "debtorCount", "totalSales", "totalPaid", "currentDebt"])
    .default("currentDebt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
};

const agentFilterSchema = z.object(agentFilterFields).default({
  status: "all",
  debtStatus: "all",
  sortBy: "currentDebt",
  sortOrder: "desc",
});

const agentListSchema = z.object({
  ...agentFilterFields,
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
}).default({
  status: "all",
  debtStatus: "all",
  sortBy: "currentDebt",
  sortOrder: "desc",
  page: 1,
  pageSize: 25,
});

type AgentFilterInput = z.infer<typeof agentFilterSchema>;

async function loadAgentRows(input: AgentFilterInput) {
  const db = await requireDb();
  const agentRows = await db.select().from(agents).orderBy(asc(agents.name));
  const financialRows = enrichClientFinancialRows(await getClientFinancialRows());
  const search = normalizeSearch(input.search);
  return agentRows
    .map(agent => {
      const clientRows = financialRows.filter(row => row.agentId === agent.id);
      return {
        ...agent,
        clientCount: clientRows.length,
        debtorCount: clientRows.filter(row => row.currentDebt > 0).length,
        totalSales: clientRows.reduce((sum, row) => sum + row.totalSales, 0),
        totalPaid: clientRows.reduce((sum, row) => sum + row.totalPaid, 0),
        currentDebt: clientRows.reduce((sum, row) => sum + Math.max(0, row.currentDebt), 0),
      };
    })
    .filter(row => {
      const matchesSearch =
        !search ||
        row.name.toLocaleLowerCase("uz-Latn").includes(search) ||
        (row.phone ?? "").toLocaleLowerCase("uz-Latn").includes(search);
      const matchesStatus =
        input.status === "all" ||
        (input.status === "active" && row.isActive) ||
        (input.status === "inactive" && !row.isActive);
      const matchesDebt =
        input.debtStatus === "all" ||
        (input.debtStatus === "debt" && row.currentDebt > 0) ||
        (input.debtStatus === "clear" && row.currentDebt <= 0);
      return matchesSearch && matchesStatus && matchesDebt;
    })
    .sort((a, b) => {
      const left = a[input.sortBy] ?? "";
      const right = b[input.sortBy] ?? "";
      const direction = input.sortOrder === "asc" ? 1 : -1;
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), "uz") * direction;
    });
}

function summarizeAgentRows(rows: Awaited<ReturnType<typeof loadAgentRows>>) {
  return {
    agentCount: rows.length,
    clientCount: rows.reduce((sum, row) => sum + row.clientCount, 0),
    debtorCount: rows.reduce((sum, row) => sum + row.debtorCount, 0),
    totalSales: rows.reduce((sum, row) => sum + row.totalSales, 0),
    totalPaid: rows.reduce((sum, row) => sum + row.totalPaid, 0),
    currentDebt: rows.reduce((sum, row) => sum + row.currentDebt, 0),
  };
}

export const agentsRouter = router({
  options: businessProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({ id: agents.id, name: agents.name, isActive: agents.isActive })
      .from(agents)
      .orderBy(asc(agents.name));
    return rows.filter(agent => agent.isActive).map(({ id, name }) => ({ id, name }));
  }),
  list: businessProcedure.input(agentListSchema).query(async ({ input }) => {
    const rows = await loadAgentRows(input);
    return {
      ...paginate(rows, input.page, input.pageSize),
      summary: summarizeAgentRows(rows),
    };
  }),
  exportData: businessProcedure.input(agentFilterSchema).query(async ({ input }) => {
    const rows = await loadAgentRows(input);
    assertExportRowLimit(rows.length, { entityLabel: "agent", filterHint: "Filterlarni toraytiring." });
    return { rows, summary: summarizeAgentRows(rows), filters: input, generatedAt: Date.now() };
  }),
  create: ownerProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(180),
        phone: z.string().trim().max(64).optional(),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [created] = await db
        .insert(agents)
        .values({ name: input.name, phone: input.phone, note: input.note })
        .$returningId();
      return { id: created.id };
    }),
  update: ownerProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(180),
        phone: z.string().trim().max(64).nullable().optional(),
        note: z.string().trim().max(1_000).nullable().optional(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db
        .update(agents)
        .set({
          name: input.name,
          phone: input.phone ?? null,
          note: input.note ?? null,
          isActive: input.isActive,
        })
        .where(eq(agents.id, input.id));
      return { success: true };
    }),
});
