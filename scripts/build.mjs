#!/usr/bin/env node
// Build the static site + static BrAPI v2 tree from the harvested snapshot in data/.
//
// Output (default: _site/):
//   index.html, app.js, style.css       browser UI (copied from site/)
//   ontologies.json                     small index the UI loads first
//   brapi/v2/{serverinfo,commoncropnames,ontologies}            all-ontology discovery
//   <ONTOLOGY>/brapi/v2/{serverinfo,commoncropnames,ontologies,variables,traits,methods,scales}
//
// Each ontology gets its own BrAPI base URL (e.g. .../CO_325/brapi/v2) so a client such as
// Field Book can import one crop's variables at a time. Static hosting cannot honour query
// parameters, so every list is served as a single page (pageSize = totalCount).
//
// Usage: node scripts/build.mjs [outDir]

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayName, isIncluded } from './curation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const OUT = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, '_site');
const TERM_URL = (id) => `https://cropontology.org/term/${id}`;
const BRAPI_VERSIONS = ['2.0', '2.1'];

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const harvest = await readJson(join(DATA, 'harvest.json'));
// Publish only ontologies curation.json includes, under their curated display names.
const ontologies = (await readJson(join(DATA, 'ontologies.json')))
  .filter((o) => isIncluded(o.ontologyDbId))
  .map((o) => {
    const name = displayName(o.ontologyDbId, o.ontologyName);
    return name === o.ontologyName ? o : {
      ...o,
      ontologyName: name,
      additionalInfo: { ...o.additionalInfo, sourceOntologyName: o.ontologyName },
    };
  });

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const clean = (v) => (blank(v) ? null : typeof v === 'string' ? v.trim() : v);

// ---- normalisation ---------------------------------------------------------------------

const DATA_TYPES = new Set(['Code', 'Date', 'Duration', 'Nominal', 'Numerical', 'Ordinal', 'Text']);
const DATA_TYPE_ALIASES = { numeric: 'Numerical', continuous: 'Numerical', categorical: 'Nominal', string: 'Text' };
const unknownTypes = new Map();

function dataType(raw) {
  if (blank(raw)) return null;
  const s = String(raw).trim();
  const exact = [...DATA_TYPES].find((t) => t.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  if (DATA_TYPE_ALIASES[s.toLowerCase()]) return DATA_TYPE_ALIASES[s.toLowerCase()];
  unknownTypes.set(s, (unknownTypes.get(s) ?? 0) + 1);
  return 'Text'; // not a BrAPI type (e.g. "Time"); the original is kept in additionalInfo.sourceDataType
}

// Source categories are strings like "1 = absent"; BrAPI v2 wants { value, label }.
function category(raw) {
  if (raw && typeof raw === 'object') return { value: clean(raw.value), label: clean(raw.label) ?? clean(raw.value) };
  const s = String(raw).trim();
  const m = s.match(/^(.+?)\s*=\s*([\s\S]+)$/);
  return m ? { value: m[1].trim(), label: m[2].trim() } : { value: s, label: s };
}

function bound(v) {
  if (blank(v)) return { str: null, int: null };
  const n = Number(v);
  return { str: String(v).trim(), int: Number.isInteger(n) ? n : null };
}

function validValues(vv) {
  if (!vv) return null;
  const min = bound(vv.minimumValue ?? vv.min);
  const max = bound(vv.maximumValue ?? vv.max);
  const cats = (vv.categories ?? []).filter((c) => !blank(c)).map(category);
  return {
    minimumValue: min.str, // BrAPI 2.1 (string)
    maximumValue: max.str,
    min: min.int, // BrAPI 2.0 (integer)
    max: max.int,
    categories: cats,
  };
}

function ontologyReference(o) {
  return {
    ontologyDbId: o.ontologyDbId,
    ontologyName: o.ontologyName,
    version: clean(o.version),
    documentationLinks: [{ URL: `https://cropontology.org/ontology/${o.ontologyDbId}`, type: 'WEBPAGE' }],
  };
}

const extRef = (id) => (id ? [{ referenceId: id, referenceID: id, referenceSource: 'cropontology.org' }] : []);

function normaliseVariable(v, o) {
  const ref = ontologyReference(o);
  const id = v.observationVariableDbId;
  const { crop, date, ...rest } = v;
  const trait = v.trait && {
    ...v.trait,
    traitName: clean(v.trait.traitName),
    traitClass: clean(v.trait.traitClass),
    description: clean(v.trait.description),
    traitDescription: clean(v.trait.description),
    synonyms: v.trait.synonyms ?? [],
    alternativeAbbreviations: v.trait.alternativeAbbreviations ?? [],
    externalReferences: extRef(v.trait.traitDbId),
  };
  const method = v.method && {
    ...v.method,
    methodName: clean(v.method.methodName),
    methodClass: clean(v.method.methodClass),
    description: clean(v.method.description),
    formula: clean(v.method.formula),
    reference: clean(v.method.reference),
    externalReferences: extRef(v.method.methodDbId),
  };
  const type = v.scale && dataType(v.scale.dataType);
  const scale = v.scale && {
    ...v.scale,
    scaleName: clean(v.scale.scaleName),
    dataType: type,
    additionalInfo: type === v.scale.dataType || blank(v.scale.dataType)
      ? v.scale.additionalInfo ?? null
      : { ...v.scale.additionalInfo, sourceDataType: v.scale.dataType },
    validValues: validValues(v.scale.validValues),
    externalReferences: extRef(v.scale.scaleDbId),
  };
  return {
    ...rest,
    observationVariableName: clean(v.observationVariableName),
    commonCropName: clean(crop) ?? o.ontologyName,
    contextOfUse: v.contextOfUse ?? [],
    synonyms: v.synonyms ?? [],
    growthStage: clean(v.growthStage),
    institution: clean(v.institution),
    scientist: clean(v.scientist),
    documentationURL: TERM_URL(id),
    submissionTimestamp: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    externalReferences: extRef(id),
    ontologyReference: ref,
    trait,
    method,
    scale,
  };
}

const distinct = (list, key) => {
  const map = new Map();
  for (const item of list) if (item?.[key] && !map.has(item[key])) map.set(item[key], item);
  return [...map.values()];
};

// ---- BrAPI envelopes -------------------------------------------------------------------

const listResponse = (data) => ({
  metadata: {
    pagination: { currentPage: 0, pageSize: Math.max(data.length, 1), totalCount: data.length, totalPages: 1 },
    status: [{ message: `Static copy of ${harvest.source}, last updated ${harvest.updatedAt}`, messageType: 'INFO' }],
    datafiles: [],
  },
  result: { data },
});

const singleResponse = (result) => ({
  metadata: { pagination: { currentPage: 0, pageSize: 1, totalCount: 1, totalPages: 1 }, status: [], datafiles: [] },
  result,
});

const serverInfo = (name, description, calls) => singleResponse({
  serverName: name,
  serverDescription: description,
  documentationURL: 'https://brapi.org/specification',
  calls: calls.map((service) => ({
    service, call: service, methods: ['GET'], versions: BRAPI_VERSIONS,
    dataTypes: ['application/json'], datatypes: ['application/json'],
  })),
});

async function emit(dir, name, body) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), JSON.stringify(body));
}

