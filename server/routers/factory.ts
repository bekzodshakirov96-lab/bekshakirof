import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { containerMovements, factoryOperations, products, stockMovements } from "../../drizzle/schema";
import { skladProcedure } from "../access";
import { normalizeContainerType } from "../containerAccounting";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

const operationTypeSchema = z.enum(["tara_sent", "filled_received", "brak_returned", "brak_replaced"]);

const stockImpact: Record<z.infer<typeof operationTypeSchema>, { movementType: "in" | "out"; reason: string } | null> = {
  tara_sent: null,
  filled_received: { movementType: "in", reason: "Zavoddan to'la keg qabul qilindi" },
  brak_returned: { movementType: "out", reason: "Brak — zavodga qaytarildi" },
  brak_replaced: { movementType: "in", reason: "Brak o'rniga zavoddan qabul qilindi" },
};

export const factoryRouter = router({
  /** Faol KEG mahsulotlari bo'yicha joriy balanslar: bizning omborimizdagi bo'sh tara,
   * zavodda kutilayotgan to'la tara va brak evaziga kutilayotgan keg soni. */
  balances: skladProcedure.query(async () => {
    const db = await requireDb();
    const productRows = await db
      .select({ id: products.id, name: products.name, containerType: products.containerType })
      .from(products)
      .where(sql`${products.isActive} = 1 and ${products.containerType} is not null`);
    const sumRows = await db
      .select({
        productId: factoryOperations.productId,
        operationType: factoryOperations.operationType,
        total: sql<number>`coalesce(sum(${factoryOperations.quantity}), 0)`.mapWith(Number),
      })
      .from(factoryOperations)
      .groupBy(factoryOperations.productId, factoryOperations.operationType);
    const totals = new Map<string, number>();
    for (const row of sumRows) totals.set(`${row.productId}:${row.operationType}`, row.total);

    // Mijozlardan qaytgan bo'sh tara — zavodga qayta yuborilgunga qadar bizning omborimizda hisoblanadi.
    // containerType tarixan ham "keg_30", ham "KEG 30" ko'rinishida yozilgan, shuning uchun normalize qilinadi.
    const containerRows = await db
      .select({ containerType: containerMovements.containerType, movementType: containerMovements.movementType, quantity: containerMovements.quantity })
      .from(containerMovements);
    const returnedByType = new Map<string, number>();
    for (const row of containerRows) {
      if (row.movementType !== "returned") continue;
      const type = normalizeContainerType(row.containerType);
      if (!type) continue;
      returnedByType.set(type, (returnedByType.get(type) ?? 0) + row.quantity);
    }

    return productRows.map(product => {
      const taraSent = totals.get(`${product.id}:tara_sent`) ?? 0;
      const filledReceived = totals.get(`${product.id}:filled_received`) ?? 0;
      const brakReturned = totals.get(`${product.id}:brak_returned`) ?? 0;
      const brakReplaced = totals.get(`${product.id}:brak_replaced`) ?? 0;
      const returnedFromClients = product.containerType ? returnedByType.get(product.containerType) ?? 0 : 0;
      return {
        productId: product.id,
        productName: product.name,
        warehouseTara: Math.max(0, returnedFromClients - taraSent),
        taraPending: taraSent - filledReceived,
        brakPending: brakReturned - brakReplaced,
      };
    });
  }),
  /** Zavod operatsiyalari tarixi, so'nggi birinchi. */
  operations: skladProcedure
    .input(
      z.object({
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().min(10).max(100).default(25),
      }),
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const items = await db
        .select({
          id: factoryOperations.id,
          operationDate: factoryOperations.operationDate,
          operationType: factoryOperations.operationType,
          productId: factoryOperations.productId,
          productName: products.name,
          quantity: factoryOperations.quantity,
          note: factoryOperations.note,
        })
        .from(factoryOperations)
        .leftJoin(products, eq(factoryOperations.productId, products.id))
        .orderBy(desc(factoryOperations.operationDate), desc(factoryOperations.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [{ total }] = await db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(factoryOperations);
      return { items, total, page: input.page, pageCount: Math.max(1, Math.ceil(total / input.pageSize)) };
    }),
  /** Bitta operatsiya yozadi (tara yuborish / to'la qabul qilish / brak qaytarish / brak evaziga qabul qilish).
   * Kerak bo'lganda tegishli Sklad kirim/chiqim yozuvini avtomatik yaratadi. */
  record: skladProcedure
    .input(
      z.object({
        operationType: operationTypeSchema,
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(100_000),
        operationDate: z.number().int(),
        note: z.string().trim().max(1_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
      if (!product) throw new Error("Mahsulot topilmadi.");
      const operationDate = new Date(input.operationDate);
      const impact = stockImpact[input.operationType];
      await db.transaction(async tx => {
        let stockMovementId: number | null = null;
        if (impact) {
          const [movement] = await tx
            .insert(stockMovements)
            .values({
              productId: input.productId,
              movementType: impact.movementType,
              quantity: String(input.quantity),
              reason: impact.reason,
              isAutomatic: true,
              movementDate: operationDate,
              note: input.note,
              createdBy: ctx.user.id,
            })
            .$returningId();
          stockMovementId = movement.id;
        }
        await tx.insert(factoryOperations).values({
          operationDate,
          operationType: input.operationType,
          productId: input.productId,
          quantity: input.quantity,
          note: input.note,
          stockMovementId,
          createdBy: ctx.user.id,
        });
      });
      return { success: true };
    }),
  /** Yozuvni o'chiradi — bog'langan avtomatik Sklad harakati (agar mavjud bo'lsa) ham birga o'chadi. */
  delete: skladProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const db = await requireDb();
    const [existing] = await db
      .select({ id: factoryOperations.id, stockMovementId: factoryOperations.stockMovementId })
      .from(factoryOperations)
      .where(eq(factoryOperations.id, input.id))
      .limit(1);
    if (!existing) throw new Error("Yozuv topilmadi yoki allaqachon o'chirilgan.");
    await db.transaction(async tx => {
      await tx.delete(factoryOperations).where(eq(factoryOperations.id, input.id));
      if (existing.stockMovementId) await tx.delete(stockMovements).where(eq(stockMovements.id, existing.stockMovementId));
    });
    return { success: true };
  }),
});
