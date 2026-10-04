import { sql } from "drizzle-orm";
import { requireDb } from "./db";

/** Additive table; existing journal rows and balances are left untouched. */
export const CASH_TRANSFER_LINKS_DDL = `CREATE TABLE IF NOT EXISTS cash_transfer_links (
  id int AUTO_INCREMENT NOT NULL,
  cashEntryId int NOT NULL,
  transactionId int,
  clientPaymentId int,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cash_transfer_links_id PRIMARY KEY (id),
  CONSTRAINT cash_transfer_links_cashEntryId_cash_entries_id_fk FOREIGN KEY (cashEntryId) REFERENCES cash_entries(id) ON DELETE CASCADE,
  CONSTRAINT cash_transfer_links_transactionId_transactions_id_fk FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE RESTRICT,
  CONSTRAINT cash_transfer_links_clientPaymentId_client_payments_id_fk FOREIGN KEY (clientPaymentId) REFERENCES client_payments(id) ON DELETE RESTRICT,
  CONSTRAINT cash_transfer_links_transaction_unique UNIQUE (transactionId),
  CONSTRAINT cash_transfer_links_payment_unique UNIQUE (clientPaymentId),
  INDEX cash_transfer_links_cash_idx (cashEntryId)
)`;

export async function ensureCashTransferLinkTable() {
  if (!process.env.DATABASE_URL) return;
  const db = await requireDb();
  await db.execute(sql.raw(CASH_TRANSFER_LINKS_DDL));
}
