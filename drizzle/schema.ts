import {
  int,
  varchar,
  bigint,
  decimal,
  boolean,
  timestamp,
  mysqlEnum,
  index,
  uniqueIndex,
  mysqlTable,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables. The very first user created (id = 1)
   * is treated as the permanent account owner (see server/routers/users.ts).
   */
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }),
  /** Login identifier for self-hosted email + password authentication. */
  email: varchar("email", { length: 255 }).notNull().unique(),
  /** bcrypt hash of the user's password. Never store or return plaintext. */
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["user", "admin", "accountant", "agent", "sklad"]).default("user").notNull(),
  /** role="agent" bo'lganda — bu foydalanuvchi qaysi agent profiliga tegishli ekanini bildiradi;
   * shu orqali uning savdo/KEG kiritishlari faqat o'z nomiga cheklanadi. */
  agentId: int("agentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const agents = mysqlTable(
  "agents",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 255 }),
    note: varchar("note", { length: 255 }),
    /** Percent (0-100) of the amount actually collected from clients (not the debt portion) paid to the agent as commission. */
    commissionPercent: decimal("commissionPercent", { precision: 5, scale: 2 }).default("0").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("agents_name_unique").on(table.name)],
);

export const clients = mysqlTable(
  "clients",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    agentId: int("agentId").references(() => agents.id, { onDelete: "set null" }),
    phone: varchar("phone", { length: 255 }),
    address: varchar("address", { length: 255 }),
    openingDebt: int("openingDebt").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("clients_code_unique").on(table.code),
    index("clients_agent_idx").on(table.agentId),
    index("clients_name_idx").on(table.name),
  ],
);

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    unit: varchar("unit", { length: 255 }).notNull(),
    price: int("price").default(0).notNull(),
    containerType: mysqlEnum("containerType", ["keg_30", "keg_50"]),
    containerUnitsPerItem: int("containerUnitsPerItem").default(0).notNull(),
    /** Sklad: below this stock level the product is flagged as low-stock. 0 = no alert configured. */
    minStockLevel: int("minStockLevel").default(0).notNull(),
    /** Manual display order (Агент x Товар jadvalidagi qatorlar tartibi va h.k.) — kichikroq son yuqorida turadi. */
    sortOrder: int("sortOrder").default(0).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("products_code_unique").on(table.code),
    index("products_name_idx").on(table.name),
  ],
);

export const transactions = mysqlTable(
  "transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceKey: varchar("sourceKey", { length: 255 }).notNull(),
    transactionDate: timestamp("transactionDate").notNull(),
    agentId: int("agentId").references(() => agents.id, { onDelete: "set null" }),
    clientId: int("clientId").references(() => clients.id, { onDelete: "set null" }),
    productId: int("productId").references(() => products.id, { onDelete: "set null" }),
    productName: varchar("productName", { length: 255 }).notNull(),
    unit: varchar("unit", { length: 255 }).notNull(),
    quantity: varchar("quantity", { length: 255 }).default("0").notNull(),
    currentPrice: int("currentPrice").default(0).notNull(),
    salePrice: int("salePrice").default(0).notNull(),
    totalAmount: int("totalAmount").default(0).notNull(),
    cashPayment: int("cashPayment").default(0).notNull(),
    terminalPayment: int("terminalPayment").default(0).notNull(),
    clickPayment: int("clickPayment").default(0).notNull(),
    note: varchar("note", { length: 255 }),
    source: mysqlEnum("source", ["manual", "excel"]).default("manual").notNull(),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("transactions_source_key_unique").on(table.sourceKey),
    index("transactions_date_idx").on(table.transactionDate),
    index("transactions_agent_idx").on(table.agentId),
    index("transactions_client_idx").on(table.clientId),
  ],
);

