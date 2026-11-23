import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {openDatabase,provisionAccount} from './team.mjs';

async function readPassword() {
  if(!process.stdin.isTTY) {
    let input='';
    for await(const chunk of process.stdin) {
      input+=chunk.toString('utf8');
      if(input.length>516)throw new Error('Password input exceeds 512 characters.');
    }
    return input.replace(/\r?\n$/,'');
  }
  process.stderr.write('Account password (hidden): ');
  const silent=new Writable({write(_chunk,_encoding,done){done();}});
  const rl=createInterface({input:process.stdin,output:silent,terminal:true,historySize:0});
  try{return await rl.question('');}finally{rl.close();process.stderr.write('\n');}
}
const [username,role,unit,...extra]=process.argv.slice(2);
if(!username||!role||!unit||extra.length){
  console.error('Usage: npm run user -- <username> <investigator|reviewer|admin> <unit>');
  process.exitCode=1;
}else{
  let db;
  try{
    const password=await readPassword();
    db=openDatabase();await provisionAccount(db,username,role,unit,password);
    console.log('Account configured for '+username+' ('+role+', '+unit+').');
  }catch(error){console.error(error.message);process.exitCode=1;}finally{db?.close();}
}

