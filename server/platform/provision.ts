import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Connection } from "mysql2/promise";
import { trialEndAfterMonth } from "../../shared/platform";
import { snapshotBusinessData } from "../tenancy/audit";
import { bindTenantDatabase } from "../tenancy/bind";
import { readDatabaseIdentity } from "../tenancy/database";
import { checkedOrigin } from "./config";
import { getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as businessSchema from "../../drizzle/schema";
import { newToken, PlatformError, tokenHash } from "./security";
import { PlatformStore, rows } from "./store";

/** Operator-only: never takes a URL/database credential from an HTTP request. */
export async function prepareCompany(
  store: PlatformStore,
  id: string,
  target: Connection,
  origin: string,
  production: boolean
) {
  const company = await store.company(id);
  if (!company || company.state !== "provisioning")
    throw new Error(
      "Only an email-verified company awaiting provisioning can be prepared."
    );
  const owner = await store.account(company.ownerId);
  if (!owner?.verified || owner.role !== "owner")
    throw new Error("Verified company owner is required.");
  const companyOrigin = checkedOrigin(origin, production);
  const snapshot = await snapshotBusinessData(target);
  const tables = snapshot.tables.map(table => table.name.toLowerCase()).sort();
  const expected = Object.values(businessSchema)
    .filter(value => is(value, MySqlTable))
    .map(value => getTableName(value).toLowerCase())
    .sort();
  if (JSON.stringify(tables) !== JSON.stringify(expected))
    throw new Error(
      "Prepare the complete current empty business schema in a separate company database first."
    );
  const [users] = await target.query("SELECT id,email,role FROM users");
  const owners = users as { id: number; email: string; role: string }[];
  const resume =
    owners.length === 1 &&
    owners[0].id === 1 &&
    owners[0].email === owner.email &&
    owners[0].role === "admin";
  if (
    snapshot.tables.some(
      table => table.rows !== (table.name === "users" && resume ? 1 : 0)
    )
  )
    throw new Error(
      "Refusing to provision a database with existing business records."
    );
  if (resume) {
    if ((await readDatabaseIdentity(target)) !== company.slug)
      throw new Error("Prepared database belongs to another company.");
  } else {
    await bindTenantDatabase(target, company.slug, snapshot);
    // Platform login exchanges a one-use ticket. This random password is never disclosed.
    await target.query(
      "INSERT INTO users (tenant_id,id,name,email,passwordHash,role) VALUES (?,1,?,?,?,'admin')",
      [
        company.slug,
        owner.name,
        owner.email,
        await bcrypt.hash(randomBytes(48).toString("hex"), 12),
      ]
    );
  }
  return { company, origin: companyOrigin, runtimeKey: newToken() };
}

export async function activateCompany(
  store: PlatformStore,
  prepared: Awaited<ReturnType<typeof prepareCompany>>
) {
  await store.transaction(async db => {
    const company = await store.company(prepared.company.id, db, true);
    if (company.state !== "provisioning" || company.trialStart !== null)
      throw new PlatformError(
        409,
        "Firma allaqachon faollashtirilgan; sinovni qayta boshlash mumkin emas."
      );
    const now = Date.now();
    const end = trialEndAfterMonth(now);
    await db.query(
      "UPDATE platform_companies SET state='ready',origin=?,runtimeKeyHash=?,trialStart=?,trialEnd=?,accessUntil=?,revision=revision+1 WHERE id=?",
      [
        prepared.origin,
        tokenHash(prepared.runtimeKey),
        now,
        end,
        end,
        company.id,
      ]
    );
    await store.event(
      db,
      company.id,
      null,
      "provisioned",
      "Alohida baza tayyorlandi. Bir kalendar oylik sinov boshlandi."
    );
  });
}
