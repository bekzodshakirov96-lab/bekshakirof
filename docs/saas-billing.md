# SaaS subscription billing (UZS)

This increment adds provider checkout, callback settlement and price management to the **separate platform process/database**. It does not access a firm's database or write to its Kassa, sales, KEG or debt ledgers. It is not an automatic recurring/card debit feature. No card data is accepted or stored.

## Operator setup

1. Keep `PLATFORM_BILLING_MODE=off` until the environment has been reviewed. This is the default. The original legacy company's deployment remains unchanged.
2. Back up the separate platform DB. For an existing platform run `npm run platform:ops -- billing-init` explicitly, using **only** its platform credentials. This creates four additive `platform_billing_*` tables; startup never migrates them. `platform:ops init` also creates them for a new empty platform. No business migration is involved.
3. Super admin → **Obuna va tarif** (`/super-admin/obuna`) sets the monthly price in whole UZS, with a mandatory audit reason. No initial price is invented. Each price is a new version. Stale simultaneous edits return 409. Existing orders retain their snapshotted price; paid history never changes when the tariff changes.
4. Put provider credentials in the platform's private environment, never Git, chat, the browser or a company runtime:

   ```text
   PLATFORM_BILLING_MODE=test
   PAYME_MERCHANT_ID=...
   PAYME_MERCHANT_KEY=...   # Payme TEST_KEY in a separate test environment
   CLICK_MERCHANT_ID=...
   CLICK_SERVICE_ID=...
   CLICK_MERCHANT_USER_ID=...
   CLICK_SECRET_KEY=...
   ```

   Mode `test` is refused in production; mode `live` is refused outside production. Missing provider credentials keep that provider disabled. Test orders/transactions are tagged and scoped to their mode. Never reuse a production company/platform DB for sandbox tests. Drain or reconcile all prepared transactions before changing merchant credentials/modes.
5. Configure the platform HTTPS endpoints in the merchant cabinets:
   - Payme Merchant API: `/api/platform/billing/callbacks/payme`. Account field: `order_id`, value from the checkout. Configure one-time orders, not an accumulating account. Payme HTTP Basic username is `Paycom`; the configured key is verified before any order lookup. JSON-RPC accepts `application/json` and `text/json`.
   - Click Shop API: `/api/platform/billing/callbacks/click` for both Prepare (action 0) and Complete (action 1). URL-encoded values are preserved for the documented MD5 signature. Service ID, amount, transaction ID and prepare ID are checked.
6. Obtain merchant approval and run each provider's actual sandbox acceptance suite against a **separate** test deployment. Confirm fiscalization/receipt requirements, tax/service classification and refund policy with the merchant setup. These business/fiscal details have not been supplied; fiscal callbacks and outbound Click Merchant API reversal/reconciliation are not enabled by this increment. Do not switch live mode until these checks are completed. The local signed callback tests do not replace provider acceptance.
7. After review, set real keys and `PLATFORM_BILLING_MODE=live` on the production **platform only**. This task does not deploy or enable live billing. Do not use the current development branch for the original firm's live service until its separate tenant-migration staging requirements are met.

## User flow

Verified owner → platform cabinet → **Obuna va to‘lovlar** → **Obunani to‘lash** → Payme or Click → provider checkout. The managed firm's owner menu links back to this platform cabinet. Price comes from the server. The browser cannot submit its own amount or another company ID. Opening a return URL does not mark an order paid; the cabinet refreshes the server's order state. Paid/cancelled/pending orders and granted dates remain in paginated history.

Only one pending order per company is offered at a time, across providers. Double clicks/retries reuse it. Before provider preparation the owner may cancel an unpaid order; after preparation only the provider protocol can resolve it. Repeated requests use a company-scoped idempotency key. An expired unprepared order is cancelled on the next checkout attempt.

## Settlement and cancellation

Amounts are stored as integer tiyin. Click's decimal UZS text is converted exactly; Payme amounts are already integer tiyin. Checkout links are generated server-side for fixed provider hosts; no arbitrary return or checkout host is accepted.

Callbacks authenticate independently of browser CSRF. Owner/admin endpoints retain the platform's exact-Origin and session/role checks. No callback can choose a company database. A company row lock serializes its order/grant changes. Provider/mode/transaction IDs and order grants have unique constraints. Only authenticated PerformTransaction / successful Complete extends access. Grant insertion, payment status, access deadline/revision and audit event commit together; retries cannot extend twice. Payment during a suspension never resumes access.

A payment adds **one Tashkent calendar month** after `max(now, accessUntil)`, preserving existing trial/manual/paid time. Payme supports CheckPerformTransaction, CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction and bounded, non-truncating GetStatement queries. Prepared Payme transactions expire after its documented 12-hour timeout when queried/performed. Pending unresolved provider transactions require reconciliation before creating another order; there is no blind timeout of a Click payment that may already have been debited.

Payme cancellation removes only that grant's unused time and shifts later grants earlier by that amount. Trial time, manual extensions and other payments remain; fully consumed service is refused with -31007. Repeated cancellation is idempotent. A failed Click Complete cancels an unperformed payment; a duplicate successful Complete returns -4 without granting again. Click post-settlement reversals and a scheduled remote reconciliation worker remain release prerequisites, not simulated refund actions in the cabinet.

## Evidence and references

Local tests use new restricted platform DB accounts/schemas on the explicitly configured disposable loopback SQL server. They cover role/CSRF/tenant boundaries, secret exclusion, price versions, concurrent order creation, callback signatures/amounts, duplicate settlement, timeout, failed/cancelled payments, suspension and preserving unrelated grants/manual extensions. No external checkout or real charge is executed by tests. A SHA-256 business-table manifest is compared before/after local review.

Primary protocol sources: [Payme Merchant API](https://developer.help.paycom.uz/metody-merchant-api/), [Payme sandbox and checkout hosts](https://developer.help.paycom.uz/pesochnitsa/), [Payme GET checkout](https://developer.help.paycom.uz/initsializatsiya-platezhey/otpravka-cheka-po-metodu-get/), [Click Shop API requests](https://docs.click.uz/shop-api/requests), [Click checkout links](https://docs.click.uz/click-button).

Local validation: 283 tests passed in 45 files with disposable SQL/HTTP suites enabled; final targeted billing tests (10 cases), TypeScript check and build passed after quote handling refinements. Browser checks verified the owner card, the managed owner's billing menu link, and the admin price/reason form (cancelled without assigning a price). The local sample firm's 24-table business fingerprint remained unchanged. All existing non-platform backend and Cash/FastKeg source hashes remained unchanged. No real payment, production connection, commit, push or deployment was performed.
