// QR codes: any element with data-qr="<text>" gets an SVG QR code of that text once the small
// qrcode-generator library has loaded, or shows the text if it can't load.

import { esc, loadScript } from './util.js';

const loadQr = loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'qrcode', 'the QR code library');

function qrSvg(make, text) {
  const qr = make(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}" fill="#1f2328"/></svg>`;
}

export async function fillQrCodes(root) {
  const pending = [...root.querySelectorAll('[data-qr]:not([data-qr-done])')];
  if (!pending.length) return;
  for (const el of pending) el.dataset.qrDone = '1';
  try {
    const make = await loadQr();
    for (const el of pending) el.innerHTML = qrSvg(make, el.dataset.qr);
  } catch {
    for (const el of pending) { el.classList.add('qr-failed'); el.innerHTML = `<code>${esc(el.dataset.qr)}</code>`; }
  }
}
