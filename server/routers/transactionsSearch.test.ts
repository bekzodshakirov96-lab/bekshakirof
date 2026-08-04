import { describe, expect, it } from "vitest";
import { normalizeSearch } from "../businessQueries";
import { buildSearchCondition, findSearchMatches } from "./transactions";

const rows = {
  clients: [
    { id: 1, name: "Sardor Raxim" },
    { id: 2, name: "Сардор 50" },
    { id: 3, name: "Akmal yangibozor" },
  ],
  agents: [
    { id: 10, name: "Rustam" },
    { id: 11, name: "Зафар" },
  ],
  productNames: ["Barlos 1.5L", "Нокдаун 2.5л"],
};

/** `buildSearchCondition` faqat kichik jadvallarni o'qiydi — soxta db yetarli. */
function fakeDb() {
  let call = 0;
  const resolveTo = (value: unknown[]) => ({ from: () => Promise.resolve(value) });
  return {
    select: () => resolveTo(call++ === 0 ? rows.clients : rows.agents),
    selectDistinct: () => resolveTo(rows.productNames.map(productName => ({ productName }))),
  } as never;
}

describe("savdo jurnali qidiruvi", () => {
  it("kirill qidiruv lotin yozuvidagi mijozni topadi", () => {
    const matched = findSearchMatches(rows, normalizeSearch("Сардор Рахим"));
    expect(matched.clientIds).toEqual([1]);
  });

  it("lotin qidiruv kirill yozuvidagi mijozni ham topadi", () => {
    // "Sardor" ikkalasiga mos keladi: "Sardor Raxim" (lotin) va "Сардор 50" (kirill).
    const matched = findSearchMatches(rows, normalizeSearch("Sardor"));
    expect(matched.clientIds).toEqual([1, 2]);
  });

  it("agent va mahsulot nomi bo'yicha ham topadi", () => {
    expect(findSearchMatches(rows, normalizeSearch("Зафар")).agentIds).toEqual([11]);
    expect(findSearchMatches(rows, normalizeSearch("Nokdaun")).productNames).toEqual(["Нокдаун 2.5л"]);
  });

  it("mos kelmaydigan so'zda hech narsa topmaydi", () => {
    const matched = findSearchMatches(rows, normalizeSearch("bunday-nom-yoq"));
    expect(matched).toEqual({ clientIds: [], agentIds: [], productNames: [] });
  });

  it("qidiruv bo'sh bo'lsa shart qo'ymaydi (butun jurnal)", async () => {
    expect(await buildSearchCondition(fakeDb(), "   ")).toBeUndefined();
  });

  /**
   * Eng muhim holat: hech narsa topilmasa `undefined` qaytarib bo'lmaydi — u
   * "filtrsiz" degani bo'lib, qidiruvga javob bermagan holda butun savdo
   * jurnalini qaytarib yuborardi.
   */
  it("hech narsa topilmasa ham shart qaytaradi (butun jurnal chiqib ketmasligi uchun)", async () => {
    expect(await buildSearchCondition(fakeDb(), "bunday-nom-yoq")).toBeDefined();
  });
});
