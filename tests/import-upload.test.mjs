import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sampleWorkbook} from './helpers/workbook.mjs';
import {createCase,ask} from '../dist/engine.js';
import {previewUpload,stageImport,replaySourceFile} from '../server/upload.mjs';

test('XLSX mapping, worksheet provenance, original bytes and replay',async()=>{
  const bytes=sampleWorkbook(), filename='sample.xlsx', upload={bytes,filename,options:{columnMap:{from:'From ID',to:'To ID',time:'When'}}};
  const preview=await previewUpload(upload);
  assert.equal(preview.sheet,'Synthetic calls');
  assert.deepEqual(preview.rows.map(row=>row.line),[3,5]);
  const c=createCase('Workbook case'), qa=await stageImport(c,upload);
  assert.equal(qa.accepted,2);
  assert.equal(c.files[0].sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(Buffer.from(c.files[0].originalBase64,'base64'),bytes);
  assert.deepEqual(c.records.map(r=>r.refs[0].line),[3,5]);
  assert.equal(ask(c,'Which contacts do A and B share?').supported,true);
  assert.equal((await stageImport(c,upload)).alreadyImported,true);
  const replay=createCase('Replay');
  await replaySourceFile(replay,c.files[0]);
  assert.deepEqual(replay.records,c.records);
  assert.deepEqual(replay.files,c.files);
  await assert.rejects(stageImport(c,{filename:'invalid.xlsx',bytes:Buffer.from('not a workbook')}),{status:400});
});
