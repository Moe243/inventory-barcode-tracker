# Lotus Rugs Completion Report

The code is implemented and locally verified. Production use still requires the existing Apps Script project to be updated and deployed from the owner's Google account. No production inventory was created, changed, or deleted during testing.

## Completed

- Removed passwords and login screens at the owner's request.
- Worker inventory and recent history load automatically from the configured production endpoint.
- Added worker Inventory and Transactions views without product creation/edit/import/label controls.
- Preserved camera scanning, manual/hardware scans, green Receive feedback, and red Remove feedback.
- Server calculates and validates whole-number quantities and prevents negative inventory.
- Submitted batches update sheet inventory/history before success is returned.
- A durable batch reference in Transactions prevents duplicate application of a confirmed batch after a lost response.
- Failed/uncertain saves keep pending counts and do not show an inventory update as successful.
- Fixed manager save form clearing after asynchronous saves.
- Manager creation rejects existing SKUs and duplicate products; Edit preserves the SKU and logs metadata/quantity changes.
- CSV/XLSX/XLS import reads the first worksheet, recognizes header aliases, supports quoted/multiline CSV, and reports invalid/duplicate rows.
- Imports default to new products only. Replacing existing stock requires explicit update mode and confirmation.
- Improved CODE128 bars and quiet space; labels retain SKU, Name, Design, Size, and Color.
- Preserved existing data and the optional previous SKU migration. No migration runs automatically.

## Architecture

```text
GitHub worker scanner -- JSONP --> Apps Script worker actions --+
                                                              +--> same Google Sheet
Google manager UI -- google.script.run --> same backend -------+
```

GitHub Pages is a static frontend. JSONP reuses the existing connection approach and follows Apps Script ContentService redirects without browser CORS problems. The worker API supports inventory/history reads and receive/remove batches. Manager actions are exposed through the manager interface and the existing POST API.

Inventory and history are never stored as independent browser datasets. Worker state contains only displayed server data and temporary pending counts. No localStorage or sessionStorage is used by the final application. The public frontend configuration contains only the Apps Script deployment URL, not a spreadsheet ID or credentials.

## Audit Before Changes

All five original project files were inspected: README, Code.gs, Index.html, scanner.html, and SETUP.md. The local branch matched GitHub main at the start.

| Area | Original finding | Fix |
| --- | --- | --- |
| Worker connection | Read URL/password from localStorage; required clicking Load inventory; no startup request | Production config plus automatic initial request; no password/settings inputs |
| Inventory storage | Backend writes to Sheets; frontend inventory was in memory, not a separate permanent database | Preserved one central database; no browser-only success path |
| Spreadsheet connection | Every call depended on getActiveSpreadsheet | Setup pins the existing Sheet in private Script Properties; all runtime calls use openById |
| Write locking | getDocumentLock was used in a web app, where Google documents it can return null | getScriptLock protects reads and writes across both interfaces |
| Sheet setup | Normal writes reread all rows, resized columns, and could clear/remap the sheet | Header-only checks; insert missing columns without clearing data |
| Import | Existing SKUs were silently replaced; invalid rows could interrupt a partially processed import | Validate/plan rows first, explicit update mode, skipped-row report, grouped writes |
| Batch | Repeated SKU rows could overwrite each other's calculations; no protection against retrying after a lost response | Group changes per SKU; validate all first; store batch reference |
| Edit | Saved changes without a history entry or full required-field validation | Validated permanent SKU edit and EDIT log |
| Transactions | Worker had no history; backend read the full historical sheet to display recent rows | Both views read central recent history; backend reads only the requested final rows |
| Barcode | CSS sizing and narrow bars could render a label that failed decoding | Wider modules, quiet space, constrained print dimensions; verified with ZXing |

The exact cause of the owner's prior empty-Sheet incidents could not be inspected inside their Google account. The lock and active-spreadsheet dependencies were concrete code defects, not evidence that a second persistent inventory existed. Google documents the web-app lock limitation in its [LockService reference](https://developers.google.com/apps-script/reference/lock/lock-service).

## Google Sheets

In local integration tests, all creation, receive/remove, edits, and valid imports updated the same Inventory tab and central Transactions tab. A new backend execution and fresh browser session read the stored state successfully.

