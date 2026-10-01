const CONFIG = {
  INVENTORY_SHEET: 'Inventory',
  TRANSACTIONS_SHEET: 'Transactions',
  INVENTORY_HEADERS: ['SKU', 'Name', 'Design', 'Size', 'Color', 'Quantity', 'BarcodeValue', 'CreatedAt', 'UpdatedAt'],
  TRANSACTION_HEADERS: ['Timestamp', 'Action', 'SKU', 'QuantityChange', 'PreviousQuantity', 'NewQuantity', 'Notes', 'Name', 'Design', 'Size', 'Color', 'Source', 'RequestId']
};

function setupSheet() {
  requireOwner_();
  const properties = PropertiesService.getScriptProperties();
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!properties.getProperty('INVENTORY_SPREADSHEET_ID') && active) {
    properties.setProperty('INVENTORY_SPREADSHEET_ID', active.getId());
  }
  return withLock_(() => {
    setupSheetsQuietly_();
    return { success: true, message: 'Inventory and Transactions sheets are ready.' };
  });
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.callback) {
    return jsonpResponse_(params.callback, handleWorkerAction_(params.action, params));
  }

  if (params.action) return jsonResponse_(handleWorkerAction_(params.action, params));

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Lotus Rugs Inventory')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    return jsonResponse_(handleApiAction_(body.action, body));
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message || String(error) });
  }
}

function apiGetInventory() {
  return handleApiAction_('getInventory', {});
}

function apiGetInitialData() {
  return handleApiAction_('getInitialData', {});
}

function apiAddOrUpdateRug(rug) {
  return handleApiAction_('addOrUpdateRug', { rug });
}

function apiUpdateRug(rug) {
  return handleApiAction_('updateRug', { rug });
}

function apiAdjustQuantity(sku, quantityChange, notes) {
  return handleApiAction_('adjustQuantity', { sku, quantityChange, notes });
}

function apiBatchAdjustQuantity(rows, notes, requestId) {
  return handleApiAction_('batchAdjustQuantity', { rows, notes, requestId });
}

function apiMigrateExistingSkusToShortFormat() {
  return handleApiAction_('migrateExistingSkusToShortFormat', {});
}

function apiDeleteRug(sku) {
  return handleApiAction_('deleteRug', { sku });
}

function apiImportInventory(rows, mode) {
  return handleApiAction_('importInventory', { rows, mode });
}

function apiGetTransactions(limit) {
  return handleApiAction_('getTransactions', { limit });
}

function getInventory_() {
  const sheet = getInventorySheet_();
  if (!sheet) {
    throw new Error('Inventory sheet is missing. A manager must run setupSheet in Apps Script.');
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

function getInitialData_() {
  const inventoryResponse = getInventory_();
  if (!inventoryResponse.success) return inventoryResponse;

  const transactionResponse = getTransactions_(75);
  return {
    success: true,
    message: 'Inventory loaded.',
    inventory: inventoryResponse.inventory || [],
    transactions: transactionResponse.transactions || []
  };
}

function addOrUpdateRug_(rug) {
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
    if (rowNumber) {
      throw new Error(`SKU ${clean.SKU} already exists. Use Edit to change that rug.`);
    }
    const now = new Date();

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

    commitChanges_([{ rowNumber: sheet.getLastRow() + 1, rug: created }],
      [transaction_('CREATE', created, 0, created.Quantity, rug.notes || '', 'Manager')]);
    return { success: true, message: 'Rug added.', sku: clean.SKU, rug: serializeRug_(created) };
  });
}

function updateRug_(rug) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const clean = normalizeRug_(rug);
    validateRug_(clean);

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

    commitChanges_([{ rowNumber, rug: updated }],
      [transaction_('EDIT', updated, existing.Quantity, updated.Quantity, 'Rug details edited', 'Manager')]);
    return { success: true, message: 'Rug details saved.', sku: clean.SKU, rug: serializeRug_(updated) };
  });
}

