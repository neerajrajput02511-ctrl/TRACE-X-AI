import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual as same, promisify} from 'node:util';
import {analyze, ask} from '../dist/engine.js';
import {serveStatic} from './static.mjs';
import {migrate} from './migrations.mjs';
import {searchCaseRecords,syncEvidenceIndex,syncForensicIndex,timeBoundary} from './records.mjs';
import {fetchOriginal,storeOriginals} from './vault.mjs';
import {openApiDocument} from './openapi.mjs';

const derive = promisify(scrypt);
const protocolRoles = new Set(['investigator','reviewer','admin']);
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const asList = value => value ?? [];
const defaultFile = fileURLToPath(new URL('../.runtime/team.sqlite',import.meta.url));
const dummySalt = randomBytes(16).toString('hex');
const dummyHash = Buffer.alloc(64);
const sessionSeconds = 8*60*60;
const maxBody = 40*1024*1024;
const idFormat = /^[A-Za-z0-9_.-]{1,90}$/;
const rateBuckets = new Map();

function limitAction(user,action,limit) {
  const time=Date.now(),key=JSON.stringify([user.unit,user.username,action]);
  for(const [bucket,value] of rateBuckets) if(value.expires<=time)rateBuckets.delete(bucket);
  const value=rateBuckets.get(key)||{expires:time+60000,count:0};
  requireValue(value.count<limit,'Too many requests. Try again in a minute.',429);
  value.count+=1;
  rateBuckets.set(key,value);
}

class Problem extends Error {
  constructor(status, message) {super(message);this.status=status;}
}
function requireValue(ok, message, status=400) {if(!ok) throw new Problem(status,message);}
function string(value,max) {return typeof value==='string' && value.trim().length>0 && value.length<=max;}
function appendValues(next,old,label) {
  requireValue(Array.isArray(next) && next.length>=old.length && old.every((value,i)=>same(value,next[i])),label+' history cannot be rewritten.');
  return next.slice(old.length);
}
function transaction(db,operation) {
  db.exec('BEGIN IMMEDIATE');
  try {const value=operation(); db.exec('COMMIT'); return value;}
  catch(error){db.exec('ROLLBACK');throw error;}
}

