import { describe, expect, it } from "vitest";
import { toCyrillic } from "./translit";

describe("toCyrillic", () => {
  it("o'giradi oddiy so'zlarni", () => {
    expect(toCyrillic("savdo")).toBe("савдо");
    expect(toCyrillic("mahsulot")).toBe("маҳсулот");
    expect(toCyrillic("qarzdorlik")).toBe("қарздорлик");
  });

  it("apostrofli harflarni to'g'ri o'giradi (o' → ў, g' → ғ)", () => {
    expect(toCyrillic("so'm")).toBe("сўм");
    expect(toCyrillic("to'lov")).toBe("тўлов");
    expect(toCyrillic("yog'")).toBe("ёғ");
    // "yo'q" → йўқ, "ёқ" emas: o' avval ishlanadi.
    expect(toCyrillic("yo'q")).toBe("йўқ");
    expect(toCyrillic("yo'l")).toBe("йўл");
  });

  it("ikki harfli birikmalarni o'giradi", () => {
    expect(toCyrillic("ishchi")).toBe("ишчи");
    expect(toCyrillic("yangi")).toBe("янги");
    expect(toCyrillic("yuborish")).toBe("юбориш");
  });

  it("so'z boshidagi e ni э qiladi, ichkarida е qoldiradi", () => {
    expect(toCyrillic("eslatma")).toBe("эслатма");
    expect(toCyrillic("kerak")).toBe("керак");
  });

  it("tutuq belgisini ъ qiladi", () => {
    expect(toCyrillic("ma'lumot")).toBe("маълумот");
  });

  it("katta harflarni saqlaydi", () => {
    expect(toCyrillic("Savdo")).toBe("Савдо");
    expect(toCyrillic("Sklad")).toBe("Склад");
    expect(toCyrillic("SAVDO")).toBe("САВДО");
  });

  it("raqamli kodlar, email va havolalarga tegmaydi", () => {
    expect(toCyrillic("C003")).toBe("C003");
    expect(toCyrillic("Barlos 1.2L")).toBe("Барлос 1.2L");
    expect(toCyrillic("27.07.2026")).toBe("27.07.2026");
    expect(toCyrillic("ceo@nokdaun.uz")).toBe("ceo@nokdaun.uz");
    expect(toCyrillic("https://nokdaun.uz")).toBe("https://nokdaun.uz");
  });

  it("brendlar va qisqartmalarni lotinda qoldiradi", () => {
    expect(toCyrillic("Excel import")).toBe("Excel импорт");
    expect(toCyrillic("PDF yuklab olish")).toBe("PDF юклаб олиш");
    expect(toCyrillic("Nokdaun CEO")).toBe("Нокдаун CEO");
    // Qo'shimcha bilan kelgan brend ham o'girilmaydi.
    expect(toCyrillic("Excel'ga yuklash")).toBe("Excel'ga юклаш");
  });

  it("kirill matnni o'zgartirmaydi", () => {
    expect(toCyrillic("Приход кег")).toBe("Приход кег");
    expect(toCyrillic("Наличные")).toBe("Наличные");
  });

  it("idempotent — qayta o'girish matnni o'zgartirmaydi", () => {
    const once = toCyrillic("Yangi savdo qo'shish");
    expect(toCyrillic(once)).toBe(once);
  });

  it("aralash matnni to'g'ri ishlaydi", () => {
    expect(toCyrillic("Jami: 135,000 so'm")).toBe("Жами: 135,000 сўм");
  });
});
