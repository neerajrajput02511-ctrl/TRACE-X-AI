import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
async function walk(dir = '') {
  const items = await fs.readdir(root + dir, { withFileTypes: true });
  const names = [];
  for (const item of items) {
    if (item.name === 'sw.js' || item.name === 'downloads' || item.name.startsWith('.')) continue;
    const name = dir + item.name;
    if (item.isDirectory()) names.push(...await walk(name + '/')); else names.push(name);
  }
  return names.sort();
}
const files = await walk();
const hash = createHash('sha256');
for(const file of files) hash.update(file).update(await fs.readFile(root + file));
const version = 'tracex-' + hash.digest('hex').slice(0,16);
const script = `const CACHE=${JSON.stringify(version)};
const ASSETS=${JSON.stringify(files)}.map(path=>new URL(path,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await cache.addAll(ASSETS);
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys()) if(key.startsWith('tracex-') && key!==CACHE) await caches.delete(key);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==location.origin) return;
 if(url.pathname.endsWith('/')) url.pathname+='index.html';
 url.hash='';url.search='';
 if(!ASSETS.includes(url.href)) return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);return (await cache.match(url.href))||fetch(req)})());
});\n`;
await fs.writeFile(root+'sw.js',script);
console.log('Offline app shell: '+ files.length +' files, '+version);
