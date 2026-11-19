// Small helpers shared by every view: escaping, formatting, URLs and the page title.

export const SITE = 'PhenoApps Crop Ontology';
export const app = document.getElementById('app');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const enc = encodeURIComponent;
export const num = (n) => Number(n ?? 0).toLocaleString();
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
export const setTitle = (t) => { document.title = t ? `${t} | ${SITE}` : SITE; };
export const hashParts = () => location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
export const terms = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);

// URLs of the published files, absolute so they can be copied or put in a QR code.
export const siteRoot = () => location.href.split('#')[0].replace(/[^/]*$/, '');
export const brapiBase = (id) => `${siteRoot()}${id ? `${id}/` : ''}brapi/v2`;
// A variable's BrAPI URL, {base}/variables/{observationVariableDbId}, as on any BrAPI server. Its QR code holds
// this. Static hosting can't serve the path itself, so a client splits it at "/variables/" into the base URL
// and the ID, loads {base}/variables and picks the record out. IDs (CO_321:0001034) are left unencoded: ':' is
// allowed in a path segment, and a plain ID is simpler for the scanning app to split out.
export const variableBrapiUrl = (id, varId) => `${brapiBase(id)}/variables/${varId}`;
export const coTermUrl = (id) => `https://cropontology.org/term/${id}`;
// The repository, and a new-issue link that opens one of its forms (.github/ISSUE_TEMPLATE) with fields filled in.
export const REPO = 'https://github.com/PhenoApps/Crop-Ontology';
export const issueUrl = (template, fields = {}) => `${REPO}/issues/new?${new URLSearchParams({ template, ...fields })}`;

// Source dates come in several shapes ("2025-01-15T12:44:37-08:00", "2020-08-05 08:26:03.997000"); show the day.
export function day(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], m[2] - 1, +m[3]))
    .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export const chevron = (dir) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${dir === 'down' ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const EXT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A link that leaves the site (app.js makes every such link open in a new tab).
export const extLink = (url, text) => `<a class="ext" href="${esc(url)}">${esc(text)}${EXT}<span class="sr">(opens in a new tab)</span></a>`;

// Lazily load a script from cdnjs once; `global` is the name it defines on window.
export function loadScript(src, global, what) {
  let p = null;
  return () => (p ??= new Promise((resolve, reject) => {
    if (window[global]) { resolve(window[global]); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window[global]);
    s.onerror = () => { p = null; reject(new Error(`Could not load ${what} from cdnjs.`)); };
    document.head.append(s);
  }));
}
