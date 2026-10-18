import { z } from "zod";
import {
  cashCategoryIdFromLegacy,
  cashStorageCategory,
} from "./cashCategoryRegistry";

/** Presentation only: financial identities, units and authorization are never editable. */
export const COMPANY_COLUMNS = {
  agent_cash_keg: {
    section: "journal",
    label: cashStorageCategory("agent_cash_keg"),
    hint: "Agent topshirgan naqd kirim, 1-tur",
  },
  agent_cash_pet: {
    section: "journal",
    label: cashStorageCategory("agent_cash_pet"),
    hint: "Agent topshirgan naqd kirim, 2-tur",
  },
  debt_repayment: {
    section: "journal",
    label: cashStorageCategory("debt_repayment"),
    hint: "Kassa qarzining qaytimi",
  },
  salary: {
    section: "journal",
    label: cashStorageCategory("salary"),
    hint: "Naqd chiqim: ish haqi",
  },
  meals: {
    section: "journal",
    label: cashStorageCategory("meals"),
    hint: "Naqd chiqim: ovqatlanish",
  },
  fuel: {
    section: "journal",
    label: cashStorageCategory("fuel"),
    hint: "Naqd chiqim: yoqilg‘i",
  },
  supplier_payment: {
    section: "journal",
    label: cashStorageCategory("supplier_payment"),
    hint: "Naqd chiqim: tovar uchun to‘lov",
  },
  other_expense: {
    section: "journal",
    label: cashStorageCategory("other_expense"),
    hint: "Boshqa naqd chiqim",
  },
  journalAgent: {
    section: "journal",
    label: "Агент",
    hint: "Agent yoki xodim",
  },
  debt: {
    section: "journal",
    label: "Qarz",
    hint: "Qarz qaydi, naqd qoldiqni o‘zgartirmaydi",
  },
  terminal: {
    section: "journal",
    label: "Терминал",
    hint: "Terminal tushumi, naqd pul emas",
  },
  click: {
    section: "journal",
    label: "Click",
    hint: "Click tushumi, naqd pul emas",
  },
  transfer: {
    section: "journal",
    label: "Перечисление",
    hint: "Bank o‘tkazmasi, naqd pul emas",
  },
  debtNote: {
    section: "journal",
    label: "Qarz izohi",
    hint: "Qarz kimga berilganligi va izohi",
  },
  note: { section: "journal", label: "Izoh", hint: "Yozuv izohi" },
  product: { section: "matrix", label: "Товар", hint: "Mahsulot nomi" },
  stock: {
    section: "matrix",
    label: "Ostatka",
    hint: "Ombordagi yakuniy qoldiq",
  },
  receipt: {
    section: "matrix",
    label: "Prixod",
    hint: "Shu kuni kelgan tovar",
  },
  price: {
    section: "matrix",
    label: "Narxi",
    hint: "Mahsulotning asosiy narxi",
  },
  dailyPrice: {
    section: "matrix",
    label: "Kunlik narx",
    hint: "Tanlangan sanadagi narx",
  },
} as const;
export type CompanyColumnKey = keyof typeof COMPANY_COLUMNS;
export const COMPANY_MODULES = {
  fastKeg: {
    label: "Tezkor KEG",
    description: "KEG savdosi bo‘limi",
    paths: ["/tezkor-keg"],
  },
  sales: {
    label: "Savdo",
    description: "Savdo kiritish va sotuv hisoboti",
    paths: ["/savdo", "/sotuv-hisoboti"],
  },
  warehouse: {
    label: "Ombor",
    description: "Sklad va sklad hisoboti",
    paths: ["/sklad", "/sklad-hisoboti"],
  },
  factory: {
    label: "Zavod hisob-kitobi",
    description: "Zavod va butilka harakatlari",
    paths: ["/zavod"],
  },
  containers: {
    label: "Tara nazorati",
    description: "Qaytariladigan tara hisobi",
    paths: ["/tara"],
  },
  employees: {
    label: "Xodimlar",
    description: "Xodimlar va ish haqi",
    paths: ["/xodimlar"],
  },
  imports: {
    label: "Excel import",
    description: "Fayldan ma’lumot yuklash",
    paths: ["/import"],
  },
  agentMatrix: {
    label: "Agent × Tovar",
    description: "Kassadagi mahsulot va agentlar jadvali",
    paths: [],
  },
} as const;
export type CompanyModuleKey = keyof typeof COMPANY_MODULES;
const columnKeys = Object.keys(COMPANY_COLUMNS) as [
  CompanyColumnKey,
  ...CompanyColumnKey[],
];
const moduleKeys = Object.keys(COMPANY_MODULES) as [
  CompanyModuleKey,
  ...CompanyModuleKey[],
];
export const companyDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  }, "Sana noto‘g‘ri.");
export const companyPreferencesSchema = z
  .object({
    labels: z.partialRecord(
      z.enum(columnKeys),
      z
        .string()
        .trim()
        .min(1)
        .max(40)
        .refine(
          value => !/[\u0000-\u001f\u007f]/.test(value),
          "Matnda boshqaruv belgisi bor."
        )
    ),
    hiddenModules: z
      .array(z.enum(moduleKeys))
      .max(moduleKeys.length)
      .refine(values => new Set(values).size === values.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const section of ["journal", "matrix"]) {
      const seen = new Set<string>();
      for (const key of columnKeys.filter(
        key => COMPANY_COLUMNS[key].section === section
      )) {
        const label = (value.labels[key] ?? COMPANY_COLUMNS[key].label)
          .normalize("NFKC")
          .toLocaleLowerCase();
        if (seen.has(label))
          ctx.addIssue({
            code: "custom",
            path: ["labels", key],
            message: "Bir jadvalda ustun nomlari takrorlanmasin.",
          });
        seen.add(label);
      }
    }
  });
export type CompanyPreferences = z.infer<typeof companyPreferencesSchema>;
export const companyPreferencesSaveSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    preferences: companyPreferencesSchema,
  })
  .strict();
export function defaultCompanyPreferences(): CompanyPreferences {
  return { labels: {}, hiddenModules: [] };
}
export function companyColumnLabel(
  preferences: CompanyPreferences,
  key: CompanyColumnKey
) {
  return preferences.labels[key] ?? COMPANY_COLUMNS[key].label;
}
export function companyCashLabel(
  preferences: CompanyPreferences,
  storageCategory: string
) {
  const id = cashCategoryIdFromLegacy(storageCategory);
  if (id && id in COMPANY_COLUMNS)
    return companyColumnLabel(preferences, id as CompanyColumnKey);
  return storageCategory;
}
export function moduleForPath(path: string): CompanyModuleKey | undefined {
  return moduleKeys.find(key =>
    (COMPANY_MODULES[key].paths as readonly string[]).includes(
      path.replace(/\/+$/, "")
    )
  );
}
