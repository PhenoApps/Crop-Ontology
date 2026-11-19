// HTML pieces shared by several views: the crop page header, its change notes, and a variable's details.

import { buildNotes, info, provenance, sourcesOf } from './data.js';
import { italicizeSpecies } from './species.js';
import { app, brapiBase, chevron, coTermUrl, day, enc, esc, extLink, num, plural, setTitle } from './util.js';

export function notFound() {
  setTitle('Not found');
  app.innerHTML = '<h1>Not found</h1><p><a href="#/">Back to all crops</a></p>';
}

// A base URL with a copy button.
export function endpointBox(id, label, note = '') {
  const url = brapiBase(id);
  return `
    <div class="endpoint">
      <span class="label">${esc(label)}</span>
      <div class="row"><code>${esc(url)}</code><button type="button" class="btn" data-copy="${esc(url)}">Copy</button></div>
      ${note ? `<p>${note}</p>` : ''}
    </div>`;
}

// One label/value pair in a <dl class="kv">; empty values are left out. Scientific names are set in italics.
export const field = (label, value, mono = false) => (value == null || value === '' || (Array.isArray(value) && !value.length))
  ? '' : `<dt>${esc(label)}</dt><dd${mono ? ' class="mono"' : ''}>${italicizeSpecies(Array.isArray(value) ? value.map(esc).join(', ') : esc(value))}</dd>`;

// A trait's subclass within its class ("Aroma" under "Quality"), as the build records it, and as a small label.
export const subclassOf = (trait) => info(trait).traitSubclass ?? null;
export const subclassTag = (trait) => (subclassOf(trait) ? `<span class="subclass">${esc(subclassOf(trait))}</span>` : '');

// The Conflicts page, filtered to one crop.
export const conflictsHref = (id) => `#/conflicts/${enc(id)}`;

// ---- crop pages -------------------------------------------------------------------------

// What the build did to one ontology, for its page.
export function ontologyNotes(c, id) {
  if (!c) return '';
  const items = [];
  const src = (Array.isArray(c.sources) ? c.sources : []).find((x) => x.ontologyDbId === id);
  if (src?.agree || src?.disagree) {
    items.push([src.agree && `${plural(src.agree, 'variable')} ${src.agree === 1 ? 'matches' : 'match'} in both sources.`,
      src.disagree && `${plural(src.disagree, 'variable')} ${src.disagree === 1 ? 'differs' : 'differ'}; the ${esc(src.preferred)} version is used for ${src.disagree === 1 ? 'it' : 'those'}.`].filter(Boolean).join(' '));
  }
  if (src?.onlyPlanteome || src?.onlyCropontology) {
    items.push(`Included from one source only: ${[src.onlyPlanteome && `${num(src.onlyPlanteome)} only in Planteome`, src.onlyCropontology && `${num(src.onlyCropontology)} only in Crop Ontology`].filter(Boolean).join(', ')}.`);
  }
  if (src?.duplicatesLeftOut) items.push(`${plural(src.duplicatesLeftOut, 'variable')} left out as renumbered copies of variables already included.`);
  if (src?.obsoleteLeftOut) items.push(`${plural(src.obsoleteLeftOut, 'variable')} marked obsolete in Planteome left out.`);
  const r = c.renamed?.find((x) => x.ontologyDbId === id);
  if (r) items.push(`Shown as "${esc(r.to)}"; the source titles it "${esc(r.from)}".`);
  const crop = c.cropNames?.find((x) => x.ontologyDbId === id);
  if (crop) items.push(`Crop name given as ${crop.from.map((x) => `"${esc(x.value)}"`).join(', ')} in the source; served as "${esc(crop.to)}".`);
  const classes = c.traitClasses?.filter((x) => x.ontologyDbId === id) ?? [];
  const spelled = classes.filter((x) => x.kind === 'spelling');
  const grouped = classes.filter((x) => x.kind === 'regrouped');
  const labelled = classes.filter((x) => x.kind === 'subclass');
  if (spelled.length) {
    items.push(`${plural(spelled.length, 'trait class name')} spelled the standard way, such as "${esc(spelled[0].from)}" shown as "${esc(spelled[0].to)}".`);
  }
  if (labelled.length) {
    items.push(`${plural(labelled.length, 'class', 'classes')} with a subclass listed under the parent class with the subclass as a label, such as "${esc(labelled[0].from)}" under "${esc(labelled[0].to)}".`);
  }
  if (grouped.length) {
    items.push(`${plural(grouped.length, 'one-off trait class', 'one-off trait classes')} grouped into ${plural(new Set(grouped.map((x) => x.to)).size, 'common class', 'common classes')}, such as "${esc(grouped[0].from)}" shown as "${esc(grouped[0].to)}".`);
  }
  if (c.fetchedIndividually?.some((x) => x.ontologyDbId === id)) items.push('The cropontology.org bulk export fails for this ontology, so its variables were fetched one at a time.');
  const cats = c.categories?.filter((x) => x.ontologyDbId === id) ?? [];
  if (cats.length) {
    const scales = new Set(cats.map((x) => x.scaleDbId)).size;
    items.push(`${cats.length} scale ${cats.length === 1 ? 'category' : 'categories'} on ${plural(scales, 'scale')} restored from spreadsheet date conversions.`);
  }
  const types = c.dataTypes?.filter((x) => x.ontologyDbId === id) ?? [];
  if (types.length) {
    const names = [...new Set(types.map((x) => x.from))].map((t) => `"${esc(t)}"`).join(', ');
    items.push(`${plural(types.length, 'variable')} ${types.length === 1 ? 'uses' : 'use'} scale types that aren't in BrAPI (${names}) and are served as Text.`);
  }
  const encs = c.encoding?.filter((x) => x.ontologyDbId === id) ?? [];
  if (encs.length) items.push(`Garbled accented characters repaired in ${plural(new Set(encs.map((x) => x.observationVariableDbId)).size, 'variable')}.`);
  const conflicts = c.idConflicts?.filter((x) => x.ontologyDbId === id) ?? [];
  if (conflicts.length) items.push(`${conflicts.length} trait, method or scale ${conflicts.length === 1 ? 'ID is' : 'IDs are'} used with different names.`);
  if (!items.length) return '';
  return `<details class="notice"><summary>${chevron('right')}Changes from the sources <span class="n">(${items.length})</span></summary><div class="body"><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul><a href="${conflictsHref(id)}">See this crop's conflicts</a></div></details>`;
}

