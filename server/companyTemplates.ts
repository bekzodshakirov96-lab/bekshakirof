import { eq, getTableName, is, sql } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import { TRPCError } from "@trpc/server";
import {
  COMPANY_TEMPLATES,
  companyTemplatePreferences,
  templateRecordSchema,
  type CompanyTemplateId,
  type CompanyTemplateRecord,
} from "../shared/companyTemplates";
import { tashkentBusinessDate } from "../shared/agentReconciliation";
import {
  COMPANY_PREFERENCES_HEAD,
  lockCompanyPreferences,
  readCompanyPreferences,
  writeCompanyPreferences,
} from "./companyPreferences";
import type { requireDb } from "./db";
import type { DatabaseTransaction } from "./stockAccounting";

type Db = Awaited<ReturnType<typeof requireDb>>;
type Reader = Pick<Db, "select">;
export const COMPANY_TEMPLATE_KEY = "company-onboarding-template";
const businessTables = Object.values(schema)
  .filter(value => is(value, MySqlTable))
  .filter(table => !["users", "app_settings"].includes(getTableName(table)))
  .sort((a, b) => getTableName(a).localeCompare(getTableName(b)));

async function savedTemplate(
  db: Reader
): Promise<CompanyTemplateRecord | null> {
  const [row] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, COMPANY_TEMPLATE_KEY))
    .limit(1);
  return row?.value ? templateRecordSchema.parse(JSON.parse(row.value)) : null;
}

async function eligibility(db: Reader, userId: number, locking = false) {
  const accountQuery = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(2);
  const accounts = await accountQuery;
  if (accounts.length !== 1 || accounts[0].id !== userId)
    return "existing_data" as const;
  if (locking) {
    const lockedAccounts = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .limit(2)
      .for("update");
    if (lockedAccounts.length !== 1 || lockedAccounts[0].id !== userId)
      return "existing_data" as const;
  }
  const settingsQuery = db.select().from(schema.appSettings);
  const settings = locking
    ? await settingsQuery.for("update")
    : await settingsQuery;
  if (
    settings.some(
      row =>
        row.key !== "bootstrapAdminClaimed" &&
        !(row.key === COMPANY_PREFERENCES_HEAD && row.value === "0")
    )
  )
    return "customized" as const;
  // Locking reads on indexed tenant ranges prevent the first business insert
  // racing the empty-company check. Existing rows are never updated or deleted.
  for (const table of businessTables) {
    const query = db
      .select({ exists: sql<number>`1` })
      .from(table)
      .limit(1);
    const rows = locking ? await query.for("update") : await query;
    if (rows.length) return "existing_data" as const;
  }
  return "eligible" as const;
}

export async function companyTemplateStatus(db: Reader, userId: number) {
  const template = await savedTemplate(db);
  return {
    state: template ? ("configured" as const) : await eligibility(db, userId),
    template,
  };
}

export async function applyCompanyTemplate(
  db: Db,
  templateId: CompanyTemplateId,
  requestKey: string,
  userId: number
) {
  return db.transaction(async (tx: DatabaseTransaction) => {
    await lockCompanyPreferences(tx, userId);
    const previous = await savedTemplate(tx);
    if (previous) {
      if (
        previous.requestKey === requestKey &&
        previous.templateId === templateId
      )
        return {
          configuration: await readCompanyPreferences(tx),
          template: previous,
          replayed: true,
        };
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Firma shabloni allaqachon tanlangan. Keyingi nom va menyu o‘zgarishlarini Firma sozlamalarida kiriting.",
      });
    }
    if ((await eligibility(tx, userId, true)) !== "eligible")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Bu firmada ma’lumotlar yoki sozlamalar mavjud. Tayyor shablon faqat bo‘sh yangi firma uchun qo‘llanadi.",
      });
    const now = new Date();
    const configuration = await writeCompanyPreferences(
      tx,
      companyTemplatePreferences(templateId),
      0,
      userId,
      now,
      `Faoliyat shabloni: ${COMPANY_TEMPLATES.find(template => template.id === templateId)!.name} (1-versiya)`
    );
    const template: CompanyTemplateRecord = {
      templateId,
      version: 1,
      appliedDate: tashkentBusinessDate(now),
      requestKey,
    };
    await tx.insert(schema.appSettings).values({
      key: COMPANY_TEMPLATE_KEY,
      value: JSON.stringify(template),
      updatedBy: userId,
    });
    return { configuration, template, replayed: false };
  });
}
