SET @add_cash_debt_borrower = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE cash_journal_debts ADD COLUMN borrowerName varchar(255)', 'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_journal_debts' AND COLUMN_NAME = 'borrowerName');
--> statement-breakpoint
PREPARE cash_debt_borrower_stmt FROM @add_cash_debt_borrower;
--> statement-breakpoint
EXECUTE cash_debt_borrower_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cash_debt_borrower_stmt;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cash_journal_debt_repayments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `debtId` int NOT NULL,
  `paymentDate` timestamp NOT NULL,
  `amount` int NOT NULL,
  `method` enum('cash','terminal','click','transfer') NOT NULL,
  `note` text,
  `cashEntryId` int NOT NULL,
  `cashEntryCreated` boolean NOT NULL DEFAULT false,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `voidedAt` timestamp,
  `voidedBy` int,
  `voidReason` varchar(500),
  CONSTRAINT `cash_journal_debt_repayments_id` PRIMARY KEY (`id`),
  CONSTRAINT `cash_debt_repayments_cash_entry_unique` UNIQUE (`cashEntryId`),
  CONSTRAINT `cash_journal_debt_repayments_debtId_cash_journal_debts_id_fk` FOREIGN KEY (`debtId`) REFERENCES `cash_journal_debts`(`id`) ON DELETE restrict,
  CONSTRAINT `cash_journal_debt_repayments_cashEntryId_cash_entries_id_fk` FOREIGN KEY (`cashEntryId`) REFERENCES `cash_entries`(`id`) ON DELETE restrict,
  CONSTRAINT `cash_journal_debt_repayments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_journal_debt_repayments_voidedBy_users_id_fk` FOREIGN KEY (`voidedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX `cash_debt_repayments_debt_idx` (`debtId`),
  INDEX `cash_debt_repayments_date_idx` (`paymentDate`)
);
