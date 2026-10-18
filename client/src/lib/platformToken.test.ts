import { describe, it, expect } from "vitest";
import { restorePlatformToken, clearPlatformToken } from "./platformToken";
function tab() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
    values,
  };
}
describe("platform one-use link reload recovery", () => {
  const token = "A".repeat(43);
  it("restores a reset link after its URL fragment has been removed and the page reloads", () => {
    const storage = tab();
    expect(restorePlatformToken("reset", `#${token}`, storage, 100)).toBe(
      token
    );
    expect(restorePlatformToken("reset", "", storage, 200)).toBe(token);
    expect(restorePlatformToken("verify", "", storage, 200)).toBe("");
    expect(restorePlatformToken("reset", "", tab(), 200)).toBe("");
    clearPlatformToken("reset", storage);
    expect(restorePlatformToken("reset", "", storage, 300)).toBe("");
  });
  it("expires saved links, refuses corrupt data and does not fall back on a malformed new link", () => {
    const storage = tab();
    restorePlatformToken("reset", `#${token}`, storage, 100);
    expect(restorePlatformToken("reset", "", storage, 3_600_100)).toBe("");
    restorePlatformToken("reset", `#${token}`, storage, 100);
    expect(restorePlatformToken("reset", "#bad", storage, 200)).toBe("");
    expect(restorePlatformToken("reset", "", storage, 200)).toBe("");
    storage.values.set("bc-platform-link-v1:reset", "bad json");
    expect(restorePlatformToken("reset", "", storage, 200)).toBe("");
    expect(storage.values.size).toBe(0);
  });
  it("retains the supplied link when storage is blocked without fabricating a replacement", () => {
    const blocked = {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
      removeItem: () => {
        throw Error("blocked");
      },
    };
    expect(restorePlatformToken("reset", `#${token}`, blocked, 100)).toBe(
      token
    );
    expect(restorePlatformToken("reset", "", blocked, 100)).toBe("");
  });
});
