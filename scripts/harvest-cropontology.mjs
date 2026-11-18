#!/usr/bin/env node
// Harvest a raw snapshot of every ontology from cropontology.org, re-fetching only what changed.
//
// Writes (each file only when its content changes, so an unchanged run leaves no diff):
//   data/cropontology/ontologies.json            BrAPI v2 ontology records, as served, sorted by id
//   data/cropontology/variables/<ONTOLOGY>.json  BrAPI v2 observation variables, as served, sorted by id
//   data/cropontology/harvest.json               source, last-change time and per ontology: fingerprint,
//                                                when the site last loaded it (loadedAt) and when this
//                                                harvester first saw its content change (editObservedAt)
//
// The site's /brapi/v2/variables call is the only complete export, but it ignores `page` and takes
// from ~35 s to several minutes per ontology. So each run first takes a cheap fingerprint of every
// ontology (its BrAPI record, its term count, and a normalised hash of its ~1 MB RDF export, which
// fetch in seconds) and only re-downloads variables when the fingerprint moved. The RDF covers names,
// descriptions, synonyms, abbreviations, scale categories, scientist and institution, but not growth
// stage, context of use, formula, method reference, status or date. An edit touching only those
// doesn't move the fingerprint, so run with --full now and then (the scheduled workflow does so
// monthly) to re-download everything.
//
// Usage:
//   node scripts/harvest-cropontology.mjs              fetch ontologies whose fingerprint changed
//   node scripts/harvest-cropontology.mjs --full       re-fetch every ontology
//   node scripts/harvest-cropontology.mjs CO_325 ...   re-fetch just these ontologies

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIncluded, knownBroken } from './curation.mjs';
import { digestTriples, rdfTriples, variableIds } from './rdf-digest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'cropontology');
const SITE = (process.env.CO_SITE ?? 'https://cropontology.org').replace(/\/$/, '');
const BRAPI = `${SITE}/brapi/v2`;
const PAGE_SIZE = Number(process.env.CO_PAGE_SIZE ?? 100000); // one oversized page; `page` is ignored upstream
const CONCURRENCY = Number(process.env.CO_CONCURRENCY ?? 3);
const TIMEOUT_MS = Number(process.env.CO_TIMEOUT_MS ?? 30 * 60_000);

const args = process.argv.slice(2);
const full = args.includes('--full');
const only = args.filter((a) => !a.startsWith('--'));

// ---- http ------------------------------------------------------------------------------

