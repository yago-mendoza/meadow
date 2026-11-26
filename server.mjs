#!/usr/bin/env node
// Meadow's server: serves public/ and keeps each project in its own folder (meadow.json + a backup a day).
//   node server.mjs [--open]
//   MEADOW_PORT (default 5240) · MEADOW_HOME: where the config lives (default %APPDATA%\Meadow)
//   MEADOW_ROOT: the default folder for projects (default Documents\Meadow) · MEADOW_DATA: an old single-board folder to bring in
// The code never holds your data: projects live outside the repo, wherever the config says.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const PORT = +process.env.MEADOW_PORT || 5240;
const URL_ = `http://localhost:${PORT}/`;
const HOME = process.env.MEADOW_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Meadow');
const CONFIG = path.join(HOME, 'config.json');
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s) => (s || 'Proyecto').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'Proyecto';

// ---- config: where projects live, which ones there are ---------------------------------------------------------------
function defaultRoot() {
  if (process.env.MEADOW_ROOT) return process.env.MEADOW_ROOT;
  let docs = path.join(os.homedir(), 'Documents');
  if (process.platform === 'win32') { try { const r = spawnSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8' }); if (r.stdout.trim()) docs = r.stdout.trim(); } catch { /* keep the default */ } }
  return path.join(docs, 'Meadow');
}
let cfg;
function saveCfg() { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CONFIG + '.tmp', JSON.stringify(cfg, null, 2)); fs.renameSync(CONFIG + '.tmp', CONFIG); }
const fresh = (name) => ({ v: 2, root: 'root', focus: 'root', drawer: [], ideas: [], tasks: [], seq: { idea: 0, tarea: 0, doc: 0 }, history: [],
  nodes: { root: { id: 'root', kind: 'project', title: name, kids: [] } } });
const fileOf = (p) => path.join(p.path, 'meadow.json');
function newProjectDir(parent, name) {
  let dir = path.join(parent, slug(name)), i = 2;
  while (fs.existsSync(dir)) dir = path.join(parent, `${slug(name)} ${i++}`);
  return dir;
}
function createProject(name, parent = cfg.root, state = null, plant = null) {
  const dir = newProjectDir(parent, name);
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'meadow.json'), JSON.stringify({ rev: 1, saved: new Date().toISOString(), state: state || fresh(name) }));
  const p = { id: uid(), path: dir }; if (plant) p.plant = String(plant).slice(0, 16);
  cfg.projects.push(p); saveCfg();
  return p;
}
function loadCfg() {
  try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { cfg = null; }
  if (cfg) return;
  cfg = { root: defaultRoot(), projects: [], last: null };
  fs.mkdirSync(cfg.root, { recursive: true });
  // the board from before projects existed comes in as the first project (a copy: the old file stays where it was)
  const legacy = path.join(process.env.MEADOW_DATA || path.join(ROOT, 'data'), 'meadow.json');
  if (fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      const name = old.state?.nodes?.root?.title || 'GGUF.OS';
      const p = createProject(name, cfg.root, old.state);
      fs.writeFileSync(fileOf(p), JSON.stringify({ ...old, rev: old.rev || 1 }));
      cfg.last = p.id;
    } catch (e) { console.error('No pude traer el tablero de antes:', e.message); }
  }
  saveCfg();
}
loadCfg();

