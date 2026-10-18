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
  it("applies exact backgrounds independently of the accent and respects each mode", () => {
    const backgrounds = { light: "#FFF4E6", dark: "#1A1725" };
    for (const dark of [false, true]) {
      const original = companyBrandVariables("#0F766E", dark);
      const custom = companyBrandVariables("#0F766E", dark, backgrounds);
      expect(custom["--background"]).toBe(
        dark ? backgrounds.dark : backgrounds.light
      );
      expect(custom["--primary"]).toBe(original["--primary"]);
      expect(custom["--primary-foreground"]).toBe(
        original["--primary-foreground"]
      );
      expect(
        companyBrandVariables("#0F766E", dark, { light: null, dark: null })
      ).toEqual(original);
    }
    const onlyBackground = companyBrandVariables(null, false, backgrounds);
    expect(onlyBackground["--background"]).toBe(backgrounds.light);
    expect(onlyBackground).not.toHaveProperty("--primary");
    expect(onlyBackground).not.toHaveProperty("--company-sidebar-primary");
    expect(
      companyBrandVariables(null, false, { light: "url(https://bad.invalid)" })
    ).toEqual({});
    expect(
      companyBrandVariables("#0F766E", false, { dark: "#000000" })
    ).toEqual(companyBrandVariables("#0F766E", false));
  });
  it.each([
    "#000000",
    "#FFFFFF",
    "#808080",
    "#285BD4",
    "#FF0000",
    "#00FF00",
    "#FFFF00",
    "#7C3AED",
  ])(
    "keeps text and surfaces readable even with an unusual %s background in either mode",
    background => {
      for (const dark of [false, true])
        for (const accent of [null, "#0F766E", "#FFFFFF", "#000000"]) {
          const v = companyBrandVariables(accent, dark, {
            light: background,
            dark: background,
          });
          expect(v["--background"]).toBe(background);
          for (const [surface, text] of [
            ["--background", "--foreground"],
            ["--background", "--muted-foreground"],
            ["--card", "--card-foreground"],
            ["--card", "--muted-foreground"],
            ["--muted", "--muted-foreground"],
            ["--secondary", "--secondary-foreground"],
          ])
            expect(colorContrast(v[surface], v[text])).toBeGreaterThanOrEqual(
              4.5
            );
          expect(
            Object.keys(v).some(key =>
              /destructive|success|warning|chart/.test(key)
            )
          ).toBe(false);
        }
    }
  );
});
