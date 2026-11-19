// #/conflicts[/ONTOLOGY_ID] (#/changes also works)  Where the two sources disagree and everything the build
// changes, from changes.json. With an ontology ID, every table shows just that crop.

import { loadChanges, loadIndex } from '../data.js';
import { diffHtml } from '../textdiff.js';
import { app, byName, enc, esc, num, setTitle } from '../util.js';

// One side of a repaired text: the short version (from just before the first change, clamped to three lines) and
// the full text, which shows when the row is opened.
const clampCell = ({ short, full }) =>
  `<div class="clamp"><span class="short">${short}</span><span class="full">${full}</span></div>`;

export async function conflicts(only) {
  const c = await loadChanges();
  if (!c) { setTitle('Conflicts'); app.innerHTML = '<h1>Conflicts</h1><p class="muted">No change log is available.</p>'; return; }
  const { ontologies } = await loadIndex();
  const name = (id) => ontologies.find((o) => o.id === id)?.name ?? id;
  setTitle(only ? `Conflicts | ${name(only)}` : 'Conflicts');
  // Every list in changes.json is per ontology; with a crop picked, keep just its rows.
  const pick = (list) => (Array.isArray(list) ? list : []).filter((x) => !only || x.ontologyDbId === only);
  const cropOptions = [...ontologies].sort((a, b) => byName(a.name, b.name))
    .map((o) => `<option value="${esc(o.id)}"${o.id === only ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
  const crop = (id) => `<a href="#/${enc(id)}">${esc(name(id))}</a>`;
  const varLink = (id, vid, text) => `<a href="#/${enc(id)}/${enc(vid)}">${esc(text ?? vid)}</a>`;
  const table = (head, rows, numeric = []) => (rows.length
    ? `<div class="table-wrap"><table class="data"><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${r.map((x, i) => `<td${numeric.includes(i) ? ' class="num"' : ''}>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">None.</p>');
  const typeGroups = new Map();
  for (const x of pick(c.dataTypes)) {
    const k = `${x.ontologyDbId}|${x.from}`;
    typeGroups.set(k, { ...x, n: (typeGroups.get(k)?.n ?? 0) + 1 });
  }
  const perOntology = pick(c.sources).sort((a, b) => byName(name(a.ontologyDbId), name(b.ontologyDbId)));
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
  ];
  app.innerHTML = `
    <h1>Conflicts</h1>
    <p class="lede">Each crop is built from two sources: Crop Ontology (cropontology.org) and the Planteome
    trait dictionaries on GitHub. Both are kept in the repository exactly as downloaded. This page lists where they
    disagree and how that was resolved, and everything else the published site and BrAPI endpoints change, and why. Changed records also note it in their <code>additionalInfo</code>.</p>
    <div class="toolbar"><label class="sort">Crop
      <select id="conflict-crop"><option value="">All crops</option>${cropOptions}</select></label></div>
    <p class="toc">${sections.map(([key, label]) => `<a href="#/conflicts" data-jump="${key}">${label}</a>`).join(' &nbsp;|&nbsp; ')}</p>

    <h2 id="sources">Which copy each crop uses</h2>
    ${c.policy?.merge?.length ? `<ul class="prose">${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${table(['Crop', 'Preferred copy', 'In Crop Ontology', 'In Planteome', 'Match', 'Differ', 'Why'], perOntology.map((x) => [
      crop(x.ontologyDbId), esc(x.preferred), num(x.inCropontology ?? x.fromCropontology), num(x.inPlanteome ?? x.fromPlanteome), num(x.agree), num(x.disagree), esc(x.reason ?? '')]), [2, 3, 4, 5])}

    <h2 id="categories">Repaired scale categories</h2>
    <p class="muted">Some categories were turned into dates by spreadsheet software before upload (for example
    "1-2-3" became 2 January 2003). The original text is restored by choosing the reading that ends on the
    scale's top value.${pick(c.categoriesUnrepaired).length ? ` ${pick(c.categoriesUnrepaired).length} date-like categories could not be resolved and are left as served.` : ''}</p>
    ${table(['Crop', 'Variable', 'Scale', 'In source', 'Published as'], pick(c.categories).map((x) => [
      crop(x.ontologyDbId), varLink(x.ontologyDbId, x.observationVariableDbId, x.observationVariableName),
      esc(x.scaleName ?? x.scaleDbId), `<code>${esc(x.from)}</code>`, `<code>${esc(x.to)}</code>`]))}

    <h2 id="encoding">Repaired text</h2>
    <p class="muted">Text that was saved as UTF-8 and later read as Windows-1252 (for example "FranÃ§oise" for
    "Françoise") is decoded again, but only where the result is plausible text. Characters a source lost as "?"
    are restored where the context makes them clear (a space in "Number?of?marketable tubers", ≤ in a length
    range); those repairs are listed in <code>curation.json</code>.</p>
    <div id="repaired-text">${table(['Crop', 'Variable', 'In source', 'Published as'], pick(c.encoding).map((x) => {
      const d = diffHtml(x.from, x.to);
      return [crop(x.ontologyDbId), varLink(x.ontologyDbId, x.observationVariableDbId, x.observationVariableName),
        clampCell(d.before), `${clampCell(d.after)}<button type="button" class="clamp-toggle" aria-expanded="false" hidden>Show all${d.changes > 1 ? ` (${d.changes} changes)` : ''}</button>`];
    }))}</div>

    <h2 id="names">Crop and ontology names</h2>
    <p class="muted">Ontology titles are shortened to the crop name. Each variable's crop is set to its ontology's
    name, so every crop is spelled one way; the source's value is kept in <code>additionalInfo.sourceCropName</code>.</p>
    ${table(['Crop', 'Source title or crop value', 'Published as'], [
      ...pick(c.renamed).map((x) => [crop(x.ontologyDbId), esc(x.from), esc(x.to)]),
      ...pick(c.cropNames).map((x) => [crop(x.ontologyDbId), x.from.map((f) => `${esc(f.value)} (${num(f.count)})`).join(', '), esc(x.to)]),
    ])}

    <h2 id="classes">Trait class names</h2>
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

    <h2 id="types">Scale data types</h2>
    <p class="muted">BrAPI allows Code, Date, Duration, Nominal, Numerical, Ordinal and Text. Other types are served
    as Text, with the original kept in the scale's <code>additionalInfo.sourceDataType</code>.</p>
    ${table(['Crop', 'Type in source', 'Served as', 'Variables'], [...typeGroups.values()].map((x) => [
      crop(x.ontologyDbId), esc(x.from), esc(x.to), String(x.n)]), [3])}

    <h2 id="left-out">Variables left out</h2>
    <p class="muted">A variable found in only one source whose name matches a different ID in the preferred copy is
    treated as the same variable renumbered. Variables marked obsolete in Planteome are left out too.</p>
    ${table(['Crop', 'Left out', 'Name', 'From', 'Kept instead'], pick(c.duplicates).map((x) => [
      crop(x.ontologyDbId), `<code>${esc(x.id)}</code>`, esc(x.name ?? ''), esc(x.source), varLink(x.ontologyDbId, x.keptId)]))}
    ${pick(c.obsoleteExcluded).length ? `<h3>Obsolete in Planteome</h3>${table(['Crop', 'Variables'], pick(c.obsoleteExcluded).map((x) => [crop(x.ontologyDbId), num(x.count)]), [1])}` : ''}

    <h2 id="conflicts">IDs used with different names</h2>
    <p class="muted">The same trait, method or scale ID appears with different names on different variables. These
    are served as found; they are worth raising with the crop's curators.</p>
    ${table(['Crop', 'Kind', 'ID', 'Names'], pick(c.idConflicts).map((x) => [
      crop(x.ontologyDbId), esc(x.kind), `<code>${esc(x.id)}</code>`, x.names.map((n) => (n ? esc(n) : '<span class="muted">(blank)</span>')).join('<br>')]))}

    <h2 id="scope">Scope and formatting</h2>
    ${table(['Crop', 'Note'], [
      ...pick(c.fetchedIndividually).map((x) => [crop(x.ontologyDbId), `The cropontology.org bulk export fails, so each variable was fetched on its own. ${esc(x.reason ?? '')}`]),
      ...pick(c.unavailable).map((x) => [`${esc(x.ontologyName)} (${esc(x.ontologyDbId)})`, `Not included. ${esc(x.reason)}`]),
    ])}
    <ul class="prose">
      ${c.policy?.include ? `<li>${esc(c.policy.include)}</li>` : ''}
      ${(c.policy?.formatting ?? []).map((p) => `<li>${esc(p)}</li>`).join('')}
    </ul>`;
  // Repaired text that fits in three lines is shown whole. Longer text collapses to three lines starting just before
  // its first change, and one button per row opens both columns. Rows are measured open, all at once.
  const repaired = app.querySelector('#repaired-text');
  const rows = [...repaired.querySelectorAll('tbody tr')];
  for (const tr of rows) tr.classList.add('open');
  const fits = rows.map((tr) => [...tr.querySelectorAll('.clamp')].every((el) => {
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    return el.scrollHeight <= line * 3 + 2;
  }));
  rows.forEach((tr, i) => {
    tr.classList.toggle('open', fits[i]);
    tr.querySelector('.clamp-toggle').hidden = fits[i];
  });
  repaired.addEventListener('click', (e) => {
    const b = e.target.closest('.clamp-toggle');
    if (!b) return;
    const open = b.closest('tr').classList.toggle('open');
    b.dataset.label ??= b.textContent;
    b.textContent = open ? 'Show less' : b.dataset.label;
    b.setAttribute('aria-expanded', String(open));
  });
  app.querySelector('#conflict-crop').addEventListener('change', (e) => {
    location.hash = e.target.value ? `#/conflicts/${enc(e.target.value)}` : '#/conflicts';
  });
}
