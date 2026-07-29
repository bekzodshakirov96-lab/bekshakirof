import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  agentCashSubmissions,
  agentTakingEntries,
  agents,
  cashEntries,
  clientPayments,
  dailyProductPrices,
  kassaDailyActuals,
  products,
  transactions,
} from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import { requireDb } from "../db";
import { assertExportRowLimit } from "../reportExport";
import { router } from "../_core/trpc";

const numberSql = (template: TemplateStringsArray, ...params: unknown[]) =>
  sql<number>(template, ...params).mapWith(Number);

/** "Приход кег"/"Приход пет" — agent naqd yig'gan pulni jismonan kassaga topshirgani
 * uchun yagona mavjud tasdiqlash yo'li. Terminal/Click/Перечисление uchun bunday
 * "topshirish" tushunchasi yo'q (pul to'g'ridan-to'g'ri bankka/Click hisobiga tushadi),
 * shu sababli ular kassaDailyActuals'dagi qo'lda tasdiqlangan summa bilan solishtiriladi. */
const CASH_SUBMISSION_CATEGORIES = ["Приход кег", "Приход пет"] as const;

function dayRange(timestamp: number) {
  const start = new Date(timestamp);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Kassaga "kelishi kerak bo'lgan" summa — savdo/qarz to'lovlarida har kanal bo'yicha
 * yozilgan miqdorlar (transactions + client_payments) — va "haqiqatda tasdiqlangan"
 * summa (naqd uchun Приход кег/пет, boshqalar uchun kunlik qo'lda tasdiqlash) orasidagi
 * farq. Bu buxgalter/agent naqd pulni yozib qo'yib, kassaga hech qachon kiritmasa yoki
 * kanalni almashtirib yozsa ham darhol ko'rinadigan, chetlab o'tib bo'lmaydigan signal —
 * chunki "kutilgan" tomon allaqachon audit qilingan transactions/client_payments
 * yozuvlaridan hisoblanadi, xodim uni yashira olmaydi. Har kanal uchun ikkita qiymat
 * qaytaradi: shu kunning o'zi (`today`) va davr boshidan shu kungacha yig'ilgan
 * qoldiq (`cumulative`, oldingi kunlardan avtomatik "ko'chib" keladi).
 */
async function computePendingByChannel(timestamp: number) {
  const db = await requireDb();
  const { end } = dayRange(timestamp);
  const { start: todayStart } = dayRange(timestamp);

  const [expected] = await db
    .select({
      cashToday: numberSql`coalesce(sum(case when ${transactions.transactionDate} >= ${todayStart} then ${transactions.cashPayment} else 0 end), 0)`,
      terminalToday: numberSql`coalesce(sum(case when ${transactions.transactionDate} >= ${todayStart} then ${transactions.terminalPayment} else 0 end), 0)`,
      clickToday: numberSql`coalesce(sum(case when ${transactions.transactionDate} >= ${todayStart} then ${transactions.clickPayment} else 0 end), 0)`,
      transferToday: numberSql`coalesce(sum(case when ${transactions.transactionDate} >= ${todayStart} then ${transactions.transferPayment} else 0 end), 0)`,
      cashCumulative: numberSql`coalesce(sum(${transactions.cashPayment}), 0)`,
      terminalCumulative: numberSql`coalesce(sum(${transactions.terminalPayment}), 0)`,
      clickCumulative: numberSql`coalesce(sum(${transactions.clickPayment}), 0)`,
      transferCumulative: numberSql`coalesce(sum(${transactions.transferPayment}), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.transactionDate} <= ${end}`);

  const [expectedDebt] = await db
    .select({
      cashToday: numberSql`coalesce(sum(case when ${clientPayments.paymentDate} >= ${todayStart} then ${clientPayments.cashAmount} else 0 end), 0)`,
      terminalToday: numberSql`coalesce(sum(case when ${clientPayments.paymentDate} >= ${todayStart} then ${clientPayments.terminalAmount} else 0 end), 0)`,
      clickToday: numberSql`coalesce(sum(case when ${clientPayments.paymentDate} >= ${todayStart} then ${clientPayments.clickAmount} else 0 end), 0)`,
      transferToday: numberSql`coalesce(sum(case when ${clientPayments.paymentDate} >= ${todayStart} then ${clientPayments.transferAmount} else 0 end), 0)`,
      cashCumulative: numberSql`coalesce(sum(${clientPayments.cashAmount}), 0)`,
      terminalCumulative: numberSql`coalesce(sum(${clientPayments.terminalAmount}), 0)`,
      clickCumulative: numberSql`coalesce(sum(${clientPayments.clickAmount}), 0)`,
      transferCumulative: numberSql`coalesce(sum(${clientPayments.transferAmount}), 0)`,
    })
    .from(clientPayments)
    .where(sql`${clientPayments.paymentDate} <= ${end}`);

  const [actualCash] = await db
    .select({
      today: numberSql`coalesce(sum(case when ${cashEntries.entryDate} >= ${todayStart} then ${cashEntries.cashAmount} else 0 end), 0)`,
      cumulative: numberSql`coalesce(sum(${cashEntries.cashAmount}), 0)`,
    })
    .from(cashEntries)
    .where(
      and(
        eq(cashEntries.type, "income"),
        inArray(cashEntries.category, [...CASH_SUBMISSION_CATEGORIES]),
        sql`${cashEntries.entryDate} <= ${end}`,
      ),
    );

  // Presel guruhi kabi — bu tizimdan tashqarida sotilib, Kunlik jurnalga Перечисление
  // sifatida qo'lda yozib qo'yiladigan savdolar. Bu pul bankka darhol tushmagani uchun
  // "haqiqatda tasdiqlangan" tomonga emas, aynan shu "kutilgan" tomonga qo'shiladi —
  // tasdiqlanguncha (kassaDailyActuals.transferConfirmed) qoldiq sifatida ko'rinib turadi.
  const [expectedTransferEntries] = await db
    .select({
      today: numberSql`coalesce(sum(case when ${cashEntries.entryDate} >= ${todayStart} then ${cashEntries.transferAmount} else 0 end), 0)`,
      cumulative: numberSql`coalesce(sum(${cashEntries.transferAmount}), 0)`,
    })
    .from(cashEntries)
    .where(and(eq(cashEntries.type, "income"), sql`${cashEntries.entryDate} <= ${end}`));

  const [actualConfirmed] = await db
    .select({
      terminalToday: numberSql`coalesce(sum(case when ${kassaDailyActuals.entryDate} >= ${todayStart} then ${kassaDailyActuals.terminalConfirmed} else 0 end), 0)`,
      clickToday: numberSql`coalesce(sum(case when ${kassaDailyActuals.entryDate} >= ${todayStart} then ${kassaDailyActuals.clickConfirmed} else 0 end), 0)`,
      transferToday: numberSql`coalesce(sum(case when ${kassaDailyActuals.entryDate} >= ${todayStart} then ${kassaDailyActuals.transferConfirmed} else 0 end), 0)`,
      terminalCumulative: numberSql`coalesce(sum(${kassaDailyActuals.terminalConfirmed}), 0)`,
      clickCumulative: numberSql`coalesce(sum(${kassaDailyActuals.clickConfirmed}), 0)`,
      transferCumulative: numberSql`coalesce(sum(${kassaDailyActuals.transferConfirmed}), 0)`,
    })
    .from(kassaDailyActuals)
    .where(sql`${kassaDailyActuals.entryDate} <= ${end}`);

  const channel = (name: "cash" | "terminal" | "click" | "transfer") => {
    const key = name === "cash" ? "cash" : name;
    let expectedToday = expected[`${key}Today` as keyof typeof expected] + expectedDebt[`${key}Today` as keyof typeof expectedDebt];
    let expectedCumulative =
      expected[`${key}Cumulative` as keyof typeof expected] + expectedDebt[`${key}Cumulative` as keyof typeof expectedDebt];
    if (name === "transfer") {
      expectedToday += expectedTransferEntries.today;
      expectedCumulative += expectedTransferEntries.cumulative;
    }
    const actualToday = name === "cash" ? actualCash.today : actualConfirmed[`${key}Today` as keyof typeof actualConfirmed];
    const actualCumulative =
      name === "cash" ? actualCash.cumulative : actualConfirmed[`${key}Cumulative` as keyof typeof actualConfirmed];
    return {
      today: expectedToday - actualToday,
      cumulative: expectedCumulative - actualCumulative,
    };
  };

  return {
    cash: channel("cash"),
    terminal: channel("terminal"),
    click: channel("click"),
    transfer: channel("transfer"),
  };
}

function toMySqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export const kassaRouter = router({
  /** Everything the fast Kassa page needs for one day, in a single round trip. */
  daySummary: businessProcedure.input(z.object({ date: z.number().int() })).query(async ({ input }) => {
    const db = await requireDb();
    const { start, end } = dayRange(input.date);

    const [cashTotals] = await db
      .select({
        prihod:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
            Number,
          ),
        rasxod:
          sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
            Number,
          ),
      })
      .from(cashEntries)
      .where(and(sql`${cashEntries.entryDate} >= ${start}`, sql`${cashEntries.entryDate} <= ${end}`));

    const [actual] = await db
      .select()
      .from(kassaDailyActuals)
      .where(and(sql`${kassaDailyActuals.entryDate} >= ${start}`, sql`${kassaDailyActuals.entryDate} <= ${end}`))
      .limit(1);

    const takingRows = await db
      .select({
        agentId: agentTakingEntries.agentId,
        agentName: agents.name,
        computedAmount: sql<number>`coalesce(sum(${agentTakingEntries.amount}), 0)`.mapWith(Number),
      })
      .from(agentTakingEntries)
      .innerJoin(agents, eq(agentTakingEntries.agentId, agents.id))
      .where(and(sql`${agentTakingEntries.entryDate} >= ${start}`, sql`${agentTakingEntries.entryDate} <= ${end}`))
      .groupBy(agentTakingEntries.agentId, agents.name);

    // "Kassa" (topshirilgan naqd) endi qo'lda kiritilmaydi — Kunlik jurnaldagi shu agentning
    // "Приход кег" va "Приход пет" yozuvlari yig'indisidan avtomatik olinadi.
    const journalIncomeRows = await db
      .select({
        agentId: cashEntries.agentId,
        agentName: agents.name,
        submittedAmount:
          sql<number>`coalesce(sum(${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount}), 0)`.mapWith(
            Number,
          ),
      })
      .from(cashEntries)
      .innerJoin(agents, eq(cashEntries.agentId, agents.id))
      .where(
        and(
          eq(cashEntries.type, "income"),
          inArray(cashEntries.category, ["Приход кег", "Приход пет"]),
          sql`${cashEntries.entryDate} >= ${start}`,
          sql`${cashEntries.entryDate} <= ${end}`,
        ),
      )
      .groupBy(cashEntries.agentId, agents.name);
    const journalIncomeByAgent = new Map(journalIncomeRows.map(row => [row.agentId, row]));

    const agentIdsWithActivity = new Set([
      ...takingRows.map(row => row.agentId),
      ...journalIncomeRows.map(row => row.agentId),
    ]);
    const agentSummaries = Array.from(agentIdsWithActivity).map(agentId => {
      const taking = takingRows.find(row => row.agentId === agentId);
      const journalIncome = journalIncomeByAgent.get(agentId);
      const computedAmount = taking?.computedAmount ?? 0;
      const submittedAmount = journalIncome?.submittedAmount ?? 0;
      return {
        agentId,
        agentName: taking?.agentName ?? journalIncome?.agentName ?? "",
        computedAmount,
        submittedAmount,
        farq: computedAmount - submittedAmount,
        note: null as string | null,
      };
    });

    const jamiPrihod = cashTotals.prihod;
    const jamiRasxod = cashTotals.rasxod;
    const kassaQoldigi = jamiPrihod - jamiRasxod;
    const agentComputedTotal = agentSummaries.reduce((sum, row) => sum + row.computedAmount, 0);
    const agentSubmittedTotal = agentSummaries.reduce((sum, row) => sum + row.submittedAmount, 0);

    const pendingByChannel = await computePendingByChannel(input.date);

    return {
      jamiPrihod,
      jamiRasxod,
      kassaQoldigi,
      actualCash: actual?.actualCash ?? null,
      actualCashNote: actual?.note ?? "",
      actualDiff: actual ? actual.actualCash - kassaQoldigi : null,
      agentSummaries: agentSummaries.sort((a, b) => a.agentName.localeCompare(b.agentName, "uz-Latn")),
      agentComputedTotal,
      agentSubmittedTotal,
      agentFarqTotal: agentComputedTotal - agentSubmittedTotal,
      problemAgentCount: agentSummaries.filter(row => row.farq !== 0).length,
      pendingByChannel,
      channelConfirmed: {
        terminal: actual?.terminalConfirmed ?? 0,
        click: actual?.clickConfirmed ?? 0,
        transfer: actual?.transferConfirmed ?? 0,
        note: actual?.note ?? "",
      },
    };
  }),

  actualCash: router({
    upsert: businessProcedure
      .input(z.object({ date: z.number().int(), actualCash: z.number().int().min(0), note: z.string().max(500).optional() }))
      .mutation(async ({ input, ctx }) => {
        await assertPeriodUnlocked(new Date(input.date));
        const db = await requireDb();
        const { start, end } = dayRange(input.date);
        const [existing] = await db
          .select({ id: kassaDailyActuals.id })
          .from(kassaDailyActuals)
          .where(and(sql`${kassaDailyActuals.entryDate} >= ${start}`, sql`${kassaDailyActuals.entryDate} <= ${end}`))
          .limit(1);
        return db.transaction(async tx => {
          if (existing) {
            const [previous] = await tx.select().from(kassaDailyActuals).where(eq(kassaDailyActuals.id, existing.id)).limit(1);
            await tx
              .update(kassaDailyActuals)
              .set({ actualCash: input.actualCash, note: input.note, updatedBy: ctx.user.id })
              .where(eq(kassaDailyActuals.id, existing.id));
            await logAudit(tx, {
              tableName: "kassa_daily_actuals",
              recordId: existing.id,
              action: "update",
              userId: ctx.user.id,
              before: previous,
              after: { entryDate: new Date(input.date), actualCash: input.actualCash, note: input.note ?? null },
            });
          } else {
            const [created] = await tx.insert(kassaDailyActuals).values({
              entryDate: new Date(input.date),
              actualCash: input.actualCash,
              note: input.note,
              updatedBy: ctx.user.id,
            }).$returningId();
            await logAudit(tx, {
              tableName: "kassa_daily_actuals",
              recordId: created.id,
              action: "create",
              userId: ctx.user.id,
              after: { entryDate: new Date(input.date), actualCash: input.actualCash, note: input.note ?? null },
            });
          }
          return { success: true } as const;
        });
      }),
  }),

  /** Terminal/Click/Перечисление uchun kunlik "haqiqatda tushdi" tasdiqlashi — bank
   * ko'chirmasi/POS hisoboti/Click panelga qarab kiritiladi, "kutilayotgan kassa"
   * panelidagi kanal bo'yicha nomuvofiqlikni yopadi. */
  channelConfirmation: router({
    upsert: businessProcedure
      .input(
        z.object({
          date: z.number().int(),
          terminalConfirmed: z.number().int().min(0),
          clickConfirmed: z.number().int().min(0),
          transferConfirmed: z.number().int().min(0),
          note: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertPeriodUnlocked(new Date(input.date));
        const db = await requireDb();
        const { start, end } = dayRange(input.date);
        const [existing] = await db
          .select()
          .from(kassaDailyActuals)
          .where(and(sql`${kassaDailyActuals.entryDate} >= ${start}`, sql`${kassaDailyActuals.entryDate} <= ${end}`))
          .limit(1);
        const note = input.note !== undefined ? input.note : existing?.note;
        return db.transaction(async tx => {
          if (existing) {
            await tx
              .update(kassaDailyActuals)
              .set({
                terminalConfirmed: input.terminalConfirmed,
                clickConfirmed: input.clickConfirmed,
                transferConfirmed: input.transferConfirmed,
                note,
                updatedBy: ctx.user.id,
              })
              .where(eq(kassaDailyActuals.id, existing.id));
            await logAudit(tx, {
              tableName: "kassa_daily_actuals",
              recordId: existing.id,
              action: "update",
              userId: ctx.user.id,
              before: existing,
              after: {
                entryDate: new Date(input.date),
                terminalConfirmed: input.terminalConfirmed,
                clickConfirmed: input.clickConfirmed,
                transferConfirmed: input.transferConfirmed,
                note: note ?? null,
              },
            });
          } else {
            const [created] = await tx.insert(kassaDailyActuals).values({
              entryDate: new Date(input.date),
              terminalConfirmed: input.terminalConfirmed,
              clickConfirmed: input.clickConfirmed,
              transferConfirmed: input.transferConfirmed,
              note,
              updatedBy: ctx.user.id,
            }).$returningId();
            await logAudit(tx, {
              tableName: "kassa_daily_actuals",
              recordId: created.id,
              action: "create",
              userId: ctx.user.id,
              after: {
                entryDate: new Date(input.date),
                terminalConfirmed: input.terminalConfirmed,
                clickConfirmed: input.clickConfirmed,
                transferConfirmed: input.transferConfirmed,
                note: note ?? null,
              },
            });
          }
          return { success: true } as const;
        });
      }),
  }),

  agentTaking: router({
    list: businessProcedure
      .input(z.object({ date: z.number().int(), agentId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const { start, end } = dayRange(input.date);
        return db
          .select()
          .from(agentTakingEntries)
          .where(
            and(
              eq(agentTakingEntries.agentId, input.agentId),
              sql`${agentTakingEntries.entryDate} >= ${start}`,
              sql`${agentTakingEntries.entryDate} <= ${end}`,
            ),
          )
          .orderBy(agentTakingEntries.id);
      }),
    /** Every agent's taking rows for one day in a single round trip, for the Kassa matrix grid. */
    listForDay: businessProcedure.input(z.object({ date: z.number().int() })).query(async ({ input }) => {
      const db = await requireDb();
      const { start, end } = dayRange(input.date);
      return db
        .select()
        .from(agentTakingEntries)
        .where(and(sql`${agentTakingEntries.entryDate} >= ${start}`, sql`${agentTakingEntries.entryDate} <= ${end}`))
        .orderBy(agentTakingEntries.id);
    }),
    addProduct: businessProcedure
      .input(
        z.object({
          date: z.number().int(),
          agentId: z.number().int().positive(),
          productId: z.number().int().positive(),
          quantity: z.number().positive().max(1_000_000).default(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertPeriodUnlocked(new Date(input.date));
        const db = await requireDb();
        const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
        if (!product) throw new Error("Mahsulot topilmadi.");
        const { start, end } = dayRange(input.date);
        const [override] = await db
          .select({ unitPrice: dailyProductPrices.unitPrice })
          .from(dailyProductPrices)
          .where(
            and(
              eq(dailyProductPrices.productId, input.productId),
              gte(dailyProductPrices.entryDate, start),
              lte(dailyProductPrices.entryDate, end),
            ),
          )
          .limit(1);
        const unitPrice = override?.unitPrice ?? product.price;
        const amount = Math.round(input.quantity * unitPrice);
        const [created] = await db
          .insert(agentTakingEntries)
          .values({
            entryDate: new Date(input.date),
            agentId: input.agentId,
            productId: product.id,
            productName: product.name,
            unitPrice,
            quantity: input.quantity.toFixed(3),
            amount,
            createdBy: ctx.user.id,
          })
          .$returningId();
        return { id: created.id, amount } as const;
      }),
    updateQuantity: businessProcedure
      .input(z.object({ id: z.number().int().positive(), quantity: z.number().positive().max(1_000_000) }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const [row] = await db.select().from(agentTakingEntries).where(eq(agentTakingEntries.id, input.id)).limit(1);
        if (!row) throw new Error("Yozuv topilmadi.");
        await assertPeriodUnlocked(row.entryDate);
        const amount = Math.round(input.quantity * row.unitPrice);
        await db
          .update(agentTakingEntries)
          .set({ quantity: input.quantity.toFixed(3), amount })
          .where(eq(agentTakingEntries.id, input.id));
        return { success: true, amount } as const;
      }),
    remove: businessProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
      const db = await requireDb();
      const [row] = await db
        .select({ entryDate: agentTakingEntries.entryDate })
        .from(agentTakingEntries)
        .where(eq(agentTakingEntries.id, input.id))
        .limit(1);
      if (!row) throw new Error("Yozuv topilmadi.");
      await assertPeriodUnlocked(row.entryDate);
      await db.delete(agentTakingEntries).where(eq(agentTakingEntries.id, input.id));
      return { success: true } as const;
    }),
  }),

  /**
   * Bitta kunga xos vaqtinchalik narx bekor qilish — Агент x Товар setkasidagi
   * "Narxi" ustuni yonidagi tahrirlanadigan katak orqali boshqariladi. Belgilansa,
   * o'sha kun-mahsulot uchun barcha mavjud agentTakingEntries qatorlari ham shu
   * narxga qayta hisoblanadi; tozalansa, mahsulotning joriy (qat'iy) narxiga qaytadi.
   */
  dayPrice: router({
    listForDay: businessProcedure.input(z.object({ date: z.number().int() })).query(async ({ input }) => {
      const db = await requireDb();
      const { start, end } = dayRange(input.date);
      const rows = await db
        .select({ productId: dailyProductPrices.productId, unitPrice: dailyProductPrices.unitPrice })
        .from(dailyProductPrices)
        .where(and(gte(dailyProductPrices.entryDate, start), lte(dailyProductPrices.entryDate, end)));
      return rows;
    }),
    upsert: businessProcedure
      .input(z.object({ date: z.number().int(), productId: z.number().int().positive(), unitPrice: z.number().int().min(0).nullable() }))
      .mutation(async ({ input, ctx }) => {
        await assertPeriodUnlocked(new Date(input.date));
        const db = await requireDb();
        const { start, end } = dayRange(input.date);
        const [existing] = await db
          .select({ id: dailyProductPrices.id })
          .from(dailyProductPrices)
          .where(and(eq(dailyProductPrices.productId, input.productId), gte(dailyProductPrices.entryDate, start), lte(dailyProductPrices.entryDate, end)))
          .limit(1);

        let effectiveUnitPrice: number;
        if (input.unitPrice && input.unitPrice > 0) {
          effectiveUnitPrice = input.unitPrice;
          if (existing) {
            await db.update(dailyProductPrices).set({ unitPrice: input.unitPrice, updatedBy: ctx.user.id }).where(eq(dailyProductPrices.id, existing.id));
          } else {
            await db.insert(dailyProductPrices).values({ entryDate: new Date(input.date), productId: input.productId, unitPrice: input.unitPrice, updatedBy: ctx.user.id });
          }
        } else {
          if (existing) await db.delete(dailyProductPrices).where(eq(dailyProductPrices.id, existing.id));
          const [product] = await db.select({ price: products.price }).from(products).where(eq(products.id, input.productId)).limit(1);
          if (!product) throw new Error("Mahsulot topilmadi.");
          effectiveUnitPrice = product.price;
        }

        await db
          .update(agentTakingEntries)
          .set({
            unitPrice: effectiveUnitPrice,
            amount: sql`round(cast(${agentTakingEntries.quantity} as decimal(18,3)) * ${effectiveUnitPrice})`,
          })
          .where(
            and(
              eq(agentTakingEntries.productId, input.productId),
              gte(agentTakingEntries.entryDate, start),
              lte(agentTakingEntries.entryDate, end),
            ),
          );
        return { success: true, unitPrice: effectiveUnitPrice } as const;
      }),
  }),

  agentCashSubmission: router({
    upsert: businessProcedure
      .input(
        z.object({
          date: z.number().int(),
          agentId: z.number().int().positive(),
          submittedAmount: z.number().int().min(0),
          note: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertPeriodUnlocked(new Date(input.date));
        const db = await requireDb();
        const { start, end } = dayRange(input.date);
        const [existing] = await db
          .select({ id: agentCashSubmissions.id })
          .from(agentCashSubmissions)
          .where(
            and(
              eq(agentCashSubmissions.agentId, input.agentId),
              sql`${agentCashSubmissions.entryDate} >= ${start}`,
              sql`${agentCashSubmissions.entryDate} <= ${end}`,
            ),
          )
          .limit(1);
        if (existing) {
          await db
            .update(agentCashSubmissions)
            .set({ submittedAmount: input.submittedAmount, note: input.note, updatedBy: ctx.user.id })
            .where(eq(agentCashSubmissions.id, existing.id));
        } else {
          await db.insert(agentCashSubmissions).values({
            entryDate: new Date(input.date),
            agentId: input.agentId,
            submittedAmount: input.submittedAmount,
            note: input.note,
            updatedBy: ctx.user.id,
          });
        }
        return { success: true } as const;
      }),
  }),

  report: router({
    /** Range totals for the Hisobotlar summary cards. */
    summary: businessProcedure
      .input(z.object({ from: z.number().int().optional(), to: z.number().int().optional() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const cashConditions = [
          input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const cashWhere = cashConditions.length ? and(...cashConditions) : undefined;
        const [cashTotals] = await db
          .select({
            prihod:
              sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
                Number,
              ),
            rasxod:
              sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' then ${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount} else 0 end), 0)`.mapWith(
                Number,
              ),
          })
          .from(cashEntries)
          .where(cashWhere);

        const takingConditions = [
          input.from ? sql`${agentTakingEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${agentTakingEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const takingWhere = takingConditions.length ? and(...takingConditions) : undefined;
        const [takingTotals] = await db
          .select({ computed: sql<number>`coalesce(sum(${agentTakingEntries.amount}), 0)`.mapWith(Number) })
          .from(agentTakingEntries)
          .where(takingWhere);

        const submissionConditions = [
          eq(cashEntries.type, "income"),
          inArray(cashEntries.category, ["Приход кег", "Приход пет"]),
          input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const [submissionTotals] = await db
          .select({ submitted: sql<number>`coalesce(sum(${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount}), 0)`.mapWith(Number) })
          .from(cashEntries)
          .where(and(...submissionConditions));

        return {
          jamiPrihod: cashTotals.prihod,
          jamiRasxod: cashTotals.rasxod,
          sofNatija: cashTotals.prihod - cashTotals.rasxod,
          agentComputedTotal: takingTotals.computed,
          agentSubmittedTotal: submissionTotals.submitted,
          agentFarqTotal: takingTotals.computed - submissionTotals.submitted,
        };
      }),

    /** Rasxod turlari (Ойлик, Обед, Газ, Завод, Расход...) bo'yicha davr jamlanmasi —
     * "Kassa hisobotlari"dagi rasxod tarkibi jadvali uchun. */
    expenseByCategory: businessProcedure
      .input(z.object({ from: z.number().int().optional(), to: z.number().int().optional() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const conditions = [
          eq(cashEntries.type, "expense"),
          input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const rows = await db
          .select({
            category: cashEntries.category,
            total: sql<number>`coalesce(sum(${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount}), 0)`.mapWith(Number),
          })
          .from(cashEntries)
          .where(and(...conditions))
          .groupBy(cashEntries.category)
          .orderBy(desc(sql`sum(${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount})`));
        const total = rows.reduce((sum, row) => sum + row.total, 0);
        return { rows, total, generatedAt: Date.now() };
      }),

    /** Line-item agent product-taking rows for the detail table, filterable and export-ready. */
    agentTakingDetails: businessProcedure
      .input(
        z.object({
          agentId: z.number().int().positive().optional(),
          productId: z.number().int().positive().optional(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
        }),
      )
      .query(async ({ input }) => {
        const db = await requireDb();
        const conditions = [
          input.agentId ? eq(agentTakingEntries.agentId, input.agentId) : undefined,
          input.productId ? eq(agentTakingEntries.productId, input.productId) : undefined,
          input.from ? sql`${agentTakingEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${agentTakingEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const where = conditions.length ? and(...conditions) : undefined;
        const countRows = await db.select({ id: agentTakingEntries.id }).from(agentTakingEntries).where(where);
        assertExportRowLimit(countRows.length, { entityLabel: "agent-tovar yozuvi" });
        const rows = await db
          .select({
            id: agentTakingEntries.id,
            entryDate: agentTakingEntries.entryDate,
            agentName: agents.name,
            productName: agentTakingEntries.productName,
            unitPrice: agentTakingEntries.unitPrice,
            quantity: agentTakingEntries.quantity,
            amount: agentTakingEntries.amount,
          })
          .from(agentTakingEntries)
          .innerJoin(agents, eq(agentTakingEntries.agentId, agents.id))
          .where(where)
          .orderBy(desc(agentTakingEntries.entryDate), desc(agentTakingEntries.id));
        const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
        return { rows, totalAmount, generatedAt: Date.now() };
      }),

    /** Per-agent-per-day reconciliation rows for the detail table, filterable and export-ready. */
    agentReconciliation: businessProcedure
      .input(
        z.object({
          agentId: z.number().int().positive().optional(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
        }),
      )
      .query(async ({ input }) => {
        const db = await requireDb();
        const takingConditions = [
          input.agentId ? eq(agentTakingEntries.agentId, input.agentId) : undefined,
          input.from ? sql`${agentTakingEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${agentTakingEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const takingRows = await db
          .select({
            entryDate: agentTakingEntries.entryDate,
            agentId: agentTakingEntries.agentId,
            agentName: agents.name,
            computedAmount: sql<number>`coalesce(sum(${agentTakingEntries.amount}), 0)`.mapWith(Number),
          })
          .from(agentTakingEntries)
          .innerJoin(agents, eq(agentTakingEntries.agentId, agents.id))
          .where(takingConditions.length ? and(...takingConditions) : undefined)
          .groupBy(agentTakingEntries.entryDate, agentTakingEntries.agentId, agents.name);

        const submissionConditions = [
          eq(cashEntries.type, "income"),
          inArray(cashEntries.category, ["Приход кег", "Приход пет"]),
          input.agentId ? eq(cashEntries.agentId, input.agentId) : undefined,
          input.from ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
          input.to ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
        ].filter(Boolean);
        const submissionRowsRaw = await db
          .select({
            entryDate: cashEntries.entryDate,
            agentId: cashEntries.agentId,
            submittedAmount: sql<number>`coalesce(sum(${cashEntries.cashAmount} + ${cashEntries.terminalAmount} + ${cashEntries.clickAmount}), 0)`.mapWith(Number),
          })
          .from(cashEntries)
          .where(and(...submissionConditions))
          .groupBy(cashEntries.entryDate, cashEntries.agentId);
        const submissionRows = submissionRowsRaw.filter(
          (row): row is typeof row & { agentId: number } => row.agentId !== null,
        );

        const key = (date: Date, agentId: number) => `${date.toISOString().slice(0, 10)}:${agentId}`;
        const submissionMap = new Map(submissionRows.map(row => [key(row.entryDate, row.agentId), row]));
        const seen = new Set<string>();
        const rows = takingRows.map(row => {
          const k = key(row.entryDate, row.agentId);
          seen.add(k);
          const submission = submissionMap.get(k);
          const submittedAmount = submission?.submittedAmount ?? 0;
          return {
            entryDate: row.entryDate,
            agentId: row.agentId,
            agentName: row.agentName,
            computedAmount: row.computedAmount,
            submittedAmount,
            farq: row.computedAmount - submittedAmount,
            note: null as string | null,
          };
        });
        // Include submission-only rows (agent had journal income on a day with no taking entries recorded).
        for (const submission of submissionRows) {
          const k = key(submission.entryDate, submission.agentId);
          if (seen.has(k)) continue;
          const agentName = takingRows.find(row => row.agentId === submission.agentId)?.agentName ?? "";
          rows.push({
            entryDate: submission.entryDate,
            agentId: submission.agentId,
            agentName,
            computedAmount: 0,
            submittedAmount: submission.submittedAmount,
            farq: 0 - submission.submittedAmount,
            note: null as string | null,
          });
        }
        rows.sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime());
        assertExportRowLimit(rows.length, { entityLabel: "agent solishtirish yozuvi" });
        return { rows, generatedAt: Date.now() };
      }),
  }),
});
