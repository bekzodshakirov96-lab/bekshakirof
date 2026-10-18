import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  users,
  agents,
  cashEntries,
  appSettings,
  auditLog,
} from "../drizzle/schema";
import { createTenantDatabase } from "./tenancy/queryScope";
import { applyTenantQueryScope } from "./tenancy/scopeSchema";
import { snapshotBusinessData } from "./tenancy/audit";
import {
  brandLogoStorageAt,
  readCompanyBranding,
  saveCompanyBranding,
  type BrandLogoStorage,
} from "./companyBranding";
import { companyBrandingRouter } from "./routers/companyBranding";
import {
  companyTemplateStatus,
  applyCompanyTemplate,
} from "./companyTemplates";
import type { TrpcContext } from "./_core/context";
type Db = ReturnType<typeof createTenantDatabase>;
const scope = new AsyncLocalStorage<Db>();
vi.mock("./db", async original => ({
  ...(await original<typeof import("./db")>()),
  requireDb: async () => {
    const db = scope.getStore();
    if (!db) throw Error("Test scope missing");
    return db;
  },
}));
const url = process.env.TENANT_ISOLATION_TEST_URL;
let root: Connection,
  connection: Connection,
  pool: Pool,
  a: Db,
  b: Db,
  ownerA: number,
  ownerB: number,
  dir: string;
let storeA: BrandLogoStorage, storeB: BrandLogoStorage;
const fields = {
  name: "Baraka savdo",
  tagline: "Ulgurji savdo",
  color: "#0F766E",
};
function png() {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    out.write(type, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
  };
  const header = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(18))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function caller(db: Db, id: number, role = "admin") {
  return scope.run(db, () =>
    companyBrandingRouter.createCaller({
      user: { id, role },
      req: { headers: {} },
      res: {},
    } as TrpcContext)
  );
}
const nonSettings = (
  snapshot: Awaited<ReturnType<typeof snapshotBusinessData>>
) =>
  snapshot.tables.filter(t => !["app_settings", "audit_log"].includes(t.name));
