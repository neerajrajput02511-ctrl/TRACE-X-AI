import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,ask} from '../dist/engine.js';
import {createReportPdf} from '../server/pdf.mjs';
import {demoCase,generatedCalls} from '../server/demo.mjs';

test('server report needs a current sign-off and produces a PDF',async()=>{
  const item=await createDemo(),answer=ask(item,'Which contacts do A and B share?');
  item.findings=[{title:'Shared contact',text:answer.text,ids:answer.ids}];
  item.contentVersion=3;
  assert.throws(()=>createReportPdf(item),{status:403});
  item.review={reviewer:'reviewer-1',revisionKey:3,signedAt:'2026-11-19T00:00:00.000Z'};
  const pdf=await createReportPdf(item);
  assert.match(pdf.subarray(0,8).toString(),/^%PDF-1/);
  assert.ok(pdf.length>10000);
  assert.match(pdf.subarray(-20).toString(),/%%EOF/);
});
test('stable demo adds QA, preserves citations and gives bounded analytical answers',async()=>{
  const c=await demoCase(), second=await demoCase();
  assert.deepEqual(c,second);
  const shared=ask(c,'Which contacts do A and B share?');
  assert.ok(shared.ids.includes('R102')&&shared.ids.includes('R109')&&shared.ids.includes('R105'));
  assert.equal(ask(c,'Did A call B directly?').supported,false);
  assert.deepEqual(ask(c,'What IPDR matches have missing port information?').ids,['R116']);
  assert.ok(ask(c,'Show tower activity of A between 2026-11-18 and 2026-11-19').ids.includes('R102'));
  assert.equal(ask(c,'Show tower activity of A between 2026-11-19 and 2026-11-18').supported,false);
  assert.equal(ask(c,'Show night calls').ids.length,3);
  assert.equal(c.files.at(-1).qa.duplicate,1);
  assert.equal(c.files.at(-1).qa.rejected,1);
  assert.equal(generatedCalls(100),generatedCalls(100));
});
