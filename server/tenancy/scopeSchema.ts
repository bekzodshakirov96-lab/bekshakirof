import { createHash } from "node:crypto";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";
import type { TenantSql } from "./database";

export const SCOPE_TABLE = "saas_tenant_scope";
const quote = (name: string) => `\`${name.replaceAll("`", "``")}\``;
export const businessTables = Object.values(schema)
  .filter(value => is(value, MySqlTable))
  .map(table => getTableConfig(table))
  .sort((a, b) => a.name.localeCompare(b.name));
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const references = (table: (typeof businessTables)[number]) => [
  ...table.foreignKeys.map(key => key.reference()),
  ...(table.name === "users"
    ? [
        {
          columns: [schema.users.agentId],
          foreignTable: schema.agents,
          foreignColumns: [schema.agents.id],
        },
      ]
    : []),
];
export function tenantTriggers(table: (typeof businessTables)[number]) {
  const foreignChecks = references(table)
    .map(ref => {
      const provided = ref.columns
        .map(col => `NEW.${quote(col.name)} IS NOT NULL`)
        .join(" AND ");
      const matches = ref.columns
        .map(
          (col, index) =>
            `p.${quote(ref.foreignColumns[index].name)} = NEW.${quote(col.name)}`
        )
        .join(" AND ");
      return `IF ${provided} AND NOT EXISTS (SELECT 1 FROM ${quote(getTableName(ref.foreignTable))} p WHERE ${matches} AND p.tenant_id = NEW.tenant_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cross-company reference refused'; END IF;`;
    })
    .join("\n");
  return ["INSERT", "UPDATE"].map(event => ({
    name: `bc_scope_${digest(table.name).slice(0, 16)}_${event.toLowerCase()}`,
    body: `BEGIN
      ${event === "UPDATE" ? "IF NOT (NEW.tenant_id <=> OLD.tenant_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Company ownership is immutable'; END IF;" : ""}
      IF NEW.tenant_id IS NULL OR NEW.tenant_id = '' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Company ID is required'; END IF;
      ${foreignChecks}
    END`,
    event,
  }));
}
export const scopeSchemaHash = digest(
  JSON.stringify(
    businessTables.map(table => ({
      name: table.name,
      indexes: table.indexes.map(index => ({
        name: index.config.name,
        unique: !!index.config.unique,
        columns: index.config.columns.map(col =>
          "name" in col ? col.name : "SQL"
        ),
      })),
      triggers: tenantTriggers(table),
    }))
  )
);
type IndexRow = {
  Key_name: string;
  Column_name: string;
  Seq_in_index: number;
  Non_unique: number;
};
async function indexGroups(db: TenantSql, table: string) {
  const [rows] = await db.query(`SHOW INDEX FROM ${quote(table)}`);
  const groups = new Map<string, { columns: string[]; unique: boolean }>();
  for (const row of rows as IndexRow[]) {
    const group = groups.get(row.Key_name) ?? {
      columns: [],
      unique: !row.Non_unique,
    };
    group.columns[row.Seq_in_index - 1] = row.Column_name;
    groups.set(row.Key_name, group);
  }
  return groups;
}

export async function assertTenantQueryScope(db: TenantSql, tenantId: string) {
  const [rows] = await db.query(
    `SELECT id,tenantId,schemaHash FROM ${SCOPE_TABLE}`
  );
  const records = rows as {
    id: number;
    tenantId: string;
    schemaHash: string;
  }[];
  if (
    records.length !== 1 ||
    records[0].id !== 1 ||
    records[0].tenantId !== tenantId ||
    records[0].schemaHash !== scopeSchemaHash
  )
    throw new Error(
      "Tenant query schema is not prepared for this runtime. Run the explicit scope migration."
    );
  const [triggers] = await db.query(
    "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()"
  );
  const names = new Set((triggers as { name: string }[]).map(row => row.name));
  if (
    businessTables.some(table =>
      tenantTriggers(table).some(trigger => !names.has(trigger.name))
    )
  )
    throw new Error("Tenant ownership triggers are missing. Startup refused.");
}

