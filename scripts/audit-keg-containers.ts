import { containerMovements, transactions } from "../drizzle/schema";
import { normalizeContainerType } from "../server/containerAccounting";
import { requireDb } from "../server/db";

async function main() {
  const db = await requireDb();
  const includeDetails = process.argv.includes("--details");
  const [sales, movements] = await Promise.all([
    db.select().from(transactions),
    db.select().from(containerMovements),
  ]);
  const kegSales = sales.filter(item => normalizeContainerType(item.productName));
  const rows = kegSales.map(sale => {
    const containerType = normalizeContainerType(sale.productName)!;
    const linked = movements.filter(item => item.transactionId === sale.id);
    const issuedQuantity = linked
      .filter(item => item.movementType === "issued")
      .reduce((sum, item) => sum + item.quantity, 0);
    const returnedQuantity = linked
      .filter(item => item.movementType === "returned")
      .reduce((sum, item) => sum + item.quantity, 0);
    const saleQuantity = Number(sale.quantity);
    return {
      transactionId: sale.id,
      transactionDate: sale.transactionDate.toISOString(),
      productName: sale.productName,
      containerType,
      agentId: sale.agentId,
      clientId: sale.clientId,
      saleQuantity,
      issuedQuantity,
      returnedQuantity,
      netContainerDebt: issuedQuantity - returnedQuantity,
      linkedMovementIds: linked.map(item => item.id),
      status: issuedQuantity === saleQuantity ? "matched" : "mismatch",
    };
  });
  const linkedMovementIds = new Set(rows.flatMap(item => item.linkedMovementIds));
  const unlinkedIssuedMovements = movements.filter(
    item =>
      item.movementType === "issued" &&
      item.transactionId === null &&
      normalizeContainerType(item.containerType),
  );
  const dateKey = (value: Date) => value.toISOString().slice(0, 10);
  const ambiguousUnlinkedIssued = unlinkedIssuedMovements.filter(movement => {
    const movementType = normalizeContainerType(movement.containerType);
    return rows.some(
      sale =>
        sale.clientId === movement.clientId &&
        sale.agentId === movement.agentId &&
        sale.containerType === movementType &&
        sale.saleQuantity === movement.quantity &&
        dateKey(new Date(sale.transactionDate)) === dateKey(movement.movementDate),
    );
  });
  const independentHistoryIssued = unlinkedIssuedMovements.filter(
    movement => !ambiguousUnlinkedIssued.some(ambiguous => ambiguous.id === movement.id),
  );
  const duplicateTransactionLinks = movements
    .filter(item => item.transactionId !== null)
    .reduce<Record<string, number>>((result, item) => {
      const key = `${item.transactionId}:${item.movementType}:${item.containerType}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
  const duplicateKeys = Object.entries(duplicateTransactionLinks)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
  const balanceMap = new Map<
    string,
    {
      clientId: number;
      containerType: string;
      linkedIssued: number;
      linkedReturned: number;
      independentIssued: number;
      independentReturned: number;
      totalIssued: number;
      totalReturned: number;
    }
  >();
  for (const movement of movements) {
    const containerType = normalizeContainerType(movement.containerType);
    if (!containerType || !movement.clientId) continue;
    const key = `${movement.clientId}:${containerType}`;
    const current = balanceMap.get(key) ?? {
      clientId: movement.clientId,
      containerType,
      linkedIssued: 0,
      linkedReturned: 0,
      independentIssued: 0,
      independentReturned: 0,
      totalIssued: 0,
      totalReturned: 0,
    };
    const linked = movement.transactionId !== null;
    if (movement.movementType === "issued") {
      current.totalIssued += movement.quantity;
      if (linked) current.linkedIssued += movement.quantity;
      else current.independentIssued += movement.quantity;
    } else {
      current.totalReturned += movement.quantity;
      if (linked) current.linkedReturned += movement.quantity;
      else current.independentReturned += movement.quantity;
    }
    balanceMap.set(key, current);
  }
  const balanceReconciliation = Array.from(balanceMap.values()).map(item => {
    const totalBalance = item.totalIssued - item.totalReturned;
    const componentBalance =
      item.linkedIssued -
      item.linkedReturned +
      item.independentIssued -
      item.independentReturned;
    return {
      ...item,
      totalBalance,
      componentBalance,
      reconciliationDifference: totalBalance - componentBalance,
    };
  });
  const criteria = {
    allKegSalesMatched: rows.every(item => item.status === "matched"),
    noDuplicateTransactionMovementKeys: duplicateKeys.length === 0,
    noAmbiguousUnlinkedIssuedMovements: ambiguousUnlinkedIssued.length === 0,
    allClientContainerBalancesReconcile: balanceReconciliation.every(
      item => item.reconciliationDifference === 0,
    ),
  };
  const auditStatus = Object.values(criteria).every(Boolean) ? "pass" : "fail";

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary: {
          auditStatus,
          kegSales: rows.length,
          matchedSales: rows.filter(item => item.status === "matched").length,
          mismatchedSales: rows.filter(item => item.status === "mismatch").length,
          linkedMovements: linkedMovementIds.size,
          unlinkedExplicitIssuedMovements: unlinkedIssuedMovements.length,
          independentHistoryIssuedMovements: independentHistoryIssued.length,
          ambiguousUnlinkedIssuedMovements: ambiguousUnlinkedIssued.length,
          duplicateTransactionMovementKeys: duplicateKeys.length,
          clientContainerBalances: balanceReconciliation.length,
          reconciliationMismatches: balanceReconciliation.filter(
            item => item.reconciliationDifference !== 0,
          ).length,
        },
        criteria,
        rows,
        balanceReconciliation,
        ...(includeDetails
          ? {
              unlinkedExplicitIssuedMovementIds: unlinkedIssuedMovements.map(item => item.id),
              independentHistoryIssuedMovementIds: independentHistoryIssued.map(item => item.id),
              ambiguousUnlinkedIssuedMovementIds: ambiguousUnlinkedIssued.map(item => item.id),
              duplicateKeys,
            }
          : {}),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
