import { createHash, randomBytes } from "node:crypto";
import { parse } from "cookie";
import type { Request, Response } from "express";
import type { PlatformConfig } from "./config";
import { rows, type PlatformStore, type Sql } from "./store";

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const cookieName = (production: boolean) =>
  production ? "__Host-bc_platform" : "bc_platform_dev";
export class PlatformError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export async function issueToken(
  db: Sql,
  accountId: string,
  purpose: "session" | "verify" | "reset" | "launch",
  ttl: number,
  companyId: string | null = null
) {
  const token = newToken();
  await db.query(
    "INSERT INTO platform_tokens (tokenHash,accountId,companyId,purpose,expiresAt) VALUES (?,?,?,?,?)",
    [tokenHash(token), accountId, companyId, purpose, Date.now() + ttl]
  );
  return token;
}
export function setSession(
  res: Response,
  token: string,
  config: PlatformConfig
) {
  res.cookie(cookieName(config.production), token, {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  });
}
export async function sessionAccount(
  req: Request,
  store: PlatformStore,
  config: PlatformConfig
) {
  const token = parse(req.headers.cookie ?? "")[cookieName(config.production)];
  if (!token || token.length > 100) return null;
  const [session] = await rows<{ accountId: string }>(
    store.pool,
    "SELECT accountId FROM platform_tokens WHERE tokenHash=? AND purpose='session' AND consumedAt IS NULL AND expiresAt>?",
    [tokenHash(token), Date.now()]
  );
  return session ? store.account(session.accountId) : null;
}
export function requireSameOrigin(req: Request, origin: string) {
  // Required even for login and anonymous registration; do not trust Host/forwarded headers.
  if (req.headers.origin !== origin || !req.is("application/json"))
    throw new PlatformError(403, "So‘rov manbasi tasdiqlanmadi.");
}
