#!/usr/bin/env python3
"""Build the KnoppMap site data: GPX tracks -> cleaned GeoJSON, photos -> GeoJSON + web images.

Usage:  python3 build/build.py            (full build)
        python3 build/build.py --tracks   (tracks only, skips photo resizing)
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import math
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GPX_FILE = ROOT / "knopp-map.gpx"
# Other recordings (e.g. ck-loop.gpx for the Home Loop at CK House) sit next to the main file and are read with it.
GPX_FILES = [GPX_FILE] + sorted(p for p in ROOT.glob("*.gpx") if p != GPX_FILE)
# The quarter's photos, then the two family houses (each shown as one pin holding all of its photos).
PHOTO_DIRS = [ROOT / "photos" / d for d in ("Knopp Map", "Old Knopp House", "CK House")]
CONFIG_DIR = ROOT / "config"
SITE = ROOT / "docs"
DATA_OUT = SITE / "data"
WEB_OUT = SITE / "photos" / "web"
THUMB_OUT = SITE / "photos" / "thumb"
REPORT = ROOT / "build" / "report.md"

NS = {"g": "http://www.topografix.com/GPX/1/1"}
PRECISION = 6
SIMPLIFY_M = 2.0          # Douglas-Peucker tolerance
SNAP_M = 25.0             # max distance an end may be extended to meet another track
TAIL_M = 25.0             # longest stub past a crossing that gets trimmed off
CLOSE_LOOP_M = 60.0       # boundary loops closed when start/end are within this
JOIN_SEG_M = 50.0         # paused-recording segments joined when the gap is under this
WEB_PX, WEB_Q = 1600, 80
THUMB_PX, THUMB_Q = 360, 72
NEAR_TRACK_M = 25.0

LAT0 = 52.2
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0


def to_xy(p):
    return (p[0] * KX, p[1] * KY)


def dist(a, b):
    ax, ay = to_xy(a)
    bx, by = to_xy(b)
    return math.hypot(ax - bx, ay - by)


def project_on_segment(p, a, b):
    """Closest point to p on segment a-b, returned as (lon, lat), distance in metres."""
    px, py = to_xy(p)
    ax, ay = to_xy(a)
    bx, by = to_xy(b)
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + t * dx, ay + t * dy
    return (qx / KX, qy / KY), math.hypot(px - qx, py - qy)


def nearest_on_line(p, line):
    best = (None, float("inf"))
    for a, b in zip(line, line[1:]):
        q, d = project_on_segment(p, a, b)
        if d < best[1]:
            best = (q, d)
    return best


def line_length(line):
    return sum(dist(a, b) for a, b in zip(line, line[1:]))


def simplify(line, tol):
    if len(line) < 3:
        return line
    keep = [False] * len(line)
    keep[0] = keep[-1] = True
    stack = [(0, len(line) - 1)]
    while stack:
        i, j = stack.pop()
        best_d, best_k = 0.0, -1
        for k in range(i + 1, j):
            _, d = project_on_segment(line[k], line[i], line[j])
            if d > best_d:
                best_d, best_k = d, k
        if best_d > tol:
            keep[best_k] = True
            stack += [(i, best_k), (best_k, j)]
    return [p for p, k in zip(line, keep) if k]


BUNDLE = {}
HIDDEN_SRCS = set()
SITE_CFG = {}
FARM_BOUNDS = []


def write_data(key, obj):
    BUNDLE[key] = obj


def photo_name(stem):
    """With a password set, photo files get unguessable names so they can't be found without unlocking."""
    pw = SITE_CFG.get("password")
    if not pw:
        return stem
    return hmac.new(pw.encode(), stem.encode(), hashlib.sha256).hexdigest()[:20]