describe.skipIf(!url)(
  "company branding with actual tenant SQL and isolated files",
  () => {
    beforeAll(async () => {
      const parsed = new URL(url!);
      if (parsed.hostname !== "127.0.0.1" || parsed.port !== "43317")
        throw Error("Disposable local SQL only");
      root = await mysql.createConnection({
        uri: url!,
        multipleStatements: true,
      });
      const suffix = randomBytes(6).toString("hex"),
        schema = `bc_brand_${suffix}`,
        account = `bb_${suffix}`,
        password = randomBytes(20).toString("hex");
      await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
      await root.query(`CREATE USER '${account}'@'%' IDENTIFIED BY ?`, [
        password,
      ]);
      await root.query(`GRANT ALL ON \`${schema}\`.* TO '${account}'@'%'`);
      parsed.username = account;
      parsed.password = password;
      parsed.pathname = `/${schema}`;
      connection = await mysql.createConnection({
        uri: parsed.href,
        multipleStatements: true,
        dateStrings: true,
      });
      const ddl = execFileSync(
        process.execPath,
        [
          "node_modules/drizzle-kit/bin.cjs",
          "export",
          "--dialect",
          "mysql",
          "--schema",
          "./drizzle/schema.ts",
        ],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
      );
      await connection.query(ddl.slice(ddl.indexOf("CREATE TABLE")));
      await applyTenantQueryScope(connection, "legacy");
      pool = mysql.createPool({
        uri: parsed.href,
        connectionLimit: 5,
        dateStrings: true,
      });
      a = createTenantDatabase(pool, "brand-a");
      b = createTenantDatabase(pool, "brand-b");
      for (const [index, db] of [a, b].entries()) {
        const [owner] = await db
          .insert(users)
          .values({
            name: `Owner ${index}`,
            email: "same@example.uz",
            passwordHash: "fixture",
            role: "admin",
          })
          .$returningId();
        const [agent] = await db
          .insert(agents)
          .values({ name: "Agent" })
          .$returningId();
        await db.insert(cashEntries).values({
          sourceKey: "cash",
          entryDate: new Date("2026-10-01T07:00:00Z"),
          type: "income",
          category: "Приход кег",
          cashAmount: 1000 + index,
          agentId: agent.id,
          createdBy: owner.id,
        });
        await db.insert(appSettings).values({
          key: "periodLockDate",
          value: "2025-01-01",
          updatedBy: owner.id,
        });
        if (index) ownerB = owner.id;
        else ownerA = owner.id;
      }
      dir = await mkdtemp(path.join(tmpdir(), "bc-brand-"));
      storeA = brandLogoStorageAt(path.join(dir, "a"));
      storeB = brandLogoStorageAt(path.join(dir, "b"));
    }, 30_000);
    afterAll(async () => {
      if (pool) await pool.end();
      if (connection) await connection.end();
      if (root) await root.end();
      if (dir) {
        const target = path.resolve(dir);
        if (
          path.dirname(target) !== path.resolve(tmpdir()) ||
          !path.basename(target).startsWith("bc-brand-")
        )
          throw Error("Unsafe fixture cleanup path");
        await rm(target, { recursive: true, force: true });
      }
    });
    it("reads defaults without writes and denies unauthorized/foreign-owner or tenant-spoofed updates", async () => {
      const before = await snapshotBusinessData(connection);
      expect((await readCompanyBranding(a)).revision).toBe(0);
      expect((await readCompanyBranding(b)).branding.name).toBe(
        "BiznesControl"
      );
      const input = {
        expectedRevision: 0,
        branding: fields,
        logo: { action: "keep" as const },
      };
      await expect(
        scope.run(a, () => caller(a, ownerA, "accountant").save(input))
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        scope.run(a, () =>
          caller(a, ownerA).save({ ...input, tenantId: "brand-b" } as never)
        )
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        saveCompanyBranding(a, input, ownerB, storeA)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await snapshotBusinessData(connection)).fingerprint).toBe(
        before.fingerprint
      );
    });
    it("persists independent names, logos and palettes without changing any financial/history rows", async () => {
      const before = nonSettings(await snapshotBusinessData(connection));
      const image = png(),
        request = {
          expectedRevision: 0,
          branding: fields,
          logo: {
            action: "replace" as const,
            base64: image.toString("base64"),
          },
        };
      const saved = await saveCompanyBranding(a, request, ownerA, storeA);
      expect((await readCompanyBranding(b)).revision).toBe(0);
      expect(
        await readFile(
          path.join(dir, "a", saved.branding.logoUrl!.replace("/uploads/", ""))
        )
      ).toEqual(image);
      await expect(
        readFile(
          path.join(dir, "b", saved.branding.logoUrl!.replace("/uploads/", ""))
        )
      ).rejects.toThrow();
      const other = await saveCompanyBranding(
        b,
        {
          ...request,
          branding: { ...fields, name: "Boshqa firma", color: "#7C3AED" },
        },
        ownerB,
        storeB
      );
      expect((await readCompanyBranding(a)).branding.name).toBe(fields.name);
      expect((await readCompanyBranding(b)).branding.name).toBe("Boshqa firma");
      expect(saved.branding.logoUrl).not.toBe(other.branding.logoUrl);
      for (const db of [a, b])
        expect(
          (await db.select().from(appSettings))
            .filter(row => !row.key.startsWith("company-brand."))
            .map(row => [row.key, row.value])
        ).toEqual([["periodLockDate", "2025-01-01"]]);
      const history = await a.select().from(auditLog);
      expect(history).toHaveLength(1);
      expect(history[0].tableName).toBe("company_branding");
      expect(history[0].afterData).toContain("Baraka savdo");
      expect(history[0].afterData).not.toContain("base64");
      expect(nonSettings(await snapshotBusinessData(connection))).toEqual(
        before
      );
      expect(
        (await scope.run(a, () => caller(a, ownerA, "accountant").get()))
          .branding
      ).toEqual(saved.branding);
    });
    it("lets an empty new firm choose its activity template after setting its visual identity", async () => {
      const db = createTenantDatabase(pool, "brand-onboard");
      const [owner] = await db
        .insert(users)
        .values({
          name: "New firm owner",
          email: "onboard@example.uz",
          passwordHash: "fixture",
          role: "admin",
        })
        .$returningId();
      const saved = await saveCompanyBranding(
        db,
        { expectedRevision: 0, branding: fields, logo: { action: "keep" } },
        owner.id,
        storeA
      );
      expect((await companyTemplateStatus(db, owner.id)).state).toBe(
        "eligible"
      );
      const before = nonSettings(await snapshotBusinessData(connection));
      await applyCompanyTemplate(db, "wholesale", randomUUID(), owner.id);
      expect(await readCompanyBranding(db)).toEqual(saved);
      expect((await companyTemplateStatus(db, owner.id)).state).toBe(
        "configured"
      );
      expect(nonSettings(await snapshotBusinessData(connection))).toEqual(
        before
      );
    });
    it("serializes concurrent saves, rejects stale revisions before uploading and cleans only a failed new file", async () => {
      const input = {
        expectedRevision: 1,
        branding: fields,
        logo: { action: "replace" as const, base64: png().toString("base64") },
      };
      const results = await Promise.allSettled([
        saveCompanyBranding(a, input, ownerA, storeA),
        saveCompanyBranding(
          a,
          { ...input, branding: { ...fields, name: "Other tab" } },
          ownerA,
          storeA
        ),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find(r => r.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
      const files = await readdir(path.join(dir, "a/branding"));
      expect(files).toHaveLength(2);
      const before = await readCompanyBranding(a);
      const broken: BrandLogoStorage = {
        put: async data => ({
          ...(await storeA.put(data)),
          url: "/uploads/invalid.png",
        }),
      };
      await expect(
        saveCompanyBranding(
          a,
          { ...input, expectedRevision: before.revision },
          ownerA,
          broken
        )
      ).rejects.toThrow();
      expect(await readdir(path.join(dir, "a/branding"))).toEqual(files);
      expect(await readCompanyBranding(a)).toEqual(before);
      await expect(
        saveCompanyBranding(
          a,
          { ...input, expectedRevision: before.revision },
          ownerA,
          {
            put: async () => {
              throw Error("EACCES C:/private/fixture");
            },
          }
        )
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Logotipni saqlab bo‘lmadi. Qayta urinib ko‘ring.",
      });
      const removed = await saveCompanyBranding(
        a,
        {
          expectedRevision: before.revision,
          branding: fields,
          logo: { action: "remove" },
        },
        ownerA,
        storeA
      );
      expect(removed.branding.logoUrl).toBeNull();
      expect(await readdir(path.join(dir, "a/branding"))).toEqual(files);
    });
  }
);