function adjustQuantity_(sku, quantityChange, notes) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const cleanSku = String(sku || '').trim().toUpperCase();
    if (!cleanSku) throw new Error('SKU is required.');
    quantityChange = quantityNumber_(quantityChange, true);

    const sheet = getInventorySheet_();
    const rowNumber = findRowBySku_(sheet, cleanSku);
    if (!rowNumber) throw new Error('SKU not found.');

    const existing = getRugByRow_(sheet, rowNumber);
    const previousQuantity = quantityNumber_(existing.Quantity);
    const newQuantity = previousQuantity + quantityChange;
    if (!Number.isSafeInteger(newQuantity) || newQuantity < 0) throw new Error('Quantity cannot go below zero or exceed the quantity limit.');

    existing.Quantity = newQuantity;
    existing.UpdatedAt = new Date();
    commitChanges_([{ rowNumber, rug: existing }],
      [transaction_(quantityChange > 0 ? 'RECEIVE' : 'REMOVE', existing, previousQuantity, newQuantity, notes || '', 'Manager')]);

    return { success: true, message: 'Quantity adjusted.', sku: cleanSku, previousQuantity, newQuantity, rug: serializeRug_(existing) };
  });
}

function batchAdjustQuantity_(rows, notes, requestId, source) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const parsedRows = typeof rows === 'string' ? JSON.parse(rows || '[]') : rows;
    if (!Array.isArray(parsedRows) || parsedRows.length === 0) throw new Error('No scan counts to submit.');

    const sheet = getInventorySheet_();
    if (parsedRows.length > 100) throw new Error('Submit at most 100 SKUs per batch.');
    const grouped = new Map();
    parsedRows.forEach(row => {
      const cleanSku = String(row.sku || row.SKU || '').trim().toUpperCase();
      const quantityChange = quantityNumber_(row.quantityChange ?? row.change, true);
      if (!cleanSku) throw new Error('SKU is required.');
      grouped.set(cleanSku, (grouped.get(cleanSku) || 0) + quantityChange);
    });
    const changes = Array.from(grouped.entries()).filter(([, change]) => change !== 0);
    if (!changes.length) throw new Error('No quantity changes to submit.');
    if (requestId) {
      if (!/^[A-Za-z0-9-]{16,80}$/.test(requestId)) throw new Error('Invalid batch reference.');
      const previous = findRequestTransactions_(requestId);
      if (previous.length) {
        const signature = items => JSON.stringify(items.slice().sort((a, b) => a[0].localeCompare(b[0])));
        if (signature(previous.map(item => [item.SKU, item.QuantityChange])) !== signature(changes)) {
          throw new Error('This batch reference was already used for different counts. Refresh inventory.');
        }
        return { success: true, message: 'Batch already saved.', rugs: changes.map(([sku]) => getRugByRow_(sheet, findRowBySku_(sheet, sku))), transactions: getTransactions_(75).transactions };
      }
    }
    const updates = [];
    changes.forEach(([cleanSku, quantityChange]) => {

      const rowNumber = findRowBySku_(sheet, cleanSku);
      if (!rowNumber) throw new Error(`${cleanSku} was not found.`);

      const existing = getRugByRow_(sheet, rowNumber);
      const previousQuantity = quantityNumber_(existing.Quantity);
      const newQuantity = previousQuantity + quantityChange;
      if (!Number.isSafeInteger(newQuantity) || newQuantity < 0) throw new Error(`${cleanSku} cannot go below zero or exceed the quantity limit.`);

      updates.push({ rowNumber, existing, cleanSku, quantityChange, previousQuantity, newQuantity });
    });

    const submittedAt = new Date();
    updates.forEach(update => {
      update.existing.Quantity = update.newQuantity;
      update.existing.UpdatedAt = submittedAt;
    });
    commitChanges_(updates.map(update => ({ rowNumber: update.rowNumber, rug: update.existing })),
      updates.map(update => transaction_(update.quantityChange > 0 ? 'RECEIVE' : 'REMOVE', update.existing,
        update.previousQuantity, update.newQuantity, notes || 'Mobile scanner batch', source || 'Manager', requestId)));

    return {
      success: true,
      message: `Submitted ${updates.length} scanned SKU${updates.length === 1 ? '' : 's'}.`,
      rugs: updates.map(update => serializeRug_(update.existing)),
      transactions: getTransactions_(75).transactions
    };
  });
}

