const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Range {
  constructor(sheet, row, column, rows = 1, columns = 1) {
    if (!Number.isInteger(row) || row < 1) throw new Error('Invalid row');
    Object.assign(this, { sheet, row, column, rows, columns });
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) =>
      this.sheet.data[this.row - 1 + r]?.[this.column - 1 + c] ?? ''));
  }
  setValues(values) {
    if (values.length !== this.rows || values.some(row => row.length !== this.columns)) throw new Error('Range shape mismatch');
    if (this.sheet.name === 'Transactions' && this.row > 1 && this.sheet.store.failHistory) {
      this.sheet.store.failHistory = false;
      throw new Error('Simulated Sheets write failure');
    }
    values.forEach((row, r) => {
      const target = this.sheet.data[this.row - 1 + r] ||= [];
      row.forEach((value, c) => target[this.column - 1 + c] = value);
    });
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  clearContent() { return this.setValues(Array.from({ length: this.rows }, () => Array(this.columns).fill(''))); }
  getRow() { return this.row; }
  createTextFinder(text) {
    return {
      matchEntireCell() { return this; },
      findAll: () => this.getValues().flatMap((row, r) => row.flatMap((value, c) => String(value) === text
        ? [new Range(this.sheet, this.row + r, this.column + c)] : []))
    };
  }
}

class Sheet {
  constructor(store, name) { Object.assign(this, { store, name, data: [] }); }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(value => value !== '')) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(row => row.reduce((last, value, index) => value !== '' ? index + 1 : last, 0))); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(...args) { return new Range(this, ...args); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  insertRowsAfter(row, count) { this.data.length = Math.max(this.data.length, row + count); }
  appendRow(row) { this.getRange(this.getLastRow() + 1, 1, 1, row.length).setValues([row]); }
  insertColumnBefore(column) { this.data.forEach(row => row.splice(column - 1, 0, '')); }
  insertRowsBefore(row, count) { this.data.splice(row - 1, 0, ...Array.from({ length: count }, () => [])); }
  deleteRow(row) { this.data.splice(row - 1, 1); }
  setFrozenRows() {}
  autoResizeColumns() {}
}

function createStore() {
  const store = { id: 'test-sheet', properties: {}, sheets: new Map(), active: true, locks: 0, flushes: 0 };
  store.getId = () => store.id;
  store.getSheetByName = name => store.sheets.get(name) || null;
  store.insertSheet = name => { const sheet = new Sheet(store, name); store.sheets.set(name, sheet); return sheet; };
  return store;
}

function createBackend(store = createStore()) {
  const context = vm.createContext({
    Date, console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => store.active ? store : null,
      openById: id => { if (id !== store.id) throw new Error('Wrong spreadsheet'); return store; },
      flush: () => { store.flushes++; }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => store.properties[key] || null,
      setProperty: (key, value) => store.properties[key] = value
    }) },
    LockService: { getDocumentLock: () => null, getScriptLock: () => ({
      waitLock: () => { if (store.locks) throw new Error('Nested lock'); store.locks++; },
      releaseLock: () => store.locks--
    }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => store.owner === false ? '' : 'owner@example.test' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' })
    },
    ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'javascript' }, createTextOutput: text => ({
      text, setMimeType() { return this; }
    }) }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../outputs/Code.gs'), 'utf8'), context);
  const call = (name, ...args) => JSON.parse(JSON.stringify(context[name](...args)));
  return { store, context, call, manager: (action, body = {}) => call('handleApiAction_', action, body),
    worker: (action, body = {}) => call('handleWorkerAction_', action, body) };
}

function readyBackend() {
  const backend = createBackend();
  backend.call('setupSheet');
  backend.store.active = false;
  backend.store.owner = false;
  return backend;
}

const rug = (sku, quantity = 0) => ({ sku, name: 'Test Rug', design: '2010', size: '5x7', color: 'Blue', quantity });
module.exports = { createBackend, readyBackend, createStore, rug };
