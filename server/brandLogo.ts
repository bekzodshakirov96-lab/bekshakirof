import { inflateSync, crc32 } from "node:zlib";
import { MAX_BRAND_LOGO_BYTES } from "../shared/companyBranding";

/** Only bounded, static, decoded PNGs. The browser normalizes PNG/JPEG/WebP
 * into a <=256px PNG before upload; SVG, appended payloads and bombs are refused. */
export function decodeBrandLogo(base64: string): Buffer {
  const data = Buffer.from(base64, "base64");
  if (
    data.length > MAX_BRAND_LOGO_BYTES ||
    data.toString("base64") !== base64 ||
    data.length < 57 ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error("Logotip noto‘g‘ri PNG fayl.");
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false,
    chunks = 0;
  const compressed: Buffer[] = [];
  while (offset < data.length) {
    if (++chunks > 100 || offset + 12 > data.length)
      throw Error("Logotip tuzilishi noto‘g‘ri.");
    const length = data.readUInt32BE(offset),
      type = data.toString("ascii", offset + 4, offset + 8),
      end = offset + 12 + length;
    if (
      end > data.length ||
      !/^[A-Za-z]{4}$/.test(type) ||
      crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)
    )
      throw Error("Logotip fayli shikastlangan.");
    const content = data.subarray(offset + 8, end - 4);
    if (chunks === 1 && type !== "IHDR")
      throw Error("Logotip sarlavhasi noto‘g‘ri.");
    if (type === "IHDR") {
      if (chunks !== 1 || length !== 13)
        throw Error("Logotip sarlavhasi noto‘g‘ri.");
      width = content.readUInt32BE(0);
      height = content.readUInt32BE(4);
      channels =
        ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[content[9]] ?? 0;
      if (
        width < 1 ||
        height < 1 ||
        width > 256 ||
        height > 256 ||
        content[8] !== 8 ||
        !channels ||
        content[10] !== 0 ||
        content[11] !== 0 ||
        content[12] !== 0
      )
        throw Error("Logotip 256 × 256 pikseldan oshmasin.");
    } else if (type === "IDAT") compressed.push(content);
    else if (type === "IEND") {
      if (length !== 0 || end !== data.length)
        throw Error("Logotip oxiri noto‘g‘ri.");
      ended = true;
    } else if (
      type[0] === type[0].toUpperCase() ||
      ["acTL", "fcTL", "fdAT"].includes(type)
    )
      throw Error("Faqat oddiy PNG logotip ruxsat etilgan.");
    offset = end;
  }
  if (!ended || !compressed.length) throw Error("Logotip to‘liq emas.");
  const stride = width * channels + 1;
  const pixels = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: stride * height,
  });
  if (pixels.length !== stride * height)
    throw Error("Logotip piksellari noto‘g‘ri.");
  for (let row = 0; row < height; row++)
    if (pixels[row * stride] > 4) throw Error("Logotip filtri noto‘g‘ri.");
  return data;
}
