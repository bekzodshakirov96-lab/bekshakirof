import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTenantDatabase } from "./tenancy/queryScope";
import { users, agents, clients, clientPayments, cashEntries, agentCommissionPayments, cashJournalDebts, cashJournalDebtRepayments, kassaDailyActuals, auditLog } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
let root: Connection | undefined, pool: Pool | undefined;
let db: ReturnType<typeof createTenantDatabase>;
let userId: number;
const schema = `bc_account_audit_${randomBytes(5).toString("hex")}`;
const url = process.env.TENANT_ISOLATION_TEST_URL;
vi.mock("./db", () => ({ requireDb: async () => db }));
vi.mock("./tenancy/config", () => ({ runtimeTenant: { id: "legacy", mode: "legacy" } }));
import { agentsRouter } from "./routers/agents";
import { debtsRouter } from "./routers/debts";
import { kassaRouter } from "./routers/kassa";
import { cashRouter } from "./routers/cash";
import { cashDebtRepaymentsRouter } from "./routers/cashDebtRepayments";
import { products, stockMovements } from "../drizzle/schema";
import { transactionsRouter } from "./routers/transactions";
import { fastKegRouter } from "./routers/fastKeg";
import { factoryRouter } from "./routers/factory";
import { activateMatrixStock, addMatrixReceipt, setMatrixCell, matrixStockDay } from "./matrixInventory";
const day = Date.parse("2026-09-10T12:00:00+05:00");
const context = (role = "admin", agentId: number | null = null) => ({ user: { id: userId, role, agentId }, req: { headers: {} }, res: {} }) as TrpcContext;
async function fixture() {
  const [agent] = await db.insert(agents).values({ name: `Accounting regression ${randomUUID()}`, commissionPercent: "10.00" }).$returningId();
  const [client] = await db.insert(clients).values({ code: randomUUID(), name: "Audit client", agentId: agent.id, openingDebt: 1000000 }).$returningId();
  return { agentId: agent.id, clientId: client.id };
}

