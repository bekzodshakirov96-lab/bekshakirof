import { toCyrillic } from "@shared/translit";

export type Language = "latin" | "cyrillic";

export const LANGUAGE_STORAGE_KEY = "nokdaun.language";

/**
 * Joriy alifboni brauzer xotirasidan o'qiydi.
 *
 * React kontekstidan tashqarida (masalan Excel/PDF eksport funksiyalarida) kerak
 * bo'ladi — u yerda hook ishlatib bo'lmaydi, lekin hujjat ekrandagi bilan bir xil
 * alifboda chiqishi kerak.
 */
export function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "latin";
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "cyrillic" ? "cyrillic" : "latin";
}

/**
 * Eksport hujjatlariga tushadigan matnni joriy alifboga moslaydi. Lotin rejimida
 * matn o'zgarishsiz qaytadi.
 */
export function localizeExportText<T>(value: T): T {
  if (typeof value !== "string") return value;
  if (getStoredLanguage() !== "cyrillic") return value;
  return toCyrillic(value) as unknown as T;
}

/** pdfmake hujjatida matn tashiydigan kalitlar. Faqat shular o'giriladi —
 * `color: "#64748B"` kabi qiymatlarga tegib bo'lmaydi. */
const PDF_TEXT_KEYS = new Set(["text", "title", "subject", "author"]);

/**
 * pdfmake hujjat ta'rifidagi barcha matnni joriy alifboga o'giradi.
 *
 * Har bir `text:` tugunni qo'lda o'rash o'rniga daraxtni to'liq aylanib chiqamiz —
 * shunda yangi qo'shilgan bo'limlar ham e'tibordan chetda qolmaydi. Uslub va rang
 * qiymatlari tegilmaydi.
 */
export function localizePdfDocument<T>(node: T): T {
  if (getStoredLanguage() !== "cyrillic") return node;
  return walk(node, false) as T;
}

function walk(node: unknown, translate: boolean): unknown {
  if (typeof node === "string") return translate ? toCyrillic(node) : node;
  if (Array.isArray(node)) return node.map(item => walk(item, translate));
  if (node && typeof node === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      // Matn kalitidan pastda joylashgan barcha satrlar o'giriladi (masalan
      // `text: [{ text: "..." }]` kabi ichma-ich tuzilmalar uchun).
      result[key] = walk(value, translate || PDF_TEXT_KEYS.has(key));
    }
    return result;
  }
  return node;
}
