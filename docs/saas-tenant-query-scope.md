# Mandatory tenant_id on business queries

Implemented locally on 2026-10-17. Not deployed or migrated on production.

## Runtime behavior

All 24 business tables now have `tenantId` in TypeScript / `tenant_id varchar(63)` in MySQL. It contains the fixed runtime company slug (`legacy` for the existing firm); the platform company UUID is a separate control-plane identifier. No browser header, request body or query parameter selects this ID.

The existing separate-database/runtime model remains in place. `tenant_id` is an additional mandatory query boundary. This increment does **not** move companies into a shared production database or add a multi-firm runtime/membership switcher. Tests deliberately put two firms in one disposable schema to prove filtering independently of database separation.

`server/tenancy/queryScope.ts` constructs Drizzle with a company-bound MySQL dialect:

- Every SELECT/SELECT DISTINCT gets `WHERE ... AND <root>.tenant_id = ?`, including counts, totals, exports, auth, unfiltered lists and `where(undefined)`.
- Every joined business table gets its own tenant predicate in `ON`; LEFT JOIN still keeps root rows with no match. Aliases retain scope. Derived subqueries must have been compiled for the same tenant.
- UPDATE and DELETE get the same mandatory predicate even without a caller-supplied WHERE. Record ownership/primary ID cannot be changed.
- INSERT and batch INSERT receive the server's tenant ID; explicit foreign tenant IDs are refused. Explicit auto-increment IDs are refused to prevent duplicate-key updates colliding with a different firm's global ID.
- Natural unique keys (email, code, sourceKey, dates, etc.) include tenant ID. `app_settings` uses `(tenant_id,key)`. Imports/upserts cannot overwrite another firm's record merely because its code/date/key matches.
- Transactions, nested transactions, row locks and prepared builders keep the same bound dialect. Business callers cannot use raw `execute`, database client/session, CTE, union, INSERT SELECT, unknown sources or unsupported join types as an unscoped escape hatch. These features require a reviewed scoped implementation before use.
- Correlated client-payment totals use an explicitly scoped scalar helper with a predicate inside the inner SELECT. Arbitrary embedded SELECT/raw SQL comments/statements in business expressions are refused. Source regression tests keep raw SQL connections/schema exemptions outside business code.

The query compiler uses Drizzle's typed dialect/session extension points, not SQL string rewriting. It is covered against the installed Drizzle version; dependency upgrades must run the SQL/real-database boundary tests.

MySQL BEFORE INSERT/UPDATE triggers additionally require foreign IDs to belong to the same tenant and prevent tenant reassignment. Existing ID foreign keys and their ON DELETE behavior stay in place; ID-first supporting indexes are retained where MySQL requires them. `users.agentId` also gets an ownership check although it was previously an implicit relation. Runtime startup refuses missing scope metadata/guard triggers. These checks complement application filtering; they are not database row-level SELECT permissions for arbitrary SQL clients.

Example compiled statements (values remain parameters):

```sql
SELECT ... FROM products WHERE products.tenant_id = ?;
UPDATE products SET price = ? WHERE (products.id = ? AND products.tenant_id = ?);
DELETE FROM products WHERE products.tenant_id = ?;
INSERT INTO products (tenant_id, ...) VALUES (?, ...);
```

Platform administration is intentionally global: its separate `platform_*` database authorizes owners by `ownerId` and super admins by role; its firm list is not restricted to one business tenant. No business data is stored in those tables.

## Required schema preparation before deployment

This build requires the scope schema even for legacy compatibility mode. **Do not deploy it over an unprepared production database.** Startup does not run this migration automatically. The existing production firm remains untouched by this local change.

1. Take DB and uploads backups and actually restore them into private staging on the production engine/version. A fingerprint alone is not a recoverable backup.
2. Stop every writer in the target environment (app, imports, scripts, jobs). Prepare any missing pre-existing business migrations first; all 24 tables must exist. Use an operator account with schema/index/trigger permissions restricted to this company database. The normal runtime needs its own company-only grants and permission to inspect its scope guards.
3. Set the target `DATABASE_URL` privately. Capture a fresh immutable baseline:

   ```text
   npm run tenant:db -- audit --out backups/before-tenant-scope.json
   ```

4. For a company already bound, or the original firm staying in legacy compatibility mode:

   ```text
   npm run tenant:db -- scope --tenant-id legacy --baseline backups/before-tenant-scope.json --apply
   ```

   Use the **existing bound slug**, not `legacy`, for an already isolated new firm. A different database identity/tenant is refused. For first binding, `tenant:db bind` now prepares scope too, before reporting success. New-company `platform:ops provision` also uses that path and inserts its owner with the correct tenant ID.

5. The command compares the baseline first; adds/assigns only tenant metadata; preserves automatic-update timestamp fields during backfill; updates keys/indexes without deleting records; validates references; installs guards; records `saas_tenant_scope` with a schema fingerprint; then compares **every original business field and row count** again. `tenant_id` and the two operational metadata tables are intentionally excluded from the financial-preservation fingerprint and checked separately. Existing amount/date/note/ID/history values are included.
6. DDL is not transactional. A failed/partial migration leaves the app stopped; retain the baseline/backups, inspect the exact cause and retry only for the same company in maintenance. The command does not reassign another tenant, silently repair invalid historical references or delete records. Never bypass an error by dropping constraints/data. If history already has orphan references, resolve that as an explicit separate review before rollout.
7. Check historical daily/monthly cash balances, next-day carry-over, client/agent debts, archived cash debts, stock/tara and imports/exports against staging baseline, then deploy and resume writers. Repeat the verified backup/maintenance process on production only when deployment is requested.

`saas_tenant_identity` and `saas_tenant_scope` are operational tables outside the Drizzle business schema; never let schema introspection/push tools delete them. Use the explicit scope command, not an automatic `db:push`, for this conversion. Existing startup schema helpers have an explicitly separate raw schema connection and only repeat-safe DDL/metadata checks; HTTP business modules cannot import it.

## Verification

- SQL compilation tests: predicates on reads/writes/aliases/LEFT JOINs, server assignment, scope-spoof rejection, raw bypass rejection and all-table/index coverage.
- Real one-schema/two-tenant tests: identical emails/codes/agent names, lists/counts/cash sums, join fan-out, derived debt totals, correlated debt payment totals, wrong-tenant IDs, cross-tenant references, immutable ownership, safe upserts/settings, nested transactions, prepared statements and rollback.
- Real legacy migration test: construct the prior schema **without tenant columns**, seed historical cash/sales/debt/tara, capture the old unscoped cash formula results and all 24 table fingerprints, migrate, and compare them against the actual new Kassa response and every original field. Binding retries preserve those results.
- Real HTTP tests retain issuer/host/file isolation and managed platform owner sign-in/suspension.

Run with an explicitly disposable loopback MySQL/MariaDB server on a non-default port:

```text
TENANT_ISOLATION_TEST_URL=mysql://<test-admin>@127.0.0.1:<disposable-port>/mysql
npm test
npm run check
npm run build
```

No production connection is used by these tests. The actual production backup/restore/migration has not been performed.

Local verification on 2026-10-17: all 41 test files / 260 tests passed with real SQL/HTTP suites enabled; TypeScript and production build passed. The prior schema without tenant columns migrated with all original field fingerprints unchanged; daily cash balance and next-day carry-over matched. Transaction list/export container scalars were exercised through the actual router, and single-table correlated scalars were tested with deliberately different parent/child IDs. The separate local demonstration firm was explicitly migrated using its baseline and an idempotent CLI retry; no production database was modified.
