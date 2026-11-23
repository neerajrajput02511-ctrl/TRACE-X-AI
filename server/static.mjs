import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.zip':'application/zip','.apk':'application/vnd.android.package-archive','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.json':'application/json','.csv':'text/csv; charset=utf-8','.tsv':'text/tab-separated-values; charset=utf-8'};
export async function serveStatic(req,res,{team=false}={}) {
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});return res.end();}
  try {
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/') name='/index.html';
    if(name.includes('\\')||name.includes('\0')||name.split('/').some(part=>part.startsWith('.'))) throw new Error('Invalid route');
    const full=path.resolve(root,'.'+name);
    if(!full.startsWith(path.resolve(root)+path.sep)||!Object.hasOwn(types,path.extname(full))) throw new Error('Invalid route');
    const stat=await fs.stat(full);
    if(!stat.isFile()) throw new Error('Not a file');
    res.setHeader('Content-Type',types[path.extname(full)]);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control',team?'no-store':'no-cache');
    if(team) res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    if(team && name==='/sw.js') {res.writeHead(404);return res.end();}
    if(name.endsWith('.apk')) res.setHeader('Content-Disposition','attachment; filename="trace-x.apk"');
    if(req.method==='HEAD')return res.end();
    if(team && path.extname(full)==='.html') {
      const html=await fs.readFile(full,'utf8');
      return res.end(html.replace(/<head>/i,'<head><script src="./team-mode.js"></script>'));
    }
    await pipeline(createReadStream(full),res);
  } catch { if(!res.headersSent)res.writeHead(404);res.end(); }
}

