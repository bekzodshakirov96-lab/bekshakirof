CREATE TABLE IF NOT EXISTS `cash_transfer_links` (
  `id` int AUTO_INCREMENT NOT NULL,
  `cashEntryId` int NOT NULL,
  `transactionId` int,
  `clientPaymentId` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `cash_transfer_links_id` PRIMARY KEY (`id`),
  CONSTRAINT `cash_transfer_links_transaction_unique` UNIQUE (`transactionId`),
  CONSTRAINT `cash_transfer_links_payment_unique` UNIQUE (`clientPaymentId`),
  CONSTRAINT `cash_transfer_links_cashEntryId_cash_entries_id_fk` FOREIGN KEY (`cashEntryId`) REFERENCES `cash_entries`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `cash_transfer_links_transactionId_transactions_id_fk` FOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON DELETE restrict ON UPDATE no action,
  CONSTRAINT `cash_transfer_links_clientPaymentId_client_payments_id_fk` FOREIGN KEY (`clientPaymentId`) REFERENCES `client_payments`(`id`) ON DELETE restrict ON UPDATE no action,
  INDEX `cash_transfer_links_cash_idx` (`cashEntryId`)
);
