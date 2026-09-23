(() => {
  "use strict";
  const { icon, esc, fmtLen, fmtDate, store, loadBundle, photoUrl } = KM;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

  // Zoom levels at which things appear.
  const Z = { farmPin: 14.5, trails: 13.5, places: 14.5, minorPlaces: 17, roadLabels: 16, trailLabels: 17 };

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
  async function share(title, hash) {
    const url = location.origin + location.pathname + hash;
    try {
      if (navigator.share) return await navigator.share({ title, url });
      await navigator.clipboard.writeText(url);
      toast("Link copied. You can paste it into a message.");
    } catch (e) {
      if (e.name !== "AbortError") prompt("Copy this link:", url);
    }
  }

  // ================================================================ text size
  const SIZES = [16, 18, 20, 23, 26];
  let sizeIdx = store.get("size", 1);
  function applySize() {
    document.documentElement.style.fontSize = SIZES[sizeIdx] + "px";
    store.set("size", sizeIdx);
    setTimeout(declutter, 50);
  }
  $("#text-bigger").onclick = () => { sizeIdx = Math.min(SIZES.length - 1, sizeIdx + 1); applySize(); toast("Text size: " + SIZE_NAMES[sizeIdx], 1500); };
  $("#text-smaller").onclick = () => { sizeIdx = Math.max(0, sizeIdx - 1); applySize(); toast("Text size: " + SIZE_NAMES[sizeIdx], 1500); };
  const SIZE_NAMES = ["Small", "Normal", "Large", "Larger", "Largest"];
  applySize();

  // ================================================================ map
  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 90, maxZoom: 20, minZoom: 5 });
  L.control.zoom({ position: "topright", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);
  L.control.scale({ position: "bottomright", imperial: false }).addTo(map);
  window.kmMap = map;
  map.createPane("boundary").style.zIndex = 390;
  map.createPane("casing").style.zIndex = 395;
  map.createPane("trails").style.zIndex = 400;

  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const CARTO = "https://{s}.basemaps.cartocdn.com/";
  // Tiles keep old imagery on screen while zooming instead of flashing grey, and don't fetch mid-animation.
  const TILE_OPTS = { maxZoom: 21, updateWhenZooming: false, updateWhenIdle: L.Browser.mobile, keepBuffer: 4 };
  const esriLayer = (svc, key, attribution, extra = {}) =>
    L.tileLayer(ESRI + svc + "/MapServer/tile/{z}/{y}/{x}", { ...TILE_OPTS, maxNativeZoom: nativeZoom(key), attribution, ...extra });
  const IMG_ATTR = "Imagery © Esri, Maxar, Earthstar Geographics";
  const OSM_ATTR = "© OpenStreetMap contributors";
  const BASEMAPS = {
    satellite: { label: "Satellite", swatch: "#3f5b33", make: () => esriLayer("World_Imagery", "img", IMG_ATTR) },
    hybrid: { label: "Satellite + roads", swatch: "#4a6a3c", make: () => L.layerGroup([esriLayer("World_Imagery", "img", IMG_ATTR),
      esriLayer("Reference/World_Transportation", "ref", ""), esriLayer("Reference/World_Boundaries_and_Places", "ref", "")]) },
    topo: { label: "Topographic", swatch: "#d9d2b0", make: () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { ...TILE_OPTS, maxNativeZoom: 17, attribution: OSM_ATTR + ", SRTM | OpenTopoMap" }) },
    esritopo: { label: "Detailed topo", swatch: "#e8e4d0", make: () => esriLayer("World_Topo_Map", "topo", "Esri, HERE, Garmin, USGS") },
    street: { label: "Street map", swatch: "#f2efe9", make: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { ...TILE_OPTS, maxNativeZoom: 19, attribution: OSM_ATTR }) },
    light: { label: "Clean & light", swatch: "#f5f5f3", make: () => L.tileLayer(CARTO + "rastertiles/voyager/{z}/{x}/{y}{r}.png",
      { ...TILE_OPTS, maxNativeZoom: 20, attribution: OSM_ATTR + " © CARTO" }) },
    dark: { label: "Night", swatch: "#1d2327", make: () => L.tileLayer(CARTO + "dark_all/{z}/{x}/{y}{r}.png",
      { ...TILE_OPTS, maxNativeZoom: 20, attribution: OSM_ATTR + " © CARTO" }) },
    bw: { label: "Black & white", swatch: "#8a8a8a", filter: "bw", make: () => esriLayer("World_Imagery", "img", IMG_ATTR) },
    parchment: { label: "Old parchment map", swatch: "#d8c08f", filter: "parchment", make: () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { ...TILE_OPTS, maxNativeZoom: 17, attribution: OSM_ATTR + ", SRTM | OpenTopoMap" }) },
    vintage: { label: "Vintage photo", swatch: "#a88b5c", filter: "vintage", make: () => esriLayer("World_Imagery", "img", IMG_ATTR) },
    blueprint: { label: "Blueprint", swatch: "#1d4f86", filter: "blueprint", make: () => esriLayer("World_Imagery", "img", IMG_ATTR) },
  };

  // ---- how deep the real imagery goes here (Esri shows a grey "Map data not yet available" tile beyond it)
  const PROBE = { img: "World_Imagery", topo: "World_Topo_Map", ref: "Reference/World_Transportation" };
  const native = store.get("nativeZoom", {});
  function nativeZoom(key) {
    const n = native[key];
    return n && n.z ? n.z : key === "ref" ? 17 : 17;
  }
  function probeTile(svc, z, lat, lng) {
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
          resolve(grey / 1024 < 0.6);
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
      for (let z = 20; z >= 15; z--) {
        const res = await Promise.all(pts.map((p) => probeTile(svc, z, p.lat, p.lng)));
        if (res.some((r) => r === null)) { found = undefined; break; }   // network trouble: try again next visit
        if (res.every(Boolean)) { found = z; break; }
      }
      if (found === undefined) continue;
      native[key] = { z: found ?? 15, at: Date.now() };
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

  let baseKey = store.get("base", null);
  let baseLayer = null;
  let dim = store.get("dim", 100);
  function applyMapLook() {
    const el = map.getContainer();
    const f = BASEMAPS[baseKey]?.filter || "";
    el.dataset.filter = f;
    el.style.setProperty("--dim", dim / 100);
    if (dim < 100) el.dataset.dim = ""; else delete el.dataset.dim;
  }
  function setBase(k) {
    if (!BASEMAPS[k]) k = THEMES[theme].base;
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = BASEMAPS[k].make().addTo(map);
    baseKey = k;
    store.set("base", k);
    applyMapLook();
  }

  // ================================================================ themes
  const THEMES = {
    farmhouse: { label: "Farmhouse", note: "Warm cream and green", base: "satellite", sw: ["#fbf8f1", "#2f5d3a", "#f2c200"],
      lines: { trail: "#fff3c4", trailCase: "#10140e", road: "#eadcbc", roadCase: "#2b2418", sel: "#f2c200", caseOp: 0.6 } },
    middleearth: { label: "Middle-earth", note: "Parchment and ink, like an old fantasy map", base: "parchment", sw: ["#f1e2bd", "#6b3e1f", "#9c2f1c"],
      font: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Alegreya:wght@400;700&display=swap",
      lines: { trail: "#4a2c12", trailCase: "#f3e3bd", road: "#6b3e1f", roadCase: "#f3e3bd", sel: "#9c2f1c", caseOp: 0.75, dash: "7 5", boundary: "#7a1f12" } },
    night: { label: "Night sky", note: "Dark and easy on the eyes", base: "dark", sw: ["#1c2126", "#3fb68b", "#ffcc4d"],
      lines: { trail: "#7fdcff", trailCase: "#05080a", road: "#cfd8dc", roadCase: "#05080a", sel: "#ffcc4d", caseOp: 0.8, boundary: "#ffcc4d" } },
    prairie: { label: "Prairie sky", note: "Bright, clean and modern", base: "hybrid", sw: ["#ffffff", "#1f6feb", "#ff9f1c"],
      lines: { trail: "#ffffff", trailCase: "#1f6feb", road: "#ffe8b3", roadCase: "#7a4b00", sel: "#ff9f1c", caseOp: 0.85 } },
    blueprint: { label: "Blueprint", note: "Surveyor's drafting table", base: "blueprint", sw: ["#0f2a4a", "#4aa3ff", "#ffd166"],
      lines: { trail: "#e6f0ff", trailCase: "#0b2140", road: "#ffffff", roadCase: "#0b2140", sel: "#ffd166", caseOp: 0.7, dash: "2 6", boundary: "#ffd166" } },
    contrast: { label: "High contrast", note: "Biggest, boldest and easiest to see", base: "satellite", sw: ["#000000", "#ffd400", "#ffffff"],
      lines: { trail: "#ffd400", trailCase: "#000000", road: "#ffffff", roadCase: "#000000", sel: "#ff3b30", caseOp: 1, extra: 1.5, boundary: "#ffffff" } },
  };
  let theme = THEMES[store.get("theme", "farmhouse")] ? store.get("theme", "farmhouse") : "farmhouse";
  function applyTheme(k, { pickBase = false } = {}) {
    theme = k;
    store.set("theme", k);
    document.documentElement.dataset.theme = k;
    const t = THEMES[k];
    if (t.font && !document.querySelector(`link[data-font="${k}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = t.font; l.dataset.font = k;
      document.head.append(l);
    }
    document.querySelector('meta[name="theme-color"]').content = t.sw[1];
    if (pickBase) setBase(t.base);
    tracks.forEach((tr) => restyle(tr));
  }
  document.documentElement.dataset.theme = theme;
  setBase(baseKey);

  // ================================================================ state
  let farmBounds = null, farmPin = null;
  let trailsOn = store.get("trailsOn", true);
  let photosOn = store.get("photosOn", false);
  let labelsOn = store.get("labelsOn", true);
  const ADV_DEFAULTS = { colourMode: "simple", thickness: 1, placeNames: true, minorSpots: true, hiddenTypes: [], lengthFilter: "all",
    trailDay: "all", cluster: true, boundaryFill: true };
  const adv = { ...ADV_DEFAULTS, ...store.get("adv", {}) };
  const saveAdv = () => store.set("adv", adv);
  const LENGTHS = { all: [0, 1e9], short: [0, 250], medium: [250, 600], long: [600, 1e9] };
  const hiddenTracks = new Set(store.get("hiddenTracks", []));
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
      const col = f.id === "quarter-section-boundary" && L_.boundary ? L_.boundary : f.properties.color;
      return { line: { color: col, weight: (3 + boost) * k + (hi ? 2 : 0), dashArray: hi ? null : "10 7", opacity: 1, fillColor: col,
        fillOpacity: adv.boundaryFill ? (hi ? 0.12 : 0.05) : 0 }, casing: { opacity: 0, fillOpacity: 0, weight: 0 } };
    }
    const road = c === "roads";
    const w = ((road ? 5 : 3.5) + boost) * k + (hi ? 2.5 : 0);
    const color = hi ? L_.sel : trailColour(f);
    return {
      line: { color, weight: w, opacity: 1, lineCap: "round", lineJoin: "round", dashArray: !road && !hi && L_.dash ? L_.dash : null },
      casing: { color: road ? L_.roadCase : L_.trailCase, weight: w + 3.5 * k, opacity: hi ? 0.95 : L_.caseOp, lineCap: "round", lineJoin: "round" },
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
    const t = { f, line, casing, group, label };
    tracks.set(f.id, t);
    restyle(t);
    if (f.id === "quarter-section-boundary") farmBounds = line.getBounds();
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
      const lab = labelShouldShow(t);
      if (lab && !map.hasLayer(t.label)) t.label.addTo(map);
      if (!lab && map.hasLayer(t.label)) map.removeLayer(t.label);
    });
  }

  // ================================================================ places
  function placeIcon(f, sel = false) {
    const p = f.properties;
    const minor = !p.featured;
    return L.divIcon({
      className: "", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="place-pin${minor ? " minor" : ""}${sel ? " sel" : ""}" style="margin-top:${minor ? "-0.85rem" : "-1.3rem"}">
        <div class="bubble">${icon(p.icon)}</div>${minor || (!adv.placeNames && !sel) ? "" : `<div class="name">${esc(p.name)}</div>`}</div>`,
    });
  }
  function addPlace(f) {
    const [lon, lat] = f.geometry.coordinates;
    const marker = L.marker([lat, lon], { icon: placeIcon(f), keyboard: true, title: f.properties.name || "Photo spot",
      alt: f.properties.name || "Photo spot", zIndexOffset: f.properties.featured ? 500 : 0, riseOnHover: true });
    marker.on("click", () => openPlace(f.id));
    places.set(f.id, { f, marker, photos: f.properties.photos.map((id) => photoById.get(id)).filter(Boolean) });
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
      if (isPhone()) pt = pt.add([0, window.innerHeight * 0.3]);
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
      <div class="btn-row"><button class="big" data-act="zoom">🔍 Zoom in here</button><button class="big ghost" data-act="share">📤 Share</button></div>
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
    $('[data-act="share"]', body).onclick = () => share(title, "#place=" + encodeURIComponent(id));
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
      ${p.profile && isTrail(t.f) ? `<h3>Ups and downs</h3>${elevationSvg(p.profile)}` : ""}
      <div class="btn-row"><button class="big" data-act="fit">🔍 Show the whole ${kind.toLowerCase()}</button><button class="big ghost" data-act="share">📤 Share</button></div>
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
    $('[data-act="share"]', body).onclick = () => share(p.name, "#trail=" + encodeURIComponent(id));
    openSheet(`🥾 ${p.name}`, body, { back: back ?? false });
    if (fly) fit();
    setTimeout(declutter, 50);
  }

  // ================================================================ photo pins layer
  const photoCluster = L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, disableClusteringAtZoom: 19 });
  const photoPlain = L.layerGroup();
  let photoLayer = adv.cluster ? photoCluster : photoPlain;
  const photoIcon = L.divIcon({ className: "", html: '<div class="photo-pin">📷</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
  let photoDay = "all";
  function refreshPhotos() {
    [photoCluster, photoPlain].forEach((l) => { l.clearLayers(); if (map.hasLayer(l) && l !== (adv.cluster ? photoCluster : photoPlain)) map.removeLayer(l); });
    photoLayer = adv.cluster ? photoCluster : photoPlain;
    const ms = allPhotos.filter((x) => photoDay === "all" || x.p.taken?.slice(0, 10) === photoDay).map((x) => x.m);
    if (adv.cluster) photoCluster.addLayers(ms); else ms.forEach((m) => photoPlain.addLayer(m));
    if (photosOn && !map.hasLayer(photoLayer)) photoLayer.addTo(map);
    if (!photosOn && map.hasLayer(photoLayer)) map.removeLayer(photoLayer);
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
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
  }
  function closeSheet() {
    const cbs = [sheetCurrent, ...sheetStack].map((s) => s?.onClose).filter(Boolean);
    sheet.hidden = true;
    sheetStack.length = 0;
    sheetCurrent = null;
    document.body.classList.remove("sheet-open");
    $$("#dock button.active").forEach((b) => b.classList.remove("active"));
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
  function setDockActive(act) {
    $$("#dock button").forEach((b) => b.classList.toggle("active", b.dataset.act === act));
  }

  // ================================================================ places list
  function placesSheet() {
    const featured = featuredPlaces().sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
    const minor = [...places.values()].filter((pl) => !pl.f.properties.featured);
    const body = document.createElement("div");
    body.innerHTML = `<h3>Places on the farm</h3>`;
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
      const pl = [...places.values()].filter((x) => (placeTitle(x) + " " + (x.f.properties.story || "")).toLowerCase().includes(q));
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
      <button class="big ghost" data-act="all" style="margin-top:.6rem">📷 See all ${pl.photos.length} photos here</button>
      <div class="tour-nav">
        <button class="big ghost" data-act="prev" ${tourIdx === 0 ? "disabled" : ""}>‹ Back</button>
        <button class="big" data-act="next">${tourIdx === n - 1 ? "Finish ✓" : "Next ›"}</button>
      </div>`;
    $(".place-hero", body)?.addEventListener("click", () => openLightbox(pl.photos, Math.max(0, pl.photos.indexOf(hero)), title));
    $('[data-act="all"]', body).onclick = () => openLightbox(pl.photos, 0, title);
    $('[data-act="prev"]', body).onclick = () => { tourIdx--; showTourStop(); };
    $('[data-act="next"]', body).onclick = () => {
      if (tourIdx === n - 1) { closeSheet(); fitFarm(); toast("That's the end of the tour. Thanks for visiting!"); return; }
      tourIdx++; showTourStop();
    };
    openSheet(tour.title || "Tour of the farm", body, { onClose: () => { tourIdx = -1; } });
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

  function moreSheet() {
    const body = document.createElement("div");
    const advOpen = store.get("advOpen", false);
    body.innerHTML = `
      <h3>Look</h3><div class="theme-grid" id="m-theme"></div>
      <h3>Map style</h3><div class="style-grid" id="m-base"></div>
      <h3>Text size</h3><div class="seg" id="m-size"></div>
      <h3>On the map</h3><div id="m-basic"></div>
      <h3>Use without internet</h3><div id="m-offline"></div>
      <details class="adv" id="m-adv" ${advOpen ? "open" : ""}>
        <summary><span>🎛️ Advanced options &amp; filters</span><small>colours, filters, labels, every trail</small></summary>
        <h3>Trail colours</h3><div class="seg" id="a-colour"></div>
        <h3>Line thickness</h3><div class="seg" id="a-thick"></div>
        <h3>Map brightness</h3>
        <div class="range-row"><span>🌑</span><input type="range" id="a-dim" min="35" max="100" step="5" aria-label="Map brightness"><span>☀️</span></div>
        <h3>Trail length</h3><div class="seg" id="a-length"></div>
        <h3>Trails recorded on</h3><div class="seg" id="a-tday"></div>
        <h3>Kinds of places</h3><div class="chips" id="a-types"></div>
        <h3>Labels &amp; extras</h3><div id="a-checks"></div>
        <h3>Photo pins</h3><div class="seg" id="a-pday"></div><div id="a-pchecks"></div>
        <h3>Legend</h3><div class="legend" id="m-legend"></div>
        <h3>Choose trails one by one</h3><div id="m-tracks"></div>
        <button class="big ghost" id="a-reset" style="margin-top:1rem">↺ Reset everything to normal</button>
      </details>
      <h3>Help</h3>
      <div class="btn-row" style="flex-wrap:wrap"><button class="big ghost" id="m-help">Show the welcome tips</button>
        <button class="big ghost" id="m-share">📤 Share this map</button></div>`;
    $("#m-adv", body).ontoggle = (e) => store.set("advOpen", e.target.open);

    // themes
    const tg = $("#m-theme", body);
    Object.entries(THEMES).forEach(([k, t]) => {
      const b = document.createElement("button");
      b.className = "theme-card" + (k === theme ? " on" : "");
      b.innerHTML = `<span class="theme-sw">${t.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${esc(t.label)}</b><small>${esc(t.note)}</small>`;
      b.onclick = () => {
        applyTheme(k, { pickBase: true });
        $$(".theme-card", tg).forEach((x) => x.classList.toggle("on", x === b));
        $$(".style-card", body).forEach((x) => x.classList.toggle("on", x.dataset.k === baseKey));
        drawLegend();
      };
      tg.append(b);
    });
    // map styles
    const bg = $("#m-base", body);
    Object.entries(BASEMAPS).forEach(([k, m]) => {
      const b = document.createElement("button");
      b.className = "style-card" + (k === baseKey ? " on" : "");
      b.dataset.k = k;
      b.innerHTML = `<span class="style-sw sw-${k}" style="background:${m.swatch}"></span><span>${esc(m.label)}</span>`;
      b.onclick = () => { setBase(k); $$(".style-card", bg).forEach((x) => x.classList.toggle("on", x === b)); };
      bg.append(b);
    });
    seg($("#m-size", body), SIZE_NAMES.map((l, i) => [i, l]), sizeIdx, (i) => { sizeIdx = i; applySize(); });
    const basic = $("#m-basic", body);
    const trBox = check(basic, "Trails &amp; roads", trailsOn, (v) => setTrails(v));
    void trBox;
    check(basic, "Trail names (when zoomed in)", labelsOn, (v) => { labelsOn = v; store.set("labelsOn", v); refreshTracks(); declutter(); });
    const phBox = check(basic, "Every photo as a camera pin", photosOn, (v) => setPhotos(v));
    offlinePanel($("#m-offline", body));

    // ---- advanced
    const restyleAll = () => { tracks.forEach(restyle); drawLegend(); saveAdv(); };
    seg($("#a-colour", body), [["simple", "One colour"], ["each", "Each trail its own"], ["steep", "By steepness"], ["length", "By length"]],
      adv.colourMode, (v) => { adv.colourMode = v; restyleAll(); });
    seg($("#a-thick", body), [[0.7, "Thin"], [1, "Normal"], [1.4, "Thick"], [1.9, "Extra thick"]], adv.thickness,
      (v) => { adv.thickness = v; restyleAll(); });
    const dimEl = $("#a-dim", body);
    dimEl.value = dim;
    dimEl.oninput = () => { dim = +dimEl.value; store.set("dim", dim); applyMapLook(); };
    const refilter = () => { saveAdv(); refreshTracks(); refreshPlaces(); declutter(); };
    seg($("#a-length", body), [["all", "All"], ["short", "Short (under 250 m)"], ["medium", "Medium"], ["long", "Long (over 600 m)"]],
      adv.lengthFilter, (v) => { adv.lengthFilter = v; refilter(); });
    const tdays = [...new Set([...tracks.values()].map((t) => (t.f.properties.recorded || "").slice(0, 10)).filter(Boolean))].sort();
    seg($("#a-tday", body), [["all", "Any day"], ...tdays.map((d) => [d, fmtDate(d + "T12:00:00-06:00", false)])], adv.trailDay,
      (v) => { adv.trailDay = v; refilter(); });
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
    check(ac, "Place names next to pins", adv.placeNames, (v) => { adv.placeNames = v; saveAdv(); places.forEach((pl) => pl.marker.setIcon(placeIcon(pl.f, pl.f.id === selectedPlace))); declutter(); });
    check(ac, "Small photo spots (when zoomed in)", adv.minorSpots, (v) => { adv.minorSpots = v; refilter(); });
    check(ac, "Shade inside the property line", adv.boundaryFill, (v) => { adv.boundaryFill = v; restyleAll(); });
    const pdays = [...new Set(allPhotos.map((x) => x.p.taken?.slice(0, 10)).filter(Boolean))].sort();
    seg($("#a-pday", body), [["all", "All days"], ...pdays.map((d) => [d, fmtDate(d + "T12:00:00-06:00", false)])], photoDay,
      (k) => { photoDay = k; if (!photosOn) { phBox.checked = true; setPhotos(true); } refreshPhotos(); });
    check($("#a-pchecks", body), "Group nearby photos together", adv.cluster, (v) => { adv.cluster = v; saveAdv(); refreshPhotos(); });

    const drawLegend = () => {
      const L_ = THEMES[theme].lines;
      const line = (c, extra = "") => `<span class="sym"><span class="line" style="border-color:${c};${extra}filter:drop-shadow(0 0 1px #000)"></span></span>`;
      let trailRows = "";
      if (adv.colourMode === "steep") trailRows = RAMP_STEEP.map(([lim, c], i) => line(c) + `<span>${i === 0 ? "Flat" : i === RAMP_STEEP.length - 1 ? "Steepest" : ["Gentle", "Some hills", "Hilly"][i - 1]}</span>`).join("");
      else if (adv.colourMode === "length") trailRows = RAMP_LEN.map(([lim, c], i) => line(c) + `<span>${i === RAMP_LEN.length - 1 ? "Over 800 m" : "Up to " + lim + " m"}</span>`).join("");
      else trailRows = line(adv.colourMode === "each" ? "#00e5ff" : L_.trail) + `<span>Trails${adv.colourMode === "each" ? " (each has its own colour)" : ""}</span>`;
      $("#m-legend", body).innerHTML = `
        ${line(L_.boundary || "#fff", "border-top-style:dashed;")}<span>Property boundary</span>
        ${line("#ff9800", "border-top-style:dashed;")}<span>Acreage parcel</span>
        ${line(L_.road, "border-top-width:6px;")}<span>Roads and yard</span>
        ${trailRows}
        ${line(L_.sel, "border-top-width:6px;")}<span>The trail you picked</span>
        <span class="sym"><span class="place-pin" style="margin:0"><span class="bubble" style="width:1.9rem;height:1.9rem;font-size:1rem">🏠</span></span></span><span>A named place – tap it for photos</span>
        <span class="sym"><span class="place-pin minor" style="margin:0"><span class="bubble">📷</span></span></span><span>Other photo spot</span>
        <span class="sym"><span class="me-dot" style="position:relative;display:inline-block"><span class="arrow" style="position:relative;left:0;top:0;display:block;width:20px;height:20px"></span></span></span><span>You (after tapping “Me”)</span>`;
    };
    drawLegend();

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
    $("#a-reset", body).onclick = () => {
      Object.assign(adv, ADV_DEFAULTS, { hiddenTypes: [] });
      saveAdv();
      hiddenTracks.clear(); store.set("hiddenTracks", []);
      dim = 100; store.set("dim", 100);
      photoDay = "all"; labelsOn = true; store.set("labelsOn", true);
      setPhotos(false); if (!trailsOn) setTrails(true);
      applyTheme("farmhouse", { pickBase: true });
      refreshPhotos(); refreshTracks(); refreshPlaces();
      places.forEach((pl) => pl.marker.setIcon(placeIcon(pl.f)));
      toast("Everything is back to normal.");
      moreSheet();
    };
    $("#m-help", body).onclick = () => { closeSheet(); showWelcome(); };
    $("#m-share", body).onclick = () => share($("#site-title").textContent, "");
    openSheet("☰ More options", body);
    setDockActive("more");
  }

  function setTrackHidden(id, hide) {
    if (hide) hiddenTracks.add(id); else hiddenTracks.delete(id);
    store.set("hiddenTracks", [...hiddenTracks]);
    refreshTracks();
    declutter();
  }
  function setTrails(on) {
    trailsOn = on;
    store.set("trailsOn", on);
    $('#dock [data-act="trails"]').setAttribute("aria-pressed", on);
    refreshTracks();
    declutter();
    toast(on ? "Trails are showing" : "Trails are hidden", 1500);
  }
  function setPhotos(on) {
    photosOn = on;
    store.set("photosOn", on);
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
  $('[data-lb="share"]', lb).onclick = () => {
    const p = lbList[lbIdx];
    if (p.place) share(lbTitle, "#place=" + encodeURIComponent(p.place)); else share(lbTitle, "");
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

  // ================================================================ welcome
  function showWelcome() { $("#welcome").hidden = false; $("#welcome-tour").focus(); }
  const doneWelcome = () => { $("#welcome").hidden = true; store.set("welcomed", true); };
  $("#welcome-ok").onclick = doneWelcome;
  $("#welcome-tour").onclick = () => { doneWelcome(); startTour(0); };
  $("#help-btn").onclick = showWelcome;

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
      else toast("You're not at the farm right now. The blue dot shows where you are.", 5000);
    }
    const chip = $("#loc-chip");
    if (!onFarm) {
      const d = farmBounds ? distM(ll, farmBounds.getCenter()) : 0;
      chip.textContent = `🏠 The farm is ${fmtLen(d)} away`;
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
  }
  function onPosErr(err) {
    stopFollow();
    toast(err.code === 1 ? "Location is turned off for this website. You can allow it in your browser settings." : "Couldn't find your location right now.", 5000);
  }

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
      <p class="note">Save the map to this device so it still works at the farm with no cell signal.
        ${saved ? `<br><b>Saved ${esc(fmtDate(saved.at, false))}</b> (${esc(saved.kind)}).` : ""}</p>
      <div class="btn-row" style="flex-wrap:wrap">
        <button class="big" data-kind="light">💾 Save map + small photos (about 25 MB)</button>
        <button class="big ghost" data-kind="full">Save everything incl. full photos (about 150 MB)</button>
      </div>
      <div class="bar" hidden><span></span></div><p class="note" data-status></p>`;
    $$("button[data-kind]", el).forEach((b) => b.onclick = () => saveOffline(b.dataset.kind, el));
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
        store.set("offlineSaved", { at: new Date().toISOString(), kind: kind === "full" ? "everything" : "map + small photos" });
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
    if (act === "more") toggle(moreSheet);
    if (act === "tour") toggle(() => startTour(Math.max(0, tourIdx)));
    if (act === "trails") setTrails(!trailsOn);
    if (act === "locate") { if (watchId == null) startFollow(); else { stopFollow(); toast("Stopped showing your location", 1500); } }
  });
  $("#back-to-farm").onclick = () => fitFarm();
  function refreshBackToFarm() {
    if (!farmBounds) return;
    $("#back-to-farm").hidden = !(!map.getBounds().intersects(farmBounds) || map.getZoom() < 12.5);
  }
  map.on("zoomend", () => { refreshTracks(); refreshPlaces(); });
  map.on("moveend zoomend", () => { refreshBackToFarm(); declutter(); });
  map.on("click", () => { if (selectedTrack && sheet.hidden) highlightTrack(null); });
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
    categories = data.tracks.categories || {};
    tour = data.tour || { stops: [] };
    data.tracks.features.filter((f) => f.geometry.type !== "Point").forEach(addTrack);

    data.photos.features.forEach((f) => {
      const p = f.properties;
      photoById.set(p.file, p);
      const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: photoIcon, title: "Photo" });
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
