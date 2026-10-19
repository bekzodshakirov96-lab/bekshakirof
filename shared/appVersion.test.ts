import { describe, expect, it } from "vitest";
import { parseAppVersion } from "./appVersion";

describe("public client build identity", () => {
  it("accepts only a versioned bounded build identifier and exposes no other fields", () => {
    expect(
      parseAppVersion({ schema: 1, buildId: "release-123", extra: "ignored" })
    ).toEqual({ schema: 1, buildId: "release-123" });
    for (const value of [
      null,
      [],
      "html",
      {},
      { schema: 2, buildId: "release-123" },
      { schema: 1, buildId: "" },
      { schema: 1, buildId: "x".repeat(129) },
      { schema: 1, buildId: "invalid/path" },
    ])
      expect(parseAppVersion(value)).toBeNull();
  });
});
