CREATE TABLE `client_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`paymentDate` timestamp NOT NULL,
	`cashAmount` int NOT NULL DEFAULT 0,
	`terminalAmount` int NOT NULL DEFAULT 0,
	`clickAmount` int NOT NULL DEFAULT 0,
	`note` varchar(1000),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `client_payments` ADD CONSTRAINT `client_payments_clientId_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_payments` ADD CONSTRAINT `client_payments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `client_payments_client_idx` ON `client_payments` (`clientId`);--> statement-breakpoint
CREATE INDEX `client_payments_date_idx` ON `client_payments` (`paymentDate`);