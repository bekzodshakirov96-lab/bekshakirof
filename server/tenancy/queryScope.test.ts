import { describe, it, expect } from "vitest";
import { eq, or, sql, getTableName } from "drizzle-orm";
import { alias, mysqlTable, int } from "drizzle-orm/mysql-core";
import {
  agents,
  cashEntries,
  cashJournalDebtRepayments,
  clients,
  products,
} from "../../drizzle/schema";
import { createTenantDatabase } from "./queryScope";
import { businessTables } from "./scopeSchema";
import { clientPaymentTotal } from "./scalars";

const db = createTenantDatabase({} as never, "company-a");
describe("mandatory tenant SQL compilation", () => {
  it("adds a parameterized tenant predicate to unfiltered and OR-filtered reads", () => {
    const query = db
      .select()
      .from(products)
      .where(or(eq(products.id, 1), eq(products.id, 2)))
      .toSQL();
    expect(query.sql).toMatch(
      /where .*\(.*id.* or .*id.*\).*and.*tenant_id.*= \?/i
    );
    expect(query.params).toEqual([1, 2, "company-a"]);
    const all = db.select().from(products).toSQL();
    expect(all.sql).toContain("tenant_id");
    expect(all.params).toEqual(["company-a"]);
  });
  it("scopes both write kinds even without where and never lets where(undefined) erase it", () => {
    expect(
      db.update(products).set({ price: 123 }).where(undefined).toSQL().params
    ).toEqual([123, "company-a"]);
    expect(db.delete(products).toSQL().params).toEqual(["company-a"]);
  });
  it("assigns tenant on insert and refuses spoofing, ownership/ID changes and raw bypasses", () => {
    const insert = db
      .insert(products)
      .values({ code: "P1", name: "Test", unit: "dona", price: 1 })
      .toSQL();
    expect(insert.sql).toMatch(/insert into.*tenant_id/i);
    expect(insert.params[0]).toBe("company-a");
    expect(() =>
      db
        .insert(products)
        .values({
          tenantId: "company-b",
          code: "P1",
          name: "Test",
          unit: "dona",
          price: 1,
        })
        .toSQL()
    ).toThrow("another company");
    expect(() =>
      db.update(products).set({ tenantId: "company-b" }).toSQL()
    ).toThrow("ownership");
    expect(() =>
      db
        .insert(products)
        .values({ id: 99, code: "P1", name: "Test", unit: "dona", price: 1 })
        .toSQL()
    ).toThrow("Explicit");
    expect(() => db.execute(sql`select * from products`)).toThrow("Unscoped");
    expect(() => (db as unknown as { $client: unknown }).$client).toThrow(
      "Unscoped"
    );
    expect(() =>
      db
        .select()
        .from(sql`products`)
        .toSQL()
    ).toThrow("unscoped");
  });
  it("scopes joins in ON to preserve unmatched left rows, including aliases and subqueries", () => {
    const agent = alias(agents, "sales_agent");
    const query = db
      .select({ client: clients.name, agent: agent.name })
      .from(clients)
      .leftJoin(agent, eq(clients.agentId, agent.id))
      .toSQL();
    expect(query.sql).toMatch(
      /left join.*on.*sales_agent.*tenant_id.*where.*clients.*tenant_id/i
    );
    expect(query.params).toEqual(["company-a", "company-a"]);
    const paid = db
      .select({ debtId: cashJournalDebtRepayments.debtId })
      .from(cashJournalDebtRepayments)
      .as("paid");
    expect(db.select().from(paid).toSQL().params).toEqual(["company-a"]);
    const other = createTenantDatabase({} as never, "company-b")
      .select()
      .from(cashEntries)
      .as("other");
    expect(() => db.select().from(other).toSQL()).toThrow("unscoped");
  });
  it("requires explicit scoping inside scalar SQL and rejects another company's scalar", () => {
    expect(() =>
      db
        .select({ total: sql`(select sum(amount) from ${cashEntries})` })
        .from(clients)
        .toSQL()
    ).toThrow("tenant-scoped");
    expect(() =>
      db
        .select({
          total: sql.raw("(select sum(cashAmount) from cash_entries)"),
        })
        .from(clients)
        .toSQL()
    ).toThrow("Raw SQL");
    expect(() =>
      db.select().from(clients).where(sql.raw("1=1 -- ")).toSQL()
    ).toThrow("Raw SQL");
    const total = clientPaymentTotal(
      sql`cp.cashAmount`,
      clients.id,
      "company-a"
    );
    expect(db.select({ total }).from(clients).toSQL().params).toEqual([
      "company-a",
      "company-a",
    ]);
    expect(() =>
      db
        .select({
          total: clientPaymentTotal(
            sql`cp.cashAmount`,
            clients.id,
            "company-b"
          ),
        })
        .from(clients)
        .toSQL()
    ).toThrow("another company");
  });
  it("keeps every business table and secondary index explicitly tenant-scoped", () => {
    expect(businessTables).toHaveLength(28);
    for (const table of businessTables) {
      expect(
        table.columns.find(col => col.name === "tenant_id")?.notNull,
        table.name
      ).toBe(true);
      for (const index of table.indexes)
        expect(
          index.config.columns[0].name,
          `${table.name}.${index.config.name}`
        ).toBe("tenant_id");
    }
    const unscoped = mysqlTable("unscoped", { id: int("id").primaryKey() });
    expect(() => db.select().from(unscoped).toSQL()).toThrow("Unscoped");
  });
});
