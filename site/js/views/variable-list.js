// #/CO_320/list  One crop: its header and a searchable, filterable list of its variables (the second tab).

import { notFound, ontologyHead, ontologyNotes, subclassOf } from '../components.js';
import { findOntology, loadChanges, loadVariables } from '../data.js';
import { app, byName, chevron, enc, esc, hashParts, num, plural, setTitle, terms } from '../util.js';

const PAGE = 100; // rows drawn at a time; "show more" adds another page

const row = (id, v) => `
  <li><a class="vrow" href="#/${enc(id)}/${enc(v.observationVariableDbId)}">
    <span class="c-var"><span class="primary">${esc(v.observationVariableName ?? v.observationVariableDbId)}</span><span class="sub mono">${esc(v.observationVariableDbId)}</span></span>
    <span class="c-trait">${esc(v.trait?.traitName ?? '')}<span class="sub">${esc([v.trait?.traitClass, subclassOf(v.trait)].filter(Boolean).join(' · '))}</span></span>
    <span class="c-ms">${esc(v.method?.methodName ?? '')}<span class="sub">${esc(v.scale?.scaleName ?? '')}</span></span>
    <span class="c-type type">${esc(v.scale?.dataType ?? '')}</span>
  </a></li>`;

export async function variableList(id) {
  const o = await findOntology(id);
  if (!o) return notFound();
  setTitle(o.name);
  app.innerHTML = `
    ${ontologyHead(o, 'list', ontologyNotes(await loadChanges(), id))}
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search variables, traits, methods, scales" aria-label="Search variables">
      <select id="cls" aria-label="Trait class"><option value="">All trait classes</option>${o.traitClasses.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select id="dt" aria-label="Data type"><option value="">All data types</option></select>
      <span class="count" id="count"></span>
    </div>
    <div class="vlist">
      <div class="vrow vhead"><span class="label">Variable</span><span class="label">Trait</span><span class="label">Method / scale</span><span class="label">Data type</span></div>
      <ul id="list"><li class="empty">Loading variables...</li></ul>
    </div>
    <button type="button" class="more" id="more" aria-label="Show more variables" title="Show more" hidden>${chevron('down')}</button>`;

  const vars = await loadVariables(id);
  if (hashParts()[0] !== id || hashParts()[1] !== 'list') return; // navigated away while loading
  const sorted = [...vars].sort((a, b) => byName(a.observationVariableName ?? '', b.observationVariableName ?? ''));
  const dt = app.querySelector('#dt');
  dt.insertAdjacentHTML('beforeend', [...new Set(vars.map((v) => v.scale?.dataType).filter(Boolean))].sort()
    .map((t) => `<option>${esc(t)}</option>`).join(''));
  const q = app.querySelector('#q');
  const cls = app.querySelector('#cls');
  const list = app.querySelector('#list');
  const more = app.querySelector('#more');
  const count = app.querySelector('#count');
  const hay = new Map(vars.map((v) => [v, [
    v.observationVariableDbId, v.observationVariableName, v.trait?.traitName, v.trait?.description,
    v.trait?.mainAbbreviation, subclassOf(v.trait), v.method?.methodName, v.scale?.scaleName, ...(v.synonyms ?? []), ...(v.trait?.synonyms ?? []),
  ].join(' ').toLowerCase()]));
  let shown = PAGE;

  const draw = () => {
    const words = terms(q.value);
    const hits = sorted.filter((v) =>
      (!cls.value || v.trait?.traitClass === cls.value)
      && (!dt.value || v.scale?.dataType === dt.value)
      && words.every((t) => hay.get(v).includes(t)));
    const n = Math.min(shown, hits.length);
    const filtered = hits.length !== vars.length;
    if (!filtered) count.textContent = n === hits.length ? plural(vars.length, 'variable') : `${num(n)} of ${num(vars.length)}`;
    else count.textContent = n === hits.length ? `${num(n)} matching` : `${num(n)} of ${num(hits.length)} matching`;
    list.innerHTML = hits.slice(0, shown).map((v) => row(id, v)).join('') || '<li class="empty">No variables match.</li>';
    more.hidden = hits.length <= shown;
  };
  const reset = () => { shown = PAGE; draw(); };
  q.addEventListener('input', reset);
  cls.addEventListener('change', reset);
  dt.addEventListener('change', reset);
  more.addEventListener('click', () => { shown += PAGE; draw(); });
  draw();
}
