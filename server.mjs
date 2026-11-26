#!/usr/bin/env node
// Meadow's server: serves public/ and keeps the whole board in data/meadow.json (atomic writes, one backup a day).
//   node server.mjs [--open]        MEADOW_PORT (default 5240) · MEADOW_DATA (default ./data)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const DATA = process.env.MEADOW_DATA || path.join(ROOT, 'data');
const FILE = path.join(DATA, 'meadow.json');
const PORT = +process.env.MEADOW_PORT || 5240;
const URL_ = `http://localhost:${PORT}/`;
fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });

let cur = { rev: 0, state: null };
try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }

function write(state) {
  const day = new Date().toISOString().slice(0, 10);
  const bk = path.join(DATA, 'backups', `meadow-${day}.json`);
  if (!fs.existsSync(bk) && fs.existsSync(FILE)) fs.copyFileSync(FILE, bk);
  cur = { rev: (cur.rev || 0) + 1, saved: new Date().toISOString(), state };
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(cur));
  fs.renameSync(FILE + '.tmp', FILE);
  return cur.rev;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, URL_);
  if (url.pathname === '/api/state') {
    if (req.method === 'GET') return send(res, 200, cur);
    if (req.method === 'PUT' || req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 50e6) req.destroy(); });
      req.on('end', () => {
        if (String(url.searchParams.get('rev')) !== String(cur.rev || 0)) return send(res, 409, { rev: cur.rev });
        let state; try { state = JSON.parse(body); } catch { return send(res, 400, { error: 'json' }); }
        if (!state || !Array.isArray(state.docs)) return send(res, 400, { error: 'shape' });
        send(res, 200, { rev: write(state) });
      });
      return;
    }
    return send(res, 405, { error: 'method' });
  }
  let p = path.normalize(path.join(PUB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!p.startsWith(PUB)) return send(res, 403, 'no', 'text/plain');
  fs.readFile(p, (err, buf) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(p)] || 'application/octet-stream'));
});

const open = () => spawn('cmd', ['/c', 'start', '', URL_], { detached: true, stdio: 'ignore' }).unref();
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { if (process.argv.includes('--open')) open(); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Meadow en ${URL_}`);
  if (process.argv.includes('--open')) open();
});
