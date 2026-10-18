import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type {
  BillingOrder,
  BillingProvider,
  BillingView,
} from "../../shared/billing";
import {
  trialEndAfterMonth,
  type Company,
  type PlatformAccount,
} from "../../shared/platform";
import type { PlatformConfig } from "./config";
import { billingOff, readyProviders } from "./billingConfig";
import { PlatformError } from "./security";
import { PlatformStore, rows, type Sql } from "./store";

export type Order = BillingOrder & {
  activeTxn: number | null;
  priceId: number;
};
export type Payment = {
  id: number;
  orderId: string;
  provider: BillingProvider;
  externalId: string;
  providerTime: number;
  state: number;
  createTime: number;
  performTime: number;
  cancelTime: number;
  reason: number | null;
};
export class ProviderError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: string
  ) {
    super(message);
  }
}
export const fail = (code: number, text: string, data?: string): never => {
  throw new ProviderError(code, text, data);
};
export const payTimeout = 12 * 60 * 60 * 1000;

export class BillingService {
  readonly settings;
  constructor(
    readonly store: PlatformStore,
    readonly config: PlatformConfig
  ) {
    this.settings = config.billing ?? billingOff;
  }
  price(db: Sql = this.store.pool) {
    return rows<{ id: number; amountTiyin: number }>(
      db,
      "SELECT id,amountTiyin FROM platform_billing_prices ORDER BY id DESC LIMIT 1"
    ).then(items => items[0] ?? null);
  }
  async setPrice(
    admin: PlatformAccount,
    amountTiyin: number,
    previousId: number | null,
    reason: string
  ) {
    if (admin.role !== "super_admin" || !admin.verified)
      throw new PlatformError(403, "Faqat super admin uchun.");
    return this.store.transaction(async db => {
      await db.query("SELECT id FROM platform_identity WHERE id=1 FOR UPDATE");
      if ((await this.price(db))?.id !== (previousId ?? undefined))
        throw new PlatformError(409, "Narx o‘zgargan. Sahifani yangilang.");
      await db.query(
        "INSERT INTO platform_billing_prices (amountTiyin,createdBy,createdAt) VALUES (?,?,?)",
        [amountTiyin, admin.id, Date.now()]
      );
      await this.store.event(
        db,
        null,
        admin,
        "billing_price_changed",
        `${amountTiyin / 100} UZS/oy. ${reason}`
      );
      return this.price(db);
    });
  }
  async companyFor(account: PlatformAccount) {
    if (account.role !== "owner" || !account.verified)
      throw new PlatformError(403, "Tasdiqlangan firma egasi uchun.");
    const [row] = await rows<{ id: string }>(
      this.store.pool,
      "SELECT id FROM platform_companies WHERE ownerId=?",
      [account.id]
    );
    if (!row) throw new PlatformError(404, "Firma topilmadi.");
    return (await this.store.company(row.id))!;
  }
  checkout(
    order: Pick<BillingOrder, "id" | "amountTiyin" | "provider" | "mode">
  ) {
    const back = `${this.config.origin}/platforma?payment=${order.id}`;
    if (order.provider === "payme") {
      const params = `m=${this.settings.payme.merchantId};ac.order_id=${order.id};a=${order.amountTiyin};l=uz;c=${back}`;
      return `https://${order.mode === "test" ? "test.paycom.uz" : "checkout.paycom.uz"}/${Buffer.from(params).toString("base64")}`;
    }
    const params = new URLSearchParams({
      service_id: this.settings.click.serviceId,
      merchant_id: this.settings.click.merchantId,
      ...(this.settings.click.merchantUserId
        ? { merchant_user_id: this.settings.click.merchantUserId }
        : {}),
      amount: (order.amountTiyin / 100).toFixed(2),
      transaction_param: order.id,
      return_url: back,
    });
    return `https://my.click.uz/services/pay/?${params}`;
  }
  async view(account: PlatformAccount, page: number): Promise<BillingView> {
    const company = await this.companyFor(account);
    const [{ total }] = await rows<{ total: number }>(
      this.store.pool,
      "SELECT COUNT(*) total FROM platform_billing_orders WHERE companyId=?",
      [company.id]
    );
    const pageCount = Math.max(1, Math.ceil(total / 10));
    page = Math.min(page, pageCount);
    const items = await rows<Order>(
      this.store.pool,
      `SELECT o.*,g.startAt periodStart,g.endAt periodEnd FROM platform_billing_orders o LEFT JOIN platform_billing_grants g ON g.orderId=o.id
       WHERE o.companyId=? ORDER BY o.createdAt DESC,o.id DESC LIMIT 10 OFFSET ?`,
      [company.id, (page - 1) * 10]
    );
    const providers = readyProviders(this.settings);
    const [pendingOrder] = await rows<
      Pick<BillingOrder, "id" | "provider" | "amountTiyin" | "mode">
    >(
      this.store.pool,
      "SELECT id,provider,amountTiyin,mode FROM platform_billing_orders WHERE companyId=? AND state='pending' AND (expiresAt>? OR activeTxn IS NOT NULL) ORDER BY createdAt DESC LIMIT 1",
      [company.id, Date.now()]
    );
    return {
      pendingOrder: pendingOrder ?? null,
      mode: this.settings.mode,
      price: await this.price(),
      providers,
      total,
      page,
      pageCount,
      orders: items.map(o => ({
        id: o.id,
        companyId: o.companyId,
        provider: o.provider,
        mode: o.mode,
        amountTiyin: o.amountTiyin,
        state: o.state,
        createdAt: o.createdAt,
        expiresAt: o.expiresAt,
        paidAt: o.paidAt,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
        ...(o.state === "pending" &&
        (o.expiresAt > Date.now() || o.activeTxn) &&
        o.mode === this.settings.mode &&
        providers[o.provider]
          ? { checkoutUrl: this.checkout(o) }
          : {}),
      })),
    };
  }
  async create(
    account: PlatformAccount,
    provider: BillingProvider,
    requestKey: string
  ) {
    if (!readyProviders(this.settings)[provider])
      throw new PlatformError(503, "To‘lov xizmati hali sozlanmagan.");
    const owner = await this.companyFor(account);
    return this.store.transaction(async db => {
      const company = (await this.store.company(owner.id, db, true))!;
      if (company.state !== "ready")
        throw new PlatformError(
          409,
          "Firma tayyor bo‘lgach to‘lash mumkin. To‘xtatilgan kirish uchun administratorga murojaat qiling."
        );
      const [prior] = await rows<Order>(
        db,
        "SELECT * FROM platform_billing_orders WHERE companyId=? AND requestKey=?",
        [company.id, requestKey]
      );
      if (prior) {
        if (prior.provider !== provider || prior.mode !== this.settings.mode)
          throw new PlatformError(
            409,
            "Buyurtma kaliti allaqachon ishlatilgan."
          );
        if (
          prior.state !== "pending" ||
          (prior.expiresAt <= Date.now() && !prior.activeTxn)
        )
          throw new PlatformError(
            409,
            "Buyurtma muddati tugagan. Yangisini yarating."
          );
        return {
          orderId: prior.id,
          amountTiyin: prior.amountTiyin,
          checkoutUrl: this.checkout(prior),
        };
      }
      await db.query(
        "UPDATE platform_billing_orders SET state='cancelled' WHERE companyId=? AND state='pending' AND activeTxn IS NULL AND expiresAt<=?",
        [company.id, Date.now()]
      );
      const [pending] = await rows<Order>(
        db,
        "SELECT * FROM platform_billing_orders WHERE companyId=? AND state='pending' LIMIT 1",
        [company.id]
      );
      if (pending) {
        if (
          pending.provider !== provider ||
          pending.mode !== this.settings.mode
        )
          throw new PlatformError(
            409,
            "Avval ochiq to‘lovni yakunlang yoki bekor qiling."
          );
        return {
          orderId: pending.id,
          amountTiyin: pending.amountTiyin,
          checkoutUrl: this.checkout(pending),
        };
      }
      const price = await this.price(db);
      if (!price)
        throw new PlatformError(503, "Obuna narxi hali belgilanmagan.");
      const id = randomUUID();
      const now = Date.now();
      await db.query(
        "INSERT INTO platform_billing_orders (id,companyId,priceId,provider,mode,amountTiyin,state,requestKey,createdAt,expiresAt) VALUES (?,?,?,?,?,?,'pending',?,?,?)",
        [
          id,
          company.id,
          price.id,
          provider,
          this.settings.mode,
          price.amountTiyin,
          requestKey,
          now,
          now + 86400000,
        ]
      );
      await this.store.event(
        db,
        company.id,
        account,
        "billing_order_created",
        `${id}: ${provider}, ${price.amountTiyin / 100} UZS (${this.settings.mode})`
      );
      return {
        orderId: id,
        amountTiyin: price.amountTiyin,
        checkoutUrl: this.checkout({
          id,
          provider,
          mode: this.settings.mode,
          amountTiyin: price.amountTiyin,
        }),
      };
    });
  }
  async cancelUnpaid(account: PlatformAccount, id: string) {
    const owner = await this.companyFor(account);
    await this.store.transaction(async db => {
      await this.store.company(owner.id, db, true);
      const [order] = await rows<Order>(
        db,
        "SELECT * FROM platform_billing_orders WHERE id=? AND companyId=? FOR UPDATE",
        [id, owner.id]
      );
      if (!order) throw new PlatformError(404, "Buyurtma topilmadi.");
      if (order.state !== "pending" || order.activeTxn)
        throw new PlatformError(
          409,
          "To‘lov provayderda boshlangan yoki tugagan. Provayderdagi holatni tekshiring."
        );
      await db.query(
        "UPDATE platform_billing_orders SET state='cancelled' WHERE id=?",
        [id]
      );
      await this.store.event(
        db,
        owner.id,
        account,
        "billing_order_cancelled",
        id
      );
    });
  }
  async payment(
    externalId: string,
    provider: BillingProvider,
    db: Sql = this.store.pool,
    lock = false
  ) {
    return (
      await rows<Payment>(
        db,
        `SELECT * FROM platform_billing_transactions WHERE provider=? AND mode=? AND externalId=?${lock ? " FOR UPDATE" : ""}`,
        [provider, this.settings.mode, externalId]
      )
    )[0];
  }
  async locked<T>(
    id: string,
    fn: (db: PoolConnection, order: Order, company: Company) => Promise<T>
  ): Promise<T> {
    return this.store.transaction(async db => {
      const [hint] = await rows<Order>(
        db,
        "SELECT * FROM platform_billing_orders WHERE id=?",
        [id]
      );
      if (!hint) return fail(-31050, "Buyurtma topilmadi.", "order_id");
      const company = (await this.store.company(hint.companyId, db, true))!;
      const [order] = await rows<Order>(
        db,
        "SELECT * FROM platform_billing_orders WHERE id=? FOR UPDATE",
        [id]
      );
      if (order.mode !== this.settings.mode)
        return fail(-31050, "To‘lov muhiti mos emas.", "order_id");
      return fn(db, order, company);
    });
  }
  checkOrder(
    order: Order,
    provider: BillingProvider,
    amountTiyin: number,
    company: Company
  ) {
    if (order.provider !== provider)
      fail(-31050, "To‘lov usuli mos emas.", "order_id");
    if (order.amountTiyin !== amountTiyin) fail(-31001, "Summa mos emas.");
    if (
      company.state !== "ready" ||
      order.state !== "pending" ||
      (!order.activeTxn && order.expiresAt <= Date.now())
    )
      fail(-31008, "Buyurtma to‘lov uchun ochiq emas.");
  }
  async prepare(
    db: Sql,
    order: Order,
    provider: BillingProvider,
    externalId: string,
    providerTime: number
  ) {
    if (order.activeTxn) fail(-31008, "Buyurtma boshqa tranzaksiyaga band.");
    await db.query(
      "INSERT INTO platform_billing_transactions (orderId,provider,mode,externalId,providerTime,state,createTime) VALUES (?,?,?,?,?,1,?)",
      [
        order.id,
        provider,
        this.settings.mode,
        externalId,
        providerTime,
        Date.now(),
      ]
    );
    const payment = (await this.payment(externalId, provider, db))!;
    await db.query(
      "UPDATE platform_billing_orders SET activeTxn=? WHERE id=?",
      [payment.id, order.id]
    );
    return payment;
  }
  async perform(db: Sql, order: Order, company: Company, payment: Payment) {
    if (payment.state === 2) return payment;
    if (
      payment.state !== 1 ||
      order.state !== "pending" ||
      order.activeTxn !== payment.id
    )
      fail(-31008, "Tranzaksiya faol emas.");
    const now = Date.now();
    const start = Math.max(now, company.accessUntil ?? 0);
    const end = trialEndAfterMonth(start);
    await db.query(
      "INSERT INTO platform_billing_grants (orderId,companyId,startAt,endAt) VALUES (?,?,?,?)",
      [order.id, company.id, start, end]
    );
    await db.query(
      "UPDATE platform_companies SET accessUntil=?,revision=revision+1 WHERE id=?",
      [end, company.id]
    );
    await db.query(
      "UPDATE platform_billing_orders SET state='paid',paidAt=? WHERE id=?",
      [now, order.id]
    );
    await db.query(
      "UPDATE platform_billing_transactions SET state=2,performTime=? WHERE id=?",
      [now, payment.id]
    );
    await this.store.event(
      db,
      company.id,
      null,
      "billing_paid",
      `${order.id}: ${order.provider}, ${order.amountTiyin / 100} UZS (${order.mode})`
    );
    return { ...payment, state: 2, performTime: now };
  }
  async cancel(
    db: Sql,
    order: Order,
    company: Company,
    payment: Payment,
    reason: number
  ) {
    if (payment.state < 0) return payment;
    const now = Date.now();
    const state = payment.state === 2 ? -2 : -1;
    if (payment.state === 2) {
      const [grant] = await rows<{ startAt: number; endAt: number }>(
        db,
        "SELECT startAt,endAt FROM platform_billing_grants WHERE orderId=? AND revokedAt IS NULL FOR UPDATE",
        [order.id]
      );
      if (!grant || grant.endAt <= now)
        fail(-31007, "Xizmat to‘liq taqdim etilgan.");
      const remaining = grant.endAt - Math.max(now, grant.startAt);
      // Remove only this payment's unused time. Preserve trial, manual
      // extensions and later paid grants, which shift earlier by that time.
      await db.query(
        "UPDATE platform_billing_grants SET startAt=startAt-?,endAt=endAt-? WHERE companyId=? AND revokedAt IS NULL AND startAt>=? AND orderId<>?",
        [remaining, remaining, company.id, grant.endAt, order.id]
      );
      await db.query(
        "UPDATE platform_billing_grants SET revokedAt=? WHERE orderId=?",
        [now, order.id]
      );
      await db.query(
        "UPDATE platform_companies SET accessUntil=?,revision=revision+1 WHERE id=?",
        [Math.max(now, (company.accessUntil ?? now) - remaining), company.id]
      );
    }
    await db.query(
      "UPDATE platform_billing_orders SET state='cancelled' WHERE id=?",
      [order.id]
    );
    await db.query(
      "UPDATE platform_billing_transactions SET state=?,cancelTime=?,reason=? WHERE id=?",
      [state, now, reason, payment.id]
    );
    await this.store.event(
      db,
      company.id,
      null,
      "billing_cancelled",
      `${order.id}: sabab ${reason}`
    );
    return { ...payment, state, cancelTime: now, reason };
  }
}
