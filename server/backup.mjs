import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const [target]=process.argv.slice(2);
if(!target){console.error('Usage: npm run backup -- <new backup directory>');process.exit(1);}
const file=path.resolve(process.env.TRACEX_DB||'.runtime/team.sqlite');
const vault=path.resolve(process.env.TRACEX_VAULT||file+'.vault');
const folder=path.resolve(target);
if(folder===vault || folder.startsWith(vault+path.sep))throw new Error('Choose a directory outside the current evidence vault.');
const source=new DatabaseSync(file,{readOnly:true});
try {
  await fs.mkdir(folder,{recursive:false,mode:0o700});
  await backup(source,path.join(folder,'team.sqlite'));
  try {await fs.cp(vault,path.join(folder,'team.sqlite.vault'),{recursive:true,errorOnExist:true,preserveTimestamps:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const saved=new DatabaseSync(path.join(folder,'team.sqlite'),{readOnly:true});
  try {
    const check=saved.prepare('PRAGMA integrity_check').all();
    if(check.some(row=>row.integrity_check!=='ok'))throw new Error('The backup did not pass SQLite integrity checks.');
    const hasManifest=saved.prepare("SELECT 1 FROM sqlite_master WHERE name='source_manifests'").get();
    if(hasManifest){
      for(const source of saved.prepare('SELECT DISTINCT sha256,length FROM source_manifests').iterate()){
        if(!/^[a-f0-9]{64}$/.test(source.sha256))throw new Error('Backup contains an invalid evidence fingerprint.');
        const object=await fs.readFile(path.join(folder,'team.sqlite.vault',source.sha256.slice(0,2),source.sha256));
        if(object.length!==source.length||createHash('sha256').update(object).digest('hex')!==source.sha256)throw new Error('A backed-up original failed its integrity check.');
      }
    }
  } finally {saved.close();}
  console.log('Backup verified at '+folder);
} finally {source.close();}
