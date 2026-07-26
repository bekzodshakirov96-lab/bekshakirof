import { describe, expect, it } from "vitest";
import { hashPassword, signSession, verifyPassword, verifySession } from "./_core/localAuth";

describe("localAuth password hashing", () => {
  it("hashes a password and verifies the correct password against it", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password against an existing hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
  });
});

describe("localAuth session tokens", () => {
  it("signs and verifies a session round-trip for the given user id", async () => {
    const token = await signSession(42);
    const session = await verifySession(token);
    expect(session).toEqual({ userId: 42 });
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(1);
    const tampered = `${token.slice(0, -1)}${token.at(-1) === "a" ? "b" : "a"}`;
    await expect(verifySession(tampered)).resolves.toBeNull();
  });

  it("returns null for a missing token", async () => {
    await expect(verifySession(undefined)).resolves.toBeNull();
    await expect(verifySession(null)).resolves.toBeNull();
  });
});