export function openDatabase(filename = process.env.TRACEX_DB || defaultFile) {
  if(filename!==':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  if(filename!==':memory:' && process.platform!=='win32') fs.chmodSync(filename,0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}
export async function provisionAccount(db,username,role,unit,password,actor=null) {
  requireValue(typeof username==='string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(username),'Use 1–64 username letters, digits, dots, hyphens or underscores.');
  requireValue(protocolRoles.has(role),'Choose investigator, reviewer or admin.');
  requireValue(string(unit,80) && unit.trim()===unit,'A unit of up to 80 characters is required.');
  requireValue(typeof password==='string' && password.length>=12 && password.length<=512,'Use a password of 12–512 characters.');
  const salt=randomBytes(16).toString('hex'), verifier=await derive(password,salt,64);
  transaction(db,()=>{
    if(actor){
      const caller=db.prepare('SELECT role,unit,active FROM accounts WHERE username=?').get(actor);
      requireValue(caller?.role==='admin'&&caller.unit===unit&&caller.active,'Admin access required.',403);
    }
    const old=db.prepare('SELECT unit FROM accounts WHERE username=?').get(username);
    requireValue(!actor||!old,'That username already exists.',409);
    if (old && old.unit!==unit) db.prepare('DELETE FROM case_assignments WHERE username=?').run(username);
    db.prepare('INSERT INTO accounts(username,role,unit,salt,verifier) VALUES(?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET role=excluded.role, unit=excluded.unit, salt=excluded.salt, verifier=excluded.verifier').run(username,role,unit,salt,verifier);
    db.prepare('DELETE FROM sessions WHERE username=?').run(username);
    auditAccount(db,unit,actor||'local operator',old?'Account credentials replaced':'Account created',username);
  });
}

function session(db,req) {
  const match=/(?:^|;\s*)tx_session=([a-f0-9]{64})(?=;|$)/.exec(req.headers.cookie||'');
  if(!match)return null;
  return db.prepare('SELECT a.username,a.role,a.unit FROM sessions s JOIN accounts a USING(username) WHERE s.digest=? AND s.expires>? AND a.active=1').get(digest(match[1]),Date.now());
}
async function readBody(req, limit) {
  requireValue((req.headers['content-type']||'').split(';')[0].toLowerCase()==='application/json','Use application/json.',415);
  requireValue(Number(req.headers['content-length']||0)<=limit,'This case exceeds the request size limit.',413);
  const pieces=[]; let length=0;
  for await(const part of req){length+=part.length;requireValue(length<=limit,'This case exceeds the request size limit.',413);pieces.push(part);}
  try {const input=JSON.parse(Buffer.concat(pieces).toString('utf8'));requireValue(input&&typeof input==='object'&&!Array.isArray(input),'A JSON object is required.');return input;}
  catch{throw new Problem(400,'Supply a valid JSON object.');}
}
function send(res,status,body) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
}
const cookie=(value,age,secure)=>'tx_session='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(secure?'; Secure':'');
async function login(db,req,res,secure) {
  const body=await readBody(req,8192);
  requireValue(string(body.username,64)&&typeof body.password==='string' && body.password.length<=512,'Enter a username and password.');
  const username=body.username;
  const address=req.socket.remoteAddress||'local';
  const keys=[['ip:'+address,75],['account:'+digest(address+'|'+username),10]];
  const timestamp=Date.now();
  // Bound both the number of guesses per address and parallel password computations.
  transaction(db,()=>{
    db.prepare('DELETE FROM attempts WHERE expires<=?').run(timestamp);
    for(const [key,budget] of keys){
      const previous=db.prepare('SELECT failures FROM attempts WHERE bucket=?').get(key);
      requireValue(!previous||previous.failures<budget,'Too many sign-in attempts. Try again in 15 minutes.',429);
      db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET failures=failures+1').run(key,timestamp+15*60*1000);
    }
  });
  const stored=db.prepare('SELECT * FROM accounts WHERE username=?').get(username);
  const candidate=await derive(body.password,stored?.salt||dummySalt,64);
  const valid=timingSafeEqual(candidate,stored?.verifier||dummyHash);
  requireValue(valid && stored?.active,'Invalid username or password.',401);
  const token=randomBytes(32).toString('hex');
  transaction(db,()=>{
    const current=db.prepare('SELECT salt,active FROM accounts WHERE username=?').get(username);
    requireValue(current?.active&&current.salt===stored.salt,'Account changed. Sign in again.',401);
    for(const [key] of keys)db.prepare('UPDATE attempts SET failures=MAX(0,failures-1) WHERE bucket=?').run(key);
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(timestamp);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),username,timestamp+sessionSeconds*1000);
    auditAccount(db,stored.unit,username,'Signed in',username);
  });
  res.setHeader('Set-Cookie',cookie(token,sessionSeconds,secure));
  send(res,200,{username,role:stored.role,unit:stored.unit});
}

function getStored(db,unit,id){return db.prepare('SELECT revision,data,legacy_unit_access,synthetic FROM cases WHERE unit=? AND id=?').get(unit,id);}
const canEdit = user => user.role==='admin'||user.role==='investigator';
const controlsCase = (user,item) => user.role==='admin'||user.username===item.owner;
const detailsDefaults={notes:'',summary:'',status:'open',scopeStart:'',scopeEnd:''};
const statuses=new Set(['open','in_review','closed','archived']);

function auditAccount(db,unit,actor,action,subject) {
  db.prepare('INSERT INTO account_activity(unit,actor,time,action,subject) VALUES(?,?,?,?,?)').run(unit,actor,now(),action,subject);
}

function recordActivity(db,user,id,action,detail) {
  db.prepare('INSERT INTO case_activity(unit,case_id,actor,time,action,detail) VALUES(?,?,?,?,?,?)').run(user.unit,id,user.username,now(),action,detail);
}

function storedCase(db,unit,id,row=getStored(db,unit,id)) {
  if(!row)return null;
  const item=JSON.parse(row.data);
  const assignments=db.prepare(`SELECT m.username,a.role FROM case_assignments m JOIN accounts a USING(username)
    WHERE m.unit=? AND m.case_id=? AND a.unit=m.unit AND a.active=1 ORDER BY m.username`).all(unit,id);
  const activity=db.prepare(`SELECT actor,time,action,detail FROM case_activity WHERE unit=? AND case_id=?
    ORDER BY sequence DESC LIMIT 200`).all(unit,id).reverse();
  return {...item,metadata:{...detailsDefaults,...item.metadata},synthetic:!!row.synthetic,assignments,legacyAccess:!!row.legacy_unit_access,activity};
}

