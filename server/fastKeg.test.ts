import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const state = vi.hoisted(() => ({
  existingRows: [] as Array<Record<string, unknown>>,
  productRows: [] as Array<Record<string, unknown>>,
  financialRows: [] as Array<Record<string, unknown>>,
  balanceRows: [] as Array<Record<string, unknown>>,
  insertedTransactions: [] as Array<Record<string, unknown>>,
  reconcileCalls: [] as Array<Record<string, unknown>>,
  nextTransactionId: 100,
  insertAttempt: 0,
  failOnInsertAttempt: 0,
  rollbackCount: 0,
}));

function createSelectChain(rows: Array<Record<string, unknown>>) {
  let selectedRows = [...rows];
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: (limit: number) => {
      selectedRows = selectedRows.slice(0, limit);
      return chain;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(selectedRows).then(resolve, reject),
  };
  return chain;
}

function createTransactionDouble() {
  let selectIndex = 0;
  return {
    select: () => {
      const rows = [state.existingRows, state.productRows, state.financialRows, state.balanceRows][selectIndex] ?? [];
      selectIndex += 1;
      return createSelectChain(rows);
    },
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        $returningId: async () => {
          state.insertAttempt += 1;
          if (state.failOnInsertAttempt === state.insertAttempt) {
            throw new Error("Sinov uchun ikkinchi yozuv xatosi");
          }
          state.insertedTransactions.push(value);
          const id = state.nextTransactionId;
          state.nextTransactionId += 1;
          return [{ id }];
        },
      }),
    }),
  };
}

vi.mock("./db", () => ({
  requireDb: async () => ({
    transaction: async (callback: (tx: ReturnType<typeof createTransactionDouble>) => Promise<unknown>) => {
      const insertedSnapshot = state.insertedTransactions.length;
      const reconcileSnapshot = state.reconcileCalls.length;
      try {
        return await callback(createTransactionDouble());
      } catch (error) {
        state.insertedTransactions.splice(insertedSnapshot);
        state.reconcileCalls.splice(reconcileSnapshot);
        state.rollbackCount += 1;
        throw error;
      }
    },
  }),
}));

// Bu testlar KEG savdosi mantiqini tekshiradi — davr qulfi va audit yozuvi
// alohida mavzular, shuning uchun ular bu yerda o'chirib qo'yiladi.
vi.mock("./auditLog", () => ({
  assertPeriodUnlocked: async () => undefined,
  logAudit: async () => undefined,
}));

vi.mock("./containerAccounting", async importOriginal => {
  const actual = await importOriginal<typeof import("./containerAccounting")>();
  return {
    ...actual,
    reconcileTransactionContainers: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
      state.reconcileCalls.push(input);
      return {
        issuedType: input.productContainerType ?? null,
        issuedQuantity: Number(input.productQuantity ?? 0) * Number(input.containerUnitsPerItem ?? 1),
        returnedType: input.returnContainerType ?? null,
        returnedQuantity: Number(input.returnQuantity ?? 0),
      };
    }),
  };
});

vi.mock("./stockAccounting", async importOriginal => {
  const actual = await importOriginal<typeof import("./stockAccounting")>();
  return {
    ...actual,
    reconcileTransactionStock: vi.fn(async () => undefined),
  };
});

import { fastKegRouter } from "./routers/fastKeg";

function createContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "fast-keg-test-user",
      email: "buxgalter@example.com",
      name: "Sinov buxgalteri",
      loginMethod: "manus",
      role: "accountant",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function clientRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code: `M-${id}`,
    name: `Mijoz ${id}`,
    openingDebt: 1_000,
    totalSales: 0,
    totalPaid: 0,
    /** Savdodan alohida qabul qilingan qarz to'lovlari (client_payments). */
    debtPaid: 0,
    ...overrides,
  };
}

function productRow(id: number, containerType: "keg_30" | "keg_50", price: number) {
  return {
    id,
    name: containerType === "keg_30" ? "KEG 30" : "KEG 50",
    unit: "dona",
    price,
    containerType,
    containerUnitsPerItem: 1,
    isActive: true,
  };
}

function inputRow(clientId: number, overrides: Record<string, number> = {}) {
  return {
    clientId,
    keg30: 0,
    keg50: 0,
    returned30: 0,
    returned50: 0,
    cash: 0,
    ...overrides,
  };
}

function batchInput(rows: ReturnType<typeof inputRow>[], key = "fastkeg_test_001") {
  return {
    idempotencyKey: key,
    transactionDate: Date.parse("2026-07-23T00:00:00.000Z"),
    agentId: 3,
    rows,
  };
}

