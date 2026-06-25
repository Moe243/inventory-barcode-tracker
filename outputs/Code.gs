const CONFIG = {
  INVENTORY_SHEET: 'Inventory',
  TRANSACTIONS_SHEET: 'Transactions',
  INVENTORY_HEADERS: ['SKU', 'Name', 'Design', 'Size', 'Color', 'Quantity', 'BarcodeValue', 'CreatedAt', 'UpdatedAt'],
  TRANSACTION_HEADERS: ['Timestamp', 'Action', 'SKU', 'QuantityChange', 'PreviousQuantity', 'NewQuantity', 'Notes'],
  PASSWORD: 'change-me-lotus'
};

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, CONFIG.INVENTORY_SHEET, CONFIG.INVENTORY_HEADERS);
  ensureSheet_(ss, CONFIG.TRANSACTIONS_SHEET, CONFIG.TRANSACTION_HEADERS);
  return jsonResponse_({ success: true, message: 'Sheets are ready.' });
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Lotus Rugs Inventory')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    return jsonResponse_(handleApiAction_(body.action, body.password, body));
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message || String(error) });
  }
}

function validatePassword(password) {
  return isPasswordValid_(password)
    ? { success: true, message: 'Password accepted.' }
    : { success: false, message: 'Wrong password.' };
}

function apiGetInventory(password) {
  return handleApiAction_('getInventory', password, {});
}

function apiGetInitialData(password) {
  return handleApiAction_('getInitialData', password, {});
}

function apiAddOrUpdateRug(password, rug) {
  return handleApiAction_('addOrUpdateRug', password, { rug });
}

function apiUpdateRug(password, rug) {
  return handleApiAction_('updateRug', password, { rug });
}

function apiAdjustQuantity(password, sku, quantityChange, notes) {
  return handleApiAction_('adjustQuantity', password, { sku, quantityChange, notes });
}

function apiDeleteRug(password, sku) {
  return handleApiAction_('deleteRug', password, { sku });
}

function apiImportInventory(password, rows) {
  return handleApiAction_('importInventory', password, { rows });
}

function apiGetTransactions(password, limit) {
  return handleApiAction_('getTransactions', password, { limit });
}

function getInventory() {
  const sheet = getInventorySheet_();
  if (!sheet) {
    return { success: true, message: 'Inventory loaded.', inventory: [] };
  }
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { success: true, message: 'Inventory loaded.', inventory: [] };
  }

  const headers = values[0];
  const rows = values.slice(1)
    .filter(row => String(row[0] || '').trim())
    .map(row => rowToObject_(headers, row));

  return { success: true, message: 'Inventory loaded.', inventory: rows };
}

function getInitialData() {
  const inventoryResponse = getInventory();
  if (!inventoryResponse.success) return inventoryResponse;

  const transactionResponse = getTransactions(75);
  return {
    success: true,
    message: 'Inventory loaded.',
    inventory: inventoryResponse.inventory || [],
    transactions: transactionResponse.transactions || []
  };
}

function addOrUpdateRug(rug) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const sheet = getInventorySheet_();
    const clean = normalizeRug_(rug);
    if (!clean.SKU) clean.SKU = generateNextSku_(sheet, clean);
    validateRug_(clean);

    const rowNumber = findRowBySku_(sheet, clean.SKU);
    const duplicateRowNumber = findRowByIdentity_(sheet, clean, clean.SKU);
    if (duplicateRowNumber) {
      const duplicate = getRugByRow_(sheet, duplicateRowNumber);
      return {
        success: false,
        message: `Duplicate rug found: ${duplicate.SKU}. Edit that SKU instead of creating another.`
      };
    }
    const now = new Date();
    const mode = String(rug.mode || 'add').toLowerCase();

    if (rowNumber) {
      const existing = getRugByRow_(sheet, rowNumber);
      const previousQuantity = Number(existing.Quantity) || 0;
      const incomingQuantity = Number(clean.Quantity) || 0;
      const newQuantity = mode === 'replace' ? incomingQuantity : previousQuantity + incomingQuantity;

      const updated = {
        SKU: existing.SKU,
        Name: clean.Name || existing.Name,
        Design: clean.Design || existing.Design,
        Size: clean.Size || existing.Size,
        Color: clean.Color || existing.Color,
        Quantity: newQuantity,
        BarcodeValue: existing.BarcodeValue || existing.SKU,
        CreatedAt: existing.CreatedAt || now,
        UpdatedAt: now
      };

      writeInventoryRow_(sheet, rowNumber, updated);
      logTransaction_('ADD_OR_UPDATE', clean.SKU, newQuantity - previousQuantity, previousQuantity, newQuantity, rug.notes || '');
      return { success: true, message: 'Rug updated.', sku: clean.SKU, rug: serializeRug_(updated) };
    }

    const created = {
      SKU: clean.SKU,
      Name: clean.Name,
      Design: clean.Design,
      Size: clean.Size,
      Color: clean.Color,
      Quantity: Number(clean.Quantity) || 0,
      BarcodeValue: clean.SKU,
      CreatedAt: now,
      UpdatedAt: now
    };

    sheet.appendRow(inventoryObjectToRow_(created));
    logTransaction_('CREATE', clean.SKU, created.Quantity, 0, created.Quantity, rug.notes || '');
    return { success: true, message: 'Rug added.', sku: clean.SKU, rug: serializeRug_(created) };
  });
}

