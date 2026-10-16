import { assertSameBusinessData, snapshotBusinessData, type DatabaseSnapshot } from "./audit";
import { readDatabaseIdentity, TENANT_IDENTITY_DDL, type TenantSql } from "./database";

/** Explicit, additive preparation. It never updates/deletes any business row. */
export async function bindTenantDatabase(db: TenantSql, tenantId: string, baseline: DatabaseSnapshot) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(tenantId)) throw new Error("Invalid company ID.");
  const before = await snapshotBusinessData(db);
  if (!before.tables.some(table => table.name === "users")) throw new Error("Business schema is missing. Prepare the schema before binding.");
  assertSameBusinessData(baseline, before);
  await db.query(TENANT_IDENTITY_DDL);
  const [rows] = await db.query("SELECT id, tenantId, bindingVersion FROM saas_tenant_identity");
  if ((rows as unknown[]).length) {
    if (await readDatabaseIdentity(db) !== tenantId) throw new Error("Database already belongs to another company. Rebinding is forbidden.");
  } else {
    try {
      await db.query("INSERT INTO saas_tenant_identity (id, tenantId, bindingVersion) VALUES (1, ?, 1)", [tenantId]);
    } catch (error) {
      // Concurrent preparation is safe only when the winner bound the same company.
      if (await readDatabaseIdentity(db) !== tenantId) throw error;
    }
  }
  const after = await snapshotBusinessData(db);
  assertSameBusinessData(baseline, after);
  return after;
}
