# SaaS stage 2: registration and platform administration

Status: implemented locally; not deployed or enabled for the existing company.

Current business runtimes additionally require the explicit `tenant_id` scope migration described in [saas-tenant-query-scope.md](saas-tenant-query-scope.md). New-company preparation includes it automatically; already bound business databases must be prepared explicitly before deploying this build. The platform database is unchanged by that migration.

## What is implemented

- Separate Node entry point, MySQL database/account and hostname for the control plane. It has **no company database credentials or business tRPC/uploads routes**.
- `/platforma/royxat`: owner + company creation in one transaction, unique email and company code, one company per account, fixed `owner` role. No public route grants super admin.
- Email verification with hashed, expiring, one-use tokens; resend after delivery failure. Account creation remains saved if email delivery fails.
- Platform sign-in/logout and password reset. Opaque server-side sessions are separate from company JWTs. Password reset invalidates platform sessions and outstanding login tickets. Existing business sessions use the company's own logout/session revocation; platform password reset is not a global logout from already-open business sessions.
- Owner dashboard: email/provisioning progress, trial dates, actual access deadline and company launch.
- Super admin `/super-admin`: real company counts, search, state filters, pagination, detail, suspension/resumption, explicit access extensions with mandatory reason, last 100 company audit events. Optimistic revision checks prevent stale tabs overwriting another operator's action.
- One **calendar month in Asia/Tashkent** starts on provisioning, never on initial registration. End-of-month and leap years are clamped. Trial cannot restart. Extension changes access deadline, not original trial dates; it does not record a payment.
- One-use 60-second company launch ticket submitted by POST; company-specific runtime credential redeems it. Company DB gets its own `users.id=1` owner and non-disclosed random password; no shared DB and no reusable cross-company JWT. Super admin cannot launch a company as its owner.
- Managed new-company runtimes enforce entitlement for **all business tRPC routes and uploads**, not just UI. Suspension reaches the runtime within at most 15 seconds. Expiry is exact; failed checks fail closed. Legacy runtime is never automatically enrolled in trial limits.

Subscription checkout and admin-managed prices are now implemented separately; see [billing setup and release boundaries](saas-billing.md). Live charging remains off pending merchant/fiscal setup and provider acceptance. Automatic Railway/database/volume/DNS provisioning, MFA, company invitations and a central multi-firm membership switcher are not part of this increment. Company employees still use their existing firm-local accounts/roles. No business financial calculations were changed.

## Architecture and trust boundaries

```
Platform domain                          Company domain (one per firm)
React /platforma, /super-admin            Existing React business UI
       |                                        |
Platform REST API                        Company tRPC + uploads gate
       |                         access/redeem  |
platform_* tables <-----------------------------+
separate DB/account                      separate DB/account/JWT/volume
```

Platform accounts have `owner` or `super_admin`; these roles are unrelated to a company's `users.role`. Browser body/headers never select a company database. DB URLs are only accepted by an operator CLI environment. Super admin HTTP routes cannot read or mutate cash, stock, client, sales or debt records.

The platform database has `platform_identity`, `platform_accounts`, `platform_companies`, `platform_tokens`, and `platform_events`. `platform:ops init` refuses any non-platform table. Startup validates the identity. There is deliberately no delete company button/route.

Same-origin JSON POSTs are required for every cookie-authenticated mutation, including sign-in and sign-up. Company runtime endpoints use a different, company-scoped bearer credential and no browser cookie. Production platform cookies are `__Host-`, Secure, HttpOnly, SameSite Strict, Path `/`, no Domain. Verification/reset tokens live in URL fragments until the UI removes them and submits explicit POST; GET/email link scanning cannot consume them. Password/token/SQL values are not logged by these APIs. The platform development server disables the pre-existing session-replay/debug collector.

## Platform setup (operator)

1. Provision a separate empty MySQL database and account with rights only on that schema. Never use the existing company's `DATABASE_URL` or credentials.
2. Configure privately: `PLATFORM_DATABASE_URL`, `PLATFORM_ORIGIN` (bare HTTPS origin), `PLATFORM_MAIL_MODE=resend`, `RESEND_API_KEY`, `PLATFORM_MAIL_FROM` (verified sender). Production refuses local mail. Do not change the existing production environment.
3. Run `npm run platform:ops -- init` explicitly. Startup never initializes schemas automatically.
4. Set `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` (16–72 UTF-8 bytes) in the operator environment, run `npm run platform:ops -- admin`, then remove the bootstrap password from the long-running server environment. The command refuses to promote/overwrite any existing account.
5. Build using `npm run build`. A separate platform service starts with `NODE_ENV=production node dist/platform.js`, `PORT` set by hosting. Route the configured platform domain to this service. `/health` is its health endpoint. Configure proxy to preserve the canonical Host; do not expose the service behind untrusted forwarding headers.
6. Open `/super-admin`, sign in, and verify the UI against actual database state. The original production site remains a business service running `dist/index.js`.

