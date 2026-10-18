import { expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { cashCategorySql } from "./cashCategorySql";

it("uses stable IDs while preserving the exact old SQL storage filters", () => {
  const dialect = new MySqlDialect();
  expect(dialect.sqlToQuery(cashCategorySql("salary")).params).toEqual(["Ойлик"]);
  expect(dialect.sqlToQuery(cashCategorySql("agent_cash_keg", "agent_cash_pet")).params).toEqual(["Приход кег", "Приход пет"]);
  expect(dialect.sqlToQuery(cashCategorySql("debt_repayment")).params).toEqual(["Qarz qaytimi"]);
  expect(() => cashCategorySql()).toThrow("tanlanmagan");
});
