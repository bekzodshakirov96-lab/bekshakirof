import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agents,
  clientPayments,
  clients,
  containerMovements,
  products,
  transactions,
} from "../../drizzle/schema";
import {
  calculateFastKegRow,
  summarizeFastKegRows,
  type FastKegCurrentState,
} from "../../shared/fastKeg";
import { requireOwnAgent, salesProcedure } from "../access";
import { assertPeriodUnlocked, logAudit } from "../auditLog";
import {
  normalizeContainerType,
  reconcileTransactionContainers,
  type ContainerType,
} from "../containerAccounting";
import { requireDb } from "../db";
import { reconcileTransactionStock } from "../stockAccounting";
import { router } from "../_core/trpc";

const numberSql = (template: TemplateStringsArray, ...params: unknown[]) =>
  sql<number>(template, ...params).mapWith(Number);

const quantitySchema = z.number().int().min(0).max(100_000);

const paymentSchema = z.number().int().min(0).max(9_000_000_000_000).default(0);

const fastKegRowSchema = z
  .object({
    clientId: z.number().int().positive(),
    keg30: quantitySchema.default(0),
    keg50: quantitySchema.default(0),
    returned30: quantitySchema.default(0),
    returned50: quantitySchema.default(0),
    cash: paymentSchema,
    terminal: paymentSchema,
    click: paymentSchema,
    transfer: paymentSchema,
  })
  .refine(
    row => row.keg30 + row.keg50 + row.returned30 + row.returned50 + row.cash + row.terminal + row.click + row.transfer > 0,
    { message: "Mijoz qatorida kamida bitta KEG, tara yoki to‘lov qiymati bo‘lishi kerak." },
  );

const saveBatchSchema = z
  .object({
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{12,80}$/),
    transactionDate: z.number().int(),
    agentId: z.number().int().positive(),
    rows: z.array(fastKegRowSchema).min(1).max(150),
  })
  .superRefine((value, ctx) => {
    const ids = value.rows.map(row => row.clientId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows"],
        message: "Bir mijoz ommaviy jadvalda faqat bir marta qatnashishi mumkin.",
      });
    }
  });

type FastKegProduct = typeof products.$inferSelect;

type FastKegAction = {
  key: string;
  type: ContainerType | null;
  product: FastKegProduct | null;
  quantity: number;
  returned: number;
};

function productByType(rows: FastKegProduct[], type: ContainerType) {
  return rows.find(product => product.containerType === type);
}

function balanceKey(clientId: number, type: ContainerType) {
  return `${clientId}:${type}`;
}

type FastKegDatabase = Awaited<ReturnType<typeof requireDb>>;

