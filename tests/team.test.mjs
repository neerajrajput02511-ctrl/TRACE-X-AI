import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,provisionAccount,createTeamServer,seedSyntheticCase} from '../server/team.mjs';
import {createCase,createDemo,importFile} from '../dist/engine.js';
import {sampleWorkbook} from './helpers/workbook.mjs';
import {safeIntentText} from '../server/model.mjs';

let db,server,root,origin;
const pass=()=>crypto.randomUUID();
const identities={};
const passwordA=pass();
async function call(route,{method='GET',body,cookie,headers={}}={}) {
  const r=await fetch(origin+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const value=r.headers.get('Content-Type')?.includes('application/json')?await r.json():await r.text();
  return {status:r.status,value,cookie:r.headers.get('Set-Cookie')?.split(';')[0],headers:r.headers};
}
async function save(item,who='analyst'){return call('/api/cases/'+item.id,{method:'PUT',body:item,cookie:identities[who]});}
async function assign(c,usernames=['review']) {
  const result=await call('/api/cases/'+c.id+'/assignments',{method:'PUT',body:{usernames},cookie:identities.analyst});
  assert.equal(result.status,200);
  return result.value;
}
async function seed(){
  const c=createCase('Training record');
  const r=await save(c);
  assert.equal(r.status,201);return r.value;
}
before(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'trace-team-tests-'));
  db=openDatabase(path.join(root,'team.sqlite'));
  server=createTeamServer(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;
  for(const [name,role,unit] of [['analyst','investigator','North'],['review','reviewer','North'],['admin','admin','North'],['other','admin','East']]){
    const pwd=name==='analyst'?passwordA:pass();
    await provisionAccount(db,name,role,unit,pwd);
    const result=await call('/api/login',{method:'POST',body:{username:name,password:pwd}});
    assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/HttpOnly/);
    identities[name]=result.cookie;
  }
});
after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  db.close();fs.rmSync(root,{recursive:true,force:true});
});

