# site

The browser UI. `scripts/build.mjs` copies these files into `_site/` next to the generated JSON; there is no
bundler or framework.

| File | Contents |
| --- | --- |
| `index.html` | page shell: header and navigation |
| `app.js` | the whole UI: a hash router and one function per view |
| `style.css` | styles (light theme; IBM Plex Sans and Mono from Google Fonts, with system fallbacks) |

## Views

| Route | View |
| --- | --- |
| `#/` | crops, sorted by name, with variable count and last-updated date; sortable and filterable |
| `#/about` | what the site is for, where the data comes from, how to use it with Field Book |
| `#/conflicts` | where the sources disagree and everything the build changes, from `changes.json` (`#/changes` also works) |
| `#/CO_320` | one crop: source details, BrAPI base URL, and the variable list |
| `#/CO_320/browse` | trait browser: a trait class → trait → variable tree beside the selected term |
| `#/CO_320/browse/<TERM_ID>` | the trait browser with a trait or variable selected |
| `#/CO_320/<VARIABLE_ID>` | one variable with its trait, method and scale |

## Data it loads

All from the built site, relative to the page:

- `ontologies.json` on first load: the crop index and when each source was last checked.
- `<ONTOLOGY_ID>/brapi/v2/variables` when a crop is opened, cached for the session. The list, trait browser and
  variable pages are all built from this one file.
- `changes.json` for the collapsible change notes on crop pages and the Conflicts page.

The UI reads `additionalInfo.provenance` and `additionalInfo.changes` on each variable to say which source it came
from and what was changed. Each variable links back to its sources: its Crop Ontology term page, and its row in
the Planteome trait dictionary (`ontologies.json` `source.planteomeUrl`, pinned to the harvested commit, plus
`additionalInfo.provenance.planteomeLine` for CSV/TSV files).

## Working on it

```sh
node scripts/build.mjs && node scripts/serve.mjs
```

Then open http://localhost:8080/. Edit files here, not in `_site/`, which is rebuilt from scratch each time.
