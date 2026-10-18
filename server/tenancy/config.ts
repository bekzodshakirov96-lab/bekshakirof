import path from "node:path";
import { COOKIE_NAME } from "../../shared/const";

export type RuntimeTenant = Readonly<{
  mode: "legacy" | "isolated";
  id: string;
  hosts: readonly string[];
}>;

/** One process serves exactly one company. Never select a database from a request. */
export function readRuntimeTenant(env: Record<string, string | undefined>): RuntimeTenant {
  const mode = env.TENANCY_MODE ?? "legacy";
  if (mode !== "legacy" && mode !== "isolated") throw new Error("TENANCY_MODE must be legacy or isolated.");
  if (mode === "legacy") {
    if (env.TENANT_ID || env.TENANT_HOSTS) throw new Error("TENANT_ID/TENANT_HOSTS require TENANCY_MODE=isolated.");
    return Object.freeze({ mode, id: "legacy", hosts: Object.freeze([]) });
  }
  const id = env.TENANT_ID ?? "";
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(id)) throw new Error("TENANT_ID must be a lowercase company slug (2–63 characters).");
  const hosts = (env.TENANT_HOSTS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length || hosts.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host))) {
    throw new Error("TENANT_HOSTS must list exact hostnames, without scheme, port, path or wildcard.");
  }
  return Object.freeze({ mode, id, hosts: Object.freeze(Array.from(new Set(hosts))) });
}

export const runtimeTenant = readRuntimeTenant(process.env);
export const SESSION_COOKIE_NAME = runtimeTenant.id === "legacy" ? COOKIE_NAME : `${COOKIE_NAME}_${runtimeTenant.id}`;
export const sessionIssuer = `urn:biznescontrol:tenant:${runtimeTenant.id}`;
export const SESSION_AUDIENCE = "biznescontrol-business";

export function tenantUploadsDirectory(base: string, tenant: RuntimeTenant) {
  // The original company's existing file URLs and volume remain valid.
  return tenant.id === "legacy" ? path.resolve(base) : path.resolve(base, "tenants", tenant.id);
}

export function permitsTenantHost(hostHeader: string | undefined, tenant: RuntimeTenant): boolean {
  if (tenant.mode === "legacy") return true;
  if (!hostHeader || !/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(hostHeader)) return false;
  return tenant.hosts.includes(hostHeader.split(":")[0].toLowerCase());
}
