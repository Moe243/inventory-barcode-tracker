const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { readyBackend } = require('./apps-script-harness.cjs');

const root = path.join(__dirname, '..');
const artifacts = path.join(__dirname, 'artifacts');
const launchOptions = { headless: true, ...(process.env.LOTUS_TEST_CHROMIUM ? { executablePath: process.env.LOTUS_TEST_CHROMIUM } : {}) };
fs.mkdirSync(artifacts, { recursive: true });
const backend = readyBackend();
const results = [];
const pass = name => { results.push({ name, status: 'PASS (local integration)' }); console.log('PASS:', name); };
const quantity = () => backend.worker('getInventory').inventory.find(r => r.SKU === 'TEST-001')?.Quantity;
const waitText = (page, selector, text) => page.waitForFunction(({ selector, text }) =>
  document.querySelector(selector)?.textContent.includes(text), { selector, text });
const libs = [
  ['**/xlsx.full.min.js', '/tmp/lotus-sheetjs-0.20.3.js'],
  ['**/JsBarcode.all.min.js', '/tmp/lotus-jsbarcode-3.11.6.js'],
  ['**/zxing-browser.min.js', '/tmp/lotus-zxing-0.1.5.js']
];

async function wire(context, transport = {}) {
  for (const [pattern, filename] of libs) await context.route(pattern, route =>
    route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(filename, 'utf8') }));
  await context.route('https://script.google.com/macros/s/**', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    transport.requests = (transport.requests || 0) + 1;
    if (transport.offline) return route.abort('internetdisconnected');
    const payload = backend.worker(params.action, params);
    if (transport.loseNextWrite && params.action === 'batchAdjustQuantity') {
      transport.loseNextWrite = false;
      return route.abort('connectionreset');
    }
    await route.fulfill({ contentType: 'application/javascript', body: `${params.callback}(${JSON.stringify(payload)});` });
  });
}

async function managerPage(context, url) {
  const page = await context.newPage();
  await page.exposeFunction('managerRpc', (name, args) => backend.call(name, ...args));
  await page.addInitScript(() => {
    function runner(success, failure) {
      return new Proxy({}, { get: (_, key) => {
        if (key === 'withSuccessHandler') return handler => runner(handler, failure);
        if (key === 'withFailureHandler') return handler => runner(success, handler);
        return (...args) => window.managerRpc(key, args).then(success).catch(error => failure({ message: error.message }));
      } });
    }
    window.google = { script: { run: runner() } };
  });
  await page.goto(url + '/manager');
  await waitText(page, '#notice', 'Inventory loaded.');
  return page;
}

async function count(page, n, sku = 'TEST-001') {
  for (let i = 0; i < n; i++) {
    await page.locator('#manualInput').fill(sku);
    await page.locator('#manualInput').press('Enter');
  }
}

async function submit(page) {
  await page.locator('#submitBtn').click();
  await waitText(page, '#submitNotice', 'Submitted');
}

