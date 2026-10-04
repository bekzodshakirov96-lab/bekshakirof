import { tashkentBusinessDate } from "../shared/agentReconciliation";

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Drizzle TIMESTAMP qiymatlarini UTC matn sifatida saqlaydi va o'qiydi.
 * Xom SQL chegaralari ham ayni formatda bog'lanishi shart: Date parametri
 * mysql2 tomonidan ulanishning +05:00 mintaqasiga qayta formatlanadi. */
export function toMySqlDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Toshkent kalendar kuni chegaralari, serverning TZ sozlamasidan mustaqil. */
export function tashkentDayRange(timestamp: number) {
  const date = tashkentBusinessDate(new Date(timestamp));
  const [year, month, day] = date.split("-").map(Number);
  const startTime = Date.UTC(year, month - 1, day) - TASHKENT_OFFSET_MS;
  return {
    start: new Date(startTime),
    end: new Date(startTime + DAY_MS - 1),
  };
}
