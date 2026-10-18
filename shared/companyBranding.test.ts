import { describe, it, expect } from "vitest";
import {
  companyBrandingSaveSchema,
  companyBrandingSchema,
  defaultCompanyBranding,
  companyInitials,
} from "./companyBranding";
describe("per-company visual identity input", () => {
  const input = {
    expectedRevision: 0,
    branding: {
      name: "Baraka savdo",
      tagline: "Savdo va xizmatlar",
      color: "#0f766e",
    },
    logo: { action: "keep" },
  };
  it("preserves legacy defaults and validates a custom name/color without accepting identity or financial fields", () => {
    expect(defaultCompanyBranding()).toEqual({
      name: "BiznesControl",
      tagline: "Firma kabineti",
      color: null,
      backgroundLight: null,
      backgroundDark: null,
      cardLight: null,
      cardDark: null,
      tableLight: null,
      tableDark: null,
      logoUrl: null,
    });
    expect(companyBrandingSaveSchema.parse(input).branding.color).toBe(
      "#0F766E"
    );
    for (const extra of [
      { tenantId: "other" },
      { ownerId: 1 },
      { cashBalance: 0 },
    ])
      expect(
        companyBrandingSaveSchema.safeParse({ ...input, ...extra }).success
      ).toBe(false);
    expect(
      companyBrandingSaveSchema.safeParse({
        ...input,
        branding: { ...input.branding, logoUrl: "/uploads/other.png" },
      }).success
    ).toBe(false);
    for (const color of [
      "red",
      "#fff",
      "url(https://evil.invalid/a)",
      "#000000;display:none",
    ])
      expect(
        companyBrandingSaveSchema.safeParse({
          ...input,
          branding: { ...input.branding, color },
        }).success
      ).toBe(false);
    for (const name of ["", "x".repeat(81), "x\ny", "Firma\u202E"])
      expect(
        companyBrandingSaveSchema.safeParse({
          ...input,
          branding: { ...input.branding, name },
        }).success
      ).toBe(false);
    expect(companyInitials("Baraka savdo")).toBe("BS");
    expect(companyInitials("Барака")).toBe("БА");
    expect(companyInitials("BiznesControl")).toBe("BC");
  });
  it("reads old revisions without migration and keeps omitted background writes distinct from explicit resets", () => {
    const old = companyBrandingSchema.parse({
      ...input.branding,
      logoUrl: null,
    });
    expect(old.backgroundLight).toBeNull();
    expect(old.backgroundDark).toBeNull();
    const oldWrite = companyBrandingSaveSchema.parse(input);
    expect(Object.hasOwn(oldWrite.branding, "backgroundLight")).toBe(false);
    const custom = companyBrandingSaveSchema.parse({
      ...input,
      branding: {
        ...input.branding,
        backgroundLight: "#fff4e6",
        backgroundDark: "#1a1725",
      },
    });
    expect(custom.branding.backgroundLight).toBe("#FFF4E6");
    expect(custom.branding.backgroundDark).toBe("#1A1725");
    expect(
      companyBrandingSaveSchema.parse({
        ...input,
        branding: { ...input.branding, backgroundLight: null },
      }).branding.backgroundLight
    ).toBeNull();
    for (const field of [
      "backgroundLight",
      "backgroundDark",
      "cardLight",
      "cardDark",
      "tableLight",
      "tableDark",
    ])
      for (const value of [
        "red",
        "#fff",
        "#000000;display:none",
        "url(https://bad.invalid)",
      ])
        expect(
          companyBrandingSaveSchema.safeParse({
            ...input,
            branding: { ...input.branding, [field]: value },
          }).success
        ).toBe(false);
  });
  it("defaults missing surface settings without converting omitted writes into resets", () => {
    const read = companyBrandingSchema.parse({
      ...input.branding,
      logoUrl: null,
    });
    for (const field of [
      "cardLight",
      "cardDark",
      "tableLight",
      "tableDark",
    ] as const) {
      expect(read[field]).toBeNull();
      expect(
        Object.hasOwn(companyBrandingSaveSchema.parse(input).branding, field)
      ).toBe(false);
      expect(
        companyBrandingSaveSchema.parse({
          ...input,
          branding: { ...input.branding, [field]: "#aabbcc" },
        }).branding[field]
      ).toBe("#AABBCC");
    }
  });
});
