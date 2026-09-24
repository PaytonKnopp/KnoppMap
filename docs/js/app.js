(() => {
  "use strict";
  const { icon, esc, fmtDate, store, loadBundle, photoUrl } = KM;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // An upright phone: panels come up from the bottom. A phone turned sideways, however narrow, gets the side panel
  // instead (the same split as the media queries in app.css).
  const isPhone = () => window.matchMedia("(max-width: 700px) and (min-height: 501px), (max-width: 700px) and (orientation: portrait)").matches;

  // Zoom levels at which things appear.
  const Z = { farmPin: 14.5, trails: 13.5, places: 14.5, sites: 10, photos: 16.75, minorPlaces: 17, roadLabels: 16, trailLabels: 17 };

  // ================================================================ small helpers
  let toastTimer;
  function toast(msg, ms = 3500) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function distM(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const r = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  // Moving focus into a photo or dialog shows the focus ring only to people using the keyboard, not after a tap
  // (the CSS hides rings while data-input is "pointer"; focusVisible does the same where browsers support it).
  const inputKind = (kind) => () => { if (document.documentElement.dataset.input !== kind) document.documentElement.dataset.input = kind; };
  document.addEventListener("keydown", inputKind("keys"), true);
  document.addEventListener("pointerdown", inputKind("pointer"), true);
  const focusQuietly = (el) => el?.focus({ focusVisible: document.documentElement.dataset.input === "keys" });
  // Tab stays inside an open photo or dialog instead of wandering to the buttons hidden behind it.
  document.addEventListener("keydown", (e) => {
    const box = e.key === "Tab" && $("#load-error:not([hidden]), #lock:not([hidden]), .overlay:not([hidden]), #lightbox:not([hidden])");
    if (!box) return;
    const items = $$("button, input, a[href]", box).filter((el) => !el.disabled && el.getClientRects().length);
    if (!items.length) return;
    const inside = box.contains(document.activeElement), first = items[0], last = items[items.length - 1];
    if (!inside || document.activeElement === (e.shiftKey ? first : last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  });
  const compassShort = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  const compass = (deg) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];

  // ================================================================ text size
  // Phones (and short landscape screens) start on Small so the panels leave room for the map; computers start on Normal.
  // Only a size someone picks is remembered. (The old "size" key was saved on every visit, so it can't tell a choice
  // from the default and is dropped.)
  const SIZES = [16, 18, 21];
  const smallMQ = window.matchMedia("(max-width: 700px), (max-height: 500px)");
  const smallScreen = smallMQ.matches;
  store.set("size", null);
  let sizeIdx = Math.min(2, store.get("textSize", smallScreen ? 0 : 1));
  function applySize() {
    document.documentElement.style.fontSize = SIZES[sizeIdx] + "px";
    document.documentElement.dataset.size = sizeIdx;
    setTimeout(declutter, 50);
  }
  const SIZE_NAMES = ["Small", "Normal", "Large"];
  applySize();

  // ================================================================ map
  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 90, maxZoom: 22, minZoom: 5 });
  L.control.zoom({ position: "topright", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);
  let scaleCtl = L.control.scale({ position: "bottomright", imperial: false }).addTo(map);
  // An antique compass rose: brass ring, aged parchment face, 16-point rose with shaded halves and a fleur-de-lis for north.
  // Each copy gets its own gradient ids (the map and the printed poster both show one).
  let compassCount = 0;
  function compassSvg() {
    const u = "cmp" + ++compassCount, ink = "#2e2014", light = "#f6ebcb";
    const at = (deg, r) => { const a = (deg * Math.PI) / 180; return `${(60 + r * Math.sin(a)).toFixed(2)},${(60 - r * Math.cos(a)).toFixed(2)}`; };
    const spike = (deg, len, side, spread, dark, pale) =>
      `<path d="M60,60L${at(deg, len)}L${at(deg - spread, side)}Z" fill="${dark}"/><path d="M60,60L${at(deg, len)}L${at(deg + spread, side)}Z" fill="${pale}"/>`;
    let rose = "";
    for (let k = 0; k < 8; k++) rose += spike(22.5 + k * 45, 25, 5, 22.5, ink, light);
    for (let k = 0; k < 4; k++) rose += spike(45 + k * 90, 31, 7.5, 45, ink, light);
    for (let k = 0; k < 4; k++) rose += k ? spike(k * 90, 38, 8.5, 45, ink, light) : spike(0, 38, 8.5, 45, "#7a1414", "#c0392b");
    let ticks = "";
    for (let d = 0; d < 360; d += 5) ticks += `<line x1="${at(d, 53).split(",")[0]}" y1="${at(d, 53).split(",")[1]}" x2="${at(d, d % 30 ? (d % 10 ? 51.4 : 50.2) : 48.6).split(",")[0]}" y2="${at(d, d % 30 ? (d % 10 ? 51.4 : 50.2) : 48.6).split(",")[1]}"/>`;
    const letter = (deg, s) => { const [x, y] = at(deg, 44.3).split(","); return `<text x="${x}" y="${y}">${s}</text>`; };
    return `<svg viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="${u}p" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fcf3da"/><stop offset=".65" stop-color="#eed9a6"/><stop offset="1" stop-color="#d4b377"/></radialGradient>
        <linearGradient id="${u}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6e4a14"/><stop offset=".28" stop-color="#e9c872"/>
          <stop offset=".52" stop-color="#a0722a"/><stop offset=".76" stop-color="#f4dc94"/><stop offset="1" stop-color="#5e3f10"/></linearGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#${u}b)" stroke="${ink}" stroke-width="1.4"/>
      <circle cx="60" cy="60" r="55.4" fill="none" stroke="#fff3cf" stroke-opacity=".55" stroke-width=".8"/>
      <circle cx="60" cy="60" r="53.2" fill="url(#${u}p)" stroke="${ink}" stroke-width="1.2"/>
      <g stroke="${ink}" stroke-width=".7" stroke-linecap="round">${ticks}</g>
      <circle cx="60" cy="60" r="39.6" fill="none" stroke="${ink}" stroke-width=".9"/><circle cx="60" cy="60" r="38.2" fill="none" stroke="${ink}" stroke-width=".4"/>
      <g font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="11.5" fill="${ink}" text-anchor="middle" dominant-baseline="central">
        ${letter(90, "E")}${letter(180, "S")}${letter(270, "W")}</g>
      <path transform="translate(60 15.2)" fill="#7a1414" d="M0-7.2C3.2-4 3.1 0 0 3 -3.1 0 -3.2-4 0-7.2ZM1.2 2.2C3.8-3.4 8.6-2.4 7.4 2 6.4-.3 4.2-.2 3.2 3ZM-1.2 2.2C-3.8-3.4-8.6-2.4-7.4 2-6.4-.3-4.2-.2-3.2 3ZM-4.4 2.7h8.8v1.7h-8.8ZM-2.2 4.4h4.4L0 7.4Z"/>
      <g class="c-rose"><g stroke="${ink}" stroke-width=".5" stroke-linejoin="round">${rose}</g>
        <circle cx="60" cy="60" r="5" fill="url(#${u}b)" stroke="${ink}" stroke-width=".8"/><circle cx="60" cy="60" r="1.5" fill="${ink}"/></g>
    </svg>`;
  }
  const Compass = L.Control.extend({ options: { position: "bottomright" },
    onAdd() {
      const d = L.DomUtil.create("div", "map-compass");
      d.title = "North is always at the top";
      d.setAttribute("role", "img");
      d.setAttribute("aria-label", "Compass: north is at the top of the map");
      d.innerHTML = compassSvg();
      L.DomEvent.disableClickPropagation(d);
      d.addEventListener("click", () => { d.classList.remove("spin"); void d.offsetWidth; d.classList.add("spin"); toast("🧭 North is always at the top of this map", 2000); });
      return d;
    } });
  const compassCtl = new Compass().addTo(map);
  window.kmMap = map;
  map.createPane("hill").style.zIndex = 240;
  map.createPane("radar").style.zIndex = 380;
  map.createPane("boundary").style.zIndex = 390;
  map.createPane("casing").style.zIndex = 395;
  map.createPane("trails").style.zIndex = 400;

  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const CARTO = "https://{s}.basemaps.cartocdn.com/";
  // Tiles keep old imagery on screen while zooming instead of flashing grey, and don't fetch mid-animation.
  const TILE_OPTS = { maxZoom: 22, updateWhenZooming: false, updateWhenIdle: L.Browser.mobile, keepBuffer: 4 };
  // Between whole zoom levels the tiles are scaled, and the browser leaves hairline lines between them. Base map tiles
  // are drawn one pixel larger so they overlap, and app.css turns off Leaflet's additive blending for them. (Not the
  // see-through radar or hill tiles: an overlap would show there.)
  const initTile = L.GridLayer.prototype._initTile;
  L.GridLayer.include({ _initTile(tile) {
    initTile.call(this, tile);
    if (this.options.pane !== "tilePane") return;
    const s = this.getTileSize();
    tile.style.width = s.x + 1 + "px";
    tile.style.height = s.y + 1 + "px";
  } });
  let madeKeys = null;   // which Esri services the map style being built uses (see setBase)
  const esriLayer = (svc, key, attribution, extra = {}) => {
    madeKeys?.add(key);
    return L.tileLayer(ESRI + svc + "/MapServer/tile/{z}/{y}/{x}", { ...TILE_OPTS, maxNativeZoom: nativeZoom(key), attribution, ...extra });
  };
  const IMG_ATTR = "Imagery © Esri, Maxar, Earthstar Geographics";
  const OSM_ATTR = "© OpenStreetMap contributors";
  const img = () => esriLayer("World_Imagery", "img", IMG_ATTR);
  const hills = (opacity = 0.6) => esriLayer("Elevation/World_Hillshade", "hill", "Hillshade © Esri", { pane: "hill", opacity });
  const openTopo = () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    { ...TILE_OPTS, maxNativeZoom: 17, attribution: OSM_ATTR + ", SRTM | OpenTopoMap" });
  const canvas = (tone) => L.layerGroup([
    L.tileLayer(`${ESRI}Canvas/World_${tone}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { ...TILE_OPTS, maxNativeZoom: 16, attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors" }),
    L.tileLayer(`${ESRI}Canvas/World_${tone}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { ...TILE_OPTS, maxNativeZoom: 16 })]);
  const BASEMAPS = {
    themed: { label: "Match the look", swatch: "linear-gradient(135deg,#3f5b33 50%,#d8c08f 50%)", filter: "theme", make: img },
    satellite: { label: "Satellite", swatch: "#3f5b33", make: img },
    hybrid: { label: "Satellite + roads", swatch: "#4a6a3c", make: () => L.layerGroup([img(),
      esriLayer("Reference/World_Transportation", "ref", ""), esriLayer("Reference/World_Boundaries_and_Places", "ref", "")]) },
    sathills: { label: "Satellite + hills", swatch: "#566b45", make: () => L.layerGroup([img(), hills(0.45)]) },
    hillshade: { label: "Hills & valleys", swatch: "linear-gradient(135deg,#e8e2cf,#9c9480)", filter: "relief", make: () => L.layerGroup([openTopo(), hills(0.75)]) },
    topo: { label: "Topographic", swatch: "#d9d2b0", make: openTopo },
    esritopo: { label: "Detailed topo", swatch: "#e8e4d0", make: () => esriLayer("World_Topo_Map", "topo", "Esri, HERE, Garmin, USGS") },
    street: { label: "Street map", swatch: "#f2efe9", make: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { ...TILE_OPTS, maxNativeZoom: 19, attribution: OSM_ATTR }) },
    light: { label: "Light canvas", swatch: "#e9e9e7", make: () => canvas("Light") },
    dark: { label: "Dark canvas", swatch: "#2b2d30", make: () => canvas("Dark") },
    bw: { label: "Black & white", swatch: "#8a8a8a", filter: "bw", make: img },
    parchment: { label: "Old parchment", swatch: "#d8c08f", filter: "parchment", make: img },
    drawn: { label: "Hand-drawn map", swatch: "#e3cf9d", filter: "drawn", make: openTopo },
    blueprint: { label: "Blueprint", swatch: "#1d4f86", filter: "blueprint", make: img },
    nightsat: { label: "Satellite at night", swatch: "#1a2433", filter: "nightsat", make: img },
    infrared: { label: "Infrared", swatch: "#b8325a", filter: "infrared", make: img },
    thermal: { label: "Heat vision", swatch: "linear-gradient(135deg,#2b0a57,#e8430c,#ffe45c)", filter: "thermal", make: img },
    sketch: { label: "Pencil sketch", swatch: "#e9e6df", filter: "sketch", make: img },
    cyclosm: { label: "Trails & paths", swatch: "#e4ecd9", make: () => L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
      { ...TILE_OPTS, maxNativeZoom: 20, attribution: OSM_ATTR + " · CyclOSM" }) },
    humanitarian: { label: "Bold & simple", swatch: "#f3e1cf", make: () => L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      { ...TILE_OPTS, maxNativeZoom: 20, attribution: OSM_ATTR + " · Humanitarian OSM" }) },
  };
  // Styles that need a free account/key; they appear once a key is set in config/site.json.
  function addKeyedStyles(keys = {}) {
    const mt = keys.maptiler, tf = keys.thunderforest;
    const mtl = (id, label, sw, ext = "png") => ({ label, swatch: sw, make: () => L.tileLayer(`https://api.maptiler.com/maps/${id}/256/{z}/{x}/{y}.${ext}?key=${mt}`,
      { ...TILE_OPTS, maxNativeZoom: 20, attribution: "© MapTiler © OpenStreetMap contributors" }) });
    if (mt) Object.assign(BASEMAPS, {
      mt_outdoor: mtl("outdoor-v2", "Outdoor (MapTiler)", "#dfe8d0"), mt_winter: mtl("winter-v2", "Winter (MapTiler)", "#eef4fa"),
      mt_topo: mtl("topo-v2", "Topo (MapTiler)", "#e6e2cf"), mt_dataviz_dark: mtl("dataviz-dark", "Dark minimal (MapTiler)", "#22262b"),
      mt_hybrid: mtl("hybrid", "HD satellite (MapTiler)", "#34502c", "jpg"),
    });
    if (keys.stadia) {
      const st = (id, label, sw, ext = "png", z = 20) => ({ label, swatch: sw, make: () => L.tileLayer(`https://tiles.stadiamaps.com/tiles/${id}/{z}/{x}/{y}.${ext}`,
        { ...TILE_OPTS, maxNativeZoom: z, attribution: "© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap contributors" }) });
      Object.assign(BASEMAPS, {
        st_watercolor: st("stamen_watercolor", "Watercolour painting", "#e9d9b8", "jpg", 16), st_toner: st("stamen_toner", "Newsprint (toner)", "#111"),
        st_terrain: st("stamen_terrain", "Terrain", "#cfd9b5"), st_dark: st("alidade_smooth_dark", "Smooth dark", "#262a2e"),
        st_light: st("alidade_smooth", "Smooth light", "#f3f3f1"),
      });
    }
    if (tf) {
      const t = (id, label, sw) => ({ label, swatch: sw, make: () => L.tileLayer(`https://{s}.tile.thunderforest.com/${id}/{z}/{x}/{y}.png?apikey=${tf}`,
        { ...TILE_OPTS, maxNativeZoom: 20, attribution: "Maps © Thunderforest © OpenStreetMap contributors" }) });
      Object.assign(BASEMAPS, { tf_outdoors: t("outdoors", "Outdoors (Thunderforest)", "#dbe6c8"), tf_landscape: t("landscape", "Landscape (Thunderforest)", "#d4e2b8"),
        tf_pioneer: t("pioneer", "Pioneer 1800s (Thunderforest)", "#e2cfa3") });
    }
  }

  // ---- how deep the real imagery goes here (Esri shows a grey "Map data not yet available" tile beyond it)
  const PROBE = { img: "World_Imagery", topo: "World_Topo_Map", ref: "Reference/World_Transportation", hill: "Elevation/World_Hillshade" };
  const FLAT_OK = new Set(["hill"]);   // naturally grey, so only a missing tile counts
  const native = store.get("nativeZoom", {});
  const probeFresh = (key) => native[key] && Date.now() - native[key].at < 7 * 864e5;
  function nativeZoom(key) {
    const n = native[key];
    return n && n.z ? n.z : { hill: 15 }[key] || 17;
  }
  function probeTile(svc, z, lat, lng, flatOk = false) {
    const n = 2 ** z;
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2 * n);
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          // The placeholder tile is almost entirely flat grey.
          const c = document.createElement("canvas");
          c.width = c.height = 32;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0, 32, 32);
          const d = g.getImageData(0, 0, 32, 32).data;
          let grey = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (Math.abs(d[i] - d[i + 1]) < 6 && Math.abs(d[i + 1] - d[i + 2]) < 6 && d[i] > 190 && d[i] < 225) grey++;
          }
          resolve(flatOk || grey / 1024 < 0.6);
        } catch { resolve(true); }
      };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.src = `${ESRI}${svc}/MapServer/tile/${z}/${y}/${x}?blankTile=false`;
    });
  }
  // Only the services the current map style uses are checked (at most weekly), and only once the tiles on screen
  // have finished loading, so the check never competes with them on a slow connection.
  let probing = false;
  async function probeImagery(keys) {
    const todo = [...keys].filter((k) => PROBE[k] && !probeFresh(k));
    if (!todo.length || probing || !farmBounds || !navigator.onLine) return;
    probing = true;
    try {
      await tilesSettled(8000);
      await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 2000 }) : setTimeout(r, 200)));
      await probeKeys(todo);
    } finally { probing = false; }
  }
  async function probeKeys(keys) {
    const b = farmBounds;
    const pts = [b.getCenter(), b.getNorthWest(), b.getNorthEast(), b.getSouthWest(), b.getSouthEast()];
    let changed = false;
    // If even a low-zoom tile can't be read (offline, or no CORS), don't guess.
    if (!(await probeTile("World_Imagery", 12, pts[0].lat, pts[0].lng))) return;
    for (const key of keys) {
      const svc = PROBE[key], old = native[key];
      let found = null;
      for (let z = 20; z >= 12; z--) {
        const res = await Promise.all(pts.map((p) => probeTile(svc, z, p.lat, p.lng, FLAT_OK.has(key))));
        if (res.some((r) => r === null)) { found = undefined; break; }   // network trouble: try again next visit
        if (res.every(Boolean)) { found = z; break; }
      }
      if (found === undefined) continue;
      native[key] = { z: found ?? 12, at: Date.now() };
      changed = changed || !old || old.z !== native[key].z;
    }
    store.set("nativeZoom", native);
    if (changed) setBase(baseKey);
  }

  // ---- map style filters and texture overlay (parchment, blueprint)
  map.createPane("texture").style.zIndex = 250;
  const texture = L.DomUtil.create("div", "map-texture", map.getPane("texture"));
  const placeTexture = () => {
    if (!map.getContainer().dataset.texture) return;   // runs on every frame of a pan, so skip it when unused
    const s = map.getSize();
    texture.style.width = s.x + "px";
    texture.style.height = s.y + "px";
    L.DomUtil.setPosition(texture, map.containerPointToLayerPoint([0, 0]));
  };
  map.on("move zoomend viewreset resize", placeTexture);

  // Every visit starts from the normal look; nothing below is remembered between visits.
  let baseKey = null;
  let baseLayer = null;
  let baseKeys = new Set();
  let dim = 100;
  function applyMapLook() {
    const el = map.getContainer();
    const m = BASEMAPS[baseKey];
    const t = THEMES[theme];
    // A look with no tint (Farmhouse) gets no CSS filter at all: even a do-nothing filter makes the browser
    // redraw the whole map through an extra layer on every frame of a pan or zoom.
    el.dataset.filter = m?.filter === "theme" && !t.mapFilter ? "" : m?.filter || "";
    el.dataset.texture = m?.filter === "theme" ? t.texture || "" : m?.filter || "";
    el.style.setProperty("--theme-filter", t.mapFilter || "none");
    el.style.setProperty("--dim", dim / 100);
    if (dim < 100) el.dataset.dim = ""; else delete el.dataset.dim;
    placeTexture();
  }
  function setBase(k) {
    if (!BASEMAPS[k]) k = "themed";
    if (baseLayer) map.removeLayer(baseLayer);
    madeKeys = new Set();
    baseLayer = BASEMAPS[k].make().addTo(map);
    baseKeys = madeKeys;
    madeKeys = null;
    baseKey = k;
    applyMapLook();
    probeImagery(baseKeys);
  }

  // ================================================================ themes (looks)
  // mapFilter tints the satellite photo under the "Match the look" map style (none: the photo as it is); texture adds an overlay.
  const THEMES = {
    farmhouse: { label: "Farmhouse", note: "Warm cream and green on real satellite", sw: ["#fbf8f1", "#2f5d3a", "#f2c200"],
      lines: { trail: "#fff3c4", trailCase: "#10140e", road: "#eadcbc", roadCase: "#2b2418", sel: "#f2c200", caseOp: 0.6 } },
    middleearth: { label: "Middle-earth", note: "Old parchment and ink, like a fantasy map", sw: ["#f1e2bd", "#6b3e1f", "#9c2f1c"],
      mapFilter: "grayscale(1) sepia(0.95) saturate(0.85) contrast(1.15) brightness(1.08)", texture: "parchment",
      font: "GFONTCinzel:wght@600;700&family=Alegreya:wght@400;700&display=swap",
      lines: { trail: "#3d220b", trailCase: "#f3e3bd", road: "#5a3316", roadCase: "#f3e3bd", sel: "#9c2f1c", caseOp: 0.8, dash: "7 5", boundary: "#7a1f12" } },
    night: { label: "Night sky", note: "Moonlit satellite, dark and easy on the eyes", sw: ["#1c2126", "#3fb68b", "#ffcc4d"],
      mapFilter: "saturate(0.35) brightness(0.5) contrast(1.2) sepia(0.25) hue-rotate(180deg)", texture: "night",
      lines: { trail: "#8fe3ff", trailCase: "#05080a", road: "#dfe6ea", roadCase: "#05080a", sel: "#ffcc4d", caseOp: 0.85, boundary: "#ffcc4d" } },
    prairie: { label: "Prairie sky", note: "Bright, vivid and modern", sw: ["#ffffff", "#1f6feb", "#ff9f1c"],
      mapFilter: "saturate(1.3) brightness(1.08) contrast(1.06)",
      lines: { trail: "#ffffff", trailCase: "#1f6feb", road: "#ffe8b3", roadCase: "#7a4b00", sel: "#ff9f1c", caseOp: 0.85 } },
    blueprint: { label: "Blueprint", note: "Surveyor's drafting table", sw: ["#0f2a4a", "#4aa3ff", "#ffd166"],
      mapFilter: "grayscale(1) invert(0.9) sepia(1) hue-rotate(175deg) saturate(3) brightness(0.8) contrast(1.3)", texture: "blueprint",
      lines: { trail: "#e6f0ff", trailCase: "#0b2140", road: "#ffffff", roadCase: "#0b2140", sel: "#ffd166", caseOp: 0.7, dash: "2 6", boundary: "#ffd166" } },
    maninblack: { label: "The Man in Black", note: "Johnny Cash: black, white and a little red", sw: ["#0d0d0d", "#f4f1ea", "#b3121b"],
      mapFilter: "grayscale(1) contrast(1.5) brightness(0.78)", texture: "grain",
      font: "GFONTRye&family=Special+Elite&display=swap",
      lines: { trail: "#f4f1ea", trailCase: "#000000", road: "#c9c3b6", roadCase: "#000000", sel: "#e0141e", caseOp: 0.85, boundary: "#e0141e" } },
    interstellar: { label: "Interstellar", note: "Dusty cornfields under a deep-space sky", sw: ["#0b1320", "#e0a458", "#8fb8de"],
      mapFilter: "sepia(0.7) saturate(1.5) hue-rotate(-12deg) contrast(1.08) brightness(0.9)", texture: "dust",
      font: "GFONTExo+2:wght@400;600;800&display=swap",
      lines: { trail: "#ffe2b0", trailCase: "#1a0f05", road: "#f3d9a9", roadCase: "#1a0f05", sel: "#8fd3ff", caseOp: 0.75, boundary: "#8fb8de" } },
    oppenheimer: { label: "Oppenheimer", note: "Black-and-white film with fire on the horizon", sw: ["#0a0a0a", "#ff6a13", "#f3e9dc"],
      mapFilter: "grayscale(1) contrast(1.35) brightness(0.82)", texture: "fire",
      font: "GFONTBebas+Neue&family=Libre+Baskerville:wght@400;700&display=swap",
      lines: { trail: "#ffd9b8", trailCase: "#0a0a0a", road: "#f3e9dc", roadCase: "#0a0a0a", sel: "#ff6a13", caseOp: 0.85, boundary: "#ff6a13" } },
    winter: { label: "First snow", note: "Frosty whites and icy blues", sw: ["#f4f8fc", "#2f6f9f", "#9fd3f2"],
      mapFilter: "grayscale(0.7) brightness(1.25) contrast(1.05) sepia(0.2) hue-rotate(165deg) saturate(1.3)", texture: "frost",
      lines: { trail: "#1f4e79", trailCase: "#ffffff", road: "#6b7f90", roadCase: "#ffffff", sel: "#e63946", caseOp: 0.85, boundary: "#1f4e79" } },
    synthwave: { label: "Synthwave", note: "Neon pink and cyan, straight out of the '80s", sw: ["#1a0b2e", "#ff2bd6", "#2de2e6"],
      mapFilter: "grayscale(1) contrast(1.25) brightness(0.55)", texture: "synth",
      font: "GFONTAudiowide&display=swap",
      lines: { trail: "#2de2e6", trailCase: "#1a0b2e", road: "#ff2bd6", roadCase: "#1a0b2e", sel: "#fff36b", caseOp: 0.9, boundary: "#ff2bd6" } },
    aurora: { label: "Northern lights", note: "Green and violet glow over a dark prairie night", sw: ["#0b1422", "#38f2a4", "#b57bff"],
      mapFilter: "saturate(0.4) brightness(0.45) contrast(1.2) hue-rotate(150deg)", texture: "aurora",
      lines: { trail: "#9dffd4", trailCase: "#02060c", road: "#e0d4ff", roadCase: "#02060c", sel: "#ffe36b", caseOp: 0.85, boundary: "#b57bff" } },
    western: { label: "Wild West", note: "Wanted-poster tan with saddle-leather brown", sw: ["#f0dcb4", "#7a3b12", "#c8892e"],
      mapFilter: "sepia(0.75) saturate(1.2) contrast(1.15) brightness(1.02)", texture: "parchment",
      font: "GFONTRye&family=Crimson+Pro:wght@400;700&display=swap",
      lines: { trail: "#fff1d0", trailCase: "#3b1a06", road: "#e5c38c", roadCase: "#3b1a06", sel: "#d9261c", caseOp: 0.8, boundary: "#7a3b12" } },
    parks: { label: "National Park poster", note: "Vintage park-poster teal, orange and cream", sw: ["#f4ecd6", "#1d5c5a", "#e2733a"],
      mapFilter: "saturate(0.8) contrast(1.2) brightness(1.02) sepia(0.25)", texture: "warm",
      font: "GFONTAbril+Fatface&family=Source+Sans+3:wght@400;700&display=swap",
      lines: { trail: "#fff4d6", trailCase: "#1d3b3a", road: "#f2c48d", roadCase: "#1d3b3a", sel: "#e2733a", caseOp: 0.8, boundary: "#e2733a" } },
    camo: { label: "Field ops", note: "Olive drab military topo with stencil lettering", sw: ["#2f3522", "#8a9a5b", "#d9c27a"],
      mapFilter: "grayscale(0.6) sepia(0.5) hue-rotate(35deg) saturate(1.1) contrast(1.15) brightness(0.8)", texture: "grain",
      font: "GFONTBlack+Ops+One&family=Roboto+Mono:wght@400;700&display=swap",
      lines: { trail: "#e8e0b0", trailCase: "#1b1f12", road: "#c9b778", roadCase: "#1b1f12", sel: "#ff7a1a", caseOp: 0.85, dash: "10 4", boundary: "#d9c27a" } },
    maple: { label: "True North", note: "Canadian red and white", sw: ["#ffffff", "#d52b1e", "#1f1f1f"],
      mapFilter: "saturate(1.05) contrast(1.05)",
      lines: { trail: "#ffffff", trailCase: "#b3160c", road: "#ffd9d4", roadCase: "#6b0c05", sel: "#ffd400", caseOp: 0.85, boundary: "#d52b1e" } },
    lumberjack: { label: "Lumberjack", note: "Buffalo plaid, pine and flannel", sw: ["#1c1c1c", "#b3261e", "#e8dcc2"],
      mapFilter: "saturate(0.9) contrast(1.1) brightness(0.9)", texture: "grain",
      font: "GFONTOswald:wght@500;700&display=swap",
      lines: { trail: "#f1e6cc", trailCase: "#3a0e0b", road: "#e0a98f", roadCase: "#1c1c1c", sel: "#ffcf40", caseOp: 0.8, boundary: "#b3261e" } },
    sunset: { label: "Golden hour", note: "Warm pinks and oranges of a prairie sunset", sw: ["#fff1e8", "#d9486b", "#ffa45c"],
      mapFilter: "sepia(0.3) saturate(1.5) hue-rotate(-20deg) brightness(1.02) contrast(1.05)", texture: "sunset",
      lines: { trail: "#fff6e0", trailCase: "#5a1330", road: "#ffd2a8", roadCase: "#5a1330", sel: "#ffe14d", caseOp: 0.75, boundary: "#d9486b" } },
    forest: { label: "Deep woods", note: "Mossy greens and bark browns", sw: ["#eef2e6", "#2f4f2f", "#a8c66c"],
      mapFilter: "saturate(1.25) hue-rotate(10deg) contrast(1.08) brightness(0.92)",
      lines: { trail: "#f3f0c8", trailCase: "#1a2a14", road: "#d8c7a0", roadCase: "#3a2a14", sel: "#ffb400", caseOp: 0.75, boundary: "#a8c66c" } },
    minimal: { label: "Clean & simple", note: "Plain black and white, nothing extra", sw: ["#ffffff", "#111111", "#888888"],
      mapFilter: "grayscale(1) brightness(1.15) contrast(0.9)",
      lines: { trail: "#111111", trailCase: "#ffffff", road: "#555555", roadCase: "#ffffff", sel: "#e53935", caseOp: 0.9, boundary: "#111111" } },
    playful: { label: "Crayon box", note: "Bright and cheerful, great for grandkids", sw: ["#fffbea", "#ff5d8f", "#3ec1d3"],
      mapFilter: "saturate(1.6) brightness(1.1) contrast(1.05)",
      font: "GFONTFredoka:wght@500;700&display=swap",
      lines: { trail: "#ffe066", trailCase: "#3a2ea0", road: "#ffffff", roadCase: "#ff5d8f", sel: "#3ec1d3", caseOp: 0.9, extra: 1.2, boundary: "#ff5d8f" } },
  };
  Object.values(THEMES).forEach((t) => { if (t.font) t.font = t.font.replace("GFONT", "https://fonts.googleapis.com/css2?family="); });
  let theme = "farmhouse";
  function applyTheme(k, { pickBase = false } = {}) {
    theme = k;
    document.documentElement.dataset.theme = k;
    const t = THEMES[k];
    if (t.font && !document.querySelector(`link[data-font="${k}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = t.font; l.dataset.font = k;
      document.head.append(l);
    }
    document.querySelector('meta[name="theme-color"]').content = t.sw[1];
    if (pickBase) setBase("themed"); else applyMapLook();
    tracks.forEach((tr) => restyle(tr));
  }
  document.documentElement.dataset.theme = theme;

  // ================================================================ state
  let farmBounds = null, farmPin = null;
  let homeZoom = Infinity;   // how far the Home button zooms on this screen (worked out in farmFit)
  setBase(baseKey);
  let trailsOn = true;
  let photosOn = true;
  let labelsOn = true;
  const ADV_DEFAULTS = { colourMode: "simple", trailColour: null, lineStyle: "theme", outline: true, flow: false, thickness: 1, lineOpacity: 100,
    placeNames: true, minorSpots: true, hiddenPlaces: [], lengthFilter: "all", steepFilter: "all", trailDay: "all", cluster: true, boundaryFill: true,
    dirArrows: true, labelSize: 1, labelLengths: false, rings: false, compass: true, units: "metric" };
  const adv = { ...ADV_DEFAULTS, hiddenPlaces: [] };
  const LENGTHS = { all: [0, 1e9], short: [0, 250], medium: [250, 600], long: [600, 1e9] };
  const STEEPS = { all: [0, 1e9], flat: [0, 1.5], gentle: [1.5, 3], hilly: [3, 1e9] };   // % climb over the trail's length
  // Distances follow the "Distances in" setting: metres and kilometres, or feet and miles.
  const fmtLen = (m) => {
    if (adv.units !== "imperial") return KM.fmtLen(m);
    const ft = m * 3.28084;
    return ft < 1000.5 ? Math.round(ft).toLocaleString() + " ft" : (m / 1609.34).toFixed(m < 16093 ? 2 : 1) + " mi";
  };
  const fmtH = (m) => (adv.units === "imperial" ? Math.round(m * 3.28084) + " ft" : Math.round(m) + " m");
  const hiddenTracks = new Set();
  const tracks = new Map();   // id -> {f, line, casing, group, label}
  const places = new Map();   // id -> {f, marker, photos}
  const photoById = new Map();
  let allPhotos = [];
  let categories = {};
  let tour = { stops: [] };
  let selectedTrack = null, selectedPlace = null;

  // ================================================================ tracks
  // The winding-path picture from the Trails button, used wherever a trail is named.
  const TRAIL_SVG = `<svg class="trail-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21c0-4 5-4 7-7s-3-5 0-8 6-1 7-3" fill="none" stroke="currentColor"
    stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3.5 3"/><circle cx="5" cy="21" r="1.8" fill="currentColor"/><path d="M17.5 1.5l3.5 1.5-3 2.5z" fill="currentColor"/></svg>`;
  const cat = (f) => f.properties.category;
  const isTrail = (f) => cat(f) !== "boundary";

  const RAMP_STEEP = [[0.5, "#4caf50"], [1.5, "#c6d93b"], [2.5, "#ffc107"], [3.5, "#ff7a1a"], [99, "#e53935"]];
  const RAMP_LEN = [[150, "#ffe066"], [300, "#ffb347"], [500, "#ff7a45"], [800, "#e8505b"], [1e9, "#b3246b"]];
  const steepness = (p) => (p.length_m ? (Math.max(p.gain_m || 0, p.loss_m || 0) / p.length_m) * 100 : 0);
  const ramp = (r, v) => r.find(([lim]) => v <= lim)[1];
  function trailColour(f) {
    const L_ = THEMES[theme].lines;
    const road = cat(f) === "roads";
    if (adv.colourMode === "each") return f.properties.color;
    if (adv.colourMode === "steep" && !road) return ramp(RAMP_STEEP, steepness(f.properties));
    if (adv.colourMode === "length" && !road) return ramp(RAMP_LEN, f.properties.length_m);
    return road ? L_.road : adv.trailColour || L_.trail;
  }
  // Lines get a little thicker at two zoom steps; only crossing one of them needs the lines restyled.
  const zoomBoost = () => { const z = map.getZoom(); return z >= 18 ? 1.5 : z >= 16 ? 0.75 : 0; };
  function styles(f, hi = false) {
    const L_ = THEMES[theme].lines;
    const k = adv.thickness * (L_.extra || 1);
    const boost = zoomBoost();
    const c = cat(f);
    if (c === "boundary") {
      const col = f.id === "quarter-section-perimeter" && L_.boundary ? L_.boundary : f.properties.color;
      return { line: { color: col, weight: (3 + boost) * k + (hi ? 2 : 0), dashArray: hi ? null : "10 7", opacity: 1, fillColor: col,
        fillOpacity: adv.boundaryFill ? (hi ? 0.12 : 0.05) : 0 }, casing: { opacity: 0, fillOpacity: 0, weight: 0 } };
    }
    const road = c === "roads";
    const w = ((road ? 5 : 3.5) + boost) * k + (hi ? 2.5 : 0);
    const color = hi ? L_.sel : trailColour(f);
    const dash = { theme: L_.dash, solid: null, dashed: `${(w * 2.6).toFixed(1)} ${(w * 1.9).toFixed(1)}`, dotted: `0.1 ${(w * 2.1).toFixed(1)}` }[adv.lineStyle];
    return {
      line: { color, weight: w, opacity: hi ? 1 : adv.lineOpacity / 100, lineCap: "round", lineJoin: "round", dashArray: !road && !hi && dash ? dash : null },
      casing: { color: road ? L_.roadCase : L_.trailCase, weight: w + 3.5 * k, lineCap: "round", lineJoin: "round",
        opacity: hi ? 0.95 : adv.outline ? L_.caseOp * adv.lineOpacity / 100 : 0 },
    };
  }
  function restyle(t) {
    const s = styles(t.f, selectedTrack === t.f.id);
    t.line.setStyle(s.line);
    t.casing.setStyle(s.casing);
    t.boost = zoomBoost();
  }

  function lineCoords(g) {
    return g.type === "LineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates[0] : g.coordinates.flat();
  }
  function midpoint(g) {
    const c = lineCoords(g);
    const p = c[Math.floor(c.length / 2)];
    return L.latLng(p[1], p[0]);
  }

  function addTrack(f) {
    const boundary = cat(f) === "boundary";
    const line = L.geoJSON(f, { pane: boundary ? "boundary" : "trails", interactive: false, className: boundary ? "km-bound" : cat(f) === "roads" ? "km-road" : "km-trail" });
    const casing = L.geoJSON(f, { pane: "casing", interactive: false });
    const hit = L.geoJSON(f, { pane: "trails", style: { weight: 24, opacity: 0, fill: false } });
    const group = L.featureGroup([casing, line, hit]);
    hit.on("click", (e) => { L.DomEvent.stop(e); openTrail(f.id, { fly: false }); });
    if (!L.Browser.mobile) {
      hit.on("mouseover", () => { const s = styles(f, true); line.setStyle(s.line); });
      hit.on("mouseout", () => restyle(tracks.get(f.id)));
      hit.bindTooltip(esc(f.properties.name), { sticky: true, direction: "top", className: "trail-label" });
    }
    const label = L.tooltip({ permanent: true, direction: "center", className: "trail-label", interactive: false })
      .setLatLng(f.geometry.type === "Polygon" ? line.getBounds().getCenter() : midpoint(f.geometry))
      .setContent(labelText(f));
    const t = { f, line, casing, group, label, dirs: f.properties.directions ? directionLayer(f) : null };
    tracks.set(f.id, t);
    restyle(t);
    if (f.id === "quarter-section-perimeter") farmBounds = line.getBounds();
  }

  const labelText = (f) => esc(f.properties.name) + (adv.labelLengths && isTrail(f) ? ` <span class="tl-len">· ${fmtLen(f.properties.length_m)}</span>` : "");

  // Point and heading at a fraction of the way along a line (lon/lat coords).
  function alongLine(coords, frac) {
    const ll = coords.map((c) => L.latLng(c[1], c[0]));
    const seg = ll.slice(1).map((p, i) => distM(ll[i], p));
    const total = seg.reduce((a, b) => a + b, 0);
    let want = total * frac;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) {
        const k = seg[i] ? Math.min(1, want / seg[i]) : 0;
        const a = ll[i], b = ll[i + 1];
        return { at: L.latLng(a.lat + (b.lat - a.lat) * k, a.lng + (b.lng - a.lng) * k), heading: bearing(a, b) };
      }
      want -= seg[i];
    }
  }
  // Named directions along one trail (e.g. Payton Trail one way, Caine Trail the other): a labelled badge plus chevrons.
  function directionLayer(f) {
    const coords = lineCoords(f.geometry);
    const group = L.layerGroup();
    const halves = [[0.08, 0.46], [0.54, 0.92]];
    f.properties.directions.forEach((d, i) => {
      const [a, b] = halves[i % 2];
      const cs = d.reverse ? [...coords].reverse() : coords;
      const fa = d.reverse ? 1 - b : a, fb = d.reverse ? 1 - a : b;
      [0, 0.25, 0.5, 0.75, 1].forEach((k) => {
        const { at, heading } = alongLine(cs, fa + (fb - fa) * k);
        if (k === 0.5) {
          group.addLayer(L.marker(at, { interactive: false, keyboard: false, zIndexOffset: 400, icon: L.divIcon({ className: "", iconSize: [0, 0],
            html: `<div class="trail-label dir-tag">${esc(d.label)}</div>` }) }));
        } else {
          group.addLayer(L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", iconSize: [0, 0],
            html: `<div class="dir-chev" style="transform:translate(-50%,-50%) rotate(${heading - 90}deg)">›</div>` }) }));
        }
      });
    });
    return group;
  }

  function highlightTrack(id) {
    const prev = selectedTrack;
    selectedTrack = id;
    if (prev && tracks.has(prev)) restyle(tracks.get(prev));
    if (id && tracks.has(id)) { restyle(tracks.get(id)); tracks.get(id).line.bringToFront(); }
  }
  function passesTrailFilters(f) {
    const [lo, hi] = LENGTHS[adv.lengthFilter] || LENGTHS.all;
    if (f.properties.length_m < lo || f.properties.length_m >= hi) return false;
    const [slo, shi] = STEEPS[adv.steepFilter] || STEEPS.all;
    const s = steepness(f.properties);
    if (cat(f) === "trails" && (s < slo || s >= shi)) return false;
    if (adv.trailDay !== "all" && (f.properties.recorded || "").slice(0, 10) !== adv.trailDay) return false;
    return true;
  }
  function trackShouldShow(t) {
    if (t.f.id === selectedTrack) return true;
    if (hiddenTracks.has(t.f.id)) return false;
    if (!isTrail(t.f)) return true;
    return trailsOn && passesTrailFilters(t.f) && map.getZoom() >= Z.trails;
  }
  function labelShouldShow(t) {
    if (!labelsOn || !trackShouldShow(t) || !isTrail(t.f)) return false;
    return t.f.id === selectedTrack || map.getZoom() >= (cat(t.f) === "roads" ? Z.roadLabels : Z.trailLabels);
  }
  function refreshTracks() {
    tracks.forEach((t) => {
      const show = trackShouldShow(t);
      if (show && !map.hasLayer(t.group)) t.group.addTo(map);
      if (!show && map.hasLayer(t.group)) map.removeLayer(t.group);
      if (show && t.boost !== zoomBoost()) restyle(t);
      if (t.dirs) {
        const d = adv.dirArrows && show && map.getZoom() >= 16.5;
        if (d && !map.hasLayer(t.dirs)) t.dirs.addTo(map);
        if (!d && map.hasLayer(t.dirs)) map.removeLayer(t.dirs);
      }
      const lab = labelShouldShow(t);
      if (lab && !map.hasLayer(t.label)) t.label.addTo(map);
      if (!lab && map.hasLayer(t.label)) map.removeLayer(t.label);
    });
  }

  // ================================================================ places
  // Only the house and cabin get their own picture; every other spot uses the same camera so the map stays tidy.
  const SPECIAL_PINS = new Set(["house", "cabin"]);
  const CABIN_SVG = `<svg class="pin-svg" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 30 32 10l24 20" fill="#5b3a1e"/>
    <path d="M4 32 32 8l28 24-4 4L32 16 8 36z" fill="#3b2412"/><rect x="44" y="12" width="7" height="14" fill="#6d4c33"/>
    <rect x="12" y="32" width="40" height="24" fill="#a0673a"/><g stroke="#6b4222" stroke-width="2.4"><path d="M12 38h40M12 44h40M12 50h40"/></g>
    <rect x="28" y="40" width="9" height="16" fill="#4a2c14"/><rect x="16" y="37" width="8" height="7" fill="#ffd978" stroke="#4a2c14" stroke-width="1.5"/>
    <rect x="41" y="37" width="8" height="7" fill="#ffd978" stroke="#4a2c14" stroke-width="1.5"/></svg>`;
  // Small unnamed spots share a drawn camera (an emoji camera sits off-centre in the small circle on some phones).
  const CAMERA_SVG = `<svg class="pin-svg cam-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 6.5 9.6 4.5h4.8l1.4 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"
    fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="#fff" stroke-width="2"/></svg>`;
  // Named places get their own picture; small unnamed spots all share the camera.
  const pinEmoji = (p) => (p.icon === "cabin" ? CABIN_SVG : p.featured || SPECIAL_PINS.has(p.icon) ? icon(p.icon) : CAMERA_SVG);
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  function placeIcon(f, sel = false) {
    const p = f.properties;
    const minor = !p.featured;
    return L.divIcon({
      className: "", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="place-pin${minor ? " minor" : ""}${sel ? " sel" : ""}${p.site ? " site" : ""}" style="margin-top:${minor ? "-0.85rem" : "-1.3rem"}">
        <div class="bubble">${pinEmoji(p)}${!minor && p.photos.length ? `<i class="pin-count">${p.photos.length}</i>` : ""}</div>${minor || (!adv.placeNames && !sel) ? "" : `<div class="name">${esc(p.name)}</div>`}</div>`,
    });
  }
  function addPlace(f) {
    const [lon, lat] = f.geometry.coordinates;
    const marker = L.marker([lat, lon], { icon: placeIcon(f), keyboard: true, title: f.properties.name || "Photo spot",
      alt: f.properties.name || "Photo spot", zIndexOffset: f.properties.featured ? 500 : 0, riseOnHover: true });
    marker.on("click", () => openPlace(f.id));
    const pl = { f, marker, photos: f.properties.photos.map((id) => photoById.get(id)).filter(Boolean) };
    places.set(f.id, pl);
    if (canHover) {
      const hero = heroOf(pl);
      marker.bindTooltip(`<div class="peek">${hero ? `<img src="${esc(photoUrl(hero, "thumb"))}" alt="">` : ""}
        <b>${esc(placeTitle(pl))}</b><small>${pl.photos.length} photo${pl.photos.length === 1 ? "" : "s"} · click to open</small></div>`,
        { direction: "top", offset: [0, -24], className: "peek-tip", opacity: 1 });
    }
  }
  function refreshPlaces() {
    // On the smallest screens the whole quarter only fits a little below the usual zoom for named places; they
    // still show on the Home view there (the least important give way if they would sit on top of each other).
    const z = map.getZoom(), placesAt = Math.min(Z.places, homeZoom);
    places.forEach((pl) => {
      const p = pl.f.properties;
      const typeOk = !adv.hiddenPlaces.includes(pl.f.id);
      // The family houses stand alone far from anything else, so their pins show from much further out.
      const at = p.site ? Z.sites : placesAt;
      const show = pl.f.id === selectedPlace || (typeOk && (p.featured ? z >= at : adv.minorSpots && z >= Z.minorPlaces && !photosOn));
      if (show && !map.hasLayer(pl.marker)) pl.marker.addTo(map);
      if (!show && map.hasLayer(pl.marker)) map.removeLayer(pl.marker);
    });
    if (farmPin) {
      const show = z < Math.min(Z.farmPin, placesAt);
      if (show && !map.hasLayer(farmPin)) farmPin.addTo(map);
      if (!show && map.hasLayer(farmPin)) map.removeLayer(farmPin);
    }
  }
  function selectPlace(id) {
    const prev = selectedPlace;
    selectedPlace = id;
    if (prev && places.has(prev)) places.get(prev).marker.setIcon(placeIcon(places.get(prev).f));
    if (id && places.has(id)) places.get(id).marker.setIcon(placeIcon(places.get(id).f, true));
    refreshPlaces();
    declutterSoon();
  }
  function placeTitle(pl) {
    if (pl.f.properties.name) return pl.f.properties.name;
    const near = pl.photos.find((x) => x.near)?.near;
    return near ? `Photo spot on ${near}` : "Photo spot";
  }
  const heroOf = (pl) => pl.photos.find((x) => x.file === pl.f.properties.hero) || pl.photos[0];
  // A big photo shows its small copy (usually already loaded) until the full one has arrived.
  const heroImg = (p, alt) => `<img class="place-hero" src="${esc(photoUrl(p))}" alt="${esc(alt)}" decoding="async"
    style="background-image:url(&quot;${esc(photoUrl(p, "thumb"))}&quot;)">`;
  const featuredPlaces = () => [...places.values()].filter((pl) => pl.f.properties.featured);
  // The two family houses (Old House, CK House): one pin each, away from the quarter.
  const sitePlaces = () => featuredPlaces().filter((pl) => pl.f.properties.site);
  const SITE_R = 600;   // metres around a house that count as being there
  /** Which place a point is at: the quarter (its outline, padded), one of the houses, or null when it's at neither. */
  function areaOf(ll, pad = 1.5) {
    if (farmBounds && farmBounds.pad(pad).contains(ll)) return { id: "quarter", name: "the quarter" };
    const pl = sitePlaces().find((x) => distM(ll, x.marker.getLatLng()) < SITE_R);
    return pl ? { id: pl.f.id, name: placeTitle(pl), pl } : null;
  }

  /** How far the buttons along the top and the dock along the bottom reach into the screen, in pixels. */
  function uiInsets() {
    const top = Math.max(0, ...$$("#topbar .top-actions, #topbar h1").map((el) => el.getBoundingClientRect().bottom));
    const dock = $("#dock").getBoundingClientRect();
    return { top, bottom: dock.height ? window.innerHeight - dock.top : 0 };
  }
  /** Fly so the point sits in the part of the screen not covered by the sheet or the top buttons. */
  function flyToVisible(ll, zoom) {
    const z = zoom ?? Math.max(map.getZoom(), 17.5);
    let pt = map.project(ll, z);
    if (!$("#sheet").hidden) {
      if (isPhone()) pt = pt.add([0, ($("#sheet").offsetHeight - uiInsets().top) / 2]);
      else pt = pt.subtract([($("#sheet").offsetWidth + 24) / 2, 0]);
    }
    map.flyTo(map.unproject(pt, z), z, { duration: 0.8 });
  }

  function gallery(list, title) {
    const g = document.createElement("div");
    g.className = "gallery";
    g.innerHTML = list.map((x, i) => `<button data-i="${i}" aria-label="Open photo ${i + 1} of ${list.length}">
      <img src="${esc(photoUrl(x, "thumb"))}" alt="" loading="lazy"></button>`).join("");
    $$("button", g).forEach((b) => b.onclick = () => openLightbox(list, +b.dataset.i, title));
    return g;
  }

  function openPlace(id, { fly = true, back = null } = {}) {
    const pl = places.get(id);
    if (!pl) return;
    const p = pl.f.properties;
    const title = placeTitle(pl);
    highlightTrack(null);
    selectPlace(id);
    history.replaceState(null, "", "#place=" + encodeURIComponent(id));
    const hero = heroOf(pl);
    const days = [...new Set(pl.photos.map((x) => fmtDate(x.taken, false)))].join(", ");
    const ll = pl.marker.getLatLng();
    const nearby = featuredPlaces().filter((o) => o !== pl).map((o) => [o, distM(ll, o.marker.getLatLng())])
      .filter(([, d]) => d < 400).sort((a, b) => a[1] - b[1]).slice(0, 4);
    const trailsHere = [...new Set(pl.photos.map((x) => x.near).filter(Boolean))]
      .map((n) => [...tracks.values()].find((t) => t.f.properties.name === n)).filter((t) => t && isTrail(t.f));

    const body = document.createElement("div");
    body.innerHTML = `
      ${hero ? heroImg(hero, title) : ""}
      ${p.story ? `<p class="place-story">${esc(p.story)}</p>` : ""}
      <p class="place-meta">${pl.photos.length} photo${pl.photos.length === 1 ? "" : "s"} · taken ${esc(days)}</p>
      <div class="btn-row"><button class="big" data-act="go">🧭 Take me there</button><button class="big ghost" data-act="zoom">🔍 Zoom in</button></div>
      <h3>Photos</h3><div data-slot="gallery"></div>
      ${trailsHere.length ? `<h3>On these trails</h3><div class="chips" data-slot="trails"></div>` : ""}
      ${nearby.length ? `<h3>Nearby</h3><div class="chips" data-slot="nearby"></div>` : ""}`;
    const heroIdx = Math.max(0, pl.photos.indexOf(hero));
    $(".place-hero", body)?.addEventListener("click", () => openLightbox(pl.photos, heroIdx, title));
    $('[data-slot="gallery"]', body).replaceWith(gallery(pl.photos, title));
    const tslot = $('[data-slot="trails"]', body);
    trailsHere.forEach((t) => tslot.append(trailChip(t)));
    const nslot = $('[data-slot="nearby"]', body);
    nearby.forEach(([o, d]) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.innerHTML = `${icon(o.f.properties.icon)} ${esc(placeTitle(o))} <small>${fmtLen(d)}</small>`;
      b.onclick = () => openPlace(o.f.id, { back: true });
      nslot.append(b);
    });
    $('[data-act="zoom"]', body).onclick = () => { if (isPhone()) closeSheet(); map.flyTo(ll, 19, { duration: 0.8 }); };
    $('[data-act="go"]', body).onclick = () => takeMeThere(pl);
    openSheet(`${icon(p.icon)} ${title}`, body, { back: back ?? !!sheetCurrent });
    if (fly) flyToVisible(ll);
  }

  // ================================================================ trail card
  function trailChip(t) {
    const b = document.createElement("button");
    b.className = "chip";
    b.innerHTML = `<span class="swatch" style="background:${esc(trailColour(t.f))}"></span>${esc(t.f.properties.name)}`;
    b.onclick = () => openTrail(t.f.id, { back: true });
    return b;
  }

  function elevationSvg(profile) {
    if (!profile || profile.length < 2) return "";
    const maxD = profile[profile.length - 1][0] || 1;
    const es = profile.map((p) => p[1]);
    let lo = Math.min(...es), hi = Math.max(...es);
    if (hi - lo < 6) { const m = (hi + lo) / 2; lo = m - 3; hi = m + 3; }
    // The left margin fits the height labels ("996 m", or "3268 ft" in feet), so they're never cut off at the edge.
    const W = 320, H = 110, pad = { l: Math.ceil(Math.max(fmtH(hi).length, fmtH(lo).length) * 5.9) + 8, r: 8, t: 10, b: 20 };
    const x = (d) => pad.l + (d / maxD) * (W - pad.l - pad.r);
    const y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const pts = profile.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
    return `<svg class="elev" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation along the trail, from ${Math.round(lo)} to ${Math.round(hi)} metres">
      <polygon points="${x(0)},${H - pad.b} ${pts} ${x(maxD)},${H - pad.b}" fill="#cfe3c9"/>
      <polyline points="${pts}" fill="none" stroke="#2f5d3a" stroke-width="2.5" stroke-linejoin="round"/>
      <g font-size="10" fill="#5d6258">
        <text x="${pad.l - 4}" y="${y(hi) + 4}" text-anchor="end">${fmtH(hi)}</text>
        <text x="${pad.l - 4}" y="${y(lo) + 4}" text-anchor="end">${fmtH(lo)}</text>
        <text x="${pad.l}" y="${H - 5}">start</text>
        <text x="${W - pad.r}" y="${H - 5}" text-anchor="end">${fmtLen(maxD)}</text>
      </g></svg>`;
  }

  function openTrail(id, { fly = true, back = null } = {}) {
    const t = tracks.get(id);
    if (!t) return;
    const p = t.f.properties;
    selectPlace(null);
    highlightTrack(id);
    if (hiddenTracks.has(id)) setTrackHidden(id, false);
    refreshTracks();
    history.replaceState(null, "", "#trail=" + encodeURIComponent(id));
    const along = allPhotos.filter((x) => x.p.near === p.name).map((x) => x.p);
    const links = (p.connects || []).map((c) => tracks.get(c)).filter(Boolean)
      .sort((a, b) => a.f.properties.name.localeCompare(b.f.properties.name));
    const body = document.createElement("div");
    const kind = cat(t.f) === "boundary" ? "Boundary" : cat(t.f) === "roads" ? "Road" : "Trail";
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${fmtLen(p.length_m)}</b><small>${cat(t.f) === "boundary" ? "around" : "long"}</small></div>
        ${p.gain_m != null && isTrail(t.f) ? `<div class="stat"><b>↗ ${fmtH(p.gain_m)}</b><small>total uphill</small></div>
          <div class="stat"><b>↘ ${fmtH(p.loss_m)}</b><small>total downhill</small></div>` : ""}
        ${p.profile && isTrail(t.f) ? `<div class="stat"><b>${Math.round((adv.units === "imperial" ? 3.28084 : 1) * Math.min(...p.profile.map((x) => x[1])))}–${fmtH(Math.max(...p.profile.map((x) => x[1])))}</b><small>height above sea</small></div>` : ""}
      </div>
      ${p.directions ? `<p class="dir-note">➜ <b>${esc(p.directions.find((d) => d.reverse)?.label || "")}</b> heading from the trail sign toward the cabin; <b>${esc(p.directions.find((d) => !d.reverse)?.label || "")}</b> coming back the other way.</p>` : ""}
      ${p.profile && isTrail(t.f) ? `<h3>Ups and downs</h3>${elevationSvg(p.profile)}` : ""}
      <div class="btn-row"><button class="big" data-act="fit">🔍 Show the whole ${kind.toLowerCase()}</button></div>
      ${links.length ? `<h3>Connects to</h3><div class="chips" data-slot="links"></div>` : ""}
      <h3>Photos along the way</h3>${along.length ? `<div data-slot="gallery"></div>` : `<p class="empty">No photos on this one yet.</p>`}`;
    const ls = $('[data-slot="links"]', body);
    links.forEach((o) => ls.append(trailChip(o)));
    if (along.length) $('[data-slot="gallery"]', body).replaceWith(gallery(along, p.name));
    const fit = () => {
      const ui = uiInsets();
      if (isPhone()) {
        map.flyToBounds(t.line.getBounds(), { paddingTopLeft: [30, ui.top + 20], paddingBottomRight: [30, $("#sheet").offsetHeight + 20], maxZoom: 18, duration: 0.8 });
      } else {
        map.flyToBounds(t.line.getBounds(), { paddingTopLeft: [$("#sheet").offsetWidth + 50, ui.top + 20], paddingBottomRight: [80, ui.bottom + 20], maxZoom: 18, duration: 0.8 });
      }
    };
    $('[data-act="fit"]', body).onclick = fit;
    openSheet(p.name, body, { back: back ?? false, titleIcon: TRAIL_SVG });
    if (fly) fit();
    declutterSoon();
  }

  // ================================================================ photo pins layer
  // Photos group more when zoomed out and split apart as you zoom in; a group whose photos were all
  // taken at practically the same spot fans out ("spiderfies") when tapped instead of zooming further.
  // One cluster group per place: photos only ever group with photos from the same place, so a group near the
  // house never swallows deck or shed photos and nearby photos from the same place always join their group.
  function makeCluster() {
    const cg = L.markerClusterGroup({
      maxClusterRadius: (z) => (z < 16 ? 80 : z < 17.5 ? 70 : z < 19 ? 60 : z < 20.5 ? 44 : z < 21.5 ? 30 : 20),
      showCoverageOnHover: false, zoomToBoundsOnClick: false, spiderfyOnMaxZoom: true, spiderfyDistanceMultiplier: 1.9,
      animateAddingMarkers: false, chunkedLoading: true,
      iconCreateFunction: (c) => {
        const kids = c.getAllChildMarkers();
        const pl = places.get(kids[0].options.photo.place);
        const cover = (pl && kids.find((k) => k.options.photo.file === pl.f.properties.hero)) || kids[0];
        const n = kids.length;
        const size = n < 5 ? 46 : n < 15 ? 54 : 62;
        return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
          html: `<div class="ph-cluster" style="width:${size}px;height:${size}px"><img src="${esc(photoUrl(cover.options.photo, "thumb"))}" alt="" loading="lazy"><b>${n}</b></div>` });
      },
    });
    cg.on("clusterclick", (e) => {
      const c = e.layer;
      const bb = c.getBounds();
      const spread = distM(bb.getSouthWest(), bb.getNorthEast());
      if (spread < 12 || map.getZoom() >= 20.5) c.spiderfy();
      else c.zoomToBounds({ padding: [60, 60], maxZoom: 22 });
    });
    if (canHover) cg.on("clustermouseover", (e) => {
      const kids = e.layer.getAllChildMarkers();
      const pl = places.get(kids[0].options.photo.place);
      e.layer.bindTooltip(`<div class="peek"><img src="${esc(photoUrl((pl && heroOf(pl)) || kids[0].options.photo, "thumb"))}" alt="">
        <b>${esc(pl ? placeTitle(pl) : "Photos")}</b><small>${kids.length} photos here · click to ${map.getZoom() >= 20.5 ? "spread them out" : "zoom in"}</small></div>`,
        { direction: "top", offset: [0, -26], className: "peek-tip", opacity: 1 }).openTooltip();
    });
    instantZoomSplits(cg);
    return cg;
  }
  // Groups split and merge at once when the zoom changes instead of sliding apart: each of the ~60 groups (one per
  // place) otherwise forces a full page layout on every zoom, which made zooming stutter. The fan-out when a tight
  // group is tapped keeps its animation. This is markercluster 1.5's own zoom handling with its non-animated steps.
  function instantZoomSplits(cg) {
    const still = cg._noAnimation;
    cg._mergeSplitClusters = function () {
      const z = Math.round(this._map._zoom);
      this._processQueue();
      if (this._zoom < z && this._currentShownBounds.intersects(this._getExpandedVisibleBounds())) {
        this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, Math.floor(this._map.getMinZoom()), this._zoom, this._getExpandedVisibleBounds());
        still._animationZoomIn.call(this, this._zoom, z);
      } else if (this._zoom > z) {
        still._animationZoomOut.call(this, this._zoom, z);
      } else {
        this._moveEnd();
      }
    };
  }
  const photoClusters = new Map();
  const photoCluster = L.layerGroup();
  const photoPlain = L.layerGroup();
  let photoLayer = adv.cluster ? photoCluster : photoPlain;
  const photoIconFor = (p) => L.divIcon({ className: "", iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div class="ph-single"><img src="${esc(photoUrl(p, "thumb"))}" alt="" loading="lazy"></div>` });
  let photosGrouped = null;   // true/false once the markers are in their groups
  // A family house keeps all of its photos inside its one pin, so they never appear on the map by themselves.
  const mapPhotos = () => allPhotos.filter((x) => !x.p.gathered);
  function refreshPhotos() {
    // The markers are only regrouped when "Group nearby photos" changes; zooming in and out just shows or hides
    // the layer, so the groups keep what they've already worked out.
    if (photosGrouped !== adv.cluster && allPhotos.length) {
      photosGrouped = adv.cluster;
      photoClusters.forEach((cg) => cg.clearLayers());
      [photoCluster, photoPlain].forEach((l) => { l.clearLayers(); if (map.hasLayer(l) && l !== (adv.cluster ? photoCluster : photoPlain)) map.removeLayer(l); });
      photoLayer = adv.cluster ? photoCluster : photoPlain;
      if (adv.cluster) {
        const byPlace = new Map();
        mapPhotos().forEach((x) => { const k = x.p.place || "none"; (byPlace.get(k) || byPlace.set(k, []).get(k)).push(x.m); });
        byPlace.forEach((ms, k) => {
          if (!photoClusters.has(k)) photoClusters.set(k, makeCluster());
          const cg = photoClusters.get(k);
          cg.addLayers(ms);
          photoCluster.addLayer(cg);
        });
      } else mapPhotos().forEach((x) => photoPlain.addLayer(x.m));
    }
    const want = photosOn && map.getZoom() >= Z.photos;
    syncZoomClass();
    if (want && !map.hasLayer(photoLayer)) photoLayer.addTo(map);
    if (!want && map.hasLayer(photoLayer)) map.removeLayer(photoLayer);
    refreshPlaces();
  }

  // ================================================================ declutter
  // Hides pins, place names and trail names that would sit on top of a more important one. Hiding only changes
  // visibility, never size or position, so everything is measured in one go and the classes are set afterwards
  // (measuring between changes made the browser lay the page out again for every pin and label).
  let declutterFrame = 0;
  const declutterSoon = () => { if (!declutterFrame) declutterFrame = requestAnimationFrame(declutter); };
  // A place name that would run off the side of the screen slides back in, while still reaching under its pin, and
  // one that would sit behind the dock goes above its pin instead.
  function nameBox(name, width, bubble, dock) {
    const r = name.getBoundingClientRect(), [wasX, wasY] = name.kmShift || [0, 0];
    const left = r.left - wasX, right = r.right - wasX, top = r.top - wasY, room = Math.max(0, r.width / 2 - 14);
    const want = left < 6 ? 6 - left : right > width - 6 ? width - 6 - right : 0;
    const dx = Math.round(Math.max(-room, Math.min(room, want)));
    const behindDock = dock.height && left + dx < dock.right && right + dx > dock.left && top + r.height > dock.top;
    const dy = behindDock ? Math.round(bubble.top - 10 - r.height - top) : 0;   // 10: clear of the photo count badge
    return { left: left + dx, right: right + dx, top: top + dy, bottom: top + dy + r.height, shift: [dx, dy] };
  }
  function declutter() {
    cancelAnimationFrame(declutterFrame);
    declutterFrame = 0;
    const rank = (pl) => (pl.f.id === selectedPlace ? 1e6 : 0) + (pl.f.properties.featured ? 1e3 : 0) + pl.photos.length;
    const width = map.getSize().x, dock = $("#dock").getBoundingClientRect();
    const pins = [...places.values()].filter((pl) => map.hasLayer(pl.marker)).sort((a, b) => rank(b) - rank(a))
      .map((pl) => pl.marker.getElement()?.querySelector(".place-pin")).filter(Boolean)
      .map((pin) => {
        const name = pin.querySelector(".name"), br = pin.querySelector(".bubble").getBoundingClientRect();
        return { pin, name, br, nr: name && nameBox(name, width, br, dock) };
      });
    const labels = [...tracks.values()].filter((t) => map.hasLayer(t.label))
      .sort((a, b) => (b.f.id === selectedTrack) - (a.f.id === selectedTrack))
      .map((t) => t.label.getElement()).filter(Boolean).map((el) => ({ el, r: el.getBoundingClientRect() }));
    const boxes = [], hide = new Map();
    const overlaps = (r, pad = 3) => boxes.some((b) => r.left < b.right + pad && r.right > b.left - pad && r.top < b.bottom + pad && r.bottom > b.top - pad);
    for (const { pin, name, br, nr } of pins) {
      const off = overlaps(br, 1);
      hide.set(pin, off);
      if (!off) boxes.push(br);
      if (name) { const nameOff = !off && overlaps(nr); hide.set(name, nameOff); if (!off && !nameOff) boxes.push(nr); }
    }
    for (const { el, r } of labels) {
      const off = overlaps(r, 6);
      hide.set(el, off);
      if (!off) boxes.push(r);
    }
    hide.forEach((off, el) => el.classList.toggle("declutter-hide", off));
    for (const { name, nr } of pins) {
      if (!name) continue;
      const [dx, dy] = nr.shift, [wasX, wasY] = name.kmShift || [0, 0];
      if (dx === wasX && dy === wasY) continue;
      name.kmShift = nr.shift;
      name.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
    }
  }

  // ================================================================ back button
  // The phone's back button (or back gesture) closes the photo or panel that is open instead of leaving the map.
  // Each of them owns one history entry while open; closing one with its ✕ uses that entry up again.
  const backLayers = [];
  let skipPops = 0, pendingBack = 0;
  function pushBack(name) {
    if (backLayers.includes(name)) return;
    // The entry underneath never keeps a #place=… address, so going back to it can't reopen what was just closed.
    if (!backLayers.length) {
      const url = location.href;
      history.replaceState(history.state, "", location.pathname + location.search);
      history.pushState({ km: name }, "", url);
    } else history.pushState({ km: name }, "", location.href);
    backLayers.push(name);
  }
  function dropBack(name) {
    const i = backLayers.lastIndexOf(name);
    if (i < 0) return;
    backLayers.splice(i, 1);
    // Closing the photo and its panel together (Show on map) steps back twice in one go.
    if (!pendingBack++) queueMicrotask(() => { const n = pendingBack; pendingBack = 0; skipPops++; history.go(-n); });
  }
  window.addEventListener("popstate", () => {
    if (skipPops) { skipPops--; return; }
    const name = backLayers.pop();
    if (name === "lightbox") closeLb(true);
    else if (name === "sheet") {
      // Inside a panel, back first goes to the list or card it was opened from.
      if (sheetStack.length) { $("#sheet-back").click(); pushBack("sheet"); } else closeSheet(true);
    }
  });

  // ================================================================ sheet
  const sheet = $("#sheet");
  const sheetStack = [];
  let sheetCurrent = null;
  function openSheet(title, content, { back = false, onClose = null, titleIcon = "" } = {}) {
    if (!back) sheetStack.length = 0;
    else if (sheetCurrent) sheetStack.push(sheetCurrent);
    sheetCurrent = { title, titleIcon, content, onClose, hash: location.hash };
    renderSheet();
    pushBack("sheet");
  }
  function renderSheet() {
    $("#sheet-title").innerHTML = (sheetCurrent.titleIcon ? `<span class="title-ic">${sheetCurrent.titleIcon}</span>` : "") + esc(sheetCurrent.title);
    const body = $("#sheet-body");
    body.replaceChildren(sheetCurrent.content);
    if (!sheetCurrent.content.contains(document.getElementById("radar-panel"))) homeRadarPanel();
    $("#sheet-back").hidden = sheetStack.length === 0;
    applySheetHeight();
    sheet.hidden = false;
    body.scrollTop = 0;   // after showing it: a hidden sheet ignores this and would open where the last one was scrolled to
    document.body.classList.add("sheet-open");
    if (isPhone() && !$("#legend-pop").hidden) $("#legend-pop .lp-x").click();
  }
  function closeSheet(fromBackButton = false) {
    if (fromBackButton !== true) dropBack("sheet");
    const cbs = [sheetCurrent, ...sheetStack].map((s) => s?.onClose).filter(Boolean);
    sheet.hidden = true;
    sheetStack.length = 0;
    sheetCurrent = null;
    sheetH = null;
    document.body.classList.remove("sheet-open");
    homeRadarPanel();
    $$("#dock button.active, #options-btn.active").forEach((b) => b.classList.remove("active"));
    selectPlace(null);
    highlightTrack(null);
    refreshTracks();
    history.replaceState(null, "", location.pathname + location.search);
    cbs.forEach((f) => f());
  }
  $("#sheet-close").onclick = () => closeSheet();
  // Phones show the radar controls inside the sheet; this puts them back in their place over the map.
  function homeRadarPanel() {
    const panel = document.getElementById("radar-panel");
    if (panel.classList.contains("in-sheet")) { panel.classList.remove("in-sheet"); $("#info-stack").append(panel); }
  }
  $("#sheet-back").onclick = () => {
    sheetCurrent = sheetStack.pop();
    if (!sheetCurrent) return closeSheet();
    history.replaceState(null, "", sheetCurrent.hash || location.pathname);
    renderSheet();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#lightbox").hidden && !sheet.hidden) closeSheet();
  });

  // Phone: drag the grip or the header up or down to show as much or as little of the map as wanted. Tapping the grip
  // jumps between nearly full screen and the normal height. The size lasts until the sheet is closed.
  let sheetH = null;
  let sheetDrag = null;
  const sheetMaxH = () => window.innerHeight - 8;
  const sheetMinH = () => $("#sheet-grip").offsetHeight + $(".sheet-head", sheet).offsetHeight;
  function applySheetHeight(minH) {
    const on = isPhone() && sheetH != null;
    if (on) sheetH = Math.max(minH ?? sheetMinH(), Math.min(sheetMaxH(), sheetH));
    sheet.classList.toggle("sized", on);
    sheet.style.height = on ? `${sheetH}px` : "";
  }
  function sheetDragStart(e) {
    if (!isPhone() || e.button > 0 || e.target.closest("button")) return;
    sheetDrag = { id: e.pointerId, y: e.clientY, h: sheet.offsetHeight, minH: sheetMinH(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function sheetDragMove(e) {
    if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
    const dy = sheetDrag.y - e.clientY;
    if (!sheetDrag.moved && Math.abs(dy) < 5) return;
    sheetDrag.moved = true;
    sheet.classList.add("dragging");
    sheetH = sheetDrag.h + dy;
    applySheetHeight(sheetDrag.minH);   // measured once per drag, so a move only writes
  }
  function sheetDragEnd(e) {
    if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
    const tapped = !sheetDrag.moved;
    sheetDrag = null;
    sheet.classList.remove("dragging");
    if (tapped && e.type === "pointerup" && e.currentTarget.id === "sheet-grip") {
      sheetH = sheet.offsetHeight < sheetMaxH() * 0.8 ? sheetMaxH() : null;
      applySheetHeight();
    }
  }
  [$("#sheet-grip"), $(".sheet-head", sheet)].forEach((el) => {
    el.addEventListener("pointerdown", sheetDragStart);
    el.addEventListener("pointermove", sheetDragMove);
    el.addEventListener("pointerup", sheetDragEnd);
    el.addEventListener("pointercancel", sheetDragEnd);
  });
  window.addEventListener("resize", () => { if (!sheet.hidden) applySheetHeight(); });
  function setDockActive(act) {
    $("#options-btn").classList.remove("active");
    $$("#dock button").forEach((b) => b.classList.toggle("active", b.dataset.act === act));
  }

  // ================================================================ places list
  function placesSheet() {
    const featured = featuredPlaces().filter((pl) => !pl.f.properties.site).sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
    const minor = [...places.values()].filter((pl) => !pl.f.properties.featured);
    const body = document.createElement("div");
    body.innerHTML = `<h3>Places on the quarter</h3>`;
    featured.forEach((pl) => body.append(placeRow(pl)));
    if (minor.length) {
      const d = document.createElement("details");
      d.innerHTML = `<summary class="list-row"><span class="emoji">📷</span><span class="txt"><b>Other photo spots</b><small>${minor.length} more spots</small></span></summary>`;
      minor.forEach((pl) => d.append(placeRow(pl)));
      body.append(d);
    }
    const trailsH = document.createElement("h3");
    trailsH.textContent = "Trails & driveway";
    body.append(trailsH);
    [...tracks.values()].filter((t) => isTrail(t.f) && !t.f.properties.site).sort((a, b) => a.f.properties.name.localeCompare(b.f.properties.name))
      .forEach((t) => body.append(trailRow(t)));
    const houses = sitePlaces();
    if (houses.length) {
      const h = document.createElement("h3");
      h.textContent = "Family houses";
      body.append(h);
      houses.forEach((pl) => {
        body.append(placeRow(pl));
        [...tracks.values()].filter((t) => t.f.properties.site === pl.f.id).forEach((t) => body.append(trailRow(t)));
      });
    }
    openSheet("📍 Places & trails", body);
    setDockActive("places");
  }
  function placeRow(pl, hl = esc) {
    const p = pl.f.properties;
    const hero = heroOf(pl);
    const b = document.createElement("button");
    b.className = "list-row";
    b.innerHTML = `${hero ? `<img src="${esc(photoUrl(hero, "thumb"))}" alt="" loading="lazy">` : `<span class="emoji">${icon(p.icon)}</span>`}
      <span class="txt"><b>${icon(p.icon)} ${hl(placeTitle(pl))}</b><small>${pl.photos.length} photo${pl.photos.length === 1 ? "" : "s"}</small></span><span class="chev">›</span>`;
    b.onclick = () => openPlace(pl.f.id, { back: true });
    return b;
  }
  function trailRow(t, hl = esc) {
    const p = t.f.properties;
    const b = document.createElement("button");
    b.className = "list-row";
    b.innerHTML = `<span class="emoji">${TRAIL_SVG}</span><span class="txt"><b>${hl(p.name)}</b><small>${fmtLen(p.length_m)}${p.gain_m != null ? ` · ↗ ${fmtH(p.gain_m)} uphill` : ""}</small></span><span class="chev">›</span>`;
    b.onclick = () => openTrail(t.f.id, { back: true });
    return b;
  }

  // ================================================================ search
  // Every word typed has to match somewhere (in any order), so "payton trail" finds the Payton and Caine Trail.
  // Apostrophes and punctuation don't matter, and a slip of a letter or two still matches ("britany" → Brittney Trail).
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  function editDist(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** 3 = a word starts with it, 2 = inside a word, 1 = near miss, 0 = no match. */
  function wordScore(q, words) {
    let best = 0;
    for (const w of words) {
      if (w.startsWith(q)) return 3;
      if (q.length >= 3 && w.includes(q)) best = Math.max(best, 2);
      else if (q.length >= 4 && best < 1) {
        const d = Math.min(editDist(q, w), editDist(q, w.slice(0, q.length)));
        if (d <= (q.length >= 7 ? 2 : 1)) best = 1;
      }
    }
    return best;
  }
  function searchScore(tokens, whole, name, extra) {
    const n = norm(name).replace(/^the /, ""), nw = n.split(" "), xw = norm(extra).split(" ");
    const bonus = n === whole ? 20 : n.startsWith(whole) ? 10 : n.includes(whole) ? 5 : 0;
    // Words typed run together still match ("fieldhighway", "trailhead").
    const squashed = whole.replace(/ /g, "");
    if (squashed.length >= 5 && n.replace(/ /g, "").includes(squashed)) return tokens.length * 6 + bonus + 1;
    let total = 0;
    for (const tok of tokens) {
      const s = Math.max(wordScore(tok, nw) * 2, wordScore(tok, xw));
      if (!s) return 0;
      total += s;
    }
    return total + bonus;
  }
  /** Wraps the words of a name that match what was typed in <mark>. */
  const highlighter = (tokens) => (name) => String(name).split(/(\s+)/).map((w) => {
    const n = norm(w);
    return n && tokens.some((t) => n.startsWith(t) || (t.length >= 3 && n.includes(t))) ? `<mark>${esc(w)}</mark>` : esc(w);
  }).join("");
  const SEARCH_EXAMPLES = ["Cabin", "Driveway", "Payton Trail"];
  function searchSheet() {
    const body = document.createElement("div");
    body.innerHTML = `<input id="search-input" type="search" placeholder="Type a place or trail name…" autocomplete="off" enterkeyhint="search" aria-label="Search">
      <div id="search-results" aria-live="polite"></div>`;
    const input = $("#search-input", body);
    const out = $("#search-results", body);
    const run = () => {
      const whole = norm(input.value), tokens = whole ? whole.split(" ") : [];
      out.replaceChildren();
      if (!tokens.length) {
        out.innerHTML = `<p class="note search-eg">For example: ${SEARCH_EXAMPLES.map((q) => `<button class="eg" data-q="${esc(q)}">${esc(q)}</button>`).join(", ")}…</p>`;
        $$(".eg", out).forEach((b) => b.onclick = () => { input.value = b.dataset.q; run(); input.focus(); });
        return;
      }
      const hl = highlighter(tokens);
      const rank = (list) => list.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.name.localeCompare(b.name));
      const pl = rank(featuredPlaces().map((x) => ({ x, name: placeTitle(x),
        s: searchScore(tokens, whole, placeTitle(x), `${x.f.properties.story || ""} ${KM.ICONS[x.f.properties.icon]?.[1] || ""}`) })));
      const tr = rank([...tracks.values()].map((x) => ({ x, name: x.f.properties.name,
        s: searchScore(tokens, whole, x.f.properties.name, `${(x.f.properties.directions || []).map((d) => d.label).join(" ")} ${categories[cat(x.f)]?.label || ""}`) })));
      const ph = allPhotos.map((x) => x.p).filter((p) => searchScore(tokens, whole, p.title || "", p.caption || "") > 0);
      const groups = [
        [pl[0]?.s || 0, () => { out.insertAdjacentHTML("beforeend", "<h3>Places</h3>"); pl.slice(0, 20).forEach((r) => out.append(placeRow(r.x, hl))); }],
        [tr[0]?.s || 0, () => { out.insertAdjacentHTML("beforeend", "<h3>Trails</h3>"); tr.forEach((r) => out.append(trailRow(r.x, hl))); }],
      ].filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
      groups.forEach(([, draw]) => draw());
      if (ph.length) { out.insertAdjacentHTML("beforeend", "<h3>Photos</h3>"); out.append(gallery(ph, "Search results")); }
      if (!groups.length && !ph.length) out.innerHTML = `<p class="note">Nothing found for “${esc(input.value.trim())}”. Try a shorter word, or open <b>Places</b> to see everything.</p>`;
    };
    input.oninput = run;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $(".list-row", out)?.click(); } };
    run();
    openSheet("🔍 Search", body);
    setDockActive(null);
    setTimeout(() => input.focus(), 50);
  }
  // "/" opens search on a computer, like most websites.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !$("#lightbox").hidden || $(".overlay:not([hidden])")) return;
    e.preventDefault();
    searchSheet();
  });
  $("#search-btn").onclick = searchSheet;

  // ================================================================ tour
  let tourIdx = -1;
  function startTour(i = 0) {
    if (!tour.stops.length) return toast("The tour isn't ready yet.");
    tourIdx = Math.max(0, Math.min(i, tour.stops.length - 1));
    showTourStop();
  }
  function showTourStop() {
    const stop = tour.stops[tourIdx];
    const pl = places.get(stop.place);
    if (!pl) return;
    const n = tour.stops.length;
    const title = placeTitle(pl);
    const hero = heroOf(pl);
    const text = stop.text || pl.f.properties.story || "";
    highlightTrack(null);
    selectPlace(pl.f.id);
    history.replaceState(null, "", "#tour=" + (tourIdx + 1));
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="tour-step">Stop ${tourIdx + 1} of ${n}</div>
      <div class="progress"><span style="width:${((tourIdx + 1) / n) * 100}%"></span></div>
      <div class="tour-name">${icon(pl.f.properties.icon)} ${esc(title)}</div>
      ${text ? `<p class="place-story tour-text">${esc(text)}</p>` : ""}
      ${hero ? heroImg(hero, title) : ""}
      <div class="btn-row tour-btns"><button class="big ghost" data-act="all">📷 All ${pl.photos.length} photos</button><button class="big ghost" data-act="go">🧭 Take me there</button></div>
      <div class="tour-nav">
        <button class="big ghost" data-act="prev" ${tourIdx === 0 ? "disabled" : ""}>‹ Back</button>
        <button class="big" data-act="next">${tourIdx === n - 1 ? "Finish ✓" : "Next ›"}</button>
      </div>`;
    $(".place-hero", body)?.addEventListener("click", () => openLightbox(pl.photos, Math.max(0, pl.photos.indexOf(hero)), title));
    $('[data-act="all"]', body).onclick = () => openLightbox(pl.photos, 0, title);
    $('[data-act="go"]', body).onclick = () => takeMeThere(pl);
    $('[data-act="prev"]', body).onclick = () => { tourIdx--; showTourStop(); };
    $('[data-act="next"]', body).onclick = () => {
      if (tourIdx === n - 1) { closeSheet(); fitFarm(); toast("That's the end of the tour. Thanks for visiting!"); return; }
      tourIdx++; showTourStop();
    };
    openSheet(tour.title || "Tour of the quarter", body, { onClose: () => { tourIdx = -1; } });
    setDockActive("tour");
    flyToVisible(pl.marker.getLatLng(), 18);
  }
  document.addEventListener("keydown", (e) => {
    if (tourIdx < 0 || !$("#lightbox").hidden || sheet.hidden || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight") $('#sheet [data-act="next"]')?.click();
    if (e.key === "ArrowLeft" && tourIdx > 0) $('#sheet [data-act="prev"]')?.click();
  });

  // ================================================================ more
  function seg(el, items, cur, onPick) {
    items.forEach(([k, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = k === cur ? "on" : "";
      b.onclick = () => { onPick(k); $$(":scope > button", el).forEach((x) => x.classList.toggle("on", x === b)); };
      el.append(b);
    });
  }
  function check(el, label, value, onChange) {
    const l = document.createElement("label");
    l.className = "check-row";
    l.innerHTML = `<input type="checkbox"> <span class="grow">${label}</span>`;
    const box = $("input", l);
    box.checked = value;
    box.onchange = () => onChange(box.checked);
    el.append(l);
    return box;
  }

  /** A grid that shows the first few cards and a "Show all" button for the rest. */
  function expandableGrid(el, cards, first, label) {
    cards.forEach((c, i) => { if (i >= first) c.classList.add("extra"); el.append(c); });
    if (cards.length <= first) return;
    const onIdx = cards.findIndex((c) => c.classList.contains("on"));
    const b = document.createElement("button");
    b.className = "show-all";
    const set = (open) => {
      el.classList.toggle("open", open);
      b.textContent = open ? "Show fewer ▴" : `Show all ${cards.length} ${label} ▾`;
    };
    b.onclick = () => set(!el.classList.contains("open"));
    set(onIdx >= first);
    el.after(b);
  }

  // ---- extras from Options → Labels & extras
  function applyLabelLook() {
    const el = map.getContainer();
    el.style.setProperty("--tl", adv.labelSize);
    el.classList.toggle("flow-trails", adv.flow);
    tracks.forEach((tr) => tr.label.setContent(labelText(tr.f)));
  }
  // The compass sits above the scale bar in the bottom-right corner; both are re-added together to keep that order.
  function placeCornerControls() {
    scaleCtl.remove();
    compassCtl.remove();
    if (!adv.compass) return;
    scaleCtl = L.control.scale({ position: "bottomright", metric: adv.units !== "imperial", imperial: adv.units === "imperial" }).addTo(map);
    compassCtl.addTo(map);
  }
  function setUnits(u) {
    if (adv.units === u) return;
    adv.units = u;
    placeCornerControls();
    applyLabelLook();
    if (adv.rings) setRings(true);
    if (measure.on) drawMeasure();
    refreshLegend();
  }
  // Dashed circles around the house, labelled with their distance, to judge how far things are.
  map.createPane("rings").style.zIndex = 385;
  let ringLayer = null;
  function setRings(on) {
    adv.rings = on;
    if (ringLayer) map.removeLayer(ringLayer);
    ringLayer = null;
    if (!on || !farmBounds) return;
    const home = featuredPlaces().find((pl) => pl.f.properties.icon === "house");
    const c = home ? home.marker.getLatLng() : farmBounds.getCenter();
    const radii = adv.units === "imperial" ? [152.4, 304.8, 402.34, 804.67] : [100, 250, 500, 750];
    ringLayer = L.layerGroup(radii.flatMap((r) => [
      L.circle(c, { radius: r, pane: "rings", color: "#fff", weight: 1.6, opacity: 0.85, dashArray: "5 7", fill: false, interactive: false }),
      L.marker([c.lat + r / 111320, c.lng], { pane: "rings", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="ring-lbl">${fmtLen(r)}</div>` }) }),
    ])).addTo(map);
  }

  function resetAll() {
    Object.assign(adv, ADV_DEFAULTS, { hiddenPlaces: [] });
    hiddenTracks.clear();
    setUnits("metric");
    setRings(false);
    placeCornerControls();
    applyLabelLook();
    dim = 100;
    labelsOn = true;
    setPhotos(true);
    if (!trailsOn) setTrails(true);
    setRadar(false); setWeather(false);
    applyTheme("farmhouse", { pickBase: true });
    refreshPhotos(); refreshTracks(); refreshPlaces();
    places.forEach((pl) => pl.marker.setIcon(placeIcon(pl.f)));
    declutterSoon();
  }

  const openSections = new Set(isPhone() ? [] : ["look"]);
  function moreSheet() {
    const body = document.createElement("div");
    body.className = "opts";
    const sec = (id, ic, title, sub, inner, extra = "") =>
      `<details class="opt-sec ${extra}" data-sec="${id}" ${openSections.has(id) ? "open" : ""}>
        <summary><span class="os-ic">${ic}</span><span class="os-txt"><b>${title}</b><small data-sum="${id}">${sub}</small></span><span class="os-chev">›</span></summary>
        <div class="os-body">${inner}</div></details>`;
    body.innerHTML = `
      <button class="big reset-top" id="m-reset">↺ Reset to original settings</button>
      ${sec("look", "🎨", "Look", esc(THEMES[theme].label), `<div class="theme-grid" id="m-theme"></div>`)}
      ${sec("style", "🗺️", "Map style", esc(BASEMAPS[baseKey]?.label || ""), `<div class="style-grid" id="m-base"></div>`)}
      ${sec("layers", "🌦️", "Weather", "Live precipitation radar and current weather", `<div id="m-over"></div>`)}
      ${sec("show", "👁️", "What's on the map", "Trails, names, photos", `<div id="m-basic"></div>`)}
      ${sec("text", "🔠", "Text size", SIZE_NAMES[sizeIdx], `<div class="seg" id="m-size"></div>`)}
      ${sec("save", "💾", "Print & offline", "Print this view, use without internet", `
        <p class="note">Prints exactly what you see now: the look, map style and filters you picked.</p>
        <button class="big ghost" id="m-print">🖨️ Print this map</button>
        <div class="os-div"></div><div id="m-offline"></div>`)}
      <div class="adv-label"><span class="adv-badge">ADVANCED</span> For people who like to fine-tune</div>
      ${sec("colours", "🖍️", "Trail colours & lines", "Colour, line style, outline, thickness, brightness", `
        <h4>Colour trails by</h4><div class="seg" id="a-colour"></div>
        <h4>Trail colour <small>(for “One colour”)</small></h4><div class="swatches" id="a-swatch"></div>
        <h4>Line style</h4><div class="seg" id="a-style"></div>
        <h4>Line thickness</h4><div class="seg" id="a-thick"></div>
        <h4>Trail see-through</h4><div class="range-row"><span class="rr-l">Faint</span><input type="range" id="a-lineop" min="20" max="100" step="5" aria-label="Trail opacity"><span class="rr-l">Solid</span></div>
        <h4>Map brightness</h4><div class="range-row"><span>🌑</span><input type="range" id="a-dim" min="35" max="100" step="5" aria-label="Map brightness"><span>☀️</span></div>
        <div id="a-linechecks"></div>`, "advsec")}
      ${sec("filter", "🔎", "Filter trails & places", "Length, steepness, places", `
        <p class="note filter-count" id="a-count"></p>
        <h4>Trail length</h4><div class="seg" id="a-length"></div>
        <h4>Steepness</h4><div class="seg" id="a-steep"></div>
        <h4>Places <small>(tap to hide or show)</small></h4><div class="chips" id="a-types"></div>
        <div class="btn-row mini-btns"><button class="chip" id="a-types-all">Show all</button><button class="chip" id="a-types-none">Hide all</button></div>`, "advsec")}
      ${sec("labels", "🏷️", "Labels & extras", "Name size, rings, compass, units, shading", `
        <h4>Trail name size</h4><div class="seg" id="a-lsize"></div>
        <h4>Distances in</h4><div class="seg" id="a-units"></div>
        <h4>On the map</h4><div id="a-checks"></div>`, "advsec")}
      ${sec("pick", "〰️", "Trails one by one", "Turn single trails on or off", `<div id="m-tracks"></div>`, "advsec")}`;
    $$(".opt-sec", body).forEach((d) => d.addEventListener("toggle", () => { if (d.open) openSections.add(d.dataset.sec); else openSections.delete(d.dataset.sec); }));
    const setSum = (id, text) => { const el = $(`[data-sum="${id}"]`, body); if (el) el.textContent = text; };

    // looks
    const tg = $("#m-theme", body);
    const tCards = Object.entries(THEMES).map(([k, t]) => {
      const b = document.createElement("button");
      b.className = "theme-card" + (k === theme ? " on" : "");
      b.dataset.k = k;
      b.innerHTML = `<span class="theme-sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${esc(t.label)}</b><small>${esc(t.note)}</small>`;
      b.onclick = () => {
        applyTheme(k, { pickBase: true });
        $$(".theme-card", tg).forEach((x) => x.classList.toggle("on", x === b));
        $$(".style-card", body).forEach((x) => x.classList.toggle("on", x.dataset.k === baseKey));
        setSum("look", t.label); setSum("style", BASEMAPS[baseKey].label);
        refreshLegend();
      };
      return b;
    });
    expandableGrid(tg, tCards, 6, "looks");
    const bg = $("#m-base", body);
    const sCards = Object.entries(BASEMAPS).map(([k, m]) => {
      const b = document.createElement("button");
      b.className = "style-card" + (k === baseKey ? " on" : "");
      b.dataset.k = k;
      b.innerHTML = `<span class="style-sw sw-${k}" style="background:${m.swatch}"></span><span>${esc(m.label)}</span>`;
      b.onclick = () => { setBase(k); $$(".style-card", bg).forEach((x) => x.classList.toggle("on", x === b)); setSum("style", m.label); };
      return b;
    });
    expandableGrid(bg, sCards, 6, "map styles");

    const ov = $("#m-over", body);
    check(ov, "🌦️ Live precipitation radar (rain &amp; snow)", overlays.radar, setRadar).dataset.over = "radar";
    check(ov, "⛅ Weather at the quarter right now", overlays.weather, setWeather);

    const basic = $("#m-basic", body);
    check(basic, `${TRAIL_SVG} Trails &amp; driveway`, trailsOn, (v) => setTrails(v));
    check(basic, "🏷️ Trail names (when zoomed in)", labelsOn, (v) => { labelsOn = v; refreshTracks(); declutterSoon(); });
    check(basic, "🔤 Place names next to pins", adv.placeNames, (v) => { adv.placeNames = v; places.forEach((pl) => pl.marker.setIcon(placeIcon(pl.f, pl.f.id === selectedPlace))); declutterSoon(); });
    check(basic, "📷 Photos on the map <small>(grouped with a count; they spread out as you zoom in)</small>", photosOn, (v) => setPhotos(v));
    seg($("#m-size", body), SIZE_NAMES.map((l, i) => [i, l]), sizeIdx, (i) => { sizeIdx = i; store.set("textSize", i); applySize(); setSum("text", SIZE_NAMES[i]); });
    $("#m-print", body).onclick = printMap;
    offlinePanel($("#m-offline", body));

    // ---- advanced
    const restyleAll = () => { tracks.forEach(restyle); refreshLegend(); $$("#m-tracks .swatch", body).forEach((s) => { s.style.background = trailColour(tracks.get(s.dataset.id).f); }); };
    const colourSeg = $("#a-colour", body);
    seg(colourSeg, [["simple", "One colour"], ["each", "Each trail"], ["steep", "Steepness"], ["length", "Length"]],
      adv.colourMode, (v) => { adv.colourMode = v; restyleAll(); });
    // Swatches for the single trail colour; the first follows the look.
    const swEl = $("#a-swatch", body);
    [[null, "Look’s colour"], ["#ffffff", "White"], ["#fff3a0", "Cream"], ["#ffd400", "Yellow"], ["#ff9f1a", "Orange"], ["#ff5a1f", "Red-orange"],
      ["#e0201b", "Red"], ["#ff4fa3", "Pink"], ["#c93de0", "Magenta"], ["#8c6bff", "Purple"], ["#2f7bff", "Blue"], ["#00d7ff", "Cyan"],
      ["#2fe08a", "Green"], ["#b6f23c", "Lime"]].forEach(([c, name]) => {
      const b = document.createElement("button");
      b.className = "sw-dot" + (adv.trailColour === c ? " on" : "") + (c ? "" : " theme");
      b.style.background = c || THEMES[theme].lines.trail;
      b.title = name;
      b.setAttribute("aria-label", "Trail colour: " + name);
      b.onclick = () => {
        adv.trailColour = c;
        $$(".sw-dot", swEl).forEach((x) => x.classList.toggle("on", x === b));
        if (adv.colourMode !== "simple") { adv.colourMode = "simple"; $$(":scope > button", colourSeg).forEach((x, i) => x.classList.toggle("on", i === 0)); }
        restyleAll();
      };
      swEl.append(b);
    });
    seg($("#a-style", body), [["theme", "Look’s own"], ["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]], adv.lineStyle,
      (v) => { adv.lineStyle = v; tracks.forEach(restyle); });
    seg($("#a-thick", body), [[0.7, "Thin"], [1, "Normal"], [1.4, "Thick"], [1.9, "Extra"]], adv.thickness,
      (v) => { adv.thickness = v; restyleAll(); });
    const dimEl = $("#a-dim", body);
    dimEl.value = dim;
    dimEl.oninput = () => { dim = +dimEl.value; applyMapLook(); };
    const opEl = $("#a-lineop", body);
    opEl.value = adv.lineOpacity;
    opEl.oninput = () => { adv.lineOpacity = +opEl.value; tracks.forEach(restyle); };
    const lc = $("#a-linechecks", body);
    check(lc, "Dark outline around trails <small>(helps them stand out on the photo)</small>", adv.outline, (v) => { adv.outline = v; tracks.forEach(restyle); });
    check(lc, "Moving trails <small>(dashes flow along every trail)</small>", adv.flow, (v) => { adv.flow = v; applyLabelLook(); });

    const countEl = $("#a-count", body);
    const updateCount = () => {
      const tr = [...tracks.values()].filter((x) => cat(x.f) === "trails");
      const shownT = tr.filter((x) => !hiddenTracks.has(x.f.id) && passesTrailFilters(x.f)).length;
      const fp = featuredPlaces(), shownP = fp.filter((pl) => !adv.hiddenPlaces.includes(pl.f.id)).length;
      countEl.innerHTML = `Showing <b>${shownT} of ${tr.length}</b> trails · <b>${shownP} of ${fp.length}</b> places`;
    };
    const refilter = () => { refreshTracks(); refreshPlaces(); declutterSoon(); updateCount(); };
    seg($("#a-length", body), [["all", "Any"], ["short", "Under " + fmtLen(250)], ["medium", fmtLen(250) + "–" + fmtLen(600)], ["long", "Over " + fmtLen(600)]],
      adv.lengthFilter, (v) => { adv.lengthFilter = v; refilter(); });
    seg($("#a-steep", body), [["all", "Any"], ["flat", "Flat"], ["gentle", "Gentle"], ["hilly", "Hilliest"]],
      adv.steepFilter, (v) => { adv.steepFilter = v; refilter(); });
    // One chip per named place, with the same name and icon as on the map, so renaming a place renames its chip too.
    const named = featuredPlaces().sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
    const tyEl = $("#a-types", body);
    const typeBtns = named.map((pl) => {
      const b = document.createElement("button"), id = pl.f.id;
      const on = () => !adv.hiddenPlaces.includes(id);
      b.className = "chip toggle" + (on() ? " on" : "");
      b.innerHTML = `${icon(pl.f.properties.icon)} ${esc(placeTitle(pl))}`;
      b.onclick = () => {
        adv.hiddenPlaces = on() ? [...adv.hiddenPlaces, id] : adv.hiddenPlaces.filter((x) => x !== id);
        b.classList.toggle("on", on());
        refilter();
      };
      tyEl.append(b);
      return b;
    });
    const allTypes = (show) => { adv.hiddenPlaces = show ? [] : named.map((pl) => pl.f.id); typeBtns.forEach((b) => b.classList.toggle("on", show)); refilter(); };
    $("#a-types-all", body).onclick = () => allTypes(true);
    $("#a-types-none", body).onclick = () => allTypes(false);
    updateCount();

    seg($("#a-lsize", body), [[0.85, "Small"], [1, "Normal"], [1.25, "Large"], [1.5, "Huge"]], adv.labelSize, (v) => { adv.labelSize = v; applyLabelLook(); declutterSoon(); });
    seg($("#a-units", body), [["metric", "Metres & km"], ["imperial", "Feet & miles"]], adv.units, (v) => {
      setUnits(v);
      const sc = $("#sheet-body").scrollTop;
      moreSheet();
      $("#sheet-body").scrollTop = sc;
    });
    const ac = $("#a-checks", body);
    check(ac, "⭕ Distance rings around the house", adv.rings, setRings);
    check(ac, "➜ Direction arrows on named trails", adv.dirArrows, (v) => { adv.dirArrows = v; refreshTracks(); });
    check(ac, "📏 Trail lengths next to trail names", adv.labelLengths, (v) => { adv.labelLengths = v; applyLabelLook(); declutterSoon(); });
    check(ac, "🧭 Compass and scale bar", adv.compass, (v) => { adv.compass = v; placeCornerControls(); });
    check(ac, "📷 Small photo spots <small>(when zoomed in)</small>", adv.minorSpots, (v) => { adv.minorSpots = v; refilter(); });
    check(ac, "🗂️ Group nearby photos together", adv.cluster, (v) => { adv.cluster = v; refreshPhotos(); });
    check(ac, "🟩 Shade inside the property line", adv.boundaryFill, (v) => { adv.boundaryFill = v; restyleAll(); });

    const list = $("#m-tracks", body);
    const cats = {};
    tracks.forEach((t) => (cats[cat(t.f)] ||= []).push(t));
    Object.keys(cats).sort((a, b) => (categories[a]?.order ?? 99) - (categories[b]?.order ?? 99)).forEach((c) => {
      const items = cats[c].sort((a, b) => a.f.properties.name.localeCompare(b.f.properties.name));
      const head = document.createElement("label");
      head.className = "check-row group";
      head.innerHTML = `<input type="checkbox"> <span class="grow">${esc(categories[c]?.label || c)}</span><small>${items.length}</small>`;
      const sub = document.createElement("div");
      sub.className = "sub-list";
      const master = $("input", head);
      const boxes = items.map((t) => {
        const r = document.createElement("div");
        r.className = "check-row";
        r.innerHTML = `<input type="checkbox" id="t-${esc(t.f.id)}"> <span class="swatch" data-id="${esc(t.f.id)}" style="background:${esc(trailColour(t.f))}"></span>
          <label class="grow" for="t-${esc(t.f.id)}">${esc(t.f.properties.name)}</label>
          <button class="round mini" aria-label="About ${esc(t.f.properties.name)}">›</button>`;
        const box = $("input", r);
        box.checked = !hiddenTracks.has(t.f.id);
        box.onchange = () => { setTrackHidden(t.f.id, !box.checked); sync(); };
        $("button", r).onclick = () => openTrail(t.f.id, { back: true });
        sub.append(r);
        return box;
      });
      const sync = () => { master.checked = boxes.every((b) => b.checked); master.indeterminate = !master.checked && boxes.some((b) => b.checked); };
      master.onchange = () => boxes.forEach((b, i) => { b.checked = master.checked; setTrackHidden(items[i].f.id, !master.checked); });
      sync();
      list.append(head, sub);
    });
    $("#m-reset", body).onclick = () => { resetAll(); toast("Back to the original settings."); moreSheet(); };
    openSheet("⚙️ Options", body);
    $("#options-btn").classList.add("active");
  }

  function setTrackHidden(id, hide) {
    if (hide) hiddenTracks.add(id); else hiddenTracks.delete(id);
    refreshTracks();
    declutterSoon();
  }
  function setTrails(on) {
    trailsOn = on;
    $('#dock [data-act="trails"]').setAttribute("aria-pressed", on);
    refreshTracks();
    declutterSoon();
    toast(on ? "Trails are showing" : "Trails are hidden", 1500);
  }
  function setPhotos(on) {
    photosOn = on;
    $('#dock [data-act="photos"]')?.setAttribute("aria-pressed", on);
    refreshPhotos();
  }

  // ================================================================ lightbox (zoom, pan, swipe, filmstrip)
  const lb = $("#lightbox");
  const stage = $(".lb-stage", lb);
  const lbImg = $("img", stage);
  let lbList = [], lbIdx = 0, lbTitle = "";
  let zs = 1, zx = 0, zy = 0;
  function applyZoom() {
    lbImg.style.transform = `translate(${zx}px, ${zy}px) scale(${zs})`;
    stage.classList.toggle("zoomed", zs > 1.01);
    $('[data-lb="zoom"]', lb).textContent = zs > 1.01 ? "↩ Fit to screen" : "🔍 Zoom";
  }
  function clampPan() {
    const r = stage.getBoundingClientRect();
    // The photo is fitted inside the stage (letterboxed), so work out the size it is actually drawn at.
    const iw = lbImg.naturalWidth || r.width, ih = lbImg.naturalHeight || r.height;
    const fit = Math.min(r.width / iw, r.height / ih);
    const lx = Math.max(0, (iw * fit * zs - r.width) / 2);
    const ly = Math.max(0, (ih * fit * zs - r.height) / 2);
    zx = Math.max(-lx, Math.min(lx, zx));
    zy = Math.max(-ly, Math.min(ly, zy));
  }
  function zoomAt(clientX, clientY, s2) {
    const r = stage.getBoundingClientRect();
    const qx = clientX - (r.left + r.width / 2), qy = clientY - (r.top + r.height / 2);
    s2 = Math.max(1, Math.min(5, s2));
    zx = qx - (s2 / zs) * (qx - zx);
    zy = qy - (s2 / zs) * (qy - zy);
    zs = s2;
    if (zs === 1) { zx = 0; zy = 0; }
    clampPan();
    applyZoom();
  }
  function resetZoom() { zs = 1; zx = 0; zy = 0; applyZoom(); }

  let lbReturn = null;   // what had focus before the photo opened, so it gets it back afterwards
  function openLightbox(list, idx, title) {
    lbList = list; lbIdx = idx; lbTitle = title;
    const strip = $(".lb-strip", lb);
    strip.innerHTML = list.length > 1 ? list.map((p, i) => `<button data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(photoUrl(p, "thumb"))}" alt="" loading="lazy"></button>`).join("") : "";
    $$("button", strip).forEach((b) => b.onclick = () => { lbIdx = +b.dataset.i; drawLightbox(); });
    drawLightbox();
    if (lb.hidden) lbReturn = document.activeElement;
    lb.hidden = false;
    pushBack("lightbox");
    focusQuietly($(".lb-close", lb));
  }
  let lbWant = "";
  function drawLightbox() {
    const p = lbList[lbIdx];
    resetZoom();
    // Flicking through never waits on a blank screen: a photo that's ready shows at once; otherwise its small copy
    // (usually already loaded for the map or gallery) shows until the full photo has arrived and been decoded.
    const full = photoUrl(p), hi = new Image();
    lbWant = full;
    hi.src = full;
    if (hi.complete && hi.naturalWidth) lbImg.src = full;
    else {
      lbImg.src = photoUrl(p, "thumb");
      hi.decode().then(() => { if (lbWant === full) lbImg.src = full; }, () => {});
    }
    lbImg.alt = p.title || lbTitle;
    const cap = p.title || lbTitle;
    // Where it was taken, from the map data (the photo files themselves carry no location); tapping opens Google Maps there.
    const at = allPhotos.find((a) => a.p === p)?.m.getLatLng();
    const where = at ? `<br><a class="lb-coords" href="https://www.google.com/maps/search/?api=1&amp;query=${at.lat.toFixed(6)},${at.lng.toFixed(6)}"
      target="_blank" rel="noopener" aria-label="Open where this photo was taken in Google Maps">📍 ${Math.abs(at.lat).toFixed(5)}° ${at.lat < 0 ? "S" : "N"},
      ${Math.abs(at.lng).toFixed(5)}° ${at.lng < 0 ? "W" : "E"}</a>` : "";
    $(".lb-cap", lb).innerHTML = `<b>${esc(cap)}</b>${p.caption ? `<br>${esc(p.caption)}` : ""}<br><small>${esc(fmtDate(p.taken))}${lbList.length > 1 ? ` · photo ${lbIdx + 1} of ${lbList.length}` : ""}${where}</small>`;
    const multi = lbList.length > 1;
    $(".lb-prev", lb).hidden = !multi;
    $(".lb-next", lb).hidden = !multi;
    $$(".lb-strip button", lb).forEach((b, i) => b.classList.toggle("on", i === lbIdx));
    $(".lb-strip button.on", lb)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    if (multi) [1, -1].forEach((d) => { new Image().src = photoUrl(lbList[(lbIdx + d + lbList.length) % lbList.length]); });   // the ones either side
  }
  const step = (d) => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; drawLightbox(); };
  function closeLb(fromBackButton = false) {
    if (fromBackButton !== true) dropBack("lightbox");
    lb.hidden = true;
    resetZoom();
    if (lbReturn?.isConnected && !lbReturn.closest("[hidden]")) lbReturn.focus({ preventScroll: true });
    lbReturn = null;
  }
  $(".lb-close", lb).onclick = () => closeLb();
  $(".lb-prev", lb).onclick = () => step(-1);
  $(".lb-next", lb).onclick = () => step(1);
  $('[data-lb="zoom"]', lb).onclick = () => {
    const r = stage.getBoundingClientRect();
    if (zs > 1.01) resetZoom(); else zoomAt(r.left + r.width / 2, r.top + r.height / 2, 2.5);
  };
  $('[data-lb="map"]', lb).onclick = () => {
    const p = lbList[lbIdx];
    const x = allPhotos.find((a) => a.p === p);
    if (!x) return;
    closeLb();
    if (isPhone()) closeSheet();
    const ll = x.m.getLatLng();
    flyToVisible(ll, 19);
    const pulse = L.marker(ll, { icon: L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="pulse"><span></span></div>' }), interactive: false }).addTo(map);
    setTimeout(() => map.removeLayer(pulse), 4200);
  };
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  const ptrs = new Map();
  let gesture = null, lastTap = 0;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) gesture = { type: "drag", sx: e.clientX, sy: e.clientY, zx, zy, moved: false };
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture = { type: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), s: zs };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId) || !gesture) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === "pinch" && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.s * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d);
    } else if (gesture.type === "drag") {
      const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
      if (zs > 1.01) { zx = gesture.zx + dx; zy = gesture.zy + dy; clampPan(); applyZoom(); }
    }
  });
  const endPtr = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (gesture?.type === "drag" && ptrs.size === 0) {
      const dx = e.clientX - gesture.sx;
      if (zs <= 1.01 && Math.abs(dx) > 60 && lbList.length > 1) step(dx < 0 ? 1 : -1);
      else if (!gesture.moved) {
        const now = Date.now();
        if (now - lastTap < 320) { zoomAt(e.clientX, e.clientY, zs > 1.01 ? 1 : 2.5); lastTap = 0; } else lastTap = now;
      }
    }
    if (ptrs.size === 0) gesture = null;
    else if (ptrs.size === 1) { const [p] = [...ptrs.values()]; gesture = { type: "drag", sx: p.x, sy: p.y, zx, zy, moved: true }; }
  };
  stage.addEventListener("pointerup", endPtr);
  stage.addEventListener("pointercancel", endPtr);
  stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, zs * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });

  // ================================================================ extra layers: precipitation radar, weather
  const overlays = { radar: false, weather: false };

  // Radar tiles are RainViewer's (Universal Blue colours, smoothed, snow drawn in its own colours). They only go to zoom 7,
  // so the panel also says what is falling at the farm itself (Open-Meteo), and its icon follows that.
  const radar = { frames: [], layers: new Map(), idx: 0, timer: null, refresh: null, host: "", loadedAt: 0, past: 0, speed: 700, opacity: 0.7 };
  const rp = () => $("#radar-panel"), pill = () => $("#radar-pill");
  // Computers get the floating panel. Phones get a slim bar that plays the radar on its own; the bar opens the full
  // controls in the sheet. CSS picks which one shows, so turning the phone round just works.
  async function setRadar(on) {
    overlays.radar = on;
    const panel = rp();
    clearInterval(radar.refresh);
    radar.resume = false;
    refreshLegend();
    if (!on) {
      stopRadarPlay();
      radar.layers.forEach((l) => map.removeLayer(l));
      if (panel.classList.contains("in-sheet")) closeSheet();
      panel.hidden = pill().hidden = true;
      $$('[data-over="radar"]').forEach((x) => { x.checked = false; });
      return;
    }
    panel.hidden = pill().hidden = false;
    updateWideBtn();
    showFarmPrecip();
    // Left open, it keeps itself current: new radar frames every few minutes, farm conditions every 10.
    radar.refresh = setInterval(() => {
      loadRadar().then(() => { if (overlays.radar && !radar.timer) showRadarFrame(radar.idx); }).catch(() => {});
      showFarmPrecip();
    }, 5 * 60e3);
    if (!radar.frames.length) setRadarTime("Loading…");
    try { await loadRadar(); } catch { /* fall back to the frames we already have */ }
    if (!overlays.radar) return;
    if (!radar.frames.length) return setRadarTime("Radar isn't available right now");
    showRadarFrame(radar.past - 1);
    if (smallMQ.matches && !radar.timer) startRadarPlay();
  }
  function setRadarTime(text) { $(".rp-time", rp()).textContent = text; $(".rpp-time", pill()).textContent = text; }
  async function loadRadar() {
    if (radar.frames.length && Date.now() - radar.loadedAt < 4 * 60e3) return;
    const j = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const past = j.radar?.past || [], frames = [...past, ...(j.radar?.nowcast || [])];
    if (!frames.length) throw new Error("no radar frames");
    // Stay on the frame being looked at, unless that was the latest one (then follow the new latest).
    const wasLatest = !radar.frames.length || radar.idx === radar.past - 1, shown = radar.frames[radar.idx]?.time;
    radar.host = j.host;
    radar.past = past.length;
    radar.frames = frames;
    radar.loadedAt = Date.now();
    const keep = new Set(frames.map((f) => f.path));
    radar.layers.forEach((l, path) => { if (!keep.has(path)) { map.removeLayer(l); radar.layers.delete(path); } });
    const same = frames.findIndex((f) => f.time === shown);
    radar.idx = wasLatest || same < 0 ? radar.past - 1 : same;
    const panel = rp();
    $(".rp-slider", panel).max = frames.length - 1;
    $(".rp-ticks", panel).innerHTML = frames.map((f, i) => `<i class="${i >= radar.past ? "fc" : ""}${i === radar.past - 1 ? " now" : ""}"></i>`).join("");
  }
  function radarLayer(i) {
    const f = radar.frames[i];
    if (!radar.layers.has(f.path)) {
      radar.layers.set(f.path, L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
        { pane: "radar", opacity: 0, maxNativeZoom: 7, maxZoom: 22, attribution: "Radar © RainViewer" }));
    }
    return radar.layers.get(f.path);
  }
  function showRadarFrame(i) {
    if (!radar.frames.length) return;
    radar.idx = Math.max(0, Math.min(radar.frames.length - 1, i));
    const cur = radarLayer(radar.idx);
    if (!map.hasLayer(cur)) cur.addTo(map);
    cur.setOpacity(radar.opacity);
    radar.layers.forEach((l) => { if (l !== cur) l.setOpacity(0); });
    [radar.idx + 1, radar.idx + 2].forEach((k) => { if (k < radar.frames.length) { const n = radarLayer(k); if (!map.hasLayer(n)) n.addTo(map); } });
    const panel = rp();
    const t = new Date(radar.frames[radar.idx].time * 1000);
    const mins = Math.round((t - Date.now()) / 60000);
    const ago = Math.abs(mins), span = ago >= 60 ? `${Math.floor(ago / 60)} h${ago % 60 ? ` ${ago % 60} min` : ""}` : `${ago} min`;
    const rel = ago < 5 ? "now" : mins < 0 ? `${span} ago` : `in ${span}`;
    const forecast = radar.idx >= radar.past;
    const hhmm = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    $(".rp-time", panel).innerHTML = `<b>${hhmm}</b> · ${rel}${forecast ? ' <span class="rp-fc">forecast</span>' : ""}`;
    $(".rpp-time", pill()).textContent = `Radar ${shortTime(hhmm)} · ${forecast ? "forecast" : rel}`;
    $(".rp-slider", panel).value = radar.idx;
    $$(".rp-ticks i", panel).forEach((el, k) => el.classList.toggle("on", k === radar.idx));
  }
  const PLAY_SVG = `<svg class="pb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
  const PAUSE_SVG = `<svg class="pb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5.5h4v13h-4zM13.5 5.5h4v13h-4z" fill="currentColor"/></svg>`;
  function stopRadarPlay() {
    clearInterval(radar.timer);
    radar.timer = null;
    $$('[data-rp="play"]').forEach((b) => { b.innerHTML = PLAY_SVG; b.setAttribute("aria-label", "Play"); });
  }
  function startRadarPlay() {
    stopRadarPlay();
    $$('[data-rp="play"]').forEach((b) => { b.innerHTML = PAUSE_SVG; b.setAttribute("aria-label", "Pause"); });
    if (radar.idx >= radar.frames.length - 1) showRadarFrame(0);
    radar.timer = setInterval(() => {
      if (radar.idx >= radar.frames.length - 1) showRadarFrame(0); else showRadarFrame(radar.idx + 1);
    }, radar.speed);
  }
  // Radar is only detailed down to about zoom 7, so one tap zooms out to the surrounding area and back.
  const isWide = () => map.getZoom() < 10;
  function updateWideBtn() {
    $$('[data-rp="wide"]').forEach((b) => { b.textContent = isWide() ? "🏠 Back to farm" : "🔭 Wider view"; });
  }
  map.on("zoomend", () => { if (overlays.radar) updateWideBtn(); });
  (() => {
    const panel = rp();
    panel.addEventListener("click", (e) => {
      const act = e.target.closest("[data-rp]")?.dataset.rp;
      if (!act) return;
      if (act === "close") return setRadar(false);
      if (act === "wide") return isWide() ? fitFarm() : map.flyTo(farmBounds.getCenter(), 8);
      if (act === "play") return radar.timer ? stopRadarPlay() : startRadarPlay();
      stopRadarPlay();
      if (act === "first") showRadarFrame(0);
      if (act === "back") showRadarFrame(radar.idx - 1);
      if (act === "fwd") showRadarFrame(radar.idx + 1);
      if (act === "now") showRadarFrame(radar.past - 1);
      if (act === "speed") {
        const speeds = [[1100, "Slow"], [700, "Normal"], [350, "Fast"]];
        const i = (speeds.findIndex(([ms]) => ms === radar.speed) + 1) % speeds.length;
        radar.speed = speeds[i][0];
        $$('[data-rp="speed"]', panel).forEach((b) => { b.textContent = "Speed: " + speeds[i][1]; });
      }
    });
    $(".rp-slider", panel).oninput = (e) => { stopRadarPlay(); showRadarFrame(+e.target.value); };
    $(".rp-opacity", panel).oninput = (e) => { radar.opacity = +e.target.value / 100; showRadarFrame(radar.idx); };

    const bar = pill();
    $(".rpp-play", bar).onclick = () => (radar.timer ? stopRadarPlay() : startRadarPlay());
    $(".rpp-x", bar).onclick = () => setRadar(false);
    $(".rpp-open", bar).onclick = () => {
      const wrap = document.createElement("div");
      wrap.className = "rp-sheet";
      panel.classList.add("in-sheet");
      const off = document.createElement("button");
      off.className = "big ghost rp-off";
      off.textContent = "Turn off the radar";
      off.onclick = () => setRadar(false);
      wrap.append(panel, off);
      openSheet(`${$(".rp-icon", panel).textContent} Precipitation`, wrap);
    };
  })();
  // No point animating (and downloading) radar frames nobody can see: pause while the tab or app is in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && radar.timer) { stopRadarPlay(); radar.resume = true; }
    else if (!document.hidden && radar.resume) { radar.resume = false; if (overlays.radar) startRadarPlay(); }
  });

  const WX = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Frosty fog"],
    51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"], 56: ["🧊", "Light freezing drizzle"], 57: ["🧊", "Freezing drizzle"],
    61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 66: ["🧊", "Light freezing rain"], 67: ["🧊", "Freezing rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Heavy snow showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm, hail"], 99: ["⛈️", "Thunderstorm, hail"] };
  // What kind of precipitation a weather code means (null = nothing falling).
  const PRECIP = { snow: ["🌨️", "Snow"], ice: ["🧊", "Freezing rain"], storm: ["⛈️", "Thunderstorms"], rain: ["🌧️", "Rain"] };
  const precipKind = (code) => ([71, 73, 75, 77, 85, 86].includes(code) ? "snow" : [56, 57, 66, 67].includes(code) ? "ice"
    : code >= 95 ? "storm" : (code >= 51 && code <= 65) || (code >= 80 && code <= 82) ? "rain" : null);
  const clock = (unix) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // "8:22pm" instead of "8:22 p.m." for the slim radar bar on phones (24-hour times stay as they are).
  const shortTime = (s) => s.replace(/\s*([ap])\.?\s?m\.?/i, (m, x) => x.toLowerCase() + "m");

  // Open-Meteo at the middle of the quarter, shared by the weather chip and the radar panel; fetched again after 10 minutes.
  let wxCache = null;
  function farmWx() {
    if (wxCache && Date.now() - wxCache.at < 10 * 60e3) return wxCache.p;
    const c = farmBounds.getCenter();
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(4)}&longitude=${c.lng.toFixed(4)}` +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m" +
      "&hourly=weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,sunset" +
      "&timezone=America%2FEdmonton&timeformat=unixtime&wind_speed_unit=kmh&forecast_days=2&forecast_hours=7";
    const p = fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    wxCache = { at: Date.now(), p };
    p.catch(() => { if (wxCache?.p === p) wxCache = null; });
    return p;
  }

  // "Light snow at the farm now · easing around 3 PM", or "Dry · rain likely around 5 PM (70%)".
  async function showFarmPrecip() {
    const panel = rp(), text = $(".rp-now-text", panel), icon = $(".rp-icon", panel);
    try {
      const { current: cur, hourly: h } = await farmWx();
      const now = Date.now() / 1000, kindNow = precipKind(cur.weather_code);
      let next = null, clears = null;
      h.time.forEach((t, i) => {
        if (t <= now || t > now + 6.5 * 3600) return;
        const k = precipKind(h.weather_code[i]);
        if (!kindNow && k && !next) next = { k, t, p: h.precipitation_probability?.[i] };
        if (kindNow && !k && !clears) clears = t;
      });
      const temp = `${Math.round(cur.temperature_2m)}°C`;
      let line, sub, short;
      if (kindNow) {
        line = `${WX[cur.weather_code][1]} at the farm now`;
        sub = clears ? `easing around ${clock(clears)}` : "keeping up for the next few hours";
        short = `${WX[cur.weather_code][1]} now · ${clears ? `easing ${shortTime(clock(clears))}` : "for a while"}`;
      } else if (next) {
        const odds = next.p == null || next.p >= 60 ? "likely" : "possible";
        line = "Dry at the farm now";
        sub = `${PRECIP[next.k][1].toLowerCase()} ${odds} around ${clock(next.t)}${next.p == null ? "" : ` (${next.p}%)`}`;
        short = `Dry now · ${PRECIP[next.k][1].toLowerCase()} ${odds === "likely" ? "likely" : "maybe"} ${shortTime(clock(next.t))}`;
      } else {
        line = "Dry at the farm now";
        sub = "nothing expected in the next 6 hours";
        short = "Dry now · none expected soon";
      }
      const kind = kindNow || next?.k || (cur.temperature_2m <= 0 ? "snow" : "rain");
      icon.textContent = $(".rpp-icon", pill()).textContent = PRECIP[kind][0];
      $(".rpp-now", pill()).textContent = short;
      text.innerHTML = `<b>${esc(line)}</b><small>${esc(temp)} · ${esc(sub)}</small>`;
    } catch {
      icon.textContent = $(".rpp-icon", pill()).textContent = "🌦️";
      text.innerHTML = "<small>Conditions at the farm aren't available right now</small>";
      $(".rpp-now", pill()).textContent = "Precipitation radar";
    }
  }

  let wxTimer = null;
  async function setWeather(on) {
    overlays.weather = on;
    const chip = $("#wx-chip");
    clearInterval(wxTimer);
    if (!on) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = "Checking the weather at the quarter…";
    const load = async () => {
      try {
        const { current: cur, daily: d } = await farmWx();
        const [emo, text] = WX[cur.weather_code] || ["🌡️", ""];
        const sunset = d.sunset?.[0] ? clock(d.sunset[0]) : "";
        chip.innerHTML = `<b>${emo} ${Math.round(cur.temperature_2m)}°C</b> ${esc(text)} · feels ${Math.round(cur.apparent_temperature)}°<br>
          <small>Wind ${Math.round(cur.wind_speed_10m)} km/h <span class="wx-long">from the ${compass(cur.wind_direction_10m)}</span><span class="wx-short">${compassShort(cur.wind_direction_10m)}</span> · High ${Math.round(d.temperature_2m_max[0])}° Low ${Math.round(d.temperature_2m_min[0])}°${sunset ? " · Sunset " + sunset : ""}</small>`;
      } catch { chip.textContent = "Weather isn't available right now."; }
    };
    await load();
    wxTimer = setInterval(load, 15 * 60e3);
  }

  // ================================================================ measure
  // Tap to drop points; each new tap measures on from the last one. Points snap onto named places when tapped
  // close to one, can be dragged to adjust, and Undo / Clear / Done are always one tap away.
  const measure = { on: false, pts: [], layer: L.layerGroup(), line: null };
  map.createPane("measure").style.zIndex = 650;
  const fmtDist = (m) => (adv.units === "imperial" ? (m * 3.28084 < 1000 ? (m * 3.28084).toFixed(m < 30 ? 1 : 0) + " ft" : (m / 1609.34).toFixed(2) + " mi")
    : m >= 1000 ? (m / 1000).toFixed(2) + " km" : m >= 100 ? Math.round(m) + " m" : m.toFixed(1) + " m");
  // The other unit, shown smaller under the total.
  const altDist = (m) => (adv.units === "imperial" ? (m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m") : Math.round(m * 3.28084).toLocaleString() + " ft");
  function snapToPlace(ll, cp) {
    let best = null;
    featuredPlaces().forEach((pl) => {
      const d = map.latLngToContainerPoint(pl.marker.getLatLng()).distanceTo(cp);
      if (d < 26 && (!best || d < best.d)) best = { d, pl };
    });
    return best ? { ll: best.pl.marker.getLatLng(), name: placeTitle(best.pl) } : { ll, name: null };
  }
  function addMeasurePoint(ll, cp) {
    const snap = snapToPlace(ll, cp);
    const m = L.marker(snap.ll, { draggable: true, pane: "measure", keyboard: false,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="ms-pt${measure.pts.length ? "" : " first"}"></div>` }) });
    m.on("drag", drawMeasure);
    m.on("dragend", () => { const i = measure.pts.findIndex((p) => p.m === m); if (i >= 0) measure.pts[i].name = null; drawMeasure(); });
    m.on("click", (e) => { L.DomEvent.stop(e); });
    measure.pts.push({ m, name: snap.name });
    measure.layer.addLayer(m);
    drawMeasure();
  }
  function drawMeasure() {
    const lls = measure.pts.map((p) => p.m.getLatLng());
    measure.layer.eachLayer((l) => { if (l.options.msLabel || l === measure.line || l.options.msCase) measure.layer.removeLayer(l); });
    let total = 0;
    if (lls.length > 1) {
      measure.layer.addLayer(L.polyline(lls, { pane: "measure", color: "#000", weight: 7, opacity: 0.35, interactive: false, msCase: true }));
      measure.line = L.polyline(lls, { pane: "measure", color: "#ffd400", weight: 4, dashArray: "10 7", interactive: false });
      measure.layer.addLayer(measure.line);
      for (let i = 1; i < lls.length; i++) {
        const d = distM(lls[i - 1], lls[i]);
        total += d;
        const mid = L.latLng((lls[i - 1].lat + lls[i].lat) / 2, (lls[i - 1].lng + lls[i].lng) / 2);
        measure.layer.addLayer(L.marker(mid, { pane: "measure", interactive: false, keyboard: false, msLabel: true,
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="ms-seg">${fmtDist(d)}</div>` }) }));
      }
      const last = lls[lls.length - 1];
      measure.layer.addLayer(L.marker(last, { pane: "measure", interactive: false, keyboard: false, msLabel: true,
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="ms-total">${fmtDist(total)}</div>` }) }));
    }
    const n = measure.pts.length;
    const named = measure.pts.map((p) => p.name).filter(Boolean);
    $("#ms-total").textContent = n < 2 ? "" : fmtDist(total);
    $("#ms-total").hidden = n < 2;
    $("#ms-sub").textContent = n === 0 ? "Tap the map to drop your first point." :
      n === 1 ? "Now tap where you want to measure to." :
      `${n - 1} leg${n > 2 ? "s" : ""} · ${altDist(total)}${named.length ? " · " + named.slice(0, 3).join(" → ") : ""} · tap to keep going`;
    $("#ms-undo").disabled = n === 0;
    $("#ms-clear").disabled = n === 0;
  }
  function setMeasure(on) {
    measure.on = on;
    $("#measure-panel").hidden = !on;
    $("#measure-btn").classList.toggle("active", on);
    $("#measure-btn").setAttribute("aria-pressed", on);
    map.getContainer().classList.toggle("measuring", on);
    document.body.classList.toggle("measuring-on", on);
    if (on) {
      closeSheet();
      if (!map.hasLayer(measure.layer)) measure.layer.addTo(map);
      map.doubleClickZoom.disable();
      drawMeasure();
    } else {
      measure.pts = []; measure.layer.clearLayers(); measure.line = null;
      map.removeLayer(measure.layer);
      map.doubleClickZoom.enable();
    }
  }
  $("#measure-btn").onclick = () => setMeasure(!measure.on);
  $("#ms-done").onclick = $("#ms-x").onclick = () => setMeasure(false);
  $("#ms-clear").onclick = () => { measure.pts = []; measure.layer.clearLayers(); measure.line = null; drawMeasure(); };
  $("#ms-undo").onclick = () => { const p = measure.pts.pop(); if (p) measure.layer.removeLayer(p.m); drawMeasure(); };
  document.addEventListener("keydown", (e) => {
    if (!measure.on) return;
    if (e.key === "Escape") setMeasure(false);
    if ((e.key === "z" && (e.ctrlKey || e.metaKey)) || e.key === "Backspace") { e.preventDefault(); $("#ms-undo").click(); }
  });

  // ================================================================ print
  // The map is redrawn at the exact paper size *before* printing (a map that is only resized by print CSS keeps its
  // old layout and prints a cropped corner). Then the area that was on screen is fitted into it.
  let printView = null;
  function visibleBounds() {
    const size = map.getSize();
    let left = 0, bottom = size.y, top = 0;
    if (!$("#sheet").hidden) {
      if (isPhone()) bottom = Math.max(120, size.y - $("#sheet").offsetHeight);
      else left = Math.min(size.x - 120, $("#sheet").getBoundingClientRect().right + 8);
    }
    return L.latLngBounds(map.containerPointToLatLng([left, top]), map.containerPointToLatLng([size.x, bottom]));
  }
  function printTitle() {
    const t = THEMES[theme];
    return { title: $("#site-title .st-name").textContent, sub: `${t.label} look · ${BASEMAPS[baseKey]?.label || ""} · printed ${fmtDate(new Date().toISOString(), false)}` };
  }
  function fillPoster() {
    const L_ = THEMES[theme].lines;
    const { title, sub } = printTitle();
    const line = (c, dash = "") => `<i class="pl-line" style="border-color:${c};${dash ? "border-top-style:dashed;" : ""}"></i>`;
    const inView = map.getBounds();
    const named = featuredPlaces().filter((pl) => !pl.f.properties.site || inView.contains(pl.marker.getLatLng()))
      .sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
    $("#print-poster").innerHTML = `
      <h1>${esc(title)}</h1><p class="pp-sub">${esc(sub.split(" · printed ")[1] ? "Printed " + sub.split(" · printed ")[1] : "")}</p>
      <div class="pp-compass">${compassSvg()}</div>
      <h2>Legend</h2>
      <div class="pp-legend">
        ${line(L_.boundary || "#fff", 1)}<span>Quarter section perimeter</span>
        ${line("#ff9800", 1)}<span>Acreage perimeter</span>
        ${line(L_.road)}<span>Driveway &amp; main yard</span>
        ${line(adv.colourMode === "each" ? "#00e5ff" : L_.trail)}<span>Trails</span>
      </div>
      <h2>Places</h2>
      <div class="pp-places">${named.map((pl) => `<span>${pl.f.properties.icon === "cabin" ? "🏡" : icon(pl.f.properties.icon)} ${esc(placeTitle(pl))}</span>`).join("")}</div>
      <p class="pp-foot">${esc(THEMES[theme].label)} look · ${esc(BASEMAPS[baseKey]?.label || "")}</p>`;
  }
  function enterPrint(kind) {
    if (!printView) printView = { bounds: visibleBounds(), center: map.getCenter(), zoom: map.getZoom() };
    const { title, sub } = printTitle();
    $("#print-head").innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    if (kind === "poster") fillPoster();
    closeSheet();
    document.body.classList.add("printing", kind === "poster" ? "print-poster" : "print-map");
    map.invalidateSize({ animate: false, pan: false });
    map.fitBounds(printView.bounds, { animate: false, padding: [0, 0] });
    declutter();
  }
  function exitPrint() {
    if (!document.body.classList.contains("printing")) return;
    document.body.classList.remove("printing", "print-poster", "print-map");
    map.invalidateSize({ animate: false, pan: false });
    if (printView) map.setView(printView.center, printView.zoom, { animate: false });
    printView = null;
    declutter();
  }
  const tilesSettled = (max = 4000) => new Promise((res) => {
    const layers = []; baseLayer.eachLayer ? baseLayer.eachLayer((l) => layers.push(l)) : layers.push(baseLayer);
    const busy = () => layers.some((l) => l._loading);
    const t0 = Date.now();
    (function wait() { if (!busy() || Date.now() - t0 > max) setTimeout(res, 250); else setTimeout(wait, 150); })();
  });
  window.addEventListener("beforeprint", () => { if (!document.body.classList.contains("printing")) enterPrint("map"); });
  window.addEventListener("afterprint", exitPrint);
  function printMap() {
    printView = { bounds: visibleBounds(), center: map.getCenter(), zoom: map.getZoom() };
    $("#print-dialog").hidden = false;
  }
  $("#print-dialog").addEventListener("click", async (e) => {
    const kind = e.target.closest("[data-print]")?.dataset.print;
    if (e.target.id === "print-dialog" || kind === "cancel") { $("#print-dialog").hidden = true; printView = null; return; }
    if (!kind || document.body.classList.contains("printing")) return;
    $("#print-dialog").hidden = true;
    enterPrint(kind);
    toast("Getting the map ready to print…", 2000);
    await tilesSettled();
    window.print();
  });
  // Backup for browsers that don't send afterprint: leaving print media also restores the map.
  const printMQ = window.matchMedia("print");
  (printMQ.addEventListener ? printMQ.addEventListener.bind(printMQ, "change") : printMQ.addListener.bind(printMQ))((e) => { if (!e.matches) setTimeout(exitPrint, 100); });

  // ================================================================ welcome
  function showWelcome() { $("#welcome").hidden = false; focusQuietly($("#welcome-tour")); }
  const doneWelcome = () => { $("#welcome").hidden = true; store.set("welcomed", true); };
  $("#welcome-ok").onclick = doneWelcome;
  $("#welcome-x").onclick = doneWelcome;
  $("#welcome").addEventListener("click", (e) => { if (e.target.id === "welcome") doneWelcome(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#welcome").hidden) doneWelcome(); });
  $("#welcome-tour").onclick = () => { doneWelcome(); startTour(0); };
  $("#help-btn").onclick = showWelcome;

  // ================================================================ legend (top-right button)
  function legendHtml() {
    const L_ = THEMES[theme].lines;
    const line = (c, extra = "") => `<span class="sym"><span class="line" style="border-color:${c};${extra}filter:drop-shadow(0 0 1px #000)"></span></span>`;
    let trailRows;
    if (adv.colourMode === "steep") trailRows = RAMP_STEEP.map(([, c], i) => line(c) + `<span>${["Flat", "Gentle", "Some hills", "Hilly", "Steepest"][i]}</span>`).join("");
    else if (adv.colourMode === "length") trailRows = RAMP_LEN.map(([lim, c], i) => line(c) + `<span>${i === RAMP_LEN.length - 1 ? "Over " + fmtLen(800) : "Up to " + fmtLen(lim)}</span>`).join("");
    else trailRows = line(adv.colourMode === "each" ? "#00e5ff" : L_.trail) + `<span>Trails${adv.colourMode === "each" ? " (each has its own colour)" : ""}</span>`;
    return `
      ${line(L_.boundary || "#fff", "border-top-style:dashed;")}<span>Quarter section perimeter</span>
      ${line("#ff9800", "border-top-style:dashed;")}<span>Acreage perimeter</span>
      ${line(L_.road, "border-top-width:6px;")}<span>Driveway &amp; main yard</span>
      ${trailRows}
      ${line(L_.sel, "border-top-width:6px;")}<span>The trail you picked</span>
      <span class="sym"><span class="place-pin" style="margin:0"><span class="bubble" style="width:1.9rem;height:1.9rem;font-size:1rem">🏠</span></span></span><span>A named place – tap it for its photos</span>
      <span class="sym"><span class="lg-group">5</span></span><span>A group of photos – zoom in to spread them out</span>
      <span class="sym"><span class="place-pin minor" style="margin:0"><span class="bubble">${CAMERA_SVG}</span></span></span><span>Other photo spot</span>
      <span class="sym"><span class="lg-me"></span></span><span>You (after tapping “Me”) – the blue beam shows which way you’re facing</span>
      ${overlays.radar ? `<span class="sym"><i class="lg-precip rain"></i></span><span>Rain on the radar, light → heavy</span>
        <span class="sym"><i class="lg-precip snow"></i></span><span>Snow on the radar, light → heavy</span>` : ""}`;
  }
  const legendPop = $("#legend-pop"), legendBtn = $("#legend-btn");
  function refreshLegend() { if (!legendPop.hidden) $(".legend", legendPop).innerHTML = legendHtml(); }
  function toggleLegend(show = legendPop.hidden) {
    legendPop.hidden = !show;
    legendBtn.setAttribute("aria-expanded", String(show));
    legendBtn.classList.toggle("active", show);
    refreshLegend();
  }
  legendBtn.onclick = (e) => { e.stopPropagation(); toggleLegend(); };
  $(".lp-x", legendPop).onclick = () => toggleLegend(false);
  document.addEventListener("pointerdown", (e) => { if (!legendPop.hidden && !legendPop.contains(e.target) && !legendBtn.contains(e.target)) toggleLegend(false); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !legendPop.hidden) toggleLegend(false); });

  // ================================================================ place switcher (the title button)
  // "Knopp Map ▾" stays at the top the whole time; its menu jumps between the quarter and the family houses.
  const siteMenu = $("#site-menu"), siteBtn = $("#site-btn");
  function currentSite() {
    const c = map.getCenter();
    return areaOf(c, 0.6)?.id || (map.getBounds().intersects(farmBounds) ? "quarter" : null);
  }
  function renderSiteMenu() {
    const here = currentSite();
    const home = featuredPlaces().find((pl) => pl.f.properties.icon === "house");
    const thumb = (pl, fallback) => {
      const h = pl && heroOf(pl);
      return h ? `<img src="${esc(photoUrl(h, "thumb"))}" alt="">` : `<span>${fallback}</span>`;
    };
    const item = (id, pic, name, sub) => `<button class="sm-item" role="menuitemradio" aria-checked="${here === id}" data-site="${esc(id)}">
      <span class="sm-pic">${pic}</span><span class="sm-txt"><b>${esc(name)}</b><small>${esc(sub)}</small></span><span class="sm-check" aria-hidden="true">✓</span></button>`;
    const fromQuarter = (pl) => farmBounds ? ` · ${fmtLen(distM(farmBounds.getCenter(), pl.marker.getLatLng()))} from the quarter` : "";
    siteMenu.innerHTML = item("quarter", thumb(home, "🌾"), "The Quarter", "Trails, places and the tour") +
      (sitePlaces().length ? `<div class="sm-sec">Family houses</div>` : "") +
      sitePlaces().map((pl) => item(pl.f.id, thumb(pl, icon(pl.f.properties.icon)), placeTitle(pl),
        `${pl.photos.length} photos${fromQuarter(pl)}`)).join("");
    $$(".sm-item", siteMenu).forEach((b) => b.onclick = () => goToSite(b.dataset.site));
  }
  function toggleSiteMenu(show = siteMenu.hidden, focus = false) {
    if (show) {
      renderSiteMenu();
      const r = $("#site-title").getBoundingClientRect();
      siteMenu.style.left = Math.max(8, r.left) + "px";
      siteMenu.style.top = r.bottom + 8 + "px";
    }
    siteMenu.hidden = !show;
    siteBtn.setAttribute("aria-expanded", String(show));
    document.body.classList.toggle("site-menu-open", show);
    if (show && focus) focusQuietly($('.sm-item[aria-checked="true"]', siteMenu) || $(".sm-item", siteMenu));
  }
  function goToSite(id) {
    toggleSiteMenu(false);
    if (id === "quarter") { closeSheet(); fitFarm(); return; }
    if (places.has(id)) openPlace(id, { back: false });
  }
  siteBtn.onclick = (e) => { e.stopPropagation(); toggleSiteMenu(undefined, e.detail === 0); };
  document.addEventListener("pointerdown", (e) => {
    if (!siteMenu.hidden && !siteMenu.contains(e.target) && !siteBtn.contains(e.target)) toggleSiteMenu(false);
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !siteMenu.hidden) toggleSiteMenu(false); });
  siteMenu.addEventListener("keydown", (e) => {
    const items = $$(".sm-item", siteMenu), i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
    if (e.key === "Escape") { e.stopPropagation(); toggleSiteMenu(false); siteBtn.focus(); }
    if (e.key === "Tab") toggleSiteMenu(false);
  });

  // ================================================================ live location
  let watchId = null, meMarker = null, meAcc = null, firstFix = true;
  function meIcon() {
    return L.divIcon({ className: "me-dot", iconSize: [0, 0], html: `<div class="me-beam" hidden></div><div class="arrow"></div>` });
  }
  // Which way you're facing: the phone's compass, or the GPS course when moving faster than walking pace.
  const ORIENT_EVT = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  let compassOn = false, compassDeg = null, gpsDeg = null, shownDeg = null, headingFrame = 0;
  function onOrientation(e) {
    let deg = null;
    if (e.webkitCompassHeading != null) deg = e.webkitCompassHeading; // iPhone / iPad
    else if (e.absolute && e.alpha != null) deg = 360 - e.alpha;      // Android
    if (deg == null) return;
    const screenTurn = screen.orientation?.angle ?? window.orientation ?? 0;
    compassDeg = (deg + screenTurn + 360) % 360;
    if (!headingFrame) headingFrame = requestAnimationFrame(drawHeading);
  }
  function startCompass() {
    if (compassOn || !window.DeviceOrientationEvent) return;
    const listen = () => {
      if (watchId == null || compassOn) return;
      compassOn = true;
      window.addEventListener(ORIENT_EVT, onOrientation);
    };
    // iPhones ask first, and only from a tap – so this runs straight from the button press.
    if (typeof DeviceOrientationEvent.requestPermission === "function")
      DeviceOrientationEvent.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
    else listen();
  }
  function stopCompass() {
    window.removeEventListener(ORIENT_EVT, onOrientation);
    cancelAnimationFrame(headingFrame);
    compassOn = false;
    compassDeg = gpsDeg = shownDeg = null;
    headingFrame = 0;
  }
  function drawHeading() {
    cancelAnimationFrame(headingFrame);
    headingFrame = 0;
    const beam = meMarker?.getElement()?.querySelector(".me-beam");
    if (!beam) return;
    const target = gpsDeg ?? compassDeg;
    if (target == null) { beam.hidden = true; shownDeg = null; return; }
    // Turn the short way round (no spinning through north) and ease the compass so the beam doesn't jitter.
    const turn = ((target - (shownDeg ?? target)) % 360 + 540) % 360 - 180;
    shownDeg = shownDeg == null ? target : shownDeg + turn * (gpsDeg != null ? 1 : 0.3);
    beam.style.transform = `rotate(${shownDeg}deg)`;
    beam.hidden = false;
    if (gpsDeg == null && Math.abs(turn) > 0.5) headingFrame = requestAnimationFrame(drawHeading);
  }
  function startFollow() {
    if (!navigator.geolocation) return toast("This device can't share its location.");
    firstFix = true;
    $('#dock [data-act="locate"]').setAttribute("aria-pressed", "true");
    toast("Finding where you are…", 2500);
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    startCompass();
  }
  function stopFollow() {
    stopNav(true);
    stopCompass();
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    [meMarker, meAcc].forEach((l) => l && map.removeLayer(l));
    meMarker = meAcc = null;
    $("#loc-chip").hidden = true;
    $('#dock [data-act="locate"]').setAttribute("aria-pressed", "false");
  }
  function onPos(pos) {
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    const { heading, speed } = pos.coords;
    gpsDeg = heading != null && !isNaN(heading) && (speed ?? 0) > (compassDeg == null ? 0.4 : 2) ? heading : null;
    if (!meMarker) {
      meAcc = L.circle(ll, { radius: pos.coords.accuracy, color: "#1e88e5", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: meIcon(), zIndexOffset: 3000, keyboard: false, title: "You are here" }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meAcc.setLatLng(ll).setRadius(pos.coords.accuracy);
    }
    drawHeading();
    // At the quarter or at one of the family houses the map follows you; anywhere else it says how far the quarter is.
    const area = areaOf(ll, 0.5);
    if (firstFix) {
      firstFix = false;
      if (area) map.flyTo(ll, Math.max(map.getZoom(), 17.5), { duration: 0.8 });
      else if (!nav.to) toast("You're not at the quarter right now. The blue dot shows where you are.", 5000);
    }
    const chip = $("#loc-chip");
    if (!area) {
      const d = farmBounds ? distM(ll, farmBounds.getCenter()) : 0;
      chip.textContent = `🏠 The quarter is ${fmtLen(d)} away`;
      chip.onclick = () => fitFarm();
    } else {
      const here = area.pl ? [area.pl] : featuredPlaces().filter((pl) => !pl.f.properties.site);
      const near = here.map((pl) => [pl, distM(ll, pl.marker.getLatLng())]).sort((a, b) => a[1] - b[1])[0];
      if (near) {
        const [pl, d] = near;
        chip.textContent = d < 25 ? `📍 You're at ${placeTitle(pl)}` : `📍 ${placeTitle(pl)} · ${fmtLen(d)} ${compass(bearing(ll, pl.marker.getLatLng()))}`;
        chip.onclick = () => openPlace(pl.f.id);
      }
    }
    chip.hidden = false;
    updateNav(ll);
  }
  function onPosErr(err) {
    stopFollow();
    stopNav(true);
    toast(err.code === 1 ? "Location is turned off for this website. You can allow it in your browser settings." : "Couldn't find your location right now.", 5000);
  }

  // ================================================================ take me there
  // Walks the trail network: every trail vertex is a node, shared junction vertices join the trails. Built once, with
  // every node also kept in flat map units so finding the nearest trail on each GPS update is quick.
  let navGraph = null;
  function buildGraph() {
    const crs = map.options.crs, nodes = [], pts = [], idx = new Map(), adj = [], segs = [];
    const node = (lng, lat) => {
      const k = lng.toFixed(6) + "," + lat.toFixed(6);
      if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push(L.latLng(lat, lng)); pts.push(crs.project(nodes[nodes.length - 1])); adj.push([]); }
      return idx.get(k);
    };
    const link = (a, b) => { if (a === b) return; const d = distM(nodes[a], nodes[b]); adj[a].push([b, d]); adj[b].push([a, d]); segs.push([a, b]); };
    tracks.forEach((t) => {
      if (!isTrail(t.f)) return;
      const g = t.f.geometry;
      const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      lines.forEach((cs) => { for (let i = 1; i < cs.length; i++) link(node(cs[i - 1][0], cs[i - 1][1]), node(cs[i][0], cs[i][1])); });
    });
    return { nodes, pts, adj, segs };
  }
  /** Nearest point on the network: {ll, a, b, d} where a–b is the segment it lies on. */
  function snapToNet(ll) {
    const G = navGraph, crs = map.options.crs, p = crs.project(ll);
    // Over an area this small the flat map keeps distances in proportion, so the closest point there is the closest on the ground.
    let best = null, bestD2 = Infinity;
    for (const [a, b] of G.segs) {
      const A = G.pts[a], B = G.pts[b];
      const dx = B.x - A.x, dy = B.y - A.y, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / len)) : 0;
      const ex = A.x + t * dx - p.x, ey = A.y + t * dy - p.y, d2 = ex * ex + ey * ey;
      if (d2 < bestD2) { bestD2 = d2; best = { a, b, t }; }
    }
    const A = G.pts[best.a], B = G.pts[best.b];
    const q = crs.unproject(L.point(A.x + best.t * (B.x - A.x), A.y + best.t * (B.y - A.y)));
    return { ll: q, a: best.a, b: best.b, d: distM(ll, q) };
  }
  // Smallest-first queue of [distance, node] for the route search.
  function heapPush(h, item) {
    h.push(item);
    for (let i = h.length - 1; i > 0;) { const up = (i - 1) >> 1; if (h[up][0] <= h[i][0]) break; [h[up], h[i]] = [h[i], h[up]]; i = up; }
  }
  function heapPop(h) {
    const top = h[0], last = h.pop();
    if (h.length) {
      h[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]]; i = m;
      }
    }
    return top;
  }
  let destSnap = null;   // where the destination sits on the trails, worked out once per destination
  function routeBetween(from, to) {
    if (!navGraph) navGraph = buildGraph();
    const direct = distM(from, to);
    if (!navGraph.segs.length) return { pts: [from, to], len: direct, onTrail: false };
    if (destSnap?.to !== to) destSnap = { to, snap: snapToNet(to) };
    const s = snapToNet(from), e = destSnap.snap;
    // Dijkstra with two temporary nodes (S, E) sitting on their segments.
    const G = navGraph, n = G.nodes.length, S = n, E = n + 1;
    const nodeLL = (i) => (i === S ? s.ll : i === E ? e.ll : G.nodes[i]);
    const extra = new Map([[S, []], [E, []]]);
    const addX = (x, y, d) => { extra.get(x)?.push([y, d]); if (!extra.has(y)) extra.set(y, []); extra.get(y).push([x, d]); };
    for (const [T, sn] of [[S, s], [E, e]]) { addX(T, sn.a, distM(sn.ll, G.nodes[sn.a])); addX(T, sn.b, distM(sn.ll, G.nodes[sn.b])); }
    if ((s.a === e.a && s.b === e.b) || (s.a === e.b && s.b === e.a)) addX(S, E, distM(s.ll, e.ll));
    const dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
    dist[S] = 0;
    const heap = [[0, S]];
    const relax = (du, u, edges) => {
      for (const [v, w] of edges) if (du + w < dist[v]) { dist[v] = du + w; prev[v] = u; heapPush(heap, [dist[v], v]); }
    };
    while (heap.length) {
      const [du, u] = heapPop(heap);
      if (done[u]) continue;
      done[u] = 1;
      if (u === E) break;
      if (u < n) relax(du, u, G.adj[u]);
      if (extra.has(u)) relax(du, u, extra.get(u));
    }
    const total = s.d + dist[E] + e.d;
    // Walking straight is better when the trail route is a long way round, or the trails are far away.
    if (!isFinite(total) || total > direct * 2.2 + 60 || s.d > direct * 0.8) return { pts: [from, to], len: direct, onTrail: false };
    const path = [];
    for (let u = E; u !== -1; u = prev[u]) path.push(nodeLL(u));
    return { pts: [from, ...path.reverse(), to], len: total, onTrail: true, offStart: s.d };
  }

  const nav = { to: null, name: "", layer: L.layerGroup(), last: null, arrived: false, fitDone: false };
  const navPanel = $("#nav-panel");
  const walkMins = (m) => Math.max(1, Math.round(m / 75));   // ~4.5 km/h
  function takeMeThere(pl) {
    const to = pl.marker.getLatLng(), name = placeTitle(pl);
    const go = () => {
      stopNav(true);
      Object.assign(nav, { to, name, arrived: false, fitDone: false, last: null, icon: icon(pl.f.properties.icon) });
      nav.layer.addTo(map);
      nav.dest = L.marker(to, { interactive: false, keyboard: false, zIndexOffset: 2500,
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="nv-flag"><span>${nav.icon}</span></div>` }) }).addTo(nav.layer);
      document.body.classList.add("navigating");
      $(".nv-to", navPanel).textContent = `${nav.icon} ${name}`;
      $(".nv-dist", navPanel).textContent = "Finding you…";
      $(".nv-sub", navPanel).textContent = "Allow location if your phone asks.";
      navPanel.hidden = false;
      if (window.innerWidth < 1100) closeSheet();
      if (watchId == null) startFollow();
      else if (meMarker) updateNav(meMarker.getLatLng());
    };
    go();
  }
  function stopNav(quiet) {
    if (!nav.to) return;
    nav.layer.clearLayers();
    map.removeLayer(nav.layer);
    nav.to = nav.line = nav.lineCase = null;
    navPanel.hidden = true;
    document.body.classList.remove("navigating");
    if (!quiet) toast("Directions stopped.");
  }
  // The same two lines are moved along with each GPS update rather than drawn afresh.
  function drawRoute(r) {
    if (!nav.line) {
      nav.lineCase = L.polyline(r.pts, { color: "#0b3d91", weight: 11, opacity: 0.55, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(nav.layer);
      nav.line = L.polyline(r.pts, { color: "#4fc3ff", weight: 6, opacity: 1, interactive: false, lineCap: "round", lineJoin: "round", className: "nv-line" }).addTo(nav.layer);
    } else {
      nav.lineCase.setLatLngs(r.pts);
      nav.line.setLatLngs(r.pts);
    }
    nav.line.setStyle({ dashArray: r.onTrail ? null : "2 10" });   // dotted while walking cross-country to the trail
  }
  function updateNav(me) {
    if (!nav.to) return;
    // Walking directions once you're at the same place as where you're going (the quarter, or that house);
    // otherwise it's a drive, so Google Maps takes over.
    const here = areaOf(me), there = areaOf(nav.to);
    if (!here || !there || here.id !== there.id) {
      const d = distM(me, nav.to);
      $(".nv-dist", navPanel).textContent = fmtLen(d) + " away";
      $(".nv-sub", navPanel).textContent = `You're not at ${there ? there.name : "the quarter"} yet. Get driving directions:`;
      $(".nv-gm", navPanel).href = `https://www.google.com/maps/dir/?api=1&destination=${nav.to.lat.toFixed(6)},${nav.to.lng.toFixed(6)}&travelmode=driving`;
      $(".nv-arrow", navPanel).style.transform = `rotate(${bearing(me, nav.to)}deg)`;
      navPanel.classList.add("far");
      [nav.line, nav.lineCase].forEach((l) => l && nav.layer.removeLayer(l));
      nav.line = nav.lineCase = null;
      return;
    }
    navPanel.classList.remove("far");
    if (nav.last && distM(nav.last, me) < 4 && nav.line) return;   // ignore GPS jitter
    nav.last = me;
    const r = routeBetween(me, nav.to);
    const straight = distM(me, nav.to);
    if (straight < 20) {
      if (!nav.arrived) {
        nav.arrived = true;
        [nav.line, nav.lineCase].forEach((l) => l && nav.layer.removeLayer(l));
        nav.line = nav.lineCase = null;
        navPanel.classList.add("arrived");
        $(".nv-to", navPanel).textContent = `🎉 You're at ${nav.name}`;
        $(".nv-dist", navPanel).textContent = "You've arrived!";
        $(".nv-sub", navPanel).textContent = "";
        $(".nv-stop", navPanel).textContent = "Done";
      }
      return;
    }
    if (nav.arrived) { nav.arrived = false; navPanel.classList.remove("arrived"); $(".nv-to", navPanel).textContent = `${nav.icon} ${nav.name}`; $(".nv-stop", navPanel).textContent = "Stop"; }
    drawRoute(r);
    // Point the arrow toward the next bend in the route (a few metres ahead), not the far-off destination.
    let aim = r.pts[r.pts.length - 1];
    for (let i = 1; i < r.pts.length; i++) if (distM(me, r.pts[i]) > 12) { aim = r.pts[i]; break; }
    const brg = bearing(me, aim);
    $(".nv-arrow", navPanel).style.transform = `rotate(${brg}deg)`;
    $(".nv-dist", navPanel).textContent = fmtLen(r.len);
    $(".nv-sub", navPanel).textContent = `About ${walkMins(r.len)} min walk · head ${compass(brg)}` + (r.onTrail ? (r.offStart > 25 ? " to the trail" : " along the trail") : "");
    if (!nav.fitDone) { nav.fitDone = true; showRoute(); }
  }
  function showRoute() {
    const pts = [nav.to, ...(meMarker ? [meMarker.getLatLng()] : [])];
    if (nav.line) pts.push(...nav.line.getLatLngs());
    const top = navPanel.offsetHeight + 90;
    map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [40, top], paddingBottomRight: [60, isPhone() ? 110 : 90], maxZoom: 19, duration: 0.8 });
  }
  $(".nv-stop", navPanel).onclick = () => stopNav(nav.arrived);
  $(".nv-see", navPanel).onclick = showRoute;

  // ================================================================ offline (service worker)
  let swReady = null;
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    swReady = navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).catch(() => null);
  }
  const updateOnline = () => { $("#offline-badge").hidden = navigator.onLine; };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateOnline();

  function farmTiles(z0 = 13, z1 = nativeZoom("img")) {
    // The quarter, plus a small square around each family house.
    return [farmBounds.pad(0.15), ...sitePlaces().map((pl) => pl.marker.getLatLng().toBounds(400))].flatMap((b) => tilesIn(b, z0, z1));
  }
  function tilesIn(b, z0, z1) {
    const urls = [];
    for (let z = z0; z <= z1; z++) {
      const n = 2 ** z;
      const tx = (lng) => Math.floor(((lng + 180) / 360) * n);
      const ty = (lat) => Math.floor((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2 * n);
      for (let x = tx(b.getWest()); x <= tx(b.getEast()); x++) {
        for (let y = ty(b.getNorth()); y <= ty(b.getSouth()); y++) urls.push(`${ESRI}World_Imagery/MapServer/tile/${z}/${y}/${x}`);
      }
    }
    return urls;
  }
  function offlinePanel(el) {
    if (!swReady) { el.innerHTML = `<p class="note">This browser can't save the map for offline use.</p>`; return; }
    const saved = store.get("offlineSaved", null);
    el.innerHTML = `
      <p class="note">Nothing is downloaded to your files. This keeps a copy of the map and every photo <b>inside this browser</b>
        on this phone or computer, so this same link keeps working at the quarter with no cell signal.
        Do it once at home on Wi-Fi (about 175 MB). Tip: use “Add to Home Screen” so it opens like an app.
        ${saved ? `<br><b>✅ Saved on ${esc(fmtDate(saved.at, false))}.</b> Tap again to refresh it.` : ""}</p>
      <button class="big" data-kind="full">💾 Save everything to this device</button>
      <div class="bar" hidden><span></span></div><p class="note" data-status></p>`;
    $("button[data-kind]", el).onclick = () => saveOffline("full", el);
  }
  async function saveOffline(kind, el) {
    const reg = await swReady;
    if (!reg?.active) return toast("Offline saving isn't ready yet. Please try again in a moment.");
    const photoUrls = allPhotos.flatMap((x) => kind === "full" ? [photoUrl(x.p, "thumb"), photoUrl(x.p)] : [photoUrl(x.p, "thumb")]);
    const heroes = featuredPlaces().map(heroOf).filter(Boolean).map((p) => photoUrl(p));
    const urls = [...new Set([...farmTiles(), ...heroes, ...photoUrls])];
    const bar = $(".bar", el), status = $("[data-status]", el);
    bar.hidden = false;
    $$("button", el).forEach((b) => b.disabled = true);
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      const { done, total, failed, finished } = e.data;
      $("span", bar).style.width = (done / total) * 100 + "%";
      status.textContent = finished ? `Done! ${total - failed} of ${total} items saved.` : `Saving… ${done} of ${total}`;
      if (finished) {
        store.set("offlineSaved", { at: new Date().toISOString() });
        $$("button", el).forEach((b) => b.disabled = false);
        toast("The map is saved on this device.");
      }
    };
    reg.active.postMessage({ type: "save", urls }, [ch.port2]);
  }

  // ================================================================ dock
  // Room for the pins and names along the edges, except on short screens (phones turned sideways), where every
  // pixel counts: there the whole quarter has to be big enough for its places to show. On an upright phone the
  // quarter spans the full width, so it starts below the zoom buttons rather than tucking its corner under them.
  function farmFit() {
    const side = isPhone() ? 20 : 60, ui = uiInsets(), tight = window.innerHeight < 560;
    const top = Math.max(ui.top, (isPhone() && !tight && $(".leaflet-control-zoom")?.getBoundingClientRect().bottom) || 0) + (tight ? 8 : 30);
    const opts = { paddingTopLeft: [side, top], paddingBottomRight: [side, ui.bottom + (tight ? 14 : 51)] };
    homeZoom = Math.max(13.5, map.getBoundsZoom(farmBounds, false, L.point(opts.paddingTopLeft).add(opts.paddingBottomRight)));
    return opts;
  }
  function fitFarm(animate = true) {
    if (!farmBounds) return;
    const opts = farmFit();
    if (animate) map.flyToBounds(farmBounds, { ...opts, duration: 0.8 }); else map.fitBounds(farmBounds, opts);
  }
  // Turning the phone round changes how far the Home view zooms, and so where the places start to show.
  window.addEventListener("resize", () => { if (farmBounds) { farmFit(); refreshPlaces(); } });
  $("#dock").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    const toggle = (fn) => { if (b.classList.contains("active")) closeSheet(); else fn(); };
    if (act === "farm") { closeSheet(); fitFarm(); }
    if (act === "places") toggle(placesSheet);
    if (act === "tour") toggle(() => startTour(Math.max(0, tourIdx)));
    if (act === "trails") setTrails(!trailsOn);
    if (act === "locate") { if (watchId == null) startFollow(); else { stopFollow(); toast("Stopped showing your location", 1500); } }
  });
  $("#back-to-farm").onclick = () => fitFarm();
  $("#options-btn").onclick = () => {
    document.body.classList.add("seen-opts"); if ($("#options-btn").classList.contains("active")) closeSheet(); else moreSheet(); };
  function refreshBackToFarm() {
    if (!farmBounds) return;
    $("#back-to-farm").hidden = !(!map.getBounds().intersects(farmBounds) || map.getZoom() < 12.5);
  }
  const syncZoomClass = () => map.getContainer().classList.toggle("photos-shown", photosOn && map.getZoom() >= Z.photos);
  map.on("zoomend", () => {
    syncZoomClass();
    refreshTracks(); refreshPlaces();
    const want = photosOn && map.getZoom() >= Z.photos;
    if (want !== map.hasLayer(photoLayer)) refreshPhotos();
  });
  map.on("moveend", () => { refreshBackToFarm(); declutterSoon(); });   // moveend also follows every zoom
  map.on("click", (e) => {
    if (measure.on) return addMeasurePoint(e.latlng, e.containerPoint);
    if (selectedTrack && sheet.hidden) highlightTrack(null);
  });
  window.addEventListener("resize", declutterSoon);

  // ================================================================ load
  function askPassword(retry) {
    return new Promise((resolve) => {
      $("#loading").hidden = true;
      $("#lock").hidden = false;
      $("#lock-err").hidden = !retry;
      const input = $("#lock-pw");
      input.value = "";
      setTimeout(() => input.focus(), 50);
      $("#lock-form").onsubmit = (e) => {
        e.preventDefault();
        $("#lock").hidden = true;
        $("#loading").hidden = false;
        resolve({ password: input.value, remember: $("#lock-remember").checked });
      };
    });
  }

  function start({ meta, data }) {
    $("#site-title .st-name").textContent = meta.title || "Knopp Map";
    document.title = meta.title || "Knopp Map";
    addKeyedStyles(meta.keys);
    categories = data.tracks.categories || {};
    tour = data.tour || { stops: [] };
    data.tracks.features.filter((f) => f.geometry.type !== "Point").forEach(addTrack);

    data.photos.features.forEach((f) => {
      const p = f.properties;
      photoById.set(p.file, p);
      const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: photoIconFor(p), title: "Photo", photo: p });
      if (canHover) m.bindTooltip(() => {
        const pl = places.get(p.place);
        const title = pl ? placeTitle(pl) : p.near ? "Near " + p.near : "Photo";
        return `<div class="peek"><img src="${esc(photoUrl(p, "thumb"))}" alt=""><b>${esc(title)}</b><small>${esc(fmtDate(p.taken))} · click to open</small></div>`;
      }, { direction: "top", offset: [0, -20], className: "peek-tip", opacity: 1 });
      m.on("click", () => {
        const pl = places.get(p.place);
        if (pl) openLightbox(pl.photos, pl.photos.indexOf(p), placeTitle(pl));
        else openLightbox([p], 0, p.near ? `Near ${p.near}` : "Photo");
      });
      allPhotos.push({ p, m });
    });
    allPhotos.sort((a, b) => (a.p.taken || "").localeCompare(b.p.taken || ""));
    data.places.features.forEach(addPlace);

    if (!farmBounds) farmBounds = L.geoJSON(data.tracks).getBounds();
    farmPin = L.marker(farmBounds.getCenter(), {
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="farm-pin"><span>🏠 ${esc(meta.title || "Knopp Map")}</span></div>` }),
      zIndexOffset: 2000, keyboard: true, title: meta.title || "Knopp Map",
    }).on("click", () => fitFarm());

    $('#dock [data-act="trails"]').setAttribute("aria-pressed", trailsOn);
    applyTheme(theme);
    if (!farmView) fitFarm(false);
    probeImagery(baseKeys);
    refreshTracks();
    refreshPlaces();
    refreshPhotos();
    refreshBackToFarm();
    declutterSoon();

    window.addEventListener("hashchange", () => {
      const [hk, hv] = decodeURIComponent(location.hash.slice(1)).split("=");
      if (hk === "place" && places.has(hv) && selectedPlace !== hv) openPlace(hv);
      else if (hk === "trail" && tracks.has(hv) && selectedTrack !== hv) openTrail(hv);
      else if (hk === "tour" && tourIdx !== (parseInt(hv, 10) || 1) - 1) startTour((parseInt(hv, 10) || 1) - 1);
    });
    const h = decodeURIComponent(location.hash.slice(1));
    const [k, v] = h.split("=");
    if (k === "place" && places.has(v)) openPlace(v);
    else if (k === "trail" && tracks.has(v)) openTrail(v);
    else if (k === "tour") startTour((parseInt(v, 10) || 1) - 1);
    else if (!store.get("welcomed", false)) showWelcome();
  }

  // site.json carries the farm's outline, so the map opens there and starts on the imagery while the data is on its way.
  let farmView = null;
  function presetView(meta) {
    const b = meta.bounds && L.latLngBounds(meta.bounds);
    if (!b?.isValid() || farmBounds) return;
    farmBounds = b;
    fitFarm(false);
    farmView = { center: map.getCenter(), zoom: map.getZoom() };
  }

  // A friendly screen with a Try again button instead of a bare alert; coming back online retries by itself.
  function loadFailed(err) {
    console.error(err);
    $("#loading").hidden = true;
    const offline = !navigator.onLine;
    $("#le-msg").textContent = offline
      ? "You're offline, and this map hasn't been saved on this device yet. It will load as soon as you're back online."
      : "Something went wrong while loading. Please check your internet connection and try again.";
    $("#load-error").hidden = false;
    focusQuietly($("#le-retry"));
    if (offline) window.addEventListener("online", () => location.reload(), { once: true });
  }
  $("#le-retry").onclick = () => location.reload();

  loadBundle(askPassword, presetView).then((res) => { $("#loading").hidden = true; start(res); }).catch(loadFailed);
})();
