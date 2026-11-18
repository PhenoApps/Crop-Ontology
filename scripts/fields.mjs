// Field-by-field comparison of a cropontology.org BrAPI variable with a Planteome trait dictionary row.
// Shared by scripts/compare.mjs (the report) and scripts/sources.mjs (the per-variable merge).

import { tdCategories } from './td.mjs';

// ---- normalisation for comparison --------------------------------------------------------

const text = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
// Names and classes: capitalisation alone isn't a difference (OBO exports lowercase term names).
const caseless = (v) => text(v).toLowerCase();
const num = (v) => { const s = text(v); return s !== '' && Number.isFinite(Number(s)) ? String(Number(s)) : s; };
const list = (v) => (Array.isArray(v) ? v : text(v).split(/\s*[;,]\s*/)).map(text).filter(Boolean).sort().join(' | ');
const cat = (c) => { const m = text(c).match(/^(.+?)\s*=\s*(.*)$/); return m ? `${m[1].trim()} = ${m[2].trim()}` : text(c); };
// Order is ignored: cropontology.org returns categories in arbitrary order.
const cats = (arr) => arr.map(cat).filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join(' | ');

// Field definitions: [name, from cropontology.org BrAPI record, from TD row, normaliser].
// The TD column a field reads is its name, except where TD_COLUMN says otherwise.
export const FIELDS = [
  ['variable name', (v) => v.observationVariableName, (r) => r['variable name'], text],
  ['variable synonyms', (v) => v.synonyms, (r) => r['variable synonyms'], list],
  ['context of use', (v) => v.contextOfUse, (r) => r['context of use'], list],
  ['growth stage', (v) => v.growthStage, (r) => r['growth stage'], text],
  ['variable status', (v) => v.status, (r) => r['variable status'], text],
  ['institution', (v) => v.institution, (r) => r.institution, text],
  ['scientist', (v) => v.scientist, (r) => r.scientist, text],
  ['crop', (v) => v.crop, (r) => r.crop, (x) => text(x).toLowerCase()],
  ['trait id', (v) => v.trait?.traitDbId, (r) => r['trait id'], text],
  ['trait name', (v) => v.trait?.traitName, (r) => r['trait name'], caseless],
  ['trait class', (v) => v.trait?.traitClass, (r) => r['trait class'], caseless],
  ['trait description', (v) => v.trait?.description, (r) => r['trait description'], text],
  ['trait synonyms', (v) => v.trait?.synonyms, (r) => r['trait synonyms'], list],
  ['main trait abbreviation', (v) => v.trait?.mainAbbreviation, (r) => r['main trait abbreviation'], text],
  ['entity', (v) => v.trait?.entity, (r) => r.entity, text],
  ['attribute', (v) => v.trait?.attribute, (r) => r.attribute, text],
  ['method id', (v) => v.method?.methodDbId, (r) => r['method id'], text],
  ['method name', (v) => v.method?.methodName, (r) => r['method name'], caseless],
  ['method class', (v) => v.method?.methodClass, (r) => r['method class'], caseless],
  ['method description', (v) => v.method?.description, (r) => r['method description'], text],
  ['formula', (v) => v.method?.formula, (r) => r.formula, text],
  ['method reference', (v) => v.method?.reference, (r) => r['method reference'], text],
  ['scale id', (v) => v.scale?.scaleDbId, (r) => r['scale id'], text],
  ['scale name', (v) => v.scale?.scaleName, (r) => r['scale name'], caseless],
  ['scale class', (v) => v.scale?.dataType, (r) => r['scale class'], (x) => text(x).toLowerCase()],
  ['decimal places', (v) => v.scale?.decimalPlaces, (r) => r['decimal places'], num],
  ['lower limit', (v) => v.scale?.validValues?.minimumValue, (r) => r['lower limit'], num],
  ['upper limit', (v) => v.scale?.validValues?.maximumValue, (r) => r['upper limit'], num],
  ['categories', (v) => v.scale?.validValues?.categories ?? [], (r) => tdCategories(r), cats],
];

const TD_COLUMN = { 'variable synonyms': 'variable synonyms', categories: null };
export const hasColumn = (header, field) => (field === 'categories'
  ? header.some((h) => /^(category|cat) \d+/.test(h))
  : header.includes(TD_COLUMN[field] ?? field));

// Fields cropontology.org's BrAPI export never fills in any ontology (e.g. trait synonyms): comparing them
// would flag every GitHub value, so they're skipped.
export const fieldsNotExported = (siteVariables) => FIELDS
  .filter(([, fromSite, , norm]) => !siteVariables.some((v) => norm(fromSite(v) ?? '') !== ''))
  .map(([f]) => f);

// The fields worth comparing for a given TD header.
export const comparableFields = (header, notExported = []) => FIELDS
  .filter(([f]) => !notExported.includes(f) && hasColumn(header, f));

// [{ field, cropontology, planteome }] for the fields that differ.
export function diffFields(siteVariable, row, fields) {
  const out = [];
  for (const [field, fromSite, fromTD, norm] of fields) {
    const a = norm(fromSite(siteVariable) ?? '');
    const b = norm(fromTD(row) ?? '');
    if (a !== b) out.push({ field, cropontology: a, planteome: b });
  }
  return out;
}
