#!/usr/bin/env python3
"""Apply an edits file downloaded from the place editor (tag.html), then rebuild the map.

Usage:  python3 build/apply_edits.py knopp-map-edits-2026-09-24.json            (apply + full build)
        python3 build/apply_edits.py knopp-map-edits-2026-09-24.json --check    (only show what it would change)
        python3 build/apply_edits.py knopp-map-edits-2026-09-24.json --no-build

The file holds the whole of config/places.json, photos.json, hidden.json and tour.json as the editor left them.
Only files that actually differ are written. A file the editor sends as null is left alone.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
PHOTO_DIRS = [ROOT / "photos" / d for d in ("Knopp Map", "Old Knopp House", "CK House")]
NAMES = ("places", "photos", "hidden", "tour")


def load(path):
    return json.loads(path.read_text()) if path.exists() else None


def check(files):
    """Problems worth stopping for, and warnings worth reading."""
    errors, warnings = [], []
    known = {p.name for d in PHOTO_DIRS if d.is_dir() for p in d.iterdir()}
    places = (files.get("places") or {}).get("places", [])
    ids = [p.get("id") for p in places]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        errors.append(f"place ids used twice: {', '.join(sorted(dupes))}")
    seen = {}
    for p in places:
        for f in p.get("photos", []):
            if f in seen:
                errors.append(f"{f} is in both {seen[f]} and {p['id']}")
            seen[f] = p["id"]
            if f not in known:
                warnings.append(f"{p['id']}: {f} is not in photos/ (the build skips it)")
    for s in (files.get("tour") or {}).get("stops", []):
        if s.get("place") not in ids:
            warnings.append(f"tour stop for unknown place {s.get('place')!r} (the build drops it)")
    for f in (files.get("hidden") or {}).get("hidden", []):
        if f not in known:
            warnings.append(f"hidden.json lists {f}, which is not in photos/")
    return errors, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edits")
    ap.add_argument("--check", action="store_true", help="show what would change, write nothing")
    ap.add_argument("--no-build", action="store_true", help="write the config files but don't rebuild")
    args = ap.parse_args()

    edits = json.loads(Path(args.edits).read_text())
    if edits.get("kind") != "knopp-map-edits":
        sys.exit("That isn't an edits file from the place editor.")
    files = {k.removesuffix(".json"): v for k, v in edits.get("files", {}).items()}

    print(f"Edits exported {edits.get('exported', '?')}")
    current = load(ROOT / "docs" / "data" / "editor.json") or {}
    if edits.get("base") and current.get("version") and edits["base"] != current["version"]:
        print("Note: the map was rebuilt after these edits were started. The editor's copy of each file replaces the one in config/;")
        print("      look over the diff (git diff config/) for anything changed elsewhere since then.")
    summary = edits.get("summary") or []
    print(f"\n{len(summary)} change(s) listed by the editor:")
    for line in summary:
        print("  -", line)

    errors, warnings = check(files)
    for w in warnings:
        print("warning:", w)
    if errors:
        for e in errors:
            print("ERROR:", e)
        sys.exit("Nothing written.")

    changed = []
    for name in NAMES:
        new = files.get(name)
        path = CONFIG_DIR / f"{name}.json"
        if new is None or new == load(path):
            continue
        changed.append(path.relative_to(ROOT))
        if not args.check:
            path.write_text(json.dumps(new, indent=2, ensure_ascii=False) + "\n")
    print("\n" + ("Would update: " if args.check else "Updated: ") + (", ".join(map(str, changed)) or "nothing (already applied)"))
    if args.check or args.no_build or not changed:
        return
    print("\nRebuilding…")
    subprocess.run([sys.executable, str(ROOT / "build" / "build.py")], check=True)


if __name__ == "__main__":
    main()