test('authentication, team injection, origin and optional local model',async()=>{
  assert.equal((await call('/api/session')).status,401);
  const self=await call('/api/session',{cookie:identities.review});
  assert.deepEqual(self.value,{username:'review',role:'reviewer',unit:'North'});
  assert.match((await call('/console.html')).value,/team-mode\.js/);
  assert.equal((await call('/sw.js')).status,404);
  assert.ok((await call('/api/openapi.json')).value.paths['/api/cases/{id}/uploads']);
  assert.equal(safeIntentText('tower sequence for personone +919999999999 192.0.2.8 ORD-001 SecretAlias'),'tower sequence for personone');
  const body={username:'analyst',password:'incorrect'};
  assert.equal((await call('/api/login',{method:'POST',body})).status,401);
  assert.equal((await call('/api/login',{method:'POST',body,headers:{Origin:'https://different.test'}})).status,403);
  assert.equal((await call('/api/intent',{method:'POST',body:{maskedQuestion:'shared contacts?'}})).status,401);
  if(!process.env.TRACEX_OLLAMA_MODEL)assert.deepEqual((await call('/api/intent',{method:'POST',cookie:identities.analyst,body:{maskedQuestion:'Shared contacts between SUBJECT_1 and SUBJECT_2?'}})).value,{intent:null});
});
test('unit isolation, stale changes and role restrictions',async()=>{
  const c=await seed();
  assert.equal(c.owner,'analyst');assert.equal(c.contentVersion,0);assert.equal(c.revision,1);
  assert.equal((await save(createCase('unauthorised'),'review')).status,403);
  assert.ok(!(await call('/api/cases',{cookie:identities.other})).value.some(x=>x.id===c.id));
  const renamed={...c,name:'Revised'};
  assert.equal((await save(renamed,'review')).status,404);
  await assign(c);
  assert.equal((await save(renamed,'review')).status,403);
  const saves=await Promise.all([save(renamed),save({...renamed,name:'Alternate'})]);
  assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
  assert.equal((await save(c)).status,409);
});
test('replays source bytes; validates ledger, independent review, archival and invalidation',async()=>{
  let c=await assign(await seed());
  await importFile(c,'a.csv','Calling Number,Called Number,Timestamp,Duration\nA,X,2026-11-18 10:14,60\nB,X,2026-11-18 10:41,40');
  assert.equal((await save({...c,records:c.records.map(r=>({...r,time:'2020-01-01'}))})).status,400);
  c=(await save(c)).value;
  assert.equal(c.contentVersion,1);
  assert.equal((await save({...c,files:c.files.map(f=>({...f,raw:f.raw+'added'}))})).status,400);
  assert.equal((await save({...c,audit:[]})).status,400);
  const afterQuery=await save({...c,chat:[{id:'q1',question:'Which contacts do A and B share?',text:'manufactured',supported:true,ids:[]}]},'review');
  assert.equal(afterQuery.status,200);c=afterQuery.value;
  assert.ok(c.chat[0].text.includes('X'));assert.deepEqual(c.chat[0].ids,['R101','R102']);assert.equal(c.audit.at(-1).actor,'review');
  c.findings=[{id:'saved1',title:'Shared X',text:'A and B both contacted X.',ids:['R101','R102']}];
  assert.equal((await save(c,'review')).status,403);
  c=(await save(c)).value;assert.equal(c.contentVersion,2);
  const sign={...c,review:{reviewer:'forged',signedAt:'2020',revisionKey:c.contentVersion}};
  assert.equal((await save(sign)).status,403);
  const signed=await save(sign,'review');assert.equal(signed.status,200);
  const approved=signed.value;assert.equal(approved.review.reviewer,'review');assert.notEqual(approved.review.signedAt,'2020');
  assert.equal((await save({...approved,review:null},'review')).status,400);
  const printed=await save({...approved,audit:[...approved.audit,{action:'Report prepared',detail:'arbitrary text'}]},'analyst');
  assert.equal(printed.status,200);assert.equal(printed.value.audit.at(-1).detail,'Signed version 2 prepared for printing.');
  c=printed.value;
  await importFile(c,'second.csv','Calling Number,Called Number,Timestamp,Duration\nA,X,2026-11-18 10:14,60\nC,X,2026-11-18 10:24,8');
  c.review=null;
  c=(await save(c)).value;
  assert.equal(c.review,null);assert.equal(c.contentVersion,3);assert.equal(c.records[0].refs.length,2);
  const history='/api/cases/'+c.id+'/reviews/2';
  assert.equal((await call(history,{cookie:identities.analyst})).value.review.reviewer,'review');
  assert.equal((await call(history,{cookie:identities.other})).status,404);
  const printedAgain=await save({...c,audit:[...c.audit,{action:'Report prepared'}]});assert.equal(printedAgain.status,403);
});
test('case-scoped search, original bytes, hash verification and access revocation',async()=>{
  let c=await assign(await seed());
  const source='Calling Number,Called Number,Timestamp,Duration,Cell ID,IMEI\r\nA,X,2026-11-18 00:10,60,JP42,DEV-A\r\nB,X,2026-11-19 10:41,40,JP12,DEV-B';
  await importFile(c,'North.csv',source);
  c=(await save(c)).value;
  const api='/api/cases/'+c.id,review=identities.review,file=c.files[0];
  const result=await call(api+'/records?kind=CDR&number=x&operator=North.csv&from=2026-11-18&to=2026-11-18&limit=1',{cookie:review});
  assert.equal(result.status,200);assert.equal(result.value.total,1);assert.equal(result.value.rows[0].id,'R101');
  assert.equal((await call(api+'/records?number=X&limit=1&offset=1',{cookie:review})).value.rows[0].id,'R101');
  assert.equal((await call(api+'/records?from=2026-02-31',{cookie:review})).status,400);
  assert.equal((await call(api+'/sources/F001')).status,401);
  const x=await call(api+'/sources/F001',{cookie:review});
  assert.equal(x.status,200);assert.equal(x.value,source);
  const opts={method:'POST',body:{},cookie:review};
  const check=await call(api+'/sources/F001/verify',opts);
  assert.deepEqual(check.value,{ok:true,expected:file.sha256,actual:file.sha256});
  const ledger=await call(api+'/activity',{...opts,body:{action:'Record viewed',ref:'R101'}});
  assert.equal(ledger.value.revision,c.revision);assert.equal(ledger.value.activity.at(-1).action,'Record viewed');
  const blob=path.join(root,'team.sqlite.vault',file.sha256.slice(0,2),file.sha256);
  fs.writeFileSync(blob,'tampered bytes');
  try {
    assert.equal((await call(api+'/sources/F001/verify',opts)).value.ok,false);
    assert.equal((await call(api+'/sources/F001',{cookie:review})).status,409);
  } finally {fs.writeFileSync(blob,source);}
  await assign(c,[]);
  assert.equal((await call(api+'/records',{cookie:review})).status,404);
  assert.equal((await call(api+'/sources/F001',{cookie:review})).status,404);
});
test('case scope, archived state and admin directory permissions',async()=>{
  const c=await seed(),api='/api/cases/'+c.id,analyst=identities.analyst;
  assert.equal((await call('/healthz')).status,200);
  assert.equal((await call('/api/admin/users',{cookie:analyst})).status,403);
  assert.ok((await call('/api/admin/health',{cookie:identities.admin})).value.audit.some(e=>e.action==='Signed in'));
  assert.equal((await call(api+'/assignments',{method:'PUT',body:{usernames:['other']},cookie:analyst})).status,400);
  let result=await call(api+'/details',{method:'PATCH',body:{notes:'Synthetic collection.',scopeStart:'2026-11-18',scopeEnd:'2026-11-18'},cookie:analyst});
  assert.equal(result.status,200);assert.equal(result.value.metadata.notes,'Synthetic collection.');
  const out=result.value;
  await importFile(out,'scope.csv','Calling Number,Called Number,Timestamp\nA,X,2026-11-19 00:00');
  assert.equal((await save(out)).status,400);
  result=await call(api+'/details',{method:'PATCH',body:{status:'archived'},cookie:analyst});
  assert.equal(result.status,200);
  assert.equal((await save(result.value)).status,409);
  const open=await call(api+'/details',{method:'PATCH',body:{status:'open'},cookie:analyst});
  assert.equal(open.value.metadata.status,'open');
});
test('legacy database migration creates a vault and related index without rewriting cases',async()=>{
  const filename=path.join(root,'legacy.sqlite');
  const fixture=await createDemo();
  fixture.owner='former-operator';
  const raw=new DatabaseSync(filename);
  raw.exec('CREATE TABLE cases(unit TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(unit,id));');
  raw.prepare('INSERT INTO cases VALUES(?,?,?,?)').run('Legacy',fixture.id,1,JSON.stringify(fixture));
  raw.close();
  const migrated=openDatabase(filename);
  try {
    assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,4);
    const stored=migrated.prepare('SELECT * FROM cases').get();
    assert.deepEqual(JSON.parse(stored.data),fixture);
    assert.equal(stored.legacy_unit_access,1);
    assert.equal(stored.owner,fixture.owner);
    assert.equal(migrated.prepare('SELECT count(*) AS total FROM record_provenance').get().total,fixture.records.length);
    const file=fixture.files[0];
    assert.equal(fs.readFileSync(path.join(filename+'.vault',file.sha256.slice(0,2),file.sha256),'utf8'),file.raw);
  }finally{migrated.close();}
});
test('synthetic fixture reset preserves real cases and rebuilds index',async()=>{
  const real=await seed(),fixture=await createDemo();
  await seedSyntheticCase(db,'North',fixture);
  const found=await call('/api/cases/CASE-RJ-001/records?limit=1',{cookie:identities.review});
  assert.ok(found.value.total>0);
  const lead='/api/cases/CASE-RJ-001/leads/'+encodeURIComponent('shared-'+encodeURIComponent(JSON.stringify(['A','B','X'])));
  const assigned=await call(lead,{method:'PATCH',body:{status:'in_review',reviewer:'review'},cookie:identities.analyst});
  assert.equal(assigned.status,200);
  assert.ok(Object.values(assigned.value.leadStates).some(entry=>entry.status==='in_review'&&entry.reviewer==='review'));
  await seedSyntheticCase(db,'North',fixture,true);
  assert.equal((await call('/api/cases/'+real.id,{cookie:identities.analyst})).value.id,real.id);
  const collision={...createCase('Real lookalike'),id:fixture.id};
  assert.equal((await save(collision,'other')).status,201);
  await assert.rejects(seedSyntheticCase(db,'East',fixture,true),/A real case/);
});
test('multipart previews and imports, case-linked answer, independent review and PDF export',async()=>{
  let c=await assign(await seed());
  const api='/api/cases/'+c.id;
  const review=identities.review,analyst=identities.analyst;
  const upload=async (bytes,name,settings={},preview=false,cookie=analyst)=>{
    const form=new FormData();
    form.append('file',new Blob([bytes]),name);
    form.append('options',JSON.stringify({revision:c.revision,...settings}));
    if(preview)form.append('preview','true');
    const result=await fetch(origin+api+'/uploads',{method:'POST',headers:{Cookie:cookie},body:form});
    return {status:result.status,value:await result.json()};
  };
  const workbook=sampleWorkbook(), map={columnMap:{from:'From ID',to:'To ID',time:'When'}};
  assert.equal((await upload(workbook,'evidence.xlsx',map,true,review)).status,403);
  assert.equal((await upload('invalid workbook','evidence.xlsx',map,true)).status,400);
  assert.equal((await upload(workbook,'evidence.exe',map,true)).status,415);
  const preview=await upload(workbook,'evidence.xlsx',map,true);
  assert.equal(preview.status,200,JSON.stringify(preview.value));
  assert.equal(preview.value.columns[0].header,'From ID');
  const imported=await upload(workbook,'evidence.xlsx',map);
  assert.equal(imported.status,200,JSON.stringify(imported.value));
  c=imported.value;
  assert.ok(c.uploadQa.accepted>0);
  assert.equal((await upload(workbook,'evidence.xlsx',map)).value.uploadQa.alreadyImported,true);
  const ipdr='Subscriber,Public IP,Destination IP,Destination Port,Source Port,Protocol,Session Start\nA,203.0.113.62,192.0.2.7,443,,TCP,2026-11-18 10:14';
  assert.equal((await upload(ipdr,'ipdr.csv',{revision:c.revision-1})).status,409);
  const ip=await upload(ipdr,'ipdr.csv');
  assert.equal(ip.status,200,JSON.stringify(ip.value));
  c=ip.value;
  const results=await call(api+'/records?ip=192.0.2.7&protocol=TCP&kind=IPDR',{cookie:review});
  assert.equal(results.value.total,1);
  assert.equal(results.value.rows[0].destinationPort,'443');
  const inaccessible=await call(api+'/records?ip=192.0.2.7',{cookie:identities.other});
  assert.equal(inaccessible.status,404);
  const original=await fetch(origin+api+'/sources/F001',{headers:{Cookie:review}});
  assert.equal(original.status,200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()),workbook);
  assert.equal((await call(api+'/sources/F001',{cookie:identities.other})).status,404);
  const chat=await save({...c,chat:[{id:'missing',question:'What IPDR matches have missing port information?'}]});
  assert.equal(chat.status,200);
  c=chat.value;
  assert.equal(c.chat[0].supported,true);
  assert.deepEqual(c.chat[0].ids,[results.value.rows[0].id]);
  c=(await save({...c,findings:[{id:'ip-quality',title:'Missing source port',text:c.chat[0].text,ids:c.chat[0].ids}]})).value;
  assert.equal((await call(api+'/report.pdf',{cookie:analyst})).status,403);
  const signed=await save({...c,review:{reviewer:'review',revisionKey:c.contentVersion}},'review');
  assert.equal(signed.status,200);
  const pdf=await fetch(origin+api+'/report.pdf',{headers:{Cookie:analyst}});
  assert.equal(pdf.status,200);
  assert.match(pdf.headers.get('content-disposition'),/attachment/);
  const bytes=Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  assert.ok(bytes.length>3000);
  assert.equal((await call(api,{cookie:analyst})).value.activity.at(-1).action,'Report exported');
});
test('password rotation and logout revoke sessions',async()=>{
  const user='rotated',pwd=pass();await provisionAccount(db,user,'admin','North',pwd);
  const login=await call('/api/login',{method:'POST',body:{username:user,password:pwd}});
  const cookie=login.cookie;const c=createCase('Admin created');
  let r=await call('/api/cases/'+c.id,{method:'PUT',cookie,body:c});
  const created=r.value;
  const fabricated={...created,review:{reviewer:user,revisionKey:0}};
  r=await call('/api/cases/'+c.id,{method:'PUT',cookie,body:fabricated});
  assert.equal(r.status,403);
  const next=pass();await provisionAccount(db,user,'reviewer','Other',next);
  assert.equal((await call('/api/session',{cookie})).status,401);
  const newLogin=await call('/api/login',{method:'POST',body:{username:user,password:next}});
  assert.equal(newLogin.value.unit,'Other');
  assert.equal((await call('/api/logout',{method:'POST',cookie:newLogin.cookie,body:{}})).status,200);
  assert.equal((await call('/api/session',{cookie:newLogin.cookie})).status,401);
});

