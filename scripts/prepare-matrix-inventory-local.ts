/** LOCAL PREVIEW ONLY. Never used by server startup or a production deploy. */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { snapshotBusinessData } from "../server/tenancy/audit";
import {
  assertTenantQueryScope,
  businessTables,
  scopeSchemaHash,
  tenantTriggers,
} from "../server/tenancy/scopeSchema";

const tenantId = process.env.TENANT_ID;
const inventoryTables = [
  "matrix_cell_writes",
  "matrix_stock_configs",
  "matrix_stock_events",
];
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV === "production" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "43317" ||
  !(
    (/^\/bc_demo_[a-z0-9]+$/.test(url.pathname) &&
      tenantId === "namuna-savdo") ||
    (/^\/bc_matrix_ui_[a-z0-9]+$/.test(url.pathname) &&
      tenantId === "matrix-preview")
  )
)
  throw new Error(
    "Only the isolated Namuna or matrix TEST localhost database is permitted."
  );
const db = await mysql.createConnection({
  uri: url.toString(),
  dateStrings: true,
});
try {
  const [identity] = await db.query(
    "SELECT tenantId FROM saas_tenant_identity WHERE id=1"
  );
  const [scope] = await db.query(
    "SELECT tenantId,schemaHash FROM saas_tenant_scope WHERE id=1"
  );
  if (
    (identity as { tenantId: string }[])[0]?.tenantId !== tenantId ||
    (scope as { tenantId: string }[])[0]?.tenantId !== tenantId
  )
    throw new Error("Demo ownership mismatch");
  const before = await snapshotBusinessData(db);
  const exported = execFileSync(
    process.execPath,
    [
      "node_modules/drizzle-kit/bin.cjs",
      "export",
      "--dialect",
      "mysql",
      "--schema",
      "./drizzle/schema.ts",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  const statements = exported
    .slice(exported.indexOf("CREATE TABLE"))
    .split(";")
    .map(value => value.trim())
    .filter(Boolean);
  for (const table of inventoryTables) {
    const [exists] = await db.query(
      "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
      [table]
    );
    if ((exists as unknown[]).length) continue;
    for (const statement of statements) {
      if (
        statement.startsWith(`CREATE TABLE \`${table}\``) ||
        statement.startsWith(`ALTER TABLE \`${table}\``) ||
        (statement.startsWith("CREATE INDEX") &&
          statement.includes(` ON \`${table}\``))
      )
        await db.query(statement);
    }
  }
  for (const table of businessTables.filter(table =>
    inventoryTables.includes(table.name)
  )) {
    await db.query(
      `ALTER TABLE \`${table.name}\` ALTER COLUMN tenant_id SET DEFAULT '${tenantId}'`
    );
    for (const trigger of tenantTriggers(table)) {
      const [existing] = await db.query(
        "SELECT ACTION_STATEMENT AS body FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
        [trigger.name]
      );
      const prior = (existing as { body: string }[])[0];
      if (!prior)
        await db.query(
          `CREATE TRIGGER \`${trigger.name}\` BEFORE ${trigger.event} ON \`${table.name}\` FOR EACH ROW ${trigger.body}`
        );
      else if (
        prior.body.replace(/\s+/g, " ").trim() !==
        trigger.body.replace(/\s+/g, " ").trim()
      )
        throw new Error("Unexpected demo tenant trigger");
    }
  }
  await db.query(
    "UPDATE saas_tenant_scope SET schemaHash=? WHERE id=1 AND tenantId=?",
    [scopeSchemaHash, tenantId]
  );
  await assertTenantQueryScope(db, tenantId!);
  const after = await snapshotBusinessData(db);
  for (const previous of before.tables) {
    const current = after.tables.find(table => table.name === previous.name);
    if (JSON.stringify(current) !== JSON.stringify(previous))
      throw new Error(`Existing business data changed in ${previous.name}`);
  }
  await writeFile(
    `temp/matrix-inventory-${tenantId}-baseline.json`,
    JSON.stringify({ before, after }, null, 2)
  );
  console.log(
    `Prepared local inventory tables. ${before.tables.length} existing business tables unchanged. No opening stock or receipts were invented.`
  );
} finally {
  await db.end();
}
