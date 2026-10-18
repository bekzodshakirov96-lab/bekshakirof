import { describe, it, expect } from "vitest";
import { companyBrandVariables, colorContrast } from "./companyBrandColors";
describe("readable company color palettes", () => {
  it("keeps legacy colors untouched and rejects arbitrary CSS", () => {
    expect(companyBrandVariables(null, false)).toEqual({});
    expect(companyBrandVariables("url(https://bad.invalid)", false)).toEqual(
      {}
    );
  });
  it.each([
    "#000000",
    "#FFFFFF",
    "#285BD4",
    "#0F766E",
    "#FFFF00",
    "#FF0000",
    "#7C3AED",
  ])("keeps text legible with %s in both themes", color => {
    for (const dark of [false, true]) {
      const v = companyBrandVariables(color, dark);
      expect(
        colorContrast(v["--primary"], v["--primary-foreground"])
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colorContrast(v["--background"], v["--foreground"])
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colorContrast(v["--muted"], v["--muted-foreground"])
      ).toBeGreaterThanOrEqual(4.5);
      expect(colorContrast(v["--input"], v["--card"])).toBeGreaterThan(1.15);
      expect(
        Object.keys(v).some(key =>
          /destructive|success|warning|chart/.test(key)
        )
      ).toBe(false);
    }
  });
});
