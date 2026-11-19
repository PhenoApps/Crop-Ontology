// #/CO_320/browse[/TERM_ID]  Trait browser, like the tree on cropontology.org: trait classes, their traits,
// and each trait's variables, beside the selected term.
//
// Returns { id, select } so the router can select another term without rebuilding the page.

import { field, notFound, ontologyHead, ontologyNotes, subclassOf, subclassTag, variableBody } from '../components.js';
import { findOntology, loadChanges, loadVariables } from '../data.js';
import { glyph } from '../glyphs.js';
import { app, byName, chevron, enc, esc, hashParts, plural, setTitle, terms } from '../util.js';

// class name -> traits; trait key -> { key, trait, cls, vars }; variable ID -> its trait entry
function index(vars) {
  const classes = new Map();
  const traits = new Map();
  const varIndex = new Map();
  for (const v of vars) {
    const key = v.trait?.traitDbId ?? `none:${v.observationVariableDbId}`;
    let t = traits.get(key);
    if (!t) {
      const cls = v.trait?.traitClass || 'Unclassified';
      t = { key, trait: v.trait ?? {}, cls, vars: [] };
      traits.set(key, t);
      if (!classes.has(cls)) classes.set(cls, []);
      classes.get(cls).push(t);
    }
    t.vars.push(v);
    varIndex.set(v.observationVariableDbId, t);
  }
  return { classes, traits, varIndex };
}

const traitName = (t) => t.trait.traitName || t.vars[0].observationVariableName || t.key;
const varName = (v) => v.observationVariableName || v.observationVariableDbId;

