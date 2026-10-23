# Independent Kassa journal and Agent × Product accounting

Kassa is an independent ledger. New sales, fast KEG sales, customer debt payments,
factory movements and commission payments do not write into Kassa or change its
cash balance, carry-forward, agent reconciliation or matrix stock.

- Cash = prior journal balance + journal cash income - journal cash expense.
- Agent reconciliation = Agent × Product amount - the agent's journal cash and
  electronic receipts. The journal control panel no longer reads sales/payments.
- Matrix stock = confirmed opening + matrix receipts - net agent quantities.
  Matrix events no longer mirror into or read the general stock movement ledger.
- Commission payments use the independent `agent_commission_payments` ledger.
- New external transfer links are blocked, including requests from old clients.
  Existing links remain readable as history.
- Explicit import of a Kassa Excel sheet is still a journal entry mechanism;
  importing sales does not generate journal entries.

Shared product/agent dictionaries and historical links remain. Isolation concerns
accounting movements, not duplicate copies of the product/agent catalog.

New repayments in Qarzdorlik → Kassadagi qarz qaydlari reduce the selected debt only.
Cash, terminal, Click and transfer remain payment-history labels. They do not create
cash_entries rows or change cash totals, opening balances, or future carry-forward.
Voiding a new repayment restores debt only. A fully repaid debt still appears in Archive.

Existing cash entries, links, repayment amounts, dates and void history are retained.
Historical repayments with cashEntryCreated=true cannot be voided through this card,
because doing so would change a historical cash entry or leave contradictory records.
The existing-income API mode remains compatible with old clients and never writes cash.

## Explicit schema preparation

Do not deploy the new runtime to an unprepared database. There is no automatic
startup migration of existing records. Back up and verify the database first and
stop writes while preparing the schema. Use the existing tenant:db audit command
to produce a fresh baseline, then run:

```
pnpm tenant:db debt-record-only --tenant-id <verified-company-id> --baseline <fresh-baseline.json> --apply
```

The migration verifies company identity and the reviewed previous scope hash
(the original legacy deployment is verified by its exact legacy scope binding),
makes cashEntryId nullable, adds a nullable requestId and a tenant-scoped unique
index, and prepares query-scope guards. It compares every original column and row
before/after, including old cash and debt links. No historical repayment is backfilled
or removed. Re-running the migration is supported. This command was run only on
the disposable localhost matrix-preview database during development.

It also creates the commission ledger and copies existing agent salary/advance
records into it once, without editing/removing their original cash entries.
Subsequent journal salary entries do not flow into commission accounting. A
completed migration rerun does not import them or duplicate old payments.

## Historical behavior and release boundary

Original cash entries (including old automatically generated receipts/expenses)
continue to contribute to cash balances. This change does **not** silently reverse
them. Any historical correction requires a separate reconciled decision.

Matrix stock and journal control are derived views. Reading matrix stock from its
own events can produce different historical displayed stock if general warehouse
movements previously affected that number. Original stock and matrix rows are
not rewritten. Before any production release, compare those derived views on a
backup and review differences; do not claim historical displayed totals are
identical merely because original rows are preserved. No production release was
performed in this task.

## Local verification (2026-10-21)

- 351 automated tests passed; 90 optional SQL tests were skipped in that default
  run. A further migration regression was added and run explicitly with local SQL.
- 28 accounting/matrix tests passed on disposable SQL databases, including real
  Sales, Fast KEG, factory, customer payment and commission router writes with
  unchanged Kassa and matrix snapshots. 100 + 500 - 80 = 520 stock carried forward;
  journal 1,000 cash income - 100 cash expense carried 900 into the following day
  and a week later. Electronic receipts changed reconciliation but not cash.
- Dedicated SQL migration test passed: original cash rows unchanged, historical
  commissions copied once, later journal salaries not imported, wrong tenant
  rejected. Its temporary database was removed after the test.
- Separate real SQL check on 127.0.0.1:43317 matrix-preview passed: all four payment
  methods; concurrent same-request retries; partial/full payments; overpayment
  rejection; archive; void; unchanged cash rows and next-day/seven-day balances.
- Migration run twice with matching original-history hashes.
- Browser at localhost:4197: 1,000,000 debt minus 200,000 cash repayment = 800,000.
  Same-day and following-day opening/closing cash remained 5,000.
- TypeScript, production build and client build guard passed.
- Production was not connected, modified or deployed for this change.

## Release rehearsal (2026-10-21)

- Final full local SQL run: 442 tests passed across 72 files, including the
  updated expected table count (27 to 28).
- Migration regression now starts with the old non-null cashEntryId and no
  requestId, preserves an existing linked repayment, and covers the legacy
  installation without a SaaS identity table. It passed on local TEST SQL.
- Restored the checksum-verified 2026-10-20 backup into a fresh disposable local
  MySQL 9.7.2 database. Applied the previous deployed migration, then the new
  isolation migration twice. All original fields in 28 tables retained the exact
  same history hash; 30 historical commission records were copied once. The
  disposable database was removed after verification.
- TypeScript, production build and client build guard passed.
- This older-backup rehearsal does not replace a fresh pre-deploy backup. Railway
  SSH timed out during the release preflight, so production preparation and
  deployment must wait for access to be restored. Read-only health checks found
  revision c164d4d running normally; no production data was written.
