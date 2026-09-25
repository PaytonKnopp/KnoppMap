// Place editor (tag.html): check every place, photo, caption and tour stop, then download one edits file for Claude.
// It only ever reads the published map; nothing here changes the family map until the edits file is applied
// (python3 build/apply_edits.py <file>), which rewrites config/places.json, photos.json, hidden.json and tour.json.
(() => {
  "use strict";
  const { ICONS, icon, esc, fmtDate, store, loadBundle, photoUrl, getJSON } = KM;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  // Same data regardless of key order.
  const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
  const same = (a, b) => canon(a) === canon(b);
  const stem = (f) => f.replace(/\.jpg$/i, "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
  const isTyping = (el) => !!el && ((el.tagName === "INPUT" && !["checkbox", "radio", "button", "file"].includes(el.type))
    || el.tagName === "TEXTAREA" || el.isContentEditable);
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const FAR_M = 50;          // a photo further than this from its place's pin gets "⚠ far"
  const FAR_HOUSE_M = 150;   // family houses spread wider

  // ---------------------------------------------------------------- data
  let meta, bundle, ed;
  const PH = new Map();      // "x.jpg" -> {file, src, taken, pos:[lon, lat] | null}; hidden photos included
  let S, BASE;               // editable config files, and the published ones: {places, photos, hidden, tour}
  let tourWasNull = false;   // no config/tour.json yet (the build picks the stops); only written if you edit it
  let HID = new Set(), BHID = new Set(), OWNER = new Map();
  const reviewed = store.get("tagReviewed", {}) || {};
  let cur = null, tab = "places", filter = "all", query = "";
  const selected = new Set();
  let anchor = null;

  const places = () => S.places.places;
  const byId = (id) => places().find((p) => p.id === id);
  function reindex() {
    HID = new Set(S.hidden.hidden || []);
    OWNER = new Map();
    for (const p of places()) for (const f of p.photos) OWNER.set(f, p);
  }
  const known = (pl) => pl.photos.filter((f) => PH.has(f));
  const shownOf = (pl, hid = HID) => known(pl).filter((f) => !hid.has(f));
  const hiddenOf = (pl) => known(pl).filter((f) => HID.has(f));
  const coverOf = (pl, hid = HID) => { const s = shownOf(pl, hid); return s.includes(pl.hero) ? pl.hero : s[0] || null; };
  const titleOf = (pl) => pl.name || "Unnamed spot";
  const nameOf = (pl) => (pl.name ? `“${pl.name}”` : `unnamed spot ${pl.id}`);
  const capOf = (f) => S.photos[f] || {};
  function centerOf(pl) {
    if (pl.coords) return pl.coords;
    const pts = shownOf(pl).map((f) => PH.get(f).pos).filter(Boolean);
    if (!pts.length) return null;
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }
  function farOf(pl, f) {
    const c = centerOf(pl), p = PH.get(f)?.pos;
    if (!c || !p) return 0;
    const d = metres(c, p);
    return d > (pl.site || pl.gather ? FAR_HOUSE_M : FAR_M) ? d : 0;
  }
  // A place's own cover must be one of its photos (the build would otherwise borrow it from wherever it went).
  function fixHero(pl) { if (!pl.photos.includes(pl.hero)) pl.hero = shownOf(pl)[0] || pl.photos[0] || null; }
  // Photos on the map that no place lists go into one new unnamed spot, so nothing is ever lost.
  function addUnclaimed() {
    const claimed = new Set(places().flatMap((p) => p.photos));
    const fresh = [...PH.keys()].filter((f) => !claimed.has(f));
    if (fresh.length) places().push({ id: nextId(), name: "", icon: "photo", story: "", hero: fresh[0], photos: fresh, featured: false });
  }
  function nextId() {
    const ids = new Set([...places(), ...BASE.places.places].map((p) => p.id));
    let n = 1;
    for (const id of ids) { const m = /^spot-(\d+)$/.exec(id); if (m) n = Math.max(n, +m[1] + 1); }
    while (ids.has(`spot-${String(n).padStart(2, "0")}`)) n++;
    return `spot-${String(n).padStart(2, "0")}`;
  }

  // ---------------------------------------------------------------- undo, saving
  const undoStack = [], redoStack = [];
  let lastKey = "", lastAt = 0;
  /** Every edit goes through here: one undo step each (typing in one box counts as one step). */
  function change(label, fn, { key = "", quiet = false } = {}) {
    const now = Date.now();
    if (!key || key !== lastKey || now - lastAt > 4000) {
      undoStack.push({ label, snap: JSON.stringify(S) });
      if (undoStack.length > 500) undoStack.shift();
      redoStack.length = 0;
    }
    lastKey = key;
    lastAt = now;
    fn();
    rev++;
    reindex();
    save();
    if (quiet) { renderChrome(); refreshRow(cur); } else renderAll();
  }
  function restore(from, to, verb) {
    const step = from.pop();
    if (!step) return;
    to.push({ label: step.label, snap: JSON.stringify(S) });
    S = JSON.parse(step.snap);
    rev++;
    lastKey = "";
    reindex();
    save();
    if (!byId(cur)) cur = places()[0]?.id || null;
    for (const f of [...selected]) if (OWNER.get(f)?.id !== cur) selected.delete(f);
    if (document.activeElement && isTyping(document.activeElement)) document.activeElement.blur();
    renderAll();
    toast(`${verb}: ${step.label}`, false);
  }
  const undo = () => restore(undoStack, redoStack, "Undone");
  const redo = () => restore(redoStack, undoStack, "Redone");

  let saveTimer = 0;
  const saveNow = () => { clearTimeout(saveTimer); saveTimer = 0; if (S) store.set("tagDraft2", { base: ed.version, tourWasNull, state: S }); };
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); };
  addEventListener("pagehide", saveNow);
  function setReviewed(id, v) { if (v) reviewed[id] = true; else delete reviewed[id]; store.set("tagReviewed", reviewed); }

  let toastTimer = 0;
  function toast(text, withUndo = true) {
    const t = $("#toast");
    $("span", t).textContent = text;
    $("button", t).hidden = !withUndo;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, withUndo ? 7000 : 4500);
  }
  $("#toast button").onclick = () => { $("#toast").hidden = true; undo(); };

  // ---------------------------------------------------------------- what changed
  // describe() is asked for often (list filter, badges); it's worked out again only after an edit.
  let rev = 0, descRev = -1, descCache = [];
  function describe() {
    if (descRev !== rev) { descCache = describeNow(); descRev = rev; }
    return descCache;
  }
  /** Everything that differs from the published map, in plain words. {text, place?, also?, tour?} */
  function describeNow() {
    const out = [];
    const B = new Map(BASE.places.places.map((p) => [p.id, p]));
    const C = new Map(places().map((p) => [p.id, p]));
    const wasIn = new Map();
    for (const p of B.values()) for (const f of p.photos) wasIn.set(f, p.id);
    for (const p of C.values()) {
      const b = B.get(p.id);
      const add = (text) => out.push({ text, place: p.id });
      if (!b) { add(`New place ${nameOf(p)} (${plural(p.photos.length, "photo")})`); continue; }
      if ((b.name || "") !== (p.name || "")) {
        add(!b.name ? `Named ${p.id} “${p.name}”` : !p.name ? `Took the name off “${b.name}” (${p.id})` : `Renamed “${b.name}” to “${p.name}”`);
      }
      if ((b.icon || "photo") !== (p.icon || "photo")) add(`${nameOf(p)}: icon ${icon(b.icon)} → ${icon(p.icon)}`);
      if (!!b.featured !== !!p.featured && !(p.featured && !b.name && p.name)) add(`${nameOf(p)}: ${p.featured ? "now shown as a named place" : "now a small camera spot"}`);
      if ((b.label || "") !== (p.label || "")) add(`${nameOf(p)}: ${p.label ? `map label “${p.label}”` : "map label removed"}`);
      if ((b.story || "") !== (p.story || "")) add(`${nameOf(p)}: story ${!b.story ? "added" : !p.story ? "removed" : "changed"}`);
      if (coverOf(b, BHID) !== coverOf(p)) add(`${nameOf(p)}: new cover photo${coverOf(p) ? ` (${stem(coverOf(p))})` : ""}`);
      if (!same(b.coords || null, p.coords || null)) {
        add(`${nameOf(p)}: ${!p.coords ? "pin put back in the middle of its photos" : b.coords ? "pin moved" : "pin placed by hand"}`);
      }
      const now = p.photos.filter((f) => b.photos.includes(f)), was = b.photos.filter((f) => p.photos.includes(f));
      if (now.join() !== was.join()) add(`${nameOf(p)}: photos put in a new order`);
    }
    for (const b of B.values()) {
      if (C.has(b.id)) continue;
      const to = b.photos.map((f) => OWNER.get(f)).find(Boolean);
      out.push({ text: to ? `Merged ${nameOf(b)} into ${nameOf(to)}` : `Deleted ${nameOf(b)}`, place: to?.id });
    }
    const moves = new Map();
    for (const [f, to] of OWNER) {
      const from = wasIn.get(f);
      if (!from || from === to.id || !C.has(from)) continue;
      const k = from + "\n" + to.id;
      moves.set(k, (moves.get(k) || 0) + 1);
    }
    for (const [k, n] of moves) {
      const [from, to] = k.split("\n");
      out.push({ text: `Moved ${plural(n, "photo")} from ${nameOf(C.get(from))} to ${nameOf(C.get(to))}`, place: to, also: from });
    }
    const group = (files) => {
      const g = new Map();
      for (const f of files) { const p = OWNER.get(f); g.set(p, [...(g.get(p) || []), f]); }
      return g;
    };
    for (const [p, fs] of group([...HID].filter((f) => !BHID.has(f) && PH.has(f)))) {
      out.push({ text: `Hid ${plural(fs.length, "photo")}${p ? ` in ${nameOf(p)}` : ""} (${fs.map(stem).join(", ")})`, place: p?.id });
    }
    for (const [p, fs] of group([...BHID].filter((f) => !HID.has(f) && PH.has(f)))) {
      out.push({ text: `Brought back ${plural(fs.length, "hidden photo")}${p ? ` in ${nameOf(p)}` : ""} (${fs.map(stem).join(", ")})`, place: p?.id });
    }
    for (const f of new Set([...Object.keys(BASE.photos), ...Object.keys(S.photos)])) {
      const b = BASE.photos[f] || {}, c = S.photos[f] || {}, p = OWNER.get(f);
      for (const [k, word] of [["caption", "caption"], ["title", "title"]]) {
        if ((b[k] || "") === (c[k] || "")) continue;
        const what = !c[k] ? `Removed the ${word}` : b[k] ? `Changed the ${word}` : `Added a ${word}`;
        out.push({ text: `${what} on ${stem(f)}${p ? ` (${titleOf(p)})` : ""}${c[k] ? `: “${short(c[k])}”` : ""}`, place: p?.id });
      }
    }
    const bt = BASE.tour, ct = S.tour, stopName = (id) => (byId(id) ? nameOf(byId(id)) : B.get(id) ? nameOf(B.get(id)) : id);
    if ((bt.title || "") !== (ct.title || "")) out.push({ text: `Tour title is now “${ct.title}”`, tour: true });
    const bIds = bt.stops.map((s) => s.place), cIds = ct.stops.map((s) => s.place);
    const added = cIds.filter((id) => !bIds.includes(id)), removed = bIds.filter((id) => !cIds.includes(id));
    if (added.length) out.push({ text: `Tour: added ${added.map(stopName).join(", ")}`, tour: true });
    if (removed.length) out.push({ text: `Tour: removed ${removed.map(stopName).join(", ")}`, tour: true });
    const keep = cIds.filter((id) => bIds.includes(id)), keepWas = bIds.filter((id) => cIds.includes(id));
    if (keep.join() !== keepWas.join()) out.push({ text: "Tour: stops put in a new order", tour: true });
    for (const s of ct.stops) {
      const b = bt.stops.find((x) => x.place === s.place);
      if (b && (b.text || "") !== (s.text || "")) out.push({ text: `Tour text for ${stopName(s.place)} changed`, tour: true });
    }
    return out;
  }
  function changedIds() {
    const s = new Set();
    for (const i of describe()) { if (i.place) s.add(i.place); if (i.also) s.add(i.also); }
    return s;
  }

  // ---------------------------------------------------------------- edits
  function setCover(pl, f) {
    if (coverOf(pl) === f && pl.hero === f) return;
    change(`New cover for ${titleOf(pl)}`, () => { pl.hero = f; setHiddenRaw([f], false); delete pl.guess; });
    toast(`${stem(f)} is now the cover photo of ${titleOf(pl)}`);
  }
  function setHiddenRaw(files, hide) {
    const H = S.hidden;
    H.hidden ||= [];
    H.why ||= {};
    for (const f of files) {
      const i = H.hidden.indexOf(f);
      if (hide && i < 0) { H.hidden.push(f); H.why[f] = BASE.hidden.why?.[f] || "hidden in the place editor"; }
      if (!hide && i >= 0) { H.hidden.splice(i, 1); delete H.why[f]; }
    }
  }
  function setHidden(files, hide) {
    files = files.filter((f) => HID.has(f) !== hide);
    if (!files.length) return;
    const n = plural(files.length, "photo");
    change(hide ? `Hid ${n}` : `Brought back ${n}`, () => setHiddenRaw(files, hide));
    toast(hide ? `Hid ${n} from the family map` : `${n} back on the family map`);
  }
  function movePhotos(files, toId) {
    const to = byId(toId);
    files = files.filter((f) => OWNER.get(f) !== to);
    if (!to || !files.length) return;
    const n = plural(files.length, "photo");
    change(`Moved ${n} to ${titleOf(to)}`, () => {
      const set = new Set(files);
      for (const p of places()) {
        if (!p.photos.some((f) => set.has(f))) continue;
        p.photos = p.photos.filter((f) => !set.has(f));
        fixHero(p);
      }
      to.photos.push(...files);
      fixHero(to);
      files.forEach((f) => selected.delete(f));
    });
    toast(`Moved ${n} to ${titleOf(to)}`);
  }
  function newPlace(from, files) {
    if (!files.length) return;
    const id = nextId();
    change(`New place from ${plural(files.length, "photo")}`, () => {
      const set = new Set(files);
      for (const p of places()) {
        if (!p.photos.some((f) => set.has(f))) continue;
        p.photos = p.photos.filter((f) => !set.has(f));
        fixHero(p);
      }
      const np = { id, name: "", icon: from.icon === "photo" ? "photo" : "star", story: "", hero: null, photos: files, featured: false };
      fixHero(np);
      places().splice(places().indexOf(from) + 1, 0, np);
      selected.clear();
    });
    openPlace(id);
    toast(`Made a new place from ${plural(files.length, "photo")}. Give it a name.`);
    $("#place [data-k=name]")?.focus();
  }
  function mergeInto(pl, toId) {
    const to = byId(toId);
    if (!to || to === pl) return;
    if (!confirm(`Move all ${plural(pl.photos.length, "photo")} from “${titleOf(pl)}” into “${titleOf(to)}” and remove “${titleOf(pl)}”?\n\nUndo can bring it back.`)) return;
    change(`Merged ${titleOf(pl)} into ${titleOf(to)}`, () => {
      to.photos.push(...pl.photos);
      if (!to.name && pl.name) Object.assign(to, { name: pl.name, icon: pl.icon, featured: pl.featured });
      if (!to.story && pl.story) to.story = pl.story;
      fixHero(to);
      for (const s of S.tour.stops) if (s.place === pl.id) s.place = to.id;
      places().splice(places().indexOf(pl), 1);
    });
    openPlace(to.id);
    toast(`Merged into ${titleOf(to)}`);
  }
  function deletePlace(pl) {
    if (pl.photos.length) return;
    change(`Deleted ${titleOf(pl)}`, () => {
      S.tour.stops = S.tour.stops.filter((s) => s.place !== pl.id);
      places().splice(places().indexOf(pl), 1);
    });
    const nx = places()[0];
    if (nx) openPlace(nx.id);
    toast("Deleted the empty place");
  }
  function reorder(pl, files, target, after) {
    if (files.includes(target)) return;
    change(`Reordered photos in ${titleOf(pl)}`, () => {
      const set = new Set(files);
      const rest = pl.photos.filter((f) => !set.has(f));
      rest.splice(rest.indexOf(target) + (after ? 1 : 0), 0, ...pl.photos.filter((f) => set.has(f)));
      pl.photos = rest;
    });
  }
  function moveBy(pl, f, d) {
    const list = known(pl), i = list.indexOf(f), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    reorder(pl, [f], list[j], d > 0);
  }
  function sortByTime(pl) {
    const t = (f) => (PH.get(f)?.taken ? Date.parse(PH.get(f).taken) : 0);
    change(`Sorted ${titleOf(pl)} by time`, () => { pl.photos.sort((a, b) => t(a) - t(b) || a.localeCompare(b)); });
    toast(`${titleOf(pl)}: photos now in the order they were taken`);
  }
  function setCaption(f, k, v) {
    change(`${k === "title" ? "Title" : "Caption"} on ${stem(f)}`, () => {
      const o = { ...(S.photos[f] || {}) };
      if (v.trim()) o[k] = v; else delete o[k];
      if (Object.keys(o).length) S.photos[f] = o; else delete S.photos[f];
    }, { key: `cap:${k}:${f}`, quiet: true });
  }

  // ---------------------------------------------------------------- place list
  function passes(pl) {
    if (filter === "todo" && reviewed[pl.id]) return false;
    if (filter === "named" && !pl.name) return false;
    if (filter === "unnamed" && pl.name) return false;
    if (filter === "houses" && !pl.site) return false;
    if (filter === "changed" && !changedIds().has(pl.id)) return false;
    if (query) {
      const hay = [pl.name, pl.label, pl.story, pl.id, ICONS[pl.icon]?.[1],
        ...pl.photos.map((f) => `${stem(f)} ${capOf(f).title || ""} ${capOf(f).caption || ""}`)].join(" ").toLowerCase();
      if (!query.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  function rowHtml(pl, ch) {
    const c = coverOf(pl), n = shownOf(pl).length, h = hiddenOf(pl).length;
    return `<div class="row${pl.id === cur ? " cur" : ""}${reviewed[pl.id] ? " done" : ""}" data-id="${esc(pl.id)}" role="option" tabindex="0" aria-selected="${pl.id === cur}">
      ${c ? `<img src="${esc(photoUrl(PH.get(c), "thumb"))}" alt="" loading="lazy" draggable="false">` : `<span class="noimg">${icon(pl.icon)}</span>`}
      <span class="t"><b>${pl.name ? `${icon(pl.icon)} ${esc(pl.name)}` : pl.label ? `<i>🏷️ ${esc(pl.label)}</i>` : "<i>Unnamed spot</i>"}</b>
        <small>${esc(pl.id)} · ${plural(n, "photo")}${h ? ` · ${h} hidden` : ""}</small></span>
      <span class="marks">${ch.has(pl.id) ? `<i class="m-edit" title="You've changed this place">✎</i>` : ""}${reviewed[pl.id] ? `<i class="m-done" title="Checked">✓</i>` : ""}</span>
    </div>`;
  }
  function renderList() {
    const ch = changedIds();
    const rows = places().filter(passes);
    $("#list").innerHTML = rows.map((pl) => rowHtml(pl, ch)).join("")
      || `<p class="empty">${filter === "todo" && !query ? "🎉 Every place is checked." : "Nothing matches."}</p>`;
    $("#list .row.cur")?.scrollIntoView({ block: "nearest" });
  }
  function refreshRow(id) {
    const r = id && $(`#list .row[data-id="${CSS.escape(id)}"]`);
    if (r && byId(id)) r.outerHTML = rowHtml(byId(id), changedIds());
  }
  $("#list").addEventListener("click", (e) => { const r = e.target.closest(".row"); if (r) openPlace(r.dataset.id); });
  $("#list").addEventListener("keydown", (e) => { const r = e.target.closest(".row"); if (r && e.key === "Enter") openPlace(r.dataset.id); });
  $("#filter").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter = b.dataset.f;
    $$("#filter button").forEach((x) => x.classList.toggle("on", x === b));
    renderList();
    renderPlace();
  };
  $("#search").oninput = (e) => { query = e.target.value.trim().toLowerCase(); renderList(); renderPlace(); };

  function neighbour(pl, dir, wrap = false) {
    const all = places(), n = all.length;
    let i = all.indexOf(pl);
    for (let k = 1; k < n; k++) {
      const j = i + dir * k;
      if (!wrap && (j < 0 || j >= n)) return null;
      const p = all[(j + n) % n];
      if (p !== pl && passes(p)) return p;
    }
    return null;
  }
  function openPlace(id, { fit = true } = {}) {
    if (!byId(id)) return;
    const changed = cur !== id;
    cur = id;
    store.set("tagCur", id);
    if (changed) { selected.clear(); anchor = null; $("#place").scrollTop = 0; }
    document.body.classList.remove("list-open");
    if (tab !== "places") showTab("places");
    renderList();
    renderPlace();
    drawMap(fit);
  }

  // ---------------------------------------------------------------- one place
  function placeOptions(exclude = null, sel = null) {
    const ps = places().filter((p) => p.id !== exclude);
    const o = (p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${p.name ? `${icon(p.icon)} ${esc(p.name)}` : `Unnamed spot ${esc(p.id)}`} (${shownOf(p).length})</option>`;
    return `<optgroup label="Named places">${ps.filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name)).map(o).join("")}</optgroup>
      <optgroup label="Unnamed spots">${ps.filter((p) => !p.name).map(o).join("")}</optgroup>`;
  }
  function tileHtml(pl, f, n, cover) {
    const p = PH.get(f), hid = HID.has(f), cap = capOf(f), far = farOf(pl, f), sel = selected.has(f);
    return `<div class="tile${hid ? " hid" : ""}${sel ? " sel" : ""}${f === cover ? " cover" : ""}" data-f="${esc(f)}" draggable="true"
        title="${esc(stem(f))} · ${esc(fmtDate(p.taken))}">
      <img src="${esc(photoUrl(p, "thumb"))}" alt="" loading="lazy" draggable="false">
      <button class="selbox" data-a="sel" aria-label="Select this photo" aria-pressed="${sel}">${sel ? "✓" : ""}</button>
      ${hid ? "" : `<span class="num">${n}</span>`}
      <span class="tools">
        <button data-a="hero" title="Make this the cover photo">⭐</button>
        <button data-a="hide" title="${hid ? "Show it on the family map again" : "Hide it from the family map"}">${hid ? "👁" : "🙈"}</button>
      </span>
      <span class="flags">${f === cover ? `<b class="f-cover">⭐ Cover</b>` : ""}${hid ? `<b class="f-hid">Hidden</b>` : ""}${far ? `<b class="f-far" title="Taken ${Math.round(far)} m from this place's pin">⚠ far</b>` : ""}</span>
      ${cap.title || cap.caption ? `<span class="cap">💬 ${esc(cap.title || cap.caption)}</span>` : ""}
    </div>`;
  }
  function selbarHtml(pl) {
    return `<b>${plural(selected.size, "photo")} selected</b>
      <select data-a="move-sel" aria-label="Move the selected photos to"><option value="">Move to…</option>${placeOptions(pl.id)}</select>
      <button data-a="new-place">New place from these</button>
      <button data-a="hide-sel">🙈 Hide</button>
      <button data-a="show-sel">👁 Show</button>
      <button data-a="clear-sel">Clear</button>`;
  }
  function renderPlace() {
    const box = $("#place");
    const pl = byId(cur);
    if (!pl) { box.innerHTML = `<p class="empty">Pick a place from the list.</p>`; return; }
    const top = box.scrollTop;
    const list = places().filter(passes), i = list.indexOf(pl);
    const files = known(pl), cover = coverOf(pl), shown = shownOf(pl).length, hid = files.length - shown;
    const stops = S.tour.stops.map((s, k) => (s.place === pl.id ? k + 1 : 0)).filter(Boolean);
    let n = 0;
    box.innerHTML = `
      <div class="pl-nav">
        <button data-a="list" class="only-narrow">☰ Places</button>
        <button data-a="prev" ${neighbour(pl, -1) ? "" : "disabled"} title="Previous place (Alt+↑)">‹ Previous</button>
        <span class="pos">${i >= 0 ? `${i + 1} of ${list.length}` : ""}</span>
        <button data-a="next" ${neighbour(pl, 1) ? "" : "disabled"} title="Next place (Alt+↓)">Next ›</button>
        <span class="grow"></span>
        ${reviewed[pl.id] ? `<span class="done-chip">✓ Checked</span>` : ""}
        <a href="index.html#place=${encodeURIComponent(pl.id)}" target="_blank" rel="noopener" title="Opens the published family map (without your edits)">Family map ↗</a>
      </div>
      <div class="pl-fields">
        <div class="name-row">
          <input data-k="name" type="text" value="${esc(pl.name || "")}" placeholder="Name this place (leave empty for a small camera spot)" aria-label="Place name">
          <select data-k="icon" aria-label="Icon">${Object.entries(ICONS).map(([k, [e, label]]) => `<option value="${k}"${k === pl.icon ? " selected" : ""}>${e} ${esc(label)}</option>`).join("")}</select>
        </div>
        <label class="check"><input data-k="featured" type="checkbox" ${pl.featured ? "checked" : ""}>
          Show as a named place <small>(picture pin with a label, listed under Places and in search; off = a small camera spot)</small></label>
        <textarea data-k="story" rows="2" placeholder="A story or memory about this place (optional; shown under the cover photo)" aria-label="Story">${esc(pl.story || "")}</textarea>
        ${!pl.name || pl.label ? `<label class="map-label">🏷️ Map label <small>optional text shown on the map like a trail name, without making this a named place</small>
          <input data-k="label" type="text" value="${esc(pl.label || "")}" placeholder="e.g. Moose Meadow"></label>` : ""}
        <div class="facts">
          ${pl.site ? `<span class="fact">🏡 Family house: its own pin, all photos shown on it</span>` : ""}
          ${stops.length ? `<span class="fact">▶️ Tour stop ${stops.join(", ")}</span>` : ""}
          ${pl.coords ? `<span class="fact">📌 Pin placed by hand <button data-a="reset-pin" title="Move the pin back to the middle of its photos">Put pin back</button></span>`
            : `<span class="fact">📍 Pin sits in the middle of its photos. Drag it on the map to place it yourself.</span>`}
          ${pl.guess ? `<span class="fact badge">Claude's guess, please check</span>` : ""}
          ${centerOf(pl) ? "" : `<span class="fact warn">⚠ No photos showing, so this place won't be on the family map</span>`}
        </div>
      </div>
      <div class="ph-head">
        <h3>Photos <small>${shown} on the map${hid ? ` · ${hid} hidden` : ""}</small></h3>
        <span class="grow"></span>
        <button data-a="sort-time" title="Put the photos in the order they were taken">Sort by time</button>
        <button data-a="select-all">Select all</button>
      </div>
      <p class="hint">Click a photo to see it big and write its caption · drag to change the order · ☐ selects · ⭐ cover · 🙈 hide</p>
      <div class="grid">${files.map((f) => tileHtml(pl, f, HID.has(f) ? 0 : ++n, cover)).join("") || `<p class="empty">No photos in this place.</p>`}</div>
      <div class="selbar"${selected.size ? "" : " hidden"}>${selbarHtml(pl)}</div>
      <details class="more">
        <summary>Merge or delete this place</summary>
        <p>Merging moves every photo from this place (hidden ones too) into another place and removes this one. Any tour stop moves with it.</p>
        <select data-a="merge"><option value="">Merge this place into…</option>${placeOptions(pl.id)}</select>
        ${pl.photos.length ? `<p class="small">Only an empty place can be deleted.</p>` : `<button data-a="delete" class="danger">Delete this empty place</button>`}
      </details>
      <div class="done-row">
        ${reviewed[pl.id]
          ? `<button data-a="next-todo" class="primary big">Next unchecked place ›</button><button data-a="undone">Mark as not checked</button>`
          : `<button data-a="done" class="primary big">✓ Looks good: next place</button>`}
      </div>`;
    box.scrollTop = top;
  }
  const tileEl = (f) => $(`#place .tile[data-f="${CSS.escape(f)}"]`);
  function updateSel() {
    const pl = byId(cur);
    $$("#place .tile").forEach((t) => {
      const on = selected.has(t.dataset.f);
      t.classList.toggle("sel", on);
      const b = $(".selbox", t);
      b.textContent = on ? "✓" : "";
      b.setAttribute("aria-pressed", on);
    });
    const bar = $("#place .selbar");
    if (bar) { bar.hidden = !selected.size; bar.innerHTML = selbarHtml(pl); }
    drawMap(false);
  }
  function toggleSel(pl, f, range) {
    const list = known(pl);
    if (range && anchor && list.includes(anchor)) {
      const [a, b] = [list.indexOf(anchor), list.indexOf(f)].sort((x, y) => x - y);
      list.slice(a, b + 1).forEach((x) => selected.add(x));
    } else if (selected.has(f)) selected.delete(f);
    else selected.add(f);
    anchor = f;
    updateSel();
  }

  const P = $("#place");
  P.addEventListener("click", (e) => {
    const pl = byId(cur);
    if (!pl) return;
    const a = e.target.closest("[data-a]")?.dataset.a;
    const tile = e.target.closest(".tile");
    if (tile) {
      const f = tile.dataset.f;
      if (a === "sel" || e.shiftKey || e.ctrlKey || e.metaKey) return toggleSel(pl, f, e.shiftKey);
      if (a === "hero") return setCover(pl, f);
      if (a === "hide") return setHidden([f], !HID.has(f));
      return openViewer(f);
    }
    const sel = known(pl).filter((f) => selected.has(f));
    switch (a) {
      case "list": document.body.classList.add("list-open"); break;
      case "prev": { const p = neighbour(pl, -1); if (p) openPlace(p.id); break; }
      case "next": { const p = neighbour(pl, 1); if (p) openPlace(p.id); break; }
      case "done": {
        setReviewed(pl.id, true);
        if (pl.guess) change(`Confirmed ${titleOf(pl)}`, () => { delete pl.guess; });
        renderChrome();
        const nx = neighbour(pl, 1, true);
        const left = places().filter((p) => !reviewed[p.id]).length;
        if (nx && left) { openPlace(nx.id); toast(`✓ ${titleOf(pl)} checked. ${left} to go.`, false); }
        else { renderList(); renderPlace(); drawMap(false); toast(left ? `✓ ${titleOf(pl)} checked` : "🎉 Every place is checked! Look over the Tour, then Download edits.", false); }
        break;
      }
      case "next-todo": {
        const nx = places().find((p, k) => k > places().indexOf(pl) && !reviewed[p.id]) || places().find((p) => !reviewed[p.id]);
        if (nx) openPlace(nx.id); else toast("🎉 Every place is checked.", false);
        break;
      }
      case "undone": setReviewed(pl.id, false); renderChrome(); renderList(); renderPlace(); drawMap(false); break;
      case "reset-pin": change(`Put the pin of ${titleOf(pl)} back`, () => { delete pl.coords; }); fitPlace(); break;
      case "sort-time": sortByTime(pl); break;
      case "select-all": known(pl).forEach((f) => selected.add(f)); updateSel(); break;
      case "clear-sel": selected.clear(); updateSel(); break;
      case "new-place": newPlace(pl, sel); break;
      case "hide-sel": setHidden(sel, true); break;
      case "show-sel": setHidden(sel, false); break;
      case "delete": deletePlace(pl); break;
    }
  });
  P.addEventListener("change", (e) => {
    const pl = byId(cur);
    const k = e.target.dataset.k, a = e.target.dataset.a, v = e.target.value;
    if (k === "icon") change(`Icon for ${titleOf(pl)}`, () => { pl.icon = v; delete pl.guess; });
    if (k === "featured") change(`${titleOf(pl)} ${e.target.checked ? "shown as a named place" : "made a camera spot"}`, () => { pl.featured = e.target.checked; delete pl.guess; });
    if (a === "move-sel" && v) movePhotos(known(pl).filter((f) => selected.has(f)), v);
    if (a === "merge" && v) { mergeInto(pl, v); if (byId(pl.id)) e.target.value = ""; }
  });
  P.addEventListener("input", (e) => {
    const pl = byId(cur);
    const k = e.target.dataset.k, v = e.target.value;
    if (k === "name") {
      change(`Name of ${pl.id}`, () => {
        pl.name = v;
        if (v && !pl.featured) pl.featured = true;   // naming a camera spot makes it a real place
        delete pl.guess;
      }, { key: "name:" + pl.id, quiet: true });
      const box = $("[data-k=featured]", P);
      if (box) box.checked = !!pl.featured;
      drawMap(false);
    }
    if (k === "label") {
      change(`Map label for ${pl.id}`, () => { if (v.trim()) pl.label = v; else delete pl.label; }, { key: "label:" + pl.id, quiet: true });
      drawMap(false);
    }
    if (k === "story") change(`Story for ${titleOf(pl)}`, () => { pl.story = v; }, { key: "story:" + pl.id, quiet: true });
  });

  // Drag photos to reorder them, or onto a place in the list to move them there.
  let drag = null, hovered = null;
  const clearDrop = () => $$(".drop-before, .drop-after, .drop-into").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into"));
  P.addEventListener("dragstart", (e) => {
    const t = e.target.closest?.(".tile");
    if (!t) return;
    const pl = byId(cur), f = t.dataset.f;
    drag = { files: selected.has(f) ? known(pl).filter((x) => selected.has(x)) : [f], from: pl.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", drag.files.join("\n"));
    requestAnimationFrame(() => drag?.files.forEach((x) => tileEl(x)?.classList.add("dragging")));
  });
  P.addEventListener("dragover", (e) => {
    if (!drag) return;
    const t = e.target.closest(".tile");
    clearDrop();
    if (!t) return;
    e.preventDefault();
    const r = t.getBoundingClientRect();
    t.classList.add(e.clientX > r.left + r.width / 2 ? "drop-after" : "drop-before");
  });
  P.addEventListener("drop", (e) => {
    const t = e.target.closest(".tile");
    if (!drag || !t) return;
    e.preventDefault();
    const after = t.classList.contains("drop-after");
    clearDrop();
    reorder(byId(cur), drag.files, t.dataset.f, after);
  });
  $("#list").addEventListener("dragover", (e) => {
    if (!drag) return;
    const r = e.target.closest(".row");
    clearDrop();
    if (!r || r.dataset.id === drag.from) return;
    e.preventDefault();
    r.classList.add("drop-into");
  });
  $("#list").addEventListener("drop", (e) => {
    const r = e.target.closest(".row");
    if (!drag || !r) return;
    e.preventDefault();
    clearDrop();
    movePhotos(drag.files, r.dataset.id);
  });
  document.addEventListener("dragend", () => { drag = null; clearDrop(); $$(".dragging").forEach((x) => x.classList.remove("dragging")); });
  // Hovering a photo lights up its dot on the map.
  P.addEventListener("mouseover", (e) => {
    const f = e.target.closest(".tile")?.dataset.f || null;
    if (f === hovered) return;
    if (hovered) hlDot(hovered, false);
    hovered = f;
    if (f) hlDot(f, true);
  });
  P.addEventListener("mouseleave", () => { if (hovered) hlDot(hovered, false); hovered = null; });

  // ---------------------------------------------------------------- map
  let map, pinLayer, dotLayer, allLayer, trailLayer;
  const dotMarks = new Map();
  const trailStyle = (f) => ({ color: f.properties.color || "#fff", weight: f.properties.category === "boundary" ? 2 : 3, opacity: 0.8,
    dashArray: f.properties.category === "boundary" ? "6 6" : null, fill: false });
  const trails = () => L.geoJSON(bundle.tracks, { interactive: false, filter: (f) => f.geometry.type !== "Point", style: trailStyle });
  function initMap() {
    map = L.map("map", { zoomSnap: 0.25, maxZoom: 22 });
    L.tileLayer(ESRI, { maxZoom: 22, maxNativeZoom: 19, attribution: "Imagery © Esri" }).addTo(map);
    trailLayer = trails().addTo(map);
    allLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    dotLayer = L.layerGroup().addTo(map);
    $("#show-trails").onchange = (e) => (e.target.checked ? trailLayer.addTo(map) : trailLayer.remove());
    $("#show-all-photos").onchange = () => drawMap(false);
    $("#fit-place").onclick = fitPlace;
    $("#fit-all").onclick = fitAll;
  }
  const thumbTip = (p, text) => `<img class="tt-img" src="${esc(photoUrl(p, "thumb"))}" alt=""><br>${text}`;
  function drawMap(fit) {
    if (!map) return;
    pinLayer.clearLayers();
    dotLayer.clearLayers();
    allLayer.clearLayers();
    dotMarks.clear();
    const pl = byId(cur);
    for (const p of places()) {
      const c = centerOf(p);
      if (!c) continue;
      const me = p === pl;
      const m = L.marker([c[1], c[0]], {
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="pin${me ? " cur" : ""}${p.name ? "" : " unnamed"}${reviewed[p.id] ? " done" : ""}">${icon(p.icon)}</div>` }),
        draggable: me, zIndexOffset: me ? 500 : 0, keyboard: false,
      }).bindTooltip(`<b>${esc(p.name || (p.label ? `🏷️ ${p.label}` : titleOf(p)))}</b> · ${plural(shownOf(p).length, "photo")}${me ? "<br><small>Drag to move this pin</small>" : ""}`, { direction: "top", offset: [0, -16] });
      if (me) m.on("dragend", () => change(`Moved the pin of ${titleOf(p)}`, () => { const ll = m.getLatLng(); p.coords = [+ll.lng.toFixed(6), +ll.lat.toFixed(6)]; delete p.guess; }));
      else m.on("click", () => openPlace(p.id, { fit: false }));
      m.addTo(pinLayer);
    }
    if (pl) {
      let n = 0;
      const cover = coverOf(pl);
      for (const f of known(pl)) {
        const ph = PH.get(f), hid = HID.has(f);
        if (!hid) n++;
        if (!ph.pos) continue;
        const cls = ["dot", hid && "hid", f === cover && "cover", selected.has(f) && "sel"].filter(Boolean).join(" ");
        const m = L.marker([ph.pos[1], ph.pos[0]], {
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="${cls}">${hid ? "" : n}</div>` }), zIndexOffset: 1000, keyboard: false,
        }).bindTooltip(thumbTip(ph, `${hid ? "Hidden" : `#${n}`} · ${esc(fmtDate(ph.taken))}`), { direction: "top", offset: [0, -12] });
        m.on("click", () => openViewer(f));
        m.on("mouseover", () => tileEl(f)?.classList.add("hl"));
        m.on("mouseout", () => tileEl(f)?.classList.remove("hl"));
        m.addTo(dotLayer);
        dotMarks.set(f, m);
      }
    }
    if ($("#show-all-photos").checked) {
      for (const p of places()) {
        if (p === pl) continue;
        for (const f of known(p)) {
          const ph = PH.get(f);
          if (!ph.pos) continue;
          L.circleMarker([ph.pos[1], ph.pos[0]], { radius: 5, weight: 1.5, color: "#111", fillColor: HID.has(f) ? "#9e9e9e" : "#fff", fillOpacity: 0.95 })
            .bindTooltip(thumbTip(ph, `${esc(titleOf(p))}${HID.has(f) ? " · hidden" : ""}`), { direction: "top" })
            .on("click", () => { openPlace(p.id, { fit: false }); openViewer(f); })
            .addTo(allLayer);
        }
      }
    }
    if (fit) fitPlace();
  }
  function hlDot(f, on) {
    const m = dotMarks.get(f);
    if (!m) return;
    m.getElement()?.firstElementChild?.classList.toggle("hl", on);
    m.setZIndexOffset(on ? 3000 : 1000);
  }
  function fitPlace() {
    const pl = byId(cur);
    if (!pl || !map) return;
    const pts = known(pl).map((f) => PH.get(f).pos).filter(Boolean);
    const c = centerOf(pl);
    if (c) pts.push(c);
    if (!pts.length) return;
    map.fitBounds(L.latLngBounds(pts.map((p) => [p[1], p[0]])), { padding: [40, 40], maxZoom: 19 });
  }
  function fitAll() {
    if (meta.bounds) return map.fitBounds(meta.bounds, { padding: [10, 10] });
    const pts = places().filter((p) => !p.site).map(centerOf).filter(Boolean);
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p[1], p[0]])), { padding: [20, 20] });
  }

  // ---------------------------------------------------------------- photo viewer
  const V = $("#viewer");
  const vw = { open: false, file: null, map: null, layer: null };
  V.querySelector(".vw-side").innerHTML = `<div class="vw-info"></div><div class="vw-map" aria-label="Where this photo was taken"></div>
    <p class="vw-keys"><kbd>←</kbd> <kbd>→</kbd> photos · <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> move it · <kbd>H</kbd> hide · <kbd>C</kbd> cover · <kbd>E</kbd> caption · <kbd>Esc</kbd> close</p>`;
  function openViewer(f) {
    vw.file = f;
    vw.open = true;
    V.hidden = false;
    document.body.classList.add("noscroll");
    if (!vw.map) {
      vw.map = L.map($(".vw-map", V), { zoomControl: false, attributionControl: false, maxZoom: 21, zoomSnap: 0.25 });
      L.tileLayer(ESRI, { maxZoom: 21, maxNativeZoom: 19 }).addTo(vw.map);
      trails().addTo(vw.map);
      vw.layer = L.layerGroup().addTo(vw.map);
    }
    renderViewer();
    requestAnimationFrame(() => { vw.map.invalidateSize(); renderViewerMap(); });
  }
  function closeViewer() {
    if (!vw.open) return;
    vw.open = false;
    V.hidden = true;
    document.body.classList.remove("noscroll");
    renderPlace();
    drawMap(false);
    const t = vw.file && tileEl(vw.file);
    if (t) { t.scrollIntoView({ block: "nearest" }); t.classList.add("hl"); setTimeout(() => t.classList.remove("hl"), 1200); }
  }
  function renderViewer() {
    if (!vw.open) return;
    const pl = OWNER.get(vw.file);
    if (!pl || !PH.has(vw.file)) return closeViewer();
    if (pl.id !== cur) openPlace(pl.id, { fit: false });
    const list = known(pl), i = list.indexOf(vw.file), f = vw.file, p = PH.get(f), hid = HID.has(f), cap = capOf(f);
    const cover = coverOf(pl) === f, c = centerOf(pl), d = c && p.pos ? metres(c, p.pos) : null, far = farOf(pl, f);
    const img = $(".vw-photo img", V);
    if (img.dataset.f !== f) { img.src = photoUrl(p); img.dataset.f = f; img.alt = cap.title || titleOf(pl); }
    for (const x of [list[i - 1], list[i + 1]]) if (x) new Image().src = photoUrl(PH.get(x));
    V.classList.toggle("is-hidden", hid);
    $(".vw-nav.prev", V).disabled = i <= 0;
    $(".vw-nav.next", V).disabled = i >= list.length - 1;
    $(".vw-info", V).innerHTML = `
      <div class="vw-title"><b>${icon(pl.icon)} ${esc(titleOf(pl))}</b><span>Photo ${i + 1} of ${list.length}</span></div>
      <div class="vw-meta">${esc(stem(f))} · ${esc(fmtDate(p.taken))}</div>
      <div class="vw-status">
        ${hid ? `<span class="st st-hid">🙈 Hidden from the family map</span>` : `<span class="st st-on">👁 On the family map</span>`}
        ${cover ? `<span class="st st-cover">⭐ Cover photo</span>` : ""}
        ${d == null ? `<span class="st">📍 No location saved</span>` : `<span class="st${far ? " st-far" : ""}">${far ? "⚠" : "📍"} Taken ${Math.round(d)} m from the pin</span>`}
      </div>
      <label class="fld">Caption <small>shown under the photo on the family map</small>
        <textarea data-k="caption" rows="3" placeholder="What's in this photo? (optional)">${esc(cap.caption || "")}</textarea></label>
      <label class="fld">Title <small>optional; replaces “${esc(titleOf(pl))}” as this photo's heading</small>
        <input data-k="title" type="text" value="${esc(cap.title || "")}" placeholder="${esc(titleOf(pl))}"></label>
      <div class="vw-btns">
        <button data-a="hide">${hid ? "👁 Show on the map" : "🙈 Hide from the map"}</button>
        <button data-a="hero" ${cover ? "disabled" : ""}>⭐ ${cover ? "It's the cover" : "Make it the cover"}</button>
        <button data-a="earlier" ${i <= 0 ? "disabled" : ""}>◀ Move earlier</button>
        <button data-a="later" ${i >= list.length - 1 ? "disabled" : ""}>Move later ▶</button>
      </div>
      <select data-a="move-to" aria-label="Move this photo to another place"><option value="">Move this photo to another place…</option>${placeOptions(pl.id)}</select>`;
    renderViewerMap();
  }
  function renderViewerMap() {
    if (!vw.open || !vw.map) return;
    vw.layer.clearLayers();
    const pl = OWNER.get(vw.file), p = PH.get(vw.file), c = centerOf(pl);
    for (const f of known(pl)) {
      const q = PH.get(f).pos;
      if (q && f !== vw.file) L.circleMarker([q[1], q[0]], { radius: 4, weight: 1, color: "#111", fillColor: HID.has(f) ? "#9e9e9e" : "#fff", fillOpacity: 0.9 }).addTo(vw.layer);
    }
    if (c) L.marker([c[1], c[0]], { icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="pin cur small">${icon(pl.icon)}</div>` }), keyboard: false }).addTo(vw.layer);
    if (p.pos) L.marker([p.pos[1], p.pos[0]], { icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="dot me"></div>` }), zIndexOffset: 1000, keyboard: false }).addTo(vw.layer);
    const pts = [c, p.pos].filter(Boolean).map((q) => [q[1], q[0]]);
    if (pts.length === 2 && metres(c, p.pos) > 5) vw.map.fitBounds(pts, { padding: [30, 30], maxZoom: 19 });
    else if (pts.length) vw.map.setView(pts[0], 18);
  }
  function step(d) {
    const pl = OWNER.get(vw.file), list = pl ? known(pl) : [], j = list.indexOf(vw.file) + d;
    if (j < 0 || j >= list.length) return;
    vw.file = list[j];
    renderViewer();
  }
  $(".vw-close", V).onclick = closeViewer;
  $(".vw-nav.prev", V).onclick = () => step(-1);
  $(".vw-nav.next", V).onclick = () => step(1);
  let touchX = null;
  $(".vw-photo", V).addEventListener("touchstart", (e) => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  $(".vw-photo", V).addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });
  const vside = $(".vw-side", V);
  vside.addEventListener("click", (e) => {
    const a = e.target.closest("button[data-a]")?.dataset.a, f = vw.file, pl = OWNER.get(f);
    if (a === "hide") setHidden([f], !HID.has(f));
    if (a === "hero") setCover(pl, f);
    if (a === "earlier") moveBy(pl, f, -1);
    if (a === "later") moveBy(pl, f, 1);
  });
  vside.addEventListener("input", (e) => { const k = e.target.dataset.k; if (k) setCaption(vw.file, k, e.target.value); });
  vside.addEventListener("change", (e) => {
    if (e.target.dataset.a !== "move-to" || !e.target.value) return;
    const f = vw.file, list = known(OWNER.get(f)), i = list.indexOf(f);
    const next = list[i + 1] || list[i - 1];
    if (next) vw.file = next; else closeViewer();
    movePhotos([f], e.target.value);
  });

  // ---------------------------------------------------------------- tour
  const TV = $("#view-tour");
  function stopHtml(s, i) {
    const pl = byId(s.place), c = pl && coverOf(pl);
    const warn = !pl ? "⚠ This place no longer exists, so the family map skips this stop."
      : !centerOf(pl) ? "⚠ This place has no photos showing, so the family map skips this stop."
      : S.tour.stops.findIndex((x) => x.place === s.place) !== i ? "This place is also an earlier stop."
      : !pl.name ? "This is an unnamed spot. Give it a name so the stop has a title." : "";
    return `<li class="stop" data-i="${i}">
      <span class="num">${i + 1}</span>
      ${c ? `<img src="${esc(photoUrl(PH.get(c), "thumb"))}" alt="" loading="lazy">` : `<span class="noimg">${pl ? icon(pl.icon) : "?"}</span>`}
      <div class="body">
        <select data-a="stop-place" aria-label="Place for stop ${i + 1}">${pl ? "" : `<option value="${esc(s.place)}" selected>(missing: ${esc(s.place)})</option>`}${placeOptions(null, s.place)}</select>
        <textarea data-a="stop-text" rows="2" aria-label="Text for stop ${i + 1}" placeholder="${esc(pl?.story ? `Empty: uses the place's story (“${short(pl.story, 60)}”)` : "What to say at this stop")}">${esc(s.text || "")}</textarea>
        ${warn ? `<p class="warn">${warn}</p>` : ""}
      </div>
      <div class="ctl">
        <button data-a="stop-up" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button data-a="stop-down" ${i === S.tour.stops.length - 1 ? "disabled" : ""} title="Move down">↓</button>
        <button data-a="stop-open" title="Open this place">📍</button>
        <button data-a="stop-del" class="danger" title="Remove this stop">✕</button>
      </div>
    </li>`;
  }
  function renderTour() {
    const T = S.tour;
    TV.innerHTML = `<div class="tour">
      <h2>▶️ Tour</h2>
      <p class="lead">The family map's tour goes through these stops in order, with big Back / Next buttons. Each stop shows the place's cover photo
        and this text. ${tourWasNull ? "<br><small>The build picks these stops for you until you change something here.</small>" : ""}</p>
      <label class="fld">Tour title <input id="tour-title" type="text" value="${esc(T.title || "")}"></label>
      <ol class="stops">${T.stops.map(stopHtml).join("")}</ol>
      <select id="add-stop" aria-label="Add a stop"><option value="">＋ Add a stop at the end…</option>${placeOptions()}</select>
    </div>`;
  }
  TV.addEventListener("input", (e) => {
    if (e.target.id === "tour-title") change("Tour title", () => { S.tour.title = e.target.value; }, { key: "tour-title", quiet: true });
    const li = e.target.closest(".stop");
    if (li && e.target.dataset.a === "stop-text") {
      const s = S.tour.stops[+li.dataset.i];
      change(`Tour text for stop ${+li.dataset.i + 1}`, () => { s.text = e.target.value; }, { key: "stop:" + s.place, quiet: true });
    }
  });
  TV.addEventListener("change", (e) => {
    const li = e.target.closest(".stop"), v = e.target.value;
    if (li && e.target.dataset.a === "stop-place") change(`Tour stop ${+li.dataset.i + 1} place`, () => { S.tour.stops[+li.dataset.i].place = v; });
    if (e.target.id === "add-stop" && v) {
      change(`Added ${titleOf(byId(v))} to the tour`, () => { S.tour.stops.push({ place: v, text: "" }); });
      toast(`Added ${titleOf(byId(v))} as stop ${S.tour.stops.length}`);
    }
  });
  TV.addEventListener("click", (e) => {
    const a = e.target.closest("button[data-a]")?.dataset.a, li = e.target.closest(".stop");
    if (!a || !li) return;
    const i = +li.dataset.i, st = S.tour.stops;
    const swap = (j) => change("Reordered the tour", () => { [st[i], st[j]] = [st[j], st[i]]; });
    if (a === "stop-up" && i > 0) swap(i - 1);
    if (a === "stop-down" && i < st.length - 1) swap(i + 1);
    if (a === "stop-open" && byId(st[i].place)) openPlace(st[i].place);
    if (a === "stop-del") { change(`Removed tour stop ${i + 1}`, () => { st.splice(i, 1); }); toast(`Removed stop ${i + 1}`); }
  });

  // ---------------------------------------------------------------- changes, export
  const CV = $("#view-changes");
  function renderChanges() {
    const items = describe();
    CV.innerHTML = `<div class="changes">
      <h2>📝 Your changes</h2>
      <p class="lead">${items.length ? `You've made <b>${plural(items.length, "change")}</b> since the family map was last published. They're saved in this browser.`
        : "No changes yet. Everything matches the published family map."}</p>
      <div class="send">
        <h3>Send them to Claude</h3>
        <ol>
          <li><button class="primary" data-a="download">⬇ Download edits</button> saves one file (<code>knopp-map-edits-<i>date</i>.json</code>).</li>
          <li>In a Claude chat for the KnoppMap project, attach that file and say <b>“Apply my map edits.”</b>
            <br><small>Can't attach a file? <button data-a="copy">Copy edits</button> and paste them into the chat instead.</small></li>
          <li>Claude checks the edits, rebuilds the map and publishes it. The family map updates a few minutes later.</li>
        </ol>
        <p class="small">Once they're published, this editor starts fresh from the new map. Your ✓ ticks stay.</p>
      </div>
      ${items.length ? `<h3>What you changed</h3><ul class="chg">${items.map((it) => `<li>${it.place && byId(it.place) ? `<a href="#" data-open="${esc(it.place)}">${esc(it.text)}</a>`
        : it.tour ? `<a href="#" data-tab="tour">${esc(it.text)}</a>` : esc(it.text)}</li>`).join("")}</ul>` : ""}
      <h3>More</h3>
      <div class="more-row">
        <label class="filebtn">📂 Load an edits file<input type="file" accept=".json,application/json" data-a="import" hidden></label>
        <button class="danger" data-a="discard" ${items.length ? "" : "disabled"}>Throw away all my edits</button>
      </div>
      <p class="small">Load an edits file to carry on from another computer or browser, or to go back to a file you downloaded earlier.</p>
    </div>`;
  }
  CV.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    const open = e.target.closest("[data-open]")?.dataset.open, t = e.target.closest("[data-tab]")?.dataset.tab;
    if (open) { e.preventDefault(); openPlace(open); }
    if (t) { e.preventDefault(); showTab(t); }
    if (a === "download") download();
    if (a === "copy") copyEdits();
    if (a === "discard" && confirm("Throw away all your edits and go back to the published map?\n\nUndo can still bring them back until you close this page.")) {
      change("Threw away all edits", () => { S = clone(BASE); });
    }
  });
  CV.addEventListener("change", (e) => { if (e.target.dataset.a === "import" && e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; });

  function editsFile() {
    return {
      kind: "knopp-map-edits", format: 1, base: ed.version, exported: new Date().toISOString(),
      howto: "Send this file to Claude and ask it to apply your map edits (python3 build/apply_edits.py <this file>).",
      summary: describe().map((i) => i.text),
      files: {
        "places.json": S.places, "photos.json": S.photos, "hidden.json": S.hidden,
        "tour.json": tourWasNull && same(S.tour, BASE.tour) ? null : S.tour,
      },
    };
  }
  function download() {
    if (!describe().length && !confirm("You haven't changed anything yet. Download anyway?")) return;
    const d = new Date(), pad = (x) => String(x).padStart(2, "0");
    const name = `knopp-map-edits-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(editsFile(), null, 2) + "\n"], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Saved ${name}. Attach it in a Claude chat and say “Apply my map edits.”`, false);
  }
  async function copyEdits() {
    try { await navigator.clipboard.writeText(JSON.stringify(editsFile())); toast("Copied. Paste it into a Claude chat and say “Apply my map edits.”", false); }
    catch { alert("Couldn't copy. Use Download edits instead."); }
  }
  async function importFile(file) {
    let x;
    try { x = JSON.parse(await file.text()); } catch { return alert("That file couldn't be read."); }
    if (x?.kind !== "knopp-map-edits" || !x.files?.["places.json"]) return alert("That isn't an edits file from this editor.");
    if (!confirm(`Load the edits in ${file.name}?\n\nThey replace what's in the editor now (Undo can bring it back).`)) return;
    const F = x.files;
    change(`Loaded ${file.name}`, () => {
      S = { places: F["places.json"], photos: F["photos.json"] || {}, hidden: F["hidden.json"] || clone(BASE.hidden), tour: F["tour.json"] || clone(BASE.tour) };
      reindex();
      addUnclaimed();
    });
    if (!byId(cur)) cur = places()[0]?.id;
    toast(`Loaded ${file.name}`);
  }

  // ---------------------------------------------------------------- chrome, tabs, keys
  function renderChrome() {
    const u = undoStack.at(-1), r = redoStack.at(-1);
    $("#undo").disabled = !u;
    $("#undo").title = u ? `Undo: ${u.label} (Ctrl+Z)` : "Nothing to undo";
    $("#redo").disabled = !r;
    $("#redo").title = r ? `Redo: ${r.label} (Ctrl+Shift+Z)` : "Nothing to redo";
    const n = describe().length;
    $("#change-count").textContent = n || "";
    const all = places(), done = all.filter((p) => reviewed[p.id]).length;
    $("#progress-bar").style.width = (all.length ? (100 * done) / all.length : 0) + "%";
    $("#progress-text").textContent = `${done} of ${all.length} places checked`;
  }
  function renderAll() {
    renderChrome();
    if (tab === "places") { renderList(); renderPlace(); drawMap(false); }
    if (tab === "tour") renderTour();
    if (tab === "changes") renderChanges();
    if (vw.open) renderViewer();
  }
  function showTab(t) {
    if (t !== "tips") store.set("tagTipsSeen", true);
    tab = t;
    $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    for (const v of ["places", "tour", "changes", "tips"]) $(`#view-${v}`).hidden = v !== t;
    document.body.dataset.tab = t;
    if (t === "places") { renderList(); renderPlace(); drawMap(false); requestAnimationFrame(() => map?.invalidateSize()); }
    if (t === "tour") renderTour();
    if (t === "changes") renderChanges();
    window.scrollTo(0, 0);
  }
  $(".tabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); };
  $("#tips-done").onclick = () => showTab("places");
  $("#undo").onclick = undo;
  $("#redo").onclick = redo;
  $("#export").onclick = download;
  document.addEventListener("click", (e) => { if (e.target.closest("[data-a=close-list]")) document.body.classList.remove("list-open"); });

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && /^[zy]$/i.test(e.key)) {
      if (isTyping(document.activeElement)) return;   // a text box undoes its own typing first
      e.preventDefault();
      if (e.key.toLowerCase() === "y" || e.shiftKey) redo(); else undo();
      return;
    }
    if (vw.open) {
      if (isTyping(e.target)) { if (e.key === "Escape") e.target.blur(); return; }
      if (e.target.tagName === "SELECT" || mod || e.altKey) return;
      const pl = OWNER.get(vw.file);
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const d = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey) moveBy(pl, vw.file, d); else step(d);
      } else if (e.key.toLowerCase() === "h") setHidden([vw.file], !HID.has(vw.file));
      else if (e.key.toLowerCase() === "c") setCover(pl, vw.file);
      else if (e.key.toLowerCase() === "e") { e.preventDefault(); $("[data-k=caption]", V)?.focus(); }
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && document.body.classList.contains("list-open")) document.body.classList.remove("list-open");
    if (tab === "places" && e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const p = byId(cur) && neighbour(byId(cur), e.key === "ArrowDown" ? 1 : -1);
      if (p) { e.preventDefault(); openPlace(p.id); }
    }
  });

  // ---------------------------------------------------------------- load
  async function loadEditor() {
    if (!meta.locked) return getJSON("data/editor.json?v=" + meta.version);
    const buf = new Uint8Array(await fetch("data/editor.enc?v=" + meta.version).then((r) => { if (!r.ok) throw new Error("editor " + r.status); return r.arrayBuffer(); }));
    const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode((store.get("pw", "") || "").trim().toLowerCase()), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(meta.salt), iterations: meta.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12))));
  }

  loadBundle(async (retry) => ({ password: prompt(retry ? "Wrong password, try again:" : "Map password:") || "", remember: true }))
  .then(async ({ meta: m, data }) => {
    meta = m;
    bundle = data;
    try { ed = await loadEditor(); }
    catch (e) {
      console.error(e);
      $("#loading").innerHTML = "The editor's data file is missing.<br><small>Ask Claude to rebuild the map (<code>python3 build/build.py</code>), then reload.</small>";
      return;
    }
    for (const f of data.photos.features) {
      const p = f.properties;
      PH.set(p.file + ".jpg", { file: p.file, src: p.src, taken: p.taken, pos: ed.takenAt?.[p.file] || f.geometry.coordinates });
    }
    for (const h of ed.hiddenPhotos || []) PH.set(h.file + ".jpg", { file: h.file, src: h.src, taken: h.taken, pos: h.pos });

    const cfg = ed.config;
    tourWasNull = !cfg.tour;
    BASE = {
      places: clone(cfg.places) || { places: [] },
      photos: clone(cfg.photos) || {},
      hidden: clone(cfg.hidden) || { hidden: [], why: {} },
      tour: clone(cfg.tour) || clone(data.tour) || { title: "Tour", stops: [] },
    };
    // New photos that no place lists yet: the build groups them into "new-01"-style spots, so start from those.
    const ids = new Set(BASE.places.places.map((p) => p.id));
    for (const f of data.places.features) {
      if (ids.has(f.id)) continue;
      const p = f.properties;
      BASE.places.places.push({ id: f.id, name: "", icon: "photo", story: "", hero: p.hero ? p.hero + ".jpg" : null, photos: p.photos.map((x) => x + ".jpg"), featured: false });
    }
    BHID = new Set(BASE.hidden.hidden || []);
    S = clone(BASE);
    reindex();
    addUnclaimed();
    BASE = clone(S);

    const draft = store.get("tagDraft2", null);
    if (draft?.state) {
      if (draft.base === ed.version) S = draft.state;
      // After Claude applies an edits file (often with small fixes), starting fresh is the usual answer.
      else if (!same(draft.state, BASE) && !confirm("The family map has been updated since you last edited here.\n\n"
        + "OK = start fresh from the updated map (choose this once Claude has applied your edits)\n"
        + "Cancel = keep the edits in this browser (only if you haven't sent them to Claude yet)")) S = draft.state;
      if (draft.base !== ed.version && S !== draft.state) store.set("tagDraft2", null);
    } else {
      const old = store.get("tagDraft", null), op = Array.isArray(old) ? old : old?.places;
      if (op?.length && confirm("You have edits from the old version of this editor. Bring them in?")) {
        const B = new Map(BASE.places.places.map((p) => [p.id, p]));
        S.places.places = op.map((o) => {
          const b = B.get(o.id) || {}, back = (b.photos || []).filter((f) => BHID.has(f) && !o.photos.includes(f));
          return { ...b, ...o, photos: [...o.photos, ...back] };
        });
      }
      store.set("tagDraft", null);
    }
    reindex();
    addUnclaimed();
    reindex();
    rev++;

    initMap();
    const last = store.get("tagCur", null);
    cur = byId(last) ? last : (places().find((p) => !reviewed[p.id]) || places()[0])?.id || null;
    $("#loading").remove();
    showTab(store.get("tagTipsSeen", false) ? "places" : "tips");
    renderChrome();
    requestAnimationFrame(() => { map.invalidateSize(); drawMap(true); });
    save();
  }).catch((e) => { console.error(e); $("#loading").textContent = "Couldn't load the map data. Check the connection and reload."; });
})();
