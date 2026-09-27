window.KM = (() => {
  const ICONS = {
    house: ["🏠", "House"], garden: ["🌷", "Garden"], bench: ["🪑", "Sitting area"], cabin: ["🏡", "Cabin"],
    shop: ["🔧", "Shop"], shed: ["🏚️", "Shed"], machine: ["🚜", "Machine shed"], greenhouse: ["🌱", "Greenhouse"],
    well: ["💧", "Well / water"], gate: ["🚪", "Gate"], bridge: ["🌉", "Bridge / crossing"], sign: ["🪧", "Trail sign"],
    pasture: ["🐄", "Pasture / cattle"], horse: ["🐴", "Horses"], field: ["🌾", "Field"], tree: ["🌳", "Tree / bush"],
    wood: ["🪵", "Wood pile"], target: ["🎯", "Target range"], animal: ["🐺", "Wildlife cut-out"],
    fire: ["🔥", "Fire pit"], star: ["⭐", "Special spot"], photo: ["📷", "Photo spot"],
    road: ["🛣️", "Road / driveway"], hill: ["⛰️", "Hill"], pond: ["🦆", "Pond"],
    homestead: ["🏘️", "Farmyard / homestead"], home: ["🏡", "House with a yard"],
  };
  const icon = (k) => (ICONS[k] || ICONS.photo)[0];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtLen = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m");
  const fmtDate = (iso, withTime = true) => {
    if (!iso) return "";
    const opts = { year: "numeric", month: "long", day: "numeric", timeZone: "America/Edmonton" };
    if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
    return new Date(iso).toLocaleString(undefined, opts);
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("km:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { if (v === null) localStorage.removeItem("km:" + k); else localStorage.setItem("km:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const getJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function decrypt(meta, password) {
    const buf = await fetch("data/bundle.enc?v=" + meta.version).then((r) => { if (!r.ok) throw new Error("bundle " + r.status); return r.arrayBuffer(); });
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.trim().toLowerCase()), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(meta.salt), iterations: meta.iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(meta.iv) }, key, buf);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /** Loads the map data. askPassword(retry) must resolve to {password, remember} when the site is locked.
   *  onMeta(meta) runs as soon as site.json is in, before the (bigger) data bundle. */
  async function loadBundle(askPassword, onMeta) {
    // index.html may already have started both downloads; if those failed, try again here.
    const boot = window.kmBoot || {};
    window.kmBoot = null;
    const reuse = (p) => (p ? p.catch(() => null) : null);
    const meta = (await reuse(boot.meta)) || (await getJSON("data/site.json"));
    onMeta?.(meta);
    if (!meta.locked) return { meta, data: (await reuse(boot.data)) || (await getJSON("data/bundle.json?v=" + meta.version)) };
    let saved = store.get("pw", null);
    for (let attempt = 0; ; attempt++) {
      let pw = saved, remember = true;
      if (!pw) ({ password: pw, remember } = await askPassword(attempt > 0));
      try {
        const data = await decrypt(meta, pw);
        store.set("pw", remember ? pw : null);
        return { meta, data };
      } catch (e) {
        if (e.name !== "OperationError") throw e;
        saved = null;
        store.set("pw", null);
      }
    }
  }

  const photoUrl = (p, size = "web") => `photos/${size}/${encodeURIComponent(p.src || p.file)}.jpg`;

  // Esri tiles. Past the most detailed picture Esri has of a spot it sends a grey "Map data not yet available"
  // square; asked with blankTile=false it sends an error instead, and that tile is filled from the level above,
  // enlarged and trimmed to its own square (up to five levels up). So zooming in anywhere, even past how deep the
  // map expects the imagery to go, or offline past what was saved, shows the sharpest real picture there is.
  const DeepTiles = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = L.TileLayer.prototype.createTile.call(this, coords, done);
      tile._deep = { coords, up: 0 };
      return tile;
    },
    _tileOnError(done, tile, e) {
      const d = tile._deep, { x: x0, y: y0, z: z0 } = d.coords;
      // A tile the map has already let go of (zoomed or panned away) is left alone.
      if (!tile.parentNode || d.up >= 5 || z0 - d.up <= 0) return L.TileLayer.prototype._tileOnError.call(this, done, tile, e);
      if (!d.up) d.w = parseFloat(tile.style.width), d.h = parseFloat(tile.style.height);
      const s = 2 ** ++d.up, size = this.getTileSize(), x = Math.floor(x0 / s), y = Math.floor(y0 / s), z = z0 - d.up;
      const W = size.x * s, H = size.y * s, left = (x0 - x * s) * size.x, top = (y0 - y * s) * size.y;
      const clip = `inset(${top}px ${Math.max(0, W - left - d.w)}px ${Math.max(0, H - top - d.h)}px ${left}px)`;
      Object.assign(tile.style, { width: W + "px", height: H + "px", marginLeft: -left + "px", marginTop: -top + "px", clipPath: clip, webkitClipPath: clip });
      tile.src = L.Util.template(this._url, L.extend({ r: "", s: this._getSubdomain({ x, y }), x, y, z }, this.options));
    },
  });
  const esriTiles = (url, opts) => new DeepTiles(url + "?blankTile=false", opts);

  return { ICONS, icon, esc, fmtLen, fmtDate, store, getJSON, loadBundle, photoUrl, esriTiles };
})();
