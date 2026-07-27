import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { bottleMovements, containerMovements, factoryOperations, products, stockMovements } from "../../drizzle/schema";
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
  /** Akt sverka uchun: davr boshidagi va oxiridagi taraPending/brakPending balanslari (har bir KEG
   * turi bo'yicha) + davr ichidagi to'liq operatsiyalar ro'yxati, har bir qatordan keyingi joriy
   * balans bilan. Bo'sh from/to — butun tarix. */
  statement: skladProcedure
    .input(z.object({ from: z.number().int().optional(), to: z.number().int().optional() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const productRows = await db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(sql`${products.isActive} = 1 and ${products.containerType} is not null`)
        .orderBy(asc(products.name));

      const fromDate = input.from ? new Date(input.from) : undefined;
      const toDate = input.to ? new Date(input.to) : undefined;

      const openingRows = fromDate
        ? await db
            .select({
              productId: factoryOperations.productId,
              operationType: factoryOperations.operationType,
              total: sql<number>`coalesce(sum(${factoryOperations.quantity}), 0)`.mapWith(Number),
            })
            .from(factoryOperations)
            .where(lt(factoryOperations.operationDate, fromDate))
            .groupBy(factoryOperations.productId, factoryOperations.operationType)
        : [];
      const openingTotals = new Map<string, number>();
      for (const row of openingRows) openingTotals.set(`${row.productId}:${row.operationType}`, row.total);

      const running = new Map<number, { taraPending: number; brakPending: number }>();
      for (const product of productRows) {
        const taraSent = openingTotals.get(`${product.id}:tara_sent`) ?? 0;
        const filledReceived = openingTotals.get(`${product.id}:filled_received`) ?? 0;
        const brakReturned = openingTotals.get(`${product.id}:brak_returned`) ?? 0;
        const brakReplaced = openingTotals.get(`${product.id}:brak_replaced`) ?? 0;
        running.set(product.id, { taraPending: taraSent - filledReceived, brakPending: brakReturned - brakReplaced });
      }
      const opening = new Map(Array.from(running.entries()).map(([id, state]) => [id, { ...state }]));

      const periodConditions = [
        fromDate ? gte(factoryOperations.operationDate, fromDate) : undefined,
        toDate ? lte(factoryOperations.operationDate, toDate) : undefined,
      ].filter(Boolean);
      const ledgerRows = await db
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
        .where(periodConditions.length ? and(...periodConditions) : undefined)
        .orderBy(asc(factoryOperations.operationDate), asc(factoryOperations.id));

      const ledger = ledgerRows.map(row => {
        const state = running.get(row.productId) ?? { taraPending: 0, brakPending: 0 };
        if (row.operationType === "tara_sent") state.taraPending += row.quantity;
        else if (row.operationType === "filled_received") state.taraPending -= row.quantity;
        else if (row.operationType === "brak_returned") state.brakPending += row.quantity;
        else if (row.operationType === "brak_replaced") state.brakPending -= row.quantity;
        running.set(row.productId, state);
        return { ...row, taraPendingAfter: state.taraPending, brakPendingAfter: state.brakPending };
      });

      const productSummaries = productRows.map(product => {
        const openingState = opening.get(product.id) ?? { taraPending: 0, brakPending: 0 };
        const closingState = running.get(product.id) ?? openingState;
        return {
          productId: product.id,
          productName: product.name,
          openingTaraPending: openingState.taraPending,
          openingBrakPending: openingState.brakPending,
          closingTaraPending: closingState.taraPending,
          closingBrakPending: closingState.brakPending,
        };
      });

      return { products: productSummaries, ledger, generatedAt: Date.now() };
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

  /**
   * Butilka harakati — yig'ilgan bo'sh butilkalarni zavodga sotish hisobi.
   * Kassa bilan bog'lanmagan: zavoddan olingan pul shu yerda alohida yuritiladi.
   */
  bottles: router({
    /** Umumiy holat: qo'ldagi zaxira, sotib olish xarajati, sotuv summasi,
     * foyda, zavod to'lagan pul va zavod qarzi. */
    summary: skladProcedure.query(async () => {
      const db = await requireDb();
      const [row] = await db
        .select({
          purchasedQuantity: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'purchase' then ${bottleMovements.quantity} else 0 end), 0)`,
          purchasedAmount: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'purchase' then ${bottleMovements.amount} else 0 end), 0)`,
          sentQuantity: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'sent' then ${bottleMovements.quantity} else 0 end), 0)`,
          sentAmount: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'sent' then ${bottleMovements.amount} else 0 end), 0)`,
          paidAmount: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'payment' then ${bottleMovements.amount} else 0 end), 0)`,
        })
        .from(bottleMovements);
      const purchasedQuantity = Number(row?.purchasedQuantity ?? 0);
      const purchasedAmount = Number(row?.purchasedAmount ?? 0);
      const sentQuantity = Number(row?.sentQuantity ?? 0);
      const sentAmount = Number(row?.sentAmount ?? 0);
      const paidAmount = Number(row?.paidAmount ?? 0);
      return {
        purchasedQuantity,
        purchasedAmount,
        sentQuantity,
        sentAmount,
        paidAmount,
        /** Sotib olingan, lekin hali zavodga yuborilmagan butilka. */
        onHand: purchasedQuantity - sentQuantity,
        /** Sotuv summasi − sotib olish xarajati. */
        profit: sentAmount - purchasedAmount,
        /** Zavod yuborilgan butilka uchun hali to'lamagan summa. */
        outstanding: sentAmount - paidAmount,
      };
    }),

    /** Yozuvlar ro'yxati — eng yangisi yuqorida, har biriga o'sha paytdagi
     * zavod qarzi (yuguruvchi qoldiq) hisoblab qo'shiladi. */
    list: skladProcedure
      .input(z.object({ limit: z.number().int().positive().max(500).default(100) }).optional())
      .query(async ({ input }) => {
        const db = await requireDb();
        const rows = await db
          .select({
            id: bottleMovements.id,
            movementDate: bottleMovements.movementDate,
            movementType: bottleMovements.movementType,
            quantity: bottleMovements.quantity,
            unitPrice: bottleMovements.unitPrice,
            amount: bottleMovements.amount,
            note: bottleMovements.note,
          })
          .from(bottleMovements)
          .orderBy(asc(bottleMovements.movementDate), asc(bottleMovements.id));

        // Zavod qarzini eskisidan yangisiga qarab yig'amiz, so'ng ko'rsatish uchun
        // teskari qilamiz. "purchase" qarzga ta'sir qilmaydi — u bizning xaridimiz.
        let balance = 0;
        const withBalance = rows.map(row => {
          if (row.movementType === "sent") balance += Number(row.amount);
          else if (row.movementType === "payment") balance -= Number(row.amount);
          return { ...row, amount: Number(row.amount), balanceAfter: balance };
        });
        return withBalance.reverse().slice(0, input?.limit ?? 100);
      }),

    create: skladProcedure
      .input(
        z.discriminatedUnion("movementType", [
          z.object({
            movementType: z.literal("purchase"),
            movementDate: z.number(),
            quantity: z.number().int().positive(),
            unitPrice: z.number().int().positive(),
            note: z.string().max(1000).optional(),
          }),
          z.object({
            movementType: z.literal("sent"),
            movementDate: z.number(),
            quantity: z.number().int().positive(),
            unitPrice: z.number().int().positive(),
            note: z.string().max(1000).optional(),
          }),
          z.object({
            movementType: z.literal("payment"),
            movementDate: z.number(),
            amount: z.number().int().positive(),
            note: z.string().max(1000).optional(),
          }),
        ]),
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const shared = {
          movementDate: new Date(input.movementDate),
          note: input.note?.trim() || null,
          createdBy: ctx.user.id,
        };
        if (input.movementType === "payment") {
          await db.insert(bottleMovements).values({
            ...shared,
            movementType: "payment",
            quantity: 0,
            unitPrice: 0,
            amount: input.amount,
          });
          return { success: true };
        }

        // Zavodga yuborishda qo'lda yetarli butilka borligini tekshiramiz —
        // aks holda "qo'lda qolgan" manfiy chiqib, hisob chalkashadi.
        if (input.movementType === "sent") {
          const [stock] = await db
            .select({
              onHand: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'purchase' then ${bottleMovements.quantity} when ${bottleMovements.movementType} = 'sent' then -${bottleMovements.quantity} else 0 end), 0)`,
            })
            .from(bottleMovements);
          const available = Number(stock?.onHand ?? 0);
          if (input.quantity > available) {
            throw new Error(`Qo'lda faqat ${available.toLocaleString("uz-UZ")} dona butilka bor — avval sotib olinganini kiriting.`);
          }
        }

        await db.insert(bottleMovements).values({
          ...shared,
          movementType: input.movementType,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          amount: input.quantity * input.unitPrice,
        });
        return { success: true };
      }),

    delete: skladProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await requireDb();
      const [existing] = await db
        .select({ id: bottleMovements.id })
        .from(bottleMovements)
        .where(eq(bottleMovements.id, input.id))
        .limit(1);
      if (!existing) throw new Error("Yozuv topilmadi yoki allaqachon o'chirilgan.");
      await db.delete(bottleMovements).where(eq(bottleMovements.id, input.id));
      return { success: true };
    }),
  }),
});
