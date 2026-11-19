// Element types (trait class, trait, variable, method, scale): a colour token and a distinct shape each, so
// identity never relies on colour alone. Shared by the graph and the trait browser icons.

export const NODE_TYPES = [
  { key: 'term', label: 'Ontology and trait class', shape: 'hexagon', token: '--node-term' },
  { key: 'trait', label: 'Trait', shape: 'square', token: '--node-trait' },
  { key: 'variable', label: 'Variable', shape: 'circle', token: '--node-variable' },
  { key: 'method', label: 'Method', shape: 'triangle', token: '--node-method' },
  { key: 'scale', label: 'Scale', shape: 'diamond', token: '--node-scale' },
];

export const typeLabel = (type) => NODE_TYPES.find((t) => t.key === type).label;

export function glyphSvg(t) {
  const p = {
    circle: '<circle cx="8" cy="8" r="5.5"/>', square: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>',
    triangle: '<path d="M8 2 14 13.5H2Z"/>', diamond: '<path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/>',
    hexagon: '<path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z"/>',
  }[t.shape];
  return `<svg viewBox="0 0 16 16" aria-hidden="true" style="fill:var(${t.token})">${p}</svg>`;
}

// Element-type icon for inline use, matching the graph.
export const glyph = (key) => glyphSvg(NODE_TYPES.find((t) => t.key === key)).replace('<svg ', '<svg class="glyph" ');
