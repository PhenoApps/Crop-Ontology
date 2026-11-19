// #/CO_320/CO_320:0000007  One variable with its trait, method and scale.
//
// The QR code holds the variable's BrAPI URL, {crop base URL}/variables/{variable ID}, the same shape as on any
// BrAPI server. A client that scans it (Field Book) splits it at "/variables/" into the base URL and the ID,
// loads {base}/variables (static hosting can't serve the single-record path), and adds the matching variable.

import { notFound, variableDetails, variableIntro } from '../components.js';
import { findOntology, loadVariables } from '../data.js';
import { app, enc, esc, setTitle, variableBrapiUrl } from '../util.js';

function scanCard(o, v) {
  const url = variableBrapiUrl(o.id, v.observationVariableDbId);
  return `
    <aside class="scan" aria-labelledby="scan-label">
      <span class="label" id="scan-label">Add to Field Book</span>
      <span class="qr" data-qr="${esc(url)}" role="img" aria-label="QR code of this variable's BrAPI address, for scanning in Field Book" title="${esc(url)}"></span>
      <p>Scan in Field Book to add this variable as a trait.</p>
    </aside>`;
}

export async function variable(id, varId) {
  const o = await findOntology(id);
  if (!o) return notFound();
  const v = (await loadVariables(id)).find((x) => x.observationVariableDbId === varId);
  if (!v) return notFound();
  const name = v.observationVariableName ?? varId;
  setTitle(`${name} | ${o.name}`);
  app.innerHTML = `
    <nav class="crumbs"><a href="#/">Crops</a> / <a href="#/${enc(id)}">${esc(o.name)}</a> / <a href="#/${enc(id)}/browse/${enc(v.trait?.traitDbId ?? varId)}">${esc(v.trait?.traitName ?? 'Trait')}</a></nav>
    <div class="var-head">
      <div>
        <div class="title-row"><h1>${esc(name)}</h1><span class="id">${esc(varId)}</span></div>
        ${variableIntro(v, o)}
      </div>
      ${scanCard(o, v)}
    </div>
    ${variableDetails(v)}`;
}
