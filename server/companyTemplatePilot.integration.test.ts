import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  clients,
  products,
  users,
  cashEntries,
  transactions,
  stockMovements,
  containerMovements,
  appSettings,
} from "../drizzle/schema";
import {
  COMPANY_TEMPLATE_IDS,
  type CompanyTemplateId,
} from "../shared/companyTemplates";
import { companyColumnLabel } from "../shared/companyPreferences";
import { createTenantDatabase } from "./tenancy/queryScope";
import { bindTenantDatabase } from "./tenancy/bind";
import { snapshotBusinessData } from "./tenancy/audit";
import { applyCompanyTemplate } from "./companyTemplates";
import {
  readCompanyPreferences,
  saveCompanyPreferences,
} from "./companyPreferences";
import {
  activateMatrixStock,
  addMatrixReceipt,
  setMatrixCell,
  matrixCellVersion,
  matrixStockDay,
} from "./matrixInventory";
import { cashRouter } from "./routers/cash";
import { kassaRouter } from "./routers/kassa";
import { fastKegRouter } from "./routers/fastKeg";
import { stockRouter } from "./routers/stock";
import type { TrpcContext } from "./_core/context";

type Db = ReturnType<typeof createTenantDatabase>;
const scope = new AsyncLocalStorage<{ db: Db; tenantId: string }>();
// The application runs one verified company per process. This direct-router
// harness supplies that same binding to both the database and correlated SQL;
// real per-process HTTP/session boundaries remain covered by the tenancy suite.
vi.mock("./tenancy/config", async original => {
  const actual = await original<typeof import("./tenancy/config")>();
  return {
    ...actual,
    runtimeTenant: {
      ...actual.runtimeTenant,
      get id() {
        return scope.getStore()?.tenantId ?? actual.runtimeTenant.id;
      },
    },
  };
});
vi.mock("./db", async original => ({
  ...(await original<typeof import("./db")>()),
  requireDb: async () => {
    const context = scope.getStore();
    if (!context) throw Error("Pilot database scope missing");
    return context.db;
  },
}));
type Fixture = {
  id: CompanyTemplateId;
  schema: string;
  account: string;
  connection: Connection;
  pool: Pool;
  db: Db;
  owner: number;
  agent: number;
  secondAgent: number;
  product: number;
  client: number;
};
const fixtures: Fixture[] = [];
const allocated: { schema: string; account: string }[] = [];
const resources: { connection: Connection; pool?: Pool }[] = [];
const url = process.env.TENANT_ISOLATION_TEST_URL;
let root: Connection;
const day = Date.parse("2030-02-28T07:00:00Z"),
  tomorrow = day + 86400000;
function ctx(f: Fixture, role = "admin") {
  return {
    user: { id: f.owner, role, agentId: f.secondAgent },
    req: { headers: {} },
    res: {},
  } as TrpcContext;
}
function run<T>(f: Fixture, action: () => Promise<T>) {
  return scope.run(
    { db: f.db, tenantId: `pilot-${f.id.replaceAll("_", "-")}` },
    action
  );
}

