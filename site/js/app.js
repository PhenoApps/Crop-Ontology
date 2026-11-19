// PhenoApps Crop Ontology: a hash-routed viewer over the static files that scripts/build.mjs writes.
//   #/                          crops
//   #/about[/SECTION]           what the site is for, its data, BrAPI and maintenance (SECTION scrolls to it)
//   #/conflicts[/CO_325]        where the sources disagree and what the build changes, optionally for one crop
//   #/CO_325                    one crop's variable list
//   #/CO_325/browse[/TERM_ID]   trait browser: trait class > trait > variable tree beside the selected term
//   #/CO_325/graph              network graph of the ontology
//   #/CO_325/CO_325:0000577     one variable
//
// Each view lives in views/ and renders into #app. A view may return a handle: the trait browser's
// { id, select } lets a new term be picked without a rebuild, and the graph's { stop } halts its simulation.

import { fillQrCodes } from './qr.js';
import { app, esc, hashParts } from './util.js';
import { about } from './views/about.js';
import { browser } from './views/browser.js';
import { conflicts } from './views/conflicts.js';
import { graphView } from './views/graph.js';
import { home } from './views/home.js';
import { variable } from './views/variable.js';
import { variableList } from './views/variable-list.js';

let current = null; // handle returned by the view on screen
let routeSeq = 0; // a slow view that finishes after a newer route mustn't replace its handle

function setNav(first) {
  const active = first === 'about' ? 'about' : first === 'conflicts' || first === 'changes' ? 'conflicts' : 'crops';
  for (const a of document.querySelectorAll('#nav [data-nav]')) {
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function render(first, second, third) {
  if (!first) return home();
  if (first === 'about') return about();
  if (first === 'conflicts' || first === 'changes') return conflicts(second);
  if (!second) return variableList(first);
  if (second === 'browse') return browser(first, third);
  if (second === 'graph') return graphView(first);
  return variable(first, second);
}

async function route() {
  const [first, second, third] = hashParts();
  setNav(first);
  try {
    if (first && second === 'browse' && current?.select && current.id === first && app.querySelector('#tree')) {
      current.select(third, true);
      return;
    }
    current?.stop?.();
    current = null;
    const seq = ++routeSeq;
    const handle = await render(first, second, third);
    if (seq !== routeSeq) { handle?.stop?.(); return; }
    current = handle ?? null;
    const section = first === 'about' && second ? document.getElementById(second) : null;
    if (section) section.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  } catch (err) {
    app.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(err.message)}</p>`;
  }
}

// In-page jumps (data-jump="<element id>") and copy buttons (data-copy="<text>"), wherever a view renders them.
document.addEventListener('click', async (e) => {
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    e.preventDefault();
    document.getElementById(jump.dataset.jump)?.scrollIntoView({ block: 'start' });
    return;
  }
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  btn.dataset.label ??= btn.textContent;
  try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = 'Copied'; } catch { btn.textContent = 'Copy failed'; }
  setTimeout(() => { btn.textContent = btn.dataset.label; }, 1500);
});

// Every link that leaves the site opens in a new tab, wherever a view renders it.
function openExternalInNewTab(root) {
  for (const a of root.querySelectorAll('a[href]')) {
    if (a.origin !== location.origin && !a.target) { a.target = '_blank'; a.rel = 'noopener'; }
  }
}
openExternalInNewTab(document);
new MutationObserver(() => { openExternalInNewTab(app); fillQrCodes(app); }).observe(app, { childList: true, subtree: true });

window.addEventListener('hashchange', route);
route();
