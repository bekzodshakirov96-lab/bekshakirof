import { readFileSync } from "node:fs";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appSettings, auditLog, cashJournalDebts } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  audits: [] as Row[],
  writes: [] as Array<{ table: string; action: string }>,
  executed: [] as string[],
  lockDate: null as string | null,
  failAudit: false,
  nextId: 1,
}));
const dialect = new MySqlDialect();

function idOf(condition: SQL) {
  return dialect.sqlToQuery(condition).params[0];
}

function createDbDouble() {
  const db = {
    select: (selection?: Record<string, unknown>) => {
      let selected: Row[] = [];
      let isMemo = false;
      let rowLimit = Infinity;
      let rowOffset = 0;
      const chain = {
        from: (table: unknown) => {
          if (table === appSettings) selected = state.lockDate ? [{ value: state.lockDate }] : [];
          else if (table === cashJournalDebts) { selected = state.rows.map(row => ({ ...row })); isMemo = true; }
          else throw new Error("Unexpected read outside debt memos and period settings");
          return chain;
        },
        leftJoin: () => chain,
        where: (condition?: SQL) => {
          if (isMemo && condition) {
            const params = dialect.sqlToQuery(condition).params;
            if (params.length === 1) {
              const field = dialect.sqlToQuery(condition).sql.includes('`agentId`') ? 'agentId' : 'id';
              selected = selected.filter(row => row[field] === params[0]);
            }
            else if (params.length === 2) {
              const timestamp = (value: unknown) => new Date(String(value).replace(" ", "T") + "Z").getTime();
              selected = selected.filter(row => {
                const date = (row.entryDate as Date).getTime();
                return date >= timestamp(params[0]) && date <= timestamp(params[1]);
              });
            }
          }
          return chain;
        },
        limit: (limit: number) => { rowLimit = limit; return chain; },
        offset: (offset: number) => { rowOffset = offset; return chain; },
        for: () => chain,
        orderBy: (...columns: unknown[]) => {
          selected.sort((a, b) => (columns.length > 1 ? Number(b.entryDate) - Number(a.entryDate) : 0) || Number(b.id) - Number(a.id));
          return chain;
        },
        then: (resolve: (value: Row[]) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(selection && 'totalAmount' in selection
            ? [{ total: selected.length, totalAmount: selected.reduce((sum, row) => sum + Number(row.amount), 0) }]
            : selected.slice(rowOffset, rowOffset + rowLimit)).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: typeof cashJournalDebts | typeof auditLog) => ({
      values: (values: Row) => {
        const commit = async () => {
          if (table !== cashJournalDebts && table !== auditLog) throw new Error("Unexpected financial write");
          if (table === auditLog && state.failAudit) throw new Error("Audit unavailable");
          state.writes.push({ table: getTableName(table), action: "insert" });
          if (table === auditLog) { state.audits.push(values); return []; }
          const id = state.nextId++;
          state.rows.push({ id, createdAt: new Date(), updatedAt: new Date(), ...values });
          return [{ id }];
        };
        return {
          $returningId: commit,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => commit().then(resolve, reject),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: async (condition: SQL) => {
          if (table !== cashJournalDebts) throw new Error("Unexpected financial update");
          state.writes.push({ table: "cash_journal_debts", action: "update" });
          const row = state.rows.find(item => item.id === idOf(condition));
          if (row) Object.assign(row, values);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (condition: SQL) => {
        if (table !== cashJournalDebts) throw new Error("Unexpected financial deletion");
        state.writes.push({ table: "cash_journal_debts", action: "delete" });
        state.rows = state.rows.filter(row => row.id !== idOf(condition));
      },
    }),
    transaction: async <T>(callback: (tx: ReturnType<typeof createDbDouble>) => Promise<T>): Promise<T> => {
      const before = structuredClone({ rows: state.rows, audits: state.audits });
      try { return await callback(db); }
      catch (error) { state.rows = before.rows; state.audits = before.audits; throw error; }
    },
    execute: async (query: SQL) => { state.executed.push(dialect.sqlToQuery(query).sql); },
  };
  return db;
}

vi.mock("./db", () => ({ requireDb: async () => createDbDouble() }));

import { cashRouter } from "./routers/cash";
import { CASH_JOURNAL_DEBTS_DDL, ensureCashJournalDebtTable } from "./cashJournalDebtSchema";

const entryDate = new Date(2026, 8, 7, 12).getTime();
const oldDate = new Date(2026, 8, 6, 12).getTime();

function caller(role: NonNullable<TrpcContext["user"]>["role"] | null = "accountant") {
  const ctx: TrpcContext = {
    user: role ? {
      id: 7, email: "memo-test@example.com", name: "Memo test", passwordHash: "test-only", role,
      tokenVersion: 0, agentId: null, language: "latin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return cashRouter.createCaller(ctx).journalDebt;
}

beforeEach(() => {
  state.rows = []; state.audits = []; state.writes = []; state.executed = [];
  state.lockDate = null; state.failAudit = false; state.nextId = 1;
});
afterEach(() => vi.unstubAllEnvs());

describe("cash.journalDebt", () => {
  it("reports all dates, filters agents, and totals all pages without financial writes", async () => {
    const api = caller();
    await api.create({ entryDate, amount: 200, agentId: 2, description: "Ali uchun" });
    await api.create({ entryDate: oldDate, amount: 100, agentId: 2, description: "Vali uchun" });
    await api.create({ entryDate, amount: 900, agentId: 3 });
    state.writes = [];
    const first = await api.report({ agentId: 2, pageSize: 1 });
    expect(first).toMatchObject({ total: 2, totalAmount: 300, page: 1, pageCount: 2, items: [{ amount: 200, agentId: 2, description: "Ali uchun" }] });
    expect(await api.report({ agentId: 2, pageSize: 1, page: 99 })).toMatchObject({ page: 2, totalAmount: 300, items: [{ amount: 100, description: "Vali uchun" }] });
    expect(await api.report({})).toMatchObject({ total: 3, totalAmount: 1200 });
    expect(await api.report({ agentId: 99 })).toMatchObject({ items: [], total: 0, totalAmount: 0, pageCount: 1 });
    expect(state.writes).toEqual([]);
  });

  it("restricts report access and validates pagination", async () => {
    await expect(caller(null).report({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("agent").report({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().report({ page: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().report({ pageSize: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("creates, edits and deletes only a memo and its audit history", async () => {
    const api = caller();
    const { id } = await api.create({ entryDate, amount: 150000, agentId: 2, description: "  Ali uchun qarz  " });
    expect(state.rows).toMatchObject([{ id, agentId: 2, employeeId: null, amount: 150000, description: "Ali uchun qarz", createdBy: 7 }]);
    await api.update({ id, entryDate, amount: 175000 });
    expect(state.rows[0]).toMatchObject({ agentId: 2, description: "Ali uchun qarz", amount: 175000, createdBy: 7 });
    await api.update({ id, entryDate, amount: 200000, agentId: null, employeeId: 5, description: "Vali uchun" });
    expect(state.rows[0]).toMatchObject({ agentId: null, employeeId: 5, description: "Vali uchun" });
    await api.delete({ id });
    expect(state.rows).toEqual([]);
    expect(state.audits.map(row => row.action)).toEqual(["create", "update", "update", "delete"]);
    expect(state.audits.every(row => row.tableName === "cash_journal_debts" && row.userId === 7)).toBe(true);
    expect(JSON.parse(String(state.audits[1].beforeData)).amount).toBe(150000);
    expect(JSON.parse(String(state.audits[1].afterData)).amount).toBe(175000);
    expect(new Set(state.writes.map(row => row.table))).toEqual(new Set(["cash_journal_debts", "audit_log"]));
  });

  it("loads only the selected day's memos", async () => {
    const api = caller();
    await api.create({ entryDate: oldDate, amount: 100 });
    const { id } = await api.create({ entryDate, amount: 200, description: "Shu kungi eslatma" });
    expect(await api.byDate({ date: entryDate })).toMatchObject([{ id, amount: 200, description: "Shu kungi eslatma" }]);
  });

  it.each([0, -1, 1.5, 2_147_483_648])("rejects invalid memo amount %s before any write", async amount => {
    await expect(caller().create({ entryDate, amount })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().update({ id: 1, entryDate, amount })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.writes).toEqual([]);
  });

  it("limits description to 1000 characters and rejects invalid dates", async () => {
    await expect(caller().create({ entryDate, amount: 1, description: "A".repeat(1001) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().create({ entryDate: Number.MAX_SAFE_INTEGER, amount: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { id } = await caller().create({ entryDate, amount: 1, description: "A".repeat(1000) });
    await caller().update({ id, entryDate, amount: 1, description: null });
    expect(state.rows[0].description).toBeNull();
  });

  it("rejects two payees, including conflict with a preserved existing payee", async () => {
    const api = caller();
    await expect(api.create({ entryDate, amount: 1, agentId: 2, employeeId: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { id } = await api.create({ entryDate, amount: 1, employeeId: 3 });
    await expect(api.update({ id, entryDate, amount: 1, agentId: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.rows[0]).toMatchObject({ agentId: null, employeeId: 3 });
  });

  it("enforces period locks on creation, both update dates, and deletion", async () => {
    const api = caller();
    const old = await api.create({ entryDate: oldDate, amount: 100 });
    const current = await api.create({ entryDate, amount: 200 });
    state.lockDate = "2026-09-06";
    const writeCount = state.writes.length;
    await expect(api.create({ entryDate: oldDate, amount: 1 })).rejects.toThrow("yopilgan davr");
    await expect(api.update({ id: old.id, entryDate, amount: 1 })).rejects.toThrow("yopilgan davr");
    await expect(api.update({ id: current.id, entryDate: oldDate, amount: 1 })).rejects.toThrow("yopilgan davr");
    await expect(api.delete({ id: old.id })).rejects.toThrow("yopilgan davr");
    expect(state.writes).toHaveLength(writeCount);
  });

  it.each(["create", "update", "delete"] as const)("rolls back memo %s if audit writing fails", async operation => {
    const api = caller();
    const { id } = await api.create({ entryDate, amount: 100 });
    const before = structuredClone(state.rows);
    state.failAudit = true;
    const promise = operation === "create" ? api.create({ entryDate, amount: 200 })
      : operation === "update" ? api.update({ id, entryDate, amount: 200 }) : api.delete({ id });
    await expect(promise).rejects.toThrow("Audit unavailable");
    expect(state.rows).toEqual(before);
    expect(state.audits).toHaveLength(1);
  });

  it("returns not-found for missing update/delete IDs", async () => {
    await expect(caller().update({ id: 55, entryDate, amount: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().delete({ id: 55 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.writes).toEqual([]);
  });

  it.each([null, "agent", "sklad", "user"] as const)("denies memo access for role %s", async role => {
    const api = caller(role);
    const code = role === null ? "UNAUTHORIZED" : "FORBIDDEN";
    await expect(api.byDate({ date: entryDate })).rejects.toMatchObject({ code });
    await expect(api.create({ entryDate, amount: 1 })).rejects.toMatchObject({ code });
    await expect(api.update({ id: 1, entryDate, amount: 1 })).rejects.toMatchObject({ code });
    await expect(api.delete({ id: 1 })).rejects.toMatchObject({ code });
    expect(state.writes).toEqual([]);
  });
});

describe("debt memo schema startup", () => {
  it("does not contact a database when DATABASE_URL is absent", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await ensureCashJournalDebtTable();
    expect(state.executed).toEqual([]);
  });

  it("runs only the additive repeat-safe DDL and matches the journal migration", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://unused-test-host");
    await ensureCashJournalDebtTable();
    await ensureCashJournalDebtTable();
    expect(state.executed).toEqual([CASH_JOURNAL_DEBTS_DDL, CASH_JOURNAL_DEBTS_DDL]);
    expect(CASH_JOURNAL_DEBTS_DDL).toMatch(/^CREATE TABLE IF NOT EXISTS cash_journal_debts/);
    const migration = readFileSync(new URL("../drizzle/0016_cash_journal_debts.sql", import.meta.url), "utf8");
    expect(migration.replace(/\r\n/g, "\n").trim().replace(/;$/, "")).toBe(CASH_JOURNAL_DEBTS_DDL);
  });
});
