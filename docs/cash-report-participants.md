# Kassa report: agents and employees

The Kassa movements filter has one selector with separate agent and employee groups.
Inactive people remain selectable so their historical transactions can be reviewed.
Agent and employee IDs are separate namespaces, even when their numeric IDs match.

The selected person and inclusive Tashkent date range filter the movements table,
expense breakdown, income/expense totals, and salary total. Salary is the sum of
Kassa expense rows classified as salary; the card also shows the number of positive
salary payments. It covers the entire selected period, including rows beyond the
current table page. Entries without an assigned person are not attributed by name.

Movement type and category further filter the movements table and its export.
They do not narrow the salary card. Export includes the selected person, date range,
participant names, and a salary subtotal for the exported rows. The agent difference
report retains its own independent filters.

This is a read-only report change. It does not create or modify cash entries,
change cash carry-forward, connect other ledgers, or require a schema migration.

Validation covers same-number IDs, inactive people, tenant isolation, date
boundaries, partial salary payments, pagination, export, and unchanged source rows
and next-day opening balances. SQL integration tests run only against disposable
databases on the loopback TEST MySQL server.