function hasCase(user,item) {
  return item && (controlsCase(user,item)||item.legacyAccess||item.assignments.some(a=>a.username===user.username));
}

export function loadCaseForUser(db,user,id) {
  const item=storedCase(db,user.unit,id);
  requireValue(hasCase(user,item),'Case not found.',404);
  return item;
}

function allowsIndexedRead(db,user,id) {
  return !!db.prepare(`SELECT 1 FROM cases c WHERE unit=? AND id=?
    AND (?='admin' OR owner=? OR legacy_unit_access=1 OR EXISTS (
      SELECT 1 FROM case_assignments a WHERE a.unit=c.unit AND a.case_id=c.id AND a.username=?
    ))`).get(user.unit,id,user.role,user.username,user.username);
}
function plainCase(body) {
  requireValue(idFormat.test(body.id) && string(body.name,80),'A valid case ID and name are required.');
  requireValue(Array.isArray(body.files)&&Array.isArray(body.records)&&Array.isArray(body.towers),'Supply source files, records and towers.');
  for(const key of ['subjects','audit','chat','findings'])requireValue(Array.isArray(asList(body[key])),'Invalid '+key+'.');
  requireValue(asList(body.subjects).every(x=>string(x,100)),'Invalid subject.');
  requireValue(body.revision===undefined||Number.isSafeInteger(body.revision),'Invalid revision.');
}

// Original files are the authority. Rebuild new rows on the server to verify the imported
// bytes, QA, normalized values and all contributing source row locators before saving.
async function replayImport(item,old) {
  const derived={files:structuredClone(old?.files||[]),records:structuredClone(old?.records||[]),towers:structuredClone(old?.towers||[])};
  for(const added of appendValues(item.files,derived.files,'Original evidence')) {
    requireValue(added && string(added.name,254) && typeof added.raw==='string','Invalid source file.');
    try{
      const {replaySourceFile}=await import('./upload.mjs');
      await replaySourceFile(derived,added);
    }
    catch(error){throw new Problem(400,error.message);}
  }
  for(const field of ['files','records','towers'])requireValue(same(derived[field],item[field]),'Imported '+field+' do not match the source bytes.');
}
function validateFindings(appended,item) {
  const ids=new Set(item.records.map(r=>r.id)), seen=new Set();
  for(const finding of asList(item.findings)) {
    requireValue(finding&&string(finding.id,100)&&!seen.has(finding.id),'Finding IDs must be unique.');
    seen.add(finding.id);
  }
  for(const f of appended) requireValue(string(f.title,400)&&string(f.text,16000)&&Array.isArray(f.ids)&&f.ids.length&&f.ids.every(id=>ids.has(id)),'Every finding needs a title, text and valid citations.');
}
function addEvent(item,user,action,detail) {
  item.audit.push({time:now(),actor:user.username,action,detail});
}
async function prepare(input, old, user) {
  plainCase(input);
  const edit=user.role==='admin'||user.role==='investigator';
  const sign=user.role==='admin'||user.role==='reviewer';
  requireValue(old||edit,'Your role cannot create cases.',403);
  requireValue((input.revision||0)===(old?.revision||0),'Case changed in another session. Reload to continue.',409);
  const findings=appendValues(asList(input.findings),asList(old?.findings),'Finding');
  const chats=appendValues(asList(input.chat),asList(old?.chat),'Assistant');
  const requestedEvents=appendValues(asList(input.audit),asList(old?.audit),'Audit');
  const changed=!old||input.name!==old.name||!same(input.subjects||[],old.subjects||[])||
    !same(input.files,old.files)||!same(input.records,old.records)||!same(input.towers,old.towers)||findings.length>0;
  requireValue(!changed||edit,'Only investigators and admins can change case evidence or findings.',403);
  if(changed) {
    await replayImport(input,old);
    validateFindings(findings,input);
  }
  const version=old?old.contentVersion+(changed?1:0):0;
  const item={id:input.id,name:input.name,createdAt:old?.createdAt||now(),subjects:input.subjects||[],
    files:input.files,records:input.records,towers:input.towers,findings:asList(input.findings),
    chat:[...asList(old?.chat)],audit:[...asList(old?.audit)],review:old?.review||null,
    owner:old?.owner||user.username,unit:user.unit,contributors:[...asList(old?.contributors)],
    metadata:old?.metadata||{...detailsDefaults},leadStates:old?.leadStates||{},
    revision:(old?.revision||0)+1,contentVersion:version};
  if(changed){
    assertScope(item.metadata,item.records);
    if(!item.contributors.includes(user.username))item.contributors.push(user.username);
    item.review=null;
    if(!old) addEvent(item,user,'Case created',item.name);
    for(const f of item.files.slice(old?.files.length||0))addEvent(item,user,'Evidence imported',f.name+' · '+f.qa.accepted+' accepted, '+f.qa.duplicate+' duplicates, '+f.qa.rejected+' rejected');
    for(const f of findings)addEvent(item,user,'Finding saved',f.title);
    if(old && (old.name!==item.name||!same(old.subjects,item.subjects)))addEvent(item,user,'Case details updated',item.name);
  }
  const chatIds=new Set(item.chat.map(e=>e.id));
  for(const entry of chats) {
    requireValue(entry && string(entry.question,400)&&string(entry.id,100)&&!chatIds.has(entry.id),'Invalid or duplicate assistant question.');
    const answer=ask(item,entry.question);
    const message={id:entry.id,question:entry.question,...answer,time:now()};
    if(!answer.supported && string(entry.suggestion,400))message.suggestion=entry.suggestion;
    item.chat.push(message);chatIds.add(entry.id);
    addEvent(item,user,'Assistant query',entry.id);
  }
  const signing=!!input.review&&!same(input.review,old?.review);
  if(signing){
    requireValue(sign&&!item.contributors.includes(user.username),'A reviewer or admin independent of the case authors must sign.',403);
    requireValue(!changed&&!old.review&&item.findings.length>0 && input.review.revisionKey===version,'Sign the current version with at least one finding.',409);
    item.review={reviewer:user.username,revisionKey:version,signedAt:now()};
    addEvent(item,user,'Report signed',user.username+' approved version '+version);
  } else if(old?.review&&!changed) {
    requireValue(same(input.review,old.review),'A signed review is immutable.');
  }
  // Client audit text is never authoritative. Record generated events with server identity.
  if(requestedEvents.some(e=>e?.action==='Report prepared')) {
    requireValue(item.review?.revisionKey===version,'Review the current report before printing.',403);
    addEvent(item,user,'Report prepared','Signed version '+version+' prepared for printing.');
  }
  return {item,signing};
}

