import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Server } from "node:http";
import mysql, { type Connection } from "mysql2/promise";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformStore, rows } from "./store";
import { createPlatformApi } from "./api";
import type { PlatformConfig } from "./config";
import { issueToken } from "./security";
import { trialEndAfterMonth } from "../../shared/platform";

// New schemas on the explicitly named disposable loopback SQL server only.
const sqlUrl = process.env.TENANT_ISOLATION_TEST_URL;
let root: Connection;
let store: PlatformStore;
let server: Server;
let base: string;
let adminCookie: string;
let ownerCookie: string;
let secondCookie: string;
const companyId = randomUUID();
const otherId = randomUUID();
const config: PlatformConfig = {
  databaseUrl: "",
  origin: "",
  production: false,
  mail: { mode: "local", apiKey: "", from: "", file: "unused" },
  billing: {
    mode: "test",
    payme: { merchantId: "local-test", key: "local-payme-key" },
    click: {
      merchantId: "123",
      serviceId: "456",
      merchantUserId: "789",
      key: "local-click-key",
    },
  },
};
const paymeAuth = `Basic ${Buffer.from("Paycom:local-payme-key").toString("base64")}`;
let counter = 0;
async function call(
  path: string,
  body?: unknown,
  cookie?: string,
  origin?: string
) {
  const r = await fetch(`${base}/api/platform${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin ?? base,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
async function payme(
  method: string,
  params: unknown,
  authorization = paymeAuth
) {
  return (
    await fetch(`${base}/api/platform/billing/callbacks/payme`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({ id: ++counter, method, params }),
    })
  ).json();
}
async function click(
  order: string,
  ext: string,
  action = "0",
  prepare?: string,
  error = "0",
  amount = "125000.00",
  badSign = false
) {
  const p: Record<string, string> = {
    click_trans_id: ext,
    service_id: "456",
    click_paydoc_id: "800",
    merchant_trans_id: order,
    amount,
    action,
    error,
    sign_time: "2026-10-17 12:00:00",
  };
  if (prepare) p.merchant_prepare_id = prepare;
  p.sign_string = createHash("md5")
    .update(
      ext +
        "456" +
        "local-click-key" +
        order +
        (action === "1" ? prepare : "") +
        amount +
        action +
        p.sign_time
    )
    .digest("hex");
  if (badSign) p.sign_string = "0".repeat(32);
  return (
    await fetch(`${base}/api/platform/billing/callbacks/click`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(p),
    })
  ).json();
}
const create = (provider = "payme", key = randomUUID(), cookie = ownerCookie) =>
  call("/billing/orders", { provider, requestKey: key }, cookie);
const company = () => store.company(companyId);
const pendingPrice = 12500000;

describe.skipIf(!sqlUrl)(
  "subscription billing with isolated SQL and signed HTTP callbacks",
  () => {
    beforeAll(async () => {
      const u = new URL(sqlUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(u.hostname) ||
        !u.port ||
        u.port === "3306"
      )
        throw Error("Disposable loopback SQL only");
      root = await mysql.createConnection(u.href);
      const suffix = randomBytes(5).toString("hex");
      const schema = `bc_bill_${suffix}`;
      await root.query("CREATE DATABASE ?? CHARACTER SET utf8mb4", [schema]);
      // Test-only DB account cannot access any firm database.
      const user = `bb_${suffix}`;
      const pass = randomBytes(20).toString("hex");
      await root.query("CREATE USER ?@? IDENTIFIED BY ?", [
        user,
        "%",
        pass,
      ]);
      await root.query("GRANT ALL ON ??.* TO ?@?", [schema, user, "%"]);
      u.username = user;
      u.password = pass;
      u.pathname = `/${schema}`;
      store = new PlatformStore(u.href);
      await store.initialize();
      await store.initialize();
      const now = Date.now();
      const ownerId = randomUUID();
      const adminId = randomUUID();
      const secondId = randomUUID();
      for (const [id, role] of [
        [ownerId, "owner"],
        [adminId, "super_admin"],
        [secondId, "owner"],
      ])
        await store.pool.query(
          "INSERT INTO platform_accounts (id,name,email,passwordHash,role,verifiedAt,createdAt) VALUES (?,?,?,'not-a-login',?,?,?)",
          [id, role, `${id}@example.test`, role, now, now]
        );
      for (const [id, owner] of [
        [companyId, ownerId],
        [otherId, secondId],
      ])
        await store.pool.query(
          "INSERT INTO platform_companies (id,name,slug,ownerId,phone,state,trialStart,trialEnd,accessUntil,createdAt) VALUES (?,?,?,?,'','ready',?,?,?,?)",
          [
            id,
            "Billing fixture",
            `bill-${id}`,
            owner,
            now,
            now + 86400000,
            now + 86400000,
            now,
          ]
        );
      const cookie = async (id: string) =>
        `bc_platform_dev=${await issueToken(store.pool, id, "session", 3600000)}`;
      ownerCookie = await cookie(ownerId);
      adminCookie = await cookie(adminId);
      secondCookie = await cookie(secondId);
      const app = express();
      app.use(
        "/api/platform",
        createPlatformApi(store, config, async () => {})
      );
      server = await new Promise<Server>(resolve => {
        const started = app.listen(0, "127.0.0.1", () => resolve(started));
      });
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      config.origin = base;
    }, 15000);
    afterAll(async () => {
      if (server)
        await new Promise<void>(r => {
          server.close(() => r());
          server.closeAllConnections();
        });
      if (store) await store.close();
      if (root) await root.end();
    });
    it("guards admin pricing, owner access, CSRF and secret exclusion", async () => {
      expect((await call("/billing")).status).toBe(401);
      expect(
        (await call("/admin/billing", undefined, ownerCookie)).status
      ).toBe(403);
      const input = {
        amountSom: 125000,
        previousId: null,
        reason: "Pilot tarifi",
      };
      expect(
        (await call("/admin/billing/price", input, ownerCookie)).status
      ).toBe(403);
      expect(
        (
          await call(
            "/admin/billing/price",
            input,
            adminCookie,
            "https://evil.test"
          )
        ).status
      ).toBe(403);
      expect((await create()).status).toBe(503); // no price yet
      expect(
        (await call("/admin/billing/price", input, adminCookie)).status
      ).toBe(200);
      expect(
        (await call("/admin/billing/price", input, adminCookie)).status
      ).toBe(409);
      const view = await call("/billing", undefined, ownerCookie);
      expect(view.data.price.amountTiyin).toBe(pendingPrice);
      expect(JSON.stringify(view.data)).not.toMatch(
        /local-payme-key|local-click-key|passwordHash/
      );
      expect(
        (
          await call(
            "/billing/orders",
            { provider: "payme", requestKey: randomUUID(), amountTiyin: 1 },
            ownerCookie
          )
        ).status
      ).toBe(400);
    });
    it("snapshots prices, creates idempotently, never activates from a return URL, and blocks another firm's order", async () => {
      const before = (await company())!.accessUntil;
      const key = randomUUID();
      const [a, b] = await Promise.all([
        create("payme", key),
        create("payme", key),
      ]);
      expect(a.data.orderId).toBe(b.data.orderId);
      const order = a.data.orderId;
      expect((await create("click")).status).toBe(409);
      expect(
        (await call(`/billing/orders/${order}/cancel`, {}, secondCookie)).status
      ).toBe(404);
      expect(
        (await call("/billing?payment=success", undefined, ownerCookie)).status
      ).toBe(200);
      expect((await company())!.accessUntil).toBe(before);
      expect(
        (await call("/billing", undefined, secondCookie)).data.orders
      ).toHaveLength(0);
      const current = (await call("/admin/billing", undefined, adminCookie))
        .data.price;
      await call(
        "/admin/billing/price",
        {
          amountSom: 150000,
          previousId: current.id,
          reason: "Tarif yangilandi",
        },
        adminCookie
      );
      expect(
        (await call("/billing", undefined, ownerCookie)).data.orders[0]
          .amountTiyin
      ).toBe(pendingPrice);
      expect(
        (
          await payme(
            "CheckPerformTransaction",
            { amount: pendingPrice, account: { order_id: order } },
            "Basic invalid"
          )
        ).error.code
      ).toBe(-32504);
      expect(
        (
          await payme("CheckPerformTransaction", {
            amount: 1,
            account: { order_id: order },
          })
        ).error.code
      ).toBe(-31001);
      expect(
        (
          await payme("CheckPerformTransaction", {
            amount: pendingPrice,
            account: { order_id: order },
          })
        ).result.allow
      ).toBe(true);
    });
    it("settles Payme exactly once, serializes concurrent callbacks and reverses only its grant", async () => {
      const order = (await call("/billing", undefined, ownerCookie)).data
        .orders[0].id;
      const before = (await company())!;
      const params = {
        id: "payme-one",
        time: Date.now(),
        amount: pendingPrice,
        account: { order_id: order },
      };
      const [a, b] = await Promise.all([
        payme("CreateTransaction", params),
        payme("CreateTransaction", params),
      ]);
      expect(a.result.transaction).toBe(b.result.transaction);
      expect(
        (await call(`/billing/orders/${order}/cancel`, {}, ownerCookie)).status
      ).toBe(409);
      const done = await Promise.all(
        Array.from({ length: 4 }, () =>
          payme("PerformTransaction", { id: params.id })
        )
      );
      expect(done.every(x => x.result.state === 2)).toBe(true);
      expect((await company())!.accessUntil).toBe(
        trialEndAfterMonth(before.accessUntil!)
      );
      expect((await company())!.trialEnd).toBe(before.trialEnd);
      expect(
        (await payme("CheckTransaction", { id: params.id })).result.state
      ).toBe(2);
      const statement = await payme("GetStatement", {
        from: params.time - 1,
        to: Date.now() + 1,
      });
      expect(statement.result.transactions[0].account.order_id).toBe(order);
      const cancelled = await payme("CancelTransaction", {
        id: params.id,
        reason: 1,
      });
      expect(cancelled.result.state).toBe(-2);
      expect((await company())!.accessUntil).toBe(before.accessUntil);
      await payme("CancelTransaction", { id: params.id, reason: 1 });
      expect((await company())!.accessUntil).toBe(before.accessUntil);
      expect(
        (await payme("PerformTransaction", { id: params.id })).error.code
      ).toBe(-31008);
    });
    it("handles Payme timeouts, unknown methods and malformed payloads without granting access", async () => {
      const price = (await call("/admin/billing", undefined, adminCookie)).data
        .price;
      const order = (await create()).data.orderId;
      const before = (await company())!.accessUntil;
      const params = {
        id: "payme-timeout",
        time: Date.now(),
        amount: price.amountTiyin,
        account: { order_id: order },
      };
      expect((await payme("CreateTransaction", params)).result.state).toBe(1);
      await store.pool.query(
        "UPDATE platform_billing_transactions SET providerTime=? WHERE externalId=?",
        [Date.now() - 43200001, params.id]
      );
      expect(
        (await payme("PerformTransaction", { id: params.id })).error.code
      ).toBe(-31008);
      expect(
        (await payme("CheckTransaction", { id: params.id })).result
      ).toMatchObject({ state: -1, reason: 4 });
      expect((await payme("Unrecognized", {})).error.code).toBe(-32601);
      expect(
        (
          await payme("CheckPerformTransaction", {
            amount: 15000000,
            account: { order_id: "missing-order" },
          })
        ).error.code
      ).toBe(-31050);
      expect((await payme("PerformTransaction", {})).error.code).toBe(-32600);
      expect((await company())!.accessUntil).toBe(before);
      const malformed = await fetch(
        `${base}/api/platform/billing/callbacks/payme`,
        {
          method: "POST",
          headers: {
            Authorization: paymeAuth,
            "Content-Type": "application/json",
          },
          body: "{",
        }
      );
      expect((await malformed.json()).error.code).toBe(-32700);
    });
    it("validates Click signatures/amount/prepare ID and settles only a signed Complete once", async () => {
      // The current price is 150,000; callbacks deliberately use that exact text.
      const order = (await create("click")).data.orderId;
      const before = (await company())!.accessUntil;
      expect(
        (await click(order, "100", "0", undefined, "0", "150000.00", true))
          .error
      ).toBe(-1);
      expect(
        (await click(order, "100", "0", undefined, "0", "1.00")).error
      ).toBe(-2);
      const prepared = await click(
        order,
        "100",
        "0",
        undefined,
        "0",
        "150000.00"
      );
      expect(prepared.error).toBe(0);
      expect((await company())!.accessUntil).toBe(before);
      expect(
        (await click(order, "100", "1", "999999", "0", "150000.00")).error
      ).toBe(-6);
      const id = String(prepared.merchant_prepare_id);
      const done = await Promise.all([
        click(order, "100", "1", id, "0", "150000.00"),
        click(order, "100", "1", id, "0", "150000.00"),
      ]);
      expect(done.map(x => x.error).sort()).toEqual([-4, 0]);
      expect((await company())!.accessUntil).toBe(trialEndAfterMonth(before!));
      const view = (await call("/billing", undefined, ownerCookie)).data;
      expect(
        view.orders.find((o: { id: string }) => o.id === order).state
      ).toBe("paid");
    });
    it("keeps suspension in place and cancels failed Click completions without granting access", async () => {
      const order = (await create("click")).data.orderId;
      const before = (await company())!.accessUntil;
      const prepared = await click(
        order,
        "101",
        "0",
        undefined,
        "0",
        "150000.00"
      );
      expect(
        (
          await click(
            order,
            "101",
            "1",
            String(prepared.merchant_prepare_id),
            "-1",
            "150000.00"
          )
        ).error
      ).toBe(-9);
      expect((await company())!.accessUntil).toBe(before);
      await store.pool.query(
        "UPDATE platform_companies SET state='suspended' WHERE id=?",
        [companyId]
      );
      expect((await create()).status).toBe(409);
      await store.pool.query(
        "UPDATE platform_companies SET state='ready' WHERE id=?",
        [companyId]
      );
      const tables = await rows<Record<string, string>>(
        store.pool,
        "SHOW TABLES"
      );
      expect(
        tables.every(t => Object.values(t)[0].startsWith("platform_"))
      ).toBe(true);
    });
    it("does not lift a suspension when a prepared payment completes", async () => {
      const order = (await create()).data.orderId;
      const params = {
        id: "suspended-payment",
        time: Date.now(),
        amount: 15000000,
        account: { order_id: order },
      };
      await payme("CreateTransaction", params);
      await store.pool.query(
        "UPDATE platform_companies SET state='suspended' WHERE id=?",
        [companyId]
      );
      expect(
        (await payme("PerformTransaction", { id: params.id })).result.state
      ).toBe(2);
      expect((await company())!.state).toBe("suspended");
      await store.pool.query(
        "UPDATE platform_companies SET state='ready' WHERE id=?",
        [companyId]
      );
    });
    it("preserves later grants, manual extensions and other companies during a refund", async () => {
      const beforeOther = (await store.company(otherId))!.accessUntil;
      const paid = async (id: string) => {
        const order = (await create()).data.orderId;
        await payme("CreateTransaction", {
          id,
          time: Date.now(),
          amount: 15000000,
          account: { order_id: order },
        });
        await payme("PerformTransaction", { id });
        return order;
      };
      const first = await paid("refund-first");
      const second = await paid("refund-second");
      const [firstGrant] = await rows<{ startAt: number; endAt: number }>(
        store.pool,
        "SELECT startAt,endAt FROM platform_billing_grants WHERE orderId=?",
        [first]
      );
      const [secondGrant] = await rows<{ startAt: number; endAt: number }>(
        store.pool,
        "SELECT startAt,endAt FROM platform_billing_grants WHERE orderId=?",
        [second]
      );
      const prior = (await company())!;
      expect(
        (
          await call(
            `/admin/companies/${companyId}`,
            {
              action: "extend",
              revision: prior.revision,
              reason: "Manual seven-day extension",
              days: 7,
            },
            adminCookie
          )
        ).status
      ).toBe(200);
      const extended = (await company())!.accessUntil!;
      await payme("CancelTransaction", { id: "refund-first", reason: 1 });
      const length = firstGrant.endAt - firstGrant.startAt;
      expect((await company())!.accessUntil).toBe(extended - length);
      const [shifted] = await rows<{ startAt: number; endAt: number }>(
        store.pool,
        "SELECT startAt,endAt FROM platform_billing_grants WHERE orderId=?",
        [second]
      );
      expect(shifted).toEqual({
        startAt: secondGrant.startAt - length,
        endAt: secondGrant.endAt - length,
      });
      expect((await store.company(otherId))!.accessUntil).toBe(beforeOther);
    });
    it("recovers abandoned prepared Click payments only after verified admin reconciliation", async () => {
      const price = (await call("/admin/billing", undefined, adminCookie)).data.price;
      const amount = (price.amountTiyin / 100).toFixed(2);
      const id = (await create("click")).data.orderId;
      const prepared = await click(id, "99000001", "0", undefined, "0", amount);
      expect(prepared.error).toBe(0);
      await store.pool.query("UPDATE platform_billing_orders SET expiresAt=? WHERE id=?", [Date.now() - 1, id]);
      const beforeAccess = (await company())!.accessUntil;
      const beforeOther = (await store.company(otherId))!.accessUntil;
      expect((await create("click")).status).toBe(409);
      expect((await create("payme")).status).toBe(409);
      const view = (await call("/billing", undefined, ownerCookie)).data;
      expect(view.orders.find((o: { id: string }) => o.id === id)).toMatchObject({ needsReview: true });
      expect(view.orders.find((o: { id: string }) => o.id === id).checkoutUrl).toBeUndefined();
      expect((await call("/admin/billing/review", undefined, ownerCookie)).status).toBe(403);
      expect((await call("/admin/billing/review", undefined, adminCookie)).data.items.some((o: { id: string }) => o.id === id)).toBe(true);
      const resolve = { id, transactionId: Number(prepared.merchant_prepare_id), externalId: "99000001", mode: "test",
        outcome: "cancelled", reference: "Provider final cancellation test receipt", providerVerified: true };
      expect((await call("/admin/billing/reconcile", resolve, ownerCookie)).status).toBe(403);
      expect((await call("/admin/billing/reconcile", { ...resolve, providerVerified: false }, adminCookie)).status).toBe(400);
      expect((await call("/admin/billing/reconcile", { ...resolve, externalId: "wrong" }, adminCookie)).status).toBe(409);
      expect((await call("/admin/billing/reconcile", resolve, adminCookie)).status).toBe(200);
      expect((await call("/admin/billing/reconcile", resolve, adminCookie)).status).toBe(200);
      expect((await company())!.accessUntil).toBe(beforeAccess);
      expect((await click(id, "99000001", "1", String(prepared.merchant_prepare_id), "0", amount)).error).toBe(-9);
      const replacement = await create("payme");
      expect(replacement.status).toBe(200);
      expect(replacement.data.orderId).not.toBe(id);
      await call(`/billing/orders/${replacement.data.orderId}/cancel`, {}, ownerCookie);

      const paidId = (await create("click")).data.orderId;
      const paidPrep = await click(paidId, "99000002", "0", undefined, "0", amount);
      await store.pool.query("UPDATE platform_billing_orders SET expiresAt=? WHERE id=?", [Date.now() - 1, paidId]);
      const paid = { ...resolve, id: paidId, transactionId: Number(paidPrep.merchant_prepare_id),
        externalId: "99000002", outcome: "paid", reference: "Provider confirmed paid test receipt" };
      const results = await Promise.all([
        call("/admin/billing/reconcile", paid, adminCookie),
        call("/admin/billing/reconcile", paid, adminCookie),
        click(paidId, "99000002", "1", String(paidPrep.merchant_prepare_id), "0", amount),
      ]);
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);
      expect([0, -4]).toContain(results[2].error);
      expect((await company())!.accessUntil).toBe(trialEndAfterMonth(beforeAccess!));
      expect((await store.company(otherId))!.accessUntil).toBe(beforeOther);
      const [grants] = await rows<{ n: number }>(store.pool, "SELECT COUNT(*) n FROM platform_billing_grants WHERE orderId=?", [paidId]);
      expect(grants.n).toBe(1);
    });
  }
);
