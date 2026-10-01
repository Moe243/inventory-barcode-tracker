# Lotus Rugs Inventory / Barcode Tracker

Google Apps Script manages rugs and saves inventory/history in one Google Sheet. The GitHub Pages worker page automatically loads that inventory and submits barcode receive/remove batches.

- Worker: https://moe243.github.io/inventory-barcode-tracker/scanner.html
- Manager/backend: `outputs/Code.gs` and `outputs/Index.html`
- Worker production configuration: `docs/config.js`
- Deployment: [SETUP.md](outputs/SETUP.md)
- Audit and verification: [COMPLETION.md](outputs/COMPLETION.md)

Both pages open without a password. Apps Script must be updated separately from GitHub Pages.

Run backend tests with `node --test tests/backend.test.cjs`. Browser workflows in `tests/browser-flow.cjs` require Playwright, Chromium, Sharp, and the versioned browser library caches listed at the top of that file. Set `LOTUS_TEST_CHROMIUM` when using an existing Chromium executable. Screenshots/results go to the ignored `tests/artifacts/` folder.
