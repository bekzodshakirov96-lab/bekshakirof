ALTER TABLE `stockMovements` ADD `unitCost` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `unitCost` int DEFAULT 0 NOT NULL;