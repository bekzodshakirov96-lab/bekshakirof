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
const version = JSON.parse(fs.readFileSync(path.join(root, "app-version.json"), "utf8"));
assert(version.schema === 1 && /^[a-zA-Z0-9._-]{8,128}$/.test(version.buildId), "Valid client build version is required");
let embeddedVersion = false;
for (const script of scripts) {
  assert(script.startsWith("/assets/") && !script.includes(".."), "Expected a local hashed build asset");
  assert(!/pdfmake|vfs_fonts|xlsx/.test(script), "Report libraries must load only when requested");
  initialBytes += fs.statSync(path.join(root, script)).size;
  embeddedVersion ||= fs.readFileSync(path.join(root, script), "utf8").includes(version.buildId);
}
assert(embeddedVersion, "Version manifest must match the loaded client, not a server-only baseline");
assert(initialBytes < 900_000, "Initial JavaScript exceeds 900 KB; check route splitting");
console.log(`Client build guard passed: HTML ${Buffer.byteLength(html)} B; entry scripts ${initialBytes} B.`);
