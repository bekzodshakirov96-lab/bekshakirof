import express, { type Express } from "express";
import { checkedOrigin } from "../platform/config";
import { SESSION_COOKIE_NAME, type RuntimeTenant } from "./config";
import { getSessionCookieOptions } from "../_core/cookies";
import { signSession } from "../_core/localAuth";
import { requireDb } from "../db";
import { users } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

export type RuntimeAccessConfig = {
  origin: string;
  key: string;
  tenantId: string;
};
export function readManagedConfig(
  env: NodeJS.ProcessEnv,
  tenant: RuntimeTenant
): RuntimeAccessConfig | null {
  if (env.PLATFORM_MANAGED !== "true") return null;
  if (tenant.mode !== "isolated" || tenant.id === "legacy")
    throw new Error(
      "Managed access may only be enabled for a new, isolated company."
    );
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.PLATFORM_RUNTIME_KEY ?? ""))
    throw new Error("PLATFORM_RUNTIME_KEY is missing.");
  return {
    origin: checkedOrigin(
      env.PLATFORM_CONTROL_URL ?? "",
      env.NODE_ENV === "production"
    ),
    key: env.PLATFORM_RUNTIME_KEY!,
    tenantId: tenant.id,
  };
}
export function platformAccessClient(
  config: RuntimeAccessConfig,
  request: typeof fetch = fetch
) {
  let cache: { until: number; allowed: boolean } | null = null;
  let pending: Promise<boolean> | null = null;
  const allowed = async () => {
    if (cache && Date.now() < cache.until) return cache.allowed;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await request(
          `${config.origin}/api/platform/runtime/access?tenantId=${encodeURIComponent(config.tenantId)}`,
          {
            headers: { Authorization: `Bearer ${config.key}` },
            signal: AbortSignal.timeout(5_000),
            redirect: "error",
          }
        );
        if (!response.ok) throw new Error("Access check failed.");
        const data = (await response.json()) as {
          allowed: boolean;
          accessUntil: number | null;
        };
        const access =
          data.allowed === true &&
          typeof data.accessUntil === "number" &&
          Date.now() < data.accessUntil;
        cache = {
          allowed: access,
          until: Math.min(
            Date.now() + 15_000,
            access ? data.accessUntil! : Date.now() + 5_000
          ),
        };
        return access;
      } catch {
        cache = { allowed: false, until: Date.now() + 3_000 };
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
  return { allowed };
}

export function installManagedAccess(app: Express, tenant: RuntimeTenant) {
  const config = readManagedConfig(process.env, tenant);
  if (!config) return;
  const access = platformAccessClient(config);
  app.post(
    "/api/platform/sso",
    express.urlencoded({ extended: false, limit: "2kb" }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (
        req.headers.origin !== config.origin ||
        !/^[A-Za-z0-9_-]{43}$/.test(req.body?.token ?? "")
      ) {
        res.status(403).send("Platformadan qayta kiring.");
        return;
      }
      try {
        const response = await fetch(
          `${config.origin}/api/platform/runtime/redeem`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(5_000),
            headers: {
              Authorization: `Bearer ${config.key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tenantId: tenant.id,
              token: req.body.token,
            }),
          }
        );
        if (!response.ok) throw new Error("Rejected ticket.");
        const data = (await response.json()) as {
          email: string;
          tenantId: string;
        };
        if (data.tenantId !== tenant.id) throw new Error("Wrong company.");
        const db = await requireDb();
        const [owner] = await db
          .select()
          .from(users)
          .where(
            and(
              eq(users.id, 1),
              eq(users.email, data.email),
              eq(users.role, "admin")
            )
          )
          .limit(1);
        if (!owner) throw new Error("Owner mismatch.");
        const ttl = 8 * 60 * 60 * 1000;
        res.cookie(
          SESSION_COOKIE_NAME,
          await signSession(owner.id, owner.tokenVersion, { expiresInMs: ttl }),
          { ...getSessionCookieOptions(req), maxAge: ttl }
        );
        res.redirect(303, "/");
      } catch {
        res
          .status(403)
          .send(
            "Kirish havolasi ishlamadi. Platformadagi firma kabinetingizdan qayta kiring."
          );
      }
    }
  );
  app.use(["/api/trpc", "/uploads"], async (_req, res, next) => {
    if (await access.allowed()) next();
    else
      res
        .status(403)
        .json({
          error:
            "Firma kirishi faol emas yoki tekshiruv xizmati ishlamayapti. Platforma kabinetiga kiring.",
        });
  });
}