function assertScope({scopeStart,scopeEnd},records) {
  const start=scopeStart?timeBoundary(scopeStart):null;
  const end=scopeEnd?timeBoundary(scopeEnd,true):null;
  requireValue(!start||!end||start<=end,'Case scope starts after its end date.');
  requireValue(records.every(r=>(!start||r.time>=start)&&(!end||r.time<=end)), 'Imported record timestamps exceed the case scope.');
}

function patchDetails(old,input,user) {
  requireValue(controlsCase(user,old),'Only the case owner or an admin may change case details.',403);
  const metadata={...old.metadata};
  for (const [key,limit] of Object.entries({notes:16000,summary:2000,scopeStart:10,scopeEnd:10})) {
    if (!Object.hasOwn(input,key)) continue;
    requireValue(typeof input[key]==='string'&&input[key].length<=limit,'Invalid case '+key+'.');
    metadata[key]=input[key].trim();
  }
  if (Object.hasOwn(input,'status')) {
    requireValue(statuses.has(input.status),'Choose a valid case status.');
    metadata.status=input.status;
  }
  for (const {key,value} of ['scopeStart','scopeEnd'].map(key=>({key,value:metadata[key]}))) {
    if (!value) continue;
    try {timeBoundary(value);}
    catch {throw new Problem(400,key+' must be a valid YYYY-MM-DD date.');}
  }
  assertScope(metadata,old.records);
  const edits=Object.keys(metadata).some(key=>key!=='status'&&metadata[key]!==old.metadata[key]);
  requireValue(old.metadata.status!=='archived'||metadata.status!=='archived'||!edits,'Reopen the archived case before editing.',409);
  const item={...old,metadata,revision:old.revision+1};
  if (edits) {
    item.contentVersion+=1;
    item.review=null;
    if(!item.contributors.includes(user.username))item.contributors.push(user.username);
  }
  addEvent(item,user,metadata.status==='archived'?'Case archived':old.metadata.status==='archived'?'Case reopened':'Case details updated','Status '+metadata.status);
  return item;
}

