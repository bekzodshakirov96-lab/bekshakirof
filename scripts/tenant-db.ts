import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { snapshotBusinessData, type DatabaseSnapshot } from "../server/tenancy/audit";
import { bindTenantDatabase } from "../server/tenancy/bind";

const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
async function main() {
  const action = args[0];
  if (action !== "audit" && action !== "bind") {
    throw new Error("Usage: tenant:db audit --out snapshot.json | tenant:db bind --tenant-id legacy --baseline snapshot.json --apply");
  }
  const output = option("--out");
  const baselinePath = option("--baseline");
  const tenantId = option("--tenant-id");
  if (action === "audit" && !output) throw new Error("audit requires --out.");
  if (action === "bind" && (!args.includes("--apply") || !baselinePath || !tenantId)) {
    throw new Error("bind requires --apply, --tenant-id and --baseline. Take and test a backup, stop writes, then prepare a fresh audit baseline.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const db = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "+05:00", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  try {
    await db.query("SET time_zone = '+05:00'");
    if (action === "audit") {
      const snapshot = await snapshotBusinessData(db);
      await writeFile(output!, JSON.stringify(snapshot, null, 2), { flag: "wx" });
      console.log(`Audit saved: ${snapshot.tables.length} tables, fingerprint ${snapshot.fingerprint}. No business data changed.`);
    } else {
      const baseline = JSON.parse(await readFile(baselinePath!, "utf8")) as DatabaseSnapshot;
      const snapshot = await bindTenantDatabase(db, tenantId!, baseline);
      console.log(`Company database bound to ${tenantId}. All business data matches baseline ${snapshot.fingerprint}.`);
    }
  } finally {
    await db.end();
  }
}
main().catch(() => {
  // Connection errors may contain connection details; never print secrets.
  console.error("Tenant database command failed. Check configuration, ownership, schema and baseline; do not enable the deployment until verification succeeds.");
  process.exitCode = 1;
});
