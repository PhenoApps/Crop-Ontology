// Read Crop Ontology trait dictionary (TD v5) files, as kept in the Planteome repos, into row objects.
// Handles CSV/TSV (comma, semicolon or tab; quoted fields; BOM) and .xlsx (via a minimal zip + sheet reader,
// no dependencies). Rows come back keyed by normalised header ("variable id", "trait name", "category 1", ...).

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// TD v5 column names. Headers that are a truncation of one of these (spreadsheets have cut
// "Trait description" to "Trait descriptio") are mapped back to the full name.
const TD_COLUMNS = [
  'curation', 'variable id', 'variable name', 'variable label', 'variable description', 'variable synonyms',
  'context of use', 'growth stage', 'variable status', 'variable xref', 'institution', 'scientist', 'date',
  'language', 'crop', 'trait id', 'trait name', 'trait class', 'trait description', 'trait synonyms',
  'main trait abbreviation', 'alternative trait abbreviations', 'entity', 'attribute', 'trait status',
  'trait xref', 'method id', 'method name', 'method class', 'method description', 'formula',
  'method reference', 'scale id', 'scale name', 'scale class', 'decimal places', 'lower limit',
  'upper limit', 'scale xref',
];

export const normHeader = (h) => {
  const s = String(h ?? '').replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (s.length < 8 || TD_COLUMNS.includes(s) || /^(category|cat) \d+/.test(s)) return s;
  return TD_COLUMNS.find((c) => c.startsWith(s)) ?? s;
};

// ---- CSV -------------------------------------------------------------------------------

export function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

// ---- XLSX ------------------------------------------------------------------------------

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, () => (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xmlText = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()]));
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export function parseXlsxSheets(buf) {
  const zip = unzip(buf);
  const read = (name) => zip.get(name)?.() ?? '';
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]));
  const sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: xmlText(m[0].match(/name="([^"]*)"/)?.[1] ?? ''),
    path: (() => { const t = rels[m[0].match(/r:id="([^"]+)"/)?.[1]] ?? ''; return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`; })(),
  }));
  return sheets.map(({ name, path }) => {
    const rows = [];
    for (const r of read(path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1];
        const type = c[1].match(/t="(\w+)"/)?.[1];
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? texts(body) : v != null ? xmlText(v) : '';
        row[ref ? colIndex(ref) : row.length] = value;
      }
      rows.push(Array.from(row, (x) => x ?? ''));
    }
    return { name, rows };
  });
}

// ---- OBO -------------------------------------------------------------------------------

const oboUnquote = (s) => s.match(/^"((?:[^"\\]|\\.)*)"/)?.[1].replace(/\\(.)/g, '$1') ?? s;

export function parseOBO(text) {
  const terms = new Map();
  for (const block of text.split(/\r?\n(?=\[)/)) {
    if (!block.startsWith('[Term]')) continue;
    const t = { synonyms: [], isA: [], rel: [], obsolete: false };
    for (const line of block.split(/\r?\n/).slice(1)) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const [, tag, raw] = m;
      const value = raw.replace(/\s+!.*$/, '').trim(); // drop "! comment"
      if (tag === 'id') t.id = value;
      else if (tag === 'name') t.name = raw.trim();
      else if (tag === 'namespace') t.namespace = value;
      else if (tag === 'def') t.def = oboUnquote(raw.trim());
      else if (tag === 'synonym') t.synonyms.push(oboUnquote(raw.trim()));
      else if (tag === 'is_a') t.isA.push(value);
      else if (tag === 'relationship') { const [type, target] = value.split(/\s+/); t.rel.push({ type, target }); }
      else if (tag === 'is_obsolete') t.obsolete = value === 'true';
    }
    if (t.id) terms.set(t.id, t);
  }
  return terms;
}

