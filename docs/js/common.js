window.KM = (() => {
  const ICONS = {
    house: ["🏠", "House"], garden: ["🌷", "Garden"], bench: ["🪑", "Sitting area"], cabin: ["🛖", "Cabin"],
    shop: ["🔧", "Shop"], shed: ["🏚️", "Shed"], machine: ["🚜", "Machine shed"], greenhouse: ["🌱", "Greenhouse"],
    well: ["💧", "Well / water"], gate: ["🚪", "Gate"], bridge: ["🌉", "Bridge / crossing"], sign: ["🪧", "Trail sign"],
    pasture: ["🐄", "Pasture / cattle"], horse: ["🐴", "Horses"], field: ["🌾", "Field"], tree: ["🌳", "Tree / bush"],
    wood: ["🪵", "Wood pile"], target: ["🎯", "Target range"], animal: ["🐺", "Wildlife cut-out"],
    fire: ["🔥", "Fire pit"], star: ["⭐", "Special spot"], photo: ["📷", "Photo spot"],
  };
  const icon = (k) => (ICONS[k] || ICONS.photo)[0];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtLen = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m");
  const walkMins = (m) => Math.max(1, Math.round(m / 70));
  const fmtDate = (iso, withTime = true) => {
    if (!iso) return "";
    const opts = { year: "numeric", month: "long", day: "numeric", timeZone: "America/Edmonton" };
    if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
    return new Date(iso).toLocaleString(undefined, opts);
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("km:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("km:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const getJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

  return { ICONS, icon, esc, fmtLen, walkMins, fmtDate, store, getJSON };
})();
