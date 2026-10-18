import { z } from "zod";
import {
  companyDateSchema,
  defaultCompanyPreferences,
  type CompanyPreferences,
} from "./companyPreferences";

export const COMPANY_TEMPLATE_IDS = [
  "wholesale",
  "agent_distribution",
  "beverages_keg",
] as const;
export type CompanyTemplateId = (typeof COMPANY_TEMPLATE_IDS)[number];
export const COMPANY_TEMPLATE_VERSION = 1;
export const COMPANY_TEMPLATES = [
  {
    id: "wholesale",
    name: "Ulgurji savdo",
    description: "Mahsulotni ombordan sotadigan savdo firmalari uchun.",
    focus: "Savdo · Ombor · Kassa",
    hidden: ["fastKeg", "factory", "containers", "agentMatrix"],
  },
  {
    id: "agent_distribution",
    name: "Agentlar orqali tarqatish",
    description:
      "Omborchi bergan tayyor miqdorlarni agentlar bo‘yicha kiritish uchun.",
    focus: "Agent × Tovar · Kassa · Solishtirish",
    hidden: ["fastKeg", "factory", "containers", "sales"],
  },
  {
    id: "beverages_keg",
    name: "Ichimliklar va KEG",
    description:
      "KEG, tara, zavod va butilka hisobini yuritadigan firmalar uchun.",
    focus: "Tezkor KEG · Zavod · Butilka · Kassa",
    hidden: [],
  },
] as const;

/** Version 1 is immutable. Later catalog changes must add a new version instead
 * of reinterpreting existing companies' saved settings. No products or amounts. */
export function companyTemplatePreferences(
  id: CompanyTemplateId,
  version = COMPANY_TEMPLATE_VERSION
): CompanyPreferences {
  if (version !== 1)
    throw new Error("Shablon versiyasi qo‘llab-quvvatlanmaydi.");
  const definition = COMPANY_TEMPLATES.find(template => template.id === id);
  if (!definition) throw new Error("Shablon topilmadi.");
  if (id === "beverages_keg") return defaultCompanyPreferences();
  return {
    labels: {
      agent_cash_keg: "Naqd kirim 1",
      agent_cash_pet: "Naqd kirim 2",
      salary: "Ish haqi",
      meals: "Ovqatlanish",
      fuel: "Yoqilg‘i",
      supplier_payment: "Tovar uchun to‘lov",
      other_expense: "Xarajat",
      journalAgent: id === "wholesale" ? "Mas’ul" : "Agent",
      terminal: "Terminal",
      transfer: "O‘tkazma",
      product: "Mahsulot",
      stock: "Ombor qoldig‘i",
      receipt: "Tovar kirimi",
    },
    hiddenModules: [...definition.hidden],
  };
}
export const templateApplySchema = z
  .object({
    templateId: z.enum(COMPANY_TEMPLATE_IDS),
    requestKey: z.string().uuid(),
  })
  .strict();
export const templateRecordSchema = z
  .object({
    templateId: z.enum(COMPANY_TEMPLATE_IDS),
    version: z.literal(1),
    appliedDate: companyDateSchema,
    requestKey: z.string().uuid(),
  })
  .strict();
export type CompanyTemplateRecord = z.infer<typeof templateRecordSchema>;
