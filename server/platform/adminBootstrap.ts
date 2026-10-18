import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { writeFile } from "node:fs/promises";
import type { PlatformStore } from "./store";
import { rows } from "./store";
import { issueToken, newToken } from "./security";

/** Explicit operator bootstrap for the first administrator only; never a public API. */
export async function inviteFirstAdmin(
  store: PlatformStore,
  email: string,
  origin: string,
  output: string
) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
    throw new Error("A valid administrator email is required.");
  if (!output.endsWith(".env.local"))
    throw new Error("Use a new private .env.local output file.");
  await store.assertReady();
  await store.transaction(async db => {
    // Singleton row serializes first-admin creation, including concurrent invocations.
    await rows(db, "SELECT id FROM platform_identity WHERE id=1 FOR UPDATE");
    const existing = await rows(
      db,
      "SELECT id FROM platform_accounts WHERE role='super_admin' OR email=? LIMIT 1",
      [normalized]
    );
    if (existing.length)
      throw new Error(
        "An administrator or this email already exists; bootstrap never overwrites/promotes accounts."
      );
    const id = randomUUID();
    const now = Date.now();
    await db.query(
      "INSERT INTO platform_accounts (id,name,email,passwordHash,role,verifiedAt,createdAt) VALUES (?,'Super admin',?,?,'super_admin',?,?)",
      [id, normalized, await bcrypt.hash(newToken(), 12), now, now]
    );
    const token = await issueToken(db, id, "reset", 60 * 60 * 1000);
    const link = `${origin}/platforma/parol#${token}`;
    // No known initial password. The human sets it through the existing one-use reset flow.
    await writeFile(
      output,
      `PLATFORM_ADMIN_SETUP_URL=${JSON.stringify(link)}\n`,
      { flag: "wx", mode: 0o600 }
    );
    await store.event(
      db,
      null,
      { id, name: "Super admin" },
      "super_admin_invited",
      "One-hour operator bootstrap invitation; no password disclosed"
    );
  });
}
