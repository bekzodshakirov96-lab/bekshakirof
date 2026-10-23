import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { snapshotBusinessData } from "./audit";
import { bindTenantDatabase } from "./bind";
import { assertTenantDatabase } from "./database";
import { applyTenantQueryScope } from "./scopeSchema";
import type { RuntimeTenant } from "./config";
import { drizzle } from "drizzle-orm/mysql2";
import { cashEntries } from "../../drizzle/schema";
import { cashExpenseSql, physicalCashBalanceSql, realizedIncomeSql } from "../cashAccounting";

// Explicitly opt in with a DISPOSABLE local MySQL/MariaDB server. No .env loading.
const testUrl = process.env.TENANT_ISOLATION_TEST_URL;
const connections: Connection[] = [];
const closePools: (() => Promise<void>)[] = [];
const suffix = randomBytes(6).toString("hex");
let root: Connection;
let original: Connection;
let other: Connection;
let originalUrl: string;
let otherUrl: string;
let originalSchema: string;
let otherSchema: string;
const date = Date.parse("2026-10-16T12:00:00+05:00");
const isolated = (id: string): RuntimeTenant => ({ mode: "isolated", id, hosts: [`${id}.example.uz`] });

async function runtime(id: string | undefined, uri: string) {
  vi.resetModules();
  vi.stubEnv("TENANCY_MODE", id ? "isolated" : "legacy");
  vi.stubEnv("TENANT_ID", id ?? "");
  vi.stubEnv("TENANT_HOSTS", id ? `${id}.example.uz` : "");
  vi.stubEnv("DATABASE_URL", uri);
  const db = await import("../db");
  closePools.push(db.closeDb);
  const { kassaRouter } = await import("../routers/kassa");
  const user = (await db.getUserById(1))!;
  const caller = kassaRouter.createCaller({ user, req: { headers: {} } as never, res: {} as never });
  return { db, caller, auth: await import("../_core/localAuth") };
}

