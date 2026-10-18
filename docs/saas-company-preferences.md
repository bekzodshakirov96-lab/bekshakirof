# Company presentation preferences — phase two (localhost only)

The company owner can open `/firma-sozlamalari` from **Nazorat → Firma
sozlamalari**. This phase adds per-company presentation configuration, retaining
the original company's Kassa and Tezkor KEG behavior.

## Implemented scope

- Twenty display labels: the daily cash journal's built-in categories and fixed
  headers, and the product matrix's five fixed headers. Agent/product names come
  from existing records; units and financial meanings are not editable.
- Eight optional navigation/card preferences: KEG, sales, stock, factory/bottles,
  containers, employees, Excel import, and Agent × Tovar.
- With no settings, firms retain the original labels and every module visible.
  No automatic onboarding change or historical backfill is performed.
- Label changes apply from the server's current Tashkent business date onward.
  Each journal/matrix resolves labels using its own selected date. Previous days
  retain previous names; a later same-day save replaces that day's presentation.
  All saved versions remain in storage.
- Current module preferences control sidebar visibility and the matrix card.
  They do **not** change role permissions, subscription entitlements, APIs,
  background calculations, exports, or direct access to a hidden page. The UI
  explicitly explains this: presentation toggles are not a security boundary.
- Kassa, products, debts, settings and user administration cannot be hidden.
  Existing role authorization continues to apply to menus and APIs.

## Storage and concurrency

`companyPreferences.get` reads the server-bound tenant database; clients cannot
provide a tenant ID. `save` requires the existing `admin` company-owner role and
rejects client-supplied dates/unknown keys. Labels are limited to 1–40 characters
and must be unique within their table; only known module IDs are accepted.

The existing tenant-scoped `app_settings` table stores immutable JSON snapshots
under `company-ui.<revision>.*`. Unicode-safe chunks of at most 400 characters
fit its existing 500-character values. No schema change is needed. Only
`company-ui.head` is updated; unrelated application settings remain untouched.

A transaction locks that company's head row and compares `expectedRevision`.
Concurrent/stale saves cannot overwrite one another: the loser receives
`CONFLICT` and an explicit reload action. Head, snapshot and readable audit entry
commit or roll back together. Reads select the newest revision effective on or
before the requested date, or fresh legacy defaults.

Financial category IDs/storage strings remain immutable. Only rendered headers
change; draft IDs, grouping, amounts, stock events, request/source IDs and SQL
predicates remain unchanged. KEG's router and shared arithmetic are untouched.
Full module authorization or new financial categories require a separate phase.

## Local verification

- Validation/presentation tests cover defaults, independent settings, unknown,
  oversized and duplicate labels, dates, financial classification, channel
  handling and unhideable core routes.
- Disposable loopback SQL covers two tenants in one schema, historical/future
  labels, concurrent saves, Unicode round trips, owner-only saves, anonymous
  denial, spoofed tenant/backdate rejection, restore-as-new-version, and unchanged
  cash/inventory records.
- TEST browser checks exercise custom names, previous-day headers, menu hiding,
  persistence and restoring defaults.
- Before/after fingerprints compare every table/schema in TEST and Namuna. Only
  TEST preference/audit rows may change; all business rows remain identical.
- Per-port development Vite optimizer caches prevent cross-runtime React chunk
  collisions. Production static serving is unaffected.

No production access, migration, data change, push or deployment is part of this
phase. Activity templates are now implemented locally in
`docs/saas-company-templates.md`; server-enforced module policies remain future work.
