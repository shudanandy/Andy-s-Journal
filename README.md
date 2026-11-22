# Andy’s Journal

A personal editorial travel journal, published as a static website. The current snapshot contains **13 country stories and 33 cities**.

## Technology

- Plain HTML, CSS, and JavaScript; no React/Vue/Vite build step and no package installation.
- `index.html` is the website entry point and contains the page styles, travel data, destination filters, cards, story dialog, city photo controls, and summary statistics.
- `globe-map.js` renders the Three.js globe and continent maps using D3 Geo and TopoJSON.
- Country and city images are a combination of embedded image data in `index.html` and original files in `images/`.
- A GitHub Actions workflow publishes the repository root to GitHub Pages.

## Run locally on macOS

From this directory, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/> in Safari. Stop the server with `Control-C` in Terminal. An HTTP server is needed for ES modules, map data requests, and browser storage behavior. The globe also needs network access to its pinned CDN dependencies.

## Main files

- `index.html` — current site and data source.
- `globe-map.js` — globe, country/continent geometry, raycasting, pointer interaction, and map transitions.
- `images/` — preserved image assets, including source images that are not currently referenced directly by the HTML.
- `Where Quiet Journeys Begin – Travel Journal.html` — byte-identical copy of `index.html` in this snapshot; `index.html` is the deployment entry. Keep them synchronized if retaining both.
- `.github/workflows/deploy.yml` — no-build GitHub Pages deployment.

## Maintain the site

Travel country and city records are currently defined near the beginning of the inline script in `index.html`. Country-level fields include the name, region, date, duration, cities, cover image, and introduction. City data is normalized from the country `c` list and optional `cp` details. Summary counts are computed from these records. Keep local image paths relative, for example `images/new-cover.jpg`.

City photo controls use IndexedDB in the visitor’s browser. Those photos are **not uploaded to the repository or live website** and are not shared between devices.

Before editing, read the documents under `AI-Handover/` in the companion handover archive. Check the actual source before relying on the notes.

## Deploy to GitHub Pages

1. Create a public repository named `andys-journal` with no starter README/license/gitignore.
2. Upload the contents of this folder to the repository root, preserving `images/` and `.github/workflows/`.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. Wait for the workflow run to finish. The Actions log and Settings → Pages show the published URL.

The website uses relative local paths and a relative module import, so it works under a project URL such as `https://<username>.github.io/andys-journal/`; no username is hard-coded. See `GITHUB_UPLOAD_GUIDE.md` in the delivery folder for detailed browser steps.

## External services

- Google Fonts: Bodoni Moda and Mulish.
- jsDelivr: Three.js 0.170.0, D3 Geo 3.1.0, TopoJSON Client 3.1.0, and World Atlas 2.0.2 country boundaries.

A network connection is required for these services. No API keys are configured in the site.