describe("fastKeg.saveBatch", () => {
  beforeEach(() => {
    state.existingRows = [];
    state.productRows = [];
    state.financialRows = [];
    state.balanceRows = [];
    state.insertedTransactions = [];
    state.reconcileCalls = [];
    state.nextTransactionId = 100;
    state.insertAttempt = 0;
    state.failOnInsertAttempt = 0;
    state.rollbackCount = 0;
  });

  it("faqat kassali qatorni soxta KEG mahsulotisiz to‘lov sifatida saqlaydi", async () => {
    state.financialRows = [clientRow(11)];
    const caller = fastKegRouter.createCaller(createContext());

    const result = await caller.saveBatch(batchInput([inputRow(11, { cash: 250 })]));

    expect(result.duplicate).toBe(false);
    expect(result.rows[0]).toMatchObject({ clientId: 11, saleAmount: 0, endingDebt: 750 });
    expect(state.insertedTransactions).toHaveLength(1);
    expect(state.insertedTransactions[0]).toMatchObject({
      productId: null,
      productName: "Kassa to‘lovi",
      totalAmount: 0,
      cashPayment: 250,
    });
    expect(state.reconcileCalls[0]).toMatchObject({ productContainerType: null, productQuantity: 0 });
  });

  it("KEG 30/50 savdosi, qaytgan tara va kassani bitta mijoz uchun to‘g‘ri taqsimlaydi", async () => {
    state.productRows = [productRow(30, "keg_30", 100), productRow(50, "keg_50", 250)];
    state.financialRows = [clientRow(12)];
    state.balanceRows = [
      { clientId: 12, containerType: "KEG 30", balance: 3 },
      { clientId: 12, containerType: "KEG 50", balance: 1 },
    ];
    const caller = fastKegRouter.createCaller(createContext());

    const result = await caller.saveBatch(
      batchInput([inputRow(12, { keg30: 2, keg50: 1, returned30: 1, returned50: 1, cash: 300 })]),
    );

    expect(result.rows[0]).toMatchObject({
      saleAmount: 450,
      endingDebt: 1_150,
      endingKeg30Balance: 4,
      endingKeg50Balance: 1,
    });
    expect(state.insertedTransactions).toHaveLength(2);
    expect(state.insertedTransactions.map(row => row.cashPayment)).toEqual([300, 0]);
    expect(state.reconcileCalls).toHaveLength(2);
    expect(state.reconcileCalls.map(row => [row.productContainerType, row.returnContainerType])).toEqual([
      ["keg_30", "keg_30"],
      ["keg_50", "keg_50"],
    ]);
  });

  it("mavjud qoldiqdan ortiq tara qaytarishni yozuv yaratishdan oldin bloklaydi", async () => {
    state.productRows = [productRow(30, "keg_30", 100)];
    state.financialRows = [clientRow(13)];
    state.balanceRows = [{ clientId: 13, containerType: "KEG 30", balance: 1 }];
    const caller = fastKegRouter.createCaller(createContext());

    await expect(
      caller.saveBatch(batchInput([inputRow(13, { returned30: 2 })])),
    ).rejects.toThrow("Mijoz 13: KEG 30 qaytishi");
    expect(state.insertedTransactions).toHaveLength(0);
    expect(state.reconcileCalls).toHaveLength(0);
    expect(state.rollbackCount).toBe(1);
  });

  it("avval saqlangan idempotency kalitini dublikat yozuvsiz qaytaradi", async () => {
    state.existingRows = [{ id: 88 }];
    const caller = fastKegRouter.createCaller(createContext());

    const result = await caller.saveBatch(batchInput([inputRow(14, { cash: 100 })]));

    expect(result).toMatchObject({ success: true, duplicate: true });
    expect(state.insertedTransactions).toHaveLength(0);
  });

  it("ikkinchi mijoz yozuvida xato bo‘lsa birinchi mijoz yozuvini ham rollback qiladi", async () => {
    state.financialRows = [clientRow(21), clientRow(22)];
    state.failOnInsertAttempt = 2;
    const caller = fastKegRouter.createCaller(createContext());

    await expect(
      caller.saveBatch(batchInput([
        inputRow(21, { cash: 100 }),
        inputRow(22, { cash: 200 }),
      ], "fastkeg_test_rollback")),
    ).rejects.toThrow("ikkinchi yozuv xatosi");
    expect(state.insertedTransactions).toHaveLength(0);
    expect(state.reconcileCalls).toHaveLength(0);
    expect(state.rollbackCount).toBe(1);
  });

  it("bir mijozni bitta to‘plamda ikki marta yuborishni schema darajasida bloklaydi", async () => {
    const caller = fastKegRouter.createCaller(createContext());
    await expect(
      caller.saveBatch(batchInput([
        inputRow(31, { cash: 100 }),
        inputRow(31, { cash: 200 }),
      ], "fastkeg_test_duplicate_client")),
    ).rejects.toThrow("Bir mijoz ommaviy jadvalda faqat bir marta");
  });
});
