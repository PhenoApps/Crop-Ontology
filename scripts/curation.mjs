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

// One spelling per trait class (see curation.json `traitClasses`). "Phenological traits" → "Phenological",
// "Agronomical" → "Agronomic", "bacterial damage" → "Bacterial damage"; each part of "Quality/Aroma" separately.
// "trait(s)" is only dropped where that leaves a known class, so "Leaf morphological trait" keeps its noun.
const classRules = config.traitClasses ?? {};
const standardClasses = new Map((classRules.standard ?? []).map((s) => [s.toLowerCase(), s]));
const classAliases = new Map(Object.entries(classRules.aliases ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
const knownClass = (s) => classAliases.get(s.toLowerCase()) ?? standardClasses.get(s.toLowerCase());
const regroup = new Map(Object.entries(classRules.regroup ?? {})
  .map(([id, map]) => [id, new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))]));

// The class name with spelling rules applied; the same for every crop (used when comparing the two sources).
export function traitClassName(raw) {
  if (raw == null) return raw;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return s.split(/\s*\/\s*/).map((part) => {
    const name = knownClass(part) ?? knownClass(part.replace(/\s+traits?$/i, '')) ?? part;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }).join('/');
}

// The class a crop's trait is published under: its spelled name, moved by `regroup` where the crop has one, and
// then, if its subclass is itself a standard class, that class ("Agronomic/Postharvest" → "Postharvest").
// { name, regrouped } so the build can say which kind of change it made.
export function publishedTraitClass(ontologyDbId, raw) {
  const spelled = traitClassName(raw);
  if (!spelled) return { name: spelled, regrouped: false };
  let name = regroup.get(ontologyDbId)?.get(spelled.toLowerCase()) ?? spelled;
  const sub = name.split('/').at(-1);
  if (name.includes('/') && standardClasses.has(sub.toLowerCase())) name = standardClasses.get(sub.toLowerCase());
  return { name, regrouped: name !== spelled };
}

// British spellings in class names that become American where the class's own trait names use the American one
// more: { published class → class with American spelling } for one ontology. Applied after publishedTraitClass.
const americanWords = Object.entries(classRules.americanSpellings ?? {});
export function americanClassSpellings(ontologyDbId, variables) {
  const traitNames = new Map();
  for (const v of variables) {
    const { name } = publishedTraitClass(ontologyDbId, v.trait?.traitClass);
    if (name) (traitNames.get(name) ?? traitNames.set(name, []).get(name)).push(String(v.trait?.traitName ?? ''));
  }
  const out = new Map();
  for (const [cls, names] of traitNames) {
    let fixed = cls;
    for (const [uk, us] of americanWords) {
      const word = (w) => new RegExp(`\\b${w}`, 'i');
      if (!word(uk).test(fixed)) continue;
      if (names.filter((n) => word(us).test(n)).length > names.filter((n) => word(uk).test(n)).length) {
        fixed = fixed.replace(new RegExp(`\\b${uk}`, 'gi'), (m) => (m[0] === m[0].toUpperCase() ? us : us.toLowerCase()));
      }
    }
    if (fixed !== cls) out.set(cls, fixed);
  }
  return out;
}

// Characters a source lost as "?" or garbled, restored (see curation.json textRepairs): the [[RegExp, replacement], …]
// to apply, in order, to one variable's text. The "*" repairs come first, then the ontology's own; a repair with
// `only` applies just to the variables it lists.
const repairLists = Object.fromEntries(Object.entries(config.textRepairs ?? {})
  .filter(([id]) => !id.startsWith('$'))
  .map(([id, list]) => [id, list.map((r) => ({ re: new RegExp(r.find, 'g'), to: r.replace, only: r.only ? new Set(r.only) : null }))]));
export const textRepairsFor = (ontologyDbId, variableId) => [...(repairLists['*'] ?? []), ...(repairLists[ontologyDbId] ?? [])]
  .filter((r) => !r.only || r.only.has(variableId))
  .map((r) => [r.re, r.to]);

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
