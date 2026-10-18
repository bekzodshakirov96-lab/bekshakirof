import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

async function authFor(id?: string) {
  vi.resetModules();
  vi.stubEnv("TENANCY_MODE", id ? "isolated" : "legacy");
  vi.stubEnv("TENANT_ID", id ?? "");
  vi.stubEnv("TENANT_HOSTS", id ? `${id}.example.uz` : "");
  return import("./_core/localAuth");
}
afterEach(() => vi.unstubAllEnvs());
describe("company-bound sessions", () => {
  it("rejects another company's token even with the same secret and user ID", async () => {
    const alpha = await authFor("alpha");
    const alphaToken = await alpha.signSession(1, 0);
    const beta = await authFor("beta");
    const betaToken = await beta.signSession(1, 0);
    await expect(beta.verifySession(alphaToken)).resolves.toBeNull();
    await expect(alpha.verifySession(betaToken)).resolves.toBeNull();
    await expect(alpha.verifySession(alphaToken)).resolves.toEqual({ userId: 1, tokenVersion: 0 });
    await expect(beta.verifySession(betaToken)).resolves.toEqual({ userId: 1, tokenVersion: 0 });
  });
  it("accepts pre-conversion sessions only in the original legacy installation", async () => {
    const oldToken = await new SignJWT({ userId: 1, tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const legacy = await authFor();
    await expect(legacy.verifySession(oldToken)).resolves.toEqual({ userId: 1, tokenVersion: 0 });
    const converted = await authFor("legacy");
    await expect(converted.verifySession(oldToken)).resolves.toBeNull();
    const other = await authFor("beta");
    await expect(other.verifySession(oldToken)).resolves.toBeNull();
  });
});
