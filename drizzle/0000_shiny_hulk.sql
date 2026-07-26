CREATE TABLE `agent_cash_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entryDate` timestamp NOT NULL,
	`agentId` int NOT NULL,
	`submittedAmount` int NOT NULL DEFAULT 0,
	`note` varchar(255),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_cash_submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_cash_submissions_date_agent_unique` UNIQUE(`entryDate`,`agentId`)
);
--> statement-breakpoint
CREATE TABLE `agent_taking_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entryDate` timestamp NOT NULL,
	`agentId` int NOT NULL,
	`productId` int,
	`productName` varchar(255) NOT NULL,
	`unitPrice` int NOT NULL DEFAULT 0,
	`quantity` varchar(255) NOT NULL DEFAULT '0',
	`amount` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_taking_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(255),
	`note` varchar(255),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agents_id` PRIMARY KEY(`id`),
	CONSTRAINT `agents_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `cash_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(255) NOT NULL,
	`entryDate` timestamp NOT NULL,
	`type` enum('income','expense') NOT NULL,
	`category` varchar(255) NOT NULL,
	`agentId` int,
	`description` varchar(255),
	`cashAmount` int NOT NULL DEFAULT 0,
	`terminalAmount` int NOT NULL DEFAULT 0,
	`clickAmount` int NOT NULL DEFAULT 0,
	`source` enum('manual','excel') NOT NULL DEFAULT 'manual',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cash_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_entries_source_key_unique` UNIQUE(`sourceKey`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`agentId` int,
	`phone` varchar(255),
	`address` varchar(255),
	`openingDebt` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `container_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(255) NOT NULL,
	`movementDate` timestamp NOT NULL,
	`transactionId` int,
	`agentId` int,
	`clientId` int,
	`containerType` varchar(255) NOT NULL,
	`movementType` enum('issued','returned') NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`note` varchar(255),
	`source` enum('manual','excel') NOT NULL DEFAULT 'manual',
	`isAutomatic` boolean NOT NULL DEFAULT false,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `container_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `container_movements_source_key_unique` UNIQUE(`sourceKey`),
	CONSTRAINT `container_movements_transaction_unique` UNIQUE(`transactionId`,`movementType`,`containerType`)
);
--> statement-breakpoint
CREATE TABLE `import_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileKey` varchar(255),
	`fileUrl` varchar(255),
	`status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
	`addedRows` int NOT NULL DEFAULT 0,
	`updatedRows` int NOT NULL DEFAULT 0,
	`skippedRows` int NOT NULL DEFAULT 0,
	`errorRows` int NOT NULL DEFAULT 0,
	`details` varchar(255),
	`importedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `import_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kassa_daily_actuals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entryDate` timestamp NOT NULL,
	`actualCash` int NOT NULL DEFAULT 0,
	`note` varchar(255),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kassa_daily_actuals_id` PRIMARY KEY(`id`),
	CONSTRAINT `kassa_daily_actuals_date_unique` UNIQUE(`entryDate`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`unit` varchar(255) NOT NULL,
	`price` int NOT NULL DEFAULT 0,
	`containerType` enum('keg_30','keg_50'),
	`containerUnitsPerItem` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(255) NOT NULL,
	`transactionDate` timestamp NOT NULL,
	`agentId` int,
	`clientId` int,
	`productId` int,
	`productName` varchar(255) NOT NULL,
	`unit` varchar(255) NOT NULL,
	`quantity` varchar(255) NOT NULL DEFAULT '0',
	`currentPrice` int NOT NULL DEFAULT 0,
	`salePrice` int NOT NULL DEFAULT 0,
	`totalAmount` int NOT NULL DEFAULT 0,
	`cashPayment` int NOT NULL DEFAULT 0,
	`terminalPayment` int NOT NULL DEFAULT 0,
	`clickPayment` int NOT NULL DEFAULT 0,
	`note` varchar(255),
	`source` enum('manual','excel') NOT NULL DEFAULT 'manual',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `transactions_source_key_unique` UNIQUE(`sourceKey`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255),
	`email` varchar(255) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`role` enum('user','admin','accountant') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `agent_cash_submissions` ADD CONSTRAINT `agent_cash_submissions_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_cash_submissions` ADD CONSTRAINT `agent_cash_submissions_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_taking_entries` ADD CONSTRAINT `agent_taking_entries_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_taking_entries` ADD CONSTRAINT `agent_taking_entries_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_taking_entries` ADD CONSTRAINT `agent_taking_entries_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_entries` ADD CONSTRAINT `cash_entries_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_entries` ADD CONSTRAINT `cash_entries_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `container_movements` ADD CONSTRAINT `container_movements_transactionId_transactions_id_fk` FOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `container_movements` ADD CONSTRAINT `container_movements_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `container_movements` ADD CONSTRAINT `container_movements_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `container_movements` ADD CONSTRAINT `container_movements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_history` ADD CONSTRAINT `import_history_importedBy_users_id_fk` FOREIGN KEY (`importedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kassa_daily_actuals` ADD CONSTRAINT `kassa_daily_actuals_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `agent_taking_entries_date_agent_idx` ON `agent_taking_entries` (`entryDate`,`agentId`);--> statement-breakpoint
CREATE INDEX `cash_entries_date_idx` ON `cash_entries` (`entryDate`);--> statement-breakpoint
CREATE INDEX `cash_entries_agent_idx` ON `cash_entries` (`agentId`);--> statement-breakpoint
CREATE INDEX `clients_agent_idx` ON `clients` (`agentId`);--> statement-breakpoint
CREATE INDEX `clients_name_idx` ON `clients` (`name`);--> statement-breakpoint
CREATE INDEX `container_movements_date_idx` ON `container_movements` (`movementDate`);--> statement-breakpoint
CREATE INDEX `container_movements_client_idx` ON `container_movements` (`clientId`);--> statement-breakpoint
CREATE INDEX `container_movements_transaction_idx` ON `container_movements` (`transactionId`);--> statement-breakpoint
CREATE INDEX `import_history_created_idx` ON `import_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `products_name_idx` ON `products` (`name`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`transactionDate`);--> statement-breakpoint
CREATE INDEX `transactions_agent_idx` ON `transactions` (`agentId`);--> statement-breakpoint
CREATE INDEX `transactions_client_idx` ON `transactions` (`clientId`);