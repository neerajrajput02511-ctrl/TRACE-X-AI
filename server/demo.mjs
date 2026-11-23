import {pathToFileURL} from 'node:url';
import {createDemo,importFile} from '../dist/engine.js';
import {openDatabase,seedSyntheticCase} from './team.mjs';

export function generatedCalls(count=10000) {
  if(!Number.isSafeInteger(count)||count<1||count>90000)throw new Error('Choose 1–90,000 generated rows.');
  const lines=['caller,callee,timestamp,duration,cell id,imei,imsi'];
  for(let i=0;i<count;i++){
    // Only symbolic synthetic identities; consecutive UTC instants ensure reproducibility.
    const at=new Date(Date.UTC(2026,10,18,0,0,i)).toISOString();
    const from='LAB'+String(i%50).padStart(2,'0');
    const to='NODE'+String((i*17+3)%131).padStart(3,'0');
    lines.push([from,to,at,15+i%480,'JP'+(11+i%6),'LAB-D'+(i%53),'LAB-S'+(i%50)].join(','));
  }
  return lines.join('\n');
}
export async function demoCase(){
  const item=await createDemo();
  item.createdAt='2026-11-19T00:00:00.000Z';
  item.synthetic=true;
  await importFile(item,'jaipur-synthetic-qa.csv',[
    'caller,callee,timestamp,duration,cell id,imei,imsi',
    'A,X,2026-11-18 10:14,84,JP11,DEV-A01,SIM-A01',
    'A,C,2026-11-18 23:01,37,JP13,DEV-A02,SIM-A01',
    'B,F,2026-11-18 23:08,52,JP13,DEV-B01,SIM-B01',
    'Z,F,2026-11-18 23:09,,MISSING-TOWER,,',
    'Z,,2026-11-18 23:10,5,,,'
  ].join('\n'));
  return item;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [unit,flag,...extra]=process.argv.slice(2);
  if(!unit||extra.length||flag&&flag!=='--reset'){
    console.error('Usage: npm run demo -- <existing account unit> [--reset]');
    process.exitCode=1;
  }else{
    const db=openDatabase();
    try{
      await seedSyntheticCase(db,unit,await demoCase(),flag==='--reset');
      console.log('Synthetic CASE-RJ-001 is available to '+unit+'.');
    }catch(error){console.error(error.message);process.exitCode=1;}
    finally{db.close();}
  }
}
