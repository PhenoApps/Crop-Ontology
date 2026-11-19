// #/CO_320/graph  A force-directed network like the ontology explorer on cropontology.org: the ontology and its
// trait classes, traits, and each variable joined to its trait, method and scale. Shared methods and scales
// become hubs. d3 (force layout, zoom, drag) is loaded only when this view opens.
//
// Returns { stop } so the router can halt the simulation when the route changes.

import { notFound, ontologyHead, ontologyNotes } from '../components.js';
import { findOntology, loadChanges, loadVariables } from '../data.js';
import { NODE_TYPES, glyphSvg, typeLabel } from '../glyphs.js';
import { app, enc, esc, hashParts, loadScript, num, plural, setTitle } from '../util.js';

const loadD3 = loadScript('https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js', 'd3', 'the graph library (d3)');

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

export async function graphView(id) {
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
        <canvas id="g-canvas" aria-label="Network graph of ${esc(o.name)} traits, methods, scales, and variables. The variable list and trait browser tabs show the same data as text."></canvas>
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
      body = `<p><a href="#/${enc(id)}/browse/${enc(n.key)}">Open in trait browser</a></p><p>Used by ${plural(n.vars.length, 'variable')}:</p><ul>${n.vars.slice(0, 12).map((v) =>
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
  drawLegend();
  resize();
  start();
  return { stop: () => { sim?.stop(); ro.disconnect(); } };
}
