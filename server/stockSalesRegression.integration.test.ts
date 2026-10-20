import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTenantQueryScope } from "./tenancy/scopeSchema";
import type { TrpcContext } from "./_core/context";

const testUrl = process.env.TENANT_ISOLATION_TEST_URL;
const name = `bc_stock_regression_${randomBytes(6).toString("hex")}`;
let root: Connection;
let blocker: Connection;
let closeDb: () => Promise<void>;
let keg: ReturnType<typeof import("./routers/fastKeg").fastKegRouter.createCaller>;
let sales: ReturnType<typeof import("./routers/transactions").transactionsRouter.createCaller>;
let debts: ReturnType<typeof import("./routers/debts").debtsRouter.createCaller>;
let stock: ReturnType<typeof import("./routers/stock").stockRouter.createCaller>;
let factory: ReturnType<typeof import("./routers/factory").factoryRouter.createCaller>;
let kassa: ReturnType<typeof import("./routers/kassa").kassaRouter.createCaller>;
let matrix: ReturnType<typeof import("./routers/matrixInventory").matrixInventoryRouter.createCaller>;
const date = Date.parse("2026-10-20T12:00:00+05:00");

async function waitForLockWaiters(count: number) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const [rows] = await root.query("SHOW FULL PROCESSLIST");
    const queries = (rows as Array<{ db: string; Info: string | null }>)
      .filter(row => row.db === name && /for update$/i.test(row.Info ?? ""));
    if (queries.length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Concurrent callers did not reach the lock barrier");
}

