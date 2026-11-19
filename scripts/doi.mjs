// The DOI an ontology's cropontology.org page links to. Curators put a Zenodo DOI badge in the ontology's
// description, linked as https://zenodo.org/doi/10.5281/zenodo.N (the all-versions DOI),
// https://doi.org/10.…, or https://zenodo.org/records/N (record N, DOI 10.5281/zenodo.N). The site has no
// other DOI links, so any on the page belong to the ontology. A Zenodo DOI is preferred over others, such as a
// journal article that Quinoa's page also cites.

export function doiFromPage(html) {
  const dois = [];
  for (const [, href] of String(html).matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    const doi = href.match(/\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s?#]+)/i)?.[1]
      ?? href.match(/\/\/zenodo\.org\/doi\/(10\.\d{4,9}\/[^\s?#]+)/i)?.[1]
      ?? href.match(/\/\/zenodo\.org\/records?\/(\d+)/i)?.[1]?.replace(/^/, '10.5281/zenodo.');
    if (doi) dois.push(decodeURIComponent(doi).replace(/[/.]+$/, ''));
  }
  return dois.find((d) => /^10\.5281\/zenodo\./i.test(d)) ?? dois[0] ?? null;
}
