import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { validateStorageKey } from "./tenancy/files";

/** Mount at /api/trpc: Express's exact auth.login mount does not match batches. */
export function loginRateLimit(limit = 20): RequestHandler {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring." },
  });
  return (req, res, next) => {
    let procedures: string[];
    try {
      // Match tRPC's Express adapter: it selects the last raw path segment,
      // then decodes that segment once before resolving the procedure(s).
      procedures = decodeURIComponent(req.path.slice(req.path.lastIndexOf("/") + 1)).split(",");
    } catch {
      res.status(400).json({ error: "So‘rov manzili noto‘g‘ri." });
      return;
    }
    if (!procedures.includes("auth.login")) return next();
    // A request may contain at most one password check. Mixed batches with a
    // single login are still charged to the same limiter as standalone login.
    if (procedures.filter(name => name === "auth.login").length > 1) {
      res.status(400).json({ error: "Bir so‘rovda faqat bitta kirish urinishi mumkin." });
      return;
    }
    return limiter(req, res, next);
  };
}

export function uploadAccess(
  authenticate: (req: Request) => Promise<{ role: string } | null>
): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const user = await authenticate(req);
      if (!user) {
        res.status(401).json({ error: "Avval tizimga kiring." });
        return;
      }
      let key: string;
      try {
        key = validateStorageKey(decodeURIComponent(req.path).slice(1));
      } catch {
        res.status(404).end();
        return;
      }
      // Branding is displayed to every company user. Original workbooks and
      // other business uploads contain company-wide data: restrict like imports.
      if (!key.startsWith("branding/") && user.role !== "admin" && user.role !== "accountant") {
        res.status(403).json({ error: "Bu faylni faqat rahbar yoki buxgalter ko‘ra oladi." });
        return;
      }
      next();
    })().catch(next);
  };
}
