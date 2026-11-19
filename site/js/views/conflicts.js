// #/conflicts (#/changes also works)  Where the two sources disagree and everything the build changes, from
// changes.json.

import { loadChanges, loadIndex } from '../data.js';
import { app, byName, enc, esc, num, setTitle } from '../util.js';

export async function conflicts() {
  setTitle('Conflicts');
  const c = await loadChanges();
  if (!c) { app.innerHTML = '<h1>Conflicts</h1><p class="muted">No change log is available.</p>'; return; }
  const { ontologies } = await loadIndex();
  const name = (id) => ontologies.find((o) => o.id === id)?.name ?? id;
  const crop = (id) => `<a href="#/${enc(id)}">${esc(name(id))}</a>`;
  const varLink = (id, vid, text) => `<a href="#/${enc(id)}/${enc(vid)}">${esc(text ?? vid)}</a>`;
  const table = (head, rows, numeric = []) => (rows.length
    ? `<div class="table-wrap"><table class="data"><thead><tr>${head.map((h, i) => `<th${numeric.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${
      rows.map((r) => `<tr>${r.map((x, i) => `<td${numeric.includes(i) ? ' class="num"' : ''}>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">None.</p>');
  const typeGroups = new Map();
  for (const x of c.dataTypes ?? []) {
    const k = `${x.ontologyDbId}|${x.from}`;
    typeGroups.set(k, { ...x, n: (typeGroups.get(k)?.n ?? 0) + 1 });
  }
  const perOntology = (Array.isArray(c.sources) ? c.sources : []).slice().sort((a, b) => byName(name(a.ontologyDbId), name(b.ontologyDbId)));
  const sections = [
    ['sources', 'Which copy each crop uses'],
    ['categories', 'Repaired scale categories'],
    ['encoding', 'Repaired text encoding'],
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
    <p class="toc">${sections.map(([key, label]) => `<a href="#/conflicts" data-jump="${key}">${label}</a>`).join(' &nbsp;|&nbsp; ')}</p>

    <h2 id="sources">Which copy each crop uses</h2>
    ${c.policy?.merge?.length ? `<ul class="prose">${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${table(['Crop', 'Preferred copy', 'In Crop Ontology', 'In Planteome', 'Match', 'Differ', 'Why'], perOntology.map((x) => [
      crop(x.ontologyDbId), esc(x.preferred), num(x.inCropontology ?? x.fromCropontology), num(x.inPlanteome ?? x.fromPlanteome), num(x.agree), num(x.disagree), esc(x.reason ?? '')]), [2, 3, 4, 5])}

    <h2 id="categories">Repaired scale categories</h2>
    <p class="muted">Some categories were turned into dates by spreadsheet software before upload (for example
    "1-2-3" became 2 January 2003). The original text is restored by choosing the reading that ends on the
    scale's top value.${c.categoriesUnrepaired?.length ? ` ${c.categoriesUnrepaired.length} date-like categories could not be resolved and are left as served.` : ''}</p>
    ${table(['Crop', 'Variable', 'Scale', 'In source', 'Published as'], (c.categories ?? []).map((x) => [
      crop(x.ontologyDbId), varLink(x.ontologyDbId, x.observationVariableDbId, x.observationVariableName),
      esc(x.scaleName ?? x.scaleDbId), `<code>${esc(x.from)}</code>`, `<code>${esc(x.to)}</code>`]))}

    <h2 id="encoding">Repaired text encoding</h2>
    <p class="muted">Text that was saved as UTF-8 and later read as Windows-1252 (for example "FranÃ§oise" for
    "Françoise") is decoded again, but only where the result is plausible text.</p>
    ${table(['Crop', 'Variable', 'In source', 'Published as'], (c.encoding ?? []).map((x) => [
      crop(x.ontologyDbId), varLink(x.ontologyDbId, x.observationVariableDbId, x.observationVariableName), esc(x.from), esc(x.to)]))}

    <h2 id="names">Crop and ontology names</h2>
    <p class="muted">Ontology titles are shortened to the crop name. Each variable's crop is set to its ontology's
    name, so every crop is spelled one way; the source's value is kept in <code>additionalInfo.sourceCropName</code>.</p>
    ${table(['Crop', 'Source title or crop value', 'Published as'], [
      ...(c.renamed ?? []).map((x) => [crop(x.ontologyDbId), esc(x.from), esc(x.to)]),
      ...(c.cropNames ?? []).map((x) => [crop(x.ontologyDbId), x.from.map((f) => `${esc(f.value)} (${num(f.count)})`).join(', '), esc(x.to)]),
    ])}

    <h2 id="classes">Trait class names</h2>
    <p class="muted">Trait classes only group traits for browsing; they don't change what a variable measures or
    how it is recorded. Some trait dictionaries spell one class several ways (wheat has both "Phenological traits"
    and "Phenological"), and some spell common classes differently from other crops: these are served under one
    spelling. Where a crop has many one-off classes, such as Cassava's "Days to branching" or "Viral disease",
    they are grouped into the classes other crops use. The source's value is kept in the trait's
    <code>additionalInfo.sourceTraitClass</code>.</p>
    ${table(['Crop', 'Class in source', 'Published as', 'Change', 'Variables'], (c.traitClasses ?? []).map((x) => [
      crop(x.ontologyDbId), esc(x.from), esc(x.to), x.kind === 'regrouped' ? 'Grouped with a common class' : 'Spelling', num(x.count)]), [4])}

    <h2 id="types">Scale data types</h2>
    <p class="muted">BrAPI allows Code, Date, Duration, Nominal, Numerical, Ordinal and Text. Other types are served
    as Text, with the original kept in the scale's <code>additionalInfo.sourceDataType</code>.</p>
    ${table(['Crop', 'Type in source', 'Served as', 'Variables'], [...typeGroups.values()].map((x) => [
      crop(x.ontologyDbId), esc(x.from), esc(x.to), String(x.n)]), [3])}

    <h2 id="left-out">Variables left out</h2>
    <p class="muted">A variable found in only one source whose name matches a different ID in the preferred copy is
    treated as the same variable renumbered. Variables marked obsolete in Planteome are left out too.</p>
    ${table(['Crop', 'Left out', 'Name', 'From', 'Kept instead'], (c.duplicates ?? []).map((x) => [
      crop(x.ontologyDbId), `<code>${esc(x.id)}</code>`, esc(x.name ?? ''), esc(x.source), varLink(x.ontologyDbId, x.keptId)]))}
    ${(c.obsoleteExcluded ?? []).length ? `<h3>Obsolete in Planteome</h3>${table(['Crop', 'Variables'], c.obsoleteExcluded.map((x) => [crop(x.ontologyDbId), num(x.count)]), [1])}` : ''}

    <h2 id="conflicts">IDs used with different names</h2>
    <p class="muted">The same trait, method or scale ID appears with different names on different variables. These
    are served as found; they are worth raising with the crop's curators.</p>
    ${table(['Crop', 'Kind', 'ID', 'Names'], (c.idConflicts ?? []).map((x) => [
      crop(x.ontologyDbId), esc(x.kind), `<code>${esc(x.id)}</code>`, x.names.map((n) => (n ? esc(n) : '<span class="muted">(blank)</span>')).join('<br>')]))}

    <h2 id="scope">Scope and formatting</h2>
    ${table(['Crop', 'Note'], [
      ...(c.fetchedIndividually ?? []).map((x) => [crop(x.ontologyDbId), `The cropontology.org bulk export fails, so each variable was fetched on its own. ${esc(x.reason ?? '')}`]),
      ...(c.unavailable ?? []).map((x) => [`${esc(x.ontologyName)} (${esc(x.ontologyDbId)})`, `Not included. ${esc(x.reason)}`]),
    ])}
    <ul class="prose">
      ${c.policy?.include ? `<li>${esc(c.policy.include)}</li>` : ''}
      ${(c.policy?.formatting ?? []).map((p) => `<li>${esc(p)}</li>`).join('')}
    </ul>`;
}
