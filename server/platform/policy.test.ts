import { describe, it, expect, vi } from "vitest";
import {
  companyAccess,
  trialEndAfterMonth,
  type Company,
} from "../../shared/platform";
import { checkedOrigin, readPlatformConfig } from "./config";
import {
  readManagedConfig,
  platformAccessClient,
} from "../tenancy/platformAccess";

describe("SaaS calendar trial and access", () => {
  it.each([
    ["2026-01-31T23:00:00+05:00", "2026-02-28T23:00:00+05:00"],
    ["2028-01-31T12:00:00+05:00", "2028-02-29T12:00:00+05:00"],
    ["2026-12-31T00:00:00+05:00", "2027-01-31T00:00:00+05:00"],
    ["2026-08-30T00:30:00+05:00", "2026-09-30T00:30:00+05:00"],
  ])("uses a clamped business calendar month %s", (start, end) => {
    expect(trialEndAfterMonth(Date.parse(start))).toBe(Date.parse(end));
  });
  it("checks exact expiry and keeps suspension above remaining access", () => {
    const company = {
      state: "ready",
      accessUntil: 200,
      trialEnd: 100,
    } as Company;
    expect(companyAccess(company, 99)).toBe("trialing");
    expect(companyAccess(company, 100)).toBe("extended");
    expect(companyAccess(company, 200)).toBe("expired");
    expect(companyAccess({ ...company, state: "suspended" }, 0)).toBe(
      "suspended"
    );
  });
});
describe("separate platform configuration", () => {
  const base = {
    PLATFORM_DATABASE_URL: "mysql://platform:private@localhost/saas",
    PLATFORM_MAIL_MODE: "local",
    PLATFORM_ORIGIN: "http://localhost:4180",
  };
  it("allows a closed production launch without inventing email credentials", () => {
    const closed = {
      ...base,
      NODE_ENV: "production",
      PLATFORM_ORIGIN: "https://platform.example.uz",
      PLATFORM_MAIL_MODE: "disabled",
      PLATFORM_REGISTRATION_ENABLED: "false",
    };
    expect(readPlatformConfig(closed)).toMatchObject({
      registrationEnabled: false,
      mail: { mode: "disabled" },
      billing: { mode: "off" },
    });
    expect(() =>
      readPlatformConfig({ ...closed, PLATFORM_REGISTRATION_ENABLED: "true" })
    ).toThrow("explicitly");
    expect(() =>
      readPlatformConfig({ ...closed, PLATFORM_REGISTRATION_ENABLED: "FALSE" })
    ).toThrow("true or false");
    expect(() =>
      readPlatformConfig({ ...closed, PLATFORM_MAIL_MODE: "resend" })
    ).toThrow("delivery");
  });
  it("never accepts the current business database or local production mail", () => {
    expect(() =>
      readPlatformConfig({
        ...base,
        DATABASE_URL: "mysql://other:private@localhost/saas",
      })
    ).toThrow("different");
    expect(() =>
      readPlatformConfig({ ...base, NODE_ENV: "production" })
    ).toThrow("production");
    expect(() =>
      readPlatformConfig({ ...base, PLATFORM_DATABASE_URL: "" })
    ).toThrow("required");
  });
  it.each([
    "http://example.uz",
    "https://example.uz/path",
    "https://user:secret@example.uz",
    "https://example.uz/?q=1",
  ])("rejects unsafe origins %s", value => {
    expect(() => checkedOrigin(value, true)).toThrow();
  });
  it("does not accidentally enroll the existing firm in trial restrictions", () => {
    expect(
      readManagedConfig({}, { mode: "legacy", id: "legacy", hosts: [] })
    ).toBeNull();
    expect(() =>
      readManagedConfig(
        { PLATFORM_MANAGED: "true" },
        { mode: "legacy", id: "legacy", hosts: [] }
      )
    ).toThrow();
    expect(() =>
      readManagedConfig(
        { PLATFORM_MANAGED: "true" },
        { mode: "isolated", id: "legacy", hosts: [] }
      )
    ).toThrow();
  });
});
describe("managed runtime access", () => {
  it("fails closed, bounds the suspension delay, and respects exact expiry", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      let allowed = true;
      const request = vi.fn(
        async () =>
          new Response(JSON.stringify({ allowed, accessUntil: now + 20_000 }))
      );
      const client = platformAccessClient(
        {
          origin: "https://saas.example.uz",
          tenantId: "company-a",
          key: "private",
        },
        request as typeof fetch
      );
      expect(await client.allowed()).toBe(true);
      allowed = false;
      vi.advanceTimersByTime(15_001);
      expect(await client.allowed()).toBe(false);
      expect(request).toHaveBeenCalledTimes(2);
      const failing = platformAccessClient(
        {
          origin: "https://saas.example.uz",
          tenantId: "company-a",
          key: "private",
        },
        vi.fn().mockRejectedValue(new Error("offline"))
      );
      expect(await failing.allowed()).toBe(false);
      const expired = platformAccessClient(
        {
          origin: "https://saas.example.uz",
          tenantId: "company-a",
          key: "private",
        },
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ allowed: true, accessUntil: now - 1 })
            )
          )
      );
      expect(await expired.allowed()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