function deleteRug_(sku) {
  return withLock_(() => {
    setupSheetsQuietly_();
    const cleanSku = String(sku || '').trim().toUpperCase();
    if (!cleanSku) throw new Error('SKU is required.');

    const sheet = getInventorySheet_();
    const rowNumber = findRowBySku_(sheet, cleanSku);
    if (!rowNumber) throw new Error('SKU not found.');

    const existing = getRugByRow_(sheet, rowNumber);
    const history = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    const historyStart = history.getLastRow() + 1;
    ensureRows_(history, historyStart);
    const width = sheet.getLastColumn();
    const previous = sheet.getRange(rowNumber, 1, 1, width).getValues();
    let deleted = false;
    try {
      history.getRange(historyStart, 1, 1, CONFIG.TRANSACTION_HEADERS.length)
        .setValues([transaction_('DELETE', existing, existing.Quantity, 0, 'Deleted SKU', 'Manager')]);
      sheet.deleteRow(rowNumber);
      deleted = true;
      SpreadsheetApp.flush();
    } catch (error) {
      if (deleted) sheet.insertRowsBefore(rowNumber, 1);
      sheet.getRange(rowNumber, 1, 1, width).setValues(previous);
      history.getRange(historyStart, 1, 1, CONFIG.TRANSACTION_HEADERS.length).clearContent();
      SpreadsheetApp.flush();
      throw error;
    }

    return { success: true, message: 'Rug deleted.', sku: cleanSku };
  });
}

function importInventory_(rows, mode) {
  return withLock_(() => {
    setupSheetsQuietly_();
    if (!Array.isArray(rows)) throw new Error('Rows must be an array.');

    if (!rows.length || rows.length > 2000) throw new Error('Import between 1 and 2000 rows at a time.');
    if (mode && mode !== 'create' && mode !== 'update') throw new Error('Invalid import mode.');
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const sheet = getInventorySheet_();
    const existingRows = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.INVENTORY_HEADERS.length).getValues() : [];
    const products = existingRows.map((row, index) => ({ rowNumber: index + 2, rug: rowToObject_(CONFIG.INVENTORY_HEADERS, row) }));
    const seen = new Set();
    const updates = [];
    const transactions = [];
    const errors = [];
    let nextNumber = getNextRugNumber_(sheet);
    let nextRow = sheet.getLastRow() + 1;
    rows.forEach((row, index) => {
      try {
        const clean = normalizeRug_(row);
        if (!clean.SKU) {
          do { clean.SKU = formatShortSku_(nextNumber++); } while (products.some(item => item.rug.SKU === clean.SKU));
        }
        validateRug_(clean);
        if (seen.has(clean.SKU)) throw new Error(`Duplicate SKU ${clean.SKU} in this file.`);
        const existing = products.find(item => String(item.rug.SKU).toUpperCase() === clean.SKU);
        if (existing && mode !== 'update') throw new Error(`SKU ${clean.SKU} exists. Select update mode to replace it.`);
        const duplicate = products.find(item => item !== existing && identityKey_(item.rug) === identityKey_(clean));
        if (duplicate) throw new Error(`Same rug already exists as ${duplicate.rug.SKU}.`);
        const now = new Date();
        const saved = { ...clean, BarcodeValue: clean.SKU, CreatedAt: existing ? existing.rug.CreatedAt : now, UpdatedAt: now };
        const update = { rowNumber: existing ? existing.rowNumber : nextRow++, rug: saved };
        updates.push(update);
        transactions.push(transaction_('IMPORT', saved, existing ? existing.rug.Quantity : 0, saved.Quantity,
          existing ? 'Import: explicit update' : 'Import: new rug', 'Manager'));
        seen.add(clean.SKU);
        if (existing) { existing.rug = saved; updated++; } else { products.push(update); added++; }
      } catch (error) {
        skipped++;
        errors.push({ row: Number(row._rowNumber) || index + 2, sku: String(row.sku || row.SKU || ''), message: error.message });
      }
    });
    if (updates.length) commitChanges_(updates, transactions);
    return { success: true, message: `Import complete. Added ${added}, updated ${updated}, skipped ${skipped}.`, added, updated, skipped, errors };
  });
}

function migrateExistingSkusToShortFormat() {
  requireOwner_();
  return migrateExistingSkusToShortFormat_();
}

