import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  BillingService,
  ProviderError,
  fail,
  payTimeout,
  type Payment,
} from "./billingService";
import { readyProviders } from "./billingConfig";
import { rows } from "./store";

export function equalSecret(a: string, b: string) {
  // Fixed-length digest comparison; never compare credentials/signatures with ==.
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );
}
export function clickTiyin(value: string) {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    return fail(-31001, "Summa xato.");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
const ext = z.string().min(1).max(100);
const uuid = z.string().uuid();
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rpc = (p: Payment) => ({
  transaction: String(p.id),
  create_time: p.createTime,
  perform_time: p.performTime,
  cancel_time: p.cancelTime,
  state: p.state,
  reason: p.reason,
});
const rpcError = (error: ProviderError) => ({
  code: error.code,
  message: { uz: error.message, ru: error.message, en: error.message },
  ...(error.data ? { data: error.data } : {}),
});

async function payme(service: BillingService, method: string, raw: unknown) {
  const params = z.record(z.string(), z.unknown()).parse(raw);
  if (method === "GetStatement") {
    const { from, to } = z
      .object({ from: timestamp, to: timestamp })
      .parse(params);
    if (from > to) fail(-32600, "Davr xato.");
    // Returning an error instead of truncating keeps reconciliation complete.
    const items = await rows<Payment & { amountTiyin: number }>(
      service.store.pool,
      `SELECT t.*,o.amountTiyin FROM platform_billing_transactions t JOIN platform_billing_orders o ON o.id=t.orderId
       WHERE t.provider='payme' AND t.mode=? AND t.providerTime BETWEEN ? AND ? ORDER BY t.providerTime,t.id LIMIT 1001`,
      [service.settings.mode, from, to]
    );
    if (items.length > 1000) fail(-32600, "Kichikroq davr tanlang.");
    return {
      transactions: items.map(p => ({
        id: p.externalId,
        time: p.providerTime,
        amount: p.amountTiyin,
        account: { order_id: p.orderId },
        ...rpc(p),
      })),
    };
  }
  const initial = ["CheckPerformTransaction", "CreateTransaction"].includes(
    method
  );
  const allowed = [
    "CheckPerformTransaction",
    "CreateTransaction",
    "PerformTransaction",
    "CancelTransaction",
    "CheckTransaction",
  ];
  if (!allowed.includes(method)) fail(-32601, "Metod topilmadi.", method);
  const id =
    initial && method !== "CreateTransaction" ? "" : ext.parse(params.id);
  const existing = id ? await service.payment(id, "payme") : undefined;
  const account = initial
    ? z.object({ order_id: uuid }).safeParse(params.account)
    : null;
  if (initial && !account?.success)
    return fail(-31050, "Buyurtma topilmadi.", "order_id");
  const orderId =
    initial && account?.success ? account.data.order_id : existing?.orderId;
  if (!orderId) fail(-31003, "Tranzaksiya topilmadi.");
  if (existing && existing.orderId !== orderId)
    fail(-31050, "Buyurtma mos emas.", "order_id");
  return service.locked(orderId!, async (db, order, company) => {
    if (order.provider !== "payme")
      return fail(-31050, "To‘lov usuli mos emas.", "order_id");
    let payment = id ? await service.payment(id, "payme", db, true) : undefined;
    if (
      initial &&
      z.number().int().nonnegative().safe().parse(params.amount) !==
        order.amountTiyin
    )
      fail(-31001, "Summa mos emas.");
    if (
      payment?.state === 1 &&
      Date.now() - payment.providerTime >= payTimeout
    ) {
      payment = await service.cancel(db, order, company, payment, 4);
      if (method !== "CheckTransaction" && method !== "CancelTransaction")
        return new ProviderError(-31008, "Tranzaksiya muddati tugagan.");
    }
    if (method === "CheckTransaction") return rpc(payment!);
    if (method === "CancelTransaction") {
      const reason = z.number().int().min(1).max(5).parse(params.reason);
      return rpc(await service.cancel(db, order, company, payment!, reason));
    }
    if (method === "PerformTransaction") {
      if (
        payment!.state === 1 &&
        Date.now() - payment!.providerTime >= payTimeout
      )
        return new ProviderError(-31008, "Tranzaksiya muddati tugagan.");
      return rpc(await service.perform(db, order, company, payment!));
    }
    if (method === "CreateTransaction" && payment) {
      if (payment.state !== 1) fail(-31008, "Tranzaksiya yaratilmaydi.");
      return rpc(payment);
    }
    service.checkOrder(order, "payme", order.amountTiyin, company);
    if (method === "CheckPerformTransaction") return { allow: true };
    const time = timestamp.parse(params.time);
    if (Date.now() - time >= payTimeout || time > Date.now() + 300000)
      fail(-31008, "Tranzaksiya vaqti xato.");
    return rpc(await service.prepare(db, order, "payme", id, time));
  });
}

const clickSchema = z.object({
  click_trans_id: z.string().regex(/^\d{1,20}$/),
  service_id: z.string().regex(/^\d{1,20}$/),
  click_paydoc_id: z.string().regex(/^\d{1,20}$/),
  merchant_trans_id: uuid,
  merchant_prepare_id: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  amount: z.string().max(30),
  action: z.enum(["0", "1"]),
  error: z.string().regex(/^-?\d{1,5}$/),
  sign_time: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  sign_string: z.string().regex(/^[a-fA-F0-9]{32}$/),
});
const clickError = (e: ProviderError) =>
  e.code === -31001 ? -2 : e.code === -31050 ? -5 : e.code === -31003 ? -6 : -9;

export function billingCallbacks(service: BillingService) {
  const router = express.Router();
  router.post(
    "/payme",
    express.json({ type: ["application/json", "text/json"], limit: "16kb" }),
    async (req, res) => {
      const id =
        typeof req.body?.id === "number" || typeof req.body?.id === "string"
          ? req.body.id
          : null;
      try {
        const expected = `Basic ${Buffer.from(`Paycom:${service.settings.payme.key}`).toString("base64")}`;
        if (
          !readyProviders(service.settings).payme ||
          !equalSecret(req.headers.authorization ?? "", expected)
        )
          fail(-32504, "Ruxsat yo‘q.");
        const body = z
          .object({
            id: z.union([z.string().max(100), z.number()]),
            method: z.string().max(64),
            params: z.unknown(),
          })
          .parse(req.body);
        const result = await payme(service, body.method, body.params);
        if (result instanceof ProviderError) throw result;
        res.json({ jsonrpc: "2.0", id, result });
      } catch (e) {
        const error =
          e instanceof ProviderError
            ? e
            : new ProviderError(
                e instanceof z.ZodError ? -32600 : -32400,
                "So‘rovni bajarib bo‘lmadi."
              );
        res.json({ jsonrpc: "2.0", id, error: rpcError(error) });
      }
    }
  );
  router.post(
    "/click",
    express.urlencoded({ extended: false, limit: "8kb" }),
    async (req, res) => {
      let response: Record<string, unknown> = {};
      try {
        if (!readyProviders(service.settings).click)
          fail(-1, "Xizmat sozlanmagan.");
        const p = clickSchema.parse(req.body);
        response = {
          click_trans_id: p.click_trans_id,
          merchant_trans_id: p.merchant_trans_id,
        };
        if (p.action === "1" && !p.merchant_prepare_id)
          fail(-8, "Prepare ID kerak.");
        const sign = createHash("md5")
          .update(
            p.click_trans_id +
              p.service_id +
              service.settings.click.key +
              p.merchant_trans_id +
              (p.action === "1" ? p.merchant_prepare_id : "") +
              p.amount +
              p.action +
              p.sign_time
          )
          .digest("hex");
        if (
          p.service_id !== service.settings.click.serviceId ||
          !equalSecret(p.sign_string.toLowerCase(), sign)
        )
          fail(-1, "Imzo xato.");
        const amount = clickTiyin(p.amount);
        const existing = await service.payment(p.click_trans_id, "click");
        if (existing && existing.orderId !== p.merchant_trans_id)
          fail(-5, "Buyurtma mos emas.");
        const result = await service.locked(
          p.merchant_trans_id,
          async (db, order, company) => {
            if (order.provider !== "click")
              return fail(-31050, "To‘lov usuli mos emas.");
            if (order.amountTiyin !== amount) fail(-31001, "Summa mos emas.");
            let payment = await service.payment(
              p.click_trans_id,
              "click",
              db,
              true
            );
            if (p.action === "0") {
              if (Number(p.error) !== 0)
                return { error: -9, error_note: "To‘lov bekor qilingan." };
              if (payment?.state === 2)
                return { error: -4, error_note: "To‘lov bajarilgan." };
              if (payment && payment.state < 0)
                return { error: -9, error_note: "To‘lov bekor qilingan." };
              if (!payment) {
                service.checkOrder(order, "click", amount, company);
                payment = await service.prepare(
                  db,
                  order,
                  "click",
                  p.click_trans_id,
                  Date.now()
                );
              }
              return {
                merchant_prepare_id: payment.id,
                error: 0,
                error_note: "Success",
              };
            }
            if (!payment || String(payment.id) !== p.merchant_prepare_id)
              return { error: -6, error_note: "Tranzaksiya topilmadi." };
            if (payment.state === 2)
              return {
                merchant_confirm_id: payment.id,
                error: -4,
                error_note: "Already paid",
              };
            if (payment.state < 0)
              return { error: -9, error_note: "Cancelled" };
            if (Number(p.error) < 0) {
              await service.cancel(db, order, company, payment, 1);
              return { error: -9, error_note: "Cancelled" };
            }
            if (Number(p.error) !== 0)
              return { error: -8, error_note: "Invalid error status" };
            payment = await service.perform(db, order, company, payment);
            return {
              merchant_confirm_id: payment.id,
              error: 0,
              error_note: "Success",
            };
          }
        );
        res.json({ ...response, ...result });
      } catch (e) {
        const code =
          e instanceof ProviderError
            ? e.code > -100
              ? e.code
              : clickError(e)
            : e instanceof z.ZodError
              ? -8
              : -7;
        res.json({
          ...response,
          error: code,
          error_note: "So‘rovni bajarib bo‘lmadi.",
        });
      }
    }
  );
  router.all("/payme", (_req, res) =>
    res.json({
      jsonrpc: "2.0",
      id: null,
      error: rpcError(new ProviderError(-32300, "POST so‘rovi kerak.")),
    })
  );
  router.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (req.path === "/payme")
        res.json({
          jsonrpc: "2.0",
          id: null,
          error: rpcError(new ProviderError(-32700, "JSON xato.")),
        });
      else res.json({ error: -8, error_note: "Request error" });
    }
  );
  return router;
}
