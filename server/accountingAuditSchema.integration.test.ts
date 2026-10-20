import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { accountingHistoryHash, accountingHistoryProjection, applyAccountingAuditSchema, assertAccountingScopeUpgradeable, ACCOUNTING_PREVIOUS_SCOPE_HASH } from "./accountingAuditSchema";
import { applyTenantQueryScope, assertTenantQueryScope } from "./tenancy/scopeSchema";

const url = process.env.TENANT_ISOLATION_TEST_URL;
describe.skipIf(!url)("accounting safeguard migration preserves existing history", () => {
  it("upgrades a previously scoped complete firm and refuses unknown metadata before altering it", async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.port !== "43317") throw new Error("Local disposable TEST server required.");
    const root = await mysql.createConnection(url!);
    const schema = `bc_audit_upgrade_${randomBytes(6).toString("hex")}`;
    let db: mysql.Connection | undefined;
    try {
      await root.query("CREATE DATABASE ??", [schema]);
      target.pathname = "/" + schema;
      db = await mysql.createConnection({ uri: target.href, multipleStatements: true, dateStrings: true });
      const exported = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "mysql", "--schema", "drizzle/schema.ts"], { encoding: "utf8", maxBuffer: 8e6 });
      await db.query(exported.slice(exported.indexOf("CREATE TABLE")));
      await applyTenantQueryScope(db, "legacy");
      await db.query("ALTER TABLE client_payments DROP INDEX client_payments_request_unique, DROP COLUMN requestId");
      await db.query("ALTER TABLE kassa_daily_actuals DROP COLUMN cashCountedAt");
      await db.query("ALTER TABLE cash_journal_debt_repayments ADD UNIQUE INDEX cash_debt_repayments_cash_entry_unique(tenant_id,cashEntryId)");
      await db.query("ALTER TABLE cash_journal_debt_repayments DROP INDEX cash_debt_repayments_active_unique, DROP COLUMN activeCashEntryId");
      await db.query("UPDATE saas_tenant_scope SET schemaHash='unreviewed'");
      await expect(assertAccountingScopeUpgradeable(db, "legacy")).rejects.toThrow("Unreviewed");
      await db.query("UPDATE saas_tenant_scope SET schemaHash=?", [ACCOUNTING_PREVIOUS_SCOPE_HASH]);
      await db.query("INSERT INTO cash_entries(sourceKey,entryDate,type,category,cashAmount,description) VALUES('legacy-proof','2026-10-01','income','Other',1732000,'Keep exactly')");
      const projection = await accountingHistoryProjection(db);
      const before = await accountingHistoryHash(db, projection);
      await assertAccountingScopeUpgradeable(db, "legacy");
      await applyAccountingAuditSchema(db);
      await applyTenantQueryScope(db, "legacy", ACCOUNTING_PREVIOUS_SCOPE_HASH);
      await assertTenantQueryScope(db, "legacy");
      expect(await accountingHistoryHash(db, projection)).toBe(before);
      await applyAccountingAuditSchema(db);
      await applyTenantQueryScope(db, "legacy", ACCOUNTING_PREVIOUS_SCOPE_HASH);
      expect(await accountingHistoryHash(db, projection)).toBe(before);
    } finally {
      await db?.end();
      await root.query("DROP DATABASE ??", [schema]);
      await root.end();
    }
  }, 120000);
  it("retains every old field, permits void/relink and enforces active and request uniqueness", async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.port !== "43317") throw new Error("Local disposable TEST server required.");
    const root = await mysql.createConnection(url!);
    const schema = `bc_audit_upgrade_${randomBytes(6).toString("hex")}`;
    let db: mysql.Connection | undefined;
    try {
      await root.query("CREATE DATABASE ??", [schema]);
      target.pathname = "/" + schema;
      db = await mysql.createConnection({ uri: target.href, dateStrings: true });
      await db.query(`CREATE TABLE client_payments (
        id int PRIMARY KEY, tenant_id varchar(63) NOT NULL DEFAULT 'legacy', amount int, note varchar(100))`);
      await db.query(`CREATE TABLE kassa_daily_actuals (
        id int PRIMARY KEY, tenant_id varchar(63) NOT NULL DEFAULT 'legacy', actualCash int, terminalConfirmed int, updatedAt timestamp NULL)`);
      await db.query(`CREATE TABLE cash_journal_debt_repayments (
        id int PRIMARY KEY, tenant_id varchar(63) NOT NULL DEFAULT 'legacy', cashEntryId int NOT NULL, debtId int, amount int,
        voidedAt timestamp NULL DEFAULT NULL, note varchar(100),
        UNIQUE KEY cash_debt_repayments_cash_entry_unique (tenant_id,cashEntryId))`);
      await db.query("INSERT INTO client_payments VALUES(1,'legacy',123456,'old payment')");
      await db.query("INSERT INTO kassa_daily_actuals VALUES(1,'legacy',1732000,500000,'2026-10-01 12:00:00'),(2,'legacy',0,200000,'2026-10-02 12:00:00')");
      await db.query("INSERT INTO cash_journal_debt_repayments VALUES(1,'legacy',101,5,100000,NULL,'active'),(2,'legacy',102,6,200000,'2026-10-02 12:00:00','void history')");
      const projection = await accountingHistoryProjection(db);
      const before = await accountingHistoryHash(db, projection);
      await applyAccountingAuditSchema(db);
      await applyAccountingAuditSchema(db);
      expect(await accountingHistoryHash(db, projection)).toBe(before);
      const [countMarkers] = await db.query("SELECT cashCountedAt FROM kassa_daily_actuals");
      expect(countMarkers).toEqual([{ cashCountedAt: null }, { cashCountedAt: null }]);
      await expect(db.query("INSERT INTO cash_journal_debt_repayments(id,cashEntryId,debtId,amount) VALUES(3,101,7,100000)")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await db.query("INSERT INTO cash_journal_debt_repayments(id,cashEntryId,debtId,amount) VALUES(3,102,7,200000)");
      await db.query("UPDATE cash_journal_debt_repayments SET voidedAt='2026-10-03 12:00:00' WHERE id=1");
      await db.query("INSERT INTO cash_journal_debt_repayments(id,cashEntryId,debtId,amount) VALUES(4,101,8,100000)");
      const [history] = await db.query("SELECT id,activeCashEntryId FROM cash_journal_debt_repayments ORDER BY id");
      expect(history).toEqual([{ id: 1, activeCashEntryId: null }, { id: 2, activeCashEntryId: null }, { id: 3, activeCashEntryId: 102 }, { id: 4, activeCashEntryId: 101 }]);
      await db.query("INSERT INTO client_payments(id,requestId,amount) VALUES(2,'same-key',400)");
      await expect(db.query("INSERT INTO client_payments(id,requestId,amount) VALUES(3,'same-key',400)")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      // Multiple old NULL request IDs remain valid; no retrospective guessing.
      await db.query("INSERT INTO client_payments(id,amount) VALUES(3,400)");
    } finally {
      await db?.end();
      await root.query("DROP DATABASE ??", [schema]);
      await root.end();
    }
  });
});
