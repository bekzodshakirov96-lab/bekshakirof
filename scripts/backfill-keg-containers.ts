import { and, eq, isNull } from "drizzle-orm";
import { containerMovements, products, transactions } from "../drizzle/schema";
import {
  containerLabel,
  normalizeContainerType,
  pairContainerCandidates,
  type ContainerType,
} from "../server/containerAccounting";
import { requireDb } from "../server/db";

const apply = process.argv.includes("--apply");

type Audit = {
  candidateTransactions: number;
  productsClassified: number;
  canonicalProductsCreated: number;
  transactionsLinkedToProduct: number;
  explicitMovementsLinked: number;
  automaticMovementsCreated: number;
  skippedAlreadyLinked: number;
  skippedInvalid: number;
  ambiguousMatches: number;
};

async function main() {
  const db = await requireDb();
  const audit: Audit = {
    candidateTransactions: 0,
    productsClassified: 0,
    canonicalProductsCreated: 0,
    transactionsLinkedToProduct: 0,
    explicitMovementsLinked: 0,
    automaticMovementsCreated: 0,
    skippedAlreadyLinked: 0,
    skippedInvalid: 0,
    ambiguousMatches: 0,
  };

  await db.transaction(async tx => {
    let productRows = await tx.select().from(products);
    for (const product of productRows) {
      const detectedType = product.containerType ?? normalizeContainerType(product.name);
      if (!detectedType || (product.containerType && product.containerUnitsPerItem > 0)) continue;
      audit.productsClassified += 1;
      if (apply) {
        await tx
          .update(products)
          .set({ containerType: detectedType, containerUnitsPerItem: product.containerUnitsPerItem || 1 })
          .where(eq(products.id, product.id));
      }
    }

    productRows = await tx.select().from(products);
    const productByType = new Map<ContainerType, (typeof productRows)[number]>();
    const usedCodes = new Set(productRows.map(item => item.code.toLocaleLowerCase()));
    for (const product of productRows) {
      const type = product.containerType ?? normalizeContainerType(product.name);
      if (type && !productByType.has(type)) productByType.set(type, product);
    }

    const transactionRows = await tx.select().from(transactions);
    const candidates = transactionRows.filter(item => normalizeContainerType(item.productName));
    audit.candidateTransactions = candidates.length;

    const transactionCandidates = [];
    const saleById = new Map(candidates.map(item => [item.id, item]));
    for (const sale of candidates) {
      const containerType = normalizeContainerType(sale.productName);
      if (!containerType || !sale.clientId) {
        audit.skippedInvalid += 1;
        continue;
      }
      const quantity = Number(sale.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        audit.skippedInvalid += 1;
        continue;
      }

      let product = sale.productId
        ? productRows.find(item => item.id === sale.productId) ?? null
        : null;
      if (!product || (product.containerType ?? normalizeContainerType(product.name)) !== containerType) {
        product = productByType.get(containerType) ?? null;
        if (!product) {
          const baseCode = containerType === "keg_30" ? "TARA-KEG30" : "TARA-KEG50";
          let code = baseCode;
          let suffix = 2;
          while (usedCodes.has(code.toLocaleLowerCase())) {
            code = `${baseCode}-${suffix}`;
            suffix += 1;
          }
          audit.canonicalProductsCreated += 1;
          if (apply) {
            const [created] = await tx
              .insert(products)
              .values({
                code,
                name: sale.productName,
                unit: sale.unit || "KEG",
                price: sale.currentPrice,
                containerType,
                containerUnitsPerItem: 1,
                isActive: true,
              })
              .$returningId();
            const [createdProduct] = await tx
              .select()
              .from(products)
              .where(eq(products.id, created.id))
              .limit(1);
            product = createdProduct;
            productRows.push(createdProduct);
            productByType.set(containerType, createdProduct);
            usedCodes.add(code.toLocaleLowerCase());
          }
        }
        audit.transactionsLinkedToProduct += 1;
        if (apply && product) {
          await tx.update(transactions).set({ productId: product.id }).where(eq(transactions.id, sale.id));
        }
      }

      const [alreadyLinked] = await tx
        .select({ id: containerMovements.id })
        .from(containerMovements)
        .where(
          and(
            eq(containerMovements.transactionId, sale.id),
            eq(containerMovements.movementType, "issued"),
            eq(containerMovements.containerType, containerLabel(containerType)),
          ),
        )
        .limit(1);
      if (alreadyLinked) {
        audit.skippedAlreadyLinked += 1;
        continue;
      }
      transactionCandidates.push({
        id: sale.id,
        sourceKey: sale.sourceKey,
        date: sale.transactionDate,
        agentId: sale.agentId,
        clientId: sale.clientId,
        containerType,
        quantity,
      });
    }

    const explicitRows = await tx
      .select()
      .from(containerMovements)
      .where(
        and(
          eq(containerMovements.movementType, "issued"),
          isNull(containerMovements.transactionId),
        ),
      );
    const explicitCandidates = explicitRows.flatMap(item => {
      const containerType = normalizeContainerType(item.containerType);
      if (!containerType || !item.clientId) return [];
      return [
        {
          id: item.id,
          sourceKey: item.sourceKey,
          date: item.movementDate,
          agentId: item.agentId,
          clientId: item.clientId,
          containerType,
          quantity: item.quantity,
        },
      ];
    });
    const pairing = pairContainerCandidates(transactionCandidates, explicitCandidates);

    audit.explicitMovementsLinked += pairing.pairs.length;
    if (apply) {
      for (const pair of pairing.pairs) {
        await tx
          .update(containerMovements)
          .set({ transactionId: pair.transaction.id })
          .where(eq(containerMovements.id, pair.movement.id));
      }
    }

    for (const candidate of pairing.unmatchedTransactions) {
      const ambiguousExplicit = pairing.unmatchedMovements.some(
        movement =>
          movement.date.toISOString().slice(0, 10) === candidate.date.toISOString().slice(0, 10) &&
          movement.clientId === candidate.clientId &&
          movement.containerType === candidate.containerType &&
          movement.quantity === candidate.quantity,
      );
      if (ambiguousExplicit) {
        audit.ambiguousMatches += 1;
        continue;
      }
      const sale = saleById.get(candidate.id);
      if (!sale) {
        audit.skippedInvalid += 1;
        continue;
      }
      audit.automaticMovementsCreated += 1;
      if (apply) {
        await tx.insert(containerMovements).values({
          sourceKey: `auto:transaction:${sale.id}:issued:${candidate.containerType}`,
          movementDate: sale.transactionDate,
          transactionId: sale.id,
          agentId: sale.agentId,
          clientId: sale.clientId,
          containerType: containerLabel(candidate.containerType),
          movementType: "issued",
          quantity: candidate.quantity,
          note: "Tarixiy KEG savdosidan avtomatik berildi",
          source: sale.source,
          isAutomatic: true,
          createdBy: sale.createdBy,
        });
      }
    }

    if (!apply) {
      tx.rollback();
    }
  }).catch(error => {
    if (!apply && error instanceof Error && error.message.includes("Rollback")) return;
    throw error;
  });

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...audit }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
