import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { permitsTenantHost, readRuntimeTenant, tenantUploadsDirectory } from "./config";
import { assertTenantDatabase } from "./database";
import { validateStorageKey } from "./files";

const alpha = readRuntimeTenant({ TENANCY_MODE: "isolated", TENANT_ID: "alpha", TENANT_HOSTS: "alpha.example.uz" });
describe("company deployment boundary", () => {
  it("preserves the original company's default configuration and upload paths", () => {
    const legacy = readRuntimeTenant({});
    expect(legacy).toMatchObject({ id: "legacy", mode: "legacy" });
    expect(tenantUploadsDirectory("./uploads", legacy)).toBe(path.resolve("./uploads"));
    expect(tenantUploadsDirectory("./uploads", alpha)).toBe(path.resolve("./uploads/tenants/alpha"));
  });
  it.each([
    { TENANT_ID: "alpha" },
    { TENANCY_MODE: "wrong" },
    { TENANCY_MODE: "isolated", TENANT_ID: "../beta", TENANT_HOSTS: "alpha.example.uz" },
    { TENANCY_MODE: "isolated", TENANT_ID: "alpha" },
    { TENANCY_MODE: "isolated", TENANT_ID: "alpha", TENANT_HOSTS: "*.example.uz" },
  ])("rejects ambiguous company settings: %j", env => expect(() => readRuntimeTenant(env)).toThrow());
  it("accepts only configured raw hostnames, including case/port normalization", () => {
    expect(permitsTenantHost("ALPHA.example.uz:443", alpha)).toBe(true);
    for (const host of [undefined, "beta.example.uz", "alpha.example.uz.evil.uz", "alpha.example.uz@evil.uz", "alpha.example.uz, beta.example.uz"]) {
      expect(permitsTenantHost(host, alpha)).toBe(false);
    }
  });
  it("requires a valid binding matching the configured company", async () => {
    const query = vi.fn().mockResolvedValue([[{ id: 1, tenantId: "alpha", bindingVersion: 1 }], []]);
    await expect(assertTenantDatabase({ query }, alpha)).resolves.toBeUndefined();
    query.mockResolvedValue([[{ id: 1, tenantId: "beta", bindingVersion: 1 }], []]);
    await expect(assertTenantDatabase({ query }, alpha)).rejects.toThrow("does not belong");
    query.mockResolvedValue([[], []]);
    await expect(assertTenantDatabase({ query }, alpha)).rejects.toThrow("invalid");
    query.mockRejectedValue(new Error("missing table"));
    await expect(assertTenantDatabase({ query }, alpha)).rejects.toThrow("not bound");
  });
  it("does not read or alter the legacy database during an ownership check", async () => {
    const query = vi.fn();
    await assertTenantDatabase({ query }, readRuntimeTenant({}));
    expect(query).not.toHaveBeenCalled();
  });
});

describe("tenant file boundary", () => {
  it("retains existing import keys", () => expect(validateStorageKey("imports/eski-fayl.xlsx")).toBe("imports/eski-fayl.xlsx"));
  it.each(["tenants/beta/file.xlsx", "TeNaNtS/beta/file.xlsx", "../beta/file", "imports/../tenants/beta", "imports\\..\\beta", "/etc/file", "C:/file", "imports/%2e%2e/file", ".. /file", "imports//file"])("blocks cross-company paths: %s", key => {
    expect(() => validateStorageKey(key)).toThrow();
  });
});
