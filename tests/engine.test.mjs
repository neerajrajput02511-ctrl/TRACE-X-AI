import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {analyze, ask, createCase, createDemo, importFile} from '../dist/engine.js';

test('two operator schemas, IPDR and tower register produce traceable analytics',async()=>{
  const c=await createDemo(), summary=analyze(c);
  assert.equal(c.files.length,4);assert.equal(summary.total,17);assert.equal(summary.cdrCount,14);
  assert.equal(summary.ipdrCount,3);assert.equal(summary.contacts,8);assert.equal(c.towers.length,6);
  assert.deepEqual(c.files.map(f=>f.type),['CDR','CDR','IPDR','TOWER']);
  assert.equal(c.files[2].qa.issues.length,1);
  assert.ok(summary.timeline.every(v=>Number.isFinite(v.lat)&&Number.isFinite(v.lon)));
  const lead=summary.leads.find(l=>l.title==='Shared contact X');
  assert.deepEqual(new Set(lead.ids),new Set(['R102','R105','R109','R111']));
  assert.equal(summary.edges.find(e=>e.source==='A'&&e.target==='X').count,2);
  assert.ok(summary.changes.some(v=>v.subject==='A' && v.before==='DEV-A01' && v.after==='DEV-A02'));
  for(const r of c.records) for(const source of r.refs) {
    const file=c.files.find(f=>source.fileId===f.id);
    assert.equal(file.raw.split('\n')[source.line-1],source.raw);
  }
});

test('original bytes, CSV quoting, source lines and dedup across timezone formats',async()=>{
  const c=createCase('Quoted file');
  const bytes=Buffer.from('\uFEFFcaller,callee,timestamp,comment\r\nA,X,2026-11-18 10:14,"one\r\ntwo, ""three"""\r\n\r\nB,X,2026-11-18 10:41,last\r\n');
  const qa=await importFile(c,'a.csv',bytes);
  assert.equal(qa.accepted,2);assert.equal(c.files[0].sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(c.records.map(r=>r.refs[0].line),[2,5]);
  assert.match(c.records[0].refs[0].raw,/\r\ntwo/);
  assert.deepEqual(c.records.map(r=>r.time),['2026-11-18T04:44:00.000Z','2026-11-18T05:11:00.000Z']);
  const duplicate=await importFile(c,'z.csv','caller,callee,timestamp\nA,X,2026-11-18T04:44:00Z');
  assert.equal(duplicate.duplicate,1);assert.deepEqual(c.records[0].refs.map(r=>r.fileId),['F001','F002']);
  const repeated=await importFile(c,'copy.csv',bytes);assert.equal(repeated.alreadyImported,true);assert.equal(c.files.length,2);
});

test('row-level QA, explicit timezone override, and atomic invalid-file rejection',async()=>{
  const c=createCase('QA');
  const result=await importFile(c,'calls.csv','caller,callee,timestamp\nA,B,2025-02-29 00:00\nB,C,2024-02-29 00:00\nA,,2024-02-29 00:00',{timezoneOffsetMinutes:0});
  assert.equal(result.rejected,2);assert.equal(result.accepted,1);assert.deepEqual(result.issues.map(i=>i.line),[2,4]);
  assert.equal(c.records[0].time,'2024-02-29T00:00:00.000Z');
  const before=JSON.stringify(c);
  await assert.rejects(importFile(c,'bad.csv','caller,callee,timestamp\nA,"B,2026-11-19 12:00'),/Unclosed quote/);
  await assert.rejects(importFile(c,'empty.csv','caller,callee,timestamp'),/data row/);
  await assert.rejects(importFile(c,'bad.bin',Uint8Array.of(255,254,255)),/UTF-8/);
  assert.equal(JSON.stringify(c),before);
});

test('inbound subscriber exports assign tower and device to the observed line',async()=>{
  const c=createCase('Incoming');
  await importFile(c,'in.csv','msisdn,other party,direction,timestamp,cell id,imei\nP,Q,Incoming,2026-11-18 10:00,C1,DEV1');
  assert.equal(c.records[0].from,'Q');assert.equal(c.records[0].to,'P');
  assert.equal(analyze(c).timeline[0].subject,'P');
  assert.equal(ask(c,'Did P call Q directly?').supported,false);
  assert.equal(ask(c,'Did Q call P directly?').supported,true);
});

test('cited answers abstain from unsupported inferences and support Hindi and time windows',async()=>{
  const c=await createDemo();
  for(const prompt of ['Which contacts do A and B share?','A और B के साझा संपर्क कौन हैं?','Show device changes for A','Show tower timeline for B','Who are the most frequent contacts?','Show calls between 10:00 and 11:00']) {
    const answer=ask(c,prompt);
    assert.ok(answer.supported,prompt);assert.ok(answer.ids.length);
    for(const id of answer.ids) assert.ok(c.records.some(r=>r.id===id));
  }
  for(const prompt of ['Did A call B directly?','Which criminal organised this?','Who are the most frequent contacts last year?',
    'Which contacts do A and ZZZ share?','Show calls between 29:09 and 50:00']) {
    assert.deepEqual(ask(c,prompt).ids,[],prompt);assert.equal(ask(c,prompt).supported,false,prompt);
  }
});

test('shared IP ambiguity survives missing port and overlapping interval',async()=>{
  const c=await createDemo();
  const broad=ask(c,'Show sessions for 203.0.113.18');
  assert.match(broad.text,/inconclusive/);assert.equal(broad.ids.length,2);
  const overlap=ask(c,'Show sessions for 203.0.113.18 port 4051 at 2026-11-18 10:24 TCP');
  assert.match(overlap.text,/inconclusive/);assert.equal(overlap.ids.length,2);
  const single=ask(c,'Show sessions for 203.0.113.18 port 4051 at 2026-11-18 10:12 TCP');
  assert.match(single.text,/One recorded session/);assert.equal(single.ids.length,1);
  assert.equal(ask(c,'Show sessions for 192.0.2.1').supported,false);
});

test('case segregation and simultaneous import of identical files',async()=>{
  const c=createCase('first'), other=createCase('second');
  const text='caller,callee,timestamp\nA,B,2026-11-18 11:00';
  await Promise.all([importFile(c,'one.csv',text),importFile(c,'two.csv',text)]);
  assert.equal(c.files.length,1);assert.equal(c.records.length,1);assert.equal(other.records.length,0);
  assert.equal(ask(other,'Did A call B directly?').supported,false);
});
