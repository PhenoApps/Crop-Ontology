#!/usr/bin/env node
// Compare the two raw copies of each ontology: cropontology.org (data/cropontology) and the Planteome
// GitHub trait dictionaries (data/planteome). Matches variables by ID and compares them field by field,
// ignoring formatting-only differences (whitespace, "1=x" vs "1 = x", "0.0" vs "0", list separators).
//
// Writes reports/comparison.json (full detail, per ontology and per variable) and prints a summary.
// Usage: node scripts/compare.mjs [ONTOLOGY_ID ...]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIncluded } from './curation.mjs';
import { pickTD } from './sources.mjs';
import { FIELDS, comparableFields, diffFields, fieldsNotExported } from './fields.mjs';
import { readTD } from './td.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CO = join(ROOT, 'data', 'cropontology');
const PL = join(ROOT, 'data', 'planteome');
const OUT = join(ROOT, 'reports');
const only = process.argv.slice(2);
const readJson = (f, fallback = null) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback);
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

// ---- compare -------------------------------------------------------------------------------

const coHarvest = readJson(join(CO, 'harvest.json'), {});
const plHarvest = readJson(join(PL, 'harvest.json'), {});
const coOntologies = readJson(join(CO, 'ontologies.json'), []);
const ids = [...new Set([...coOntologies.map((o) => o.ontologyDbId), ...Object.keys(plHarvest.ontologies ?? {})])]
  .filter((id) => isIncluded(id) && (!only.length || only.includes(id))).sort(byId);

// Fields cropontology.org's BrAPI export never fills in any ontology (e.g. trait synonyms) can't be
// compared: every GitHub value would show as a difference. They're skipped and listed in the report.
const allSite = existsSync(join(CO, 'variables'))
  ? readdirSync(join(CO, 'variables')).flatMap((f) => readJson(join(CO, 'variables', f)))
  : [];
const notExported = fieldsNotExported(allSite);

const report = {
  generatedAt: new Date().toISOString(),
  sources: {
    cropontology: { source: coHarvest.source, updatedAt: coHarvest.updatedAt, fieldsNotExported: notExported },
    planteome: { source: plHarvest.source, updatedAt: plHarvest.updatedAt },
  },
  ontologies: {},
};

for (const id of ids) {
  const o = coOntologies.find((x) => x.ontologyDbId === id);
  const pl = plHarvest.ontologies?.[id];
  const entry = {
    name: o?.ontologyName ?? null,
    cropontology: { version: o?.version ?? null, variables: null, note: null },
    planteome: pl ? { repo: pl.repo, commit: pl.commit, committedAt: pl.committedAt, file: null, sheet: null, variables: null, rowsWithoutId: 0, note: null }
      : { note: 'No Planteome repo' },
  };
  const coFile = join(CO, 'variables', `${id}.json`);
  const site = existsSync(coFile) ? readJson(coFile) : null;
  if (site) entry.cropontology.variables = site.length;
  else entry.cropontology.note = o ? 'Not harvested from cropontology.org' : 'Not on cropontology.org';

  let td = null;
  if (pl) {
    const file = pickTD(id, pl.files);
    if (!file) entry.planteome.note = pl.files.length ? 'No trait dictionary file (only ontology exports)' : 'No data files at repo root';
    else {
      try {
        const t = readTD(join(PL, id, file.name));
        entry.planteome.file = file.name;
        entry.planteome.sheet = t.sheet;
        entry.planteome.rowsWithoutId = t.rows.filter((r) => !r['variable id']).length;
        td = new Map(t.rows.filter((r) => r['variable id']).map((r) => [r['variable id'], r]));
        td.header = t.header;
        const usable = new Set(comparableFields(t.header).map(([f]) => f));
        entry.planteome.missingColumns = FIELDS.map(([f]) => f).filter((f) => !usable.has(f));
        entry.planteome.variables = td.size;
      } catch (err) {
        entry.planteome.note = `Could not read ${file.name}: ${err.message}`;
      }
    }
  }

  if (site && td) {
    const siteById = new Map(site.map((v) => [v.observationVariableDbId, v]));
    const onlySite = [...siteById.keys()].filter((k) => !td.has(k)).sort(byId);
    const onlyPlanteome = [...td.keys()].filter((k) => !siteById.has(k)).sort(byId);
    const fieldCounts = {};
    const differences = [];
    let identical = 0;
    const fields = comparableFields(td.header, notExported);
    for (const [vid, v] of siteById) {
      const r = td.get(vid);
      if (!r) continue;
      const diffs = diffFields(v, r, fields);
      for (const { field } of diffs) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
      if (diffs.length) differences.push({ id: vid, name: v.observationVariableName, diffs });
      else identical++;
    }
    Object.assign(entry, {
      inBoth: siteById.size - onlySite.length, identical, differing: differences.length,
      onlyCropontology: onlySite.map((k) => ({ id: k, name: siteById.get(k).observationVariableName })),
      onlyPlanteome: onlyPlanteome.map((k) => ({ id: k, name: td.get(k)['variable name'] })),
      fieldCounts: Object.fromEntries(Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])),
      differences: differences.sort((a, b) => byId(a.id, b.id)),
    });
  }
  report.ontologies[id] = entry;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'comparison.json'), JSON.stringify(report, null, 1) + '\n');

// ---- summary -------------------------------------------------------------------------------

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
console.log(`${pad('ID', 8)}${pad('Name', 20)}${lpad('site', 6)}${lpad('github', 7)}${lpad('both', 6)}${lpad('same', 6)}${lpad('differ', 7)}${lpad('site-only', 10)}${lpad('gh-only', 8)}  top differing fields / note`);
for (const [id, e] of Object.entries(report.ontologies)) {
  const top = e.fieldCounts ? Object.entries(e.fieldCounts).slice(0, 3).map(([f, n]) => `${f} ${n}`).join(', ') : '';
  const missing = e.planteome.missingColumns?.length ? `GitHub file lacks ${e.planteome.missingColumns.length} compared columns` : '';
  const note = [e.cropontology.note, e.planteome.note, missing].filter(Boolean).join('; ');
  const tail = [top, missing].filter(Boolean).join('; ') || note;
  console.log(`${pad(id, 8)}${pad((e.name ?? '').slice(0, 19), 20)}${lpad(e.cropontology.variables ?? '-', 6)}${lpad(e.planteome.variables ?? '-', 7)}${lpad(e.inBoth ?? '-', 6)}${lpad(e.identical ?? '-', 6)}${lpad(e.differing ?? '-', 7)}${lpad(e.onlyCropontology?.length ?? '-', 10)}${lpad(e.onlyPlanteome?.length ?? '-', 8)}  ${tail}`);
}
if (notExported.length) console.log(`\nNot compared (cropontology.org's BrAPI export never fills them): ${notExported.join(', ')}`);
console.log(`Full detail: ${join('reports', 'comparison.json')}`);
