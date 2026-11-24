import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveStatic} from '../server/static.mjs';
import {sampleWorkbook} from '../tests/helpers/workbook.mjs';

const bytes = sampleWorkbook();
const fingerprint = createHash('sha256').update(bytes).digest('hex');
const server = http.createServer((req, res) => serveStatic(req, res));
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({channel:process.env.TRACEX_BROWSER || 'msedge'});
  const page = await browser.newPage({acceptDownloads:true});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/console.html');
  await page.getByRole('heading', {name:'Case overview'}).waitFor();
  await page.locator('#switch-case').selectOption('__new__');
  await page.getByLabel('Case name').fill('Workbook evidence');
  await page.getByRole('dialog').getByRole('button', {name:'Create case'}).click();
  await page.locator('#switch-case option:checked').filter({hasText:'Workbook evidence'}).waitFor({state:'attached'});

  await page.getByRole('button', {name:'Import evidence'}).click();
  await page.locator('#evidence-files').setInputFiles({name:'sample-calls.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer:bytes});
  await page.getByRole('button', {name:'Preview mapping'}).click();
  await page.getByRole('combobox', {name:'Field for From ID'}).selectOption('from');
  await page.getByRole('combobox', {name:'Field for To ID'}).selectOption('to');
  await page.getByRole('combobox', {name:'Field for When'}).selectOption('time');
  await page.getByRole('button', {name:'Confirm and import'}).click();
  await page.getByText(/2 accepted/i).first().waitFor();
  await page.getByRole('button', {name:'Open evidence library'}).click();

  await page.getByRole('button', {name:'R101', exact:true}).click();
  await page.getByRole('dialog').getByText('Synthetic calls · Row 3', {exact:true}).waitFor();
  await page.getByRole('button', {name:'View file & fingerprint'}).click();
  await page.getByRole('dialog').getByText(fingerprint, {exact:true}).waitFor();
  await page.getByRole('button', {name:'Verify SHA-256'}).click();
  await page.locator('#verify-result').filter({hasText:/Verified/}).waitFor();
  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', {name:'Download original'}).click()
  ]);
  assert.equal(saved.suggestedFilename(), 'sample-calls.xlsx');
  assert.deepEqual(await fs.readFile(await saved.path()), bytes);
  assert.deepEqual(errors, []);

  const malformed = await page.evaluate(async () => {
    const {previewLocalFile} = await import('/local-evidence.js');
    try {await previewLocalFile(new File(['not a workbook'],'invalid.xlsx'));}
    catch(error) {return error.message;}
    return '';
  });
  assert.match(malformed, /workbook|\.xlsx/);
  console.log('Passed browser-local XLSX mapping, physical row provenance, original SHA-256 and download, and malformed-file rejection.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
