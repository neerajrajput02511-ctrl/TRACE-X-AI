import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {serveStatic} from '../server/static.mjs';

const server = http.createServer((req, res) => serveStatic(req, res));
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({channel:process.env.TRACEX_BROWSER || 'msedge'});

  async function launch(page) {
    await page.goto(origin);
    await page.getByRole('link', {name:'Launch workspace'}).click();
    await page.getByRole('heading', {name:'Case overview'}).waitFor();
  }

  const existing = await browser.newContext();
  await existing.addInitScript(() => {
    if (sessionStorage.getItem('block-case-storage')) {
      Object.defineProperty(window, 'indexedDB', {get() {
        throw new DOMException('Access to IndexedDB is denied in this context.', 'SecurityError');
      }});
    }
  });
  const page = await existing.newPage();
  await launch(page);
  await page.getByRole('button', {name:'Import evidence'}).waitFor();
  await page.evaluate(async () => {
    const {createCase} = await import('/engine.js');
    const {saveCase} = await import('/case-store.js');
    const saved = createCase('Saved test case');
    await saveCase(saved);
    localStorage.setItem('tracex.active.case', saved.id);
    sessionStorage.setItem('block-case-storage', '1');
  });

  await launch(page);
  await page.getByText(/Temporary demo · Browser storage is unavailable/).waitFor();
  assert.equal(await page.getByRole('button', {name:'Import evidence'}).count(), 0);
  await page.getByRole('link', {name:'Case assistant'}).click();
  await page.getByRole('button', {name:'Which contacts do A and B share?'}).click();
  await page.getByText(/A and B share contact X/).waitFor();
  assert.equal(await page.getByRole('button', {name:'Save finding'}).count(), 0);
  await page.evaluate(() => sessionStorage.removeItem('block-case-storage'));
  await page.getByRole('button', {name:'Retry storage'}).click();
  await page.locator('#switch-case').waitFor();
  assert.equal(await page.locator('#switch-case option:checked').innerText(), 'Saved test case');
  assert.equal(await page.getByText(/Temporary demo/).count(), 0);
  await existing.close();

  const quota = await browser.newContext();
  await quota.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (store, mode) {
      if (mode === 'readwrite') throw new DOMException('Storage quota exhausted.', 'QuotaExceededError');
      return transaction.call(this, store, mode);
    };
  });
  const quotaPage = await quota.newPage();
  await launch(quotaPage);
  await quotaPage.getByText(/Temporary demo · Browser storage is unavailable/).waitFor();
  await quotaPage.goto(origin + '/console.html?demo=1');
  await quotaPage.getByText(/Read-only case records/).waitFor();
  assert.equal(await quotaPage.getByRole('button', {name:'Import evidence'}).count(), 0);
  await quota.close();

  const offline = await browser.newContext();
  const offlinePage = await offline.newPage();
  await launch(offlinePage);
  await offlinePage.evaluate(() => navigator.serviceWorker.ready);
  await offlinePage.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await offlinePage.evaluate(async () => {
    const key = (await caches.keys()).find(name => name.startsWith('tracex-'));
    const cache = await caches.open(key);
    await cache.put('/console.html', new Response('<title>Stale entry</title>', {headers:{'Content-Type':'text/html'}}));
  });
  await launch(offlinePage);
  await offlinePage.evaluate(async () => {
    const key = (await caches.keys()).find(name => name.startsWith('tracex-'));
    const cache = await caches.open(key);
    await cache.put('/console.html', await fetch('/console.html'));
  });
  await offline.setOffline(true);
  await offlinePage.reload();
  await offlinePage.getByRole('heading', {name:'Case overview'}).waitFor();
  await offline.close();
  console.log('Passed Launch workspace: fresh and saved cases, blocked storage, exhausted quota, temporary cited answers and recovery, stale cache, and offline reload.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