export const cashEntries = mysqlTable(
  "cash_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceKey: varchar("sourceKey", { length: 255 }).notNull(),
    entryDate: timestamp("entryDate").notNull(),
    type: mysqlEnum("type", ["income", "expense"]).notNull(),
    category: varchar("category", { length: 255 }).notNull(),
    agentId: int("agentId").references(() => agents.id, { onDelete: "set null" }),
    description: varchar("description", { length: 255 }),
    cashAmount: int("cashAmount").default(0).notNull(),
    terminalAmount: int("terminalAmount").default(0).notNull(),
    clickAmount: int("clickAmount").default(0).notNull(),
    source: mysqlEnum("source", ["manual", "excel"]).default("manual").notNull(),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("cash_entries_source_key_unique").on(table.sourceKey),
    index("cash_entries_date_idx").on(table.entryDate),
    index("cash_entries_agent_idx").on(table.agentId),
  ],
);

export const containerMovements = mysqlTable(
  "container_movements",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceKey: varchar("sourceKey", { length: 255 }).notNull(),
    movementDate: timestamp("movementDate").notNull(),
    transactionId: int("transactionId").references(() => transactions.id, { onDelete: "cascade" }),
    agentId: int("agentId").references(() => agents.id, { onDelete: "set null" }),
    clientId: int("clientId").references(() => clients.id, { onDelete: "set null" }),
    containerType: varchar("containerType", { length: 255 }).notNull(),
    movementType: mysqlEnum("movementType", ["issued", "returned"]).notNull(),
    quantity: int("quantity").default(0).notNull(),
    note: varchar("note", { length: 255 }),
    source: mysqlEnum("source", ["manual", "excel"]).default("manual").notNull(),
    isAutomatic: boolean("isAutomatic").default(false).notNull(),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("container_movements_source_key_unique").on(table.sourceKey),
    uniqueIndex("container_movements_transaction_unique").on(
      table.transactionId,
      table.movementType,
      table.containerType,
    ),
    index("container_movements_date_idx").on(table.movementDate),
    index("container_movements_client_idx").on(table.clientId),
    index("container_movements_transaction_idx").on(table.transactionId),
  ],
);

/**
 * Sklad: single central warehouse stock ledger. Current stock per product is the running
 * sum of "in" minus "out" movements — never a cached column, so it can't drift.
 * "out" movements linked to a transactionId (isAutomatic=true) are kept in sync with sales
 * by reconcileTransactionStock() in server/stockAccounting.ts; manual in/out (production
 * receipts, waste, damage) have no transactionId and are entered directly on the Sklad page.
 */
export const stockMovements = mysqlTable(
  "stockMovements",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").references(() => products.id, { onDelete: "cascade" }).notNull(),
    movementType: mysqlEnum("movementType", ["in", "out"]).notNull(),
    quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
    reason: varchar("reason", { length: 255 }),
    transactionId: int("transactionId").references(() => transactions.id, { onDelete: "cascade" }),
    isAutomatic: boolean("isAutomatic").default(false).notNull(),
    movementDate: timestamp("movementDate").notNull(),
    note: varchar("note", { length: 1_000 }),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("stock_movements_product_idx").on(table.productId),
    index("stock_movements_date_idx").on(table.movementDate),
    index("stock_movements_transaction_idx").on(table.transactionId),
  ],
);

/**
 * Zavod bilan tara/KEG almashinuvi hisobi. Ikki mustaqil oqim:
 * tara_sent -> filled_received (bo'sh tara yuborildi -> zavod to'ldirib qaytardi) va
 * brak_returned -> brak_replaced (brak zavodga qaytarildi -> o'rniga yangi keg keldi).
 * filled_received/brak_replaced skladga avtomatik kirim, brak_returned avtomatik chiqim
 * yaratadi (stockMovementId orqali bog'langan) — Sklad qoldig'i har doim to'g'ri bo'lishi uchun.
 */
export const factoryOperations = mysqlTable(
  "factory_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    operationDate: timestamp("operationDate").notNull(),
    operationType: mysqlEnum("operationType", ["tara_sent", "filled_received", "brak_returned", "brak_replaced"]).notNull(),
    productId: int("productId").references(() => products.id, { onDelete: "cascade" }).notNull(),
    quantity: int("quantity").notNull(),
    note: varchar("note", { length: 1_000 }),
    stockMovementId: int("stockMovementId").references(() => stockMovements.id, { onDelete: "set null" }),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("factory_operations_product_idx").on(table.productId),
    index("factory_operations_date_idx").on(table.operationDate),
  ],
);

