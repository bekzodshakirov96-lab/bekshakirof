import { sql } from "drizzle-orm";
import { requireDb } from "./db";

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS cash_journal_debt_repayments (
  id int AUTO_INCREMENT NOT NULL,
  debtId int NOT NULL,
  paymentDate timestamp NOT NULL,
  amount int NOT NULL,
  method enum('cash','terminal','click','transfer') NOT NULL,
  note text,
  cashEntryId int NOT NULL,
  cashEntryCreated boolean NOT NULL DEFAULT false,
  createdBy int,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voidedAt timestamp,
  voidedBy int,
  voidReason varchar(500),
  CONSTRAINT cash_journal_debt_repayments_id PRIMARY KEY (id),
  CONSTRAINT cash_debt_repayments_cash_entry_unique UNIQUE (cashEntryId),
  CONSTRAINT cash_journal_debt_repayments_debtId_cash_journal_debts_id_fk FOREIGN KEY (debtId) REFERENCES cash_journal_debts(id) ON DELETE restrict,
  CONSTRAINT cash_journal_debt_repayments_cashEntryId_cash_entries_id_fk FOREIGN KEY (cashEntryId) REFERENCES cash_entries(id) ON DELETE restrict,
  CONSTRAINT cash_journal_debt_repayments_createdBy_users_id_fk FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT cash_journal_debt_repayments_voidedBy_users_id_fk FOREIGN KEY (voidedBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX cash_debt_repayments_debt_idx (debtId),
  INDEX cash_debt_repayments_date_idx (paymentDate)
)`;

/** Restart-safe schema bootstrap used by the deployed server. */
export async function ensureCashDebtRepaymentSchema() {
  if (!process.env.DATABASE_URL) return;
  const db = await requireDb();
  const [rows] = await db.execute(sql`SELECT COUNT(*) AS count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_journal_debts' AND COLUMN_NAME = 'borrowerName'`);
  const count = Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
  if (!count) {
    try {
      await db.execute(sql.raw("ALTER TABLE cash_journal_debts ADD COLUMN borrowerName varchar(255)"));
    } catch (error) {
      // Parallel startupda boshqa nusxa ustunni yaratgan bo'lishi mumkin.
      const mysqlError = error as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
      if (mysqlError.code !== "ER_DUP_FIELDNAME" && mysqlError.errno !== 1060
        && mysqlError.cause?.code !== "ER_DUP_FIELDNAME" && mysqlError.cause?.errno !== 1060) throw error;
    }
  }
  await db.execute(sql.raw(CREATE_TABLE));
}
