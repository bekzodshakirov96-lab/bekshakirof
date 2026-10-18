# SaaS business identities — phase one (localhost only)

This phase separates fixed business meaning from user-facing words. It is a
compatibility foundation, not a completed module marketplace or company settings
builder. Production was not accessed or migrated for this work.

## Compatibility contract

- `shared/cashCategoryRegistry.ts` defines nine immutable built-in category IDs,
  their financial roles, legacy storage tokens and default display labels.
- `legacy_beverage_v1` retains the existing journal column order and words.
- `categoryId` is optional on cash create/update. New journal drafts send it;
  old clients/imports can continue sending only their category text.
- If an ID is supplied, type and any recognized legacy label must agree with it.
  Display text never changes the financial role. The server converts an ID write
  to the SAME legacy storage token that existing readers understand.
- No `categoryId` database column, schema alteration, historical backfill or
  relabeling of stored rows is performed. IDs in read responses are derived.
  Old free-text categories are preserved without guessing translations.
- Existing goods-payment aliases retain their previous trim/case-insensitive
  matching in profit calculations. Other legacy JS matching stays exact.
- `server/cashCategorySql.ts` translates stable IDs to unchanged SQL storage
  predicates, preserving the database's existing collation behavior.
- Agent settlement, salary queries and cost classification consume central
  identities. The physical-cash formula, channel handling, repayment exclusion,
  daily balance carry-forward and idempotency/source keys remain unchanged.
- Cash's read-only `categoryDefinitions` API exposes IDs/defaults to authorized
  company business users. Company label overrides are NOT persisted or editable
  in this phase. Fresh presentation views cannot mutate shared defaults.
- Tezkor KEG workflows, validation, product mapping and stock/cash algorithms are
  unchanged; its server router and shared arithmetic files are untouched.

## Why legacy storage remains in phase one

Keeping old storage tokens permits old readers/imports and historical reports to
remain compatible while business calculations move behind a stable-ID boundary.
It does not mean arbitrary new categories are implemented. Later configurable
definitions need tenant-scoped IDs, validated financial roles and versioning;
unknown new labels must never silently become an agent collection or salary.

## Verification

- Regression cases cover every default label/order, unknown historical labels,
  renamed presentation labels, all financial type/channel combinations, old SQL
  predicates and goods-payment alias behavior.
- Disposable local SQL verifies old rows unchanged, real daily summaries and
  next-day opening balances, ID create/update validation, request retry deduplication,
  anonymous denial and company isolation.
- Existing Kassa, KEG, import/export, repayment, salary/commission and tenant tests
  remain required. No production or existing local company financial entries are
  created for these tests.
- Before/after local TEST and Namuna database fingerprints and KEG/core cash file
  hashes are stored under ignored `temp/category-preservation-*.json`.

## Subsequent stages

Versioned company presentation settings are now implemented locally. See
`docs/saas-company-preferences.md` for the exact scope and verification.
Module authorization policies and subscription entitlements are separate from
the presentation toggles implemented in that phase.

1. Versioned, tenant-scoped settings: labels, optional modules and permissions.
2. Onboarding templates for general wholesale, agent distribution and beverages.
3. Controlled workflow/unit policies with effective dates and historical snapshots.
4. Pilot with different firms before any production activation.

The current firm's profile must keep its Kassa and Tezkor KEG operating principles.
Changing labels does not permit changing type, payment channel or money movement.
