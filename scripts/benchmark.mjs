import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {analyze,ask,createCase,importFile} from '../dist/engine.js';
import {generatedCalls} from '../server/demo.mjs';

const n=Number(process.argv[2]||50000), item=createCase('Synthetic performance fixture');
const input=generatedCalls(n);
const timings={};
async function measure(name,fn){
 const started=performance.now();const result=await fn();timings[name]=Math.round((performance.now()-started)*100)/100;return result;
}
const qa=await measure('importMs',()=>importFile(item,'benchmark.csv',input));
const analytics=await measure('analyticsMs',()=>analyze(item));
const answer=await measure('queryMs',()=>ask(item,'Show top contacts'));
if(qa.accepted!==n||!answer.supported)throw new Error('Performance fixture failed correctness checks.');
console.log(JSON.stringify({node:process.version,platform:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,sourceBytes:Buffer.byteLength(input),rows:qa.accepted,rejected:qa.rejected,distinctParties:analytics.contacts,edges:analytics.edges.length,citations:answer.ids.length,heapUsedMB:Math.round(process.memoryUsage().heapUsed/1024/1024),...timings},null,2));
