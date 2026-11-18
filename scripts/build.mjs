#!/usr/bin/env node
// Build the static site + static BrAPI v2 tree from the harvested snapshots in data/.
//
// Each ontology merges cropontology.org and its Planteome GitHub trait dictionary variable by variable
// (see scripts/sources.mjs for the rules). Both are normalised through the same path, and every change
// the build makes is published in changes.json.
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
import { displayName, isIncluded, knownBroken, siteReloadsCountFrom } from './curation.mjs';
import { fieldsNotExported } from './fields.mjs';
import { CO_DIR, LABELS, mergeOntology, planteomeCopy, preferredSource } from './sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = CO_DIR;
const OUT = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, '_site');
const TERM_URL = (id) => `https://cropontology.org/term/${id}`;
const BRAPI_VERSIONS = ['2.0', '2.1'];

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const harvest = await readJson(join(DATA, 'harvest.json'));
const planteomeHarvest = await readJson(join(ROOT, 'data', 'planteome', 'harvest.json')).catch(() => ({}));
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

// Spreadsheet software turns category text such as "1-2-3" into a date (2 Jan 2003), and the
// upload stores it as one. Undo that for non-Date scales, choosing between the two possible originals
// ("M-D-YY" or "M-D" with the current year filled in) by which one ends on the scale's top value:
// its maximumValue or the largest number in its name (e.g. "S3_5_9" → 9, "S1_5_by2" → 5).
const EXCEL_DATE = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?$/;
function undoSpreadsheetDate(raw, scale, vv) {
  const m = String(raw).trim().match(EXCEL_DATE);
  if (!m || /^date$/i.test(String(scale?.dataType ?? '').trim())) return { repaired: null, matched: false };
  const [year, month, day] = m.slice(1).map(Number);
  const candidates = [`${month}-${day}-${year % 100}`, `${month}-${day}`];
  const nameNumbers = (String(scale?.scaleName ?? '').replace(/by\d+/gi, '').match(/\d+/g) ?? []).map(Number);
  const tops = new Set([Number(vv?.maximumValue ?? vv?.max), nameNumbers.length ? Math.max(...nameNumbers) : NaN].filter(Number.isFinite));
  const fits = candidates.filter((c) => tops.has(Number(c.split('-').pop())));
  return { repaired: fits.length === 1 ? fits[0] : null, matched: true };
}

function validValues(vv, scale, note) {
  if (!vv) return null;
  const min = bound(vv.minimumValue ?? vv.min);
  const max = bound(vv.maximumValue ?? vv.max);
  const cats = (vv.categories ?? []).filter((c) => !blank(c)).map((c) => {
    const { repaired, matched } = undoSpreadsheetDate(c, scale, vv);
    if (repaired) { note('category', { from: String(c), to: repaired }); return category(repaired); }
    if (matched) note('categoryUnrepaired', { value: String(c) });
    return category(c);
  });
  return {
    minimumValue: min.str, // BrAPI 2.1 (string)
    maximumValue: max.str,
    min: min.int, // BrAPI 2.0 (integer)
    max: max.int,
    // cropontology.org returns categories in arbitrary order; list them in value order.
    categories: cats.sort((a, b) => String(a.value).localeCompare(String(b.value), 'en', { numeric: true })),
  };
}

function ontologyReference(o) {
  return {
    ontologyDbId: o.ontologyDbId,
    ontologyName: o.ontologyName,
    version: clean(o.version),
    documentationLinks: [{ URL: o.documentationURL ?? `https://cropontology.org/ontology/${o.ontologyDbId}`, type: 'WEBPAGE' }],
  };
}

const extRef = (id, src) => (id ? [{ referenceId: id, referenceID: id, referenceSource: src.refSource }] : []);

// Text that was UTF-8 but got decoded as Windows-1252 somewhere upstream ("FranÃ§oise" for "Françoise").
// Reverse it only when the string looks double-encoded and re-decodes as valid UTF-8.
const CP1252 = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e],
  [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]]);
