const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, readyBackend, rug } = require('./apps-script-harness.cjs');
const batch = (backend, rows, requestId) => backend.worker('batchAdjustQuantity', { rows, requestId, notes: 'Warehouse test' });

test('manager creation, worker receive/remove, and new execution all read the same sheet', () => {
  const b = readyBackend();
  assert.equal(b.manager('addOrUpdateRug', { rug: rug('TEST-001') }).success, true);
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: 3 }], 'receive-test-001-0001').success, true);
  assert.equal(b.manager('getInventory').inventory[0].Quantity, 3);
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: -1 }], 'remove-test-001-00001').success, true);
  const reopened = createBackend(b.store);
  assert.equal(reopened.worker('getInitialData').inventory[0].Quantity, 2);
  assert.equal(b.store.getSheetByName('Inventory').data[1][5], 2);
  assert.deepEqual(reopened.worker('getTransactions').transactions.map(t => t.Action), ['REMOVE', 'RECEIVE', 'CREATE']);
  assert.equal(b.store.locks, 0);
  assert.ok(b.store.flushes >= 3);
});

test('no active spreadsheet produces an actionable configuration error instead of false empty inventory', () => {
  const b = createBackend();
  b.store.active = false;
  const result = b.worker('getInitialData');
  assert.equal(result.success, false);
  assert.match(result.message, /run setupSheet/);
  assert.equal(b.store.sheets.size, 0);
});

test('duplicate SKU and duplicate product never change original quantity', () => {
  const b = readyBackend();
  b.manager('addOrUpdateRug', { rug: rug('TEST-001', 5) });
  assert.equal(b.manager('addOrUpdateRug', { rug: rug('TEST-001', 9) }).success, false);
  assert.equal(b.manager('addOrUpdateRug', { rug: rug('TEST-002') }).success, false);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 5);
});

test('backend rejects invalid quantities and negative stock across create, edit, and scanning', () => {
  const b = readyBackend();
  for (const quantity of [NaN, Infinity, -1, 1.5, null, true, '', 'no', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(b.manager('addOrUpdateRug', { rug: rug('BAD', quantity) }).success, false, String(quantity));
  }
  b.manager('addOrUpdateRug', { rug: rug('TEST-001', 2) });
  assert.equal(b.manager('updateRug', { rug: rug('TEST-001', -1) }).success, false);
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: -3 }], 'negative-test-001-01').success, false);
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: 0.5 }], 'fraction-test-001-01').success, false);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 2);
});

test('batch validates all rows before writing and combines repeated SKU rows', () => {
  const b = readyBackend();
  b.manager('addOrUpdateRug', { rug: rug('TEST-001') });
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: 1 }, { sku: 'MISSING', quantityChange: 1 }], 'all-rows-test-001-1').success, false);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 0);
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: 2 }, { sku: 'TEST-001', quantityChange: 1 }], 'combined-test-001-1').success, true);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 3);
  assert.equal(b.worker('getTransactions').transactions[0].QuantityChange, 3);
});

test('retrying a saved batch does not apply it twice, including after restarting backend', () => {
  const b = readyBackend();
  b.manager('addOrUpdateRug', { rug: rug('TEST-001') });
  const rows = [{ sku: 'TEST-001', quantityChange: 3 }];
  assert.equal(batch(b, rows, 'retry-reference-0001').success, true);
  const fresh = createBackend(b.store);
  assert.equal(batch(fresh, rows, 'retry-reference-0001').success, true);
  assert.equal(fresh.worker('getInventory').inventory[0].Quantity, 3);
  assert.equal(fresh.worker('getTransactions').transactions.length, 2);
  assert.equal(batch(fresh, [{ sku: 'TEST-001', quantityChange: 5 }], 'retry-reference-0001').success, false);
});

