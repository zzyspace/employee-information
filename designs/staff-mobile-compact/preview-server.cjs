#!/usr/bin/env node
'use strict';

// Local-only staff preview. All records are invented here; no database or real API is read.
// Usage: node /tmp/staff-current-style-preview.cjs selfcheck|server|verify
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const PORTAL = process.env.STAFF_VERIFY_SOURCE || path.join(__dirname, 'index.html');
const OUTPUT = process.env.STAFF_PREVIEW_OUTPUT || path.join(__dirname, 'previews');
const PLAYWRIGHT = '/Users/ryan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MODE = process.argv[2] || 'server';
const WIDTHS = [320, 390, 768, 1440];
const PERMISSIONS = ['employee:view', 'employee:edit', 'employee:delete', 'employee:restore', 'attachment:view'];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeSamplePng() {
  // Abstract blue document placeholder, deliberately containing no identity data or photograph.
  const width = 640, height = 400;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [243, 247, 252];
    if (x > 24 && x < 616 && y > 24 && y < 376) rgb = [255, 255, 255];
    if (x > 24 && x < 616 && y > 24 && y < 89) rgb = [221, 236, 254];
    if (x > 55 && x < 290 && y > 45 && y < 60) rgb = [55, 106, 167];
    if (x > 441 && x < 582 && y > 125 && y < 289) rgb = [221, 232, 245];
    if (x > 60 && x < 382 && [138, 176, 214, 252, 315].some(start => y > start && y < start + 12)) rgb = [202, 215, 231];
    const index = y * (width * 3 + 1) + 1 + x * 3;
    raw[index] = rgb[0]; raw[index + 1] = rgb[1]; raw[index + 2] = rgb[2];
  }
  function chunk(type, bytes) {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, checksum]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const samplePng = makeSamplePng();
const attachment = (id, kind) => ({
  id: `${id}-${kind}`, version: 2,
  originalName: `虚构样例-${kind}.png`, contentType: 'image/png', sizeBytes: samplePng.length,
  url: `/staff/api/admin/submissions/${id}/attachments/${kind}`,
});
const seeds = [
  ['demo-1001', '林晴', 'fuzzy', 'front_of_house', true, false],
  ['demo-1002', '周禾', 'fuzzy_qz', 'back_of_house', false, false],
  ['demo-1003', '许夏', 'peanut', 'front_of_house', true, false],
  ['demo-1004', '沈月', 'fuzzy', 'back_of_house', false, false],
  ['demo-1005', '顾宁', 'fuzzy_qz', 'front_of_house', true, false],
  ['demo-1006', '程星', 'peanut', 'back_of_house', false, true],
  ['demo-1007', '赵溪', 'fuzzy', 'front_of_house', true, true],
];
const records = seeds.map(([id, name, storeKey, position, health, deleted], index) => ({
  id, submitId: 1001 + index, name, storeKey, position,
  phone: `1300000${String(index + 1).padStart(4, '0')}`,
  identityCardNumber: `00000019900101${String(index + 1).padStart(4, '0')}`,
  createdAt: `2026-09-${String(25 - index).padStart(2, '0')}T02:30:00.000Z`,
  updatedAt: '2026-09-26T01:15:00.000Z', version: 2,
  deletedAt: deleted ? '2026-09-26T02:00:00.000Z' : null,
  attachments: { idCardFront: attachment(id, 'idCardFront'), idCardBack: attachment(id, 'idCardBack'), healthCertificate: health ? attachment(id, 'healthCertificate') : null },
}));

