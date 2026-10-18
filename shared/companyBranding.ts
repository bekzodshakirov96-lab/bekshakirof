import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      value => !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value),
      "Matnda boshqaruv belgisi bor."
    );
const brandColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Rang #RRGGBB ko‘rinishida bo‘lsin.")
  .transform(value => value.toUpperCase());
export const companyBrandFieldsSchema = z
  .object({
    name: text(80).refine(value => value.length > 0, "Firma nomini kiriting."),
    tagline: text(80),
    color: brandColor.nullable(),
    // Optional on writes: older clients must not erase saved backgrounds.
    backgroundLight: brandColor.nullable().optional(),
    backgroundDark: brandColor.nullable().optional(),
  })
  .strict();
export const companyBrandingSchema = companyBrandFieldsSchema
  .extend({
    // Older stored revisions have neither field; reading them writes nothing.
    backgroundLight: brandColor.nullable().default(null),
    backgroundDark: brandColor.nullable().default(null),
    logoUrl: z
      .string()
      .regex(/^\/uploads\/branding\/[a-f0-9-]+_[a-f0-9]{8}\.png$/)
      .nullable(),
  })
  .strict();
export type CompanyBranding = z.infer<typeof companyBrandingSchema>;
export const MAX_BRAND_LOGO_BYTES = 350 * 1024;
export const companyBrandingSaveSchema = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    branding: companyBrandFieldsSchema,
    logo: z.discriminatedUnion("action", [
      z.object({ action: z.literal("keep") }).strict(),
      z.object({ action: z.literal("remove") }).strict(),
      z
        .object({
          action: z.literal("replace"),
          base64: z
            .string()
            .min(1)
            .max(Math.ceil(MAX_BRAND_LOGO_BYTES / 3) * 4)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .strict(),
    ]),
  })
  .strict();
export type CompanyBrandingSave = z.infer<typeof companyBrandingSaveSchema>;
export type CompanyBrandingSnapshot = {
  revision: number;
  branding: CompanyBranding;
};
export function isCompanyBrandingSetting(key: string) {
  return /^company-brand\.(?:head|\d+\.(?:count|\d+))$/.test(key);
}
export function defaultCompanyBranding(): CompanyBranding {
  return {
    name: "BiznesControl",
    tagline: "Firma kabineti",
    color: null,
    backgroundLight: null,
    backgroundDark: null,
    logoUrl: null,
  };
}
export function companyInitials(name: string) {
  if (name === "BiznesControl") return "BC";
  const words = name.match(new RegExp("[\\p{L}\\p{N}]+", "gu")) ?? [];
  return (
    words.length > 1
      ? words[0]!.charAt(0) + words[1]!.charAt(0)
      : Array.from(words[0] ?? "BC")
          .slice(0, 2)
          .join("")
  ).toLocaleUpperCase();
}
