# Accounting and access audit remediation — 2026-10-20

Status: implemented and tested locally. Not committed, pushed, or deployed.
No production database, uploaded file, company balance, or historical transaction was modified.

## Findings addressed

| Finding | Change | Evidence |
| --- | --- | --- |
| A01: overlapping commission settlements | Lock agent; reject overlapping settled periods; exact retry returns existing settlement. Report exposes overlaps. | Commission unit tests and real SQL overlapping-settlement regression. |
| A02: concurrent Fast KEG overpayment | Acquire client and ordered product locks before any repeatable-read snapshot; re-evaluate debt under lock. | Parallel payments and mixed standalone/KEG payment tests. |
| A03: repeated standalone debt payment | Stable client request UUID, tenant/request unique index, payload equality check and transactional retry response. | Repeated and concurrent identical requests create one payment. |
| A04: electronic confirmation treated as counted cash | Explicit cashCountedAt marker; old audit evidence can prove prior explicit counts. Unproven values require confirmation and do not produce a false shortage. | Electronic-only confirmation, explicit zero count and legacy-evidence tests. |
| A05: KEG profit missing cost | Save dated unit cost at sale creation; exclude future purchases from the cost calculation. | Dated cost/profit SQL regression. |
| A06: note edit rewrites historical cost | Preserve unitCost unless product or transaction date changes. | Note edit after a newer purchase preserves original cost. |
| A07: fractional quantity rounds to zero stock | Reject quantities with more than three decimal places before accounting writes. | Tiny-quantity rejection and no-write assertions. |
| A08: voided repayment prevents linking same receipt again | Unique generated activeCashEntryId applies only to active repayments; keep voided history. | Void/relink and duplicate active link tests. |
| A09: agent can pay unassigned client | Enforce client ownership inside the payment transaction and deletion path. | Agent denied for an unassigned client. |
| A10: login batching bypass | Apply limiter to normalized tRPC procedure path; reject duplicate login batches. | Real HTTP nested/encoded-path and batching tests. |
| A11: confidential uploaded documents exposed to low roles | Branding remains tenant-authenticated; other uploads require admin/accountant. | Real HTTP role tests. |
| A12: expired prepared billing order blocks future checkout | Surface review-required order; super admin may record provider-verified final outcome with reference and audit trail. Expiry is never interpreted as cancellation. | Cancellation retry, late callback, concurrent paid reconciliation/callback, no duplicate access grant, cross-company checks. |
| A13: inconsistent period locks | Apply period checks to stock, factory and bottle mutations/deletions. | Locked-period SQL regressions. |
| Daily price/matrix race | Serialize price and taking updates on product lock; update dependent amounts atomically. | Concurrent price/quantity test ends with correct quantity × price. |

Production dependency advisories were remediated, including SheetJS 0.20.3
from the official vendor distribution. XLS/XLSM/XLSX import compatibility is
covered. The production-only dependency audit reports zero advisories.
The first pass left eleven development-tool advisories and a 1.58 MB SaaS entry
bundle. These were addressed in the subsequent local-only
[dependency and bundle remediation](dependency-bundle-remediation.md).

The SaaS checkout also had developer inspection tooling in its generic build.
Its Vite plugins are now restricted to the development server, matching the main
checkout. Production build output is checked for those scripts.

Bottle sales minus purchase cost remains an accounting-definition question,
not an automatically corrected historical figure. No historical cost backfill
or retrospective money adjustment is included.

## Local verification

- Main checkout: 434 tests passed, zero failed/skipped (71 files).
- SaaS platform checkout: 37 tests passed, zero failed/skipped.
- TypeScript checks and builds for both checkouts.
- Explicit schema upgrade tested twice, including an old scope hash, unchanged
  original-field fingerprints, active-link constraints and rejection of unknown
  scope versions before DDL.
- Database tests used only disposable schemas on 127.0.0.1:43317, MariaDB 10.4.
  This is not a claim of validation against the production MySQL engine.
- Full-suite JSON evidence: `temp/audit-fixes-20261020/full-tests.json`;
  SaaS evidence: the corresponding checkout's `platform-tests.json`.
- Eighteen temporary schemas and fifteen temporary SQL users removed after
  validating server identity, creation time, baseline absence, grants and lack of
  active connections. Pre-existing schemas/accounts preserved.
- Two synthetic demo schemas retained for local browser review on ports 4206
  (company) and 4207 (platform); no real company data copied into these fixtures.

## Release prerequisites — not executed against production

This change requires an explicit schema preparation step. Do not deploy new
runtime code over an old company schema or rely on server startup to migrate it.

1. Back up and verify company databases and uploads. Stop company writes.
2. Using the intended database connection, generate a fresh `tenant:db audit`
   snapshot. This is the baseline for the maintenance operation.
3. Run `tenant:db audit-fixes --tenant-id <actual-tenant-id> --baseline <snapshot>
   --apply` for each company database. The operation verifies tenant identity and
   an allowlisted scope version before DDL, adds nullable metadata and indexes,
   then verifies every original field and history row is unchanged. Unknown scope
   versions abort; investigate instead of bypassing the check.
4. The approved old scope hash is
   `4a76e8607d06b608f8f97560d632fa84a3a73ebeb557b4b1164795c15d916a07`.
   A partially completed migration can be inspected and resumed with a fresh
   baseline; do not assume DDL can be transactionally rolled back.
5. Deploy the matching runtime/client only after schema validation succeeds.
   Refresh old browser sessions: standalone debt payments now require requestId.
6. Validate database ownership, history fingerprints, permissions and key flows
   before reopening writes. Preserve the verified backup.

Schema preparation never infers a historical cash count, recomputes historical
sales cost, changes paid amounts, or grants subscription time.
Provider recovery is separate, super-admin-only, requires a verified final state,
and records the evidence reference.
