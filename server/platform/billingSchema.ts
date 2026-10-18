// Platform database only. Never import company DB/router modules here.
export const billingSchema = [
  `CREATE TABLE IF NOT EXISTS platform_billing_prices (
    id int AUTO_INCREMENT PRIMARY KEY, amountTiyin bigint NOT NULL,
    createdBy char(36) NOT NULL, createdAt bigint NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES platform_accounts(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_billing_orders (
    id char(36) PRIMARY KEY, companyId char(36) NOT NULL, priceId int NOT NULL,
    provider varchar(10) NOT NULL, mode varchar(10) NOT NULL, amountTiyin bigint NOT NULL,
    state varchar(16) NOT NULL, requestKey char(36) NOT NULL,
    activeTxn bigint NULL, createdAt bigint NOT NULL, expiresAt bigint NOT NULL, paidAt bigint NULL,
    UNIQUE (companyId, requestKey), INDEX (companyId, createdAt),
    FOREIGN KEY (companyId) REFERENCES platform_companies(id),
    FOREIGN KEY (priceId) REFERENCES platform_billing_prices(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_billing_transactions (
    id bigint AUTO_INCREMENT PRIMARY KEY, orderId char(36) NOT NULL,
    provider varchar(10) NOT NULL, mode varchar(10) NOT NULL, externalId varchar(100) NOT NULL,
    providerTime bigint NOT NULL, state int NOT NULL, createTime bigint NOT NULL,
    performTime bigint NOT NULL DEFAULT 0, cancelTime bigint NOT NULL DEFAULT 0, reason int NULL,
    UNIQUE (provider, mode, externalId), INDEX (provider, providerTime),
    FOREIGN KEY (orderId) REFERENCES platform_billing_orders(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_billing_grants (
    orderId char(36) PRIMARY KEY, companyId char(36) NOT NULL,
    startAt bigint NOT NULL, endAt bigint NOT NULL, revokedAt bigint NULL,
    FOREIGN KEY (orderId) REFERENCES platform_billing_orders(id),
    FOREIGN KEY (companyId) REFERENCES platform_companies(id), INDEX (companyId, endAt)
  ) ENGINE=InnoDB`,
];
