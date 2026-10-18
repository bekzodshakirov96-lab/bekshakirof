import { randomUUID } from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  companyAccess,
  type Company,
  type PlatformAccount,
} from "../../shared/platform";
import type { PlatformConfig } from "./config";
import { COMPANY_SELECT, PlatformStore, rows } from "./store";
import {
  cookieName,
  issueToken,
  PlatformError,
  requireSameOrigin,
  sessionAccount,
  setSession,
  tokenHash,
} from "./security";
import type { SendMail } from "./mail";
import { BillingService } from "./billingService";
import { billingCallbacks } from "./billingProviders";
import { billingApi } from "./billingApi";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z
  .string()
  .min(12, "Parol kamida 12 belgidan iborat bo‘lsin.")
  .max(72)
  .refine(
    value => Buffer.byteLength(value, "utf8") <= 72,
    "Parol UTF-8 bo‘yicha 72 baytdan oshmasin."
  );
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signupSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    password,
    companyName: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]{1,62}$/,
        "Firma kodi: kichik lotin harflari, raqam va chiziqcha."
      )
      .refine(
        value =>
          ![
            "legacy",
            "www",
            "admin",
            "api",
            "platform",
            "platforma",
            "super-admin",
          ].includes(value),
        "Boshqa firma kodini tanlang."
      ),
    phone: z.string().trim().min(7).max(32),
  })
  .strict();
type AccountRecord = PlatformAccount & {
  passwordHash: string;
  verifiedAt: number | null;
};
type TokenRecord = { accountId: string; companyId: string | null };
const HOUR = 3_600_000;

