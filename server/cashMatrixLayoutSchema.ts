import { sql } from "drizzle-orm";
import { requireDb } from "./db";

/** Additive, restart-safe counterpart of drizzle/0017_curly_lily_hollister.sql. */
export const CASH_MATRIX_LAYOUTS_DDL = `CREATE TABLE IF NOT EXISTS \`cash_matrix_layouts\` (
  \`id\` int AUTO_INCREMENT NOT NULL,
  \`effectiveDate\` timestamp NOT NULL,
  \`layout\` text NOT NULL,
  \`updatedBy\` int,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  \`updatedAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`cash_matrix_layouts_id\` PRIMARY KEY(\`id\`),
  CONSTRAINT \`cash_matrix_layouts_date_unique\` UNIQUE(\`effectiveDate\`),
  CONSTRAINT \`cash_matrix_layouts_updatedBy_users_id_fk\` FOREIGN KEY (\`updatedBy\`) REFERENCES \`users\`(\`id\`) ON DELETE set null ON UPDATE no action
)`;

export async function ensureCashMatrixLayoutTable() {
  if (!process.env.DATABASE_URL) return;
  const db = await requireDb();
  await db.execute(sql.raw(CASH_MATRIX_LAYOUTS_DDL));
}
