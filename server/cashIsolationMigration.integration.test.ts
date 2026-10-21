import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { it, expect } from "vitest";
import { TENANT_IDENTITY_DDL } from "./tenancy/database";
import { applyTenantQueryScope } from "./tenancy/scopeSchema";
import { migrateCashDebtRecordOnly, DEBT_RECORD_PREVIOUS_SCOPE_HASH } from "./cashDebtRecordOnlySchema";

const url = process.env.TENANT_ISOLATION_TEST_URL;
it.skipIf(!url)("copies historical commission once, preserves original cash/history and refuses another tenant", async () => {
  const target = new URL(url!);
  if (target.hostname !== "127.0.0.1" || target.port !== "43317") throw Error("Local TEST SQL only");
  const schema = `bc_cash_isolation_${randomBytes(6).toString("hex")}`;
  const root = await mysql.createConnection(url!);
  let db: mysql.Connection | undefined;
  try {
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    target.pathname = `/${schema}`;
    db = await mysql.createConnection({uri:target.toString(),multipleStatements:true});
    const ddl = execFileSync(process.execPath,["node_modules/drizzle-kit/bin.cjs","export","--dialect","mysql","--schema","./drizzle/schema.ts"],{encoding:"utf8",maxBuffer:8e6});
    await db.query(ddl.slice(ddl.indexOf("CREATE TABLE")).replace('`cashEntryId` int,','`cashEntryId` int NOT NULL,'));
    await db.query(TENANT_IDENTITY_DDL);
    await db.query("INSERT INTO saas_tenant_identity(id,tenantId,bindingVersion) VALUES(1,'legacy',1)");
    await applyTenantQueryScope(db,"legacy");
    await db.query("INSERT INTO agents(id,name) VALUES(1,'TEST historical agent')");
    await db.query("INSERT INTO cash_entries(sourceKey,agentId,entryDate,type,category,cashAmount) VALUES ('old-advance',1,'2026-09-10 12:00:00','expense','Ойлик',1000),('agent-commission:1:2026-09-01:2026-09-30',1,'2026-10-01 12:00:00','expense','Ойлик',9000),('other',1,'2026-10-01 12:00:00','income','Приход пет',20000)");
    const [originalCash] = await db.query("SELECT * FROM cash_entries ORDER BY id");
    await db.query("INSERT INTO cash_journal_debts(id,entryDate,agentId,amount) VALUES(1,'2026-10-01 12:00:00',1,30000)");
    await db.query("INSERT INTO cash_journal_debt_repayments(debtId,paymentDate,amount,method,cashEntryId,cashEntryCreated) VALUES(1,'2026-10-01 12:00:00',20000,'cash',3,true)");
    const [originalPayments] = await db.query("SELECT id,debtId,paymentDate,amount,method,cashEntryId,cashEntryCreated,createdAt,activeCashEntryId FROM cash_journal_debt_repayments ORDER BY id");
    await db.query("DROP TABLE agent_commission_payments");
    await db.query("ALTER TABLE cash_journal_debt_repayments DROP INDEX cash_debt_repayments_request_unique, DROP COLUMN requestId");
    await db.query("UPDATE saas_tenant_scope SET schemaHash=?",[DEBT_RECORD_PREVIOUS_SCOPE_HASH]);
    await expect(migrateCashDebtRecordOnly(db,"other-tenant")).rejects.toThrow("identity");
    // Legacy production predates SaaS database identities; retain its original
    // scope binding instead of introducing or rewriting company metadata.
    await db.query("DROP TABLE saas_tenant_identity");
    await expect(migrateCashDebtRecordOnly(db,"other-tenant")).rejects.toThrow("identity");
    await expect(migrateCashDebtRecordOnly(db,"legacy")).resolves.toMatchObject({historyPreserved:true});
    const [columns] = await db.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM cash_journal_debt_repayments");
    expect(columns.find(c=>c.Field==='cashEntryId')?.Null).toBe('YES');
    expect(columns.some(c=>c.Field==='requestId')).toBe(true);
    expect((await db.query("SELECT * FROM cash_entries ORDER BY id"))[0]).toEqual(originalCash);
    expect((await db.query("SELECT id,debtId,paymentDate,amount,method,cashEntryId,cashEntryCreated,createdAt,activeCashEntryId FROM cash_journal_debt_repayments ORDER BY id"))[0]).toEqual(originalPayments);
    const [ledger] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM agent_commission_payments ORDER BY id");
    expect(ledger.map(r=>({sourceKey:r.sourceKey,cashAmount:r.cashAmount})).sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey))).toEqual([
      {sourceKey:'agent-commission:1:2026-09-01:2026-09-30',cashAmount:9000},
      {sourceKey:'old-advance',cashAmount:1000},
    ]);
    await db.query("INSERT INTO cash_entries(sourceKey,agentId,entryDate,type,category,cashAmount) VALUES ('later-journal-only',1,'2026-10-21 12:00:00','expense','Ойлик',777)");
    await migrateCashDebtRecordOnly(db,"legacy");
    expect((await db.query("SELECT * FROM agent_commission_payments ORDER BY id"))[0]).toEqual(ledger);
    expect((await db.query<mysql.RowDataPacket[]>("SELECT * FROM cash_entries ORDER BY id"))[0]).toHaveLength(4);
  } finally {
    await db?.end();
    await root.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await root.end();
  }
},60000);
