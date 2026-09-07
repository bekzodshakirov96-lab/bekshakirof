CREATE TABLE IF NOT EXISTS cash_journal_debts (
  id int AUTO_INCREMENT NOT NULL,
  entryDate timestamp NOT NULL,
  agentId int,
  employeeId int,
  amount int NOT NULL,
  description text,
  createdBy int,
  createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cash_journal_debts_id PRIMARY KEY (id),
  CONSTRAINT cash_journal_debts_agentId_agents_id_fk FOREIGN KEY (agentId) REFERENCES agents(id) ON DELETE SET NULL,
  CONSTRAINT cash_journal_debts_employeeId_employees_id_fk FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT cash_journal_debts_createdBy_users_id_fk FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL,
  INDEX cash_journal_debts_date_idx (entryDate),
  INDEX cash_journal_debts_agent_idx (agentId),
  INDEX cash_journal_debts_employee_idx (employeeId)
);
