// Offline support: the app shell and data are network-first (so updates arrive), photos and map tiles are cache-first.
const SHELL = "km-shell-v7";
const MEDIA = "km-media-v1";
const CORE = [
  "./", "index.html", "css/app.css", "js/common.js", "js/app.js", "manifest.webmanifest", "icons/icon-192.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/markercluster/leaflet.markercluster.js",
  "vendor/markercluster/MarkerCluster.css", "vendor/markercluster/MarkerCluster.Default.css", "data/site.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => ![SHELL, MEDIA].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isMedia = (url) => url.pathname.includes("/photos/") || url.hostname.endsWith("arcgisonline.com");

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (isMedia(url)) {
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && url.pathname.includes("/photos/thumb/")) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })
    .then((hit) => hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});

self.addEventListener("message", (e) => {
  if (e.data?.type !== "save") return;
  const port = e.ports[0];
  const urls = e.data.urls;
  e.waitUntil((async () => {
    const c = await caches.open(MEDIA);
    let done = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try {
          if (!(await c.match(u, { ignoreSearch: true }))) {
            const res = await fetch(u, { mode: new URL(u, location.href).origin === location.origin ? "same-origin" : "cors" });
            if (!res.ok) throw new Error(res.status);
            await c.put(u, res);
          }
        } catch { failed++; }
        done++;
        if (done % 10 === 0 || done === urls.length) port.postMessage({ done, total: urls.length, failed, finished: done === urls.length });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    // also refresh the data bundle while online
    const shell = await caches.open(SHELL);
    for (const u of ["data/site.json", "data/bundle.json", "data/bundle.enc", "index.html"]) {
      try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) await shell.put(u, r); } catch { /* not present */ }
    }
  })());
});
