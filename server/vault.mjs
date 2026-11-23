import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function originalBytes(file) {
  return file.originalBase64 != null ? Buffer.from(file.originalBase64,'base64') : Buffer.from(file.raw,'utf8');
}

export function vaultDirectory(db) {
  const filename=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
  return filename ? path.resolve(process.env.TRACEX_VAULT||filename+'.vault') : null;
}

function address(db,key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid vault key.');
  const root=vaultDirectory(db);
  return root && path.join(root,key.slice(0,2),key);
}

export function storeOriginals(db,files) {
  for (const file of files) {
    const target=address(db,file.sha256);
    const bytes=originalBytes(file);
    if (hash(bytes)!==file.sha256) throw new Error('Source bytes do not match the evidence fingerprint.');
    if (!target) continue;
    if (fs.existsSync(target)) {
      if (hash(fs.readFileSync(target))!==file.sha256) throw new Error('An existing evidence object failed integrity verification.');
      continue;
    }
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    const temp=target+'.'+randomUUID()+'.tmp';
    try {
      fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600,flush:true});
      try {fs.linkSync(temp,target);} catch(error) {
        if (error.code!=='EEXIST' || hash(fs.readFileSync(target))!==file.sha256) throw error;
      }
    } finally {fs.rmSync(temp,{force:true});}
  }
}

export function fetchOriginal(db,file) {
  const target=address(db,file.sha256);
  let bytes;
  try {bytes=target ? fs.readFileSync(target) : originalBytes(file);}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  const actual=bytes ? hash(bytes) : null;
  const ok=actual===file.sha256;
  return {ok,expected:file.sha256,actual,bytes:ok?bytes:null};
}