function json(body, status = 200) { return { status, type: 'application/json; charset=utf-8', body: JSON.stringify(body) }; }
function route(method, rawUrl) {
  if (!['GET', 'HEAD'].includes(method)) return json({ success: false, error: { message: '本地虚构数据预览禁止所有写入。' } }, 405);
  const url = new URL(rawUrl, 'http://127.0.0.1');
  if (['/', '/staff', '/staff/'].includes(url.pathname)) return { status: 200, type: 'text/html; charset=utf-8', body: fs.readFileSync(PORTAL) };
  const staticFiles = { '/before': ['baseline.html','text/html'], '/review': ['review.html','text/html'], '/compact.css': ['compact.css','text/css'] };
  if(staticFiles[url.pathname]) { const [file,type]=staticFiles[url.pathname];return {status:200,type:type+'; charset=utf-8',body:fs.readFileSync(path.join(__dirname,file))}; }
  if (url.pathname === '/favicon.ico') return { status: 204, type: 'image/x-icon', body: '' };
  if (url.pathname === '/auth/api/session') return json({
    success: true, username: 'fictional-preview', displayName: '虚构数据预览',
    apps: ['expense', 'invoice', 'staff', 'store'], canManageAccounts: true,
    destinations: { expense: '/expense', invoice: '/invoice', staff: '/staff', store: '/store' },
  });
  if (url.pathname === '/staff/api/admin/session') return json({ success: true, username: 'fictional-preview', permissions: PERMISSIONS, stores: 'all' });
  if (url.pathname === '/staff/api/admin/submissions') {
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const storeKey = url.searchParams.get('storeKey') || '', status = url.searchParams.get('status') || 'active';
    const matching = records.filter(item =>
      (!storeKey || item.storeKey === storeKey) &&
      (status === 'all' || (status === 'deleted' ? Boolean(item.deletedAt) : !item.deletedAt)) &&
      (!search || [item.name, item.phone, item.identityCardNumber, String(item.submitId)].some(value => value.toLowerCase().includes(search)))
    );
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    return json({ success: true, total: matching.length, items: matching.slice(offset, offset + limit) });
  }
  const match = url.pathname.match(/^\/staff\/api\/admin\/submissions\/([^/]+)(?:\/(history|attachments)(?:\/([^/]+))?)?$/);
  if (match) {
    const item = records.find(record => record.id === decodeURIComponent(match[1]));
    if (!item) return json({ success: false, error: { message: '虚构样例不存在。' } }, 404);
    if (match[2] === 'history') return json({ success: true, items: [
      { ...item, version: 2, action: 'updated', changedAt: item.updatedAt, actorUsername: 'preview-admin', actorDisplayName: '演示管理员' },
      { ...item, version: 1, action: 'created', changedAt: item.createdAt, actorUsername: null, actorDisplayName: '员工提交', attachments: { ...item.attachments, healthCertificate: null } },
    ] });
    if (match[2] === 'attachments' && Object.hasOwn(item.attachments, match[3]) && item.attachments[match[3]]) return { status: 200, type: 'image/png', body: samplePng };
    if (!match[2]) return json({ success: true, item });
  }
  return json({ success: false, error: { message: '预览仅提供员工页面和本地虚构 API。' } }, 404);
}

function startServer(port) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    try {
      const result = route(req.method, req.url);
      res.writeHead(result.status, { 'Content-Type': result.type, 'Cache-Control': 'no-store', ...(result.status === 405 ? { Allow: 'GET, HEAD' } : {}) });
      res.end(req.method === 'HEAD' ? undefined : result.body);
    } catch (error) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(String(error)); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, requests, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function selfcheck() {
  assert.equal(JSON.parse(route('GET', '/staff/api/admin/submissions').body).total, 5);
  assert.equal(JSON.parse(route('GET', '/staff/api/admin/submissions?status=all').body).total, 7);
  assert.equal(JSON.parse(route('GET', '/staff/api/admin/submissions?status=deleted').body).total, 2);
  assert.equal(JSON.parse(route('GET', '/staff/api/admin/submissions?storeKey=fuzzy_qz').body).total, 2);
  assert.equal(JSON.parse(route('GET', '/staff/api/admin/submissions?search=%E6%9E%97%E6%99%B4').body).total, 1);
  assert.equal(JSON.parse(route('GET', '/staff/api/admin/submissions/demo-1001/history').body).items.length, 2);
  assert.equal(route('GET', '/staff/api/admin/submissions/demo-1001/attachments/idCardFront').type, 'image/png');
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS']) assert.equal(route(method, '/staff/api/admin/submissions/demo-1001').status, 405);
  assert.ok(route('GET', '/staff').body.includes(Buffer.from('function openDetail')));
  console.log(JSON.stringify({ mode: 'selfcheck', status: 'passed', fixtureRecords: records.length, active: 5, deleted: 2, writes: '405', source: PORTAL }));
}

