# site

The browser UI. `scripts/build.mjs` copies these files into `_site/` next to the generated JSON; there is no
bundler or framework. The JavaScript is plain ES modules loaded by the browser (`<script type="module">`), so the
site has to be served over HTTP, as `scripts/serve.mjs` and GitHub Pages do; opening `index.html` from disk won't work.

| File | Contents |
| --- | --- |
| `index.html` | page shell: header and navigation |
| `style.css` | styles (light theme; IBM Plex Sans and Mono from Google Fonts, with system fallbacks) |
| `js/app.js` | entry point: the hash router, copy buttons and in-page jumps, new-tab external links, QR filling |
| `js/util.js` | escaping, number and date formatting, site and BrAPI URLs, lazy script loading |
| `js/data.js` | loading `ontologies.json`, `changes.json` and each crop's variables; reading provenance |
| `js/components.js` | HTML shared by views: crop page header and change notes, a variable's details, not-found page |
| `js/glyphs.js` | element types (trait class, trait, variable, method, scale) with their colour token and shape |
| `js/qr.js` | turns any `data-qr="<text>"` element into a QR code |
| `js/species.js` | sets scientific names in italics in variable and trait details, from a list of the genera in the data |
| `js/views/*.js` | one module per view (see below) |

Two small libraries are loaded from cdnjs only where they're needed: [d3](https://d3js.org) 7.9.0 for the graph
tab's force layout, zoom and drag, and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4
for the QR codes on crop and variable pages (which fall back to showing the URL as text). Element-type colours are
CSS tokens (`--node-*` in `style.css`), shared by the graph and the trait browser icons, and each type also has its
own shape.

## Views

| Route | Module | View |
| --- | --- | --- |
| `#/` | `home.js` | crops, sorted by name, with variable count and last-updated date; sortable and filterable |
| `#/about` | `about.js` | why the site exists, where the data comes from, BrAPI use and limits, maintenance; `#/about/brapi` (or another section ID) scrolls to that section |
| `#/conflicts` | `conflicts.js` | where the sources disagree and everything the build changes, from `changes.json` (`#/changes` also works); `#/conflicts/CO_320` shows one crop, and crop pages link there |
| `#/CO_320` | `variable-list.js` | one crop: source details, a QR code of its BrAPI base URL, and the variable list |
| `#/CO_320/browse` | `browser.js` | trait browser: a trait class → trait → variable tree beside the selected term |
| `#/CO_320/browse/<TERM_ID>` | `browser.js` | the trait browser with a trait or variable selected |
| `#/CO_320/graph` | `graph.js` | network graph of the ontology: classes, traits, variables, methods and scales (like the cropontology.org explorer) |
| `#/CO_320/<VARIABLE_ID>` | `variable.js` | one variable with its trait, method and scale, and an "Add to Field Book" QR code |

A view renders into `#app`. It may return a handle that the router keeps while the view is on screen: the trait
browser returns `{ id, select }` so picking another term doesn't rebuild the page, and the graph returns
`{ stop }` so its simulation halts when the route changes.

## The variable QR code

The QR code on a variable page holds the variable's BrAPI URL, `{crop base URL}/variables/{variable ID}`, with
the ID unencoded, for example `https://phenoapps.github.io/Crop-Ontology/CO_321/brapi/v2/variables/CO_321:0001034`.
That is the standard BrAPI `GET variables/{observationVariableDbId}` path. It is meant for Field Book, which adds
the variable as a trait:

1. Split the URL at the last `/variables/`: the part before is the BrAPI base URL, the part after the
   `observationVariableDbId`.
2. Static hosting can't serve the single-record path (it 404s here), so load `{base}/variables` and take the
   record with that ID. On a full BrAPI server the URL itself returns the record, so the same scan handling works
   there too.

Scanned with an ordinary phone camera, the URL gives GitHub Pages' 404 page.

## Data it loads

All from the built site, relative to the page:

- `ontologies.json` on first load: the crop index and when each source was last checked.
- `<ONTOLOGY_ID>/brapi/v2/variables` when a crop is opened, cached for the session. The list, trait browser, graph
  and variable pages are all built from this one file.
- `changes.json` for the collapsible change notes on crop pages and the Conflicts page.

The UI reads `additionalInfo.provenance` and `additionalInfo.changes` on each variable to say which source it came
from and what was changed, and `trait.additionalInfo.sourceTraitClass` to show a trait class's original spelling.
Each variable links back to its sources: its Crop Ontology term page, and its row in the Planteome trait dictionary
(`ontologies.json` `source.planteomeUrl`, pinned to the harvested commit, plus
`additionalInfo.provenance.planteomeLine` for CSV/TSV files).

## Working on it

```sh
node scripts/build.mjs && node scripts/serve.mjs
```

Then open http://localhost:8080/. Edit files here, not in `_site/`, which is rebuilt from scratch each time.
