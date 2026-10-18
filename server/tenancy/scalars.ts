import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { clientPayments, containerMovements } from "../../drizzle/schema";
import { runtimeTenant } from "./config";
import { markTenantSql } from "./queryScope";

/** Correlated financial scalar: the inner ledger must carry its own tenant predicate. */
export function clientPaymentTotal(
  amount: SQL,
  clientId: SQLWrapper,
  tenantId = runtimeTenant.id
): SQL<number> {
  // Keep the outer table qualifier even in a single-table SELECT: Drizzle's
  // projection builder otherwise strips direct Column qualifiers inside scalars.
  const outerId = sql`${clientId}`;
  return markTenantSql(
    sql<number>`coalesce((select sum(${amount}) from ${clientPayments} cp where cp.clientId = ${outerId} and cp.tenant_id = ${tenantId}), 0)`,
    tenantId
  ) as SQL<number>;
}

export function transactionContainerColumns(
  transactionId: SQLWrapper,
  tenantId = runtimeTenant.id
) {
  const outerId = sql`${transactionId}`;
  const containerType = (movement: "issued" | "returned") =>
    markTenantSql(
      sql<
        string | null
      >`(select cm.containerType from ${containerMovements} cm where cm.transactionId = ${outerId} and cm.movementType = ${movement} and cm.tenant_id = ${tenantId} limit 1)`,
      tenantId
    ) as SQL<string | null>;
  const quantity = (movement: "issued" | "returned") =>
    (
      markTenantSql(
        sql<number>`coalesce((select sum(cm.quantity) from ${containerMovements} cm where cm.transactionId = ${outerId} and cm.movementType = ${movement} and cm.tenant_id = ${tenantId}), 0)`,
        tenantId
      ) as SQL<number>
    ).mapWith(Number);
  return {
    issuedContainerType: containerType("issued"),
    issuedContainerQuantity: quantity("issued"),
    returnedContainerType: containerType("returned"),
    returnedContainerQuantity: quantity("returned"),
  };
}
