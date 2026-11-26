// Meadow: a zoomable grid with documents (pages that open), post-its (written on the spot), ideas and tasks (one object
// that can sit on the plane and inside any document at once), frames, a stash at the bottom left, and a panel on the
// right with every task, every idea and the history.
import { createEditor, LINK_RE, TAG_RE, TOKEN_RE } from './editor.bundle.js';
import { measure, flip, grow, EASE, DUR } from './motion.js';

const PASTEL = ['#fff1b8', '#ffd9c2', '#f9d0e3', '#e3d9f7', '#cfe5fb', '#cdeedd', '#e4ebd3', '#eceef2'];
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DOC_W = 200;

let S = { docs: [], postits: [], frames: [], ideas: [], tasks: [], seq: { idea: 0, tarea: 0 }, history: [], view: { x: 140, y: 80, z: 1 } };
let rev = 0;
const sel = new Set();
const vp = $('#vp'), grid = $('#grid'), world = $('#world'), itemsEl = $('#items'), framesEl = $('#frames');
const stash = $('#stash');

const N = (d) => S.docs.indexOf(d) + 1;
const docById = (id) => S.docs.find((d) => d.id === id);
const listOf = (kind) => (kind === 'idea' ? S.ideas : S.tasks);
const getItem = (kind, n) => listOf(kind).find((x) => x.n === n);
const token = (it) => `{${it.kind} ${it.n}}`;
function find(id) {
  for (const [k, list] of [['d', S.docs], ['p', S.postits], ['f', S.frames], ['i', S.ideas], ['t', S.tasks], ['x', S.texts || []]]) {
    const o = list.find((x) => x.id === id); if (o) return { k, o };
  }
  return null;
}
const elOf = (id) => world.querySelector(`[data-id="${id}"]`);
// a thing's size on the plane (its layout size times its own scale)
const sizeOf = (el, o) => [el.offsetWidth * (o.s || 1), el.offsetHeight * (o.s || 1)];
// Text as a person reads it: links show their label, ideas and tasks their text.
const readable = (t) => (t || '')
  .replace(LINK_RE, (m, label) => label)
  .replace(TOKEN_RE, (m, kind, n) => { const it = getItem(kind, +n); return it ? `${kind === 'idea' ? '💡' : it.done ? '☑' : '☐'} ${it.text}` : ''; });
const docsUsing = (it) => S.docs.filter((d) => (d.text || '').includes(token(it)));

// ---- saving --------------------------------------------------------------------------------------------------------
async function load() {
  const j = await (await fetch('/api/state')).json();
  rev = j.rev || 0;
  if (j.state) S = { ...S, ...j.state };
  else S.view = { x: Math.round(innerWidth / 2 - 100), y: Math.round(innerHeight / 2 - 140), z: 1 };
  for (const k of ['postits', 'frames', 'ideas', 'tasks', 'history', 'signs', 'texts']) S[k] ||= [];
  S.seq ||= { idea: 0, tarea: 0 };
  for (const d of S.docs) { const t = titleOf(d.text); if (t) d.name = t; else d.text = withTitle(d.text, d.name); }
  if (!S.trays?.length) S.trays = [{ id: 'b1', name: 'Cajón', color: TRAY_COLORS[0], open: true }];
  for (const t of S.trays) t.name = t.name.replace(/^Bandeja\b/, 'Cajón');
  for (const d of S.docs) if (d.place === 'stash' && !S.trays.some((t) => t.id === d.tray)) d.tray = S.trays[0].id;
  render();
}
let saveT = null, dirty = false;
function save() { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 400); }
async function flush() {
  saveT = null; if (!dirty) return; dirty = false;
  try {
    const r = await fetch('/api/state?rev=' + rev, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(S) });
    if (r.status === 409) { toast('Meadow ha cambiado en otra pestaña. Recarga esta para seguir.', [['Recargar', () => location.reload()]], 0); return; }
    rev = (await r.json()).rev;
  } catch { dirty = true; toast('No se pudo guardar; reintento en 2 s'); setTimeout(flush, 2000); }
}
addEventListener('beforeunload', () => {
  closeSession();
  if (dirty) navigator.sendBeacon('/api/state?rev=' + rev, new Blob([JSON.stringify(S)], { type: 'application/json' }));
});

const undo = [];
function snap() {
  undo.push(JSON.stringify({ docs: S.docs, postits: S.postits, frames: S.frames, ideas: S.ideas, tasks: S.tasks, signs: S.signs, texts: S.texts, trays: S.trays, seq: S.seq }));
  if (undo.length > 80) undo.shift();
}
function doUndo() {
  const s = undo.pop(); if (!s) return toast('Nada que deshacer');
  Object.assign(S, JSON.parse(s)); sel.clear(); renderStash();
  if (curId) { const d = docById(curId); if (!d) closeEditor(); else { ed.replaceText(d.text || ''); fillHead(); } }
  changed();
}

// ---- history -------------------------------------------------------------------------------------------------------
function log(kind, msg, extra = {}) {
  S.history.unshift({ t: Date.now(), kind, msg, ...extra });
  if (S.history.length > 400) S.history.length = 400;
}
const ICON = { crear: '＋', borrar: '🗑', editar: '✎', hecha: '✔', reabrir: '↺', restaurar: '⟲', renombrar: '✎', bandeja: '📥' };

// ---- view, zoom and grid -------------------------------------------------------------------------------------------
function applyView() {
  const { x, y, z } = S.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  $('#z-val').textContent = Math.round(z * 100) + ' %';
  drawGrid();
}
const SHOW_GRID = false;               // Yago, 26.11: «quita la grid, sin grid»
function drawGrid() {
  const dpr = devicePixelRatio || 1, w = vp.clientWidth, h = vp.clientHeight;
  if (grid.width !== w * dpr || grid.height !== h * dpr) { grid.width = w * dpr; grid.height = h * dpr; }
  const c = grid.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#f7f7fb'; c.fillRect(0, 0, w, h);
  if (!SHOW_GRID) return;
  const { x, y, z } = S.view;
  let step = 1; const seq = [2, 2.5, 2]; let k = 0;
  while (step * z < 16) step *= seq[k++ % 3];
  // a grid of small dots (lines would be mistaken for frames): every fifth one a little bigger
  const dots = (st, r, col) => {
    c.fillStyle = col;
    const x0 = Math.floor(-x / z / st) * st, y0 = Math.floor(-y / z / st) * st;
    for (let wx = x0; wx * z + x <= w + 2; wx += st) {
      const sx = wx * z + x;
      for (let wy = y0; wy * z + y <= h + 2; wy += st) c.fillRect(sx - r / 2, wy * z + y - r / 2, r, r);
    }
  };
  dots(step, 1.6, '#d6d2e0'); dots(step * 5, 2.6, '#bdb6cc');
  c.strokeStyle = 'rgba(113,75,103,.28)'; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(x - 10, y); c.lineTo(x + 10, y); c.moveTo(x, y - 10); c.lineTo(x, y + 10); c.stroke();
}
let viewT; function saveView() { clearTimeout(viewT); viewT = setTimeout(save, 600); }
function zoomAt(mx, my, f) {
  const v = S.view, nz = Math.min(12, Math.max(0.03, v.z * f));
  v.x = mx - (mx - v.x) * nz / v.z; v.y = my - (my - v.y) * nz / v.z; v.z = nz;
  applyView(); saveView();
}
vp.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  if (e.shiftKey) { S.view.x -= dy; applyView(); saveView(); return; }
  zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
}, { passive: false });
const toWorld = (cx, cy) => ({ x: (cx - S.view.x) / S.view.z, y: (cy - S.view.y) / S.view.z });
const centerWorld = () => toWorld(innerWidth / 2 - 100, innerHeight / 2 - 60);
addEventListener('resize', drawGrid);
let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; }, true);

function centerOn(o, el) {
  const [w, h] = el ? sizeOf(el, o) : [200, 120];
  S.view.x = innerWidth / 2 - 150 - (o.x + w / 2) * S.view.z;
  S.view.y = innerHeight / 2 - (o.y + h / 2) * S.view.z;
  applyView(); saveView();
}
$('#z-val').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / S.view.z);
$('#z-fit').onclick = () => {
  const boxes = [...world.querySelectorAll('[data-k]')].map((el) => {
    const o = find(el.dataset.id).o; if (el.dataset.k === 'f') return [o.x, o.y - 34, o.w, o.h + 34]; const [w, h] = sizeOf(el, o); return [o.x, o.y, w, h];
  });
  if (!boxes.length) return;
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2])), y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  const aw = innerWidth - 400, ah = innerHeight - 160;
  const z = Math.min(2, aw / (x1 - x0 + 80), ah / (y1 - y0 + 80));
  S.view = { z, x: 30 + (aw - (x1 - x0) * z) / 2 - x0 * z, y: 80 + (ah - (y1 - y0) * z) / 2 - y0 * z };
  applyView(); saveView();
};

// ---- rendering -----------------------------------------------------------------------------------------------------
const palHTML = () => `<div class="pal">${PASTEL.map((c) => `<i data-c="${c}" style="--d:${c}"></i>`).join('')}</div>`;
function docHTML(d, n) {
  const text = readable((d.text || '').replace(/^\s*#{1,6}\s+.*(\n|$)/, '').replace(/^\n+/, ''));
  const words = (text.match(/\S+/g) || []).length;
  return `<div class="doc${sel.has(d.id) ? ' sel' : ''}" data-id="${d.id}" data-k="d" style="left:${d.x}px;top:${d.y}px;z-index:${d.z || 0};--s:${d.s || 1}">
    <div class="page">
      <div class="dtitle">${esc(d.name)}</div>
      <div class="dbody">${text ? esc(text.split('\n').slice(0, 14).join('\n')) : '<em>en blanco</em>'}</div>
      <div class="dfoot"><span>📄</span><span>${words ? words + (words === 1 ? ' palabra' : ' palabras') : ''}</span></div>
    </div>
    <button class="x" title="Borrar">×</button>
    <div class="acts">
      <button data-a="copy">⧉<b>Copiar</b></button><button data-a="add">＋<b>Añadir lo copiado</b></button><button data-a="replace">⇄<b>Reemplazar</b></button>${ZB}
    </div>${PRS}</div>`;
}
const PRS = '<div class="prs" title="Arrastra: más grande o más pequeño (con lo que lleva encima; Alt: solo esto)"></div>';
const ZB = '<button data-a="front">⤒<b>Al frente</b></button><button data-a="back">⤓<b>Al fondo</b></button>';
const postitHTML = (p) => `<div class="postit${sel.has(p.id) ? ' sel' : ''}" data-id="${p.id}" data-k="p" style="left:${p.x}px;top:${p.y}px;z-index:${p.z || 0};--bg:${p.color};--s:${p.s || 1}">
  <div class="ptext">${esc(p.text)}</div><button class="x" title="Borrar">×</button>${palHTML()}<div class="acts">${ZB}</div>${PRS}</div>`;
// Free text: words straight on the plane, no document.
const textHTML = (x) => `<div class="ftext${sel.has(x.id) ? ' sel' : ''}" data-id="${x.id}" data-k="x" style="left:${x.x}px;top:${x.y}px;z-index:${x.z || 0};--s:${x.s || 1}">
  <div class="xt">${esc(x.text)}</div><button class="x" title="Borrar">×</button><div class="acts">${ZB}</div>${PRS}</div>`;
function writeText(x, fresh = false) {
  const el = elOf(x.id)?.querySelector('.xt'); if (!el) return;
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
  const end = (ok) => {
    el.contentEditable = 'false';
    const v = el.innerText.replace(/\n+$/, '');
    if (!v.trim()) { if (fresh || ok) { S.texts = S.texts.filter((o) => o !== x); render(); save(); } return; }
    if (v !== x.text) { snap(); x.text = v; save(); renderItems(); paintSel(); }
  };
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { e.stopPropagation(); el.blur(); } e.stopPropagation(); });
  el.addEventListener('blur', () => end(true), { once: true });
}
const frameHTML = (f) => `<div class="frame${sel.has(f.id) ? ' sel' : ''}" data-id="${f.id}" data-k="f" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;--bg:${f.color}">
  <div class="fdesc${f.desc ? '' : ' empty'}" title="Clic para escribir la descripción">${esc(f.desc || '')}</div>
  <div class="ftab"><span class="ftitle">${esc(f.title)}</span><button class="f-add" title="Crear un marco dentro">＋</button><button class="x" title="Borrar el marco (no lo de dentro)">×</button>${palHTML()}</div>
  <div class="edge e-t"></div><div class="edge e-b"></div><div class="edge e-l"></div><div class="edge e-r"></div><div class="rs c-tl" data-c="tl"></div><div class="rs c-tr" data-c="tr"></div><div class="rs c-bl" data-c="bl"></div><div class="rs c-br" data-c="br"></div></div>`;
function itemHTML(it) {
  const k = it.kind === 'idea' ? 'i' : 't', uses = docsUsing(it).length;
  if (!it.dock) {                                   // loose: a small circle with its icon; a click reads it
    return `<div class="item circle ${it.kind}${it.done ? ' done' : ''}${sel.has(it.id) ? ' sel' : ''}" data-id="${it.id}" data-k="${k}" style="left:${it.x}px;top:${it.y}px;z-index:${it.z || 0};--s:${it.s || 1}">
      <span class="cico">${it.kind === 'idea' ? '💡' : it.done ? '✔' : ''}</span>
      <button class="x" title="${uses ? 'Quitar del plano (sigue en sus documentos)' : 'Borrar'}">×</button>
      <div class="acts"><button data-a="ref">⧉<b>Copiar para pegar</b></button>${it.pin ? '' : ZB}</div>${it.pin ? '' : PRS}</div>`;   // pinned: its size is its host's
  }
  const lead = it.kind === 'idea' ? '<span class="iico">💡</span>' : `<button class="chk" title="${it.done ? 'Reabrir' : 'Hecha'}">${it.done ? '✔' : ''}</button>`;
  return `<div class="item ${it.kind}${it.done ? ' done' : ''} docked${sel.has(it.id) ? ' sel' : ''}" data-id="${it.id}" data-k="${k}" style="left:${it.x}px;top:${it.y}px;z-index:${it.z || 0};--s:${it.s || 1}">
    ${lead}<span class="itext">${esc(it.text) || '…'}</span>
    <button class="x" title="${uses ? 'Quitar del plano (sigue en sus documentos)' : 'Borrar'}">×</button>
    <div class="acts"><button data-a="ref">⧉<b>Copiar para pegar</b></button></div></div>`;
}
// ---- signs: a tab standing out of an edge of a document, post-it, idea, task or frame; a click reads it -------------
const signsOf = (id) => (S.signs || []).filter((g) => g.host === id);
// A tag tied to the edge with a string: a paper tag with a hole and a scribble that means nothing (the same for one tag).
function scribble(seed) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
  let d = '';
  for (let row = 0; row < 2; row++) {
    const y = 15 + row * 7; let x = 29; d += `M${x} ${y}`;
    const end = 54 - row * 7 - rnd() * 4;
    while (x < end) { const nx = Math.min(end, x + 2.2 + rnd() * 2.4); d += ` Q${((x + nx) / 2).toFixed(1)} ${(y - 1.6 - rnd() * 2).toFixed(1)} ${nx.toFixed(1)} ${(y + (rnd() - .5) * 1.2).toFixed(1)}`; x = nx; }
  }
  return d;
}
const ribbonSVG = (g) => { const c = g.color || RIBBON_RED; return `<svg class="tag" viewBox="0 0 46 18" width="46" height="18" aria-hidden="true">
  <defs><linearGradient id="rb-${g.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".82"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".9"/></linearGradient></defs>
  <path d="M0 2 H44 L37 9 L44 16 H0 Z" fill="url(#rb-${g.id})"/>
  <path d="M0 2 H44 L37 9 L44 16 H0 Z" fill="none" stroke="rgba(0,0,0,.12)" stroke-width=".7"/>
  <path d="M1 4.5 H36" stroke="rgba(255,255,255,.35)" stroke-width="1"/><rect x="0" y="2" width="4" height="14" fill="rgba(0,0,0,.1)"/></svg>`; };
