# data

Raw snapshots of the two sources, committed so that a diff shows exactly what changed upstream. Files here are
written only by the harvesters in [`scripts/`](../scripts/README.md) and are never edited by hand: corrections
belong upstream, and changes made for publishing happen in the build.

## cropontology/

Downloaded from the [cropontology.org](https://cropontology.org) BrAPI v2 service by `harvest-cropontology.mjs`.
Records are stored as served, sorted by ID so diffs are readable.

| File | Contents |
| --- | --- |
| `ontologies.json` | BrAPI ontology records for the ontologies `curation.json` `include` selects |
| `variables/<ONTOLOGY_ID>.json` | the ontology's BrAPI observation variables, with nested trait, method, and scale |
| `harvest.json` | when the source was last checked, and per ontology the harvest state below |

Per-ontology fields in `harvest.json`:

| Field | Meaning |
| --- | --- |
| `fingerprint` | hash of the BrAPI record, term count, and RDF export; a change triggers a re-download |
| `variableCount` | number of variables downloaded |
| `changedAt` | when this snapshot last changed |
| `loadedAt` | when cropontology.org says it last loaded the ontology |
| `editObservedAt` | when the harvester first saw the content change between loads, if it has |
| `fetchedVia` | `per-variable` when the bulk export failed and variables were fetched one at a time |
| `doi` | the DOI linked from the ontology's cropontology.org page (usually its Zenodo badge), or `null` if none; recorded even for ontologies with no variables here |

## planteome/

Copied from the `CO_###-<crop>-traits` repositories in the [Planteome](https://github.com/Planteome) GitHub
organization by `harvest-planteome.mjs`.

| File | Contents |
| --- | --- |
| `<ONTOLOGY_ID>/<file>` | the repo's trait dictionary (`.csv`, `.tsv`, `.xlsx`) and ontology exports (`.obo`, `.owl`), byte for byte |
| `harvest.json` | per ontology: repo URL, branch, commit, and commit date; per file: path, size, SHA-256, and the date of the last commit that changed it |

Repos differ in what they keep. Most have a trait dictionary CSV; some only an `.xlsx` or an `.obo` file. The build
picks one file per repo (`pickTD` in `scripts/sources.mjs`, overridable with `curation.json` `planteomeFiles`) and
only uses it if it has trait, method, and scale ID columns.