function migrateExistingSkusToShortFormat_() {
  return withLock_(() => {
    setupSheetsQuietly_();
    const sheet = getInventorySheet_();
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, message: 'No inventory rows to migrate.', renamed: 0, updatedTransactions: 0 };
    }

    const now = new Date();
    const rowCount = sheet.getLastRow() - 1;
    const range = sheet.getRange(2, 1, rowCount, CONFIG.INVENTORY_HEADERS.length);
    const values = range.getValues();
    const usedSkus = new Set();
    const skuMap = {};
    let nextFallbackNumber = 1;
    let renamed = 0;

    const migratedRows = values.map(row => {
      const rug = rowToObject_(CONFIG.INVENTORY_HEADERS, row);
      const oldSku = String(rug.SKU || '').trim().toUpperCase();
      const preferredNumber = parseRugNumber_(oldSku) || nextFallbackNumber;
      const newSku = nextAvailableShortSku_(preferredNumber, usedSkus);
      nextFallbackNumber = Math.max(nextFallbackNumber, parseRugNumber_(newSku) + 1);
      usedSkus.add(newSku);

      if (oldSku && oldSku !== newSku) {
        skuMap[oldSku] = newSku;
        renamed++;
      }

      const migrated = {
        SKU: newSku,
        Name: rug.Name,
        Design: rug.Design,
        Size: rug.Size,
        Color: rug.Color,
        Quantity: Number(rug.Quantity) || 0,
        BarcodeValue: newSku,
        CreatedAt: rug.CreatedAt,
        UpdatedAt: oldSku !== newSku || String(rug.BarcodeValue || '').trim().toUpperCase() !== newSku ? now : rug.UpdatedAt
      };
      return inventoryObjectToRow_(migrated);
    });

    range.setValues(migratedRows);
    const updatedTransactions = updateTransactionSkuReferences_(skuMap);

    Object.keys(skuMap).forEach(oldSku => {
      const newSku = skuMap[oldSku];
      const migratedRow = migratedRows.find(row => String(row[0] || '').trim().toUpperCase() === newSku);
      const quantity = migratedRow ? Number(migratedRow[5] || 0) : 0;
      logTransaction_('SKU_MIGRATION', newSku, 0, quantity, quantity, `Old SKU: ${oldSku}`);
    });

    return {
      success: true,
      message: `SKU migration complete. Renamed ${renamed} rug${renamed === 1 ? '' : 's'} and updated ${updatedTransactions} transaction row${updatedTransactions === 1 ? '' : 's'}.`,
      renamed,
      updatedTransactions
    };
  });
}

function getTransactions_(limit) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  if (!sheet) {
    return { success: true, message: 'Transactions loaded.', transactions: [] };
  }
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, message: 'Transactions loaded.', transactions: [] };
  }

  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  const maxRows = Math.min(500, Math.max(1, Math.floor(Number(limit) || 75)));
  const count = Math.min(maxRows, lastRow - 1);
  const transactions = sheet.getRange(lastRow - count + 1, 1, count, width).getValues()
    .filter(row => row.some(cell => String(cell || '').trim()))
    .map(row => rowToObject_(headers, row))
    .reverse();

  return { success: true, message: 'Transactions loaded.', transactions };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupSheetsQuietly_() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, CONFIG.INVENTORY_SHEET, CONFIG.INVENTORY_HEADERS);
  ensureSheet_(ss, CONFIG.TRANSACTIONS_SHEET, CONFIG.TRANSACTION_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
    return sheet;
  }

  // Insert missing columns in place without clearing rows or custom columns.
  let currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  headers.forEach((header, index) => {
    if (currentHeaders[index] === header) return;
    if (currentHeaders.includes(header)) throw new Error(`${name} columns are out of order. Restore the documented header order before saving.`);
    sheet.insertColumnBefore(index + 1);
    sheet.getRange(1, index + 1).setValue(header);
    currentHeaders.splice(index, 0, header);
  });
  return sheet;
}

function getInventorySheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.INVENTORY_SHEET);
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
    Quantity: quantityNumber_(rug.Quantity !== undefined ? rug.Quantity : rug.quantity !== undefined ? rug.quantity : 0)
  };
}

