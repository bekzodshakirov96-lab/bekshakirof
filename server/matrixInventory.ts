import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agentTakingEntries,
  agents,
  dailyProductPrices,
  matrixStockConfigs,
  matrixStockEvents,
  matrixCellWrites,
  products,
} from "../drizzle/schema";
import { assertPeriodUnlocked, logAudit } from "./auditLog";
import { tashkentDayRange, toMySqlDate } from "./businessDay";
import { tashkentBusinessDate } from "../shared/agentReconciliation";
import type { requireDb } from "./db";
import type { DatabaseTransaction } from "./stockAccounting";

type Db = Awaited<ReturnType<typeof requireDb>>;
type Tx = DatabaseTransaction;
export const inventoryQuantity = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine(
    value => Number(value.toFixed(3)) === value,
    "Miqdor 3 tagacha kasr bilan kiritiladi"
  );
const round = (value: number) => Math.round(value * 1000) / 1000;

async function lockProduct(tx: Tx, productId: number) {
  const [product] = await tx
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .for("update");
  if (!product) throw new Error("Mahsulot topilmadi.");
  return product;
}

async function post(
  tx: Tx,
  event: {
    productId: number;
    kind: "opening" | "receipt" | "receipt_reversal" | "taking";
    quantity: number;
    movementDate: Date;
    requestKey: string;
    createdBy: number | null;
    sourceEntryId?: number;
    reversesId?: number;
    note?: string;
  }
) {
  // Matrix receipts/takings are independent from the general warehouse ledger.
  const [created] = await tx
    .insert(matrixStockEvents)
    .values({ ...event, quantity: event.quantity.toFixed(3) })
    .$returningId();
  await logAudit(tx, {
    tableName: "matrix_stock_events",
    recordId: created.id,
    action: "create",
    userId: event.createdBy,
    after: event,
  });
  return created.id;
}

export async function syncTaking(
  tx: Tx,
  row: {
    id: number;
    productId: number | null;
    quantity: string;
    entryDate: Date;
  },
  userId: number | null,
  targetQuantity = Number(row.quantity)
) {
  if (!row.productId) return;
  const [config] = await tx
    .select()
    .from(matrixStockConfigs)
    .where(eq(matrixStockConfigs.productId, row.productId));
  if (!config || row.entryDate < config.effectiveDate) return;
  if (!Number.isFinite(targetQuantity) || targetQuantity < 0)
    throw new Error("Eski yozuv miqdorini tekshiring.");
  const [posted] = await tx
    .select({
      quantity:
        sql<number>`coalesce(sum(${matrixStockEvents.quantity}), 0)`.mapWith(
          Number
        ),
    })
    .from(matrixStockEvents)
    .where(
      and(
        eq(matrixStockEvents.kind, "taking"),
        eq(matrixStockEvents.sourceEntryId, row.id)
      )
    );
  const difference = round(-targetQuantity - (posted?.quantity ?? 0));
  if (difference !== 0)
    await post(tx, {
      productId: row.productId,
      kind: "taking",
      quantity: difference,
      movementDate: row.entryDate,
      sourceEntryId: row.id,
      requestKey: randomUUID(),
      createdBy: userId,
    });
}

/** Each displayed cell is an absolute NET quantity, not an incremental issue. A
 * product row lock serializes creation and compare-and-set edits across devices. */
