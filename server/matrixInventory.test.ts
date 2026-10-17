import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentTakingEntries,
  agents,
  cashEntries,
  factoryOperations,
  matrixStockEvents,
  products,
  stockMovements,
  transactions,
  users,
} from "../drizzle/schema";
import { drizzle } from "drizzle-orm/mysql2";
import { stockRouter } from "./routers/stock";
import { factoryRouter } from "./routers/factory";
import { kassaRouter } from "./routers/kassa";
import { productsRouter } from "./routers/products";
import { agentsRouter } from "./routers/agents";
import { transactionsRouter } from "./routers/transactions";
import { reconcileTransactionStock } from "./stockAccounting";
import type { TrpcContext } from "./_core/context";
import { tashkentDayRange } from "./businessDay";
import {
  activateMatrixStock,
  addMatrixReceipt,
  inventoryQuantity,
  matrixReceiptHistory,
  matrixStockDay,
  reverseMatrixReceipt,
  setMatrixCell,
  syncLegacyTaking,
  matrixCellVersion,
} from "./matrixInventory";

const lock = vi.hoisted(() => ({ through: 0 }));
vi.mock("./db", async original => ({
  ...(await original<typeof import("./db")>()),
  requireDb: async () => a,
}));
vi.mock("./auditLog", async original => ({
  ...(await original<typeof import("./auditLog")>()),
  assertPeriodUnlocked: async (date: Date) => {
    if (+date <= lock.through) throw new Error("Davr yopilgan");
  },
}));

it("accepts exact 3-place inventory quantities only", () => {
  for (const value of [0, 0.001, 40.125, 1_000_000])
    expect(inventoryQuantity.safeParse(value).success).toBe(true);
  for (const value of [-1, 0.0001, Infinity, NaN, 1_000_001])
    expect(inventoryQuantity.safeParse(value).success).toBe(false);
});

const url = process.env.TENANT_ISOLATION_TEST_URL;
let root: Connection;
let connection: Connection;
let pool: Pool;
let a: ReturnType<typeof drizzle>;
let owner: number;
let otherOwner: number;
let agent: number;
let secondAgent: number;
const day = +tashkentDayRange(Date.now()).start;
const date = day + 12 * 3_600_000;
const tomorrow = date + 86_400_000;
const yesterday = date - 86_400_000;
const receipt = (
  productId: number,
  quantity: number,
  when = date,
  requestKey = randomUUID()
) =>
  addMatrixReceipt(a, { productId, quantity, date: when, requestKey }, owner);
const cellRequests = new Map<
  string,
  Promise<Parameters<typeof setMatrixCell>[1]>
>();
const cell = (
  productId: number,
  quantity: number,
  expectedQuantity: number,
  when = date,
  agentId = agent
) => {
  const key = `${productId}:${agentId}:${when}:${quantity}:${expectedQuantity}`;
  let request = cellRequests.get(key);
  if (!request) {
    request = (async () => ({
      productId,
      quantity,
      expectedQuantity,
      date: when,
      agentId,
      expectedVersion: await matrixCellVersion(a, productId, agentId, when),
      requestKey: randomUUID(),
    }))();
    cellRequests.set(key, request);
  }
  return request.then(input => setMatrixCell(a, input, owner));
};
async function product() {
  const [row] = await a
    .insert(products)
    .values({
      name: `Fixture ${randomUUID()}`,
      code: randomUUID(),
      unit: "blok",
      price: 1000,
    })
    .$returningId();
  return row.id;
}
async function balance(id: number, when = date) {
  return (await matrixStockDay(a, when)).find(row => row.productId === id)!;
}

