// Highlight what changed between two versions of a text, for the Conflicts page's repaired text table. Returns
// { before, after, changes }: each side as escaped HTML with the changed stretches in <mark class="was"> or
// <mark class="now"> (or the classes given), both in full and in a short version that starts just before the first change; and how many
// separate changes there are.
//
// The texts are compared as tokens (ASCII words, whitespace runs and single other characters), so "?13C" → "δ13C"
// marks just "?" and "δ", and "Qu?bec" → "Québec" just "?" and "é".

import { esc } from './util.js';

const tokens = (s) => String(s).match(/\s+|[A-Za-z0-9_]+|[^]/gu) ?? [];

export function diffHtml(before, after, [wasClass, nowClass] = ['was', 'now']) {
  const a = tokens(before);
  const b = tokens(after);
  // The common start and end are unchanged; only the middle needs comparing.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);

  // Longest common subsequence of the middles, then walk it to mark tokens only one side has.
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const was = [];
  const now = [];
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && x[i] === y[j]) { was.push([x[i++], false]); now.push([y[j++], false]); }
    else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) was.push([x[i++], true]);
    else now.push([y[j++], true]);
  }

  const render = (head, middle, tail, cls, short) => {
    let lead = head.join('');
    // The short version starts shortly before the first change, so a clamped cell still shows it.
    if (short && lead.length > CONTEXT) lead = `…${lead.slice(lead.indexOf(' ', lead.length - CONTEXT) + 1 || lead.length - CONTEXT)}`;
    let html = esc(lead);
    for (let k = 0; k < middle.length;) {
      const changed = middle[k][1];
      let text = '';
      while (k < middle.length && middle[k][1] === changed) text += middle[k++][0];
      html += changed ? `<mark class="${cls}">${esc(text)}</mark>` : esc(text);
    }
    return html + esc(tail.join(''));
  };
  const side = (t, middle, cls) => ({
    full: render(t.slice(0, start), middle, t.slice(t.length - end), cls, false),
    short: render(t.slice(0, start), middle, t.slice(t.length - end), cls, true),
  });
  return { before: side(a, was, wasClass), after: side(b, now, nowClass), changes: Math.max(...[was, now].map(countRuns)) };
}

const CONTEXT = 30; // characters of unchanged text kept before the first change in the short version
// How many separate changed stretches one side has.
const countRuns = (list) => list.reduce((n, [, changed], k) => n + (changed && !list[k - 1]?.[1] ? 1 : 0), 0);