test('caught transaction write failure restores inventory and preserves existing history', () => {
  const b = readyBackend();
  b.manager('addOrUpdateRug', { rug: rug('TEST-001', 2) });
  b.store.failHistory = true;
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: 3 }], 'failed-write-test-001').success, false);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 2);
  assert.equal(b.worker('getTransactions').transactions.length, 1);
  assert.equal(batch(b, [{ sku: 'TEST-001', quantityChange: 3 }], 'failed-write-test-001').success, true);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 5);
});

test('imports add valid rows, report invalid/duplicate rows, and only overwrite in explicit update mode', () => {
  const b = readyBackend();
  b.manager('addOrUpdateRug', { rug: rug('TEST-001', 2) });
  const result = b.manager('importInventory', { rows: [
    rug('TEST-001', 99), { ...rug('IMPORT-001', 4), design: '2020' },
    { ...rug('IMPORT-002'), color: '' }, { ...rug('IMPORT-001'), design: '2030' },
    { ...rug(''), design: '2040' }
  ] });
  assert.equal(result.success, true);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 3);
  assert.equal(result.errors.length, 3);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 2);
  assert.equal(b.manager('importInventory', { rows: [rug('TEST-001', 7)], mode: 'update' }).updated, 1);
  assert.equal(b.worker('getInventory').inventory[0].Quantity, 7);
  assert.equal(b.worker('getTransactions').transactions[0].Action, 'IMPORT');
});

test('edit keeps permanent SKU and captures product details and quantity delta in history', () => {
  const b = readyBackend();
  b.manager('addOrUpdateRug', { rug: rug('TEST-001', 2) });
  assert.equal(b.manager('updateRug', { rug: { ...rug('TEST-001', 3), name: 'Renamed Rug' } }).success, true);
  const tx = b.worker('getTransactions').transactions[0];
  assert.equal(tx.Action, 'EDIT');
  assert.equal(tx.Name, 'Renamed Rug');
  assert.equal(tx.Size, '5x7');
  assert.equal(tx.QuantityChange, 1);
  assert.equal(tx.PreviousQuantity, 2);
  assert.equal(tx.NewQuantity, 3);
});

test('setup preserves existing inventory, historical rows, and custom columns when adding missing headers', () => {
  const b = createBackend();
  const inventory = b.store.insertSheet('Inventory');
  inventory.data = [['SKU', 'Name', 'Size', 'Color', 'Quantity', 'BarcodeValue', 'CreatedAt', 'UpdatedAt', 'Custom'],
    ['OLD-001', 'Old Rug', '5x7', 'Blue', 2, 'OLD-001', '', '', 'Keep me']];
  const history = b.store.insertSheet('Transactions');
  history.data = [['Timestamp', 'Action', 'SKU', 'QuantityChange', 'PreviousQuantity', 'NewQuantity', 'Notes'],
    ['2026-01-01', 'CREATE', 'OLD-001', 2, 0, 2, 'Keep history']];
  b.call('setupSheet');
  assert.equal(inventory.data[1][5], 2);
  assert.equal(inventory.data[1][9], 'Keep me');
  assert.equal(history.data[1][6], 'Keep history');
  assert.equal(b.worker('getInventory').inventory[0].Design, '');
});

test('short auto SKUs are never reused after deletion', () => {
  const b = readyBackend();
  const first = b.manager('addOrUpdateRug', { rug: rug('') });
  assert.equal(first.sku, 'RUG-0001');
  assert.equal(first.rug.BarcodeValue, first.sku);
  b.manager('deleteRug', { sku: first.sku });
  assert.equal(b.manager('addOrUpdateRug', { rug: rug('') }).sku, 'RUG-0002');
});

test('public worker API rejects creation, editing, import, and migration', () => {
  const b = readyBackend();
  for (const action of ['addOrUpdateRug', 'updateRug', 'importInventory', 'deleteRug', 'migrateExistingSkusToShortFormat']) {
    assert.equal(b.worker(action, { rug: rug('BAD'), rows: [rug('BAD')] }).success, false);
  }
  assert.equal(b.worker('getInitialData').success, true);
});
