# Knopp Map

An interactive map of the Knopp quarter section: 3 property perimeters, 3 roads, 26 named trails, 14 named places
and about 230 geotagged field photos, plus two family houses nearby (Old House and CK House), each shown as one pin
holding all of its photos. It is a plain static website (Leaflet, no server, no accounts) served by
GitHub Pages from the `docs/` folder.

**Live site:** https://paytonknopp.github.io/KnoppMap/  ·  **Place editor:** https://paytonknopp.github.io/KnoppMap/tag.html

---

## For family: using the map

| | |
|---|---|
| ▾ **Knopp Map** (title) | Tap the title for the place switcher: **Main Quarter**, **Old House** or **CK House**. The title never changes; the ✓ shows where you are. **Back to the farm** brings you home from anywhere. |
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
- **The phone's Back button** (or back swipe) closes the photo or panel that's open, and inside a panel goes back to
  the list you opened it from, instead of leaving the map.
- **Phones turned sideways** (any phone, including the narrower iPhone SE and iPhone 8) get a slim dock with panels
  down the left side, open on the whole property with its places showing, and show photos filling the screen with
  the caption and buttons floating over them.
- **Take me there** (on every place card and tour stop) draws a blue walking route along the trails from your
  position, with distance, walking time, a direction arrow and "You've arrived". Away from the quarter it offers
  Google Maps driving directions instead.
- **Family houses:** Old House (62 photos) and CK House (41 photos and the Home Loop driveway track) are one pin
  each, shown from far out. Tapping the pin opens all of its photos; they never scatter across the map. They're
  listed under *Family houses* in Places, are searchable, and work with Take me there. They are not in the tour
  and don't change anything about the quarter.
- **Photo viewer** shows each photo's name, date and the exact coordinates where it was taken; tap the coordinates
  to open that spot in Google Maps.
- **Photos** appear as thumbnail groups with a count. They split apart as you zoom in; a tight group fans out when
  tapped. Photos only ever group with others from the same place. On a computer, hovering shows a preview.
