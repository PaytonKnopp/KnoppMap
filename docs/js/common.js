window.KM = (() => {
  const ICONS = {
    house: ["🏠", "House"], garden: ["🌷", "Garden"], bench: ["🪑", "Sitting area"], cabin: ["🏡", "Cabin"],
    shop: ["🔧", "Shop"], shed: ["🏚️", "Shed"], machine: ["🚜", "Machine shed"], greenhouse: ["🌱", "Greenhouse"],
    well: ["💧", "Well / water"], gate: ["🚪", "Gate"], bridge: ["🌉", "Bridge / crossing"], sign: ["🪧", "Trail sign"],
    pasture: ["🐄", "Pasture / cattle"], horse: ["🐴", "Horses"], field: ["🌾", "Field"], tree: ["🌳", "Tree / bush"],
    wood: ["🪵", "Wood pile"], target: ["🎯", "Target range"], animal: ["🐺", "Wildlife cut-out"],
    fire: ["🔥", "Fire pit"], star: ["⭐", "Special spot"], photo: ["📷", "Photo spot"],
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

  /** Loads the map data. askPassword(retry) must resolve to {password, remember} when the site is locked. */
  async function loadBundle(askPassword) {
    const meta = await getJSON("data/site.json");
    if (!meta.locked) return { meta, data: await getJSON("data/bundle.json?v=" + meta.version) };
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

  return { ICONS, icon, esc, fmtLen, fmtDate, store, getJSON, loadBundle, photoUrl };
})();
