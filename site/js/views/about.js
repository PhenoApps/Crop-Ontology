// #/about[/SECTION]  What the site is for, where its data comes from, how to use its BrAPI endpoints, and how
// it is kept up to date. #/about/brapi and the like scroll to that section (see app.js).

import { loadChanges, loadIndex } from '../data.js';
import { REPO, app, brapiBase, byName, day, esc, setTitle } from '../util.js';

const ISSUES = `${REPO}/issues/new/choose`;

// The BrAPI v2 base URL with a copy button and a crop picker: all crops, or one crop's own base URL.
function baseUrlBox(ontologies) {
  const options = [...ontologies].sort((a, b) => byName(a.name, b.name))
    .map((o) => `<option value="${esc(o.id)}">${esc(o.name)} (${esc(o.id)})</option>`).join('');
  return `
    <div class="endpoint">
      <span class="label" id="base-url-label">BrAPI v2 base URL</span>
      <div class="row">
        <select id="base-url-crop" aria-label="Crop"><option value="">All crops</option>${options}</select>
        <code id="base-url" aria-labelledby="base-url-label">${esc(brapiBase(''))}</code><button type="button" class="btn" data-copy="${esc(brapiBase(''))}">Copy</button>
      </div>
    </div>`;
}

function wireBaseUrlBox() {
  const pick = app.querySelector('#base-url-crop');
  pick?.addEventListener('change', () => {
    const url = brapiBase(pick.value);
    app.querySelector('#base-url').textContent = url;
    app.querySelector('.endpoint [data-copy]').dataset.copy = url;
  });
}

export async function about() {
  setTitle('About');
  const [{ ontologies, sources }, c] = await Promise.all([loadIndex(), loadChanges()]);
  const fromGitHub = ontologies.filter((o) => o.source?.preferred === 'planteome').length;
  const checked = (s) => (s?.checked ? day(s.checked) : null);
  app.innerHTML = `
    <div class="prose">
      <h1>About</h1>
      <p class="lede">The PhenoApps Crop Ontology publishes the Crop Ontology trait dictionaries in a form that
      phenotyping apps can import directly. It is maintained by the <a href="https://phenoapps.org">PhenoApps</a>
      development team.</p>

      <h2 id="why">Why it exists</h2>
      <p>The <a href="https://cropontology.org">Crop Ontology</a> defines standard observation variables for
      ${ontologies.length} crops. Each variable pairs a trait (what is observed) with a method (how) and a scale
      (the units or categories recorded). Using the same variables across trials and programs is what makes
      phenotypic data comparable. Currently, the trait dictionaries are kept in two places: the Crop Ontology
      database and the crop repositories in the <a href="https://github.com/Planteome">Planteome</a> organization on
      GitHub. Some crops have been updated in one and not the other. This site collects both copies, merges them, and
      serves the result as plain files that load quickly and don't depend on a backend database.</p>

      <h2 id="data">Where the data comes from</h2>
      <p>Both sources are kept in the repository exactly as they were downloaded. ${fromGitHub} of
      ${ontologies.length} crops currently prefer the Planteome copy where the two disagree.</p>
      ${c?.policy?.merge?.length ? `<p>For each crop:</p><ul>${c.policy.merge.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      <p>The date on each crop is the last change to the copy served here: the Planteome file's last commit, or the
      last time Crop Ontology reloaded that ontology. Everything the build changes in the source data is listed on
      the <a href="#/conflicts">Conflicts</a> page.</p>

      <h2 id="brapi">BrAPI</h2>
      ${baseUrlBox(ontologies)}
      <p>Each base URL answers <code>serverinfo</code>, <code>commoncropnames</code>, <code>ontologies</code>,
      <code>variables</code>, <code>traits</code>, <code>methods</code>, and <code>scales</code>. Every variable
      includes its trait, method, and scale, and its <code>commonCropName</code>, so a client using the default base
      URL can filter by crop. Where the build changed something from the sources, the record notes it in its
      <code>additionalInfo</code>.</p>

      <h3 id="field-book">Field Book</h3>
      <p><a href="https://github.com/PhenoApps/Field-Book">Field Book</a> allows traits from this site to be added
      through the Crop Ontology Settings. QR codes on the site can be scanned to add entire crops or individual
      variables to Field Book.</p>

      <h3 id="limitations">Limitations</h3>
      <p>The site is plain files on GitHub Pages with no server backend, which changes how the BrAPI endpoints
      behave:</p>
      <ul>
        <li><strong>Content type.</strong> GitHub Pages chooses a file's content type based on its extension. Since
        BrAPI paths have none, they are sent as <code>application/octet-stream</code> rather than
        <code>application/json</code>. Browsers and most HTTP clients read them as JSON, but other clients may reject
        them.</li>
        <li><strong>No query parameters.</strong> Every call returns its whole list as one page, ignoring any filters
        such as <code>ontologyDbId</code>, <code>traitClass</code>, or <code>pageSize</code>. The all-crops variable
        list is over 20 MB before compression, so use a crop-specific base URL where you can.</li>
        <li><strong>No lookups by ID or searches.</strong> Calls with an ID in the path, such as
        <code>variables/{id}</code>, and <code>search</code> calls aren't available. To get a single record, load the
        entire list and pick out the specific record by ID.</li>
        <li><strong>Read only.</strong> Only GET requests work.</li>
        <li><strong>Caching.</strong> Files may be briefly cached, so updates can be delayed.</li>
      </ul>

      <h2 id="maintenance">Maintenance</h2>
      <p>A scheduled job on GitHub refreshes the data every Monday at 06:17 UTC:</p>
      <ul>
        <li>Any ontologies that have been updated on cropontology.org are redownloaded.</li>
        <li>Each Planteome repository is copied if its latest commit changed.</li>
        <li>The two sources are compared, and any changes are proposed to the maintainers for review. The site is
        rebuilt and redeployed once they're accepted.</li>
        <li>If a source fails to download, the crops that did download are still published and the run is flagged
        as failed for the maintainers.</li>
      </ul>
      <p>Crop Ontology was last checked ${esc(checked(sources?.cropontology) ?? 'recently')}; Planteome
      ${esc(checked(sources?.planteome) ?? 'recently')}. Errors in a trait itself, such as a wrong description or a
      missing scale category, belong with the crop's curators, on cropontology.org or in the crop's Planteome
      repository; each variable's page links to its sources, and fixes made there appear here after the next weekly
      run.</p>
      <p>Problems with this site or its BrAPI endpoints, such as a page that doesn't load, an app that can't import
      from it, or a merge or repair that looks wrong, can be reported as an <a href="${ISSUES}">issue on GitHub</a>,
      with the crop and variable IDs.</p>

      <h2 id="credit">Credit</h2>
      <p>The trait dictionaries are the work of the crop communities and curators of the Crop Ontology. The license
      for each crop is displayed on its page. This site is not the official Crop Ontology.</p>
    </div>`;
  wireBaseUrlBox();
}
