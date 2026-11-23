import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual as same, promisify} from 'node:util';
import {ask, importFile} from '../dist/engine.js';
import {serveStatic} from './static.mjs';

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
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts(username TEXT PRIMARY KEY,role TEXT NOT NULL,unit TEXT NOT NULL,salt TEXT NOT NULL,verifier BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES accounts(username),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cases(unit TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(unit,id));
    CREATE TABLE IF NOT EXISTS approvals(unit TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(unit,id,version));
    CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY,failures INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  return db;
}
export async function provisionAccount(db,username,role,unit,password) {
  requireValue(typeof username==='string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(username),'Use 1–64 username letters, digits, dots, hyphens or underscores.');
  requireValue(protocolRoles.has(role),'Choose investigator, reviewer or admin.');
  requireValue(string(unit,80) && unit.trim()===unit,'A unit of up to 80 characters is required.');
  requireValue(typeof password==='string' && password.length>=12 && password.length<=512,'Use a password of 12–512 characters.');
  const salt=randomBytes(16).toString('hex'), verifier=await derive(password,salt,64);
  transaction(db,()=>{
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET role=excluded.role, unit=excluded.unit, salt=excluded.salt, verifier=excluded.verifier').run(username,role,unit,salt,verifier);
    db.prepare('DELETE FROM sessions WHERE username=?').run(username);
  });
}

function session(db,req) {
  const match=/(?:^|;\s*)tx_session=([a-f0-9]{64})(?=;|$)/.exec(req.headers.cookie||'');
  if(!match)return null;
  return db.prepare('SELECT a.username,a.role,a.unit FROM sessions s JOIN accounts a USING(username) WHERE s.digest=? AND s.expires>?').get(digest(match[1]),Date.now());
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
  requireValue(valid && stored,'Invalid username or password.',401);
  const token=randomBytes(32).toString('hex');
  transaction(db,()=>{
    const current=db.prepare('SELECT salt FROM accounts WHERE username=?').get(username);
    requireValue(current?.salt===stored.salt,'Account changed. Sign in again.',401);
    for(const [key] of keys)db.prepare('UPDATE attempts SET failures=MAX(0,failures-1) WHERE bucket=?').run(key);
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(timestamp);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),username,timestamp+sessionSeconds*1000);
  });
  res.setHeader('Set-Cookie',cookie(token,sessionSeconds,secure));
  send(res,200,{username,role:stored.role,unit:stored.unit});
}

function getStored(db,unit,id){return db.prepare('SELECT revision,data FROM cases WHERE unit=? AND id=?').get(unit,id);}
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
    try{await importFile(derived,added.name,added.raw,{timezoneOffsetMinutes:added.qa?.defaultTimezoneOffsetMinutes});}
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
    revision:(old?.revision||0)+1,contentVersion:version};
  if(changed){
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
    addEvent(item,user,'Assistant query',entry.question);
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

export function createTeamServer(db, {secureCookies=process.env.TRACEX_SECURE_COOKIES==='1'}={}) {
  return http.createServer(async(req,res)=>{
    try {
      const route=new URL(req.url,'http://localhost').pathname;
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
        const {classify}=await import('./model.mjs');
        send(res,200,await classify(body.maskedQuestion));return;
      }
      if(route==='/api/logout'&&req.method==='POST'){
        const token=/(?:^|;\s*)tx_session=([a-f0-9]{64})(?=;|$)/.exec(req.headers.cookie||'');
        if(token)db.prepare('DELETE FROM sessions WHERE digest=?').run(digest(token[1]));
        res.setHeader('Set-Cookie',cookie('',0,secureCookies));send(res,200,{signedOut:true});return;
      }
      if(route==='/api/cases'&&req.method==='GET'){
        send(res,200,db.prepare('SELECT data FROM cases WHERE unit=? ORDER BY id').all(user.unit).map(row=>JSON.parse(row.data)));return;
      }
      const history=/^\/api\/cases\/([A-Za-z0-9_.-]+)\/reviews\/(\d+)$/.exec(route);
      if(history&&req.method==='GET'){
        const snapshot=db.prepare('SELECT data FROM approvals WHERE unit=? AND id=? AND version=?').get(user.unit,history[1],Number(history[2]));
        requireValue(snapshot,'Signed revision not found.',404);send(res,200,JSON.parse(snapshot.data));return;
      }
      const match=/^\/api\/cases\/([A-Za-z0-9_.-]+)$/.exec(route);
      if(match && req.method==='PUT'){
        const body=await readBody(req,maxBody),id=match[1];requireValue(body.id===id,'Case ID mismatch.');
        const original=getStored(db,user.unit,id), old=original?JSON.parse(original.data):null;
        const {item,signing}=await prepare(body,old,user);
        transaction(db,()=>{
          const current=session(db,req);
          requireValue(current && same(current,user),'Session changed. Sign in again.',401);
          requireValue((getStored(db,user.unit,id)?.revision||0)===(old?.revision||0),'Case changed in another session. Reload to continue.',409);
          const data=JSON.stringify(item);
          db.prepare('INSERT INTO cases VALUES(?,?,?,?) ON CONFLICT(unit,id) DO UPDATE SET data=excluded.data,revision=excluded.revision').run(user.unit,id,item.revision,data);
          if(signing)db.prepare('INSERT INTO approvals VALUES(?,?,?,?)').run(user.unit,id,item.contentVersion,data);
        });
        send(res,old?200:201,item);return;
      }
      throw new Problem(404,'Endpoint not found.');
    } catch(error) {
      if(!error.status)console.error('TRACE-X request failed:',error.name);
      if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'The team server could not complete this request.'});
      else res.end();
    }
  });
}