// The ontology's DOI as a two-part badge like the Zenodo one on its cropontology.org page, drawn in CSS.
const doiBadge = (doi) => `<a class="doi" href="https://doi.org/${esc(doi)}" title="Cite this ontology: doi.org/${esc(doi)}"><span class="doi-k">DOI</span><span class="doi-v">${esc(doi).replace('/', '/<wbr>').replace(/\.(?=\d+$)/, '.<wbr>')}</span><span class="sr">(opens in a new tab)</span></a>`;

// Title, facts, BrAPI QR code, change notes and view tabs at the top of each crop page.
export function ontologyHead(o, tab, notes) {
  const s = o.source ?? {};
  // How many of the served variables each source has; a variable in both counts for both.
  const mix = [['Crop Ontology', s.inCropontology ?? s.fromCropontology], ['Planteome', s.inPlanteome ?? s.fromPlanteome]]
    .map(([label, n]) => `${num(n)} in ${label}`).join('<br>');
  const links = [
    s.cropontologyUrl && extLink(s.cropontologyUrl, 'cropontology.org'),
    s.planteomeUrl && extLink(s.planteomeUrl, s.planteomeFile ?? 'Planteome file'),
    o.doi && doiBadge(o.doi),
  ].filter(Boolean).join('<br>');
  const fact = (label, html, cls = '') => (html ? `<div${cls ? ` class="${cls}"` : ''}><dt class="label">${label}</dt><dd>${html}</dd></div>` : '');
  const tabLink = (key, href, text) => `<a href="${href}"${tab === key ? ' aria-current="page"' : ''}>${text}</a>`;
  return `
    <nav class="crumbs"><a href="#/">Crops</a> / ${esc(o.name)}</nav>
    <div class="title-row"><h1>${esc(o.name)}</h1><span class="id">${esc(o.id)}</span></div>
    ${o.description ? `<p class="lede">${esc(o.description)}</p>` : ''}
    <dl class="facts">
      ${fact('Variables', `${num(o.variableCount)}<span class="note">${mix}</span>`)}
      ${fact('Updated', day(o.version) ? esc(day(o.version)) : '')}
      ${fact('Served from', s.label ? `${esc(s.label)}${s.reason ? `<span class="note">${esc(s.reason)}</span>` : ''}` : '')}
      ${fact('Licence', esc(o.licence ?? ''))}
      ${fact('Sources', links)}
      ${fact('BrAPI v2', `<span class="qr" data-qr="${esc(brapiBase(o.id))}" role="img" aria-label="QR code of the BrAPI v2 base URL for ${esc(o.name)}" title="${esc(brapiBase(o.id))}"></span>`, 'fact-qr')}
    </dl>
    ${notes}
    <nav class="tabs" aria-label="Views">
      ${tabLink('list', `#/${enc(o.id)}`, 'Variable list')}
      ${tabLink('browse', `#/${enc(o.id)}/browse`, 'Trait browser')}
      ${tabLink('graph', `#/${enc(o.id)}/graph`, 'Graph')}
    </nav>`;
}

// ---- one variable -----------------------------------------------------------------------

// Links from a variable back to where its information comes from: its Crop Ontology term page and/or its row in
// the Planteome trait dictionary (the file is pinned to the harvested commit, so the line stays valid).
function sourceLinks(v, o) {
  const has = sourcesOf(v);
  const links = [];
  if (has.cropOntology) links.push(extLink(coTermUrl(v.observationVariableDbId), 'Crop Ontology term page'));
  if (has.planteome) {
    const file = o?.source?.planteomeUrl ?? (/github\.com/.test(v.documentationURL ?? '') ? v.documentationURL : null);
    if (file) {
      const line = provenance(v)?.planteomeLine;
      const name = decodeURIComponent(file.split('/').pop());
      const url = line && /\.(csv|tsv)$/i.test(file) ? `${file}?plain=1#L${line}` : file;
      links.push(extLink(url, line ? `Planteome ${name}, line ${line}` : `Planteome ${name}`));
    }
  }
  return links.length ? `<p class="sources-line"><span class="label">Original source</span>${links.join('')}</p>` : '';
}

