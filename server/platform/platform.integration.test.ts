import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import express from "express";
import mysql, { type Connection } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { PlatformStore, rows } from "./store";
import type { PlatformConfig } from "./config";
import { createPlatformApi } from "./api";
import { platformHeaders } from "./headers";
import { issueToken, newToken } from "./security";
import { prepareCompany, activateCompany } from "./provision";
import { snapshotBusinessData } from "../tenancy/audit";
import { companyAccess, type Company } from "../../shared/platform";

// Explicit disposable database only. Never reads .env or touches production.
const url = process.env.TENANT_ISOLATION_TEST_URL;
const suffix = randomBytes(6).toString("hex");
let store: PlatformStore;
let root: Connection;
let target: Connection;
let targetUrl: string;
let server: Server;
let base: string;
let ownerCookie: string;
let adminCookie: string;
let company: Company;
let runtimeKey: string;
let child: ChildProcess | undefined;
const mails: { email: string; kind: string; token: string }[] = [];
let requestId = 0;
const config: PlatformConfig = {
  databaseUrl: "",
  origin: "http://127.0.0.1",
  production: false,
  mail: { mode: "local", apiKey: "", from: "", file: "unused" },
};
const password = "a-long-test-password-2026";
async function request(
  path: string,
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {}
) {
  const response = await fetch(`${base}/api/platform${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      "X-Forwarded-For": `192.0.2.${++requestId % 250}`,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    response,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

describe.skipIf(!url)("platform control plane with real SQL/HTTP", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !parsed.port ||
      parsed.port === "3306"
    )
      throw new Error(
        "Use a disposable loopback MySQL server on a non-default port."
      );
    root = await mysql.createConnection({
      uri: url!,
      multipleStatements: true,
    });
    const schema = `bc_platform_${suffix}`;
    const user = `bp_${suffix}`;
    const pass = newToken();
    await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    await root.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [
      pass,
    ]);
    await root.query(`GRANT ALL ON \`${schema}\`.* TO '${user}'@'%'`);
    parsed.username = user;
    parsed.password = pass;
    parsed.pathname = `/${schema}`;
    store = new PlatformStore(parsed.toString());
    await store.initialize();
    await store.initialize(); // Repeatable initialization, no data changes.
    const app = express();
    app.set("trust proxy", 1);
    app.use(platformHeaders(config.production));
    app.use(
      "/api/platform",
      createPlatformApi(store, config, async (email, kind, token) => {
        mails.push({ email, kind, token });
      })
    );
    server = await new Promise<Server>(resolve => {
      const result = app.listen(0, "127.0.0.1", () => resolve(result));
    });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    config.origin = base;
    const adminId = randomUUID();
    await store.pool.query(
      "INSERT INTO platform_accounts (id,name,email,passwordHash,role,verifiedAt,createdAt) VALUES (?,'Super admin','admin@example.uz',?,'super_admin',?,?)",
      [adminId, await bcrypt.hash(password, 10), Date.now(), Date.now()]
    );
    adminCookie = `bc_platform_dev=${await issueToken(store.pool, adminId, "session", 3600000)}`;
    const targetSchema = `bc_empty_${suffix}`;
    const targetUser = `be_${suffix}`;
    await root.query(
      `CREATE DATABASE \`${targetSchema}\` CHARACTER SET utf8mb4`
    );
    await root.query(
      `CREATE USER '${targetUser}'@'%' IDENTIFIED BY ?`,
      [pass]
    );
    await root.query(
      `GRANT ALL ON \`${targetSchema}\`.* TO '${targetUser}'@'%'`
    );
    parsed.username = targetUser;
    parsed.pathname = `/${targetSchema}`;
    targetUrl = parsed.toString();
    target = await mysql.createConnection({
      uri: targetUrl,
      multipleStatements: true,
      dateStrings: true,
    });
    const exported = execFileSync(
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
    await target.query(exported.slice(exported.indexOf("CREATE TABLE")));
  }, 30_000);
  afterAll(async () => {
    child?.kill();
    if (server)
      await new Promise<void>(resolve => server.close(() => resolve()));
    if (target) await target.end();
    if (store) await store.close();
    if (root) await root.end();
  });
  it("creates one owner/company atomically and rejects browser privilege escalation, CSRF and collisions", async () => {
    const input = {
      name: "Test egasi",
      email: "owner@example.uz",
      password,
      companyName: "Baraka savdo",
      slug: `baraka-${suffix}`,
      phone: "+998901234567",
    };
    expect(
      (await request("/register", { ...input, role: "super_admin" })).response
        .status
    ).toBe(400);
    expect(
      (
        await request("/register", input, undefined, {
          Origin: "https://other.example.uz",
        })
      ).response.status
    ).toBe(403);
    const result = await request("/register", input);
    expect(result.response.status).toBe(201);
    expect(result.data.mailSent).toBe(true);
    ownerCookie = result.cookie!;
    expect(result.response.headers.get("set-cookie")).toContain("HttpOnly");
    const me = await request("/me", undefined, ownerCookie);
    expect(me.data.account.role).toBe("owner");
    company = me.data.company;
    expect(company.state).toBe("pending_email");
    expect(company.trialStart).toBeNull();
    const repeat = await request("/register", input);
    expect(repeat.response.status).toBe(409);
    expect(
      await rows(store.pool, "SELECT id FROM platform_companies")
    ).toHaveLength(1);
  });
  it("keeps platform admin and company accounts separate, including ordinary company JWTs", async () => {
    expect((await request("/admin/companies")).response.status).toBe(401);
    expect(
      (await request("/admin/companies", undefined, ownerCookie)).response
        .status
    ).toBe(403);
    expect(
      (
        await request(
          "/admin/companies",
          undefined,
          "app_session_id=fake-business-jwt"
        )
      ).response.status
    ).toBe(401);
    const login = await request("/login", {
      email: "admin@example.uz",
      password,
    });
    expect(login.response.status).toBe(200);
    expect(
      (await request("/admin/companies", undefined, login.cookie)).response
        .status
    ).toBe(200);
    expect(
      (await request(`/companies/${company.id}/launch`, {}, adminCookie))
        .response.status
    ).toBe(404);
  });
  it("verifies email once, does not start trial until provisioning, and rejects cross-database access", async () => {
    const verify = mails.find(mail => mail.kind === "verify")!;
    const rawTokens = await rows<{ tokenHash: string }>(
      store.pool,
      "SELECT tokenHash FROM platform_tokens"
    );
    expect(rawTokens.some(row => row.tokenHash === verify.token)).toBe(false);
    expect(
      (await request("/verify", { token: verify.token })).response.status
    ).toBe(200);
    expect(
      (await request("/verify", { token: verify.token })).response.status
    ).toBe(400);
    company = (await request("/me", undefined, ownerCookie)).data.company;
    expect(company.state).toBe("provisioning");
    expect(company.trialStart).toBeNull();
    const [db] = await rows<{ name: string }>(
      store.pool,
      "SELECT DATABASE() name"
    );
    await expect(
      target.query(`SELECT * FROM \`${db.name}\`.platform_accounts`)
    ).rejects.toMatchObject({ errno: 1142 });
  });
  it("provisions only a complete empty company schema; never copies legacy data or resets trial", async () => {
    await target.query("INSERT INTO agents (name) VALUES ('Existing history')");
    const baseline = await snapshotBusinessData(target);
    await expect(
      prepareCompany(store, company.id, target, "http://127.0.0.1:43191", false)
    ).rejects.toThrow("existing business");
    expect(await snapshotBusinessData(target)).toEqual(baseline);
    // Remove only this explicitly created fixture row in the disposable empty schema.
    await target.query("DELETE FROM agents WHERE name='Existing history'");
    const prepared = await prepareCompany(
      store,
      company.id,
      target,
      "http://127.0.0.1:43191",
      false
    );
    runtimeKey = prepared.runtimeKey;
    await activateCompany(store, prepared);
    const current = (await store.company(company.id))!;
    expect(current.state).toBe("ready");
    expect(current.trialStart).toBeGreaterThan(0);
    expect(current.accessUntil).toBe(current.trialEnd);
    expect(
      (
        await rows<{ id: number; email: string }>(
          target,
          "SELECT id,email FROM users"
        )
      )[0]
    ).toMatchObject({ id: 1, email: "owner@example.uz" });
    await expect(activateCompany(store, prepared)).rejects.toThrow(
      "qayta boshlash"
    );
    await expect(
      prepareCompany(store, company.id, target, "http://127.0.0.1:43191", false)
    ).rejects.toThrow("awaiting provisioning");
    company = current;
  }, 15_000);
  it("suspends/resumes and extends access with audit, concurrency checks and no financial writes", async () => {
    const before = await snapshotBusinessData(target);
    expect(
      (
        await request(
          `/admin/companies/${company.id}`,
          { action: "suspend", revision: company.revision, reason: "" },
          adminCookie
        )
      ).response.status
    ).toBe(400);
    expect(
      (
        await request(
          `/admin/companies/${company.id}`,
          {
            action: "suspend",
            revision: company.revision,
            reason: "Sinov tekshiruvi",
          },
          ownerCookie
        )
      ).response.status
    ).toBe(403);
    const result = await request(
      `/admin/companies/${company.id}`,
      {
        action: "suspend",
        revision: company.revision,
        reason: "Sinov tekshiruvi",
      },
      adminCookie
    );
    expect(result.response.status).toBe(200);
    expect(
      (
        await request(
          `/runtime/access?tenantId=${company.slug}`,
          undefined,
          undefined,
          { Authorization: `Bearer ${runtimeKey}` }
        )
      ).data.allowed
    ).toBe(false);
    expect(
      (
        await request(
          `/admin/companies/${company.id}`,
          {
            action: "resume",
            revision: company.revision,
            reason: "Eskirgan oynadan",
          },
          adminCookie
        )
      ).response.status
    ).toBe(409);
    company = (await store.company(company.id))!;
    expect(
      (
        await request(
          `/admin/companies/${company.id}`,
          {
            action: "resume",
            revision: company.revision,
            reason: "Tekshiruv tugadi",
          },
          adminCookie
        )
      ).response.status
    ).toBe(200);
    company = (await store.company(company.id))!;
    const trial = company.trialEnd;
    await request(
      `/admin/companies/${company.id}`,
      {
        action: "extend",
        revision: company.revision,
        reason: "Pilot uchun muddat",
        days: 7,
      },
      adminCookie
    );
    company = (await store.company(company.id))!;
    expect(company.trialEnd).toBe(trial);
    expect(company.accessUntil).toBe(trial! + 7 * 86400000);
    expect(await snapshotBusinessData(target)).toEqual(before);
    const detail = await request(
      `/admin/companies/${company.id}`,
      undefined,
      adminCookie
    );
    expect(
      detail.data.events.map((event: { action: string }) => event.action)
    ).toEqual(
      expect.arrayContaining([
        "registered",
        "email_verified",
        "provisioned",
        "suspend",
        "resume",
        "extend",
      ])
    );
    expect(JSON.stringify(detail.data)).not.toContain(runtimeKey);
  });
  it("filters firms and computes trial/expired stats independently, with no key/password leakage", async () => {
    const list = await request(
      "/admin/companies?q=Baraka&state=trialing&page=1",
      undefined,
      adminCookie
    );
    expect(list.data.total).toBe(1);
    expect(list.data.companies).toHaveLength(1);
    expect(JSON.stringify(list.data)).not.toMatch(
      /passwordHash|runtimeKeyHash/
    );
    expect(
      (await request("/admin/companies?q=absent", undefined, adminCookie)).data
        .total
    ).toBe(0);
    expect(
      (await request("/admin/companies?q=%25", undefined, adminCookie)).data
        .total
    ).toBe(0);
  });
  it("protects admin overview/activity and calculates real counts, expiry queue and sorted filters", async () => {
    for (const path of ["/admin/overview", "/admin/events"]) {
      expect((await request(path)).response.status).toBe(401);
      expect(
        (await request(path, undefined, ownerCookie)).response.status
      ).toBe(403);
    }
    const now = Date.now();
    const day = 86400000;
    const fixtures = [
      {
        name: "Alpha",
        state: "ready",
        end: now + 2 * day,
        trial: now + 2 * day,
      },
      { name: "Beta", state: "ready", end: now + 8 * day, trial: now - day },
      { name: "Gamma", state: "ready", end: now - day, trial: now - day },
      { name: "Delta", state: "suspended", end: now + day, trial: now + day },
      { name: "Epsilon", state: "provisioning", end: null, trial: null },
      { name: "Zeta", state: "pending_email", end: null, trial: null },
    ];
    const ids: string[] = [];
    for (const [index, fixture] of fixtures.entries()) {
      const owner = randomUUID();
      const id = randomUUID();
      ids.push(id);
      await store.pool.query(
        "INSERT INTO platform_accounts (id,name,email,passwordHash,role,createdAt) VALUES (?,'Overview fixture',?,'not-a-login','owner',?)",
        [owner, `${id}@example.test`, now]
      );
      await store.pool.query(
        "INSERT INTO platform_companies (id,name,slug,ownerId,phone,state,trialEnd,accessUntil,createdAt) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          id,
          `Overview ${fixture.name}`,
          `overview-${id}`,
          owner,
          "",
          fixture.state,
          fixture.trial,
          fixture.end,
          now - index * 1000,
        ]
      );
    }
    const overview = await request("/admin/overview", undefined, adminCookie);
    expect(overview.response.status).toBe(200);
    const all = await rows<Company>(
      store.pool,
      "SELECT * FROM platform_companies"
    );
    const expected: Record<string, number> = {};
    for (const row of all) {
      const state = companyAccess(row, overview.data.asOf);
      expected[state] = (expected[state] ?? 0) + 1;
    }
    expect(
      Object.fromEntries(
        overview.data.stats.map((item: { state: string; total: number }) => [
          item.state,
          item.total,
        ])
      )
    ).toEqual(expected);
    expect(overview.data.expiring.map((row: Company) => row.id)).toEqual([
      ids[0],
    ]);
    expect(overview.data.expiringTotal).toBe(1);
    expect(overview.data.recent.length).toBeLessThanOrEqual(5);
    expect(overview.data.registeredThisMonth).toBe(all.length);
    const expiry = await request(
      "/admin/companies?q=Overview&expiring=true",
      undefined,
      adminCookie
    );
    expect(expiry.data.total).toBe(1);
    expect(expiry.data.companies[0].id).toBe(ids[0]);
    const filtered = await request(
      "/admin/companies?q=Overview&expiring=true&state=suspended",
      undefined,
      adminCookie
    );
    expect(filtered.data.total).toBe(0);
    for (const [sort, expectedOrder] of [
      ["name", [0, 1, 3, 4, 2, 5]],
      ["oldest", [5, 4, 3, 2, 1, 0]],
      ["newest", [0, 1, 2, 3, 4, 5]],
      ["deadline", [2, 3, 0, 1, 4, 5]],
    ] as const) {
      const list = await request(
        `/admin/companies?q=Overview&sort=${sort}`,
        undefined,
        adminCookie
      );
      if (sort === "deadline") {
        expect(
          list.data.companies.slice(0, 4).map((row: Company) => row.id)
        ).toEqual(expectedOrder.slice(0, 4).map(index => ids[index]));
        expect(
          list.data.companies
            .slice(4)
            .every((row: Company) => row.accessUntil === null)
        ).toBe(true);
      } else
        expect(list.data.companies.map((row: Company) => row.id)).toEqual(
          expectedOrder.map(index => ids[index])
        );
    }
    const activity = await request("/admin/events", undefined, adminCookie);
    expect(activity.response.status).toBe(200);
    expect(activity.data.events.length).toBeGreaterThan(0);
    expect(activity.data.events.length).toBeLessThanOrEqual(25);
    expect(
      activity.data.events.every(
        (item: { id: number }, index: number, items: { id: number }[]) =>
          !index || items[index - 1].id > item.id
      )
    ).toBe(true);
    expect(
      (await request("/admin/events?page=100000", undefined, adminCookie)).data
        .events
    ).toEqual([]);
    expect(
      JSON.stringify([overview.data, activity.data, expiry.data])
    ).not.toMatch(/passwordHash|runtimeKeyHash|tokenHash|actorId/);
    expect(JSON.stringify([overview.data, activity.data])).not.toContain(
      runtimeKey
    );
    for (const path of [
      "/admin/companies?sort=invalid",
      "/admin/companies?expiring=invalid",
      "/admin/events?page=0",
    ]) {
      expect(
        (await request(path, undefined, adminCookie)).response.status
      ).toBe(400);
    }
  });
  it("uses one-use, tenant-scoped login tickets and denies wrong runtime credentials", async () => {
    const launch = await request(
      `/companies/${company.id}/launch`,
      {},
      ownerCookie
    );
    expect(launch.response.status).toBe(200);
    const body = { tenantId: company.slug, token: launch.data.token };
    expect(
      (
        await request("/runtime/redeem", body, undefined, {
          Authorization: `Bearer ${newToken()}`,
        })
      ).response.status
    ).toBe(401);
    expect(
      (
        await request(
          "/runtime/redeem",
          { ...body, tenantId: "another-company" },
          undefined,
          { Authorization: `Bearer ${runtimeKey}` }
        )
      ).response.status
    ).toBe(401);
    const redeemed = await request("/runtime/redeem", body, undefined, {
      Authorization: `Bearer ${runtimeKey}`,
    });
    expect(redeemed.data).toEqual({
      email: "owner@example.uz",
      tenantId: company.slug,
    });
    expect(
      (
        await request("/runtime/redeem", body, undefined, {
          Authorization: `Bearer ${runtimeKey}`,
        })
      ).response.status
    ).toBe(401);
  });
  it("reset revokes sessions and outstanding launch tokens; logout revokes copied cookies", async () => {
    await request("/forgot", { email: "owner@example.uz" });
    const reset = mails.find(mail => mail.kind === "reset")!;
    const launch = await request(
      `/companies/${company.id}/launch`,
      {},
      ownerCookie
    );
    expect(
      (
        await request("/reset", {
          token: reset.token,
          password: "new-private-password-2026",
        })
      ).response.status
    ).toBe(200);
    expect(
      (await request("/me", undefined, ownerCookie)).data.account
    ).toBeNull();
    expect(
      (
        await request(
          "/runtime/redeem",
          { tenantId: company.slug, token: launch.data.token },
          undefined,
          { Authorization: `Bearer ${runtimeKey}` }
        )
      ).response.status
    ).toBe(401);
    expect(
      (await request("/reset", { token: reset.token, password })).response
        .status
    ).toBe(400);
    const login = await request("/login", {
      email: "owner@example.uz",
      password: "new-private-password-2026",
    });
    ownerCookie = login.cookie!;
    expect((await request("/logout", {}, ownerCookie)).response.status).toBe(
      200
    );
    expect(
      (await request("/me", undefined, ownerCookie)).data.account
    ).toBeNull();
    ownerCookie = (
      await request("/login", {
        email: "owner@example.uz",
        password: "new-private-password-2026",
      })
    ).cookie!;
  });
  it("completes actual business-runtime SSO and blocks its API when firm access is suspended", async () => {
    const port = await new Promise<number>(resolve => {
      const probe = createNetServer().listen(0, "127.0.0.1", () => {
        const port = (probe.address() as { port: number }).port;
        probe.close(() => resolve(port));
      });
    });
    const businessOrigin = `http://127.0.0.1:${port}`;
    await store.pool.query(
      "UPDATE platform_companies SET origin=? WHERE id=?",
      [businessOrigin, company.id]
    );
    child = spawn(
      process.execPath,
      ["--import", "tsx", "server/_core/index.ts"],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: targetUrl,
          TENANCY_MODE: "isolated",
          TENANT_ID: company.slug,
          TENANT_HOSTS: "127.0.0.1",
          PORT: String(port),
          JWT_SECRET: newToken(),
          PLATFORM_MANAGED: "true",
          PLATFORM_CONTROL_URL: base,
          PLATFORM_RUNTIME_KEY: runtimeKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Business startup timed out")),
        20_000
      );
      child!.stdout!.on("data", data => {
        if (String(data).includes("Server running")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child!.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Business startup failed"));
      });
    });
    const launch = await request(
      `/companies/${company.id}/launch`,
      {},
      ownerCookie
    );
    const beforeSso = await snapshotBusinessData(target);
    // Browser-origin protection must remain strict; rejected requests must not
    // redeem the valid ticket or set a business session cookie.
    for (const origin of [undefined, "null", "https://untrusted.example"]) {
      const rejected = await fetch(`${businessOrigin}/api/platform/sso`, {
        method: "POST",
        redirect: "manual",
        headers: {
          ...(origin ? { Origin: origin } : {}),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: launch.data.token }),
      });
      expect(rejected.status).toBe(403);
      expect(rejected.headers.get("set-cookie")).toBeNull();
      expect(await rejected.text()).toBe("Platformadan qayta kiring.");
    }
    const ssoRequest = {
      method: "POST",
      redirect: "manual" as const,
      headers: {
        Origin: base,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: launch.data.token }),
    };
    const sso = await fetch(`${businessOrigin}/api/platform/sso`, ssoRequest);
    expect(sso.status).toBe(303);
    expect(sso.headers.get("location")).toBe("/");
    expect(await snapshotBusinessData(target)).toEqual(beforeSso);
    const replay = await fetch(
      `${businessOrigin}/api/platform/sso`,
      ssoRequest
    );
    expect(replay.status).toBe(403);
    expect(replay.headers.get("set-cookie")).toBeNull();
    const businessCookie = sso.headers.get("set-cookie")!.split(";")[0];
    const auth = await fetch(`${businessOrigin}/api/trpc/auth.me`, {
      headers: { Cookie: businessCookie },
    });
    expect(auth.status).toBe(200);
    expect(JSON.stringify(await auth.json())).toContain("owner@example.uz");
    const changeOwner = await fetch(`${businessOrigin}/api/trpc/users.update`, {
      method: "POST",
      headers: { Cookie: businessCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { id: 1, name: "Egasi", email: "another@example.uz" },
      }),
    });
    expect(changeOwner.status).toBe(400);
    expect(JSON.stringify(await changeOwner.json())).toContain(
      "platforma hisobiga"
    );
    company = (await store.company(company.id))!;
    await request(
      `/admin/companies/${company.id}`,
      {
        action: "suspend",
        revision: company.revision,
        reason: "Runtime gate tekshiruvi",
      },
      adminCookie
    );
    // Wait the documented maximum 15-second entitlement cache lifetime.
    await new Promise(resolve => setTimeout(resolve, 15_100));
    expect(
      (
        await fetch(`${businessOrigin}/api/trpc/auth.me`, {
          headers: { Cookie: businessCookie },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${businessOrigin}/uploads/example.xlsx`, {
          headers: { Cookie: businessCookie },
        })
      ).status
    ).toBe(403);
  }, 35_000);
});
