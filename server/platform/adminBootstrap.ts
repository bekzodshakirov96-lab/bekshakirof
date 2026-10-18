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
  output: string,
  renewUnused = false
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
    const existing = await rows<{ id: string; email: string; role: string }>(
      db,
      renewUnused
        ? "SELECT id,email,role FROM platform_accounts FOR UPDATE"
        : "SELECT id,email,role FROM platform_accounts WHERE role='super_admin' OR email=? LIMIT 1",
      renewUnused ? [] : [normalized]
    );
    if (renewUnused) {
      const account = existing[0];
      if (
        existing.length !== 1 ||
        account.role !== "super_admin" ||
        account.email !== normalized
      )
        throw new Error(
          "Renewal is limited to the sole, original bootstrap administrator."
        );
      const invited = await rows(
        db,
        "SELECT id FROM platform_events WHERE action='super_admin_invited' AND actorId=? LIMIT 1",
        [account.id]
      );
      const used = await rows(
        db,
        "SELECT id FROM platform_events WHERE action='password_reset' LIMIT 1"
      );
      const sessions = await rows(
        db,
        "SELECT tokenHash FROM platform_tokens WHERE purpose='session' LIMIT 1"
      );
      const companies = await rows(
        db,
        "SELECT id FROM platform_companies LIMIT 1"
      );
      if (!invited.length || used.length || sessions.length || companies.length)
        throw new Error(
          "Administrator setup has been used; renewal never resets an active account."
        );
      await db.query(
        "UPDATE platform_tokens SET consumedAt=? WHERE accountId=? AND purpose='reset' AND consumedAt IS NULL",
        [Date.now(), account.id]
      );
      const token = await issueToken(db, account.id, "reset", 60 * 60 * 1000);
      await writeFile(
        output,
        `PLATFORM_ADMIN_SETUP_URL=${JSON.stringify(`${origin}/platforma/parol#${token}`)}\n`,
        { flag: "wx", mode: 0o600 }
      );
      await store.event(
        db,
        null,
        { id: account.id, name: "Super admin" },
        "super_admin_invitation_renewed",
        "Unused bootstrap link replaced by operator; password unchanged"
      );
      return;
    }
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