const signHTML = (g, extra = '') => `<div class="sign ribbon e-${g.edge}${extra}" data-sign="${g.id}" style="--t:${(g.t * 100).toFixed(1)}%" title="Ribete · clic para verlo">${ribbonSVG(g)}</div>`;
function signsHTML(id) { return signsOf(id).map((g) => signHTML(g)).join(''); }
// Where a sign dropped at the pointer would stand: the edge of the thing under it nearest to the pointer.
function signSpot(e) {
  const hostEl = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-k]');
  if (!hostEl) return null;
  const r = hostEl.getBoundingClientRect();
  const d = { top: e.clientY - r.top, bottom: r.bottom - e.clientY, left: e.clientX - r.left, right: r.right - e.clientX };
  const edge = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
  const t = edge === 'top' || edge === 'bottom' ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
  return { hostEl, edge, t: Math.min(.92, Math.max(.06, t)) };
}
function addSignsToHosts() {
  for (const el of world.querySelectorAll('[data-k]')) {
    const html = signsHTML(el.dataset.id); if (!html) continue;
    el.insertAdjacentHTML('beforeend', html);
  }
}
let firstRender = true;
function renderItems() {
  const before = firstRender ? null : measure(world);
  peeked = []; clearTimeout(peekT);
  framesEl.innerHTML = [...S.frames].sort((a, b) => b.w * b.h - a.w * a.h).map(frameHTML).join('');
  itemsEl.innerHTML = S.docs.map((d, i) => (d.place === 'canvas' ? docHTML(d, i + 1) : '')).join('')
    + S.postits.filter((p) => !p.riding).map(postitHTML).join('')
    + (S.texts || []).filter((x) => !x.riding).map(textHTML).join('')
    + [...S.ideas, ...S.tasks].filter((it) => it.onCanvas && !it.riding && !hiddenInFold(it)).map(itemHTML).join('')
    + groupsHTML();
  $('#empty').classList.toggle('on', !itemsEl.children.length && !S.frames.length);
  S.signs = (S.signs || []).filter((g) => find(g.host));
  addSignsToHosts();
  layoutDocks();
  layoutPins();
  flip(world, before, (el) => S.view.z * (find(el.dataset.id)?.o.s || 1));
  firstRender = false;
}
// ---- tasks docked under a document: stacked in order, as wide as the document, moving and scaling with it ----------
const docked = (d) => [...S.ideas, ...S.tasks].filter((t) => t.onCanvas && t.dock === d.id).sort((a, b) => (a.dockAt ?? 0) - (b.dockAt ?? 0));
const DOCK_MAX = 5, MINOR_MAX = 2;
// Which kinds are folded into a numbered circle under a document.
function foldedKinds(d) {
  const list = docked(d), out = new Set();
  if (list.length <= DOCK_MAX) return out;
  const n = { idea: list.filter((t) => t.kind === 'idea').length, tarea: list.filter((t) => t.kind === 'tarea').length };
  const major = n.tarea >= n.idea ? 'tarea' : 'idea', minor = major === 'tarea' ? 'idea' : 'tarea';
  out.add(major); if (n[minor] > MINOR_MAX) out.add(minor);
  return out;
}
const hiddenInFold = (it) => { if (!it.dock) return false; const d = docById(it.dock); return !!d && foldedKinds(d).has(it.kind); };
function groupsHTML() {
  let html = '';
  for (const d of S.docs) {
    if (d.place !== 'canvas') continue;
    for (const kind of foldedKinds(d)) {
      const items = docked(d).filter((t) => t.kind === kind), open = kind === 'tarea' ? items.filter((t) => !t.done).length : items.length;
      html += `<button class="dgroup ${kind}" data-doc="${d.id}" data-kind="${kind}" title="${items.length} ${kind === 'idea' ? 'ideas' : 'tareas'}">${kind === 'idea' ? '💡' : '☑'}<b>${open}</b></button>`;
    }
  }
  return html;
}
function layoutDocks() {
  for (const t of [...S.ideas, ...S.tasks]) if (t.dock && !t.riding && !S.docs.some((d) => d.id === t.dock && d.place === 'canvas')) delete t.dock;
  for (const d of S.docs) {
    if (d.place !== 'canvas') continue;
    const list = docked(d); if (!list.length) continue;
    const del = elOf(d.id); if (!del) continue;
    const sc = d.s || 1; let y = d.y + del.offsetHeight * sc + 8 * sc;
    const groups = [...itemsEl.querySelectorAll(`.dgroup[data-doc="${d.id}"]`)];
    groups.forEach((g, i) => { Object.assign(g.style, { left: d.x + i * 52 * sc + 'px', top: y + 'px', zIndex: (d.z || 0) + 1 }); g.style.setProperty('--s', sc); });
    if (groups.length) y += 46 * sc;
    list.filter((t) => !hiddenInFold(t)).forEach((t, i) => {
      t.dockAt = i; t.x = d.x; t.y = Math.round(y); t.s = sc; t.z = Math.max(t.z || 0, (d.z || 0));
      const el = elOf(t.id); if (!el) return;
      Object.assign(el.style, { left: t.x + 'px', top: t.y + 'px', zIndex: t.z }); el.style.setProperty('--s', sc);
      y += el.offsetHeight * sc + 6 * sc;
    });
  }
}
// ---- circles pinned to a thing: on a document's or post-it's left or right edge (centred on the line, spread around
// its middle), or in a row right of a frame's tab. They move and scale with it; dragged away, they come loose. ------
const pinnedTo = (id) => [...S.ideas, ...S.tasks].filter((t) => t.onCanvas && !t.dock && t.pin?.host === id);
// The eight anchors of a document or post-it: corners tl tr bl br and side middles t r b l. Several circles on one anchor
// spread along its side (the middles) or along the top/bottom edge, inwards (the corners).
const ANCHORS = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
function anchorAt(h, hel, side, i, n, sc) {
  const [w, hh] = sizeOf(hel, h), gap = 44 * sc, off = (i - (n - 1) / 2) * gap;
  const L = h.x, R = h.x + w, T = h.y, B = h.y + hh, CX = h.x + w / 2, CY = h.y + hh / 2;
  switch (side) {
    case 'tl': return [L + i * gap, T]; case 'tr': return [R - i * gap, T];
    case 'bl': return [L + i * gap, B]; case 'br': return [R - i * gap, B];
    case 't': return [CX + off, T]; case 'b': return [CX + off, B];
    case 'l': case 'left': return [L, CY + off]; default: return [R, CY + off];
  }
}
function layoutPins() {
  for (const t of [...S.ideas, ...S.tasks]) if (t.pin && !t.riding && !find(t.pin.host)) delete t.pin;
  const hosts = new Set([...S.ideas, ...S.tasks].filter((t) => t.pin && t.onCanvas && !t.riding).map((t) => t.pin.host));
  for (const id of hosts) {
    const f = find(id), hel = elOf(id); if (!f || !hel) continue;
    const h = f.o, sc = f.k === 'f' ? 1 : h.s || 1;
    const sides = new Set(pinnedTo(id).map((t) => t.pin.side));
    for (const side of sides) {
      const list = pinnedTo(id).filter((t) => t.pin.side === side).sort((a, b) => (a.pin.at ?? 0) - (b.pin.at ?? 0));
      list.forEach((t, i) => {
        t.s = sc; const r = 19 * sc;
        let cx, cy;
        if (side === 'tab') {
          const tab = hel.querySelector('.ftab'), tw = tab ? tab.offsetWidth : 90, th = tab ? tab.offsetHeight : 30;
          cx = h.x + 16 + tw + 10 + i * 44 + 19; cy = h.y - th / 2;
        } else [cx, cy] = anchorAt(h, hel, side, i, list.length, sc);
        t.x = Math.round(cx - r); t.y = Math.round(cy - r);
        t.z = Math.max(t.z || 0, (h.z || 0) + 1);
        const el = elOf(t.id); if (!el) return;
        Object.assign(el.style, { left: t.x + 'px', top: t.y + 'px', zIndex: t.z }); el.style.setProperty('--s', t.s);
      });
    }
  }
}
// What a dropped circle pins to. A frame: only its tab row. A document or post-it: near an edge, the nearest of its eight
// anchors; dropped well inside it, nothing (it just lies on top, and goes with it).
const EDGE_NEAR = 34;
function pinTarget(it, e) {
  const me = elOf(it.id);
  for (const f of S.frames) {
    const fel = elOf(f.id), tab = fel?.querySelector('.ftab'); if (!tab) continue;
    const r = tab.getBoundingClientRect(), n = pinnedTo(f.id).filter((x) => x !== it && x.pin.side === 'tab').length;
    const right = r.right + (10 + (n + 1) * 44) * S.view.z;
    if (e.clientX > r.left && e.clientX < right && e.clientY > r.top - 8 * S.view.z && e.clientY < r.bottom + 6 * S.view.z) return { host: f.id, side: 'tab', at: 99 };
  }
  const near = EDGE_NEAR;
  const under = [...itemsEl.querySelectorAll('[data-k="d"], [data-k="p"]')].filter((el) => el !== me).reverse().find((el) => {
    const r = el.getBoundingClientRect();
    return e.clientX > r.left - near && e.clientX < r.right + near && e.clientY > r.top - near && e.clientY < r.bottom + near;
  });
  if (!under) return null;
  const r = under.getBoundingClientRect();
  const dl = Math.abs(e.clientX - r.left), dr = Math.abs(e.clientX - r.right), dt = Math.abs(e.clientY - r.top), db = Math.abs(e.clientY - r.bottom);
  const nearX = Math.min(dl, dr) < near, nearY = Math.min(dt, db) < near;
  if (!nearX && !nearY) return null;                                         // well inside: it just lies on it
  const v = dt < db ? 't' : 'b', hside = dl < dr ? 'l' : 'r';
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  let side;
  if (nearX && nearY) side = v + hside;                                       // a corner
  else if (nearX) side = fy < .2 ? 't' + hside : fy > .8 ? 'b' + hside : hside;
  else side = fx < .2 ? v + 'l' : fx > .8 ? v + 'r' : v;
  return { host: under.dataset.id, side, at: side === 't' || side === 'b' ? e.clientX : e.clientY };
}
// The dotted slot: where a circle being dragged would be pinned if dropped now.
function pinHint(it, e) {
  const hint = $('#pinhint'), pt = it && pinTarget(it, e);
  if (!pt) { hint.classList.remove('on'); return; }
  const f = find(pt.host), hel = elOf(pt.host); if (!f || !hel) return hint.classList.remove('on');
  const z = S.view.z, h = f.o; let wx, wy, sc = 1;
  if (pt.side === 'tab') {
    const tab = hel.querySelector('.ftab'), n = pinnedTo(h.id).filter((x) => x !== it && x.pin.side === 'tab').length;
    wx = h.x + 16 + tab.offsetWidth + 10 + n * 44 + 19; wy = h.y - tab.offsetHeight / 2;
  } else {
    sc = h.s || 1;
    const n = pinnedTo(h.id).filter((x) => x !== it && x.pin.side === pt.side).length;
    [wx, wy] = anchorAt(h, hel, pt.side, /^[tb][lr]$/.test(pt.side) ? n : n, /^[tb][lr]$/.test(pt.side) ? n + 1 : n + 1, sc);
  }
  const d = 38 * sc * z;
  Object.assign(hint.style, { left: S.view.x + wx * z - d / 2 + 'px', top: S.view.y + wy * z - d / 2 + 'px', width: d + 'px', height: d + 'px' });
  hint.classList.add('on');
}
// Where a dropped task docks: under a document, if it lands in the strip below it (or among the tasks already there).
function dockTarget(t) {
  const el = elOf(t.id); if (!el) return null;
  const [w, h] = sizeOf(el, t), cx = t.x + w / 2, cy = t.y + h / 2;
  for (const d of S.docs) {
    if (d.place !== 'canvas' || d.id === t.dock && false) continue;
    const de = elOf(d.id); if (!de) continue;
    const [dw, dh] = sizeOf(de, d);
    const stack = docked(d).filter((x) => x !== t).reduce((acc, x) => { const xe = elOf(x.id); return acc + (xe ? xe.offsetHeight * (x.s || 1) + 6 : 0); }, 0);
    if (cx > d.x && cx < d.x + dw && cy > d.y + dh + EDGE_NEAR / S.view.z && cy < d.y + dh + stack + 110) {   // below the bottom-edge anchors
      const others = docked(d).filter((x) => x !== t);
      const at = others.filter((x) => x.y + 10 < t.y).length;           // its place in the stack, by where it was dropped
      return { d, at, others };
    }
  }
  return null;
}
// ---- trays: documents waiting, at the bottom left. One is open at a time; the others fold to a coloured strip. -------
const TRAY_COLORS = ['#f6c1d6', '#bfdcf7', '#c6ead2', '#f8dca8', '#d9ccf3', '#f3c9b8'];
const MAX_TRAYS = 6;
let traysShown = localStorage.getItem('meadow.trays') === 'shown';
function showTrays(on) { traysShown = on; localStorage.setItem('meadow.trays', on ? 'shown' : 'tucked'); stash.classList.toggle('tucked', !on); sizeSkin(true); }
// The shape takes the size of what it shows: the chest when tucked, the open drawers otherwise.
function sizeSkin(animate = true) {
  const skin = stash.querySelector('.st-skin'); if (!skin) return;
  const open = !stash.classList.contains('tucked') || stash.classList.contains('dragopen');
  const tgt = stash.querySelector(open ? '.st-open' : '.st-chest');
  const w = tgt.offsetWidth, h = tgt.offsetHeight;
  skin.classList.toggle('is-open', open);
  if (!animate) { skin.style.transition = 'none'; skin.style.width = w + 'px'; skin.style.height = h + 'px'; skin.offsetHeight; skin.style.transition = ''; return; }
  skin.style.width = w + 'px'; skin.style.height = h + 'px';
}
// While open, the shape follows its drawers when one opens or closes inside it.
new ResizeObserver(() => {
  const skin = stash.querySelector('.st-skin'); if (!skin || !skin.classList.contains('is-open')) return;
  const o = stash.querySelector('.st-open'); skin.style.transition = 'none'; skin.style.height = o.offsetHeight + 'px'; skin.style.width = o.offsetWidth + 'px';
  requestAnimationFrame(() => { skin.style.transition = ''; });
}).observe(stash);
// A click anywhere else puts them away again (when you opened them).
addEventListener('pointerdown', (e) => { if (traysShown && !e.target.closest('#stash, #ed, #reader')) showTrays(false); }, true);
// while a document is dragged the trays come out by themselves, and go back when it is dropped
const dragTrays = (on) => { if (stash.classList.contains('dragopen') === on) return; stash.classList.toggle('dragopen', on); sizeSkin(true); };
function nearTrays(e) {
  if (stash.classList.contains('dragopen')) {
    const r = stash.getBoundingClientRect();
    return e.clientX < r.right + 90 && e.clientY > r.top - 90;          // stay out while the pointer is around them
  }
  return e.clientX < 470 && e.clientY > innerHeight - 320;                 // come out while it is still on its way
}
const trayOf = (d) => S.trays.find((t) => t.id === d.tray) || S.trays[0];
const openTray = () => S.trays.find((t) => t.open) || S.trays[0];
function renderStash() {
  const html = S.trays.map((t) => {
    const ds = S.docs.map((d, i) => [d, i + 1]).filter(([d]) => d.place === 'stash' && trayOf(d) === t);
    return `<div class="tray${t.open ? ' open' : ''}" data-tray="${t.id}" style="--t:${t.color};--i:${S.trays.indexOf(t)};--n:${S.trays.length}">
      <header><i class="hdl"></i><i class="t-dot" title="Cambiar el color"></i><b class="t-name" title="Clic para renombrar">${esc(t.name)}</b><span class="t-n">${ds.length || ''}</span>
        ${ds.length ? '<button class="t-out" title="Sacar todos sus documentos al plano">⤢</button>' : ''}
        ${S.trays.length > 1 ? '<button class="t-x" title="Quitar el cajón (sus documentos pasan a otro)">×</button>' : ''}</header>
      <div class="t-body"><div class="t-clip"><div class="t-list">${ds.map(([d, n]) => `<div class="chip" data-id="${d.id}" title="Clic para abrir · arrástralo al plano o a otro cajón">
        <span>📄</span><b>${esc(d.name)}</b><button class="x" title="Borrar">×</button></div>`).join('')
        || '<div class="t-empty">Suelta aquí documentos para dejarlos en espera</div>'}</div></div></div></div>`;
  }).join('');
  const total = S.docs.filter((d) => d.place === 'stash').length;
  const pill = `<button class="t-pill" title="Abrir los cajones"><span class="cab">${S.trays.map((t) => {
    const n = S.docs.filter((d) => d.place === 'stash' && trayOf(d) === t).length;
    return `<span class="drw" data-tray="${t.id}" style="--t:${t.color}" title="${esc(t.name)}"><i class="hdl"></i><b>${n || ''}</b></span>`; }).join('')}</span></button>`;
  const tools = `<div class="t-tools" style="--i:${S.trays.length};--n:${S.trays.length}">${S.trays.length < MAX_TRAYS ? '<button class="t-add" title="Nuevo cajón">＋</button>' : ''}
    <button class="t-hide" title="Cerrar los cajones (Esc)">▾ Recoger</button></div>`;
  stash.innerHTML = `<div class="st-skin"><div class="st-chest">${pill}</div><div class="st-open">${tools}<div class="st-trays">${html}</div></div></div>`;
  stash.classList.toggle('tucked', !traysShown);
  stash.dataset.total = total;
  // never over the tools: the trays get the height left under the sidebar
  const side = $('#side').getBoundingClientRect();
  stash.style.maxHeight = Math.max(160, innerHeight - side.bottom - 26) + 'px';
  sizeSkin(false);
}
// Which tray is under the pointer (its id), or null.
function overStash(e) {
  const add = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.t-add');
  if (add && S.trays.length < MAX_TRAYS) return 'new';
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tray');
  if (el) return el.dataset.tray;
  const r = stash.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? openTray().id : null;
}
function hotTray(e, on) {
  const id = on ? overStash(e) : null;
  for (const el of stash.querySelectorAll('.tray')) el.classList.toggle('hot', el.dataset.tray === id);
  stash.querySelector('.t-add')?.classList.toggle('hot', id === 'new');
}
// What lies on a document (post-its, ideas, tasks, docked tasks) rides along with it into a drawer: hidden, with its
// offset kept, and put back in the same place when the document comes out. Its tags go with it by themselves.
function boardRiders(d) {
  const keep = new Set(sel); sel.clear(); sel.add(d.id);
  const deps = collectMoving(false).filter((m) => m.o !== d && (m.k === 'p' || m.k === 'i' || m.k === 't' || m.k === 'x'));
  sel.clear(); for (const id of keep) sel.add(id);
  for (const m of deps) { m.o.riding = d.id; m.o.rdx = m.o.x - d.x; m.o.rdy = m.o.y - d.y; sel.delete(m.o.id); }
}
function releaseRiders(d) {
  for (const o of [...S.postits, ...S.ideas, ...S.tasks, ...S.texts]) if (o.riding === d.id) {
    o.x = Math.round(d.x + o.rdx); o.y = Math.round(d.y + o.rdy); o.z = topZ();
    delete o.riding; delete o.rdx; delete o.rdy;
  }
}
function putInTray(docs, trayId) {
  // (renderStash redraws after this; the open tray is the one that received them)
  let t = S.trays.find((x) => x.id === trayId) || openTray();
  if (trayId === 'new') {                          // dropped on «＋»: a new drawer, named after what it receives
    const used = new Set(S.trays.map((x) => x.color));
    t = { id: 'b' + uid(), name: docs[0]?.name || `Cajón ${S.trays.length + 1}`, color: TRAY_COLORS.find((c) => !used.has(c)) || TRAY_COLORS[0], open: true };
    S.trays.push(t);
  }
  for (const d of docs) { if (d.place === 'canvas') boardRiders(d); d.place = 'stash'; d.tray = t.id; sel.delete(d.id); }
  for (const x of S.trays) x.open = x === t;
  return t;
}
function render() { renderItems(); renderStash(); renderPanel(); paintSelBar(); applyView(); }
function changed() { save(); render(); ed?.refresh(); }
function paintSel() { for (const el of world.querySelectorAll('[data-k]')) el.classList.toggle('sel', sel.has(el.dataset.id)); paintSelBar(); }

