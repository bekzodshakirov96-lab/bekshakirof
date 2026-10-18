import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { describe, it, expect } from "vitest";
import { installReleaseMaintenance, RELEASE_MAINTENANCE_FILE } from "./releaseMaintenance";

describe("release admission and draining", () => {
  it("blocks new reads/writes, observes active requests and resumes without resetting data", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "bc-release-"));
    const app = express();
    installReleaseMaintenance(app, directory);
    let writes = 0;
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    app.post("/write", (_req, res) => { writes++; res.json({ writes }); });
    app.get("/slow", async (_req, res) => {
      entered();
      await new Promise<void>(resolve => { release = resolve; });
      res.json({ ok: true });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      expect((await (await fetch(url + "/write", { method: "POST" })).json()).writes).toBe(1);
      const pending = fetch(url + "/slow");
      await ready;
      writeFileSync(path.join(directory, RELEASE_MAINTENANCE_FILE), "release");
      const health = await fetch(url + "/api/release-health");
      expect(health.status).toBe(503);
      expect(await health.json()).toMatchObject({ ready: false, maintenance: true, activeRequests: 1 });
      for (const method of ["GET", "POST"]) {
        const response = await fetch(url + "/write", { method });
        expect(response.status).toBe(503);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expect(writes).toBe(1);
      release(); await (await pending).text();
      expect(await (await fetch(url + "/api/release-health")).json()).toMatchObject({ activeRequests: 0, maintenance: true });
      rmSync(path.join(directory, RELEASE_MAINTENANCE_FILE));
      expect((await fetch(url + "/api/release-health")).status).toBe(200);
      expect((await (await fetch(url + "/write", { method: "POST" })).json()).writes).toBe(2);
    } finally {
      release?.(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
