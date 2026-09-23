(() => {
  "use strict";
  const { icon, esc, fmtLen, fmtDate, store, loadBundle, photoUrl } = KM;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

  // Zoom levels at which things appear.
  const Z = { farmPin: 14.5, trails: 13.5, places: 14.5, photos: 16.75, minorPlaces: 17, roadLabels: 16, trailLabels: 17 };

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
  const compass = (deg) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];

  // ================================================================ text size
  const SIZES = [16, 18, 21];
  let sizeIdx = Math.min(2, store.get("size", 1));
  function applySize() {
    document.documentElement.style.fontSize = SIZES[sizeIdx] + "px";
    store.set("size", sizeIdx);
    setTimeout(declutter, 50);
  }
  const SIZE_NAMES = ["Small", "Normal", "Large"];
  applySize();

  // ================================================================ map
  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 90, maxZoom: 22, minZoom: 5 });
  L.control.zoom({ position: "topright", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);
  L.control.scale({ position: "bottomright", imperial: false }).addTo(map);
  const COMPASS_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" class="c-ring"/><circle cx="50" cy="50" r="38" class="c-face"/>
    <g class="c-ticks">${Array.from({ length: 16 }, (_, i) => `<line x1="50" y1="${i % 4 ? 15 : 12}" x2="50" y2="19" transform="rotate(${i * 22.5} 50 50)"/>`).join("")}</g>
    <path d="M50 18 58 50 50 46 42 50Z" class="c-n"/><path d="M50 82 58 50 50 54 42 50Z" class="c-s"/>
    <path d="M18 50 50 44 46 50 50 56Z" class="c-ew"/><path d="M82 50 50 44 54 50 50 56Z" class="c-ew"/>
    <circle cx="50" cy="50" r="4" class="c-hub"/>
    <text x="50" y="11" class="c-lbl c-lbl-n">N</text><text x="50" y="97" class="c-lbl">S</text><text x="94" y="54" class="c-lbl">E</text><text x="6" y="54" class="c-lbl">W</text></svg>`;
  const Compass = L.Control.extend({ options: { position: "bottomright" },
    onAdd() { const d = L.DomUtil.create("div", "map-compass"); d.title = "North is up"; d.innerHTML = COMPASS_SVG; L.DomEvent.disableClickPropagation(d); return d; } });
  new Compass().addTo(map);
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
  const esriLayer = (svc, key, attribution, extra = {}) =>
    L.tileLayer(ESRI + svc + "/MapServer/tile/{z}/{y}/{x}", { ...TILE_OPTS, maxNativeZoom: nativeZoom(key), attribution, ...extra });
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
  const PROBE = { img: "World_Imagery", topo: "World_Topo_Map", ref: "Reference/World_Transportation",
    hill: "Elevation/World_Hillshade", terrain: "World_Terrain_Base" };
  const FLAT_OK = new Set(["hill", "terrain"]);   // these are naturally grey, so only a missing tile counts
  const native = store.get("nativeZoom", {});
  function nativeZoom(key) {
    const n = native[key];
    return n && n.z ? n.z : { hill: 15, terrain: 13 }[key] || 17;
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
  async function probeImagery() {
    if (!farmBounds || !navigator.onLine) return;
    const b = farmBounds;
    const pts = [b.getCenter(), b.getNorthWest(), b.getNorthEast(), b.getSouthWest(), b.getSouthEast()];
    let changed = false;
    // If even a low-zoom tile can't be read (offline, or no CORS), don't guess.
    if (!(await probeTile("World_Imagery", 12, pts[0].lat, pts[0].lng))) return;
    for (const [key, svc] of Object.entries(PROBE)) {
      const old = native[key];
      if (old && Date.now() - old.at < 7 * 864e5) continue;
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
    const s = map.getSize();
    texture.style.width = s.x + "px";
    texture.style.height = s.y + "px";
    L.DomUtil.setPosition(texture, map.containerPointToLayerPoint([0, 0]));
  };
  map.on("move zoomend viewreset resize", placeTexture);

  // Every visit starts from the normal look; nothing below is remembered between visits.
  let baseKey = null;
  let baseLayer = null;
  let dim = 100;
  function applyMapLook() {
    const el = map.getContainer();
    const m = BASEMAPS[baseKey];
    const t = THEMES[theme];
    el.dataset.filter = m?.filter || "";
    el.dataset.texture = m?.filter === "theme" ? t.texture || "" : m?.filter || "";
    el.style.setProperty("--theme-filter", t.mapFilter || "saturate(1)");
    el.style.setProperty("--dim", dim / 100);
    if (dim < 100) el.dataset.dim = ""; else delete el.dataset.dim;
  }
  function setBase(k) {
    if (!BASEMAPS[k]) k = "themed";
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = BASEMAPS[k].make().addTo(map);
    baseKey = k;
    applyMapLook();
  }

  // ================================================================ themes (looks)
  // mapFilter tints the satellite photo under the "Match the look" map style; texture adds an overlay.
  const THEMES = {
    farmhouse: { label: "Farmhouse", note: "Warm cream and green on real satellite", sw: ["#fbf8f1", "#2f5d3a", "#f2c200"], mapFilter: "saturate(1)",
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
  setBase(baseKey);

  // ================================================================ state
  let farmBounds = null, farmPin = null;
  let trailsOn = true;
  let photosOn = true;
  let labelsOn = true;
  const ADV_DEFAULTS = { colourMode: "simple", thickness: 1, lineOpacity: 100, placeNames: true, minorSpots: true, hiddenTypes: [], lengthFilter: "all",
    trailDay: "all", cluster: true, boundaryFill: true };
  const adv = { ...ADV_DEFAULTS, hiddenTypes: [] };
  const saveAdv = () => {};
  const LENGTHS = { all: [0, 1e9], short: [0, 250], medium: [250, 600], long: [600, 1e9] };
  const hiddenTracks = new Set();
  const tracks = new Map();   // id -> {f, line, casing, group, label}
  const places = new Map();   // id -> {f, marker, photos}
  const photoById = new Map();
  let allPhotos = [];
  let categories = {};
  let tour = { stops: [] };
  let selectedTrack = null, selectedPlace = null;

  // ================================================================ tracks
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
    return road ? L_.road : L_.trail;
  }
  function styles(f, hi = false) {
    const z = map.getZoom();
    const L_ = THEMES[theme].lines;
    const k = adv.thickness * (L_.extra || 1);
    const boost = z >= 18 ? 1.5 : z >= 16 ? 0.75 : 0;
    const c = cat(f);
    if (c === "boundary") {
      const col = f.id === "quarter-section-perimeter" && L_.boundary ? L_.boundary : f.properties.color;
      return { line: { color: col, weight: (3 + boost) * k + (hi ? 2 : 0), dashArray: hi ? null : "10 7", opacity: 1, fillColor: col,
        fillOpacity: adv.boundaryFill ? (hi ? 0.12 : 0.05) : 0 }, casing: { opacity: 0, fillOpacity: 0, weight: 0 } };
    }
    const road = c === "roads";
    const w = ((road ? 5 : 3.5) + boost) * k + (hi ? 2.5 : 0);
    const color = hi ? L_.sel : trailColour(f);
    return {
      line: { color, weight: w, opacity: hi ? 1 : adv.lineOpacity / 100, lineCap: "round", lineJoin: "round", dashArray: !road && !hi && L_.dash ? L_.dash : null },
      casing: { color: road ? L_.roadCase : L_.trailCase, weight: w + 3.5 * k, opacity: hi ? 0.95 : L_.caseOp * adv.lineOpacity / 100, lineCap: "round", lineJoin: "round" },
    };
  }
  function restyle(t) {
    const s = styles(t.f, selectedTrack === t.f.id);
    t.line.setStyle(s.line);
    t.casing.setStyle(s.casing);
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
    const line = L.geoJSON(f, { pane: boundary ? "boundary" : "trails", interactive: false });
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
      .setContent(esc(f.properties.name));
    const t = { f, line, casing, group, label, dirs: f.properties.directions ? directionLayer(f) : null };
    tracks.set(f.id, t);
    restyle(t);
    if (f.id === "quarter-section-perimeter") farmBounds = line.getBounds();
  }

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
      if (show) restyle(t);
      if (t.dirs) {
        const d = show && map.getZoom() >= 16.5;
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
  // Named places get their own picture; small unnamed spots all share the camera.
  const pinEmoji = (p) => (p.icon === "cabin" ? CABIN_SVG : p.featured || SPECIAL_PINS.has(p.icon) ? icon(p.icon) : "📷");
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  function placeIcon(f, sel = false) {
    const p = f.properties;
    const minor = !p.featured;
    return L.divIcon({
      className: "", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="place-pin${minor ? " minor" : ""}${sel ? " sel" : ""}" style="margin-top:${minor ? "-0.85rem" : "-1.3rem"}">
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
    const z = map.getZoom();
    places.forEach((pl) => {
      const p = pl.f.properties;
      const typeOk = !adv.hiddenTypes.includes(p.icon);
      const show = pl.f.id === selectedPlace || (typeOk && (p.featured ? z >= Z.places : adv.minorSpots && z >= Z.minorPlaces && !photosOn));
      if (show && !map.hasLayer(pl.marker)) pl.marker.addTo(map);
      if (!show && map.hasLayer(pl.marker)) map.removeLayer(pl.marker);
    });
    if (farmPin) {
      const show = z < Z.farmPin;
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
    setTimeout(declutter, 0);
  }
  function placeTitle(pl) {
    if (pl.f.properties.name) return pl.f.properties.name;
    const near = pl.photos.find((x) => x.near)?.near;
    return near ? `Photo spot on ${near}` : "Photo spot";
  }
  const heroOf = (pl) => pl.photos.find((x) => x.file === pl.f.properties.hero) || pl.photos[0];
  const featuredPlaces = () => [...places.values()].filter((pl) => pl.f.properties.featured);

  /** Fly so the point sits in the part of the screen not covered by the sheet. */
  function flyToVisible(ll, zoom) {
    const z = zoom ?? Math.max(map.getZoom(), 17.5);
    let pt = map.project(ll, z);
    if (!$("#sheet").hidden) {
      if (isPhone()) pt = pt.add([0, $("#sheet").offsetHeight / 2]);
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
      ${hero ? `<img class="place-hero" src="${esc(photoUrl(hero))}" alt="${esc(title)}">` : ""}
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
    const W = 320, H = 110, pad = { l: 34, r: 8, t: 10, b: 20 };
    const maxD = profile[profile.length - 1][0] || 1;
    const es = profile.map((p) => p[1]);
    let lo = Math.min(...es), hi = Math.max(...es);
    if (hi - lo < 6) { const m = (hi + lo) / 2; lo = m - 3; hi = m + 3; }
    const x = (d) => pad.l + (d / maxD) * (W - pad.l - pad.r);
    const y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const pts = profile.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
    return `<svg class="elev" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elevation along the trail, from ${Math.round(lo)} to ${Math.round(hi)} metres">
      <polygon points="${x(0)},${H - pad.b} ${pts} ${x(maxD)},${H - pad.b}" fill="#cfe3c9"/>
      <polyline points="${pts}" fill="none" stroke="#2f5d3a" stroke-width="2.5" stroke-linejoin="round"/>
      <g font-size="10" fill="#5d6258">
        <text x="${pad.l - 4}" y="${y(hi) + 4}" text-anchor="end">${Math.round(hi)} m</text>
        <text x="${pad.l - 4}" y="${y(lo) + 4}" text-anchor="end">${Math.round(lo)} m</text>
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
        ${p.gain_m != null && isTrail(t.f) ? `<div class="stat"><b>↗ ${p.gain_m} m</b><small>total uphill</small></div>
          <div class="stat"><b>↘ ${p.loss_m} m</b><small>total downhill</small></div>` : ""}
        ${p.profile && isTrail(t.f) ? `<div class="stat"><b>${Math.round(Math.min(...p.profile.map((x) => x[1])))}–${Math.round(Math.max(...p.profile.map((x) => x[1])))} m</b><small>height above sea</small></div>` : ""}
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
      if (isPhone()) {
        map.flyToBounds(t.line.getBounds(), { paddingTopLeft: [30, 80], paddingBottomRight: [30, window.innerHeight * 0.66], maxZoom: 18, duration: 0.8 });
      } else {
        map.flyToBounds(t.line.getBounds(), { paddingTopLeft: [$("#sheet").offsetWidth + 50, 80], paddingBottomRight: [80, 120], maxZoom: 18, duration: 0.8 });
      }
    };
    $('[data-act="fit"]', body).onclick = fit;
    openSheet(`🥾 ${p.name}`, body, { back: back ?? false });
    if (fly) fit();
    setTimeout(declutter, 50);
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
    return cg;
  }
  const photoClusters = new Map();
  const photoCluster = L.layerGroup();
  const photoPlain = L.layerGroup();
  let photoLayer = adv.cluster ? photoCluster : photoPlain;
  const photoIconFor = (p) => L.divIcon({ className: "", iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div class="ph-single"><img src="${esc(photoUrl(p, "thumb"))}" alt="" loading="lazy"></div>` });
  let photoDay = "all";
  function refreshPhotos() {
    photoClusters.forEach((cg) => cg.clearLayers());
    [photoCluster, photoPlain].forEach((l) => { l.clearLayers(); if (map.hasLayer(l) && l !== (adv.cluster ? photoCluster : photoPlain)) map.removeLayer(l); });
    photoLayer = adv.cluster ? photoCluster : photoPlain;
    const shown = allPhotos.filter((x) => photoDay === "all" || x.p.taken?.slice(0, 10) === photoDay);
    if (adv.cluster) {
      const byPlace = new Map();
      shown.forEach((x) => { const k = x.p.place || "none"; (byPlace.get(k) || byPlace.set(k, []).get(k)).push(x.m); });
      byPlace.forEach((ms, k) => {
        if (!photoClusters.has(k)) photoClusters.set(k, makeCluster());
        const cg = photoClusters.get(k);
        cg.addLayers(ms);
        photoCluster.addLayer(cg);
      });
    } else shown.forEach((x) => photoPlain.addLayer(x.m));
    const want = photosOn && map.getZoom() >= Z.photos;
    syncZoomClass();
    if (want && !map.hasLayer(photoLayer)) photoLayer.addTo(map);
    if (!want && map.hasLayer(photoLayer)) map.removeLayer(photoLayer);
    refreshPlaces();
  }

  // ================================================================ declutter
  function declutter() {
    const boxes = [];
    const overlaps = (r, pad = 3) => boxes.some((b) => r.left < b.right + pad && r.right > b.left - pad && r.top < b.bottom + pad && r.bottom > b.top - pad);
    const rank = (pl) => (pl.f.id === selectedPlace ? 1e6 : 0) + (pl.f.properties.featured ? 1e3 : 0) + pl.photos.length;
    const pins = [...places.values()].filter((pl) => map.hasLayer(pl.marker)).sort((a, b) => rank(b) - rank(a));
    for (const pl of pins) {
      const pin = pl.marker.getElement()?.querySelector(".place-pin");
      if (!pin) continue;
      pin.classList.remove("declutter-hide");
      const name = pin.querySelector(".name");
      name?.classList.remove("declutter-hide");
      const br = pin.querySelector(".bubble").getBoundingClientRect();
      if (overlaps(br, 1)) { pin.classList.add("declutter-hide"); continue; }
      boxes.push(br);
      if (name) { const nr = name.getBoundingClientRect(); if (overlaps(nr)) name.classList.add("declutter-hide"); else boxes.push(nr); }
    }
    const labels = $$(".leaflet-tooltip.trail-label");
    labels.sort((a, b) => (b.textContent === tracks.get(selectedTrack)?.f.properties.name) - (a.textContent === tracks.get(selectedTrack)?.f.properties.name));
    for (const el of labels) {
      el.classList.remove("declutter-hide");
      const r = el.getBoundingClientRect();
      if (overlaps(r, 6)) el.classList.add("declutter-hide"); else boxes.push(r);
    }
  }

  // ================================================================ sheet
  const sheet = $("#sheet");
  const sheetStack = [];
  let sheetCurrent = null;
  function openSheet(title, content, { back = false, onClose = null } = {}) {
    if (!back) sheetStack.length = 0;
    else if (sheetCurrent) sheetStack.push(sheetCurrent);
    sheetCurrent = { title, content, onClose, hash: location.hash };
    renderSheet();
  }
  function renderSheet() {
    $("#sheet-title").textContent = sheetCurrent.title;
    const body = $("#sheet-body");
    body.replaceChildren(sheetCurrent.content);
    body.scrollTop = 0;
    $("#sheet-back").hidden = sheetStack.length === 0;
    applySheetHeight();
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
    if (isPhone() && !$("#legend-pop").hidden) $("#legend-pop .lp-x").click();
  }
  function closeSheet() {
    const cbs = [sheetCurrent, ...sheetStack].map((s) => s?.onClose).filter(Boolean);
    sheet.hidden = true;
    sheetStack.length = 0;
    sheetCurrent = null;
    sheetH = null;
    document.body.classList.remove("sheet-open");
    $$("#dock button.active, #options-btn.active").forEach((b) => b.classList.remove("active"));
    selectPlace(null);
    highlightTrack(null);
    refreshTracks();
    history.replaceState(null, "", location.pathname + location.search);
    cbs.forEach((f) => f());
  }
  $("#sheet-close").onclick = closeSheet;
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
  function applySheetHeight() {
    const on = isPhone() && sheetH != null;
    if (on) sheetH = Math.max(sheetMinH(), Math.min(sheetMaxH(), sheetH));
    sheet.classList.toggle("sized", on);
    sheet.style.height = on ? `${sheetH}px` : "";
  }
  function sheetDragStart(e) {
    if (!isPhone() || e.button > 0 || e.target.closest("button")) return;
    sheetDrag = { id: e.pointerId, y: e.clientY, h: sheet.offsetHeight, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function sheetDragMove(e) {
    if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
    const dy = sheetDrag.y - e.clientY;
    if (!sheetDrag.moved && Math.abs(dy) < 5) return;
    sheetDrag.moved = true;
    sheet.classList.add("dragging");
    sheetH = sheetDrag.h + dy;
    applySheetHeight();
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
    const featured = featuredPlaces().sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
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
    trailsH.textContent = "Trails and roads";
    body.append(trailsH);
    [...tracks.values()].filter((t) => isTrail(t.f)).sort((a, b) => a.f.properties.name.localeCompare(b.f.properties.name))
      .forEach((t) => body.append(trailRow(t)));
    openSheet("📍 Places & trails", body);
    setDockActive("places");
  }
  function placeRow(pl) {
    const p = pl.f.properties;
    const hero = heroOf(pl);
    const b = document.createElement("button");
    b.className = "list-row";
    b.innerHTML = `${hero ? `<img src="${esc(photoUrl(hero, "thumb"))}" alt="" loading="lazy">` : `<span class="emoji">${icon(p.icon)}</span>`}
      <span class="txt"><b>${icon(p.icon)} ${esc(placeTitle(pl))}</b><small>${pl.photos.length} photo${pl.photos.length === 1 ? "" : "s"}</small></span><span class="chev">›</span>`;
    b.onclick = () => openPlace(pl.f.id, { back: true });
    return b;
  }
  function trailRow(t) {
    const p = t.f.properties;
    const b = document.createElement("button");
    b.className = "list-row";
    b.innerHTML = `<span class="emoji">🥾</span><span class="txt"><b>${esc(p.name)}</b><small>${fmtLen(p.length_m)}${p.gain_m != null ? ` · ↗ ${p.gain_m} m uphill` : ""}</small></span><span class="chev">›</span>`;
    b.onclick = () => openTrail(t.f.id, { back: true });
    return b;
  }

  // ================================================================ search
  function searchSheet() {
    const body = document.createElement("div");
    body.innerHTML = `<input id="search-input" type="search" placeholder="Type a place or trail name…" autocomplete="off" aria-label="Search">
      <div id="search-results"></div>`;
    const input = $("#search-input", body);
    const out = $("#search-results", body);
    const run = () => {
      const q = input.value.trim().toLowerCase();
      out.replaceChildren();
      if (!q) { out.innerHTML = `<p class="note">For example: cabin, gate, garden, Roger…</p>`; return; }
      const pl = [...places.values()].filter((x) => x.f.properties.featured && (placeTitle(x) + " " + (x.f.properties.story || "")).toLowerCase().includes(q));
      const tr = [...tracks.values()].filter((t) => t.f.properties.name.toLowerCase().includes(q));
      const ph = allPhotos.map((x) => x.p).filter((p) => ((p.title || "") + " " + (p.caption || "")).toLowerCase().includes(q));
      if (pl.length) { out.insertAdjacentHTML("beforeend", "<h3>Places</h3>"); pl.slice(0, 20).forEach((x) => out.append(placeRow(x))); }
      if (tr.length) { out.insertAdjacentHTML("beforeend", "<h3>Trails and roads</h3>"); tr.forEach((t) => out.append(trailRow(t))); }
      if (ph.length) { out.insertAdjacentHTML("beforeend", "<h3>Photos</h3>"); out.append(gallery(ph, "Search results")); }
      if (!pl.length && !tr.length && !ph.length) out.innerHTML = `<p class="note">Nothing found for “${esc(input.value)}”.</p>`;
    };
    input.oninput = run;
    run();
    openSheet("🔍 Search", body);
    setDockActive(null);
    setTimeout(() => input.focus(), 50);
  }
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
      ${hero ? `<img class="place-hero" src="${esc(photoUrl(hero))}" alt="${esc(title)}">` : ""}
      ${text ? `<p class="place-story">${esc(text)}</p>` : ""}
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

  function resetAll() {
    Object.assign(adv, ADV_DEFAULTS, { hiddenTypes: [] });
    hiddenTracks.clear();
    dim = 100;
    photoDay = "all";
    labelsOn = true;
    setPhotos(true);
    if (!trailsOn) setTrails(true);
    setHills(false); setRadar(false); setWeather(false);
    applyTheme("farmhouse", { pickBase: true });
    refreshPhotos(); refreshTracks(); refreshPlaces();
    places.forEach((pl) => pl.marker.setIcon(placeIcon(pl.f)));
    declutter();
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
      ${sec("layers", "🌦️", "Weather", "Live rain radar and current weather", `<div id="m-over"></div>`)}
      ${sec("show", "👁️", "What's on the map", "Trails, names, photos", `<div id="m-basic"></div>`)}
      ${sec("text", "🔠", "Text size", SIZE_NAMES[sizeIdx], `<div class="seg" id="m-size"></div>`)}
      ${sec("save", "💾", "Print & offline", "Print this view, use without internet", `
        <p class="note">Prints exactly what you see now: the look, map style and filters you picked.</p>
        <button class="big ghost" id="m-print">🖨️ Print this map</button>
        <div class="os-div"></div><div id="m-offline"></div>`)}
      <div class="adv-label"><span class="adv-badge">ADVANCED</span> For people who like to fine-tune</div>
      ${sec("colours", "🖍️", "Trail colours & lines", "Colour, thickness, brightness", `
        <h4>Colour trails by</h4><div class="seg" id="a-colour"></div>
        <h4>Line thickness</h4><div class="seg" id="a-thick"></div>
        <h4>Trail see-through</h4><div class="range-row"><span class="rr-l">Faint</span><input type="range" id="a-lineop" min="20" max="100" step="5" aria-label="Trail opacity"><span class="rr-l">Solid</span></div>
        <h4>Map brightness</h4><div class="range-row"><span>🌑</span><input type="range" id="a-dim" min="35" max="100" step="5" aria-label="Map brightness"><span>☀️</span></div>`, "advsec")}
      ${sec("filter", "🔎", "Filter trails & places", "Length, kinds of places", `
        <h4>Trail length</h4><div class="seg" id="a-length"></div>
        <h4>Kinds of places <small>(tap to hide or show)</small></h4><div class="chips" id="a-types"></div>`, "advsec")}
      ${sec("labels", "🏷️", "Labels & extras", "Names, photo spots, shading", `<div id="a-checks"></div>`, "advsec")}
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
    check(ov, "🌧️ Live rain radar", overlays.radar, setRadar).dataset.over = "radar";
    check(ov, "⛅ Weather at the quarter right now", overlays.weather, setWeather);

    const basic = $("#m-basic", body);
    check(basic, "🥾 Trails &amp; roads", trailsOn, (v) => setTrails(v));
    check(basic, "🏷️ Trail names (when zoomed in)", labelsOn, (v) => { labelsOn = v; refreshTracks(); declutter(); });
    check(basic, "🔤 Place names next to pins", adv.placeNames, (v) => { adv.placeNames = v; places.forEach((pl) => pl.marker.setIcon(placeIcon(pl.f, pl.f.id === selectedPlace))); declutter(); });
    check(basic, "📷 Photos on the map <small>(grouped with a count; they spread out as you zoom in)</small>", photosOn, (v) => setPhotos(v));
    seg($("#m-size", body), SIZE_NAMES.map((l, i) => [i, l]), sizeIdx, (i) => { sizeIdx = i; applySize(); setSum("text", SIZE_NAMES[i]); });
    $("#m-print", body).onclick = printMap;
    offlinePanel($("#m-offline", body));

    // ---- advanced
    const restyleAll = () => { tracks.forEach(restyle); refreshLegend(); };
    seg($("#a-colour", body), [["simple", "One colour"], ["each", "Each trail"], ["steep", "Steepness"], ["length", "Length"]],
      adv.colourMode, (v) => { adv.colourMode = v; restyleAll(); });
    seg($("#a-thick", body), [[0.7, "Thin"], [1, "Normal"], [1.4, "Thick"], [1.9, "Extra"]], adv.thickness,
      (v) => { adv.thickness = v; restyleAll(); });
    const dimEl = $("#a-dim", body);
    dimEl.value = dim;
    dimEl.oninput = () => { dim = +dimEl.value; applyMapLook(); };
    const opEl = $("#a-lineop", body);
    opEl.value = adv.lineOpacity;
    opEl.oninput = () => { adv.lineOpacity = +opEl.value; tracks.forEach(restyle); };
    const refilter = () => { refreshTracks(); refreshPlaces(); declutter(); };
    seg($("#a-length", body), [["all", "All"], ["short", "Under 250 m"], ["medium", "250–600 m"], ["long", "Over 600 m"]],
      adv.lengthFilter, (v) => { adv.lengthFilter = v; refilter(); });
    const types = [...new Set([...places.values()].map((pl) => pl.f.properties.icon))];
    const tyEl = $("#a-types", body);
    types.forEach((ty) => {
      const b = document.createElement("button");
      const on = () => !adv.hiddenTypes.includes(ty);
      b.className = "chip toggle" + (on() ? " on" : "");
      b.innerHTML = `${icon(ty)} ${esc(KM.ICONS[ty]?.[1] || ty)}`;
      b.onclick = () => {
        adv.hiddenTypes = on() ? [...adv.hiddenTypes, ty] : adv.hiddenTypes.filter((x) => x !== ty);
        b.classList.toggle("on", on());
        refilter();
      };
      tyEl.append(b);
    });
    const ac = $("#a-checks", body);
    check(ac, "Small photo spots (when zoomed in)", adv.minorSpots, (v) => { adv.minorSpots = v; refilter(); });
    check(ac, "Shade inside the property line", adv.boundaryFill, (v) => { adv.boundaryFill = v; restyleAll(); });
    check(ac, "Group nearby photos together", adv.cluster, (v) => { adv.cluster = v; refreshPhotos(); });


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
        r.innerHTML = `<input type="checkbox" id="t-${esc(t.f.id)}"> <span class="swatch" style="background:${esc(trailColour(t.f))}"></span>
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
    declutter();
  }
  function setTrails(on) {
    trailsOn = on;
    $('#dock [data-act="trails"]').setAttribute("aria-pressed", on);
    refreshTracks();
    declutter();
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
    const lx = Math.max(0, (lbImg.offsetWidth * zs - r.width) / 2);
    const ly = Math.max(0, (lbImg.offsetHeight * zs - r.height) / 2);
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

  function openLightbox(list, idx, title) {
    lbList = list; lbIdx = idx; lbTitle = title;
    const strip = $(".lb-strip", lb);
    strip.innerHTML = list.length > 1 ? list.map((p, i) => `<button data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(photoUrl(p, "thumb"))}" alt="" loading="lazy"></button>`).join("") : "";
    $$("button", strip).forEach((b) => b.onclick = () => { lbIdx = +b.dataset.i; drawLightbox(); });
    drawLightbox();
    lb.hidden = false;
    $(".lb-close", lb).focus();
  }
  function drawLightbox() {
    const p = lbList[lbIdx];
    resetZoom();
    lbImg.src = photoUrl(p);
    lbImg.alt = p.title || lbTitle;
    const cap = p.title || lbTitle;
    $(".lb-cap", lb).innerHTML = `<b>${esc(cap)}</b>${p.caption ? `<br>${esc(p.caption)}` : ""}<br><small>${esc(fmtDate(p.taken))}${lbList.length > 1 ? ` · photo ${lbIdx + 1} of ${lbList.length}` : ""}</small>`;
    const multi = lbList.length > 1;
    $(".lb-prev", lb).hidden = !multi;
    $(".lb-next", lb).hidden = !multi;
    $$(".lb-strip button", lb).forEach((b, i) => b.classList.toggle("on", i === lbIdx));
    $(".lb-strip button.on", lb)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    if (multi) new Image().src = photoUrl(lbList[(lbIdx + 1) % lbList.length]);
  }
  const step = (d) => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; drawLightbox(); };
  const closeLb = () => { lb.hidden = true; resetZoom(); };
  $(".lb-close", lb).onclick = closeLb;
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

  // ================================================================ extra layers: hills, rain radar, weather
  const overlays = { hills: false, radar: false, weather: false };
  let hillLayer = null;
  function setHills(on) {
    overlays.hills = on;
    if (on && !hillLayer) hillLayer = hills(0.5);
    if (on) hillLayer.addTo(map); else if (hillLayer) map.removeLayer(hillLayer);
  }

  const radar = { frames: [], layers: new Map(), idx: 0, timer: null, host: "", loadedAt: 0, past: 0, speed: 700, opacity: 0.7 };
  const rp = () => $("#radar-panel");
  async function setRadar(on) {
    overlays.radar = on;
    const panel = rp();
    if (!on) {
      stopRadarPlay();
      radar.layers.forEach((l) => map.removeLayer(l));
      panel.hidden = true;
      $$('[data-over="radar"]').forEach((x) => { x.checked = false; });
      return;
    }
    panel.hidden = false;
    $(".rp-time", panel).textContent = "Loading…";
    try {
      if (Date.now() - radar.loadedAt > 5 * 60e3) {
        const j = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-cache" }).then((r) => r.json());
        radar.host = j.host;
        radar.past = (j.radar?.past || []).length;
        radar.frames = [...(j.radar?.past || []), ...(j.radar?.nowcast || [])];
        radar.layers.forEach((l) => map.removeLayer(l));
        radar.layers.clear();
        radar.loadedAt = Date.now();
      }
      if (!overlays.radar || !radar.frames.length) return;
      const slider = $(".rp-slider", panel);
      slider.max = radar.frames.length - 1;
      $(".rp-ticks", panel).innerHTML = radar.frames.map((f, i) => `<i class="${i >= radar.past ? "fc" : ""}${i === radar.past - 1 ? " now" : ""}"></i>`).join("");
      showRadarFrame(radar.past - 1);
    } catch {
      $(".rp-time", panel).textContent = "Radar isn't available right now";
    }
  }
  function radarLayer(i) {
    if (!radar.layers.has(i)) {
      radar.layers.set(i, L.tileLayer(`${radar.host}${radar.frames[i].path}/256/{z}/{x}/{y}/2/1_1.png`,
        { pane: "radar", opacity: 0, maxNativeZoom: 7, maxZoom: 22, attribution: "Radar © RainViewer" }));
    }
    return radar.layers.get(i);
  }
  function showRadarFrame(i) {
    if (!radar.frames.length) return;
    radar.idx = Math.max(0, Math.min(radar.frames.length - 1, i));
    const cur = radarLayer(radar.idx);
    if (!map.hasLayer(cur)) cur.addTo(map);
    cur.setOpacity(radar.opacity);
    radar.layers.forEach((l, k) => { if (k !== radar.idx) l.setOpacity(0); });
    [radar.idx + 1, radar.idx + 2].forEach((k) => { if (k < radar.frames.length) { const n = radarLayer(k); if (!map.hasLayer(n)) n.addTo(map); } });
    const panel = rp();
    const t = new Date(radar.frames[radar.idx].time * 1000);
    const mins = Math.round((t - Date.now()) / 60000);
    const rel = Math.abs(mins) < 5 ? "now" : mins < 0 ? `${-mins} min ago` : `in ${mins} min`;
    const forecast = radar.idx >= radar.past;
    $(".rp-time", panel).innerHTML = `<b>${t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</b> · ${rel}${forecast ? ' <span class="rp-fc">forecast</span>' : ""}`;
    $(".rp-slider", panel).value = radar.idx;
    $$(".rp-ticks i", panel).forEach((el, k) => el.classList.toggle("on", k === radar.idx));
  }
  function stopRadarPlay() {
    clearInterval(radar.timer);
    radar.timer = null;
    const b = $('[data-rp="play"]');
    if (b) { b.textContent = "▶"; b.setAttribute("aria-label", "Play"); }
  }
  function startRadarPlay() {
    stopRadarPlay();
    const b = $('[data-rp="play"]');
    b.textContent = "⏸"; b.setAttribute("aria-label", "Pause");
    if (radar.idx >= radar.frames.length - 1) showRadarFrame(0);
    radar.timer = setInterval(() => {
      if (radar.idx >= radar.frames.length - 1) showRadarFrame(0); else showRadarFrame(radar.idx + 1);
    }, radar.speed);
  }
  (() => {
    const panel = rp();
    panel.addEventListener("click", (e) => {
      const act = e.target.closest("[data-rp]")?.dataset.rp;
      if (!act) return;
      if (act === "close") return setRadar(false);
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
        e.target.closest("[data-rp]").textContent = "Speed: " + speeds[i][1];
      }
    });
    $(".rp-slider", panel).oninput = (e) => { stopRadarPlay(); showRadarFrame(+e.target.value); };
    $(".rp-opacity", panel).oninput = (e) => { radar.opacity = +e.target.value / 100; showRadarFrame(radar.idx); };
  })();

  const WX = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Frosty fog"],
    51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"], 61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"], 71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm, hail"], 99: ["⛈️", "Thunderstorm, hail"] };
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
        const c = farmBounds.getCenter();
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(4)}&longitude=${c.lng.toFixed(4)}` +
          "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,sunset" +
          "&timezone=America%2FEdmonton&wind_speed_unit=kmh&forecast_days=1";
        const j = await fetch(u).then((r) => r.json());
        const cur = j.current, d = j.daily;
        const [emo, text] = WX[cur.weather_code] || ["🌡️", ""];
        const sunset = d.sunset?.[0] ? new Date(d.sunset[0]).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
        chip.innerHTML = `<b>${emo} ${Math.round(cur.temperature_2m)}°C</b> ${esc(text)} · feels ${Math.round(cur.apparent_temperature)}°<br>
          <small>Wind ${Math.round(cur.wind_speed_10m)} km/h from the ${compass(cur.wind_direction_10m)} · High ${Math.round(d.temperature_2m_max[0])}° Low ${Math.round(d.temperature_2m_min[0])}°${sunset ? " · Sunset " + sunset : ""}</small>`;
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
  const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + " km" : m >= 100 ? Math.round(m) + " m" : m.toFixed(1) + " m");
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
    $("#ms-total").textContent = n < 2 ? "—" : fmtDist(total);
    $("#ms-sub").textContent = n === 0 ? "Tap the map to drop your first point." :
      n === 1 ? "Now tap where you want to measure to." :
      `${n - 1} leg${n > 2 ? "s" : ""} · ${Math.round(total * 3.28084).toLocaleString()} ft${named.length ? " · " + named.slice(0, 3).join(" → ") : ""} · tap to keep going`;
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
  $("#ms-done").onclick = () => setMeasure(false);
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
    return { title: $("#site-title").textContent, sub: `${t.label} look · ${BASEMAPS[baseKey]?.label || ""} · printed ${fmtDate(new Date().toISOString(), false)}` };
  }
  function fillPoster() {
    const L_ = THEMES[theme].lines;
    const { title, sub } = printTitle();
    const line = (c, dash = "") => `<i class="pl-line" style="border-color:${c};${dash ? "border-top-style:dashed;" : ""}"></i>`;
    const named = featuredPlaces().sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
    $("#print-poster").innerHTML = `
      <h1>${esc(title)}</h1><p class="pp-sub">${esc(sub.split(" · printed ")[1] ? "Printed " + sub.split(" · printed ")[1] : "")}</p>
      <div class="pp-compass">${COMPASS_SVG}</div>
      <h2>Legend</h2>
      <div class="pp-legend">
        ${line(L_.boundary || "#fff", 1)}<span>Quarter section perimeter</span>
        ${line("#ff9800", 1)}<span>Acreage perimeter</span>
        ${line(L_.road)}<span>Roads and yard</span>
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
  const tilesSettled = () => new Promise((res) => {
    const layers = []; baseLayer.eachLayer ? baseLayer.eachLayer((l) => layers.push(l)) : layers.push(baseLayer);
    const busy = () => layers.some((l) => l._loading);
    const t0 = Date.now();
    (function wait() { if (!busy() || Date.now() - t0 > 4000) setTimeout(res, 250); else setTimeout(wait, 150); })();
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
  function showWelcome() { $("#welcome").hidden = false; $("#welcome-tour").focus(); }
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
    else if (adv.colourMode === "length") trailRows = RAMP_LEN.map(([lim, c], i) => line(c) + `<span>${i === RAMP_LEN.length - 1 ? "Over 800 m" : "Up to " + lim + " m"}</span>`).join("");
    else trailRows = line(adv.colourMode === "each" ? "#00e5ff" : L_.trail) + `<span>Trails${adv.colourMode === "each" ? " (each has its own colour)" : ""}</span>`;
    return `
      ${line(L_.boundary || "#fff", "border-top-style:dashed;")}<span>Quarter section perimeter</span>
      ${line("#ff9800", "border-top-style:dashed;")}<span>Acreage perimeter</span>
      ${line(L_.road, "border-top-width:6px;")}<span>Roads and yard</span>
      ${trailRows}
      ${line(L_.sel, "border-top-width:6px;")}<span>The trail you picked</span>
      <span class="sym"><span class="place-pin" style="margin:0"><span class="bubble" style="width:1.9rem;height:1.9rem;font-size:1rem">🏠</span></span></span><span>A named place – tap it for its photos</span>
      <span class="sym"><span class="lg-group">5</span></span><span>A group of photos – zoom in to spread them out</span>
      <span class="sym"><span class="place-pin minor" style="margin:0"><span class="bubble">📷</span></span></span><span>Other photo spot</span>
      <span class="sym"><span class="lg-me"></span></span><span>You (after tapping “Me”)</span>`;
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

  // ================================================================ live location
  let watchId = null, meMarker = null, meAcc = null, firstFix = true;
  function meIcon(heading) {
    const rot = heading == null ? "" : `style="transform:rotate(${heading}deg)"`;
    return L.divIcon({ className: "me-dot", iconSize: [0, 0], html: `<div class="arrow${heading == null ? "" : " heading"}" ${rot}></div>` });
  }
  function startFollow() {
    if (!navigator.geolocation) return toast("This device can't share its location.");
    firstFix = true;
    $('#dock [data-act="locate"]').setAttribute("aria-pressed", "true");
    toast("Finding where you are…", 2500);
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopFollow() {
    stopNav(true);
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    [meMarker, meAcc].forEach((l) => l && map.removeLayer(l));
    meMarker = meAcc = null;
    $("#loc-chip").hidden = true;
    $('#dock [data-act="locate"]').setAttribute("aria-pressed", "false");
  }
  function onPos(pos) {
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    const heading = pos.coords.heading != null && !isNaN(pos.coords.heading) && (pos.coords.speed ?? 0) > 0.4 ? pos.coords.heading : null;
    if (!meMarker) {
      meAcc = L.circle(ll, { radius: pos.coords.accuracy, color: "#1e88e5", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: meIcon(heading), zIndexOffset: 3000, keyboard: false, title: "You are here" }).addTo(map);
    } else {
      meMarker.setLatLng(ll).setIcon(meIcon(heading));
      meAcc.setLatLng(ll).setRadius(pos.coords.accuracy);
    }
    const onFarm = farmBounds && farmBounds.pad(0.5).contains(ll);
    if (firstFix) {
      firstFix = false;
      if (onFarm) map.flyTo(ll, Math.max(map.getZoom(), 17.5), { duration: 0.8 });
      else if (!nav.to) toast("You're not at the quarter right now. The blue dot shows where you are.", 5000);
    }
    const chip = $("#loc-chip");
    if (!onFarm) {
      const d = farmBounds ? distM(ll, farmBounds.getCenter()) : 0;
      chip.textContent = `🏠 The quarter is ${fmtLen(d)} away`;
      chip.onclick = () => fitFarm();
    } else {
      const near = featuredPlaces().map((pl) => [pl, distM(ll, pl.marker.getLatLng())]).sort((a, b) => a[1] - b[1])[0];
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
  // Walks the trail network: every trail vertex is a node, shared junction vertices join the trails.
  let navGraph = null;
  function buildGraph() {
    const nodes = [], idx = new Map(), adj = [], segs = [];
    const node = (lng, lat) => {
      const k = lng.toFixed(6) + "," + lat.toFixed(6);
      if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push(L.latLng(lat, lng)); adj.push([]); }
      return idx.get(k);
    };
    const link = (a, b) => { if (a === b) return; const d = distM(nodes[a], nodes[b]); adj[a].push([b, d]); adj[b].push([a, d]); segs.push([a, b]); };
    tracks.forEach((t) => {
      if (!isTrail(t.f)) return;
      const g = t.f.geometry;
      const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      lines.forEach((cs) => { for (let i = 1; i < cs.length; i++) link(node(cs[i - 1][0], cs[i - 1][1]), node(cs[i][0], cs[i][1])); });
    });
    return { nodes, adj, segs };
  }
  /** Nearest point on the network: {ll, a, b, d} where a–b is the segment it lies on. */
  function snapToNet(ll) {
    const G = navGraph, p = map.options.crs.project(ll);
    let best = null;
    for (const [a, b] of G.segs) {
      const A = map.options.crs.project(G.nodes[a]), B = map.options.crs.project(G.nodes[b]);
      const dx = B.x - A.x, dy = B.y - A.y, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / len)) : 0;
      const q = map.options.crs.unproject(L.point(A.x + t * dx, A.y + t * dy));
      const d = distM(ll, q);
      if (!best || d < best.d) best = { ll: q, a, b, d };
    }
    return best;
  }
  function routeBetween(from, to) {
    if (!navGraph) navGraph = buildGraph();
    const direct = distM(from, to);
    if (!navGraph.segs.length) return { pts: [from, to], len: direct, onTrail: false };
    const s = snapToNet(from), e = snapToNet(to);
    // Dijkstra with two temporary nodes (S, E) sitting on their segments.
    const G = navGraph, n = G.nodes.length, S = n, E = n + 1;
    const nodeLL = (i) => (i === S ? s.ll : i === E ? e.ll : G.nodes[i]);
    const extra = new Map([[S, []], [E, []]]);
    const addX = (x, y, d) => { extra.get(x)?.push([y, d]); if (!extra.has(y)) extra.set(y, []); extra.get(y).push([x, d]); };
    for (const [T, sn] of [[S, s], [E, e]]) { addX(T, sn.a, distM(sn.ll, G.nodes[sn.a])); addX(T, sn.b, distM(sn.ll, G.nodes[sn.b])); }
    if ((s.a === e.a && s.b === e.b) || (s.a === e.b && s.b === e.a)) addX(S, E, distM(s.ll, e.ll));
    const dist = new Map([[S, 0]]), prev = new Map(), done = new Set();
    const heap = [[0, S]];
    while (heap.length) {
      let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      const [du, u] = heap.splice(bi, 1)[0];
      if (done.has(u)) continue;
      done.add(u);
      if (u === E) break;
      for (const [v, w] of [...(u < n ? G.adj[u] : []), ...(extra.get(u) || [])]) {
        const nd = du + w;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); }
      }
    }
    const trailLen = dist.get(E);
    const total = trailLen == null ? Infinity : s.d + trailLen + e.d;
    // Walking straight is better when the trail route is a long way round, or the trails are far away.
    if (!isFinite(total) || total > direct * 2.2 + 60 || s.d > direct * 0.8) return { pts: [from, to], len: direct, onTrail: false };
    const path = [];
    for (let u = E; u != null; u = prev.get(u)) path.unshift(nodeLL(u));
    return { pts: [from, ...path, to], len: total, onTrail: true, offStart: s.d };
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
    nav.to = null;
    navPanel.hidden = true;
    document.body.classList.remove("navigating");
    if (!quiet) toast("Directions stopped.");
  }
  function drawRoute(r) {
    [nav.line, nav.lineCase, nav.lead].forEach((l) => l && nav.layer.removeLayer(l));
    const pts = r.pts;
    nav.lineCase = L.polyline(pts, { color: "#0b3d91", weight: 11, opacity: 0.55, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(nav.layer);
    nav.line = L.polyline(pts, { color: "#4fc3ff", weight: 6, opacity: 1, interactive: false, lineCap: "round", lineJoin: "round",
      dashArray: r.onTrail ? null : "2 10", className: "nv-line" }).addTo(nav.layer);
  }
  function updateNav(me) {
    if (!nav.to) return;
    const onQuarter = farmBounds && farmBounds.pad(1.5).contains(me);
    if (!onQuarter) {
      const d = distM(me, nav.to);
      $(".nv-dist", navPanel).textContent = fmtLen(d) + " away";
      $(".nv-sub", navPanel).textContent = "You're not at the quarter yet. Get driving directions:";
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
    const b = farmBounds.pad(0.15);
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
        Do it once at home on Wi-Fi (about 150 MB). Tip: use “Add to Home Screen” so it opens like an app.
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
  function fitFarm(animate = true) {
    if (!farmBounds) return;
    const side = isPhone() ? 20 : 60;
    const opts = { paddingTopLeft: [side, 80], paddingBottomRight: [side, 120] };
    if (animate) map.flyToBounds(farmBounds, { ...opts, duration: 0.8 }); else map.fitBounds(farmBounds, opts);
  }
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
  map.on("moveend zoomend", () => { refreshBackToFarm(); declutter(); });
  map.on("click", (e) => {
    if (measure.on) return addMeasurePoint(e.latlng, e.containerPoint);
    if (selectedTrack && sheet.hidden) highlightTrack(null);
  });
  window.addEventListener("resize", () => setTimeout(declutter, 100));

  // ================================================================ load
  function askPassword(retry) {
    return new Promise((resolve) => {
      $("#lock").hidden = false;
      $("#lock-err").hidden = !retry;
      const input = $("#lock-pw");
      input.value = "";
      setTimeout(() => input.focus(), 50);
      $("#lock-form").onsubmit = (e) => {
        e.preventDefault();
        $("#lock").hidden = true;
        resolve({ password: input.value, remember: $("#lock-remember").checked });
      };
    });
  }

  function start({ meta, data }) {
    $("#site-title").textContent = meta.title || "Knopp Map";
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
    fitFarm(false);
    setTimeout(probeImagery, 1500);
    refreshTracks();
    refreshPlaces();
    refreshPhotos();
    refreshBackToFarm();
    declutter();

    window.addEventListener("hashchange", () => {
      const [hk, hv] = decodeURIComponent(location.hash.slice(1)).split("=");
      if (hk === "place" && places.has(hv) && selectedPlace !== hv) openPlace(hv);
      else if (hk === "trail" && tracks.has(hv) && selectedTrack !== hv) openTrail(hv);
    });
    const h = decodeURIComponent(location.hash.slice(1));
    const [k, v] = h.split("=");
    if (k === "place" && places.has(v)) openPlace(v);
    else if (k === "trail" && tracks.has(v)) openTrail(v);
    else if (k === "tour") startTour((parseInt(v, 10) || 1) - 1);
    else if (!store.get("welcomed", false)) showWelcome();
  }

  loadBundle(askPassword).then(start).catch((err) => {
    console.error(err);
    alert(navigator.onLine ? "Sorry, the map couldn't load. Please refresh the page." : "You're offline and this map hasn't been saved on this device yet.");
  });
})();
