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
6. In `Code.gs`, change the temporary password value `change-me-lotus` to your own password:
   - `CONFIG.PASSWORD`
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
9. Enter the Apps Script `/exec` URL and app password.
10. Tap `Load inventory`.
11. Choose `Receive` or `Remove`.
12. Tap `Start live scanner` and allow camera permission.

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

## Security Notes

This setup is intended for internal warehouse use.

The easiest deployment is:

- `Execute as: Me`
- `Who has access: Anyone with the link`

That means anyone who has the deployed web app link and password can access the app. The included password screen checks the password on the Apps Script backend, but it is still basic protection only, not enterprise security. For stronger security, deploy access only to specific Google accounts in your organization.

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