async function run() {
  const server = http.createServer((request, response) => {
    const filename = request.url === '/manager' ? 'outputs/Index.html'
      : request.url === '/scanner.html' ? 'docs/scanner.html' : request.url === '/config.js' ? 'docs/config.js' : null;
    if (!filename) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : 'text/html');
    response.end(fs.readFileSync(path.join(root, filename)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let cameraBrowser;
  const errors = [];
  try {
    browser = await chromium.launch(launchOptions);
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await wire(desktop);
    desktop.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const manager = await managerPage(desktop, url);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const transport = {};
    await wire(mobile, transport);
    mobile.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let worker = await mobile.newPage();
    await worker.goto(url + '/scanner.html');
    await waitText(worker, '#setupNotice', 'Loaded 0 SKUs.');
    assert.equal(await worker.locator('input[type="password"], #apiUrlInput').count(), 0);
    assert.equal(transport.requests, 1);
    pass('1 Automatic worker load without URL, password, or browser storage');

    await manager.locator('[data-tab="add"]').click();
    for (const [name, value] of Object.entries({ sku: 'TEST-001', name: 'Test Rug', design: '2010', size: '5x7', color: 'Blue', quantity: '0' })) {
      await manager.locator(`#addForm [name="${name}"]`).fill(value);
    }
    await manager.locator('#addForm button[value="same"]').click();
    await waitText(manager, '#notice', 'Rug added.');
    assert.equal(await manager.locator('#addForm [name="name"]').inputValue(), 'Test Rug');
    assert.equal(await manager.locator('#addForm [name="size"]').inputValue(), '');
    await worker.locator('#refreshBtn').click();
    await waitText(worker, '#setupNotice', 'Loaded 1 SKUs.');
    assert.equal(quantity(), 0);
    assert.match(await worker.locator('#inventoryBody').textContent(), /TEST-001/);
    pass('2 Manager creates TEST-001; worker dashboard and sheet contain it');

    await count(worker, 3);
    assert.equal(quantity(), 0);
    assert.equal(await worker.locator('#scanStatusTitle').textContent(), 'Received +1');
    assert.equal(await worker.locator('#pendingPieces').textContent(), '3');
    await submit(worker);
    assert.equal(quantity(), 3);
    await manager.locator('#refreshBtn').click();
    await waitText(manager, '#totalRugs', '3');
    pass('3 Receive 3; server confirmation updates both dashboards, sheet, and history');

    await worker.locator('#removeModeBtn').click();
    assert.equal(await worker.locator('#removeModeBtn').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(180, 35, 24)');
    await count(worker, 1);
    assert.equal(await worker.locator('#scanStatusTitle').textContent(), 'Removed -1');
    await submit(worker);
    assert.equal(quantity(), 2);
    await manager.locator('#refreshBtn').click();
    await waitText(manager, '#totalRugs', '2');
    pass('4 Remove 1; quantity 2 in both dashboards and sheet; red feedback');

    await mobile.close();
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await wire(fresh, transport);
    fresh.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    worker = await fresh.newPage();
    await worker.goto(url + '/scanner.html');
    await waitText(worker, '#setupNotice', 'Loaded 1 SKUs.');
    assert.match(await worker.locator('#resultList').textContent(), /Current quantity: 2/);
    assert.equal(await worker.evaluate(() => localStorage.length), 0);
    pass('5 Fresh browser session automatically reloads persisted quantity 2');

    await manager.locator('[data-tab="import"]').click();
    await manager.locator('#csvFile').setInputFiles({ name: 'rugs.csv', mimeType: 'text/csv', buffer: Buffer.from(
      '\uFEFFsku,name,design,size,color,quantity\r\nTEST-001,Test Rug,2010,5x7,Blue,99\r\nIMPORT-001,"Rug, One",2020,8x10,Red,4\r\nIMPORT-002,"Rug\nTwo",2030,5x8,Green,1\r\nBAD-001,Invalid,2040,5x8,,2') });
    await waitText(manager, '#importNotice', '4 rows ready');
    await manager.locator('#importBtn').click();
    await waitText(manager, '#importNotice', 'Added 2, updated 0, skipped 2');
    assert.equal(await manager.locator('#importErrors li').count(), 2);
    assert.equal(quantity(), 2);
    const xlsxBytes = await manager.evaluate(() => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        ['SKU', 'Collection', 'Pattern', 'Size', 'Colour', 'Qty'],
        ['EXCEL-001', 'Excel Rug', '2050', '8x10', 'Teal', 2]
      ]), 'Rugs');
      return Array.from(new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' })));
    });
    await manager.locator('#csvFile').setInputFiles({ name: 'rugs.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsxBytes) });
    await waitText(manager, '#importNotice', '1 rows ready');
    await manager.locator('#importBtn').click();
    await waitText(manager, '#importNotice', 'Added 1, updated 0, skipped 0');
    await worker.locator('#refreshBtn').click();
    await waitText(worker, '#setupNotice', 'Loaded 4 SKUs.');
    pass('6 CSV and XLSX imports, quoted multiline names, aliases, duplicates, and invalid row reports');

    await worker.locator('[data-view="transactions"]').click();
    await waitText(worker, '#transactionsBody', 'IMPORT');
    const workerHistory = await worker.locator('#transactionsBody').textContent();
    for (const action of ['CREATE', 'RECEIVE', 'REMOVE', 'IMPORT']) assert.ok(workerHistory.includes(action));
    await manager.locator('[data-tab="transactions"]').click();
    await waitText(manager, '#transactionsBody', 'IMPORT');
    for (const action of ['CREATE', 'RECEIVE', 'REMOVE', 'IMPORT']) assert.ok((await manager.locator('#transactionsBody').textContent()).includes(action));
    pass('7 Both interfaces display the same newest-first transaction history');

    await manager.locator('[data-tab="barcodes"]').click();
    const label = manager.locator('.label').filter({ hasText: 'TEST-001' });
    const barcodeSvg = await label.locator('svg').evaluate(el => el.outerHTML);
    await label.locator('svg').screenshot({ path: path.join(artifacts, 'barcode.png') });
    const barcode = 'data:image/png;base64,' + fs.readFileSync(path.join(artifacts, 'barcode.png')).toString('base64');
    await worker.locator('[data-view="scanner"]').click();
    const decoded = await worker.evaluate(async data => (await new ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(data)).getText(), barcode);
    assert.equal(decoded, 'TEST-001');
    await worker.locator('#manualInput').fill(decoded);
    await worker.locator('#manualInput').press('Enter');
    assert.equal(await worker.locator('#pendingPieces').textContent(), '1');
    await worker.locator('#clearBtn').click();
    const bounds = await label.evaluate(el => { const a = el.getBoundingClientRect(), b = el.querySelector('svg').getBoundingClientRect(); return b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom; });
    assert.ok(bounds);
    await manager.emulateMedia({ media: 'print' });
    assert.ok(await label.isVisible());
    await label.locator('svg').screenshot({ path: path.join(artifacts, 'barcode-print.png') });
    const printedBarcode = 'data:image/png;base64,' + fs.readFileSync(path.join(artifacts, 'barcode-print.png')).toString('base64');
    assert.equal(await worker.evaluate(async data => (await new ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(data)).getText(), printedBarcode), 'TEST-001');
    assert.ok(await label.evaluate(el => {
      const box = el.getBoundingClientRect(), details = el.querySelector('.label-detail').getBoundingClientRect();
      return Math.abs(box.height - 1.8 * 96) < 1 && details.bottom <= box.bottom;
    }));
    await manager.screenshot({ path: path.join(artifacts, 'labels-print.png'), fullPage: true });
    await manager.emulateMedia({ media: 'screen' });
    pass('8 Real JsBarcode label decodes to TEST-001 with ZXing; barcode fits label and print view');

    await worker.evaluate(() => scrollTo(0, 0));
    await worker.screenshot({ path: path.join(artifacts, 'worker-mobile.png'), fullPage: true });
    assert.equal(await worker.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await worker.locator('[data-view="inventory"]').click();
    await worker.screenshot({ path: path.join(artifacts, 'inventory-mobile.png'), fullPage: true });
    assert.equal(await worker.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await worker.locator('[data-view="scanner"]').click();

    transport.loseNextWrite = true;
    await count(worker, 1);
    await worker.locator('#submitBtn').click();
    await waitText(worker, '#submitNotice', 'Save was not confirmed');
    assert.equal(quantity(), 3);
    assert.equal(await worker.locator('#clearBtn').isDisabled(), true);
    await worker.locator('#submitBtn').click();
    await waitText(worker, '#submitNotice', 'Batch already saved');
    assert.equal(quantity(), 3);
    pass('Lost server response: immutable retry saves a batch only once');

    await count(worker, 1, 'MISSING');
    assert.equal(await worker.locator('#pendingPieces').textContent(), '0');
    assert.equal(await worker.locator('#scanStatusTitle').textContent(), 'Not Found');
    await worker.locator('#targetOnlyInput').check();
    await count(worker, 1, 'IMPORT-001');
    assert.equal(await worker.locator('#scanStatusTitle').textContent(), 'Wrong SKU');
    assert.equal(await worker.locator('#pendingPieces').textContent(), '0');
    await worker.locator('#targetOnlyInput').uncheck();
    transport.offline = true;
    await count(worker, 1);
    await worker.locator('#submitBtn').click();
    await waitText(worker, '#submitNotice', 'Save was not confirmed');
    assert.equal(quantity(), 3);
    assert.equal(await worker.locator('#pendingPieces').textContent(), '1');
    transport.offline = false;
    await submit(worker);
    assert.equal(quantity(), 4);
    transport.offline = true;
    await worker.locator('#refreshBtn').click();
    await waitText(worker, '#setupNotice', 'Unable to connect to inventory');
    assert.equal(await worker.locator('#startBtn').isDisabled(), true);
    transport.offline = false;
    pass('Offline and rejected scans never claim an inventory save or update quantities locally');

    const cameraFile = path.join(os.tmpdir(), 'lotus-test-camera.y4m');
    const renderedBarcode = await sharp(Buffer.from(barcodeSvg), { density: 144 }).flatten({ background: '#fff' }).png().toBuffer();
    const barcodeSize = await sharp(renderedBarcode).metadata();
    const frameWidth = barcodeSize.width;
    const frameHeight = barcodeSize.height;
    const leftPad = Math.floor((640 - frameWidth) / 2);
    const topPad = Math.floor((480 - frameHeight) / 2);
    const pixels = await sharp(renderedBarcode).removeAlpha().greyscale()
      .extend({ top: topPad, bottom: 480 - frameHeight - topPad, left: leftPad, right: 640 - frameWidth - leftPad, background: '#fff' })
      .raw().toBuffer({ resolveWithObject: true });
    assert.equal(pixels.info.channels, 1);
    const frame = Buffer.concat([Buffer.from('FRAME\n'), pixels.data, Buffer.alloc(640 * 480 / 2, 128)]);
    fs.writeFileSync(cameraFile, Buffer.concat([Buffer.from('YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n'), ...Array(50).fill(frame)]));
    cameraBrowser = await chromium.launch({ ...launchOptions, args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cameraFile}`
    ] });
    const cameraContext = await cameraBrowser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
    await wire(cameraContext);
    const cameraPage = await cameraContext.newPage();
    cameraPage.on('pageerror', error => errors.push(error.message));
    await cameraPage.goto(url + '/scanner.html');
    await waitText(cameraPage, '#setupNotice', 'Loaded 4 SKUs.');
    await cameraPage.locator('#startBtn').click();
    try {
      await waitText(cameraPage, '#scanStatusTitle', 'Received +1');
    } catch (error) {
      await cameraPage.screenshot({ path: path.join(artifacts, 'camera-failure.png'), fullPage: true });
      console.log('Camera diagnostics:', await cameraPage.evaluate(() => ({
        notice: document.querySelector('#scanNotice').textContent,
        status: document.querySelector('#scanStatusTitle').textContent,
        width: document.querySelector('video').videoWidth, height: document.querySelector('video').videoHeight,
        ready: document.querySelector('video').readyState
      })));
      throw error;
    }
    await cameraPage.waitForTimeout(1600);
    assert.equal(await cameraPage.locator('#pendingPieces').textContent(), '1');
    await cameraPage.screenshot({ path: path.join(artifacts, 'camera-mobile.png'), fullPage: true });
    await cameraPage.locator('#stopBtn').click();
    await submit(cameraPage);
    assert.equal(quantity(), 5);
    pass('9 Mobile camera stream: real ZXing detects CODE128, avoids repeated frame counts, and saves to sheet');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  } finally {
    if (cameraBrowser) await cameraBrowser.close();
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
