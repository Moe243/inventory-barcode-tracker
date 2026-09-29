# Lotus Rugs Inventory Setup

This project uses Google Sheets as the inventory database and Google Apps Script as the backend/web app host.

## Files

- `Code.gs`: Apps Script backend.
- `Index.html`: Web app frontend.
- `docs/scanner.html`: separate mobile live scanner page for GitHub Pages.

## Setup Steps

1. Create a Google Sheet named `Lotus Rugs Inventory`.
2. In the Sheet, open `Extensions > Apps Script`.
3. Replace the default Apps Script code with the contents of `Code.gs`.
4. Create a new HTML file named `Index.html`.
5. Paste the contents of `Index.html` into that file.
6. This version is public and does not use `APP_PASSWORD`. Remove the old script property if present.
7. In Apps Script, select `setupSheet` from the function dropdown and click `Run`.
8. Approve the Google permissions.
9. Deploy the app:
   - Click `Deploy > New deployment`.
   - Choose `Web app`.
   - Set `Execute as` to `Me`.
   - Set `Who has access` to `Anyone with the link`.
   - Click `Deploy`.
10. Copy the Web App URL.
11. Open the Web App URL and test adding rugs, filtering by design/size/color, scanning/counting inventory, exporting, and printing selected barcode labels.

## Mobile Live Scanner Setup

The main Apps Script app can stay as your dashboard. The live warehouse scanner should run from the separate mobile web page in `docs/scanner.html`, because iPhone Safari/Chrome may block live camera access inside the Apps Script web app frame.

1. Paste the updated `Code.gs` into Apps Script.
2. Save and deploy a **New version** of the Apps Script web app.
3. In GitHub, open the repository settings for `inventory-barcode-tracker`.
4. Go to `Pages`.
5. Set source to `Deploy from a branch`.
6. Set branch to `main` and folder to `/docs`.
7. Save.
8. Open the GitHub Pages scanner URL on your iPhone.
9. Open the shared scanner link. The scanner is configured for the warehouse deployment URL in `docs/scanner.html` and loads inventory automatically.
10. Choose `Receive` or `Remove`.
11. Tap `Start live scanner` and allow camera permission.

If you are upgrading from the older long SKU format, run `migrateExistingSkusToShortFormat` once from Apps Script after deploying the updated `Code.gs`, then reprint barcode labels.

The scanner page works in warehouse batch mode:

- Scan any known rug SKU.
- Pending counts are grouped by SKU.
- Receive scans submit positive quantity changes.
- Remove scans submit negative quantity changes.
- Nothing changes in the sheet until you tap `Submit batch`.

You can also check `Require selected SKU` if you only want one selected SKU to count and want mismatched labels rejected.

## Embed On Your Website

Use the deployed Apps Script URL in an iframe:

```html
<iframe src="GOOGLE_APPS_SCRIPT_WEB_APP_URL" width="100%" height="900" style="border:0;" allow="camera"></iframe>
```

## Google Sheet Structure

The `setupSheet()` function creates these sheets automatically.

### Inventory

| SKU | Name | Design | Size | Color | Quantity | BarcodeValue | CreatedAt | UpdatedAt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

### Transactions

| Timestamp | Action | SKU | QuantityChange | PreviousQuantity | NewQuantity | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## CSV Import Format

CSV imports should use these headers:

```csv
sku,name,design,size,color,quantity
RUG-0001,Diamond,2010,8x10,Turquoise,2
RUG-0002,Sofia,187,5x8,Blue,1
```

Blank SKUs are allowed during import. The backend generates short camera-friendly SKUs like `RUG-0001`.

## Barcode Receiving Workflow

1. Add a rug with name, design, size, and color.
2. Leave SKU blank so the app creates the next short SKU.
3. Keep starting quantity at `0` if you plan to receive stock by scanning.
4. Open `Barcodes`, select the SKUs you want, set label counts, and print.
5. Open `Scan / Count`, search/select the target SKU, choose `Receive` or `Remove`, and start the camera scanner on a phone or tablet.
6. Matching scans increase the pending count. Wrong SKUs show a warning and do not count.
7. Press `Submit scanned count` when the batch is done.

## Mobile Warehouse Workflow

1. Print barcode labels from the main app.
2. Open the GitHub Pages scanner on your iPhone.
3. Load inventory.
4. Choose `Receive` for incoming rugs or `Remove` for outgoing rugs.
5. Walk the warehouse and scan labels live.
6. Review the pending batch.
7. Submit the batch once when finished.

## One-Warehouse Pilot

This app tracks **one quantity per SKU in one warehouse**. A barcode identifies a SKU, not a particular physical rug. Do not print a different SKU for every copy of the same item, and do not treat a scan as a location update.

1. Make a copy of the production Google Sheet and connect a separate Apps Script test deployment to that copy. Keep the production Sheet and web app in use during testing.
2. Select 20–50 SKUs in one physical area. Check that each printed barcode resolves to the intended style, size, and color. Record the physical starting count for each SKU.
3. Use **Receive** for actual stock arriving and **Remove** for stock leaving. Review the SKU counts and notes before pressing **Submit batch**. A physical count alone must not be entered as a receive or removal; compare it with the recorded count first and enter only the difference as a documented correction.
4. Test a mixed batch, repeated scans of the same SKU, an unknown barcode, and removal greater than stock. A failed batch must leave all quantities unchanged.
5. After each test submission, check both Inventory and Transactions in the Sheet against the physical count. Repeat from two devices at the same time.
6. If the phone reports a timeout or loses connection after Submit, check the Transactions sheet and current quantity before trying again. The current API does not yet give retries a unique batch ID.
7. When the pilot agrees with the physical count, train staff on the same steps and expand SKU by SKU. Keep one manager responsible for corrections and daily discrepancy review.

## Security Notes

This setup is intended for internal warehouse use.

The easiest deployment is:

- `Execute as: Me`
- `Who has access: Anyone with the link`

This version has no password. Anyone with the dashboard or scanner URL can read inventory and submit changes; the public Apps Script endpoint also exposes add, import, correction, deletion, and SKU migration actions. Keep real inventory out of this deployment until access control is restored. The Google Sheet itself can remain unshared; the deployed script runs with the deployer's permissions.

## Practical Notes

- Writes use `LockService` so two people adjusting inventory at the same time are less likely to overwrite each other.
- Barcode labels use JsBarcode CODE128 from a CDN.
- Camera scanning uses the ZXing browser barcode library from a CDN.
- The separate mobile scanner also uses ZXing and submits grouped scan batches through Apps Script.
- Existing SKUs in the Add Rug form can either add to the current quantity or replace the current quantity.
- The Add Rug form has buttons for adding another rug with the same name/design or starting a new rug.
- The app prevents duplicate `Name + Design + Size + Color` rows.
- CSV import updates existing SKUs and adds new SKUs.
- Barcode labels encode the short SKU and print name, design, size, and color under the barcode.