// ---- selection bar: copy all of a group at once -------------------------------------------------------------------
function paintSelBar() {
  const bar = $('#selbar'), n = [...sel].filter((id) => find(id)).length;
  bar.classList.toggle('on', n >= 2);
  if (n >= 2) $('#selbar-n').textContent = `${n} seleccionados`;
}
function groupText() {
  const parts = [];
  const ids = [...sel].map(find).filter(Boolean).sort((a, b) => (a.o.y - b.o.y) || (a.o.x - b.o.x));
  for (const { k, o } of ids) {
    if (k === 'd') parts.push(titleOf(o.text) ? readable(o.text) : `# ${o.name}\n${readable(o.text)}`);
    else if (k === 'p' || k === 'x') parts.push(o.text);
    else if (k === 'i') parts.push(`💡 ${o.text}`);
    else if (k === 't') parts.push(`- [${o.done ? 'x' : ' '}] ${o.text}`);
  }
  return parts.filter((p) => p.trim()).join('\n\n');
}
$('#selbar-copy').onclick = async () => { await navigator.clipboard.writeText(groupText()); toast('Copiado todo el grupo'); };
$('#selbar-del').onclick = () => removeIds([...sel]);

// ---- creating ------------------------------------------------------------------------------------------------------
function nextName() {
  const names = new Set(S.docs.map((d) => d.name)); let i = 1;
  while (names.has(`Documento ${i}`)) i++;
  return `Documento ${i}`;
}
// A document's name is its first title in the text («# Name»): writing it renames the document, renaming writes it.
const TITLE_LINE = /^#{1,6}\s+(.+?)\s*$/;
function titleOf(text) { const first = (text || '').split('\n').find((l) => l.trim()); const m = first && first.match(TITLE_LINE); return m ? m[1] : null; }
function withTitle(text, name) {
  const lines = (text || '').split('\n'), i = lines.findIndex((l) => l.trim());
  if (i >= 0 && TITLE_LINE.test(lines[i])) lines[i] = lines[i].replace(/^(#{1,6}\s+).*$/, '$1' + name);
  else lines.splice(Math.max(0, i), 0, '# ' + name, ...(i >= 0 ? [''] : []));
  return lines.join('\n');
}
function renameDoc(d, name) {
  if (!name || name === d.name) return;
  if (!renameDoc.typing) snap();
  d.name = name; d.text = withTitle(d.text, name); d.updated = Date.now();
  if (curId === d.id) { ed.replaceText(d.text); if (document.activeElement !== $('#ed-name')) $('#ed-name').value = name; }
  save();
}
function newDoc({ name, place = 'canvas', x = 0, y = 0, text = '' }) {
  name = name || titleOf(text) || nextName();
  text = withTitle(text, name) + (text ? '' : '\n\n');
  const d = { id: uid(), name, text, x: Math.round(x), y: Math.round(y), z: topZ(), place, created: Date.now(), updated: Date.now() };
  S.docs.push(d); return d;
}
function newItem(kind, text, at) {
  const n = ++S.seq[kind];
  const it = { id: (kind === 'idea' ? 'i' : 't') + n, kind, n, text, created: Date.now(), done: false, onCanvas: !!at, x: at ? Math.round(at.x) : 0, y: at ? Math.round(at.y) : 0, z: topZ() };
  listOf(kind).push(it);
  if (text) log('crear', `${kind === 'idea' ? 'Idea' : 'Tarea'} «${text}»`, { ref: it.id });
  return it;
}
function create(kind, w, inStash) {
  snap();
  if (kind === 'doc') {
    const d = newDoc({ place: inStash ? 'stash' : 'canvas', x: w.x - DOC_W / 2, y: w.y - 30 });
    if (inStash) putInTray([d], inStash);
    log('crear', `Documento «${d.name}»`, { ref: d.id });
    sel.clear(); save(); render();
    if (w.free || inStash) {                       // dragged onto the plane or a tray: placed, not opened; its name ready to type
      const el = inStash ? stash.querySelector(`.chip[data-id="${d.id}"] b`) : elOf(d.id)?.querySelector('.dtitle');
      if (el) editInline(el, (v) => { if (v) { renameDoc(d, v); render(); } });
    } else { openEditor(d.id); setTimeout(() => { $('#ed-name').focus(); $('#ed-name').select(); }, 30); }
  } else if (kind === 'text') {
    const x = { id: uid(), x: Math.round(w.x - 40), y: Math.round(w.y - 14), z: topZ(), text: '' };
    S.texts.push(x); sel.clear(); sel.add(x.id); save(); render(); writeText(x, true);
  } else if (kind === 'postit') {
    const p = { id: uid(), x: Math.round(w.x - 85), y: Math.round(w.y - 75), z: topZ(), text: '', color: PASTEL[0] };
    S.postits.push(p); sel.clear(); sel.add(p.id); save(); render(); editPostit(p);
  } else if (kind === 'frame' && !w.free && [...sel].map(find).some((x) => x?.k === 'f')) {
    return frameInside([...sel].map(find).find((x) => x?.k === 'f').o);
  } else if (kind === 'frame') {
    const f = { id: uid(), x: Math.round(w.x - 220), y: Math.round(w.y - 140), w: 440, h: 300, title: '', color: PASTEL[(S.frames.length + 4) % PASTEL.length] };
    const fitted = fitFrame(f, { x: w.x - 260, y: w.y - 200, w: 520, h: 400 });
    S.frames.push(f); sel.clear(); sel.add(f.id); save(); render();
    if (fitted) elOf(f.id)?.animate([{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    editInline(elOf(f.id).querySelector('.ftitle'), (v) => { f.title = v; save(); render(); }, true);
  } else {
    const it = newItem(kind, '', { x: w.x - 19, y: w.y - 19 });
    if (w.pin) { it.pin = { ...w.pin, at: w.pin.side === 'tab' ? 99 : w.pin.at }; }
    sel.clear(); sel.add(it.id); save(); render();
    writeInline(it, true);
  }
}

// Inline text editing. onDone gets the trimmed text, or null when cancelled.
function editInline(el, onDone, allowEmpty = false) {
  const before = el.textContent === '…' ? '' : el.textContent;
  el.textContent = before;
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    el.contentEditable = 'false';
    const v = el.textContent.replace(/\s+/g, ' ').trim();
    if (!ok) { el.textContent = before; onDone(before ? null : ''); return; }
    if (!v && !allowEmpty && before) { el.textContent = before; onDone(null); return; }
    onDone(v);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  el.addEventListener('blur', () => finish(true), { once: true });
}
function editPostit(p) {
  const el = elOf(p.id)?.querySelector('.ptext'); if (!el) return;
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); el.blur(); } });
  el.addEventListener('blur', () => {
    el.contentEditable = 'false';
    const v = el.innerText.replace(/\n$/, '');
    if (v !== p.text) { snap(); p.text = v; save(); }
  }, { once: true });
}
// Stacking: what is on the plane has a z; new things and «Al frente» go on top, «Al fondo» under everything.
const stackable = () => [...S.docs.filter((d) => d.place === 'canvas'), ...S.postits, ...S.ideas, ...S.tasks];
const topZ = () => Math.max(0, ...stackable().map((o) => o.z || 0)) + 1;
// Interior: who owns whom. A thing belongs to the smallest bigger thing (not of a lower kind) whose rectangle holds its
// centre; ties go to the one on top. Edge things (pinned, docked) belong to their host and are left out here.
function owners() {
  const boxes = [...itemsEl.querySelectorAll('[data-k]')].map((el) => {
    const { k, o } = find(el.dataset.id), [w, h] = sizeOf(el, o); return { id: o.id, k, x: o.x, y: o.y, w, h, z: o.z || 0, o };
  });
  const ownerOf = new Map();
  for (const Y of boxes) {
    if (Y.o.pin || Y.o.dock) continue;
    const cx = Y.x + Y.w / 2, cy = Y.y + Y.h / 2, area = Y.w * Y.h;
    let best = null;
    for (const X of boxes) {
      if (X === Y || RANK[X.k] < RANK[Y.k] || X.w * X.h <= area * 1.05) continue;
      if (cx <= X.x || cx >= X.x + X.w || cy <= X.y || cy >= X.y + X.h) continue;
      if (!best || X.w * X.h < best.w * best.h || (X.w * X.h === best.w * best.h && X.z > best.z)) best = X;
    }
    if (best) ownerOf.set(Y.id, best.id);
  }
  return { boxes, ownerOf };
}
// What lies inside a thing is never behind it: after any change of order, each thing sits above its owner.
function enforceStack() {
  const { ownerOf } = owners();
  const kids = new Map();
  for (const [id, own] of ownerOf) { if (!kids.has(own)) kids.set(own, []); kids.get(own).push(find(id)?.o); }
  // owners from the bottom up; each one's things above it, in the order they already had
  const order = [...kids.keys()].map((id) => find(id)?.o).filter(Boolean).sort((p, q) => (p.z || 0) - (q.z || 0));
  for (let pass = 0; pass < 4; pass++) for (const x of order) {
    let base = (x.z || 0) + 1;
    for (const y of kids.get(x.id).filter(Boolean).sort((p, q) => (p.z || 0) - (q.z || 0))) { y.z = Math.max(y.z || 0, base); base = y.z + 1; }
  }
}
function restack(objs, front) {
  objs = objs.filter((o) => !('w' in o && 'title' in o));        // frames always stay behind
  if (!objs.length) return;
  snap();
  const { ownerOf } = owners();
  if (front) { let z = topZ(); for (const o of objs) o.z = z++; }
  else {
    const set = new Set(objs);
    const floor = Math.max(0, ...objs.map((o) => { const own = ownerOf.get(o.id); return own ? (find(own)?.o.z || 0) + 1 : 0; }));
    for (const o of stackable()) if (!set.has(o) && (o.z || 0) >= floor) o.z = (o.z || 0) + objs.length;
    objs.forEach((o, i) => { o.z = floor + i; });
  }
  enforceStack();
  save(); renderItems(); paintSel();
}
// A frame dropped near loose things wraps them: it takes their outline plus a margin.
function fitFrame(f, near) {
  const R = near || { x: f.x - 60, y: f.y - 60, w: f.w + 120, h: f.h + 120 };
  const boxes = [];
  for (const el of itemsEl.querySelectorAll('[data-k]')) {
    const o = find(el.dataset.id).o, [w, h] = sizeOf(el, o);
    if (o.x + w > R.x && o.x < R.x + R.w && o.y + h > R.y && o.y < R.y + R.h) boxes.push([o.x, o.y, w, h]);
  }
  if (!boxes.length) return false;
  const pad = 28;
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2])), y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  f.x = Math.round(x0 - pad); f.y = Math.round(y0 - pad); f.w = Math.round(x1 - x0 + pad * 2); f.h = Math.round(y1 - y0 + pad * 2);
  return true;
}
function frameInside(outer) {
  snap();
  const f = { id: uid(), x: outer.x + 28, y: outer.y + 48, w: Math.max(180, Math.round(outer.w * 0.5)), h: Math.max(120, Math.round(outer.h * 0.45)), title: '',
    color: PASTEL[(PASTEL.indexOf(outer.color) + 2) % PASTEL.length] };
  S.frames.push(f); sel.clear(); sel.add(f.id); save(); render();
  elOf(f.id)?.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  editInline(elOf(f.id).querySelector('.ftitle'), (v) => { f.title = v || ''; save(); render(); }, true);
}
const RIBBON_RED = '#d9534f';
const SIGN_COLORS = [RIBBON_RED, RIBBON_RED];          // new ribbons are red; the reader offers the others
const RIBBON_COLORS = [RIBBON_RED, '#e8973a', '#e5c33f', '#5cae6b', '#4a90d9', '#8e6bd1', '#d96aa6', '#6b6470'];
function dropSign(e) {
  const sp = signSpot(e);
  if (!sp) return toast('Suéltalo junto al borde de un documento, post-it, idea, tarea o marco');
  snap();
  const g = { id: uid(), host: sp.hostEl.dataset.id, edge: sp.edge, t: sp.t, text: '', color: SIGN_COLORS[S.signs.length % SIGN_COLORS.length] };
  S.signs.push(g); save(); renderItems(); paintSel();
  openSign(g, true);
}
// The reader: a big panel over everything. Editing happens here too.
function closeReader() {
  const box = $('#reader'); if (!box.classList.contains('open') || box.classList.contains('closing')) return;
  box.classList.add('closing');
  setTimeout(() => { box.classList.remove('open', 'editing', 'closing', 'is-item'); box.onclose?.(); box.onclose = null; }, 200);
}
// An idea or a task in the reader: read it, edit it, tick it, delete it. «fresh»: just created, empty means it goes.
function writeInline(it, fresh = false) {
  const el = elOf(it.id); if (!el) return;
  const w0 = el.offsetWidth;
  el.classList.add('writing');
  const span = document.createElement('span'); span.className = 'wtext'; span.contentEditable = 'true'; span.spellcheck = false;
  span.textContent = it.text || '';
  el.append(span); span.focus();
  const r = document.createRange(); r.selectNodeContents(span); r.collapse(false); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
  grow(el, w0);
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    const v = span.textContent.replace(/\s+/g, ' ').trim();
    if (fresh && (!v || !ok)) { listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1); render(); save(); return; }
    if (ok && v && fresh) { it.text = v; log('crear', `${it.kind === 'idea' ? 'Idea' : 'Tarea'} «${v}»`, { ref: it.id }); changed(); return; }
    if (ok && v && v !== it.text) return setItemText(it, v);
    renderItems(); paintSel();
  };
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    e.stopPropagation();
  });
  span.addEventListener('input', () => { el.style.width = 'auto'; });
  span.addEventListener('blur', () => finish(true), { once: true });
}
function openItem(it, editing = false, fresh = false) {
  if (!it) return;
  const box = $('#reader'), name = it.kind === 'idea' ? 'Idea' : 'Tarea';
  const where = docsUsing(it).map((d) => `«${d.name}»`).join(', ');
  box.classList.add('is-item');
  box.querySelector('.rd-colors').hidden = true;
  box.querySelector('.rd-where').textContent = name + (it.kind === 'tarea' ? (it.done ? ' · hecha' : ' · pendiente') : '') + (where ? ` · en ${where}` : '');
  box.querySelector('.rd-panel').style.setProperty('--sc', it.kind === 'idea' ? '#cdeedd' : '#cfe5fb');
  const done = box.querySelector('[data-rd="done"]');
  done.hidden = it.kind !== 'tarea'; done.textContent = it.done ? '↺ Reabrir' : '✔ Hecha';
  const text = box.querySelector('.rd-text'), area = box.querySelector('.rd-edit');
  area.placeholder = it.kind === 'idea' ? 'Escribe la idea… (Ctrl+Enter guarda)' : 'Escribe la tarea… (Ctrl+Enter guarda)';
  const show = (ed) => { box.classList.toggle('editing', ed); text.textContent = it.text || 'Sin texto todavía.'; area.value = it.text || ''; if (ed) setTimeout(() => area.focus(), 30); };
  const drop = () => { if (fresh && !it.text) { listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1); render(); save(); } };
  box.onclose = drop;
  const saveIt = () => {
    const v = area.value.replace(/\s+$/, '');
    if (fresh && !it.text && v) { it.text = v; log('crear', `${name} «${v}»`, { ref: it.id }); changed(); fresh = false; }
    else setItemText(it, v);
    show(false);
  };
  box.onclick = (e) => {
    const a = e.target.closest('[data-rd]')?.dataset.rd;
    if (e.target === box.querySelector('.rd-back') || a === 'close') closeReader();
    else if (a === 'edit') show(true);
    else if (a === 'save') saveIt();
    else if (a === 'done') { toggleTask(it); done.textContent = it.done ? '↺ Reabrir' : '✔ Hecha'; box.querySelector('.rd-where').textContent = name + (it.done ? ' · hecha' : ' · pendiente'); }
    else if (a === 'del') { box.onclose = null; closeReader(); removeIds([it.id]); }
  };
  area.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveIt(); if (e.key === 'Escape') { e.stopPropagation(); if (area.value.trim() && area.value !== (it.text || '')) saveIt(); closeReader(); } };
  box.classList.remove('closing'); box.classList.add('open'); show(editing);
}
function openSign(g, editing = false) {
  if (!g) return;
  const host = find(g.host)?.o;
  const where = host ? (host.name || host.title || host.text || '').split('\n')[0].slice(0, 40) : '';
  const box = $('#reader');
  box.querySelector('.rd-where').textContent = where ? `Ribete en «${where}»` : 'Ribete';
  const cols = box.querySelector('.rd-colors');
  cols.hidden = false;
  cols.innerHTML = RIBBON_COLORS.map((c) => `<i data-rc="${c}" style="--d:${c}" class="${(g.color || RIBBON_RED) === c ? 'on' : ''}"></i>`).join('');
  cols.onclick = (e) => { const i = e.target.closest('[data-rc]'); if (!i) return; snap(); g.color = i.dataset.rc; save(); renderItems(); paintSel();
    for (const x of cols.children) x.classList.toggle('on', x === i); box.querySelector('.rd-panel').style.setProperty('--sc', g.color); };
  box.querySelector('.rd-panel').style.setProperty('--sc', g.color);
  const text = box.querySelector('.rd-text'), area = box.querySelector('.rd-edit');
  const show = (ed) => {
    box.classList.toggle('editing', ed);
    text.textContent = g.text || 'Sin texto todavía.';
    area.value = g.text || '';
    if (ed) setTimeout(() => area.focus(), 30);
  };
  box.onclick = (e) => {
    const a = e.target.closest('[data-rd]')?.dataset.rd;
    if (e.target === box.querySelector('.rd-back') || a === 'close') close();
    else if (a === 'edit') show(true);
    else if (a === 'save') { snap(); g.text = area.value.replace(/\s+$/, ''); save(); renderItems(); paintSel(); show(false); }
    else if (a === 'del') { snap(); S.signs = S.signs.filter((x) => x !== g); save(); renderItems(); paintSel(); close(); toast('Ribete quitado', [['Deshacer', doUndo]]); }
  };
  area.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) box.querySelector('[data-rd="save"]').click(); if (e.key === 'Escape') { e.stopPropagation(); if (!g.text && !area.value) { S.signs = S.signs.filter((x) => x !== g); save(); renderItems(); } close(); } };
  const close = () => closeReader();
  box.classList.remove('is-item'); box.onclose = null;
  box.querySelector('[data-rd="done"]').hidden = true;
  box.classList.remove('closing'); box.classList.add('open'); show(editing);
}
function setItemText(it, v) {
  if (v == null || v === it.text) return;
  snap(); log('renombrar', `«${it.text}» → «${v}»`, { ref: it.id }); it.text = v; changed();
}
function toggleTask(it) {
  snap(); it.done = !it.done; it.doneAt = it.done ? Date.now() : null;
  log(it.done ? 'hecha' : 'reabrir', `Tarea «${it.text}»`, { item: it.id });
  changed();
}

