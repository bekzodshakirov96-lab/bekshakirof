CREATE TABLE `bottle_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`movementDate` timestamp NOT NULL,
	`movementType` enum('sent','payment') NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`unitPrice` int NOT NULL DEFAULT 0,
	`amount` bigint NOT NULL DEFAULT 0,
	`note` varchar(1000),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bottle_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bottle_movements` ADD CONSTRAINT `bottle_movements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bottle_movements_date_idx` ON `bottle_movements` (`movementDate`);