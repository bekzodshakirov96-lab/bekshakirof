import { createHash } from "node:crypto";
import { readDatabaseIdentity, type TenantSql } from "./tenancy/database";
import { scopeSchemaHash } from "./tenancy/scopeSchema";

// Reviewed pre-audit schema (2026-10-20); no arbitrary hash override from CLI.
export const ACCOUNTING_PREVIOUS_SCOPE_HASH = "4a76e8607d06b608f8f97560d632fa84a3a73ebeb557b4b1164795c15d916a07";
export async function assertAccountingScopeUpgradeable(db: TenantSql, tenantId: string) {
  const [identityTables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='saas_tenant_identity'");
  if ((identityTables as unknown[]).length) {
    if (await readDatabaseIdentity(db) !== tenantId) throw new Error("Company identity mismatch.");
  } else if (tenantId !== "legacy") {
    throw new Error("An isolated firm must have an explicit database identity.");
  }
  const [rows] = await db.query("SELECT id,tenantId,schemaHash FROM saas_tenant_scope");
  const records = rows as { id: number; tenantId: string; schemaHash: string }[];
  if (records.length !== 1 || records[0].id !== 1 || records[0].tenantId !== tenantId
    || ![ACCOUNTING_PREVIOUS_SCOPE_HASH, scopeSchemaHash].includes(records[0].schemaHash))
    throw new Error("Unreviewed prior accounting schema; no migration applied.");
}

const quote = (name: string) => `\`${name.replaceAll("`", "``")}\``;
type Projection = { table: string; columns: string[]; keys: string[] };

/** Explicit maintenance migration only: never called by HTTP or startup. */
export async function accountingHistoryProjection(db: TenantSql): Promise<Projection[]> {
  const [tables] = await db.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'");
  const result: Projection[] = [];
  for (const row of tables as Record<string, string>[]) {
    const table = Object.values(row)[0];
    if (table === "saas_tenant_scope") continue;
    const [columns] = await db.query(`SHOW COLUMNS FROM ${quote(table)}`);
    const [keys] = await db.query(`SHOW KEYS FROM ${quote(table)} WHERE Key_name='PRIMARY'`);
    const ordered = (keys as { Column_name: string; Seq_in_index: number }[])
      .sort((a, b) => a.Seq_in_index - b.Seq_in_index).map(k => k.Column_name);
    if (!ordered.length) throw new Error("History verification requires primary keys.");
    result.push({ table, columns: (columns as { Field: string }[]).map(c => c.Field), keys: ordered });
  }
  return result.sort((a, b) => a.table.localeCompare(b.table));
}

/** Compare the original fields exactly, including timestamps and void history. */
export async function accountingHistoryHash(db: TenantSql, projection: Projection[]) {
  const hash = createHash("sha256");
  for (const { table, columns, keys } of projection) {
    hash.update(table + "\n");
    let offset = 0;
    for (;;) {
      const [rows] = await db.query(`SELECT ${columns.map(quote).join(",")} FROM ${quote(table)}
        ORDER BY ${keys.map(quote).join(",")} LIMIT 1000 OFFSET ${offset}`);
      const records = rows as Record<string, unknown>[];
      for (const row of records) hash.update(JSON.stringify(row) + "\n");
      if (records.length < 1000) break;
      offset += records.length;
    }
  }
  return hash.digest("hex");
}

export async function applyAccountingAuditSchema(db: TenantSql) {
  async function addColumn(table: string, name: string, definition: string) {
    const [rows] = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      [table, name],
    );
    if (!(rows as unknown[]).length)
      await db.query(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(name)} ${definition}`);
  }
  async function indexes() {
    const [rows] = await db.query("SHOW INDEX FROM cash_journal_debt_repayments");
    return rows as { Key_name: string; Column_name: string; Seq_in_index: number }[];
  }
  await addColumn("client_payments", "requestId", "varchar(64) NULL");
  await addColumn("kassa_daily_actuals", "cashCountedAt", "timestamp NULL DEFAULT NULL");
  await addColumn("cash_journal_debt_repayments", "activeCashEntryId",
    "int GENERATED ALWAYS AS (CASE WHEN voidedAt IS NULL THEN cashEntryId ELSE NULL END) STORED");
  // Keep the FK's required cashEntryId-leading index before replacing uniqueness.
  if (!(await indexes()).some(i => i.Column_name === "cashEntryId" && i.Seq_in_index === 1 && i.Key_name !== "cash_debt_repayments_cash_entry_unique"))
    await db.query("ALTER TABLE cash_journal_debt_repayments ADD INDEX cash_debt_repayments_cash_entry_idx (cashEntryId)");
  if (!(await indexes()).some(i => i.Key_name === "cash_debt_repayments_active_unique"))
    await db.query("ALTER TABLE cash_journal_debt_repayments ADD UNIQUE INDEX cash_debt_repayments_active_unique (tenant_id,activeCashEntryId)");
  // Replacement already enforces one ACTIVE assignment. All voided rows remain.
  if ((await indexes()).some(i => i.Key_name === "cash_debt_repayments_cash_entry_unique"))
    await db.query("ALTER TABLE cash_journal_debt_repayments DROP INDEX cash_debt_repayments_cash_entry_unique");
  const [paymentIndexes] = await db.query("SHOW INDEX FROM client_payments");
  if (!(paymentIndexes as { Key_name: string }[]).some(i => i.Key_name === "client_payments_request_unique"))
    await db.query("ALTER TABLE client_payments ADD UNIQUE INDEX client_payments_request_unique (tenant_id,requestId)");
}
