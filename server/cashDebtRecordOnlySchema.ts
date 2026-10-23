import { readDatabaseIdentity, type TenantSql } from "./tenancy/database";
import { applyTenantQueryScope, scopeSchemaHash } from "./tenancy/scopeSchema";
import { accountingHistoryHash, accountingHistoryProjection } from "./accountingAuditSchema";

export const DEBT_RECORD_PREVIOUS_SCOPE_HASH = "44a3d1756efbff6c0daac6833e69375f17cfca8f8250bcf31f59736b1e7fd9e0";
const LOCAL_RECORD_ONLY_SCOPE_HASH = "1c7e86f2c4b04e0e383a377d2eee54d81716cdbea3b3b385112759bdd5ef14b3";

/** Explicit maintenance migration. Never invoked by startup or HTTP requests.
 * Retains every old cash link, amount and timestamp; only new records may omit cash.
 */
export async function migrateCashDebtRecordOnly(db: TenantSql, tenantId: string) {
  const [identityTables] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='saas_tenant_identity'");
  if ((identityTables as unknown[]).length) {
    if (await readDatabaseIdentity(db) !== tenantId) throw new Error("Company identity mismatch.");
  } else if (tenantId !== "legacy") {
    throw new Error("Company identity is required for isolated tenants.");
  }
  // The original single-company installation has no identity table. Its exact
  // legacy scope binding and reviewed hash are still mandatory below.
  const [scope] = await db.query("SELECT id,tenantId,schemaHash FROM saas_tenant_scope");
  const records = scope as { id: number; tenantId: string; schemaHash: string }[];
  if (records.length !== 1 || records[0].id !== 1 || records[0].tenantId !== tenantId
    || ![DEBT_RECORD_PREVIOUS_SCOPE_HASH, LOCAL_RECORD_ONLY_SCOPE_HASH, scopeSchemaHash].includes(records[0].schemaHash))
    throw new Error("Unreviewed repayment schema. Migration refused.");
  const projection = await accountingHistoryProjection(db);
  const before = await accountingHistoryHash(db, projection);
  await db.query(`CREATE TABLE IF NOT EXISTS agent_commission_payments (
    tenant_id varchar(63) NOT NULL DEFAULT 'legacy', id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sourceKey varchar(255) NOT NULL, agentId int NOT NULL, entryDate timestamp NOT NULL,
    cashAmount int NOT NULL, description varchar(255), createdBy int,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY agent_commission_source_unique (tenant_id,sourceKey),
    KEY agent_commission_agent_date_idx (tenant_id,agentId,entryDate),
    FOREIGN KEY (agentId) REFERENCES agents(id) ON DELETE RESTRICT,
    FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
  )`);
  // One-time historical snapshot, while writes are paused. Originals stay intact.
  // Once scope is upgraded, later journal salary entries must never be imported.
  if (records[0].schemaHash !== scopeSchemaHash) {
    await db.query(`INSERT INTO agent_commission_payments
      (tenant_id,sourceKey,agentId,entryDate,cashAmount,description,createdBy,createdAt)
      SELECT c.tenant_id,c.sourceKey,c.agentId,c.entryDate,c.cashAmount,c.description,c.createdBy,c.createdAt
      FROM cash_entries c WHERE c.tenant_id=? AND c.type='expense' AND c.category='Ойлик' AND c.agentId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM agent_commission_payments p WHERE p.tenant_id=c.tenant_id AND p.sourceKey=c.sourceKey)`, [tenantId]);
  }
  const [columns] = await db.query("SHOW COLUMNS FROM cash_journal_debt_repayments");
  const fields = columns as { Field: string; Null: string }[];
  if (!fields.some(c => c.Field === "requestId"))
    await db.query("ALTER TABLE cash_journal_debt_repayments ADD COLUMN requestId varchar(36) NULL");
  if (fields.find(c => c.Field === "cashEntryId")?.Null !== "YES")
    await db.query("ALTER TABLE cash_journal_debt_repayments MODIFY COLUMN cashEntryId int NULL");
  await applyTenantQueryScope(db, tenantId, records[0].schemaHash);
  if (before !== await accountingHistoryHash(db, projection))
    throw new Error("History mismatch; keep runtime stopped.");
  return { historyPreserved: true, before, after: before };
}