export function createPlatformApi(
  store: PlatformStore,
  config: PlatformConfig,
  sendMail: SendMail
) {
  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  // Provider callbacks authenticate their own signatures/credentials, not a
  // browser Origin or session. They must precede the browser CSRF middleware.
  api.use(
    "/billing/callbacks",
    billingCallbacks(new BillingService(store, config))
  );
  api.use(express.json({ limit: "16kb" }));
  const endpoint =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      void fn(req, res).catch(next);
    };
  const authenticated = async (req: Request, admin = false) => {
    const account = await sessionAccount(req, store, config);
    if (!account) throw new PlatformError(401, "Avval platformaga kiring.");
    if (admin && (account.role !== "super_admin" || !account.verified))
      throw new PlatformError(403, "Faqat super admin uchun.");
    return account;
  };
  // Runtime credentials authorize only their own company's access/one-use login tickets.
  const runtime = async (req: Request) => {
    const secret = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/
    )?.[1];
    if (!secret)
      throw new PlatformError(401, "Firma autentifikatsiyasi talab etiladi.");
    const [company] = await rows<Company>(
      store.pool,
      `${COMPANY_SELECT} WHERE c.runtimeKeyHash=? AND c.slug=?`,
      [tokenHash(secret), req.body?.tenantId ?? req.query.tenantId]
    );
    if (!company)
      throw new PlatformError(401, "Firma autentifikatsiyasi tasdiqlanmadi.");
    return company;
  };
  api.get(
    "/runtime/access",
    endpoint(async (req, res) => {
      const company = await runtime(req);
      const state = companyAccess(company);
      res.json({
        allowed: state === "trialing" || state === "extended",
        state,
        accessUntil: company.accessUntil,
      });
    })
  );
  api.post(
    "/runtime/redeem",
    endpoint(async (req, res) => {
      const company = await runtime(req);
      const token = tokenSchema.parse(req.body.token);
      const result = await store.transaction(async db => {
        const current = await store.company(company.id, db, true);
        const access = companyAccess(current);
        if (access !== "trialing" && access !== "extended")
          throw new PlatformError(403, "Firma uchun kirish faol emas.");
        const [ticket] = await rows<TokenRecord>(
          db,
          "SELECT accountId,companyId FROM platform_tokens WHERE tokenHash=? AND purpose='launch' AND consumedAt IS NULL AND expiresAt>? FOR UPDATE",
          [tokenHash(token), Date.now()]
        );
        if (
          !ticket ||
          ticket.companyId !== company.id ||
          ticket.accountId !== company.ownerId
        )
          throw new PlatformError(
            401,
            "Kirish havolasi eskirgan yoki ishlatilgan."
          );
        const [owner] = await rows<{
          email: string;
          verifiedAt: number | null;
        }>(db, "SELECT email,verifiedAt FROM platform_accounts WHERE id=?", [
          ticket.accountId,
        ]);
        if (!owner.verifiedAt)
          throw new PlatformError(403, "Emailni tasdiqlang.");
        await db.query(
          "UPDATE platform_tokens SET consumedAt=? WHERE tokenHash=?",
          [Date.now(), tokenHash(token)]
        );
        await store.event(db, company.id, null, "owner_login");
        return { email: owner.email, tenantId: company.slug };
      });
      res.json(result);
    })
  );

  api.use((req, _res, next) => {
    try {
      if (req.method !== "GET") requireSameOrigin(req, config.origin);
      next();
    } catch (error) {
      next(error);
    }
  });
  api.use(billingApi(store, config));
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: "Urinishlar ko‘paydi. 15 daqiqadan keyin qayta urinib ko‘ring.",
    },
  });
  api.use(
    ["/register", "/login", "/forgot", "/reset", "/verify", "/resend"],
    authLimiter
  );
  api.get(
    "/me",
    endpoint(async (req, res) => {
      const account = await sessionAccount(req, store, config);
      const company =
        account?.role === "owner"
          ? ((
              await rows<Company>(
                store.pool,
                `${COMPANY_SELECT} WHERE c.ownerId=?`,
                [account.id]
              )
            )[0] ?? null)
          : null;
      res.json({ account, company });
    })
  );
  api.post(
    "/register",
    endpoint(async (req, res) => {
      const input = signupSchema.parse(req.body);
      const id = randomUUID();
      const companyId = randomUUID();
      const hash = await bcrypt.hash(input.password, 12);
      let verification: string;
      try {
        verification = await store.transaction(async db => {
          const now = Date.now();
          await db.query(
            "INSERT INTO platform_accounts (id,name,email,passwordHash,role,createdAt) VALUES (?,?,?,?,'owner',?)",
            [id, input.name, input.email, hash, now]
          );
          await db.query(
            "INSERT INTO platform_companies (id,name,slug,ownerId,phone,state,createdAt) VALUES (?,?,?,?,?,'pending_email',?)",
            [companyId, input.companyName, input.slug, id, input.phone, now]
          );
          await store.event(
            db,
            companyId,
            { id, name: input.name },
            "registered"
          );
          return issueToken(db, id, "verify", 24 * HOUR);
        });
      } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY")
          throw new PlatformError(
            409,
            "Bu email yoki firma kodi band. Hisobingizga kiring yoki boshqa kod tanlang."
          );
        throw error;
      }
      setSession(
        res,
        await issueToken(store.pool, id, "session", 8 * HOUR),
        config
      );
      let mailSent = true;
      try {
        await sendMail(input.email, "verify", verification);
      } catch {
        mailSent = false;
      }
      res.status(201).json({ mailSent });
    })
  );
  api.post(
    "/login",
    endpoint(async (req, res) => {
      const input = z
        .object({ email, password: z.string().min(1).max(200) })
        .parse(req.body);
      const [account] = await rows<AccountRecord>(
        store.pool,
        "SELECT * FROM platform_accounts WHERE email=?",
        [input.email]
      );
      const valid = await bcrypt.compare(
        input.password,
        account?.passwordHash ??
          "$2a$12$rYOBm7uRBvXkwIOLZFeQOey7slvTFyOfv9OqUPyKj0xvCWwzwL4t2"
      );
      if (!account || !valid)
        throw new PlatformError(401, "Email yoki parol noto‘g‘ri.");
      setSession(
        res,
        await issueToken(store.pool, account.id, "session", 8 * HOUR),
        config
      );
      res.json({ ok: true });
    })
  );
  api.post(
    "/logout",
    endpoint(async (req, res) => {
      const raw = (await import("cookie")).parse(req.headers.cookie ?? "")[
        cookieName(config.production)
      ];
      if (raw)
        await store.pool.query(
          "UPDATE platform_tokens SET consumedAt=? WHERE tokenHash=? AND purpose='session'",
          [Date.now(), tokenHash(raw)]
        );
      res.clearCookie(cookieName(config.production), {
        path: "/",
        secure: config.production,
        httpOnly: true,
        sameSite: "strict",
      });
      res.json({ ok: true });
    })
  );
  api.post(
    "/resend",
    endpoint(async (req, res) => {
      const account = await authenticated(req);
      if (!account.verified)
        await sendMail(
          account.email,
          "verify",
          await issueToken(store.pool, account.id, "verify", 24 * HOUR)
        );
      res.json({ ok: true });
    })
  );
  api.post(
    "/verify",
    endpoint(async (req, res) => {
      const token = tokenSchema.parse(req.body.token);
      await store.transaction(async db => {
        const [ticket] = await rows<TokenRecord>(
          db,
          "SELECT accountId FROM platform_tokens WHERE tokenHash=? AND purpose='verify' AND consumedAt IS NULL AND expiresAt>? FOR UPDATE",
          [tokenHash(token), Date.now()]
        );
        if (!ticket)
          throw new PlatformError(
            400,
            "Tasdiqlash havolasi eskirgan yoki ishlatilgan."
          );
        await db.query(
          "UPDATE platform_accounts SET verifiedAt=COALESCE(verifiedAt,?) WHERE id=?",
          [Date.now(), ticket.accountId]
        );
        await db.query(
          "UPDATE platform_tokens SET consumedAt=? WHERE accountId=? AND purpose='verify' AND consumedAt IS NULL",
          [Date.now(), ticket.accountId]
        );
        await db.query(
          "UPDATE platform_companies SET state='provisioning',revision=revision+1 WHERE ownerId=? AND state='pending_email'",
          [ticket.accountId]
        );
        const [company] = await rows<{ id: string }>(
          db,
          "SELECT id FROM platform_companies WHERE ownerId=?",
          [ticket.accountId]
        );
        await store.event(db, company?.id ?? null, null, "email_verified");
      });
      res.json({ ok: true });
    })
  );
  api.post(
    "/forgot",
    endpoint(async (req, res) => {
      const input = email.parse(req.body.email);
      const [account] = await rows<AccountRecord>(
        store.pool,
        "SELECT * FROM platform_accounts WHERE email=?",
        [input]
      );
      if (account?.verifiedAt) {
        try {
          await sendMail(
            input,
            "reset",
            await issueToken(store.pool, account.id, "reset", HOUR)
          );
        } catch {
          /* Same response regardless of delivery/account existence. */
        }
      }
      res.json({ ok: true });
    })
  );
  api.post(
    "/reset",
    endpoint(async (req, res) => {
      const input = z.object({ token: tokenSchema, password }).parse(req.body);
      const hash = await bcrypt.hash(input.password, 12);
      await store.transaction(async db => {
        const [ticket] = await rows<TokenRecord>(
          db,
          "SELECT accountId FROM platform_tokens WHERE tokenHash=? AND purpose='reset' AND consumedAt IS NULL AND expiresAt>? FOR UPDATE",
          [tokenHash(input.token), Date.now()]
        );
        if (!ticket)
          throw new PlatformError(
            400,
            "Parol tiklash havolasi eskirgan yoki ishlatilgan."
          );
        await db.query(
          "UPDATE platform_accounts SET passwordHash=? WHERE id=?",
          [hash, ticket.accountId]
        );
        await db.query(
          "UPDATE platform_tokens SET consumedAt=? WHERE accountId=? AND consumedAt IS NULL AND purpose IN ('session','reset','launch')",
          [Date.now(), ticket.accountId]
        );
        await store.event(db, null, null, "password_reset");
      });
      res.json({ ok: true });
    })
  );
  api.post(
    "/companies/:id/launch",
    endpoint(async (req, res) => {
      const account = await authenticated(req);
      const company = await store.company(req.params.id);
      if (
        !company ||
        company.ownerId !== account.id ||
        account.role !== "owner"
      )
        throw new PlatformError(404, "Firma topilmadi.");
      const access = companyAccess(company);
      if (
        !account.verified ||
        !company.origin ||
        (access !== "trialing" && access !== "extended")
      )
        throw new PlatformError(403, "Firma uchun kirish faol emas.");
      res.json({
        action: `${company.origin}/api/platform/sso`,
        token: await issueToken(
          store.pool,
          account.id,
          "launch",
          60_000,
          company.id
        ),
      });
    })
  );
  api.get(
    "/admin/overview",
    endpoint(async (req, res) => {
      await authenticated(req, true);
      const now = Date.now();
      const shifted = new Date(now + 5 * 3600000);
      const monthStart =
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) -
        5 * 3600000;
      const stateSql =
        "CASE WHEN c.state<>'ready' THEN c.state WHEN c.accessUntil IS NULL OR c.accessUntil<=? THEN 'expired' WHEN c.trialEnd>? THEN 'trialing' ELSE 'extended' END";
      const expiringWhere =
        " WHERE c.state='ready' AND c.accessUntil>? AND c.accessUntil<=?";
      const end = now + 7 * 86400000;
      const [stats, recent, expiring, expiryCounts, monthCounts, activity] =
        await Promise.all([
          rows(
            store.pool,
            `SELECT (${stateSql}) state,COUNT(*) total FROM platform_companies c GROUP BY 1`,
            [now, now]
          ),
          rows(
            store.pool,
            `${COMPANY_SELECT} ORDER BY c.createdAt DESC,c.id LIMIT 5`
          ),
          rows(
            store.pool,
            `${COMPANY_SELECT}${expiringWhere} ORDER BY c.accessUntil,c.id LIMIT 5`,
            [now, end]
          ),
          rows<{ total: number }>(
            store.pool,
            `SELECT COUNT(*) total FROM platform_companies c${expiringWhere}`,
            [now, end]
          ),
          rows<{ total: number }>(
            store.pool,
            "SELECT COUNT(*) total FROM platform_companies WHERE createdAt>=? AND createdAt<=?",
            [monthStart, now]
          ),
          rows(
            store.pool,
            "SELECT e.id,e.companyId,e.actorName,e.action,e.reason,e.createdAt,c.name companyName,c.slug companySlug FROM platform_events e LEFT JOIN platform_companies c ON c.id=e.companyId ORDER BY e.id DESC LIMIT 6"
          ),
        ]);
      res.json({
        asOf: now,
        stats,
        recent,
        expiring,
        expiringTotal: expiryCounts[0].total,
        registeredThisMonth: monthCounts[0].total,
        activity,
      });
    })
  );
  api.get(
    "/admin/events",
    endpoint(async (req, res) => {
      await authenticated(req, true);
      const input = z
        .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
        .parse(req.query);
      const events = await rows(
        store.pool,
        "SELECT e.id,e.companyId,e.actorName,e.action,e.reason,e.createdAt,c.name companyName,c.slug companySlug FROM platform_events e LEFT JOIN platform_companies c ON c.id=e.companyId ORDER BY e.id DESC LIMIT 25 OFFSET ?",
        [(input.page - 1) * 25]
      );
      const [count] = await rows<{ total: number }>(
        store.pool,
        "SELECT COUNT(*) total FROM platform_events"
      );
      res.json({ events, total: count.total });
    })
  );
  api.get(
    "/admin/companies",
    endpoint(async (req, res) => {
      await authenticated(req, true);
      const input = z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          q: z.string().max(120).default(""),
          sort: z
            .enum(["newest", "oldest", "name", "deadline"])
            .default("newest"),
          expiring: z.enum(["false", "true"]).default("false"),
          state: z
            .enum([
              "all",
              "pending_email",
              "provisioning",
              "suspended",
              "expired",
              "trialing",
              "extended",
            ])
            .default("all"),
        })
        .parse(req.query);
      const now = Date.now();
      const stateSql =
        "CASE WHEN c.state<>'ready' THEN c.state WHEN c.accessUntil IS NULL OR c.accessUntil<=? THEN 'expired' WHEN c.trialEnd>? THEN 'trialing' ELSE 'extended' END";
      const where = ` WHERE (c.name LIKE ? OR c.slug LIKE ? OR a.email LIKE ?)${input.state === "all" ? "" : ` AND (${stateSql})=?`}${input.expiring === "true" ? " AND c.state='ready' AND c.accessUntil>? AND c.accessUntil<=?" : ""}`;
      const pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
      const params: unknown[] = [
        pattern,
        pattern,
        pattern,
        ...(input.state === "all" ? [] : [now, now, input.state]),
        ...(input.expiring === "true" ? [now, now + 7 * 86400000] : []),
      ];
      const order = {
        newest: "c.createdAt DESC,c.id",
        oldest: "c.createdAt,c.id",
        name: "c.name,c.id",
        deadline: "c.accessUntil IS NULL,c.accessUntil,c.id",
      }[input.sort];
      const companies = await rows<Company>(
        store.pool,
        `${COMPANY_SELECT}${where} ORDER BY ${order} LIMIT 25 OFFSET ?`,
        [...params, (input.page - 1) * 25]
      );
      const [count] = await rows<{ total: number }>(
        store.pool,
        `SELECT COUNT(*) total FROM platform_companies c JOIN platform_accounts a ON a.id=c.ownerId${where}`,
        params
      );
      const stats = await rows<{ state: string; total: number }>(
        store.pool,
        `SELECT (${stateSql}) state,COUNT(*) total FROM platform_companies c GROUP BY 1`,
        [now, now]
      );
      res.json({ companies, total: count.total, stats });
    })
  );
  api.get(
    "/admin/companies/:id",
    endpoint(async (req, res) => {
      await authenticated(req, true);
      const company = await store.company(req.params.id);
      if (!company) throw new PlatformError(404, "Firma topilmadi.");
      res.json({ company, events: await store.events(company.id) });
    })
  );
  api.post(
    "/admin/companies/:id",
    endpoint(async (req, res) => {
      const account = await authenticated(req, true);
      const input = z
        .object({
          action: z.enum(["suspend", "resume", "extend"]),
          revision: z.number().int().nonnegative(),
          reason: z.string().trim().min(5).max(500),
          days: z.number().int().min(1).max(366).optional(),
        })
        .strict()
        .parse(req.body);
      await store.transaction(async db => {
        const company = await store.company(req.params.id, db, true);
        if (!company) throw new PlatformError(404, "Firma topilmadi.");
        if (company.revision !== input.revision)
          throw new PlatformError(
            409,
            "Firma o‘zgargan. Yangilab qayta urinib ko‘ring."
          );
        if (input.action === "suspend" && company.state === "ready")
          await db.query(
            "UPDATE platform_companies SET state='suspended',revision=revision+1 WHERE id=?",
            [company.id]
          );
        else if (input.action === "resume" && company.state === "suspended")
          await db.query(
            "UPDATE platform_companies SET state='ready',revision=revision+1 WHERE id=?",
            [company.id]
          );
        else if (
          input.action === "extend" &&
          ["ready", "suspended"].includes(company.state) &&
          input.days
        ) {
          const end =
            Math.max(Date.now(), company.accessUntil ?? 0) +
            input.days * 86_400_000;
          await db.query(
            "UPDATE platform_companies SET accessUntil=?,revision=revision+1 WHERE id=?",
            [end, company.id]
          );
        } else
          throw new PlatformError(409, "Bu holatda amalni bajarib bo‘lmaydi.");
        await store.event(
          db,
          company.id,
          account,
          input.action,
          `${input.reason}${input.action === "extend" ? ` (+${input.days} kun)` : ""}`
        );
      });
      res.json({ ok: true });
    })
  );
  api.use((_req, _res, next) =>
    next(new PlatformError(404, "Manzil topilmadi."))
  );
  api.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof PlatformError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues[0]?.message ?? "Maydonlarni tekshiring.",
        });
        return;
      }
      // Never leak database credentials, SQL, tokens or submitted passwords in API/logs.
      console.error("[Platform] Request failed.");
      res.status(503).json({
        error: "Xizmat vaqtincha ishlamayapti. Qayta urinib ko‘ring.",
      });
    }
  );
  return api;
}