function updateRug(rug) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const clean = normalizeRug_(rug);
    if (!clean.SKU) throw new Error('SKU is required.');

    const sheet = getInventorySheet_();
    const rowNumber = findRowBySku_(sheet, clean.SKU);
    if (!rowNumber) throw new Error('SKU not found.');
    const duplicateRowNumber = findRowByIdentity_(sheet, clean, clean.SKU);
    if (duplicateRowNumber && duplicateRowNumber !== rowNumber) {
      const duplicate = getRugByRow_(sheet, duplicateRowNumber);
      return {
        success: false,
        message: `Duplicate rug found: ${duplicate.SKU}. Edit that SKU instead of creating another.`
      };
    }

    const existing = getRugByRow_(sheet, rowNumber);
    const updated = {
      SKU: existing.SKU,
      Name: clean.Name,
      Design: clean.Design,
      Size: clean.Size,
      Color: clean.Color,
      Quantity: Number(clean.Quantity),
      BarcodeValue: existing.BarcodeValue || existing.SKU,
      CreatedAt: existing.CreatedAt,
      UpdatedAt: new Date()
    };

    if (Number.isNaN(updated.Quantity) || updated.Quantity < 0) throw new Error('Quantity must be zero or more.');
    writeInventoryRow_(sheet, rowNumber, updated);
    return { success: true, message: 'Rug details saved.', sku: clean.SKU, rug: serializeRug_(updated) };
  });
}

function adjustQuantity(sku, quantityChange, notes) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const cleanSku = String(sku || '').trim().toUpperCase();
    if (!cleanSku) throw new Error('SKU is required.');
    if (!Number.isFinite(quantityChange) || quantityChange === 0) throw new Error('Quantity change must not be zero.');

    const sheet = getInventorySheet_();
    const rowNumber = findRowBySku_(sheet, cleanSku);
    if (!rowNumber) throw new Error('SKU not found.');

    const existing = getRugByRow_(sheet, rowNumber);
    const previousQuantity = Number(existing.Quantity) || 0;
    const newQuantity = previousQuantity + quantityChange;
    if (newQuantity < 0) throw new Error('Quantity cannot go below zero.');

    existing.Quantity = newQuantity;
    existing.UpdatedAt = new Date();
    writeInventoryRow_(sheet, rowNumber, existing);
    logTransaction_(quantityChange > 0 ? 'RECEIVE' : 'REMOVE', cleanSku, quantityChange, previousQuantity, newQuantity, notes || '');

    return { success: true, message: 'Quantity adjusted.', sku: cleanSku, previousQuantity, newQuantity, rug: serializeRug_(existing) };
  });
}

function deleteRug(sku) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const cleanSku = String(sku || '').trim().toUpperCase();
    if (!cleanSku) throw new Error('SKU is required.');

    const sheet = getInventorySheet_();
    const rowNumber = findRowBySku_(sheet, cleanSku);
    if (!rowNumber) throw new Error('SKU not found.');

    const existing = getRugByRow_(sheet, rowNumber);
    sheet.deleteRow(rowNumber);
    logTransaction_('DELETE', cleanSku, -Number(existing.Quantity || 0), Number(existing.Quantity || 0), 0, 'Deleted SKU');

    return { success: true, message: 'Rug deleted.', sku: cleanSku };
  });
}