function validateRug_(rug) {
  if (!rug.SKU) throw new Error('SKU is required.');
  if (!rug.Name) throw new Error('Name is required.');
  if (!rug.Design) throw new Error('Design is required.');
  if (!rug.Size) throw new Error('Size is required.');
  if (!rug.Color) throw new Error('Color is required.');
  if (!/^[A-Z0-9][A-Z0-9-]{0,79}$/.test(rug.SKU)) throw new Error('SKU must use letters, numbers, and hyphens (up to 80 characters).');
  quantityNumber_(rug.Quantity);
}

function generateNextSku_(sheet, rug) {
  const nextNumber = getNextRugNumber_(sheet);
  PropertiesService.getScriptProperties().setProperty('NEXT_RUG_NUMBER', String(nextNumber + 1));
  return formatShortSku_(nextNumber);
}

function getNextRugNumber_(sheet) {
  const properties = PropertiesService.getScriptProperties();
  const reserved = Number(properties.getProperty('NEXT_RUG_NUMBER')) || 1;
  const values = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat() : [];
  if (!properties.getProperty('NEXT_RUG_NUMBER')) {
    const history = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
    if (history && history.getLastRow() > 1) values.push(...history.getRange(2, 3, history.getLastRow() - 1, 1).getValues().flat());
  }
  const maxNumber = values.reduce((max, sku) => {
    const rugNumber = parseRugNumber_(sku);
    return rugNumber ? Math.max(max, rugNumber) : max;
  }, 0);

  return Math.max(reserved, maxNumber + 1);
}

function formatShortSku_(number) {
  const cleanNumber = Math.max(1, Math.floor(Number(number) || 1));
  return `RUG-${String(cleanNumber).padStart(4, '0')}`;
}

