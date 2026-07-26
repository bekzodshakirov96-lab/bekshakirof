import { TRPCError } from "@trpc/server";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { containerMovements } from "../drizzle/schema";
import type { getDb } from "./db";

export type ContainerType = "keg_30" | "keg_50";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const CONTAINER_LABELS: Record<ContainerType, string> = {
  keg_30: "KEG 30",
  keg_50: "KEG 50",
};

export function normalizeContainerType(value: string | null | undefined): ContainerType | null {
  if (!value) return null;
  const normalized = value
    .toLocaleLowerCase("uz-Latn")
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim();
  const isKeg = /(^|\s)(keg|кег)(\s|$)/i.test(normalized) || /razliv|разлив/i.test(normalized);
  if (!isKeg) return null;
  if (/(^|\s)30(\s|$)/.test(normalized)) return "keg_30";
  if (/(^|\s)50(\s|$)/.test(normalized)) return "keg_50";
  return null;
}

export function containerLabel(type: ContainerType): string {
  return CONTAINER_LABELS[type];
}

export function calculateIssuedContainerQuantity(
  productQuantity: number,
  unitsPerItem: number,
): number {
  const calculated = productQuantity * unitsPerItem;
  if (!Number.isInteger(calculated) || calculated < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "KEG mahsuloti miqdori butun tara sonini berishi kerak.",
    });
  }
  return calculated;
}

export type ContainerMatchCandidate<TId extends number | string = number> = {
  id: TId;
  sourceKey: string;
  date: Date;
  agentId: number | null;
  clientId: number;
  containerType: ContainerType;
  quantity: number;
};

function containerMatchKey(candidate: ContainerMatchCandidate<number | string>): string {
  return [
    candidate.date.toISOString().slice(0, 10),
    candidate.agentId ?? 0,
    candidate.clientId,
    candidate.containerType,
    candidate.quantity,
  ].join(":");
}

export function pairContainerCandidates<
  TTransactionId extends number | string,
  TMovementId extends number | string,
>(
  transactionCandidates: ContainerMatchCandidate<TTransactionId>[],
  movementCandidates: ContainerMatchCandidate<TMovementId>[],
): {
  pairs: Array<{
    transaction: ContainerMatchCandidate<TTransactionId>;
    movement: ContainerMatchCandidate<TMovementId>;
  }>;
  unmatchedTransactions: ContainerMatchCandidate<TTransactionId>[];
  unmatchedMovements: ContainerMatchCandidate<TMovementId>[];
} {
  const transactionGroups = new Map<string, ContainerMatchCandidate<TTransactionId>[]>();
  const movementGroups = new Map<string, ContainerMatchCandidate<TMovementId>[]>();
  for (const candidate of transactionCandidates) {
    const key = containerMatchKey(candidate);
    transactionGroups.set(key, [...(transactionGroups.get(key) ?? []), candidate]);
  }
  for (const candidate of movementCandidates) {
    const key = containerMatchKey(candidate);
    movementGroups.set(key, [...(movementGroups.get(key) ?? []), candidate]);
  }

  const pairs: Array<{
    transaction: ContainerMatchCandidate<TTransactionId>;
    movement: ContainerMatchCandidate<TMovementId>;
  }> = [];
  const unmatchedTransactions: ContainerMatchCandidate<TTransactionId>[] = [];
  const unmatchedMovements: ContainerMatchCandidate<TMovementId>[] = [];
  const groupKeys = new Set([
    ...Array.from(transactionGroups.keys()),
    ...Array.from(movementGroups.keys()),
  ]);

  for (const key of Array.from(groupKeys).sort()) {
    const transactionsForKey = [...(transactionGroups.get(key) ?? [])].sort((a, b) =>
      a.sourceKey.localeCompare(b.sourceKey),
    );
    const movementsForKey = [...(movementGroups.get(key) ?? [])].sort((a, b) =>
      a.sourceKey.localeCompare(b.sourceKey),
    );
    const pairCount = Math.min(transactionsForKey.length, movementsForKey.length);
    for (let index = 0; index < pairCount; index += 1) {
      pairs.push({ transaction: transactionsForKey[index], movement: movementsForKey[index] });
    }
    unmatchedTransactions.push(...transactionsForKey.slice(pairCount));
    unmatchedMovements.push(...movementsForKey.slice(pairCount));
  }

  return { pairs, unmatchedTransactions, unmatchedMovements };
}