// ---- deleting ------------------------------------------------------------------------------------------------------
// Document numbers close the gap, as if the deleted one never existed. An idea or task that is still inside a document
// only leaves the plane; deleted for good, it stays in those documents as plain text.
function renumber(text, k) {
  return (text || '').replace(LINK_RE, (m, label, n) => { n = +n; if (n === k) return `[${label}]`; return n > k ? `[${label}*${n - 1}]` : m; });
}
function deleteItemForGood(it) {
  const plain = `${it.kind === 'idea' ? '💡' : it.done ? '☑' : '☐'} ${it.text}`;
  for (const d of S.docs) d.text = (d.text || '').split(token(it)).join(plain);
  listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1);
}
function removeIds(ids) {
  ids = ids.filter((id) => find(id)); if (!ids.length) return;
  snap();
  const set = new Set(ids); let left = 0;
  const idx = S.docs.map((d, i) => (set.has(d.id) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
  for (const i of idx) {
    const [d] = S.docs.splice(i, 1);
    if (d.place !== 'canvas') releaseRiders(d);
    log('borrar', `Documento «${d.name}»`, { restore: { k: 'd', o: d } });
    for (const o of S.docs) o.text = renumber(o.text, i + 1);
  }
  for (const p of S.postits.filter((p) => set.has(p.id))) log('borrar', `Post-it «${(p.text || '').slice(0, 40)}»`, { restore: { k: 'p', o: p } });
  for (const f of S.frames.filter((f) => set.has(f.id))) log('borrar', `Marco «${f.title || 'sin título'}»`, { restore: { k: 'f', o: f } });
  S.signs = (S.signs || []).filter((g) => !set.has(g.host));
  S.texts = (S.texts || []).filter((x) => !set.has(x.id));
  S.postits = S.postits.filter((p) => !set.has(p.id));
  S.frames = S.frames.filter((f) => !set.has(f.id));
  for (const it of [...S.ideas, ...S.tasks].filter((x) => set.has(x.id))) {
    if (docsUsing(it).length) { it.onCanvas = false; left++; continue; }
    log('borrar', `${it.kind === 'idea' ? 'Idea' : 'Tarea'} «${it.text}»`, { restore: { k: it.kind, o: { ...it } } });
    deleteItemForGood(it);
  }
  for (const id of ids) sel.delete(id);
  if (curId) { const d = docById(curId); if (!d) closeEditor(); else { ed.replaceText(d.text || ''); fillHead(); } }
  changed();
  toast(left && left === ids.length ? 'Quitado del plano: sigue en sus documentos' : ids.length === 1 ? 'Borrado' : `${ids.length} elementos borrados`, [['Deshacer', doUndo]]);
}
function restoreFrom(h) {
  const { k, o } = h.restore;
  if (k === 'd') { S.docs.push({ ...o }); }
  else if (k === 'p') S.postits.push({ ...o });
  else if (k === 'f') S.frames.push({ ...o });
  else { if (getItem(k, o.n)) return toast('Ya está'); listOf(k).push({ ...o, onCanvas: true }); }
  log('restaurar', h.msg, { ref: o.id }); h.restored = true; changed(); toast('Restaurado');
}

// ---- actions on the plane ------------------------------------------------------------------------------------------
async function docAction(a, d) {
  if (a === 'copy') { await navigator.clipboard.writeText(readable(d.text)); return toast(`Copiado «${d.name}»`); }
  let clip;
  try { clip = (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'); } catch { return toast('El navegador no deja leer el portapapeles'); }
  if (!clip) return toast('El portapapeles está vacío');
  snap();
  const before = d.text;
  d.text = a === 'add' ? (d.text ? d.text.replace(/\n*$/, '\n') + clip : clip) : clip;
  d.updated = Date.now();
  log('editar', `${a === 'add' ? 'Añadiste a' : 'Reemplazaste'} «${d.name}»`, { docId: d.id, before });
  changed();
  toast(a === 'add' ? `Añadido al final de «${d.name}»` : `«${d.name}» reemplazado`, [['Deshacer', doUndo]]);
}

// ---- pointer: pan, box select, move, resize ------------------------------------------------------------------------
let act = null, space = false;
vp.addEventListener('contextmenu', (e) => e.preventDefault());
vp.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.dgroup')) return;
  const sgEl = e.target.closest('.sign');
  if (sgEl) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    act = { k: 'sign', g: S.signs.find((x) => x.id === sgEl.dataset.sign), el: sgEl, sx: e.clientX, sy: e.clientY, moved: false };
    return;
  }
  if (e.target.closest('.acts, .x, .pal, .chk, .f-add, .wtext, [contenteditable="true"]')) return;
  const it = e.target.closest('[data-k]');
  // pan: dragging the empty grid (the common thing), or middle/right button, or Space + drag; Ctrl + drag selects a group
  if (e.button === 1 || e.button === 2 || (e.button === 0 && (space || (!it && !e.ctrlKey && !e.metaKey)))) {
    e.preventDefault();
    act = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, empty: !it }; vp.classList.add('panning'); return;
  }
  if (e.button !== 0) return;
  document.activeElement?.blur?.();
  const rs = e.target.closest('.rs');
  const prs = e.target.closest('.prs');
  if (prs) {
    const host = prs.closest('[data-k]'), p = find(host.dataset.id).o;
    const keep = new Set(sel); sel.clear(); sel.add(p.id);
    const deps = collectMoving(e.altKey).filter((m) => m.o !== p).map((m) => ({ ...m, s0: m.o.s || 1, w0: m.o.w, h0: m.o.h }));
    sel.clear(); for (const id of keep) sel.add(id); sel.add(p.id); paintSel();
    act = { k: 'scale', p, sx: e.clientX, s0: p.s || 1, w0: host.offsetWidth, el: host, deps }; return;
  }
  if (rs) {
    const f = find(rs.closest('.frame').dataset.id).o;
    const keep = new Set(sel); sel.clear(); sel.add(f.id);
    const deps = e.shiftKey ? collectMoving(false).filter((m) => m.o !== f).map((m) => ({ ...m, s0: m.o.s || 1, w0: m.o.w, h0: m.o.h })) : [];
    sel.clear(); for (const id of keep) sel.add(id);
    // the contents' outline: the frame can't be pulled inside it (unless they scale with it)
    let hold = null;
    if (!e.shiftKey) {
      sel.clear(); sel.add(f.id);
      for (const m of collectMoving(false)) {
        if (m.o === f) continue;
        const [w, h] = m.k === 'f' ? [m.o.w, m.o.h] : sizeOf(m.el, m.o), y0 = m.k === 'f' ? m.o.y - 34 : m.o.y;
        hold = hold ? { x0: Math.min(hold.x0, m.o.x), y0: Math.min(hold.y0, y0), x1: Math.max(hold.x1, m.o.x + w), y1: Math.max(hold.y1, m.o.y + h) }
          : { x0: m.o.x, y0, x1: m.o.x + w, y1: m.o.y + h };
      }
      sel.clear(); for (const id of keep) sel.add(id);
    }
    act = { k: 'resize', f, sx: e.clientX, sy: e.clientY, x: f.x, y: f.y, w: f.w, h: f.h, c: rs.dataset.c || 'br', el: rs.closest('.frame'), deps, hold }; return;
  }
  if (it) {
    const id = it.dataset.id, toggle = e.shiftKey || e.ctrlKey || e.metaKey, selBefore = new Set(sel);
    if (toggle) { sel.has(id) ? sel.delete(id) : sel.add(id); }
    else if (!sel.has(id)) { sel.clear(); sel.add(id); }
    paintSel();
    act = { k: 'move', sx: e.clientX, sy: e.clientY, moving: collectMoving(e.altKey), moved: false, id, kind: it.dataset.k, toggle, selBefore, title: e.target.closest('.ftitle, .dtitle, .fdesc') };
    return;
  }
  act = { k: 'box', sx: e.clientX, sy: e.clientY, add: e.shiftKey, base: new Set(sel), moved: false };   // Ctrl + drag on empty grid (Shift adds)
});