describe.skipIf(!url)("accounting audit regression on isolated local SQL", () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.port !== "43317") throw Error("Only explicit disposable SQL 127.0.0.1:43317 is permitted");
    root = await mysql.createConnection(url!);
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    const ddl = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "./drizzle/schema.ts"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    target.pathname = `/${schema}`;
    const connection = await mysql.createConnection({ uri: target.toString(), multipleStatements: true });
    try {
      // Older disposable MariaDB defaults nullable TIMESTAMP differently from
      // production MySQL8. Explicit NULL expresses the schema's intended type.
      await connection.query(ddl.slice(ddl.indexOf("CREATE TABLE")).replace(/`(voidedAt|cashCountedAt)` timestamp/g, "`$1` timestamp NULL DEFAULT NULL"));
    } finally { await connection.end(); }
    pool = mysql.createPool({ uri: target.toString(), timezone: "+05:00", connectionLimit: 6 });
    pool.on("connection", connection => { connection.query("SET time_zone='+05:00'"); });
    db = createTenantDatabase(pool, "legacy");
    const [owner] = await db.insert(users).values({ name: "Audit owner", email: "audit@local.test", passwordHash: "test-fixture", role: "admin" }).$returningId();
    userId = owner.id;
  }, 60000);
  afterAll(async () => {
    await pool?.end();
    if (root) { await root.query(`DROP DATABASE IF EXISTS \`${schema}\``); await root.end(); }
  });

  it("isolates journal and matrix from sales, KEG, factory, customer payments and commission; carries only journal cash forward", async () => {
    const {agentId, clientId} = await fixture();
    const date = Date.parse("2026-10-21T12:00:00+05:00");
    await db.update(clients).set({clientType:"keg"}).where(eq(clients.id,clientId));
    const [product] = await db.insert(products).values({code:randomUUID(),name:"Independent matrix TEST",unit:"blok",price:1000}).$returningId();
    const [keg] = await db.insert(products).values({code:randomUUID(),name:"Independent KEG TEST",unit:"dona",price:1000,containerType:"keg_30",containerUnitsPerItem:1}).$returningId();
    for (const productId of [product.id,keg.id]) {
      await activateMatrixStock(db,{productId,date,openingQuantity:100},userId);
      await addMatrixReceipt(db,{productId,date,quantity:500,requestKey:randomUUID()},userId);
      const cell = {productId,date,agentId,quantity:80,expectedQuantity:0,expectedVersion:0,requestKey:randomUUID()};
      await setMatrixCell(db,cell,userId);
      await setMatrixCell(db,cell,userId);
    }
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    const cash = cashRouter.createCaller(context()), kassa = kassaRouter.createCaller(context());
    const snapshot = async () => ({today:await kassa.daySummary({date}),next:await cash.openingBalance({date:date+86400000}),later:await cash.openingBalance({date:date+7*86400000}),matrix:await matrixStockDay(db,date),nextStock:await matrixStockDay(db,date+86400000)});
    const before = await snapshot();
    for (const productId of [product.id,keg.id]) {
      expect(before.matrix.find(r=>r.productId===productId)).toMatchObject({opening:100,closing:520,received:500});
      expect(before.nextStock.find(r=>r.productId===productId)).toMatchObject({opening:520,closing:520});
    }
    await transactionsRouter.createCaller(context()).create({transactionDate:date,agentId,clientId,productId:product.id,quantity:10,salePrice:1000,cashPayment:5000,terminalPayment:2000,clickPayment:1000,transferPayment:2000});
    expect(await snapshot()).toEqual(before);
    await fastKegRouter.createCaller(context()).saveBatch({idempotencyKey:randomUUID(),transactionDate:date,agentId,rows:[{clientId,keg30:2,cash:1000,terminal:500,click:250,transfer:250}]});
    expect(await snapshot()).toEqual(before);
    await factoryRouter.createCaller(context()).record({productId:keg.id,operationDate:date,quantity:20,operationType:"filled_received"});
    expect(await snapshot()).toEqual(before);
    await debtsRouter.createCaller(context()).payments.create({clientId,requestId:randomUUID(),paymentDate:date,cashAmount:100000,terminalAmount:10000,clickAmount:10000,transferAmount:10000});
    expect(await snapshot()).toEqual(before);
    const commissions = agentsRouter.createCaller(context());
    const report = await commissions.commissionReport({from:Date.parse("2026-10-01T00:00:00+05:00"),to:Date.parse("2026-10-31T23:59:59+05:00")});
    const own = report.find(r=>r.agentId===agentId)!;
    await commissions.payCommission({agentId,amount:own.remainingAmount,periodLabel:"2026-10-01 — 2026-10-31"});
    expect(await snapshot()).toEqual(before);
    await cash.create({entryDate:date,type:"income",category:"Приход пет",agentId,cashAmount:1000,terminalAmount:200,clickAmount:300,transferAmount:400});
    await cash.create({entryDate:date,type:"expense",category:"Расход",agentId,cashAmount:100});
    const after = await snapshot();
    expect(after.today.kassaQoldigi-before.today.kassaQoldigi).toBe(900);
    expect(after.next.openingBalance-before.next.openingBalance).toBe(900);
    expect(after.later.openingBalance-before.later.openingBalance).toBe(900);
    expect(after.matrix).toEqual(before.matrix);
    expect(after.today.pendingByChannel.cash.today-before.today.pendingByChannel.cash.today).toBe(-1900);
  });

  it("denies agent mutations on unassigned and other agents' clients, while allowing its own", async () => {
    const own = await fixture(), other = await fixture();
    const [unassigned] = await db.insert(clients).values({ code: randomUUID(), name: "Unassigned" }).$returningId();
    const agent = debtsRouter.createCaller(context("agent", own.agentId));
    for (const clientId of [unassigned.id, other.clientId]) {
      await expect(agent.payments.create({ requestId: randomUUID(), clientId, paymentDate: day, cashAmount: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [payment] = await db.insert(clientPayments).values({ clientId, paymentDate: new Date(day), cashAmount: 100 }).$returningId();
      await expect(agent.payments.delete({ id: payment.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(agent.payments.create({ requestId: randomUUID(), clientId: own.clientId, paymentDate: day, cashAmount: 100 })).resolves.toEqual({ success: true });
    const [ownPayment] = await db.select().from(clientPayments).where(eq(clientPayments.clientId, own.clientId));
    await expect(agent.payments.delete({ id: ownPayment.id })).resolves.toEqual({ success: true });
  });

  it("deduplicates concurrent and sequential payment retries, rejecting changed payloads", async () => {
    const { clientId } = await fixture();
    const api = debtsRouter.createCaller(context());
    const payment = { requestId: randomUUID(), clientId, paymentDate: day, cashAmount: 123456, note: "one physical receipt" };
    await Promise.all([api.payments.create(payment), api.payments.create(payment)]);
    await api.payments.create(payment);
    expect(await db.select().from(clientPayments).where(eq(clientPayments.requestId, payment.requestId))).toHaveLength(1);
    await expect(api.payments.create({ ...payment, cashAmount: 999 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("blocks overlapping commission payouts, deduplicates exact retries and permits adjacent periods", async () => {
    const { clientId, agentId } = await fixture();
    await db.insert(clientPayments).values({ clientId, agentId, paymentDate: new Date(day), cashAmount: 1000000 });
    await db.insert(clientPayments).values({ clientId, agentId, paymentDate: new Date("2026-10-02T12:00:00+05:00"), cashAmount: 500000 });
    const api = agentsRouter.createCaller(context());
    const before = await kassaRouter.createCaller(context()).daySummary({date:day});
    const first = { agentId, amount: 100000, periodLabel: "2026-09-01 — 2026-09-30" };
    await Promise.all([api.payCommission(first), api.payCommission(first)]);
    await expect(api.payCommission({ ...first, periodLabel: "2026-09-01 — 2026-10-01" })).rejects.toMatchObject({ code: "CONFLICT" });
    const report = await api.commissionReport({ from: Date.parse("2026-09-01T00:00:00+05:00"), to: Date.parse("2026-10-01T23:59:59.999+05:00") });
    expect(report.find(row => row.agentId === agentId)?.overlappingPeriods).toEqual(["2026-09-01 — 2026-09-30"]);
    await api.payCommission({ agentId, amount: 50000, periodLabel: "2026-10-01 — 2026-10-31" });
    const cash = await db.select().from(cashEntries).where(eq(cashEntries.agentId, agentId));
    expect(cash).toHaveLength(0);
    const commissions = await db.select().from(agentCommissionPayments).where(eq(agentCommissionPayments.agentId,agentId));
    expect(commissions.reduce((sum,row)=>sum+row.cashAmount,0)).toBe(150000);
    expect(await kassaRouter.createCaller(context()).daySummary({date:day})).toEqual(before);
  });

  it("keeps electronic confirmation uncounted until an explicit cash count, including zero", async () => {
    const api = kassaRouter.createCaller(context());
    const date = Date.parse("2026-10-05T12:00:00+05:00");
    await db.insert(cashEntries).values({ sourceKey: randomUUID(), entryDate: new Date(date), type: "income", category: "Приход пет", cashAmount: 500000, source: "manual", createdBy: userId });
    await api.channelConfirmation.upsert({ date, terminalConfirmed: 100000, clickConfirmed: 0, transferConfirmed: 0 });
    const uncounted = await api.daySummary({ date });
    expect(uncounted.actualCash).toBeNull(); expect(uncounted.actualDiff).toBeNull();
    await api.actualCash.upsert({ date, actualCash: 0 });
    await api.channelConfirmation.upsert({ date, terminalConfirmed: 200000, clickConfirmed: 0, transferConfirmed: 0 });
    const counted = await api.daySummary({ date });
    expect(counted.actualCash).toBe(0); expect(counted.actualDiff).toBe(-counted.kassaQoldigi);
  });

  it("retains historical explicit count via audit evidence without setting a marker or guessing", async () => {
    const date = Date.parse("2026-10-06T12:00:00+05:00");
    const [row] = await db.insert(kassaDailyActuals).values({ entryDate: new Date(date), actualCash: 350000 }).$returningId();
    const api = kassaRouter.createCaller(context());
    expect((await api.daySummary({ date })).actualCash).toBeNull();
    await db.insert(auditLog).values({ tableName: "kassa_daily_actuals", recordId: row.id, action: "update", userId, afterData: JSON.stringify({ actualCash: 350000 }) });
    expect((await api.daySummary({ date })).actualCash).toBe(350000);
    expect((await db.select().from(kassaDailyActuals).where(eq(kassaDailyActuals.id, row.id)))[0].cashCountedAt).toBeNull();
  });

  it("reassigns a voided existing receipt while retaining history and exactly one cash income", async () => {
    const { agentId } = await fixture();
    const [wrong] = await db.insert(cashJournalDebts).values({ entryDate: new Date(day), amount: 500000, agentId, description: "Wrong borrower", createdBy: userId }).$returningId();
    const [correct] = await db.insert(cashJournalDebts).values({ entryDate: new Date(day), amount: 500000, agentId, description: "Correct borrower", createdBy: userId }).$returningId();
    const [cash] = await db.insert(cashEntries).values({ sourceKey: randomUUID(), entryDate: new Date(day), type: "income", category: "Qarz qaytimi", agentId, cashAmount: 100000, source: "manual", createdBy: userId }).$returningId();
    const api = cashDebtRepaymentsRouter.createCaller(context());
    const payment = { mode: "existing" as const, cashEntryId: cash.id, debtId: wrong.id, paymentDate: day, amount: 100000, method: "cash" as const, requestId: randomUUID() };
    const first = await api.create(payment);
    await api.void({ id: first.id, reason: "Wrong borrower selected" });
    expect((await cashRouter.createCaller(context()).byDate({ date: day })).find(row => row.id === cash.id)?.debtRepaymentId).toBeNull();
    const second = await api.create({ ...payment, debtId: correct.id, requestId: randomUUID() });
    await expect(api.create({ ...payment, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const history = await db.select().from(cashJournalDebtRepayments).where(eq(cashJournalDebtRepayments.cashEntryId, cash.id));
    expect(history).toHaveLength(2); expect(history.filter(row => !row.voidedAt)).toHaveLength(1);
    expect((await cashRouter.createCaller(context()).byDate({ date: day })).find(row => row.id === cash.id)?.debtRepaymentId).toBe(second.id);
    expect((await db.select().from(cashEntries).where(eq(cashEntries.id, cash.id)))[0].cashAmount).toBe(100000);
  });

  it("records all repayment methods without cash changes, including retries, archive and void", async () => {
    const { agentId } = await fixture();
    const [debt] = await db.insert(cashJournalDebts).values({entryDate:new Date(day),amount:400000,agentId,createdBy:userId}).$returningId();
    const api = cashDebtRepaymentsRouter.createCaller(context());
    const cash = cashRouter.createCaller(context());
    const before = await db.select().from(cashEntries);
    const next = await cash.openingBalance({date:day+86400000});
    const ids: number[] = [];
    for (const method of ["cash", "terminal", "click", "transfer"] as const) {
      const input = {mode:"new" as const,debtId:debt.id,paymentDate:day,amount:100000,method,requestId:randomUUID()};
      const [a,b] = await Promise.all([api.create(input),api.create(input)]);
      expect(a).toEqual(b); ids.push(a.id);
      expect(await db.select().from(cashEntries)).toEqual(before);
      expect(await cash.openingBalance({date:day+86400000})).toEqual(next);
    }
    const rows = await db.select().from(cashJournalDebtRepayments).where(eq(cashJournalDebtRepayments.debtId,debt.id));
    expect(rows).toHaveLength(4);
    expect(rows.every(row => row.cashEntryId === null && !row.cashEntryCreated)).toBe(true);
    expect((await api.report({status:"closed",page:1,pageSize:100})).items.some(row=>row.id===debt.id)).toBe(true);
    for (const id of ids) await api.void({id,reason:"Record-only correction"});
    expect(await db.select().from(cashEntries)).toEqual(before);
    expect(await cash.openingBalance({date:day+86400000})).toEqual(next);
    expect((await api.report({status:"active",page:1,pageSize:100})).items.find(row=>row.id===debt.id)?.paidAmount).toBe(0);
  });
});
