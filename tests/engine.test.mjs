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

test('party direction, duration, repeat contacts and peak hour remain evidence-linked',async()=>{
  const c=await createDemo(),{callStats}=analyze(c);
  const a=callStats.parties.find(p=>p.id==='A'), b=callStats.parties.find(p=>p.id==='B');
  assert.deepEqual([a.count,a.incoming,a.outgoing,a.seconds,a.knownDurations],[4,0,4,230,4]);
  assert.deepEqual([b.count,b.incoming,b.outgoing,b.seconds,b.knownDurations],[4,1,3,283,4]);
  assert.deepEqual([a.first.id,a.last.id],['R101','R107']);
  assert.equal(callStats.peakHour.hour,10);
  assert.deepEqual(callStats.peakHour.ids,['R102','R103','R104','R109','R110']);
  assert.ok(callStats.repeatedPairs.some(pair=>pair.source==='A'&&pair.target==='X'&&pair.count===2));
  assert.deepEqual(ask(c,'Show first and last calls for A').ids,['R101','R107']);
  assert.deepEqual(ask(c,'Show incoming calls for B').ids,['R110']);
  assert.deepEqual(ask(c,'Show outgoing calls for B').ids,['R109','R111','R112']);
  assert.deepEqual(ask(c,'How many times did A call X?').ids,['R102','R105']);
  assert.equal(ask(c,'How many times did X call A?').supported,false);
  assert.deepEqual(ask(c,'How many calls involve B?').ids,b.ids);
  assert.match(ask(c,'Summarize calls for B').text,/1 incoming, 3 outgoing.*283 seconds/);
  assert.deepEqual(new Set(ask(c,'Show repeated contacts for A').ids),new Set(a.ids));
  assert.deepEqual(new Set(ask(c,'Which contacts are shared by A and B on 2026-11-18?').ids),new Set(['R102','R105','R109','R111']));
});

test('IST date windows filter before claims and dated overnight ranges span two days',async()=>{
  const c=createCase('Midnight');
  await importFile(c,'calls.csv',[
    'caller,callee,timestamp,duration',
    'A,X,2026-11-18 00:10,0',
    'A,X,2026-11-18 23:05,33',
    'B,X,2026-11-19 01:03,42',
    'A,Y,2026-11-19 03:15,',
    'B,Z,2026-11-19 12:10,64'
  ].join('\n'));
  assert.deepEqual(ask(c,'Show calls between 23:00 and 02:00 on 2026-11-18').ids,['R102','R103']);
  assert.deepEqual(ask(c,'Show calls for A between 23:00 and 02:00 on 2026-11-18').ids,['R102']);
  assert.equal(ask(c,'Show calls between 23:00 and 02:00 on 2026-02-30').supported,false);
  assert.deepEqual(ask(c,'Show call history for A on 2026-11-19').ids,['R104']);
  assert.match(ask(c,'Summarize calls for A on 2026-11-19').text,/No duration is recorded/);
  assert.equal(ask(c,'Which contacts do A and B share on 2026-11-18?').supported,false);
  assert.deepEqual(ask(c,'Which contacts do A and B share between 2026-11-18 and 2026-11-19?').ids,['R101','R102','R103']);
});

test('IPDR lookup canonicalizes endpoint spelling and identifies incomplete session intervals',async()=>{
  const c=createCase('Source port');
  await importFile(c,'network.csv',[
    'subscriber,public ip,source port,protocol,TIME_FIRST,TIME_LAST',
    'A,2001:0db8:0:0:0:0:0:1,443,6,2026-11-18 08:30,2026-11-18 08:55',
    'B,2001:db8::1,443,TCP,2026-11-18 09:00,'
  ].join('\n'));
  const exact=ask(c,'Show IPDR sessions for 2001:db8::1 port 00443 at 2026-11-18T03:10:00Z TCP');
  assert.match(exact.text,/One recorded session/);
  assert.deepEqual(exact.ids,['R101']);
  const incomplete=ask(c,'Find sessions for 2001:db8::1 source port 443 at 2026-11-18 09:30+05:30 TCP');
  assert.match(incomplete.text,/inconclusive.*session end/);
  assert.deepEqual(incomplete.ids,['R102']);
  assert.equal(ask(c,'Show sessions for 2001:db8::1 port 99999').supported,false);
  assert.equal(ask(c,'Show sessions for 999.1.1.1').supported,false);
});

test('service labels require explicit IPDR metadata and preserve their source references',async()=>{
  const c=createCase('Publisher labels');
  await importFile(c,'labels.csv',[
    'subscriber,public ip,destination port,session start,application',
    'A,203.0.113.18,443,2026-11-18 10:10,Approved portal',
    'B,203.0.113.18,443,2026-11-18 10:11,'
  ].join('\n'));
  assert.deepEqual(analyze(c).ipServices,[{name:'Approved portal',count:1,ids:['R101']}]);
  assert.deepEqual(ask(c,'Show recorded services for A').ids,['R101']);
  assert.match(ask(c,'Show recorded services').text,/Approved portal/);
  assert.equal(ask(c,'Show recorded services for B').supported,false);
  assert.equal(ask(await createDemo(),'Show recorded services').supported,false);
});

test('leading blank rows and quoted alternate separators preserve operator line provenance',async()=>{
  const c=createCase('Mixed separator header');
  const file='\r\nCaller\tCallee\tTimestamp\t"Note,Type,Source,Ref"\r\nA\tB\t2026-11-18 10:50\t"First note, one"';
  const qa=await importFile(c,'operator.tsv',file);
  assert.equal(qa.accepted,1);
  assert.equal(c.records[0].refs[0].line,3);
  assert.equal(c.records[0].refs[0].raw,file.split('\r\n')[2]);
});