/** Explicit maintenance operation. Only tenant metadata/keys are changed; never financial values. */
export async function applyTenantQueryScope(db: TenantSql, tenantId: string) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(tenantId))
    throw new Error("Invalid company ID.");
  const [tables] = await db.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
  );
  const names = new Set(
    (tables as { name: string }[]).map(row => row.name.toLowerCase())
  );
  if (
    businessTables.some(table => !names.has(table.name.toLowerCase())) ||
    Array.from(names).some(name => name.startsWith("platform_"))
  )
    throw new Error(
      "Prepare the complete company schema first. Platform tables are forbidden here."
    );
  if (names.has("saas_tenant_identity")) {
    const [identity] = await db.query(
      "SELECT tenantId FROM saas_tenant_identity WHERE id=1"
    );
    if ((identity as { tenantId: string }[])[0]?.tenantId !== tenantId)
      throw new Error("Rebinding is forbidden.");
  }
  if (names.has(SCOPE_TABLE)) {
    await assertTenantQueryScope(db, tenantId);
    return;
  }
  // Preflight every existing scope before any DDL/backfill.
  for (const table of businessTables) {
    const [columns] = await db.query(
      "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND lower(TABLE_NAME)=lower(?) AND COLUMN_NAME='tenant_id'",
      [table.name]
    );
    if ((columns as unknown[]).length) {
      const [foreign] = await db.query(
        `SELECT 1 FROM ${quote(table.name)} WHERE tenant_id IS NULL OR tenant_id NOT IN ('legacy',?) LIMIT 1`,
        [tenantId]
      );
      if ((foreign as unknown[]).length)
        throw new Error(
          "Existing rows belong to another company. Migration refused."
        );
    }
  }
  for (const table of businessTables) {
    const [columnRows] = await db.query(
      "SELECT COLUMN_NAME AS name,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND lower(TABLE_NAME)=lower(?)",
      [table.name]
    );
    const columns = columnRows as { name: string; extra: string }[];
    if (!columns.some(col => col.name === "tenant_id")) {
      await db.query(
        `ALTER TABLE ${quote(table.name)} ADD COLUMN tenant_id varchar(63) NOT NULL DEFAULT '${tenantId}'`
      );
    } else {
      const preserveTimestamps = columns
        .filter(col => /on update/i.test(col.extra))
        .map(col => `${quote(col.name)}=${quote(col.name)}`);
      await db.query(
        `UPDATE ${quote(table.name)} SET tenant_id=?${preserveTimestamps.length ? "," + preserveTimestamps.join(",") : ""} WHERE tenant_id='legacy' AND tenant_id<>?`,
        [tenantId, tenantId]
      );
      await db.query(
        `ALTER TABLE ${quote(table.name)} ALTER COLUMN tenant_id SET DEFAULT '${tenantId}'`
      );
    }
  }
  for (const table of businessTables) {
    let actual = await indexGroups(db, table.name);
    const replacementNames = new Set(
      table.indexes.map(index => index.config.name)
    );
    // Keep the ID-first indexes required by existing MySQL foreign keys before
    // replacing old unique/date indexes with their tenant-prefixed counterparts.
    for (const ref of table.foreignKeys.map(key => key.reference())) {
      const columns = ref.columns.map(col => col.name);
      if (
        !Array.from(actual).some(
          ([name, index]) =>
            !replacementNames.has(name) &&
            columns.every((col, i) => index.columns[i] === col)
        )
      ) {
        const name = `scope_fk_${digest(table.name + columns.join(",")).slice(0, 16)}`;
        if (!actual.has(name))
          await db.query(
            `ALTER TABLE ${quote(table.name)} ADD INDEX ${quote(name)} (${columns.map(quote).join(",")})`
          );
        actual = await indexGroups(db, table.name);
      }
    }
    for (const index of table.indexes) {
      const wanted = index.config.columns.map(col => {
        if (!("name" in col)) throw new Error("Unsupported index expression.");
        return col.name;
      });
      const old = actual.get(index.config.name);
      if (
        old &&
        old.unique === !!index.config.unique &&
        JSON.stringify(old.columns) === JSON.stringify(wanted)
      )
        continue;
      await db.query(
        `ALTER TABLE ${quote(table.name)} ${old ? `DROP INDEX ${quote(index.config.name)}, ` : ""}ADD ${index.config.unique ? "UNIQUE " : ""}INDEX ${quote(index.config.name)} (${wanted.map(quote).join(",")})`
      );
    }
    if (
      table.name === "app_settings" &&
      JSON.stringify(actual.get("PRIMARY")?.columns) !==
        JSON.stringify(["tenant_id", "key"])
    ) {
      await db.query(
        "ALTER TABLE app_settings DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id,`key`)"
      );
    }
  }
  // Refuse pre-existing cross-company references before installing write guards.
  for (const table of businessTables) {
    for (const ref of references(table)) {
      const provided = ref.columns
        .map(col => `c.${quote(col.name)} IS NOT NULL`)
        .join(" AND ");
      const matches = ref.columns
        .map(
          (col, index) =>
            `p.${quote(ref.foreignColumns[index].name)}=c.${quote(col.name)}`
        )
        .join(" AND ");
      const [bad] = await db.query(
        `SELECT 1 FROM ${quote(table.name)} c WHERE ${provided} AND NOT EXISTS (SELECT 1 FROM ${quote(getTableName(ref.foreignTable))} p WHERE ${matches} AND p.tenant_id=c.tenant_id) LIMIT 1`
      );
      if ((bad as unknown[]).length)
        throw new Error(
          "An existing reference is invalid. Repair it explicitly; migration does not change history."
        );
    }
    const [existing] = await db.query(
      "SELECT TRIGGER_NAME AS name,ACTION_STATEMENT AS body FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND lower(EVENT_OBJECT_TABLE)=lower(?)",
      [table.name]
    );
    for (const trigger of tenantTriggers(table)) {
      const old = (existing as { name: string; body: string }[]).find(
        row => row.name === trigger.name
      );
      if (!old)
        await db.query(
          `CREATE TRIGGER ${quote(trigger.name)} BEFORE ${trigger.event} ON ${quote(table.name)} FOR EACH ROW ${trigger.body}`
        );
      else if (
        old.body.replace(/\s+/g, " ").trim() !==
        trigger.body.replace(/\s+/g, " ").trim()
      )
        throw new Error(
          "Existing tenant guard differs from the reviewed migration."
        );
    }
  }
  await db.query(
    `CREATE TABLE ${SCOPE_TABLE} (id tinyint PRIMARY KEY,tenantId varchar(63) NOT NULL,schemaHash char(64) NOT NULL,preparedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT INTO ${SCOPE_TABLE} (id,tenantId,schemaHash) VALUES (1,?,?)`,
    [tenantId, scopeSchemaHash]
  );
  await assertTenantQueryScope(db, tenantId);
}
