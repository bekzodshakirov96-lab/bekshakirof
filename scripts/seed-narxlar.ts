// One-time import of the "Narxlar" (central product price list) sheet from the
// client's monthly Kassa Excel workbook. Run once after setting DATABASE_URL:
//   npx tsx scripts/seed-narxlar.ts
// Safe to re-run: products already present (matched by name, case-insensitive)
// are skipped rather than duplicated.
import { products } from "../drizzle/schema";
import { requireDb } from "../server/db";

// Extracted from the "Narxlar" sheet of the August 2026 workbook. Update this
// list (or point it at a fresh sheet) whenever prices change materially —
// day-to-day price edits should instead be made in the Tovarlar page, since
// historical sales keep their own price snapshot regardless of this list.
const NARXLAR: Array<{ name: string; price: number }> = [
  { name: "Юнусобот 2,5", price: 106000 },
  { name: "Нокдаун 2,5л", price: 112000 },
  { name: "Барлос 2,5л", price: 106000 },
  { name: "Барлос 1,5л", price: 80000 },
  { name: "Барлос 1,2л", price: 67500 },
  { name: "чешское 0,5 л", price: 111000 },
  { name: "Кружка пен 1,0 л", price: 73000 },
  { name: "макка", price: 105000 },
  { name: "Italyano", price: 90000 },
  { name: "махито 86", price: 86000 },
  { name: "suv oq", price: 53000 },
  { name: "Tosh suv", price: 59500 },
  { name: "TAMAT", price: 24000 },
  { name: "Tik tok 1", price: 45000 },
  { name: "Tik tok0,5", price: 35000 },
  { name: "Бочка 50", price: 600000 },
  { name: "Бочка 30", price: 400000 },
  { name: "Живая варка 2.0", price: 88000 },
  { name: "Buchinger 1.5", price: 123000 },
  { name: "Buchinger NF", price: 123000 },
  { name: "Жигуёвское 1.5", price: 123000 },
  { name: "BUCHINGER 130000", price: 130000 },
  { name: "Felliz 0.5", price: 47000 },
  { name: "Felliz 1.25", price: 57000 },
  { name: "ZAMZAM 0.5", price: 45000 },
  { name: "ZAMZAM 1.0", price: 38500 },
  { name: "PANDA", price: 145000 },
  { name: "Немецкий 1.5", price: 110000 },
];

function slugCode(name: string, index: number) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9А-ЯЁ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base ? `NX-${base}-${index}` : `NX-${index}`;
}

async function main() {
  const db = await requireDb();
  const existing = await db.select({ name: products.name }).from(products);
  const existingNames = new Set(existing.map(row => row.name.trim().toLowerCase()));

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < NARXLAR.length; i++) {
    const item = NARXLAR[i];
    const key = item.name.trim().toLowerCase();
    if (existingNames.has(key)) {
      skipped++;
      continue;
    }
    const isKeg30 = /бочка\s*30/i.test(item.name);
    const isKeg50 = /бочка\s*50/i.test(item.name);
    await db.insert(products).values({
      code: slugCode(item.name, i + 1),
      name: item.name,
      unit: "dona",
      price: item.price,
      containerType: isKeg30 ? "keg_30" : isKeg50 ? "keg_50" : undefined,
      containerUnitsPerItem: isKeg30 || isKeg50 ? 1 : 0,
    });
    existingNames.add(key);
    created++;
  }

  console.log(`Narxlar import tugadi: ${created} ta yangi mahsulot qo‘shildi, ${skipped} ta allaqachon bor edi (o‘tkazib yuborildi).`);
  process.exit(0);
}

main().catch(error => {
  console.error("Narxlar import xatosi:", error);
  process.exit(1);
});