export async function setMatrixCell(
  db: Db,
  input: {
    date: number;
    agentId: number;
    productId: number;
    quantity: number;
    expectedQuantity: number;
    expectedVersion: number;
    requestKey: string;
  },
  userId: number
) {
  await assertPeriodUnlocked(new Date(input.date));
  return db.transaction(async tx => {
    const product = await lockProduct(tx, input.productId);
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, input.agentId));
    if (!agent) throw new Error("Agent topilmadi.");
    const { start, end } = tashkentDayRange(input.date);
    const [retry] = await tx
      .select()
      .from(matrixCellWrites)
      .where(eq(matrixCellWrites.requestKey, input.requestKey));
    if (retry) {
      if (
        retry.productId !== input.productId ||
        retry.agentId !== input.agentId ||
        +retry.entryDate !== +start ||
        retry.expectedVersion !== input.expectedVersion ||
        Number(retry.expectedQuantity) !== input.expectedQuantity ||
        Number(retry.quantity) !== input.quantity ||
        retry.createdBy !== userId
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "So'rov ID boshqa tahrir uchun ishlatilgan.",
        });
      return {
        success: true,
        quantity: input.quantity,
        version: retry.id,
        replayed: true,
      };
    }
    const version = await matrixCellVersion(
      tx,
      input.productId,
      input.agentId,
      input.date
    );
    const rows = await tx
      .select()
      .from(agentTakingEntries)
      .where(
        and(
          eq(agentTakingEntries.agentId, input.agentId),
          eq(agentTakingEntries.productId, input.productId),
          gte(agentTakingEntries.entryDate, start),
          lte(agentTakingEntries.entryDate, end)
        )
      )
      .orderBy(asc(agentTakingEntries.id));
    const current = round(
      rows.reduce((sum, row) => sum + Number(row.quantity), 0)
    );
    if (version !== input.expectedVersion || current !== input.expectedQuantity)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Bu katak boshqa oynada o'zgargan. Jadval yangilandi; miqdorni tekshirib qayta kiriting.",
      });
    if (rows.length > 1)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Bu katakda eski takroriy yozuvlar bor. Ularni tekshirmasdan o'zgartirib bo'lmaydi.",
      });
    const existing = rows[0];
    if (input.quantity === current) {
      // Still record the accepted request; a retry must never be a later edit.
    } else if (input.quantity === 0 && existing) {
      await syncTaking(tx, existing, userId, 0);
      await logAudit(tx, {
        tableName: "agent_taking_entries",
        recordId: existing.id,
        action: "delete",
        userId,
        before: existing,
      });
      await tx
        .delete(agentTakingEntries)
        .where(eq(agentTakingEntries.id, existing.id));
    } else if (existing) {
      const amount = Math.round(input.quantity * existing.unitPrice);
      await tx
        .update(agentTakingEntries)
        .set({
          entryDate: existing.entryDate,
          quantity: input.quantity.toFixed(3),
          amount,
        })
        .where(eq(agentTakingEntries.id, existing.id));
      await syncTaking(tx, existing, userId, input.quantity);
      await logAudit(tx, {
        tableName: "agent_taking_entries",
        recordId: existing.id,
        action: "update",
        userId,
        before: existing,
        after: { quantity: input.quantity, amount },
      });
    } else if (input.quantity > 0) {
      const [override] = await tx
        .select()
        .from(dailyProductPrices)
        .where(
          and(
            eq(dailyProductPrices.productId, product.id),
            gte(dailyProductPrices.entryDate, start),
            lte(dailyProductPrices.entryDate, end)
          )
        )
        .limit(1);
      const unitPrice = override?.unitPrice ?? product.price;
      const data = {
        entryDate: new Date(input.date),
        agentId: input.agentId,
        productId: product.id,
        productName: product.name,
        unitPrice,
        quantity: input.quantity.toFixed(3),
        amount: Math.round(input.quantity * unitPrice),
        createdBy: userId,
      };
      const [created] = await tx
        .insert(agentTakingEntries)
        .values(data)
        .$returningId();
      await syncTaking(tx, { id: created.id, ...data }, userId);
      await logAudit(tx, {
        tableName: "agent_taking_entries",
        recordId: created.id,
        action: "create",
        userId,
        after: data,
      });
    }
    const newVersion = await recordMatrixCellWrite(tx, {
      ...input,
      entryDate: start,
      createdBy: userId,
    });
    return { success: true, quantity: input.quantity, version: newVersion };
  });
}

export async function matrixCellVersion(
  tx: Tx | Db,
  productId: number,
  agentId: number,
  date: number
) {
  const { start } = tashkentDayRange(date);
  const [row] = await tx
    .select({
      version: sql<number>`coalesce(max(${matrixCellWrites.id}), 0)`.mapWith(
        Number
      ),
    })
    .from(matrixCellWrites)
    .where(
      and(
        eq(matrixCellWrites.productId, productId),
        eq(matrixCellWrites.agentId, agentId),
        eq(matrixCellWrites.entryDate, start)
      )
    );
  return row?.version ?? 0;
}

export async function matrixCellVersions(db: Db, date: number) {
  const { start } = tashkentDayRange(date);
  return db
    .select({
      productId: matrixCellWrites.productId,
      agentId: matrixCellWrites.agentId,
      version: sql<number>`max(${matrixCellWrites.id})`.mapWith(Number),
    })
    .from(matrixCellWrites)
    .where(eq(matrixCellWrites.entryDate, start))
    .groupBy(matrixCellWrites.productId, matrixCellWrites.agentId);
}

export async function recordMatrixCellWrite(
  tx: Tx,
  input: {
    productId: number;
    agentId: number;
    entryDate: Date;
    quantity: number;
    expectedQuantity: number;
    expectedVersion: number;
    requestKey: string;
    createdBy: number;
  }
) {
  const [row] = await tx
    .insert(matrixCellWrites)
    .values({
      ...input,
      entryDate: tashkentDayRange(+input.entryDate).start,
      quantity: input.quantity.toFixed(3),
      expectedQuantity: input.expectedQuantity.toFixed(3),
    })
    .$returningId();
  return row.id;
}

/** Legacy mutation callers still synchronize configured products. New matrix UI
 * uses setMatrixCell, which additionally rejects stale browser state. */
