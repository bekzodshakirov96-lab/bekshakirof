import express from "express";
import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { Server } from "node:http";
import { it, expect } from "vitest";
import { loginRateLimit, uploadAccess } from "./httpAccess";

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

it("counts standalone and mixed-batch password checks together and refuses duplicate logins", async () => {
  const t = initTRPC.create();
  let attempts = 0;
  const router = t.router({
    auth: t.router({ login: t.procedure.mutation(() => ({ attempt: ++attempts })) }),
    noop: t.procedure.mutation(() => ({ ok: true })),
  });
  const app = express();
  app.use(express.json());
  app.use("/api/trpc", loginRateLimit(2));
  app.use("/api/trpc", createExpressMiddleware({ router, createContext: () => ({}) }));
  const { base, server } = await listen(app);
  const post = (route: string) => fetch(`${base}/api/trpc/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  try {
    expect((await post("auth.login,auth.login?batch=1")).status).toBe(400);
    expect((await post("nested/auth%2Elogin%2Cauth.login?batch=1")).status).toBe(400);
    expect(attempts).toBe(0);
    expect((await post("auth.login")).status).toBe(200);
    expect((await post("noop,auth.login?batch=1")).status).toBe(200);
    expect(attempts).toBe(2);
    expect((await post("auth.login,noop?batch=1")).status).toBe(429);
    expect((await post("noop,auth%2Elogin?batch=1")).status).toBe(429);
    expect((await post("auth.login")).status).toBe(429);
    expect((await post("nested/auth.login")).status).toBe(429);
    expect((await post("nested/auth%2Elogin")).status).toBe(429);
    expect((await post("nested/noop%2Cauth%2Elogin?batch=1")).status).toBe(429);
    // Double encoding and encoded slashes are not valid aliases for login in
    // the adapter. They must not accidentally trigger a password check.
    expect((await post("auth%252Elogin")).status).toBe(404);
    expect((await post("nested%2Fauth.login")).status).toBe(404);
    expect(attempts).toBe(2);
    // Normal business API traffic is not charged to the login quota.
    expect((await post("noop")).status).toBe(200);
  } finally {
    await close(server);
  }
});

it("requires business roles for workbooks, keeps branding visible, and rejects invalid storage paths", async () => {
  const app = express();
  app.use("/uploads", uploadAccess(async req => {
    const role = req.headers["x-test-role"];
    return typeof role === "string" ? { role } : null;
  }));
  app.use("/uploads", (_req, res) => res.status(200).send("fixture file"));
  const { base, server } = await listen(app);
  const get = (path: string, role?: string) => fetch(base + "/uploads/" + path, {
    headers: role ? { "x-test-role": role } : {},
  });
  try {
    expect((await get("imports/fixture.xlsx")).status).toBe(401);
    expect((await get("branding/fixture.png")).status).toBe(401);
    for (const role of ["agent", "sklad", "user"]) {
      expect((await get("imports/fixture.xlsx", role)).status).toBe(403);
      expect((await get("%69mports/fixture.xlsx", role)).status).toBe(403);
      expect((await get("old-workbook.xlsm", role)).status).toBe(403);
      expect((await get("branding/fixture.png", role)).status).toBe(200);
    }
    for (const role of ["admin", "accountant"]) {
      expect((await get("imports/fixture.xlsx", role)).status).toBe(200);
      expect((await get("branding/fixture.png", role)).status).toBe(200);
      expect((await get("tenants/other/imports.xlsx", role)).status).toBe(404);
      expect((await get("branding/%2e%2e%2fimports/fixture.xlsx", role)).status).toBe(404);
      expect((await get("branding%5c..%5cimports%5cfixture.xlsx", role)).status).toBe(404);
    }
  } finally {
    await close(server);
  }
});
