import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cashEntries, cashJournalDebts, cashJournalDebtRepayments } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  debts: [] as Row[], cash: [] as Row[], repayments: [] as Row[], audits: [] as Row[],
  nextCash: 1, nextPayment: 1,
}));
const dialect = new MySqlDialect();

function fakeDb() {
  const db = {
    select: (selection?: Record<string, unknown>) => {
      let table: unknown;
      let condition: SQL | undefined;
      const query = {
        from(value: unknown) { table = value; return query; },
        where(value: SQL | undefined) { condition = value; return query; },
        limit() { return query; },
        for() { return query; },
        then(resolve: (value: Row[]) => unknown, reject: (reason: unknown) => unknown) {
          let rows = table === cashJournalDebts ? state.debts : table === cashEntries ? state.cash
            : table === cashJournalDebtRepayments ? state.repayments : [];
          if (condition) {
            const { sql, params } = dialect.sqlToQuery(condition);
            if (sql.includes("`sourceKey`")) rows = rows.filter(row => row.sourceKey === params[0]);
            else if (sql.includes("`cashEntryId`")) rows = rows.filter(row => row.cashEntryId === params[0]);
            else if (sql.includes("`debtId`")) rows = rows.filter(row => row.debtId === params[0]);
            else if (sql.includes("`id`")) rows = rows.filter(row => row.id === params[0]);
          }
          if (table === cashJournalDebtRepayments && selection?.amount) {
            rows = [{ amount: rows.filter(row => !row.voidedAt).reduce((sum, row) => sum + Number(row.amount), 0) }];
          }
          return Promise.resolve(rows.map(row => ({ ...row }))).then(resolve, reject);
        },
      };
      return query;
    },
    insert: (table: unknown) => ({ values: (values: Row) => ({
      $returningId: async () => {
        const id = table === cashEntries ? state.nextCash++ : state.nextPayment++;
        const row = { id, ...values };
        if (table === cashEntries) state.cash.push(row);
        else if (table === cashJournalDebtRepayments) state.repayments.push(row);
        else throw new Error("Unexpected insert");
        return [{ id }];
      },
    }) }),
    update: (table: unknown) => ({ set: (values: Row) => ({ where: async (condition: SQL) => {
      const id = dialect.sqlToQuery(condition).params[0];
      const rows = table === cashEntries ? state.cash : state.repayments;
      const row = rows.find(item => item.id === id);
      if (row) Object.assign(row, values);
    } }) }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>): Promise<T> => {
      const before = structuredClone({ cash: state.cash, repayments: state.repayments, nextCash: state.nextCash, nextPayment: state.nextPayment });
      try { return await callback(db); }
      catch (error) { Object.assign(state, before); throw error; }
    },
  };
  return db;
}

vi.mock("./db", () => ({ requireDb: async () => fakeDb() }));
vi.mock("./auditLog", () => ({
  assertPeriodUnlocked: async () => {},
  logAudit: async (_tx: unknown, entry: Row) => { state.audits.push(entry); },
}));

import { cashDebtRepaymentsRouter } from "./routers/cashDebtRepayments";

const date = Date.UTC(2026, 9, 7, 7);
function caller() {
  const ctx: TrpcContext = {
    user: { id: 7, email: "test@example.com", name: "Test", passwordHash: "test", role: "accountant",
      tokenVersion: 0, agentId: null, language: "latin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return cashDebtRepaymentsRouter.createCaller(ctx);
}

beforeEach(() => {
  state.debts = [{ id: 1, amount: 300, entryDate: new Date(date), agentId: 2, employeeId: null,
    borrowerName: "Ali", description: "Ali uchun" }];
  state.cash = []; state.repayments = []; state.audits = []; state.nextCash = 1; state.nextPayment = 1;
});

describe("independent cash debt repayments", () => {
  it("records partial and full repayments once, with exactly one cash income per payment", async () => {
    const api = caller();
    const first = { mode: "new" as const, debtId: 1, paymentDate: date, amount: 100,
      method: "cash" as const, requestId: "b3e2fc5c-c183-49e9-b5c2-af274804b1df" };
    expect(await api.create(first)).toEqual({ id: 1 });
    expect(await api.create(first)).toEqual({ id: 1 });
    expect(state.cash).toMatchObject([{ type: "income", category: "Qarz qaytimi", cashAmount: 100,
      terminalAmount: 0, clickAmount: 0, transferAmount: 0 }]);
    expect(state.repayments).toHaveLength(1);
    await expect(api.create({ ...first, requestId: "874be72d-a7cc-4188-b516-93858fc89a90", amount: 201 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.cash).toHaveLength(1);
    await api.create({ ...first, requestId: "464568aa-8823-4c3d-b603-55f383db09ef", amount: 200,
      method: "terminal" });
    expect(state.cash).toHaveLength(2);
    expect(state.cash[1]).toMatchObject({ cashAmount: 0, terminalAmount: 200 });
    await expect(api.create({ ...first, requestId: "367ee982-f3ea-4383-83de-f0384691577c", amount: 1 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("links a matching existing income without duplicating cash and keeps it when the link is voided", async () => {
    state.cash.push({ id: 1, sourceKey: "manual:existing", entryDate: new Date(date), type: "income",
      category: "Qarz qaytimi", agentId: 2, employeeId: null,
      cashAmount: 0, terminalAmount: 0, clickAmount: 75, transferAmount: 0 });
    state.nextCash = 2;
    const api = caller();
    const payment = { mode: "existing" as const, cashEntryId: 1, debtId: 1, paymentDate: date,
      amount: 75, method: "click" as const, requestId: "44b4ef8f-d613-468d-a84e-44b66484a24e" };
    expect(await api.create(payment)).toEqual({ id: 1 });
    expect(await api.create(payment)).toEqual({ id: 1 });
    expect(state.cash).toHaveLength(1);
    await api.void({ id: 1, reason: "Noto‘g‘ri qarzga bog‘landi" });
    expect(state.repayments[0].voidedAt).toBeInstanceOf(Date);
    expect(state.cash[0].clickAmount).toBe(75);
  });

  it("rejects a cash receipt owned by another agent", async () => {
    state.cash.push({ id: 1, sourceKey: "manual:other-agent", entryDate: new Date(date), type: "income",
      category: "Qarz qaytimi", agentId: 3, employeeId: null,
      cashAmount: 100, terminalAmount: 0, clickAmount: 0, transferAmount: 0 });
    const api = caller();
    await expect(api.create({ mode: "existing", cashEntryId: 1, debtId: 1, paymentDate: date,
      amount: 100, method: "cash", requestId: "74f09d7b-f721-46a6-8be5-0a54ccc88ed9" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.repayments).toHaveLength(0);
    expect(state.cash).toHaveLength(1);
  });

  it("voids a generated payment and neutralizes its linked cash entry", async () => {
    const api = caller();
    await api.create({ mode: "new", debtId: 1, paymentDate: date, amount: 50, method: "cash",
      requestId: "cf98fc1d-a371-4a2e-a06f-ed79d51e42ed" });
    await api.void({ id: 1, reason: "To‘lov xato yozildi" });
    expect(state.repayments[0].voidedAt).toBeInstanceOf(Date);
    expect(state.cash[0].cashAmount).toBe(0);
    await expect(api.void({ id: 1, reason: "Yana xato" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
