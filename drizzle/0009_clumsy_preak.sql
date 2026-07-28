CREATE TABLE `app_settings` (
	`key` varchar(64) NOT NULL,
	`value` varchar(500),
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tableName` varchar(64) NOT NULL,
	`recordId` int NOT NULL,
	`action` enum('create','update','delete') NOT NULL,
	`userId` int,
	`beforeData` text,
	`afterData` text,
	`reason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD CONSTRAINT `app_settings_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_table_record_idx` ON `audit_log` (`tableName`,`recordId`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_log_user_idx` ON `audit_log` (`userId`);