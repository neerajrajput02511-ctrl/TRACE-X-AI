import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
let count=0;
for(const dir of ['dist','server','scripts','tests']){
  for(const name of await fs.readdir(dir)){
    if(!/\.(?:m?js)$/.test(name))continue;
    const result=spawnSync(process.execPath,['--check',path.join(dir,name)],{stdio:'inherit'});
    if(result.status!==0)process.exit(result.status||1);
    count++;
  }
}
console.log('Syntax verified: '+count+' JavaScript modules.');
