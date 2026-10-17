import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agentTakingEntries, agents, cashEntries, products, stockMovements, users } from "../drizzle/schema";
import { ensureMatrixInventorySchema, MATRIX_INVENTORY_DDL } from "./matrixInventorySchema";
import { matrixStockDay } from "./matrixInventory";

let connection: mysql.Connection;
let db: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ requireDb: async () => db }));
const names = ["matrix_stock_configs", "matrix_stock_events", "matrix_cell_writes"];
const url = process.env.TENANT_ISOLATION_TEST_URL;

it("uses additive inventory DDL only, without data backfill or old-table ALTER", () => {
  expect(MATRIX_INVENTORY_DDL).toHaveLength(3);
  for (const statement of MATRIX_INVENTORY_DDL) {
    expect(statement).toMatch(/^CREATE TABLE IF NOT EXISTS `matrix_/);
    expect(statement).not.toMatch(/\b(?:INSERT INTO|UPDATE\s+`|DELETE FROM|ALTER TABLE|DROP TABLE|TRUNCATE)\b/i);
  }
});

describe.skipIf(!url)("existing company preservation during additive schema upgrade", () => {
  afterAll(async () => connection?.end());
  it("preserves every old row and table definition across two bootstraps, and never activates stock", async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "43317") throw new Error("Disposable SQL only");
    const root = await mysql.createConnection(url!);
    const schema = `bc_inventory_upgrade_${randomBytes(6).toString("hex")}`;
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    await root.end();
    parsed.pathname = `/${schema}`;
    connection = await mysql.createConnection({ uri: parsed.toString(), multipleStatements: true, dateStrings: true });
    db = drizzle(connection);
    const exported = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "drizzle/schema.ts"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const legacy = exported.slice(exported.indexOf("CREATE TABLE")).split(";").filter(statement => !names.some(name => statement.includes(`\`${name}\``)));
    await connection.query(legacy.join(";"));
    const [owner] = await db.insert(users).values({ name: "Existing owner", email: "existing@test.local", passwordHash: "fixture", role: "admin" }).$returningId();
    const [agent] = await db.insert(agents).values({ name: "Existing agent" }).$returningId();
    const [product] = await db.insert(products).values({ name: "Existing product", code: "legacy", unit: "blok", price: 1000 }).$returningId();
    const date = new Date("2026-09-01T07:00:00Z");
    await db.insert(cashEntries).values({ sourceKey: "old-income", entryDate: date, type: "income", category: "Приход пет", cashAmount: 1732000, agentId: agent.id, createdBy: owner.id });
    await db.insert(agentTakingEntries).values({ entryDate: date, agentId: agent.id, productId: product.id, productName: "Existing product", quantity: "40", unitPrice: 1000, amount: 40000, createdBy: owner.id });
    await db.insert(stockMovements).values({ productId: product.id, movementDate: date, movementType: "in", quantity: "100", createdBy: owner.id });
    const [tables] = await connection.query("SHOW TABLES");
    const legacyNames = (tables as Record<string, string>[]).map(row => Object.values(row)[0]).sort();
    async function fingerprint() {
      const data = [];
      for (const table of legacyNames) {
        const [ddl] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
        const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
        data.push({ table, ddl, rows });
      }
      return createHash("sha256").update(JSON.stringify(data)).digest("hex");
    }
    const before = await fingerprint();
    const priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = parsed.toString();
    try { await ensureMatrixInventorySchema(); await ensureMatrixInventorySchema(); }
    finally { if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorDatabaseUrl; }
    expect(await fingerprint()).toBe(before);
    for (const table of names) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      expect((rows as { n: number }[])[0].n).toBe(0);
    }
    expect(await matrixStockDay(db, +date)).toEqual([]);
  }, 30000);
});
