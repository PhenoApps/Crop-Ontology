// #/conflicts[/ONTOLOGY_ID[/SECTION]] (#/changes also works)  Where the two sources disagree and everything the
// build changes, from changes.json, and at the end every variable the sources describe differently, from
// differences.json. With an ontology ID, every table shows just that crop; a section ID opens the page there.

import { loadChanges, loadDifferences, loadIndex } from '../data.js';
import { diffHtml } from '../textdiff.js';
import { app, byName, enc, esc, extLink, issueUrl, num, plural, setTitle } from '../util.js';

// One side of a repaired text: the short version (from just before the first change, clamped to three lines) and
// the full text, which shows when the row is opened.
const clampCell = ({ short, full }) =>
  `<div class="clamp"><span class="short">${short}</span><span class="full">${full}</span></div>`;
const toggleButton = (changes) =>
  `<button type="button" class="clamp-toggle" aria-expanded="false" hidden>Show all${changes > 1 ? ` (${changes} changes)` : ''}</button>`;

// Rows whose clamped cells fit in three lines are shown whole; the rest keep their "Show all" button. Rows are
// measured open, all at once.
function measureClamps(container) {
  const rows = [...container.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('.clamp'));
  for (const tr of rows) tr.classList.add('open');
  const fits = rows.map((tr) => [...tr.querySelectorAll('.clamp')].every((el) => {
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    return el.scrollHeight <= line * 3 + 2;
  }));
  rows.forEach((tr, i) => {
    tr.classList.toggle('open', fits[i]);
    const b = tr.querySelector('.clamp-toggle');
    if (b) b.hidden = fits[i];
  });
}
// One button per row opens all of the row's clamped cells.
function wireClamps(container) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('.clamp-toggle');
    if (!b) return;
    const open = b.closest('tr').classList.toggle('open');
    b.dataset.label ??= b.textContent;
    b.textContent = open ? 'Show less' : b.dataset.label;
    b.setAttribute('aria-expanded', String(open));
  });
}

