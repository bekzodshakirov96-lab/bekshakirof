import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { readPlatformConfig } from "../server/platform/config";
import { PlatformStore, rows } from "../server/platform/store";
import { activateCompany, prepareCompany } from "../server/platform/provision";
import { newToken } from "../server/platform/security";
import { billingSchema } from "../server/platform/billingSchema";
import { inviteFirstAdmin } from "../server/platform/adminBootstrap";

const args = process.argv.slice(2);
const flag = (name: string) => args[args.indexOf(name) + 1];
async function main() {
  const config = readPlatformConfig();
  const store = new PlatformStore(config.databaseUrl);
  try {
    if (args[0] === "init") {
      await store.initialize();
      console.log("Separate platform schema ready.");
      return;
    }
    await store.assertReady();
    if (args[0] === "admin-invite" || args[0] === "admin-reinvite") {
      if (
        !args.includes("--out") ||
        !flag("--out") ||
        flag("--out").startsWith("--")
      )
        throw new Error(
          "Administrator invitation requires --out NEW_PRIVATE_FILE.env.local."
        );
      await inviteFirstAdmin(
        store,
        process.env.PLATFORM_ADMIN_EMAIL ?? "",
        config.origin,
        path.resolve(flag("--out")),
        args[0] === "admin-reinvite"
      );
      console.log(
        "Administrator invitation saved privately; expires in one hour. No password/token printed."
      );
      return;
    }
    if (args[0] === "billing-init") {
      for (const ddl of billingSchema) await store.pool.query(ddl);
      console.log(
        "Platform billing tables ready; company databases untouched."
      );
      return;
    }
    if (args[0] === "admin") {
      const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
      const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
      if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        password.length < 16 ||
        Buffer.byteLength(password) > 72
      )
        throw new Error(
          "Set valid PLATFORM_ADMIN_EMAIL and a 16–72 byte PLATFORM_ADMIN_PASSWORD privately in the environment."
        );
      await store.transaction(async db => {
        const existing = await rows(
          db,
          "SELECT id FROM platform_accounts WHERE email=? FOR UPDATE",
          [email]
        );
        if (existing.length)
          throw new Error(
            "Account already exists; this command never promotes an existing firm account."
          );
        const id = randomUUID();
        const name = "Super admin";
        await db.query(
          "INSERT INTO platform_accounts (id,name,email,passwordHash,role,verifiedAt,createdAt) VALUES (?,?,?,?,'super_admin',?,?)",
          [
            id,
            name,
            email,
            await bcrypt.hash(password, 12),
            Date.now(),
            Date.now(),
          ]
        );
        await store.event(db, null, { id, name }, "super_admin_created");
      });
      console.log("Super admin created. Password was not printed.");
      return;
    }
    if (args[0] === "provision") {
      if (
        !["--company", "--origin", "--out"].every(
          name =>
            args.includes(name) && flag(name) && !flag(name).startsWith("--")
        )
      )
        throw new Error(
          "Usage: provision --company UUID --origin https://company.example.uz --out NEW_PRIVATE_ENV_FILE"
        );
      const targetUrl = process.env.NEW_COMPANY_DATABASE_URL;
      if (!targetUrl)
        throw new Error(
          "NEW_COMPANY_DATABASE_URL must point to a prepared, empty company schema with its own database account."
        );
      const target = await mysql.createConnection({
        uri: targetUrl,
        dateStrings: true,
        timezone: "+05:00",
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
      try {
        const prepared = await prepareCompany(
          store,
          flag("--company"),
          target,
          flag("--origin"),
          config.production
        );
        if (prepared.origin === config.origin)
          throw new Error("Company and platform must have different origins.");
        const env = {
          TENANCY_MODE: "isolated",
          TENANT_ID: prepared.company.slug,
          TENANT_HOSTS: new URL(prepared.origin).hostname,
          DATABASE_URL: targetUrl,
          JWT_SECRET: newToken(),
          TZ: "Asia/Tashkent",
          UPLOADS_DIR: "/app/uploads",
          PLATFORM_MANAGED: "true",
          PLATFORM_CONTROL_URL: config.origin,
          PLATFORM_RUNTIME_KEY: prepared.runtimeKey,
        };
        // Exclusive file, outside tracked source. Never emit secrets in logs.
        const out = path.resolve(flag("--out"));
        if (!out.endsWith(".env.local"))
          throw new Error("Use a private, ignored .env.local output file.");
        await writeFile(
          out,
          Object.entries(env)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join("\n") + "\n",
          { flag: "wx", mode: 0o600 }
        );
        await activateCompany(store, prepared);
        console.log(
          "Company prepared; one-month trial started. Deploy the same business build using the private environment file and a separate uploads volume."
        );
      } finally {
        await target.end();
      }
      return;
    }
    throw new Error(
      "Usage: platform:ops init | admin | admin-invite --out FILE.env.local | admin-reinvite --out FILE.env.local | provision --company UUID --origin ORIGIN --out FILE.env.local"
    );
  } finally {
    await store.close();
  }
}
main().catch(error => {
  // Configuration errors contain instructions; mysql errors may contain credentials/SQL.
  console.error(
    (error as { code?: string }).code
      ? "Platform operation failed. Check database permissions and existing state."
      : (error as Error).message
  );
  process.exitCode = 1;
});
