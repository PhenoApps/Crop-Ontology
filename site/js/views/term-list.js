// #/CO_320/methods and #/CO_320/scales  One crop's methods or scales, each listed once with the number of variables
// that use it, searchable and filterable like the variable list. A row opens that method or scale in the trait
// browser, which lists its variables.

import { notFound, ontologyHead, ontologyNotes } from '../components.js';
import { findOntology, loadChanges, loadVariables } from '../data.js';
import { app, byName, chevron, enc, esc, hashParts, num, plural, setTitle, terms } from '../util.js';

const PAGE = 100; // rows drawn at a time; "show more" adds another page

// A scale's values in a few words: its categories, or its range and units.
function scaleValues(s) {
  const vv = s.validValues ?? {};
  const cats = vv.categories ?? [];
  if (cats.length) return `${plural(cats.length, 'category', 'categories')}: ${cats.map((c) => [c.value, c.label].filter((x) => x != null && x !== '').join(' = ')).join('; ')}`;
  const [lo, hi] = [vv.minimumValue ?? vv.min, vv.maximumValue ?? vv.max];
  const range = lo != null && hi != null ? `${lo} to ${hi}` : lo != null ? `at least ${lo}` : hi != null ? `at most ${hi}` : '';
  return [range, s.units].filter(Boolean).join(' ');
}

const KINDS = {
  methods: {
    tab: 'methods', noun: 'method', term: (v) => v.method, id: (m) => m.methodDbId, name: (m) => m.methodName,
    detail: (m) => m.description ?? m.formula ?? '', type: (m) => m.methodClass ?? '',
    filter: ['Method class', 'All method classes'], heads: ['Method', 'Description', 'Class'],
    hay: (m) => [m.methodName, m.methodDbId, m.description, m.formula, m.methodClass, m.reference],
  },
  scales: {
    tab: 'scales', noun: 'scale', term: (v) => v.scale, id: (s) => s.scaleDbId, name: (s) => s.scaleName,
    detail: scaleValues, type: (s) => s.dataType ?? '',
    filter: ['Data type', 'All data types'], heads: ['Scale', 'Values', 'Data type'],
    hay: (s) => [s.scaleName, s.scaleDbId, s.units, scaleValues(s)],
  },
};

async function termList(id, kind) {
  const k = KINDS[kind];
  const o = await findOntology(id);
  if (!o) return notFound();
  setTitle(o.name);
  app.innerHTML = `
    ${ontologyHead(o, k.tab, ontologyNotes(await loadChanges(), id))}
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search ${k.noun}s" aria-label="Search ${k.noun}s">
      <select id="type" aria-label="${k.filter[0]}"><option value="">${k.filter[1]}</option></select>
      <span class="count" id="count"></span>
    </div>
    <div class="vlist terms">
      <div class="vrow vhead">${k.heads.map((h) => `<span class="label">${h}</span>`).join('')}</div>
      <ul id="list"><li class="empty">Loading ${k.noun}s...</li></ul>
    </div>
    <button type="button" class="more" id="more" aria-label="Show more ${k.noun}s" title="Show more" hidden>${chevron('down')}</button>`;

  const vars = await loadVariables(id);
  if (hashParts()[0] !== id || hashParts()[1] !== kind) return; // navigated away while loading
  // Each method or scale once, with how many variables use it.
  const byId = new Map();
  for (const v of vars) {
    const t = k.term(v);
    const tid = t && k.id(t);
    if (!tid) continue;
    if (!byId.has(tid)) byId.set(tid, { t, tid, n: 0 });
    byId.get(tid).n++;
  }
  const items = [...byId.values()].sort((a, b) => byName(k.name(a.t) ?? a.tid, k.name(b.t) ?? b.tid) || byName(a.tid, b.tid));
  const hay = new Map(items.map((e) => [e, k.hay(e.t).filter(Boolean).join(' ').toLowerCase()]));
  const row = (e) => `
    <li><a class="vrow" href="#/${enc(id)}/browse/${enc(e.tid)}">
      <span class="c-var"><span class="primary">${esc(k.name(e.t) ?? e.tid)}</span><span class="sub mono">${esc(e.tid)}</span></span>
      <span class="c-ms"><span class="lines-2">${esc(k.detail(e.t))}</span></span>
      <span class="c-type type">${esc(k.type(e.t))}<span class="sub">${plural(e.n, 'variable')}</span></span>
    </a></li>`;

  const type = app.querySelector('#type');
  type.insertAdjacentHTML('beforeend', [...new Set(items.map((e) => k.type(e.t)).filter(Boolean))].sort(byName)
    .map((t) => `<option>${esc(t)}</option>`).join(''));
  const q = app.querySelector('#q');
  const list = app.querySelector('#list');
  const more = app.querySelector('#more');
  const count = app.querySelector('#count');
  let shown = PAGE;

  const draw = () => {
    const words = terms(q.value);
    const hits = items.filter((e) => (!type.value || k.type(e.t) === type.value) && words.every((w) => hay.get(e).includes(w)));
    const n = Math.min(shown, hits.length);
    if (hits.length === items.length) count.textContent = n === hits.length ? plural(items.length, k.noun) : `${num(n)} of ${num(items.length)}`;
    else count.textContent = n === hits.length ? `${num(n)} matching` : `${num(n)} of ${num(hits.length)} matching`;
    list.innerHTML = hits.slice(0, shown).map(row).join('') || `<li class="empty">No ${k.noun}s match.</li>`;
    more.hidden = hits.length <= shown;
  };
  const reset = () => { shown = PAGE; draw(); };
  q.addEventListener('input', reset);
  type.addEventListener('change', reset);
  more.addEventListener('click', () => { shown += PAGE; draw(); });
  draw();
}

export const methodList = (id) => termList(id, 'methods');
export const scaleList = (id) => termList(id, 'scales');
