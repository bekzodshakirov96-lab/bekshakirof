# Activity templates — phase three (localhost only)

Phase-four pilot findings, fixes and verification:
`docs/saas-template-pilot-audit-2026-10-18.md`.

New owners select a starting template in the **business cabinet**, after platform
registration, email verification, provisioning and SSO. The registration process,
provisioning guards, subscriptions and the original firm's bindings are unchanged.

## Version 1 catalog

| Activity | Presentation defaults | Hidden optional navigation |
| --- | --- | --- |
| Wholesale | General cash, supplier, product and stock words | KEG, factory/bottles, containers, Agent × Tovar |
| Agent distribution | General cash and product words; Agent × Tovar visible | KEG, factory/bottles, containers, separate sales pages |
| Beverages and KEG | Exact legacy labels and all modules visible | None |

Templates contain only phase-two labels and navigation preferences. They do not
seed agents, products, units, prices, quantities, balances, transactions, formulas,
cash categories, permissions, or subscriptions. Hidden modules remain accessible
under their original authorization and can be shown later in Firma sozlamalari.
The existing Kassa and Tezkor KEG algorithms are unchanged.

## New-company workflow

- An authenticated company owner sees a setup notice while the company is empty.
  It links to `/firma-sozlamalari#shablonlar`.
- Three activity cards show a description and preview of names/modules. Choosing
  a card only previews it. **Shablonni qo‘llash** explicitly persists the choice.
- Companies with business records, audit history, multiple accounts or existing
  custom settings may browse previews but cannot apply a starting template.
  Nothing is automatically applied to existing firms.
- A template is applied once. Afterward the owner can edit individual labels and
  module visibility using phase-two settings; the template cannot reset these.
- A user who starts entering business data without choosing a template retains
  legacy defaults and can still edit individual settings. Applying a bulk starting
  template after that is deliberately forbidden.

## Storage, isolation and atomicity

The owner-only `companyPreferences.onboarding.status/choose` procedures use only
the server-bound company database. Strict input accepts a catalog ID and UUID
request key; tenant IDs, dates, raw preference objects and arbitrary templates
are rejected. No platform or business schema migration is required.

The chosen template ID, immutable catalog version, Tashkent application date and
request key are saved in the existing tenant-scoped `app_settings` key
`company-onboarding-template`. Its first presentation snapshot, readable audit
and marker are committed in the same transaction. The snapshot and marker use
one captured business date. An identical request retry returns the current
configuration without overwriting subsequent customizations. Different requests
after initialization fail with CONFLICT.

The transaction first locks the same preference-head row as ordinary settings
saves. It then rechecks every business table (including audit history) using
locking tenant-range reads. A concurrent first business insert cannot slip past
an earlier non-locking empty-company status check. Any failure rolls back the
head, preference chunks, audit and template marker together.

## Verification and boundaries

- Unit tests cover all catalog variants, independent preference objects, exact
  beverage compatibility, immutable financial categories and strict inputs.
- Disposable SQL tests cover old-company rejection, tenant isolation, owner-only
  access, parallel retry deduplication, later customization preservation, previous
  date defaults, final-marker failure rollback, and a concurrent first product.
- A separate empty localhost company on port 4184 exercises the owner notice,
  activity preview, explicit apply, persisted choice and resulting menu.
- Before/after fingerprints verify all 29 tables and every existing row in TEST
  and Namuna, together with KEG/core cash file hashes. The new preview company is
  isolated from both existing fixtures.

All work remains local. No production connection, migration, push or deployment
is performed. New catalog versions must never reinterpret saved version-one
choices; industry workflows and server-enforced module entitlements are separate
future work.
