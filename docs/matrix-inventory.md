# Agent × Tovar warehouse quantities

## Dated column widths

Drag a header's right boundary to resize its column. A focused separator also
supports Left/Right (10px), Shift+Left/Right (40px), and Home/End. Pointer release
saves once; Escape or pointer cancellation discards the unsaved preview.

Widths live in the existing cash_matrix_layouts.layout JSON as columnWidths;
no schema change is required. Stable keys identify fixed columns and agent:<id>
identifies each agent independently. The selected date and following dates inherit
the widths until a later explicit layout version. Past layouts remain read-only.
Old snapshots without widths use defaults; old clients that omit widths retain
the effective saved widths. Updates explicitly preserve effectiveDate even when
an older MySQL TIMESTAMP column has implicit ON UPDATE behavior. Invalidate all
dated layout queries after saving so already-visited future dates also refresh.
Column resizing never changes money, quantities or warehouse movements.

The accountant enters the warehouse manager's prepared NET quantities. Returns
are already included in those figures and must not be added again by this app.
The existing monetary quantity × daily price calculation and cash reconciliation
remain separate. A receipt never creates a cash payment or a sale.

New receipts are entered directly in the Prixod cell and posted on Enter, Tab or
blur. The draft clears after success; the day's total appears beneath it. The
separate history icon opens receipts/reversals, not an additional entry form.

## Model

`stockMovements` remains the single warehouse ledger used by Sklad and the matrix.
`matrix_stock_configs` enables a product from an explicitly confirmed Tashkent
business-day start. The entered number MUST be the physical opening balance,
not a count taken after that day's issues. Prefer counting after close and
activating the following day. No automatic historical backfill before that date.

Activation posts only `counted opening - existing stock before activation`, then
links taking rows on/after activation. Existing financial rows are unchanged.
The confirmed opening freezes earlier stock history. Manual/batch stock writers,
factory receipts/deletions and sale stock changes/deletions take the same product
lock as activation and refuse movements before the opening date. Existing rows
remain readable. Price/name-only sales edits do not rewrite warehouse history.
Existing stock movements on/after that date remain effective; verify receipts
were not already entered through Sklad before entering them again in the matrix.

`matrix_stock_events` is append-only metadata linking generated stock movements
to opening counts, individual receipts, receipt reversals, and taking changes.
The editable taking cell is an absolute net quantity. Its linked ledger target
is `-quantity`, so 40 → 35 posts +5, retrying 35 posts nothing, and removal posts
+35. Earlier taking entries have no warehouse impact. Receipt reversals retain
their original records and require a reason and an open posting period.

Each new receipt has a random idempotency key. Equal quantities with DIFFERENT
keys are distinct receipts. Product row locks serialize taking edits, receipts,
activation and reversal; compare-and-set rejects stale cell edits. Legacy
duplicate financial cells are displayed as a total and cannot be silently merged.
Negative balances are visible in red, never clamped. Quantities use decimal(12,3).
Each product uses its existing unit throughout; no implicit package conversion.

`matrix_cell_writes` durably stores each accepted request, its expected edit
version and quantities. The highest write ID for a day/product/agent is the cell
version, including after deletion. Replaying a request returns its original
result without writing; a new request with an old version is rejected even after
40 -> 10 -> 40 or deleting/recreating a cell. Legacy quantity writers advance
the same version. The frontend loads these versions alongside the daily rows.

Business dates are explicitly preserved in quantity, daily-price and product-name
updates, including on older MariaDB tables with implicit TIMESTAMP ON UPDATE.
New taking tables declare an explicit timestamp default to avoid that implicit
behavior. Existing historical dates are not guessed or rewritten.

For a selected date, matrix stock is its closing balance, including all agents
(even hidden ones), all warehouse movements, and all price-independent quantity
corrections. Later date entries are excluded. A backdated open-period correction
changes subsequent balances. Existing closed-period guards apply.

## Local preview and deployment boundary

`node --env-file=data/namuna-runtime.env.local --import tsx scripts/prepare-matrix-inventory-local.ts`
only accepts the disposable Namuna demo or matrix TEST database at 127.0.0.1:43317.
For the matrix TEST runtime use `--env-file=temp/matrix-ui.env.local` instead.
It creates the three new
tables, prepares tenant metadata, and verifies every prior business table hash.
It does NOT activate any product, seed balances, or mutate financial history.

No production migration runs automatically at startup. Schema additions change
the tenant scope hash; an old database must not be restarted on this code until
an explicit, backed-up and staging-tested schema/scope migration is prepared.
The local helper intentionally refuses production. This work is not deployed.
