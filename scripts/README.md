# scripts

Node scripts that harvest the two sources, compare them, and build the site. They need Node 20 or later and
have no dependencies. Run them from the repository root.

| Script | Run it to | Reads | Writes |
| --- | --- | --- | --- |
| `harvest-cropontology.mjs` | refresh the cropontology.org snapshot | cropontology.org BrAPI and RDF | `data/cropontology/` |
| `harvest-planteome.mjs` | refresh the Planteome GitHub snapshot | Planteome repos on GitHub | `data/planteome/` |
| `compare.mjs` | see how the two sources differ, field by field | `data/` | `reports/comparison.json` |
| `build.mjs` | build the website and BrAPI files | `data/`, `site/`, `curation.json` | `_site/` |
| `serve.mjs` | preview `_site/` locally | `_site/` | — |

Modules used by the scripts above:

| Module | Purpose |
| --- | --- |
| `curation.mjs` | reads `curation.json`: which ontologies to include, display names, overrides |
| `sources.mjs` | merges the two copies of an ontology and converts trait dictionary rows to BrAPI variables |
| `fields.mjs` | the field-by-field comparison shared by `compare.mjs` and `sources.mjs` |
| `td.mjs` | reads trait dictionary files (CSV, TSV and `.xlsx`) without dependencies |
| `rdf-digest.mjs` | a stable content hash of cropontology.org's RDF export, used to detect changes |

## harvest-cropontology.mjs

```sh
node scripts/harvest-cropontology.mjs            # ontologies whose fingerprint changed (a minute or two if none)
node scripts/harvest-cropontology.mjs --full     # every ontology (about 75 minutes)
node scripts/harvest-cropontology.mjs CO_325     # just these ontologies
```

The only complete export cropontology.org offers is `/brapi/v2/variables?ontologyDbId=…`. It is slow (35 seconds
to several minutes per ontology) and ignores `page`, so each list is fetched in one request and checked against
`totalCount`.

To avoid that cost on every run, the harvester first fingerprints every ontology, which takes a minute or two, and
re-downloads only those whose fingerprint changed. The fingerprint combines the BrAPI ontology record, the term
count from `/get-ontologies`, and a hash of the RDF export (`/ontology/{id}/rdf`).

- The RDF covers names, descriptions, synonyms, abbreviations, scale categories, scientist and institution, but
  not growth stage, context of use, formula, method reference, status or date. An edit that only touches those
  isn't detected, so `--full` re-fetches everything; the scheduled workflow does that monthly.
- The export changes blank-node IDs, namespace prefixes and element order on every request, so `rdf-digest.mjs`
  hashes the RDF's triples rather than its text.
- If an ontology's bulk export fails, its variables are fetched one at a time with `?observationVariableDbId=`,
  using the variable IDs from its RDF. Vitis (CO_356) needs this.
- Ontologies listed in `curation.json` `knownBroken` are tried once and reported as warnings, not failures.
- Files are rewritten only when their content changes, so a run with no upstream change leaves no diff.

## harvest-planteome.mjs

```sh
node scripts/harvest-planteome.mjs               # all CO_###-*-traits repos
node scripts/harvest-planteome.mjs CO_320        # just these
```

Lists the `CO_###-<crop>-traits` repositories in the Planteome organization and copies the data files at each
repo's root (`.csv`, `.tsv`, `.xlsx`, `.xls`, `.obo`, `.owl`) unchanged. `curation.json` `planteomePaths` adds files
kept elsewhere in a repo. A repo is cloned only when its HEAD commit differs from the recorded one, so a run usually
takes seconds. `GITHUB_TOKEN` is used if set. Repository contents are treated as data and never executed.

## compare.mjs

```sh
node scripts/compare.mjs                         # all ontologies
node scripts/compare.mjs CO_320 CO_321           # just these
```

Matches variables by ID across the two copies and compares 28 fields: names, synonyms, context, growth stage,
status, people, and the trait, method and scale fields, limits and categories. Formatting-only differences are
ignored (whitespace, capitalisation of names and classes, `1=x` vs `1 = x`, `0.0` vs `0`, category order), as are
fields the cropontology.org export never fills and columns a GitHub file doesn't have. The report lists, per
ontology, the variables found in only one copy and the field-level differences for each shared variable.

## build.mjs

```sh
node scripts/build.mjs                           # writes _site/
node scripts/build.mjs out                       # writes out/
```

For each included ontology, `sources.mjs` decides which copy is preferred and merges the two:

- every variable found in either copy is served;
- where both have a variable and its fields agree, it is served as is;
- where they disagree, the preferred copy wins: Planteome GitHub, unless cropontology.org reloaded the ontology
  on or after `siteReloadsCountFrom` or the harvester saw it change, after the GitHub file's last commit;
- a variable in only one copy whose name matches a different ID in the preferred copy is treated as renumbered and
  left out, as are variables marked obsolete on GitHub;
- a GitHub file is only used if it has trait, method and scale ID columns.

The merged variables are then normalised to BrAPI v2: lists go under `result.data`; scale categories such as
`"1 = absent"` become `{ "value": "1", "label": "absent" }` in value order; both BrAPI 2.0 (`min`/`max`) and 2.1
(`minimumValue`/`maximumValue`) limits are set; non-BrAPI scale types become Text; categories that spreadsheets
turned into dates (`1-2-3` → 2003-01-02) and garbled accented text are repaired.

Every change is recorded three ways: in the record's `additionalInfo` (`provenance`, `changes`, `sourceCropName`,
`sourceDataType`), in `_site/changes.json`, and on the site's *Changes from sources* page.

Output layout:

```
_site/
  index.html, app.js, style.css             UI, copied from site/
  ontologies.json                           index the UI loads first
  changes.json                              every change made to the source data
  brapi/v2/{serverinfo,commoncropnames,ontologies,variables,traits,methods,scales}               all crops
  <ONTOLOGY_ID>/brapi/v2/{serverinfo,commoncropnames,ontologies,variables,traits,methods,scales} one crop
```

## serve.mjs

```sh
node scripts/serve.mjs                           # _site on port 8080
node scripts/serve.mjs out 9000
```

A small static server that sends the extensionless BrAPI files as `application/json`, which GitHub Pages doesn't,
so BrAPI clients that check the content type can be tested against a local build.
