// #/  The crops, as cards that can be filtered and sorted.

import { loadIndex } from '../data.js';
import { italicizeSpecies } from '../species.js';
import { app, byName, day, enc, esc, plural, setTitle, terms } from '../util.js';

const state = { q: '', sort: 'name' }; // kept while browsing, so returning to the list restores it

const SORTS = {
  name: (a, b) => byName(a.name, b.name),
  updated: (a, b) => String(b.version ?? '').slice(0, 10).localeCompare(String(a.version ?? '').slice(0, 10)) || byName(a.name, b.name),
  variables: (a, b) => b.variableCount - a.variableCount || byName(a.name, b.name),
  id: (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }),
};

const card = (o) => {
  const updated = day(o.version);
  return `
    <a class="crop" href="#/${enc(o.id)}">
      <span class="crop-top"><span class="crop-name">${esc(o.name)}</span><span class="crop-id">${esc(o.id)}</span></span>
      ${o.description ? `<span class="crop-desc">${italicizeSpecies(esc(o.description))}</span>` : ''}
      <span class="crop-tags">
        <span class="tag">${plural(o.variableCount, 'variable')}</span>
        ${updated ? `<span class="tag" title="Last change to the copy served here (${esc(o.source?.label ?? '')})">Updated ${esc(updated)}</span>` : ''}
      </span>
    </a>`;
};

export async function home() {
  const { ontologies } = await loadIndex();
  setTitle();
  app.innerHTML = `
    <h1>Crops</h1>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Filter by crop, ID or description" aria-label="Filter crops" value="${esc(state.q)}">
      <label class="sort">Sort by
        <select id="sort">
          <option value="name">Name</option><option value="updated">Last updated</option>
          <option value="variables">Number of variables</option><option value="id">Ontology ID</option>
        </select>
      </label>
      <span class="count" id="count"></span>
    </div>
    <div class="crops" id="grid"></div>`;
  const grid = app.querySelector('#grid');
  const q = app.querySelector('#q');
  const sort = app.querySelector('#sort');
  const count = app.querySelector('#count');
  sort.value = state.sort;
  const draw = () => {
    state.q = q.value;
    state.sort = sort.value;
    const words = terms(q.value);
    const hits = ontologies.filter((o) => {
      const hay = `${o.id} ${o.name} ${o.description ?? ''} ${o.crops.join(' ')}`.toLowerCase();
      return words.every((t) => hay.includes(t));
    }).sort(SORTS[sort.value] ?? SORTS.name);
    count.textContent = hits.length === ontologies.length ? `${ontologies.length} crops` : `${hits.length} of ${ontologies.length}`;
    grid.innerHTML = hits.map(card).join('') || '<p class="muted">No crops match.</p>';
  };
  q.addEventListener('input', draw);
  sort.addEventListener('change', draw);
  draw();
}