function parseRugNumber_(sku) {
  const match = String(sku || '').trim().match(/^RUG-?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function nextAvailableShortSku_(preferredNumber, usedSkus) {
  let candidateNumber = Math.max(1, Math.floor(Number(preferredNumber) || 1));
  let candidateSku = formatShortSku_(candidateNumber);
  while (usedSkus.has(candidateSku)) {
    candidateNumber++;
    candidateSku = formatShortSku_(candidateNumber);
  }
  return candidateSku;
}

function skuPart_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function updateTransactionSkuReferences_(skuMap) {
  const oldSkus = Object.keys(skuMap || {});
  if (!oldSkus.length) return 0;

  const sheet = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const rowCount = sheet.getLastRow() - 1;
  const range = sheet.getRange(2, 1, rowCount, CONFIG.TRANSACTION_HEADERS.length);
  const values = range.getValues();
  const skuColumnIndex = CONFIG.TRANSACTION_HEADERS.indexOf('SKU');
  let updated = 0;

  values.forEach(row => {
    const oldSku = String(row[skuColumnIndex] || '').trim().toUpperCase();
    if (skuMap[oldSku]) {
      row[skuColumnIndex] = skuMap[oldSku];
      updated++;
    }
  });

  if (updated) range.setValues(values);
  return updated;
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
  const inventory = getInventorySheet_();
  const row = findRowBySku_(inventory, sku);
  const rug = row ? getRugByRow_(inventory, row) : { SKU: sku };
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  sheet.appendRow(transaction_(action, rug, previousQuantity, newQuantity, notes, 'Manager'));
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function requireOwner_() {
  const active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Run this setup function from the owner\'s Apps Script editor.');
  }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('INVENTORY_SPREADSHEET_ID');
  if (!id) throw new Error('Inventory is not configured. A manager must run setupSheet in the original spreadsheet\'s Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function quantityNumber_(value, change) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    throw new Error('Quantity must be a whole number.');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (change ? number === 0 : number < 0)) {
    throw new Error(change ? 'Quantity change must be a nonzero whole number.' : 'Quantity must be a whole number of zero or more.');
  }
  return number;
}

function transaction_(action, rug, previous, next, notes, source, requestId) {
  return [new Date(), action, rug.SKU, next - previous, Number(previous), Number(next), String(notes || '').slice(0, 500),
    rug.Name || '', rug.Design || '', rug.Size || '', rug.Color || '', source, requestId || ''];
}

function findRequestTransactions_(requestId) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  if (sheet.getLastRow() < 2) return [];
  const matches = sheet.getRange(2, CONFIG.TRANSACTION_HEADERS.indexOf('RequestId') + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(requestId).matchEntireCell(true).findAll();
  return matches.map(cell => rowToObject_(CONFIG.TRANSACTION_HEADERS,
    sheet.getRange(cell.getRow(), 1, 1, CONFIG.TRANSACTION_HEADERS.length).getValues()[0]));
}

function commitChanges_(updates, transactions) {
  const inventory = getInventorySheet_();
  const history = getSpreadsheet_().getSheetByName(CONFIG.TRANSACTIONS_SHEET);
  const width = CONFIG.INVENTORY_HEADERS.length;
  const historyStart = history.getLastRow() + 1;
  ensureRows_(inventory, Math.max(...updates.map(update => update.rowNumber)));
  ensureRows_(history, historyStart + transactions.length - 1);
  const groups = [];
  updates.slice().sort((a, b) => a.rowNumber - b.rowNumber).forEach(update => {
    const last = groups[groups.length - 1];
    if (last && last.start + last.updates.length === update.rowNumber) last.updates.push(update);
    else groups.push({ start: update.rowNumber, updates: [update] });
  });
  groups.forEach(group => {
    group.range = inventory.getRange(group.start, 1, group.updates.length, width);
    group.previous = group.range.getValues();
  });
  const safeCells = row => row.map(value => typeof value === 'string' && value.startsWith('=') ? "'" + value : value);
  const properties = PropertiesService.getScriptProperties();
  const next = Math.max(Number(properties.getProperty('NEXT_RUG_NUMBER')) || 1,
    ...updates.map(update => parseRugNumber_(update.rug.SKU) + 1));
  properties.setProperty('NEXT_RUG_NUMBER', String(next));
  // Sheets has no multi-tab transaction. Restore the affected cells on a caught write failure.
  try {
    groups.forEach(group => group.range.setValues(group.updates.map(update => safeCells(inventoryObjectToRow_(update.rug)))));
    history.getRange(historyStart, 1, transactions.length, CONFIG.TRANSACTION_HEADERS.length).setValues(transactions.map(safeCells));
    SpreadsheetApp.flush();
  } catch (error) {
    groups.forEach(group => group.range.setValues(group.previous));
    history.getRange(historyStart, 1, transactions.length, CONFIG.TRANSACTION_HEADERS.length).clearContent();
    SpreadsheetApp.flush();
    throw error;
  }
}

function ensureRows_(sheet, needed) {
  const available = sheet.getMaxRows();
  if (needed > available) sheet.insertRowsAfter(available, needed - available);
}

function handleWorkerAction_(action, body) {
  try {
    switch (action) {
      case 'getInventory': return withLock_(() => getInventory_());
      case 'getInitialData': return withLock_(() => getInitialData_());
      case 'getTransactions': return withLock_(() => getTransactions_(body.limit));
      case 'batchAdjustQuantity':
        if (!body.requestId) throw new Error('Batch reference is required. Refresh the scanner.');
        return batchAdjustQuantity_(body.rows, body.notes, body.requestId, 'Worker');
      default: return { success: false, message: 'This action is available only to a manager.' };
    }
  } catch (error) {
    return { success: false, message: error.message || String(error) };
  }
}

function handleApiAction_(action, body) {
  try {
    switch (action) {
      case 'getInventory':
        return withLock_(() => getInventory_());
      case 'getInitialData':
        return withLock_(() => getInitialData_());
      case 'addOrUpdateRug':
        return addOrUpdateRug_(body.rug || {});
      case 'updateRug':
        return updateRug_(body.rug || {});
      case 'adjustQuantity':
        return adjustQuantity_(body.sku, body.quantityChange, body.notes || '');
      case 'batchAdjustQuantity':
        return batchAdjustQuantity_(body.rows || [], body.notes || '', body.requestId, 'Manager');
      case 'migrateExistingSkusToShortFormat':
        return migrateExistingSkusToShortFormat_();
      case 'deleteRug':
        return deleteRug_(body.sku);
      case 'importInventory':
        return importInventory_(body.rows || [], body.mode);
      case 'getTransactions':
        return withLock_(() => getTransactions_(body.limit));
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

function jsonpResponse_(callback, payload) {
  const cleanCallback = String(callback || '').trim();
  const safeCallback = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(cleanCallback)
    ? cleanCallback
    : 'callback';
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(payload)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
