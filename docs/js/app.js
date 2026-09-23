(() => {
  "use strict";
  const { icon, esc, fmtLen, walkMins, fmtDate, store, getJSON } = KM;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

  // Zoom thresholds for what appears on the map.
  const Z = { farmPin: 14.5, trails: 13.5, places: 14.5, minorPlaces: 17, roadLabels: 16, trailLabels: 17 };

  // ---------------------------------------------------------------- text size
  const SIZES = [16, 18, 20, 23, 26];
  let sizeIdx = store.get("size", 1);
  function applySize() {
    document.documentElement.style.fontSize = SIZES[sizeIdx] + "px";
    store.set("size", sizeIdx);
    setTimeout(declutter, 50);
  }
  $("#text-bigger").onclick = () => { sizeIdx = Math.min(SIZES.length - 1, sizeIdx + 1); applySize(); };
  $("#text-smaller").onclick = () => { sizeIdx = Math.max(0, sizeIdx - 1); applySize(); };
  applySize();

  // ---------------------------------------------------------------- map
  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 90, maxZoom: 20, minZoom: 5 });
  L.control.zoom({ position: "topright", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);
  L.control.scale({ position: "bottomright", imperial: false }).addTo(map);
  window.kmMap = map;
  map.createPane("boundary").style.zIndex = 390;
  map.createPane("trails").style.zIndex = 400;

  const BASEMAPS = {
    satellite: ["Satellite", () => L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" })],
    hybrid: ["Satellite + roads", () => L.layerGroup([BASEMAPS.satellite[1](),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19 }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19 })])],
    topo: ["Topographic", () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { maxZoom: 20, maxNativeZoom: 17, attribution: "© OpenStreetMap contributors, SRTM | OpenTopoMap" })],
    street: ["Street map", () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap contributors" })],
  };
  let baseKey = store.get("base", "satellite");
  let baseLayer = null;
  function setBase(k) {
    if (!BASEMAPS[k]) k = "satellite";
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = BASEMAPS[k][1]().addTo(map);
    baseKey = k;
    store.set("base", k);
  }
  setBase(baseKey);

  // ---------------------------------------------------------------- state
  let farmBounds = null;
  let farmPin = null;
  let trailsOn = store.get("trailsOn", true);
  let photosOn = store.get("photosOn", false);
  let labelsOn = store.get("labelsOn", true);
  const hiddenTracks = new Set(store.get("hiddenTracks", []));
  const tracks = new Map();   // id -> {f, line, group, label}
  const places = new Map();   // id -> {f, marker, photos:[props]}
  const photoById = new Map();
  let categories = {};
  let selectedTrack = null;
  let selectedPlace = null;

  // ---------------------------------------------------------------- tracks
  function lineWeight(f, hi) {
    const z = map.getZoom();
    const base = f.properties.category === "boundary" ? 3 : f.properties.category === "roads" ? 5 : 4;
    const zoomBoost = z >= 18 ? 2 : z >= 16 ? 1 : 0;
    return base + zoomBoost + (hi ? 3 : 0);
  }
  function lineStyle(f, hi = false) {
    const boundary = f.properties.category === "boundary";
    return {
      color: f.properties.color, weight: lineWeight(f, hi), opacity: 1, lineCap: "round", lineJoin: "round",
      dashArray: boundary && !hi ? "10 7" : null, fillColor: f.properties.color, fillOpacity: boundary ? 0.05 : 0,
    };
  }
  const isTrail = (f) => f.properties.category !== "boundary";

  function midpoint(g) {
    const c = g.type === "LineString" ? g.coordinates : g.coordinates[0];
    const p = c[Math.floor(c.length / 2)];
    return L.latLng(p[1], p[0]);
  }

  function addTrack(f) {
    const pane = f.properties.category === "boundary" ? "boundary" : "trails";
    const line = L.geoJSON(f, { pane, style: () => lineStyle(f) });
    const hit = L.geoJSON(f, { pane, style: { weight: 22, opacity: 0, fillOpacity: 0 }, interactive: true });
    const group = L.featureGroup([hit, line]);
    const p = f.properties;
    group.bindPopup(`<div class="trail-pop"><b>${esc(p.name)}</b><small>${fmtLen(p.length_m)}` +
      (isTrail(f) ? ` · about ${walkMins(p.length_m)} min walk` : "") + `</small></div>`);
    group.on("popupopen", () => highlightTrack(f.id));
    group.on("popupclose", () => highlightTrack(null));
    if (!L.Browser.mobile) {
      group.on("mouseover", () => line.setStyle(lineStyle(f, true)));
      group.on("mouseout", () => { if (selectedTrack !== f.id) line.setStyle(lineStyle(f)); });
    }
    const label = L.tooltip({ permanent: true, direction: "center", className: "trail-label", interactive: false, pane: "tooltipPane" })
      .setLatLng(f.geometry.type === "Polygon" ? line.getBounds().getCenter() : midpoint(f.geometry))
      .setContent(esc(p.name));
    tracks.set(f.id, { f, line, group, label });
    if (f.id === "quarter-section-boundary") farmBounds = line.getBounds();
  }

  function highlightTrack(id) {
    if (selectedTrack && tracks.has(selectedTrack)) {
      const t = tracks.get(selectedTrack);
      t.line.setStyle(lineStyle(t.f));
    }
    selectedTrack = id;
    if (id) {
      const t = tracks.get(id);
      t.line.setStyle(lineStyle(t.f, true));
      t.line.bringToFront();
    }
  }

  function trackShouldShow(t) {
    if (hiddenTracks.has(t.f.id)) return false;
    if (!isTrail(t.f)) return true;
    return trailsOn && map.getZoom() >= Z.trails;
  }
  function labelShouldShow(t) {
    if (!labelsOn || !trackShouldShow(t) || !isTrail(t.f)) return false;
    return map.getZoom() >= (t.f.properties.category === "roads" ? Z.roadLabels : Z.trailLabels);
  }

  function refreshTracks() {
    tracks.forEach((t) => {
      const show = trackShouldShow(t);
      if (show && !map.hasLayer(t.group)) t.group.addTo(map);
      if (!show && map.hasLayer(t.group)) map.removeLayer(t.group);
      if (show) t.line.setStyle(lineStyle(t.f, selectedTrack === t.f.id));
      const lab = labelShouldShow(t);
      if (lab && !map.hasLayer(t.label)) t.label.addTo(map);
      if (!lab && map.hasLayer(t.label)) map.removeLayer(t.label);
    });
  }

  // ---------------------------------------------------------------- places
  function placeIcon(f, sel = false) {
    const p = f.properties;
    const minor = !p.featured;
    const title = p.name || "Photo spot";
    return L.divIcon({
      className: "", iconSize: [0, 0], iconAnchor: [0, 0],
      html: `<div class="place-pin${minor ? " minor" : ""}${sel ? " sel" : ""}" style="margin-top:${minor ? "-0.85rem" : "-1.3rem"}">
        <div class="bubble" role="button" aria-label="${esc(title)}">${icon(p.icon)}</div>
        ${minor ? "" : `<div class="name">${esc(p.name)}</div>`}</div>`,
    });
  }

  function addPlace(f) {
    const [lon, lat] = f.geometry.coordinates;
    const marker = L.marker([lat, lon], { icon: placeIcon(f), keyboard: true, title: f.properties.name || "Photo spot",
      zIndexOffset: f.properties.featured ? 500 : 0, riseOnHover: true });
    marker.on("click", () => openPlace(f.id));
    places.set(f.id, { f, marker, photos: f.properties.photos.map((id) => photoById.get(id)).filter(Boolean) });
  }

  function refreshPlaces() {
    const z = map.getZoom();
    places.forEach((pl) => {
      const show = pl.f.properties.featured ? z >= Z.places : z >= Z.minorPlaces && !photosOn;
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
    if (selectedPlace && places.has(selectedPlace)) {
      const pl = places.get(selectedPlace);
      pl.marker.setIcon(placeIcon(pl.f));
    }
    selectedPlace = id;
    if (id) {
      const pl = places.get(id);
      pl.marker.setIcon(placeIcon(pl.f, true));
    }
    setTimeout(declutter, 0);
  }

  function placeTitle(pl) {
    if (pl.f.properties.name) return pl.f.properties.name;
    const near = pl.photos.find((x) => x.near)?.near;
    return near ? `Photo spot on ${near}` : "Photo spot";
  }

  function openPlace(id, { fly = true } = {}) {
    const pl = places.get(id);
    if (!pl) return;
    const p = pl.f.properties;
    selectPlace(id);
    history.replaceState(null, "", "#place=" + encodeURIComponent(id));
    const hero = pl.photos.find((x) => x.file === p.hero) || pl.photos[0];
    const days = [...new Set(pl.photos.map((x) => fmtDate(x.taken, false)))].join(", ");
    const body = document.createElement("div");
    body.innerHTML = `
      ${hero ? `<img class="place-hero" src="photos/web/${esc(hero.file)}.jpg" alt="${esc(placeTitle(pl))}">` : ""}
      ${p.story ? `<p class="place-story">${esc(p.story)}</p>` : ""}
      <p class="place-meta">${pl.photos.length} photo${pl.photos.length === 1 ? "" : "s"} · taken ${esc(days)}</p>
      <div class="gallery">${pl.photos.map((x, i) => `<button data-i="${i}" aria-label="Open photo ${i + 1}">
        <img src="photos/thumb/${esc(x.file)}.jpg" alt="" loading="lazy"></button>`).join("")}</div>
      <div class="btn-row"><button class="big" data-act="zoom">🔍 Zoom in here</button></div>`;
    const heroIdx = Math.max(0, pl.photos.indexOf(hero));
    $(".place-hero", body)?.addEventListener("click", () => openLightbox(pl.photos, heroIdx, placeTitle(pl)));
    $$(".gallery button", body).forEach((b) => b.onclick = () => openLightbox(pl.photos, +b.dataset.i, placeTitle(pl)));
    $('[data-act="zoom"]', body).onclick = () => {
      if (isPhone()) closeSheet();
      map.flyTo(pl.marker.getLatLng(), 19, { duration: 0.8 });
    };
    openSheet(`${icon(p.icon)} ${placeTitle(pl)}`, body, { back: sheetStack.length ? true : false });
    if (fly) {
      const ll = pl.marker.getLatLng();
      const z = Math.max(map.getZoom(), 17.5);
      if (isPhone()) {
        // keep the place visible above the bottom sheet
        const pt = map.project(ll, z).add([0, window.innerHeight * 0.3]);
        map.flyTo(map.unproject(pt, z), z, { duration: 0.8 });
      } else {
        const pt = map.project(ll, z).subtract([($("#sheet").offsetWidth + 24) / 2, 0]);
        map.flyTo(map.unproject(pt, z), z, { duration: 0.8 });
      }
    }
  }

  // ---------------------------------------------------------------- photos layer
  const photoLayer = L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, disableClusteringAtZoom: 19 });
  const photoIcon = L.divIcon({ className: "", html: '<div class="photo-pin">📷</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
  let photoDay = "all";
  let allPhotos = [];

  function refreshPhotos() {
    photoLayer.clearLayers();
    const show = allPhotos.filter((x) => photoDay === "all" || x.p.taken?.slice(0, 10) === photoDay);
    photoLayer.addLayers(show.map((x) => x.m));
    if (photosOn && !map.hasLayer(photoLayer)) photoLayer.addTo(map);
    if (!photosOn && map.hasLayer(photoLayer)) map.removeLayer(photoLayer);
    setPressed("photos", photosOn);
    refreshPlaces();
  }

  // ---------------------------------------------------------------- declutter labels
  // Places are placed in priority order (selected, then named places with the most photos);
  // anything that would overlap an already-placed pin or label is hidden until you zoom in.
  function declutter() {
    const boxes = [];
    const overlaps = (r, pad = 3) => boxes.some((b) => r.left < b.right + pad && r.right > b.left - pad && r.top < b.bottom + pad && r.bottom > b.top - pad);
    const rank = (pl) => (pl.f.id === selectedPlace ? 1e6 : 0) + (pl.f.properties.featured ? 1e3 : 0) + pl.photos.length;
    const pins = [...places.values()].filter((pl) => map.hasLayer(pl.marker)).sort((a, b) => rank(b) - rank(a));
    for (const pl of pins) {
      const pin = pl.marker.getElement()?.querySelector(".place-pin");
      if (!pin) continue;
      pin.classList.remove("declutter-hide");
      const bubble = pin.querySelector(".bubble");
      const name = pin.querySelector(".name");
      name?.classList.remove("declutter-hide");
      const br = bubble.getBoundingClientRect();
      if (overlaps(br, 1)) { pin.classList.add("declutter-hide"); continue; }
      boxes.push(br);
      if (name) {
        const nr = name.getBoundingClientRect();
        if (overlaps(nr)) name.classList.add("declutter-hide"); else boxes.push(nr);
      }
    }
    for (const el of $$(".leaflet-tooltip.trail-label")) {
      el.classList.remove("declutter-hide");
      const r = el.getBoundingClientRect();
      if (overlaps(r, 6)) el.classList.add("declutter-hide"); else boxes.push(r);
    }
  }

  // ---------------------------------------------------------------- sheet
  const sheet = $("#sheet");
  const sheetStack = [];
  let sheetCurrent = null;
  function openSheet(title, content, { back = false } = {}) {
    if (!back) sheetStack.length = 0;
    else if (sheetCurrent) sheetStack.push(sheetCurrent);
    sheetCurrent = { title, content };
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
    sheet.hidden = true;
    sheetStack.length = 0;
    sheetCurrent = null;
    document.body.classList.remove("sheet-open");
    $$("#dock button.active").forEach((b) => b.classList.remove("active"));
    selectPlace(null);
    history.replaceState(null, "", location.pathname + location.search);
  }
  $("#sheet-close").onclick = closeSheet;
  $("#sheet-back").onclick = () => {
    sheetCurrent = sheetStack.pop();
    if (!sheetCurrent) return closeSheet();
    selectPlace(null);
    renderSheet();
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#lightbox").hidden && !sheet.hidden) closeSheet(); });

  // ---------------------------------------------------------------- sheets: places, more
  function placesSheet() {
    const featured = [...places.values()].filter((pl) => pl.f.properties.featured)
      .sort((a, b) => placeTitle(a).localeCompare(placeTitle(b)));
    const minor = [...places.values()].filter((pl) => !pl.f.properties.featured);
    const body = document.createElement("div");
    const row = (pl) => {
      const p = pl.f.properties;
      const hero = pl.photos.find((x) => x.file === p.hero) || pl.photos[0];
      const b = document.createElement("button");
      b.className = "list-row";
      b.innerHTML = `${hero ? `<img src="photos/thumb/${esc(hero.file)}.jpg" alt="" loading="lazy">` : `<span class="emoji">${icon(p.icon)}</span>`}
        <span class="txt"><b>${icon(p.icon)} ${esc(placeTitle(pl))}</b><small>${pl.photos.length} photo${pl.photos.length === 1 ? "" : "s"}</small></span>
        <span class="chev">›</span>`;
      b.onclick = () => openPlace(pl.f.id);
      return b;
    };
    body.innerHTML = `<h3>Places on the farm</h3>`;
    featured.forEach((pl) => body.append(row(pl)));
    if (minor.length) {
      const d = document.createElement("details");
      d.innerHTML = `<summary class="list-row"><span class="emoji">📷</span><span class="txt"><b>Other photo spots</b><small>${minor.length} more spots</small></span></summary>`;
      minor.forEach((pl) => d.append(row(pl)));
      body.append(d);
    }
    openSheet("📍 Places", body);
  }

  function moreSheet() {
    const body = document.createElement("div");
    body.innerHTML = `
      <h3>Map style</h3><div class="seg" id="m-base"></div>
      <h3>Text size</h3><div class="seg" id="m-size"></div>
      <h3>On the map</h3>
      <label class="check-row"><input type="checkbox" id="m-trails"> <span class="grow">Trails &amp; roads</span></label>
      <label class="check-row"><input type="checkbox" id="m-labels"> <span class="grow">Trail names (when zoomed in)</span></label>
      <label class="check-row"><input type="checkbox" id="m-photos"> <span class="grow">Every photo as a camera pin</span></label>
      <div class="seg" id="m-days" style="margin-top:.4rem"></div>
      <h3>Legend</h3><div class="legend" id="m-legend"></div>
      <h3>Choose trails</h3><div id="m-tracks"></div>
      <h3>Help</h3><button class="big ghost" id="m-help">Show the welcome tips again</button>`;

    const base = $("#m-base", body);
    Object.entries(BASEMAPS).forEach(([k, [label]]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = k === baseKey ? "on" : "";
      b.onclick = () => { setBase(k); $$("button", base).forEach((x) => x.classList.toggle("on", x === b)); };
      base.append(b);
    });
    const size = $("#m-size", body);
    ["Small", "Normal", "Large", "Larger", "Largest"].forEach((label, i) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = i === sizeIdx ? "on" : "";
      b.onclick = () => { sizeIdx = i; applySize(); $$("button", size).forEach((x) => x.classList.toggle("on", x === b)); };
      size.append(b);
    });
    const tr = $("#m-trails", body);
    tr.checked = trailsOn;
    tr.onchange = () => setTrails(tr.checked);
    const lb = $("#m-labels", body);
    lb.checked = labelsOn;
    lb.onchange = () => { labelsOn = lb.checked; store.set("labelsOn", labelsOn); refreshTracks(); declutter(); };
    const ph = $("#m-photos", body);
    ph.checked = photosOn;
    ph.onchange = () => setPhotos(ph.checked);
    const days = $("#m-days", body);
    const dayList = [...new Set(allPhotos.map((x) => x.p.taken?.slice(0, 10)).filter(Boolean))].sort();
    [["all", "All days"], ...dayList.map((d) => [d, fmtDate(d + "T12:00:00-06:00", false)])].forEach(([k, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = k === photoDay ? "on" : "";
      b.onclick = () => { photoDay = k; refreshPhotos(); $$("button", days).forEach((x) => x.classList.toggle("on", x === b)); };
      days.append(b);
    });

    const legend = $("#m-legend", body);
    const boundary = [...tracks.values()].find((t) => t.f.id === "quarter-section-boundary");
    legend.innerHTML = `
      <span class="sym"><span class="line" style="border-top-style:dashed;border-color:${boundary ? esc(boundary.f.properties.color) : "#fff"};filter:drop-shadow(0 0 1px #000)"></span></span><span>Property boundary (dashed)</span>
      <span class="sym"><span class="line" style="border-color:#bdbdbd;filter:drop-shadow(0 0 1px #000)"></span></span><span>Roads and yard (grey)</span>
      <span class="sym"><span class="line" style="border-color:#00e5ff"></span></span><span>Trails (each trail has its own colour)</span>
      <span class="sym"><span class="place-pin" style="margin:0"><span class="bubble" style="width:1.9rem;height:1.9rem;font-size:1rem">🏠</span></span></span><span>A named place. Tap it for photos.</span>
      <span class="sym"><span class="place-pin minor" style="margin:0"><span class="bubble">📷</span></span></span><span>Other photo spot</span>`;

    const list = $("#m-tracks", body);
    const cats = {};
    tracks.forEach((t) => (cats[t.f.properties.category] ||= []).push(t));
    Object.keys(cats).sort((a, b) => (categories[a]?.order ?? 99) - (categories[b]?.order ?? 99)).forEach((cat) => {
      const items = cats[cat].sort((a, b) => a.f.properties.name.localeCompare(b.f.properties.name));
      const head = document.createElement("label");
      head.className = "check-row group";
      head.innerHTML = `<input type="checkbox"> <span class="grow">${esc(categories[cat]?.label || cat)}</span><small>${items.length}</small>`;
      const sub = document.createElement("div");
      sub.className = "sub-list";
      const master = $("input", head);
      const boxes = items.map((t) => {
        const r = document.createElement("div");
        r.className = "check-row";
        r.innerHTML = `<input type="checkbox" id="t-${esc(t.f.id)}"> <span class="swatch" style="background:${esc(t.f.properties.color)}"></span>
          <label class="grow" for="t-${esc(t.f.id)}">${esc(t.f.properties.name)}</label>
          <button class="round" style="width:2.4rem;height:2.4rem;box-shadow:none;background:var(--paper-2)" aria-label="Show ${esc(t.f.properties.name)} on the map">🔍</button>`;
        const box = $("input", r);
        box.checked = !hiddenTracks.has(t.f.id);
        box.onchange = () => { setTrackHidden(t.f.id, !box.checked); syncMaster(); };
        $("button", r).onclick = () => showTrack(t.f.id);
        sub.append(r);
        return box;
      });
      const syncMaster = () => {
        master.checked = boxes.every((b) => b.checked);
        master.indeterminate = !master.checked && boxes.some((b) => b.checked);
      };
      master.onchange = () => { boxes.forEach((b, i) => { b.checked = master.checked; setTrackHidden(items[i].f.id, !master.checked); }); };
      syncMaster();
      list.append(head, sub);
    });
    $("#m-help", body).onclick = () => { closeSheet(); showWelcome(); };
    openSheet("☰ More options", body);
  }

  function setTrackHidden(id, hide) {
    if (hide) hiddenTracks.add(id); else hiddenTracks.delete(id);
    store.set("hiddenTracks", [...hiddenTracks]);
    refreshTracks();
    declutter();
  }
  function showTrack(id) {
    const t = tracks.get(id);
    setTrackHidden(id, false);
    if (isTrail(t.f) && !trailsOn) setTrails(true);
    if (isPhone()) closeSheet();
    map.flyToBounds(t.line.getBounds(), { padding: [60, 60], maxZoom: 18, duration: 0.8 });
    map.once("moveend", () => { highlightTrack(id); t.group.openPopup(midpoint(t.f.geometry.type === "Polygon" ? { type: "LineString", coordinates: t.f.geometry.coordinates[0] } : t.f.geometry)); });
  }

  function setTrails(on) {
    trailsOn = on;
    store.set("trailsOn", on);
    setPressed("trails", on);
    refreshTracks();
    declutter();
  }
  function setPhotos(on) {
    photosOn = on;
    store.set("photosOn", on);
    refreshPhotos();
  }
  function setPressed(act, on) { $(`#dock [data-act="${act}"]`).setAttribute("aria-pressed", on); }

  // ---------------------------------------------------------------- lightbox
  const lb = $("#lightbox");
  let lbList = [], lbIdx = 0, lbTitle = "";
  function openLightbox(list, idx, title) {
    lbList = list; lbIdx = idx; lbTitle = title;
    drawLightbox();
    lb.hidden = false;
    $(".lb-close", lb).focus();
  }
  function drawLightbox() {
    const p = lbList[lbIdx];
    const img = $("img", lb);
    img.src = `photos/web/${p.file}.jpg`;
    img.alt = lbTitle;
    const cap = p.title || lbTitle;
    $("figcaption", lb).innerHTML = `<b>${esc(cap)}</b>${p.caption ? " — " + esc(p.caption) : ""}<br>${esc(fmtDate(p.taken))} · photo ${lbIdx + 1} of ${lbList.length}`;
    const multi = lbList.length > 1;
    $(".lb-prev", lb).hidden = !multi;
    $(".lb-next", lb).hidden = !multi;
    // warm the cache for the next photo
    if (multi) new Image().src = `photos/web/${lbList[(lbIdx + 1) % lbList.length].file}.jpg`;
  }
  const step = (d) => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; drawLightbox(); };
  const closeLb = () => { lb.hidden = true; };
  $(".lb-close", lb).onclick = closeLb;
  $(".lb-prev", lb).onclick = () => step(-1);
  $(".lb-next", lb).onclick = () => step(1);
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.tagName === "FIGURE") closeLb(); });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
  let tx = null;
  lb.addEventListener("touchstart", (e) => { tx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (tx === null || lbList.length < 2) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
    tx = null;
  });

  // ---------------------------------------------------------------- welcome
  function showWelcome() { $("#welcome").hidden = false; $("#welcome-ok").focus(); }
  $("#welcome-ok").onclick = () => { $("#welcome").hidden = true; store.set("welcomed", true); };
  $("#help-btn").onclick = showWelcome;

  // ---------------------------------------------------------------- location
  let meLayer = null;
  function locate() {
    if (!navigator.geolocation) return alert("This device can't share its location.");
    map.locate({ setView: false, enableHighAccuracy: true, maximumAge: 10000 });
  }
  map.on("locationfound", (e) => {
    if (meLayer) map.removeLayer(meLayer);
    meLayer = L.layerGroup([
      L.circle(e.latlng, { radius: e.accuracy, color: "#1e88e5", weight: 1, fillOpacity: 0.12, interactive: false }),
      L.circleMarker(e.latlng, { radius: 9, color: "#fff", weight: 3, fillColor: "#1e88e5", fillOpacity: 1 }).bindTooltip("You are here"),
    ]).addTo(map);
    if (farmBounds && farmBounds.pad(2).contains(e.latlng)) {
      map.flyTo(e.latlng, Math.max(map.getZoom(), 17), { duration: 0.8 });
    } else {
      alert("You're not at the farm right now, so the map will stay on the farm. Your blue dot is shown wherever you are.");
    }
  });
  map.on("locationerror", () => alert("Couldn't find your location. Please check that location is allowed for this website."));

  // ---------------------------------------------------------------- dock
  function fitFarm(animate = true) {
    if (!farmBounds) return;
    const pad = isPhone() ? [24, 24] : [60, 60];
    const opts = { paddingTopLeft: [pad[0], 70], paddingBottomRight: [pad[1], 110] };
    if (animate) map.flyToBounds(farmBounds, { ...opts, duration: 0.8 }); else map.fitBounds(farmBounds, opts);
  }
  $("#dock").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const act = b.dataset.act;
    const toggleSheet = (fn) => {
      if (b.classList.contains("active")) return closeSheet();
      fn();
      $$("#dock button.active").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    };
    if (act === "farm") { closeSheet(); fitFarm(); }
    if (act === "places") toggleSheet(placesSheet);
    if (act === "more") toggleSheet(moreSheet);
    if (act === "trails") setTrails(!trailsOn);
    if (act === "photos") setPhotos(!photosOn);
    if (act === "locate") locate();
  });
  $("#back-to-farm").onclick = () => fitFarm();

  function refreshBackToFarm() {
    if (!farmBounds) return;
    const v = map.getBounds();
    const lost = !v.intersects(farmBounds) || map.getZoom() < 12.5;
    $("#back-to-farm").hidden = !lost;
  }

  map.on("zoomend", () => { refreshTracks(); refreshPlaces(); });
  map.on("moveend zoomend", () => { refreshBackToFarm(); declutter(); });
  window.addEventListener("resize", () => setTimeout(declutter, 100));

  // ---------------------------------------------------------------- load
  Promise.all([getJSON("data/tracks.geojson"), getJSON("data/places.geojson"), getJSON("data/photos.geojson")])
    .then(([tfc, pfc, phfc]) => {
      categories = tfc.categories || {};
      const lines = tfc.features.filter((f) => f.geometry.type !== "Point");
      lines.forEach(addTrack);

      phfc.features.forEach((f) => {
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
      pfc.features.forEach(addPlace);

      if (!farmBounds) farmBounds = L.geoJSON(tfc).getBounds();
      farmPin = L.marker(farmBounds.getCenter(), {
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="farm-pin"><span>🏠 Knopp Farm</span></div>' }),
        zIndexOffset: 2000, keyboard: true, title: "Knopp Farm",
      }).on("click", () => fitFarm());

      setPressed("trails", trailsOn);
      fitFarm(false);
      refreshTracks();
      refreshPlaces();
      refreshPhotos();
      refreshBackToFarm();
      declutter();

      const m = location.hash.match(/place=([^&]+)/);
      if (m && places.has(decodeURIComponent(m[1]))) openPlace(decodeURIComponent(m[1]));
      else if (!store.get("welcomed", false)) showWelcome();
    })
    .catch((err) => {
      console.error(err);
      alert("Sorry, the map couldn't load. Please check your internet connection and refresh the page.");
    });
})();
