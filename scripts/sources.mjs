// Merging the two raw copies of an ontology, variable by variable, and converting Planteome trait
// dictionary rows into the same BrAPI-variable shape cropontology.org serves.
//
// Policy (agreed 2026-11-18):
//   - Serve the union of both copies' variables, so no term is lost because only one source has it.
//   - Where both have a variable and its fields agree, serve it as is.
//   - Where they disagree, use the preferred copy: Planteome GitHub, unless cropontology.org changed
//     later — a reload of the ontology on or after curation.json siteReloadsCountFrom (earlier reloads
//     are the site's 2023 migration), or an edit the harvester saw — than the GitHub file's last commit.
//     curation.json `sources` forces the preferred copy per ontology.
//   - A variable only one copy has, whose name matches a variable under a different ID in the preferred
//     copy, is taken to be the same variable renumbered and left out.
//   - Variables marked obsolete on GitHub are left out (cropontology.org never serves obsolete ones); one
//     that's obsolete on GitHub but current on the site follows the preferred copy.
// A Planteome file can only contribute if it has trait, method and scale columns.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planteomeFiles, siteReloadsCountFrom, sourceOverrides } from './curation.mjs';
import { comparableFields, diffFields } from './fields.mjs';
import { readTD, tdCategories } from './td.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CO_DIR = join(ROOT, 'data', 'cropontology');
export const PL_DIR = join(ROOT, 'data', 'planteome');
const readJson = (f, fallback = null) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback);

// Short names for the two sources, as shown to users.
export const LABELS = { cropontology: 'Crop Ontology', planteome: 'Planteome' };

// Which file in a Planteome repo to use: curation.json planteomeFiles override, else a CSV named like a
// TD, else any CSV, else an .xlsx, else an OBO export (Banana has only that); "staging" files are skipped.
export function pickTD(id, files) {
  if (planteomeFiles[id]) return files.find((f) => f.name === planteomeFiles[id]) ?? null;
  const usable = files.filter((f) => /\.(csv|tsv|xlsx|obo)$/i.test(f.name) && !/staging/i.test(f.name));
  return usable.find((f) => /\.(csv|tsv)$/i.test(f.name) && /td|trait_dictionary/i.test(f.name))
    ?? usable.find((f) => /\.(csv|tsv)$/i.test(f.name))
    ?? usable.find((f) => /\.xlsx$/i.test(f.name))
    ?? usable.find((f) => /\.obo$/i.test(f.name)) ?? null;
}

export const isObsolete = (r) => /obsolete/i.test(`${r['variable status'] ?? ''} ${r.curation ?? ''}`)
  || /_obsolete$/i.test(r['variable name'] ?? '');

const REQUIRED = ['trait id', 'method id', 'scale id'];

// Everything known about an ontology's Planteome copy, or null if there's no repo.
export function planteomeCopy(id, harvest = readJson(join(PL_DIR, 'harvest.json'), {})) {
  const repo = harvest.ontologies?.[id];
  if (!repo) return null;
  const file = pickTD(id, repo.files);
  const copy = { repo: repo.repo, commit: repo.commit, file: file?.name ?? null, path: file?.path ?? file?.name ?? null,
    date: file?.committedAt ?? null, header: [], rows: [], obsoleteIds: new Set(), usable: false, reason: null };
  if (!file) { copy.reason = repo.files.length ? 'no trait dictionary file' : 'no data files'; return copy; }
  try {
    const td = readTD(join(PL_DIR, id, file.name));
    const missing = REQUIRED.filter((c) => !td.header.includes(c));
    const withId = td.rows.filter((r) => r['variable id']);
    copy.header = td.header;
    copy.obsoleteIds = new Set(withId.filter(isObsolete).map((r) => r['variable id']));
    copy.rows = withId.filter((r) => !isObsolete(r));
    copy.usable = !missing.length && copy.rows.length > 0;
    if (missing.length) copy.reason = `${file.name} has no ${missing.join('/')} columns`;
    else if (!copy.rows.length) copy.reason = `${file.name} has no current variables`;
  } catch (err) {
    copy.reason = `could not read ${file.name}: ${err.message}`;
  }
  return copy;
}

const time = (s) => { const t = Date.parse(String(s ?? '').replace(' ', 'T')); return Number.isFinite(t) ? t : null; };
const day = (s) => String(s ?? '').slice(0, 10);

// Which copy wins where both have a variable and they disagree: { prefer, reason }.
export function preferredSource(id, { siteState, siteHasVariables, planteome }) {
  const override = sourceOverrides[id];
  if (override === 'planteome' && planteome?.usable) return { prefer: 'planteome', reason: 'set in curation.json' };
  if (override === 'cropontology' && siteHasVariables) return { prefer: 'cropontology', reason: 'set in curation.json' };
  if (!planteome?.usable) return { prefer: siteHasVariables ? 'cropontology' : null, reason: planteome ? `Planteome copy unusable: ${planteome.reason}` : 'no Planteome repo' };
  if (!siteHasVariables) return { prefer: 'planteome', reason: 'not available from Crop Ontology' };
  const gh = time(planteome.date);
  const siteChanges = [
    time(siteState?.loadedAt) >= time(siteReloadsCountFrom) ? { what: 'reloaded', at: siteState.loadedAt } : null,
    siteState?.editObservedAt ? { what: 'edited', at: siteState.editObservedAt } : null,
  ].filter(Boolean).sort((a, b) => time(b.at) - time(a.at));
  const latest = siteChanges[0];
  if (latest && gh != null && time(latest.at) > gh) {
    return { prefer: 'cropontology', reason: `Crop Ontology ${latest.what} ${day(latest.at)}, after the Planteome file's last change (${day(planteome.date)})` };
  }
  return { prefer: 'planteome', reason: `Planteome preferred; no change on Crop Ontology since the Planteome file's last change (${day(planteome.date)})` };
}