function provenanceLine(v) {
  const p = provenance(v);
  if (!p?.source) return '';
  let rest = '';
  if (p.alsoIn) rest = ` ${esc(p.alsoIn)} has the same details.`;
  else if (p.differsFrom) rest = ` ${esc(p.differsFrom)} has different values for ${(p.differingFields ?? []).map(esc).join(', ') || 'some fields'}.`;
  else rest = ' Only in this source.';
  return `<p class="prov">From <strong>${esc(p.source)}</strong>.${rest}</p>`;
}

// Where a variable came from and what the build changed.
export function variableIntro(v, o) {
  const notes = buildNotes(v);
  return `
    ${provenanceLine(v)}
    ${sourceLinks(v, o)}
    ${notes.length ? `<div class="notice"><strong>Changed when publishing</strong><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul><a href="${conflictsHref(o.id)}">See this crop's conflicts</a></div>` : ''}`;
}

// A variable's own fields, then its trait, method and scale. `aside` (the variable page's QR card) sits on the
// same row as the first box.
export function variableDetails(v, aside = '') {
  const t = v.trait ?? {};
  // Trait, method and scale IDs link to their Crop Ontology term pages when the variable is in Crop Ontology.
  const inCO = sourcesOf(v).cropOntology;
  const idField = (id) => (!id ? '' : `<dt>ID</dt><dd class="mono">${inCO ? extLink(coTermUrl(id), id) : esc(id)}</dd>`);
  const m = v.method ?? {};
  const s = v.scale ?? {};
  const vv = s.validValues ?? {};
  return `
    <div class="var-row${aside ? ' has-aside' : ''}">
    <div class="panel">
      <dl class="kv">
        ${field('Crop', v.commonCropName)}
        ${field('Crop in source', info(v).sourceCropName)}
        ${field('Synonyms', v.synonyms)}
        ${field('Context of use', v.contextOfUse)}
        ${field('Growth stage', v.growthStage)}
        ${field('Institution', v.institution)}
        ${field('Scientist', v.scientist)}
        ${field('Default value', v.defaultValue)}
        ${field('Status', v.status)}
        ${field('Language', v.language)}
      </dl>
    </div>
    ${aside}
    </div>
    <div class="sections">
      <section class="panel">
        <h2>Trait</h2>
        <dl class="kv">
          ${field('Name', t.traitName)}${idField(t.traitDbId)}${field('Class', t.traitClass)}${field('Subclass', subclassOf(t))}${field('Class in source', info(t).sourceTraitClass)}
          ${field('Description', t.description)}${field('Abbreviation', t.mainAbbreviation)}
          ${field('Other abbreviations', t.alternativeAbbreviations)}${field('Synonyms', t.synonyms)}
          ${field('Entity', t.entity)}${field('Attribute', t.attribute)}
        </dl>
      </section>
      <section class="panel">
        <h2>Method</h2>
        <dl class="kv">
          ${field('Name', m.methodName)}${idField(m.methodDbId)}${field('Class', m.methodClass)}
          ${field('Description', m.description)}${field('Formula', m.formula)}${field('Reference', m.reference)}
        </dl>
      </section>
      <section class="panel">
        <h2>Scale</h2>
        <dl class="kv">
          ${field('Name', s.scaleName)}${idField(s.scaleDbId)}${field('Data type', s.dataType)}
          ${field('Type in source', s.additionalInfo?.sourceDataType)}
          ${field('Decimal places', s.decimalPlaces)}${field('Minimum', vv.minimumValue)}${field('Maximum', vv.maximumValue)}
        </dl>
        ${vv.categories?.length ? `<table class="data cats"><thead><tr><th>Value</th><th>Meaning</th></tr></thead><tbody>${vv.categories.map((c) =>
          `<tr><td>${esc(c.value)}</td><td>${c.label !== c.value ? italicizeSpecies(esc(c.label)) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      </section>
    </div>`;
}

export const variableBody = (v, o) => variableIntro(v, o) + variableDetails(v);
