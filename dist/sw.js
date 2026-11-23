const CACHE="tracex-4fa66827c09cdd53";
const ASSETS=["case-store.js","case-ui.js","case-views.js","console.css","console.html","console.js","engine.js","fonts/Barlow-LICENSE.txt","fonts/BarlowCondensed-LICENSE.txt","fonts/PlexMono-LICENSE.txt","fonts/body-semibold.ttf","fonts/body.ttf","fonts/display.ttf","fonts/mono.ttf","icon-192.png","icon-512.png","icon-mask.png","index.html","landing.js","login.html","login.js","manifest.webmanifest","mark.svg","query-router.js","register.js","site.css","storage.js","team-mode.js"].map(path=>new URL(path,self.registration.scope).href);
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
});