// node:https rather than fetch(): fetch gives up when response headers take longer than 5 minutes,
// and the source can take longer than that to answer for the largest ontologies.
function request(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { headers: { accept: 'application/json, */*' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`no response in ${TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
  });
}

async function get(url, { json = true, attempt = 1, attempts = 4 } = {}) {
  try {
    const text = await request(url);
    if (!json) return text;
    try { return JSON.parse(text); } catch { throw new Error('response was not JSON'); }
  } catch (err) {
    if (attempt >= attempts) throw new Error(`${url}: ${err.message}`);
    const wait = 2 ** attempt * 5000;
    console.warn(`  retry ${attempt} in ${wait / 1000}s for ${url} (${err.message})`);
    await new Promise((r) => setTimeout(r, wait));
    return get(url, { json, attempts, attempt: attempt + 1 });
  }
}

// The source puts list results in `result.data` for some calls and directly in `result` for others.
const records = (body) => (Array.isArray(body.result) ? body.result : body.result?.data ?? []);

async function getAll(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  const body = await get(`${BRAPI}/${path}${sep}pageSize=${PAGE_SIZE}&page=0`, opts);
  const list = records(body);
  const { totalCount } = body.metadata?.pagination ?? {};
  if (totalCount != null && list.length < totalCount) {
    throw new Error(`${path}: got ${list.length} of ${totalCount} records; raise CO_PAGE_SIZE`);
  }
  return list;
}

// ---- helpers ---------------------------------------------------------------------------

const sha = (s) => createHash('sha256').update(s).digest('hex');
const byKey = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]), 'en', { numeric: true });
const sortedEntries = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));

function dedupe(list, key) {
  const seen = new Map();
  for (const item of list) if (!seen.has(item[key])) seen.set(item[key], item);
  return [...seen.values()];
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}


const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};

async function writeIfChanged(file, value) {
  const text = JSON.stringify(value, null, 1) + '\n';
  let old = null;
  try { old = await readFile(file, 'utf8'); } catch {}
  if (old === text) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// ---- run -------------------------------------------------------------------------------

console.log(`Source: ${SITE}${full ? ' (full refresh)' : ''}`);
const previous = await readJson(join(DATA, 'harvest.json'), {});
const state = { ...previous.ontologies };
let changed = false;

// Only ontologies matching curation.json's `include` (CO_ numbers) are kept.
const ontologies = dedupe(await getAll('ontologies'), 'ontologyDbId')
  .filter((o) => isIncluded(o.ontologyDbId))
  .sort(byKey('ontologyDbId'));
const ids = ontologies.map((o) => o.ontologyDbId);
if (!only.length) changed = (await writeIfChanged(join(DATA, 'ontologies.json'), ontologies)) || changed;
const unknown = only.filter((id) => !ids.includes(id));
if (unknown.length) throw new Error(`Not on ${SITE}: ${unknown.join(', ')}`);

// Ontologies removed upstream or excluded by curation.json are removed here too (only on a run over the whole list).
if (!only.length) {
  const stale = new Set(Object.keys(state));
  for (const file of await readdir(join(DATA, 'variables')).catch(() => [])) stale.add(file.replace(/\.json$/, ''));
  for (const id of [...stale].filter((id) => !ids.includes(id))) {
    console.log(`  ${id} not listed upstream or excluded by curation.json; removing`);
    await rm(join(DATA, 'variables', `${id}.json`), { force: true });
    delete state[id];
    changed = true;
  }
}

const termCounts = Object.fromEntries((await get(`${SITE}/get-ontologies`)).map((o) => [o.ontology_id, o.total_terms]));
const targets = only.length ? ontologies.filter((o) => only.includes(o.ontologyDbId)) : ontologies;

console.log(`Fingerprinting ${targets.length} ontologies…`);
const fingerprints = {}; // null = couldn't fingerprint, so always re-fetch and never match next time
const rdfVariables = {}; // variable ids per ontology, for fetching one at a time when the bulk export fails
await pool(targets, 4, async (o) => {
  const id = o.ontologyDbId;
  try {
    const triples = rdfTriples(await get(`${SITE}/ontology/${encodeURIComponent(id)}/rdf`, { json: false }));
    rdfVariables[id] = variableIds(triples);
    const rdf = digestTriples(triples);
    fingerprints[id] = sha(stableStringify({ record: o, terms: termCounts[id] ?? null, rdf })).slice(0, 16);
  } catch (err) {
    fingerprints[id] = null;
    console.warn(`  ${id}: RDF unavailable (${err.message}); will re-fetch variables`);
  }
});

const exists = async (file) => (await readFile(file).then(() => true, () => false));

// When the site last loaded each ontology: every term page shows a created_at, set when the ontology's
// trait dictionary was (re)uploaded, the same for all its terms. The BrAPI export doesn't carry it, and the
// ontology record's `version` isn't updated on reload. One term page per ontology is enough.
const loadedAt = {};
await pool(targets, 4, async (o) => {
  const id = o.ontologyDbId;
  const vars = rdfVariables[id] ?? [];
  // Some term pages fail on the site, so try a few terms.
  for (const termId of [...new Set([vars[0], vars[vars.length >> 1], vars.at(-1)])].filter(Boolean)) {
    try {
      const html = await get(`${SITE}/term/${encodeURIComponent(termId)}`, { json: false, attempts: 1 });
      const m = html.replace(/<[^>]*>/g, '\n').match(/created_at\s*\n\s*(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}:\d{2})/);
      if (m) { loadedAt[id] = `${m[1]}T${m[2]}`; return; }
    } catch {}
  }
  if (vars.length) console.warn(`  ${id}: no load date found on its term pages`);
});
for (const [id, at] of Object.entries(loadedAt)) {
  if (state[id] && state[id].loadedAt !== at) { state[id] = { ...state[id], loadedAt: at }; changed = true; }
}
const toFetch = [];
for (const o of targets) {
  const id = o.ontologyDbId;
  const fresh = fingerprints[id] != null && state[id]?.fingerprint === fingerprints[id];
  if (full || only.length || !fresh || !(await exists(join(DATA, 'variables', `${id}.json`)))) toFetch.push(o);
}
console.log(`${toFetch.length} to fetch, ${targets.length - toFetch.length} unchanged`);

// Fetch variables one by one with ?observationVariableDbId=, which works when the per-ontology export doesn't.
async function fetchEach(ids) {
  const out = [];
  await pool(ids, 4, async (vid) => {
    const body = await get(`${BRAPI}/variables?observationVariableDbId=${encodeURIComponent(vid)}&pageSize=10&page=0`);
    const rec = records(body).find((r) => r.observationVariableDbId === vid);
    if (!rec) throw new Error(`${vid} not returned by ?observationVariableDbId=`);
    out.push(rec);
  });
  return out;
}

const failures = [];
const warnings = [];
const annotate = (level, msg) => { if (process.env.GITHUB_ACTIONS) console.log(`::${level}::${msg}`); };
const now = new Date().toISOString();
await pool(toFetch, CONCURRENCY, async (o) => {
  const id = o.ontologyDbId;
  const started = Date.now();
  console.log(`  → ${id.padEnd(16)} fetching  ${o.ontologyName}`);
  try {
    // Known-broken ontologies get one attempt: retrying a deterministic upstream error only wastes time.
    const opts = knownBroken[id] ? { attempts: 1 } : undefined;
    let raw;
    let method = 'bulk';
    try {
      raw = await getAll(`variables?ontologyDbId=${encodeURIComponent(id)}`, opts);
    } catch (bulkErr) {
      // Fallback: the bulk export can fail on data it can't serialise even when every variable loads on its own.
      if (!rdfVariables[id]?.length) throw bulkErr;
      console.warn(`  ! ${id} bulk export failed (${bulkErr.message}); fetching ${rdfVariables[id].length} variables one at a time`);
      raw = await fetchEach(rdfVariables[id]);
      method = 'per-variable';
    }
    const vars = dedupe(raw, 'observationVariableDbId').sort(byKey('observationVariableDbId'));
    const file = join(DATA, 'variables', `${id}.json`);
    const hadSnapshot = await exists(file);
    const dataChanged = await writeIfChanged(file, vars);
    const entry = {
      ...state[id],
      fingerprint: fingerprints[id], variableCount: vars.length, fetchedVia: method, loadedAt: loadedAt[id] ?? state[id]?.loadedAt ?? null,
      changedAt: dataChanged ? now : state[id]?.changedAt ?? now,
      // Content changed since a previous snapshot (e.g. edited in the site's curation portal, which keeps
      // no public modified date): this run is the earliest the edit is known to have happened.
      editObservedAt: dataChanged && hadSnapshot ? now : state[id]?.editObservedAt ?? null,
    };
    if (stableStringify(entry) !== stableStringify(state[id] ?? null)) changed = true;
    state[id] = entry;
    const secs = Math.round((Date.now() - started) / 1000);
    if (knownBroken[id] && method === 'bulk') {
      const msg = `${id} is listed in curation.json knownBroken but its bulk export worked; remove it from that list.`;
      console.log(`  ! ${msg}`);
      annotate('notice', msg);
    } else if (method === 'per-variable') {
      warnings.push(id);
      annotate('warning', `${id}: bulk export still failing upstream; fetched ${vars.length} variables one at a time.`);
    }
    console.log(`  ✓ ${id.padEnd(16)} ${String(vars.length).padStart(5)} variables  ${dataChanged ? 'CHANGED' : 'same   '}  ${String(secs).padStart(4)}s  ${o.ontologyName}`);
  } catch (err) {
    if (knownBroken[id]) {
      warnings.push(id);
      const msg = `${id} still failing upstream (known: ${knownBroken[id]}): ${err.message}`;
      console.warn(`  ! ${msg}`);
      annotate('warning', msg);
    } else {
      failures.push(id);
      console.error(`  ✗ ${id} FAILED: ${err.message}`);
    }
  }
});

if (changed) {
  await writeIfChanged(join(DATA, 'harvest.json'), {
    source: BRAPI,
    updatedAt: now,
    ontologies: sortedEntries(state),
  });
  console.log('Snapshot updated.');
} else {
  console.log('No changes.');
}

if (warnings.length) console.warn(`Upstream problems (not fatal): ${warnings.join(', ')}`);
if (failures.length) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