const MOJIBAKE = /[ÃÂâÅÄ][\u0080-¿Œ-Ÿƒˆ˜–-™]/;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const PLAUSIBLE = /^[\x00-\x7f\p{L}\p{M} °±²³µ·½×–—‘’“”…≤≥]*$/u;
function fixEncoding(s) {
  if (typeof s !== 'string' || !MOJIBAKE.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xff) bytes.push(c);
    else if (CP1252.has(c)) bytes.push(CP1252.get(c));
    else return s;
  }
  try {
    const fixed = utf8.decode(Uint8Array.from(bytes));
    // Accept only plausible text: letters, marks and everyday punctuation. A result such as "†" where a
    // dash was meant means the original bytes were already damaged, so leave those as served.
    return fixed !== s && PLAUSIBLE.test(fixed) ? fixed : s;
  } catch { return s; }
}
function fixEncodingDeep(value, found) {
  if (typeof value === 'string') { const f = fixEncoding(value); if (f !== value) found.set(value, f); return f; }
  if (Array.isArray(value)) return value.map((x) => fixEncodingDeep(x, found));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, fixEncodingDeep(x, found)]));
  return value;
}

// Every content change the build makes is recorded here and published as changes.json.
const changes = { renamed: [], cropNames: [], categories: [], categoriesUnrepaired: [], dataTypes: [], encoding: [], fetchedIndividually: [], unavailable: [] };
// Source crop values per ontology, for the crop-name mapping in changes.json: { id: Map(value → count) }.
const sourceCrops = new Map();

function normaliseVariable(raw, o, src) {
  const ref = ontologyReference(o);
  const encodingFixes = new Map();
  const v = fixEncodingDeep(raw, encodingFixes);
  const id = v.observationVariableDbId;
  const at = {
    ontologyDbId: o.ontologyDbId, observationVariableDbId: id, observationVariableName: clean(v.observationVariableName),
    scaleDbId: v.scale?.scaleDbId ?? null, scaleName: clean(v.scale?.scaleName),
  };
  const notes = [];
  for (const [from, to] of encodingFixes) {
    changes.encoding.push({ ...at, from, to });
    notes.push(`Text encoding repaired: "${from}" → "${to}".`);
  }
  const note = (kind, detail) => {
    if (kind === 'category') {
      changes.categories.push({ ...at, ...detail });
      notes.push(`Category "${detail.to}" restored: ${src.label} has it as the date ${detail.from}, a spreadsheet conversion of the original text.`);
    } else if (kind === 'categoryUnrepaired') {
      changes.categoriesUnrepaired.push({ ...at, ...detail });
    }
  };
  const { crop, date, ...rest } = v;
  if (clean(crop)) {
    const counts = sourceCrops.get(o.ontologyDbId) ?? sourceCrops.set(o.ontologyDbId, new Map()).get(o.ontologyDbId);
    counts.set(clean(crop), (counts.get(clean(crop)) ?? 0) + 1);
  }
  const trait = v.trait && {
    ...v.trait,
    traitName: clean(v.trait.traitName),
    traitClass: clean(v.trait.traitClass),
    description: clean(v.trait.description),
    traitDescription: clean(v.trait.description),
    synonyms: v.trait.synonyms ?? [],
    alternativeAbbreviations: v.trait.alternativeAbbreviations ?? [],
    externalReferences: extRef(v.trait.traitDbId, src),
  };
  const method = v.method && {
    ...v.method,
    methodName: clean(v.method.methodName),
    methodClass: clean(v.method.methodClass),
    description: clean(v.method.description),
    formula: clean(v.method.formula),
    reference: clean(v.method.reference),
    externalReferences: extRef(v.method.methodDbId, src),
  };
  const type = v.scale && dataType(v.scale.dataType);
  const typeChanged = v.scale && !blank(v.scale.dataType) && type !== v.scale.dataType;
  if (typeChanged) {
    changes.dataTypes.push({ ...at, from: v.scale.dataType, to: type });
    notes.push(`Scale data type "${v.scale.dataType}" isn't a BrAPI type, so it is served as "${type}".`);
  }
  const vv = v.scale && validValues(v.scale.validValues, v.scale, note);
  const scale = v.scale && {
    ...v.scale,
    scaleName: clean(v.scale.scaleName),
    dataType: type,
    additionalInfo: typeChanged ? { ...v.scale.additionalInfo, sourceDataType: v.scale.dataType } : v.scale.additionalInfo ?? null,
    validValues: vv,
    externalReferences: extRef(v.scale.scaleDbId, src),
  };
  return {
    ...rest,
    observationVariableName: clean(v.observationVariableName),
    // One crop per ontology, named as the ontology, so clients can filter by crop; sources write the same
    // crop many ways ("MAIZE", "sorghum", "Sweetpotato"). The source value is kept in additionalInfo.
    commonCropName: o.ontologyName,
    contextOfUse: v.contextOfUse ?? [],
    synonyms: v.synonyms ?? [],
    growthStage: clean(v.growthStage),
    institution: clean(v.institution),
    scientist: clean(v.scientist),
    documentationURL: src.termUrl(id),
    submissionTimestamp: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    externalReferences: extRef(id, src),
    ontologyReference: ref,
    trait,
    method,
    scale,
    additionalInfo: {
      ...v.additionalInfo,
      ...(clean(crop) && clean(crop) !== o.ontologyName ? { sourceCropName: clean(crop) } : {}),
      ...(notes.length ? { changes: notes } : {}),
    },
  };
}

