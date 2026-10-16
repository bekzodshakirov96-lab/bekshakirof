# SaaS stage 1: company-isolated deployments

Status: implemented and tested locally; **not applied to the existing production database**.

## Decision and scope

One immutable company per Node process, one MySQL database and restricted database account per company, one configured hostname set, separate session issuer/cookie and upload directory. The same application version is deployed for all companies. Central self-service signup, provisioning, memberships and subscription billing are later phases.

The earlier pooled-database proposal would require revising 484 database call sites. This first stage uses deployment/database isolation instead, so Kassa, sales, factory, debt and warehouse algorithms and all historical IDs remain unchanged. Every existing router, raw SQL query, importer, exporter, summary and audit query uses the runtime's single database connection. No company ID supplied in an HTTP header selects a database.

All 24 current business tables stay inside their company's database: users, agents, positions, employees, clients, products, transactions, cash_entries, cash_transfer_links, cash_journal_debts, cash_journal_debt_repayments, container_movements, stockMovements, factory_operations, client_payments, bottle_movements, import_history, kassa_daily_actuals, agent_taking_entries, daily_product_prices, cash_matrix_layouts, agent_cash_submissions, audit_log and app_settings. Check the schema/snapshot for canonical table spelling.

## Runtime contract

- `TENANCY_MODE=legacy` (default with no company settings): existing installation behavior, original uploads, pre-conversion sessions. This is a compatibility mode, not a template for new SaaS companies.
- `TENANCY_MODE=isolated`: `TENANT_ID`, exact `TENANT_HOSTS` and `DATABASE_URL` are required. No wildcard hosts; include legitimate proxy health-check hostnames. The raw Host is checked; forwarded host and tenant headers cannot change the company.
- Startup validates the database binding **before** running schema helpers or opening the HTTP listener. Missing/invalid/mismatched binding refuses startup with a nonzero exit code. Database use outside the HTTP bootstrap validates it too.
- `saas_tenant_identity` is explicit operational metadata, managed by `tenant:db`. Do not remove it through schema introspection/push tools. It holds exactly one immutable ID/version row. The application reads it; it never auto-binds/rebinds a database.
- Each runtime must have a distinct JWT secret. Tokens additionally require the matching company issuer and business audience, so another company's token is rejected even if secrets were accidentally equal. Original unscoped tokens work only in legacy compatibility mode; users with those tokens log in again after conversion.
- Cookies remain host-only. New company IDs also get a distinct cookie name. A company deployment cannot switch firms or accept arbitrary database connection strings from requests.
- Original company ID is `legacy`; its uploads directory and existing URLs are retained. New companies use `UPLOADS_DIR/tenants/<id>`. Give each deployment its own persistent volume. The reserved `tenants` path cannot be accessed through the original root; traversal and encoded escape paths are rejected before static file serving.
- Local-development CORS exceptions are disabled in isolated mode. The existing original deployment retains its previous development behavior while still in legacy mode.

## Existing production company conversion

Do these operations first on a restored, private staging copy. Commands below intentionally do not contain credentials. Set `DATABASE_URL` through the deployment secret manager or shell environment; never commit it.

1. Take a consistent database backup **and** upload-volume backup, record the application revision, and successfully restore both into staging. A snapshot fingerprint is NOT a recoverable backup.
2. Arrange a maintenance window and stop all writers (application, imports and scheduled scripts). Do not produce a baseline while users are entering new records.
3. Create an ignored `backups` directory. Capture the baseline using the dedicated company connection:

   ```text
   npm run tenant:db -- audit --out backups/legacy-before-binding.json
   ```

   The tool reads all base tables with repeatable-read snapshots, deterministic primary-key ordering, and hashes every row. It saves only table names, row counts and hashes, never row contents. Missing primary keys stop verification.

4. Bind this **existing** database to the original company ID, without moving or modifying business rows:

   ```text
   npm run tenant:db -- bind --tenant-id legacy --baseline backups/legacy-before-binding.json --apply
   ```

   It checks the current data against the baseline, creates only the metadata table and inserts its identity, then checks all business data again. An existing different identity is never overwritten. Re-running for the same identity is safe. A baseline mismatch fails; if writes happened during preparation, keep maintenance mode and investigate rather than deleting/replacing business data.

5. Configure the original deployment:

   ```text
   TENANCY_MODE=isolated
   TENANT_ID=legacy
   TENANT_HOSTS=www.biznescontrol.uz,biznescontrol.uz,<actual Railway health host>
   ```

   Retain the original database, timezone (+05:00 / Asia/Tashkent), JWT secret and volume. Verify the runtime database account cannot access other company databases. Keep identity metadata read-only for the runtime where database privileges permit; schema preparation uses a separate operator account.

6. Start the new version on staging. Compare Kassa opening/closing balances across representative historical dates, customer debts, agent settlements, tara and stock balances. Read an old uploaded workbook and check role permissions. Repeat the snapshot audit and require an identical fingerprint before re-opening writers.
7. Only after staging passes, repeat backup/maintenance/baseline/binding/verification on production. This code change alone does **not** perform production conversion.

## Adding a new company (operator provisioning until the later SaaS onboarding phase)

Create an empty, separate database and a company-only database user, apply the business schema, capture an audit baseline and bind it to a unique new company slug. Deploy the same code with isolated mode, that ID, exact company hosts, its own DB account, JWT secret and volume. Never clone the original firm's business rows to provision another firm. Never grant a runtime account global database privileges.

Database/schema creation and cloud resource provisioning are intentionally not public endpoints. The future signup service must own these operations and ensure unique company IDs and idempotent provisioning.

## Rollback

Binding adds metadata only. Before writers resume, the original company can revert to its recorded application revision and original environment because business tables/IDs and original upload paths were never rewritten. Leave metadata in place; deletion is unnecessary.

After writers resume, preserve every newer record; restoring an earlier backup blindly would lose new entries. Do not downgrade newly provisioned company deployments to an older build without company-bound authentication and file guards. Keep them suspended until a tested compatible version is available.

## Validation

Unit tests cover invalid configuration, host matching, database ownership, missing bindings, shared-secret/colliding-user-ID sessions and path escapes. File integration tests use separate filesystem roots and retain an old workbook path.

The opt-in database/HTTP integration suite creates fresh databases and restricted users on an explicitly disposable loopback MySQL/MariaDB server (non-default port). It exports the real Drizzle schema, seeds representative historical cash/sales/debt/tara records and verifies all 24 business-table fingerprints, exact daily Kassa report preservation, cross-database permission denial, session separation, incorrect routing headers and forbidden file paths. No production database is used.

```text
TENANT_ISOLATION_TEST_URL=mysql://<test-admin>@127.0.0.1:<disposable-port>/mysql
npx vitest run server/tenancy/database.integration.test.ts
npm run check
npm run build
```

Test schemas have generated `bc_test_...` names and are retained inside that disposable server; stop that dedicated server after testing. The normal test suite skips database integration when the explicit test URL is absent. This local run uses MariaDB 10.4 (MySQL-compatible); staging verification on the production engine/version remains required before conversion.

Local verification on 2026-10-17: 36 test files / 226 tests passed with database integration enabled; TypeScript check and production build passed. The fixture's 24 business-table fingerprints and exact Kassa daily response matched across original-company binding. The CLI audit/bind flow, incorrect-startup refusal, cross-database grants, cross-company bearer tokens, HTTP host spoofing, file isolation and legacy upload paths were exercised. These are fixture results, not a claim that a production backup has been restored or that production has been converted.
