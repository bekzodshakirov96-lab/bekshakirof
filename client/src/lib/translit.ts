/**
 * O'zbek lotin → kirill transliteratsiyasi.
 *
 * Lotin va kirill — bir xil tilning ikki alifbosi, shuning uchun har bir matnni
 * qo'lda ikki marta yozish o'rniga avtomatik o'giramiz. Bu barcha sahifalarni,
 * shu jumladan bazadan kelgan ma'lumotlarni ham qamrab oladi.
 *
 * Funksiya **idempotent**: natijada lotin harflari qolmaydi, shuning uchun
 * allaqachon o'girilgan matnni qayta o'girish uni o'zgartirmaydi. DOM kuzatuvchisi
 * cheksiz siklga tushmasligi uchun shu xossa muhim.
 */

/** Tutuq belgisi sifatida ishlatiladigan barcha apostrof ko'rinishlari. */
const APOSTROPHES = "'‘’ʻʼ`´";

/** Lotin unlilari — "e" boshida э bo'lishini aniqlash uchun. */
const VOWELS = "aeiouAEIOU";

/**
 * Lotin yozuvida qoladigan brendlar va qisqartmalar — bularni o'girish
 * ("Excel" → "Эхсел", "CEO" → "СЕО") noto'g'ri natija beradi.
 */
const KEEP_LATIN = new Set([
  "excel", "pdf", "ceo", "crm", "sms", "id", "it", "kpi", "url", "qr",
  "click", "payme", "uzum", "telegram", "email", "web", "online", "office",
]);

/**
 * O'girish shart bo'lmagan bo'laklar: raqamli kodlar (C003, 1.2L, 27.07.2026),
 * email manzillar, havolalar va brend nomlari. Bularni o'girish ma'lumotni buzadi.
 */
function isSkippableToken(token: string): boolean {
  if (!token) return true;
  if (/\d/.test(token)) return true;
  if (token.includes("@")) return true;
  if (/^(https?:|www\.)/i.test(token)) return true;
  if (/\.(uz|com|ru|org|net)\b/i.test(token)) return true;
  // Brend nomi — qo'shimchasi bilan kelsa ham ("Excel'ga") lotinda qoladi.
  const stem = /^[a-zA-Z]+/.exec(token)?.[0].toLowerCase();
  if (stem && KEEP_LATIN.has(stem)) return true;
  return false;
}

/** Bitta so'zni o'giradi (bo'sh joysiz bo'lak). */
function translitWord(word: string): string {
  let result = "";
  let index = 0;

  while (index < word.length) {
    const rest = word.slice(index);
    const char = word[index];
    const lower = char.toLowerCase();
    const isUpper = char !== lower && char === char.toUpperCase();
    /** Keyingi harf ham katta bo'lsa (yoki so'z tugagan bo'lsa) — TO'LIQ KATTA yozuv. */
    const nextChar = word[index + 1] ?? "";
    const nextIsUpper = nextChar !== "" && nextChar === nextChar.toUpperCase() && /[a-z]/i.test(nextChar);

    /** Katta/kichik holatni saqlagan holda qo'shish. */
    const push = (cyrillic: string, consumed: number) => {
      if (!isUpper) result += cyrillic;
      else if (nextIsUpper || cyrillic.length === 1) result += cyrillic.toUpperCase();
      else result += cyrillic[0].toUpperCase() + cyrillic.slice(1);
      index += consumed;
    };

    // 1. Apostrofli juftliklar — eng avval, chunki "yo'l" → йўл (ёл emas).
    const twoLower = rest.slice(0, 2).toLowerCase();
    const apostropheNext = rest[1] !== undefined && APOSTROPHES.includes(rest[1]);
    if (lower === "o" && apostropheNext) { push("ў", 2); continue; }
    if (lower === "g" && apostropheNext) { push("ғ", 2); continue; }

    // 2. Ikki harfli birikmalar.
    if (twoLower === "sh") { push("ш", 2); continue; }
    if (twoLower === "ch") { push("ч", 2); continue; }
    if (twoLower === "ts") { push("ц", 2); continue; }
    if (twoLower === "ya") { push("я", 2); continue; }
    // "yo" — faqat keyin apostrof bo'lmasa ("yo'l" = y + o' = йўл, ёл emas).
    if (twoLower === "yo" && !(rest[2] !== undefined && APOSTROPHES.includes(rest[2]))) { push("ё", 2); continue; }
    if (twoLower === "yu") { push("ю", 2); continue; }
    if (twoLower === "ye") { push("е", 2); continue; }

    // 3. "e": so'z boshida yoki unlidan keyin — э, aks holda е.
    if (lower === "e") {
      const previous = index === 0 ? "" : word[index - 1];
      const afterVowel = previous !== "" && VOWELS.includes(previous);
      push(index === 0 || afterVowel ? "э" : "е", 1);
      continue;
    }

    // 4. Tutuq belgisi (unlidan keyin kelgan apostrof): ma'no → маъно.
    if (APOSTROPHES.includes(char)) {
      const previous = index === 0 ? "" : word[index - 1];
      if (previous !== "" && /[a-zA-Zа-яА-ЯёЁ]/.test(previous)) { result += "ъ"; index += 1; continue; }
      result += char;
      index += 1;
      continue;
    }

    // 5. Bitta harflar.
    const single: Record<string, string> = {
      a: "а", b: "б", c: "с", d: "д", f: "ф", g: "г", h: "ҳ", i: "и",
      j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "қ",
      r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "й", z: "з",
    };
    const mapped = single[lower];
    if (mapped) { push(mapped, 1); continue; }

    // 6. Qolgani (kirill, raqam, tinish belgisi) o'zgarishsiz.
    result += char;
    index += 1;
  }

  return result;
}

/**
 * Matnni lotindan kirillga o'giradi. Bo'sh joy va tinish belgilari saqlanadi;
 * raqamli kodlar, email va havolalar tegilmaydi.
 */
export function toCyrillic(text: string): string {
  if (!text || !/[a-zA-Z]/.test(text)) return text;
  return text.replace(/\S+/g, token => (isSkippableToken(token) ? token : translitWord(token)));
}
