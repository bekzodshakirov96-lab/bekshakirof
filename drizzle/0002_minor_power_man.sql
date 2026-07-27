CREATE TABLE `daily_product_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entryDate` timestamp NOT NULL,
	`productId` int NOT NULL,
	`unitPrice` int NOT NULL,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_product_prices_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_product_prices_date_product_unique` UNIQUE(`entryDate`,`productId`)
);
--> statement-breakpoint
CREATE TABLE `factory_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operationDate` timestamp NOT NULL,
	`operationType` enum('tara_sent','filled_received','brak_returned','brak_replaced') NOT NULL,
	`productId` int NOT NULL,
	`quantity` int NOT NULL,
	`note` varchar(1000),
	`stockMovementId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `factory_operations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stockMovements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`movementType` enum('in','out') NOT NULL,
	`quantity` decimal(12,3) NOT NULL,
	`reason` varchar(255),
	`transactionId` int,
	`isAutomatic` boolean NOT NULL DEFAULT false,
	`movementDate` timestamp NOT NULL,
	`note` varchar(1000),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stockMovements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','accountant','agent','sklad') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `products` ADD `minStockLevel` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `sortOrder` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `agentId` int;--> statement-breakpoint
ALTER TABLE `daily_product_prices` ADD CONSTRAINT `daily_product_prices_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_product_prices` ADD CONSTRAINT `daily_product_prices_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `factory_operations` ADD CONSTRAINT `factory_operations_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `factory_operations` ADD CONSTRAINT `factory_operations_stockMovementId_stockMovements_id_fk` FOREIGN KEY (`stockMovementId`) REFERENCES `stockMovements`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `factory_operations` ADD CONSTRAINT `factory_operations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stockMovements` ADD CONSTRAINT `stockMovements_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stockMovements` ADD CONSTRAINT `stockMovements_transactionId_transactions_id_fk` FOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stockMovements` ADD CONSTRAINT `stockMovements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `factory_operations_product_idx` ON `factory_operations` (`productId`);--> statement-breakpoint
CREATE INDEX `factory_operations_date_idx` ON `factory_operations` (`operationDate`);--> statement-breakpoint
CREATE INDEX `stock_movements_product_idx` ON `stockMovements` (`productId`);--> statement-breakpoint
CREATE INDEX `stock_movements_date_idx` ON `stockMovements` (`movementDate`);--> statement-breakpoint
CREATE INDEX `stock_movements_transaction_idx` ON `stockMovements` (`transactionId`);