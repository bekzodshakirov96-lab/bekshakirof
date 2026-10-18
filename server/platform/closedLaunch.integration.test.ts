import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { describe, it, expect } from "vitest";
import { PlatformStore, rows } from "./store";
import { inviteFirstAdmin } from "./adminBootstrap";
import { createPlatformApi } from "./api";
import { tokenHash } from "./security";
import type { PlatformConfig } from "./config";

const testUrl = process.env.TENANT_ISOLATION_TEST_URL;
describe.skipIf(!testUrl)("closed SaaS launch against disposable SQL", () => {
  it("blocks unavailable flows without writes and creates only one one-use admin invitation", async () => {
    const parsed = new URL(testUrl!);
    if (
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      !parsed.port ||
      parsed.port === "3306"
    )
      throw Error("Disposable loopback SQL only");
    const suffix = randomBytes(6).toString("hex");
    const schema = `closed_${suffix}`;
    const root = await mysql.createConnection(testUrl!);
    let store: PlatformStore | undefined;
    let server: Server | undefined;
    const dir = await mkdtemp(path.join(tmpdir(), "platform-invite-"));
    try {
      await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
      parsed.pathname = `/${schema}`;
      store = new PlatformStore(parsed.toString());
      await store.initialize();
      const config: PlatformConfig = {
        databaseUrl: parsed.toString(),
        origin: "http://127.0.0.1",
        production: false,
        registrationEnabled: false,
        mail: { mode: "disabled", apiKey: "", from: "", file: "unused" },
      };
      let mailCalls = 0;
      const app = express();
      app.use(
        "/api/platform",
        createPlatformApi(store, config, async () => {
          mailCalls++;
        })
      );
      server = await new Promise<Server>(resolve => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      config.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const post = (route: string, body: unknown) =>
        fetch(`${config.origin}/api/platform${route}`, {
          method: "POST",
          headers: {
            Origin: config.origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      const caps = await fetch(`${config.origin}/api/platform/capabilities`);
      expect(await caps.json()).toEqual({
        registrationEnabled: false,
        emailEnabled: false,
      });
      for (const route of ["/register", "/forgot", "/resend"])
        expect((await post(route, { email: "owner@example.uz" })).status).toBe(
          503
        );
      for (const table of [
        "platform_accounts",
        "platform_companies",
        "platform_tokens",
        "platform_events",
      ])
        expect(
          await rows(store.pool, `SELECT COUNT(*) n FROM ${table}`)
        ).toEqual([{ n: 0 }]);
      expect(mailCalls).toBe(0);
      const out = path.join(dir, "invite.env.local");
      await writeFile(out, "do not overwrite");
      await expect(
        inviteFirstAdmin(store, "admin@example.uz", config.origin, out)
      ).rejects.toThrow();
      expect(
        await rows(store.pool, "SELECT COUNT(*) n FROM platform_accounts")
      ).toEqual([{ n: 0 }]);
      const concurrent = await Promise.allSettled(
        [1, 2].map(n =>
          inviteFirstAdmin(
            store!,
            "ADMIN@example.uz",
            config.origin,
            path.join(dir, `invite${n}.env.local`)
          )
        )
      );
      expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const winner = concurrent.findIndex(r => r.status === "fulfilled") + 1;
      const saved = await readFile(
        path.join(dir, `invite${winner}.env.local`),
        "utf8"
      );
      const link = JSON.parse(saved.trim().split("=").slice(1).join("="));
      const token = new URL(link).hash.slice(1);
      const [ticket] = await rows<{ tokenHash: string; expiresAt: number }>(
        store.pool,
        "SELECT tokenHash,expiresAt FROM platform_tokens"
      );
      expect(ticket.tokenHash).toBe(tokenHash(token));
      expect(ticket.expiresAt - Date.now()).toBeGreaterThan(3_500_000);
      expect(ticket.expiresAt - Date.now()).toBeLessThanOrEqual(3_600_000);
      expect(
        await rows(store.pool, "SELECT email,role FROM platform_accounts")
      ).toEqual([{ email: "admin@example.uz", role: "super_admin" }]);
      expect(saved).not.toContain("password");
      expect((await post("/reset", { token, password: "seven77" })).status).toBe(400);
      const password = "eight888";
      expect((await post("/reset", { token, password })).status).toBe(200);
      expect((await post("/reset", { token, password })).status).toBe(400);
      const login = await post("/login", {
        email: "admin@example.uz",
        password,
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect(
        (
          await fetch(`${config.origin}/api/platform/admin/overview`, {
            headers: { Cookie: cookie },
          })
        ).status
      ).toBe(200);
      await expect(
        inviteFirstAdmin(
          store,
          "other@example.uz",
          config.origin,
          path.join(dir, "another.env.local")
        )
      ).rejects.toThrow("already exists");
    } finally {
      if (server)
        await new Promise<void>(resolve => server!.close(() => resolve()));
      if (store) await store.close();
      await root.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await root.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
