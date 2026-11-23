import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createTeamServer,openDatabase,provisionAccount,seedSyntheticCase} from '../server/team.mjs';
import {createDemo} from '../dist/engine.js';

const db=openDatabase(':memory:');
const password=randomUUID();
await provisionAccount(db,'lead-admin','admin','Jaipur',password);
await provisionAccount(db,'unassigned','reviewer','Jaipur',password);
await seedSyntheticCase(db,'Jaipur',await createDemo());
const server=createTeamServer(db);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:process.env.TRACEX_BROWSER_CHANNEL||'msedge',headless:true});
const errors=[];

function track(page){page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));return page;}
async function login(page,name) {
  await page.goto(origin+'/console.html');
  await page.waitForURL('**/login.html');
  await page.getByLabel('Username').fill(name);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.waitForURL('**/console.html');
}
async function check(text,action) {await action();console.log('PASS '+text);}

try {
  const page=track(await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true}));
  await login(page,'lead-admin');
  await page.getByRole('heading',{name:'Case overview',exact:true}).waitFor();
  await check('administration loads health and unit users; create a reviewer',async()=>{
    await page.getByRole('link',{name:'Administration',exact:true}).click();
    await page.getByRole('heading',{name:'Service status'}).waitFor();
    await page.getByRole('button',{name:'Add user'}).click();
    await page.getByLabel('Username').fill('new-reviewer');
    await page.getByLabel('Role',{exact:true}).selectOption('reviewer');
    await page.getByLabel('Initial password').fill(password);
    await page.getByRole('button',{name:'Create account'}).click();
    await page.getByRole('cell',{name:'new-reviewer',exact:true}).first().waitFor();
  });
  await check('archive and reopen a private case; unassigned reviewer sees no case',async()=>{
    await page.goto(origin+'/console.html#overview');
    await page.getByLabel('Switch active case').selectOption('__new__');
    await page.getByLabel('Case name').fill('Private case');
    await page.getByRole('dialog').getByRole('button',{name:'Create case'}).click();
    await page.getByText('Private case',{exact:true}).last().waitFor();
    await page.getByRole('button',{name:'Edit details'}).click();
    await page.getByLabel('Summary',{exact:true}).fill('Review evidence supplied by two sources.');
    await page.getByLabel('Status',{exact:true}).selectOption('archived');
    await page.getByRole('button',{name:'Save details'}).click();
    await page.getByRole('button',{name:'Reopen case'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Import evidence'}).count(),0);
    const reviewer=track(await browser.newPage({viewport:{width:390,height:844}}));
    await login(reviewer,'unassigned');
    const payload=await reviewer.evaluate(async()=>await (await fetch('./api/cases')).json());
    assert.ok(!payload.some(item=>item.name==='Private case'));
    await reviewer.close();
    await page.getByRole('button',{name:'Reopen case'}).click();
    await page.getByRole('button',{name:'Import evidence'}).waitFor();
    await page.getByRole('button',{name:'Manage access'}).click();
    await page.getByRole('checkbox',{name:/new-reviewer/}).check();
    await page.getByRole('button',{name:'Save assignments'}).click();
    await page.getByText('new-reviewer (Reviewer)',{exact:true}).waitFor();
  });
  await check('indexed evidence filtering, original SHA verification and exact-byte download',async()=>{
    await page.getByLabel('Switch active case').selectOption('CASE-RJ-001');
    await page.getByRole('link',{name:'Evidence library'}).click();
    await page.getByText('More filters',{exact:true}).click();
    await page.getByLabel('Record kind').selectOption('CDR');
    await page.locator('[data-form="search"] input[name="number"]').fill('A');
    await page.getByLabel('Sort by time').selectOption('oldest');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.locator('.paginator').getByText(/records/).waitFor();
    const rows=await page.locator('.table-scroll table tbody tr').allTextContents();
    assert.ok(rows.length>=2);
    assert.ok(rows.every(row=>row.includes('CDR')));
    await page.locator('.file-entry').first().click();
    const dialog=page.getByRole('dialog');
    const expected=await dialog.locator('dd').nth(1).textContent();
    await dialog.getByRole('button',{name:'Verify SHA-256'}).click();
    await dialog.getByText('Verified. The original matches its recorded SHA-256.').waitFor();
    const downloadPromise=page.waitForEvent('download');
    await dialog.getByRole('link',{name:'Download original'}).click();
    const download=await downloadPromise;
    const stream=await download.createReadStream();
    const digest=createHash('sha256');
    for await(const chunk of stream)digest.update(chunk);
    assert.equal(digest.digest('hex'),expected);
  });
  await check('Cytoscape and Leaflet, date bounds, and shared-contact path',async()=>{
    await page.goto(origin+'/console.html#network');
    await page.locator('.graph-stage canvas').first().waitFor();
    await page.getByLabel('First party').selectOption('A');
    await page.getByLabel('Second party').selectOption('B');
    await page.getByRole('button',{name:'Find shared contacts'}).click();
    await page.getByText('A · X · B',{exact:true}).waitFor();
    await page.getByLabel('From date (IST)').fill('2020-01-02');
    await page.getByLabel('To date (IST)').fill('2020-01-03');
    await page.getByRole('button',{name:'Apply dates'}).click();
    await page.getByText('No connections',{exact:true}).waitFor();
    await page.getByRole('link',{name:'Tower timeline'}).click();
    await page.locator('.leaflet-container').waitFor();
    await page.getByRole('button',{name:'Switch to keyboard diagram'}).click();
    await page.locator('.tower-stage > svg').waitFor();
  });
  await check('mobile read-only synthetic demo handles questions without writing cases',async()=>{
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await mobile.addInitScript(()=>{window.TRACEX_TEAM=false;window.TRACEX_READ_ONLY=true;Object.defineProperty(window,'TRACEX_TEAM',{value:false,writable:false});});
    // The product's native build serves bundled assets, so bypass team-mode.js only for this simulation.
    await mobile.route('**/team-mode.js',route=>route.fulfill({status:200,body:'',contentType:'text/javascript'}));
    const reader=track(await mobile.newPage());
    await reader.goto(origin+'/console.html#assistant');
    await reader.getByText(/Offline synthetic demo · Read-only/).waitFor();
    assert.equal(await reader.getByRole('button',{name:'Import evidence'}).count(),0);
    await reader.getByRole('button',{name:'Which contacts do A and B share?',exact:true}).click();
    await reader.getByText(/A and B share contact X/).waitFor();
    assert.equal(await reader.getByRole('button',{name:'Save finding'}).count(),0);
    assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await reader.reload();
    await reader.getByText(/Offline synthetic demo · Read-only/).waitFor();
    assert.equal(await reader.locator('.exchange').count(),0);
    await mobile.close();
  });
  await check('team index reports network loss and supports retry',async()=>{
    await page.goto(origin+'/console.html#sources');
    await page.route('**/records?*',route=>route.abort());
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByText('Search unavailable',{exact:true}).waitFor();
    await page.unroute('**/records?*');
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.locator('.paginator').getByText(/records/).waitFor();
  });
  assert.deepEqual(errors,[]);
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
