#!/usr/bin/env python3
"""Build the KnoppMap site data: GPX tracks -> cleaned GeoJSON, photos -> GeoJSON + web images.

Usage:  python3 build/build.py            (full build)
        python3 build/build.py --tracks   (tracks only, skips photo resizing)
"""
import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GPX_FILE = ROOT / "knopp-map.gpx"
PHOTO_DIR = ROOT / "photos" / "Knopp Map"
CONFIG_DIR = ROOT / "config"
SITE = ROOT / "docs"
DATA_OUT = SITE / "data"
WEB_OUT = SITE / "photos" / "web"
THUMB_OUT = SITE / "photos" / "thumb"
REPORT = ROOT / "build" / "report.md"

NS = {"g": "http://www.topografix.com/GPX/1/1"}
PRECISION = 6
SIMPLIFY_M = 2.0          # Douglas-Peucker tolerance
SNAP_M = 20.0             # max distance an end may be moved to meet another track
TAIL_M = 30.0             # how far back from an end we look for a better junction (trims overshoot)
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


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def load_json(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


# ---------------------------------------------------------------- tracks

def parse_gpx():
    root = ET.parse(GPX_FILE).getroot()
    tracks, waypoints = [], []
    for w in root.findall("g:wpt", NS):
        name = (w.findtext("g:name", "", NS) or "").strip()
        waypoints.append({"name": re.sub(r"\s+\d{4}-\d{2}-\d{2}.*$", "", name),
                          "coord": (float(w.get("lon")), float(w.get("lat")))})
    for t in root.findall("g:trk", NS):
        name = (t.findtext("g:name", "", NS) or "").strip()
        segs, times = [], []
        for s in t.findall("g:trkseg", NS):
            pts = []
            for p in s.findall("g:trkpt", NS):
                pts.append((float(p.get("lon")), float(p.get("lat"))))
                tm = p.findtext("g:time", None, NS)
                if tm:
                    times.append(tm)
            if len(pts) >= 2:
                segs.append(pts)
        if segs:
            tracks.append({"raw_name": name, "segs": segs,
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


def snap_end(line, others, at_start):
    """Find the best junction near one end: trims overshoot and extends undershoot."""
    seq = line if at_start else line[::-1]
    walked, best = 0.0, None
    for i, p in enumerate(seq):
        if i > 0:
            walked += dist(seq[i - 1], p)
        if walked > TAIL_M or i > len(seq) * 0.4:
            break
        for oname, oline in others:
            q, d = nearest_on_line(p, oline)
            # Penalise walking back so a recorded end is only trimmed for a clearly better junction.
            score = d + 0.3 * walked
            if d <= SNAP_M and (best is None or score < best[4]):
                best = (i, q, d, oname, score)
    if best is None:
        return line, None
    i, q, d, oname, _ = best
    kept = seq[i:]
    trimmed = line_length(seq[: i + 1]) if i else 0.0
    new = [q] + kept if d > 0.5 else [q] + kept[1:]
    if not at_start:
        new = new[::-1]
    return new, {"with": oname, "moved": d, "trimmed": trimmed}


def build_tracks():
    tracks, waypoints = parse_gpx()
    cfg = track_config(tracks)
    log_join, log_snap, log_loop = [], [], []

    for t in tracks:
        c = cfg["tracks"][t["raw_name"]]
        t.update(name=c["name"], category=c.get("category", "trails"), color=c.get("color", "#ffd400"),
                 loop=c.get("loop", False), snap=c.get("snap", True))
        t["parts"] = join_segments(t["segs"], t["loop"], log_join, t["name"])

    # Snap ends of non-loop tracks onto neighbouring tracks (using the raw geometry of the others).
    raw_lines = [(t["name"], part) for t in tracks for part in t["parts"]]
    for t in tracks:
        if t["loop"] or not t["snap"]:
            continue
        new_parts = []
        for part in t["parts"]:
            others = [(n, l) for n, l in raw_lines if l is not part]
            for at_start in (True, False):
                part, info = snap_end(part, others, at_start)
                if info:
                    log_snap.append(f"| {t['name']} | {'start' if at_start else 'end'} | {info['with']} "
                                    f"| {info['moved']:.1f} | {info['trimmed']:.1f} |")
            new_parts.append(part)
        t["parts"] = new_parts

    for t in tracks:
        if t["loop"]:
            part = t["parts"][0]
            gap = dist(part[0], part[-1])
            if gap <= CLOSE_LOOP_M:
                part.append(part[0])
                log_loop.append(f"- **{t['name']}**: closed loop (gap {gap:.1f} m)")
            else:
                log_loop.append(f"- **{t['name']}**: NOT closed, start/end are {gap:.0f} m apart")

    features, raw_pts, out_pts = [], 0, 0
    for t in tracks:
        parts = []
        for part in t["parts"]:
            raw_pts += len(part)
            s = simplify(part, SIMPLIFY_M)
            out_pts += len(s)
            parts.append([[round(x, PRECISION), round(y, PRECISION)] for x, y in s])
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
            },
            "geometry": geom,
        })
    for w in waypoints:
        features.append({"type": "Feature", "id": slug(w["name"]),
                         "properties": {"name": w["name"], "category": "waypoint"},
                         "geometry": {"type": "Point", "coordinates": [round(c, PRECISION) for c in w["coord"]]}})

    out = {"type": "FeatureCollection", "categories": cfg["categories"], "features": features}
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    (DATA_OUT / "tracks.geojson").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))

    report = [f"## Tracks\n", f"{len(tracks)} tracks, {len(waypoints)} waypoint(s). "
              f"Points: {raw_pts} raw -> {out_pts} after {SIMPLIFY_M:g} m simplification.\n",
              "### Loops\n", *log_loop, "", "### Joined recording segments\n", *(log_join or ["- none"]), "",
              f"### End snapping (within {SNAP_M:g} m, looking back {TAIL_M:g} m for overshoot)\n",
              "| Track | End | Joined to | Moved (m) | Trimmed (m) |", "|---|---|---|---|---|", *log_snap, ""]
    return features, report


