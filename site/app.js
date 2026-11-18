// PhenoApps Crop Ontology: a hash-routed viewer over the static files that scripts/build.mjs writes.
//   #/                          crops
//   #/about                     what the site is for and where its data comes from
//   #/changes                   everything the build changes relative to its sources
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

  function docLink(url) {
    if (!url) return '';
    const where = /cropontology\.org/.test(url) ? 'cropontology.org' : /github\.com/.test(url) ? 'the Planteome GitHub file' : 'the source';
    return `<a href="${esc(url)}">View on ${where}</a>`;
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
      items.push(`Included from one source only: ${[src.onlyPlanteome && `${num(src.onlyPlanteome)} only on Planteome GitHub`, src.onlyCropontology && `${num(src.onlyCropontology)} only on cropontology.org`].filter(Boolean).join(', ')}.`);
    }
    if (src?.duplicatesLeftOut) items.push(`${plural(src.duplicatesLeftOut, 'variable')} left out as renumbered copies of variables already included.`);
    if (src?.obsoleteLeftOut) items.push(`${plural(src.obsoleteLeftOut, 'variable')} marked obsolete on GitHub left out.`);
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
    return `<div class="notice"><strong>Changes from the sources</strong><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul><a href="#/changes">All changes</a></div>`;
  }

  function ontologyHead(o, tab, notes) {
    const s = o.source ?? {};
    const mix = [['cropontology.org', s.fromCropontology], ['Planteome GitHub', s.fromPlanteome]]
      .filter(([, n]) => n).map(([label, n]) => `${num(n)} from ${label}`).join('<br>');
    const links = [
      s.cropontologyUrl && `<a href="${esc(s.cropontologyUrl)}">cropontology.org</a>`,
      s.planteomeUrl && `<a href="${esc(s.planteomeUrl)}">${esc(s.planteomeFile ?? 'GitHub file')}</a>`,
    ].filter(Boolean).join('<br>');
    const fact = (label, html) => (html ? `<div><dt class="label">${label}</dt><dd>${html}</dd></div>` : '');
    return `
      <nav class="crumbs"><a href="#/">Crops</a> / ${esc(o.name)}</nav>
      <div class="title-row"><h1>${esc(o.name)}</h1><span class="id">${esc(o.id)}</span></div>
      ${o.description ? `<p class="lede">${esc(o.description)}</p>` : ''}
      <dl class="facts">
        ${fact('Variables', `${num(o.variableCount)}${mix ? `<span class="note">${mix}</span>` : ''}`)}
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
  function variableBody(v) {
    const t = v.trait ?? {};
    const m = v.method ?? {};
    const s = v.scale ?? {};
    const vv = s.validValues ?? {};
    const notes = buildNotes(v);
    return `
      ${provenanceLine(v)}
      ${notes.length ? `<div class="notice"><strong>Changed when publishing</strong><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul><a href="#/changes">All changes</a></div>` : ''}
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
            ${field('Name', t.traitName)}${field('ID', t.traitDbId, true)}${field('Class', t.traitClass)}
            ${field('Description', t.description)}${field('Abbreviation', t.mainAbbreviation)}
            ${field('Other abbreviations', t.alternativeAbbreviations)}${field('Synonyms', t.synonyms)}
            ${field('Entity', t.entity)}${field('Attribute', t.attribute)}
          </dl>
        </section>
        <section class="panel">
          <h2>Method</h2>
          <dl class="kv">
            ${field('Name', m.methodName)}${field('ID', m.methodDbId, true)}${field('Class', m.methodClass)}
            ${field('Description', m.description)}${field('Formula', m.formula)}${field('Reference', m.reference)}
          </dl>
        </section>
        <section class="panel">
          <h2>Scale</h2>
          <dl class="kv">
            ${field('Name', s.scaleName)}${field('ID', s.scaleDbId, true)}${field('Data type', s.dataType)}
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
        <div class="vrow vhead"><span class="label">Variable</span><span class="label">Trait</span><span class="label">Method / scale</span><span class="label">Data type</span></div>
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
              <div class="tn-row${selected === t.key ? ' sel' : ''}">${toggle(`t:${t.key}`, tOpen, traitName(t))}<a class="tn-label" href="${href(t.key)}">${esc(traitName(t))}</a><span class="tn-n">${vs.length}</span></div>
              ${tOpen ? `<ul role="group">${vs.map((v) => `
                <li class="tn tn-leaf" role="treeitem"><div class="tn-row${selected === v.observationVariableDbId ? ' sel' : ''}"><span class="tw-gap"></span><a class="tn-label" href="${href(v.observationVariableDbId)}">${esc(varName(v))}</a></div></li>`).join('')}</ul>` : ''}
            </li>`;
        }).join('') : '';
        return `
          <li class="tn tn-class" role="treeitem" aria-expanded="${clsOpen}">
            <div class="tn-row">${toggle(`c:${cls}`, clsOpen, cls)}<button type="button" class="tn-label" data-toggle="c:${esc(cls)}">${esc(cls)}</button><span class="tn-n">${rows.length}</span></div>
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
        <span class="label">Variable</span>
        <h2>${esc(varName(v))}</h2>
        <p class="term-id">${esc(v.observationVariableDbId)}<a href="#/${enc(id)}/${enc(v.observationVariableDbId)}">Open variable page</a></p>
        ${variableBody(v)}`;
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
      <p class="lede">${docLink(v.documentationURL)}</p>
      ${variableBody(v)}`;
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
        apart: the cropontology.org database and the crop repositories in the
        <a href="https://github.com/Planteome">Planteome</a> GitHub organization. Some crops have been updated in one
        and not the other, and the cropontology.org BrAPI service can take minutes to answer for a single crop.</p>
        <p>This site collects both copies, merges them crop by crop, and serves the result as plain files that load
        quickly and don't depend on a database being up.</p>

        <h2>What it offers</h2>
        <ul>
          <li>A <strong>BrAPI v2 base URL</strong> for every crop, and one for all crops together, that Field Book and
          other <a href="https://brapi.org/specification">BrAPI</a> clients can import traits from.</li>
          <li>A <strong>variable list</strong> and a <strong>trait browser</strong> for each crop, to look up a trait,
          method or scale before using it.</li>
          <li>A record of <a href="#/changes">every change</a> made to the source data, so nothing is altered silently.</li>
        </ul>

        <h2>Where the data comes from</h2>
        <p>Both sources are checked every week and kept in the repository exactly as they were downloaded.
        cropontology.org was last checked ${esc(checked(sources?.cropontology) ?? 'recently')}; Planteome GitHub
        ${esc(checked(sources?.planteome) ?? 'recently')}. ${fromGitHub} of ${ontologies.length} crops currently
        prefer the Planteome GitHub copy where the two disagree.</p>
        ${c?.policy?.merge?.length ? `<p>For each crop:</p><ul>${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <p>The date on each crop is the last change to the copy served here: the GitHub file's last commit, or the
        last time cropontology.org reloaded that ontology.</p>

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
    setTitle('Changes from sources');
    const c = await loadChanges();
    if (!c) { app.innerHTML = '<h1>Changes from sources</h1><p class="muted">No change log is available.</p>'; return; }
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
      <h1>Changes from sources</h1>
      <p class="lede">Each crop is built from two sources, cropontology.org and the Planteome GitHub trait
      dictionaries. Both are kept in the repository exactly as downloaded. This page lists everything the published
      site and BrAPI endpoints change, and why. Changed records also note it in their <code>additionalInfo</code>.</p>
      <p class="toc">${sections.map(([key, label]) => `<a href="#/changes" data-jump="${key}">${label}</a>`).join(' &nbsp;|&nbsp; ')}</p>

      <h2 id="sources">Which copy each crop uses</h2>
      ${c.policy?.merge?.length ? `<ul class="prose">${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${table(['Crop', 'Preferred copy', 'From cropontology.org', 'From GitHub', 'Match', 'Differ', 'Why'], perOntology.map((x) => [
        crop(x.ontologyDbId), esc(x.preferred), num(x.fromCropontology), num(x.fromPlanteome), num(x.agree), num(x.disagree), esc(x.reason ?? '')]), [2, 3, 4, 5])}

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
      treated as the same variable renumbered. Variables marked obsolete on GitHub are left out too.</p>
      ${table(['Crop', 'Left out', 'Name', 'From', 'Kept instead'], (c.duplicates ?? []).map((x) => [
        crop(x.ontologyDbId), `<code>${esc(x.id)}</code>`, esc(x.name ?? ''), esc(x.source), varLink(x.ontologyDbId, x.keptId)]))}
      ${(c.obsoleteExcluded ?? []).length ? `<h3>Obsolete on GitHub</h3>${table(['Crop', 'Variables'], c.obsoleteExcluded.map((x) => [crop(x.ontologyDbId), num(x.count)]), [1])}` : ''}

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
    const active = first === 'about' || first === 'changes' ? first : 'crops';
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
      if (!first) await home();
      else if (first === 'about') await about();
      else if (first === 'changes') await changesPage();
      else if (!second) await ontology(first);
      else if (second === 'browse') await browser(first, third);
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
  window.addEventListener('hashchange', route);
  route();
})();