async function loadAgentClientRows(db: FastKegDatabase, agentId: number) {
  const financialRows = await db
    .select({
      id: clients.id,
      code: clients.code,
      name: clients.name,
      phone: clients.phone,
      openingDebt: clients.openingDebt,
      totalSales: numberSql`coalesce(sum(${transactions.totalAmount}), 0)`,
      totalPaid: numberSql`coalesce(sum(${transactions.cashPayment} + ${transactions.terminalPayment} + ${transactions.clickPayment} + ${transactions.transferPayment}), 0)`,
      // Qarz to'lovlari (savdodan alohida qabul qilingan pul) — subquery bilan, aks holda
      // transactions bilan JOIN qatorlarni ko'paytirib, yig'indini buzib yuboradi.
      debtPaid: numberSql`coalesce((select sum(cp.cashAmount + cp.terminalAmount + cp.clickAmount + cp.transferAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
    })
    .from(clients)
    .leftJoin(transactions, eq(transactions.clientId, clients.id))
    .where(and(eq(clients.agentId, agentId), eq(clients.isActive, true)))
    .groupBy(clients.id, clients.code, clients.name, clients.phone, clients.openingDebt)
    .orderBy(asc(clients.name));

  if (financialRows.length === 0) return [];
  const clientIds = financialRows.map(row => row.id);
  const balanceRows = await db
    .select({
      clientId: containerMovements.clientId,
      containerType: containerMovements.containerType,
      balance:
        sql<number>`coalesce(sum(case when ${containerMovements.movementType} = 'issued' then ${containerMovements.quantity} else -${containerMovements.quantity} end), 0)`.mapWith(
          Number,
        ),
    })
    .from(containerMovements)
    .where(inArray(containerMovements.clientId, clientIds))
    .groupBy(containerMovements.clientId, containerMovements.containerType);
  // `containerType` has historically been written both as the raw enum ("keg_30") and as
  // the display label ("KEG 30") depending on which code path inserted the row — normalize
  // both to the same key so balances from either format are summed together correctly.
  const balanceMap = new Map<string, number>();
  for (const row of balanceRows) {
    if (row.clientId === null) continue;
    const type = normalizeContainerType(row.containerType);
    if (!type) continue;
    const key = `${row.clientId}:${type}`;
    balanceMap.set(key, (balanceMap.get(key) ?? 0) + row.balance);
  }

  return financialRows.map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone,
    currentDebt: row.openingDebt + row.totalSales - row.totalPaid - (row.debtPaid ?? 0),
    keg30Balance: balanceMap.get(`${row.id}:keg_30`) ?? 0,
    keg50Balance: balanceMap.get(`${row.id}:keg_50`) ?? 0,
  }));
}

export const fastKegRouter = router({
  setup: salesProcedure.query(async () => {
    const db = await requireDb();
    const [agentRows, productRows] = await Promise.all([
      db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(eq(agents.isActive, true))
        .orderBy(asc(agents.name)),
      db
        .select()
        .from(products)
        .where(
          and(
            eq(products.isActive, true),
            inArray(products.containerType, ["keg_30", "keg_50"]),
          ),
        )
        .orderBy(asc(products.id)),
    ]);
    const keg30 = productByType(productRows, "keg_30");
    const keg50 = productByType(productRows, "keg_50");
    return {
      agents: agentRows,
      products: {
        keg30: keg30
          ? {
              id: keg30.id,
              name: keg30.name,
              price: keg30.price,
              unitsPerItem: keg30.containerUnitsPerItem || 1,
            }
          : null,
        keg50: keg50
          ? {
              id: keg50.id,
              name: keg50.name,
              price: keg50.price,
              unitsPerItem: keg50.containerUnitsPerItem || 1,
            }
          : null,
      },
    };
  }),

  clientsByAgent: salesProcedure
    .input(z.object({ agentId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      requireOwnAgent(ctx.user.role, ctx.user.agentId, input.agentId);
      const db = await requireDb();
      return loadAgentClientRows(db, input.agentId);
    }),

  selectedDraft: salesProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        clientIds: z.array(z.number().int().positive()).min(1).max(150),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireOwnAgent(ctx.user.role, ctx.user.agentId, input.agentId);
      if (new Set(input.clientIds).size !== input.clientIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Mijozlar takrorlanmasligi kerak." });
      }
      const db = await requireDb();
      const allRows = await loadAgentClientRows(db, input.agentId);
      const rowMap = new Map(allRows.map(row => [row.id, row]));
      const selected = input.clientIds.map(clientId => {
        const client = rowMap.get(clientId);
        if (!client) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tanlangan mijozlardan biri bu agentga tegishli emas yoki faol emas.",
          });
        }
        return client;
      });
      return selected;
    }),

  saveBatch: salesProcedure.input(saveBatchSchema).mutation(async ({ input, ctx }) => {
    requireOwnAgent(ctx.user.role, ctx.user.agentId, input.agentId);
    await assertPeriodUnlocked(new Date(input.transactionDate));
    const db = await requireDb();
    return db.transaction(async tx => {
      const sourcePrefix = `fast-keg:${input.idempotencyKey}:`;
      const existing = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(like(transactions.sourceKey, `${sourcePrefix}%`))
        .limit(1);
      if (existing.length > 0) {
        return {
          success: true,
          duplicate: true,
          message: "Bu ommaviy KEG operatsiyasi avval saqlangan.",
          rows: [],
          summary: null,
        };
      }

      const productRows = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.isActive, true),
            inArray(products.containerType, ["keg_30", "keg_50"]),
          ),
        )
        .orderBy(asc(products.id));
      const keg30Product = productByType(productRows, "keg_30");
      const keg50Product = productByType(productRows, "keg_50");
      const needsKeg30 = input.rows.some(row => row.keg30 > 0 || row.returned30 > 0);
      const needsKeg50 = input.rows.some(row => row.keg50 > 0 || row.returned50 > 0);
      if (needsKeg30 && !keg30Product) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Mahsulotlar bo‘limida KEG 30 tara sozlamasini avval belgilang.",
        });
      }
      if (needsKeg50 && !keg50Product) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Mahsulotlar bo‘limida KEG 50 tara sozlamasini avval belgilang.",
        });
      }
      if (input.rows.some(row => row.keg30 > 0) && (keg30Product?.price ?? 0) <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "KEG 30 narxi musbat qiymat qilib belgilanmagan.",
        });
      }
      if (input.rows.some(row => row.keg50 > 0) && (keg50Product?.price ?? 0) <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "KEG 50 narxi musbat qiymat qilib belgilanmagan.",
        });
      }

      const clientIds = input.rows.map(row => row.clientId);
      // Shu mijozlar qatoriga qulf qo'yamiz — bir xil mijoz uchun ikkita saveBatch
      // chaqiruvi deyarli bir vaqtda kelsa (tarmoq qayta urinishi, ikki qurilma va h.k.),
      // ikkinchisi shu yerda birinchisi commit bo'lguncha kutadi, keyin qarz/tara
      // qoldig'ini YANGILANGAN holatda o'qiydi. Aks holda ikkalasi ham eski balansni
      // "yetarli" deb hisoblab, umumiy qoldiq manfiy bo'lib qolishi mumkin edi (lost update).
      await tx
        .select({ id: clients.id })
        .from(clients)
        .where(inArray(clients.id, clientIds))
        .for("update");
      const financialRows = await tx
        .select({
          id: clients.id,
          code: clients.code,
          name: clients.name,
          openingDebt: clients.openingDebt,
          totalSales: numberSql`coalesce(sum(${transactions.totalAmount}), 0)`,
          totalPaid: numberSql`coalesce(sum(${transactions.cashPayment} + ${transactions.terminalPayment} + ${transactions.clickPayment} + ${transactions.transferPayment}), 0)`,
          debtPaid: numberSql`coalesce((select sum(cp.cashAmount + cp.terminalAmount + cp.clickAmount + cp.transferAmount) from ${clientPayments} cp where cp.clientId = ${clients.id}), 0)`,
        })
        .from(clients)
        .leftJoin(transactions, eq(transactions.clientId, clients.id))
        .where(
          and(
            inArray(clients.id, clientIds),
            eq(clients.agentId, input.agentId),
            eq(clients.isActive, true),
          ),
        )
        .groupBy(clients.id, clients.code, clients.name, clients.openingDebt);
      if (financialRows.length !== clientIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tanlangan mijozlardan biri bu agentga tegishli emas yoki faol emas.",
        });
      }

      const balanceRows = await tx
        .select({
          clientId: containerMovements.clientId,
          containerType: containerMovements.containerType,
          balance:
            sql<number>`coalesce(sum(case when ${containerMovements.movementType} = 'issued' then ${containerMovements.quantity} else -${containerMovements.quantity} end), 0)`.mapWith(
              Number,
            ),
        })
        .from(containerMovements)
        .where(inArray(containerMovements.clientId, clientIds))
        .groupBy(containerMovements.clientId, containerMovements.containerType);
      // Same historical mixed-format issue as loadAgentClientRows above — normalize before summing.
      const balanceMap = new Map<string, number>();
      for (const row of balanceRows) {
        if (row.clientId === null) continue;
        const type = normalizeContainerType(row.containerType);
        if (!type) continue;
        const key = balanceKey(row.clientId, type);
        balanceMap.set(key, (balanceMap.get(key) ?? 0) + row.balance);
      }
      const clientMap = new Map(financialRows.map(row => [row.id, row]));
      const transactionDate = new Date(input.transactionDate);
      const pricing = {
        keg30Price: keg30Product?.price ?? 0,
        keg50Price: keg50Product?.price ?? 0,
        keg30UnitsPerItem: keg30Product?.containerUnitsPerItem || 1,
        keg50UnitsPerItem: keg50Product?.containerUnitsPerItem || 1,
      };

      const savedRows = [] as Array<{
        clientId: number;
        clientCode: string;
        clientName: string;
        keg30: number;
        keg50: number;
        returned30: number;
        returned50: number;
        cash: number;
        terminal: number;
        click: number;
        transfer: number;
        saleAmount: number;
        endingDebt: number;
        endingKeg30Balance: number;
        endingKeg50Balance: number;
        transactionIds: number[];
      }>;

      for (const inputRow of input.rows) {
        const client = clientMap.get(inputRow.clientId)!;
        const current: FastKegCurrentState = {
          currentDebt: client.openingDebt + client.totalSales - client.totalPaid - (client.debtPaid ?? 0),
          currentKeg30Balance: balanceMap.get(balanceKey(client.id, "keg_30")) ?? 0,
          currentKeg50Balance: balanceMap.get(balanceKey(client.id, "keg_50")) ?? 0,
        };
        const calculated = calculateFastKegRow(inputRow, current, pricing);
        if (calculated.endingKeg30Balance < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${client.name}: KEG 30 qaytishi mavjud ${current.currentKeg30Balance + calculated.issued30} dona qoldiqdan oshdi.`,
          });
        }
        if (calculated.endingKeg50Balance < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${client.name}: KEG 50 qaytishi mavjud ${current.currentKeg50Balance + calculated.issued50} dona qoldiqdan oshdi.`,
          });
        }
        if (calculated.endingDebt < 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${client.name}: kassa summasi mavjud qarz va yangi savdo yig‘indisidan oshmasligi kerak.`,
          });
        }

        const actions: FastKegAction[] = [
          {
            key: "keg30",
            type: "keg_30" as const,
            product: keg30Product ?? null,
            quantity: inputRow.keg30,
            returned: inputRow.returned30,
          },
          {
            key: "keg50",
            type: "keg_50" as const,
            product: keg50Product ?? null,
            quantity: inputRow.keg50,
            returned: inputRow.returned50,
          },
        ].filter(action => action.quantity > 0 || action.returned > 0);
        if (actions.length === 0) {
          actions.push({
            key: "payment",
            type: null,
            product: null,
            quantity: 0,
            returned: 0,
          });
        }

        const transactionIds: number[] = [];
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
          const action = actions[actionIndex];
          const totalAmount = action.product ? action.quantity * action.product.price : 0;
          const [created] = await tx
            .insert(transactions)
            .values({
              sourceKey: `${sourcePrefix}${client.id}:${action.key}`,
              transactionDate,
              agentId: input.agentId,
              clientId: client.id,
              productId: action.product?.id ?? null,
              productName: action.product?.name ?? "Kassa to‘lovi",
              unit: action.product?.unit ?? "to‘lov",
              quantity: action.quantity.toFixed(3),
              currentPrice: action.product?.price ?? 0,
              salePrice: action.product?.price ?? 0,
              totalAmount,
              cashPayment: actionIndex === 0 ? inputRow.cash : 0,
              terminalPayment: actionIndex === 0 ? inputRow.terminal : 0,
              clickPayment: actionIndex === 0 ? inputRow.click : 0,
              transferPayment: actionIndex === 0 ? inputRow.transfer : 0,
              note: `Tezkor KEG savdosi • ${input.idempotencyKey}`,
              source: "manual",
              createdBy: ctx.user.id,
            })
            .$returningId();
          transactionIds.push(created.id);
          await reconcileTransactionContainers(tx, {
            transactionId: created.id,
            movementDate: transactionDate,
            agentId: input.agentId,
            clientId: client.id,
            productContainerType: action.quantity > 0 ? action.type : null,
            productQuantity: action.quantity,
            containerUnitsPerItem: action.product?.containerUnitsPerItem || 1,
            returnContainerType: action.returned > 0 ? action.type : null,
            returnQuantity: action.returned,
            createdBy: ctx.user.id,
            source: "manual",
          });
          await reconcileTransactionStock(tx, {
            transactionId: created.id,
            movementDate: transactionDate,
            productId: action.product?.id ?? null,
            quantity: action.quantity,
            createdBy: ctx.user.id,
          });
        }

        for (const transactionId of transactionIds) {
          await logAudit(tx, {
            tableName: "transactions",
            recordId: transactionId,
            action: "create",
            userId: ctx.user.id,
            after: {
              source: "Tezkor KEG savdosi",
              clientId: client.id,
              agentId: input.agentId,
              keg30: inputRow.keg30,
              keg50: inputRow.keg50,
              returned30: inputRow.returned30,
              returned50: inputRow.returned50,
              saleAmount: calculated.saleAmount,
              cash: inputRow.cash,
              terminal: inputRow.terminal,
              click: inputRow.click,
              transfer: inputRow.transfer,
            },
          });
        }

        savedRows.push({
          clientCode: client.code,
          clientName: client.name,
          ...inputRow,
          saleAmount: calculated.saleAmount,
          endingDebt: calculated.endingDebt,
          endingKeg30Balance: calculated.endingKeg30Balance,
          endingKeg50Balance: calculated.endingKeg50Balance,
          transactionIds,
        });
      }

      return {
        success: true,
        duplicate: false,
        message: `${savedRows.length} ta mijoz uchun KEG operatsiyalari saqlandi.`,
        rows: savedRows,
        summary: summarizeFastKegRows(savedRows),
      };
    });
  }),
});
