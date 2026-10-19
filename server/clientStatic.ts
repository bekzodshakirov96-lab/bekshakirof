import express, { type Express } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION_PATH, parseAppVersion } from "../shared/appVersion";

/** Public build metadata contains no company or user information. */
export function installClientStatic(app: Express, directory: string) {
  const root = path.resolve(directory);
  app.get(APP_VERSION_PATH, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const version = parseAppVersion(
        JSON.parse(await readFile(path.join(root, "app-version.json"), "utf8"))
      );
      if (!version) throw new Error("Invalid build manifest");
      res.json(version);
    } catch {
      // Never turn a missing manifest into SPA HTML or expose filesystem paths.
      res.status(404).json({ error: "Versiya ma’lumoti mavjud emas." });
    }
  });
  app.use(
    express.static(root, {
      setHeaders(res, file) {
        if (path.basename(file) === "index.html")
          res.setHeader("Cache-Control", "no-store");
      },
    })
  );
  app.use("*", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .sendFile(path.join(root, "index.html"));
  });
}
