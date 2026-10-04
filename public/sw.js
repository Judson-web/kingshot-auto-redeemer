const CACHE="kingshot-shell-v1";
const SHELL=["/","/manual"];

self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET")return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 if(event.request.mode==="navigate"){
  event.respondWith(fetch(event.request).catch(()=>caches.match("/manual").then(r=>r||caches.match("/"))));
  return;
 }
});
self.addEventListener("message",event=>{
 if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
});
