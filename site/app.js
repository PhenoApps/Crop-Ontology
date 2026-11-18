// Crop Ontology mirror: tiny hash-routed viewer over the static BrAPI files.
//   #/                      ontology list
//   #/CO_325                variables of one ontology
//   #/CO_325/CO_325:0000577 one variable
(() => {
  const app = document.getElementById('app');
  const PAGE = 100;
  const cache = new Map();
  let index = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const enc = encodeURIComponent;
  const brapiBase = (id) => new URL(`${id}/brapi/v2`, location.href.split('#')[0]).href;

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} loading ${url}`);
    return res.json();
  }

  async function loadIndex() {
    if (!index) {
      index = await getJson('ontologies.json');
      const when = new Date(index.updatedAt);
      document.getElementById('snapshot').textContent =
        `Copied from cropontology.org · updated ${when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
    }
    return index;
  }

  async function loadVariables(id) {
    if (!cache.has(id)) cache.set(id, getJson(`${id}/brapi/v2/variables`).then((b) => b.result.data));
    return cache.get(id);
  }

  // ---- views ----------------------------------------------------------------------------

  async function home() {
    const { ontologies } = await loadIndex();
    document.title = 'Crop Ontology Mirror';
    app.innerHTML = `
      <h1>Crop ontologies</h1>
      <p class="muted">${ontologies.length} trait dictionaries, ${ontologies.reduce((n, o) => n + o.variableCount, 0).toLocaleString()} observation variables.</p>
      <div class="toolbar"><input type="search" id="q" placeholder="Filter by crop, ID or description" aria-label="Filter ontologies"></div>
      <div class="grid" id="grid"></div>`;
    const grid = app.querySelector('#grid');
    const draw = (q) => {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = ontologies.filter((o) => {
        const hay = `${o.id} ${o.name} ${o.description ?? ''} ${o.crops.join(' ')}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
      grid.innerHTML = hits.map((o) => `
        <a class="card" href="#/${enc(o.id)}">
          <h3>${esc(o.name)}</h3>
          <div class="id">${esc(o.id)}</div>
          ${o.description ? `<p>${esc(o.description)}</p>` : ''}
          <div class="n">${o.variableCount.toLocaleString()} variables</div>
        </a>`).join('') || '<p class="muted">No ontologies match.</p>';
    };
    const q = app.querySelector('#q');
    q.addEventListener('input', () => draw(q.value));
    draw('');
  }

  function endpointBox(id) {
    const url = brapiBase(id);
    return `
      <div class="endpoint">
        <label for="ep">BrAPI v2 base URL (for Field Book and other BrAPI clients)</label>
        <div class="row"><code id="ep">${esc(url)}</code><button type="button" data-copy="${esc(url)}">Copy</button></div>
      </div>`;
  }

  async function ontology(id, state = {}) {
    const { ontologies } = await loadIndex();
    const o = ontologies.find((x) => x.id === id);
    if (!o) return notFound();
    document.title = `${o.name} · Crop Ontology Mirror`;
    app.innerHTML = `
      <div class="crumbs"><a href="#/">All ontologies</a></div>
      <h1>${esc(o.name)}</h1>
      <div class="meta">
        <span>${esc(o.id)}</span>
        ${o.version ? `<span>Version ${esc(o.version)}</span>` : ''}
        ${o.licence ? `<span>Licence ${esc(o.licence)}</span>` : ''}
        <a href="https://cropontology.org/ontology/${enc(o.id)}">View on cropontology.org</a>
      </div>
      ${o.description ? `<p>${esc(o.description)}</p>` : ''}
      ${endpointBox(o.id)}
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search variables, traits, methods, scales" aria-label="Search variables" value="${esc(state.q ?? '')}">
        <select id="cls" aria-label="Trait class"><option value="">All trait classes</option>${o.traitClasses.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <select id="dt" aria-label="Data type"><option value="">All data types</option></select>
        <span class="count" id="count"></span>
      </div>
      <ul class="vars" id="list"><li class="muted" style="padding:10px 14px">Loading variables…</li></ul>
      <button type="button" class="more" id="more" hidden>Show more</button>`;

    const vars = await loadVariables(id);
    if (location.hash.split('/')[1] !== enc(id) && location.hash.split('/')[1] !== id) return; // navigated away
    const types = [...new Set(vars.map((v) => v.scale?.dataType).filter(Boolean))].sort();
    const dt = app.querySelector('#dt');
    dt.insertAdjacentHTML('beforeend', types.map((t) => `<option>${esc(t)}</option>`).join(''));
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
      <li><a class="var" href="#/${enc(id)}/${enc(v.observationVariableDbId)}">
        <span class="name">${esc(v.observationVariableName ?? v.observationVariableDbId)}<span class="sub">${esc(v.observationVariableDbId)}</span></span>
        <span class="trait">${esc(v.trait?.traitName ?? '')}<span class="sub">${esc([v.method?.methodName, v.scale?.scaleName].filter(Boolean).join(' · '))}</span></span>
        <span class="tag">${esc(v.scale?.dataType ?? '—')}</span>
      </a></li>`;

    const draw = () => {
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = vars.filter((v) =>
        (!cls.value || v.trait?.traitClass === cls.value) &&
        (!dt.value || v.scale?.dataType === dt.value) &&
        terms.every((t) => hay.get(v).includes(t)));
      count.textContent = `${hits.length.toLocaleString()} of ${vars.length.toLocaleString()}`;
      list.innerHTML = hits.slice(0, shown).map(row).join('') || '<li class="muted" style="padding:10px 14px">No variables match.</li>';
      more.hidden = hits.length <= shown;
    };
    const reset = () => { shown = PAGE; draw(); };
    q.addEventListener('input', reset);
    cls.addEventListener('change', reset);
    dt.addEventListener('change', reset);
    more.addEventListener('click', () => { shown += PAGE * 2; draw(); });
    draw();
  }

  const field = (label, value) => (value == null || value === '' || (Array.isArray(value) && !value.length))
    ? '' : `<dt>${esc(label)}</dt><dd>${Array.isArray(value) ? value.map(esc).join(', ') : esc(value)}</dd>`;

  async function variable(id, varId) {
    const { ontologies } = await loadIndex();
    const o = ontologies.find((x) => x.id === id);
    if (!o) return notFound();
    const v = (await loadVariables(id)).find((x) => x.observationVariableDbId === varId);
    if (!v) return notFound();
    const t = v.trait ?? {};
    const m = v.method ?? {};
    const s = v.scale ?? {};
    const vv = s.validValues ?? {};
    document.title = `${v.observationVariableName} · ${o.name}`;
    app.innerHTML = `
      <div class="crumbs"><a href="#/">All ontologies</a> › <a href="#/${enc(id)}">${esc(o.name)}</a></div>
      <h1>${esc(v.observationVariableName ?? varId)}</h1>
      <div class="meta"><span>${esc(varId)}</span><a href="${esc(v.documentationURL)}">View on cropontology.org</a></div>
      <div class="detail" style="margin-top:16px">
        <dl>
          ${field('Crop', v.commonCropName)}
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
        <section class="detail">
          <h2>Trait</h2>
          <dl>
            ${field('Name', t.traitName)}${field('ID', t.traitDbId)}${field('Class', t.traitClass)}
            ${field('Description', t.description)}${field('Abbreviation', t.mainAbbreviation)}
            ${field('Other abbreviations', t.alternativeAbbreviations)}${field('Synonyms', t.synonyms)}
            ${field('Entity', t.entity)}${field('Attribute', t.attribute)}
          </dl>
        </section>
        <section class="detail">
          <h2>Method</h2>
          <dl>
            ${field('Name', m.methodName)}${field('ID', m.methodDbId)}${field('Class', m.methodClass)}
            ${field('Description', m.description)}${field('Formula', m.formula)}${field('Reference', m.reference)}
          </dl>
        </section>
        <section class="detail">
          <h2>Scale</h2>
          <dl>
            ${field('Name', s.scaleName)}${field('ID', s.scaleDbId)}${field('Data type', s.dataType)}
            ${field('Decimal places', s.decimalPlaces)}${field('Minimum', vv.minimumValue)}${field('Maximum', vv.maximumValue)}
          </dl>
          ${vv.categories?.length ? `<table class="cats" style="margin-top:10px"><tbody>${vv.categories.map((c) =>
            `<tr><td>${esc(c.value)}</td><td>${c.label !== c.value ? esc(c.label) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
        </section>
      </div>`;
  }

  function notFound() {
    app.innerHTML = '<h1>Not found</h1><p><a href="#/">Back to all ontologies</a></p>';
  }

  // ---- routing --------------------------------------------------------------------------

  async function route() {
    const [, id, varId] = location.hash.replace(/^#/, '').split('/').map((p) => decodeURIComponent(p ?? ''));
    try {
      if (!id) await home();
      else if (!varId) await ontology(id);
      else await variable(id, varId);
      window.scrollTo(0, 0);
    } catch (err) {
      app.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(err.message)}</p>`;
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = 'Copied'; }
    catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  window.addEventListener('hashchange', route);
  route();
})();
