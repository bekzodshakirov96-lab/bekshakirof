import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, ".vite/manifest.json"), "utf8"));
assert(Buffer.byteLength(html) < 16_384, "HTML must remain small");
assert(!/manus-runtime|debug-collector/.test(html), "Developer tooling must not ship");

function closure(key, seen = new Set()) {
  assert(manifest[key], `Missing build module: ${key}`);
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const imported of manifest[key].imports ?? []) closure(imported, seen);
  return seen;
}
function measure(keys) {
  const files = [...new Set([...keys].map(key => manifest[key].file))];
  let bytes = 0, gzipBytes = 0;
  for (const file of files) {
    assert(file.startsWith("assets/") && !file.includes(".."));
    const content = fs.readFileSync(path.join(root, file));
    bytes += content.byteLength;
    gzipBytes += gzipSync(content).byteLength;
  }
  return { files, bytes, gzipBytes };
}
const entry = Object.keys(manifest).find(key => manifest[key].isEntry);
assert(entry, "Client entry is required");
const initial = closure(entry);
const entrySize = measure(initial);
assert(entrySize.bytes < 600_000, "Initial JavaScript exceeds 600 KB");

// Check transitive static imports as well as the entry file. Merely renaming
// a large eager bundle into a vendor chunk must not satisfy this guard.
for (const key of initial) {
  assert(!key.startsWith("src/pages/"), `Page eagerly loaded: ${key}`);
  assert(!/pdfmake|vfs_fonts|xlsx/i.test(manifest[key].file), "Export libraries must load on demand");
}
const pages = ["Agents", "AktSverka", "AuditLog", "Cash", "Clients", "Containers",
  "Dashboard", "Debts", "Employees", "Factory", "ImportExcel", "FastKeg",
  "Products", "KassaReports", "SalesReport", "Stock", "StockReport",
  "Transactions", "Users", "CompanySettings", "NotFound", "Platform"];
for (const page of pages) {
  const key = `src/pages/${page}.tsx`;
  assert(manifest[key]?.isDynamicEntry, `${page} must remain accessible as a lazy route`);
}
const platform = closure("src/pages/Platform.tsx", new Set(initial));
assert(!platform.has("src/components/DashboardLayout.tsx"), "Platform must not load company shell");
for (const page of pages.filter(page => page !== "Platform")) {
  assert(!platform.has(`src/pages/${page}.tsx`), `Company page loaded by platform: ${page}`);
}
const platformSize = measure(platform);
assert(platformSize.bytes < 800_000, "Platform route and shared imports exceed 800 KB");
console.log(JSON.stringify({
  entry: entrySize,
  platform: platformSize,
  lazyPages: pages.length,
  baselineEntryBytes: 1_584_730,
  entryReductionPercent: Number((100 * (1 - entrySize.bytes / 1_584_730)).toFixed(1)),
}, null, 2));
