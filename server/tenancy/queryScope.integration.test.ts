import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import {
  agents,
  appSettings,
  cashEntries,
  cashJournalDebts,
  cashJournalDebtRepayments,
  clients,
  clientPayments,
  containerMovements,
  products,
  positions,
  transactions,
} from "../../drizzle/schema";
import { createTenantDatabase } from "./queryScope";
import { applyTenantQueryScope } from "./scopeSchema";
import { assertSameBusinessData, snapshotBusinessData } from "./audit";
import { clientPaymentTotal, transactionContainerColumns } from "./scalars";

const url = process.env.TENANT_ISOLATION_TEST_URL;
const suffix = randomBytes(6).toString("hex");
let root: Connection;
let connection: Connection;
let a: ReturnType<typeof createTenantDatabase>;
let b: typeof a;
let ownerA: number;
let ownerB: number;
let agentA: number;
let agentB: number;
let clientA: number;
let clientB: number;
let productA: number;
let productB: number;

describe.skipIf(!url)("tenant_id boundary in ONE actual database", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.port ||
      parsed.port === "3306"
    )
      throw new Error(
        "Only a disposable loopback SQL server on an explicit non-default port is allowed."
      );
    root = await mysql.createConnection({
      uri: url!,
      multipleStatements: true,
    });
    const schema = `bc_rows_${suffix}`;
    const user = `br_${suffix}`;
    const password = randomBytes(20).toString("hex");
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    await root.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [
      password,
    ]);
    await root.query(`GRANT ALL ON \`${schema}\`.* TO '${user}'@'%'`);
    parsed.username = user;
    parsed.password = password;
    parsed.pathname = `/${schema}`;
    connection = await mysql.createConnection({
      uri: parsed.toString(),
      multipleStatements: true,
      dateStrings: true,
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
    await applyTenantQueryScope(connection, "legacy");
    a = createTenantDatabase(connection, "company-a");
    b = createTenantDatabase(connection, "company-b");
    for (const [index, db] of [a, b].entries()) {
      const [owner] = await db
        .insert((await import("../../drizzle/schema")).users)
        .values({
          email: "same@example.uz",
          name: `Owner ${index}`,
          passwordHash: "fixture",
          role: "admin",
        })
        .$returningId();
      const [agent] = await db
        .insert(agents)
        .values({ name: "Same agent" })
        .$returningId();
      const [client] = await db
        .insert(clients)
        .values({ code: "SAME", name: `Client ${index}`, agentId: agent.id })
        .$returningId();
      const [product] = await db
        .insert(products)
        .values({
          code: "SAME",
          name: `Product ${index}`,
          unit: "dona",
          price: 100,
        })
        .$returningId();
      if (!index) {
        ownerA = owner.id;
        agentA = agent.id;
        clientA = client.id;
        productA = product.id;
      } else {
        ownerB = owner.id;
        agentB = agent.id;
        clientB = client.id;
        productB = product.id;
      }
      await db.insert(cashEntries).values({
        sourceKey: "same-entry",
        entryDate: new Date("2026-10-01T07:00:00Z"),
        type: "income",
        category: "Приход кег",
        cashAmount: index ? 900000 : 100000,
        agentId: agent.id,
        createdBy: owner.id,
      });
      await db.insert(transactions).values({
        sourceKey: "same-sale",
        transactionDate: new Date("2026-10-01T07:00:00Z"),
        agentId: agent.id,
        clientId: client.id,
        productId: product.id,
        productName: `Product ${index}`,
        unit: "dona",
        quantity: "2",
        totalAmount: index ? 600000 : 200000,
        createdBy: owner.id,
      });
    }
  }, 30_000);
  afterAll(async () => {
    if (connection) await connection.end();
    if (root) await root.end();
  });
  it("separates lists, counts, natural-key lookups and financial sums in the same database", async () => {
    expect((await a.select().from(clients)).map(row => row.name)).toEqual([
      "Client 0",
    ]);
    expect((await b.select().from(clients)).map(row => row.name)).toEqual([
      "Client 1",
    ]);
    expect((await a.select({ count: count() }).from(products))[0].count).toBe(
      1
    );
    expect(
      (await a.select().from(products).where(eq(products.code, "SAME")))[0].id
    ).toBe(productA);
    const total = {
      amount: sql<number>`sum(${cashEntries.cashAmount})`.mapWith(Number),
    };
    expect((await a.select(total).from(cashEntries))[0].amount).toBe(100000);
    expect((await b.select(total).from(cashEntries))[0].amount).toBe(900000);
    const [all] = await connection.query(
      "SELECT COUNT(*) count FROM cash_entries"
    );
    expect((all as { count: number }[])[0].count).toBe(2);
  });
  it("scopes joins on each side even with a broad ON clause and protects derived aggregates", async () => {
    const joined = await a
      .select({ client: clients.name, agent: agents.name })
      .from(clients)
      .leftJoin(agents, sql`true`);
    expect(joined).toEqual([{ client: "Client 0", agent: "Same agent" }]);
    for (const [index, db] of [a, b].entries()) {
      const [debt] = await db
        .insert(cashJournalDebts)
        .values({
          entryDate: new Date(),
          amount: 10000,
          createdBy: index ? ownerB : ownerA,
        })
        .$returningId();
      const [cash] = await db
        .insert(cashEntries)
        .values({
          sourceKey: "debt-cash",
          entryDate: new Date(),
          type: "income",
          category: "Qarz qaytimi",
          cashAmount: index ? 500 : 200,
          createdBy: index ? ownerB : ownerA,
        })
        .$returningId();
      await db.insert(cashJournalDebtRepayments).values({
        debtId: debt.id,
        cashEntryId: cash.id,
        paymentDate: new Date(),
        amount: index ? 500 : 200,
        method: "cash",
        createdBy: index ? ownerB : ownerA,
      });
    }
    const paid = a
      .select({
        debtId: cashJournalDebtRepayments.debtId,
        total: sql<number>`sum(${cashJournalDebtRepayments.amount})`
          .mapWith(Number)
          .as("total"),
      })
      .from(cashJournalDebtRepayments)
      .groupBy(cashJournalDebtRepayments.debtId)
      .as("paid");
    expect(await a.select({ total: paid.total }).from(paid)).toEqual([
      { total: 200 },
    ]);
    const [otherClient] = await a
      .insert(clients)
      .values({ code: "OTHER", name: "Unrelated client", agentId: agentA })
      .$returningId();
    await a
      .insert(clientPayments)
      .values({
        clientId: otherClient.id,
        paymentDate: new Date(),
        cashAmount: 999,
        createdBy: ownerA,
      });
    for (const [index, db] of [a, b].entries())
      await db.insert(clientPayments).values({
        clientId: index ? clientB : clientA,
        paymentDate: new Date(),
        cashAmount: index ? 700 : 300,
        createdBy: index ? ownerB : ownerA,
      });
    const scalar = clientPaymentTotal(
      sql`cp.cashAmount`,
      clients.id,
      "company-a"
    ).mapWith(Number);
    expect(
      await a
        .select({ total: scalar })
        .from(clients)
        .where(eq(clients.id, clientA))
    ).toEqual([{ total: 300 }]);
    const [sale] = await a.select({ id: transactions.id }).from(transactions);
    await a
      .insert(containerMovements)
      .values({
        sourceKey: "unrelated-tara",
        movementDate: new Date(),
        clientId: otherClient.id,
        containerType: "keg_30",
        movementType: "issued",
        quantity: 999,
      });
    await a
      .insert(containerMovements)
      .values({
        sourceKey: "sale-tara",
        movementDate: new Date(),
        transactionId: sale.id,
        clientId: clientA,
        containerType: "keg_30",
        movementType: "issued",
        quantity: 3,
      });
    expect(
      await a
        .select(transactionContainerColumns(transactions.id, "company-a"))
        .from(transactions)
    ).toEqual([
      {
        issuedContainerType: "keg_30",
        issuedContainerQuantity: 3,
        returnedContainerType: null,
        returnedContainerQuantity: 0,
      },
    ]);
  });
  it("cannot update/delete another tenant by ID and scopes even bulk writes", async () => {
    await a
      .update(products)
      .set({ price: 999 })
      .where(eq(products.id, productB));
    await a.delete(products).where(eq(products.id, productB));
    expect(
      (await b.select().from(products).where(eq(products.id, productB)))[0]
        .price
    ).toBe(100);
    await a.update(products).set({ price: 250 });
    expect((await a.select().from(products))[0].price).toBe(250);
    expect((await b.select().from(products))[0].price).toBe(100);
    await a.insert(positions).values({ name: "Same position" });
    await b.insert(positions).values({ name: "Same position" });
    await a.delete(positions);
    expect(await a.select().from(positions)).toEqual([]);
    expect(await b.select().from(positions)).toHaveLength(1);
  });
  it("refuses cross-tenant references, tenant reassignment, and conflicting explicit IDs", async () => {
    const before = await snapshotBusinessData(connection);
    await expect(
      a.insert(clients).values({ code: "BAD", name: "Bad", agentId: agentB })
    ).rejects.toThrow();
    await expect(
      a.update(clients).set({ agentId: agentB }).where(eq(clients.id, clientA))
    ).rejects.toThrow();
    await expect(
      connection.query("UPDATE clients SET tenant_id='company-b' WHERE id=?", [
        clientA,
      ])
    ).rejects.toMatchObject({ sqlState: "45000" });
    await expect(
      async () =>
        await a
          .insert(products)
          .values({
            id: productB,
            code: "BAD",
            name: "Bad",
            unit: "dona",
            price: 1,
          })
          .onDuplicateKeyUpdate({ set: { price: 1 } })
    ).rejects.toThrow("Explicit");
    assertSameBusinessData(before, await snapshotBusinessData(connection));
  });
  it("keeps idempotent upserts and settings keys inside the same tenant", async () => {
    await a
      .insert(products)
      .values({ code: "SAME", name: "Product 0", unit: "dona", price: 333 })
      .onDuplicateKeyUpdate({ set: { price: 333 } });
    expect((await a.select().from(products))[0].price).toBe(333);
    expect((await b.select().from(products))[0].price).toBe(100);
    await a
      .insert(appSettings)
      .values({ key: "lockDate", value: "2026-01-01", updatedBy: ownerA });
    await b
      .insert(appSettings)
      .values({ key: "lockDate", value: "2026-09-01", updatedBy: ownerB });
    await a
      .insert(appSettings)
      .values({ key: "lockDate", value: "2026-02-01", updatedBy: ownerA })
      .onDuplicateKeyUpdate({ set: { value: "2026-02-01" } });
    expect((await a.select().from(appSettings))[0].value).toBe("2026-02-01");
    expect((await b.select().from(appSettings))[0].value).toBe("2026-09-01");
  });
  it("retains scope through prepared statements, transactions, nested transactions and rollback", async () => {
    expect(await a.select().from(products).prepare().execute()).toHaveLength(1);
    await a.transaction(async tx => {
      expect(await tx.select().from(products)).toHaveLength(1);
      await tx.transaction(async nested => {
        expect((await nested.select().from(products))[0].tenantId).toBe(
          "company-a"
        );
      });
    });
    await expect(
      a.transaction(async tx => {
        await tx.insert(products).values({
          code: "ROLLBACK",
          name: "Will roll back",
          unit: "dona",
          price: 1,
        });
        throw new Error("rollback fixture");
      })
    ).rejects.toThrow("rollback fixture");
    expect(
      await a.select().from(products).where(eq(products.code, "ROLLBACK"))
    ).toEqual([]);
  });
});