function compactForStorage(item) {
  const {activity,assignments,legacyAccess,synthetic,uploadQa,...data}=item;
  return data;
}

function saveCurrent(db,req,user,id,old,item,signing=false) {
  const changedRecords=!old || old.files.length!==item.files.length;
  transaction(db,()=>{
    const current=session(db,req);
    requireValue(current&&same(current,user),'Session changed. Sign in again.',401);
    const before=getStored(db,user.unit,id);
    requireValue((before?.revision||0)===(old?.revision||0),'Case changed in another session. Reload to continue.',409);
    if(before)requireValue(hasCase(user,storedCase(db,user.unit,id,before)),'Case not found.',404);
    if(changedRecords)storeOriginals(db,item.files.slice(old?.files.length||0));
    const data=JSON.stringify(compactForStorage(item));
    db.prepare(`INSERT INTO cases(unit,id,revision,data,owner) VALUES(?,?,?,?,?)
      ON CONFLICT(unit,id) DO UPDATE SET data=excluded.data,revision=excluded.revision`).run(user.unit,id,item.revision,data,item.owner);
    if(changedRecords)syncEvidenceIndex(db,user.unit,item);
    if(changedRecords||item.findings.length!==old?.findings.length) syncForensicIndex(db,user.unit,item,changedRecords);
    if(signing)db.prepare('INSERT INTO approvals VALUES(?,?,?,?)').run(user.unit,id,item.contentVersion,data);
  });
  return storedCase(db,user.unit,id);
}

async function adminRoute(db,req,res,user,route) {
  requireValue(user.role==='admin','Admin access required.',403);
  if(route==='/api/admin/users'){
    if(req.method==='GET'){send(res,200,assignmentCandidates(db,user));return;}
    if(req.method==='POST'){
      const body=await readBody(req,8192);
      await provisionAccount(db,body.username,body.role,user.unit,body.password,user.username);
      send(res,201,{username:body.username,role:body.role,unit:user.unit,active:true});return;
    }
  }
  const account=/^\/api\/admin\/users\/([a-z0-9_.-]+)$/i.exec(route);
  if(account&&req.method==='PATCH'){
    const input=await readBody(req,4096),username=account[1];
    requireValue(username!==user.username,'An admin may not change their own role or active status.',400);
    const result=transaction(db,()=>{
      requireValue(same(session(db,req),user),'Session changed. Sign in again.',401);
      const current=db.prepare('SELECT role,active FROM accounts WHERE username=? AND unit=?').get(username,user.unit);
      requireValue(current,'Account not found.',404);
      const role=input.role??current.role;
      const active=input.active??!!current.active;
      requireValue(protocolRoles.has(role)&&typeof active==='boolean','Choose a valid role and active flag.');
      db.prepare('UPDATE accounts SET role=?,active=? WHERE username=? AND unit=?').run(role,Number(active),username,user.unit);
      db.prepare('DELETE FROM sessions WHERE username=?').run(username);
      auditAccount(db,user.unit,user.username,active?'Account access updated':'Account disabled',username);
      return {username,role,unit:user.unit,active};
    });
    send(res,200,result);return;
  }
  if(route==='/api/admin/health'&&req.method==='GET'){
    const version=db.prepare('PRAGMA user_version').get().user_version;
    const activeCases=db.prepare(`SELECT count(*) AS count FROM cases WHERE unit=?
      AND COALESCE(json_extract(data,'$.metadata.status'),'open') NOT IN ('archived','closed')`).get(user.unit).count;
    const counts={users:assignmentCandidates(db,user).filter(a=>a.active).length,cases:activeCases};
    const audit=db.prepare('SELECT time,action,actor,subject FROM account_activity WHERE unit=? ORDER BY sequence DESC LIMIT 60').all(user.unit);
    send(res,200,{status:'ok',schemaVersion:version,counts,audit});return;
  }
  throw new Problem(404,'Endpoint not found.');
}

