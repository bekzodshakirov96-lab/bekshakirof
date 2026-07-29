ALTER TABLE `client_payments` ADD `transferAmount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `transferPayment` int DEFAULT 0 NOT NULL;