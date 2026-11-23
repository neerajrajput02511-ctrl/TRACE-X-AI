import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,ask} from '../dist/engine.js';
import {routeQuestion} from '../dist/query-router.js';
test('offline classifier proposes an approved, cited query for an English paraphrase',async()=>{
 const c=await createDemo();const next=await routeQuestion(c,'Who did A and B both call?');
 assert.equal(next,'Which contacts do A and B share?');
 assert.ok(ask(c,next).ids.includes('R102'));
});
test('unsupported allegations and missing parties produce no query',async()=>{
 const c=await createDemo();
 assert.equal(await routeQuestion(c,'Is X guilty?'),null);
 assert.equal(await routeQuestion(c,'Which towers were recorded for Z?'),null);
 assert.equal(await routeQuestion(c,'What is the weather?'),null);
});

