import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { billingSchema } from "./billingSchema";
import type {
  Company,
  PlatformAccount,
  PlatformEvent,
} from "../../shared/platform";

const schema = [
  `CREATE TABLE IF NOT EXISTS platform_identity (id int PRIMARY KEY, version int NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_accounts (
    id char(36) PRIMARY KEY, name varchar(120) NOT NULL, email varchar(254) NOT NULL UNIQUE,
    passwordHash varchar(255) NOT NULL, role varchar(20) NOT NULL, verifiedAt bigint NULL,
    createdAt bigint NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_companies (
    id char(36) PRIMARY KEY, name varchar(160) NOT NULL, slug varchar(63) NOT NULL UNIQUE,
    ownerId char(36) NOT NULL UNIQUE, phone varchar(32) NOT NULL, state varchar(24) NOT NULL,
    origin varchar(255) NULL UNIQUE, runtimeKeyHash char(64) NULL UNIQUE,
    trialStart bigint NULL, trialEnd bigint NULL, accessUntil bigint NULL, revision int NOT NULL DEFAULT 0,
    createdAt bigint NOT NULL, FOREIGN KEY (ownerId) REFERENCES platform_accounts(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_tokens (
    tokenHash char(64) PRIMARY KEY, accountId char(36) NOT NULL, companyId char(36) NULL,
    purpose varchar(20) NOT NULL, expiresAt bigint NOT NULL, consumedAt bigint NULL,
    FOREIGN KEY (accountId) REFERENCES platform_accounts(id),
    FOREIGN KEY (companyId) REFERENCES platform_companies(id), INDEX (accountId, purpose)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS platform_events (
    id bigint AUTO_INCREMENT PRIMARY KEY, companyId char(36) NULL, actorId char(36) NULL,
    actorName varchar(120) NOT NULL, action varchar(64) NOT NULL, reason varchar(500) NOT NULL,
    createdAt bigint NOT NULL, INDEX (companyId, id)
  ) ENGINE=InnoDB`,
];

export const COMPANY_SELECT = `SELECT c.id,c.name,c.slug,c.ownerId,a.name ownerName,a.email,c.phone,c.state,c.origin,
 c.createdAt,c.trialStart,c.trialEnd,c.accessUntil,c.revision FROM platform_companies c JOIN platform_accounts a ON a.id=c.ownerId`;
export type Sql = Pick<PoolConnection, "query">;
export async function rows<T>(
  db: Sql,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result as T[];
}

export class PlatformStore {
  readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = mysql.createPool({
      uri: databaseUrl,
      connectionLimit: 6,
      timezone: "+00:00",
      decimalNumbers: true,
    });
  }
  async assertReady() {
    const identity = await rows<{ id: number; version: number }>(
      this.pool,
      "SELECT id,version FROM platform_identity"
    );
    if (
      identity.length !== 1 ||
      identity[0].id !== 1 ||
      identity[0].version !== 1
    )
      throw new Error("Run platform:ops init against a dedicated database.");
    const business = await rows(this.pool, "SHOW TABLES LIKE 'cash_entries'");
    if (business.length)
      throw new Error(
        "Company business tables are forbidden in the platform database."
      );
  }
  async initialize() {
    const tables = await rows<Record<string, string>>(this.pool, "SHOW TABLES");
    if (tables.some(row => !Object.values(row)[0].startsWith("platform_")))
      throw new Error(
        "Refusing to initialize a database containing non-platform tables."
      );
    for (const ddl of [...schema, ...billingSchema]) await this.pool.query(ddl);
    await this.pool.query(
      "INSERT IGNORE INTO platform_identity (id,version) VALUES (1,1)"
    );
    await this.assertReady();
  }
  async transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> {
    const db = await this.pool.getConnection();
    try {
      await db.beginTransaction();
      const result = await fn(db);
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  }
  async account(id: string): Promise<PlatformAccount | null> {
    const [account] = await rows<
      PlatformAccount & { verifiedAt: number | null }
    >(
      this.pool,
      "SELECT id,name,email,role,verifiedAt FROM platform_accounts WHERE id=?",
      [id]
    );
    return account
      ? {
          id: account.id,
          name: account.name,
          email: account.email,
          role: account.role,
          verified: !!account.verifiedAt,
        }
      : null;
  }
  async company(id: string, db: Sql = this.pool, lock = false) {
    return (
      await rows<Company>(
        db,
        `${COMPANY_SELECT} WHERE c.id=?${lock ? " FOR UPDATE" : ""}`,
        [id]
      )
    )[0];
  }
  async event(
    db: Sql,
    companyId: string | null,
    actor: Pick<PlatformAccount, "id" | "name"> | null,
    action: string,
    reason = ""
  ) {
    await db.query(
      "INSERT INTO platform_events (companyId,actorId,actorName,action,reason,createdAt) VALUES (?,?,?,?,?,?)",
      [
        companyId,
        actor?.id ?? null,
        actor?.name ?? "Platforma operatori",
        action,
        reason,
        Date.now(),
      ]
    );
  }
  async events(companyId: string) {
    return rows<PlatformEvent>(
      this.pool,
      "SELECT id,companyId,actorName,action,reason,createdAt FROM platform_events WHERE companyId=? ORDER BY id DESC LIMIT 100",
      [companyId]
    );
  }
  close() {
    return this.pool.end();
  }
}