describe.skipIf(!testUrl)("real isolated company databases", () => {
  beforeAll(async () => {
    const target = new URL(testUrl!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.port || target.port === "3306") {
      throw new Error("Use an explicitly disposable loopback test server on a non-default port.");
    }
    root = await mysql.createConnection({ uri: testUrl!, multipleStatements: true });
    connections.push(root);
    const exported = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "./drizzle/schema.ts"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const sqlStart = exported.indexOf("CREATE TABLE");
    if (sqlStart < 0) throw new Error("Schema export did not contain SQL.");
    const schemaSql = exported.slice(sqlStart);
    for (const [index, label] of ["original", "other"].entries()) {
      const schema = `bc_test_${suffix}_${label}`;
      const username = `bc_${suffix}_${index}`;
      const password = randomBytes(18).toString("hex");
      await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
      await root.query(`CREATE USER '${username}'@'%' IDENTIFIED BY ?`, [password]);
      await root.query(`GRANT ALL ON \`${schema}\`.* TO '${username}'@'%'`);
      const uri = new URL(testUrl!);
      uri.username = username; uri.password = password; uri.pathname = `/${schema}`;
      const db = await mysql.createConnection({ uri: uri.toString(), multipleStatements: true, dateStrings: true, timezone: "+05:00", supportBigNumbers: true, bigNumberStrings: true });
      connections.push(db);
      await db.query("SET time_zone = '+05:00'");
      // Reconstruct the previous schema for the original firm, so the migration
      // proof includes genuinely adding missing columns/keys to historical rows.
      const oldSchema = schemaSql.replace(/^\s*`tenant_id` varchar\(63\) NOT NULL DEFAULT 'legacy',\r?\n/gm, "").replaceAll("`tenant_id`,", "");
      await db.query(index === 0 ? oldSchema : schemaSql);
      await db.query("INSERT INTO users (id, name, email, passwordHash, role) VALUES (1, ?, 'owner@example.uz', 'test-only', 'admin')", [label]);
      await db.query("INSERT INTO agents (id, name) VALUES (1, 'Agent')");
      await db.query("INSERT INTO clients (id, code, name, agentId, openingDebt) VALUES (1, 'C1', ?, 1, 300000)", [`${label} client`]);
      await db.query("INSERT INTO products (id, code, name, unit, price) VALUES (1, 'P1', ?, 'dona', 100000)", [`${label} product`]);
      await db.query("INSERT INTO transactions (sourceKey, transactionDate, agentId, clientId, productId, productName, unit, quantity, totalAmount, cashPayment, createdBy) VALUES ('sale-1', '2026-10-16 12:00:00', 1, 1, 1, ?, 'dona', '2', 200000, 100000, 1)", [`${label} product`]);
      await db.query("INSERT INTO cash_entries (sourceKey, entryDate, type, category, cashAmount, terminalAmount, agentId, createdBy) VALUES ('income-1', '2026-10-16 12:00:00', 'income', 'Приход кег', ?, 50000, 1, 1), ('expense-1', '2026-10-16 12:00:00', 'expense', 'Расход', 20000, 0, 1, 1)", [index ? 700000 : 100000]);
      await db.query("INSERT INTO cash_journal_debts (entryDate, agentId, amount, borrowerName, description, createdBy) VALUES ('2026-10-16 12:00:00', 1, 25000, 'Ali', 'Eski qarz qaydi', 1)");
      await db.query("INSERT INTO container_movements (sourceKey, movementDate, transactionId, clientId, containerType, movementType, quantity) VALUES ('tara-1', '2026-10-16 12:00:00', 1, 1, 'keg_30', 'issued', 3), ('tara-2', '2026-10-16 12:00:00', 1, 1, 'keg_30', 'returned', 1)");
      if (index === 0) { original = db; originalUrl = uri.toString(); originalSchema = schema; }
      else { other = db; otherUrl = uri.toString(); otherSchema = schema; }
    }
  }, 30_000);

  afterEach(async () => {
    for (const close of closePools.splice(0)) await close();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    // Test schemas are kept in the disposable server, never dropped against a shared server.
    for (const db of connections) await db.end();
  });

  it("preserves every business row and actual daily cash report when converting the original company", async () => {
    const before = await snapshotBusinessData(original);
    expect(before.tables).toHaveLength(28);
    const [oldColumns] = await original.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='tenant_id'");
    expect(oldColumns).toHaveLength(0);
    const [cashBeforeScope] = await drizzle(original).select({ jamiPrihod: realizedIncomeSql(), jamiRasxod: cashExpenseSql(), kassaQoldigi: physicalCashBalanceSql() }).from(cashEntries);
    await applyTenantQueryScope(original, "legacy");
    const legacyRuntime = await runtime(undefined, originalUrl);
    const cashBefore = await legacyRuntime.caller.daySummary({ date });
    expect(cashBefore).toMatchObject(cashBeforeScope);
    expect((await legacyRuntime.caller.daySummary({ date: date + 86_400_000 })).kassaQoldigi).toBe(cashBeforeScope.kassaQoldigi);
    await expect(bindTenantDatabase(original, "not-original", before)).rejects.toThrow("Rebinding is forbidden");
    const [unexpectedBinding] = await original.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='saas_tenant_identity'");
    expect(unexpectedBinding).toHaveLength(0);
    const { transactionsRouter } = await import("../routers/transactions");
    const transactionApi = transactionsRouter.createCaller({ user: (await legacyRuntime.db.getUserById(1))!, req: { headers: {} } as never, res: {} as never });
    const transactionList = await transactionApi.list({ pageSize: 10 });
    expect(transactionList.items[0]).toMatchObject({ issuedContainerType: "keg_30", issuedContainerQuantity: 3, returnedContainerQuantity: 1 });
    const transactionExport = await transactionApi.exportData({});
    expect(transactionExport.rows[0]).toMatchObject({ issuedContainerQuantity: 3, returnedContainerQuantity: 1 });
    const result = await bindTenantDatabase(original, "legacy", before);
    expect(result).toEqual(before);
    const converted = await runtime("legacy", originalUrl);
    expect(await converted.caller.daySummary({ date })).toEqual(cashBefore);
    await expect(bindTenantDatabase(original, "legacy", before)).resolves.toEqual(before);
    await expect(assertTenantDatabase(original, isolated("legacy"))).resolves.toBeUndefined();
  });

  it("separates colliding record IDs, daily cash totals, database permissions and bearer sessions", async () => {
    const baseline = await snapshotBusinessData(other);
    await bindTenantDatabase(other, "company-b", baseline);
    const companyA = await runtime("legacy", originalUrl);
    const companyB = await runtime("company-b", otherUrl);
    const totalA = await companyA.caller.daySummary({ date });
    const totalB = await companyB.caller.daySummary({ date });
    expect(totalA).not.toEqual(totalB);
    expect((await companyA.db.getUserById(1))?.name).toBe("original");
    expect((await companyB.db.getUserById(1))?.name).toBe("other");
    await expect(original.query(`SELECT * FROM \`${otherSchema}\`.cash_entries`)).rejects.toMatchObject({ errno: 1142 });
    await expect(other.query(`SELECT * FROM \`${originalSchema}\`.clients`)).rejects.toMatchObject({ errno: 1142 });
    const tokenA = await companyA.auth.signSession(1);
    await expect(companyB.auth.authenticateRequest({ headers: { authorization: `Bearer ${tokenA}` } } as never)).resolves.toBeNull();
    const tokenB = await companyB.auth.signSession(1);
    await expect(companyB.auth.authenticateRequest({ headers: { authorization: `Bearer ${tokenB}` } } as never)).resolves.toMatchObject({ id: 1, name: "other" });
  });

  it("refuses missing/wrong bindings and changed baselines without altering any business data", async () => {
    const before = await snapshotBusinessData(original);
    await expect(bindTenantDatabase(original, "company-b", before)).rejects.toThrow("Rebinding is forbidden");
    await expect(bindTenantDatabase(original, "legacy", { ...before, fingerprint: "changed" })).rejects.toThrow("Business data changed");
    await expect(assertTenantDatabase(original, isolated("company-b"))).rejects.toThrow("does not belong");
    vi.resetModules();
    vi.stubEnv("TENANCY_MODE", "isolated"); vi.stubEnv("TENANT_ID", "company-b");
    vi.stubEnv("TENANT_HOSTS", "company-b.example.uz"); vi.stubEnv("DATABASE_URL", originalUrl);
    const invalidDb = await import("../db");
    closePools.push(invalidDb.closeDb);
    await expect(invalidDb.requireDb()).rejects.toThrow("does not belong");
    const failedStartup = spawnSync(process.execPath, ["--import", "tsx", "server/_core/index.ts"], {
      env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8", timeout: 10_000,
    });
    expect(failedStartup.status).toBe(1);
    expect(failedStartup.stdout).not.toContain("Server running");
    expect(await snapshotBusinessData(original)).toEqual(before);
  });

  it("enforces the company boundary on the real HTTP server, including spoofed routing headers", async () => {
    const companyA = await runtime("legacy", originalUrl);
    const companyB = await runtime("company-b", otherUrl);
    const tokenA = await companyA.auth.signSession(1);
    const tokenB = await companyB.auth.signSession(1);
    const socket = createServer();
    await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const child = spawn(process.execPath, ["--import", "tsx", "server/_core/index.ts"], {
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: originalUrl,
        TENANCY_MODE: "isolated", TENANT_ID: "legacy", TENANT_HOSTS: "legacy.example.uz", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("HTTP fixture startup timed out")), 10_000);
        child.stdout.on("data", chunk => { if (String(chunk).includes("Server running")) { clearTimeout(timeout); resolve(); } });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error("HTTP fixture exited before startup")); });
        child.once("error", error => { clearTimeout(timeout); reject(error); });
      });
      const rawRequest = (requestPath: string, headers: Record<string, string>) => new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest({ hostname: "127.0.0.1", port, path: requestPath, method: "GET", headers }, res => {
          let body = "";
          res.on("data", chunk => { body += String(chunk); });
          res.on("end", () => resolve({ status: res.statusCode!, body }));
        });
        req.on("error", reject);
        req.setTimeout(5000, () => req.destroy(new Error("HTTP fixture request timed out")));
        req.end();
      });
      const request = (api: string, token: string, host = "legacy.example.uz") => rawRequest(`/api/trpc/${api}`, {
        host, authorization: `Bearer ${token}`, "x-forwarded-host": "company-b.example.uz", "x-tenant-id": "company-b",
      });
      expect((await request("auth.me", tokenA, "company-b.example.uz")).status).toBe(421);
      const me = JSON.parse((await request("auth.me", tokenA)).body);
      expect(me).toMatchObject({ result: { data: { json: { name: "original" } } } });
      expect((await request("products.list", tokenB)).status).toBe(401);
      const products = JSON.parse((await request("products.list", tokenA)).body);
      expect(products.result.data.json[0].name).toBe("original product");
      const escaped = await rawRequest("/uploads/tenants/company-b/private.xlsx", { host: "legacy.example.uz", cookie: `app_session_id=${tokenA}` });
      expect(escaped.status).toBe(404);
    } finally {
      if (child.exitCode === null) {
        const ended = new Promise<void>(resolve => child.once("exit", () => resolve()));
        child.kill();
        await ended;
      }
    }
  }, 20_000);

  it("runs the explicit audit/bind CLI without changing historical data", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "bc-tenant-audit-"));
    const baselinePath = path.join(folder, "baseline.json");
    const options = { env: { ...process.env, DATABASE_URL: originalUrl }, encoding: "utf8" as const, timeout: 10_000 };
    const before = await snapshotBusinessData(original);
    const audit = execFileSync(process.execPath, ["--import", "tsx", "scripts/tenant-db.ts", "audit", "--out", baselinePath], options);
    expect(audit).toContain("28 tables");
    expect(JSON.parse(await readFile(baselinePath, "utf8"))).toEqual(before);
    const binding = execFileSync(process.execPath, ["--import", "tsx", "scripts/tenant-db.ts", "bind", "--tenant-id", "legacy", "--baseline", baselinePath, "--apply"], options);
    expect(binding).toContain("All business data matches baseline");
    expect(await snapshotBusinessData(original)).toEqual(before);
  });
});
