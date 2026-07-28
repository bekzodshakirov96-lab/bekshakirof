import { eq } from "drizzle-orm";
import { appSettings, auditLog } from "../drizzle/schema";
import type { DatabaseTransaction } from "./stockAccounting";
import { requireDb } from "./db";

type AuditWriter = DatabaseTransaction | Awaited<ReturnType<typeof requireDb>>;

/** Davr qulfi sanasi shu kalit ostida saqlanadi (YYYY-MM-DD yoki bo'sh). */
export const PERIOD_LOCK_KEY = "periodLockDate";

/**
 * Moliyaviy yozuv o'zgarishini tarixga yozadi. Yozuvning o'zi bilan bir xil
 * tranzaksiyada chaqirilishi kerak — shunda yozuv saqlanmasa, tarix ham yozilmaydi.
 */
export async function logAudit(
  tx: AuditWriter,
  entry: {
    tableName: string;
    recordId: number;
    action: "create" | "update" | "delete";
    userId: number | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    tableName: entry.tableName,
    recordId: entry.recordId,
    action: entry.action,
    userId: entry.userId,
    beforeData: entry.before === undefined ? null : JSON.stringify(entry.before),
    afterData: entry.after === undefined ? null : JSON.stringify(entry.after),
    reason: entry.reason ?? null,
  });
}

/**
 * Davr qulfi: shu sanadan oldingi (shu sana ham kiradi) moliyaviy yozuvlarni
 * o'zgartirish/o'chirishni bloklaydi — yopilgan oy hisobotlari keyin jimgina
 * qayta yozilib ketmasligi uchun.
 */
export async function getPeriodLockDate(): Promise<Date | null> {
  const db = await requireDb();
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PERIOD_LOCK_KEY))
    .limit(1);
  if (!row?.value) return null;
  const parsed = new Date(`${row.value}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function assertPeriodUnlocked(recordDate: Date): Promise<void> {
  const lockDate = await getPeriodLockDate();
  if (!lockDate) return;
  if (recordDate.getTime() <= lockDate.getTime()) {
    throw new Error(
      `Bu sana yopilgan davrga tegishli (${lockDate.toLocaleDateString("uz-UZ")} va undan oldingi kunlar qulflangan). O‘zgartirish uchun avval rahbar davr qulfini o‘zgartirishi kerak.`,
    );
  }
}