function importInventory(rows) {
  return withLock_(() => {
    setupSheetsQuietly_();
    if (!Array.isArray(rows)) throw new Error('Rows must be an array.');

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const sheet = getInventorySheet_();

    rows.forEach(row => {
      const clean = normalizeRug_(row);
      if (!clean.SKU) clean.SKU = generateNextSku_(sheet, clean);
      validateRug_(clean);

      const rowNumber = findRowBySku_(sheet, clean.SKU);
      const duplicateRowNumber = findRowByIdentity_(sheet, clean, clean.SKU);
      if (duplicateRowNumber) {
        skipped++;
        return;
      }
      const now = new Date();

      if (rowNumber) {
        const existing = getRugByRow_(sheet, rowNumber);
        const updatedRug = {
          SKU: existing.SKU,
          Name: clean.Name || existing.Name,
          Design: clean.Design || existing.Design,
          Size: clean.Size || existing.Size,
          Color: clean.Color || existing.Color,
          Quantity: Number(clean.Quantity) || 0,
          BarcodeValue: existing.BarcodeValue || existing.SKU,
          CreatedAt: existing.CreatedAt || now,
          UpdatedAt: now
        };
        writeInventoryRow_(sheet, rowNumber, updatedRug);
        logTransaction_('IMPORT_UPDATE', clean.SKU, updatedRug.Quantity - Number(existing.Quantity || 0), Number(existing.Quantity || 0), updatedRug.Quantity, 'CSV import');
        updated++;
      } else {
        const newRug = {
          SKU: clean.SKU,
          Name: clean.Name,
          Design: clean.Design,
          Size: clean.Size,
          Color: clean.Color,
          Quantity: Number(clean.Quantity) || 0,
          BarcodeValue: clean.SKU,
          CreatedAt: now,
          UpdatedAt: now
        };
        sheet.appendRow(inventoryObjectToRow_(newRug));
        logTransaction_('IMPORT_CREATE', clean.SKU, newRug.Quantity, 0, newRug.Quantity, 'CSV import');
        added++;
      }
    });

    return { success: true, message: `Import complete. Added ${added}, updated ${updated}, skipped ${skipped} duplicates.`, added, updated, skipped };
  });
}

function getTransactions(limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  if (!sheet) {
    return { success: true, message: 'Transactions loaded.', transactions: [] };
  }
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { success: true, message: 'Transactions loaded.', transactions: [] };
  }

  const headers = values[0];
  const maxRows = Math.max(1, Number(limit || 75));
  const transactions = values.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim()))
    .slice(-maxRows)
    .map(row => rowToObject_(headers, row))
    .reverse();

  return { success: true, message: 'Transactions loaded.', transactions };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupSheetsQuietly_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, CONFIG.INVENTORY_SHEET, CONFIG.INVENTORY_HEADERS);
  ensureSheet_(ss, CONFIG.TRANSACTIONS_SHEET, CONFIG.TRANSACTION_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
    return sheet;
  }

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const currentHeaders = values[0].map(header => String(header || '').trim());
  const hasHeaders = headers.length === currentHeaders.filter(Boolean).length &&
    headers.every((header, index) => currentHeaders[index] === header);

  if (!hasHeaders) {
    const headerIndex = currentHeaders.reduce((index, header, columnIndex) => {
      if (header) index[header] = columnIndex;
      return index;
    }, {});
    const remappedRows = values.slice(1)
      .filter(row => row.some(cell => String(cell || '').trim()))
      .map(row => headers.map(header => {
        if (Object.prototype.hasOwnProperty.call(headerIndex, header)) {
          return row[headerIndex[header]];
        }
        return '';
      }));

    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (remappedRows.length) {
      sheet.getRange(2, 1, remappedRows.length, headers.length).setValues(remappedRows);
    }
    sheet.setFrozenRows(1);
  }
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function getInventorySheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INVENTORY_SHEET);
}

function findRowBySku_(sheet, sku) {
  const cleanSku = String(sku || '').trim().toUpperCase();
  if (!cleanSku || sheet.getLastRow() < 2) return null;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toUpperCase() === cleanSku) {
      return i + 2;
    }
  }
  return null;
}

function findRowByIdentity_(sheet, rug, excludedSku) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const cleanExcludedSku = String(excludedSku || '').trim().toUpperCase();
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.INVENTORY_HEADERS.length).getValues();

  for (let i = 0; i < values.length; i++) {
    const existing = rowToObject_(CONFIG.INVENTORY_HEADERS, values[i]);
    if (String(existing.SKU || '').trim().toUpperCase() === cleanExcludedSku) continue;
    if (identityKey_(existing) === identityKey_(rug)) return i + 2;
  }
  return null;
}

