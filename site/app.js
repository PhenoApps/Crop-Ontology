// PhenoApps Crop Ontology: a hash-routed viewer over the static files that scripts/build.mjs writes.
//   #/                          crops
//   #/about                     what the site is for and where its data comes from
//   #/conflicts                 where the sources disagree and what the build changes (#/changes also works)
//   #/CO_325                    one crop's variable list
//   #/CO_325/browse[/TERM_ID]   trait browser: trait class > trait > variable tree beside the selected term
//   #/CO_325/CO_325:0000577     one variable
(() => {
  const SITE = 'PhenoApps Crop Ontology';
  const PAGE = 100;
  const app = document.getElementById('app');
  const cache = new Map();
  let indexP = null;
  let changesP = null;
  let browserView = null; // the trait browser on screen, so picking a term doesn't rebuild the page
  const homeState = { q: '', sort: 'name' };

  // ---- helpers ------------------------------------------------------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const enc = encodeURIComponent;
  const num = (n) => Number(n ?? 0).toLocaleString();
  const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
  const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  const siteRoot = () => location.href.split('#')[0].replace(/[^/]*$/, '');
  const brapiBase = (id) => `${siteRoot()}${id ? `${id}/` : ''}brapi/v2`;
  const setTitle = (t) => { document.title = t ? `${t} | ${SITE}` : SITE; };
  const hashParts = () => location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
  const chevron = (dir) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${dir === 'down' ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Source dates come in several shapes ("2025-01-15T12:44:37-08:00", "2020-08-05 08:26:03.997000"); show the day.
  function day(s) {
    const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], m[2] - 1, +m[3]))
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} loading ${url}`);
    return res.json();
  }
  const loadIndex = () => (indexP ??= getJson('ontologies.json'));
  const loadChanges = () => (changesP ??= getJson('changes.json').catch(() => null));
  function loadVariables(id) {
    if (!cache.has(id)) cache.set(id, getJson(`${id}/brapi/v2/variables`).then((b) => b.result.data));
    return cache.get(id);
  }
  async function findOntology(id) {
    const { ontologies } = await loadIndex();
    return ontologies.find((o) => o.id === id) ?? null;
  }

  const info = (x) => x?.additionalInfo ?? {};
  const provenance = (v) => info(v).provenance ?? info(v).mirrorSource ?? null;
  const buildNotes = (v) => info(v).changes ?? info(v).mirrorChanges ?? [];

  const EXT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const extLink = (url, text) => `<a class="ext" href="${esc(url)}">${esc(text)}${EXT}<span class="sr">(opens in a new tab)</span></a>`;
  const coTermUrl = (id) => `https://cropontology.org/term/${id}`;

  // Which sources have this variable, from its provenance.
  function sourcesOf(v) {
    const p = provenance(v) ?? {};
    const labels = [p.source, p.alsoIn, p.differsFrom].filter(Boolean).join(' ');
    const doc = v.documentationURL ?? '';
    return {
      cropOntology: /crop ?ontology/i.test(labels) || (!labels && /cropontology\.org/.test(doc)),
      planteome: /planteome/i.test(labels) || (!labels && /github\.com/.test(doc)),
    };
  }

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

  // ---- shared pieces ------------------------------------------------------------------

  function endpointBox(id, label, note = '') {
    const url = brapiBase(id);
    return `
      <div class="endpoint">
        <span class="label">${esc(label)}</span>
        <div class="row"><code>${esc(url)}</code><button type="button" class="btn" data-copy="${esc(url)}">Copy</button></div>
        ${note ? `<p>${note}</p>` : ''}
      </div>`;
  }

  // What the build did to one ontology, for its page.
  function ontologyNotes(c, id) {
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
    return `<details class="notice"><summary>${chevron('right')}Changes from the sources <span class="n">(${items.length})</span></summary><div class="body"><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul><a href="#/conflicts">See all conflicts</a></div></details>`;
  }

  function ontologyHead(o, tab, notes) {
    const s = o.source ?? {};
    // How many of the served variables each source has; a variable in both counts for both.
    const mix = [['Crop Ontology', s.inCropontology ?? s.fromCropontology], ['Planteome', s.inPlanteome ?? s.fromPlanteome]]
      .map(([label, n]) => `${num(n)} in ${label}`).join('<br>');
    const links = [
      s.cropontologyUrl && extLink(s.cropontologyUrl, 'cropontology.org'),
      s.planteomeUrl && extLink(s.planteomeUrl, s.planteomeFile ?? 'Planteome file'),
    ].filter(Boolean).join('<br>');
    const fact = (label, html) => (html ? `<div><dt class="label">${label}</dt><dd>${html}</dd></div>` : '');
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
      </dl>
      ${notes}
      ${endpointBox(o.id, `BrAPI v2 base URL for ${o.name}`, `Use this in Field Book or another BrAPI client to import this crop's traits. <a href="#/about">How it works</a>`)}
      <nav class="tabs" aria-label="Views">
        <a href="#/${enc(o.id)}"${tab === 'list' ? ' aria-current="page"' : ''}>Variable list</a>
        <a href="#/${enc(o.id)}/browse"${tab === 'browse' ? ' aria-current="page"' : ''}>Trait browser</a>
        <a href="#/${enc(o.id)}/graph"${tab === 'graph' ? ' aria-current="page"' : ''}>Graph</a>
      </nav>`;
  }

  const field = (label, value, mono = false) => (value == null || value === '' || (Array.isArray(value) && !value.length))
    ? '' : `<dt>${esc(label)}</dt><dd${mono ? ' class="mono"' : ''}>${Array.isArray(value) ? value.map(esc).join(', ') : esc(value)}</dd>`;

  function provenanceLine(v) {
    const p = provenance(v);
    if (!p?.source) return '';
    let rest = '';
    if (p.alsoIn) rest = ` ${esc(p.alsoIn)} has the same details.`;
    else if (p.differsFrom) rest = ` ${esc(p.differsFrom)} has different values for ${(p.differingFields ?? []).map(esc).join(', ') || 'some fields'}.`;
    else rest = ' Only in this source.';
    return `<p class="prov">From <strong>${esc(p.source)}</strong>.${rest}</p>`;
  }

  // Trait, method and scale of one variable; used by the variable page and the trait browser.
  function variableBody(v, o) {
    const t = v.trait ?? {};
    // Trait, method and scale IDs link to their Crop Ontology term pages when the variable is in Crop Ontology.
    const inCO = sourcesOf(v).cropOntology;
    const idField = (id) => (!id ? '' : `<dt>ID</dt><dd class="mono">${inCO ? extLink(coTermUrl(id), id) : esc(id)}</dd>`);
    const m = v.method ?? {};
    const s = v.scale ?? {};
    const vv = s.validValues ?? {};
    const notes = buildNotes(v);
    return `
      ${provenanceLine(v)}
      ${sourceLinks(v, o)}
      ${notes.length ? `<div class="notice"><strong>Changed when publishing</strong><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul><a href="#/conflicts">See all conflicts</a></div>` : ''}
      <div class="panel" style="margin-top:14px">
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
      <div class="sections">
        <section class="panel">
          <h2>Trait</h2>
          <dl class="kv">
            ${field('Name', t.traitName)}${idField(t.traitDbId)}${field('Class', t.traitClass)}
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
            `<tr><td>${esc(c.value)}</td><td>${c.label !== c.value ? esc(c.label) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
        </section>
      </div>`;
  }

  // ---- crops (home) ------------------------------------------------------------------

  const SORTS = {
    name: (a, b) => byName(a.name, b.name),
    updated: (a, b) => String(b.version ?? '').slice(0, 10).localeCompare(String(a.version ?? '').slice(0, 10)) || byName(a.name, b.name),
    variables: (a, b) => b.variableCount - a.variableCount || byName(a.name, b.name),
    id: (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }),
  };

  async function home() {
    const { ontologies } = await loadIndex();
    setTitle();
    const total = ontologies.reduce((n, o) => n + o.variableCount, 0);
    app.innerHTML = `
      <h1>Crops</h1>
      <p class="lede">Trait dictionaries for ${ontologies.length} crops, ${num(total)} observation variables in all.
      Each crop is published as a BrAPI v2 endpoint so its traits can be imported into
      <a href="https://github.com/PhenoApps/Field-Book">Field Book</a>. <a href="#/about">About this site</a></p>
      ${endpointBox('', 'BrAPI v2 base URL, all crops', 'Serves every crop at once. Each crop also has its own base URL, shown on its page.')}
      <div class="toolbar">
        <input type="search" id="q" placeholder="Filter by crop, ID or description" aria-label="Filter crops" value="${esc(homeState.q)}">
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
    sort.value = homeState.sort;
    const draw = () => {
      homeState.q = q.value;
      homeState.sort = sort.value;
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = ontologies.filter((o) => {
        const hay = `${o.id} ${o.name} ${o.description ?? ''} ${o.crops.join(' ')}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      }).sort(SORTS[sort.value] ?? SORTS.name);
      count.textContent = hits.length === ontologies.length ? `${ontologies.length} crops` : `${hits.length} of ${ontologies.length}`;
      grid.innerHTML = hits.map((o) => {
        const updated = day(o.version);
        return `
        <a class="crop" href="#/${enc(o.id)}">
          <span class="crop-top"><span class="crop-name">${esc(o.name)}</span><span class="crop-id">${esc(o.id)}</span></span>
          ${o.description ? `<span class="crop-desc">${esc(o.description)}</span>` : ''}
          <span class="crop-tags">
            <span class="tag">${plural(o.variableCount, 'variable')}</span>
            ${updated ? `<span class="tag" title="Last change to the copy served here (${esc(o.source?.label ?? '')})">Updated ${esc(updated)}</span>` : ''}
          </span>
        </a>`;
      }).join('') || '<p class="muted">No crops match.</p>';
    };
    q.addEventListener('input', draw);
    sort.addEventListener('change', draw);
    draw();
  }

  // ---- variable list -----------------------------------------------------------------

  async function ontology(id) {
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
        <div class="vrow vhead"><span class="label">Variable</span><span class="label">${glyph('trait')}Trait</span><span class="label">Method / scale</span><span class="label">Data type</span></div>
        <ul id="list"><li class="empty">Loading variables...</li></ul>
      </div>
      <button type="button" class="more" id="more" aria-label="Show more variables" title="Show more" hidden>${chevron('down')}</button>`;

    const vars = await loadVariables(id);
    if (hashParts()[0] !== id) return; // navigated away while loading
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
      v.trait?.mainAbbreviation, v.method?.methodName, v.scale?.scaleName, ...(v.synonyms ?? []), ...(v.trait?.synonyms ?? []),
    ].join(' ').toLowerCase()]));
    let shown = PAGE;

    const row = (v) => `
      <li><a class="vrow" href="#/${enc(id)}/${enc(v.observationVariableDbId)}">
        <span class="c-var"><span class="primary">${esc(v.observationVariableName ?? v.observationVariableDbId)}</span><span class="sub mono">${esc(v.observationVariableDbId)}</span></span>
        <span class="c-trait">${esc(v.trait?.traitName ?? '')}<span class="sub">${esc(v.trait?.traitClass ?? '')}</span></span>
        <span class="c-ms">${esc(v.method?.methodName ?? '')}<span class="sub">${esc(v.scale?.scaleName ?? '')}</span></span>
        <span class="c-type type">${esc(v.scale?.dataType ?? '')}</span>
      </a></li>`;

    const draw = () => {
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = sorted.filter((v) =>
        (!cls.value || v.trait?.traitClass === cls.value)
        && (!dt.value || v.scale?.dataType === dt.value)
        && terms.every((t) => hay.get(v).includes(t)));
      const n = Math.min(shown, hits.length);
      const filtered = hits.length !== vars.length;
      if (!filtered) count.textContent = n === hits.length ? plural(vars.length, 'variable') : `${num(n)} of ${num(vars.length)}`;
      else count.textContent = n === hits.length ? `${num(n)} matching` : `${num(n)} of ${num(hits.length)} matching`;
      list.innerHTML = hits.slice(0, shown).map(row).join('') || '<li class="empty">No variables match.</li>';
      more.hidden = hits.length <= shown;
    };
    const reset = () => { shown = PAGE; draw(); };
    q.addEventListener('input', reset);
    cls.addEventListener('change', reset);
    dt.addEventListener('change', reset);
    more.addEventListener('click', () => { shown += PAGE; draw(); });
    draw();
  }

  // ---- trait browser -------------------------------------------------------------------
  // Like the tree on cropontology.org: trait classes, their traits, and each trait's variables.

  async function browser(id, term) {
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

    // class name -> traits; trait key -> { trait, cls, vars }
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
    const traitName = (t) => t.trait.traitName || t.vars[0].observationVariableName || t.key;
    const varName = (v) => v.observationVariableName || v.observationVariableDbId;
    const classList = [...classes.entries()]
      .sort(([a], [b]) => (a === 'Unclassified') - (b === 'Unclassified') || byName(a, b));
    for (const [, list] of classList) {
      list.sort((a, b) => byName(traitName(a), traitName(b)));
      for (const t of list) t.vars.sort((a, b) => byName(varName(a), varName(b)));
    }
    const traitHay = new Map([...traits.values()].map((t) => [t, [t.key, traitName(t), t.trait.description,
      t.trait.mainAbbreviation, ...(t.trait.synonyms ?? []), t.cls].join(' ').toLowerCase()]));
    const varHay = new Map(vars.map((v) => [v, [v.observationVariableDbId, v.observationVariableName,
      v.method?.methodName, v.scale?.scaleName, ...(v.synonyms ?? [])].join(' ').toLowerCase()]));

    const open = new Set();
    let selected = null;
    const href = (key) => `#/${enc(id)}/browse/${enc(key)}`;
    const toggle = (key, isOpen, label) =>
      `<button type="button" class="tw" data-toggle="${esc(key)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Collapse' : 'Expand'} ${esc(label)}">${chevron('right')}</button>`;

    function drawTree() {
      const terms = tq.value.toLowerCase().split(/\s+/).filter(Boolean);
      const filtering = terms.length > 0;
      const hit = (h) => terms.every((x) => h.includes(x));
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
              <div class="tn-row${selected === t.key ? ' sel' : ''}">${toggle(`t:${t.key}`, tOpen, traitName(t))}${glyph('trait')}<a class="tn-label" href="${href(t.key)}">${esc(traitName(t))}</a><span class="tn-n">${vs.length}</span></div>
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
        <span class="label">Trait</span>
        <h2>${esc(traitName(t))}</h2>
        <p class="term-id">${esc(t.key.startsWith('none:') ? 'No trait ID' : t.key)}</p>
        <dl class="kv">
          ${field('Class', tr.traitClass)}${field('Description', tr.description)}${field('Abbreviation', tr.mainAbbreviation)}
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
      if (t) { open.add(`c:${t.cls}`); open.add(`t:${t.key}`); }
      if (traits.has(selected)) showTrait(t);
      else if (varIndex.has(selected)) showVariable(t.vars.find((v) => v.observationVariableDbId === selected));
      else { selected = null; showOverview(); }
      drawTree();
      revealSelection();
      if (fromClick && selected && matchMedia('(max-width: 760px)').matches) pane.scrollIntoView({ block: 'start' });
      setTitle(selected ? `${t.key === selected ? traitName(t) : varName(varIndex.get(selected).vars.find((v) => v.observationVariableDbId === selected))} | ${o.name}` : `${o.name} traits`);
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
    browserView = { id, select };
    select(term, false);
  }

  // ---- graph ----------------------------------------------------------------------------
  // A force-directed network like the ontology explorer on cropontology.org: the ontology and its trait classes,
  // traits, and each variable joined to its trait, method and scale. Shared methods and scales become hubs.
  // d3 (force layout, zoom, drag) is loaded only when this view opens.

  let activeGraph = null; // stopped when the route changes
  let d3P = null;
  const loadD3 = () => (d3P ??= new Promise((resolve, reject) => {
    if (window.d3) { resolve(window.d3); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
    s.onload = () => resolve(window.d3);
    s.onerror = () => { d3P = null; reject(new Error('Could not load the graph library (d3) from cdnjs.')); };
    document.head.append(s);
  }));

  // Node types: colour from the categorical palette plus a distinct shape (identity never relies on colour alone).
  const NODE_TYPES = [
    { key: 'term', label: 'Ontology and trait class', shape: 'hexagon', token: '--node-term' },
    { key: 'trait', label: 'Trait', shape: 'square', token: '--node-trait' },
    { key: 'variable', label: 'Variable', shape: 'circle', token: '--node-variable' },
    { key: 'method', label: 'Method', shape: 'triangle', token: '--node-method' },
    { key: 'scale', label: 'Scale', shape: 'diamond', token: '--node-scale' },
  ];
  const glyphSvg = (t) => {
    const p = { circle: '<circle cx="8" cy="8" r="5.5"/>', square: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>',
      triangle: '<path d="M8 2 14 13.5H2Z"/>', diamond: '<path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/>',
      hexagon: '<path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z"/>' }[t.shape];
    return `<svg viewBox="0 0 16 16" aria-hidden="true" style="fill:var(${t.token})">${p}</svg>`;
  };
  // Element-type icon for the trait browser, matching the graph.
  const glyph = (key) => glyphSvg(NODE_TYPES.find((t) => t.key === key)).replace('<svg ', '<svg class="glyph" ');

  function buildGraph(o, vars, hidden) {
    const nodes = new Map();
    const links = [];
    const add = (type, key, label, extra = {}) => {
      const nid = `${type}:${key}`;
      if (!nodes.has(nid)) nodes.set(nid, { id: nid, type, key, label: label || key, degree: 0, ...extra });
      return nodes.get(nid);
    };
    const link = (a, b, kind) => { if (a && b) { links.push({ source: a.id, target: b.id, kind }); a.degree++; b.degree++; } };
    const show = (type) => !hidden.has(type);
    const root = show('term') ? add('term', o.id, o.name, { root: true }) : null;
    for (const v of vars) {
      const t = v.trait ?? {};
      const cls = show('term') ? add('term', `class:${t.traitClass || 'Unclassified'}`, t.traitClass || 'Unclassified') : null;
      if (cls && !cls.linked) { link(root, cls, 'class'); cls.linked = true; }
      const tn = show('trait') && t.traitDbId ? add('trait', t.traitDbId, t.traitName, { ref: t.traitDbId }) : null;
      if (tn && !tn.linked) { link(cls, tn, 'trait'); tn.linked = true; }
      const vn = show('variable') ? add('variable', v.observationVariableDbId, v.observationVariableName, { ref: v.observationVariableDbId }) : null;
      const mn = show('method') && v.method?.methodDbId ? add('method', v.method.methodDbId, v.method.methodName, { vars: [] }) : null;
      const sn = show('scale') && v.scale?.scaleDbId ? add('scale', v.scale.scaleDbId, v.scale.scaleName, { vars: [] }) : null;
      mn?.vars.push(v);
      sn?.vars.push(v);
      if (vn) { link(vn, tn ?? cls, 'variable'); link(vn, mn, 'method'); link(vn, sn, 'scale'); }
      else { link(tn, mn, 'method'); link(tn, sn, 'scale'); } // variables hidden: join traits to their methods/scales
    }
    // Drop repeated trait-method/scale edges created when variables are hidden.
    const seen = new Set();
    return { nodes: [...nodes.values()], links: links.filter((l) => { const k = `${l.source}|${l.target}`; return !seen.has(k) && seen.add(k); }) };
  }

  async function graphView(id) {
    const o = await findOntology(id);
    if (!o) return notFound();
    setTitle(`${o.name} graph`);
    app.innerHTML = `
      ${ontologyHead(o, 'graph', ontologyNotes(await loadChanges(), id))}
      <div class="graph-wrap">
        <div class="graph-tools">
          <button type="button" class="btn-plain" id="g-fit">Fit</button>
          <button type="button" class="btn-plain" id="g-freeze" aria-pressed="false">Freeze</button>
          <input type="search" id="g-q" placeholder="Find a term" aria-label="Find a term in the graph">
          <span class="count" id="g-count"></span>
        </div>
        <div class="graph-legend" id="g-legend" role="group" aria-label="Node types (click to show or hide)"></div>
        <div class="graph" id="g-box">
          <canvas id="g-canvas" aria-label="Network graph of ${esc(o.name)} traits, methods, scales and variables. The variable list and trait browser tabs show the same data as text."></canvas>
          <div class="g-tip" id="g-tip" hidden></div>
          <div class="g-info" id="g-info" hidden></div>
          <p class="g-status" id="g-status">Loading...</p>
        </div>
        <p class="g-help">Drag to pan, scroll to zoom, drag a node to move it, click a node for details. Labels appear as you zoom in.</p>
      </div>`;

    const [vars, d3] = await Promise.all([loadVariables(id), loadD3()]);
    if (hashParts()[0] !== id || hashParts()[1] !== 'graph') return;
    const box = app.querySelector('#g-box');
    const canvas = app.querySelector('#g-canvas');
    const tip = app.querySelector('#g-tip');
    const infoBox = app.querySelector('#g-info');
    const status = app.querySelector('#g-status');
    const legend = app.querySelector('#g-legend');
    const freezeBtn = app.querySelector('#g-freeze');
    const q = app.querySelector('#g-q');
    const count = app.querySelector('#g-count');
    const ctx = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const color = Object.fromEntries(NODE_TYPES.map((t) => [t.key, css.getPropertyValue(t.token).trim()]));
    const shapeOf = Object.fromEntries(NODE_TYPES.map((t) => [t.key, t.shape]));
    const ink = css.getPropertyValue('--ink').trim();
    const ink3 = css.getPropertyValue('--ink-3').trim();
    const rule = css.getPropertyValue('--rule-2').trim();
    const FONT = '500 11px "IBM Plex Sans", "Segoe UI", sans-serif';

    const hidden = new Set();
    let graph = null;
    let sim = null;
    let transform = d3.zoomIdentity;
    let autoFit = true;
    let frozen = false;
    let hover = null;
    let selected = null;
    let neighbours = new Set();
    let matches = new Set();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;

    const short = (s) => (s.length > 40 ? `${s.slice(0, 39)}...` : s);
    // Shapes are drawn at a constant on-screen size; zooming spreads them apart rather than enlarging them.
    const radius = (n) => (n.root ? 9 : n.type === 'term' ? 7 : n.type === 'variable' ? 4 : n.type === 'trait' ? 5 : 4.5 + Math.min(3.5, Math.sqrt(n.degree) / 2));

    function resize() {
      dpr = window.devicePixelRatio || 1;
      width = box.clientWidth;
      height = box.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      draw();
    }

    function shape(n, x, y, r) {
      ctx.beginPath();
      switch (shapeOf[n.type]) {
        case 'circle': ctx.arc(x, y, r, 0, Math.PI * 2); break;
        case 'square': ctx.rect(x - r, y - r, r * 2, r * 2); break;
        case 'triangle': ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.15, y + r * 0.9); ctx.lineTo(x - r * 1.15, y + r * 0.9); ctx.closePath(); break;
        case 'diamond': ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); break;
        default: for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo'](x + r * 1.15 * Math.cos(a), y + r * 1.15 * Math.sin(a)); } ctx.closePath();
      }
    }

    // Label priority: what the reader is focused on first, then the ontology's structure, then hubs, then leaves.
    const TYPE_RANK = { term: 1, trait: 2, method: 3, scale: 3, variable: 4 };
    function priority(n) {
      if (n === selected) return -3;
      if (n === hover) return -2;
      if (neighbours.has(n) || matches.has(n)) return -1;
      return (n.root ? 0 : TYPE_RANK[n.type]) - Math.min(0.9, n.degree / 100);
    }

    function draw() {
      if (!graph) return;
      const k = transform.k;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const focus = selected ? neighbours : matches.size ? matches : null;

      // Edges, in graph space.
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * transform.x, dpr * transform.y);
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = rule;
      ctx.globalAlpha = focus ? 0.3 : 0.8;
      ctx.beginPath();
      for (const l of graph.links) { ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); }
      ctx.stroke();
      if (selected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ink3;
        ctx.lineWidth = 1.5 / k;
        ctx.beginPath();
        for (const l of graph.links) if (l.source === selected || l.target === selected) { ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); }
        ctx.stroke();
      }

      // Nodes and labels, in screen space.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const visible = [];
      for (const n of graph.nodes) {
        n.sx = transform.applyX(n.x);
        n.sy = transform.applyY(n.y);
        n.lr = null;
        if (n.sx > -20 && n.sx < width + 20 && n.sy > -20 && n.sy < height + 20) visible.push(n);
      }
      visible.sort((a, b) => priority(b) - priority(a)); // low priority first, so focused nodes paint on top
      for (const n of visible) {
        ctx.globalAlpha = focus && !focus.has(n) ? 0.2 : 1;
        shape(n, n.sx, n.sy, radius(n));
        ctx.fillStyle = color[n.type];
        ctx.fill();
        ctx.lineWidth = n === selected || matches.has(n) ? 2 : 1.25;
        ctx.strokeStyle = n === selected || matches.has(n) ? ink : '#ffffff';
        ctx.stroke();
      }

      // Greedy label placement: highest priority first, skipping any label that would overlap one already placed.
      const placed = [];
      const CELL = 60;
      const grid = new Map();
      const cells = (r) => {
        const out = [];
        for (let gx = Math.floor(r.x / CELL); gx <= Math.floor((r.x + r.w) / CELL); gx++) {
          for (let gy = Math.floor(r.y / CELL); gy <= Math.floor((r.y + r.h) / CELL); gy++) out.push(`${gx},${gy}`);
        }
        return out;
      };
      const free = (r) => cells(r).every((c) => !(grid.get(c) ?? []).some((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y));
      const claim = (r) => { placed.push(r); for (const c of cells(r)) (grid.get(c) ?? grid.set(c, []).get(c)).push(r); };
      // Every visible shape reserves its own space, so labels don't cover other nodes.
      const shapes = visible.map((n) => { const r = radius(n) + 1; return { x: n.sx - r, y: n.sy - r, w: r * 2, h: r * 2, n }; });
      const hitsShape = (r, self) => shapes.some((s) => s.n !== self && r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y);
      const budget = visible.length > 600 ? 40 : visible.length > 250 ? 80 : 400; // keep dense views readable
      let shown = 0;
      ctx.textBaseline = 'middle';
      for (const n of [...visible].reverse()) {
        const forced = priority(n) < 0;
        if (!forced && shown >= budget) continue;
        const bold = n.type === 'term' || n === selected;
        ctx.font = bold ? FONT.replace('500', '600') : FONT;
        n.text ??= short(n.label);
        const w = ctx.measureText(n.text).width;
        const r = { x: n.sx + radius(n) + 4, y: n.sy - 8, w: w + 4, h: 16 };
        if (!forced && (!free(r) || (visible.length < 1500 && hitsShape(r, n)))) continue;
        claim(r);
        n.lr = r;
        shown++;
        ctx.globalAlpha = focus && !focus.has(n) ? 0.3 : 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(251,251,250,0.92)'; // halo in the canvas colour keeps text legible over edges
        ctx.strokeText(n.text, r.x + 1, n.sy);
        ctx.fillStyle = ink;
        ctx.fillText(n.text, r.x + 1, n.sy);
      }
      ctx.globalAlpha = 1;
    }
    const requestDraw = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };

    // The node whose shape or visible label is under a screen point.
    function nodeAt(px, py) {
      let best = null;
      let bestD = Infinity;
      for (const n of graph.nodes) {
        if (n.sx == null) continue;
        const d = Math.hypot(px - n.sx, py - n.sy);
        if (d <= radius(n) + 4 && d < bestD) { best = n; bestD = d; }
      }
      if (best) return best;
      return graph.nodes.find((n) => n.lr && px >= n.lr.x && px <= n.lr.x + n.lr.w && py >= n.lr.y && py <= n.lr.y + n.lr.h) ?? null;
    }

    function fit(nodes = graph.nodes, animate = true) {
      if (!nodes.length || !width) return;
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const k = Math.min(2.5, Math.max((maxX - minX) / Math.max(width * 0.6, width - 380), (maxY - minY) / Math.max(height * 0.8, height - 60)) ** -1);
      const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
      const sel = d3.select(canvas);
      (animate ? sel.transition().duration(450) : sel).call(zoom.transform, t);
    }

    const typeLabel = (type) => NODE_TYPES.find((t) => t.key === type).label;
    function showInfo(n) {
      if (!n) { infoBox.hidden = true; return; }
      const rel = graph.links.filter((l) => l.source === n || l.target === n).map((l) => (l.source === n ? l.target : l.source));
      const byType = (type) => rel.filter((x) => x.type === type);
      let body = '';
      if (n.type === 'variable') {
        body = `<p><a href="#/${enc(id)}/${enc(n.ref)}">Variable page</a> | <a href="#/${enc(id)}/browse/${enc(n.ref)}">Trait browser</a></p>`;
      } else if (n.type === 'trait') {
        body = `<p><a href="#/${enc(id)}/browse/${enc(n.ref)}">Open in trait browser</a></p>`;
      } else if (n.vars) {
        body = `<p>Used by ${plural(n.vars.length, 'variable')}:</p><ul>${n.vars.slice(0, 12).map((v) =>
          `<li><a href="#/${enc(id)}/browse/${enc(v.observationVariableDbId)}">${esc(v.observationVariableName ?? v.observationVariableDbId)}</a></li>`).join('')}${n.vars.length > 12 ? `<li class="muted">and ${n.vars.length - 12} more</li>` : ''}</ul>`;
      } else {
        body = `<p>${[['trait', 'trait'], ['term', 'trait class']].map(([t, word]) => byType(t).length && plural(byType(t).length, word)).filter(Boolean).join(', ')} linked.</p>`;
      }
      infoBox.innerHTML = `
        <button type="button" class="g-close" aria-label="Close">&times;</button>
        <span class="label">${esc(typeLabel(n.type))}</span>
        <strong>${esc(n.label)}</strong>
        ${n.type !== 'term' ? `<span class="mono muted">${esc(n.key)}</span>` : ''}
        ${body}`;
      infoBox.hidden = false;
    }

    function select(n) {
      selected = n;
      neighbours = new Set(n ? [n] : []);
      if (n) for (const l of graph.links) { if (l.source === n) neighbours.add(l.target); if (l.target === n) neighbours.add(l.source); }
      showInfo(n);
      requestDraw();
    }

    function drawLegend() {
      const counts = buildGraph(o, vars, new Set()).nodes.reduce((m, n) => m.set(n.type, (m.get(n.type) ?? 0) + 1), new Map());
      legend.innerHTML = NODE_TYPES.map((t) => `
        <button type="button" class="g-key" data-type="${t.key}" aria-pressed="${!hidden.has(t.key)}">${glyphSvg(t)}${esc(t.label)} <span class="n">${num(counts.get(t.key) ?? 0)}</span></button>`).join('');
    }

    function start() {
      const old = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
      graph = buildGraph(o, vars, hidden);
      for (const n of graph.nodes) { const p = old.get(n.id); if (p) Object.assign(n, { x: p.x, y: p.y, vx: 0, vy: 0 }); }
      const root = graph.nodes.find((n) => n.root);
      if (root) { root.fx = 0; root.fy = 0; }
      sim?.stop();
      sim = d3.forceSimulation(graph.nodes)
        .force('link', d3.forceLink(graph.links).id((n) => n.id)
          .distance((l) => ({ class: 110, trait: 60, variable: 34, method: 46, scale: 46 })[l.kind] ?? 40)
          .strength((l) => (l.kind === 'method' || l.kind === 'scale' ? 0.25 : 0.7)))
        .force('charge', d3.forceManyBody().strength((n) => (n.type === 'term' ? -300 : -45)).distanceMax(500).theta(0.95))
        .force('collide', d3.forceCollide((n) => radius(n) + 6).iterations(1))
        .force('x', d3.forceX(0).strength(0.02))
        .force('y', d3.forceY(0).strength(0.02))
        .alphaDecay(0.03)
        .on('tick', () => { if (autoFit && sim.alpha() > 0.05) fit(graph.nodes, false); requestDraw(); })
        .on('end', () => { if (autoFit) fit(); });
      if (frozen) sim.stop();
      selected = graph.nodes.includes(selected) ? selected : null;
      select(selected);
      count.textContent = `${num(graph.nodes.length)} nodes, ${num(graph.links.length)} links`;
      status.hidden = true;
    }

    const zoom = d3.zoom().scaleExtent([0.05, 6])
      .on('zoom', (e) => { transform = e.transform; if (e.sourceEvent) autoFit = false; requestDraw(); });
    const drag = d3.drag()
      .container(canvas)
      .subject((e) => { const n = nodeAt(e.x, e.y); return n ? Object.assign(n, { x: n.x, y: n.y }) : null; })
      .on('start', (e) => { autoFit = false; if (!frozen) sim.alphaTarget(0.2).restart(); e.subject.fx = e.subject.x; e.subject.fy = e.subject.y; })
      .on('drag', (e) => {
        const [x, y] = transform.invert(d3.pointer(e.sourceEvent, canvas));
        e.subject.fx = x; e.subject.fy = y;
        if (frozen) { e.subject.x = x; e.subject.y = y; requestDraw(); }
      })
      .on('end', (e) => { if (!frozen) sim.alphaTarget(0); if (!e.subject.root) { e.subject.fx = null; e.subject.fy = null; } });
    d3.select(canvas).call(drag).call(zoom).on('dblclick.zoom', null);

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = n ? 'pointer' : 'grab';
      if (n !== hover) { hover = n; requestDraw(); }
      if (n) {
        tip.innerHTML = `<span class="label">${esc(typeLabel(n.type))}</span>${esc(n.label)}${n.type !== 'term' ? `<span class="mono">${esc(n.key)}</span>` : ''}`;
        tip.hidden = false;
        const x = e.clientX - r.left + 14;
        tip.style.left = `${Math.min(x, width - tip.offsetWidth - 8)}px`;
        tip.style.top = `${e.clientY - r.top + 14}px`;
      } else tip.hidden = true;
    });
    canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; requestDraw(); });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      select(nodeAt(e.clientX - r.left, e.clientY - r.top));
    });
    infoBox.addEventListener('click', (e) => { if (e.target.closest('.g-close')) select(null); });
    app.querySelector('#g-fit').addEventListener('click', () => { autoFit = false; fit(matches.size ? [...matches] : graph.nodes); });
    freezeBtn.addEventListener('click', () => {
      frozen = !frozen;
      freezeBtn.textContent = frozen ? 'Thaw' : 'Freeze';
      freezeBtn.setAttribute('aria-pressed', String(frozen));
      if (frozen) sim.stop(); else sim.alpha(0.3).restart();
    });
    legend.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      if (hidden.has(b.dataset.type)) hidden.delete(b.dataset.type); else hidden.add(b.dataset.type);
      drawLegend();
      start();
      if (!frozen) sim.alpha(0.5).restart();
    });
    q.addEventListener('input', () => {
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      matches = new Set(terms.length ? graph.nodes.filter((n) => terms.every((t) => `${n.label} ${n.key}`.toLowerCase().includes(t))) : []);
      count.textContent = terms.length ? `${num(matches.size)} found` : `${num(graph.nodes.length)} nodes, ${num(graph.links.length)} links`;
      requestDraw();
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && matches.size) { autoFit = false; fit([...matches]); } });

    const ro = new ResizeObserver(resize);
    ro.observe(box);
    activeGraph = { stop: () => { sim?.stop(); ro.disconnect(); } };
    drawLegend();
    resize();
    start();
  }

  // ---- one variable ------------------------------------------------------------------

  async function variable(id, varId) {
    const o = await findOntology(id);
    if (!o) return notFound();
    const v = (await loadVariables(id)).find((x) => x.observationVariableDbId === varId);
    if (!v) return notFound();
    const name = v.observationVariableName ?? varId;
    setTitle(`${name} | ${o.name}`);
    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Crops</a> / <a href="#/${enc(id)}">${esc(o.name)}</a> / <a href="#/${enc(id)}/browse/${enc(v.trait?.traitDbId ?? varId)}">${esc(v.trait?.traitName ?? 'Trait')}</a></nav>
      <div class="title-row"><h1>${esc(name)}</h1><span class="id">${esc(varId)}</span></div>
      ${variableBody(v, o)}`;
  }

  // ---- about ------------------------------------------------------------------------

  async function about() {
    setTitle('About');
    const [{ ontologies, sources }, c] = await Promise.all([loadIndex(), loadChanges()]);
    const fromGitHub = ontologies.filter((o) => o.source?.preferred === 'planteome').length;
    const checked = (s) => (s?.checked ? day(s.checked) : null);
    app.innerHTML = `
      <div class="prose">
        <h1>About</h1>
        <p class="lede">The PhenoApps Crop Ontology publishes the Crop Ontology trait dictionaries in a form that
        phenotyping apps can import directly. It is maintained by <a href="https://phenoapps.org">PhenoApps</a>, the
        group behind <a href="https://github.com/PhenoApps/Field-Book">Field Book</a>.</p>

        <h2>Why it exists</h2>
        <p>The <a href="https://cropontology.org">Crop Ontology</a> defines standard observation variables for
        ${ontologies.length} crops. Each variable pairs a trait (what is observed) with a method (how) and a scale
        (the units or categories recorded). Using the same variables across trials and programs is what makes
        phenotypic data comparable, so Field Book users should be able to start from them rather than typing traits
        in by hand.</p>
        <p>Getting them into an app has not been easy. The trait dictionaries are kept in two places that have drifted
        apart: the Crop Ontology database behind cropontology.org, and the crop repositories in the
        <a href="https://github.com/Planteome">Planteome</a> organization on GitHub. Some crops have been updated in one
        and not the other, and the cropontology.org BrAPI service can take minutes to answer for a single crop.</p>
        <p>This site collects both copies, merges them crop by crop, and serves the result as plain files that load
        quickly and don't depend on a database being up.</p>

        <h2>What it offers</h2>
        <ul>
          <li>A <strong>BrAPI v2 base URL</strong> for every crop, and one for all crops together, that Field Book and
          other <a href="https://brapi.org/specification">BrAPI</a> clients can import traits from.</li>
          <li>A <strong>variable list</strong>, a <strong>trait browser</strong> and a <strong>graph</strong> of each crop's
          ontology, to look up a trait, method or scale before using it.</li>
          <li>A record of <a href="#/conflicts">every conflict and change</a> made to the source data, so nothing is altered silently.</li>
        </ul>

        <h2>Where the data comes from</h2>
        <p>Both sources are checked every week and kept in the repository exactly as they were downloaded.
        Crop Ontology was last checked ${esc(checked(sources?.cropontology) ?? 'recently')}; Planteome
        ${esc(checked(sources?.planteome) ?? 'recently')}. ${fromGitHub} of ${ontologies.length} crops currently
        prefer the Planteome copy where the two disagree.</p>
        ${c?.policy?.merge?.length ? `<p>For each crop:</p><ul>${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <p>The date on each crop is the last change to the copy served here: the Planteome file's last commit, or the
        last time Crop Ontology reloaded that ontology.</p>

        <h2>Using it in Field Book</h2>
        <p>Open a crop, copy its BrAPI base URL, and set it as the BrAPI server in Field Book's settings. Traits can
        then be imported from it like any other BrAPI server. Static hosting can't filter or page results, so each
        request returns the full list in one response, and calls for a single record such as
        <code>variables/{id}</code> aren't available.</p>

        <h2>Corrections and credit</h2>
        <p>The trait dictionaries are the work of the crop communities and curators of the Crop Ontology. Each crop
        keeps its own licence, shown on its page and in its BrAPI <code>ontologies</code> record. This site is not
        the official Crop Ontology; corrections to traits belong with their curators on
        <a href="https://cropontology.org">cropontology.org</a> or in the crop's Planteome repository, and will
        appear here after the next weekly check.</p>
        <p>Problems with this site or its BrAPI endpoints can be reported on
        <a href="https://github.com/PhenoApps/Crop-Ontology/issues">GitHub</a>.</p>
      </div>`;
  }

  // ---- changes ----------------------------------------------------------------------

  async function changesPage() {
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

  function notFound() {
    setTitle('Not found');
    app.innerHTML = '<h1>Not found</h1><p><a href="#/">Back to all crops</a></p>';
  }

  // ---- routing ------------------------------------------------------------------------

  function setNav(first) {
    const active = first === 'about' ? 'about' : first === 'conflicts' || first === 'changes' ? 'conflicts' : 'crops';
    for (const a of document.querySelectorAll('#nav [data-nav]')) {
      if (a.dataset.nav === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }

  async function route() {
    const [first, second, third] = hashParts();
    setNav(first);
    try {
      if (first && second === 'browse' && browserView?.id === first && app.querySelector('#tree')) {
        browserView.select(third, true);
        return;
      }
      browserView = null;
      activeGraph?.stop();
      activeGraph = null;
      if (!first) await home();
      else if (first === 'about') await about();
      else if (first === 'conflicts' || first === 'changes') await changesPage();
      else if (!second) await ontology(first);
      else if (second === 'browse') await browser(first, third);
      else if (second === 'graph') await graphView(first);
      else await variable(first, second);
      window.scrollTo(0, 0);
    } catch (err) {
      app.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(err.message)}</p>`;
    }
  }

  document.addEventListener('click', async (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      document.getElementById(jump.dataset.jump)?.scrollIntoView({ block: 'start' });
      return;
    }
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = 'Copied'; } catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  // Every link that leaves the site opens in a new tab, wherever a view renders it.
  function openExternalInNewTab(root) {
    for (const a of root.querySelectorAll('a[href]')) {
      if (a.origin !== location.origin && !a.target) { a.target = '_blank'; a.rel = 'noopener'; }
    }
  }
  openExternalInNewTab(document);
  new MutationObserver(() => openExternalInNewTab(app)).observe(app, { childList: true, subtree: true });

  window.addEventListener('hashchange', route);
  route();
})();