export async function syncLegacyTaking(
  db: Db,
  id: number,
  userId: number,
  quantity?: number
) {
  const [source] = await db
    .select()
    .from(agentTakingEntries)
    .where(eq(agentTakingEntries.id, id));
  if (!source) throw new Error("Yozuv topilmadi.");
  return db.transaction(async tx => {
    if (source.productId) await lockProduct(tx, source.productId);
    const [row] = await tx
      .select()
      .from(agentTakingEntries)
      .where(eq(agentTakingEntries.id, id));
    if (!row) throw new Error("Yozuv topilmadi.");
    await assertPeriodUnlocked(row.entryDate);
    await syncTaking(tx, row, userId, quantity ?? Number(row.quantity));
    if (quantity !== undefined) {
      if (row.productId)
        await recordMatrixCellWrite(tx, {
          productId: row.productId,
          agentId: row.agentId,
          entryDate: row.entryDate,
          quantity,
          expectedQuantity: Number(row.quantity),
          expectedVersion: await matrixCellVersion(
            tx,
            row.productId,
            row.agentId,
            +row.entryDate
          ),
          requestKey: randomUUID(),
          createdBy: userId,
        });
      await logAudit(tx, {
        tableName: "agent_taking_entries",
        recordId: id,
        action: quantity === 0 ? "delete" : "update",
        userId,
        before: row,
        after: { quantity },
      });
      if (quantity === 0)
        await tx
          .delete(agentTakingEntries)
          .where(eq(agentTakingEntries.id, id));
      else
        await tx
          .update(agentTakingEntries)
          .set({
            entryDate: row.entryDate,
            quantity: quantity.toFixed(3),
            amount: Math.round(quantity * row.unitPrice),
          })
          .where(eq(agentTakingEntries.id, id));
    }
    return {
      success: true,
      amount: Math.round((quantity ?? Number(row.quantity)) * row.unitPrice),
    };
  });
}

export async function activateMatrixStock(
  db: Db,
  input: { productId: number; date: number; openingQuantity: number },
  userId: number
) {
  const { start } = tashkentDayRange(input.date);
  if (tashkentBusinessDate(start) < tashkentBusinessDate(new Date()))
    throw new Error("Boshlash sanasi bugungi yoki kelgusi kun bo'lishi kerak.");
  await assertPeriodUnlocked(start);
  return db.transaction(async tx => {
    await lockProduct(tx, input.productId);
    const [existing] = await tx
      .select()
      .from(matrixStockConfigs)
      .where(eq(matrixStockConfigs.productId, input.productId));
    if (existing) {
      if (
        +existing.effectiveDate === +start &&
        Number(existing.openingQuantity) === input.openingQuantity
      )
        return { success: true };
      throw new Error(
        "Bu mahsulot uchun boshlang'ich qoldiq allaqachon tasdiqlangan."
      );
    }
    await tx.insert(matrixStockConfigs).values({
      productId: input.productId,
      effectiveDate: start,
      openingQuantity: input.openingQuantity.toFixed(3),
      createdBy: userId,
    });
    await post(tx, {
      productId: input.productId,
      kind: "opening",
      quantity: input.openingQuantity,
      movementDate: start,
      requestKey: randomUUID(),
      createdBy: userId,
      note: `Kun boshidagi sanab tasdiqlangan qoldiq: ${input.openingQuantity}`,
    });
    const rows = await tx
      .select()
      .from(agentTakingEntries)
      .where(
        and(
          eq(agentTakingEntries.productId, input.productId),
          gte(agentTakingEntries.entryDate, start)
        )
      );
    for (const row of rows) await syncTaking(tx, row, userId);
    return { success: true };
  });
}

export async function addMatrixReceipt(
  db: Db,
  input: {
    productId: number;
    date: number;
    quantity: number;
    requestKey: string;
    note?: string;
  },
  userId: number
) {
  await assertPeriodUnlocked(new Date(input.date));
  return db.transaction(async tx => {
    await lockProduct(tx, input.productId);
    const [config] = await tx
      .select()
      .from(matrixStockConfigs)
      .where(eq(matrixStockConfigs.productId, input.productId));
    if (!config || new Date(input.date) < config.effectiveDate)
      throw new Error(
        "Avval shu mahsulotning boshlang'ich qoldig'ini tasdiqlang va boshlash sanasini tekshiring."
      );
    const [existing] = await tx
      .select()
      .from(matrixStockEvents)
      .where(eq(matrixStockEvents.requestKey, input.requestKey));
    if (existing) {
      if (
        existing.kind !== "receipt" ||
        existing.productId !== input.productId ||
        Number(existing.quantity) !== input.quantity ||
        +existing.movementDate !== input.date ||
        (existing.note ?? "") !== (input.note ?? "")
      )
        throw new Error("So'rov ID boshqa kirim uchun ishlatilgan.");
      return { success: true, id: existing.id };
    }
    const id = await post(tx, {
      productId: input.productId,
      kind: "receipt",
      quantity: input.quantity,
      movementDate: new Date(input.date),
      requestKey: input.requestKey,
      note: input.note,
      createdBy: userId,
    });
    return { success: true, id };
  });
}

