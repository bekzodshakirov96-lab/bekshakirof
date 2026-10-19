import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { expect, it } from "vitest";
import { installClientStatic } from "./clientStatic";
import {
  installReleaseMaintenance,
  RELEASE_MAINTENANCE_FILE,
} from "./releaseMaintenance";

it("serves fresh public metadata/HTML for both runtimes, without SPA fallback on a missing manifest", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-client-version-"));
  const app = express();
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "index.html"), "<html>app shell</html>");
  writeFileSync(
    path.join(directory, "assets", "app-123.js"),
    "console.log('app')"
  );
  writeFileSync(
    path.join(directory, "app-version.json"),
    JSON.stringify({ schema: 1, buildId: "release-a-123" })
  );
  installReleaseMaintenance(app, directory);
  installClientStatic(app, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const initial = await fetch(base + "/app-version.json");
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toEqual({
      schema: 1,
      buildId: "release-a-123",
    });
    writeFileSync(
      path.join(directory, "app-version.json"),
      JSON.stringify({
        schema: 1,
        buildId: "release-b-456",
        privateField: "not exposed",
      })
    );
    expect(await (await fetch(base + "/app-version.json")).json()).toEqual({
      schema: 1,
      buildId: "release-b-456",
    });
    for (const route of [
      "/",
      "/kassa",
      "/platforma",
      "/super-admin/firmalar",
    ]) {
      const response = await fetch(base + route);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain("app shell");
    }
    expect((await fetch(base + "/assets/app-123.js")).status).toBe(200);
    rmSync(path.join(directory, "app-version.json"));
    const missing = await fetch(base + "/app-version.json");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
    expect(await missing.text()).not.toContain(directory);
    writeFileSync(path.join(directory, "app-version.json"), "not JSON");
    expect((await fetch(base + "/app-version.json")).status).toBe(404);
    writeFileSync(path.join(directory, RELEASE_MAINTENANCE_FILE), "test");
    const paused = await fetch(base + "/app-version.json");
    expect(paused.status).toBe(503);
    expect(await paused.json()).toMatchObject({ maintenance: true });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("bc-client-version-")
    )
      throw new Error("Unsafe test cleanup target");
    rmSync(target, { recursive: true, force: true });
  }
});