def write_bundle():
    raw = json.dumps(BUNDLE, separators=(",", ":"), ensure_ascii=False).encode()
    pw = SITE_CFG.get("password")
    for old in ("bundle.json", "bundle.enc", "tracks.geojson", "photos.geojson", "places.geojson"):
        (DATA_OUT / old).unlink(missing_ok=True)
    if not pw:
        (DATA_OUT / "bundle.json").write_bytes(raw)
        meta = {"locked": False}
        if FARM_BOUNDS:
            # Lets the map open on the farm (and start loading imagery) before the data bundle arrives.
            # Left out when locked so the location stays behind the password.
            meta["bounds"] = FARM_BOUNDS
    else:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        salt, iv, iters = os.urandom(16), os.urandom(12), 250_000
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iters).derive(pw.strip().lower().encode())
        (DATA_OUT / "bundle.enc").write_bytes(AESGCM(key).encrypt(iv, raw, None))
        meta = {"locked": True, "salt": base64.b64encode(salt).decode(), "iv": base64.b64encode(iv).decode(), "iter": iters}
    meta["title"] = SITE_CFG.get("title", "Knopp Map")
    meta["keys"] = {k: v for k, v in (SITE_CFG.get("keys") or {}).items() if v}
    meta["version"] = hashlib.sha256(raw).hexdigest()[:12]
    (DATA_OUT / "site.json").write_text(json.dumps(meta) + "\n")


def build_tour(place_feats):
    cfg = load_json(CONFIG_DIR / "tour.json", None)
    ids = {f["id"] for f in place_feats}
    if cfg:
        stops = [s for s in cfg.get("stops", []) if s.get("place") in ids]
    else:
        # Default: every named place, walking from the house to whatever is closest next.
        todo = [f for f in place_feats if f["properties"]["featured"]]
        start = next((f for f in todo if f["properties"]["icon"] == "house"), todo[0] if todo else None)
        stops, cur = [], start
        while cur:
            stops.append({"place": cur["id"]})
            todo.remove(cur)
            c = cur["geometry"]["coordinates"]
            cur = min(todo, key=lambda f: dist(c, f["geometry"]["coordinates"]), default=None)
    write_data("tour", {"title": (cfg or {}).get("title", "Tour of the farm"), "stops": stops})
    return [f"## Tour\n", f"{len(stops)} stops ({'config/tour.json' if cfg else 'automatic order'}).\n"]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


# ---------------------------------------------------------------- tracks

def parse_gpx():
    tracks, waypoints = [], []
    for path in GPX_FILES:
        t, w = parse_gpx_file(path)
        tracks += t
        waypoints += w
    return tracks, waypoints


def parse_gpx_file(path):
    root = ET.parse(path).getroot()
    tracks, waypoints = [], []
    for w in root.findall("g:wpt", NS):
        name = (w.findtext("g:name", "", NS) or "").strip()
        waypoints.append({"name": re.sub(r"\s+\d{4}-\d{2}-\d{2}.*$", "", name),
                          "coord": (float(w.get("lon")), float(w.get("lat")))})
    for t in root.findall("g:trk", NS):
        name = (t.findtext("g:name", "", NS) or "").strip()
        segs, times, prof = [], [], []
        for s in t.findall("g:trkseg", NS):
            pts = []
            for p in s.findall("g:trkpt", NS):
                pts.append((float(p.get("lon")), float(p.get("lat"))))
                ele = p.findtext("g:ele", None, NS)
                if ele is not None:
                    prof.append((pts[-1], float(ele)))
                tm = p.findtext("g:time", None, NS)
                if tm:
                    times.append(tm)
            if len(pts) >= 2:
                segs.append(pts)
        if segs:
            tracks.append({"raw_name": name, "segs": segs, "prof": prof,
                           "start": min(times) if times else None})
    return tracks, waypoints


def track_config(tracks):
    """config/tracks.json holds display name, category and colour per track; new tracks get defaults."""
    path = CONFIG_DIR / "tracks.json"
    cfg = load_json(path, {"categories": {}, "tracks": {}})
    palette = ["#ffd400", "#00e5ff", "#ff4fd8", "#7cff4f", "#ff8c1a", "#b388ff",
               "#4fc3ff", "#ff5252", "#c6ff00", "#ffab91", "#64ffda", "#f48fb1"]
    changed = False
    for i, t in enumerate(tracks):
        if t["raw_name"] not in cfg["tracks"]:
            cfg["tracks"][t["raw_name"]] = {"name": t["raw_name"].strip(), "category": "trails",
                                            "color": palette[i % len(palette)]}
            changed = True
    if changed:
        CONFIG_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    return cfg


