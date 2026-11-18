# Crop Ontology mirror

A read-only static copy of the trait dictionaries on [cropontology.org](https://cropontology.org),
published with GitHub Pages as:

- a **browsable website**: search ontologies and variables, and view the trait, method and scale behind each variable
- a **static [BrAPI v2](https://brapi.org/specification) endpoint per ontology**, for importing traits into
  BrAPI clients such as [Field Book](https://github.com/PhenoApps/Field-Book)

Site: `https://phenoapps.github.io/Crop-Ontology/` (once Pages is enabled; see [Setup](#setup)).

## BrAPI endpoints

Each ontology has its own base URL, so a client imports one crop's variables at a time:

```
https://phenoapps.github.io/Crop-Ontology/<ONTOLOGY_ID>/brapi/v2
```

| Call | Contents |
| --- | --- |
| `serverinfo` | the calls listed here |
| `commoncropnames` | the crop(s) named in the ontology |
| `ontologies` | the ontology record |
| `variables` | all observation variables, with nested trait, method and scale |
| `traits`, `methods`, `scales` | distinct traits, methods and scales used by those variables |

The root base URL `…/Crop-Ontology/brapi/v2` serves only `serverinfo`, `ontologies` and `commoncropnames`, to help
clients discover the per-ontology URLs.

Static hosting limits:

- **No query parameters.** Filters and `page`/`pageSize` are ignored. Every list is returned as one page with
  `totalPages: 1`, so a client that follows the pagination metadata gets everything in one request.
- **No single-record calls** such as `variables/{id}`, because `variables` is a file and can't also be a directory.
- **Content type.** GitHub Pages serves extensionless files as `application/octet-stream`. Browsers and most
  HTTP clients don't mind, but the BrAPI Java client that Field Book uses rejects any response that isn't JSON,
  so Field Book needs a small change to import from here.

## How it works

```
cropontology.org BrAPI v2 ──harvest.mjs──▶ data/ (committed raw snapshot) ──build.mjs──▶ _site/ ──▶ GitHub Pages
```

- `scripts/harvest.mjs` downloads each ontology's variables from `/brapi/v2/variables?ontologyDbId=…`, the only
  complete export the site offers. Responses are stored **as served**, sorted by ID so diffs are readable.
  - That call is slow: 35 s to several minutes per ontology, about 75 minutes for all of them. It also ignores
    `page`, so each list is fetched in one oversized request and checked against `totalCount`.
  - To avoid that cost every run, the harvester first **fingerprints** every ontology in a minute or two, then
    re-downloads only those whose fingerprint changed. The fingerprint combines the BrAPI ontology record, the term
    count from `/get-ontologies`, and a normalised hash of the RDF export (`/ontology/{id}/rdf`).
  - The RDF covers names, descriptions, synonyms, abbreviations, scale categories, scientist and institution. It
    doesn't include growth stage, context of use, formula, method reference, status or date, so an edit that only
    touches those isn't detected. `--full` re-fetches everything, and the scheduled workflow does that on the first
    Monday of each month.
  - Files are rewritten only when their content changes. A run with no upstream change leaves no diff.
- `scripts/build.mjs` normalises the snapshot to the BrAPI v2 shape. Lists go under `result.data`, scale
  categories like `"1 = absent"` become `{ "value": "1", "label": "absent" }`, and both v2.0 (`min`/`max`) and v2.1
  (`minimumValue`/`maximumValue`) bounds are set. It then writes the site and BrAPI tree to `_site/`. The generated
  output is not committed.
- `.github/workflows/pages.yml` builds and deploys on every push to `main` that touches the data, site or build
  script.
- `.github/workflows/harvest.yml` re-harvests every Monday, or on demand from the Actions tab with an optional full
  refresh. It commits the snapshot if anything changed and redeploys.

## Curation

`curation.json` controls what is published and under what name. Both scripts read it.

- `include`: a regex on the ontology ID. It defaults to `^CO_\d+$`, so only CO-numbered ontologies are harvested
  and published.
- `stripWords`: words removed from upstream titles so each ontology shows just the crop name. For example,
  "Beet Ontology" becomes "Beet" and "Sugar Kelp trait" becomes "Sugar Kelp".
- `names`: per-ID overrides for anything the rule gets wrong, e.g. `{ "CO_365": "Faba bean" }`.
- `knownBroken`: ontologies that fail upstream, with the reason. The harvester tries each once, logs a warning
  (a GitHub Actions warning annotation in CI) instead of failing the run, and adds a notice if one starts working
  again. Its previously harvested data, if any, stays in place.

The raw snapshot in `data/` keeps upstream names unchanged. The published records carry the original title in
`additionalInfo.sourceOntologyName`.

## Local use

Requires Node 20+. There are no dependencies.

```sh
node scripts/harvest.mjs            # refresh ontologies whose fingerprint changed (a minute or two if none)
node scripts/harvest.mjs --full     # re-fetch everything (about 75 min; the source is slow)
node scripts/harvest.mjs CO_325     # re-fetch one ontology
node scripts/build.mjs              # build _site/
node scripts/serve.mjs              # preview at http://localhost:8080/
```

`serve.mjs` serves the BrAPI files as `application/json`, which is useful for testing BrAPI clients against
`http://<your-ip>:8080/CO_325/brapi/v2`.

## Setup

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main`, or run **Deploy site** from the Actions tab.

## Data source and licences

The data belongs to the Crop Ontology curators. Each ontology's licence is shown on its page and in its BrAPI
`ontologies` record. This mirror copies the **cropontology.org** database, which can differ from the ontology
files that curators keep elsewhere, such as Planteome's GitHub repositories. Changes belong upstream, not here.