function updateAssignments(db,req,user,item,input) {
  requireValue(controlsCase(user,item),'Only the case owner or an admin may assign access.',403);
  requireValue(item.metadata.status!=='archived','Reopen the archived case to edit assignments.',409);
  requireValue(Array.isArray(input.usernames)&&input.usernames.length<=100&&input.usernames.every(n=>string(n,64)),'Choose up to 100 valid assignees.');
  const wanted=[...new Set(input.usernames)];
  transaction(db,()=>{
    requireValue(same(session(db,req),user),'Session changed. Sign in again.',401);
    const valid=new Set(assignmentCandidates(db,user).filter(a=>a.active).map(a=>a.username));
    requireValue(wanted.every(name=>valid.has(name)),'Assign active accounts from this unit only.');
    db.prepare('DELETE FROM case_assignments WHERE unit=? AND case_id=?').run(user.unit,item.id);
    const assign=db.prepare('INSERT INTO case_assignments VALUES(?,?,?)');
    for(const username of wanted)assign.run(user.unit,item.id,username);
    db.prepare('UPDATE cases SET legacy_unit_access=0 WHERE unit=? AND id=?').run(user.unit,item.id);
    recordActivity(db,user,item.id,'Assignments updated',wanted.length+' assigned account(s).');
  });
  return storedCase(db,user.unit,item.id);
}

async function caseExtra(db,req,res,user,id,action,params) {
  if(action==='records'&&req.method==='GET'){
    requireValue(allowsIndexedRead(db,user,id),'Case not found.',404);
    send(res,200,searchCaseRecords(db,user.unit,id,params,requireValue));return;
  }
  const item=loadCaseForUser(db,user,id);
  if(action==='report.pdf'&&req.method==='GET'){
    requireValue(item.review?.revisionKey===item.contentVersion,'Review and sign the current report to export.',403);
    const {createReportPdf}=await import('./pdf.mjs');
    const pdf=await createReportPdf(item);
    const live=loadCaseForUser(db,user,id);
    requireValue(same(session(db,req),user),'Session changed. Sign in again.',401);
    requireValue(same(live.review,item.review),'Review the current revision to export.',409);
    recordActivity(db,user,id,'Report exported','Signed version '+item.contentVersion+'.');
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.length,'Content-Disposition':'attachment; filename="'+id+'.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(pdf);return;
  }
  if(action==='details'&&req.method==='PATCH'){
    const body=await readBody(req,24576);
    const current=loadCaseForUser(db,user,id);
    send(res,200,saveCurrent(db,req,user,id,current,patchDetails(current,body,user)));return;
  }
  if(action==='assignment-candidates'&&req.method==='GET'){
    requireValue(controlsCase(user,item),'Only the case owner or an admin may view assignment candidates.',403);
    send(res,200,assignmentCandidates(db,user));return;
  }
  if(action==='assignments'){
    if(req.method==='GET'){send(res,200,item.assignments);return;}
    if(req.method==='PUT'){const body=await readBody(req,16384);send(res,200,updateAssignments(db,req,user,loadCaseForUser(db,user,id),body));return;}
  }
  if(action==='activity'&&req.method==='POST'){
    const body=await readBody(req,4096);
    const source=body.action==='Source viewed'&&item.files.some(f=>f.id===body.ref);
    const record=body.action==='Record viewed'&&item.records.some(r=>r.id===body.ref);
    requireValue(source||record,'Choose a source or record in this case.');
    requireValue(same(session(db,req),user),'Session changed. Sign in again.',401);
    loadCaseForUser(db,user,id);
    recordActivity(db,user,id,body.action,body.ref);
    send(res,200,storedCase(db,user.unit,id));return;
  }
  if(action==='uploads'&&req.method==='POST'){
    requireValue(canEdit(user),'Your role cannot import evidence.',403);
    requireValue(item.metadata.status!=='archived','Reopen the archived case before importing.',409);
    limitAction(user,'upload',80);
    const {readUpload,stageImport,previewUpload}=await import('./upload.mjs');
    const upload=await readUpload(req);
    requireValue(same(session(db,req),user),'Session changed. Sign in again.',401);
    const latest=loadCaseForUser(db,user,id);
    requireValue(latest.metadata.status!=='archived','Reopen the archived case before importing.',409);
    if(upload.preview){send(res,200,await previewUpload(upload));return;}
    requireValue(upload.options.revision===latest.revision,'Case changed in another session. Reload to continue.',409);
    const input=structuredClone(latest);
    const uploadQa=await stageImport(input,upload);
    if(input.files.length===latest.files.length){send(res,200,{...latest,uploadQa});return;}
    input.review=null;
    const prepared=await prepare(input,latest,user);
    const saved=saveCurrent(db,req,user,id,latest,prepared.item,prepared.signing);
    send(res,200,{...saved,uploadQa});return;
  }
  const source=/^sources\/([a-z0-9_.-]+)(\/verify)?$/i.exec(action);
  if(source&&((!source[2]&&req.method==='GET')||(source[2]&&req.method==='POST'))){
    const f=item.files.find(file=>file.id===source[1]);
    requireValue(f,'Original file not found.',404);
    const {ok,expected,actual,bytes}=fetchOriginal(db,f);
    if(source[2]){
      recordActivity(db,user,id,ok?'Source integrity verified':'Source integrity failed',f.id);
      send(res,200,{ok,expected,actual});return;
    }
    requireValue(ok,'Original file is unavailable or failed its integrity check.',409);
    recordActivity(db,user,id,'Original downloaded',f.id);
    const filename=f.name.replace(/[^a-z0-9._-]/gi,'_').slice(0,150)||'evidence';
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(bytes);return;
  }
  const lead=/^leads\/(.+)$/.exec(action);
  if(lead&&req.method==='PATCH'){
    const body=await readBody(req,4096), current=loadCaseForUser(db,user,id),leadId=decodeURIComponent(lead[1]);
    requireValue(current.metadata.status!=='archived','Reopen the case before updating leads.',409);
    requireValue(analyze(current).leads.some(entry=>entry.id===leadId),'Analytical lead not found.',404);
    const state=body.status,reviewer=body.reviewer||'';
    requireValue(['new','in_review','cleared','dismissed'].includes(state),'Choose a valid lead status.');
    requireValue(!reviewer||assignmentCandidates(db,user).some(a=>a.username===reviewer&&a.active&&a.role==='reviewer'&&(current.legacyAccess||current.assignments.some(x=>x.username===reviewer))),'Choose an assigned reviewer.');
    current.leadStates={...current.leadStates,[leadId]:{status:state,reviewer,actor:user.username,time:now()}};
    current.revision+=1;
    addEvent(current,user,'Lead status updated',state);
    send(res,200,saveCurrent(db,req,user,id,{...current,revision:current.revision-1},current));return;
  }
  throw new Problem(404,'Endpoint not found.');
}

