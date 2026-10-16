import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());
it("keeps original uploads readable and company uploads in separate filesystem roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bc-tenant-files-"));
  const base = path.join(root, "uploads");
  await mkdir(path.join(base, "imports"), { recursive: true });
  await writeFile(path.join(base, "imports", "old.xlsx"), "original business file");
  async function storage(id: string) {
    vi.resetModules();
    vi.stubEnv("TENANCY_MODE", "isolated"); vi.stubEnv("TENANT_ID", id);
    vi.stubEnv("TENANT_HOSTS", `${id}.example.uz`); vi.stubEnv("UPLOADS_DIR", base);
    return import("../storage");
  }
  const legacy = await storage("legacy");
  expect(await legacy.storageGet("imports/old.xlsx")).toEqual({ key: "imports/old.xlsx", url: "/uploads/imports/old.xlsx" });
  expect(await readFile(path.join(legacy.UPLOADS_DIR, "imports/old.xlsx"), "utf8")).toBe("original business file");
  const alpha = await storage("alpha");
  const beta = await storage("beta");
  const a = await alpha.storagePut("imports/new.xlsx", "alpha only");
  const b = await beta.storagePut("imports/new.xlsx", "beta only");
  expect(await readFile(path.join(alpha.UPLOADS_DIR, a.key), "utf8")).toBe("alpha only");
  expect(await readFile(path.join(beta.UPLOADS_DIR, b.key), "utf8")).toBe("beta only");
  await expect(readFile(path.join(beta.UPLOADS_DIR, a.key))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(legacy.storageGet(`tenants/alpha/${a.key}`)).rejects.toThrow("Invalid storage key");
  await expect(alpha.storageGet(`../beta/${b.key}`)).rejects.toThrow("Invalid storage key");
  expect(await readFile(path.join(base, "imports/old.xlsx"), "utf8")).toBe("original business file");
});
