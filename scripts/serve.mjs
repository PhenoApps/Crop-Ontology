#!/usr/bin/env node
// Local preview of the built site. Serves extensionless BrAPI files as application/json,
// which is what a JSON-mime-checking BrAPI client (e.g. Field Book) needs.
// Usage: node scripts/serve.mjs [dir=_site] [port=8080]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const dir = process.argv[2] ?? '_site';
const port = Number(process.argv[3] ?? 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(400).end(); return; }
  let file = join(dir, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const type = TYPES[extname(file)] ?? (/[/\\]brapi[/\\]v2[/\\]/.test(file) ? 'application/json' : 'application/octet-stream');
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'access-control-allow-origin': '*' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}/`));