- **Looks** (20 themes) restyle the whole app and tint the satellite photo; **map styles** (20) change the base map.
- **Weather:** live RainViewer precipitation radar with rain and snow in separate colours (slider, play/pause, step,
  speed, see-through, rain and snow colour keys, a one-tap wider view). On a phone the radar plays on its own with just a
  slim bar showing (what's falling at the farm, the radar time, pause and ✕); tap the bar for all the controls. The rain
  and snow colours are also in the Legend while the radar is on, and it pauses while the map is in the background. A line in the panel says what is falling at
  the farm right now and what's coming in the next few hours, and the panel's icon switches between 🌧️ 🌨️ 🧊 ⛈️ to
  match. There is also a chip with current Open-Meteo conditions at the quarter.
- **Advanced options:**
  - *Trail colours & lines:* colour by one colour / each trail / steepness / length, pick the single trail colour,
    line style (the look's own, solid, dashed, dotted), thickness, see-through, map brightness, dark outline on or
    off, and *Moving trails* (dashes flow along every trail).
  - *Filter trails & places:* trail length, steepness, each named place by its own name (with Show all /
    Hide all), and a live count of what's showing. Renaming a place in the editor renames its filter too.
  - *Labels & extras:* trail name size, distances in metres or feet and miles (everywhere: cards, measure, scale,
    rings), distance rings around the house, direction arrows on named trails, trail lengths next to
    names, compass and scale bar, small photo spots, photo grouping, and shading inside the property line.
  - *Trails one by one:* turn single trails on or off. The driveway and main yard are listed on their own; every
    other line, including Ring Road and Field Highway Trail, is a trail.
- **Print:** prints exactly the area on screen, either as *Just the map* or a *Framed poster* with title, compass,
  legend and list of places.
- **Offline:** Options → Print & offline → *Save everything to this device* keeps the map and all photos inside the
  browser, so the same link works at the quarter with no signal. "Add to Home Screen" gives it an app icon.
  - The panel counts what is really saved on the device (not just a note that a save once happened) and says what
    is missing: new photos, a save that was cut short, or a copy the phone cleared. *Save* only fetches what is
    missing, so an interrupted save carries on where it stopped.
  - Each visit with internet checks the saved copy by itself and quietly fills in a small gap (up to about 25 MB, not
    on mobile data where the phone says so). A bigger gap gets a message with an *Update* button, at most once a day.
  - Photos taken off the map are removed from the saved copy, and the browser is asked to keep the copy when space runs
    low. A site update never leaves a saved map without its data.
  - iPhones: Safari clears a website's saved data after about a week without a visit, so the panel suggests Add to
    Home Screen and saving from inside the Home Screen app, which Safari leaves alone.
- **Text size** starts on *Small* on phones (and phones turned sideways) and *Normal* on computers. A size you pick in
  Options is remembered on that device. Every size fits on the smallest phones (the top buttons and dock stop growing
  at a comfortable size).
- **Slow or no connection:** a "Loading the map…" note appears if the data takes a moment. If it can't load at all, a
  *Try again* screen explains why, and it retries by itself when the phone comes back online.
- **Nothing is remembered between visits** except text size and whether the tips were seen. Every visit opens with
  the original look and filters.

---

## Repository layout

```
knopp-map.gpx          raw Gaia GPS export for the quarter (never edited by the build)
ck-loop.gpx            the Home Loop at CK House (any other *.gpx next to it is read too)
photos/Knopp Map/      original phone photos of the quarter (GPS + time read from EXIF)
photos/Old Knopp House/, photos/CK House/   photos of the two family houses
config/tracks.json     per track: display name, category, colour, loop, snap, manual endpoints, named directions
config/places.json     named places: name, icon, story, cover photo, photos, featured, optional fixed position
config/tour.json       tour stops in order, with the text for each stop
config/hidden.json     near-duplicate photos hidden from the map (never deleted; remove a line to restore)
config/photos.json     optional per-photo title / caption
config/site.json       site title, optional password, optional map-style keys
build/build.py         turns all of the above into the website data
build/apply_edits.py   applies an edits file downloaded from the place editor, then rebuilds
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
- `"site": true` marks a family house (its own pin, shown from far out, listed under *Family houses*, and a choice
  in the title's place switcher); `"gather": true` puts all of that place's photos on its pin instead of where each
  was taken. Old House and CK House have both, with `coords` set by hand on the house. A track joins a house with
  `"site": "<place id>"` in `config/tracks.json` (Home Loop → `ck-house`).

## Editing places — `/tag.html`

The place editor is a private checking tool for the map's keeper. It reads the published map and never changes it by
itself; edits only reach the family map when the edits file is applied and the site rebuilt.

- **Places tab:** a list of every place (with *Not checked*, *Named*, *Unnamed*, *Houses* and *Edited* filters and a
  progress bar), the open place (name, icon, named-place switch, story, photos) and a satellite map showing the
  place's pin plus a numbered dot where each of its photos was taken. **✓ Looks good: next place** ticks a place off.
- **Photos:** click one to open it big (← → to go through them) with its caption and title, a mini-map of where it
  was taken, and buttons to hide/show it, make it the cover, move it earlier/later or send it to another place.
  Drag photos to reorder them or onto a place in the list to move them; tick several to move, split off, hide or show
  them together. Hidden photos stay in the editor, greyed out, so they can be brought back. *⚠ far* marks a photo
  taken more than 50 m (150 m for the houses) from its place's pin.
- **Tour tab:** tour title, and each stop's place and text; reorder, add or remove stops.
- **Changes tab:** everything that differs from the published map in plain words, **⬇ Download edits** / *Copy
  edits*, *Load an edits file* (carry on from another device or restore a backup) and *Throw away all my edits*.
- **Tips tab:** how everything works and the keyboard shortcuts. **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z) cover
  every edit.

Work saves in that browser as you go. To publish: **⬇ Download edits** gives one file,
`knopp-map-edits-<date>.json`, holding the editor's copy of `config/places.json`, `photos.json`, `hidden.json` and
`tour.json`. Send it to Claude ("Apply my map edits"), or run:

```
python3 build/apply_edits.py knopp-map-edits-2026-09-24.json --check   # show what would change
python3 build/apply_edits.py knopp-map-edits-2026-09-24.json           # write the config files and rebuild
```

The editor loads `docs/data/editor.json` (or `editor.enc` when a password is set), which the full build writes
next to the map data: the config files as they are, the hidden photos, and where each photo was taken. The family
map never downloads it.

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
