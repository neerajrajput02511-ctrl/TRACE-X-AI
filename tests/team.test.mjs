import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,provisionAccount,createTeamServer} from '../server/team.mjs';
import {createCase,importFile} from '../dist/engine.js';

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
  assert.equal((await save(renamed,'review')).status,403);
  const saves=await Promise.all([save(renamed),save({...renamed,name:'Alternate'})]);
  assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
  assert.equal((await save(c)).status,409);
});
test('replays source bytes; validates ledger, independent review, archival and invalidation',async()=>{
  let c=await seed();
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