Setup preserves the original Inventory columns and appends snapshot/source/reference columns to Transactions. Caught write failures restore affected inventory cells and remove newly attempted history rows. Google Sheets is not a transactional database; these checks do not prove atomic recovery from a hard Apps Script termination or Google service outage.

Actual production Sheet persistence remains unverified until the new Apps Script version is deployed and the live acceptance sequence is run. No claim is made that the owner's Sheet has already been updated.

## GitHub

Automatic loading, Inventory/Transactions views, live camera decoding, target mismatch rejection, manual scans, mode colors, batch submission, and retry/error handling passed local integration checks using the real frontend and backend code.

The production endpoint is in `docs/config.js`. The previously deployed backend still returned Invalid password during the read-only audit, so it requires the new version before anonymous worker loading can succeed.

## Manager Site

Add/edit/import/print functionality is implemented. SKU remains the permanent edit ID. Blank SKU generation remains RUG-0001 style and reserves numbers so deleting the highest SKU does not reuse its ID. Duplicate Name + Design + Size + Color protection remains in place.

Scanning controls have been removed from the manager UI. Existing quick quantity adjustments remain available and are recorded centrally.

## Test Results

Tests ran against the real application code with a mocked Apps Script/Sheets service, real Playwright Chromium, real SheetJS, real JsBarcode, and real ZXing. Test data existed only in the test service. Camera testing used a simulated video stream of an actual generated label, not a physical iPhone.

| Required test | Local result | Production result |
| --- | --- | --- |
| 1 Automatic worker load | PASS: no password/URL/browser cache required | BLOCKED: old Apps Script version |
| 2 Create TEST-001 at zero | PASS: manager, worker, and test Sheet agree | NOT RUN on live Sheet |
| 3 Receive three | PASS: 0 to 3; confirmed response and history | NOT RUN on live Sheet |
| 4 Remove one | PASS: 3 to 2; both views and test Sheet agree | NOT RUN on live Sheet |
| 5 Fresh session reload | PASS: quantity two persists with no browser storage | NOT RUN against updated live backend |
| 6 Import | PASS: CSV and XLSX, aliases, duplicate/invalid reports | NOT RUN on live Sheet |
| 7 Transactions | PASS: both views show CREATE/RECEIVE/REMOVE/IMPORT | NOT RUN against updated live backend |
| 8 Barcode | PASS: screen and print CODE128 decode as TEST-001; label fits | Physical label test pending |
| 9 Mobile | PASS: 390px layout, simulated camera decoding, stable count, confirmed submission | Physical iPhone test pending |

Also passed 12 backend tests covering invalid numbers, duplicate products, complete-batch validation, repeated SKU grouping, safe retries, failure rollback, explicit import updates, EDIT snapshots, safe header upgrades, permanent generated IDs, and worker API action restrictions. Browser tests additionally simulated offline requests, lost confirmations, unknown SKUs, and wrong targets.

Test sources are in `tests/`. Generated screenshots and local result details are in the ignored `tests/artifacts/` directory.

## Deployment

- GitHub source/Pages update is published separately from the Google deployment. See the chat close-out for the verified GitHub publish status.
- Worker URL: https://moe243.github.io/inventory-barcode-tracker/scanner.html
- Existing manager/API URL: https://script.google.com/macros/s/AKfycbzSniBOoKRH74rHd3KOAJi52I-HLVg5hvOztCH-UpNeD4ehOhWSF-Tnw9ZkBGAaGfiS-w/exec
- Google requires a new version of that existing deployment. See [SETUP.md](SETUP.md) for exact clicks and [Google's web-app deployment guide](https://developers.google.com/apps-script/guides/web) for execution/access behavior.

## Manual Action Required

The Google editor was inaccessible because computer-use permission was not granted, and no authenticated Apps Script connector was available. The owner must paste Code.gs and Index, run setupSheet in the original spreadsheet's project, and deploy a New version with Execute as Me and anonymous Anyone access.

After deploying, run the live acceptance sequence from SETUP.md and scan a printed label with the warehouse phone. No worker endpoint/password configuration is needed.

## Remaining Issues

The new Google backend is not deployed or verified against the production Sheet. Physical iPhone permission/scanning remains a live-device check. These are the outstanding blockers to calling the warehouse system live and complete.

Anonymous access is intentional for this basic version. Both links are password-free; their interface separation is not authentication or role enforcement.