export async function conflicts(only) {
  const differencesP = loadDifferences(); // fetched alongside; its table fills in when it arrives
  const c = await loadChanges();
  if (!c) { setTitle('Conflicts'); app.innerHTML = '<h1>Conflicts</h1><p class="muted">No change log is available.</p>'; return; }
  const { ontologies } = await loadIndex();
  const name = (id) => ontologies.find((o) => o.id === id)?.name ?? id;
  setTitle(only ? `Conflicts | ${name(only)}` : 'Conflicts');
  // Every list in changes.json is per ontology; with a crop picked, keep just its rows.
  // Rows are listed by crop name, A to Z; the sort is stable, so each crop's rows keep their order (e.g. by variable ID).
  const cropName = (x) => ontologies.find((o) => o.id === x.ontologyDbId)?.name ?? x.ontologyName ?? x.ontologyDbId;
  const byCrop = (a, b) => byName(cropName(a), cropName(b));
  const pick = (list) => (Array.isArray(list) ? list : []).filter((x) => !only || x.ontologyDbId === only).sort(byCrop);
  // A table built from two lists: sort the combined rows by crop. Each entry is [source record, table row].
  const rowsByCrop = (entries) => entries.sort(([a], [b]) => byCrop(a, b)).map(([, row]) => row);
  const cropOptions = [...ontologies].sort((a, b) => byName(a.name, b.name))
    .map((o) => `<option value="${esc(o.id)}"${o.id === only ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
  const crop = (id) => `<a href="#/${enc(id)}">${esc(name(id))}</a>`;
  const varLink = (id, vid, text) => `<a href="#/${enc(id)}/${enc(vid)}">${esc(text ?? vid)}</a>`;
  const table = (head, rows, numeric = []) => (rows.length
    ? `<div class="table-wrap capped"><table class="data"><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${r.map((x, i) => `<td${numeric.includes(i) ? ' class="num"' : ''}>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">None.</p>');
  const typeGroups = new Map();
  for (const x of pick(c.dataTypes)) {
    const k = `${x.ontologyDbId}|${x.from}`;
    typeGroups.set(k, { ...x, n: (typeGroups.get(k)?.n ?? 0) + 1 });
  }
  const perOntology = pick(c.sources);
  const sections = [
    ['sources', 'Which copy each crop uses'],
    ['categories', 'Repaired scale categories'],
    ['encoding', 'Repaired text'],
    ['names', 'Crop and ontology names'],
    ['classes', 'Trait class names'],
    ['types', 'Scale data types'],
    ['left-out', 'Variables left out'],
    ['conflicts', 'IDs used with different names'],
    ['scope', 'Scope and formatting'],
    ['differences', 'Differences between the sources'],
  ];
  // Each section heading links to the "Trait data looks wrong" form, with its section (and crop) filled in.
  const sectionLabel = Object.fromEntries(sections);
  // How many entries each section has for the crop shown (or all crops), so an empty section offers no report link.
  // The differences table loads separately; its size is the crops' Differ totals.
  const entries = {
    sources: perOntology.length,
    categories: pick(c.categories).length,
    encoding: pick(c.encoding).length,
    names: pick(c.renamed).length + pick(c.cropNames).length,
    classes: pick(c.traitClasses).length,
    types: typeGroups.size,
    'left-out': pick(c.duplicates).length + pick(c.obsoleteExcluded).length,
    conflicts: pick(c.idConflicts).length,
    scope: pick(c.fetchedIndividually).length + pick(c.unavailable).length,
    differences: pick(c.sources).reduce((n, x) => n + (x.disagree ?? 0), 0),
  };
  const heading = (key) => {
    const label = sectionLabel[key];
    if (!entries[key]) return `<h2 id="${key}">${esc(label)}</h2>`;
    const url = issueUrl('1-trait-data.yml', {
      title: `[Data] Conflicts page: ${label}${only ? ` (${name(only)})` : ''}`, section: label, ...(only ? { crop: `${name(only)} (${only})` } : {}),
    });
    return `<h2 id="${key}" class="has-report">${esc(label)}${extLink(url, 'Report a problem')}</h2>`;
  };
  app.innerHTML = `
    <div class="page-head"><h1>Conflicts</h1>
      <select id="conflict-crop" class="short-list" aria-label="Crop"><option value="">All crops</option>${cropOptions}</select></div>
    <p class="lede">Each crop is built from two sources: Crop Ontology (cropontology.org) and the Planteome
    trait dictionaries on GitHub. Both are kept in the repository exactly as downloaded. This page lists where they
    disagree and how that was resolved, and everything else the published site and BrAPI endpoints change, and why. Changed records also note it in their <code>additionalInfo</code>.</p>

    ${heading('sources')}
    ${c.policy?.merge?.length ? `<ul class="prose">${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${table(['Crop', 'Preferred copy', 'In Crop Ontology', 'In Planteome', 'Match', 'Differ', 'Why'], perOntology.map((x) => [
      crop(x.ontologyDbId), esc(x.preferred), num(x.inCropontology ?? x.fromCropontology), num(x.inPlanteome ?? x.fromPlanteome), num(x.agree),
      x.disagree ? `<a href="#/conflicts/${enc(x.ontologyDbId)}/differences" title="See how they differ">${num(x.disagree)}</a>` : num(0),
      esc(x.reason ?? '')]), [2, 3, 4, 5])}

    ${heading('categories')}
    <p class="muted">Some categories were turned into dates by spreadsheet software before upload (for example
    "1-2-3" became 2 January 2003). The original text is restored by choosing the reading that ends on the
    scale's top value.${pick(c.categoriesUnrepaired).length ? ` ${pick(c.categoriesUnrepaired).length} date-like categories could not be resolved and are left as served.` : ''}</p>
    ${table(['Crop', 'Variable', 'Scale', 'In source', 'Published as'], pick(c.categories).map((x) => [
      crop(x.ontologyDbId), varLink(x.ontologyDbId, x.observationVariableDbId, x.observationVariableName),
      esc(x.scaleName ?? x.scaleDbId), `<code>${esc(x.from)}</code>`, `<code>${esc(x.to)}</code>`]))}

    ${heading('encoding')}
    <p class="muted">Text that was saved as UTF-8 and later read as Windows-1252 (for example "FranÃ§oise" for
    "Françoise") is decoded again, but only where the result is plausible text. Characters a source lost as "?"
    are restored where the context makes them clear (a space in "Number?of?marketable tubers", ≤ in a length
    range); those repairs are listed in <code>curation.json</code>.</p>
    <div id="repaired-text">${table(['Variable', 'In source', 'Published as'], pick(c.encoding).map((x) => {
      const d = diffHtml(x.from, x.to);
      // Crop goes under the variable rather than in a column of its own, to keep the table narrow.
      return [`${varLink(x.ontologyDbId, x.observationVariableDbId, x.observationVariableName)}<span class="row-crop">${crop(x.ontologyDbId)}</span>`,
        clampCell(d.before), `${clampCell(d.after)}${toggleButton(d.changes)}`];
    }))}</div>

    ${heading('names')}
    <p class="muted">Ontology titles are shortened to the crop name. Each variable's crop is set to its ontology's
    name, so every crop is spelled one way; the source's value is kept in <code>additionalInfo.sourceCropName</code>.</p>
    ${table(['Crop', 'Source title or crop value', 'Published as'], rowsByCrop([
      ...pick(c.renamed).map((x) => [x, [crop(x.ontologyDbId), esc(x.from), esc(x.to)]]),
      ...pick(c.cropNames).map((x) => [x, [crop(x.ontologyDbId), x.from.map((f) => `${esc(f.value)} (${num(f.count)})`).join(', '), esc(x.to)]]),
    ]))}

    ${heading('classes')}
    <p class="muted">Trait classes only group traits for browsing; they don't change what a variable measures or
    how it is recorded. Some trait dictionaries spell one class several ways (wheat has both "Phenological traits"
    and "Phenological"), and some spell common classes differently from other crops: these are served under one
    spelling. Where a crop has many one-off classes, such as Cassava's "Days to branching" or "Viral disease",
    they are grouped into the classes other crops use; quality classes keep their original name as a subclass
    ("Viscosity trait" becomes "Quality/Viscosity"). A subclass that is itself a common class becomes that class
    ("Agronomic/Post harvest" becomes "Postharvest"), and a British spelling becomes American where the class's own
    traits are spelled that way (Sweet potato's odor traits have the subclass "Odor"). A class with a subclass is
    served as its parent class, so each crop lists only a few classes, and the subclass is kept as a label on the
    trait: "Quality/Aroma" is served as "Quality" with the subclass "Aroma" in
    <code>additionalInfo.traitSubclass</code>. The source's value is kept in the trait's
    <code>additionalInfo.sourceTraitClass</code>.</p>
    ${table(['Crop', 'Class in source', 'Published as', 'Change', 'Variables'], pick(c.traitClasses).map((x) => [
      crop(x.ontologyDbId), esc(x.from), `${esc(x.to)}${x.subclass ? ` <span class="subclass">${esc(x.subclass)}</span>` : ''}`,
      ({ regrouped: 'Grouped with a common class', subclass: 'Subclass shown as a label' })[x.kind] ?? 'Spelling', num(x.count)]), [4])}

    ${heading('types')}
    <p class="muted">BrAPI allows Code, Date, Duration, Nominal, Numerical, Ordinal, and Text. Other types are served
    as Text, with the original kept in the scale's <code>additionalInfo.sourceDataType</code>.</p>
    ${table(['Crop', 'Type in source', 'Served as', 'Variables'], [...typeGroups.values()].map((x) => [
      crop(x.ontologyDbId), esc(x.from), esc(x.to), String(x.n)]), [3])}

    ${heading('left-out')}
    <p class="muted">A variable found in only one source whose name matches a different ID in the preferred copy is
    treated as the same variable renumbered. Variables marked obsolete in Planteome are left out too.</p>
    ${table(['Crop', 'Left out', 'Name', 'From', 'Kept instead'], pick(c.duplicates).map((x) => [
      crop(x.ontologyDbId), `<code>${esc(x.id)}</code>`, esc(x.name ?? ''), esc(x.source), varLink(x.ontologyDbId, x.keptId)]))}
    ${pick(c.obsoleteExcluded).length ? `<h3>Obsolete in Planteome</h3>${table(['Crop', 'Variables'], pick(c.obsoleteExcluded).map((x) => [crop(x.ontologyDbId), num(x.count)]), [1])}` : ''}

    ${heading('conflicts')}
    <p class="muted">The same trait, method, or scale ID appears with different names on different variables. These
    are served as found; they are worth raising with the crop's curators.</p>
    ${table(['Crop', 'Kind', 'ID', 'Names'], pick(c.idConflicts).map((x) => [
      crop(x.ontologyDbId), esc(x.kind), `<code>${esc(x.id)}</code>`, x.names.map((n) => (n ? esc(n) : '<span class="muted">(blank)</span>')).join('<br>')]))}

    ${heading('scope')}
    ${table(['Crop', 'Note'], rowsByCrop([
      ...pick(c.fetchedIndividually).map((x) => [x, [crop(x.ontologyDbId), `The cropontology.org bulk export fails, so each variable was fetched on its own. ${esc(x.reason ?? '')}`]]),
      ...pick(c.unavailable).map((x) => [x, [`${esc(x.ontologyName)} (${esc(x.ontologyDbId)})`, `Not included. ${esc(x.reason)}`]]),
    ]))}
    <ul class="prose">
      ${c.policy?.include ? `<li>${esc(c.policy.include)}</li>` : ''}
      ${(c.policy?.formatting ?? []).map((p) => `<li>${esc(p)}</li>`).join('')}
    </ul>

    ${heading('differences')}
    <p class="muted">Variables both sources have but describe differently: for each, the fields that differ, as each
    source writes them, with the differing text highlighted. The value served is marked with a bar; the other is
    kept only in that source. Differences of formatting alone (capitalisation, spacing, category order, or "0.0"
    for "0") aren't counted.</p>
    <div class="toolbar"><label class="sort">Field <select id="diff-field" disabled><option value="">All fields</option></select></label>
      <span class="count" id="diff-count"></span></div>
    <div class="table-wrap capped" id="differences-box"><p class="muted" style="padding:10px 14px">Loading…</p></div>`;
  // Repaired text longer than three lines collapses to three lines starting just before its first change.
  const repaired = app.querySelector('#repaired-text');
  measureClamps(repaired);
  wireClamps(repaired);

  // Differences between the sources, once differences.json has loaded.
  const box = app.querySelector('#differences-box');
  const fieldSelect = app.querySelector('#diff-field');
  const count = app.querySelector('#diff-count');
  wireClamps(box);
  const d = await differencesP;
  if (!box.isConnected) return; // navigated away while loading
  const vars = pick(d?.variables);
  const fieldCounts = new Map();
  for (const v of vars) for (const f of v.fields) fieldCounts.set(f.field, (fieldCounts.get(f.field) ?? 0) + 1);
  fieldSelect.insertAdjacentHTML('beforeend', [...fieldCounts].sort(([a], [b]) => a.localeCompare(b))
    .map(([f, n]) => `<option value="${esc(f)}">${esc(f)} (${num(n)})</option>`).join(''));
  fieldSelect.disabled = !fieldCounts.size;
  const labels = d?.sources ?? { cropontology: 'Crop Ontology', planteome: 'Planteome' };
  const drawDifferences = () => {
    const field = fieldSelect.value;
    const html = [];
    let nVars = 0;
    for (const v of vars) {
      const fields = v.fields.filter((f) => !field || f.field === field);
      if (!fields.length) continue;
      nVars++;
      fields.forEach((f, i) => {
        const diff = diffHtml(f.cropontology, f.planteome, ['diff', 'diff']);
        const value = (side, text, label) => `<td${v.used === label ? ' class="used"' : ''}>${text ? clampCell(side) : '<span class="muted">(blank)</span>'}`;
        html.push(`<tr${i === 0 ? ' class="var-start"' : ''}>${i === 0 ? `<td rowspan="${fields.length}">${varLink(v.ontologyDbId, v.observationVariableDbId, v.observationVariableName)}<span class="row-crop">${crop(v.ontologyDbId)} · ${esc(v.used)} value served</span></td>` : ''}<td>${esc(f.field)}</td>${value(diff.before, f.cropontology, labels.cropontology)}</td>${value(diff.after, f.planteome, labels.planteome)}${toggleButton(diff.changes)}</td></tr>`);
      });
    }
    box.innerHTML = html.length
      ? `<table class="data diffs"><thead><tr><th>Variable</th><th>Field</th><th>${esc(labels.cropontology)}</th><th>${esc(labels.planteome)}</th></tr></thead><tbody>${html.join('')}</tbody></table>`
      : '<p class="muted" style="padding:10px 14px">None.</p>';
    count.textContent = html.length ? `${plural(nVars, 'variable')}, ${plural(html.length, 'difference')}` : '';
    measureClamps(box);
  };
  fieldSelect.addEventListener('change', drawDifferences);
  drawDifferences();
  app.querySelector('#conflict-crop').addEventListener('change', (e) => {
    location.hash = e.target.value ? `#/conflicts/${enc(e.target.value)}` : '#/conflicts';
  });
}
