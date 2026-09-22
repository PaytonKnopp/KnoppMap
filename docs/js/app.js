(() => {
  "use strict";

  const BASEMAPS = {
    Satellite: () => L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }),
    Hybrid: () => L.layerGroup([
      BASEMAPS.Satellite(),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20, maxNativeZoom: 19 }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20, maxNativeZoom: 19 }),
    ]),
    Topo: () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { maxZoom: 20, maxNativeZoom: 17, attribution: "&copy; OpenStreetMap contributors, SRTM | OpenTopoMap" }),
    Street: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "&copy; OpenStreetMap contributors" }),
  };

  const CAMERA_SVG = '<svg viewBox="0 0 24 24"><path fill="#111" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';

  const map = L.map("map", { zoomControl: false, zoomSnap: 0.25 });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.control.scale({ position: "bottomright", imperial: false }).addTo(map);

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtLen = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + " km" : m + " m");
  const fmtDate = (iso, withTime = true) => {
    if (!iso) return "";
    const d = new Date(iso);
    const opts = { year: "numeric", month: "short", day: "numeric", timeZone: "America/Edmonton" };
    if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
    return d.toLocaleString(undefined, opts);
  };

  // ---------------------------------------------------------------- basemaps
  let currentBase = null;
  function setBase(name) {
    if (currentBase) map.removeLayer(currentBase);
    currentBase = BASEMAPS[name]().addTo(map);
    currentBase.bringToBack?.();
    document.querySelectorAll("#basemaps button").forEach((b) => b.classList.toggle("on", b.dataset.name === name));
  }
  Object.keys(BASEMAPS).forEach((name) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.dataset.name = name;
    b.onclick = () => setBase(name);
    $("#basemaps").append(b);
  });
  setBase("Satellite");

  // ---------------------------------------------------------------- panel
  const panel = $("#panel");
  const togglePanel = (open) => {
    panel.classList.toggle("open", open);
    $("#panel-toggle").setAttribute("aria-expanded", open);
  };
  $("#panel-toggle").onclick = () => togglePanel(!panel.classList.contains("open"));
  $("#panel-close").onclick = () => togglePanel(false);
  const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

  // ---------------------------------------------------------------- tracks
  const trackLayers = new Map();   // id -> { feature, layer, label }
  let boundaryBounds = null;
  let selected = null;

  function styleFor(f, highlight = false) {
    const p = f.properties;
    const boundary = p.category === "boundary";
    return {
      color: p.color,
      weight: (boundary ? 3 : 4) + (highlight ? 3 : 0),
      opacity: 1,
      dashArray: boundary && !highlight ? "8 6" : null,
      fillColor: p.color,
      fillOpacity: boundary ? 0.06 : 0,
      lineCap: "round",
      lineJoin: "round",
    };
  }

  function trackPopup(f) {
    const p = f.properties;
    return `<div class="popup-track"><b>${esc(p.name)}</b><div class="meta">${fmtLen(p.length_m)}` +
      (p.recorded ? ` &middot; recorded ${fmtDate(p.recorded, false)}` : "") + `</div></div>`;
  }

  function select(id) {
    if (selected && trackLayers.has(selected)) {
      const t = trackLayers.get(selected);
      t.layer.setStyle(styleFor(t.feature));
    }
    selected = id;
    if (id) {
      const t = trackLayers.get(id);
      t.layer.setStyle(styleFor(t.feature, true));
      t.layer.bringToFront();
    }
  }

  function addTrack(f) {
    const layer = L.geoJSON(f, { style: () => styleFor(f) });
    // A wide invisible line underneath makes thin trails easy to tap on a phone.
    const hit = L.geoJSON(f, { style: { weight: 18, opacity: 0, fillOpacity: 0 } });
    const group = L.featureGroup([hit, layer]);
    group.bindPopup(trackPopup(f));
    group.bindTooltip(esc(f.properties.name), { sticky: true, direction: "top", className: "track-label" });
    group.on("popupopen", () => select(f.id));
    group.on("popupclose", () => select(null));
    group.on("mouseover", () => { if (selected !== f.id) layer.setStyle(styleFor(f, true)); });
    group.on("mouseout", () => { if (selected !== f.id) layer.setStyle(styleFor(f)); });

    const center = layer.getBounds().getCenter();
    let anchor = center;
    const g = f.geometry;
    const coords = g.type === "LineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0];
    if (g.type !== "Polygon") anchor = L.latLng(coords[Math.floor(coords.length / 2)].slice().reverse());
    const label = L.tooltip({ permanent: true, direction: "center", className: "track-label", interactive: false })
      .setLatLng(anchor).setContent(esc(f.properties.name));

    trackLayers.set(f.id, { feature: f, layer, group, label, visible: true });
    group.addTo(map);
    if (f.properties.category === "boundary" && f.id === "quarter-section-boundary") boundaryBounds = layer.getBounds();
  }

  function setTrackVisible(id, on) {
    const t = trackLayers.get(id);
    t.visible = on;
    if (on) { t.group.addTo(map); if (labelsOn) t.label.addTo(map); }
    else { map.removeLayer(t.group); map.removeLayer(t.label); }
  }

  let labelsOn = false;
  $("#labels-toggle").onchange = (e) => {
    labelsOn = e.target.checked;
    trackLayers.forEach((t) => { if (labelsOn && t.visible) t.label.addTo(map); else map.removeLayer(t.label); });
  };

  function buildTrackList(fc) {
    const cats = fc.categories || {};
    const byCat = {};
    fc.features.filter((f) => f.geometry.type !== "Point").forEach((f) => {
      (byCat[f.properties.category] ||= []).push(f);
    });
    const order = Object.keys(byCat).sort((a, b) => (cats[a]?.order ?? 99) - (cats[b]?.order ?? 99));
    const root = $("#categories");
    for (const cat of order) {
      const feats = byCat[cat].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
      const wrap = document.createElement("div");
      wrap.className = "cat" + (feats.length > 8 ? " collapsed" : "");
      const total = feats.reduce((s, f) => s + f.properties.length_m, 0);
      wrap.innerHTML = `<div class="cat-head"><label><input type="checkbox" checked> ${esc(cats[cat]?.label || cat)}
        <span class="count">${feats.length} &middot; ${fmtLen(total)}</span></label>
        <button class="twisty" aria-label="Expand">${feats.length > 8 ? "▸" : "▾"}</button></div><ul></ul>`;
      const master = wrap.querySelector(".cat-head input");
      const ul = wrap.querySelector("ul");
      const boxes = [];
      for (const f of feats) {
        const li = document.createElement("li");
        li.dataset.name = f.properties.name.toLowerCase();
        li.innerHTML = `<input type="checkbox" checked aria-label="Show ${esc(f.properties.name)}">
          <span class="swatch" style="background:${esc(f.properties.color)}"></span>
          <span class="name">${esc(f.properties.name)}</span><span class="len">${fmtLen(f.properties.length_m)}</span>`;
        const box = li.querySelector("input");
        boxes.push(box);
        box.onchange = () => {
          setTrackVisible(f.id, box.checked);
          master.checked = boxes.every((b) => b.checked);
          master.indeterminate = !master.checked && boxes.some((b) => b.checked);
        };
        li.querySelector(".name").onclick = () => zoomToTrack(f.id, box);
        ul.append(li);
      }
      master.onchange = () => boxes.forEach((b) => { b.checked = master.checked; setTrackVisible(feats[boxes.indexOf(b)].id, b.checked); });
      wrap.querySelector(".twisty").onclick = (e) => {
        wrap.classList.toggle("collapsed");
        e.target.textContent = wrap.classList.contains("collapsed") ? "▸" : "▾";
      };
      root.append(wrap);
    }

    $("#track-search").oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll(".cat").forEach((c) => {
        if (q) c.classList.remove("collapsed");
        c.querySelectorAll("li").forEach((li) => li.classList.toggle("hidden", !!q && !li.dataset.name.includes(q)));
      });
    };
  }

  function zoomToTrack(id, box) {
    const t = trackLayers.get(id);
    if (!t.visible) { box.checked = true; box.onchange(); }
    if (isPhone()) togglePanel(false);
    map.fitBounds(t.layer.getBounds(), { padding: [40, 40], maxZoom: 18 });
    const g = t.feature.geometry;
    const c = g.type === "Polygon" ? g.coordinates[0][0] : g.type === "LineString"
      ? g.coordinates[Math.floor(g.coordinates.length / 2)] : g.coordinates[0][0];
    t.group.openPopup(L.latLng(c[1], c[0]));
  }

  // ---------------------------------------------------------------- photos
  let photos = [];
  let visiblePhotos = [];
  let dateFilter = "all";
  const cluster = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 19 });
  const plain = L.layerGroup();
  let photoLayer = cluster;

  const photoIcon = L.divIcon({ className: "", html: `<div class="photo-pin">${CAMERA_SVG}</div>`, iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] });

  function photoTitle(p) { return p.title || (p.near ? `Near ${p.near}` : "Photo"); }

  function photoPopup(p) {
    return `<div class="popup-photo"><img src="photos/thumb/${esc(p.file)}.jpg" alt="${esc(photoTitle(p))}" data-file="${esc(p.file)}" loading="lazy">
      <div class="meta"><b>${esc(photoTitle(p))}</b>${p.caption ? esc(p.caption) + "<br>" : ""}${fmtDate(p.taken)}</div></div>`;
  }

  function buildPhotos(fc) {
    photos = fc.features.map((f) => {
      const p = f.properties;
      const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: photoIcon, title: photoTitle(p) });
      m.bindPopup(photoPopup(p), { minWidth: 220 });
      m.on("popupopen", (e) => {
        e.popup.getElement().querySelector("img").onclick = () => openLightbox(p.file);
      });
      return { p, m, day: (p.taken || "").slice(0, 10) };
    }).sort((a, b) => (a.p.taken || "").localeCompare(b.p.taken || ""));

    const days = [...new Set(photos.map((x) => x.day).filter(Boolean))].sort();
    const chips = $("#photo-dates");
    const mk = (val, text) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.dataset.val = val;
      b.onclick = () => { dateFilter = val; refreshPhotos(); };
      chips.append(b);
    };
    mk("all", "All days");
    days.forEach((d) => mk(d, fmtDate(d + "T12:00:00-06:00", false)));
    refreshPhotos();
  }

  function refreshPhotos() {
    cluster.clearLayers();
    plain.clearLayers();
    visiblePhotos = photos.filter((x) => dateFilter === "all" || x.day === dateFilter);
    const markers = visiblePhotos.map((x) => x.m);
    cluster.addLayers(markers);
    markers.forEach((m) => plain.addLayer(m));
    document.querySelectorAll("#photo-dates button").forEach((b) => b.classList.toggle("on", b.dataset.val === dateFilter));
    $("#photo-count").textContent = visiblePhotos.length;
  }

  function setPhotoLayer() {
    map.removeLayer(cluster);
    map.removeLayer(plain);
    photoLayer = $("#cluster-toggle").checked ? cluster : plain;
    if ($("#photos-toggle").checked) photoLayer.addTo(map);
  }
  $("#photos-toggle").onchange = setPhotoLayer;
  $("#cluster-toggle").onchange = setPhotoLayer;

  // ---------------------------------------------------------------- lightbox
  const lb = $("#lightbox");
  let lbIndex = -1;
  function openLightbox(file) {
    lbIndex = visiblePhotos.findIndex((x) => x.p.file === file);
    showLightbox();
    lb.hidden = false;
  }
  function showLightbox() {
    const { p } = visiblePhotos[lbIndex];
    const img = lb.querySelector("img");
    img.src = `photos/web/${p.file}.jpg`;
    img.alt = photoTitle(p);
    lb.querySelector("figcaption").innerHTML =
      `<b>${esc(photoTitle(p))}</b>${p.caption ? " &middot; " + esc(p.caption) : ""}<br>${fmtDate(p.taken)} &middot; ${lbIndex + 1} / ${visiblePhotos.length}`;
  }
  function step(d) {
    lbIndex = (lbIndex + d + visiblePhotos.length) % visiblePhotos.length;
    showLightbox();
  }
  function closeLightbox() {
    lb.hidden = true;
    const x = visiblePhotos[lbIndex];
    if (x && photoLayer === cluster) cluster.zoomToShowLayer(x.m, () => x.m.openPopup());
    else if (x) { map.panTo(x.m.getLatLng()); x.m.openPopup(); }
  }
  lb.querySelector(".lb-close").onclick = closeLightbox;
  lb.querySelector(".lb-prev").onclick = () => step(-1);
  lb.querySelector(".lb-next").onclick = () => step(1);
  lb.onclick = (e) => { if (e.target === lb) closeLightbox(); };
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
  let touchX = null;
  lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchX = null;
  });

  // ---------------------------------------------------------------- actions
  const fit = () => boundaryBounds && map.fitBounds(boundaryBounds, { padding: isPhone() ? [20, 20] : [30, 30] });
  $("#fit-btn").onclick = () => { if (isPhone()) togglePanel(false); fit(); };

  let me = null;
  $("#locate-btn").onclick = () => {
    if (isPhone()) togglePanel(false);
    map.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true });
  };
  map.on("locationfound", (e) => {
    if (me) map.removeLayer(me);
    me = L.layerGroup([
      L.circle(e.latlng, { radius: e.accuracy, color: "#4fc3ff", weight: 1, fillOpacity: 0.12 }),
      L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#1e88e5", fillOpacity: 1 }),
    ]).addTo(map);
  });
  map.on("locationerror", (e) => alert("Couldn't get your location: " + e.message));

  // ---------------------------------------------------------------- load
  Promise.all([
    fetch("data/tracks.geojson").then((r) => r.json()),
    fetch("data/photos.geojson").then((r) => r.json()),
  ]).then(([tracks, pics]) => {
    const lines = tracks.features.filter((f) => f.geometry.type !== "Point");
    // Boundaries drawn first so trails sit on top of them.
    lines.sort((a, b) => (a.properties.category === "boundary" ? -1 : 0) - (b.properties.category === "boundary" ? -1 : 0));
    lines.forEach(addTrack);
    tracks.features.filter((f) => f.geometry.type === "Point").forEach((f) => {
      L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
        icon: L.divIcon({ className: "house-pin", html: "🏠", iconSize: [26, 26], iconAnchor: [13, 13] }),
        zIndexOffset: 1000,
      }).bindTooltip(esc(f.properties.name)).addTo(map);
    });
    buildTrackList(tracks);
    buildPhotos(pics);
    setPhotoLayer();
    if (!boundaryBounds) boundaryBounds = L.geoJSON(tracks).getBounds();
    fit();
  }).catch((err) => {
    console.error(err);
    alert("Map data failed to load.");
  });
})();
