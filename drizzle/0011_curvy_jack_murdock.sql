ALTER TABLE `kassa_daily_actuals` ADD `terminalConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `kassa_daily_actuals` ADD `clickConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `kassa_daily_actuals` ADD `transferConfirmed` int DEFAULT 0 NOT NULL;