import type { RuntimeTenant } from "./config";

export interface TenantSql {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export const TENANT_IDENTITY_TABLE = "saas_tenant_identity";
export const TENANT_IDENTITY_DDL = `CREATE TABLE IF NOT EXISTS saas_tenant_identity (
  id tinyint NOT NULL PRIMARY KEY,
  tenantId varchar(63) NOT NULL,
  bindingVersion int NOT NULL,
  boundAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT saas_tenant_identity_singleton CHECK (id = 1)
)`;

export async function readDatabaseIdentity(db: TenantSql): Promise<string> {
  let rows: unknown;
  try {
    [rows] = await db.query("SELECT id, tenantId, bindingVersion FROM saas_tenant_identity");
  } catch {
    throw new Error("Company database is not bound. Run the explicit tenant database preparation command first.");
  }
  const identities = rows as { id: number; tenantId: string; bindingVersion: number }[];
  if (!Array.isArray(identities) || identities.length !== 1 || identities[0].id !== 1 || identities[0].bindingVersion !== 1) {
    throw new Error("Company database identity is invalid.");
  }
  return identities[0].tenantId;
}

export async function assertTenantDatabase(db: TenantSql, tenant: RuntimeTenant) {
  if (tenant.mode === "legacy") return;
  if (await readDatabaseIdentity(db) !== tenant.id) {
    throw new Error("Company database does not belong to this deployment. Startup refused.");
  }
}
