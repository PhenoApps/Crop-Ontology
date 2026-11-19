// #/about[/SECTION]  What the site is for, where its data comes from, how to use its BrAPI endpoints, and how
// it is kept up to date. #/about/brapi and the like scroll to that section (see app.js).

import { loadChanges, loadIndex } from '../data.js';
import { app, brapiBase, byName, day, esc, setTitle, siteRoot } from '../util.js';

const ISSUES = 'https://github.com/PhenoApps/Crop-Ontology/issues';

// The BrAPI v2 base URL with a copy button and a crop picker: all crops, or one crop's own base URL.
function baseUrlBox(ontologies) {
  const options = [...ontologies].sort((a, b) => byName(a.name, b.name))
    .map((o) => `<option value="${esc(o.id)}">${esc(o.name)} (${esc(o.id)})</option>`).join('');
  return `
    <div class="endpoint">
      <div class="endpoint-head">
        <span class="label" id="base-url-label">BrAPI v2 base URL</span>
        <select id="base-url-crop" aria-label="Crop"><option value="">All crops</option>${options}</select>
      </div>
      <div class="row"><code id="base-url" aria-labelledby="base-url-label">${esc(brapiBase(''))}</code><button type="button" class="btn" data-copy="${esc(brapiBase(''))}">Copy</button></div>
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
  const root = siteRoot();
  app.innerHTML = `
    <div class="prose">
      <h1>About</h1>
      <p class="lede">The PhenoApps Crop Ontology publishes the Crop Ontology trait dictionaries in a form that
      phenotyping apps can import directly. It is maintained by <a href="https://phenoapps.org">PhenoApps</a>, the
      group behind <a href="https://github.com/PhenoApps/Field-Book">Field Book</a>.</p>

      <h2 id="why">Why it exists</h2>
      <p>The <a href="https://cropontology.org">Crop Ontology</a> defines standard observation variables for
      ${ontologies.length} crops. Each variable pairs a trait (what is observed) with a method (how) and a scale
      (the units or categories recorded). Using the same variables across trials and programs is what makes
      phenotypic data comparable, so Field Book users should be able to start from them rather than typing traits
      in by hand.</p>
      <p>Getting them into an app has not been easy. The trait dictionaries are kept in two places that have drifted
      apart: the Crop Ontology database behind cropontology.org, and the crop repositories in the
      <a href="https://github.com/Planteome">Planteome</a> organization on GitHub. Some crops have been updated in one
      and not the other.</p>
      <p>cropontology.org also has only limited <a href="https://brapi.org/specification">BrAPI</a> support. Its
      service lists six calls, covering variables, traits and ontologies, and has no <code>commoncropnames</code>,
      <code>methods</code> or <code>scales</code>. It ignores paging, returns some lists under
      <code>result.data</code> as the specification requires and others directly under <code>result</code>, and
      returns errors when asked for a single variable or trait (<code>variables/{id}</code>,
      <code>traits/{id}</code>), though it lists both calls. Listing one crop's variables
      takes from half a minute to several minutes, and for some crops fails outright.</p>
      <p>This site collects both copies, merges them crop by crop, and serves the result as plain files that load
      quickly and don't depend on a database being up.</p>

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
      <code>variables</code>, <code>traits</code>, <code>methods</code> and <code>scales</code>. Every variable
      includes its trait, method and scale, and its <code>commonCropName</code> is its crop's name, so a client using
      the all-crops URL can filter by crop. Where the build changed something from the sources, the record notes it
      in its <code>additionalInfo</code>.</p>

      <h3>In Field Book</h3>
      <p>Field Book has this site built in, so its traits can be added without setting up a BrAPI server. Each
      variable's page has a QR code: scan it in Field Book to add that variable as a trait. The code holds the
      variable's BrAPI address, its crop's base URL followed by <code>/variables/</code> and its ID, such as
      <code>${esc(root)}CO_321/brapi/v2/variables/CO_321:0001034</code>. That address can't be opened here (see
      below), so Field Book reads the crop and the ID from it and picks the variable out of the crop's list.</p>

      <h3>Limits of GitHub Pages</h3>
      <p>The site is plain files on GitHub Pages with no server program behind it, which changes how the endpoints
      behave:</p>
      <ul>
        <li><strong>Content type.</strong> GitHub Pages chooses a file's content type from its extension. BrAPI paths
        such as <code>variables</code> have none, so they are sent as <code>application/octet-stream</code> rather
        than <code>application/json</code>. Browsers and most HTTP clients read them as JSON anyway, but clients that
        check the content type reject them.</li>
        <li><strong>No query parameters.</strong> Filters such as <code>ontologyDbId</code> or
        <code>traitClass</code>, and <code>page</code> and <code>pageSize</code>, are ignored. Every call returns its
        whole list as one page. The all-crops variable list is over 20 MB before compression, so use a crop's own
        base URL where you can.</li>
        <li><strong>No lookups by ID or searches.</strong> Calls with an ID in the path, such as
        <code>variables/{id}</code>, and <code>search</code> calls aren't available. To get one record, load the
        list and pick it out by ID.</li>
        <li><strong>Read only.</strong> Only GET requests work, and none need a login. Requests from other websites
        are allowed.</li>
        <li><strong>Caching.</strong> Files may be cached for up to 10 minutes, so an update can take that long to
        reach an app.</li>
      </ul>

      <h2 id="maintenance">Maintenance</h2>
      <p>A scheduled job on GitHub refreshes the data every Monday at 06:17 UTC:</p>
      <ul>
        <li>cropontology.org is checked for ontologies that changed, and only those are downloaded again. On the
        first Monday of each month every ontology is downloaded again, to catch edits the quick check can't see.</li>
        <li>Each Planteome repository is copied again if its latest commit changed.</li>
        <li>The two sources are compared, changed snapshots are committed to the repository, and the site is rebuilt
        and redeployed. If nothing changed upstream, nothing is redeployed.</li>
        <li>If a source fails to download, the crops that did download are still published and the run is flagged
        as failed for the maintainers.</li>
      </ul>
      <p>Crop Ontology was last checked ${esc(checked(sources?.cropontology) ?? 'recently')}; Planteome
      ${esc(checked(sources?.planteome) ?? 'recently')}. Errors in a trait itself, such as a wrong description or a
      missing scale category, belong with the crop's curators, on cropontology.org or in the crop's Planteome
      repository; each variable's page links to its sources, and fixes made there appear here after the next weekly
      run. Problems with this site or its BrAPI endpoints, such as a page that doesn't load, an app that can't import
      from it, or a merge or repair that looks wrong, can be reported as an <a href="${ISSUES}">issue on GitHub</a>,
      with the crop and variable IDs and, for import problems, the app and its version.</p>

      <h2 id="credit">Credit</h2>
      <p>The trait dictionaries are the work of the crop communities and curators of the Crop Ontology. Each crop
      keeps its own licence, shown on its page and in its BrAPI <code>ontologies</code> record. This site is not
      the official Crop Ontology.</p>
    </div>`;
  wireBaseUrlBox();
}