function getRugByRow_(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, CONFIG.INVENTORY_HEADERS.length).getValues()[0];
  return rowToObject_(CONFIG.INVENTORY_HEADERS, values);
}

function writeInventoryRow_(sheet, rowNumber, rug) {
  sheet.getRange(rowNumber, 1, 1, CONFIG.INVENTORY_HEADERS.length).setValues([inventoryObjectToRow_(rug)]);
}

function inventoryObjectToRow_(rug) {
  return [
    rug.SKU,
    rug.Name,
    rug.Design,
    rug.Size,
    rug.Color,
    Number(rug.Quantity) || 0,
    rug.BarcodeValue || rug.SKU,
    rug.CreatedAt,
    rug.UpdatedAt
  ];
}

function rowToObject_(headers, row) {
  return headers.reduce((object, header, index) => {
    const value = row[index];
    object[header] = value instanceof Date ? value.toISOString() : value;
    return object;
  }, {});
}

function normalizeRug_(rug) {
  return {
    SKU: String(rug.SKU || rug.sku || '').trim().toUpperCase(),
    Name: String(rug.Name || rug.name || rug.collection || '').trim(),
    Design: String(rug.Design || rug.design || rug.pattern || '').trim(),
    Size: String(rug.Size || rug.size || '').trim(),
    Color: String(rug.Color || rug.color || '').trim(),
    Quantity: Number(rug.Quantity ?? rug.quantity ?? 0)
  };
}

function validateRug_(rug) {
  if (!rug.SKU) throw new Error('SKU is required.');
  if (!rug.Name) throw new Error('Name is required.');
  if (!rug.Design) throw new Error('Design is required.');
  if (!rug.Size) throw new Error('Size is required.');
  if (!rug.Color) throw new Error('Color is required.');
  if (!Number.isFinite(rug.Quantity) || rug.Quantity < 0) throw new Error('Quantity must be zero or more.');
}

function generateNextSku_(sheet, rug) {
  const nextNumber = getNextRugNumber_(sheet);
  return [
    `RUG${nextNumber}`,
    skuPart_(rug.Name),
    skuPart_(rug.Design),
    skuPart_(rug.Size),
    skuPart_(rug.Color)
  ].filter(Boolean).join('-');
}

function getNextRugNumber_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return 1;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const maxNumber = values.reduce((max, sku) => {
    const match = String(sku || '').match(/^RUG-?(\d+)/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return maxNumber + 1;
}

function skuPart_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function identityKey_(rug) {
  return [
    rug.Name,
    rug.Design,
    rug.Size,
    rug.Color
  ].map(value => String(value || '').trim().toUpperCase()).join('|');
}

function serializeRug_(rug) {
  return CONFIG.INVENTORY_HEADERS.reduce((object, header) => {
    const value = rug[header];
    object[header] = value instanceof Date ? value.toISOString() : value;
    return object;
  }, {});
}

function logTransaction_(action, sku, quantityChange, previousQuantity, newQuantity, notes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  sheet.appendRow([
    new Date(),
    action,
    sku,
    Number(quantityChange) || 0,
    Number(previousQuantity) || 0,
    Number(newQuantity) || 0,
    notes || ''
  ]);
}

function withLock_(callback) {
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000);
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function isPasswordValid_(password) {
  return String(password || '') === CONFIG.PASSWORD;
}

function handleApiAction_(action, password, body) {
  if (!isPasswordValid_(password)) {
    return { success: false, message: 'Invalid password.' };
  }

  try {
    switch (action) {
      case 'getInventory':
        return getInventory();
      case 'getInitialData':
        return getInitialData();
      case 'addOrUpdateRug':
        return addOrUpdateRug(body.rug || {});
      case 'updateRug':
        return updateRug(body.rug || {});
      case 'adjustQuantity':
        return adjustQuantity(body.sku, Number(body.quantityChange), body.notes || '');
      case 'deleteRug':
        return deleteRug(body.sku);
      case 'importInventory':
        return importInventory(body.rows || []);
      case 'getTransactions':
        return getTransactions(body.limit);
      default:
        return { success: false, message: 'Unknown action.' };
    }
  } catch (error) {
    return { success: false, message: error.message || String(error) };
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
