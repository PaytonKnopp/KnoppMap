(() => {
  "use strict";
  const { ICONS, icon, esc, fmtDate, store, loadBundle, photoUrl } = KM;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let places = [];
  let photos = new Map();          // "file.jpg" -> {file, taken, lon, lat}
  const selected = new Set();
  let filter = "all";
  let query = "";

  const map = L.map("map", { zoomSnap: 0.25, maxZoom: 22 });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 22, maxNativeZoom: 19, attribution: "Imagery © Esri" }).addTo(map);
  const markers = new Map();

  let version = "";
  const save = () => store.set("tagDraft", { version, places });

  function center(pl) {
    if (pl.coords) return pl.coords;
    const pts = pl.photos.map((f) => photos.get(f)).filter(Boolean);
    if (!pts.length) return null;
    return [pts.reduce((s, p) => s + p.lon, 0) / pts.length, pts.reduce((s, p) => s + p.lat, 0) / pts.length];
  }

  function touched(pl) { delete pl.guess; save(); }

  // ---------------------------------------------------------------- map
  function pinIcon(pl) {
    const cls = !pl.name ? "unnamed" : pl.guess ? "guess" : "";
    return L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="pin ${cls}">${icon(pl.icon)}</div>` });
  }
  function drawMap(fit = false) {
    markers.forEach((m) => map.removeLayer(m));
    markers.clear();
    for (const pl of places) {
      const c = center(pl);
      if (!c) continue;
      const m = L.marker([c[1], c[0]], { icon: pinIcon(pl), draggable: true, title: pl.name || pl.id })
        .bindTooltip(esc(pl.name || "Unnamed spot") + ` (${pl.photos.length})`)
        .addTo(map);
      m.on("click", () => focusCard(pl.id));
      m.on("dragend", () => { const ll = m.getLatLng(); pl.coords = [+ll.lng.toFixed(6), +ll.lat.toFixed(6)]; touched(pl); });
      markers.set(pl.id, m);
    }
    // Opens on the quarter; the family houses are a drive away (their 📍 button zooms to them).
    const quarter = [...markers].filter(([id]) => !places.find((p) => p.id === id)?.site).map(([, m]) => m);
    if (fit && quarter.length) map.fitBounds(L.featureGroup(quarter).getBounds(), { padding: [20, 20] });
  }

  function focusCard(id) {
    const card = $(`.card[data-id="${CSS.escape(id)}"]`);
    if (!card) { filter = "all"; query = ""; $("#search").value = ""; syncFilter(); render(); return focusCard(id); }
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1500);
  }

  // ---------------------------------------------------------------- list
  const iconOptions = (cur) => Object.entries(ICONS).map(([k, [e, label]]) =>
    `<option value="${k}"${k === cur ? " selected" : ""}>${e} ${esc(label)}</option>`).join("");

  function visible(pl) {
    if (filter === "named" && !pl.name) return false;
    if (filter === "unnamed" && pl.name) return false;
    if (filter === "guess" && !pl.guess) return false;
    if (query && !(pl.name || "").toLowerCase().includes(query) && !(pl.story || "").toLowerCase().includes(query) && !pl.id.includes(query)) return false;
    return true;
  }

  function render() {
    const list = $("#list");
    list.replaceChildren();
    const order = [...places].sort((a, b) => (!!b.name - !!a.name) || b.photos.length - a.photos.length);
    const targets = places.map((p) => `<option value="${esc(p.id)}">${esc(p.name || "Unnamed")} · ${esc(p.id)} (${p.photos.length})</option>`).join("");
    for (const pl of order.filter(visible)) {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = pl.id;
      card.innerHTML = `
        <div class="row">
          <input type="text" value="${esc(pl.name)}" placeholder="Name this place (e.g. Saddle Shed)" aria-label="Place name">
          <select aria-label="Icon">${iconOptions(pl.icon)}</select>
        </div>
        <div class="row">
          <label class="feat"><input type="checkbox" ${pl.featured ? "checked" : ""}> Show as a named place on the family map</label>
          ${pl.guess ? `<span class="badge">Claude's guess — check me</span>` : ""}
          <span class="id">${esc(pl.id)} · ${pl.photos.length} photos</span>
          <button data-a="locate" title="Show on map">📍</button>
        </div>
        <textarea placeholder="A story or memory about this place (optional)">${esc(pl.story || "")}</textarea>
        <div class="photos">${pl.photos.map((f) => {
          const p = photos.get(f);
          return `<div class="ph${selected.has(f) ? " sel" : ""}${pl.hero === f ? " hero" : ""}" data-f="${esc(f)}" title="${esc(fmtDate(p?.taken))}">
            <img src="${esc(p ? photoUrl(p, "thumb") : "")}" loading="lazy" alt="">
            <span class="tools"><button class="star" data-a="hero" title="Use as cover photo">⭐</button><button data-a="view" title="View large">🔍</button></span></div>`;
        }).join("")}</div>
        <div class="actions">
          <span>Selected photos:</span>
          <select data-a="target"><option value="">Move to…</option>${targets}</select>
          <button data-a="move">Move</button>
          <button data-a="split">New place from selected</button>
          <span style="flex:1"></span>
          <select data-a="merge-target"><option value="">Merge this place into…</option>${targets}</select>
          <button data-a="merge">Merge</button>
          ${pl.photos.length === 0 ? `<button data-a="delete" class="danger">Delete empty place</button>` : ""}
        </div>`;

      $("input[type=text]", card).oninput = (e) => {
        pl.name = e.target.value;
        if (pl.name && !pl.featured) { pl.featured = true; $(".feat input", card).checked = true; }
        touched(pl);
        markers.get(pl.id)?.setIcon(pinIcon(pl)).setTooltipContent(esc(pl.name || "Unnamed spot"));
        $(".badge", card)?.remove();
        stats();
      };
      $("select", card).onchange = (e) => { pl.icon = e.target.value; touched(pl); markers.get(pl.id)?.setIcon(pinIcon(pl)); };
      $(".feat input", card).onchange = (e) => { pl.featured = e.target.checked; touched(pl); };
      $("textarea", card).oninput = (e) => { pl.story = e.target.value; touched(pl); };
      card.addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        const ph = e.target.closest(".ph");
        if (a === "hero" && ph) { pl.hero = ph.dataset.f; touched(pl); $$(".ph", card).forEach((x) => x.classList.toggle("hero", x === ph)); return; }
        if (a === "view" && ph) { $("#viewer img").src = photoUrl(photos.get(ph.dataset.f)); $("#viewer").hidden = false; return; }
        if (ph && !a) {
          const f = ph.dataset.f;
          if (selected.has(f)) selected.delete(f); else selected.add(f);
          ph.classList.toggle("sel", selected.has(f));
          return;
        }
        if (a === "locate") { const m = markers.get(pl.id); if (m) { map.setView(m.getLatLng(), 19); m.openTooltip(); } }
        if (a === "move") movePhotos($('[data-a="target"]', card).value);
        if (a === "split") splitPhotos(pl);
        if (a === "merge") mergePlace(pl, $('[data-a="merge-target"]', card).value);
        if (a === "delete") { places = places.filter((x) => x !== pl); save(); render(); drawMap(); }
      });
      list.append(card);
    }
    stats();
  }

  function takeSelected() {
    const files = [...selected];
    for (const pl of places) {
      const before = pl.photos.length;
      pl.photos = pl.photos.filter((f) => !selected.has(f));
      if (pl.photos.length !== before) { if (!pl.photos.includes(pl.hero)) pl.hero = pl.photos[0] || null; delete pl.coords; }
    }
    selected.clear();
    return files;
  }
  function movePhotos(targetId) {
    const target = places.find((p) => p.id === targetId);
    if (!target) return alert("Choose a place to move the selected photos to.");
    if (!selected.size) return alert("Click some photos first to select them.");
    target.photos.push(...takeSelected());
    if (!target.hero) target.hero = target.photos[0];
    save(); render(); drawMap();
    focusCard(target.id);
  }
  function splitPhotos(from) {
    if (!selected.size) return alert("Click some photos first to select them.");
    const files = takeSelected();
    const pl = { id: "place-" + Date.now().toString(36), name: "", icon: from.icon === "photo" ? "photo" : "star", story: "", hero: files[0], photos: files, featured: false };
    places.push(pl);
    save(); render(); drawMap();
    focusCard(pl.id);
  }
  function mergePlace(pl, targetId) {
    const target = places.find((p) => p.id === targetId);
    if (!target || target === pl) return alert("Choose another place to merge into.");
    if (!confirm(`Move all ${pl.photos.length} photos into "${target.name || target.id}" and remove this place?`)) return;
    target.photos.push(...pl.photos);
    delete target.coords;
    places = places.filter((x) => x !== pl);
    save(); render(); drawMap();
    focusCard(target.id);
  }

  function stats() {
    const named = places.filter((p) => p.name).length;
    const guesses = places.filter((p) => p.guess).length;
    $("#stats").textContent = `${places.length} places · ${named} named · ${guesses} still to check`;
  }

  // ---------------------------------------------------------------- toolbar
  function syncFilter() { $$("#filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter)); }
  $("#filter").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; filter = b.dataset.f; syncFilter(); render(); };
  $("#search").oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
  $("#viewer").onclick = () => { $("#viewer").hidden = true; };

  function exportJSON() {
    const out = { places: places.map((p) => {
      const o = { id: p.id, name: p.name || "", icon: p.icon || "photo", story: p.story || "", hero: p.hero || p.photos[0] || null,
        photos: p.photos, featured: !!p.featured };
      if (p.guess) o.guess = true;
      if (p.coords) o.coords = p.coords;
      if (p.site) o.site = true;       // a family house (Old House, CK House): its own pin away from the quarter
      if (p.gather) o.gather = true;   // all of its photos sit on the pin
      return o;
    }) };
    return JSON.stringify(out, null, 2) + "\n";
  }
  $("#export").onclick = () => {
    const url = URL.createObjectURL(new Blob([exportJSON()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "places.json" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("#copy").onclick = async () => {
    try { await navigator.clipboard.writeText(exportJSON()); $("#copy").textContent = "Copied ✓"; }
    catch { alert("Couldn't copy — use Download instead."); }
    setTimeout(() => { $("#copy").textContent = "Copy"; }, 2000);
  };
  $("#reset").onclick = () => {
    if (!confirm("Throw away your edits in this browser and reload the published places?")) return;
    store.set("tagDraft", null);
    location.reload();
  };

  // ---------------------------------------------------------------- load
  loadBundle(async (retry) => ({ password: prompt(retry ? "Wrong password, try again:" : "Map password:") || "", remember: true }))
  .then(({ meta, data }) => {
    version = meta.version;
    const pfc = data.places, phfc = data.photos;
    phfc.features.forEach((f) => photos.set(f.properties.file + ".jpg",
      { file: f.properties.file, src: f.properties.src, taken: f.properties.taken, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
    let draft = store.get("tagDraft", null);
    if (Array.isArray(draft)) draft = { version: "", places: draft };
    if (draft && draft.version !== version &&
        confirm("The published map has changed since you last edited here.\n\nOK = start from the new published version (recommended)\nCancel = keep your unsaved edits")) draft = null;
    draft = draft?.places || null;
    places = draft || pfc.features.map((f) => {
      const p = f.properties;
      const o = { id: f.id, name: p.name, icon: p.icon, story: p.story, hero: p.hero ? p.hero + ".jpg" : null,
        photos: p.photos.map((x) => x + ".jpg"), featured: p.featured };
      if (p.guess) o.guess = true;
      if (p.moved) o.coords = f.geometry.coordinates;
      if (p.site) o.site = true;
      if (p.gather) o.gather = true;
      return o;
    });
    // photos added since the draft was started go into their own unnamed spot so nothing is lost
    const claimed = new Set(places.flatMap((p) => p.photos));
    const fresh = [...photos.keys()].filter((f) => !claimed.has(f));
    if (fresh.length) places.push({ id: "place-new-" + Date.now().toString(36), name: "", icon: "photo", story: "", hero: fresh[0], photos: fresh, featured: false });
    render();
    drawMap(true);
  }).catch((e) => { console.error(e); alert("Couldn't load the map data."); });
})();