Resend adapter uses its official [Send Email API](https://resend.com/docs/api-reference/emails/send-email). No mail is sent to real recipients by local tests; production delivery still needs a verified sender, credentials and a successful real verification/reset delivery check.

## New-company preparation (operator)

Infrastructure provisioning is deliberately explicit in this increment. A registered owner sees `Email tasdiqlanmagan`, then `Firma tayyorlanmoqda`; the panel never falsely marks an uncreated runtime as ready.

1. Confirm the company is in provisioning state. Create its own DB/account and apply **only the empty schema from the current version** (`drizzle/schema.ts`) there. No seed/import/legacy copy. Create its own runtime, persistent uploads volume and HTTPS hostname. Keep the runtime stopped until its DB is bound.
2. In an operator environment with platform credentials, set `NEW_COMPANY_DATABASE_URL` to this empty company DB. The URL must use the company-specific DB user, not the server root account.
3. Run:

   ```text
   npm run platform:ops -- provision --company COMPANY_UUID --origin https://company.example.uz --out /private/company.env.local
   ```

   Output must be a new, private, ignored `.env.local` file. Keep it outside source control, set appropriate Windows ACLs/Unix permissions. It contains company DB URL, JWT key, runtime credential, fixed tenant ID/host and platform URL. Secrets are not printed. The platform stores only the runtime key hash, no DB credentials.

4. The command verifies the **complete** schema and zero business records, binds identity, creates only this firm's owner, writes its private runtime env file exclusively, then atomically starts the trial. Re-running cannot restart a ready firm's trial. A failed attempt before activation may leave the new empty target bound with its owner; a retry only accepts exactly that owner and zero other business rows. If activation fails after writing the env file, retain it for diagnosis, choose a new private output file on retry and use only credentials from the successful activation. Never delete/rebind business data to make a retry succeed.
5. Apply the private environment to the separate runtime, set `NODE_ENV=production`, configure its dedicated uploads volume, deploy the same build and verify owner launch from the platform. Add only this runtime's required healthcheck hostname to its fixed `TENANT_HOSTS` if hosting requires it.
6. Check health/owner launch immediately after provisioning; trial begins when the operator activates, so prepare infrastructure before that step. If deployment fails, fix it and use an audited access extension for the lost days; never reset trial history.

Do not run this command for the existing business. A non-empty database is refused without modifying its rows. The existing company remains in legacy mode, outside platform expiry/suspension. Moving it later requires the stage-1 backup/restore/fingerprint procedure and a separate reviewed legacy onboarding path, not pretending it is an empty new firm.

## Local review

### Separate hosted platform, closed registration

The platform is deployed independently of the current firm's service. Use a new Railway project, a private MySQL service with its own `/var/lib/mysql` volume and a web service. Do not change the existing company's database, environment, uploads or deployment. `node scripts/build-platform-release.mjs` prepares a fresh allowlisted upload under ignored `temp/platform-launch/artifact-*`; only the platform server/operator, client assets and dependency manifests are included. It contains no credentials or business server entrypoint. Upload that folder as the service root, never the whole checkout. Run `railway up . --no-gitignore --path-as-root` **from the generated artifact directory only**, with explicit new-project/environment/service selectors. The normal repository gitignore excludes `dist`, so a default upload silently omits the compiled server.

Without verified email delivery, explicitly set `PLATFORM_MAIL_MODE=disabled`, `PLATFORM_REGISTRATION_ENABLED=false`, `PLATFORM_BILLING_MODE=off`, an exact HTTPS `PLATFORM_ORIGIN` and a dedicated `PLATFORM_DATABASE_URL`. Closed registration rejects register/resend/forgot requests before account/company/token writes. Login and existing one-use verification/reset links remain usable. Production local-file email is still forbidden; the UI reads public capabilities and explains unavailable actions. Do not enable registration until actual email delivery has passed acceptance checks.

For the first deployment only, `PLATFORM_BOOTSTRAP_ONLY=true` starts a 503 holding process with no database access or public APIs. Through private Railway SSH, explicitly run `node dist/platform-ops.js init` against the empty, new platform schema. Then limit the runtime MySQL account to SELECT/INSERT/UPDATE/DELETE on that schema. Never grant it access to company databases. Remove the hold flag and redeploy; normal startup still refuses an unprepared schema.

`PLATFORM_ADMIN_EMAIL=... node dist/platform-ops.js admin-invite --out /tmp/first-admin.env.local` invites only the first administrator. It refuses existing accounts/admins, serializes concurrent runs and writes an exclusive private file. There is no known initial password: the generated reset link expires in one hour and the human chooses a password through the existing one-use form. Transfer the file privately and remove the remote copy; never print its content in logs or commit it. This is an explicit trusted operator bootstrap, not a public verification bypass. The platform database and its backups are separate from the current business. New company provisioning remains an explicit operator procedure; this release does not automatically allocate company infrastructure or enable payments.

If that first link expires before setup is completed, the same operator may run `admin-reinvite --out NEW_PRIVATE_FILE.env.local` with the original email. This refuses any active/used account, any company or additional account, and any account without the original bootstrap audit event. It changes no password: it revokes older reset links, issues a new one-hour link and audits the replacement atomically. A failed exclusive file write rolls the transaction back. It is not a general administrator password recovery mechanism.

Verification/reset pages remove link fragments from the address bar and retain only the link token in purpose-separated, origin/tab-scoped sessionStorage for at most one hour. Reloading the same tab restores it; success removes it. Passwords are never stored. Invalid/expired cache data is discarded, and unavailable storage falls back to the original link for that load only. Server-side expiration, purpose validation and single-use consumption are unchanged.

Use a disposable local SQL server and separate schema. Configure `PLATFORM_MAIL_MODE=local`, `PLATFORM_ORIGIN=http://localhost:4180`, initialize schema/admin explicitly, then `npm run platform:dev` with port 4180. The existing local business app at 4177 remains independent. Local verification/reset messages are in ignored `data/platform-local-mail.jsonl`. These links grant access: never commit/share that file. No demonstration credentials exist in source code.

## Validation and release boundaries

### Company cabinet presentation

The owner portal uses the same compact console sections, status labels and metadata rows as super admin. Launch and resend use the existing endpoints and POST handoff unchanged. The business workspace has a compact sidebar/header, independent expandable navigation groups and browser-local collapsed/group preferences scoped by host and user. Role-based menu visibility is unchanged.

Presentation rules in `company-workspace.css` are scoped to `data-company-style="compact"`. `/kassa` and `/tezkor-keg` explicitly use `original`, so their content is excluded from the compact metric, table and header rules. Shared finance components only gain presentation attributes. No calculations, saving handlers, API procedures, schema or database records are changed by this refinement.

Local UI review uses a loopback-only, read-only Vite preview at `127.0.0.1:4182`, with an always-visible sample-data badge, API requests refused and all mutations rejected. Its ignored `temp/` fixtures/config are review aids, not production code. Dashboard, products, Kassa and Fast KEG rendered in this mode; independent groups, collapse persistence and both themes were checked. Initial review found the separate disposable owner portal's 4180 → 4181 SSO handoff was rejected with “Platformadan qayta kiring.” The subsequent fix and actual browser verification are described below. No production deployment or data access was performed.

Validation for the presentation increment: TypeScript check and build passed; 250 unit tests passed with 21 opt-in integration tests skipped. SHA-256 comparison against a turn-start manifest confirmed all 134 protected server/shared/client library and Cash/FastKeg source files unchanged.

### Browser SSO origin regression

Helmet's default `Referrer-Policy: no-referrer` on the platform HTML caused the browser's native cross-origin form POST to send `Origin: null`. The managed runtime correctly rejected that origin before redeeming a ticket. Node HTTP tests with an explicitly supplied Origin had not exercised this browser policy. This behavior is documented in [MDN's Referrer-Policy reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header).

`platformHeaders` now sets `strict-origin` for platform documents, sending the origin alone, without paths or query strings, and still suppressing HTTPS-to-HTTP downgrade referrers. Platform API responses retain `no-referrer` and `no-store`. Runtime exact-origin checks, server-to-server credentials, tenant/owner matching, one-minute single-use tickets and session cookies are unchanged. The existing business runtime's Helmet configuration is unchanged.

Local verification reproduced `Origin: null` before the fix and `Origin: http://localhost:4180` afterward, using the real owner button in a browser, then opened the authenticated 4181 dashboard. The disposable company's 24 business table fingerprints were identical before/after. Regression tests fail against the old header, pass for development and production header configurations, and check the actual API's privacy headers. SQL/HTTP tests additionally reject missing/null/untrusted origins without consuming the ticket, accept the valid handoff, reject replay and continue blocking suspended companies. All 273 tests (43 files, including the opt-in suites on the disposable loopback database), TypeScript check and build passed. Real hosted HTTPS/cookie behavior remains a staging release check.

### Super admin console

Authenticated administrators use three addressable views: `/super-admin` (overview), `/super-admin/firmalar` (companies), and `/super-admin/tarix` (audit activity). The shell supports light/dark themes and a compact mobile navigation. Dashboard cards and status bars open the corresponding company filter; company profiles separate contact information, access controls, and the last 100 audited actions into tabs.

The company list uses a compact table with a sticky header/first column, status dots plus text, removable filter chips, explicit sort choices, and compact/comfortable row spacing. Search, state, expiry flag, sorting, pagination and density are validated URL parameters. A shared URL takes precedence over saved preferences; opening the bare route restores the current administrator's last view from versioned browser storage. Storage failures fall back to URL state. No server-side preferences or business records are written. Company details open in a right-side sheet with bounded independent scrolling and focus returned to the triggering row; existing access mutations still require the explicit access form and an audit reason. Local preview verification for this refinement uses read-only requests against disposable platform firms. No production migration or deployment is part of this interface change.

Overview and activity use the same compact presentation: a single KPI strip, small table rows, restrained status dots, and consistent borders/spacing. The sidebar can collapse to icons and remembers its state per administrator in browser storage. Activity is a paginated table; its validated page number is in the URL, oversized pages clamp to the last actual page, and long reasons open in a read-only right-side inspector. Company links continue to open the existing company sheet. These refinements use the existing GET endpoints unchanged; no business calculations, database schema, production credentials or deployment configuration are modified.

`GET /api/platform/admin/overview` returns actual status counts, registrations since the current Tashkent calendar month's start, five recent firms, the next five expirations within seven rolling days, their total, and six recent events. Expiry reminders include ready firms with future access only, excluding suspended, expired and unprepared firms. `GET /admin/events?page=…` returns 25 audited events per page with safe company names, no credentials. Company listing supports validated `sort=newest|oldest|name|deadline` and `expiring=true|false` alongside existing search/status/page parameters. Every endpoint requires a verified super administrator; these reads never access business databases or modify financial records. There are no fabricated revenue, uptime, or payment figures.

The overview refreshes every minute; the refresh button invalidates all platform queries. Access mutations retain revision checks and mandatory audit reasons. Extending access shows the resulting date before submission and does not record an online payment. SQL/HTTP tests cover all six access states, the expiry queue, sorting, filter combinations, pagination, owner/anonymous rejection and response secret exclusion.

`npm run check`, `npm run build`, `npm test`. To run real SQL/HTTP isolation and platform tests, explicitly set `TENANT_ISOLATION_TEST_URL` to a **disposable loopback** MySQL/MariaDB server on an explicit non-3306 port. Each suite creates uniquely named schemas and restricted users; never point this at a shared/production server. Fixtures are kept for inspection; no schemas are dropped.

Tests cover atomic sign-up, privilege/CSRF rejection, duplicate registration, one-use verification, empty-schema/legacy-data refusal, no trial restart, tenant database permissions, platform vs firm auth, audited state changes, stale revision rejection, extensions with unchanged cash rows, filters, one-use scoped launch, reset/logout revocation, and a real child company process accepting SSO then refusing API/uploads after suspension. Unit tests cover calendar boundaries, expiry, configuration and fail-closed access caching. Production MySQL version, restored original company, real TLS/cookie behavior, mail sender delivery and hosting provisioning must still be checked in staging before public registration.

To roll back the existing business build, leave it in its unchanged legacy configuration. Control plane and newly managed company services require their own rollout/rollback; do not downgrade a managed runtime to an old build without its gate. Platform DB backup and restore must be practiced separately from company backups. Billing defaults off; admin tariff setup, private provider credentials and the external acceptance/reconciliation checks in `saas-billing.md` are required before live charging.
