import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('../dist/', import.meta.url));
if (!process.argv[2]) throw new Error('Pass a Vercel-linked staging directory.');
const staging = path.resolve(process.argv[2]);
const linked = JSON.parse(await fs.readFile(path.join(staging,'.vercel','project.json'),'utf8'));
if (linked.projectName !== 'trace-x-ai-shyne') throw new Error('Link this staging directory to trace-x-ai-shyne.');
const target = path.join(staging,'.vercel','output');
await fs.mkdir(target);

const extensions = new Set(['.html','.css','.js','.txt','.ttf','.svg','.png','.webmanifest','.zip','.apk','.csv','.tsv']);
async function publishFiles(from, to) {
  await fs.mkdir(to);
  for (const entry of await fs.readdir(from,{withFileTypes:true})) {
    const input = path.join(from,entry.name);
    const output = path.join(to,entry.name);
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error('Unexpected deployment member: '+entry.name);
    if (entry.isDirectory()) await publishFiles(input,output);
    else {
      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) throw new Error('Unexpected deployment member: '+entry.name);
      await fs.copyFile(input,output);
    }
  }
}
await publishFiles(source,path.join(target,'static'));
const rules = {
  version:3,
  routes:[
    {src:'/sw\\.js', headers:{'Cache-Control':'no-cache, max-age=0','Service-Worker-Allowed':'/'}, continue:true},
    {src:'/downloads/trace-x\\.apk', headers:{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="trace-x.apk"'}, continue:true},
    {src:'/downloads/jaipur-synthetic-case\\.zip', headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="jaipur-synthetic-case.zip"'}, continue:true},
    {src:'/.*', headers:{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()'}, continue:true},
    {src:'/$', dest:'/index.html'},
    {handle:'filesystem'}
  ]
};
await fs.writeFile(path.join(target,'config.json'),JSON.stringify(rules,null,2)+'\n');
console.log('Prepared the standalone demo for production deployment.');
