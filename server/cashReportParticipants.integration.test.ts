import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { agents, cashEntries, employees, users } from "../drizzle/schema";
import { createTenantDatabase } from "./tenancy/queryScope";
import type { TrpcContext } from "./_core/context";

let root: Connection | undefined, pool: Pool | undefined;
let db: ReturnType<typeof createTenantDatabase>;
let ownerId: number, agentId: number, employeeId: number, inactiveId: number, emptyId: number, foreignId: number;
const schema = `bc_cash_people_${randomBytes(5).toString("hex")}`;
const url = process.env.TENANT_ISOLATION_TEST_URL;
const stamp = (date: string) => Date.parse(`${date}+05:00`);
const period = { from: stamp("2026-11-01T00:00:00"), to: stamp("2026-11-13T23:59:59.999") };
vi.mock("./db", () => ({ requireDb: async () => db }));
import { cashRouter } from "./routers/cash";
import { kassaRouter } from "./routers/kassa";
const context = (role = "admin") => ({ user: { id: ownerId, role }, req: { headers: {} }, res: {} }) as TrpcContext;
const api = () => cashRouter.createCaller(context());

describe.skipIf(!url)("cash report agent/employee filter on disposable SQL", () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.port !== "43317") throw Error("Disposable localhost TEST SQL only");
    root = await mysql.createConnection(url!);
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    target.pathname = `/${schema}`;
    const ddl = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "./drizzle/schema.ts"], { encoding: "utf8", maxBuffer: 8e6 });
    const setup = await mysql.createConnection({ uri: target.href, multipleStatements: true });
    try { await setup.query(ddl.slice(ddl.indexOf("CREATE TABLE")).replace(/`(voidedAt|cashCountedAt)` timestamp/g, "`$1` timestamp NULL DEFAULT NULL")); }
    finally { await setup.end(); }
    pool = mysql.createPool({ uri: target.href, timezone: "+05:00", connectionLimit: 4 });
    pool.on("connection", connection => { connection.query("SET time_zone='+05:00'"); });
    db = createTenantDatabase(pool, "legacy");
    [ownerId] = (await db.insert(users).values({ name: "Local tester", email: "cash-people@local.test", passwordHash: "test-only", role: "admin" }).$returningId()).map(r => r.id);
    [agentId] = (await db.insert(agents).values({ name: "Same name", isActive: false }).$returningId()).map(r => r.id);
    [employeeId] = (await db.insert(employees).values({ name: "Same name" }).$returningId()).map(r => r.id);
    [inactiveId] = (await db.insert(employees).values({ name: "Former employee", isActive: false }).$returningId()).map(r => r.id);
    [emptyId] = (await db.insert(employees).values({ name: "No movements" }).$returningId()).map(r => r.id);
    const other = createTenantDatabase(pool, "other-firm");
    [foreignId] = (await other.insert(employees).values({ name: "Foreign employee" }).$returningId()).map(r => r.id);
    let serial = 0;
    const row = (date: string, category: string, cashAmount: number, extra = {}) => ({
      sourceKey: `local-test:${++serial}`, employeeId, entryDate: new Date(stamp(date)),
      type: "expense" as const, category, cashAmount, ...extra,
    });
    await db.insert(cashEntries).values([
      row("2026-10-31T23:59:59", "Ойлик", 600_000),
      row("2026-11-01T00:00:00", "Ойлик", 100_000),
      row("2026-11-07T23:59:59", "Ойлик", 150_000),
      row("2026-11-13T23:59:59", "Ойлик", 250_000),
      row("2026-11-14T00:00:00", "Ойлик", 900_000),
      ...Array.from({ length: 60 }, () => row("2026-11-08T12:00:00", "Газ", 1_000)),
      row("2026-11-09T12:00:00", "Приход пет", 20_000, { type: "income" }),
      row("2026-11-10T12:00:00", "Расход", 500, { terminalAmount: 700 }),
      row("2026-11-05T12:00:00", "Ойлик", 80_000, { employeeId: inactiveId }),
      row("2026-11-04T12:00:00", "Ойлик", 65_000, { employeeId: null, agentId }),
    ]);
    await other.insert(cashEntries).values(row("2026-11-05T12:00:00", "Ойлик", 9_000_000, { employeeId: foreignId }));
  }, 60000);

  afterAll(async () => {
    await pool?.end();
    if (root) { await root.query(`DROP DATABASE IF EXISTS \`${schema}\``); await root.end(); }
  });

  it("lists inactive people and separates equal agent/employee IDs and names", async () => {
    expect(agentId).toBe(employeeId);
    const options = await api().participantOptions();
    expect(options.agents).toContainEqual({ id: agentId, name: "Same name", isActive: false });
    expect(options.employees.map(r => r.id)).toEqual(expect.arrayContaining([employeeId, inactiveId, emptyId]));
    expect(options.employees.some(r => r.id === foreignId)).toBe(false);
  });

  it("totals partial salaries across the exact inclusive period without other people or outside dates", async () => {
    expect(await api().reportSummary({ ...period, employeeId })).toEqual({ income: 20_700, expense: 560_500, net: -539_800, salaryPaid: 500_000, salaryPaymentCount: 3 });
    expect((await api().reportSummary({ ...period, agentId })).salaryPaid).toBe(65_000);
    expect((await api().reportSummary({ ...period, employeeId: inactiveId })).salaryPaid).toBe(80_000);
    expect((await api().reportSummary({ ...period, employeeId: emptyId })).salaryPaid).toBe(0);
    expect((await api().reportSummary({ ...period, employeeId: foreignId })).salaryPaid).toBe(0);
  });

  it("keeps all pages, employee names, electronic splits and export sums aligned", async () => {
    const input = { ...period, employeeId, type: "all" as const };
    const first = await api().list({ ...input, page: 1, pageSize: 50 });
    const second = await api().list({ ...input, page: 2, pageSize: 50 });
    const exported = await api().exportData(input);
    expect(first.total).toBe(66);
    expect(first.totals).toEqual({ cashIncome: 20_000, cashExpense: 560_500, terminal: 700, click: 0, transfer: 0 });
    expect(second.totals).toEqual(first.totals);
    expect([...first.items, ...second.items].map(r => r.reportKey)).toEqual(exported.rows.map(r => r.reportKey));
    expect(exported.summary).toEqual({ income: 20_700, expense: 560_500 });
    expect(exported.rows.every(r => r.employeeId === employeeId && r.employeeName === "Same name" && !r.agentName)).toBe(true);
  });

  it("combines person/category/type filters and uses the same scope for expense categories", async () => {
    const input = { ...period, employeeId, type: "expense" as const, category: "Ойлик" };
    const list = await api().list(input);
    const exported = await api().exportData(input);
    expect(list.total).toBe(3);
    expect(list.totals.cashExpense).toBe(500_000);
    expect(exported.rows.map(r => r.reportKey)).toEqual(list.items.map(r => r.reportKey));
    const breakdown = await kassaRouter.createCaller(context()).report.expenseByCategory({ ...period, employeeId });
    expect(breakdown.total).toBe(560_500);
    expect(breakdown.rows.find(r => r.category === "Ойлик")?.total).toBe(500_000);
    expect((await api().list({ ...period, employeeId, type: "income" })).totals.cashExpense).toBe(0);
    expect((await api().reportSummary({ ...period, employeeId })).salaryPaid).toBe(500_000);
  });

  it("rejects ambiguous agent-and-employee requests and denies non-accounting roles", async () => {
    const both = { ...period, agentId, employeeId };
    await expect(api().list(both)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(api().exportData(both)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(api().reportSummary(both)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(kassaRouter.createCaller(context()).report.expenseByCategory(both)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(cashRouter.createCaller(context("agent")).participantOptions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reads reports without changing cash history or next-day opening balances", async () => {
    const before = await db.select().from(cashEntries);
    const date = stamp("2026-11-14T00:00:00");
    const opening = await api().openingBalance({ date });
    await api().reportSummary({ ...period, employeeId });
    await api().list({ ...period, employeeId });
    await api().exportData({ ...period, employeeId });
    await kassaRouter.createCaller(context()).report.expenseByCategory({ ...period, employeeId });
    expect(await db.select().from(cashEntries)).toEqual(before);
    expect(await api().openingBalance({ date })).toEqual(opening);
  });
});
