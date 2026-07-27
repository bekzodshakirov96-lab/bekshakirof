import { beforeEach, describe, expect, it } from "vitest";
import { LANGUAGE_STORAGE_KEY, localizeExportText, localizePdfDocument } from "./languageStorage";

// Testlar node muhitida ishlaydi (vitest.config.ts), shuning uchun brauzerdagi
// localStorage'ning eng sodda o'rnini qo'yamiz.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      clear: () => store.clear(),
    },
  },
  writable: true,
});

function setLanguage(value: "latin" | "cyrillic") {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
}

describe("eksport alifbosi", () => {
  beforeEach(() => window.localStorage.clear());

  it("lotin rejimida matnni o'zgartirmaydi", () => {
    setLanguage("latin");
    expect(localizeExportText("Mega Market")).toBe("Mega Market");
  });

  it("kirill rejimida matnni o'giradi", () => {
    setLanguage("cyrillic");
    expect(localizeExportText("Mega Market")).toBe("Мега Маркет");
  });

  it("satr bo'lmagan qiymatlarga tegmaydi", () => {
    setLanguage("cyrillic");
    expect(localizeExportText(135000)).toBe(135000);
    expect(localizeExportText(null)).toBe(null);
  });

  it("pdf hujjatida faqat matn kalitlarini o'giradi, rang/uslubga tegmaydi", () => {
    setLanguage("cyrillic");
    const result = localizePdfDocument({
      info: { title: "Akt sverka", author: "Tizim" },
      content: [
        { text: "Mijoz: Mega Market", color: "#64748B", style: "sectionTitle" },
        { table: { body: [[{ text: "Sana" }, { text: "Mahsulot" }]] } },
      ],
    });
    expect(result.info.title).toBe("Акт сверка");
    expect(result.content[0].text).toBe("Мижоз: Мега Маркет");
    // Rang va uslub nomlari o'girilmasligi kerak.
    expect(result.content[0].color).toBe("#64748B");
    expect(result.content[0].style).toBe("sectionTitle");
    expect(result.content[1].table.body[0][1].text).toBe("Маҳсулот");
  });

  it("lotin rejimida pdf hujjati o'zgarishsiz qoladi", () => {
    setLanguage("latin");
    const definition = { content: [{ text: "Mijoz: Mega Market" }] };
    expect(localizePdfDocument(definition).content[0].text).toBe("Mijoz: Mega Market");
  });
});