// What moves with the selection: the selected things, and whatever sits inside a selected frame (Alt: the frame alone).
// What moves with the selection (Alt: the selection alone):
// · a frame carries what has its centre inside it, and the frames wholly inside it (nested, any depth);
// · a document carries the post-its, ideas and tasks lying on it (one lying on two documents goes with the upper one);
// · a post-it, idea or task carries the small things it touches, and those theirs, except what lies on a document
//   that is not moving: that belongs to the document.
const RANK = { f: 4, d: 3, p: 2, i: 2, t: 2, x: 2 };
function collectMoving(alone) {
  const out = new Map();
  const add = (id) => { const f = find(id), el = elOf(id); if (f && el && !out.has(id)) out.set(id, { k: f.k, o: f.o, el, x0: f.o.x, y0: f.o.y }); };
  for (const id of sel) add(id);
  if (alone) return [...out.values()];
  const inside = (p, q) => p !== q && p.x >= q.x && p.y >= q.y && p.x + p.w <= q.x + q.w && p.y + p.h <= q.y + q.h;
  for (const id of sel) {
    const f = find(id); if (!f || f.k !== 'f') continue;
    const fr = f.o;
    for (const g of S.frames) if (inside(g, fr)) add(g.id);
    for (const el of itemsEl.querySelectorAll('[data-k]')) {
      const o = find(el.dataset.id).o;
      const [w, h] = sizeOf(el, o), cx = o.x + w / 2, cy = o.y + h / 2;
      if (cx > fr.x && cx < fr.x + fr.w && cy > fr.y && cy < fr.y + fr.h) add(el.dataset.id);
    }
  }
  for (const m of [...out.values()]) { if (m.k === 'd') for (const t of docked(m.o)) add(t.id); for (const t of pinnedTo(m.o.id)) add(t.id); }
  const { boxes, ownerOf } = owners();
  // carry: whatever is owned by something moving moves too (and what it owns, and so on)
  let grew = true;
  while (grew) {
    grew = false;
    for (const Y of boxes) {
      if (out.has(Y.id)) continue;
      const own = ownerOf.get(Y.id);
      if (own && out.has(own)) { add(Y.id); grew = true; }
      if (out.has(Y.id)) for (const t of [...docked(Y.o), ...pinnedTo(Y.id)]) add(t.id);
    }
  }
  return [...out.values()];
}
const overCanvas = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return !!el && !el.closest('#side, #stash, #zoom, #ed, #panel, #selbar') && !!el.closest('#vp'); };

addEventListener('pointermove', (e) => {
  if (gh) return moveGhost(e);
  if (!act) return;
  const z = S.view.z;
  if (act.k === 'sign') {
    if (!act.moved && Math.hypot(e.clientX - act.sx, e.clientY - act.sy) < 4) return;
    if (!act.moved) { act.moved = true; document.body.classList.add('dragging'); act.el.style.visibility = 'hidden'; }
    world.querySelector('.sign.preview')?.remove();
    const sp = signSpot(e);
    if (sp) sp.hostEl.insertAdjacentHTML('beforeend', signHTML({ ...act.g, id: act.g.id, edge: sp.edge, t: sp.t }, ' preview'));
    return;
  }
  if (act.k === 'pan') { S.view.x = act.vx + e.clientX - act.sx; S.view.y = act.vy + e.clientY - act.sy; applyView(); }
  else if (act.k === 'move') {
    if (!act.moved && Math.hypot(e.clientX - act.sx, e.clientY - act.sy) < 3) return;
    if (!act.moved) { act.moved = true; snap(); document.body.classList.add('dragging'); }
    if (act.moving.some((m) => m.k === 'd')) dragTrays(nearTrays(e));
    const dx = (e.clientX - act.sx) / z, dy = (e.clientY - act.sy) / z;
    { const now = performance.now(), dt = Math.max(1, now - (act.lt || now - 16)); const v = Math.hypot(e.clientX - (act.lx ?? e.clientX), e.clientY - (act.ly ?? e.clientY)) / dt;
      act.v = (act.v || 0) * 0.6 + v * 0.4; act.lt = now; act.lx = e.clientX; act.ly = e.clientY; }
    for (const m of act.moving) { m.o.x = Math.round(m.x0 + dx); m.o.y = Math.round(m.y0 + dy); m.el.style.left = m.o.x + 'px'; m.el.style.top = m.o.y + 'px'; }
    liveFit(act);
    pinHint((act.kind === 'i' || act.kind === 't') && act.moving.length === 1 ? act.moving[0].o : null, e);
    hotTray(e, act.moving.some((m) => m.k === 'd'));
  } else if (act.k === 'box') {
    if (!act.moved && Math.hypot(e.clientX - act.sx, e.clientY - act.sy) < 3) return;
    act.moved = true;
    const x0 = Math.min(act.sx, e.clientX), y0 = Math.min(act.sy, e.clientY), x1 = Math.max(act.sx, e.clientX), y1 = Math.max(act.sy, e.clientY);
    Object.assign($('#selrect').style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
    sel.clear(); if (act.add) for (const id of act.base) sel.add(id);
    for (const el of world.querySelectorAll('[data-k]')) {
      const b = el.getBoundingClientRect();
      const hit = el.dataset.k === 'f'
        ? b.left >= x0 && b.right <= x1 && b.top >= y0 && b.bottom <= y1
        : b.right >= x0 && b.left <= x1 && b.bottom >= y0 && b.top <= y1;
      if (hit) sel.add(el.dataset.id);
    }
    paintSel();
  } else if (act.k === 'scale') {
    if (!act.snapped) { act.snapped = true; snap(); document.body.classList.add('dragging'); }
    const ns = Math.round(Math.min(4, Math.max(0.25, act.s0 * (1 + (e.clientX - act.sx) / z / (act.w0 * act.s0)))) * 100) / 100;
    const f = ns / act.s0, p = act.p;
    p.s = ns; act.el.style.setProperty('--s', ns);
    scaleDeps(act.deps, p.x, p.y, f, f);
  } else if (act.k === 'resize') {
    if (!act.snapped) { act.snapped = true; snap(); document.body.classList.add('dragging'); }
    const dx = (e.clientX - act.sx) / z, dy = (e.clientY - act.sy) / z, c = act.c, f = act.f;
    let W = Math.max(160, Math.round(c.includes('l') ? act.w - dx : act.w + dx)), H = Math.max(100, Math.round(c.includes('t') ? act.h - dy : act.h + dy));
    if (act.hold) {                                // never smaller than what it holds
      const p = FIT_PAD, hd = act.hold, top = p + (act.f.desc ? 30 : 0);
      W = Math.max(W, c.includes('l') ? act.x + act.w - (hd.x0 - p) : hd.x1 + p - act.x);
      H = Math.max(H, c.includes('t') ? act.y + act.h - (hd.y0 - top) : hd.y1 + p - act.y);
    }
    f.w = W; f.h = H; f.x = c.includes('l') ? act.x + act.w - W : act.x; f.y = c.includes('t') ? act.y + act.h - H : act.y;
    Object.assign(act.el.style, { left: f.x + 'px', top: f.y + 'px', width: W + 'px', height: H + 'px' });
    if (act.deps.length) scaleDeps(act.deps, c.includes('l') ? act.x + act.w : act.x, c.includes('t') ? act.y + act.h : act.y, W / act.w, H / act.h);
  }
});
// What a thing carries follows its scaling: positions stretch from the corner, sizes grow by the same factor.
function scaleDeps(deps, ox, oy, fx, fy) {
  const f = Math.min(fx, fy);
  for (const m of deps) {
    m.o.x = Math.round(ox + (m.x0 - ox) * fx); m.o.y = Math.round(oy + (m.y0 - oy) * fy);
    m.el.style.left = m.o.x + 'px'; m.el.style.top = m.o.y + 'px';
    if (m.k === 'f') { m.o.w = Math.round(m.w0 * fx); m.o.h = Math.round(m.h0 * fy); m.el.style.width = m.o.w + 'px'; m.el.style.height = m.o.h + 'px'; }
    else { m.o.s = Math.round(m.s0 * f * 100) / 100; m.el.style.setProperty('--s', m.o.s); }
  }
}
addEventListener('pointerup', (e) => {
  if (gh) return dropGhost(e);
  if (!act) return;
  const a = act; act = null;
  if (a.k === 'sign') {
    world.querySelector('.sign.preview')?.remove(); document.body.classList.remove('dragging');
    if (!a.moved) return openSign(a.g);
    const sp = signSpot(e);
    if (sp) { snap(); a.g.host = sp.hostEl.dataset.id; a.g.edge = sp.edge; a.g.t = sp.t; save(); }
    else toast('Suéltala junto al borde de algo');
    renderItems(); paintSel(); return;
  }
  const trayAt = overStash(e);                     // read it before the trays tuck away
  vp.classList.remove('panning'); document.body.classList.remove('dragging'); hotTray(e, false); dragTrays(false); $('#pinhint').classList.remove('on');
  if (a.k === 'pan') { if (a.empty && Math.hypot(e.clientX - a.sx, e.clientY - a.sy) < 3) { sel.clear(); paintSel(); } else saveView(); }
  else if (a.k === 'move' && a.moved) {
    const movedDocs = new Set(a.moving.filter((m) => m.k === 'd').map((m) => m.o.id));
    for (const m of a.moving) {
      if ((m.k !== 't' && m.k !== 'i') || !sel.has(m.o.id) || (m.o.dock && movedDocs.has(m.o.dock))) continue;
      const tg = dockTarget(m.o);
      if (tg) { delete m.o.pin; tg.others.splice(tg.at, 0, m.o); tg.others.forEach((x, i) => { x.dock = tg.d.id; x.dockAt = i; }); continue; }
      if (m.o.dock) { delete m.o.dock; delete m.o.dockAt; m.o.s = 1; }
      const pt = pinTarget(m.o, e);
      if (pt) {
        m.o.pin = pt;
        // order on that side by where things were dropped
        const list = pinnedTo(pt.host).filter((x) => x.pin.side === pt.side && x !== m.o);
        const along = (x) => { const r = elOf(x.id)?.getBoundingClientRect(); return r ? (pt.side === 't' || pt.side === 'b' ? r.left + r.width / 2 : r.top + r.height / 2) : 0; };
        const idx = pt.side === 'tab' || /^[tb][lr]$/.test(pt.side) ? list.length : list.filter((x) => along(x) < pt.at).length;
        list.splice(idx, 0, m.o); list.forEach((x, i) => { x.pin.at = i; });
      } else if (m.o.pin) { delete m.o.pin; m.o.s = 1; }
    }
    const tray = trayAt;
    endFit(a, !!tray);
    if (tray) {
      const ds = a.moving.filter((m) => m.k === 'd');
      for (const m of a.moving) { m.o.x = m.x0; m.o.y = m.y0; }
      if (ds.length) { const t = putInTray(ds.map((m) => m.o), tray); toast(ds.length === 1 ? `«${ds[0].o.name}» en «${t.name}»` : `${ds.length} documentos en «${t.name}»`); }
    } else if (a.moving.length === 1 && a.moving[0].k === 'f') {
      const f = a.moving[0].o, before = { ...f };
      if (fitFrame(f)) toast('Marco ajustado a lo que tiene cerca', [['Deshacer', () => { Object.assign(f, before); save(); render(); }]]);
    }
    pushApart([...a.moving.filter((m) => m.k === 'f').map((m) => m.o), ...(a.fitOrig ? a.fitOrig.keys() : [])]);
    enforceStack();
    save(); render();
  } else if (a.k === 'move' && a.title && !a.toggle) {
    const f = find(a.id).o;                              // one click on a frame's or a document's title edits it
    if (a.kind === 'd') editInline(a.title, (v) => { if (v) { renameDoc(f, v); render(); } });
    else if (a.title.classList.contains('fdesc')) editInline(a.title, (v) => { if (v !== null) { snap(); f.desc = v; save(); render(); } }, true);
    else editInline(a.title, (v) => { if (v !== null && v !== f.title) { snap(); f.title = v; save(); render(); } }, true);
  } else if (a.k === 'move' && !a.toggle && (a.kind === 'i' || a.kind === 't')) {
    openItem(find(a.id).o);                             // a click on an idea or a task reads it
  } else if (a.k === 'move' && !a.toggle && a.kind === 'f') {
    const f = find(a.id).o, keep = new Set([f.id]);
    sel.clear(); sel.add(f.id);
    const all = collectMoving(false).map((m) => m.o.id);
    const wasAll = a.selBefore && a.selBefore.size === all.length && all.every((id) => a.selBefore.has(id));
    sel.clear(); for (const id of wasAll ? keep : all) sel.add(id);
    paintSel();
  } else if (a.k === 'move' && !a.toggle && (a.kind === 'd' || a.kind === 'p' || a.kind === 'x')) {
    const d = find(a.id).o; sel.clear(); sel.add(d.id);
    const all = collectMoving(false).map((m) => m.o.id);
    const wasAll = all.length > 1 && a.selBefore && a.selBefore.size === all.length && all.every((id) => a.selBefore.has(id));
    sel.clear(); for (const id of wasAll ? [d.id] : all) sel.add(id);
    paintSel();
    if (!wasAll) { clearTimeout(clickT); clickT = setTimeout(() => focusOn(a.id), 240); }
  } else if (a.k === 'move' && !a.toggle) {
    clearTimeout(clickT); clickT = setTimeout(() => focusOn(a.id), 240);   // a click brings it close; a double click opens
  } else if (a.k === 'box') {
    $('#selrect').style.display = 'none';
    if (!a.moved && !a.add) { sel.clear(); paintSel(); }
  } else if (a.k === 'resize') { pushApart([a.f]); save(); render(); }
  else if (a.k === 'scale') save();
});

vp.addEventListener('click', (e) => {
  const grp = e.target.closest('.dgroup');
  if (grp) return openGroup(grp);
  if (e.target.closest('.sign')) return;                // a tag is read on pointerup (a click), or dragged
  const b = e.target.closest('.acts button');
  if (b) {
    const host = b.closest('[data-k]'), f = find(host.dataset.id);
    if (b.dataset.a === 'front' || b.dataset.a === 'back') return restack(sel.has(f.o.id) ? [...sel].map(find).filter(Boolean).map((x) => x.o) : [f.o], b.dataset.a === 'front');
    if (f.k === 'd') return docAction(b.dataset.a, f.o);
    if (b.dataset.a === 'ref') { navigator.clipboard.writeText(token(f.o)); return toast('Copiada. Pégala en un documento o en otro sitio del plano (Ctrl+V)'); }
  }
  const chk = e.target.closest('.chk');
  if (chk) return toggleTask(find(chk.closest('[data-k]').dataset.id).o);
  const fa = e.target.closest('.f-add');
  if (fa) return frameInside(find(fa.closest('.frame').dataset.id).o);
  const x = e.target.closest('.x');
  if (x) return removeIds([x.closest('[data-k]').dataset.id]);
  const dot = e.target.closest('.pal i');
  if (dot) { const f = find(dot.closest('[data-k]').dataset.id); snap(); f.o.color = dot.dataset.c; save(); render(); }
});
vp.addEventListener('dblclick', (e) => {
  clearTimeout(clickT);
  const ftx = e.target.closest('.ftext'); if (ftx) return writeText(find(ftx.dataset.id).o);
  const dc = e.target.closest('.doc');
  if (dc && !e.target.closest('.dtitle, .acts, .x, .prs, .sign')) return openEditor(dc.dataset.id);
  const pt = e.target.closest('.postit');
  if (pt) return editPostit(find(pt.dataset.id).o);
  const itx = e.target.closest('.item');
  if (itx) { const it = find(itx.dataset.id).o; return it.dock ? openItem(it, true) : writeInline(it); }
  const ft = e.target.closest('.ftab');
  if (ft) { const f = find(ft.closest('.frame').dataset.id).o; return editInline(ft.querySelector('.ftitle'), (v) => { if (v !== null) { f.title = v; save(); render(); } }, true); }
});

// Ctrl+V on the plane: a copied idea or task appears here; any other text becomes a post-it.
addEventListener('paste', (e) => {
  if (edOpen() || typing(e)) return;
  const t = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n/g, '\n');
  if (!t.trim()) return;
  e.preventDefault();
  const w = overCanvas({ clientX: mouse.x, clientY: mouse.y }) ? toWorld(mouse.x, mouse.y) : centerWorld();
  const m = t.trim().match(/^\{(idea|tarea) (\d+)\}$/);
  snap();
  if (m) {
    const it = getItem(m[1], +m[2]); if (!it) return toast('Esa ya no existe');
    it.onCanvas = true; it.x = Math.round(w.x - 90); it.y = Math.round(w.y - 18); it.z = topZ();
    sel.clear(); sel.add(it.id); changed(); return;
  }
  const p = { id: uid(), x: Math.round(w.x - 85), y: Math.round(w.y - 75), z: topZ(), text: t, color: PASTEL[0] };
  S.postits.push(p); sel.clear(); sel.add(p.id); changed(); toast('Pegado como post-it');
});

