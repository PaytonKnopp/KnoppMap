# Knopp Map

An interactive map of the Knopp quarter section: 3 property perimeters, 3 roads, 26 named trails, 14 named places
and about 230 geotagged field photos. It is a plain static website (Leaflet, no server, no accounts) served by
GitHub Pages from the `docs/` folder.

**Live site:** https://paytonknopp.github.io/KnoppMap/  ·  **Place editor:** https://paytonknopp.github.io/KnoppMap/tag.html

---

## For family: using the map

| | |
|---|---|
| 🏠 **Home** | Jump back to the whole property. |
| 📍 **Places** | List of named places and trails. Tap one to fly there and see its photos. |
| ▶️ **Tour** | A 14-stop slideshow walk around the quarter with big Back / Next buttons. |
| 〰️ **Trails** | Show or hide trail lines. Tap any trail for length, climb, an elevation chart, connecting trails and photos. |
| 🧭 **Me** | Your live position (when you're at the quarter) with the nearest place and direction. A blue beam on the dot shows which way you're facing, like Google Maps (iPhones ask to allow motion & orientation). |
| 🔍 **Search** | Find places, trails and photo captions. Words can be in any order and small typos are fine ("payton trail", "britany"); press Enter to open the top result, or `/` to open search on a computer. |
| 📏 **Measure** | Tap points on the map to measure distance; keep tapping to add legs. Points snap to named places, can be dragged, and Undo / Clear / Done and a ✕ to close are always shown. |
| 🗺️ **Legend** | What the lines and pins mean (folded-map button, top right). |
| 💡 **Tips** | The welcome guide. |
| ⚙️ **Options** | Looks, map styles, weather, what's shown, text size, print & offline, and the advanced sections below. **Reset to original settings** is at the top. |
| 🧭 **Compass** | The antique compass (bottom right) shows north is up; tap it for a little spin. |

- **Panels on a phone** (Places, Options, place cards and the rest) can be dragged up or down by their header to
  show as much or as little of the map as you like. Tap the little grip bar to jump between nearly full screen and
  the normal height. Closing the panel puts it back to normal.
- **Take me there** (on every place card and tour stop) draws a blue walking route along the trails from your
  position, with distance, walking time, a direction arrow and "You've arrived". Away from the quarter it offers
  Google Maps driving directions instead.
- **Photos** appear as thumbnail groups with a count. They split apart as you zoom in; a tight group fans out when
  tapped. Photos only ever group with others from the same place. On a computer, hovering shows a preview.
- **Looks** (20 themes) restyle the whole app and tint the satellite photo; **map styles** (20) change the base map.
- **Weather:** live RainViewer precipitation radar with rain and snow in separate colours (slider, play/pause, step,
  speed, see-through, rain and snow colour keys, a one-tap wider view). On a phone the panel starts small (what's
  falling at the farm, play and the time slider); **More** opens the rest. A line in the panel says what is falling at
  the farm right now and what's coming in the next few hours, and the panel's icon switches between 🌧️ 🌨️ 🧊 ⛈️ to
  match. There is also a chip with current Open-Meteo conditions at the quarter.
- **Advanced options:**
  - *Trail colours & lines:* colour by one colour / each trail / steepness / length, pick the single trail colour,
    line style (the look's own, solid, dashed, dotted), thickness, see-through, map brightness, dark outline on or
    off, and *Moving trails* (dashes flow along every trail).
  - *Filter trails & places:* trail length, steepness, kinds of places (with Show all /
    Hide all), and a live count of what's showing.
  - *Labels & extras:* trail name size, distances in metres or feet and miles (everywhere: cards, measure, scale,
    rings), distance rings around the house, direction arrows on named trails, trail lengths next to
    names, compass and scale bar, small photo spots, photo grouping, and shading inside the property line.
  - *Trails one by one:* turn single trails on or off. The driveway and main yard are listed on their own; every
    other line, including Ring Road and Field Highway Trail, is a trail.
- **Print:** prints exactly the area on screen, either as *Just the map* or a *Framed poster* with title, compass,
  legend and list of places.
- **Offline:** Options → Print & offline → *Save everything to this device* keeps the map and all photos inside the
  browser, so the same link works at the quarter with no signal. "Add to Home Screen" gives it an app icon.
- **Text size** starts on *Small* on phones (and phones turned sideways) and *Normal* on computers. A size you pick in
  Options is remembered on that device.
- **Nothing is remembered between visits** except text size and whether the tips were seen. Every visit opens with
  the original look and filters.

---

## Repository layout

```
knopp-map.gpx          raw Gaia GPS export (never edited by the build)
photos/Knopp Map/      original phone photos (GPS + time read from EXIF)
config/tracks.json     per track: display name, category, colour, loop, snap, manual endpoints, named directions
config/places.json     named places: name, icon, story, cover photo, photos, featured, optional fixed position
config/tour.json       tour stops in order, with the text for each stop
config/hidden.json     near-duplicate photos hidden from the map (never deleted; remove a line to restore)
config/photos.json     optional per-photo title / caption
config/site.json       site title, optional password, optional map-style keys
build/build.py         turns all of the above into the website data
build/report.md        what the last build did (joins, trims, loops, photo checks, places, tour)
docs/                  the website: index.html, tag.html, css/, js/, data/, photos/web, photos/thumb, sw.js
```

## Rebuilding after a change

```
pip install pillow cryptography
python3 build/build.py             # full build (only resizes photos that are new)
python3 build/build.py --tracks    # trails only, fast
cd docs && python3 -m http.server  # preview at http://localhost:8000
```

Commit `config/`, `build/report.md` and `docs/`, push, and merge to `main`; GitHub Pages updates in a minute or two.

## How the data is cleaned

**Trails**
- Paused-recording segments of one track are joined when the gap is under 50 m; perimeters (`"loop": true`) are
  closed into outlines.
- Lines are simplified (2 m tolerance), then every trail end is connected: an end touching a trail is locked on, an
  end that crosses a trail and runs on up to 25 m is trimmed back, and an end stopping within 25 m of a trail is
  extended to it. Both lines share the exact junction point.
- `"extend": {"start": [lon, lat], "end": [lon, lat]}` pins an end to a chosen point (used to route Brush Pile
  Trail between the two brush piles); `"snap": false` turns automatic joining off for a track.
- `"directions"` adds named direction markers (Payton Trail one way, Caine Trail the other).

**Photos**
- Position and time come from EXIF. Each photo is checked against the GPS track timeline and moved to the track if
  the camera was more than 25 m off (none needed it).
- Web copies (1600 px) and thumbnails (360 px) have location data stripped.
- Near-duplicates (burst shots) are listed in `config/hidden.json`; the sharper one of each pair stays.

**Places**
- `config/places.json` is seeded once by grouping photos taken within 20 m, then hand-edited and never overwritten.
  New photos not in any place are grouped into temporary unnamed spots.
- Named places (`featured`) get a picture icon and a label; unnamed ones are small camera spots.

## Editing places — `/tag.html`

Rename places, pick icons and cover photos, write stories, move photos between places, split or merge places, and
drag pins. Edits save in that browser as a draft. Click **Download places.json**, put it in `config/` (or send it to
Claude), and rebuild.

## Looks and map styles

Themes are the `THEMES` object in `docs/js/app.js` plus a matching `:root[data-theme="…"]` block in
`docs/css/app.css`. Map styles are `BASEMAPS` in `docs/js/app.js`. All built-in styles, the radar and the weather
need no account. Extra styles switch on automatically when keys are added to `config/site.json`:

```json
"keys": { "maptiler": "YOUR_KEY", "thunderforest": "YOUR_KEY", "stadia": true }
```

Restrict each key to `paytonknopp.github.io` in the provider's dashboard.

## Optional family password

Set `"password": "knopp"` in `config/site.json` and rebuild (not case-sensitive). The map data is then encrypted
(AES-GCM) and photo files get unguessable names, so nothing loads without the password; "Remember me" means family
type it once. Set it back to `null` to remove it. While the repository is public, the originals in `photos/` can
still be downloaded from GitHub itself.

## Links

Every place, trail and tour stop has its own address, e.g. `#place=spot-05`, `#trail=cabin-trail`, `#tour=3`.
