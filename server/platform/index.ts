import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { readPlatformConfig } from "./config";
import { PlatformStore } from "./store";
import { createPlatformApi } from "./api";
import { mailSender } from "./mail";
import { platformHeaders } from "./headers";

async function start() {
  const config = readPlatformConfig();
  const store = new PlatformStore(config.databaseUrl);
  try {
    await store.assertReady();
  } catch {
    await store.close();
    throw new Error(
      "Platform schema unavailable. Initialize a dedicated platform database first."
    );
  }
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.use(platformHeaders(config.production));
  app.use((req, res, next) => {
    if (req.headers.host !== new URL(config.origin).host) {
      res.status(421).end();
      return;
    }
    next();
  });
  app.get("/api/runtime", (_req, res) => res.json({ mode: "platform" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.redirect(302, "/platforma"));
  app.use(
    "/api/platform",
    createPlatformApi(store, config, mailSender(config))
  );
  // No tenant API, uploads or access to the business database in this process.
  app.use(["/api", "/uploads"], (_req, res) => {
    res.status(404).json({ error: "Manzil topilmadi." });
  });
  if (!config.production) process.env.PLATFORM_SERVER = "true";
  const { setupVite, serveStatic } = await import("../_core/vite");
  if (!config.production) await setupVite(app, server);
  else serveStatic(app);
  server.listen(Number(process.env.PORT || "4180"), "0.0.0.0", () =>
    console.log(`Platform ready at ${config.origin}/super-admin`)
  );
  const close = () => {
    server.close(() => {
      void store.close().then(() => process.exit(0));
    });
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
start().catch(() => {
  console.error(
    "[Platform] Startup refused. Check separate database, origin, schema and mail configuration."
  );
  process.exitCode = 1;
});
