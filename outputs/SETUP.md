# Lotus Rugs Deployment

The manager page and worker scanner use the same Google Sheet. There is no password or worker setup form.

## Update The Existing Apps Script Project

1. Open the Google Sheet that should contain your actual inventory. Choose **Extensions > Apps Script**. Use the existing project.
2. Replace **Code.gs** with `outputs/Code.gs`.
3. Replace the HTML file named **Index** with `outputs/Index.html`. Save both files.
4. Select **setupSheet** in the function dropdown and click **Run**. Approve Google authorization if requested.
5. Confirm your spreadsheet contains **Inventory** and **Transactions** tabs. Setup preserves existing data and inserts missing columns.
6. Choose **Deploy > Manage deployments**, select the existing web app, click the pencil icon, and select **New version**.
7. Set **Execute as: Me** and **Who has access: Anyone**. Choose access without Google sign-in, not "Anyone with a Google account."
8. Click **Deploy**. Updating this existing deployment preserves the production `/exec` URL already in `docs/config.js`.
9. Open the manager URL and the GitHub worker link. Both load automatically and should show the same inventory.

Saving code alone does not update the public web app. Run setup once for this upgrade, then deploy a new version.

### If The Script Is Standalone

Setup normally records the bound spreadsheet ID in private Script Properties. If this script is not attached to a Sheet, set **INVENTORY_SPREADSHEET_ID** in **Project Settings > Script properties** to your existing inventory spreadsheet ID, then run setup. The ID is between `/d/` and `/edit` in the spreadsheet URL. Do not put it in GitHub client code.

Once this property is set, all devices read and write the same spreadsheet. Setup does not create a replacement spreadsheet.

## GitHub Pages

- Repository: https://github.com/Moe243/inventory-barcode-tracker
- Worker: https://moe243.github.io/inventory-barcode-tracker/scanner.html
- Files: `docs/scanner.html` and `docs/config.js`
- Pages: **Settings > Pages > Deploy from a branch > main > /docs**
- Production endpoint is configured in `docs/config.js`. Workers enter no URLs or passwords.
- If you create a different Apps Script deployment instead of updating the existing one, update `apiUrl` in `docs/config.js` and publish that configuration once.

## Daily Workflow

Managers add/edit rugs, import files, and print labels from Apps Script. Blank SKUs generate `RUG-0001` style identifiers. Creating an existing SKU is rejected; use Edit. New rugs can start at quantity zero.

Workers open the GitHub link, choose Receive or Remove, and tap **Start live scanner**. Allow camera access in the phone browser. Scans add pending counts. Move a label out of view before scanning another rug with the same SKU; a label held continuously in view is counted only once. Hardware scanners and typed SKUs also work.

Review counts and press **Submit batch**. Displayed quantities update only after server confirmation. Receive feedback is green; Remove feedback is red. Inventory and Transactions tabs load central data. Refresh either interface to see another device's changes.

If confirmation is lost, keep the page open and retry the same batch. Its reference is recorded in Transactions, so a retry does not apply it twice. While confirmation is uncertain, the batch cannot be edited or cleared. Pending counts are temporary, not permanent inventory.

## CSV And Excel Import

The manager reads CSV, XLSX, and XLS locally using SheetJS. The first worksheet is used. Headers ignore case/spaces and accept:

| Field | Column names |
| --- | --- |
| SKU | sku (optional; blank generates a SKU) |
| Name | name, collection, rug name |
| Design | design, pattern, design number |
| Size | size |
| Color | color, colour |
| Quantity | quantity, qty (optional; blank defaults to zero) |

```csv
sku,name,design,size,color,quantity
,Diamond,2010,8x10,Turquoise,0
,Sofia,187,5x8,Blue,0
```

Name, Design, Size, and Color are required. Quantities must be nonnegative whole numbers. Import at most 2000 rows from a file under 10 MB.

Default mode adds new rugs and skips existing SKUs. Replacing existing details and quantities requires explicitly selecting update mode and confirming it. Invalid rows and duplicate SKUs/products are reported by file row number. Valid rows are saved to Inventory and logged as IMPORT.

## Sheet Structure

Inventory columns remain:

`SKU, Name, Design, Size, Color, Quantity, BarcodeValue, CreatedAt, UpdatedAt`

Transactions retain the original columns and add product snapshots/source/batch reference:

`Timestamp, Action, SKU, QuantityChange, PreviousQuantity, NewQuantity, Notes, Name, Design, Size, Color, Source, RequestId`

Existing history is retained. Old entries may lack product/source details. New entries include them. Both interfaces show the newest 75 first.

## Labels And Existing SKUs

The manager generates CODE128 labels from backend BarcodeValue (equal to SKU for new rugs). Labels show SKU, Name, Design, Size, and Color. Workers have no label-generation controls.

This upgrade does not rename SKUs or run a migration automatically. The old optional `migrateExistingSkusToShortFormat` editor function is preserved. Only run it deliberately to convert old long SKUs; copy the Sheet first and reprint labels afterward.

## Access

Anonymous Apps Script access is required for GitHub Pages. At your request, both interfaces are password-free. Anyone with their links can view inventory and use available functions. The worker API limits actions to inventory/history reads and receive/remove batches. The manager URL/API have no authentication. The interface split is a workflow distinction, not user authorization.

No Google credentials, spreadsheet ID, password, or OAuth token is shipped in worker code. This basic version assumes trusted use of its public links.

## Verify After Deployment

Create a unique test rug at zero. Refresh the worker and inspect Inventory. Receive three and submit; remove one and submit. Both dashboards and the Sheet must show two. Reopen the worker in a fresh session and verify two remains. Check history on both interfaces and Transactions. Import a small file, verify valid rows/skipped-row reports, print a label, and scan it on the warehouse phone.

Local tests use real application code with a Sheets service test double. They do not modify production data or replace the live phone test.