export const importHistory = mysqlTable(
  "import_history",
  {
    id: int("id").autoincrement().primaryKey(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    fileKey: varchar("fileKey", { length: 255 }),
    fileUrl: varchar("fileUrl", { length: 255 }),
    status: mysqlEnum("status", ["processing", "completed", "failed"])
      .default("processing")
      .notNull(),
    addedRows: int("addedRows").default(0).notNull(),
    updatedRows: int("updatedRows").default(0).notNull(),
    skippedRows: int("skippedRows").default(0).notNull(),
    errorRows: int("errorRows").default(0).notNull(),
    details: varchar("details", { length: 255 }),
    importedBy: int("importedBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => [index("import_history_created_idx").on(table.createdAt)],
);

/** One row per calendar day: the actual counted cash, compared against the computed Kassa qoldig'i. */
export const kassaDailyActuals = mysqlTable(
  "kassa_daily_actuals",
  {
    id: int("id").autoincrement().primaryKey(),
    entryDate: timestamp("entryDate").notNull(),
    actualCash: int("actualCash").default(0).notNull(),
    note: varchar("note", { length: 255 }),
    updatedBy: int("updatedBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("kassa_daily_actuals_date_unique").on(table.entryDate)],
);

/**
 * Products an agent took out on a given day, for daily reconciliation (not a client
 * sale). unitPrice is snapshotted at entry time so later price changes don't rewrite
 * history — mirrors transactions.currentPrice/salePrice.
 */
export const agentTakingEntries = mysqlTable(
  "agent_taking_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    entryDate: timestamp("entryDate").notNull(),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    productId: int("productId").references(() => products.id, { onDelete: "set null" }),
    productName: varchar("productName", { length: 255 }).notNull(),
    unitPrice: int("unitPrice").default(0).notNull(),
    quantity: varchar("quantity", { length: 255 }).default("0").notNull(),
    amount: int("amount").default(0).notNull(),
    createdBy: int("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [index("agent_taking_entries_date_agent_idx").on(table.entryDate, table.agentId)],
);

/**
 * Bitta mahsulot uchun tanlangan kunga xos vaqtinchalik narx bekor qilish.
 * Belgilansa, o'sha kundagi Агент x Товар setkasida shu mahsulot barcha agentlar
 * uchun shu narx bilan hisoblanadi; mahsulotning doimiy (products.price) narxini
 * o'zgartirmaydi va boshqa kunlarga ta'sir qilmaydi.
 */
export const dailyProductPrices = mysqlTable(
  "daily_product_prices",
  {
    id: int("id").autoincrement().primaryKey(),
    entryDate: timestamp("entryDate").notNull(),
    productId: int("productId")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    unitPrice: int("unitPrice").notNull(),
    updatedBy: int("updatedBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("daily_product_prices_date_product_unique").on(table.entryDate, table.productId)],
);

/** How much cash each agent handed over on a given day, one row per agent per day. */
export const agentCashSubmissions = mysqlTable(
  "agent_cash_submissions",
  {
    id: int("id").autoincrement().primaryKey(),
    entryDate: timestamp("entryDate").notNull(),
    agentId: int("agentId")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    submittedAmount: int("submittedAmount").default(0).notNull(),
    note: varchar("note", { length: 255 }),
    updatedBy: int("updatedBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("agent_cash_submissions_date_agent_unique").on(table.entryDate, table.agentId)],
);

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = typeof agents.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;
export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;
export type CashEntry = typeof cashEntries.$inferSelect;
export type InsertCashEntry = typeof cashEntries.$inferInsert;
export type ContainerMovement = typeof containerMovements.$inferSelect;
export type InsertContainerMovement = typeof containerMovements.$inferInsert;
export type ImportHistory = typeof importHistory.$inferSelect;
export type KassaDailyActual = typeof kassaDailyActuals.$inferSelect;
export type AgentTakingEntry = typeof agentTakingEntries.$inferSelect;
export type AgentCashSubmission = typeof agentCashSubmissions.$inferSelect;
export type DailyProductPrice = typeof dailyProductPrices.$inferSelect;