def join_segments(segs, is_loop, log, name):
    out = [list(segs[0])]
    for s in segs[1:]:
        gap = dist(out[-1][-1], s[0])
        if is_loop or gap <= JOIN_SEG_M:
            out[-1].extend(s)
            log.append(f"- **{name}**: joined paused segment (gap {gap:.0f} m)")
        else:
            out.append(list(s))
            log.append(f"- **{name}**: kept separate segment (gap {gap:.0f} m, over {JOIN_SEG_M:.0f} m)")
    return out


def seg_intersect(p1, p2, q1, q2):
    """Intersection of segments p1-p2 and q1-q2 as (point, t along p), or None."""
    (x1, y1), (x2, y2) = to_xy(p1), to_xy(p2)
    (x3, y3), (x4, y4) = to_xy(q1), to_xy(q2)
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(den) < 1e-9:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return ((x1 + t * (x2 - x1)) / KX, (y1 + t * (y2 - y1)) / KY), t
    return None


def insert_vertex(line, q):
    """Put q into line as a vertex (or reuse a vertex within 0.3 m) so both tracks share the exact point."""
    best_i, best_d = 0, float("inf")
    for i, (a, b) in enumerate(zip(line, line[1:])):
        _, d = project_on_segment(q, a, b)
        if d < best_d:
            best_i, best_d = i, d
    for v in (line[best_i], line[best_i + 1]):
        if dist(v, q) < 0.3:
            return v
    line.insert(best_i + 1, q)
    return q


def connect_end(line, others, at_start):
    """Make one end of a track meet its neighbour: trim a stub that runs past a crossing, or extend a short end."""
    if len(line) < 2:
        return None
    seq = line if at_start else line[::-1]
    length = line_length(seq)
    end = seq[0]
    best = None
    for oname, ol in others:
        q, d = nearest_on_line(end, ol)
        if best is None or d < best[1]:
            best = (q, d, oname, ol)
    if best and best[1] < 1.0:
        # Already touching: lock the end onto the neighbour exactly.
        q = insert_vertex(best[3], best[0])
        if seq[0] == q:
            return None
        seq[0] = q
        line[:] = seq if at_start else seq[::-1]
        return {"with": best[2], "how": "joined", "moved": best[1], "trimmed": 0.0}
    # 1. Overshoot: the end crosses another track and keeps going a little way.
    walked, cut = 0.0, None
    for i in range(len(seq) - 1):
        a, b = seq[i], seq[i + 1]
        seg = dist(a, b)
        hits = []
        for oname, ol in others:
            for q1, q2 in zip(ol, ol[1:]):
                r = seg_intersect(a, b, q1, q2)
                if r:
                    hits.append((r[1], r[0], oname, ol))
        hits = [h for h in hits if walked + h[0] * seg > 0.3]
        if hits:
            tt, q, oname, ol = min(hits, key=lambda h: h[0])
            stub = walked + tt * seg
            if stub <= TAIL_M and stub < length * 0.4:
                cut = (i, q, oname, ol, stub)
            break
        walked += seg
        if walked > TAIL_M:
            break
    if cut:
        i, q, oname, ol, stub = cut
        q = insert_vertex(ol, q)
        new = [q] + seq[i + 1:]
        line[:] = new if at_start else new[::-1]
        return {"with": oname, "how": "trimmed at crossing", "moved": 0.0, "trimmed": stub}
    # 2. Undershoot: the end stops just short of a neighbour.
    if best and best[1] <= SNAP_M:
        q, d, oname, ol = best
        q = insert_vertex(ol, q)
        new = [q] + seq
        line[:] = new if at_start else new[::-1]
        return {"with": oname, "how": "extended", "moved": d, "trimmed": 0.0}
    return None