// ---- focus: a click centres a thing and brings it close; a pill takes you back to where you were ----------------
let clickT = null, backView = null, backT = null;
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let viewAnim = 0;
function animateView(to, ms = 380) {
  const from = { ...S.view }, id = ++viewAnim, t0 = performance.now();
  const area = visibleArea(), cx = (area.l + area.r) / 2, cy = (area.t + area.b) / 2;
  const c0 = { x: (cx - from.x) / from.z, y: (cy - from.y) / from.z }, c1 = { x: (cx - to.x) / to.z, y: (cy - to.y) / to.z };
  const step = (now) => {
    if (id !== viewAnim) return;
    const k = ease(Math.min(1, (now - t0) / ms));
    const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * k);
    const wx = c0.x + (c1.x - c0.x) * k, wy = c0.y + (c1.y - c0.y) * k;
    S.view = { x: cx - wx * z, y: cy - wy * z, z };
    applyView();
    if (k < 1) requestAnimationFrame(step); else { S.view = { ...to }; applyView(); saveView(); }
  };
  requestAnimationFrame(step);
}
function visibleArea() {
  const panelOpen = !$('#panel').classList.contains('closed');
  return { l: 24, r: innerWidth - (panelOpen ? 340 : 24), t: 70, b: innerHeight - 20 };
}
function focusOn(id) {
  const f = find(id), el = elOf(id); if (!f || !el) return;
  const [w, h] = f.k === 'f' ? [f.o.w, f.o.h + 34] : sizeOf(el, f.o);
  const area = visibleArea(), aw = area.r - area.l, ah = area.b - area.t;
  const z = Math.min(3, (aw * 0.62) / w, (ah * 0.7) / h);
  const ox = f.o.x + w / 2, oy = f.o.y - (f.k === 'f' ? 34 : 0) + h / 2;
  const to = { z, x: (area.l + area.r) / 2 - ox * z, y: (area.t + area.b) / 2 - oy * z };
  if (Math.abs(to.z - S.view.z) < 0.02 && Math.hypot(to.x - S.view.x, to.y - S.view.y) < 4) return;
  if (!backView) backView = { ...S.view };
  animateView(to);
  showBack();
}
function showBack() {
  const p = $('#backpill'); p.classList.add('on');
  clearTimeout(backT); backT = setTimeout(() => { p.classList.remove('on'); backView = null; }, 7000);
}
$('#backpill').onclick = () => {
  if (backView) animateView(backView);
  backView = null; clearTimeout(backT); $('#backpill').classList.remove('on');
};

// ---- frames make room: dragging things into a frame grows it, and the frames that hold it, to keep them inside -----
const FIT_PAD = 58;                    // frames fitting their contents keep room for hover buttons (not too snug)
const FIT_FAST = 1.1;                   // px per ms: faster than this, a dragged document leaves the frame instead
function liveFit(a) {
  // only a document makes a frame adapt: smaller things never move or resize bigger ones (hierarchy)
  if (a.kind !== 'd' || a.moving.some((m) => m.k === 'f')) return;
  const things = a.moving.filter((m) => m.k !== 'f'); if (!things.length) return;
  a.fitOrig ||= new Map();
  for (const [f, o] of a.fitOrig) { Object.assign(f, o); paintFrame(f, true); }   // start from how they were
  if ((a.v || 0) > FIT_FAST) { a.fitHost = null; return; }                         // fast: it just goes out (and lets go of the frame)
  const moving = new Set(a.moving.map((m) => m.o));
  const box = things.reduce((r, m) => {
    const [w, h] = sizeOf(m.el, m.o);
    return r ? { x0: Math.min(r.x0, m.o.x), y0: Math.min(r.y0, m.o.y), x1: Math.max(r.x1, m.o.x + w), y1: Math.max(r.y1, m.o.y + h) }
      : { x0: m.o.x, y0: m.o.y, x1: m.o.x + w, y1: m.o.y + h };
  }, null);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const holds = (f, x, y) => x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h;
  if (!a.fitHost || !S.frames.includes(a.fitHost)) a.fitHost = S.frames.filter((f) => holds(f, cx, cy)).sort((p, q) => p.w * p.h - q.w * q.h)[0] || null;
  const host = a.fitHost;
  if (!host) return;
  const chain = [host, ...S.frames.filter((f) => f !== host && f.x <= host.x && f.y <= host.y
    && f.x + f.w >= host.x + host.w && f.y + f.h >= host.y + host.h).sort((p, q) => p.w * p.h - q.w * q.h)];
  // what a frame holds besides what is being dragged: things whose centre is in it, frames wholly in it
  const contents = (f) => {
    const r = [];
    for (const el of itemsEl.querySelectorAll('[data-k]')) {
      const o = find(el.dataset.id)?.o; if (!o || moving.has(o)) continue;
      const [w, h] = sizeOf(el, o);
      if (holds(f, o.x + w / 2, o.y + h / 2)) r.push({ x0: o.x, y0: o.y, x1: o.x + w, y1: o.y + h });
    }
    for (const g of S.frames) if (g !== f && !chain.includes(g) && g.x >= f.x && g.y >= f.y && g.x + g.w <= f.x + f.w && g.y + g.h <= f.y + f.h)
      r.push({ x0: g.x, y0: g.y - 34, x1: g.x + g.w, y1: g.y + g.h });
    return r;
  };
  let inner = box;
  for (const f of chain) {
    if (!a.fitOrig.has(f)) a.fitOrig.set(f, { x: f.x, y: f.y, w: f.w, h: f.h });
    const all = [inner, ...contents(f)], top = FIT_PAD + (f.desc ? 30 : 0);
    const x0 = Math.min(...all.map((q) => q.x0)) - FIT_PAD, y0 = Math.min(...all.map((q) => q.y0)) - top;
    const x1 = Math.max(...all.map((q) => q.x1)) + FIT_PAD, y1 = Math.max(...all.map((q) => q.y1)) + FIT_PAD;
    Object.assign(f, { x: Math.round(x0), y: Math.round(y0), w: Math.max(160, Math.round(x1 - x0)), h: Math.max(100, Math.round(y1 - y0)) });
    paintFrame(f, true);
    inner = { x0: f.x, y0: f.y - 34, x1: f.x + f.w, y1: f.y + f.h };    // the next frame out keeps this one, tab included
  }
}
// ---- frames never overlap a frame that is not inside them: a frame that grows, moves or is stretched over another
// pushes it away (with everything it holds) just enough, along the shortest way out; the pushed one may push others ----
const PUSH_GAP = 24, TAB_H = 34;
const fbox = (f) => ({ x0: f.x, y0: f.y - TAB_H, x1: f.x + f.w, y1: f.y + f.h });
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;   // a within b
function shiftFrame(f, dx, dy) {
  const keep = new Set(sel); sel.clear(); sel.add(f.id);
  const group = collectMoving(false); sel.clear(); for (const id of keep) sel.add(id);
  for (const m of group) { m.o.x = Math.round(m.o.x + dx); m.o.y = Math.round(m.o.y + dy); }
}
function pushApart(changed) {
  const queue = [...new Set(changed)].filter((f) => S.frames.includes(f));
  let guard = 0;
  while (queue.length && guard++ < 60) {
    const A = queue.shift(), a = fbox(A);
    for (const B of S.frames) {
      if (B === A || inside(A, B) || inside(B, A)) continue;              // nested frames may overlap: that is nesting
      const b = fbox(B);
      if (a.x1 + PUSH_GAP / 2 <= b.x0 || b.x1 + PUSH_GAP / 2 <= a.x0 || a.y1 + PUSH_GAP / 2 <= b.y0 || b.y1 + PUSH_GAP / 2 <= a.y0) continue;
      const moves = [[a.x1 + PUSH_GAP - b.x0, 0], [a.x0 - PUSH_GAP - b.x1, 0], [0, a.y1 + PUSH_GAP - b.y0], [0, a.y0 - PUSH_GAP - b.y1]];
      const [dx, dy] = moves.sort((p, q) => Math.hypot(...p) - Math.hypot(...q))[0];
      shiftFrame(B, dx, dy);
      queue.push(B);
    }
  }
}
function paintFrame(f, smooth = false) {
  const el = elOf(f.id); if (!el) return;
  el.classList.toggle('fit', smooth);
  Object.assign(el.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
}
// On drop the grown frames stay (into a drawer: they go back as they were).
function endFit(a, undoIt) {
  if (!a.fitOrig) return;
  for (const [f, o] of a.fitOrig) { if (undoIt) Object.assign(f, o); paintFrame(f); }
}

function openGroup(btn) {
  const d = docById(btn.dataset.doc), kind = btn.dataset.kind; if (!d) return;
  const items = docked(d).filter((t) => t.kind === kind);
  const pop = $('#dlist'), r = btn.getBoundingClientRect();
  pop.innerHTML = `<div class="dl-h">${kind === 'idea' ? '💡 Ideas' : '☑ Tareas'} de «${esc(d.name)}» <i>${items.length}</i></div>`
    + items.map((t) => `<div class="dl-row${t.done ? ' done' : ''}" data-item="${t.id}">${t.kind === 'tarea' ? `<button class="chk${t.done ? ' on' : ''}">${t.done ? '✔' : ''}</button>` : '<span>💡</span>'}<span class="dl-t">${esc(t.text)}</span></div>`).join('');
  Object.assign(pop.style, { left: Math.min(r.right + 10, innerWidth - 340) + 'px', top: Math.max(70, Math.min(r.top, innerHeight - 380)) + 'px' });
  pop.classList.add('on');
  pop.onclick = (e) => {
    const row = e.target.closest('[data-item]'); if (!row) return;
    const it = find(row.dataset.item).o;
    if (e.target.closest('.chk')) { toggleTask(it); return openGroup(itemsEl.querySelector(`.dgroup[data-doc="${d.id}"][data-kind="${kind}"]`) || btn); }
    pop.classList.remove('on'); openItem(it);
  };
}
addEventListener('pointerdown', (e) => { if (!e.target.closest('#dlist, .dgroup')) $('#dlist')?.classList.remove('on'); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#dlist')?.classList.remove('on'); });

// ---- viewer: zoomed out too far to read, the thing under the pointer says its title at the bottom ------------------
const VIEWER_BELOW = 0.6;
function titleLine(f) {
  const { k, o } = f;
  if (k === 'd') { const w = (readable(o.text).match(/\S+/g) || []).length; return ['📄', o.name, w ? w + (w === 1 ? ' palabra' : ' palabras') : '']; }
  if (k === 'x') return ['Aa', (o.text || 'texto').split('\n')[0], ''];
  if (k === 'p') return ['🗒️', (o.text || 'post-it vacío').split('\n')[0], ''];
  if (k === 'i') return ['💡', o.text || 'idea', ''];
  if (k === 't') return [o.done ? '☑' : '☐', o.text || 'tarea', o.done ? 'hecha' : ''];
  return ['⬚', o.title || 'Marco sin título', ''];
}
vp.addEventListener('pointermove', (e) => {
  const v = $('#viewer');
  if (act || gh || S.view.z >= VIEWER_BELOW) { v.classList.remove('on'); return; }
  const el = e.target.closest?.('[data-k]'), f = el && find(el.dataset.id);
  if (!f) { v.classList.remove('on'); return; }
  const [ico, title, sub] = titleLine(f);
  v.innerHTML = `<span>${ico}</span><b>${esc(title)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}`;
  v.classList.add('on');
});
vp.addEventListener('pointerleave', () => $('#viewer').classList.remove('on'));

// ---- hover buttons never cover anything: before they show, the first free side is chosen (above, below, right, left)
const ACT_SIDES = ['at-top', 'at-bottom', 'at-right', 'at-left'];
function placeActs(host) {
  const acts = host.querySelector(':scope > .acts'); if (!acts) return;
  const others = [...world.querySelectorAll('#items [data-k], .ftab, .fdesc:not(.empty), .dgroup, .sign')]
    .filter((o) => o !== host && !host.contains(o) && !o.contains(host)).map((o) => o.getBoundingClientRect());
  const hit = (r) => others.some((q) => q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom);
  const pref = host.dataset.k === 'd' ? ACT_SIDES : ['at-bottom', 'at-top', 'at-right', 'at-left'];
  for (const side of pref) {
    acts.classList.remove(...ACT_SIDES); acts.classList.add(side);
    const r = [...acts.children].reduce((u, b) => { const q = b.getBoundingClientRect(); return u ? { left: Math.min(u.left, q.left), top: Math.min(u.top, q.top), right: Math.max(u.right, q.right), bottom: Math.max(u.bottom, q.bottom) } : q; }, null);
    if (r && !hit(r)) return;
  }
  acts.classList.remove(...ACT_SIDES); acts.classList.add(pref[0]);
}
itemsEl.addEventListener('pointerover', (e) => {
  const host = e.target.closest('[data-k]'); if (!host || act || gh) return;
  if (e.relatedTarget && host.contains(e.relatedTarget)) return;       // still inside the same thing
  placeActs(host);
});

// ---- peek: hovering something that is partly covered brings it forward for a moment, with what lies on it ----------
let peekT = null, peeked = [];
function unpeek() {
  for (const el of peeked) { const f = find(el.dataset.id); el.style.zIndex = f ? f.o.z || 0 : ''; el.classList.remove('peek'); }
  peeked = [];
}
function covered(el, group) {
  const me = find(el.dataset.id).o, r = el.getBoundingClientRect();
  return [...itemsEl.querySelectorAll('[data-k]')].some((o) => {
    if (o === el || group.has(o)) return false;
    const x = find(o.dataset.id).o; if ((x.z || 0) < (me.z || 0)) return false;
    const q = o.getBoundingClientRect();
    return q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom;
  });
}
function peek(el) {
  if (act || gh || !el.isConnected) return;
  const keep = new Set(sel); sel.clear(); sel.add(el.dataset.id);
  const group = collectMoving(false); sel.clear(); for (const id of keep) sel.add(id);
  if (!covered(el, new Set(group.map((m) => m.el)))) return;     // only when something else covers it
  unpeek();
  group.sort((a, b) => (a.o.z || 0) - (b.o.z || 0)).forEach((m, i) => { m.el.style.zIndex = 10000 + i; m.el.classList.add('peek'); peeked.push(m.el); });
}
itemsEl.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-k]'); if (!el || peeked.includes(el)) return;
  clearTimeout(peekT); peekT = setTimeout(() => peek(el), 280);
});
addEventListener('pointermove', (e) => {
  if (!peeked.length) return;
  const el = e.target.closest?.('[data-k]');
  if (!el || !peeked.includes(el)) { if (!el) clearTimeout(peekT); unpeek(); }
});

