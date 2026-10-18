import { eq, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appSettings, users } from "../drizzle/schema";
import {
  COMPANY_COLUMNS,
  COMPANY_MODULES,
  companyColumnLabel,
  companyDateSchema,
  companyPreferencesSchema,
  defaultCompanyPreferences,
  type CompanyColumnKey,
  type CompanyPreferences,
} from "../shared/companyPreferences";
import { tashkentBusinessDate } from "../shared/agentReconciliation";
import type { requireDb } from "./db";
import { logAudit } from "./auditLog";
import type { DatabaseTransaction } from "./stockAccounting";

type Db = Awaited<ReturnType<typeof requireDb>>;
type Reader = Pick<Db, "select">;
const PREFIX = "company-ui.";
const HEAD = `${PREFIX}head`;
export const COMPANY_PREFERENCES_HEAD = HEAD;
type Snapshot = {
  revision: number;
  effectiveDate: string | null;
  preferences: CompanyPreferences;
};
function auditView(snapshot: Snapshot) {
  return {
    "Amal qilish sanasi": snapshot.effectiveDate ?? "Asl sozlamalar",
    ...Object.fromEntries(
      (Object.keys(COMPANY_COLUMNS) as CompanyColumnKey[]).map(key => [
        `${COMPANY_COLUMNS[key].section === "journal" ? "Kunlik jurnal" : "Agent × Tovar"} / ${COMPANY_COLUMNS[key].label}`,
        companyColumnLabel(snapshot.preferences, key),
      ])
    ),
    "Yashirilgan modullar":
      snapshot.preferences.hiddenModules
        .map(key => COMPANY_MODULES[key].label)
        .join(", ") || "Barchasi ko‘rsatiladi",
  };
}

/** Existing tenant-scoped settings table; immutable, chunked snapshots stay within
 * its 500-character value limit. Only HEAD is updated. No schema/data backfill. */
export async function readCompanyPreferences(
  db: Reader,
  date = tashkentBusinessDate(new Date())
) {
  companyDateSchema.parse(date);
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(like(appSettings.key, `${PREFIX}%`));
  const values = new Map(rows.map(row => [row.key, row.value]));
  const latestRevision = Number(values.get(HEAD) ?? 0);
  if (!Number.isSafeInteger(latestRevision) || latestRevision < 0)
    throw new Error("Firma sozlamalari versiyasi noto‘g‘ri.");
  let snapshot: Snapshot = {
    revision: 0,
    effectiveDate: null,
    preferences: defaultCompanyPreferences(),
  };
  // New revisions can only be effective today; latest revision wins on that day.
  for (let revision = latestRevision; revision > 0; revision--) {
    const count = Number(values.get(`${PREFIX}${revision}.count`));
    if (!Number.isInteger(count) || count < 1 || count > 30)
      throw new Error("Firma sozlamalari tarixini o‘qib bo‘lmadi.");
    const chunks = Array.from({ length: count }, (_, i) =>
      values.get(`${PREFIX}${revision}.${i}`)
    );
    if (chunks.some(value => typeof value !== "string"))
      throw new Error("Firma sozlamalari to‘liq emas.");
    const parsed = JSON.parse(chunks.join("")) as Snapshot;
    if (parsed.revision !== revision)
      throw new Error("Firma sozlamalari versiyasi mos emas.");
    const effectiveDate = companyDateSchema.parse(parsed.effectiveDate);
    const preferences = companyPreferencesSchema.parse(parsed.preferences);
    if (effectiveDate <= date) {
      snapshot = { revision, effectiveDate, preferences };
      break;
    }
  }
  return { ...snapshot, latestRevision };
}

export async function saveCompanyPreferences(
  db: Db,
  preferences: CompanyPreferences,
  expectedRevision: number,
  userId: number,
  now = new Date()
) {
  return db.transaction(tx =>
    writeCompanyPreferences(tx, preferences, expectedRevision, userId, now)
  );
}

export async function lockCompanyPreferences(
  tx: DatabaseTransaction,
  userId: number
) {
  // app_settings/audit reference the owner. Acquire that row before HEAD in
  // every settings writer: otherwise two first-time template requests can
  // deadlock when FK shared locks meet the onboarding user-range check.
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!owner)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Firma foydalanuvchisi topilmadi.",
    });
  await tx
    .insert(appSettings)
    .values({ key: HEAD, value: "0", updatedBy: userId })
    .onDuplicateKeyUpdate({ set: { key: HEAD } });
  const [head] = await tx
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, HEAD))
    .for("update");
  return Number(head.value);
}

/** Used inside the caller's transaction so template selection and its marker
 * commit with the first preference snapshot, including the existing audit. */
export async function writeCompanyPreferences(
  tx: DatabaseTransaction,
  preferences: CompanyPreferences,
  expectedRevision: number,
  userId: number,
  now = new Date(),
  reason?: string
) {
  const validated = companyPreferencesSchema.parse(preferences);
  const currentRevision = await lockCompanyPreferences(tx, userId);
  if (currentRevision !== expectedRevision)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Sozlamalar boshqa oynada o‘zgargan. Yangilab, qayta tekshiring.",
    });
  const before = await readCompanyPreferences(tx);
  const snapshot: Snapshot = {
    revision: currentRevision + 1,
    effectiveDate: tashkentBusinessDate(now),
    preferences: validated,
  };
  const json = JSON.stringify(snapshot);
  const characters = Array.from(json);
  const chunks = Array.from(
    { length: Math.ceil(characters.length / 400) },
    (_, i) => characters.slice(i * 400, (i + 1) * 400).join("")
  );
  await tx.insert(appSettings).values([
    {
      key: `${PREFIX}${snapshot.revision}.count`,
      value: String(chunks.length),
      updatedBy: userId,
    },
    ...chunks.map((value, index) => ({
      key: `${PREFIX}${snapshot.revision}.${index}`,
      value,
      updatedBy: userId,
    })),
  ]);
  await tx
    .update(appSettings)
    .set({
      value: String(snapshot.revision),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.key, HEAD));
  await logAudit(tx, {
    tableName: "company_preferences",
    recordId: snapshot.revision,
    action: "update",
    userId,
    before: auditView(before),
    after: auditView(snapshot),
    reason,
  });
  return { ...snapshot, latestRevision: snapshot.revision };
}
