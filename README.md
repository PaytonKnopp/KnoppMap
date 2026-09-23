# Knopp Map

Interactive map of the Knopp quarter section: property boundaries, roads, named trails and geotagged field photos.
Built with Leaflet as a plain static site in `docs/`, which GitHub Pages serves directly.

## Layout

```
knopp-map.gpx          raw Gaia GPS export (never edited by the build)
photos/Knopp Map/      original phone photos (GPS read from EXIF)
config/tracks.json     display name, category, colour and loop flag per track   <- edit me
config/places.json     named places: name, icon, story, cover photo, which photos <- edit with the tagger
config/photos.json     optional title/caption per photo
config/tour.json       optional: tour stops and wording (otherwise every named place, nearest-first from the house)
config/site.json       site title and optional family password
build/build.py         turns the raw files into site data
build/report.md        what the last build did (snaps, trims, loops, missing GPS)
docs/                  the website (index.html, css, js, data/, photos/web, photos/thumb)
```

## Rebuilding

```
pip install pillow cryptography
python3 build/build.py             # full build (only resizes photos that are new)
python3 build/build.py --tracks    # tracks only, fast
```

Then commit `docs/` and push. To preview locally: `cd docs && python3 -m http.server` and open http://localhost:8000.

## How the tracks are cleaned up

- Paused-recording segments in the same track are joined when the gap is under 50 m.
- Boundary tracks (`"loop": true` in `config/tracks.json`) are closed into a polygon.
- Lines are simplified with a 2 m tolerance first, then every trail end is connected:
  an end already touching a trail is locked onto it; an end that crosses a trail and runs on for up to 25 m is trimmed
  back to the crossing; an end that stops within 25 m of a trail is extended to it. The junction point is added to both
  lines so they share one exact point. Coordinates are rounded to 6 decimals.

Every snap and trim is listed in `build/report.md`. To stop a track being snapped, add `"snap": false` to it in
`config/tracks.json`.

## Places and the tagger

Photos are grouped into places. The family map shows named places as big labelled pins; tapping one opens its
photos and story. Unnamed places show as small photo-spot dots when zoomed in.

Edit places at **`/tag.html`** on the live site (not linked from the family map):
rename, pick an icon and cover photo, write a story, move photos between places, split or merge, drag pins.
Edits save in that browser. Click **Download places.json**, upload it to `config/` on GitHub, then rebuild.

`config/places.json` was seeded once automatically (photos grouped by walking order within 20 m) and is never
overwritten by the build. New photos not listed in any place are grouped into temporary unnamed spots.

## Looks, map styles and filters

**More → Look** has six themes (Farmhouse, Middle-earth, Night sky, Prairie sky, Blueprint, High contrast); each also
picks a matching map style. **Map style** offers 11 base maps: satellite, satellite + roads, two topo maps, street,
clean light, night, black & white, old parchment, vintage photo and blueprint. The satellite map detects how far the
real imagery goes at the farm and enlarges that level beyond it, so you never see "Map data not yet available".

**Advanced options & filters** (collapsed by default): trail colouring (one colour / per trail / steepness / length),
line thickness, map brightness, trail length and recording-day filters, kinds of places, label toggles, photo pins,
legend, per-trail switches, and "Reset everything to normal". Themes live in `THEMES` in `docs/js/app.js` and
`docs/css/app.css` — adding one is a new entry plus a CSS block.

## Tour

Without `config/tour.json` the tour visits every named place, walking to the nearest one next, starting at the house.
To choose the order and wording yourself:

```json
{ "title": "Tour of the farm",
  "stops": [ { "place": "spot-01", "text": "Grandma and Grandpa's house, built in ..." }, { "place": "spot-05" } ] }
```

## Family password

Set `"password": "something"` in `config/site.json` and rebuild. The map data is then encrypted (AES-GCM) and
photo files get unguessable names, so the site shows a password screen and nothing can be read without it.
Family can tick "Remember me" so they only type it once. Set it back to `null` to remove the lock.
Note: while this repository is public, the original photos in `photos/` and the GPX file are still downloadable
from GitHub itself — make the repo private (and deploy with Pages from a private repo or another host) for real privacy.

## Offline use

The site is an installable web app. In **More → Use without internet**, family can save the satellite map for the
farm plus small (or full) photos onto their phone, so it works at the farm with no signal. "Add to Home Screen"
gives it an app icon.

## Links

Every place, trail and tour stop has its own link (e.g. `#place=spot-05`, `#trail=cabin-trail`, `#tour=3`) —
the Share buttons copy these.

## Captions

`config/photos.json` is keyed by the original file name:

```json
{
  "20260823_140246.jpg": { "title": "Front gate", "caption": "Looking south down the approach road" }
}
```

Photos without a title show "Near <closest trail>".

## GitHub Pages

Settings -> Pages -> Build and deployment -> Source: **Deploy from a branch**, Branch: **main**, folder **/docs**.