// ---- dragging from the sidebar and the stash (a ghost follows the pointer) ------------------------------------------
let gh = null;
const ghost = $('#ghost');
function startGhost(e, info) { gh = { ...info, sx: e.clientX, sy: e.clientY, moved: false }; }
function moveGhost(e) {
  if (!gh.moved && Math.hypot(e.clientX - gh.sx, e.clientY - gh.sy) < 4) return;
  if (!gh.moved) { gh.moved = true; ghost.innerHTML = gh.label; ghost.style.display = 'flex'; document.body.classList.add('dragging'); }
  if (gh.kind === 'doc' || gh.kind === 'chip') dragTrays(nearTrays(e));
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  if (gh.kind === 'sign') {
    world.querySelector('.sign.preview')?.remove();
    const sp = signSpot(e);
    ghost.style.display = sp ? 'none' : 'flex';
    if (sp) sp.hostEl.insertAdjacentHTML('beforeend', signHTML({ id: 'preview', edge: sp.edge, t: sp.t, color: SIGN_COLORS[S.signs.length % SIGN_COLORS.length] }, ' preview'));
    return;
  }
  hotTray(e, gh.kind === 'doc' || gh.kind === 'chip');
  if (gh.kind === 'idea' || gh.kind === 'tarea') pinHint({ id: '__new', kind: gh.kind }, e); else $('#pinhint').classList.remove('on');
}
function dropGhost(e) {
  const g = gh; gh = null;
  const trayAt = overStash(e);                     // read it before the trays tuck away
  world.querySelector('.sign.preview')?.remove();
  ghost.style.display = 'none'; document.body.classList.remove('dragging'); hotTray(e, false); dragTrays(false);
  if (g.kind === 'chip') {
    const d = docById(g.id); if (!d) return;
    if (!g.moved) return openEditor(d.id);
    const tray = trayAt;
    if (tray) { if (tray !== trayOf(d).id) { snap(); putInTray([d], tray); save(); render(); } return; }
    if (overCanvas(e)) {
      snap(); const w = toWorld(e.clientX, e.clientY);
      d.place = 'canvas'; d.x = Math.round(w.x - DOC_W / 2); d.y = Math.round(w.y - 20); releaseRiders(d);
      sel.clear(); sel.add(d.id); save(); render();
    }
    return;
  }
  if (g.kind === 'sign') { if (g.moved) dropSign(e); else toast('Arrastra el ribete hasta el borde de un documento, post-it o marco'); return; }
  if (!g.moved) return create(g.kind, centerWorld(), false);
  const tray = trayAt;
  if (tray) { if (g.kind === 'doc') create('doc', { x: 0, y: 0 }, tray); return; }
  $('#pinhint').classList.remove('on');
  if (overCanvas(e)) create(g.kind, { ...toWorld(e.clientX, e.clientY), free: true, pin: (g.kind === 'idea' || g.kind === 'tarea') ? pinTarget({ id: '__new' }, e) : null }, false);
}

const TOOLS = [
  ['doc', '📄', 'Documento', '#ffffff', 'Una página que se abre y se escribe'],
  ['postit', '🗒️', 'Post-it', '#fff1b8', 'Se escribe encima; no se abre'],
  ['idea', '💡', 'Idea', '#cdeedd', 'Una idea que puedes pegar en el plano y dentro de documentos'],
  ['tarea', '☑️', 'Tarea', '#cfe5fb', 'Una tarea que puedes pegar en el plano y dentro de documentos'],
  ['text', 'Aa', 'Texto', '#f1eef4', 'Texto suelto, escrito directamente en el plano'],
  ['frame', '⬚', 'Marco', '#e3d9f7', 'Un marco para agrupar lo que hay suelto'],
  ['sign', '🔖', 'Ribete', '#f6c9c7', 'Una cinta roja (o del color que quieras) en el borde de un documento, post-it o marco'],
];
$('#types').innerHTML = TOOLS.map(([k, ico, name, c, tip]) => `<div class="tool" data-kind="${k}" style="--c:${c}" title="${tip} · clic o arrastra al plano">
  <span class="ico">${ico}</span><span>${name}</span></div>`).join('');
$('#side').addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.tool'); if (!t || e.button !== 0) return;
  e.preventDefault(); startGhost(e, { kind: t.dataset.kind, label: t.innerHTML });
});
stash.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.x, .t-x, [contenteditable="true"]')) return;
  const c = e.target.closest('.chip'); if (!c) return;
  e.preventDefault(); startGhost(e, { kind: 'chip', id: c.dataset.id, label: c.innerHTML.replace(/<button[\s\S]*<\/button>/, '') });
});
stash.addEventListener('click', (e) => {
  const dr = e.target.closest('.t-pill') ? nearestDrawer(e.clientY) : null;
  if (dr) { for (const o of S.trays) o.open = o.id === dr.dataset.tray; for (const el of stash.querySelectorAll('.tray')) el.classList.toggle('open', el.dataset.tray === dr.dataset.tray); save(); return showTrays(true); }
  if (e.target.closest('.t-pill')) return showTrays(true);
  if (e.target.closest('.t-hide')) return showTrays(false);
  const dot = e.target.closest('.t-dot');
  if (dot) {
    const t = S.trays.find((o) => o.id === dot.closest('.tray').dataset.tray);
    snap(); t.color = TRAY_COLORS[(TRAY_COLORS.indexOf(t.color) + 1) % TRAY_COLORS.length]; save(); return renderStash();
  }
  const out = e.target.closest('.t-out');
  if (out) {
    const t = S.trays.find((o) => o.id === out.closest('.tray').dataset.tray);
    const ds = S.docs.filter((d) => d.place === 'stash' && trayOf(d) === t); if (!ds.length) return;
    snap(); const c = centerWorld(), cols = Math.min(4, ds.length);
    ds.forEach((d, i) => { d.place = 'canvas'; d.x = Math.round(c.x - (cols * 230) / 2 + (i % cols) * 230); d.y = Math.round(c.y - 140 + Math.floor(i / cols) * 300); d.z = topZ(); releaseRiders(d); });
    sel.clear(); ds.forEach((d) => sel.add(d.id)); changed(); return toast(`${ds.length} documento${ds.length > 1 ? 's' : ''} fuera de «${t.name}»`, [['Deshacer', doUndo]]);
  }
  const x = e.target.closest('.chip .x'); if (x) return removeIds([x.closest('.chip').dataset.id]);
  if (e.target.closest('.t-add')) {
    snap(); const used = new Set(S.trays.map((t) => t.color));
    const t = { id: 'b' + uid(), name: `Cajón ${S.trays.length + 1}`, color: TRAY_COLORS.find((c) => !used.has(c)) || TRAY_COLORS[0], open: true };
    for (const o of S.trays) o.open = false;
    S.trays.push(t); save(); renderStash();
    const nm = stash.querySelector(`[data-tray="${t.id}"] .t-name`); if (nm) editInline(nm, (v) => { if (v && v !== t.name) { t.name = v; save(); renderStash(); } });
    return;
  }
  const tx = e.target.closest('.t-x');
  if (tx) {
    const t = S.trays.find((o) => o.id === tx.closest('.tray').dataset.tray); if (!t || S.trays.length < 2) return;
    snap(); S.trays = S.trays.filter((o) => o !== t);
    const to = S.trays[0];
    for (const d of S.docs) if (d.place === 'stash' && d.tray === t.id) d.tray = to.id;
    if (t.open) to.open = true;
    save(); renderStash(); return;
  }
  const nm1 = e.target.closest('.t-name');
  if (nm1 && !nm1.isContentEditable) { const t = S.trays.find((o) => o.id === nm1.closest('.tray').dataset.tray); return editInline(nm1, (v) => { if (v && v !== t.name) { snap(); t.name = v; save(); renderStash(); } }); }
  const hd = e.target.closest('.tray header');
  if (hd && !e.target.closest('[contenteditable="true"]')) {
    const t = S.trays.find((o) => o.id === hd.closest('.tray').dataset.tray);
    for (const o of S.trays) o.open = o === t;
    for (const el of stash.querySelectorAll('.tray')) el.classList.toggle('open', el.dataset.tray === t.id);
    save();
  }
});
stash.addEventListener('dblclick', (e) => {
  const nm = e.target.closest('.t-name'); if (!nm) return;
  const t = S.trays.find((o) => o.id === nm.closest('.tray').dataset.tray);
  editInline(nm, (v) => { if (v) { t.name = v; save(); renderStash(); } });
});
addEventListener('resize', () => renderStash());
function nearestDrawer(y) {
  let best = null, bd = Infinity;
  for (const el of stash.querySelectorAll('.drw')) { const r = el.getBoundingClientRect(), d = Math.abs(y - (r.top + r.height / 2)); if (d < bd) { bd = d; best = el; } }
  return best;
}
stash.addEventListener('pointermove', (e) => {
  if (!e.target.closest('.st-chest')) return;
  const near = nearestDrawer(e.clientY);
  for (const el of stash.querySelectorAll('.drw')) el.classList.toggle('near', el === near);
});
stash.addEventListener('pointerleave', () => { for (const el of stash.querySelectorAll('.drw')) el.classList.remove('near'); });

// ---- the panel: tasks, ideas, history ------------------------------------------------------------------------------
let tab = localStorage.getItem('meadow.tab') || 'tareas';
$('#panel').classList.toggle('closed', localStorage.getItem('meadow.panel') === 'closed');
$('#panel-tab').onclick = () => {
  const closed = $('#panel').classList.toggle('closed');
  localStorage.setItem('meadow.panel', closed ? 'closed' : 'open');
};
$('#panel nav').onclick = (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  tab = b.dataset.tab; localStorage.setItem('meadow.tab', tab); renderPanel();
};
function whereOf(it) {
  const ds = docsUsing(it).map((d) => d.name);
  return [it.onCanvas ? 'plano' : '', ...ds.map((n) => `«${n}»`)].filter(Boolean).join(' · ') || 'en ningún sitio';
}
function when(t) {
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ayer ' + hm;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' + hm;
}
// The frame a point lies in, as a path from the outermost («Viaje › Transporte»), or '' when it lies in none.
function framePath(x, y) {
  return S.frames.filter((f) => x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h)
    .sort((a, b) => b.w * b.h - a.w * a.h).map((f) => f.title || 'Sin título').join(' › ');
}
// Where an idea or task lives for grouping: its own place on the plane, else the place of the first document holding it.
function groupOf(it) {
  const at = (o) => { const el = elOf(o.id); const [w, h] = el ? sizeOf(el, o) : [0, 0]; return framePath(o.x + w / 2, o.y + h / 2); };
  if (it.riding) return 'En un cajón, con su documento';
  if (it.onCanvas) return at(it) || 'En el plano, sin marco';
  const d = docsUsing(it).find((x) => x.place === 'canvas');
  if (d) return at(d) || 'En documentos sueltos';
  return docsUsing(it).length ? 'En documentos de los cajones' : 'En ningún sitio';
}
function groupedRows(list) {
  const groups = new Map();
  for (const it of list) { const g = groupOf(it); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); }
  const order = [...groups.keys()].sort((a, b) => (/^En /.test(a) - /^En /.test(b)) || a.localeCompare(b, 'es'));
  return order.map((g) => `<details class="grp" open><summary><span>${/^En /.test(g) ? '' : '⬚ '}${esc(g)}</span><i>${groups.get(g).length}</i></summary>${groups.get(g).map(itemRow).join('')}</details>`).join('');
}
let taskFilter = localStorage.getItem('meadow.taskFilter') || 'pend';
function goTo(id) {
  const f = find(id); if (!f) return toast('Ya no existe');
  if (f.k === 'd') { if (f.o.place === 'canvas') { /* documents open */ } return openEditor(f.o.id); }
  if (f.k === 'i' || f.k === 't') return locate(f.o);
  if (edOpen()) closeEditor();
  const el = elOf(id); centerOn(f.o, el); sel.clear(); sel.add(id); paintSel();
  el?.animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}