function assignmentCandidates(db,user) {
  return db.prepare('SELECT username,role,active FROM accounts WHERE unit=? ORDER BY username').all(user.unit)
    .map(row=>({...row,active:!!row.active}));
}

export async function seedSyntheticCase(db,unit,item,reset=false) {
  requireValue(item.id==='CASE-RJ-001'&&string(unit,80),'The seed must target CASE-RJ-001 in one unit.');
  const existing=getStored(db,unit,item.id);
  requireValue(!existing||existing.synthetic,'A real case already has this ID. The seed did not modify it.',409);
  if(existing&&!reset)return storedCase(db,unit,item.id);
  const demo={...item,unit,owner:'synthetic fixture',revision:(existing?.revision||0)+1,contentVersion:0,
    contributors:[],metadata:{...detailsDefaults},audit:[],chat:[],findings:[],review:null,leadStates:{}};
  storeOriginals(db,demo.files);
  transaction(db,()=>{
    const verify=getStored(db,unit,item.id);
    requireValue(!verify||verify.synthetic,'A real case already has this ID.',409);
    requireValue((verify?.revision||0)===(existing?.revision||0),'Case was updated. Retry the seed.',409);
    db.prepare(`INSERT INTO cases(unit,id,revision,data,legacy_unit_access,synthetic,owner) VALUES(?,?,?,?,1,1,?)
      ON CONFLICT(unit,id) DO UPDATE SET data=excluded.data,revision=excluded.revision,legacy_unit_access=1`).run(unit,item.id,demo.revision,JSON.stringify(compactForStorage(demo)),demo.owner);
    db.prepare('DELETE FROM case_assignments WHERE unit=? AND case_id=?').run(unit,item.id);
    db.prepare('DELETE FROM case_activity WHERE unit=? AND case_id=?').run(unit,item.id);
    db.prepare('DELETE FROM approvals WHERE unit=? AND id=?').run(unit,item.id);
    syncEvidenceIndex(db,unit,demo);
    syncForensicIndex(db,unit,demo,true);
    recordActivity(db,{unit,username:'synthetic fixture'},item.id,existing?'Synthetic case reset':'Synthetic case seeded','Synthetic case data only.');
  });
  return storedCase(db,unit,item.id);
}