export async function reverseMatrixReceipt(
  db: Db,
  id: number,
  reason: string,
  userId: number
) {
  const [initial] = await db
    .select()
    .from(matrixStockEvents)
    .where(eq(matrixStockEvents.id, id));
  if (!initial || initial.kind !== "receipt")
    throw new Error("Prixod topilmadi.");
  return db.transaction(async tx => {
    await lockProduct(tx, initial.productId);
    await assertPeriodUnlocked(initial.movementDate);
    const [reversed] = await tx
      .select()
      .from(matrixStockEvents)
      .where(eq(matrixStockEvents.reversesId, id));
    if (reversed) return { success: true };
    await post(tx, {
      productId: initial.productId,
      kind: "receipt_reversal",
      quantity: -Number(initial.quantity),
      movementDate: initial.movementDate,
      reversesId: id,
      requestKey: randomUUID(),
      note: reason,
      createdBy: userId,
    });
    return { success: true };
  });
}

export async function matrixStockDay(db: Db, date: number) {
  const { start, end } = tashkentDayRange(date);
  return db.transaction(
    async tx => {
      const configs = await tx.select().from(matrixStockConfigs);
      const balances = await tx.select({
        productId: matrixStockEvents.productId,
        opening: sql<number>`coalesce(sum(case when ${matrixStockEvents.movementDate} < ${toMySqlDate(start)} then ${matrixStockEvents.quantity} else 0 end),0)`.mapWith(Number),
        closing: sql<number>`coalesce(sum(${matrixStockEvents.quantity}),0)`.mapWith(Number),
      }).from(matrixStockEvents)
        .innerJoin(matrixStockConfigs,eq(matrixStockConfigs.productId,matrixStockEvents.productId))
        .where(and(lte(matrixStockEvents.movementDate,end),
          gte(matrixStockEvents.movementDate,matrixStockConfigs.effectiveDate),
          sql`${matrixStockEvents.kind} <> 'opening'`))
        .groupBy(matrixStockEvents.productId);
      const receipts = await tx
        .select({
          productId: matrixStockEvents.productId,
          quantity:
            sql<number>`coalesce(sum(${matrixStockEvents.quantity}), 0)`.mapWith(
              Number
            ),
        })
        .from(matrixStockEvents)
        .where(
          and(
            gte(matrixStockEvents.movementDate, start),
            lte(matrixStockEvents.movementDate, end),
            sql`${matrixStockEvents.kind} in ('receipt','receipt_reversal')`
          )
        )
        .groupBy(matrixStockEvents.productId);
      return configs.map(config => ({
        productId: config.productId,
        effectiveDate: config.effectiveDate,
        active: config.effectiveDate <= end,
        opening: round(
          config.effectiveDate > end ? 0 : +config.effectiveDate === +start
            ? Number(config.openingQuantity)
            : Number(config.openingQuantity) + (balances.find(row => row.productId === config.productId)?.opening ?? 0)
        ),
        closing: round(
          config.effectiveDate > end ? 0 : Number(config.openingQuantity) + (balances.find(row => row.productId === config.productId)?.closing ?? 0)
        ),
        received: round(
          receipts.find(row => row.productId === config.productId)?.quantity ??
            0
        ),
      }));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}

export async function matrixReceiptHistory(
  db: Db,
  input: { productId: number; date: number; page: number }
) {
  const { start, end } = tashkentDayRange(input.date);
  const where = and(
    eq(matrixStockEvents.productId, input.productId),
    gte(matrixStockEvents.movementDate, start),
    lte(matrixStockEvents.movementDate, end),
    sql`${matrixStockEvents.kind} in ('receipt','receipt_reversal')`
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(matrixStockEvents)
    .where(where);
  const pageCount = Math.max(1, Math.ceil((count?.total ?? 0) / 10));
  const page = Math.min(input.page, pageCount);
  const items = await db
    .select()
    .from(matrixStockEvents)
    .where(where)
    .orderBy(desc(matrixStockEvents.id))
    .limit(10)
    .offset((page - 1) * 10);
  const reversals = await db
    .select({ reversesId: matrixStockEvents.reversesId })
    .from(matrixStockEvents)
    .where(
      and(
        eq(matrixStockEvents.productId, input.productId),
        eq(matrixStockEvents.kind, "receipt_reversal")
      )
    );
  return {
    items: items.map(row => ({
      ...row,
      reversed: reversals.some(reversal => reversal.reversesId === row.id),
    })),
    page,
    pageCount,
  };
}