export async function getClientContainerBalance(
  tx: DatabaseTransaction,
  clientId: number,
  type: ContainerType,
  excludeTransactionId?: number,
): Promise<number> {
  const excludeCurrent = excludeTransactionId
    ? or(isNull(containerMovements.transactionId), ne(containerMovements.transactionId, excludeTransactionId))
    : undefined;
  // `containerType` has historically been stored both as the raw enum ("keg_30") and as the
  // display label ("KEG 30") depending on which code path wrote the row, so filter by the
  // normalized type in JS rather than matching only one stored format.
  const rows = await tx
    .select({
      containerType: containerMovements.containerType,
      movementType: containerMovements.movementType,
      quantity: containerMovements.quantity,
    })
    .from(containerMovements)
    .where(and(eq(containerMovements.clientId, clientId), excludeCurrent));
  return rows.reduce((balance, row) => {
    if (normalizeContainerType(row.containerType) !== type) return balance;
    return balance + (row.movementType === "issued" ? row.quantity : -row.quantity);
  }, 0);
}

export type ReconcileContainerInput = {
  transactionId: number;
  movementDate: Date;
  agentId: number;
  clientId: number;
  productContainerType: ContainerType | null;
  productQuantity: number;
  containerUnitsPerItem: number;
  returnContainerType?: ContainerType | null;
  returnQuantity?: number;
  createdBy: number | null;
  source: "manual" | "excel";
};

export type ContainerImpact = {
  issuedType: ContainerType | null;
  issuedQuantity: number;
  returnedType: ContainerType | null;
  returnedQuantity: number;
};

export async function reconcileTransactionContainers(
  tx: DatabaseTransaction,
  input: ReconcileContainerInput,
): Promise<ContainerImpact> {
  const issuedType = input.productContainerType;
  const issuedQuantity = issuedType
    ? calculateIssuedContainerQuantity(input.productQuantity, input.containerUnitsPerItem)
    : 0;
  const returnedType = input.returnContainerType ?? null;
  const returnedQuantity = Math.max(0, Math.round(input.returnQuantity ?? 0));

  if ((returnedQuantity > 0 && !returnedType) || (returnedType && returnedQuantity <= 0)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Qaytgan tara turi va miqdorini birga kiriting.",
    });
  }

  if (returnedType && returnedQuantity > 0) {
    const currentBalance = await getClientContainerBalance(
      tx,
      input.clientId,
      returnedType,
      input.transactionId,
    );
    const available = currentBalance + (issuedType === returnedType ? issuedQuantity : 0);
    if (returnedQuantity > available) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${containerLabel(returnedType)} qaytarish miqdori mavjud ${Math.max(0, available)} dona qoldiqdan oshmasligi kerak.`,
      });
    }
  }

  await tx
    .delete(containerMovements)
    .where(
      and(
        eq(containerMovements.transactionId, input.transactionId),
        eq(containerMovements.isAutomatic, true),
      ),
    );

  if (issuedType && issuedQuantity > 0) {
    await tx.insert(containerMovements).values({
      sourceKey: `auto:transaction:${input.transactionId}:issued:${issuedType}`,
      movementDate: input.movementDate,
      transactionId: input.transactionId,
      agentId: input.agentId,
      clientId: input.clientId,
      containerType: containerLabel(issuedType),
      movementType: "issued",
      quantity: issuedQuantity,
      note: "KEG mahsuloti savdosidan avtomatik berildi",
      source: input.source,
      isAutomatic: true,
      createdBy: input.createdBy,
    });
  }

  if (returnedType && returnedQuantity > 0) {
    await tx.insert(containerMovements).values({
      sourceKey: `auto:transaction:${input.transactionId}:returned:${returnedType}`,
      movementDate: input.movementDate,
      transactionId: input.transactionId,
      agentId: input.agentId,
      clientId: input.clientId,
      containerType: containerLabel(returnedType),
      movementType: "returned",
      quantity: returnedQuantity,
      note: "Savdo operatsiyasida mijozdan tara qaytdi",
      source: input.source,
      isAutomatic: true,
      createdBy: input.createdBy,
    });
  }

  return { issuedType, issuedQuantity, returnedType, returnedQuantity };
}