// ---- build -----------------------------------------------------------------------------

await rm(OUT, { recursive: true, force: true });
await cp(join(ROOT, 'site'), OUT, { recursive: true });
await writeFile(join(OUT, '.nojekyll'), '');

const available = new Set((await readdir(join(DATA, 'variables'))).map((f) => f.replace(/\.json$/, '')));
const snapshotDate = harvest.updatedAt.slice(0, 10);
const index = [];
const brapiOntologies = [];
let total = 0;

for (const o of ontologies) {
  const id = o.ontologyDbId;
  if (!available.has(id)) { console.warn(`  ${id}: no variables harvested, skipped`); continue; }
  const variables = (await readJson(join(DATA, 'variables', `${id}.json`))).map((v) => normaliseVariable(v, o));
  const crops = [...new Map(variables.map((v) => v.commonCropName).filter(Boolean)
    .map((c) => [c.toLowerCase(), c])).values()];
  const ontology = {
    ref: ontologyReference(o),
    ontologyDbId: id,
    ontologyName: o.ontologyName,
    description: clean(o.description),
    version: clean(o.version),
    authors: clean(o.authors),
    copyright: clean(o.copyright),
    licence: clean(o.licence),
    documentationURL: `https://cropontology.org/ontology/${id}`,
    additionalInfo: o.additionalInfo ?? {},
  };
  const { ref: _ref, ...ontologyRecord } = ontology;
  brapiOntologies.push(ontologyRecord);

  const base = join(OUT, id, 'brapi', 'v2');
  const calls = ['serverinfo', 'commoncropnames', 'ontologies', 'variables', 'traits', 'methods', 'scales'];
  await emit(base, 'serverinfo', serverInfo(
    `Crop Ontology mirror: ${o.ontologyName} (${id})`,
    `Read-only static mirror of ${id} copied from cropontology.org (last updated ${snapshotDate}). Lists are served as one page; query parameters are ignored.`,
    calls,
  ));
  await emit(base, 'commoncropnames', listResponse(crops));
  await emit(base, 'ontologies', listResponse([ontologyRecord]));
  await emit(base, 'variables', listResponse(variables));
  // Standalone trait/method/scale records carry their own ontologyReference; nested copies don't.
  const withRef = (list, key) => distinct(list, key).map((x) => ({ ...x, ontologyReference: ontology.ref }));
  await emit(base, 'traits', listResponse(withRef(variables.map((v) => v.trait), 'traitDbId')));
  await emit(base, 'methods', listResponse(withRef(variables.map((v) => v.method), 'methodDbId')));
  await emit(base, 'scales', listResponse(withRef(variables.map((v) => v.scale), 'scaleDbId')));

  index.push({
    id, name: o.ontologyName, description: ontology.description, version: ontology.version,
    licence: ontology.licence, crops, variableCount: variables.length,
    traitClasses: [...new Set(variables.map((v) => v.trait?.traitClass).filter(Boolean))].sort(),
  });
  total += variables.length;
  console.log(`  ${id.padEnd(16)} ${String(variables.length).padStart(5)} variables`);
}

const rootBase = join(OUT, 'brapi', 'v2');
await emit(rootBase, 'serverinfo', serverInfo(
  'Crop Ontology mirror',
  `Read-only static mirror of cropontology.org (last updated ${snapshotDate}). Variables are served per ontology at <ONTOLOGY_ID>/brapi/v2.`,
  ['serverinfo', 'commoncropnames', 'ontologies'],
));
await emit(rootBase, 'ontologies', listResponse(brapiOntologies));
await emit(rootBase, 'commoncropnames', listResponse([...new Map(index.flatMap((o) => o.crops).map((c) => [c.toLowerCase(), c])).values()].sort()));
await writeFile(join(OUT, 'ontologies.json'), JSON.stringify({
  source: harvest.source, updatedAt: harvest.updatedAt, ontologies: index,
}));

if (unknownTypes.size) console.warn('Non-BrAPI scale data types served as Text:', Object.fromEntries(unknownTypes));
console.log(`Built ${index.length} ontologies, ${total} variables -> ${OUT}`);
