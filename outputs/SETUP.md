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
6. In both files, change the temporary password value `change-me-lotus` to your own password:
   - `CONFIG.PASSWORD` in `Code.gs`
   - `FRONTEND_PASSWORD` in `Index.html`
7. In Apps Script, select `setupSheet` from the function dropdown and click `Run`.
8. Approve the Google permissions.
9. Deploy the app:
   - Click `Deploy > New deployment`.
   - Choose `Web app`.
   - Set `Execute as` to `Me`.
   - Set `Who has access` to `Anyone with the link`.
   - Click `Deploy`.
10. Copy the Web App URL.
11. Open the Web App URL and test adding, editing, importing, exporting, adjusting quantity, and printing barcode labels.

## Embed On Your Website

Use the deployed Apps Script URL in an iframe:

```html
<iframe src="GOOGLE_APPS_SCRIPT_WEB_APP_URL" width="100%" height="900" style="border:0;"></iframe>
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
sku,name,size,color,quantity
RUG-0001,Persian runner,3x10,Red,2
RUG-0002,Wool area rug,8x10,Blue,1
```

Blank SKUs are allowed during import. The backend generates SKUs like `RUG-0001`, `RUG-0002`, and `RUG-0003`.

## Security Notes

This setup is intended for internal warehouse use.

The easiest deployment is:

- `Execute as: Me`
- `Who has access: Anyone with the link`

That means anyone who has the deployed web app link and password can access the app. The included password screen is basic protection only, not enterprise security. For stronger security, deploy access only to specific Google accounts in your organization.

## Practical Notes

- Writes use `LockService` so two people adjusting inventory at the same time are less likely to overwrite each other.
- Barcode labels use JsBarcode CODE128 from a CDN.
- Existing SKUs in the Add Rug form can either add to the current quantity or replace the current quantity.
- CSV import updates existing SKUs and adds new SKUs.
