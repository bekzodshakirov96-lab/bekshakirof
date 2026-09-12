import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CASH_MATRIX_LAYOUTS_DDL } from "./cashMatrixLayoutSchema";

describe("cash matrix layout schema startup", () => {
  it("uses repeat-safe DDL matching the checked-in migration", () => {
    expect(CASH_MATRIX_LAYOUTS_DDL).toMatch(/^CREATE TABLE IF NOT EXISTS `cash_matrix_layouts`/);
    const migration = readFileSync(new URL("../drizzle/0017_curly_lily_hollister.sql", import.meta.url), "utf8");
    const repeatSafeMigration = migration
      .replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ")
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, "  ")
      .trim()
      .replace(/;$/, "");
    expect(repeatSafeMigration).toBe(CASH_MATRIX_LAYOUTS_DDL);
  });
});
