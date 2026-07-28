ALTER TABLE `client_payments` ADD `agentId` int;--> statement-breakpoint
ALTER TABLE `client_payments` ADD CONSTRAINT `client_payments_agentId_agents_id_fk` FOREIGN KEY (`agentId`) REFERENCES `agents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `client_payments_agent_idx` ON `client_payments` (`agentId`);