// ---- one project's state (cached), written atomically with a backup a day --------------------------------------------
const cache = new Map();
const proj = (id) => cfg.projects.find((p) => p.id === id);
function stateOf(p) {
  if (!cache.has(p.id)) { let cur = { rev: 0, state: null }; try { cur = JSON.parse(fs.readFileSync(fileOf(p), 'utf8')); } catch { /* empty */ } cache.set(p.id, cur); }
  return cache.get(p.id);
}
function write(p, state) {
  const cur = stateOf(p), day = new Date().toISOString().slice(0, 10), file = fileOf(p);
  fs.mkdirSync(path.join(p.path, 'backups'), { recursive: true });
  const bk = path.join(p.path, 'backups', `meadow-${day}.json`);
  if (!fs.existsSync(bk) && fs.existsSync(file)) fs.copyFileSync(file, bk);
  const next = { rev: (cur.rev || 0) + 1, saved: new Date().toISOString(), state };
  fs.writeFileSync(file + '.tmp', JSON.stringify(next)); fs.renameSync(file + '.tmp', file);
  cache.set(p.id, next);
  return next.rev;
}
function summary(p) {
  const exists = fs.existsSync(fileOf(p));
  let name = path.basename(p.path), updated = null;
  if (exists) { try { name = stateOf(p).state?.nodes?.root?.title || name; updated = fs.statSync(fileOf(p)).mtime.toISOString(); } catch { /* unreadable */ } }
  return { id: p.id, name, path: p.path, exists, updated, opened: p.opened || null, plant: p.plant || null };
}
// moving a project: copy, check, then remove the old folder
function moveDir(from, to) {
  if (fs.existsSync(to)) throw new Error('Ya existe una carpeta con ese nombre allí');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); return; } catch { /* another drive: copy instead */ }
  fs.cpSync(from, to, { recursive: true });
  const a = fs.readFileSync(path.join(from, 'meadow.json')), b = fs.readFileSync(path.join(to, 'meadow.json'));
  if (!a.equals(b)) { fs.rmSync(to, { recursive: true, force: true }); throw new Error('La copia no salió igual; no he movido nada'); }
  fs.rmSync(from, { recursive: true, force: true });
}
function pickFolder(title) {
  if (process.platform !== 'win32') return null;
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::EnableVisualStyles(); $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${title.replace(/'/g, "''")}'; $d.ShowNewFolderButton = $true; $f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }; $f.Show(); $f.Activate(); if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }; $f.Close()`;   // in front of the browser
  const r = spawnSync('powershell', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' });
  return r.stdout.trim() || null;
}

// ---- http ----------------------------------------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 50e6) req.destroy(); }); req.on('end', () => ok(b)); });
const json = async (req) => { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } };
const listing = () => ({ root: cfg.root, last: cfg.last, projects: cfg.projects.map(summary) });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, URL_), q = url.pathname;
  try {
    if (q === '/api/projects' && req.method === 'GET') return send(res, 200, listing());
    if (q === '/api/projects' && req.method === 'POST') { const { name, plant } = await json(req); const p = createProject(name || 'Proyecto nuevo', cfg.root, null, plant); return send(res, 200, { id: p.id, ...listing() }); }
    if (q === '/api/projects/add') {                      // an existing folder (one is made if it has no project yet)
      const b = await json(req); const dir = b.path || pickFolder('Elige la carpeta del proyecto'); if (!dir) return send(res, 200, { cancelled: true });
      let p = cfg.projects.find((x) => path.resolve(x.path) === path.resolve(dir));
      if (!p) {
        p = { id: uid(), path: dir }; fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
        if (!fs.existsSync(fileOf(p))) fs.writeFileSync(fileOf(p), JSON.stringify({ rev: 1, saved: new Date().toISOString(), state: fresh(path.basename(dir)) }));
        cfg.projects.push(p); saveCfg();
      }
      return send(res, 200, { id: p.id, ...listing() });
    }
    if (q === '/api/projects/move') {
      const b = await json(req), p = proj(b.id); if (!p) return send(res, 404, { error: 'No existe ese proyecto' });
      const to = b.to || pickFolder(`Elige dónde mover «${summary(p).name}»`); if (!to) return send(res, 200, { cancelled: true });
      const dest = path.join(to, path.basename(p.path));
      if (path.resolve(dest) === path.resolve(p.path)) return send(res, 200, listing());
      moveDir(p.path, dest); p.path = dest; cache.delete(p.id); saveCfg();
      return send(res, 200, listing());
    }
    if (q === '/api/projects/remove') { const b = await json(req); cfg.projects = cfg.projects.filter((x) => x.id !== b.id); if (cfg.last === b.id) cfg.last = null; cache.delete(b.id); saveCfg(); return send(res, 200, listing()); }
    if (q === '/api/projects/plant') { const b = await json(req), p = proj(b.id); if (p) { p.plant = String(b.plant || '').slice(0, 16) || undefined; saveCfg(); } return send(res, 200, listing()); }
    if (q === '/api/projects/opened') { const b = await json(req), p = proj(b.id); if (p) { p.opened = new Date().toISOString(); cfg.last = p.id; saveCfg(); } return send(res, 200, { ok: true }); }
    if (q === '/api/root') {                              // the folder for new projects; optionally bring the ones in the old folder along
      const b = await json(req); const to = b.root || pickFolder('Elige la carpeta donde guardar los proyectos'); if (!to) return send(res, 200, { cancelled: true });
      const old = cfg.root; fs.mkdirSync(to, { recursive: true });
      const moved = [], failed = [];
      if (b.move) for (const p of cfg.projects) if (path.resolve(path.dirname(p.path)) === path.resolve(old)) {
        try { const dest = path.join(to, path.basename(p.path)); moveDir(p.path, dest); p.path = dest; cache.delete(p.id); moved.push(p.id); } catch (e) { failed.push({ id: p.id, error: e.message }); }
      }
      cfg.root = to; saveCfg();
      return send(res, 200, { moved, failed, ...listing() });
    }
    if (q === '/api/state') {
      const p = proj(url.searchParams.get('p') || cfg.last); if (!p) return send(res, 404, { error: 'Sin proyecto' });
      if (req.method === 'GET') return send(res, 200, { project: summary(p), ...stateOf(p) });
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readBody(req), cur = stateOf(p);
        if (String(url.searchParams.get('rev')) !== String(cur.rev || 0)) return send(res, 409, { rev: cur.rev });
        let state; try { state = JSON.parse(body); } catch { return send(res, 400, { error: 'json' }); }
        if (!state || !(Array.isArray(state.docs) || (state.v === 2 && state.nodes && typeof state.nodes === 'object'))) return send(res, 400, { error: 'shape' });
        return send(res, 200, { rev: write(p, state) });
      }
      return send(res, 405, { error: 'method' });
    }
  } catch (e) { return send(res, 500, { error: e.message }); }
  const p = path.normalize(path.join(PUB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!p.startsWith(PUB)) return send(res, 403, 'no', 'text/plain');
  fs.readFile(p, (err, buf) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(p)] || 'application/octet-stream'));
});

const open = () => spawn('cmd', ['/c', 'start', '', URL_], { detached: true, stdio: 'ignore' }).unref();
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { if (process.argv.includes('--open')) open(); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Meadow en ${URL_} · proyectos en ${cfg.root} · configuración en ${CONFIG}`);
  if (process.argv.includes('--open')) open();
});
