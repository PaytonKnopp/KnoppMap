// Offline support: the app shell and data are network-first (so updates arrive), photos and map tiles are cache-first.
const SHELL = "km-shell-v29";
const MEDIA = "km-media-v1";
const CORE = [
  "./", "index.html", "css/app.css", "js/common.js", "js/app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-180.png", "icons/icon-32.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/markercluster/leaflet.markercluster.js",
  "vendor/markercluster/MarkerCluster.css", "vendor/markercluster/MarkerCluster.Default.css", "data/site.json",
];

// The app and the data it opens with (site.json and the bundle it names), fetched fresh and stored all or nothing.
// An update stores them before the old copy is thrown away, so a device that saved the map never ends up with the new
// app but no data; if anything can't be fetched, the update waits and the old copy stays.
async function saveShell() {
  const fresh = (u) => new Request(u, { cache: "no-cache" });
  const meta = await fetch(fresh("data/site.json")).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const c = await caches.open(SHELL);
  await c.addAll([...CORE, meta.locked ? "data/bundle.enc" : "data/bundle.json"].map(fresh));
}

self.addEventListener("install", (e) => {
  e.waitUntil(saveShell().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => ![SHELL, MEDIA].includes(k)).map((k) => caches.delete(k)));
    // The page request starts while this worker is still waking up, instead of after.
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

const isMedia = (url) => url.pathname.includes("/photos/") || url.hostname.endsWith("arcgisonline.com");
// Shell files are stored under their plain address (no ?v=…), so there is one copy of each and offline gets the newest.
const shellKey = (url) => url.origin + url.pathname;

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (isMedia(url)) {
    // Looked up by exact address: ignoring the "?…" part makes the browser scan every saved tile and photo each time.
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(e.request, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok && url.pathname.includes("/photos/thumb/")) e.waitUntil(c.put(e.request, res.clone()));
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      // "no-cache" checks with the server every time (a quick "not modified" when nothing changed), so after an update
      // the page never pairs a new index.html with a stylesheet or script the browser kept from before.
      const res = e.request.mode === "navigate" ? (await e.preloadResponse) || (await fetch(e.request)) : await fetch(e.request, { cache: "no-cache" });
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(SHELL).then((c) => c.put(shellKey(url), copy))); }
      return res;
    } catch {
      return (await caches.match(shellKey(url))) || (e.request.mode === "navigate" ? (await caches.match("index.html")) || Response.error() : Response.error());
    }
  })());
});

self.addEventListener("message", (e) => {
  const port = e.ports[0];
  // The page saves the photos and map tiles itself; it asks here for a fresh copy of the app and its data, and hears
  // back once they are stored.
  if (e.data?.type === "shell") {
    e.waitUntil(saveShell().then(() => true, () => false).then((ok) => port?.postMessage({ ok })));
    return;
  }
  // A page still running the previous app.js hands the whole download to the worker instead.
  if (e.data?.type !== "save") return;
  const urls = e.data.urls;
  e.waitUntil((async () => {
    const c = await caches.open(MEDIA);
    let done = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try {
          if (!(await c.match(u, { ignoreVary: true }))) {
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
