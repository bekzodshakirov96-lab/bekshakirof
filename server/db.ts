import { eq, sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { appSettings, InsertUser, users } from "../drizzle/schema";
import { runtimeTenant } from "./tenancy/config";
import { assertTenantDatabase } from "./tenancy/database";
import { assertTenantQueryScope } from "./tenancy/scopeSchema";
import { createTenantDatabase } from "./tenancy/queryScope";
const databaseUrl = process.env.DATABASE_URL;
let activePool: ReturnType<typeof mysql.createPool> | null = null;
let schemaDb: MySql2Database<Record<string, unknown>> | null = null;

// MySQL TIMESTAMP columns (entryDate, transactionDate, etc.) are stored as UTC
// internally and converted using the CONNECTION'S session time_zone on every
// read/write. That session defaults to the database host's own SYSTEM setting —
// fine today (this machine is Tashkent time), but a future managed MySQL host
// (RDS, PlanetScale, Railway...) commonly defaults to UTC, which would silently
// shift every existing Kassa/report timestamp by hours the moment the database
// itself moves. Pin every connection to Tashkent's fixed offset (Uzbekistan has
// no DST) so this stays correct no matter where the database is hosted.
async function connect() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const pool = mysql.createPool({ uri: databaseUrl, timezone: "+05:00" });
  // Despite the promise-wrapper types, this event hands back the underlying
  // callback-style connection, so `.query()` here takes a callback, not a promise.
  pool.on("connection", connection => {
    const callbackQuery = connection.query.bind(connection) as unknown as (
      sql: string,
      cb: (error: unknown) => void,
    ) => void;
    callbackQuery("SET time_zone = '+05:00'", error => {
      if (error) console.warn("[Database] Failed to set session time_zone:", error);
    });
  });
  try {
    await assertTenantDatabase(pool, runtimeTenant);
    await assertTenantQueryScope(pool, runtimeTenant.id);
    activePool = pool;
    schemaDb = drizzle(pool);
    return createTenantDatabase(pool, runtimeTenant.id);
  } catch (error) {
    await pool.end();
    throw error;
  }
}

let _db: Awaited<ReturnType<typeof connect>> | null = null;
let connecting: Promise<Awaited<ReturnType<typeof connect>>> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db) {
    try {
      connecting ??= connect();
      _db = await connecting;
    } catch (error) {
      connecting = null;
      if (runtimeTenant.mode === "isolated") throw error;
      console.warn("[Database] Failed to connect.");
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

/** Startup schema helpers only. HTTP business code must use requireDb(). */
export async function requireSchemaDb() {
  await requireDb();
  if (!schemaDb) throw new Error("Schema database is unavailable.");
  return schemaDb;
}

/** Release this runtime's pool (used by shutdown/integration test tooling). */
export async function closeDb() {
  await connecting?.catch(() => null);
  _db = null;
  connecting = null;
  schemaDb = null;
  const pool = activePool;
  activePool = null;
  if (pool) await pool.end();
}

/** True when this is the very first account ever created (the permanent owner). */
/** Faqat "hali sozlanmagan tizim" ekranini ko'rsatish/yashirish uchun — o'qish
 * uchun, poyga holatidan himoyalanmagan. Haqiqiy "birinchi admin" qarori
 * `claimFirstAdmin()` orqali atomik tarzda qabul qilinadi. */
export async function isFirstUser(): Promise<boolean> {
  const db = await requireDb();
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return !row;
}

/** Tizimda birinchi bo'lib ro'yxatdan o'tgan (demak, admin bo'lishi kerak bo'lgan)
 * so'rovni atomik tarzda aniqlaydi. `app_settings.key` PRIMARY KEY ekanidan
 * foydalanib, bir martalik "mutex" sifatida ishlatiladi — ikki so'rov bir vaqtda
 * kelsa ham, faqat bittasi ushbu INSERT'da g'olib chiqadi (boshqasi duplicate-key
 * xatosi bilan yiqiladi), shuning uchun ikkalasi ham admin bo'lib qolish xavfi yo'q. */
export async function claimFirstAdmin(): Promise<boolean> {
  const db = await requireDb();
  // Allaqachon foydalanuvchi bor tizimlarda (masalan bu tuzatishdan oldin
  // o'rnatilgan, `app_settings` qatori hali yo'q bo'lgan real tizimlar) bootstrap
  // da'vosi hech qachon berilmasin — aks holda birinchi keyingi `register`
  // chaqiruvi noto'g'ri ravishda yana bitta admin yaratib qo'yardi.
  const [existingUser] = await db.select({ id: users.id }).from(users).limit(1);
  if (existingUser) return false;
  try {
    await db.insert(appSettings).values({ key: "bootstrapAdminClaimed", value: "1" });
    return true;
  } catch {
    return false;
  }
}

export async function createUser(user: InsertUser) {
  const db = await requireDb();
  const [created] = await db
    .insert(users)
    .values({ ...user, role: user.role ?? "user" })
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

/** Logout paytida chaqiriladi — shu foydalanuvchining barcha oldingi (o'g'irlangan
 * nusxalari ham) tokenlarini bekor qiladi, chunki ularning ichidagi tokenVersion
 * endi bazadagi qiymatga mos kelmaydi (server/_core/localAuth.ts:authenticateRequest). */
export async function incrementTokenVersion(id: number) {
  const db = await requireDb();
  await db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, id));
}

/** Foydalanuvchi tanlagan interfeys alifbosini saqlaydi (lotin yoki kirill). */
export async function setUserLanguage(id: number, language: "latin" | "cyrillic") {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ language }).where(eq(users.id, id));
}

// TODO: add feature queries here as your schema grows.