# ---------------------------------------------------------------- photos

def dms_to_deg(v, ref):
    d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    return -d if ref in ("S", "W") else d


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
    feats, missing, report = [], [], []
    files = sorted(p for p in PHOTO_DIR.iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
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
            if resize and not (WEB_OUT / f"{stem}.jpg").exists():
                img = ImageOps.exif_transpose(im).convert("RGB")
                web = img.copy()
                web.thumbnail((WEB_PX, WEB_PX), Image.LANCZOS)
                web.save(WEB_OUT / f"{stem}.jpg", "JPEG", quality=WEB_Q, optimize=True, progressive=True)
                img.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
                img.save(THUMB_OUT / f"{stem}.jpg", "JPEG", quality=THUMB_Q, optimize=True)
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
                "file": stem, "taken": iso, "title": cap.get("title"), "caption": cap.get("caption"),
                "near": near if near_d <= NEAR_TRACK_M else None,
            },
            "geometry": {"type": "Point", "coordinates": [round(lon, PRECISION), round(lat, PRECISION)]},
        })
        if n % 25 == 0:
            print(f"  photos {n}/{len(files)}", file=sys.stderr)

    (DATA_OUT / "photos.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, separators=(",", ":"), ensure_ascii=False))
    report += ["## Photos\n", f"{len(files)} photos found, {len(feats)} placed on the map.\n",
               "### Missing GPS\n", *([f"- {m}" for m in missing] or ["- none"]), ""]
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", action="store_true", help="tracks only")
    ap.add_argument("--no-resize", action="store_true", help="skip image resizing")
    args = ap.parse_args()
    feats, report = build_tracks()
    if not args.tracks:
        report += build_photos(feats, resize=not args.no_resize)
    REPORT.write_text("# Build report\n\n" + "\n".join(report) + "\n")
    print(f"Done. See {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
