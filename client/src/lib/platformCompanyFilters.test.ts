import { describe, expect, it } from "vitest";
import {
  companyFiltersUrl,
  companyFilterStorageKey,
  defaultCompanyFilters,
  normalizeCompanyFilters,
  parseCompanyFilters,
  restoreCompanyFilters,
} from "./platformCompanyFilters";

describe("platform company view persistence", () => {
  it("restores a saved view on a bare company URL", () => {
    const saved = {
      ...defaultCompanyFilters,
      state: "expired",
      q: "Firma & Co",
      page: 3,
      density: "comfortable",
    };
    expect(
      restoreCompanyFilters(new URLSearchParams(), JSON.stringify(saved))
    ).toEqual(saved);
  });
  it("makes a shared URL authoritative instead of mixing in another admin's filters", () => {
    const saved = JSON.stringify({
      ...defaultCompanyFilters,
      q: "hidden",
      expiring: true,
    });
    expect(
      restoreCompanyFilters(new URLSearchParams("state=all"), saved)
    ).toEqual(defaultCompanyFilters);
  });
  it("round-trips Cyrillic, Uzbek and reserved search characters safely", () => {
    const filters = {
      ...defaultCompanyFilters,
      q: "Савдо O‘tkir & + #?",
      expiring: true,
      sort: "deadline" as const,
      page: 2,
    };
    const url = new URL(companyFiltersUrl(filters), "http://localhost");
    expect(url.pathname).toBe("/super-admin/firmalar");
    expect(parseCompanyFilters(url.searchParams)).toEqual(filters);
  });
  it.each([
    null,
    "broken",
    "null",
    "[]",
    '{"state":"__proto__","sort":"constructor","page":-2,"expiring":"false","q":{}}',
  ])("handles invalid saved state without breaking the page: %s", saved => {
    expect(restoreCompanyFilters(new URLSearchParams(), saved)).toEqual(
      defaultCompanyFilters
    );
  });
  it("bounds URL inputs and discards unknown fields", () => {
    expect(
      normalizeCompanyFilters({
        q: "x".repeat(200),
        page: "1.5",
        tenantId: "other",
        state: "ready",
        density: "huge",
      })
    ).toEqual({ ...defaultCompanyFilters, q: "x".repeat(120) });
    for (const page of [0, -1, 100001, Infinity, "1e3"])
      expect(normalizeCompanyFilters({ page }).page).toBe(1);
  });
  it("separates view preferences by administrator account", () => {
    expect(companyFilterStorageKey("one")).not.toBe(
      companyFilterStorageKey("two")
    );
  });
});
