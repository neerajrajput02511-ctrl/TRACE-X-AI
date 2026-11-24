const CACHE="tracex-95ae29eef9a76fea";
const ASSETS=["case-store.js","case-tools.js","case-ui.js","case-views.js","console.css","console.html","console.js","crypto.js","device-report.js","engine.js","fonts/Barlow-LICENSE.txt","fonts/BarlowCondensed-LICENSE.txt","fonts/NotoSansDevanagari-LICENSE.txt","fonts/PlexMono-LICENSE.txt","fonts/body-semibold.ttf","fonts/body.ttf","fonts/display.ttf","fonts/hindi.ttf","fonts/mono.ttf","icon-192.png","icon-512.png","icon-mask.png","index.html","landing.js","local-evidence.js","login.html","login.js","manifest.webmanifest","mark.svg","query-router.js","register.js","report-layout.js","site.css","spatial.js","storage.js","team-mode.js","vendor/cytoscape-LICENSE.txt","vendor/cytoscape.js","vendor/fflate-LICENSE.txt","vendor/images/layers-2x.png","vendor/images/layers.png","vendor/images/marker-icon-2x.png","vendor/images/marker-icon.png","vendor/images/marker-shadow.png","vendor/leaflet-LICENSE.txt","vendor/leaflet.css","vendor/leaflet.js","vendor/pdfkit-LICENSE.txt","vendor/pdfkit.js","vendor/read-excel-file-LICENSE.txt","vendor/saxen-LICENSE.txt","vendor/workbook.js","workbook-layout.js"].map(path=>new URL(path,self.registration.scope).href);
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
 event.respondWith((async()=>{
   try{return await fetch(req,{cache:'no-cache'});}
   catch(error){
     const cached=await caches.match(url.href,{cacheName:CACHE});
     if(cached)return cached;
     throw error;
   }
 })());
});
