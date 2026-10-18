import { describe, expect, it } from "vitest";
import { readBillingConfig, readyProviders } from "./billingConfig";
import { clickTiyin, equalSecret } from "./billingProviders";
describe("billing configuration and exact monetary conversion", () => {
  it("defaults off and refuses accidental development live billing", () => {
    expect(readyProviders(readBillingConfig({}, false))).toEqual({
      payme: false,
      click: false,
    });
    expect(
      readyProviders(
        readBillingConfig(
          {
            PLATFORM_BILLING_MODE: "test",
            CLICK_MERCHANT_ID: "1",
            CLICK_SERVICE_ID: "2",
            CLICK_SECRET_KEY: "test-only",
          },
          false
        )
      ).click
    ).toBe(true);
    expect(() =>
      readBillingConfig({ PLATFORM_BILLING_MODE: "live" }, false)
    ).toThrow();
    expect(() =>
      readBillingConfig({ PLATFORM_BILLING_MODE: "test" }, true)
    ).toThrow();
    expect(() =>
      readBillingConfig({ PLATFORM_BILLING_MODE: "bad" }, true)
    ).toThrow();
    expect(() =>
      readBillingConfig({ CLICK_SERVICE_ID: "123&x=1" }, false)
    ).toThrow();
  });
  it("converts UZS text to integer tiyin without floating point rounding", () => {
    expect(clickTiyin("125000.10")).toBe(12500010);
    expect(clickTiyin("1")).toBe(100);
    expect(clickTiyin("0.01")).toBe(1);
    for (const s of ["1e5", "-1", "1.001", "NaN", "1,000", " 1", "1."])
      expect(() => clickTiyin(s)).toThrow();
    expect(equalSecret("abc", "abc")).toBe(true);
    expect(equalSecret("abc", "abd")).toBe(false);
  });
});