// Merge one ontology's two copies. Returns the variables to serve, each with where it came from, plus counts.
export function mergeOntology({ id, ontologyName, siteVariables, planteome, prefer, notExported = [] }) {
  const fromGH = (r) => tdRowToVariable(r, id, ontologyName);
  const stats = { agree: 0, disagree: 0, onlyCropontology: 0, onlyPlanteome: 0, duplicates: [], obsolete: [] };
  const usableGH = planteome?.usable ? planteome : null;
  if (!usableGH) {
    const variables = (siteVariables ?? []).map((raw) => ({ raw, source: 'cropontology', status: 'only' }));
    return { variables, stats: { ...stats, onlyCropontology: variables.length } };
  }
  if (!siteVariables) {
    const variables = usableGH.rows.map((r) => ({ raw: fromGH(r), source: 'planteome', status: 'only', planteomeLine: r.line }));
    return { variables, stats: { ...stats, onlyPlanteome: variables.length, obsolete: [...usableGH.obsoleteIds] } };
  }
  const fields = comparableFields(usableGH.header, notExported);
  const ghById = new Map(usableGH.rows.map((r) => [r['variable id'], r]));
  const siteById = new Map(siteVariables.map((v) => [v.observationVariableDbId, v]));
  const out = [];
  const candidates = []; // only in one copy; checked for renumbered duplicates below
  for (const [vid, v] of siteById) {
    const r = ghById.get(vid);
    if (r) {
      const diffs = diffFields(v, r, fields);
      const raw = prefer === 'planteome' ? fromGH(r) : v;
      out.push({ raw, source: prefer, status: diffs.length ? 'disagree' : 'agree', diffs, planteomeLine: r.line });
      stats[diffs.length ? 'disagree' : 'agree']++;
    } else if (usableGH.obsoleteIds.has(vid) && prefer === 'planteome') {
      stats.obsolete.push(vid);
    } else {
      candidates.push({ raw: v, source: 'cropontology', status: 'only', obsoleteOnGitHub: usableGH.obsoleteIds.has(vid) });
    }
  }
  for (const [vid, r] of ghById) if (!siteById.has(vid)) candidates.push({ raw: fromGH(r), source: 'planteome', status: 'only', planteomeLine: r.line });
  stats.obsolete.push(...[...usableGH.obsoleteIds].filter((vid) => !siteById.has(vid)));

  // Names in the preferred copy (including shared variables); a non-preferred-only variable with one of
  // these names under another ID is the same variable renumbered.
  const key = (v) => String(v.observationVariableName ?? '').trim().toLowerCase();
  const preferredCopy = prefer === 'planteome' ? [...ghById.values()].map(fromGH) : siteVariables;
  const preferredNames = new Map(preferredCopy.filter((v) => key(v)).map((v) => [key(v), v.observationVariableDbId]));
  for (const c of candidates) {
    const same = c.source !== prefer ? preferredNames.get(key(c.raw)) : null;
    if (same && same !== c.raw.observationVariableDbId) {
      stats.duplicates.push({ id: c.raw.observationVariableDbId, name: c.raw.observationVariableName, source: c.source, keptId: same });
      continue;
    }
    out.push(c);
    stats[c.source === 'planteome' ? 'onlyPlanteome' : 'onlyCropontology']++;
  }
  return { variables: out, stats };
}

// A Planteome TD row as a cropontology.org-style BrAPI variable, so the build treats both sources alike.
export function tdRowToVariable(r, ontologyDbId, ontologyName) {
  const v = (k) => (r[k] ?? '').trim() || null;
  const list = (k) => (r[k] ?? '').split(/\s*[;,]\s*/).map((x) => x.trim()).filter(Boolean);
  const num = (k) => { const s = v(k); return s != null && Number.isFinite(Number(s)) ? Number(s) : null; };
  return {
    observationVariableDbId: v('variable id'),
    observationVariableName: v('variable name') ?? v('variable label') ?? v('variable id'),
    observationVariablePUI: null,
    ontologyReference: { ontologyDbId, ontologyName },
    contextOfUse: list('context of use'),
    defaultValue: null,
    growthStage: v('growth stage'),
    institution: v('institution'),
    language: v('language'),
    scientist: v('scientist'),
    status: v('variable status'),
    synonyms: list('variable synonyms'),
    date: v('date'),
    crop: v('crop'),
    trait: {
      traitDbId: v('trait id'), traitName: v('trait name'), traitClass: v('trait class'), traitPUI: null,
      description: v('trait description'), synonyms: list('trait synonyms'),
      mainAbbreviation: v('main trait abbreviation'), alternativeAbbreviations: list('alternative trait abbreviations'),
      entity: v('entity'), entityPUI: null, attribute: v('attribute'), attributePUI: null, status: v('trait status'),
      additionalInfo: null,
    },
    method: {
      methodDbId: v('method id'), methodName: v('method name'), methodClass: v('method class'),
      description: v('method description'), formula: v('formula'), reference: v('method reference'), additionalInfo: null,
    },
    scale: {
      scaleDbId: v('scale id'), scaleName: v('scale name'), dataType: v('scale class'), decimalPlaces: num('decimal places'),
      scalePUI: null, units: null,
      validValues: { minimumValue: v('lower limit'), maximumValue: v('upper limit'), categories: tdCategories(r) },
    },
    additionalInfo: v('variable label') ? { variableLabel: v('variable label') } : null,
  };
}
