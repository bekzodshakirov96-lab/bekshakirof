import { beforeEach, describe, expect, it, vi } from "vitest";
import { bottleMovements, containerMovements, factoryOperations, products, stockMovements } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  factoryRows: [] as Row[],
  bottleRows: [] as Row[],
  stockRows: [] as Row[],
  containerRows: [] as Row[],
}));

function selectRows(table: unknown): Row[] {
  if (table === products) return [{ id: 1, name: "KEG 30", containerType: "keg_30" }];
  if (table === containerMovements) return state.containerRows;
  if (table === factoryOperations) {
    const totals = new Map<string, Row>();
    for (const row of state.factoryRows) {
      const key = `${row.productId}:${row.operationType}`;
      const previous = totals.get(key);
      totals.set(key, {
        productId: row.productId,
        operationType: row.operationType,
        total: Number(previous?.total ?? 0) + Number(row.quantity),
      });
    }
    return [...totals.values()];
  }
  if (table === bottleMovements) {
    const sum = (type: string, field: string) => state.bottleRows
      .filter(row => row.movementType === type)
      .reduce((total, row) => total + Number(row[field]), 0);
    const purchasedQuantity = sum("purchase", "quantity");
    const sentQuantity = sum("sent", "quantity");
    return [{
      purchasedQuantity,
      purchasedAmount: sum("purchase", "amount"),
      sentQuantity,
      sentAmount: sum("sent", "amount"),
      paidAmount: sum("payment", "amount"),
      onHand: purchasedQuantity - sentQuantity,
    }];
  }
  throw new Error("Unexpected selected table");
}

function createDbDouble() {
  const db = {
    select: () => {
      let rows: Row[] = [];
      const chain = {
        from: (table: unknown) => { rows = selectRows(table); return chain; },
        where: () => chain,
        groupBy: () => chain,
        limit: (limit: number) => { rows = rows.slice(0, limit); return chain; },
        then: (resolve: (value: Row[]) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (row: Row) => ({
        $returningId: async () => {
          const rows = table === factoryOperations ? state.factoryRows
            : table === bottleMovements ? state.bottleRows
            : table === stockMovements ? state.stockRows : undefined;
          if (!rows) throw new Error("Unexpected inserted table");
          const id = rows.length + 1;
          rows.push({ id, ...row });
          return [{ id }];
        },
      }),
    }),
    transaction: async <T>(callback: (tx: ReturnType<typeof createDbDouble>) => Promise<T>): Promise<T> => callback(db),
  };
  return db;
}

vi.mock("./db", () => ({ requireDb: async () => createDbDouble() }));
vi.mock("./auditLog", () => ({ logAudit: async () => undefined }));

import { factoryRouter } from "./routers/factory";

function createCaller() {
  const ctx: TrpcContext = {
    user: {
      id: 7,
      email: "factory-test@example.com",
      name: "Factory test",
      passwordHash: "test-only",
      role: "accountant",
      tokenVersion: 0,
      agentId: null,
      language: "latin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return factoryRouter.createCaller(ctx);
}

const operationDate = Date.parse("2026-09-06T12:00:00Z");

beforeEach(() => {
  state.factoryRows = [];
  state.bottleRows = [];
  state.stockRows = [];
  state.containerRows = [];
});

describe("factory negative container balances", () => {
  it("allows sending empty tara without recorded returns and reports the signed balance", async () => {
    const caller = createCaller();
    await expect(caller.record({ operationType: "tara_sent", productId: 1, quantity: 2, operationDate }))
      .resolves.toEqual({ success: true });
    expect(await caller.balances()).toMatchObject([{ warehouseTara: -2, taraPending: 2, brakPending: 0 }]);
    expect(state.stockRows).toHaveLength(0);
  });

  it("allows filled and replacement receipts beyond the recorded factory balances", async () => {
    const caller = createCaller();
    await caller.record({ operationType: "filled_received", productId: 1, quantity: 1, operationDate });
    await caller.record({ operationType: "brak_replaced", productId: 1, quantity: 2, operationDate });
    expect(await caller.balances()).toMatchObject([{ warehouseTara: 0, taraPending: -1, brakPending: -2 }]);
    expect(state.stockRows).toMatchObject([
      { productId: 1, movementType: "in", quantity: "1" },
      { productId: 1, movementType: "in", quantity: "2" },
    ]);
  });

  it("allows bottles to be sent from zero or negative stock and later purchases to settle it", async () => {
    const caller = createCaller();
    for (let i = 0; i < 2; i += 1) {
      await expect(caller.bottles.create({ movementType: "sent", movementDate: operationDate, quantity: 1, unitPrice: 1700 }))
        .resolves.toEqual({ success: true });
    }
    expect(await caller.bottles.summary()).toMatchObject({ onHand: -2, sentQuantity: 2, outstanding: 3400 });

    await caller.bottles.create({ movementType: "purchase", movementDate: operationDate, quantity: 3, unitPrice: 1000 });
    expect(await caller.bottles.summary()).toMatchObject({ onHand: 1, purchasedQuantity: 3, profit: 400 });
  });

  it.each([0, -1, 1.5])("still rejects invalid movement quantity %s", async quantity => {
    const caller = createCaller();
    await expect(caller.record({ operationType: "tara_sent", productId: 1, quantity, operationDate }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.bottles.create({ movementType: "sent", movementDate: operationDate, quantity, unitPrice: 1700 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.factoryRows).toHaveLength(0);
    expect(state.bottleRows).toHaveLength(0);
  });

  it.each([0, -1])("still rejects invalid bottle price %s", async unitPrice => {
    await expect(createCaller().bottles.create({ movementType: "sent", movementDate: operationDate, quantity: 1, unitPrice }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.bottleRows).toHaveLength(0);
  });
});
