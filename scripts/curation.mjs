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
