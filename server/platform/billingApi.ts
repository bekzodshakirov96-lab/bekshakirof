import express from "express";
import { z } from "zod";
import type { PlatformConfig } from "./config";
import type { PlatformStore } from "./store";
import { PlatformError, sessionAccount } from "./security";
import { readyProviders } from "./billingConfig";
import { BillingService } from "./billingService";

/** Mounted after the platform's same-origin JSON check, never in a firm runtime. */
export function billingApi(store: PlatformStore, config: PlatformConfig) {
  const router = express.Router();
  const service = new BillingService(store, config);
  const endpoint =
    (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      void fn(req, res).catch(next);
    };
  const account = async (req: express.Request, admin = false) => {
    const user = await sessionAccount(req, store, config);
    if (!user) throw new PlatformError(401, "Platformaga kiring.");
    if (admin && (user.role !== "super_admin" || !user.verified))
      throw new PlatformError(403, "Faqat super admin uchun.");
    return user;
  };
  router.get(
    "/billing",
    endpoint(async (req, res) => {
      const user = await account(req);
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(req.query.page ?? 1);
      res.json(await service.view(user, page));
    })
  );
  router.post(
    "/billing/orders",
    endpoint(async (req, res) => {
      const user = await account(req);
      const p = z
        .object({
          provider: z.enum(["payme", "click"]),
          requestKey: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      res.json(await service.create(user, p.provider, p.requestKey));
    })
  );
  router.post(
    "/billing/orders/:id/cancel",
    endpoint(async (req, res) => {
      await service.cancelUnpaid(
        await account(req),
        z.string().uuid().parse(req.params.id)
      );
      res.json({ ok: true });
    })
  );
  router.get(
    "/admin/billing",
    endpoint(async (req, res) => {
      await account(req, true);
      res.json({
        price: await service.price(),
        mode: service.settings.mode,
        providers: readyProviders(service.settings),
      });
    })
  );
  router.post(
    "/admin/billing/price",
    endpoint(async (req, res) => {
      const admin = await account(req, true);
      const p = z
        .object({
          amountSom: z.number().int().min(1).max(1000000000),
          previousId: z.number().int().positive().nullable(),
          reason: z.string().trim().min(5).max(300),
        })
        .strict()
        .parse(req.body);
      res.json({
        price: await service.setPrice(
          admin,
          p.amountSom * 100,
          p.previousId,
          p.reason
        ),
      });
    })
  );
  return router;
}
