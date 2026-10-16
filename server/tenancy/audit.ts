import { createHash } from "node:crypto";
import { TENANT_IDENTITY_TABLE, type TenantSql } from "./database";

export type DatabaseSnapshot = {
  version: 1;
  fingerprint: string;
  tables: { name: string; rows: number; sha256: string }[];
};
const quote = (identifier: string) => `\`${identifier.replaceAll("`", "``")}\``;

/** Reads every business row; manifests contain hashes/counts, never the row contents. */
export async function snapshotBusinessData(db: TenantSql): Promise<DatabaseSnapshot> {
  await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
  try {
    const [tableRows] = await db.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    const tables: DatabaseSnapshot["tables"] = [];
    for (const { name } of tableRows as { name: string }[]) {
      if (name === TENANT_IDENTITY_TABLE) continue;
      const [keys] = await db.query(`SHOW KEYS FROM ${quote(name)} WHERE Key_name = 'PRIMARY'`);
      const columns = (keys as { Column_name: string; Seq_in_index: number }[])
        .sort((a, b) => a.Seq_in_index - b.Seq_in_index).map(key => quote(key.Column_name));
      if (!columns.length) throw new Error(`Cannot verify table without primary key: ${name}`);
      const hash = createHash("sha256");
      let rows = 0;
      for (;;) {
        const [batch] = await db.query(`SELECT * FROM ${quote(name)} ORDER BY ${columns.join(", ")} LIMIT 1000 OFFSET ${rows}`);
        const records = batch as Record<string, unknown>[];
        for (const record of records) hash.update(JSON.stringify(record) + "\n");
        rows += records.length;
        if (records.length < 1000) break;
      }
      tables.push({ name, rows, sha256: hash.digest("hex") });
    }
    return { version: 1, tables, fingerprint: createHash("sha256").update(JSON.stringify(tables)).digest("hex") };
  } finally {
    await db.query("ROLLBACK");
  }
}

export function assertSameBusinessData(expected: DatabaseSnapshot, actual: DatabaseSnapshot) {
  if (expected.version !== 1 || expected.fingerprint !== actual.fingerprint || JSON.stringify(expected.tables) !== JSON.stringify(actual.tables)) {
    throw new Error("Business data changed since the baseline. Binding must stop; compare snapshots in maintenance mode.");
  }
}
