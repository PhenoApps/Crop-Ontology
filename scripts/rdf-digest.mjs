// Content digest of cropontology.org's RDF/XML ontology export, stable across requests.
//
// The export says the same thing in different ways on every request: blank-node ids are random,
// namespace prefixes (ns1, ns2…) are reassigned, elements come out in a different order, a class is
// sometimes referenced (rdf:resource) and sometimes described inline, and literals are sometimes
// CDATA. So the digest is taken over the triples rather than the text:
//   parse to triples → name each blank node by a hash of its own content → sort → sha256.
// The parser covers the RDF/XML forms this export uses (typed and rdf:Description node elements,
// rdf:about / rdf:nodeID subjects, rdf:resource objects, nested node elements, literals with
// xml:lang). It isn't a general RDF/XML parser.

import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
  const hex = e[1] === 'x' || e[1] === 'X';
  return String.fromCodePoint(parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10));
});

export function rdfTriples(xml) {
  const ns = {};
  for (const m of xml.matchAll(/xmlns:(\w+)="([^"]*)"/g)) ns[m[1]] = m[2];
  const iri = (qname) => {
    const [prefix, local] = qname.split(':');
    return local == null ? qname : (ns[prefix] ?? `${prefix}:`) + local;
  };
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));

  const triples = [];
  const stack = []; // frames: { kind: 'root' } | { kind: 'node', subj } | { kind: 'prop', pred, lang, text, obj }
  let anon = 0;
  const tokens = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>)/);

  for (const tok of tokens) {
    if (!tok) continue;
    const cdata = tok.startsWith('<![CDATA[');
    if (cdata || !tok.startsWith('<')) {
      // Text and CDATA decode to the same string, so a literal hashes the same however it was escaped.
      const top = stack.at(-1);
      if (top?.kind === 'prop') top.text += cdata ? tok.slice(9, -3) : decode(tok);
      continue;
    }
    const name = tok.match(/^<\/?([\w:.-]+)/)?.[1];
    if (!name) continue;
    if (tok.startsWith('</')) {
      const frame = stack.pop();
      if (frame?.kind === 'prop' && frame.obj == null) {
        triples.push([stack.at(-1).subj, frame.pred, `"${frame.text.trim()}"@${frame.lang ?? ''}`]);
      }
      continue;
    }
    const selfClosing = tok.endsWith('/>');
    const a = attrs(tok);
    if (name === 'rdf:RDF') { if (!selfClosing) stack.push({ kind: 'root' }); continue; }

    const parent = stack.at(-1);
    if (!parent || parent.kind === 'root' || parent.kind === 'prop') {
      // Node element.
      const subj = a['rdf:about'] != null ? `<${a['rdf:about']}>` : `_:${a['rdf:nodeID'] ?? `anon${anon++}`}`;
      if (name !== 'rdf:Description') triples.push([subj, RDF_TYPE, `<${iri(name)}>`]);
      if (parent?.kind === 'prop') {
        parent.obj = subj;
        triples.push([stack.at(-2).subj, parent.pred, subj]);
      }
      if (!selfClosing) stack.push({ kind: 'node', subj });
    } else {
      // Property element.
      const pred = iri(name);
      if (a['rdf:resource'] != null || a['rdf:nodeID'] != null) {
        triples.push([parent.subj, pred, a['rdf:resource'] != null ? `<${a['rdf:resource']}>` : `_:${a['rdf:nodeID']}`]);
        if (!selfClosing) stack.push({ kind: 'prop', pred, obj: 'resource' });
      } else if (!selfClosing) {
        stack.push({ kind: 'prop', pred, lang: a['xml:lang'], text: '' });
      }
    }
  }
  return triples;
}

export const rdfDigest = (xml) => digestTriples(rdfTriples(xml));

// IDs of the observation variables declared in an ontology's RDF (classes under …/rdf/Variable).
export function variableIds(triples) {
  const SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
  return [...new Set(triples
    .filter(([s, p, o]) => p === SUBCLASS && o === '<https://cropontology.org/rdf/Variable>' && s.startsWith('<'))
    .map(([s]) => s.slice(1, -1).split('/rdf/').pop()))].sort();
}

export function digestTriples(triples) {
  const isBlank = (t) => t.startsWith('_:');
  // Blank nodes in this export are leaf owl:Restrictions; name each by a hash of its own pairs.
  const content = new Map();
  for (const [s, p, o] of triples) {
    if (!isBlank(s)) continue;
    if (!content.has(s)) content.set(s, new Set());
    content.get(s).add(`${p} ${o}`);
  }
  const label = new Map([...content].map(([id, pairs]) => [id, `_:${sha([...pairs].sort().join('\n')).slice(0, 16)}`]));
  const lines = new Set();
  for (const [s, p, o] of triples) {
    if (!isBlank(s)) lines.add(`${s} ${p} ${isBlank(o) ? label.get(o) ?? o : o}`);
  }
  for (const [id, pairs] of content) lines.add(`${label.get(id)} := ${[...pairs].sort().join(' | ')}`);
  return sha([...lines].sort().join('\n'));
}
