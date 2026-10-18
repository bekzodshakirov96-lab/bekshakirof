import { statSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";

export const RELEASE_MAINTENANCE_FILE = ".bc-release-maintenance";

/** Operator-controlled admission gate. Does not touch the database or sessions. */
export function installReleaseMaintenance(app: Express, uploadsDirectory: string) {
  const marker = path.join(uploadsDirectory, RELEASE_MAINTENANCE_FILE);
  let activeRequests = 0;
  function paused() {
    try {
      statSync(marker);
      return true;
    } catch (error) {
      // Missing marker is normal. Filesystem errors must fail closed.
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }
  app.get("/api/release-health", (_req, res) => {
    const maintenance = paused();
    res.set("Cache-Control", "no-store").status(maintenance ? 503 : 200).json({
      ready: !maintenance,
      maintenance,
      activeRequests,
      revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    });
  });
  app.use((_req, res, next) => {
    if (paused()) {
      res.set("Cache-Control", "no-store").set("Retry-After", "60").status(503).json({
        error: "Texnik yangilash davom etmoqda. Birozdan keyin qayta urinib ko‘ring.",
        maintenance: true,
      });
      return;
    }
    activeRequests++;
    let counted = true;
    const finish = () => {
      if (!counted) return;
      counted = false;
      activeRequests--;
    };
    res.once("finish", finish);
    res.once("close", finish);
    next();
  });
}
