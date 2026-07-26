import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users } from "../drizzle/schema";

// MySQL TIMESTAMP columns (entryDate, transactionDate, etc.) are stored as UTC
// internally and converted using the CONNECTION'S session time_zone on every
// read/write. That session defaults to the database host's own SYSTEM setting —
// fine today (this machine is Tashkent time), but a future managed MySQL host
// (RDS, PlanetScale, Railway...) commonly defaults to UTC, which would silently
// shift every existing Kassa/report timestamp by hours the moment the database
// itself moves. Pin every connection to Tashkent's fixed offset (Uzbekistan has
// no DST) so this stays correct no matter where the database is hosted.
function connect() {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, timezone: "+05:00" });
  // Despite the promise-wrapper types, this event hands back the underlying
  // callback-style connection, so `.query()` here takes a callback, not a promise.
  pool.on("connection", connection => {
    connection.query("SET time_zone = '+05:00'", (error: unknown) => {
      if (error) console.warn("[Database] Failed to set session time_zone:", error);
    });
  });
  return drizzle(pool);
}

let _db: ReturnType<typeof connect> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db) {
    try {
      _db = connect();
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new Error("Ma'lumotlar bazasiga ulanish mavjud emas.");
  }
  return db;
}

/** True when this is the very first account ever created (the permanent owner). */
export async function isFirstUser(): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return !row;
}

export async function createUser(user: InsertUser) {
  const db = await requireDb();
  const isFirst = await isFirstUser();
  const [created] = await db
    .insert(users)
    .values({ ...user, role: isFirst ? "admin" : (user.role ?? "user") })
    .$returningId();
  return getUserById(created.id);
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function touchLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
}

// TODO: add feature queries here as your schema grows.