def profile(prof, n=60):
    """Smoothed elevation profile [[distance m, elevation m], ...] plus total climb and descent."""
    if len(prof) < 3:
        return None, 0, 0
    d, dist_along = 0.0, [0.0]
    for (a, _), (b, _) in zip(prof, prof[1:]):
        d += dist(a, b)
        dist_along.append(d)
    raw = [e for _, e in prof]
    k = 3
    smooth = [sum(raw[max(0, i - k):i + k + 1]) / len(raw[max(0, i - k):i + k + 1]) for i in range(len(raw))]
    gain = loss = 0.0
    ref = smooth[0]
    for e in smooth[1:]:
        if e - ref >= 1.0:
            gain += e - ref
            ref = e
        elif ref - e >= 1.0:
            loss += ref - e
            ref = e
    step = max(1, len(smooth) // n)
    idx = list(range(0, len(smooth), step))
    if idx[-1] != len(smooth) - 1:
        idx.append(len(smooth) - 1)
    return [[round(dist_along[i]), round(smooth[i], 1)] for i in idx], round(gain), round(loss)


def connections(features, tol=8.0):
    """Tracks whose ends touch (or cross near) another track are listed as connected."""
    lines = {}
    for f in features:
        g = f["geometry"]
        lines[f["id"]] = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
    for f in features:
        own = lines[f["id"]]
        ends = [p for part in own for p in (part[0], part[-1])]
        near = set()
        for oid, other in lines.items():
            if oid == f["id"]:
                continue
            o_ends = [p for part in other for p in (part[0], part[-1])]
            if any(nearest_on_line(p, part)[1] <= tol for p in ends for part in other) or \
               any(nearest_on_line(p, part)[1] <= tol for p in o_ends for part in own):
                near.add(oid)
        f["properties"]["connects"] = sorted(near)


def farm_bounds(features):
    """[[south, west], [north, east]] of the quarter section outline (or of everything), as the app computes it."""
    feats = [f for f in features if f["id"] == "quarter-section-perimeter"] or features
    pts = []
    for f in feats:
        g = f["geometry"]
        if g["type"] == "Point":
            pts.append(g["coordinates"])
        elif g["type"] == "LineString":
            pts += g["coordinates"]
        else:
            pts += [p for part in g["coordinates"] for p in part]
    if not pts:
        return []
    return [[min(p[1] for p in pts), min(p[0] for p in pts)], [max(p[1] for p in pts), max(p[0] for p in pts)]]


def build_tracks():
    tracks, waypoints = parse_gpx()
    cfg = track_config(tracks)
    log_join, log_snap, log_loop = [], [], []

    for t in tracks:
        c = cfg["tracks"][t["raw_name"]]
        t.update(name=c["name"], category=c.get("category", "trails"), color=c.get("color", "#ffd400"),
                 loop=c.get("loop", False), snap=c.get("snap", True), site=c.get("site"))
        t["parts"] = join_segments(t["segs"], t["loop"], log_join, t["name"])
        ext = c.get("extend") or {}
        if ext.get("start"):
            t["parts"][0].insert(0, tuple(ext["start"]))
        if ext.get("end"):
            t["parts"][-1].append(tuple(ext["end"]))
        # "end_on": the last point moves onto the given spot, e.g. so a loop finishes on its own driveway instead of crossing it.
        if c.get("end_on"):
            part, q = t["parts"][-1], tuple(c["end_on"])
            tail = range(int(len(part) * 0.7), len(part))
            i = min(tail, key=lambda k: dist(part[k], q))
            part[i:] = [q]
        t["directions"] = c.get("directions")

    for t in tracks:
        if t["loop"]:
            part = t["parts"][0]
            gap = dist(part[0], part[-1])
            if gap <= CLOSE_LOOP_M:
                part.append(part[0])
                log_loop.append(f"- **{t['name']}**: closed loop (gap {gap:.1f} m)")
            else:
                log_loop.append(f"- **{t['name']}**: NOT closed, start/end are {gap:.0f} m apart")

    raw_pts = sum(len(p) for t in tracks for p in t["parts"])
    # Simplify first so the junction points added below are never moved afterwards.
    for t in tracks:
        t["parts"] = [simplify(p, SIMPLIFY_M) for p in t["parts"]]
    for _ in range(2):
        for t in tracks:
            if t["loop"] or not t["snap"]:
                continue
            for part in t["parts"]:
                others = [(o["name"], op) for o in tracks for op in o["parts"] if op is not part]
                for at_start in (True, False):
                    info = connect_end(part, others, at_start)
                    if info:
                        log_snap.append(f"| {t['name']} | {'start' if at_start else 'end'} | {info['with']} "
                                        f"| {info['how']} | {info['moved']:.1f} | {info['trimmed']:.1f} |")

    features, out_pts = [], 0
    for t in tracks:
        parts = []
        for part in t["parts"]:
            out_pts += len(part)
            parts.append([[round(x, PRECISION), round(y, PRECISION)] for x, y in part])
        closed = t["loop"] and parts[0][0] == parts[0][-1]
        if closed:
            geom = {"type": "Polygon", "coordinates": parts[:1]}
        elif len(parts) == 1:
            geom = {"type": "LineString", "coordinates": parts[0]}
        else:
            geom = {"type": "MultiLineString", "coordinates": parts}
        features.append({
            "type": "Feature",
            "id": slug(t["name"]),
            "properties": {
                "name": t["name"], "category": t["category"], "color": t["color"],
                "length_m": round(sum(line_length(p) for p in parts)),
                "recorded": t["start"],
                **({"directions": t["directions"]} if t.get("directions") else {}),
                **({"site": t["site"]} if t.get("site") else {}),
                **dict(zip(("profile", "gain_m", "loss_m"), profile(t["prof"]))),
            },
            "geometry": geom,
        })
    connections(features)
    for w in waypoints:
        features.append({"type": "Feature", "id": slug(w["name"]),
                         "properties": {"name": w["name"], "category": "waypoint"},
                         "geometry": {"type": "Point", "coordinates": [round(c, PRECISION) for c in w["coord"]]}})

    out = {"type": "FeatureCollection", "categories": cfg["categories"], "features": features}
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    write_data("tracks", out)
    FARM_BOUNDS[:] = farm_bounds(features)

    report = [f"## Tracks\n", f"{len(tracks)} tracks, {len(waypoints)} waypoint(s). "
              f"Points: {raw_pts} raw -> {out_pts} after {SIMPLIFY_M:g} m simplification.\n",
              "### Loops\n", *log_loop, "", "### Joined recording segments\n", *(log_join or ["- none"]), "",
              f"### End snapping (within {SNAP_M:g} m, looking back {TAIL_M:g} m for overshoot)\n",
              "| Track | End | Joined to | How | Moved (m) | Trimmed (m) |", "|---|---|---|---|---|---|", *log_snap, ""]
    return features, report


# ---------------------------------------------------------------- photos

def dms_to_deg(v, ref):
    d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    return -d if ref in ("S", "W") else d


def gpx_timeline():
    """All recorded track points with timestamps, sorted, for checking where you were when a photo was taken."""
    pts = []
    for path in GPX_FILES:
        for p in ET.parse(path).getroot().iter("{http://www.topografix.com/GPX/1/1}trkpt"):
            t = p.findtext("g:time", None, NS)
            if t:
                pts.append((datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp(), float(p.get("lon")), float(p.get("lat"))))
    pts.sort()
    return pts


FIX_GAP_S = 60      # only trust the track when it has points on both sides of the photo this close together
FIX_OFF_M = 25      # and the camera's location disagrees with it by more than this


def track_position(timeline, times, t):
    import bisect
    i = bisect.bisect_left(times, t)
    if i == 0 or i >= len(timeline):
        return None
    a, b = timeline[i - 1], timeline[i]
    if b[0] - a[0] > FIX_GAP_S or t - a[0] > FIX_GAP_S or b[0] - t > FIX_GAP_S:
        return None
    k = 0 if b[0] == a[0] else (t - a[0]) / (b[0] - a[0])
    return (a[1] + k * (b[1] - a[1]), a[2] + k * (b[2] - a[2]))


def build_photos(track_features, resize=True):
    from PIL import Image, ImageOps

    captions = load_json(CONFIG_DIR / "photos.json", {})
    lines = []
    for f in track_features:
        g = f["geometry"]
        if g["type"] == "LineString":
            lines.append((f["properties"]["name"], g["coordinates"]))
        elif g["type"] in ("MultiLineString", "Polygon"):
            lines += [(f["properties"]["name"], c) for c in g["coordinates"]]

    WEB_OUT.mkdir(parents=True, exist_ok=True)
    THUMB_OUT.mkdir(parents=True, exist_ok=True)
    feats, missing, report, fixes = [], [], [], []
    timeline = gpx_timeline()
    times = [p[0] for p in timeline]
    hidden = set(load_json(CONFIG_DIR / "hidden.json", {}).get("hidden", []))
    all_files = sorted((p for d in PHOTO_DIRS if d.is_dir() for p in d.iterdir() if p.suffix.lower() in (".jpg", ".jpeg")),
                       key=lambda p: p.name)
    files = [p for p in all_files if p.name not in hidden]
    HIDDEN_SRCS.update(photo_name(p.stem) + ".jpg" for p in all_files if p.name in hidden)
    for n, src in enumerate(files, 1):
        with Image.open(src) as im:
            ex = im.getexif()
            gps = ex.get_ifd(0x8825)
            sub = ex.get_ifd(0x8769)
            taken = sub.get(36867) or ex.get(306)
            offset = sub.get(36881) or sub.get(36880)
            if not gps or 2 not in gps or 4 not in gps:
                missing.append(src.name)
                continue
            lat = dms_to_deg(gps[2], gps.get(1, "N"))
            lon = dms_to_deg(gps[4], gps.get(3, "E"))
            iso = None
            if taken:
                dt = datetime.strptime(taken, "%Y:%m:%d %H:%M:%S")
                if offset:
                    sign = -1 if offset.startswith("-") else 1
                    h, m = offset.lstrip("+-").split(":")
                    dt = dt.replace(tzinfo=timezone(sign * timedelta(hours=int(h), minutes=int(m))))
                iso = dt.isoformat()
            stem = src.stem
            out = photo_name(stem)
            if resize and not (WEB_OUT / f"{out}.jpg").exists():
                img = ImageOps.exif_transpose(im).convert("RGB")
                web = img.copy()
                web.thumbnail((WEB_PX, WEB_PX), Image.LANCZOS)
                web.save(WEB_OUT / f"{out}.jpg", "JPEG", quality=WEB_Q, optimize=True, progressive=True)
                img.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
                img.save(THUMB_OUT / f"{out}.jpg", "JPEG", quality=THUMB_Q, optimize=True)
        fixed = False
        if iso:
            tp = track_position(timeline, times, datetime.fromisoformat(iso).timestamp())
            if tp and dist((lon, lat), tp) > FIX_OFF_M:
                fixes.append(f"- {src.name}: moved {dist((lon, lat), tp):.0f} m to the GPS track position at that time")
                lon, lat = tp
                fixed = True
        near, near_d = None, float("inf")
        for name, line in lines:
            _, d = nearest_on_line((lon, lat), line)
            if d < near_d:
                near, near_d = name, d
        cap = captions.get(src.name, {})
        feats.append({
            "type": "Feature",
            "id": stem,
            "properties": {
                "file": stem, "src": out, "taken": iso, "title": cap.get("title"), "caption": cap.get("caption"),
                "near": near if near_d <= NEAR_TRACK_M else None, "corrected": fixed,
            },
            "geometry": {"type": "Point", "coordinates": [round(lon, PRECISION), round(lat, PRECISION)]},
        })
        if n % 25 == 0:
            print(f"  photos {n}/{len(files)}", file=sys.stderr)

    report += ["## Photos\n", f"{len(all_files)} photos found, {len(hidden & {p.name for p in all_files})} hidden as near-duplicates "
               f"(config/hidden.json), {len(feats)} placed on the map.\n",
               "### Missing GPS\n", *([f"- {m}" for m in missing] or ["- none"]), "",
               f"### Locations corrected from the GPS track (camera was over {FIX_OFF_M} m off)\n", *(fixes or ["- none"]), ""]
    return feats, report


# ---------------------------------------------------------------- places

PLACE_R = 20.0


def auto_places(photo_feats):
    """Group photos walk-order style: a new spot starts once you've moved more than PLACE_R from the current one."""
    groups = []
    for f in sorted(photo_feats, key=lambda f: f["properties"]["taken"] or ""):
        c = f["geometry"]["coordinates"]
        best = None
        for g in groups:
            d = dist(c, g["c"])
            if d < PLACE_R and (best is None or d < best[0]):
                best = (d, g)
        if best:
            g = best[1]
            g["m"].append(f)
            n = len(g["m"])
            g["c"] = [sum(x["geometry"]["coordinates"][i] for x in g["m"]) / n for i in (0, 1)]
        else:
            groups.append({"c": list(c), "m": [f]})
    places = []
    for i, g in enumerate(sorted(groups, key=lambda g: -len(g["m"])), 1):
        files = [m["properties"]["file"] + ".jpg" for m in g["m"]]
        places.append({"id": f"spot-{i:02d}", "name": "", "icon": "photo", "story": "",
                       "hero": files[0], "photos": files})
    return places


def build_places(photo_feats):
    """config/places.json is the hand-edited source of truth; it is only seeded automatically the first time."""
    path = CONFIG_DIR / "places.json"
    cfg = load_json(path, None)
    if cfg is None:
        cfg = {"places": auto_places(photo_feats)}
        path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    by_file = {f["properties"]["file"] + ".jpg": f for f in photo_feats}
    listed = {x for p in cfg["places"] for x in p.get("photos", [])}
    new_photos = [f for name, f in by_file.items() if name not in listed]
    extra = auto_places(new_photos)
    for i, p in enumerate(extra, 1):
        p["id"] = f"new-{i:02d}"
    claimed, feats, report = set(), [], []
    for p in cfg["places"] + extra:
        members = [by_file[x] for x in p.get("photos", []) if x in by_file]
        claimed.update(p.get("photos", []))
        if p.get("coords"):
            lon, lat = p["coords"]
        elif members:
            lon = sum(m["geometry"]["coordinates"][0] for m in members) / len(members)
            lat = sum(m["geometry"]["coordinates"][1] for m in members) / len(members)
        else:
            continue
        for m in members:
            m["properties"]["place"] = p["id"]
            if p.get("gather"):
                # A house shown as one pin: every photo sits on the pin instead of where it was taken.
                m["properties"]["gathered"] = True
                m["geometry"]["coordinates"] = [round(lon, PRECISION), round(lat, PRECISION)]
        hero = p.get("hero") if p.get("hero") in by_file else (members[0]["properties"]["file"] + ".jpg" if members else None)
        feats.append({"type": "Feature", "id": p["id"], "properties": {
            "name": p.get("name", ""), "icon": p.get("icon", "photo"), "story": p.get("story", ""),
            "hero": hero[:-4] if hero else None, "photos": [m["properties"]["file"] for m in members],
            "featured": bool(p.get("featured", bool(p.get("name")))), "guess": bool(p.get("guess")),
            "moved": bool(p.get("coords")),
            **({"site": True} if p.get("site") else {}), **({"gather": True} if p.get("gather") else {}),
        }, "geometry": {"type": "Point", "coordinates": [round(lon, PRECISION), round(lat, PRECISION)]}})
    loose = [f for f in by_file if f not in claimed]
    write_data("places", {"type": "FeatureCollection", "features": feats})
    report += build_tour(feats)
    named = sum(1 for f in feats if f["properties"]["name"])
    report += ["## Places\n", f"{len(feats)} places ({named} named). {len(loose)} photos not in any place. "
               f"{len(new_photos)} new photos grouped into {len(extra)} unnamed spots (name them in the tagger).\n"]
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", action="store_true", help="tracks only")
    ap.add_argument("--no-resize", action="store_true", help="skip image resizing")
    args = ap.parse_args()
    SITE_CFG.update(load_json(CONFIG_DIR / "site.json", {}))
    feats, report = build_tracks()
    if args.tracks:
        old = DATA_OUT / "bundle.json"
        if not old.exists():
            sys.exit("--tracks needs an existing unlocked bundle; run a full build first")
        BUNDLE.update({k: v for k, v in json.loads(old.read_text()).items() if k != "tracks"})
    else:
        photo_feats, r = build_photos(feats, resize=not args.no_resize)
        report += r + build_places(photo_feats)
        write_data("photos", {"type": "FeatureCollection", "features": photo_feats})
        keep = {f["properties"]["src"] + ".jpg" for f in photo_feats} | HIDDEN_SRCS
        for d in (WEB_OUT, THUMB_OUT):
            for f in d.glob("*.jpg"):
                if f.name not in keep:
                    f.unlink()
    write_bundle()
    REPORT.write_text("# Build report\n\n" + "\n".join(report) + "\n")
    print(f"Done. See {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
