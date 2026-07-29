import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, cashEntries, clientPayments, transactions } from "../../drizzle/schema";
import { businessProcedure, ownerProcedure, salesProcedure } from "../access";
import { logAudit } from "../auditLog";
import {
  enrichClientFinancialRows,
  getClientFinancialRows,
  normalizeSearch,
  paginate,
} from "../businessQueries";
import { requireDb } from "../db";
import { assertExportRowLimit } from "../reportExport";
import { router } from "../_core/trpc";

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

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
  options: salesProcedure.query(async () => {
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
        commissionPercent: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select().from(agents).where(eq(agents.id, input.id)).limit(1);
      if (!previous) throw new Error("Agent topilmadi.");
      return db.transaction(async tx => {
        await tx
          .update(agents)
          .set({
            name: input.name,
            phone: input.phone ?? null,
            note: input.note ?? null,
            isActive: input.isActive,
            ...(input.commissionPercent !== undefined ? { commissionPercent: input.commissionPercent.toFixed(2) } : {}),
          })
          .where(eq(agents.id, input.id));
        const [updated] = await tx.select().from(agents).where(eq(agents.id, input.id)).limit(1);
        await logAudit(tx, {
          tableName: "agents",
          recordId: input.id,
          action: "update",
          userId: ctx.user.id,
          before: previous,
          after: updated,
        });
        return { success: true };
      });
    }),
  /** Sets only the commission percent — used by the inline editor on the Agents page (no need to resend name/phone/note). */
  setCommissionPercent: ownerProcedure
    .input(z.object({ id: z.number().int().positive(), commissionPercent: z.number().min(0).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [previous] = await db.select({ commissionPercent: agents.commissionPercent }).from(agents).where(eq(agents.id, input.id)).limit(1);
      if (!previous) throw new Error("Agent topilmadi.");
      return db.transaction(async tx => {
        await tx
          .update(agents)
          .set({ commissionPercent: input.commissionPercent.toFixed(2) })
          .where(eq(agents.id, input.id));
        await logAudit(tx, {
          tableName: "agents",
          recordId: input.id,
          action: "update",
          userId: ctx.user.id,
          before: { commissionPercent: previous.commissionPercent },
          after: { commissionPercent: input.commissionPercent.toFixed(2) },
        });
        return { success: true };
      });
    }),
  /**
   * Commission per agent for a period, based on the amount actually collected from clients —
   * both sale payments (cash + terminal + click + Перечисление recorded on their transactions)
   * and standalone old-debt payments (client_payments, attributed to the agent who collected
   * them). Bank transfers (Перечисление) count too, even though the agent doesn't physically
   * handle that money — the client still paid it off through that agent's relationship. The
   * unpaid/still-owed portion of a sale earns no commission.
   */
  commissionReport: businessProcedure
    .input(z.object({ from: z.number().int().optional(), to: z.number().int().optional() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const transactionPeriodConditions = [
        input.from ? sql`${transactions.transactionDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${transactions.transactionDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);
      const paymentPeriodConditions = [
        input.from ? sql`${clientPayments.paymentDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
        input.to ? sql`${clientPayments.paymentDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
      ].filter(Boolean);

      const agentRows = await db.select().from(agents).orderBy(asc(agents.name));
      const collectedRows = await db
        .select({
          agentId: transactions.agentId,
          collectedAmount:
            sql<number>`coalesce(sum(${transactions.cashPayment} + ${transactions.terminalPayment} + ${transactions.clickPayment} + ${transactions.transferPayment}), 0)`.mapWith(
              Number,
            ),
        })
        .from(transactions)
        .where(transactionPeriodConditions.length ? and(...transactionPeriodConditions) : undefined)
        .groupBy(transactions.agentId);
      const collectedByAgent = new Map(collectedRows.map(row => [row.agentId, row.collectedAmount]));

      const debtPaymentRows = await db
        .select({
          agentId: clientPayments.agentId,
          debtCollectedAmount:
            sql<number>`coalesce(sum(${clientPayments.cashAmount} + ${clientPayments.terminalAmount} + ${clientPayments.clickAmount} + ${clientPayments.transferAmount}), 0)`.mapWith(
              Number,
            ),
        })
        .from(clientPayments)
        .where(paymentPeriodConditions.length ? and(...paymentPeriodConditions) : undefined)
        .groupBy(clientPayments.agentId);
      const debtCollectedByAgent = new Map(debtPaymentRows.map(row => [row.agentId, row.debtCollectedAmount]));

      return agentRows
        .filter(agent => agent.isActive)
        .map(agent => {
          const saleCollectedAmount = collectedByAgent.get(agent.id) ?? 0;
          const debtCollectedAmount = debtCollectedByAgent.get(agent.id) ?? 0;
          const collectedAmount = saleCollectedAmount + debtCollectedAmount;
          const commissionPercent = Number(agent.commissionPercent);
          const commissionAmount = Math.round((collectedAmount * commissionPercent) / 100);
          return { agentId: agent.id, agentName: agent.name, commissionPercent, collectedAmount, commissionAmount };
        });
    }),
  /** Records a computed commission payout as an "Ойлик" (salary) expense in the Kassa cash journal. */
  payCommission: businessProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        amount: z.number().int().positive(),
        periodLabel: z.string().trim().min(1).max(160),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [created] = await tx.insert(cashEntries).values({
          sourceKey: `agent-commission:${randomUUID()}`,
          entryDate: new Date(),
          type: "expense",
          category: "Ойлик",
          agentId: input.agentId,
          description: `Komissiya (${input.periodLabel})`,
          cashAmount: input.amount,
          terminalAmount: 0,
          clickAmount: 0,
          source: "manual",
          createdBy: ctx.user.id,
        }).$returningId();
        await logAudit(tx, {
          tableName: "cash_entries",
          recordId: created.id,
          action: "create",
          userId: ctx.user.id,
          after: { type: "expense", category: "Ойлик", agentId: input.agentId, cashAmount: input.amount, periodLabel: input.periodLabel },
        });
        return { success: true };
      });
    }),
});
