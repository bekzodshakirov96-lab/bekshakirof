import { deflateSync, crc32 } from "node:zlib";
import { describe, it, expect } from "vitest";
import { decodeBrandLogo } from "./brandLogo";
function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
  return out;
}
function png(width = 2, height = 2, pixels?: Buffer) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk(
      "IDAT",
      deflateSync(pixels ?? Buffer.alloc(height * (width * 4 + 1)))
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
describe("bounded raster logo validation", () => {
  it("accepts a valid static PNG, including transparency", () => {
    const image = png();
    expect(decodeBrandLogo(image.toString("base64"))).toEqual(image);
  });
  it("rejects SVG/HTML, corrupt PNGs, trailing payloads and oversized/decompression payloads", () => {
    const badCrc = png();
    badCrc[badCrc.length - 1] ^= 1;
    for (const image of [
      Buffer.from('<svg onload="alert(1)"/>'),
      Buffer.from("<html/>"),
      png().subarray(0, 30),
      badCrc,
      Buffer.concat([png(), Buffer.from("<script>")]),
      png(257, 1),
      png(2, 2, Buffer.alloc(10000)),
    ])
      expect(() => decodeBrandLogo(image.toString("base64"))).toThrow();
    expect(() => decodeBrandLogo(png().toString("base64") + "=")).toThrow();
  });
});
