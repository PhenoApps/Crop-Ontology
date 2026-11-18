// Shared reading of curation.json: which ontologies to publish and what to call them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'curation.json'), 'utf8'));
const include = new RegExp(config.include ?? '.*');
const strip = (config.stripWords ?? [])
  .sort((a, b) => b.length - a.length) // longest first, so "trait dictionary" beats "trait"
  .map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi'));

export const isIncluded = (ontologyDbId) => include.test(ontologyDbId);

export function displayName(ontologyDbId, sourceName) {
  if (config.names?.[ontologyDbId]) return config.names[ontologyDbId];
  const name = strip.reduce((s, re) => s.replace(re, ' '), sourceName ?? '').replace(/\s+/g, ' ').trim();
  return name || sourceName || ontologyDbId;
}

// Ontologies known to fail upstream: { id: reason }. The harvester reports these as warnings, not failures.
export const knownBroken = config.knownBroken ?? {};

// Which file in a Planteome repo is the trait dictionary, when the default choice is wrong: { id: filename }.
export const planteomeFiles = config.planteomeFiles ?? {};

// Extra repo-relative files to copy from a Planteome repo, for repos whose trait data isn't at the root:
// { id: ["dir/file.obo"] }.
export const planteomePaths = config.planteomePaths ?? {};

// Force an ontology's source instead of choosing the more recently updated one:
// { id: "cropontology" | "planteome" }.
export const sourceOverrides = config.sources ?? {};

// cropontology.org reloads before this date don't count as newer than GitHub: the site's 2023 platform
// migration re-imported every ontology, so its load dates from then say nothing about curation.
export const siteReloadsCountFrom = config.siteReloadsCountFrom ?? '2024-01-01';