describe.skipIf(!url)(
  "activity template pilots on three independent company databases",
  () => {
    beforeAll(async () => {
      const parsed = new URL(url!);
      if (parsed.hostname !== "127.0.0.1" || parsed.port !== "43317")
        throw Error("Only explicit disposable loopback SQL is allowed");
      root = await mysql.createConnection(url!);
      const ddl = execFileSync(
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
      for (const [index, id] of COMPANY_TEMPLATE_IDS.entries()) {
        const suffix = randomBytes(5).toString("hex");
        const schema = `bc_pilot_${id}_${suffix}`,
          account = `pl_${index}_${suffix}`,
          password = randomBytes(20).toString("hex");
        await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
        await root.query(
          `CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`,
          [password]
        );
        allocated.push({ schema, account });
        await root.query(
          `GRANT ALL ON \`${schema}\`.* TO '${account}'@'127.0.0.1'`
        );
        const target = new URL(url!);
        target.username = account;
        target.password = password;
        target.pathname = `/${schema}`;
        const connection = await mysql.createConnection({
          uri: target.toString(),
          multipleStatements: true,
          dateStrings: true,
        });
        const resource: (typeof resources)[number] = { connection };
        resources.push(resource);
        await connection.query(ddl.slice(ddl.indexOf("CREATE TABLE")));
        const tenant = `pilot-${id.replaceAll("_", "-")}`;
        await bindTenantDatabase(
          connection,
          tenant,
          await snapshotBusinessData(connection)
        );
        const pool = mysql.createPool({
          uri: target.toString(),
          timezone: "+05:00",
          connectionLimit: 4,
        });
        resource.pool = pool;
        pool.on("connection", connection => {
          connection.query("SET time_zone = '+05:00'", error => {
            if (error) throw error;
          });
        });
        const db = createTenantDatabase(pool, tenant);
        const [owner] = await db
          .insert(users)
          .values({
            name: "Pilot owner",
            email: "owner@pilot.test",
            passwordHash: "fixture",
            role: "admin",
          })
          .$returningId();
        await applyCompanyTemplate(db, id, randomUUID(), owner.id);
        expect(await db.select().from(products)).toHaveLength(0);
        expect(await db.select().from(cashEntries)).toHaveLength(0);
        expect(await db.select().from(transactions)).toHaveLength(0);
        const [agent] = await db
          .insert(agents)
          .values({ name: "Agent 1" })
          .$returningId();
        const [secondAgent] = await db
          .insert(agents)
          .values({ name: "Agent 2" })
          .$returningId();
        const [product] = await db
          .insert(products)
          .values({
            code: "GOODS",
            name: "Pilot goods",
            unit: "blok",
            price: 10000,
          })
          .$returningId();
        const [client] = await db
          .insert(clients)
          .values({
            code: "CLIENT",
            name: "Pilot client",
            agentId: agent.id,
            clientType: "keg",
          })
          .$returningId();
        fixtures.push({
          id,
          schema,
          account,
          connection,
          pool,
          db,
          owner: owner.id,
          agent: agent.id,
          secondAgent: secondAgent.id,
          product: product.id,
          client: client.id,
        });
      }
    }, 30000);
    afterAll(async () => {
      for (const resource of resources) {
        await resource.pool?.end();
        await resource.connection.end();
      }
      for (const allocation of allocated) {
        if (
          !/^bc_pilot_(wholesale|agent_distribution|beverages_keg)_[a-f0-9]{10}$/.test(
            allocation.schema
          ) ||
          !/^pl_[0-2]_[a-f0-9]{10}$/.test(allocation.account)
        )
          throw Error("Unsafe pilot cleanup target");
        await root.query(`DROP DATABASE \`${allocation.schema}\``);
        await root.query(`DROP USER '${allocation.account}'@'127.0.0.1'`);
      }
      await root?.end();
    });

    for (const id of COMPANY_TEMPLATE_IDS) {
      it(`${id}: real Kassa channels, cash-only expenses, debt memo, edit/delete, retry and next-day carry-forward`, async () => {
        const f = fixtures.find(row => row.id === id)!;
        await run(f, async () => {
          const cash = cashRouter.createCaller(ctx(f)),
            kassa = kassaRouter.createCaller(ctx(f));
          const request = {
            entryDate: day,
            type: "income" as const,
            category: "Renamed receipt",
            categoryId: "agent_cash_keg" as const,
            agentId: f.agent,
            cashAmount: 1000000,
            terminalAmount: 200000,
            clickAmount: 300000,
            transferAmount: 400000,
            requestId: randomUUID(),
          };
          const first = await cash.create(request);
          expect(await cash.create(request)).toEqual(first);
          const second = await cash.create({
            ...request,
            categoryId: "agent_cash_pet",
            cashAmount: 500000,
            terminalAmount: 0,
            clickAmount: 0,
            transferAmount: 0,
            requestId: randomUUID(),
          });
          const expense = await cash.create({
            entryDate: day,
            type: "expense",
            category: "Salary",
            categoryId: "salary",
            agentId: f.agent,
            cashAmount: 125000,
            requestId: randomUUID(),
          });
          await cash.create({
            entryDate: day,
            type: "income",
            category: "Qarz qaytimi",
            categoryId: "debt_repayment",
            agentId: f.agent,
            cashAmount: 100000,
            terminalAmount: 25000,
            requestId: randomUUID(),
          });
          await cash.journalDebt.create({
            entryDate: day,
            amount: 700000,
            agentId: f.agent,
            description: "Independent note",
          });
          expect(await f.db.select().from(cashEntries)).toHaveLength(4);
          // The existing realized-income KPI excludes bank transfers; agent
          // settlement includes them, while physical cash includes cash only.
          expect(await kassa.daySummary({ date: day })).toMatchObject({
            jamiPrihod: 2125000,
            jamiRasxod: 125000,
            kassaQoldigi: 1475000,
            agentSubmittedTotal: 2400000,
          });
          expect(
            (await cash.openingBalance({ date: tomorrow })).openingBalance
          ).toBe(1475000);
          await cash.update({
            id: second.id,
            entryDate: day,
            type: "income",
            category: "Renamed receipt",
            categoryId: "agent_cash_pet",
            agentId: f.agent,
            cashAmount: 400000,
            terminalAmount: 0,
            clickAmount: 0,
            transferAmount: 0,
          });
          expect(
            (await cash.openingBalance({ date: tomorrow })).openingBalance
          ).toBe(1375000);
          await cash.delete({ id: expense.id });
          expect(await kassa.daySummary({ date: day })).toMatchObject({
            jamiPrihod: 2025000,
            jamiRasxod: 0,
            kassaQoldigi: 1500000,
            agentSubmittedTotal: 2300000,
          });
          expect(
            (await cash.openingBalance({ date: tomorrow + 86400000 }))
              .openingBalance
          ).toBe(1500000);
          const rows = await f.db.select().from(cashEntries);
          const before = await readCompanyPreferences(f.db);
          await saveCompanyPreferences(
            f.db,
            {
              ...before.preferences,
              labels: { ...before.preferences.labels, salary: "Jamoa maoshi" },
            },
            before.latestRevision,
            f.owner
          );
          expect(await f.db.select().from(cashEntries)).toEqual(rows);
          expect(
            companyColumnLabel(
              (await readCompanyPreferences(f.db)).preferences,
              "salary"
            )
          ).toBe("Jamoa maoshi");
        });
      });

      it(`${id}: 100 + 500 - 40 - 40 = 520, tomorrow = 510, replay and correction affect stock once`, async () => {
        const f = fixtures.find(row => row.id === id)!;
        await run(f, async () => {
          await activateMatrixStock(
            f.db,
            { productId: f.product, date: day, openingQuantity: 100 },
            f.owner
          );
          const receipt = {
            productId: f.product,
            date: day,
            quantity: 500,
            requestKey: randomUUID(),
          };
          await addMatrixReceipt(f.db, receipt, f.owner);
          await addMatrixReceipt(f.db, receipt, f.owner);
          const first = {
            productId: f.product,
            agentId: f.agent,
            date: day,
            quantity: 40,
            expectedQuantity: 0,
            expectedVersion: await matrixCellVersion(
              f.db,
              f.product,
              f.agent,
              day
            ),
            requestKey: randomUUID(),
          };
          await setMatrixCell(f.db, first, f.owner);
          await setMatrixCell(f.db, first, f.owner);
          await setMatrixCell(
            f.db,
            {
              ...first,
              agentId: f.secondAgent,
              expectedVersion: await matrixCellVersion(
                f.db,
                f.product,
                f.secondAgent,
                day
              ),
              requestKey: randomUUID(),
            },
            f.owner
          );
          const balance = async (date: number) =>
            (await matrixStockDay(f.db, date)).find(
              row => row.productId === f.product
            )!;
          expect(await balance(day)).toMatchObject({ closing: 520 });
          expect(await balance(tomorrow)).toMatchObject({
            opening: 520,
            closing: 520,
          });
          await addMatrixReceipt(
            f.db,
            {
              ...receipt,
              date: tomorrow,
              quantity: 20,
              requestKey: randomUUID(),
            },
            f.owner
          );
          await setMatrixCell(
            f.db,
            {
              ...first,
              date: tomorrow,
              quantity: 30,
              expectedVersion: await matrixCellVersion(
                f.db,
                f.product,
                f.agent,
                tomorrow
              ),
              requestKey: randomUUID(),
            },
            f.owner
          );
          expect(await balance(tomorrow)).toMatchObject({
            opening: 520,
            closing: 510,
          });
          await setMatrixCell(
            f.db,
            {
              ...first,
              quantity: 10,
              expectedQuantity: 40,
              expectedVersion: await matrixCellVersion(
                f.db,
                f.product,
                f.agent,
                day
              ),
              requestKey: randomUUID(),
            },
            f.owner
          );
          expect(await balance(day)).toMatchObject({ closing: 550 });
          expect(await balance(tomorrow)).toMatchObject({
            opening: 550,
            closing: 540,
          });
          await expect(
            setMatrixCell(f.db, { ...first, requestKey: randomUUID() }, f.owner)
          ).rejects.toMatchObject({ code: "CONFLICT" });
          expect(
            (await kassaRouter.createCaller(ctx(f)).daySummary({ date: day }))
              .kassaQoldigi
          ).toBe(1500000);
        });
      });

      it(`${id}: KEG sale, four channels, debt, tare return, stock, retry and role guards retain original semantics`, async () => {
        const f = fixtures.find(row => row.id === id)!;
        await run(f, async () => {
          for (const [type, price] of [
            ["keg_30", 400000],
            ["keg_50", 600000],
          ] as const) {
            const [product] = await f.db
              .insert(products)
              .values({
                code: type,
                name: type,
                unit: "dona",
                price,
                containerType: type,
                containerUnitsPerItem: 1,
              })
              .$returningId();
            await f.db
              .insert(stockMovements)
              .values({
                productId: product.id,
                movementType: "in",
                movementDate: new Date(day),
                quantity: "10",
              });
          }
          const keg = fastKegRouter.createCaller(ctx(f));
          const request = {
            idempotencyKey: "pilot_same_request_0001",
            transactionDate: day,
            agentId: f.agent,
            rows: [
              {
                clientId: f.client,
                keg30: 2,
                keg50: 1,
                returned30: 1,
                returned50: 0,
                cash: 500000,
                terminal: 200000,
                click: 100000,
                transfer: 300000,
              },
            ],
          };
          const saved = await keg.saveBatch(request);
          expect(saved.rows[0]).toMatchObject({
            saleAmount: 1400000,
            endingDebt: 300000,
            endingKeg30Balance: 1,
            endingKeg50Balance: 1,
          });
          expect((await keg.saveBatch(request)).duplicate).toBe(true);
          expect(await f.db.select().from(transactions)).toHaveLength(2);
          expect(
            (await keg.clientsByAgent({ agentId: f.agent }))[0]
          ).toMatchObject({
            currentDebt: 300000,
            keg30Balance: 1,
            keg50Balance: 1,
          });
          const stock = await stockRouter.createCaller(ctx(f)).list();
          expect(stock.find(row => row.name === "keg_30")?.currentStock).toBe(
            8
          );
          expect(stock.find(row => row.name === "keg_50")?.currentStock).toBe(
            9
          );
          await keg.saveBatch({
            ...request,
            idempotencyKey: "pilot_same_request_0002",
            rows: [
              {
                clientId: f.client,
                keg30: 0,
                keg50: 0,
                returned30: 0,
                returned50: 1,
                cash: 300000,
                terminal: 0,
                click: 0,
                transfer: 0,
              },
            ],
          });
          expect(
            (await keg.clientsByAgent({ agentId: f.agent }))[0]
          ).toMatchObject({ currentDebt: 0, keg30Balance: 1, keg50Balance: 0 });
          const before = await Promise.all([
            f.db.select().from(transactions),
            f.db.select().from(containerMovements),
            f.db.select().from(stockMovements),
          ]);
          await expect(
            keg.saveBatch({
              ...request,
              idempotencyKey: "pilot_bad_overpay_0003",
              rows: [
                {
                  clientId: f.client,
                  keg30: 0,
                  keg50: 0,
                  returned30: 0,
                  returned50: 0,
                  cash: 1,
                  terminal: 0,
                  click: 0,
                  transfer: 0,
                },
              ],
            })
          ).rejects.toThrow();
          await expect(
            fastKegRouter.createCaller(ctx(f, "agent")).saveBatch(request)
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
          expect(
            await Promise.all([
              f.db.select().from(transactions),
              f.db.select().from(containerMovements),
              f.db.select().from(stockMovements),
            ])
          ).toEqual(before);
          expect(
            (await kassaRouter.createCaller(ctx(f)).daySummary({ date: day }))
              .kassaQoldigi
          ).toBe(1500000);
        });
      });
    }

    it("keeps identical IDs/source keys in different databases separate and denies SQL access to another company", async () => {
      expect(fixtures.map(f => f.owner)).toEqual([1, 1, 1]);
      expect(fixtures.map(f => f.client)).toEqual([1, 1, 1]);
      for (const f of fixtures) {
        expect((await readCompanyPreferences(f.db)).latestRevision).toBe(2);
        expect(await f.db.select().from(transactions)).toHaveLength(3);
        const other = fixtures.find(row => row !== f)!;
        await expect(
          f.connection.query(`SELECT * FROM \`${other.schema}\`.cash_entries`)
        ).rejects.toMatchObject({ errno: 1142 });
      }
    });

    for (const scenario of ["users", "settings"] as const) {
      it(`rechecks concurrent first ${scenario} before applying a starting template`, async () => {
        const f = fixtures[0],
          db = createTenantDatabase(f.pool, `pilot-guard-${scenario}`);
        const [owner] = await db
          .insert(users)
          .values({
            name: "Guard owner",
            email: `${scenario}@pilot.test`,
            passwordHash: "fixture",
            role: "admin",
          })
          .$returningId();
        let inserted!: () => void, release!: () => void;
        const ready = new Promise<void>(resolve => {
          inserted = resolve;
        });
        const gate = new Promise<void>(resolve => {
          release = resolve;
        });
        const writing = db.transaction(async tx => {
          if (scenario === "users")
            await tx
              .insert(users)
              .values({
                name: "New accountant",
                email: "staff@pilot.test",
                passwordHash: "fixture",
                role: "accountant",
              });
          else
            await tx
              .insert(appSettings)
              .values({
                key: "periodLockDate",
                value: "2020-01-01",
                updatedBy: owner.id,
              });
          inserted();
          await gate;
        });
        await ready;
        const choosing = applyCompanyTemplate(
          db,
          "wholesale",
          randomUUID(),
          owner.id
        ).then(
          value => ({ value, error: null }),
          (error: unknown) => ({ value: null, error })
        );
        await new Promise(resolve => setTimeout(resolve, 50));
        release();
        await writing;
        expect((await choosing).error).toMatchObject({
          code: "PRECONDITION_FAILED",
        });
        expect((await readCompanyPreferences(db)).latestRevision).toBe(0);
      });
    }
  }
);