export async function browser(id, term) {
  const o = await findOntology(id);
  if (!o) return notFound();
  setTitle(`${o.name} traits`);
  app.innerHTML = `
    ${ontologyHead(o, 'browse', ontologyNotes(await loadChanges(), id))}
    <div class="browser">
      <div class="tree-pane">
        <div class="tree-tools">
          <div class="type-key" aria-hidden="true"><span>${glyph('term')}Trait class</span><span>${glyph('trait')}Trait</span><span>${glyph('variable')}Variable</span></div>
          <input type="search" id="tq" placeholder="Filter traits and variables" aria-label="Filter traits and variables">
          <span class="count" id="tcount"></span>
        </div>
        <div class="tree" id="tree"><p class="empty">Loading traits...</p></div>
      </div>
      <div class="term" id="term"></div>
    </div>`;

  const vars = await loadVariables(id);
  if (hashParts()[0] !== id || hashParts()[1] !== 'browse') return;
  const tq = app.querySelector('#tq');
  const tree = app.querySelector('#tree');
  const pane = app.querySelector('#term');
  const tcount = app.querySelector('#tcount');

  const { classes, traits, varIndex } = index(vars);
  const classList = [...classes.entries()]
    .sort(([a], [b]) => (a === 'Unclassified') - (b === 'Unclassified') || byName(a, b));
  for (const [, list] of classList) {
    list.sort((a, b) => byName(traitName(a), traitName(b)));
    for (const t of list) t.vars.sort((a, b) => byName(varName(a), varName(b)));
  }
  const traitHay = new Map([...traits.values()].map((t) => [t, [t.key, traitName(t), t.trait.description,
    t.trait.mainAbbreviation, ...(t.trait.synonyms ?? []), t.cls, subclassOf(t.trait)].join(' ').toLowerCase()]));
  const varHay = new Map(vars.map((v) => [v, [v.observationVariableDbId, v.observationVariableName,
    v.method?.methodName, v.scale?.scaleName, ...(v.synonyms ?? [])].join(' ').toLowerCase()]));

  const open = new Set();
  let selected = null;
  const href = (key) => `#/${enc(id)}/browse/${enc(key)}`;
  const toggle = (key, isOpen, label) =>
    `<button type="button" class="tw" data-toggle="${esc(key)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Collapse' : 'Expand'} ${esc(label)}">${chevron('right')}</button>`;

  function drawTree() {
    const words = terms(tq.value);
    const filtering = words.length > 0;
    const hit = (h) => words.every((x) => h.includes(x));
    let nTraits = 0;
    let nVars = 0;
    const html = classList.map(([cls, list]) => {
      const rows = list.map((t) => ({ t, vs: !filtering || hit(traitHay.get(t)) ? t.vars : t.vars.filter((v) => hit(varHay.get(v))) }))
        .filter((r) => r.vs.length);
      if (!rows.length) return '';
      nTraits += rows.length;
      nVars += rows.reduce((n, r) => n + r.vs.length, 0);
      const clsOpen = filtering || open.has(`c:${cls}`);
      const traitRows = clsOpen ? rows.map(({ t, vs }) => {
        const tOpen = (filtering && !hit(traitHay.get(t))) || open.has(`t:${t.key}`);
        return `
          <li class="tn" role="treeitem" aria-expanded="${tOpen}">
            <div class="tn-row${selected === t.key ? ' sel' : ''}">${toggle(`t:${t.key}`, tOpen, traitName(t))}${glyph('trait')}<a class="tn-label" href="${href(t.key)}">${esc(traitName(t))}</a>${subclassTag(t.trait)}<span class="tn-n">${vs.length}</span></div>
            ${tOpen ? `<ul role="group">${vs.map((v) => `
              <li class="tn tn-leaf" role="treeitem"><div class="tn-row${selected === v.observationVariableDbId ? ' sel' : ''}"><span class="tw-gap"></span>${glyph('variable')}<a class="tn-label" href="${href(v.observationVariableDbId)}">${esc(varName(v))}</a></div></li>`).join('')}</ul>` : ''}
          </li>`;
      }).join('') : '';
      return `
        <li class="tn tn-class" role="treeitem" aria-expanded="${clsOpen}">
          <div class="tn-row">${toggle(`c:${cls}`, clsOpen, cls)}${glyph('term')}<button type="button" class="tn-label" data-toggle="c:${esc(cls)}">${esc(cls)}</button><span class="tn-n">${rows.length}</span></div>
          ${clsOpen ? `<ul role="group">${traitRows}</ul>` : ''}
        </li>`;
    }).join('');
    tree.innerHTML = html ? `<ul role="tree" aria-label="Traits">${html}</ul>` : '<p class="empty">Nothing matches.</p>';
    tcount.textContent = `${plural(nTraits, 'trait')}, ${plural(nVars, 'variable')}`;
  }

  function revealSelection() {
    const row = tree.querySelector('.tn-row.sel');
    if (!row) return;
    const top = row.offsetTop;
    if (top < tree.scrollTop || top + row.offsetHeight > tree.scrollTop + tree.clientHeight) tree.scrollTop = top - tree.clientHeight / 3;
  }

  function showOverview() {
    pane.innerHTML = `
      <span class="label">${esc(o.name)}</span>
      <h2>Trait classes</h2>
      <p class="muted">Pick a trait or variable in the tree to see its details.</p>
      <table class="data">
        <thead><tr><th>Class</th><th class="num">Traits</th><th class="num">Variables</th></tr></thead>
        <tbody>${classList.map(([cls, list]) => `
          <tr><td><a href="#" data-open="${esc(cls)}">${esc(cls)}</a></td><td class="num">${list.length}</td><td class="num">${list.reduce((n, t) => n + t.vars.length, 0)}</td></tr>`).join('')}
        </tbody>
      </table>`;
  }

  function showTrait(t) {
    const tr = t.trait;
    pane.innerHTML = `
      <span class="label">${glyph('trait')}Trait</span>
      <h2>${esc(traitName(t))}</h2>
      <p class="term-id">${esc(t.key.startsWith('none:') ? 'No trait ID' : t.key)}</p>
      <dl class="kv">
        ${field('Class', tr.traitClass)}${field('Subclass', subclassOf(tr))}${field('Class in source', tr.additionalInfo?.sourceTraitClass)}
        ${field('Description', tr.description)}${field('Abbreviation', tr.mainAbbreviation)}
        ${field('Other abbreviations', tr.alternativeAbbreviations)}${field('Synonyms', tr.synonyms)}
        ${field('Entity', tr.entity)}${field('Attribute', tr.attribute)}${field('Status', tr.status)}
      </dl>
      <h3>${plural(t.vars.length, 'variable')}</h3>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Variable</th><th>Method</th><th>Scale</th><th>Data type</th></tr></thead>
        <tbody>${t.vars.map((v) => `
          <tr><td><a href="${href(v.observationVariableDbId)}">${esc(varName(v))}</a></td><td>${esc(v.method?.methodName ?? '')}</td>
          <td>${esc(v.scale?.scaleName ?? '')}</td><td class="mono">${esc(v.scale?.dataType ?? '')}</td></tr>`).join('')}
        </tbody>
      </table></div>`;
  }

  function showVariable(v) {
    pane.innerHTML = `
      <span class="label">${glyph('variable')}Variable</span>
      <h2>${esc(varName(v))}</h2>
      <p class="term-id">${esc(v.observationVariableDbId)}<a href="#/${enc(id)}/${enc(v.observationVariableDbId)}">Open variable page</a></p>
      ${variableBody(v, o)}`;
  }

  function select(key, fromClick) {
    selected = key || null;
    const t = traits.get(selected) ?? varIndex.get(selected);
    const v = varIndex.has(selected) ? t.vars.find((x) => x.observationVariableDbId === selected) : null;
    if (t) { open.add(`c:${t.cls}`); open.add(`t:${t.key}`); }
    if (traits.has(selected)) showTrait(t);
    else if (v) showVariable(v);
    else { selected = null; showOverview(); }
    drawTree();
    revealSelection();
    if (fromClick && selected && matchMedia('(max-width: 760px)').matches) pane.scrollIntoView({ block: 'start' });
    setTitle(selected ? `${v ? varName(v) : traitName(t)} | ${o.name}` : `${o.name} traits`);
  }

  tree.addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    const key = b.dataset.toggle;
    if (open.has(key)) open.delete(key); else open.add(key);
    drawTree();
  });
  pane.addEventListener('click', (e) => {
    const a = e.target.closest('[data-open]');
    if (!a) return;
    e.preventDefault();
    open.add(`c:${a.dataset.open}`);
    drawTree();
    const row = [...tree.querySelectorAll('.tn-class > .tn-row button.tn-label')].find((x) => x.textContent === a.dataset.open);
    if (row) tree.scrollTop = row.parentElement.offsetTop;
  });
  tq.addEventListener('input', drawTree);
  select(term, false);
  return { id, select };
}
