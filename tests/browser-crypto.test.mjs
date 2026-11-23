import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {sha256Fallback,uuid} from '../dist/crypto.js';
import {createCase,importFile,previewImport} from '../dist/engine.js';

test('HTTP debug browser SHA-256 fallback matches Node across padding and block boundaries',()=>{
  for(const length of [0,1,17,55,56,63,64,65,119,120,127,128,65539]){
    const bytes=randomBytes(length);
    assert.equal(sha256Fallback(bytes),createHash('sha256').update(bytes).digest('hex'));
  }
  assert.match(uuid(),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('custom field mapping retains headers, timezone, bytes and exact row locators',async()=>{
  const raw='origin account;end account;network time\nA;X;2026-11-18 10:14\nB;X;2026-11-18 10:41';
  const pi=await previewImport(raw);
  assert.equal(pi.type,null);
  assert.deepEqual(pi.columns.map(c=>c.header),['origin account','end account','network time']);
  const item=createCase();
  const columnMap={from:'origin account',to:'end account',time:'network time'};
  const qa=await importFile(item,'custom.csv',raw,{columnMap,timezoneOffsetMinutes:0});
  assert.equal(qa.accepted,2);
  assert.deepEqual(qa.columnMap,columnMap);
  assert.equal(item.files[0].raw,raw);
  assert.equal(item.records[0].time,'2026-11-18T10:14:00.000Z');
  assert.deepEqual(item.records[1].refs,[{fileId:'F001',line:3,raw:'B;X;2026-11-18 10:41'}]);
});