async function verify() {
  const { chromium } = require(PLAYWRIGHT);
  fs.mkdirSync(OUTPUT, { recursive: true });
  const local = await startServer(0);
  const results = [], failures = [], errors = [], blockedRequests = [];
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    for (const width of WIDTHS) for (const theme of ['light', 'dark']) {
      const label = `${width}-${theme}`, context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
      await context.addInitScript(({value,key}) => { if (window === window.top) localStorage.setItem(key,value); }, {value:theme,key:process.env.STAFF_VERIFY_SOURCE?'comeover-admin-theme':'staff-mobile-compact-theme'});
      await context.route('**/*', requestRoute => {
        const requestUrl = requestRoute.request().url();
        if (requestUrl.startsWith(local.origin + '/') || requestUrl.startsWith('blob:') || requestUrl.startsWith('data:')) return requestRoute.continue();
        blockedRequests.push({ case: label, url: requestUrl }); return requestRoute.abort();
      });
      const page = await context.newPage(), caseErrors = [], stages = [];
      page.on('pageerror', error => caseErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') caseErrors.push(message.text()); });
      const shot = stage => page.screenshot({ path: path.join(OUTPUT, `staff-${label}-${stage}.png`), fullPage: stage === 'list' });
      const layout = async stage => {
        const measured = await page.evaluate(() => {
          const root = document.documentElement, header = document.querySelector('body > .topbar'), rect = header.getBoundingClientRect(), style = getComputedStyle(header);
          return { viewport: innerWidth, scrollWidth: root.scrollWidth, bodyScrollWidth: document.body.scrollWidth, topbar: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: style.borderRadius, shadow: style.boxShadow }, theme: root.dataset.theme };
        });
        assert.ok(measured.scrollWidth <= measured.viewport && measured.bodyScrollWidth <= measured.viewport, `${label}/${stage}: horizontal page overflow ${JSON.stringify(measured)}`);
        assert.equal(measured.theme, theme, `${label}: unexpected theme`);
        assert.equal(measured.topbar.x, 0); assert.equal(measured.topbar.width, width);
        assert.ok(measured.topbar.height >= 64, `${label}: header shorter than 64px`);
        assert.equal(measured.topbar.radius, '0px'); assert.equal(measured.topbar.shadow, 'none');
        stages.push({ stage, ...measured });
      };
      const listChange = async (action, expected) => {
        await Promise.all([
          page.waitForResponse(response => {
            if (!response.url().startsWith(local.origin + '/staff/api/admin/submissions?')) return false;
            const parsed = new URL(response.url());
            return Object.entries(expected).every(([key, value]) => parsed.searchParams.get(key) === value);
          }), action(),
        ]);
        await page.locator('.workspace[aria-busy="false"]').waitFor();
      };
      try {
        await page.goto(local.origin + '/staff', { waitUntil: 'networkidle' });
        await page.locator('.workspace[aria-busy="false"]').waitFor();
        assert.match(await page.locator('#summary-range').innerText(), /共 5 条/);
        await layout('list'); await shot('list');
        assert.equal(await page.locator('#records-body tr').first().locator('td').count(),7);
        assert.equal(await page.locator('#records-body tr').first().locator('.record-identity').innerText(),records[0].identityCardNumber);
        assert.equal(await page.locator('#records-body tr').first().locator('.record-phone').innerText(),records[0].phone);
        assert.equal(await page.locator('#records-cards article').first().locator('.record-phone').innerText(),records[0].phone);
        assert.equal(await page.locator('#records-cards .record-identity').count(),0);
        assert.equal(await page.locator('#records-cards .avatar, #records-cards .record-id, #records-cards .record-actions, #records-cards .card-footer').count(),0);
        assert.equal(await page.locator('#records-cards article').first().locator('.card-identity').innerText(),records[0].identityCardNumber);
        assert.equal(await page.locator('.document-pill.is-optional').first().locator('span').last().innerText(),'健康证未上传');
        await page.locator('[data-action="more"][data-id="demo-1001"]:visible').click();
        await page.locator('#row-menu').waitFor({state:'visible'});
        assert.equal(await page.locator('#detail-modal').isVisible(),false);
        await page.keyboard.press('Escape'); await page.locator('#row-menu').waitFor({state:'hidden'});
        const entry=page.locator('[data-record-id="demo-1001"]:visible').first();
        await entry.locator('.record-phone').click();
        await page.locator('#detail-modal').waitFor({state:'visible'});
        await page.locator('#detail-modal [data-close="detail-modal"]').click();
        await entry.focus(); await page.keyboard.press('Enter');
        await page.locator('#detail-modal').waitFor({state:'visible'});
        await page.locator('#detail-modal [data-close="detail-modal"]').click();
        await entry.locator('.document-summary').click();
        await page.locator('#detail-documents').waitFor({state:'visible'});
        assert.equal(await page.locator('#tab-documents').getAttribute('aria-selected'),'true');
        await page.locator('#detail-modal [data-close="detail-modal"]').click();


        assert.equal(await page.locator('#refresh-button').count(),0);
        assert.equal(await page.locator('#store-key').isVisible(),true);
        if(width<=650)assert.ok(await page.evaluate(()=>document.getElementById('store-key').getBoundingClientRect().bottom<=document.getElementById('query-button').getBoundingClientRect().top));

        await page.locator('#search').fill('林晴'); await listChange(() => page.locator('#query-button').click(), { search: '林晴' });
        assert.equal(await page.locator('#records-body tr').count(), 1);
        assert.match(await page.locator('#summary-range').innerText(), /共 1 条/);
        await layout('search');
        await listChange(() => page.locator('#clear-search').click(), { search: '' });

        await page.locator('#store-key').selectOption('fuzzy_qz'); await listChange(() => page.locator('#query-button').click(), { storeKey: 'fuzzy_qz' });
        assert.equal(await page.locator('#records-body tr').count(), 2);
        assert.match(await page.locator('#records-body').innerText(), /周禾/);
        await layout('store-filter');
        await page.locator('#store-key').selectOption(''); await listChange(() => page.locator('#query-button').click(), { storeKey: '' });

        await listChange(() => page.locator('[data-status="deleted"]').click(), { status: 'deleted' });
        assert.equal(await page.locator('#records-body tr').count(), 2); await layout('recycle-bin');
        await listChange(() => page.locator('[data-status="all"]').click(), { status: 'all' });
        assert.equal(await page.locator('#records-body tr').count(), 7); await layout('all-records');
        await listChange(() => page.locator('[data-status="active"]').click(), { status: 'active' });

        await page.locator('[data-action="detail"][data-id="demo-1001"]:visible').first().click();
        await page.locator('#detail-title').filter({ hasText: '林晴' }).waitFor();
        await page.locator('#detail-history .revision').first().waitFor({ state: 'attached' });
        assert.equal(await page.locator('#detail-modal').getAttribute('hidden'), null);
        assert.ok((await page.locator('#detail-basic').innerText()).includes(records[0].phone));
        assert.ok((await page.locator('#detail-basic').innerText()).includes(records[0].identityCardNumber));
        assert.equal(await page.locator('#detail-basic button').filter({hasText:/^(显示|收起)$/}).count(),0);
        await layout('detail'); await shot('detail');
        await page.locator('#tab-history').click();
        assert.equal(await page.locator('#detail-history .revision').count(), 2);
        await page.locator('#detail-history .revision summary').first().click();
        await layout('history'); await shot('history');
        await page.locator('#tab-documents').click();
        await page.locator('#document-image').waitFor({ state: 'visible' });
        assert.ok(await page.locator('#document-image').evaluate(element => element.naturalWidth === 640));
        await layout('document'); await shot('document');
        await page.locator('#detail-edit').click();
        await page.locator('#edit-modal:not([hidden])').waitFor();
        await page.waitForFunction(() => document.getElementById('edit-name').value === '林晴');
        assert.equal(await page.locator('#edit-store').inputValue(), 'fuzzy');
        await layout('edit'); await shot('edit');
        await page.locator('#edit-modal [data-close="edit-modal"]').first().click();
        await page.locator('#edit-modal').waitFor({ state: 'hidden' });
        // openEdit currently closes the detail drawer before opening edit.
        // Only close a detail drawer if the UI actually left one visible.
        if (await page.locator('#detail-modal').isVisible()) {
          await page.locator('#detail-modal [data-close="detail-modal"]').click();
        }
        await page.locator('#detail-modal').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('main').evaluate(element => element.inert), false);

        await page.locator('#center-switcher-trigger').click();
        await page.locator('#center-switcher-menu').waitFor({ state: 'visible' });
        const menu = await page.evaluate(() => {
          const header = document.querySelector('.topbar').getBoundingClientRect(), menu = document.getElementById('center-switcher-menu').getBoundingClientRect(), backdrop = document.getElementById('center-switcher-backdrop').getBoundingClientRect();
          return { gap: menu.top - header.bottom, left: menu.left, right: menu.right, backdropWidth: backdrop.width, backdropHeight: backdrop.height, aboveBackdrop: Boolean(document.elementFromPoint(menu.left + 20, menu.top + 20)?.closest('.center-switcher-menu')) };
        });
        assert.ok(menu.gap >= 8 && menu.gap <= 10, `menu gap: ${JSON.stringify(menu)}`);
        assert.ok(menu.left >= 0 && menu.right <= width && menu.aboveBackdrop, `menu bounds: ${JSON.stringify(menu)}`);
        assert.equal(menu.backdropWidth, width); assert.equal(menu.backdropHeight, 900);
        await layout('switcher'); await shot('switcher');
        await page.keyboard.press('Escape'); await page.locator('#center-switcher-menu').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#center-switcher-trigger').getAttribute('aria-expanded'), 'false');
        await page.locator('#center-switcher-trigger').click();
        await page.locator('#center-switcher-backdrop').click({ position: { x: width - 8, y: 892 } });
        await page.locator('#center-switcher-menu').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('body').evaluate(element => element.classList.contains('switcher-open')), false);
        assert.deepEqual(caseErrors, [], `${label}: console/page errors`);
        results.push({ case: label, passed: true, stages, menu });
      } catch (error) {
        await page.screenshot({ path: path.join(OUTPUT, `staff-${label}-failure.png`) }).catch(() => {});
        failures.push({ case: label, error: error.message });
        results.push({ case: label, passed: false, stages });
      } finally {
        errors.push(...caseErrors.map(error => ({ case: label, error })));
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
  const writeRequests = local.requests.filter(request => !['GET', 'HEAD'].includes(request.method));
  const report = { source: PORTAL, sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(PORTAL)).digest('hex'), fixture: 'Seven completely fictional records; abstract PNG; no real data or writes', cases: results.length, results, failures, errors, blockedRequests, writeRequests, output: OUTPUT };
  fs.writeFileSync(path.join(OUTPUT, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: report.cases, passed: results.filter(item => item.passed).length, failures, errors, blockedRequests, writeRequests, output: OUTPUT }, null, 2));
  if (failures.length || errors.length || blockedRequests.length || writeRequests.length) process.exitCode = 1;
}

(async () => {
  if (MODE === 'selfcheck') return selfcheck();
  if (MODE === 'verify') return verify();
  if (MODE !== 'server') throw new Error('Mode must be selfcheck, server, or verify.');
  selfcheck();
  const local = await startServer(Number(process.env.STAFF_PREVIEW_PORT) || 8802);
  console.log(JSON.stringify({ mode: 'server', url: local.origin + '/staff', pid: process.pid, source: PORTAL, fixture: 'fictional records only', writes: '405', freshSourceOnEveryRequest: true }));
  const stop = () => local.server.close(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
