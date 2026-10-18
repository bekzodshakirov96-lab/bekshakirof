import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { bottleMovements } from "../drizzle/schema";
import type { requireDb } from "./db";

// Calendar dates are interpreted in Tashkent, independently of browser/server TZ.
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00+05:00`);
  return Number.isFinite(date.getTime()) && new Date(date.getTime() + 18_000_000).toISOString().slice(0, 10) === value;
}, "Sana noto'g'ri");

export const bottleReportInput = z.object({
  fromDate: calendarDate.optional(),
  toDate: calendarDate.optional(),
  page: z.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
}).refine(value => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  message: "Boshlanish sanasi tugash sanasidan keyin bo'lmasligi kerak",
  path: ["toDate"],
});

export async function readBottleReport(db: Awaited<ReturnType<typeof requireDb>>, input: z.infer<typeof bottleReportInput>) {
  const start = input.fromDate ? new Date(`${input.fromDate}T00:00:00+05:00`) : undefined;
  const end = input.toDate ? new Date(new Date(`${input.toDate}T00:00:00+05:00`).getTime() + 86_400_000) : undefined;
  const where = and(start ? gte(bottleMovements.movementDate, start) : undefined, end ? lt(bottleMovements.movementDate, end) : undefined);
  const debtChange = sql<number>`case when ${bottleMovements.movementType} = 'sent' then ${bottleMovements.amount} when ${bottleMovements.movementType} = 'payment' then -${bottleMovements.amount} else 0 end`;

  // Totals cover ALL matching rows, not just the displayed page. One read-only
  // snapshot keeps totals, page and historical balances consistent during edits.
  return db.transaction(async tx => {
    const [totals] = await tx.select({
      total: sql<number>`count(*)`.mapWith(Number),
      sentQuantity: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'sent' then ${bottleMovements.quantity} else 0 end), 0)`.mapWith(Number),
      sentAmount: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'sent' then ${bottleMovements.amount} else 0 end), 0)`.mapWith(Number),
      paidAmount: sql<number>`coalesce(sum(case when ${bottleMovements.movementType} = 'payment' then ${bottleMovements.amount} else 0 end), 0)`.mapWith(Number),
    }).from(bottleMovements).where(where);
    const total = totals?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(input.page, pageCount);
    const rows = await tx.select({
      id: bottleMovements.id,
      movementDate: bottleMovements.movementDate,
      movementType: bottleMovements.movementType,
      quantity: bottleMovements.quantity,
      unitPrice: bottleMovements.unitPrice,
      amount: bottleMovements.amount,
      note: bottleMovements.note,
    }).from(bottleMovements).where(where)
      .orderBy(desc(bottleMovements.movementDate), desc(bottleMovements.id))
      .limit(input.pageSize).offset((page - 1) * input.pageSize);

    // Preserve the real historical factory debt, including dates outside the
    // filter and previous pages. Same-day ordering is stable by record ID.
    const oldest = rows.at(-1);
    let balance = 0;
    if (oldest) {
      const [opening] = await tx.select({ amount: sql<number>`coalesce(sum(${debtChange}), 0)`.mapWith(Number) })
        .from(bottleMovements).where(or(
          lt(bottleMovements.movementDate, oldest.movementDate),
          and(eq(bottleMovements.movementDate, oldest.movementDate), lt(bottleMovements.id, oldest.id)),
        ));
      balance = opening?.amount ?? 0;
    }
    const items = [...rows].reverse().map(row => {
      const amount = Number(row.amount);
      if (row.movementType === "sent") balance += amount;
      else if (row.movementType === "payment") balance -= amount;
      return { ...row, amount, balanceAfter: balance };
    }).reverse();
    return {
      items, total, page, pageCount,
      sentQuantity: totals?.sentQuantity ?? 0,
      sentAmount: totals?.sentAmount ?? 0,
      paidAmount: totals?.paidAmount ?? 0,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
