import { randomUUID, randomBytes } from "node:crypto";
import { unlink, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { eq, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appSettings, users } from "../drizzle/schema";
import {
  companyBrandingSchema,
  companyBrandingSaveSchema,
  defaultCompanyBranding,
  type CompanyBrandingSave,
  type CompanyBrandingSnapshot,
  type CompanyBranding,
} from "../shared/companyBranding";
import type { requireDb } from "./db";
import { logAudit } from "./auditLog";
import { decodeBrandLogo } from "./brandLogo";
import { UPLOADS_DIR } from "./storage";

type Db = Awaited<ReturnType<typeof requireDb>>;
const PREFIX = "company-brand.",
  HEAD = PREFIX + "head";
export type BrandLogoStorage = {
  put: (data: Buffer) => Promise<{ url: string; discard: () => Promise<void> }>;
};
export function brandLogoStorageAt(root: string): BrandLogoStorage {
  return {
    async put(data) {
      const key = `branding/${randomUUID()}_${randomBytes(4).toString("hex")}.png`;
      const target = path.join(root, key);
      await mkdir(path.dirname(target), { recursive: true });
      const handle = await open(target, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(target).catch(() => {});
        throw error;
      }
      return { url: `/uploads/${key}`, discard: () => unlink(target) };
    },
  };
}
const localLogoStorage = brandLogoStorageAt(UPLOADS_DIR);
const auditView = (brand: CompanyBranding) => ({
  "Firma nomi": brand.name,
  "Nom ostidagi yozuv": brand.tagline,
  "Asosiy rang": brand.color ?? "Standart",
  Logotip: brand.logoUrl ?? "Harfli belgi",
});

/** Reads/writes only tenant-scoped app_settings. Branding is independent of
 * dated column/module snapshots and never changes company financial records. */
export async function readCompanyBranding(
  db: Pick<Db, "select">
): Promise<CompanyBrandingSnapshot> {
  const [head] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, HEAD))
    .limit(1);
  const revision = Number(head?.value ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw Error("Firma ko‘rinishi versiyasi noto‘g‘ri.");
  if (!revision) return { revision: 0, branding: defaultCompanyBranding() };
  const prefix = `${PREFIX}${revision}.`;
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(like(appSettings.key, `${prefix}%`));
  const values = new Map(rows.map(row => [row.key, row.value]));
  const count = Number(values.get(prefix + "count"));
  if (!Number.isInteger(count) || count < 1 || count > 8)
    throw Error("Firma ko‘rinishi sozlamalari to‘liq emas.");
  const parts = Array.from({ length: count }, (_, i) => values.get(prefix + i));
  if (parts.some(value => typeof value !== "string"))
    throw Error("Firma ko‘rinishi sozlamalari to‘liq emas.");
  return {
    revision,
    branding: companyBrandingSchema.parse(JSON.parse(parts.join(""))),
  };
}

export async function saveCompanyBranding(
  db: Db,
  raw: CompanyBrandingSave,
  userId: number,
  storage: BrandLogoStorage = localLogoStorage
) {
  const input = companyBrandingSaveSchema.parse(raw);
  let image: Buffer | undefined;
  try {
    if (input.logo.action === "replace")
      image = decodeBrandLogo(input.logo.base64);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Logotipni qayta tanlang. PNG, JPG yoki WebP rasm ishlating.",
    });
  }
  let created: Awaited<ReturnType<BrandLogoStorage["put"]>> | undefined;
  try {
    return await db.transaction(async tx => {
      const [owner] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (owner?.role !== "admin")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Firma ko‘rinishini faqat rahbar o‘zgartiradi.",
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
      const revision = Number(head.value);
      if (revision !== input.expectedRevision)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Ko‘rinish boshqa oynada o‘zgargan. Yangi sozlamalarni yuklang.",
        });
      const before = await readCompanyBranding(tx);
      let logoUrl = before.branding.logoUrl;
      if (input.logo.action === "remove") logoUrl = null;
      if (image) {
        try {
          created = await storage.put(image);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Logotipni saqlab bo‘lmadi. Qayta urinib ko‘ring.",
          });
        }
        logoUrl = created.url;
      }
      const branding = companyBrandingSchema.parse({
        ...input.branding,
        logoUrl,
      });
      const characters = Array.from(JSON.stringify(branding));
      const parts = Array.from(
        { length: Math.ceil(characters.length / 400) },
        (_, i) => characters.slice(i * 400, (i + 1) * 400).join("")
      );
      const next = revision + 1,
        prefix = `${PREFIX}${next}.`;
      await tx.insert(appSettings).values([
        {
          key: prefix + "count",
          value: String(parts.length),
          updatedBy: userId,
        },
        ...parts.map((value, i) => ({
          key: prefix + i,
          value,
          updatedBy: userId,
        })),
      ]);
      await tx
        .update(appSettings)
        .set({ value: String(next), updatedBy: userId, updatedAt: new Date() })
        .where(eq(appSettings.key, HEAD));
      await logAudit(tx, {
        tableName: "company_branding",
        recordId: next,
        action: "update",
        userId,
        before: auditView(before.branding),
        after: auditView(branding),
      });
      return { revision: next, branding };
    });
  } catch (error) {
    if (created) await created.discard().catch(() => {});
    throw error;
  }
}
