CREATE TABLE `agent_cash_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entryDate` integer NOT NULL,
	`agentId` integer NOT NULL,
	`submittedAmount` integer DEFAULT 0 NOT NULL,
	`note` text,
	`updatedBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_cash_submissions_date_agent_unique` ON `agent_cash_submissions` (`entryDate`,`agentId`);--> statement-breakpoint
CREATE TABLE `agent_taking_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entryDate` integer NOT NULL,
	`agentId` integer NOT NULL,
	`productId` integer,
	`productName` text NOT NULL,
	`unitPrice` integer DEFAULT 0 NOT NULL,
	`quantity` text DEFAULT '0' NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`createdBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_taking_entries_date_agent_idx` ON `agent_taking_entries` (`entryDate`,`agentId`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`note` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_unique` ON `agents` (`name`);--> statement-breakpoint
CREATE TABLE `cash_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sourceKey` text NOT NULL,
	`entryDate` integer NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`agentId` integer,
	`description` text,
	`cashAmount` integer DEFAULT 0 NOT NULL,
	`terminalAmount` integer DEFAULT 0 NOT NULL,
	`clickAmount` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`createdBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_entries_source_key_unique` ON `cash_entries` (`sourceKey`);--> statement-breakpoint
CREATE INDEX `cash_entries_date_idx` ON `cash_entries` (`entryDate`);--> statement-breakpoint
CREATE INDEX `cash_entries_agent_idx` ON `cash_entries` (`agentId`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`agentId` integer,
	`phone` text,
	`address` text,
	`openingDebt` integer DEFAULT 0 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_code_unique` ON `clients` (`code`);--> statement-breakpoint
CREATE INDEX `clients_agent_idx` ON `clients` (`agentId`);--> statement-breakpoint
CREATE INDEX `clients_name_idx` ON `clients` (`name`);--> statement-breakpoint
CREATE TABLE `container_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sourceKey` text NOT NULL,
	`movementDate` integer NOT NULL,
	`transactionId` integer,
	`agentId` integer,
	`clientId` integer,
	`containerType` text NOT NULL,
	`movementType` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`isAutomatic` integer DEFAULT false NOT NULL,
	`createdBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `container_movements_source_key_unique` ON `container_movements` (`sourceKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `container_movements_transaction_unique` ON `container_movements` (`transactionId`,`movementType`,`containerType`);--> statement-breakpoint
CREATE INDEX `container_movements_date_idx` ON `container_movements` (`movementDate`);--> statement-breakpoint
CREATE INDEX `container_movements_client_idx` ON `container_movements` (`clientId`);--> statement-breakpoint
CREATE INDEX `container_movements_transaction_idx` ON `container_movements` (`transactionId`);--> statement-breakpoint
CREATE TABLE `import_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fileName` text NOT NULL,
	`fileKey` text,
	`fileUrl` text,
	`status` text DEFAULT 'processing' NOT NULL,
	`addedRows` integer DEFAULT 0 NOT NULL,
	`updatedRows` integer DEFAULT 0 NOT NULL,
	`skippedRows` integer DEFAULT 0 NOT NULL,
	`errorRows` integer DEFAULT 0 NOT NULL,
	`details` text,
	`importedBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`importedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_history_created_idx` ON `import_history` (`createdAt`);--> statement-breakpoint
CREATE TABLE `kassa_daily_actuals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entryDate` integer NOT NULL,
	`actualCash` integer DEFAULT 0 NOT NULL,
	`note` text,
	`updatedBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kassa_daily_actuals_date_unique` ON `kassa_daily_actuals` (`entryDate`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`containerType` text,
	`containerUnitsPerItem` integer DEFAULT 0 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sourceKey` text NOT NULL,
	`transactionDate` integer NOT NULL,
	`agentId` integer,
	`clientId` integer,
	`productId` integer,
	`productName` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` text DEFAULT '0' NOT NULL,
	`currentPrice` integer DEFAULT 0 NOT NULL,
	`salePrice` integer DEFAULT 0 NOT NULL,
	`totalAmount` integer DEFAULT 0 NOT NULL,
	`cashPayment` integer DEFAULT 0 NOT NULL,
	`terminalPayment` integer DEFAULT 0 NOT NULL,
	`clickPayment` integer DEFAULT 0 NOT NULL,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`createdBy` integer,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_key_unique` ON `transactions` (`sourceKey`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`transactionDate`);--> statement-breakpoint
CREATE INDEX `transactions_agent_idx` ON `transactions` (`agentId`);--> statement-breakpoint
CREATE INDEX `transactions_client_idx` ON `transactions` (`clientId`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`passwordHash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`lastSignedIn` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);