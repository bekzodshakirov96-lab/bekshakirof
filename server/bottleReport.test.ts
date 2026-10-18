import { randomBytes } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bottleMovements } from "../drizzle/schema";
import { bottleReportInput, readBottleReport } from "./bottleReport";
import { createTenantDatabase } from "./tenancy/queryScope";

describe("bottle report input", () => {
  it("accepts open-ended/all-time periods and rejects reversed or impossible dates", () => {
    expect(bottleReportInput.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(bottleReportInput.safeParse({ fromDate: "2026-10-01" }).success).toBe(true);
    expect(bottleReportInput.safeParse({ toDate: "2026-10-31" }).success).toBe(true);
    for (const input of [
      { fromDate: "2026-10-02", toDate: "2026-10-01" },
      { fromDate: "2026-02-30" }, { toDate: "2026-13-01" },
      { fromDate: "10/01/2026" }, { page: 0 }, { pageSize: 501 },
    ]) expect(bottleReportInput.safeParse(input).success).toBe(false);
  });
});

// Opt-in only. Each run creates its own schema on a disposable loopback server;
// never loads app .env files or reads/writes a real company's database.
const url = process.env.TENANT_ISOLATION_TEST_URL;
let root: Connection;
let connection: Connection;
let company: ReturnType<typeof createTenantDatabase>;
let other: typeof company;
let before: string;
const report = (input: Parameters<typeof bottleReportInput.parse>[0] = {}) =>
  readBottleReport(company, bottleReportInput.parse(input));

describe.skipIf(!url)("bottle report with real SQL and tenant isolation", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.port || parsed.port === "3306")
      throw new Error("Disposable loopback MySQL on an explicit non-default port is required.");
    root = await mysql.createConnection(url!);
    const suffix = randomBytes(6).toString("hex");
    const schema = `bc_bottle_${suffix}`;
    const user = `bb_${suffix}`;
    const password = randomBytes(20).toString("hex");
    await root.query(`CREATE DATABASE \`${schema}\``);
    await root.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
    await root.query(`GRANT ALL ON \`${schema}\`.* TO '${user}'@'%'`);
    parsed.username = user; parsed.password = password; parsed.pathname = `/${schema}`;
    connection = await mysql.createConnection({ uri: parsed.toString(), timezone: "Z" });
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`CREATE TABLE bottle_movements (
      id int AUTO_INCREMENT PRIMARY KEY, tenant_id varchar(63) NOT NULL,
      movementDate timestamp NOT NULL, movementType enum('purchase','sent','payment') NOT NULL,
      quantity int NOT NULL DEFAULT 0, unitPrice int NOT NULL DEFAULT 0,
      amount bigint NOT NULL DEFAULT 0, note varchar(1000), createdBy int,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX date_idx (tenant_id, movementDate)
    ) ENGINE=InnoDB`);
    company = createTenantDatabase(connection, "company-a");
    other = createTenantDatabase(connection, "company-b");
    await company.insert(bottleMovements).values([
      { movementDate: new Date("2026-09-30T23:59:59+05:00"), movementType: "sent", quantity: 1, amount: 1000 },
      { movementDate: new Date("2026-10-01T00:00:00+05:00"), movementType: "sent", quantity: 10, unitPrice: 1700, amount: 17000 },
      { movementDate: new Date("2026-10-01T00:00:00+05:00"), movementType: "purchase", quantity: 50, unitPrice: 900, amount: 45000 },
      { movementDate: new Date("2026-10-01T23:59:59+05:00"), movementType: "payment", amount: 5000 },
      { movementDate: new Date("2026-10-02T00:00:00+05:00"), movementType: "sent", quantity: 20, unitPrice: 1700, amount: 34000 },
      ...Array.from({ length: 105 }, () => ({ movementDate: new Date("2026-10-03T12:00:00+05:00"), movementType: "sent" as const, quantity: 1, amount: 1700 })),
    ]);
    await other.insert(bottleMovements).values({ movementDate: new Date("2026-10-01T12:00:00+05:00"), movementType: "sent", quantity: 999, amount: 999999999 });
    before = JSON.stringify((await connection.query("SELECT * FROM bottle_movements ORDER BY id"))[0]);
  });
  afterAll(async () => {
    if (connection) {
      const after = JSON.stringify((await connection.query("SELECT * FROM bottle_movements ORDER BY id"))[0]);
      await connection.end();
      expect(after).toBe(before);
    }
    await root?.end();
  });
  it("includes both Tashkent date boundaries and separates sales, purchases and receipts", async () => {
    const result = await report({ fromDate: "2026-10-01", toDate: "2026-10-01" });
    expect(result).toMatchObject({ total: 3, sentQuantity: 10, sentAmount: 17000, paidAmount: 5000 });
    expect(result.items.map(row => row.movementType)).toEqual(["payment", "purchase", "sent"]);
    expect(result.items.map(row => row.balanceAfter)).toEqual([13000, 18000, 18000]);
  });
  it("totals all 110 rows even past 100, and paginates without losing/duplicating history", async () => {
    const all = await report();
    expect(all).toMatchObject({ total: 110, sentQuantity: 136, sentAmount: 230500, paidAmount: 5000, pageCount: 6 });
    expect(all.items).toHaveLength(20);
    expect(all.items[0].balanceAfter).toBe(225500);
    const ids = new Set<number>();
    let lastBalance = Infinity;
    for (let page = 1; page <= all.pageCount; page++) {
      const result = await report({ page });
      expect(result.sentAmount).toBe(all.sentAmount);
      for (const row of result.items) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
        // Purchases do not change debt; only the single payment decreases it.
        if (row.movementType !== "purchase" && row.movementType !== "sent") continue;
        expect(row.balanceAfter).toBeLessThanOrEqual(lastBalance);
        lastBalance = row.balanceAfter;
      }
    }
    expect(ids.size).toBe(110);
    expect((await report({ page: 999 })).page).toBe(6);
  });
  it("supports one-sided and empty periods without leaking another company's amounts", async () => {
    expect(await report({ toDate: "2026-09-30" })).toMatchObject({ total: 1, sentQuantity: 1, sentAmount: 1000 });
    expect(await report({ fromDate: "2026-10-02" })).toMatchObject({ total: 106, sentQuantity: 125, sentAmount: 212500, paidAmount: 0 });
    expect(await report({ fromDate: "2026-11-01" })).toMatchObject({ total: 0, items: [], sentQuantity: 0, sentAmount: 0, paidAmount: 0, page: 1 });
    expect(await readBottleReport(other, bottleReportInput.parse({}))).toMatchObject({ total: 1, sentQuantity: 999, sentAmount: 999999999, paidAmount: 0 });
  });
});
