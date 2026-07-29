// Self-hosted authentication: email + password, sessions signed as JWTs and
// stored in an httpOnly cookie. Replaces the Manus-hosted OAuth flow that
// previously lived in sdk.ts / oauth.ts so this app can run on any server.
import { COOKIE_NAME, SESSION_TTL_MS } from "@shared/const";
import bcrypt from "bcryptjs";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

const BCRYPT_ROUNDS = 10;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function getSessionSecret() {
  const secret = ENV.cookieSecret;
  if (!secret) {
    throw new Error(
      "JWT_SECRET sozlanmagan. .env faylida uzun, tasodifiy JWT_SECRET qiymatini belgilang.",
    );
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = { userId: number; tokenVersion: number };

/** `tokenVersion` foydalanuvchining joriy `users.tokenVersion` qiymati bilan birga
 * imzolanadi. Har logout'da bu qiymat DB'da +1 oshadi (server/db.ts:incrementTokenVersion),
 * shu sababli o'sha paytdan oldin chiqarilgan har qanday token (o'g'irlangan nusxasi
 * ham) `authenticateRequest`da mos kelmay, rad etiladi. */
export async function signSession(
  userId: number,
  tokenVersion: number = 0,
  options: { expiresInMs?: number } = {},
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? SESSION_TTL_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
  const secretKey = getSessionSecret();

  return new SignJWT({ userId, tokenVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);
}

export async function verifySession(
  cookieValue: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;

  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secretKey, { algorithms: ["HS256"] });
    const { userId, tokenVersion } = payload as Record<string, unknown>;
    if (typeof userId !== "number" || typeof tokenVersion !== "number") return null;
    return { userId, tokenVersion };
  } catch (error) {
    console.warn("[Auth] Session verification failed", String(error));
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) return new Map<string, string>();
  return new Map(Object.entries(parseCookieHeader(cookieHeader)));
}

/** Resolves the logged-in user (or null) from the session cookie / bearer header. */
export async function authenticateRequest(req: Request): Promise<User | null> {
  const cookies = parseCookies(req.headers.cookie);
  let sessionToken = cookies.get(COOKIE_NAME);

  if (!sessionToken) {
    const authHeader = req.headers.authorization;
    if (isNonEmptyString(authHeader) && authHeader.startsWith("Bearer ")) {
      sessionToken = authHeader.slice(7);
    }
  }

  const session = await verifySession(sessionToken);
  if (!session) return null;

  const user = await db.getUserById(session.userId);
  if (!user) return null;
  if (user.tokenVersion !== session.tokenVersion) return null;
  return user;
}
