# PhenoApps Crop Ontology

Crop trait dictionaries from the [Crop Ontology](https://cropontology.org), published by
[PhenoApps](https://phenoapps.org) as static [BrAPI v2](https://brapi.org/specification) endpoints for
[Field Book](https://github.com/PhenoApps/Field-Book) and other phenotyping apps, with a website for browsing them.

**Site:** https://phenoapps.github.io/Crop-Ontology/

The trait dictionaries are kept in two places that have drifted apart: the cropontology.org database and the
`CO_###-<crop>-traits` repositories in the [Planteome](https://github.com/Planteome) GitHub organization. This
project keeps a raw copy of both, merges them crop by crop, and publishes the result as plain files on GitHub Pages.
The site's [About page](https://phenoapps.github.io/Crop-Ontology/#/about) explains the purpose for end users.

## BrAPI endpoints

| Base URL | Serves |
| --- | --- |
| `https://phenoapps.github.io/Crop-Ontology/brapi/v2` | every crop |
| `https://phenoapps.github.io/Crop-Ontology/<ONTOLOGY_ID>/brapi/v2` | one crop, e.g. `CO_320` for rice |

Each base URL answers `serverinfo`, `commoncropnames`, `ontologies`, `variables`, `traits`, `methods`, and `scales`.
Variables carry their trait, method, and scale, and every variable's `commonCropName` is its crop's name, so a
client using the all-crops URL can filter by crop. Each record in the all-crops `ontologies` list has
`additionalInfo.commonCropName`, `variableCount`, and `brapiBasePath` (e.g. `CO_325/brapi/v2`, relative to the site
root), so a client can offer a list of crops and then load just the one picked. Where the ontology's
cropontology.org page links a DOI (usually Zenodo), its record has it as `additionalInfo.doi`.

Each variable page has a QR code of the variable's BrAPI URL,
`https://phenoapps.github.io/Crop-Ontology/<ONTOLOGY_ID>/brapi/v2/variables/<VARIABLE_ID>`, so Field Book can add
a single trait by scanning it. That path isn't served here; Field Book splits it into the base URL and the ID and
reads the crop's `variables` list (see [`site/README.md`](site/README.md#the-variable-qr-code)).

Limits of static hosting:

- **No query parameters.** Filters and `page`/`pageSize` are ignored. Every list is one page with `totalPages: 1`.
- **No single-record or search calls** such as `variables/{id}`; load the list and pick the record out by ID.
- **Content type.** GitHub Pages serves these extensionless files as `application/octet-stream`. Browsers and most
  HTTP clients accept that; the BrAPI Java client used by Field Book requires a JSON content type.
- **Caching.** GitHub Pages sends `Cache-Control: max-age=600`, so an update can take 10 minutes to reach clients.

## How the data is built

```
cropontology.org ──harvest-cropontology──▶ data/cropontology/ ─┐
                                                              ├─build──▶ _site/ ──▶ GitHub Pages
Planteome GitHub ──harvest-planteome─────▶ data/planteome/ ────┘
                                                              └─compare──▶ reports/comparison.json
```

For each crop, the site serves every variable found in either source. Where both have a variable and they
disagree, the Planteome GitHub copy is used unless cropontology.org changed that ontology more recently. Every
change the build makes to the source data (merges, repaired categories and text, mapped data types, renamed crops,
and standardised trait class names)
is listed on the site's *Conflicts* page and in `changes.json`.

The details are in the folder READMEs:

| Folder | Contents |
| --- | --- |
| [`scripts/`](scripts/README.md) | harvesters, the comparison, and the build and its modules |
| [`data/`](data/README.md) | raw snapshots of both sources, committed as downloaded |
| [`site/`](site/README.md) | the browser UI (variable list, trait browser, graph, and the About and Conflicts pages) |
| `.github/workflows/` | `harvest.yml` proposes a weekly data refresh as a pull request; `pages.yml` builds and deploys the site; `labels.yml` creates the issue labels |
| `.github/ISSUE_TEMPLATE/` | issue forms for trait data (including changes listed on the Conflicts page), import and BrAPI problems, and suggestions |
| `curation.json` | publishing rules: which ontologies, display names, source overrides (see below) |

`_site/` (build output) and `reports/` (comparison report) are generated and not committed.

## Running locally

Requires Node 20 or later. There are no dependencies to install.

```sh
node scripts/harvest-cropontology.mjs   # refresh ontologies that changed on cropontology.org
node scripts/harvest-planteome.mjs      # refresh the Planteome copies
node scripts/compare.mjs                # optional: field-by-field comparison -> reports/comparison.json
node scripts/build.mjs                  # build _site/
node scripts/serve.mjs                  # preview at http://localhost:8080/
```

`serve.mjs` sends the BrAPI files as `application/json`, so a phone on the same network can import from
`http://<your-ip>:8080/brapi/v2`.

## Automation

- `harvest.yml` runs both harvesters and the comparison every Monday (a full cropontology.org refresh on the first
  Monday of the month). If anything changed, it opens a pull request, *Data refresh*, from the `data-refresh` branch
  (or updates the open one), with the crops that changed and a check that the site still builds. The site updates
  when it's merged. Each run starts again from `main` and replaces the branch. If a source fails, it also opens an
  issue labelled `harvest` (or comments on the one already open). It can be run from the Actions tab too, and needs
  **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.
- `pages.yml` builds and deploys on pushes to `main` that touch the data, site, build scripts, or `curation.json`.
- `labels.yml` creates or updates the labels in `.github/labels.json` (used by the issue forms, the harvest
  workflow, and Dependabot) whenever that file changes on `main`, or when run from the Actions tab.
- Dependabot (`.github/dependabot.yml`) checks the workflows' GitHub Actions for updates every Monday and groups them
  into one pull request.

The site links to the issue forms with fields filled in: each variable page has "Report a problem", and each Conflicts section heading has "Report a problem".

To enable Pages on a new fork: **Settings → Pages → Build and deployment → Source: GitHub Actions**, then run
*Deploy site* from the Actions tab.

## Curation

`curation.json` is read by the harvesters and the build.

| Key | Purpose |
| --- | --- |
| `include` | regex on the ontology ID; defaults to `^CO_\d+$` |
| `stripWords` | words removed from source titles so each crop shows just its name ("Beet Ontology" → "Beet") |
| `names` | display-name overrides by ID, e.g. `"CO_365": "Faba bean"` |
| `traitClasses` | one spelling per trait class: `standard` names and `aliases` ("Phenological traits" and "Agronomical" become "Phenological" and "Agronomic"), applied when comparing the sources too; `regroup` moves a crop's one-off classes into the common ones (Cassava's "Viral disease" becomes "Biotic stress", "Viscosity trait" becomes "Quality/Viscosity"); a subclass that is a standard class becomes that class; a class with a subclass is served as its parent, with the subclass in `additionalInfo.traitSubclass` ("Quality/Aroma" → "Quality", subclass "Aroma"); `americanSpellings` gives a class the American spelling where its traits use it |
| `textRepairs` | regular-expression repairs of characters a source lost as `?` or garbled (Potato's "Number?of?marketable tubers", Wheat's "?13C"), per ontology or for all (`"*"`); `only` limits a repair to listed variables. Each is listed on the Conflicts page |
| `knownBroken` | ontologies that fail upstream, with the reason; reported as warnings rather than failures |
| `planteomeFiles` | which file in a Planteome repo is the trait dictionary, when the default choice is wrong |
| `planteomePaths` | extra files to copy from a Planteome repo whose trait data isn't at its root |
| `siteReloadsCountFrom` | cropontology.org reloads before this date (its 2023 migration) don't count as newer than GitHub |
| `sources` | force the preferred copy for an ontology: `"cropontology"` or `"planteome"` |

## Licences and credit

The trait dictionaries are the work of the crop communities and curators of the Crop Ontology. Each ontology keeps
its own licence, shown on its page and in its BrAPI `ontologies` record. This is not the official Crop Ontology
site. Corrections to traits belong with their curators, on cropontology.org or in the crop's Planteome repository,
and are picked up by the next weekly refresh. The code in this repository is licensed under the terms in
[LICENSE](LICENSE).

## AI use

The code and documentation in this repository were written with the help of Claude Opus 5.5 working under the 
direction of the PhenoApps maintainers, who are responsible for reviewing and accepting changes. The ontology 
data is not AI-generated: it is copied from cropontology.org and the Planteome GitHub repositories, and every 
automated change to it is listed in `changes.json` and on the site.
