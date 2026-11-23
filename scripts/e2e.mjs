import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createTeamServer,openDatabase,provisionAccount} from '../server/team.mjs';

const db=openDatabase(':memory:');
const server=createTeamServer(db,{secureCookies:false});
let browser;
try {
  const password=randomBytes(24).toString('hex');
  for(const role of ['investigator','reviewer','admin'])await provisionAccount(db,role,role,'Playwright',password);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:process.env.TRACEX_BROWSER||'msedge',headless:true});
  const errors=[];
  async function login(role,viewport={width:1366,height:900}){
    const context=await browser.newContext({viewport,acceptDownloads:true});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/console.html');
    await page.waitForURL('**/login.html');
    await page.getByLabel('Username').fill(role);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button',{name:'Sign in'}).click();
    await page.waitForURL('**/console.html');
    return {context,page};
  }
  const {page,context}=await login('investigator');
  await page.getByRole('button',{name:'Create case'}).click();
  await page.getByLabel('Case name').fill('Browser synthetic case');
  await page.getByRole('dialog').getByRole('button',{name:'Create case'}).click();
  await page.getByRole('button',{name:'Import evidence'}).click();
  await page.locator('#evidence-files').setInputFiles([
    {name:'a-calls.csv',mimeType:'text/csv',buffer:Buffer.from('Caller,Callee,Timestamp,Cell ID\nA,X,2026-11-18 10:14,C1')},
    {name:'b-calls.tsv',mimeType:'text/tab-separated-values',buffer:Buffer.from('MSISDN\tOther Party\tDirection\tDate\tTime\tCell ID\nB\tX\tOutgoing\t18/11/2026\t10:41\tC1')},
    {name:'one-ip.csv',mimeType:'text/csv',buffer:Buffer.from('Subscriber,Public IP,Source Port,Protocol,Session Start\nA,203.0.113.4,,TCP,2026-11-18 10:10')},
    {name:'tower.csv',mimeType:'text/csv',buffer:Buffer.from('Cell ID,Tower Name,Latitude,Longitude\nC1,Sample Jaipur,26.914,75.789')},
  ]);
  const mapping=page.getByRole('button',{name:'Preview mapping'});
  await mapping.click();
  await page.getByRole('button',{name:'Confirm and import'}).click();
  await page.getByText(/1 accepted/).first().waitFor();
  await page.getByRole('button',{name:'Open evidence library'}).click();
  await page.getByRole('heading',{name:'Evidence library'}).waitFor();
  await page.getByRole('button',{name:/^a-calls\.csv CDR/}).click();
  await page.getByRole('button',{name:'Verify SHA-256'}).click();
  await page.locator('#verify-result').filter({hasText:/verified|matches/i}).waitFor();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('link',{name:'Link analysis'}).click();
  await page.locator('.spatial-canvas canvas').first().waitFor();
  await page.getByRole('link',{name:'Tower timeline'}).click();
  await page.locator('.spatial-canvas.leaflet-container').first().waitFor();
  await page.getByRole('link',{name:'Case assistant'}).click();
  await page.locator('#case-question').fill('Which contacts do A and B share?');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await page.getByText(/A and B share contact X/).first().waitFor();
  await page.getByRole('button',{name:'R101',exact:true}).click();
  await page.getByRole('dialog').getByText('Row 2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Save finding',exact:true}).click();
  await page.getByRole('status').filter({hasText:/Finding saved/}).waitFor();
  const cases=await (await context.request.get(base+'/api/cases')).json();
  const id=cases[0].id;
  const signedRoute=base+'/api/cases/'+id+'/report.pdf';
  assert.equal((await context.request.get(signedRoute)).status(),403);
  const reviewer=await login('reviewer',{width:390,height:844});
  assert.deepEqual(await (await reviewer.context.request.get(base+'/api/cases')).json(),[]);
  const assignment=await context.request.put(base+'/api/cases/'+id+'/assignments',{data:{usernames:['reviewer']}});
  assert.equal(assignment.status(),200,await assignment.text());
  await reviewer.page.goto(base+'/console.html#reports');
  await reviewer.page.reload();
  await reviewer.page.getByRole('button',{name:'Review & sign'}).click();
  await reviewer.page.getByRole('checkbox').check();
  await reviewer.page.getByRole('button',{name:'Sign report',exact:true}).click();
  const action=reviewer.page.getByRole('link',{name:'Download PDF'});
  await action.waitFor();
  const [download]=await Promise.all([reviewer.page.waitForEvent('download'),action.click()]);
  assert.equal(download.suggestedFilename(),id+'.pdf');
  const response=await reviewer.context.request.get(signedRoute);
  assert.equal(response.status(),200);
  assert.equal((await response.body()).subarray(0,5).toString(),'%PDF-');
  assert.equal(await reviewer.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const refreshed=await (await reviewer.context.request.get(base+'/api/cases')).json();
  assert.ok(refreshed[0].activity.some(event=>event.action==='Report exported'));
  assert.deepEqual(errors,[]);
  console.log('Passed browser lifecycle: login, four uploads, mapping, SHA verification, graph/map, cited answer, original row, denied reviewer, assignment, independent sign-off, PDF download and export audit.');
} finally {
  if(browser)await browser.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  db.close();
}