describe.skipIf(!url)("matrix inventory on disposable SQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.port ||
      parsed.port === "3306"
    )
      throw new Error("Only disposable non-default loopback SQL is allowed");
    root = await mysql.createConnection(url!);
    const suffix = randomBytes(6).toString("hex");
    const schema = `bc_inventory_${suffix}`;
    const user = `mi_${suffix}`;
    const password = randomBytes(20).toString("hex");
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    await root.query(`CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY ?`, [
      password,
    ]);
    await root.query(`GRANT ALL ON \`${schema}\`.* TO '${user}'@'127.0.0.1'`);
    parsed.username = user;
    parsed.password = password;
    parsed.pathname = `/${schema}`;
    connection = await mysql.createConnection({
      uri: parsed.toString(),
      multipleStatements: true,
    });
    const exported = execFileSync(
      process.execPath,
      [
        "node_modules/drizzle-kit/bin.cjs",
        "export",
        "--dialect",
        "mysql",
        "--schema",
        "./drizzle/schema.ts",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
    );
    await connection.query(exported.slice(exported.indexOf("CREATE TABLE")));
    pool = mysql.createPool({
      uri: parsed.toString(),
      timezone: "+05:00",
      connectionLimit: 5,
    });
    pool.on("connection", c => {
      (
        c.query as unknown as (
          sql: string,
          callback: (error: unknown) => void
        ) => void
      )("SET time_zone = '+05:00'", error => {
        if (error) throw error;
      });
    });
    a = drizzle(pool);
    [owner] = (
      await a
        .insert(users)
        .values({
          name: "Owner",
          email: "owner@example.test",
          passwordHash: "fixture",
          role: "admin",
        })
        .$returningId()
    ).map(row => row.id);
    [otherOwner] = (
      await a
        .insert(users)
        .values({
          name: "Other",
          email: "other@example.test",
          passwordHash: "fixture",
          role: "admin",
        })
        .$returningId()
    ).map(row => row.id);
    [agent] = (
      await a.insert(agents).values({ name: "Agent" }).$returningId()
    ).map(row => row.id);
    [secondAgent] = (
      await a.insert(agents).values({ name: "Agent 2" }).$returningId()
    ).map(row => row.id);
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    await connection?.end();
    await root?.end();
  });

  it("leaves old/unconfigured quantities untouched and applies only the opening DIFFERENCE", async () => {
    const id = await product();
    await a.insert(stockMovements).values({
      productId: id,
      movementType: "in",
      movementDate: new Date(yesterday),
      quantity: "80",
    });
    await cell(id, 77, 0, yesterday);
    await cell(id, 10, 0);
    const oldRows = await a
      .select()
      .from(agentTakingEntries)
      .where(eq(agentTakingEntries.productId, id));
    expect(
      (await a.select().from(matrixStockEvents)).filter(
        row => row.productId === id
      )
    ).toHaveLength(0);
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    expect(await balance(id)).toMatchObject({
      opening: 100,
      closing: 90,
      received: 0,
    });
    expect(
      (await a.select().from(matrixStockEvents))
        .filter(row => row.productId === id)
        .map(row => Number(row.quantity))
    ).toEqual([20, -10]);
    expect(
      await a
        .select()
        .from(agentTakingEntries)
        .where(eq(agentTakingEntries.productId, id))
    ).toEqual(oldRows);
    expect(await balance(id, yesterday)).toMatchObject({ active: false });
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    expect(
      (await a.select().from(matrixStockEvents)).filter(
        row => row.productId === id
      )
    ).toHaveLength(2);
    await expect(
      activateMatrixStock(
        a,
        { productId: id, date, openingQuantity: 200 },
        owner
      )
    ).rejects.toThrow("allaqachon");
  });

  it("carries 100 + 500 - 80 = 520 and dates/units independently of money", async () => {
    const id = await product();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 0 },
      owner
    );
    await receipt(id, 100);
    await receipt(id, 500, tomorrow);
    await cell(id, 80, 0, tomorrow);
    expect(await balance(id)).toMatchObject({
      opening: 0,
      received: 100,
      closing: 100,
    });
    expect(await balance(id, tomorrow)).toMatchObject({
      opening: 100,
      received: 500,
      closing: 520,
    });
    await cell(id, 20, 0, tomorrow + 86_400_000);
    expect(await balance(id, tomorrow + 86_400_000)).toMatchObject({
      opening: 520,
      received: 0,
      closing: 500,
    });
    expect(await a.select().from(cashEntries)).toEqual([]);
    expect(await a.select().from(transactions)).toEqual([]);
  });

  it("uses only net prepared quantities; edits/removal post differences and retain history", async () => {
    const id = await product();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    await cell(id, 40, 0);
    await cell(id, 40, 0); // network retry
    expect(await balance(id)).toMatchObject({ closing: 60 });
    await cell(id, 35, 40);
    expect(await balance(id)).toMatchObject({ closing: 65 });
    await expect(cell(id, 50, 40)).rejects.toMatchObject({ code: "CONFLICT" });
    const [entry] = await a
      .select()
      .from(agentTakingEntries)
      .where(eq(agentTakingEntries.productId, id));
    expect(entry.amount).toBe(35000);
    await syncLegacyTaking(a, entry.id, owner, 30);
    expect(await balance(id)).toMatchObject({ closing: 70 });
    await cell(id, 0, 30);
    expect(await balance(id)).toMatchObject({ closing: 100 });
    expect(
      (await a.select().from(matrixStockEvents))
        .filter(row => row.productId === id)
        .map(row => Number(row.quantity))
    ).toEqual([100, -40, 5, 5, 30]);
  });

  it("creates one receipt per request ID, permits equal real receipts, and reverses once", async () => {
    const id = await product();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 0 },
      owner
    );
    const key = randomUUID();
    const [first, retry] = await Promise.all([
      receipt(id, 100, date, key),
      receipt(id, 100, date, key),
    ]);
    expect(first.id).toBe(retry.id);
    await receipt(id, 100);
    expect(await balance(id)).toMatchObject({ closing: 200, received: 200 });
    await expect(receipt(id, 200, date, key)).rejects.toThrow("ID");
    await Promise.all([
      reverseMatrixReceipt(a, first.id, "Xato prixod", owner),
      reverseMatrixReceipt(a, first.id, "Xato prixod", owner),
    ]);
    expect(await balance(id)).toMatchObject({ closing: 100, received: 100 });
    const history = await matrixReceiptHistory(a, {
      productId: id,
      date,
      page: 1,
    });
    expect(history.items).toHaveLength(3);
    expect(history.items.find(row => row.id === first.id)?.reversed).toBe(true);
    for (let index = 0; index < 12; index++) await receipt(id, 1);
    expect(
      (await matrixReceiptHistory(a, { productId: id, date, page: 1 })).items
    ).toHaveLength(10);
    expect(
      (await matrixReceiptHistory(a, { productId: id, date, page: 2 })).items
    ).toHaveLength(5);
  });

  it("serializes simultaneous cells and preserves explicit negative balances", async () => {
    const id = await product();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    await Promise.all([cell(id, 60, 0), cell(id, 60, 0)]);
    expect(
      (await a.select().from(agentTakingEntries)).filter(
        row => row.productId === id
      )
    ).toHaveLength(1);
    await cell(id, 60, 0, date, secondAgent);
    expect(await balance(id)).toMatchObject({ closing: -20 });
    const results = await Promise.allSettled([
      cell(id, 61, 60),
      cell(id, 62, 60),
    ]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
  });

  it("rolls back failed posts and enforces closed periods", async () => {
    const id = await product();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    await expect(
      addMatrixReceipt(
        a,
        { productId: id, date, quantity: 10, requestKey: randomUUID() },
        otherOwner + 999999
      )
    ).rejects.toThrow();
    expect(await balance(id)).toMatchObject({ closing: 100, received: 0 });
    lock.through = day + 86_400_000 - 1;
    try {
      await expect(receipt(id, 10)).rejects.toThrow("yopilgan");
      await expect(cell(id, 10, 0)).rejects.toThrow("yopilgan");
    } finally {
      lock.through = 0;
    }
    expect(await balance(id)).toMatchObject({ closing: 100 });
  });

  it("preserves selected business dates even on old implicit ON UPDATE schemas", async () => {
    // Match the pre-fix local MariaDB table rather than testing only new DDL.
    await connection.query(
      "ALTER TABLE agent_taking_entries MODIFY entryDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    );
    try {
      const id = await product();
      const when = tomorrow + 3 * 86_400_000;
      await activateMatrixStock(
        a,
        { productId: id, date, openingQuantity: 100 },
        owner
      );
      await cell(id, 40, 0, when);
      await cell(id, 35, 40, when);
      const [row] = await a
        .select()
        .from(agentTakingEntries)
        .where(eq(agentTakingEntries.productId, id));
      expect(+row.entryDate).toBe(when);
      await syncLegacyTaking(a, row.id, owner, 30);
      const [edited] = await a
        .select()
        .from(agentTakingEntries)
        .where(eq(agentTakingEntries.id, row.id));
      expect(+edited.entryDate).toBe(when);
      expect(await balance(id, when)).toMatchObject({ closing: 70 });
      expect(await balance(id, when + 86_400_000)).toMatchObject({
        opening: 70,
        closing: 70,
      });
      expect(await balance(id, date)).toMatchObject({ closing: 100 });
      const context = {
        user: { id: owner, role: "admin" },
        req: { headers: {} },
        res: {},
      } as TrpcContext;
      const kassa = kassaRouter.createCaller(context);
      await kassa.dayPrice.upsert({
        date: when,
        productId: id,
        unitPrice: 1100,
      });
      await kassa.dayPrice.upsert({
        date: when,
        productId: id,
        unitPrice: 1200,
      });
      await productsRouter
        .createCaller(context)
        .rename({ id, name: "Renamed date preservation fixture" });
      const [repriced] = await a
        .select()
        .from(agentTakingEntries)
        .where(eq(agentTakingEntries.id, row.id));
      expect(+repriced.entryDate).toBe(when);
      expect(repriced.amount).toBe(36000);
      expect(await balance(id, when)).toMatchObject({ closing: 70 });
    } finally {
      await connection.query(
        "ALTER TABLE agent_taking_entries MODIFY entryDate TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
      );
    }
  });

  it("freezes pre-count stock through manual, batch, factory and sale writers", async () => {
    const id = await product();
    const [old] = await a
      .insert(stockMovements)
      .values({
        productId: id,
        movementDate: new Date(yesterday),
        movementType: "in",
        quantity: "80",
        isAutomatic: false,
      })
      .$returningId();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    const context = {
      user: { id: owner, role: "admin" },
      req: { headers: {} },
      res: {},
    } as TrpcContext;
    const stock = stockRouter.createCaller(context);
    const factory = factoryRouter.createCaller(context);
    await expect(stock.deleteMovement({ id: old.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      stock.stockIn({ productId: id, movementDate: yesterday, quantity: 80 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      stock.stockOut({
        productId: id,
        movementDate: yesterday,
        quantity: 10,
        reason: "Test",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      stock.stockInBatch({
        movementDate: yesterday,
        items: [{ productId: id, quantity: 5 }],
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      factory.record({
        productId: id,
        operationDate: yesterday,
        quantity: 5,
        operationType: "filled_received",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      a.transaction(tx =>
        reconcileTransactionStock(tx, {
          transactionId: 999,
          productId: id,
          movementDate: new Date(yesterday),
          quantity: 5,
          createdBy: owner,
        })
      )
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await balance(id)).toMatchObject({ opening: 100, closing: 100 });
    expect(await balance(id, tomorrow)).toMatchObject({
      opening: 100,
      closing: 100,
    });
    await stock.stockIn({
      productId: id,
      movementDate: tomorrow,
      quantity: 20,
    });
    expect(await balance(id, tomorrow)).toMatchObject({
      opening: 100,
      closing: 120,
    });
    const concurrentId = await product();
    const race = await Promise.allSettled([
      activateMatrixStock(
        a,
        { productId: concurrentId, date, openingQuantity: 100 },
        owner
      ),
      stock.stockIn({
        productId: concurrentId,
        movementDate: yesterday,
        quantity: 80,
      }),
    ]);
    expect(race[0].status).toBe("fulfilled");
    expect(await balance(concurrentId)).toMatchObject({
      opening: 100,
      closing: 100,
    });
  });

  it("deduplicates a delayed request after 40 -> 10 -> 40 and rejects stale versions after deletion", async () => {
    const id = await product();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    await cell(id, 40, 0);
    const old = {
      productId: id,
      agentId: agent,
      date,
      quantity: 10,
      expectedQuantity: 40,
      expectedVersion: await matrixCellVersion(a, id, agent, date),
      requestKey: randomUUID(),
    };
    await setMatrixCell(a, old, owner);
    await cell(id, 40, 10);
    expect(await balance(id)).toMatchObject({ closing: 60 });
    expect(await setMatrixCell(a, old, owner)).toMatchObject({
      replayed: true,
    });
    expect(await balance(id)).toMatchObject({ closing: 60 });
    await expect(
      setMatrixCell(a, { ...old, requestKey: randomUUID() }, owner)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      setMatrixCell(a, { ...old, quantity: 9 }, owner)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const beforeDelete = await matrixCellVersion(a, id, agent, date);
    await cell(id, 0, 40);
    await expect(
      setMatrixCell(
        a,
        {
          ...old,
          quantity: 40,
          expectedQuantity: 0,
          expectedVersion: beforeDelete,
          requestKey: randomUUID(),
        },
        owner
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await balance(id)).toMatchObject({ closing: 100 });
    const fresh = {
      ...old,
      quantity: 35,
      expectedQuantity: 0,
      expectedVersion: await matrixCellVersion(a, id, agent, date),
      requestKey: randomUUID(),
    };
    await Promise.all(
      Array.from({ length: 10 }, () => setMatrixCell(a, fresh, owner))
    );
    expect(
      (await a.select().from(agentTakingEntries)).filter(
        row => row.productId === id
      )
    ).toHaveLength(1);
    expect(await balance(id)).toMatchObject({ closing: 65 });
  });

  it("preserves backfilled agent taking history on agent deletion", async () => {
    const id = await product();
    const [oldAgent] = await a
      .insert(agents)
      .values({ name: "Existing history" })
      .$returningId();
    const [taking] = await a
      .insert(agentTakingEntries)
      .values({
        productId: id,
        agentId: oldAgent.id,
        entryDate: new Date(date),
        productName: "Existing",
        quantity: "40",
        unitPrice: 1000,
        amount: 40000,
        createdBy: owner,
      })
      .$returningId();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    const caller = agentsRouter.createCaller({
      user: { id: owner, role: "admin" },
      req: { headers: {} },
      res: {},
    } as TrpcContext);
    await expect(caller.delete({ id: oldAgent.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      await a
        .select()
        .from(agentTakingEntries)
        .where(eq(agentTakingEntries.id, taking.id))
    ).toHaveLength(1);
    expect(await balance(id)).toMatchObject({ closing: 60 });
    const [unused] = await a
      .insert(agents)
      .values({ name: "Unused agent" })
      .$returningId();
    await expect(caller.delete({ id: unused.id })).resolves.toMatchObject({
      success: true,
    });
  });

  it("blocks factory and sale cascade deletion before the physical count", async () => {
    const id = await product();
    const [sale] = await a
      .insert(transactions)
      .values({
        sourceKey: randomUUID(),
        productId: id,
        transactionDate: new Date(yesterday),
        productName: "Existing sale",
        unit: "blok",
        quantity: "5",
        totalAmount: 5000,
        agentId: agent,
      })
      .$returningId();
    const [saleStock] = await a
      .insert(stockMovements)
      .values({
        productId: id,
        movementDate: new Date(yesterday),
        movementType: "out",
        quantity: "5",
        transactionId: sale.id,
        isAutomatic: true,
      })
      .$returningId();
    const [factoryStock] = await a
      .insert(stockMovements)
      .values({
        productId: id,
        movementDate: new Date(yesterday),
        movementType: "in",
        quantity: "80",
        isAutomatic: true,
      })
      .$returningId();
    const [factory] = await a
      .insert(factoryOperations)
      .values({
        productId: id,
        operationDate: new Date(yesterday),
        operationType: "filled_received",
        quantity: 80,
        stockMovementId: factoryStock.id,
        createdBy: owner,
      })
      .$returningId();
    await activateMatrixStock(
      a,
      { productId: id, date, openingQuantity: 100 },
      owner
    );
    const context = {
      user: { id: owner, role: "admin" },
      req: { headers: {} },
      res: {},
    } as TrpcContext;
    await expect(
      factoryRouter.createCaller(context).delete({ id: factory.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      transactionsRouter.createCaller(context).delete({ id: sale.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await a.select().from(transactions).where(eq(transactions.id, sale.id))
    ).toHaveLength(1);
    expect(
      await a
        .select()
        .from(factoryOperations)
        .where(eq(factoryOperations.id, factory.id))
    ).toHaveLength(1);
    expect(
      await a
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.id, saleStock.id))
    ).toHaveLength(1);
    expect(await balance(id, tomorrow)).toMatchObject({
      opening: 100,
      closing: 100,
    });
  });
});