const distinct = (list, key) => {
  const map = new Map();
  for (const item of list) if (item?.[key] && !map.has(item[key])) map.set(item[key], item);
  return [...map.values()];
};

// ---- BrAPI envelopes -------------------------------------------------------------------

const listResponse = (data, message = 'PhenoApps Crop Ontology: trait dictionaries merged from cropontology.org and Planteome GitHub') => ({
  metadata: {
    pagination: { currentPage: 0, pageSize: Math.max(data.length, 1), totalCount: data.length, totalPages: 1 },
    status: [{ message, messageType: 'INFO' }],
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
// site/README.md documents the source folder; it isn't part of the published site.
await cp(join(ROOT, 'site'), OUT, { recursive: true, filter: (src) => !/README\.md$/i.test(src) });
await writeFile(join(OUT, '.nojekyll'), '');

const available = new Set((await readdir(join(DATA, 'variables')).catch(() => [])).map((f) => f.replace(/\.json$/, '')));
const index = [];
const brapiOntologies = [];
let total = 0;
changes.sources = [];
changes.duplicates = [];
changes.obsoleteExcluded = [];
changes.idConflicts = [];
const allVariables = [];

// How to label and link back to each copy of an ontology.
function sourcesFor(id, planteome) {
  const out = {
    cropontology: {
      use: 'cropontology', label: LABELS.cropontology, url: `https://cropontology.org/ontology/${id}`,
      refSource: 'cropontology.org', termUrl: TERM_URL,
    },
  };
  if (planteome?.usable) {
    const fileUrl = `${planteome.repo}/blob/${planteome.commit}/${planteome.path}`;
    out.planteome = {
      use: 'planteome', label: LABELS.planteome, url: fileUrl, file: planteome.file, commit: planteome.commit,
      date: planteome.date, refSource: planteome.repo.replace(/^https:\/\//, ''), termUrl: () => fileUrl,
    };
  }
  return out;
}

// Fields the site's export never fills can't be compared (see scripts/fields.mjs).
const allSiteVariables = [];
for (const id of available) allSiteVariables.push(...await readJson(join(DATA, 'variables', `${id}.json`)));
const notExported = fieldsNotExported(allSiteVariables);

// Every included ontology from either source; cropontology.org supplies the metadata when it has a record.
const siteRecords = new Map(ontologies.map((o) => [o.ontologyDbId, o]));
const ids = [...new Set([...siteRecords.keys(), ...Object.keys(planteomeHarvest.ontologies ?? {})])]
  .filter(isIncluded).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

for (const id of ids) {
  const site = siteRecords.get(id);
  const planteome = planteomeCopy(id, planteomeHarvest);
  const siteHasVariables = available.has(id);
  const siteState = harvest.ontologies?.[id];
  const name = site?.ontologyName ?? displayName(id, planteome?.repo?.split('/').pop().replace(/^CO_\d+-|-traits$/g, '').replace(/-/g, ' ') ?? id);
  const { prefer, reason } = preferredSource(id, { siteState, siteHasVariables, planteome });
  if (!prefer) {
    console.warn(`  ${id}: no usable copy in either source, skipped`);
    changes.unavailable.push({ ontologyDbId: id, ontologyName: name, reason: knownBroken[id] ?? 'No usable copy in either source.' });
    continue;
  }
  const srcs = sourcesFor(id, planteome);
  const o = {
    ...(site ?? { ontologyDbId: id, ontologyName: name, additionalInfo: {} }),
    documentationURL: srcs[prefer].url,
  };
  if (site?.additionalInfo?.sourceOntologyName) {
    changes.renamed.push({ ontologyDbId: id, from: site.additionalInfo.sourceOntologyName, to: site.ontologyName });
  }
  if (siteHasVariables && siteState?.fetchedVia === 'per-variable') {
    changes.fetchedIndividually.push({ ontologyDbId: id, ontologyName: o.ontologyName, reason: knownBroken[id] ?? null });
  }

  const merged = mergeOntology({
    id, ontologyName: o.ontologyName, prefer, notExported, planteome,
    siteVariables: siteHasVariables ? await readJson(join(DATA, 'variables', `${id}.json`)) : null,
  });
  const other = prefer === 'planteome' ? 'cropontology' : 'planteome';
  const variables = merged.variables.map(({ raw, source, status, diffs }) => {
    const v = normaliseVariable(raw, o, srcs[source]);
    const provenance = {
      source: LABELS[source],
      ...(status === 'agree' ? { alsoIn: LABELS[other] } : {}),
      ...(status === 'disagree' ? { differsFrom: LABELS[other], differingFields: diffs.map((d) => d.field) } : {}),
    };
    return { ...v, additionalInfo: { ...v.additionalInfo, provenance } };
  }).sort((a, b) => a.observationVariableDbId.localeCompare(b.observationVariableDbId, 'en', { numeric: true }));

  const s = merged.stats;
  const fromCount = Object.fromEntries(['cropontology', 'planteome'].map((k) => [k, merged.variables.filter((x) => x.source === k).length]));
  changes.sources.push({
    ontologyDbId: id, ontologyName: o.ontologyName, preferred: LABELS[prefer], reason,
    planteomeFile: planteome?.file ?? null, planteomeUsable: planteome?.usable ?? false,
    planteomeDate: planteome?.date ?? null, cropontologyLoadedAt: siteState?.loadedAt ?? null,
    served: variables.length, fromCropontology: fromCount.cropontology, fromPlanteome: fromCount.planteome,
    agree: s.agree, disagree: s.disagree, onlyCropontology: s.onlyCropontology, onlyPlanteome: s.onlyPlanteome,
    duplicatesLeftOut: s.duplicates.length, obsoleteLeftOut: s.obsolete.length,
  });
  for (const d of s.duplicates) changes.duplicates.push({ ontologyDbId: id, ...d, source: LABELS[d.source] });
  if (s.obsolete.length) changes.obsoleteExcluded.push({ ontologyDbId: id, ontologyName: o.ontologyName, count: s.obsolete.length });

  const crops = [...new Map(variables.map((v) => v.commonCropName).filter(Boolean)
    .map((c) => [c.toLowerCase(), c])).values()];
  const sourceInfo = {
    preferred: LABELS[prefer], reason,
    fromCropontology: fromCount.cropontology, fromPlanteome: fromCount.planteome,
    ...(srcs.planteome ? { planteomeFile: srcs.planteome.url } : {}),
  };
  const version = prefer === 'planteome' ? planteome.date : siteState?.loadedAt ?? site?.version ?? null;
  const ontology = {
    ref: ontologyReference(o),
    ontologyDbId: id,
    ontologyName: o.ontologyName,
    description: clean(o.description),
    version: clean(version),
    authors: clean(o.authors),
    copyright: clean(o.copyright),
    licence: clean(o.licence),
    documentationURL: srcs[prefer].url,
    additionalInfo: {
      ...o.additionalInfo,
      provenance: sourceInfo,
      // For crop pickers: how big this ontology is, and where its own subset lives. The path is relative
      // to the site root, i.e. the all-ontology base URL with its trailing "brapi/v2" removed.
      variableCount: variables.length,
      commonCropName: o.ontologyName,
      brapiBasePath: `${id}/brapi/v2`,
    },
  };
  const { ref: _ref, ...ontologyRecord } = ontology;
  brapiOntologies.push(ontologyRecord);

  const mix = Object.entries(fromCount).filter(([, n]) => n).map(([k, n]) => `${n} from ${LABELS[k]}`).join(', ');
  const message = `PhenoApps Crop Ontology, ${id}: ${mix}`;
  const list = (data) => listResponse(data, message);
  const base = join(OUT, id, 'brapi', 'v2');
  const calls = ['serverinfo', 'commoncropnames', 'ontologies', 'variables', 'traits', 'methods', 'scales'];
  await emit(base, 'serverinfo', serverInfo(
    `PhenoApps Crop Ontology: ${o.ontologyName} (${id})`,
    `Read-only static copy of ${id} (${mix}). Lists are served as one page; query parameters are ignored.`,
    calls,
  ));
  await emit(base, 'commoncropnames', list(crops));
  await emit(base, 'ontologies', list([ontologyRecord]));
  await emit(base, 'variables', list(variables));
  // The same trait/method/scale ID with different names (within a source, or across the two copies): the
  // standalone lists can only show one record per ID, so record it. Each variable keeps its own nested copy.
  for (const [kind, idKey, nameKey] of [['trait', 'traitDbId', 'traitName'], ['method', 'methodDbId', 'methodName'], ['scale', 'scaleDbId', 'scaleName']]) {
    const names = new Map();
    for (const v of variables) {
      const t = v[kind];
      if (!t?.[idKey]) continue;
      const n = String(t[nameKey] ?? '').trim();
      if (!names.has(t[idKey])) names.set(t[idKey], new Map());
      names.get(t[idKey]).set(n.toLowerCase(), n);
    }
    for (const [tid, ns] of names) {
      if (ns.size > 1) changes.idConflicts.push({ ontologyDbId: id, kind, id: tid, names: [...ns.values()] });
    }
  }
  allVariables.push(...variables);
  // Standalone trait/method/scale records carry their own ontologyReference; nested copies don't.
  const withRef = (items, key) => distinct(items, key).map((x) => ({ ...x, ontologyReference: ontology.ref }));
  await emit(base, 'traits', list(withRef(variables.map((v) => v.trait), 'traitDbId')));
  await emit(base, 'methods', list(withRef(variables.map((v) => v.method), 'methodDbId')));
  await emit(base, 'scales', list(withRef(variables.map((v) => v.scale), 'scaleDbId')));

  index.push({
    id, name: o.ontologyName, description: ontology.description, version: ontology.version,
    licence: ontology.licence, crops, variableCount: variables.length,
    traitClasses: [...new Set(variables.map((v) => v.trait?.traitClass).filter(Boolean))].sort(),
    source: {
      preferred: prefer, label: LABELS[prefer], reason, cropontologyUrl: site ? srcs.cropontology.url : null,
      planteomeUrl: srcs.planteome?.url ?? null, planteomeFile: srcs.planteome?.file ?? null,
      fromCropontology: fromCount.cropontology, fromPlanteome: fromCount.planteome,
    },
  });
  total += variables.length;
  console.log(`  ${id.padEnd(9)} ${String(variables.length).padStart(5)} variables  ${mix.padEnd(52)} prefer ${LABELS[prefer]}`);
}

for (const [id, counts] of sourceCrops) {
  const to = index.find((x) => x.id === id)?.name;
  const from = [...counts].filter(([c]) => c !== to).map(([value, count]) => ({ value, count }));
  if (to && from.length) changes.cropNames.push({ ontologyDbId: id, to, from });
}

const sourcesSummary = {
  cropontology: { label: LABELS.cropontology, url: 'https://cropontology.org', checked: harvest.updatedAt },
  planteome: { label: LABELS.planteome, url: planteomeHarvest.source ?? 'https://github.com/Planteome', checked: planteomeHarvest.updatedAt ?? null },
};
// One base URL for everything: every ontology's variables, traits, methods and scales. Static hosting
// can't filter, so clients filter by ontologyReference/commonCropName themselves. Per-ontology bases
// (<ONTOLOGY_ID>/brapi/v2) serve the same records split by ontology.
const rootBase = join(OUT, 'brapi', 'v2');
await emit(rootBase, 'serverinfo', serverInfo(
  'PhenoApps Crop Ontology',
  'Read-only static Crop Ontology trait dictionaries, merged from cropontology.org and the Planteome GitHub repos. This base URL serves every ontology; <ONTOLOGY_ID>/brapi/v2 serves one. Lists are served as one page; query parameters are ignored.',
  ['serverinfo', 'commoncropnames', 'ontologies', 'variables', 'traits', 'methods', 'scales'],
));
await emit(rootBase, 'ontologies', listResponse(brapiOntologies));
await emit(rootBase, 'variables', listResponse(allVariables));
const withOwnRef = (kind, key) => distinct(allVariables.map((v) => v[kind] && { ...v[kind], ontologyReference: v.ontologyReference }), key);
await emit(rootBase, 'traits', listResponse(withOwnRef('trait', 'traitDbId')));
await emit(rootBase, 'methods', listResponse(withOwnRef('method', 'methodDbId')));
await emit(rootBase, 'scales', listResponse(withOwnRef('scale', 'scaleDbId')));
await emit(rootBase, 'commoncropnames', listResponse([...new Map(index.flatMap((o) => o.crops).map((c) => [c.toLowerCase(), c])).values()].sort()));
// Public record of everything the build changes relative to its sources (see the site's Changes page).
await writeFile(join(OUT, 'changes.json'), JSON.stringify({
  sourceSummary: sourcesSummary,
  policy: {
    include: 'Only CO-numbered ontologies (CO_###) are included.',
    merge: [
      'Each ontology serves every variable found in either cropontology.org or its Planteome GitHub trait dictionary.',
      'Where both have a variable and its details agree, it is served as is.',
      `Where they disagree, the Planteome GitHub version is used, unless cropontology.org changed the ontology later than the GitHub file: a reload on or after ${siteReloadsCountFrom} (earlier reloads were the site's 2023 migration) or an edit to the site seen by the harvester.`,
      'A variable that only one copy has, but whose name matches a variable under a different ID in the preferred copy, is treated as the same variable renumbered and left out.',
      'A GitHub trait dictionary is only used if it has trait, method and scale columns.',
    ],
    formatting: [
      'List responses put records under result.data, as the BrAPI v2 specification requires.',
      'Scale categories written as "value = label" are split into BrAPI { value, label } objects.',
      'Scale categories are listed in value order; cropontology.org returns them in no fixed order.',
      'Scale limits are given both as BrAPI 2.1 minimumValue/maximumValue strings and BrAPI 2.0 min/max integers.',
      'Variables marked obsolete in a GitHub trait dictionary are left out, as cropontology.org leaves them out.',
      'Each variable records where it came from in additionalInfo.provenance.',
      "Every variable's commonCropName is its ontology's name, one crop per ontology, so clients can filter by crop; the source's own crop value is kept in additionalInfo.sourceCropName.",
    ],
  },
  ...changes,
}));
await writeFile(join(OUT, 'ontologies.json'), JSON.stringify({ sources: sourcesSummary, ontologies: index }));

const sum = (k) => changes.sources.reduce((n, x) => n + (x[k] ?? 0), 0);
console.log(`Merge: ${sum('fromPlanteome')} variables from ${LABELS.planteome}, ${sum('fromCropontology')} from ${LABELS.cropontology}; ${sum('agree')} agree, ${sum('disagree')} disagree, ${sum('onlyPlanteome')} only on GitHub, ${sum('onlyCropontology')} only on the site, ${sum('duplicatesLeftOut')} renumbered duplicates and ${sum('obsoleteLeftOut')} obsolete left out`);
console.log(`ID conflicts: ${changes.idConflicts.length}`);
console.log(`Changes: ${changes.renamed.length} renamed, ${changes.categories.length} categories restored (${changes.categoriesUnrepaired.length} left as served), ${changes.dataTypes.length} data types mapped, ${changes.encoding.length} encoding repairs, ${changes.fetchedIndividually.length} fetched individually, ${changes.unavailable.length} unavailable`);
if (unknownTypes.size) console.warn('Non-BrAPI scale data types served as Text:', Object.fromEntries(unknownTypes));
console.log(`Built ${index.length} ontologies, ${total} variables -> ${OUT}`);