// Crop Ontology OBO exports (TD2OBO) as TD-like rows: a variable is a term with variable_of links to its
// trait, method and scale (told apart by namespace, e.g. BananaTrait); a class or data type is the target's
// is_a parent; scale categories are the scale's is_a children (synonym = value, name = label); the
// variable's short name is its first synonym. Obsolete terms are left out.
export function readOBO(file) {
  const terms = parseOBO(readFileSync(file, 'utf8'));
  const children = new Map();
  for (const t of terms.values()) for (const p of t.isA) (children.get(p) ?? children.set(p, []).get(p)).push(t);
  const parentName = (t) => t?.isA.map((p) => terms.get(p)?.name).find(Boolean)?.replace(/_/g, ' ') ?? '';
  const tidy = (s) => String(s ?? '').replace(/[,;\s]+$/, '').trim();
  const rows = [];
  for (const v of terms.values()) {
    const targets = v.rel.filter((r) => r.type === 'variable_of').map((r) => terms.get(r.target)).filter(Boolean);
    if (!targets.length || v.obsolete) continue;
    const of = (kind) => targets.find((t) => new RegExp(`${kind}$`, 'i').test(t.namespace ?? ''));
    const [trait, method, scale] = [of('trait'), of('method'), of('scale')];
    // A synonym can hold several comma-separated names ("PlntShtTime_Comp_d, plant2shoot"); the first is the
    // variable's short name, the rest are synonyms.
    const names = v.synonyms.flatMap((s) => s.split(/\s*,\s*/)).map(tidy).filter(Boolean);
    const row = {
      'variable id': v.id,
      'variable name': names[0] ?? v.name ?? '',
      'variable label': v.name ?? '',
      'variable synonyms': names.slice(1).join(', '),
      'trait id': trait?.id ?? '', 'trait name': trait?.name ?? '', 'trait class': parentName(trait),
      'trait description': trait?.def ?? '', 'trait synonyms': (trait?.synonyms ?? []).map(tidy).join(', '),
      'method id': method?.id ?? '', 'method name': method?.name ?? '', 'method class': parentName(method),
      'method description': method?.def ?? '',
      'scale id': scale?.id ?? '', 'scale name': scale?.name ?? '', 'scale class': parentName(scale),
    };
    (scale ? children.get(scale.id) ?? [] : [])
      .filter((c) => !c.obsolete)
      .map((c) => (c.synonyms[0] != null ? `${tidy(c.synonyms[0])} = ${c.name}` : c.name))
      .forEach((c, i) => { row[`category ${i + 1}`] = c; });
    rows.push(row);
  }
  const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { sheet: null, header, rows };
}

// ---- TD --------------------------------------------------------------------------------

// Rows keyed by header, from the first sheet/table whose header row (within the first 15 rows) has "Variable ID".
// OBO files are read with readOBO.
export function readTD(file) {
  if (/\.obo$/i.test(file)) return readOBO(file);
  const buf = readFileSync(file);
  const tables = /\.xlsx$/i.test(file)
    ? parseXlsxSheets(buf).map((s) => ({ name: s.name, rows: s.rows }))
    : [{ name: null, rows: parseDelimited(buf.toString('utf8')) }];
  for (const t of tables) {
    const h = t.rows.slice(0, 15).findIndex((r) => r.some((c) => normHeader(c) === 'variable id'));
    if (h < 0) continue;
    const header = t.rows[h].map(normHeader);
    const rows = t.rows.slice(h + 1)
      .filter((r) => r.some((c) => String(c).trim() !== ''))
      .map((r) => Object.fromEntries(header.map((k, i) => [k, String(r[i] ?? '').trim()]).filter(([k]) => k)));
    return { sheet: t.name, header, rows };
  }
  throw new Error(`no "Variable ID" header found in ${file}`);
}

// Categories from a TD row: "Category 1".."Category N" ("1 = absent"), or "Cat N Code" + "Cat N Description".
export function tdCategories(r) {
  const out = [];
  for (let i = 1; i <= 50; i++) {
    const plain = r[`category ${i}`];
    const code = r[`cat ${i} code`];
    const desc = r[`cat ${i} description`];
    if (plain) out.push(plain);
    else if (code || desc) out.push(desc ? `${code} = ${desc}` : code);
  }
  return out;
}
