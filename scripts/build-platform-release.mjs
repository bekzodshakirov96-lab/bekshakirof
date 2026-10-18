import { execFileSync } from "node:child_process";
import { cp, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "temp", "platform-launch", "artifact");
// Build first. The upload directory is an allowlist: never copy .env, uploads,
// backups, local fixtures, business server entrypoint or source checkout.
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" }
);
buildSync({
  absWorkingDir: root,
  entryPoints: ["scripts/platform-ops.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
  outfile: "dist/platform-ops.js",
});
await mkdir(path.join(out, "dist"), { recursive: true });
for (const file of ["package.json", "package-lock.json"])
  await copyFile(path.join(root, file), path.join(out, file));
for (const file of ["platform.js", "platform-ops.js"])
  await copyFile(path.join(root, "dist", file), path.join(out, "dist", file));
await cp(path.join(root, "dist/public"), path.join(out, "dist/public"), {
  recursive: true,
});
await copyFile(
  path.join(root, "deploy/platform/Dockerfile"),
  path.join(out, "Dockerfile")
);
await copyFile(
  path.join(root, "deploy/platform/launch.mjs"),
  path.join(out, "launch.mjs")
);
await writeFile(
  path.join(out, "railway.json"),
  JSON.stringify({
    build: { builder: "DOCKERFILE" },
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
  })
);
console.log(`Platform-only upload prepared at ${out}`);
