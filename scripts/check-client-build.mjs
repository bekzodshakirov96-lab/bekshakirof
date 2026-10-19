import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert(Buffer.byteLength(html) < 16_384, "HTML exceeds 16 KiB; check for injected developer tooling");
assert(!/manus-runtime|debug-collector/.test(html), "Developer runtime must not ship in the client build");

const scripts = [...html.matchAll(/(?:src|href)="([^"?#]+\.js)"/g)].map(match => match[1]);
assert(scripts.length > 0, "Client entry script is missing");
let initialBytes = 0;
for (const script of scripts) {
  assert(script.startsWith("/assets/") && !script.includes(".."), "Expected a local hashed build asset");
  assert(!/pdfmake|vfs_fonts|xlsx/.test(script), "Report libraries must load only when requested");
  initialBytes += fs.statSync(path.join(root, script)).size;
}
assert(initialBytes < 900_000, "Initial JavaScript exceeds 900 KB; check route splitting");
console.log(`Client build guard passed: HTML ${Buffer.byteLength(html)} B; entry scripts ${initialBytes} B.`);
