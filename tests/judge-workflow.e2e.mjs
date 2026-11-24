import assert from 'node:assert/strict';
import http from 'node:http';
import {unzipSync} from 'fflate';
import {chromium} from 'playwright';
import {serveStatic} from '../server/static.mjs';
import {sampleWorkbook} from './helpers/workbook.mjs';

const live = process.env.TRACEX_LIVE_URL;
const server = live ? null : http.createServer((req, res) => serveStatic(req, res));
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = live ? new URL(live).origin : 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({channel:process.env.TRACEX_BROWSER_CHANNEL || 'msedge', headless:true});

try {
  const page = await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true});
  page.setDefaultTimeout(live ? 25000 : 12000);
  page.setDefaultNavigationTimeout(live ? 45000 : 12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const home = await page.goto(origin, {waitUntil:'domcontentloaded'});
  assert.equal(home.status(), 200);
  await page.getByRole('link', {name:'Run Jaipur demo',exact:true}).click();
  await page.getByRole('heading', {name:'Guided demo',exact:true}).waitFor();

  await page.getByRole('button', {name:'Open evidence library',exact:true}).click();
  await page.locator('.file-entry').first().click();
  await page.getByRole('button', {name:'Verify SHA-256',exact:true}).click();
  await page.getByText('Verified. The original matches its recorded SHA-256.').waitFor();
  await page.getByRole('button', {name:'Close dialog'}).click();
  await page.getByText('More filters', {exact:true}).click();
  await page.getByLabel('Record kind').selectOption('CDR');
  await page.getByLabel('Party', {exact:true}).fill('A');
  await page.getByRole('button', {name:'Search',exact:true}).click();
  const matches = await page.locator('table tbody tr').allTextContents();
  assert.ok(matches.length > 1 && matches.every(row => row.includes('CDR')));

  await page.getByRole('link', {name:'Guided demo',exact:true}).click();
  await page.getByRole('button', {name:'Compare A and B',exact:true}).click();
  await page.getByText('A · X · B', {exact:true}).waitFor();
  await page.getByRole('link', {name:'Guided demo',exact:true}).click();
  await page.getByRole('button', {name:'Ask about shared contacts',exact:true}).click();
  await page.getByText(/A and B share contact X/).waitFor();
  await page.getByRole('button', {name:'R102',exact:true}).click();
  await page.getByRole('heading', {name:'Source record R102'}).waitFor();
  await page.getByText('north-operator-cdr.csv', {exact:true}).waitFor();
  await page.getByRole('button', {name:'Close dialog'}).click();

  await page.getByRole('button', {name:'Save finding',exact:true}).click();
  await page.getByText('Finding saved to the case report.').waitFor();
  await page.getByRole('link', {name:'Reports & audit',exact:true}).click();
  assert.equal(await page.getByRole('button', {name:'Download PDF',exact:true}).count(), 0);
  await page.getByRole('button', {name:'Review & sign',exact:true}).click();
  await page.getByLabel('Reviewer name').fill('Demo Reviewer');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', {name:'Sign report',exact:true}).click();
  await page.getByText(/Local sign-off by Demo Reviewer/).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', {name:'Download PDF',exact:true}).click()
  ]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const pdf = Buffer.concat(chunks);
  assert.equal(download.suggestedFilename(), 'CASE-RJ-001-report.pdf');
  assert.match(pdf.subarray(0, 8).toString(), /^%PDF-1/);
  assert.match(pdf.subarray(-32).toString(), /%%EOF/);
  assert.ok(pdf.length > 10000);
  if (process.env.TRACEX_TEST_REPORT_PATH) await download.saveAs(process.env.TRACEX_TEST_REPORT_PATH);

  await page.getByRole('link', {name:'Case assistant',exact:true}).click();
  await page.getByRole('button', {name:'Show tower timeline for A',exact:true}).click();
  await page.getByText('Show tower timeline for A', {exact:true}).filter({visible:true}).last().waitFor();
  await page.locator('.exchange').last().getByRole('button', {name:'Save finding',exact:true}).click();
  await page.getByText('Finding saved to the case report.').waitFor();
  await page.getByRole('link', {name:'Reports & audit',exact:true}).click();
  await page.getByText(/2 saved findings · Awaiting review/).waitFor();
  assert.equal(await page.getByRole('button', {name:'Download PDF',exact:true}).count(), 0);
  console.log('PASS source QA, filtered links, cited answer and version-bound PDF');

  await page.getByRole('link', {name:'Evidence library',exact:true}).click();
  await page.getByRole('button', {name:'Import evidence',exact:true}).click();
  const workbook = sampleWorkbook();
  await page.locator('#evidence-files').setInputFiles({
    name:'source-check.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:workbook
  });
  await page.getByRole('button', {name:'Preview mapping'}).click();
  await page.getByText(/2 source rows · Synthetic calls/).waitFor();
  await page.getByLabel('Field for From ID').selectOption('from');
  await page.getByLabel('Field for To ID').selectOption('to');
  await page.getByLabel('Field for When').selectOption('time');
  await page.getByRole('button', {name:'Confirm and import'}).click();
  await page.getByRole('heading', {name:'Import results',exact:true}).waitFor();
  await page.getByText('2 accepted · 0 duplicates · 0 rejected').waitFor();
  await page.getByRole('button', {name:'Open evidence library',exact:true}).click();
  await page.getByRole('button', {name:/source-check\.xlsx/}).click();
  await page.getByRole('button', {name:'Verify SHA-256',exact:true}).click();
  await page.getByText('Verified. The original matches its recorded SHA-256.').waitFor();
  const [original] = await Promise.all([
    page.waitForEvent('download', {timeout:12000}),
    page.getByRole('button', {name:'Download original',exact:true}).click()
  ]);
  const downloaded = [];
  for await (const chunk of await original.createReadStream()) downloaded.push(chunk);
  assert.deepEqual(Buffer.concat(downloaded), workbook);
  await page.getByRole('button', {name:'Close dialog'}).click();
  await page.getByRole('button', {name:'Clear',exact:true}).click();
  await page.getByText('More filters', {exact:true}).click();
  await page.getByLabel('Source filename / operator', {exact:true}).fill('source-check.xlsx');
  await page.getByRole('button', {name:'Search',exact:true}).click();
  await page.locator('table tbody .cite').first().click();
  await page.getByText('Synthetic calls · Row 5', {exact:true}).waitFor();
  console.log('PASS browser XLSX mapping, verified original bytes and worksheet provenance');

  const archive = await page.request.get(origin+'/downloads/jaipur-synthetic-case.zip');
  assert.equal(archive.status(), 200);
  const sample = unzipSync(new Uint8Array(await archive.body()));
  const expected = {'north-operator-cdr.csv':8, 'west-operator-cdr.tsv':6, 'sample-ip-sessions.csv':3, 'jaipur-tower-sample.csv':6};
  await page.getByRole('button', {name:'Close dialog'}).click();
  await page.locator('#switch-case').selectOption('__new__');
  await page.getByLabel('Case name').fill('PS03 sample import');
  await page.getByRole('dialog').getByRole('button', {name:'Create case',exact:true}).click();
  await page.getByRole('heading', {name:'Case overview',exact:true}).waitFor();
  await page.getByRole('button', {name:'Import evidence',exact:true}).click();
  await page.locator('#evidence-files').setInputFiles(Object.keys(expected).map(name => ({
    name,
    mimeType:name.endsWith('.tsv')?'text/tab-separated-values':'text/csv',
    buffer:Buffer.from(sample[name])
  })));
  await page.getByRole('button', {name:'Preview mapping'}).click();
  await page.getByRole('button', {name:'Confirm and import'}).click();
  await page.getByRole('heading', {name:'Import results',exact:true}).waitFor();
  for (const [name, accepted] of Object.entries(expected)) {
    const result = page.locator('.import-results article').filter({hasText:name});
    assert.match(await result.innerText(), new RegExp('\\b'+accepted+' accepted'));
  }
  await page.getByRole('button', {name:'Open evidence library',exact:true}).click();
  await page.getByRole('link', {name:'Tower timeline',exact:true}).click();
  await page.locator('.leaflet-container').waitFor();
  console.log('PASS download and fresh import of two CDR formats, IPDR and tower data');

  const mobile = await browser.newPage({viewport:{width:370,height:800},isMobile:true,hasTouch:true});
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(origin + '/console.html?demo=1#demo', {waitUntil:'domcontentloaded',timeout:live?45000:12000});
  await mobile.getByRole('heading', {name:'Guided demo',exact:true}).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await mobile.getByRole('button', {name:'Ask about shared contacts',exact:true}).click();
  await mobile.getByText(/A and B share contact X/).waitFor();
  assert.equal(await mobile.getByRole('button', {name:'Save finding',exact:true}).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS guided workspace, source QA, local filters, shared link, cited answer, signed PDF download, revision invalidation, XLSX provenance and exact original bytes, and mobile layout');
} catch (error) {
  console.error(error);
  process.exitCode=1;
} finally {
  await browser.close();
  if (server) {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
}