function itemRow(it) {
  const lead = it.kind === 'idea' ? '<span class="r-ico">💡</span>' : `<button class="chk${it.done ? ' on' : ''}" data-tid="${it.n}">${it.done ? '✔' : ''}</button>`;
  return `<div class="row${it.done ? ' done' : ''}" data-loc="${it.id}">${lead}<div class="r-main"><div class="r-text">${esc(it.text) || '…'}</div>
    <div class="r-sub">${esc(whereOf(it))}</div></div><button class="r-copy" data-copy="${it.id}" title="Copiar para pegar">⧉</button></div>`;
}
function renderPanel() {
  const open = S.tasks.filter((t) => !t.done).length;
  $('#pt-n').textContent = open || '';
  for (const b of document.querySelectorAll('#panel nav button')) b.classList.toggle('on', b.dataset.tab === tab);
  let html = '';
  if (tab === 'tareas') {
    const pend = S.tasks.filter((t) => !t.done).length, hech = S.tasks.length - pend;
    const list = S.tasks.filter((t) => taskFilter === 'all' || (taskFilter === 'done') === !!t.done)
      .sort((a, b) => (a.done - b.done) || (b.created - a.created));
    html = `<div class="filt">${[['pend', 'Pendientes', pend], ['done', 'Hechas', hech], ['all', 'Todas', S.tasks.length]]
      .map(([k, l, n]) => `<button data-filt="${k}" class="${taskFilter === k ? 'on' : ''}">${l} <i>${n}</i></button>`).join('')}</div>`;
    html += groupedRows(list) || `<p class="none">${taskFilter === 'done' ? 'Nada hecho todavía.' : 'Sin tareas pendientes. Arrastra «Tarea» al plano, o escribe <b>[</b> en un documento.'}</p>`;
  } else if (tab === 'ideas') {
    html = groupedRows([...S.ideas].sort((a, b) => b.created - a.created)) || '<p class="none">Sin ideas todavía.</p>';
  } else {
    html = S.history.slice(0, 200).map((h, i) => `<div class="hrow"><span class="h-ico">${ICON[h.kind] || '·'}</span><div class="r-main">
      <div class="r-text">${esc(h.msg)}</div><div class="r-sub">${when(h.t)}
      ${h.restore && !h.restored ? ` · <button class="lnk" data-hi="${i}" data-ha="restore">Restaurar</button>` : ''}
      ${(() => { const r = h.ref || h.item || h.docId, f = r && find(r); return f ? ` · <button class="lnk" data-goto="${r}">${f.k === 'd' ? 'Abrir' : 'Ir'}</button>` : ''; })()}
      ${h.kind === 'editar' && h.before != null && docById(h.docId) ? ` · <button class="lnk" data-hi="${i}" data-ha="version">Volver a como estaba</button>` : ''}
      </div></div></div>`).join('') || '<p class="none">Aquí aparecerá lo que hagas.</p>';
  }
  $('#panel-body').innerHTML = html;
}
$('#panel-body').addEventListener('click', async (e) => {
  const fb = e.target.closest('[data-filt]');
  if (fb) { taskFilter = fb.dataset.filt; localStorage.setItem('meadow.taskFilter', taskFilter); return renderPanel(); }
  const gt = e.target.closest('[data-goto]');
  if (gt) return goTo(gt.dataset.goto);
  const c = e.target.closest('.chk[data-tid]');
  if (c) return toggleTask(getItem('tarea', +c.dataset.tid));
  const cp = e.target.closest('[data-copy]');
  if (cp) { const it = find(cp.dataset.copy).o; await navigator.clipboard.writeText(token(it)); return toast('Copiada. Pégala en un documento o en el plano'); }
  const h = e.target.closest('[data-ha]');
  if (h) {
    const ev = S.history[+h.dataset.hi]; if (!ev) return;
    if (h.dataset.ha === 'restore') return restoreFrom(ev);
    const d = docById(ev.docId); if (!d) return;
    snap(); const now = d.text; d.text = ev.before;
    log('editar', `Volviste «${d.name}» a como estaba`, { docId: d.id, before: now });
    if (curId === d.id) ed.replaceText(d.text);
    changed(); return toast('Documento restaurado', [['Deshacer', doUndo]]);
  }
  const row = e.target.closest('[data-loc]');
  if (row) locate(find(row.dataset.loc).o);
});
function locate(it) {
  if (it.onCanvas) {
    if (edOpen()) closeEditor();
    const el = elOf(it.id); centerOn(it, el);
    sel.clear(); sel.add(it.id); paintSel();
    elOf(it.id)?.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  } else { const d = docsUsing(it)[0]; if (d) openEditor(d.id); }
}

// ---- keyboard ------------------------------------------------------------------------------------------------------
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');
addEventListener('keydown', (e) => {
  document.body.classList.toggle('ctrl', e.ctrlKey || e.metaKey);
  if ($('#reader').classList.contains('open')) { if (e.key === 'Escape') closeReader(); return; }
  if (edOpen()) { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.pop')) closeEditor(); return; }
  if (typing(e)) return;
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (e.key === 'Enter' && $('#backpill').classList.contains('on')) { e.preventDefault(); $('#backpill').click(); }
  else if (e.key === ' ') { space = true; vp.classList.add('space'); e.preventDefault(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) removeIds([...sel]);
  else if (mod && key === 'z') { e.preventDefault(); doUndo(); }
  else if (mod && key === 'a') { e.preventDefault(); for (const el of world.querySelectorAll('[data-k]')) sel.add(el.dataset.id); paintSel(); }
  else if (mod && key === 'c' && sel.size) {
    e.preventDefault();
    if (sel.size === 1) { const f = find([...sel][0]); if (f && (f.k === 'i' || f.k === 't')) { navigator.clipboard.writeText(token(f.o)); return toast('Copiada para pegar'); } }
    navigator.clipboard.writeText(groupText()); toast(sel.size === 1 ? 'Copiado' : 'Copiado todo el grupo');
  } else if (e.key === 'Escape') { sel.clear(); paintSel(); if (traysShown) showTrays(false); }
});
addEventListener('keyup', (e) => {
  document.body.classList.toggle('ctrl', e.ctrlKey || e.metaKey);
  if (e.key === ' ') { space = false; vp.classList.remove('space'); }
});
addEventListener('blur', () => { space = false; vp.classList.remove('space'); document.body.classList.remove('ctrl'); });

// ---- toasts --------------------------------------------------------------------------------------------------------
function toast(msg, actions = [], ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 280); };
  for (const [label, fn] of actions) {
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = () => { fn?.(); close(); }; el.append(b);
  }
  $('#toasts').append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  if (ms) setTimeout(close, ms);
}

// ---- the editor ----------------------------------------------------------------------------------------------------
let ed = null, curId = null, hist = [], plain = false, level = 0, session = null;
const edOpen = () => $('#ed').classList.contains('open');
function tagsInUse() {
  const count = new Map();
  for (const d of S.docs) for (const line of (d.text || '').split('\n')) {
    const m = line.match(TAG_RE); if (m) { const t = m[2].trim(); count.set(t, (count.get(t) || 0) + 1); }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}
// A small box to rename an idea or a task from inside a document.
function popEdit(anchor, value, onDone) {
  const r = anchor.getBoundingClientRect();
  const box = document.createElement('input'); box.className = 'pop'; box.value = value;
  Object.assign(box.style, { left: r.left + 'px', top: r.bottom + 6 + 'px' });
  document.body.append(box); box.focus(); box.select();
  let done = false;
  const end = (ok) => { if (done) return; done = true; box.remove(); if (ok && box.value.trim()) onDone(box.value.trim()); ed?.focus(); };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') end(true); if (e.key === 'Escape') { e.stopPropagation(); end(false); } });
  box.addEventListener('blur', () => end(true));
}
const edApi = {
  onChange(text) {
    const d = docById(curId); if (!d || d.text === text) return;
    d.text = text; d.updated = Date.now();
    const t = titleOf(text); if (t && t !== d.name) { d.name = t; if (document.activeElement !== $('#ed-name')) $('#ed-name').value = t; }
    save();
    clearTimeout(edApi.t); edApi.t = setTimeout(backlinks, 500);
  },
  getDocs: () => S.docs.map((d, i) => ({ n: i + 1, name: d.name, icon: '📄' })),
  getTags: tagsInUse,
  getItem: (kind, n) => getItem(kind, n),
  getItems: () => [...S.tasks.filter((t) => !t.done), ...S.ideas, ...S.tasks.filter((t) => t.done)],
  createItem(kind, text) { const it = newItem(kind, text, null); save(); renderPanel(); toast(`${kind === 'idea' ? 'Idea' : 'Tarea'} creada · está también en el panel`); return it.n; },
  toggleTask(n) { const it = getItem('tarea', n); if (it) toggleTask(it); },
  editItem(kind, n, el) { const it = getItem(kind, n); if (it) popEdit(el, it.text, (v) => setItemText(it, v)); },
  createDoc(name, text = '', o = {}) {
    const d = newDoc({ name, text, place: 'stash' }); putInTray([d], openTray().id);
    log('crear', `Documento «${name}» (en un cajón)`, { ref: d.id });
    save(); renderStash(); renderPanel();
    if (o.announce) toast(`«${name}» creado en «${openTray().name}»`, [['Abrir', () => openEditor(d.id)], ['Luego', null]], 6000);
    return N(d);
  },
  openDoc(n) { const d = S.docs[n - 1]; d ? openEditor(d.id) : toast('Ese documento ya no existe'); },
  toast: (m) => toast(m),
  onOutline(heads, current) {
    const key = JSON.stringify(heads) + current;
    if (key === edApi.lastOutline) return; edApi.lastOutline = key;
    $('#toc-list').innerHTML = heads.length
      ? heads.map((h) => `<button class="toc d${Math.min(h.d, 3)}${h.line === current ? ' on' : ''}" data-line="${h.line}">${esc(h.text)}</button>`).join('')
      : '<p class="none">Escribe <b># Título</b> para dividir el documento en secciones; aparecerán aquí.</p>';
    $('#toc-list .on')?.scrollIntoView({ block: 'nearest' });
  },
  onLevel(l) {
    level = l;
    for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.classList.toggle('on', +b.dataset.l === l);
  },
};
// One editing session per opened document: if the text changed, the history keeps how it was before.
function closeSession() {
  if (!session) return;
  const d = docById(session.id);
  if (d && d.text !== session.before) { log('editar', `Editaste «${d.name}»`, { docId: d.id, before: session.before }); save(); }
  session = null;
}
function openEditor(id, push = true) {
  const d = docById(id); if (!d) return;
  if (curId && push && curId !== id && ed) hist.push({ id: curId, pos: ed.view.state.selection.main.head, top: ed.view.scrollDOM.scrollTop });
  closeSession(); session = { id, before: d.text || '' };
  curId = id;
  $('#ed').classList.add('open');
  if (!ed) ed = createEditor($('#ed-body'), edApi);
  ed.setDoc(d.text || '');
  fillHead(); ed.focus();
}
function fillHead() {
  const d = docById(curId); if (!d) return;
  $('#ed-ico').textContent = '📄';
  $('#ed-name').value = d.name;
  $('#ed-prev').hidden = !hist.length;
  renderCrumbs();
  backlinks();
}
function backlinks() {
  const d = docById(curId); if (!d) return;
  const n = N(d), re = new RegExp(`\\[[^\\[\\]\\n]*?\\*${n}\\]`);
  const from = S.docs.filter((o) => o !== d && re.test(o.text || ''));
  $('#ed-foot').innerHTML = from.length
    ? '<span>Enlazado desde</span>' + from.map((o) => `<button data-id="${o.id}">📄 ${esc(o.name)}</button>`).join('')
    : '<span><b>[</b> busca documentos, ideas y tareas, o crea una nueva · <b>[nombre*]</b> crea un documento · Ctrl+clic abre un enlace · <b># Título</b> hace secciones</span>';
}
function closeEditor() { closeSession(); $('#ed').classList.remove('open'); curId = null; hist = []; render(); }
$('#ed-close').onclick = closeEditor;
$('.ed-back').onclick = closeEditor;
$('#ed-prev').onclick = () => backTo(hist.length - 1);
// Going back to a step of the trail: that document, at the place you left it.
function backTo(i) {
  const at = hist[i]; if (!at) return;
  hist = hist.slice(0, i);
  openEditor(at.id, false);
  const v = ed.view, pos = Math.min(at.pos, v.state.doc.length);
  v.dispatch({ selection: { anchor: pos } });
  requestAnimationFrame(() => { v.scrollDOM.scrollTop = at.top; });
}
// The trail between documents, over the text: each step can be peeked (hover: that document where you were) or reached.
function renderCrumbs() {
  const bar = $('#ed-crumbs'), d = docById(curId);
  bar.classList.toggle('on', hist.length > 0);
  if (!hist.length || !d) { bar.innerHTML = ''; return; }
  bar.innerHTML = '<button class="cr-back" title="Volver al anterior">← Volver</button>'
    + hist.map((h, i) => { const o = docById(h.id); return o ? `<button class="cr" data-i="${i}">${esc(o.name)}</button><span class="cr-sep">›</span>` : ''; }).join('')
    + `<span class="cr cur">${esc(d.name)}</span>`;
}
$('#ed-crumbs').addEventListener('click', (e) => {
  if (e.target.closest('.cr-back')) return backTo(hist.length - 1);
  const c = e.target.closest('.cr[data-i]'); if (c) { $('#crumb-peek').classList.remove('on'); backTo(+c.dataset.i); }
});
$('#ed-crumbs').addEventListener('pointerover', (e) => {
  const c = e.target.closest('.cr[data-i]'); const pk = $('#crumb-peek');
  if (!c) return;
  const h = hist[+c.dataset.i], o = h && docById(h.id); if (!o) return;
  const text = o.text || '', lineAt = text.slice(0, h.pos).split('\n').length - 1, lines = text.split('\n');
  const from = Math.max(0, lineAt - 4), to = Math.min(lines.length, lineAt + 9);
  pk.innerHTML = `<div class="pk-t">📄 ${esc(o.name)}</div><div class="pk-b">${lines.slice(from, to).map((l, k) =>
    `<div class="${from + k === lineAt ? 'here' : ''}">${esc(readable(l)) || '&nbsp;'}</div>`).join('')}</div>`;
  const r = c.getBoundingClientRect();
  Object.assign(pk.style, { left: Math.min(r.left, innerWidth - 440) + 'px', top: r.bottom + 6 + 'px' });
  pk.classList.add('on');
});
$('#ed-crumbs').addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('.cr[data-i]')) $('#crumb-peek').classList.remove('on'); });
$('#ed-foot').onclick = (e) => { const b = e.target.closest('button[data-id]'); if (b) openEditor(b.dataset.id); };
$('#ed-name').addEventListener('input', (e) => { const d = docById(curId); if (!d || !e.target.value.trim()) return; if (!renameDoc.typing) snap(); renameDoc.typing = true; renameDoc(d, e.target.value.trim()); clearTimeout(renameDoc.t); renameDoc.t = setTimeout(() => { renameDoc.typing = false; }, 1200); });
$('#ed-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
$('#ed-plain').onclick = () => {
  plain = !plain; ed.setPlain(plain);
  $('#ed-plain').classList.toggle('on', !plain);
  $('#ed-plain').title = plain ? 'Texto en crudo · clic: formato a la vista' : 'Formato a la vista · clic: texto en crudo';
  $('#ed-lv').classList.toggle('off', plain);
};
for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.onclick = () => ed.setLevel(level === +b.dataset.l ? 0 : +b.dataset.l);
$('#toc-list').onclick = (e) => { const b = e.target.closest('.toc'); if (b) ed.gotoLine(+b.dataset.line); };

load();
