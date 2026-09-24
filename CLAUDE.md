# KnoppMap

A static Leaflet site served by GitHub Pages from `docs/`. The data comes from `config/*.json`, the GPX files and
`photos/`, turned into `docs/data/` by `build/build.py`. See README.md for everything else.

## "Apply my map edits"

The user checks the map in the place editor (`docs/tag.html`) and sends back a `knopp-map-edits-<date>.json` file
(attached, or pasted as JSON; if pasted, save it to a file first). To apply it:

1. `pip install pillow cryptography` if needed.
2. `python3 build/apply_edits.py <file> --check`. Read the summary and warnings back to the user in plain words.
3. `python3 build/apply_edits.py <file>`. This writes `config/places.json`, `photos.json`, `hidden.json` and
   `tour.json` and runs the full build.
4. Look over `git diff --stat` and `build/report.md`, then commit `config/`, `build/report.md` and `docs/` and push.
   It goes live once merged to `main`.

The edits file holds the whole of each config file as the editor left it, not a diff. If the script notes the map
was rebuilt after the edits were started, check `git diff config/` for anything the file would undo.
