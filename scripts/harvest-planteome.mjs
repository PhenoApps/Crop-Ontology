#!/usr/bin/env node
// Keep raw copies of the Planteome GitHub repos' trait dictionaries, for comparison with cropontology.org.
//
// Each Planteome repo named CO_###-<crop>-traits holds a crop's trait dictionary (TD) as curated on GitHub,
// usually a TD CSV (some only an .xlsx) plus an OBO export. This copies the data files at the repo root
// unchanged into data/planteome/<ONTOLOGY>/ and records the commit they came from. Repos that keep their trait
// data elsewhere (e.g. Banana's musabase/cgiar_banana_ontology.obo) list those paths in curation.json
// planteomePaths; they are copied too, under their file name.
//
//   data/planteome/<ONTOLOGY>/<file>   root-level .csv/.tsv/.xlsx/.xls/.obo/.owl files, byte-for-byte
//   data/planteome/harvest.json        per ontology: repo, branch, commit, commit date, and per file its size,
//                                      hash and the date of the last commit that changed it
//
// A repo is re-cloned only when its HEAD commit differs from the recorded one (checked with git ls-remote),
// and files are rewritten only when their content changes, so an unchanged run leaves no diff.
// Repos are treated as data: files are copied, never executed.
//
// Usage: node scripts/harvest-planteome.mjs [ONTOLOGY_ID ...]   (GITHUB_TOKEN is used if set)

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isIncluded, planteomePaths } from './curation.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'planteome');
const ORG = process.env.PLANTEOME_ORG ?? 'Planteome';
const DATA_FILE = /\.(csv|tsv|xlsx|xls|obo|owl)$/i;
const only = process.argv.slice(2);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };

async function listRepos() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'phenoapps-crop-ontology' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const repos = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/orgs/${ORG}/repos?per_page=100&type=public&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => { while (queue.length) await fn(queue.shift()); }));
}

const previous = await readJson(join(DATA, 'harvest.json'), {});
const state = { ...previous.ontologies };
let changed = false;
const failures = [];

const repos = (await listRepos())
  .map((r) => ({ id: r.name.match(/^(CO_\d+)-/)?.[1], name: r.name, url: r.clone_url, html: r.html_url, branch: r.default_branch, archived: r.archived }))
  .filter((r) => r.id && isIncluded(r.id) && (!only.length || only.includes(r.id)))
  .sort((a, b) => byId(a.id, b.id));

const seen = new Map();
for (const r of repos) {
  if (seen.has(r.id)) console.warn(`  ${r.id}: several repos (${seen.get(r.id).name}, ${r.name}); using ${seen.get(r.id).name}`);
  else seen.set(r.id, r);
}
console.log(`${seen.size} Planteome repos for CO ontologies`);

await pool([...seen.values()], 4, async (r) => {
  try {
    const { stdout } = await run('git', ['ls-remote', r.url, 'HEAD']);
    const commit = stdout.split(/\s+/)[0];
    const dir = join(DATA, r.id);
    // Same commit and every configured extra path already copied → nothing to do.
    const copied = new Set((state[r.id]?.files ?? []).map((f) => f.path ?? f.name));
    const configured = (planteomePaths[r.id] ?? []).every((p) => copied.has(p))
      && (state[r.id]?.files ?? []).every((f) => f.committedAt); // older snapshots lack per-file dates
    if (state[r.id]?.commit === commit && configured && (await stat(dir).catch(() => null))) {
      console.log(`  ${r.id.padEnd(8)} unchanged  ${commit.slice(0, 7)}  ${r.name}`);
      return;
    }
    const tmp = await mkdtemp(join(tmpdir(), 'planteome-'));
    try {
      // Full history without old file contents: enough for "when did this file last change".
      await run('git', ['clone', '--quiet', '--filter=blob:none', '--no-tags', r.url, tmp]);
      const { stdout: when } = await run('git', ['-C', tmp, 'log', '-1', '--format=%cI']);
      const rootFiles = (await readdir(tmp, { withFileTypes: true }))
        .filter((e) => e.isFile() && DATA_FILE.test(e.name)).map((e) => e.name);
      const sources = [...rootFiles, ...(planteomePaths[r.id] ?? [])];
      const missing = sources.filter((p) => p.includes('..'));
      if (missing.length) throw new Error(`unsafe path in planteomePaths: ${missing.join(', ')}`);
      const names = sources.map((p) => p.split('/').pop());
      if (new Set(names).size !== names.length) throw new Error('two copied files share a name');
      await mkdir(dir, { recursive: true });
      const files = [];
      for (const path of sources.sort(byId)) {
        const name = path.split('/').pop();
        const buf = await readFile(join(tmp, ...path.split('/'))).catch(() => {
          throw new Error(`${path} not found in ${r.name}`);
        });
        const target = join(dir, name);
        const old = await readFile(target).catch(() => null);
        if (!old || !old.equals(buf)) await writeFile(target, buf);
        const { stdout: changedAt } = await run('git', ['-C', tmp, 'log', '-1', '--format=%cI', '--', path]);
        files.push({ name, path, size: buf.length, sha256: sha256(buf), committedAt: changedAt.trim() });
      }
      for (const stale of (await readdir(dir)).filter((n) => !names.includes(n))) await rm(join(dir, stale), { force: true });
      const entry = { repo: r.html, branch: r.branch, commit, committedAt: when.trim(), archived: r.archived, files };
      if (JSON.stringify(entry) !== JSON.stringify(state[r.id] ?? null)) changed = true;
      state[r.id] = entry;
      const summary = files.length ? files.map((f) => f.name).join(', ') : 'no data files at repo root';
      console.log(`  ${r.id.padEnd(8)} ${previous.ontologies?.[r.id] ? 'updated  ' : 'new      '}  ${commit.slice(0, 7)}  ${summary}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  } catch (err) {
    failures.push(r.id);
    console.error(`  ✗ ${r.id} ${r.name} FAILED: ${err.message.split('\n')[0]}`);
  }
});

// Repos that disappeared (or were excluded) are dropped on a full run.
if (!only.length) {
  for (const id of Object.keys(state).filter((id) => !seen.has(id))) {
    console.log(`  ${id} no longer has a Planteome repo; removing`);
    await rm(join(DATA, id), { recursive: true, force: true });
    delete state[id];
    changed = true;
  }
}

if (changed) {
  await mkdir(DATA, { recursive: true });
  await writeFile(join(DATA, 'harvest.json'), JSON.stringify({
    source: `https://github.com/${ORG}`,
    updatedAt: new Date().toISOString(),
    ontologies: Object.fromEntries(Object.entries(state).sort(([a], [b]) => byId(a, b))),
  }, null, 1) + '\n');
  console.log('Snapshot updated.');
} else {
  console.log('No changes.');
}
if (failures.length) { console.error(`Failed: ${failures.join(', ')}`); process.exit(1); }
