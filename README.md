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

## Looks, map styles, layers and filters

Everything resets to normal each time the map is opened (only text size is remembered).
**Options** (top left, under the title) holds, in order: Reset, Look (22 themes), Map style, Extra layers
(hills shading, live RainViewer rain radar, current Open-Meteo weather), what shows on the map, text size, Print,
offline saving, and a collapsed **Advanced** box (trail colouring, thickness, brightness, length filter, kinds of
places, labels, legend, per-trail switches).

Each look tints the real satellite photo through the "Match the look" map style and can add a texture
(parchment, film grain, frost, neon...). Themes are `THEMES` in `docs/js/app.js` plus a CSS block in `docs/css/app.css`.

All built-in map styles, the radar and the weather need no account. Extra styles appear automatically when keys are
added to `config/site.json` and the site is rebuilt:

```json
"keys": { "maptiler": "YOUR_KEY", "thunderforest": "YOUR_KEY", "stadia": true }
```

- **MapTiler** (free, 100k tiles/month): Outdoor, Winter, Topo, Dark minimal, HD satellite.
- **Thunderforest** (free hobby key, 150k/month): Outdoors, Landscape, Pioneer (1800s style).
- **Stadia Maps** (free non-commercial, no key — register the site's domain in the Stadia dashboard, then set `true`):
  Watercolour, Toner, Terrain, Smooth light/dark.

Keys are visible in the page source; restrict each key to `paytonknopp.github.io` in the provider's dashboard.

## Tour

Without `config/tour.json` the tour visits every named place, walking to the nearest one next, starting at the house.
To choose the order and wording yourself:

```json
{ "title": "Tour of the farm",
  "stops": [ { "place": "spot-01", "text": "Grandma and Grandpa's house, built in ..." }, { "place": "spot-05" } ] }
```

## Family password

Set `"password": "knopp"` in `config/site.json` and rebuild (not case-sensitive, so KNOPP works too). The map data is then encrypted (AES-GCM) and
photo files get unguessable names, so the site shows a password screen and nothing can be read without it.
Family can tick "Remember me" so they only type it once. Set it back to `null` to remove the lock.
Note: while this repository is public, the original photos in `photos/` and the GPX file are still downloadable
from GitHub itself — make the repo private (and deploy with Pages from a private repo or another host) for real privacy.

## Offline use

The site is an installable web app. **Options → Save everything to this device** stores the farm's satellite
tiles and every photo in the browser's own storage (nothing goes to the Files/Downloads folder), so the same link
keeps working at the farm with no signal. "Add to Home Screen" gives it an app icon.

## Links

Every place, trail and tour stop has its own link (e.g. `#place=spot-05`, `#trail=cabin-trail`, `#tour=3`).

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
