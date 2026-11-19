// Loading the built JSON files, and reading what the build recorded on each variable.

const cache = new Map();
let indexP = null;
let changesP = null;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} loading ${url}`);
  return res.json();
}

// ontologies.json: the crop index and when each source was last checked.
export const loadIndex = () => (indexP ??= getJson('ontologies.json'));
// changes.json: every change the build made to the source data (null if missing).
export const loadChanges = () => (changesP ??= getJson('changes.json').catch(() => null));
// One crop's variables, cached for the session; the list, trait browser, graph and variable pages share it.
export function loadVariables(id) {
  if (!cache.has(id)) cache.set(id, getJson(`${id}/brapi/v2/variables`).then((b) => b.result.data));
  return cache.get(id);
}
export async function findOntology(id) {
  const { ontologies } = await loadIndex();
  return ontologies.find((o) => o.id === id) ?? null;
}

export const info = (x) => x?.additionalInfo ?? {};
export const provenance = (v) => info(v).provenance ?? info(v).mirrorSource ?? null;
export const buildNotes = (v) => info(v).changes ?? info(v).mirrorChanges ?? [];

// Which sources have this variable, from its provenance.
export function sourcesOf(v) {
  const p = provenance(v) ?? {};
  const labels = [p.source, p.alsoIn, p.differsFrom].filter(Boolean).join(' ');
  const doc = v.documentationURL ?? '';
  return {
    cropOntology: /crop ?ontology/i.test(labels) || (!labels && /cropontology\.org/.test(doc)),
    planteome: /planteome/i.test(labels) || (!labels && /github\.com/.test(doc)),
  };
}
