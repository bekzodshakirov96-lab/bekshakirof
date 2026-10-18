import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { platformHeaders } from "./headers";
import { createPlatformApi } from "./api";
import type { PlatformStore } from "./store";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
          server.closeAllConnections();
        })
    )
  );
});

describe("platform browser SSO headers", () => {
  it.each([false, true])(
    "preserves the form POST origin without disclosing page paths (production=%s)",
    async production => {
      const app = express();
      app.use(platformHeaders(production));
      const server = await new Promise<Server>(resolve => {
        const started = app.listen(0, "127.0.0.1", () => resolve(started));
      });
      servers.push(server);
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      app.use(
        "/api/platform",
        createPlatformApi(
          {} as PlatformStore,
          {
            origin: base,
            production,
            databaseUrl: "unused",
            mail: { mode: "local", apiKey: "", from: "", file: "unused" },
          },
          async () => {}
        )
      );
      app.get("/platforma", (_req, res) =>
        res.type("html").send("<h1>Firma kabineti</h1>")
      );
      const document = await fetch(`${base}/platforma`);
      // no-referrer turns native cross-origin form POST Origin into "null".
      // strict-origin sends only the origin and still suppresses HTTPS -> HTTP.
      expect(document.headers.get("referrer-policy")).toBe("strict-origin");
      expect(document.headers.get("x-content-type-options")).toBe("nosniff");
      expect(document.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      if (production) {
        expect(document.headers.get("content-security-policy")).toContain(
          "form-action 'self' https:"
        );
        expect(document.headers.get("strict-transport-security")).toBeTruthy();
      } else expect(document.headers.get("content-security-policy")).toBeNull();
      // API responses retain their stricter no-referrer policy; only the HTML
      // document's policy governs the browser's subsequent native form submit.
      const api = await fetch(`${base}/api/platform/me`);
      expect(api.status).toBe(200);
      expect(api.headers.get("referrer-policy")).toBe("no-referrer");
      expect(api.headers.get("cache-control")).toBe("no-store");
      expect(await api.json()).toEqual({ account: null, company: null });
    }
  );
});