export function createTeamServer(db, {secureCookies=process.env.TRACEX_SECURE_COOKIES==='1'}={}) {
  return http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      if(route==='/healthz'&&req.method==='GET'){send(res,200,{status:'ok'});return;}
      if(route==='/api/openapi.json'&&req.method==='GET'){send(res,200,openApiDocument);return;}
      if(!route.startsWith('/api/')){await serveStatic(req,res,{team:true});return;}
      if(!['GET','HEAD'].includes(req.method)){
        const origin=req.headers.origin;
        if(origin){let valid=false;try{const u=new URL(origin);valid=['http:','https:'].includes(u.protocol)&&u.host===req.headers.host;}catch{}requireValue(valid,'Origin does not match this server.',403);}
        requireValue(req.headers['sec-fetch-site']!=='cross-site','Cross-site writes are not allowed.',403);
      }
      if(route==='/api/login'&&req.method==='POST'){await login(db,req,res,secureCookies);return;}
      const user=session(db,req);
      requireValue(user,'Sign in to the shared workspace.',401);
      if(route==='/api/session'&&req.method==='GET'){send(res,200,user);return;}
      if(route==='/api/intent'&&req.method==='POST'){
        const body=await readBody(req,4096);
        requireValue(string(body.maskedQuestion,400),'Supply a masked question of up to 400 characters.');
        if(!process.env.TRACEX_OLLAMA_MODEL){send(res,200,{intent:null});return;}
        limitAction(user,'intent',20);
        const {classify}=await import('./model.mjs');
        send(res,200,await classify(body.maskedQuestion));return;
      }
      if(route==='/api/logout'&&req.method==='POST'){
        const token=/(?:^|;\s*)tx_session=([a-f0-9]{64})(?=;|$)/.exec(req.headers.cookie||'');
        if(token)db.prepare('DELETE FROM sessions WHERE digest=?').run(digest(token[1]));
        auditAccount(db,user.unit,user.username,'Signed out',user.username);
        res.setHeader('Set-Cookie',cookie('',0,secureCookies));send(res,200,{signedOut:true});return;
      }
      if(route.startsWith('/api/admin/')){await adminRoute(db,req,res,user,route);return;}
      if(route==='/api/cases'&&req.method==='GET'){
        const rows=db.prepare(`SELECT id,revision,data,legacy_unit_access,synthetic FROM cases c WHERE unit=?
          AND (?='admin' OR owner=? OR legacy_unit_access=1 OR EXISTS
          (SELECT 1 FROM case_assignments a WHERE a.unit=c.unit AND a.case_id=c.id AND a.username=?)) ORDER BY id`).all(user.unit,user.role,user.username,user.username);
        send(res,200,rows.map(row=>storedCase(db,user.unit,row.id,row)));return;
      }
      const history=/^\/api\/cases\/([A-Za-z0-9_.-]+)\/reviews\/(\d+)$/.exec(route);
      if(history&&req.method==='GET'){
        loadCaseForUser(db,user,history[1]);
        const snapshot=db.prepare('SELECT data FROM approvals WHERE unit=? AND id=? AND version=?').get(user.unit,history[1],Number(history[2]));
        requireValue(snapshot,'Signed revision not found.',404);send(res,200,JSON.parse(snapshot.data));return;
      }
      const match=/^\/api\/cases\/([A-Za-z0-9_.-]+)$/.exec(route);
      if(match&&req.method==='GET'){send(res,200,loadCaseForUser(db,user,match[1]));return;}
      if(match && req.method==='PUT'){
        const id=match[1];
        if(getStored(db,user.unit,id))loadCaseForUser(db,user,id);
        else requireValue(canEdit(user),'Your role cannot create cases.',403);
        const body=await readBody(req,maxBody);
        requireValue(body.id===id,'Case ID mismatch.');
        const original=getStored(db,user.unit,id),old=original?loadCaseForUser(db,user,id):null;
        requireValue(old?.metadata.status!=='archived','Reopen the archived case before writing to it.',409);
        const {item,signing}=await prepare(body,old,user);
        send(res,old?200:201,saveCurrent(db,req,user,id,old,item,signing));return;
      }
      const extra=/^\/api\/cases\/([A-Za-z0-9_.-]+)\/(.+)$/.exec(route);
      if(extra){await caseExtra(db,req,res,user,extra[1],extra[2],url.searchParams);return;}
      throw new Problem(404,'Endpoint not found.');
    } catch(error) {
      if(!error.status)console.error('TRACE-X request failed:',error.name);
      if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'The team server could not complete this request.'});
      else res.end();
    }
  });
}
