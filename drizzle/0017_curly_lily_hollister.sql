CREATE TABLE `cash_matrix_layouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`effectiveDate` timestamp NOT NULL,
	`layout` text NOT NULL,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cash_matrix_layouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_matrix_layouts_date_unique` UNIQUE(`effectiveDate`),
	CONSTRAINT `cash_matrix_layouts_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action
);