describe.skipIf(!testUrl)("stock and sales real SQL regression", { timeout: 15000 }, () => {
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (url.hostname !== "127.0.0.1" || url.port !== "43317") throw new Error("Disposable TEST server only");
    root = await mysql.createConnection({ uri: testUrl!, multipleStatements: true, timezone: "+05:00" });
    await root.query("SET time_zone='+05:00'");
    await root.query(`CREATE DATABASE \`${name}\``);
    await root.query(`USE \`${name}\``);
    const exported = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "./drizzle/schema.ts"], { encoding: "utf8", maxBuffer: 8e6 });
    await root.query(exported.slice(exported.indexOf("CREATE TABLE")));
    await applyTenantQueryScope(root, "legacy");
    await root.query("INSERT INTO users(id,name,email,passwordHash,role) VALUES(1,'TEST','test@local','test-only','admin'); INSERT INTO agents(id,name) VALUES(1,'TEST'); INSERT INTO clients(id,code,name,agentId,openingDebt,clientType) VALUES(1,'TEST','TEST',1,1000,'keg'); INSERT INTO products(id,code,name,unit,price,containerType,containerUnitsPerItem) VALUES(1,'K30','KEG30','dona',500,'keg_30',1),(2,'NORMAL','Normal','blok',500,NULL,0); INSERT INTO stockMovements(productId,movementType,quantity,unitCost,reason,movementDate) VALUES(1,'in',100,300,'test','2026-10-19 12:00:00'),(2,'in',100,100,'test','2026-10-19 12:00:00')");
    url.pathname = `/${name}`;
    vi.stubEnv("DATABASE_URL", url.toString()); vi.stubEnv("TENANCY_MODE", "legacy"); vi.stubEnv("TENANT_ID", "");
    vi.resetModules();
    closeDb = (await import("./db")).closeDb;
    const ctx = { user: { id: 1, role: "admin" }, req: { headers: {} }, res: {} } as TrpcContext;
    keg = (await import("./routers/fastKeg")).fastKegRouter.createCaller(ctx);
    sales = (await import("./routers/transactions")).transactionsRouter.createCaller(ctx);
    debts = (await import("./routers/debts")).debtsRouter.createCaller(ctx);
    stock = (await import("./routers/stock")).stockRouter.createCaller(ctx);
    factory = (await import("./routers/factory")).factoryRouter.createCaller(ctx);
    kassa = (await import("./routers/kassa")).kassaRouter.createCaller(ctx);
    matrix = (await import("./routers/matrixInventory")).matrixInventoryRouter.createCaller(ctx);
    await keg.setup();
    blocker = await mysql.createConnection(url.toString());
  }, 120_000);
  afterAll(async () => {
    if (blocker) { await blocker.rollback(); await blocker.end(); }
    if (closeDb) await closeDb();
    if (root) { await root.query(`DROP DATABASE IF EXISTS \`${name}\``); await root.end(); }
    vi.unstubAllEnvs();
  });

  it("serializes concurrent payments using the refreshed debt balance", async () => {
    await blocker.beginTransaction(); await blocker.query("SELECT id FROM clients WHERE id=1 FOR UPDATE");
    const base = { transactionDate: date, agentId: 1, rows: [{ clientId: 1, cash: 700 }] };
    const resultsPromise = Promise.allSettled([
      keg.saveBatch({ ...base, idempotencyKey: "concurrent-payment-one" }),
      keg.saveBatch({ ...base, idempotencyKey: "concurrent-payment-two" }),
    ]);
    try { await waitForLockWaiters(2); } finally { await blocker.commit(); }
    const results = await resultsPromise;
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
    const [rows] = await root.query("SELECT 1000-SUM(cashPayment) balance FROM transactions");
    expect(Number((rows as any)[0].balance)).toBe(300);
  });

  it("concurrent retry with one key records the payment once", async () => {
    await blocker.beginTransaction(); await blocker.query("SELECT id FROM clients WHERE id=1 FOR UPDATE");
    const input = { transactionDate: date, agentId: 1, rows: [{ clientId: 1, cash: 100 }], idempotencyKey: "same-key-payment-test" };
    const resultPromise = Promise.all([keg.saveBatch(input), keg.saveBatch(input)]);
    try { await waitForLockWaiters(2); } finally { await blocker.commit(); }
    const results = await resultPromise;
    expect(results.filter(row => row.duplicate)).toHaveLength(1);
    const [rows] = await root.query("SELECT COUNT(*) n FROM transactions WHERE sourceKey LIKE 'fast-keg:same-key-payment-test:%'");
    expect(Number((rows as any)[0].n)).toBe(1);
  });

  it("FastKEG sees a standalone debt payment committed while waiting for its client lock", async () => {
    await root.query("INSERT INTO clients(id,code,name,agentId,openingDebt,clientType) VALUES(2,'MIXED','Mixed payment',1,1000,'keg')");
    await blocker.beginTransaction(); await blocker.query("SELECT id FROM clients WHERE id=2 FOR UPDATE");
    const payment = debts.payments.create({ requestId: "dbdc29df-2eca-4562-bf35-7a99bdd1996c", clientId: 2, paymentDate: date, cashAmount: 700 });
    await waitForLockWaiters(1);
    const kegPayment = keg.saveBatch({ transactionDate: date, agentId: 1, rows: [{ clientId: 2, cash: 700 }], idempotencyKey: "mixed-debt-keg-payment" });
    const outcomes = Promise.allSettled([payment, kegPayment]);
    try { await waitForLockWaiters(2); } finally { await blocker.commit(); }
    const result = await outcomes;
    expect(result[0].status).toBe("fulfilled");
    expect(result[1].status).toBe("rejected");
  });

  it("snapshots KEG cost and excludes payment-only records from missing-cost sales", async () => {
    await keg.saveBatch({ transactionDate: date, agentId: 1, rows: [{ clientId: 1, keg30: 2 }], idempotencyKey: "keg-cost-regression" });
    const [rows] = await root.query("SELECT unitCost FROM transactions WHERE quantity=2");
    expect((rows as any)[0].unitCost).toBe(300);
    const summary = await sales.profitSummary({});
    expect(summary).toMatchObject({ revenue: 1000, cost: 600, grossProfit: 400, linesWithoutCost: 0 });
  });

  it("rejects sub-ledger-precision quantities before money or stock is written", async () => {
    const base = { transactionDate: date, agentId: 1, clientId: 1, productId: 2, quantity: .0004, salePrice: 1_000_000 };
    await expect(sales.create(base)).rejects.toThrow("3 tagacha");
    await expect(sales.createMultiple({ ...base, items: [{ productId: 2, quantity: .0004, salePrice: 1_000_000 }] })).rejects.toThrow("3 tagacha");
    await expect(stock.stockIn({ productId: 2, movementDate: date, quantity: .0004 })).rejects.toThrow("3 tagacha");
  });

  it("retains historical cost on a note edit and excludes future receipts on backdated sales", async () => {
    const base = { transactionDate: date, agentId: 1, clientId: 1, productId: 2, quantity: 2, salePrice: 500, cashPayment: 0, terminalPayment: 0, clickPayment: 0, transferPayment: 0 };
    await sales.create(base);
    const [rows] = await root.query("SELECT id,unitCost FROM transactions WHERE productId=2");
    const row = (rows as any)[0]; expect(row.unitCost).toBe(100);
    await root.query("INSERT INTO stockMovements(productId,movementType,quantity,unitCost,reason,movementDate) VALUES(2,'in',100,300,'later cost','2026-10-21 12:00:00')");
    await sales.update({ ...base, id: row.id, note: "Note only" });
    await sales.create(base);
    const [updated] = await root.query("SELECT unitCost FROM transactions WHERE productId=2");
    expect((updated as any[]).map(row => row.unitCost)).toEqual([100, 100]);
  });

  it("commits daily price and matrix money consistently with concurrent quantity entry", async () => {
    await blocker.beginTransaction(); await blocker.query("SELECT id FROM products WHERE id=2 FOR UPDATE");
    const pending = Promise.all([
      kassa.dayPrice.upsert({ date, productId: 2, unitPrice: 700 }),
      matrix.setCell({ date, productId: 2, agentId: 1, quantity: 3, expectedQuantity: 0, expectedVersion: 0, requestKey: "83f957a8-8b9b-4a5c-9b62-7628cef87d1d" }),
    ]);
    try { await waitForLockWaiters(2); } finally { await blocker.commit(); }
    await pending;
    const [rows] = await root.query("SELECT unitPrice,amount FROM agent_taking_entries WHERE productId=2");
    expect((rows as any)[0]).toMatchObject({ unitPrice: 700, amount: 2100 });
  });

  it("blocks stock/factory/bottle creation and deletion in a locked period", async () => {
    await factory.bottles.create({ movementType: "purchase", movementDate: date, quantity: 10, unitPrice: 100 });
    await factory.record({ operationType: "filled_received", operationDate: date, productId: 1, quantity: 1 });
    await root.query("INSERT INTO app_settings (`key`,value) VALUES('periodLockDate','2026-10-20')");
    const [bottles] = await root.query("SELECT id FROM bottle_movements");
    const [operations] = await root.query("SELECT id FROM factory_operations");
    const [movements] = await root.query("SELECT id FROM stockMovements WHERE isAutomatic=0 LIMIT 1");
    await expect(stock.stockIn({ productId: 2, movementDate: date, quantity: 1 })).rejects.toThrow("yopilgan davr");
    await expect(stock.stockInBatch({ movementDate: date, items: [{ productId: 2, quantity: 1 }] })).rejects.toThrow("yopilgan davr");
    await expect(stock.stockOut({ productId: 2, movementDate: date, quantity: 1, reason: "test" })).rejects.toThrow("yopilgan davr");
    await expect(stock.deleteMovement({ id: (movements as any)[0].id })).rejects.toThrow("yopilgan davr");
    await expect(factory.record({ operationType: "tara_sent", operationDate: date, productId: 1, quantity: 1 })).rejects.toThrow("yopilgan davr");
    await expect(factory.delete({ id: (operations as any)[0].id })).rejects.toThrow("yopilgan davr");
    await expect(factory.bottles.create({ movementType: "payment", movementDate: date, amount: 10 })).rejects.toThrow("yopilgan davr");
    await expect(factory.bottles.delete({ id: (bottles as any)[0].id })).rejects.toThrow("yopilgan davr");
  });
});
