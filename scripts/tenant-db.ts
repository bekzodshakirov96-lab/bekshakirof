import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { snapshotBusinessData, type DatabaseSnapshot } from "../server/tenancy/audit";
import { bindTenantDatabase } from "../server/tenancy/bind";
import { applyTenantQueryScope } from "../server/tenancy/scopeSchema";
import { assertSameBusinessData } from "../server/tenancy/audit";
import { migrateCashDebtRecordOnly } from "../server/cashDebtRecordOnlySchema";
import { accountingHistoryHash, accountingHistoryProjection, applyAccountingAuditSchema, assertAccountingScopeUpgradeable, ACCOUNTING_PREVIOUS_SCOPE_HASH } from "../server/accountingAuditSchema";

const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
async function main() {
  const action = args[0];
  if (!["audit", "bind", "scope", "audit-fixes", "debt-record-only"].includes(action)) {
    throw new Error("Usage: tenant:db audit --out snapshot.json | tenant:db bind|scope|audit-fixes|debt-record-only --tenant-id legacy --baseline snapshot.json --apply");
  }
  const output = option("--out");
  const baselinePath = option("--baseline");
  const tenantId = option("--tenant-id");
  if (action === "audit" && !output) throw new Error("audit requires --out.");
  if (action !== "audit" && (!args.includes("--apply") || !baselinePath || !tenantId)) {
    throw new Error("Migration requires --apply, --tenant-id and --baseline. Take and test a backup, stop writes, then prepare a fresh audit baseline.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const db = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "+05:00", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  try {
    await db.query("SET time_zone = '+05:00'");
    if (action === "audit") {
      const snapshot = await snapshotBusinessData(db);
      await writeFile(output!, JSON.stringify(snapshot, null, 2), { flag: "wx" });
      console.log(`Audit saved: ${snapshot.tables.length} tables, fingerprint ${snapshot.fingerprint}. No business data changed.`);
    } else if (action === "debt-record-only") {
      const baseline = JSON.parse(await readFile(baselinePath!, "utf8")) as DatabaseSnapshot;
      assertSameBusinessData(baseline, await snapshotBusinessData(db));
      await migrateCashDebtRecordOnly(db, tenantId!);
      console.log("Record-only repayments prepared. All original cash and debt history is unchanged.");
    } else if (action === "audit-fixes") {
      const baseline = JSON.parse(await readFile(baselinePath!, "utf8")) as DatabaseSnapshot;
      assertSameBusinessData(baseline, await snapshotBusinessData(db));
      await assertAccountingScopeUpgradeable(db, tenantId!);
      const projection = await accountingHistoryProjection(db);
      const before = await accountingHistoryHash(db, projection);
      await applyAccountingAuditSchema(db);
      await applyTenantQueryScope(db, tenantId!, ACCOUNTING_PREVIOUS_SCOPE_HASH);
      if (before !== await accountingHistoryHash(db, projection)) throw new Error("Original history changed; keep runtime stopped.");
      console.log("Accounting safeguards prepared. Every original field and history row is unchanged.");
    } else if (action === "scope") {
      const baseline = JSON.parse(await readFile(baselinePath!, "utf8")) as DatabaseSnapshot;
      assertSameBusinessData(baseline, await snapshotBusinessData(db));
      await applyTenantQueryScope(db, tenantId!);
      assertSameBusinessData(baseline, await snapshotBusinessData(db));
      console.log("Tenant query scope prepared. Every original business field matches the baseline.");
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
