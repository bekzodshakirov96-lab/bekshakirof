import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const state = vi.hoisted(() => ({
  agentRows: [] as Array<Record<string, unknown>>,
  financialRows: [] as Array<Record<string, unknown>>,
  transactionRows: [] as Array<Record<string, unknown>>,
}));

function createSelectChain(sourceRows: Array<Record<string, unknown>>, countMode = false) {
  let rows = countMode ? [{ total: sourceRows.length }] : [...sourceRows];
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (limit: number) => {
      rows = rows.slice(0, limit);
      return chain;
    },
    offset: (offset: number) => Promise.resolve(rows.slice(offset)),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

vi.mock("./db", () => ({
  requireDb: async () => ({
    select: (selection?: Record<string, unknown>) => {
      if (!selection) return createSelectChain(state.agentRows);
      if (Object.prototype.hasOwnProperty.call(selection, "total")) return createSelectChain(state.transactionRows, true);
      return createSelectChain(state.transactionRows);
    },
  }),
}));

vi.mock("./businessQueries", () => ({
  getClientFinancialRows: async () => state.financialRows,
  enrichClientFinancialRows: (rows: Array<Record<string, unknown>>) => rows,
  normalizeSearch: (value?: string) => value?.trim().toLocaleLowerCase("uz-Latn") ?? "",
  paginate: (rows: Array<Record<string, unknown>>, page: number, pageSize: number) => ({
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(rows.length / pageSize)),
  }),
}));

import { agentsRouter } from "./routers/agents";
import { debtsRouter } from "./routers/debts";
import { transactionsRouter } from "./routers/transactions";

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "export-test-user",
      email: "admin@example.com",
      name: "Rahbar",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function financialRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    code: "M-001",
    name: "Mijoz",
    agentId: 1,
    agentName: "Agent",
    phone: null,
    address: null,
    openingDebt: 0,
    totalSales: 0,
    cashPayment: 0,
    terminalPayment: 0,
    clickPayment: 0,
    totalPaid: 0,
    currentDebt: 0,
    ...overrides,
  };
}

describe("exportData router parity", () => {
  it("qarzdorlik list va exportida bir xil filter hamda saralangan datasetni qaytaradi", async () => {
    state.financialRows = [
      financialRow({ id: 1, code: "AL-1", name: "Ali Market", agentId: 1, agentName: "Aziz", currentDebt: 400 }),
      financialRow({ id: 2, code: "AL-2", name: "Alim Savdo", agentId: 1, agentName: "Aziz", currentDebt: 900 }),
      financialRow({ id: 3, code: "BK-1", name: "Bek Market", agentId: 2, agentName: "Bobur", currentDebt: 700 }),
    ];
    const caller = debtsRouter.createCaller(createContext());
    const filters = { search: "ali", agentId: 1, status: "debt" as const, minDebt: 300, sortBy: "currentDebt" as const, sortOrder: "desc" as const };
    const list = await caller.list({ ...filters, page: 1, pageSize: 10 });
    const exported = await caller.exportData(filters);
    expect(list.items.map(row => row.id)).toEqual([2, 1]);
    expect(exported.rows.map(row => row.id)).toEqual(list.items.map(row => row.id));
    expect(exported.summary.currentDebt).toBe(1300);
  });

  it("agentlar list va exportida faol/qarz filteri hamda saralash paritysini saqlaydi", async () => {
    state.agentRows = [
      { id: 1, name: "Aziz", phone: "90", isActive: true },
      { id: 2, name: "Bobur", phone: "91", isActive: true },
      { id: 3, name: "Dilshod", phone: "92", isActive: false },
    ];
    state.financialRows = [
      financialRow({ id: 1, agentId: 1, currentDebt: 200, totalSales: 500, totalPaid: 300 }),
      financialRow({ id: 2, agentId: 2, currentDebt: 800, totalSales: 1000, totalPaid: 200 }),
    ];
    const caller = agentsRouter.createCaller(createContext());
    const filters = { status: "active" as const, debtStatus: "debt" as const, sortBy: "currentDebt" as const, sortOrder: "desc" as const };
    const list = await caller.list({ ...filters, page: 1, pageSize: 10 });
    const exported = await caller.exportData(filters);
    expect(list.items.map(row => row.id)).toEqual([2, 1]);
    expect(exported.rows.map(row => row.id)).toEqual([2, 1]);
    expect(exported.summary.currentDebt).toBe(1000);
  });

  it("savdo list va exporti bir xil saralangan qatorlar ketma-ketligini qaytaradi", async () => {
    state.transactionRows = [
      { id: 9, transactionDate: new Date("2026-07-03"), agentName: "Aziz", clientName: "Ali", productName: "KEG 50", unit: "dona", quantity: 4, salePrice: 10, totalAmount: 40, cashPayment: 20, terminalPayment: 20, clickPayment: 0, note: null, source: "manual", issuedContainerType: "KEG 50", issuedContainerQuantity: 4, returnedContainerType: null, returnedContainerQuantity: 0 },
      { id: 8, transactionDate: new Date("2026-07-02"), agentName: "Aziz", clientName: "Ali", productName: "Suv", unit: "dona", quantity: 2, salePrice: 5, totalAmount: 10, cashPayment: 10, terminalPayment: 0, clickPayment: 0, note: null, source: "manual", issuedContainerType: null, issuedContainerQuantity: 0, returnedContainerType: null, returnedContainerQuantity: 0 },
    ];
    const caller = transactionsRouter.createCaller(createContext());
    const filters = { search: "Ali", sortBy: "transactionDate" as const, sortOrder: "desc" as const };
    const list = await caller.list({ ...filters, page: 1, pageSize: 10 });
    const exported = await caller.exportData({ ...filters, page: 1, pageSize: 25 });
    expect(exported.rows.map(row => row.id)).toEqual(list.items.map(row => row.id));
    expect(exported.summary.totalAmount).toBe(50);
    expect(exported.summary.issuedContainers).toBe(4);
  });
});

describe("exportData router limitlari", () => {
  it("qarzdorlik exportida 10 001 qatorni o‘zbekcha xato bilan bloklaydi", async () => {
    state.financialRows = Array.from({ length: 10_001 }, (_, index) => financialRow({ id: index + 1, code: `M-${index}`, name: `Mijoz ${index}` }));
    const caller = debtsRouter.createCaller(createContext());
    await expect(caller.exportData({ status: "all", sortBy: "code", sortOrder: "asc" })).rejects.toThrow("Filterlarni toraytiring");
  });

  it("agentlar exportida 10 001 qatorni o‘zbekcha xato bilan bloklaydi", async () => {
    state.agentRows = Array.from({ length: 10_001 }, (_, index) => ({ id: index + 1, name: `Agent ${index}`, phone: null, isActive: true }));
    state.financialRows = [];
    const caller = agentsRouter.createCaller(createContext());
    await expect(caller.exportData({ status: "all", debtStatus: "all", sortBy: "name", sortOrder: "asc" })).rejects.toThrow("Filterlarni toraytiring");
  });

  it("savdo exportida 10 001 qatorni o‘zbekcha xato bilan bloklaydi", async () => {
    state.transactionRows = Array.from({ length: 10_001 }, (_, index) => ({ id: index + 1 }));
    const caller = transactionsRouter.createCaller(createContext());
    await expect(caller.exportData({ sortBy: "transactionDate", sortOrder: "desc", page: 1, pageSize: 25 })).rejects.toThrow("Sana yoki boshqa filterlarni toraytiring");
  });
});
