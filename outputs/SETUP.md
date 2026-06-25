# Lotus Rugs Inventory Setup

This project uses Google Sheets as the inventory database and Google Apps Script as the backend/web app host.

## Files

- `Code.gs`: Apps Script backend.
- `Index.html`: Web app frontend.

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

## Embed On Your Website

Use the deployed Apps Script URL in an iframe:

```html
<iframe src="GOOGLE_APPS_SCRIPT_WEB_APP_URL" width="100%" height="900" style="border:0;" allow="camera"></iframe>
```

## Google Sheet Structure

The `setupSheet()` function creates these sheets automatically.

### Inventory

| SKU | Name | Size | Color | Quantity | BarcodeValue | CreatedAt | UpdatedAt |
| --- | --- | --- | --- | --- | --- | --- | --- |

### Transactions

| Timestamp | Action | SKU | QuantityChange | PreviousQuantity | NewQuantity | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## CSV Import Format

CSV imports should use these headers:

```csv
sku,design,size,color,quantity
RUG-0001,Persian runner,3x10,Red,2
RUG-0002,Wool area rug,8x10,Blue,1
```

Blank SKUs are allowed during import. The backend generates SKUs like `RUG-0001`, `RUG-0002`, and `RUG-0003`. Older CSV files with a `name` column still work; the app treats `name` as the design.

## Barcode Receiving Workflow

1. Add a rug with design, size, and color.
2. Leave SKU blank so the app creates the next `RUG-0001` style SKU.
3. Keep starting quantity at `0` if you plan to receive stock by scanning.
4. Open `Barcodes`, select the SKUs you want, set label counts, and print.
5. Open `Scan / Count`, search/select the target SKU, choose `Receive` or `Remove`, and start the camera scanner on a phone or tablet.
6. Matching scans increase the pending count. Wrong SKUs show a warning and do not count.
7. Press `Submit scanned count` when the batch is done.

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
- Existing SKUs in the Add Rug form can either add to the current quantity or replace the current quantity.
- CSV import updates existing SKUs and adds new SKUs.
