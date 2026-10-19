# Client update notice

Every production build emits a public `app-version.json` with an opaque build ID.
The same ID is compiled into the client. An open tab compares its loaded build
against the server on startup, every 60–70 seconds while visible and online, and
when focus or connectivity returns. No company, account or transaction data is
included in the manifest. Both business and platform servers serve it with
`Cache-Control: no-store`; HTML also bypasses caching.

When a different build is available, every open client displays a persistent
notice with a **Yangilash** button underneath. Clicking checks availability again
and reloads the current URL. Login cookies and saved data are preserved. There
is no automatic reload, service worker, browser notification permission or
database migration.

While a React Query mutation or platform API write is running, the button is disabled. A second check
after the availability request also catches saves started on blur. If the user
has entered anything in an input, select, textarea or editable element during
this page session, a confirmation asks them to save first. This is deliberately
conservative: it does not attempt to infer whether every module has saved its
inputs, and may also warn after a filter or already saved edit. Dropping a file
also marks entered data, covering prepared Excel imports. Existing native
unsaved-form warnings remain active.

Readiness errors and progress appear inside the confirmation dialog as well as
the notification, so keyboard and screen-reader users can retry without losing context.

Offline, maintenance, missing metadata and invalid responses do not interrupt
normal work or dismiss an existing notice. Requests time out after ten seconds,
do not overlap, and are aborted on unmount. A click during unavailability shows
a retry message instead of reloading.

## Rollout and limits

- This is an in-site notice for open pages, not email or an OS push message.
  Background pages check when the user returns; closed browsers do not receive it.
- On the first deployment of this feature, users with older code must refresh
  once to load the monitor. Subsequent builds are detected automatically.
- Development uses Vite HMR; the notice is active only in built releases.
- `check:build` validates the manifest and its match with the initial JavaScript.
  This feature adds no financial writes or changes to Kassa/Tezkor KEG formulas.

## Local verification

Unit and HTTP tests cover validation, first-poll version races, repeated release
and rollback detection, offline/hidden pages, overlap, cancellation, timeout,
uncached requests, maintenance, missing manifests and uncached SPA HTML.
Browser QA uses two real production builds on a disposable local server with
the isolated TEST backend. No production records are used or changed.
