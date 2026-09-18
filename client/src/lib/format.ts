export function formatMoney(value: number | null | undefined, compact = false) {
  const amount = Number(value ?? 0);
  if (compact) {
    return new Intl.NumberFormat("uz-UZ", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount) + " so‘m";
  }
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 }).format(amount) + " so‘m";
}

export function formatNumber(value: number | string | null | undefined, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits }).format(Number(value ?? 0));
}

export function formatDate(value: string | number | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDate(date)} ${time}`;
}

export function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("uz-UZ", { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1));
}

/**
 * `<input type="date">` uchun YYYY-MM-DD qiymati, MAHALLIY kalendar kuni bo'yicha.
 * `date.toISOString().slice(0, 10)` UTC vaqtidan foydalanadi — Toshkent (UTC+5) kabi
 * mintaqalarda tungi soat 00:00–05:00 oralig'ida bu "kecha"gi sanani qaytarib yuboradi.
 */
export function localDateInputValue(date: Date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Biznes kuni barcha qurilmalarda Toshkent kalendari bo'yicha bir xil bo'lishi kerak.
 * Brauzerning mahalliy vaqt mintaqasiga tayanilsa, Mac va Windows boshqa mintaqalarda
 * turganida ayni yozuv turli kunga tushib qolishi mumkin.
 */
export function tashkentDateInputValue(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * YYYY-MM-DD qiymatini Toshkentdagi kunduz soat 12:00 ga bog'laydi. Natija qurilma
 * vaqt mintaqasidan mustaqil va serverdagi kunlik chegaralar bilan bir xil ishlaydi.
 */
export function tashkentDateToTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), 7);
  return tashkentDateInputValue(new Date(timestamp)) === value ? timestamp : Number.NaN;
}

/** YYYY-MM-DD qiymatini vaqt mintaqasiga bog'lamasdan kunlar bo'yicha suradi. */
export function shiftDateInputValue(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * type="number" ishlatilmasin: fokusdagi number-inputda sichqoncha g'ildiragi qiymatni
 * tasodifan o'zgartirib/o'chirib yuborishi mumkin (brauzerning standart xatti-harakati).
 * O'rniga type="text" + inputMode + shu sanitizatsiya funksiyalaridan foydalaning.
 */
export function sanitizeIntegerInput(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}
