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
  for (const [k, list] of [['d', S.docs], ['p', S.postits], ['f', S.frames], ['i', S.ideas], ['t', S.tasks], ['x', S.texts || []], ['g', S.shapes || []]]) {
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
const allText = (d) => d.book ? (d.pages || []).map((p) => p.id === d.page ? d.text : p.text).join('\n') : (d.text || '');
const docsUsing = (it) => S.docs.filter((d) => allText(d).includes(token(it)));
// a notebook as one text: each page under its tab's name
const bookText = (d) => (d.pages || []).map((p) => `## ${p.title}\n${readable(p.id === d.page ? d.text : p.text)}`).join('\n\n');

// ---- saving --------------------------------------------------------------------------------------------------------
async function load() {
  const j = await (await fetch('/api/state')).json();
  rev = j.rev || 0;
  if (j.state) S = { ...S, ...j.state };
  else S.view = { x: Math.round(innerWidth / 2 - 100), y: Math.round(innerHeight / 2 - 140), z: 1 };
  for (const k of ['postits', 'frames', 'ideas', 'tasks', 'history', 'signs', 'texts', 'shapes']) S[k] ||= [];
  S.seq ||= { idea: 0, tarea: 0 };
  for (const t of [...(S.ideas || []), ...(S.tasks || [])]) if (t.pin?.side === 'tab') t.pin.side = 't';
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
  undo.push(JSON.stringify({ docs: S.docs, postits: S.postits, frames: S.frames, ideas: S.ideas, tasks: S.tasks, signs: S.signs, texts: S.texts, shapes: S.shapes, trays: S.trays, seq: S.seq }));
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
const ICON = { crear: '＋', borrar: '🗑', editar: '✎', hecha: '✔', reabrir: '↺', restaurar: '⟲', renombrar: '✎' };

// ---- view, zoom and grid -------------------------------------------------------------------------------------------
function applyView() {
  const { x, y, z } = S.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  world.style.setProperty('--zi', 1 / z);           // text in a page being read keeps a normal size on screen
  if (inline) { inline.ed.view.requestMeasure(); clearTimeout(applyView.t); applyView.t = setTimeout(paintPage, 120); }
  $('#z-val').textContent = Math.round(z * 100) + ' %';
  drawGrid();
  if (!inline && ![...itemsEl.querySelectorAll('.doc')].some((el) => el.getBoundingClientRect().width >= NEAR_W * 0.9)) gridView = { ...S.view };
  nearDocs();
}
let gridView = null;
const NEAR_W = 300;                     // a page this wide on screen (px) is legible: it reads and writes in place                     // a page this wide on screen (px) reads in place
let nearT = null;
function nearDocs() {
  clearTimeout(nearT);
  nearT = setTimeout(() => {
    let best = null, bestD = Infinity;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (const el of itemsEl.querySelectorAll('.doc')) {
      const r = el.getBoundingClientRect(), near = r.width >= NEAR_W;
      if (near !== el.classList.contains('near')) {
        el.classList.toggle('near', near);
        const d = docById(el.dataset.id), body = el.querySelector('.dbody');
        if (d && body && !near) { if (inline?.id === d.id) unmountInline(); body.innerHTML = previewHTML(d); }
        else if (d && body && inline?.id !== d.id) body.innerHTML = readingHTML(d);
      }
      if (near) {
        const vis = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        const dd = -vis + Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (vis > r.width * r.height * 0.3 && dd < bestD) { bestD = dd; best = el; }
      }
    }
    // the closest page in the middle of the screen is the live document; the others just read
    const pill = $('#editpill');
    if (inline && !entering && inline.el.getBoundingClientRect().width < NEAR_W * 0.8) { unmountInline(); pill.classList.remove('on'); }
    if (inline) setTimeout(paintPage, 80); else pill.classList.remove('on');
  }, 60);
}
let inline = null;                      // { id, ed, el }: the page being edited in place
function mountInline(el, center = true) {
  const d = docById(el.dataset.id); if (!d) return;
  if (inline?.id === d.id && inline.el.isConnected) return;
  unmountInline();
  const body = el.querySelector('.dbody'); if (!body) return;
  body.innerHTML = '<div class="ied"></div>';
  const host = body.firstChild;
  const api = { ...edApi, readOnly: true, onOutline() {}, onLevel() {},
    onChange(text) {
      if (d.text === text) return;
      d.text = text; d.updated = Date.now();
      const t = titleOf(text); if (t && t !== d.name) { d.name = t; const ti = el.querySelector('.dtitle'); if (ti) ti.textContent = t; }
      save();
    } };
  const e2 = createEditor(host, api);
  e2.setDoc(d.text || '');
  inline = { id: d.id, ed: e2, el };
  el.classList.add('live');
  document.body.classList.add('reading');            // reading a page: the top bar steps aside
  if (center) centerLive();
}
// once the zooming settles, the live page glides to the middle of the screen (the zoom is kept)
let lastWheel = 0, entering = false;
addEventListener('wheel', () => { lastWheel = performance.now(); }, { capture: true, passive: true });
function centerLive() {
  clearTimeout(centerLive.t);
  centerLive.t = setTimeout(() => {
    if (!inline || !inline.el.isConnected) return;
    if (performance.now() - lastWheel < 250 || act) return centerLive();
    const r = inline.el.getBoundingClientRect(), a = visibleArea(), z0 = S.view.z;
    const wx = (r.left - S.view.x) / z0, wy = (r.top - S.view.y) / z0, ww = r.width / z0, wh = r.height / z0;
    const z1 = Math.min(12, Math.min((a.b - a.t - 36) / wh, (a.r - a.l - 60) / ww));
    const to = { z: z1, x: (a.l + a.r) / 2 - (wx + ww / 2) * z1, y: (a.t + a.b) / 2 - (wy + wh / 2) * z1 };
    if (Math.abs(to.x - S.view.x) > 3 || Math.abs(to.y - S.view.y) > 3 || Math.abs(z1 - z0) > 0.01) { entering = true; animateView(to, 520); setTimeout(() => { entering = false; paintPage(); }, 560); }
  }, 260);
}
function unmountInline() {
  if (!inline) return;
  try { inline.ed.view.destroy(); } catch {}
  inline.el.classList.remove('live');
  inline = null;
  document.body.classList.remove('reading');
}
// the whole text, lightly read: titles as titles, ideas/tasks/links as words
function readingHTML(d) {
  const lines = (d.text || '').split('\n');
  const out = lines.map((l, i) => {
    if (i === 0 && /^#{1,6}\s/.test(l)) return '';
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    if (m) return `<div class="rh rh${Math.min(3, m[1].length)}">${esc(readable(m[2]))}</div>`;
    return `<div class="rl">${esc(readable(l)) || '&nbsp;'}</div>`;
  }).join('');
  return out.replace(/^(<div class="rl">&nbsp;<\/div>)+/, '') || NOTHING_DOC;
}
function previewHTML(d) {
  const text = readable((d.text || '').replace(/^\s*#{1,6}\s+.*(\n|$)/, '').replace(/^\n+/, ''));
  return text ? esc(text.split('\n').slice(0, 14).join('\n')) : NOTHING_DOC;
}
// pages instead of an endless strip: the live page turns one screenful at a time
const liveScroller = () => inline?.ed.view.scrollDOM;
function pageInfo() { const sc = liveScroller(); if (!sc) return null; const h = sc.clientHeight || 1; return { sc, h, n: Math.max(1, Math.ceil((sc.scrollHeight - 2) / h)), i: Math.round(sc.scrollTop / h) }; }
function paintPage() { const p = pageInfo(); $('#ep-page').textContent = p && p.n > 1 ? `${p.i + 1} / ${p.n}` : ''; $('#editpill').classList.toggle('paged', !!p && p.n > 1); }
function turnPage(dir) {
  const p = pageInfo(); if (!p) return;
  const i = Math.min(p.n - 1, Math.max(0, p.i + dir)); if (i === p.i) return;
  p.sc.scrollTo({ top: i * p.h, behavior: 'smooth' }); setTimeout(paintPage, 320);
}
let wheelAcc = 0, wheelT = 0;
vp.addEventListener('wheel', (e) => {
  if (e.ctrlKey || !e.target.closest?.('.ied')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const now = performance.now(); if (now - wheelT < 380) return;
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) > 40) { turnPage(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; wheelT = now; }
}, { passive: false, capture: true });
$('#ep-prev').onclick = () => turnPage(-1);
$('#ep-next').onclick = () => turnPage(1);
$('#ep-edit').onclick = () => { const id = $('#editpill').dataset.id; if (id) { $('#editpill').classList.remove('on'); openEditor(id); } };
$('#ep-back').onclick = () => {
  unmountInline(); $('#editpill').classList.remove('on');
  animateView(gridView && gridView.z < S.view.z ? gridView : { ...S.view, z: 1, x: innerWidth / 2 - (innerWidth / 2 - S.view.x) / S.view.z, y: innerHeight / 2 - (innerHeight / 2 - S.view.y) / S.view.z }, 480);
};
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
  if (!e.ctrlKey && e.target.closest?.('.ied')) return;     // scroll the page being read
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  if (e.shiftKey) { S.view.x -= dy; applyView(); saveView(); return; }
  zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
}, { passive: false });
const toWorld = (cx, cy) => ({ x: (cx - S.view.x) / S.view.z, y: (cy - S.view.y) / S.view.z });
const centerWorld = () => { const a = visibleArea(); return toWorld((a.l + a.r) / 2, (a.t + a.b) / 2); };
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
function docTint(d) {
  if (!d || d.place !== 'canvas') return '';
  const el = elOf(d.id), [w, h] = el ? sizeOf(el, d) : [DOC_W, 260], cx = d.x + w / 2, cy = d.y + h / 2;
  const f = S.frames.filter((g) => cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h).sort((p, q) => p.w * p.h - q.w * q.h)[0];
  return f?.color || '';
}
function docHTML(d, n) {
  const text = readable((d.text || '').replace(/^\s*#{1,6}\s+.*(\n|$)/, '').replace(/^\n+/, ''));
  const words = (text.match(/\S+/g) || []).length;
  const tint = docTint(d);
  return `<div class="doc${d.book ? ' book' : ''}${sel.has(d.id) ? ' sel' : ''}${tint ? ' tinted' : ''}" data-id="${d.id}" data-k="d" style="left:${d.x}px;top:${d.y}px;z-index:${d.z || 0};--s:${d.s || 1}${tint ? ';--tint:' + tint : ''}">
    <div class="page">
      ${d.book ? `<div class="btabs">${(d.pages || []).map((p) => `<span class="${p.id === d.page ? 'on' : ''}">${esc(p.title)}</span>`).join('')}</div>` : ''}<div class="dtitle">${esc(d.name)}</div>
      <div class="dbody">${text ? esc(text.split('\n').slice(0, 14).join('\n')) : NOTHING_DOC}</div>
      <div class="dfoot"><span>📄</span><span>${words ? words + (words === 1 ? ' palabra' : ' palabras') : ''}</span></div>
    </div>
    <div class="dhov"><div class="dhov-in"><button data-a="read" title="Leer aquí, pasando páginas">${EYE}<b>Leer</b></button><i></i><button data-a="edit" title="Abrir el editor">${PEN}<b>Editar</b></button></div></div>
    <button class="x" title="Borrar">×</button>
    <div class="acts">
      <button data-a="copy">⧉<b>Copiar</b></button><button data-a="add">＋<b>Añadir lo copiado</b></button><button data-a="replace">⇄<b>Reemplazar</b></button>${ZB}
    </div>${PRS}</div>`;
}
const PRS = '<div class="prs" title="Arrastra: más grande o más pequeño (con lo que lleva encima; Alt: solo esto)"></div>';
// each post-it keeps its own small tilt, from its id (not from its place in the page)
const tiltOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ((h % 25) - 12) / 10; };
const ZB = '<button data-a="front">⤒<b>Al frente</b></button><button data-a="back">⤓<b>Al fondo</b></button>';
const postitHTML = (p) => `<div class="postit${sel.has(p.id) ? ' sel' : ''}" data-id="${p.id}" data-k="p" style="left:${p.x}px;top:${p.y}px;z-index:${p.z || 0};--bg:${p.color};--s:${p.s || 1};--tilt:${tiltOf(p.id)}deg">
  <div class="ptext">${esc(p.text)}</div><button class="x" title="Borrar">×</button>${palHTML()}<div class="acts">${ZB}</div>${PRS}</div>`;
// A shape: colour on the plane. Its form and colour change on hover; its right and bottom edges (and corner) size it.
const SHAPES = {
  rect: '<rect x="0" y="0" width="100" height="100"/>',
  round: '<rect x="0" y="0" width="100" height="100" rx="14" ry="14"/>',
  ellipse: '<ellipse cx="50" cy="50" rx="50" ry="50"/>',
  tri: '<path d="M50 0 L100 100 L0 100 Z"/>',
  diamond: '<path d="M50 0 L100 50 L50 100 L0 50 Z"/>',
};
const SHAPE_COLORS = ['#f6c1d6', '#f9b4a6', '#ffd58a', '#fff1b8', '#bfe3c6', '#a9d6ee', '#c9c0f0', '#e6dfe8', '#8fb3df', '#d9534f', '#5cae6b', '#3b3341'];
const shapeHTML = (g) => `<div class="shape${sel.has(g.id) ? ' sel' : ''}" data-id="${g.id}" data-k="g" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;z-index:${g.z || 0};--c:${g.color}">
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${SHAPES[g.form] || SHAPES.round}</svg>
  <button class="x" title="Borrar">×</button>
  <div class="shp-tools"><span class="shp-forms">${Object.keys(SHAPES).map((f) => `<button data-form="${f}" class="${f === g.form ? 'on' : ''}" title="${{ rect: 'Rectángulo', round: 'Redondeado', ellipse: 'Círculo', tri: 'Triángulo', diamond: 'Rombo' }[f]}"><svg viewBox="0 0 100 100" width="14" height="14">${SHAPES[f]}</svg></button>`).join('')}</span><i></i><span class="shp-cols">${SHAPE_COLORS.map((c) => `<b data-sc="${c}" style="--d:${c}" class="${c === g.color ? 'on' : ''}"></b>`).join('')}</span></div>
  <div class="acts">${ZB}</div><div class="tb tb-w" data-d="w"></div><div class="tb tb-h" data-d="h"></div><div class="tb tb-wh" data-d="wh"></div></div>`;
// Free text: words straight on the plane, no document.
const textHTML = (x) => `<div class="ftext${sel.has(x.id) ? ' sel' : ''}" data-id="${x.id}" data-k="x" style="left:${x.x}px;top:${x.y}px;z-index:${x.z || 0};--s:${x.s || 1}${x.w ? `;width:${x.w}px` : ''}${x.h ? `;height:${x.h}px` : ''}">
  <div class="xt">${esc(x.text)}</div><button class="x" title="Borrar">×</button><div class="acts">${ZB}</div><div class="tb tb-w" data-d="w" title="Ancho"></div><div class="tb tb-h" data-d="h" title="Alto"></div>${PRS}</div>`;
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
const NOTHING_FRAME = `<div class="nothing"><svg viewBox="0 0 120 70" width="120" height="70" aria-hidden="true">
  <path d="M8 58 H112" stroke="#c9bfcc" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 5"/>
  <g transform="translate(62 38)"><circle r="17" fill="none" stroke="#b6a48c" stroke-width="1.4"/>
    <path d="M-14 -6 C-4 -16 8 -14 14 -4 M-15 5 C-6 14 9 14 15 3 M-8 -14 C-2 -2 2 4 -6 15 M6 -15 C1 -3 -3 6 7 15 M-16 -1 C-5 -4 6 2 16 0" fill="none" stroke="#c7b598" stroke-width="1.1"/></g>
  <path d="M24 34 H36 M18 42 H34 M26 50 H38" stroke="#d9cfda" stroke-width="1.6" stroke-linecap="round"/>
</svg><span>Aquí no hay nada… todavía</span></div>`;
// read here / edit: two halves of one control, in the middle of the page, over a blur of it
const EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const PEN = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="M14.5 5.5l3 3"/></svg>';
const NOTHING_DOC = `<div class="nothing doc-nothing"><svg viewBox="0 0 80 50" width="70" height="44" aria-hidden="true">
  <g transform="rotate(-28 40 25)"><rect x="12" y="20" width="46" height="9" rx="2" fill="#fbe7a6" stroke="#d9b75c" stroke-width="1"/>
    <path d="M58 20 L68 24.5 L58 29 Z" fill="#f3dcc0" stroke="#c9a679" stroke-width="1"/><path d="M65 23.2 L68 24.5 L65 25.8 Z" fill="#6b5b50"/>
    <rect x="6" y="20" width="7" height="9" rx="2" fill="#f2b6c1" stroke="#d98c9b" stroke-width="1"/></g>
  <path d="M14 42 C22 38 28 46 36 42 S50 38 58 42" fill="none" stroke="#cdc3cf" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1 4"/>
</svg><span>Página en blanco</span></div>`;
const frameHTML = (f) => `<div class="frame${sel.has(f.id) ? ' sel' : ''}" data-id="${f.id}" data-k="f" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;--bg:${f.color}">
  <div class="fdesc${f.desc ? '' : ' empty'}${pinnedTo(f.id).some((t) => t.pin.side === 'desc' && t.pin.tab === activeTab(f)) ? ' has-pins' : ''}" title="Clic para escribir la descripción">${esc(f.desc || '')}</div>${NOTHING_FRAME}
  <div class="ftabs">${tabsOf(f).map((t, i) => { const on = t.id === activeTab(f); const n = on ? 0 : tabCount(f, t.id);
    return `<div class="ftab${on ? ' on' : ''}" data-tab="${t.id}"><span class="ftitle">${esc(t.title)}</span>${n ? `<i class="tn">${n}</i>` : ''}${on ? `<button class="f-add" title="Crear un marco dentro de este">＋</button><button class="x" title="${tabsOf(f).length > 1 ? 'Borrar esta pestaña' : 'Borrar el marco'}">×</button>` : ''}</div>`; }).join('')}<button class="tab-add" title="Nueva pestaña">＋</button>${palHTML()}</div>
  <div class="edge e-t"></div><div class="edge e-b"></div><div class="edge e-l"></div><div class="edge e-r"></div><div class="rs c-tl" data-c="tl"></div><div class="rs c-tr" data-c="tr"></div><div class="rs c-bl" data-c="bl"></div><div class="rs c-br" data-c="br"></div></div>`;
// A frame's tabs: the first is its title; the active one decides what is shown inside.
function tabsOf(f) { if (!f.tabs?.length) f.tabs = [{ id: 'tab-' + f.id, title: f.title || '' }]; f.tabs[0].title = f.title || ''; return f.tabs; }
const activeTab = (f) => (tabsOf(f).some((t) => t.id === f.active) ? f.active : tabsOf(f)[0].id);
const things = () => [...S.docs.filter((d) => d.place === 'canvas'), ...S.postits, ...S.texts, ...(S.shapes || []), ...S.ideas, ...S.tasks];
const tabCount = (f, tid) => things().filter((o) => (o.ftab?.f === f.id && o.ftab.t === tid) || (o.pin?.host === f.id && o.pin.side === 'desc' && o.pin.tab === tid)).length;
// hidden behind another tab: itself, or the host it is pinned or docked to
function inOtherTab(o) {
  if (!o) return false;
  const t = o.ftab, f = t && S.frames.find((x) => x.id === t.f);
  if (f && tabsOf(f).length > 1 && t.t !== activeTab(f)) return true;
  if (o.pin?.side === 'desc') { const h = find(o.pin.host)?.o; if (h && o.pin.tab && o.pin.tab !== activeTab(h)) return true; return inOtherTab(h); }
  if (o.pin) return inOtherTab(find(o.pin.host)?.o);
  if (o.dock) return inOtherTab(docById(o.dock));
  return false;
}
// After a drop or a creation: what lies in a frame with tabs belongs to its open tab; what left it, to none.
function assignTabs() {
  for (const el of itemsEl.querySelectorAll('[data-k]')) {
    const o = find(el.dataset.id)?.o; if (!o || o.pin || o.dock) continue;
    const [w, h] = sizeOf(el, o), cx = o.x + w / 2, cy = o.y + h / 2;
    const f = S.frames.filter((g) => cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h).sort((p, q) => p.w * p.h - q.w * q.h)[0];
    if (f && tabsOf(f).length > 1) o.ftab = { f: f.id, t: activeTab(f) }; else delete o.ftab;
  }
}
// What is hidden in a frame's other tabs moves with the frame.
function shiftHidden(f, dx, dy) { for (const o of things()) if (o.ftab?.f === f.id && inOtherTab(o)) { o.x = Math.round(o.x + dx); o.y = Math.round(o.y + dy); } }
// The ones of its kind that live where it lives: the same edge of the same host (and tab), the same page's column, or
// loose ones of the same kind in the same place (the same frame tab, or the open plane).
function siblingsOf(it) {
  const pool = (it.kind === 'idea' ? S.ideas : S.tasks).filter((x) => x.onCanvas && !x.riding && !stackBase(x) && !inOtherTab(x));
  if (it.pin) return pool.filter((x) => x.pin?.host === it.pin.host && x.pin.side === it.pin.side && (x.pin.tab || '') === (it.pin.tab || ''));
  if (it.dock) return pool.filter((x) => x.dock === it.dock);
  return pool.filter((x) => !x.pin && !x.dock && (x.ftab?.f || '') === (it.ftab?.f || ''));
}
// A stack: circles dropped onto another circle join it (stackOf = the base's id). Only the base is drawn, with a number.
const stackBase = (it) => (it.stackOf && [...S.ideas, ...S.tasks].find((x) => x.id === it.stackOf)) || null;
const stackMembers = (base) => [...S.ideas, ...S.tasks].filter((x) => x.stackOf === base.id);
function itemHTML(it) {
  const k = it.kind === 'idea' ? 'i' : 't', uses = docsUsing(it).length;
  if (!it.dock) {                                   // loose: a small circle with its icon; a click reads it
    const sn = stackMembers(it).length;
    return `<div class="item circle ${it.kind}${it.done ? ' done' : ''}${sn ? ' stacked' : ''}${sel.has(it.id) ? ' sel' : ''}"${sn ? ` data-stack="${sn + 1}"` : ''} data-id="${it.id}" data-k="${k}" style="left:${it.x}px;top:${it.y}px;z-index:${it.z || 0};--s:${it.s || 1}">
      <span class="cico">${it.kind === 'idea' ? '💡' : it.done ? '✔' : ''}</span>${k === 't' && !sn ? `<span class="cin"><button data-c="done" title="${it.done ? 'Reabrir' : 'Hecha'}">${it.done ? '↺' : '✓'}</button><i></i><button data-c="del" title="${uses ? 'Quitar del plano' : 'Borrar'}">×</button></span>` : ''}
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
  itemsEl.innerHTML = S.docs.map((d, i) => (d.place === 'canvas' && !inOtherTab(d) ? docHTML(d, i + 1) : '')).join('')
    + S.postits.filter((p) => !p.riding && !inOtherTab(p)).map(postitHTML).join('')
    + (S.shapes || []).filter((g) => !inOtherTab(g)).map(shapeHTML).join('')
    + (S.texts || []).filter((x) => !x.riding && !inOtherTab(x)).map(textHTML).join('')
    + [...S.ideas, ...S.tasks].filter((it) => it.onCanvas && !it.riding && !hiddenInFold(it) && !inOtherTab(it) && !stackBase(it)).map(itemHTML).join('')
    + groupsHTML();
  $('#empty').classList.toggle('on', !itemsEl.children.length && !S.frames.length);
  S.signs = (S.signs || []).filter((g) => find(g.host));
  addSignsToHosts();
  layoutDocks();
  layoutPins();
  flip(world, before, (el) => S.view.z * (find(el.dataset.id)?.o.s || 1));
  firstRender = false;
  for (const el of itemsEl.querySelectorAll('.doc.near')) el.classList.remove('near');   // re-read after a redraw
  if (inline && !inline.el.isConnected) { const rid = inline.id; try { inline.ed.view.destroy(); } catch {} inline = null; const ne = elOf(rid); if (ne) { ne.classList.add('near'); mountInline(ne, false); } else document.body.classList.remove('reading'); }
  nearDocs();
  assignTabs();                                    // what is in a frame with tabs belongs to its open tab
  fitTabs();
  for (const f of S.frames) {
    const el = elOf(f.id); if (!el) continue;
    const holds = [...itemsEl.querySelectorAll('[data-k]')].some((x) => { const o = find(x.dataset.id)?.o; if (!o) return false; const [w, h] = sizeOf(x, o); const cx = o.x + w / 2, cy = o.y + h / 2; return cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h; })
      || S.frames.some((g) => g !== f && g.x >= f.x && g.y >= f.y && g.x + g.w <= f.x + f.w && g.y + g.h <= f.y + f.h);
    el.classList.toggle('void', !holds);
  }
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
// The eight anchors of a document, post-it or frame: corners tl tr bl br and side middles t r b l, each ON the border
// line (it runs through the circle's centre). Several circles on one anchor spread along the side.
const ANCHORS = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
const hostRect = (f, hel) => f.k === 'f' ? [f.o.w, f.o.h] : sizeOf(hel, f.o);
const DESC_S = 1;                                               // circles in a description strip: the same size as all
function descBox(f) { const d = elOf(f.o.id)?.querySelector('.fdesc'); return d ? d.offsetHeight : 0; }
function anchorAt(f, hel, side, i, n, sc) {
  if (f.k === 'f' && side === 'desc') { const h = Math.max(48, descBox(f)); return [f.o.x + f.o.w - 28 - i * 44, f.o.y + h / 2]; }
  if (f.k === 'f') return [f.o.x, f.o.y + descBox(f) + 34 + i * 46];   // a frame: its left side, from under its description down
  const h = f.o, [w, hh] = hostRect(f, hel), gap = 44 * sc, off = (i - (n - 1) / 2) * gap;
  const col = f.k === 'd' ? docked(h).filter((x) => !hiddenInFold(x)).reduce((a, x) => { const xe = elOf(x.id); return a + (xe ? xe.offsetHeight * (x.s || 1) + 6 * sc : 0); }, 0) + (itemsEl.querySelector('.dgroup[data-doc="' + h.id + '"]') ? 46 * sc : 0) : 0;
  const L = h.x, R = h.x + w, T = h.y, B = h.y + hh + (col ? col + 8 * sc : 0), CX = h.x + w / 2, CY = h.y + hh / 2;
  switch (side) {
    case 'tl': return [L + i * gap, T]; case 'tr': return [R - i * gap, T];
    case 'bl': return [L + i * gap, B]; case 'br': return [R - i * gap, B];
    case 't': case 'tab': return [CX + off, T]; case 'b': return [CX + off, B];
    case 'l': case 'left': return [L, CY + off]; default: return [R, CY + off];
  }
}
function layoutPins() {
  for (const t of [...S.ideas, ...S.tasks]) { if (t.pin && !t.riding && !find(t.pin.host)) delete t.pin; if (t.pin && find(t.pin.host)?.k === 'f' && t.pin.side !== 'desc') t.pin.side = 'l'; }
  const hosts = new Set([...S.ideas, ...S.tasks].filter((t) => t.pin && t.onCanvas && !t.riding).map((t) => t.pin.host));
  for (const id of hosts) {
    const f = find(id), hel = elOf(id); if (!f || !hel) continue;
    const h = f.o;
    for (const side of new Set(pinnedTo(id).map((t) => t.pin.side))) {
      const sc = side === 'desc' ? DESC_S : f.k === 'f' ? 1 : h.s || 1;
      const list = pinnedTo(id).filter((t) => t.pin.side === side && !(side === 'desc' && t.pin.tab !== activeTab(h))).sort((a, b) => (a.pin.at ?? 0) - (b.pin.at ?? 0));
      list.forEach((t, i) => {
        t.s = sc; const r = 19 * sc;
        const [cx, cy] = anchorAt(f, hel, side, i, list.length, sc);
        t.x = Math.round(cx - r); t.y = Math.round(cy - r);
        t.z = (h.z || 0) + 1;                       // an edge thing has its host's height, just above it
        const el = elOf(t.id); if (!el) return;
        Object.assign(el.style, { left: t.x + 'px', top: t.y + 'px', zIndex: t.z }); el.style.setProperty('--s', t.s);
      });
    }
  }
}
// What a circle pins to, from the circle itself (its rectangle, or one around the pointer for a new one): as soon as it
// reaches a document, post-it or frame (documents first), it goes to the anchor of the side it comes to; inside, to the
// nearest anchor. Under a document it docks instead (see dockAt).
const EDGE_NEAR = 22;
function probeOf(it, e) {
  const me = it && elOf(it.id), z = S.view.z;
  if (me) { const r = me.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }
  return { l: e.clientX - 19 * z, t: e.clientY - 19 * z, r: e.clientX + 19 * z, b: e.clientY + 19 * z };
}
function pinTarget(it, e) {
  const me = it && elOf(it.id), p = probeOf(it, e), cx = (p.l + p.r) / 2, cy = (p.t + p.b) / 2, rad = (p.r - p.l) / 2, near = EDGE_NEAR + rad;
  const touches = (r) => cx > r.left - near && cx < r.right + near && cy > r.top - near && cy < r.bottom + near;
  const cands = [...itemsEl.querySelectorAll('[data-k="d"], [data-k="p"]')].filter((el) => el !== me).reverse()
    .concat([...framesEl.querySelectorAll('.frame')].reverse());
  const host = cands.find((el) => touches(el.getBoundingClientRect()));
  if (!host) return null;
  const r = host.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (cx - r.left) / r.width)), fy = Math.min(1, Math.max(0, (cy - r.top) / r.height));
  const dl = Math.abs(cx - r.left), dr = Math.abs(cx - r.right), dt = Math.abs(cy - r.top), db = Math.abs(cy - r.bottom);
  const dmin = Math.min(dl, dr, dt, db);
  const edge = dmin === dl ? 'l' : dmin === dr ? 'r' : dmin === dt ? 't' : 'b';
  const corner = (k) => k < 0.18 ? 0 : k > 0.82 ? 1 : null;
  let side;
  if (edge === 'l' || edge === 'r') { const c = corner(fy); side = c === null ? edge : (c ? 'b' : 't') + edge; }
  else { const c = corner(fx); side = c === null ? edge : edge + (c ? 'r' : 'l'); }
  if (host.dataset.k === 'f') {                                         // a frame: its description strip, or its left side
    const fo = find(host.dataset.id).o, dh = Math.max(30, descBox({ o: fo })) * S.view.z;
    if (cy > r.top && cy < r.top + dh + 6 && cx > r.left + r.width * 0.35) return { host: fo.id, side: 'desc', tab: activeTab(fo), at: -cx };
    side = 'l';
  }
  return { host: host.dataset.id, side, at: side === 't' || side === 'b' ? cx : cy };
}
// The dotted slot: where a circle being dragged would land if dropped now (a dock slot under a page, or an anchor).
function pinHint(it, e) {
  const hint = $('#pinhint');
  const onto = it && document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest?.('.item.circle')).find((x) => x && x.dataset.id !== it.id);
  hint.classList.toggle('stack', !!onto);
  if (onto) {
    const r = onto.getBoundingClientRect(), p = 10;
    Object.assign(hint.style, { left: r.left - p + 'px', top: r.top - p + 'px', width: r.width + p * 2 + 'px', height: r.height + p * 2 + 'px' });
    hint.classList.remove('bar'); hint.classList.add('on'); return;
  }
  const w = toWorld(e.clientX, e.clientY), dk = it && dockAt(w.x, w.y, it);
  if (dk) {
    const de = elOf(dk.d.id), [dw, dh] = sizeOf(de, dk.d), sc = dk.d.s || 1, z = S.view.z;
    let y = dk.d.y + dh + 8 * sc;
    dk.others.slice(0, dk.at).forEach((x) => { const xe = elOf(x.id); y += (xe ? xe.offsetHeight * (x.s || 1) : 36) + 6 * sc; });
    Object.assign(hint.style, { left: S.view.x + dk.d.x * z + 'px', top: S.view.y + y * z + 'px', width: dw * z + 'px', height: 36 * sc * z + 'px' });
    hint.classList.add('on', 'bar'); return;
  }
  hint.classList.remove('bar');
  const pt = it && pinTarget(it, e);
  if (!pt) { hint.classList.remove('on'); return; }
  const f = find(pt.host), hel = elOf(pt.host); if (!f || !hel) return hint.classList.remove('on');
  const z = S.view.z, sc = pt.side === 'desc' ? DESC_S : f.k === 'f' ? 1 : f.o.s || 1;
  const n = pinnedTo(f.o.id).filter((x) => x !== it && x.pin.side === pt.side && (pt.side !== 'desc' || x.pin.tab === pt.tab)).length;
  const [wx, wy] = anchorAt(f, hel, pt.side, n, n + 1, sc);
  const d = 38 * sc * z;
  Object.assign(hint.style, { left: S.view.x + wx * z - d / 2 + 'px', top: S.view.y + wy * z - d / 2 + 'px', width: d + 'px', height: d + 'px' });
  hint.classList.add('on');
}
// Where a dropped task docks: under a document, if it lands in the strip below it (or among the tasks already there).
function dockTarget(t) {
  const el = elOf(t.id); if (!el) return null;
  const [w, h] = sizeOf(el, t);
  return dockAt(t.x + w / 2, t.y + h / 2, t);
}
function dockAt(cx, cy, t) {
  for (const d of S.docs) {
    if (d.place !== 'canvas' || inOtherTab(d)) continue;
    const de = elOf(d.id); if (!de) continue;
    const [dw, dh] = sizeOf(de, d);
    const stack = docked(d).filter((x) => x !== t).reduce((acc, x) => { const xe = elOf(x.id); return acc + (xe ? xe.offsetHeight * (x.s || 1) + 6 : 0); }, 0);
    if (cx > d.x && cx < d.x + dw && cy > d.y + dh + 22 * (d.s || 1) && cy < d.y + dh + stack + 130) {   // under the page: a column
      const others = docked(d).filter((x) => x !== t);
      const at = others.filter((x) => x.y + 10 < cy - 18).length;           // its place in the stack, by where it was dropped
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
function changed() { save(); render(); assignTabs(); ed?.refresh(); }
function paintSel() { for (const el of world.querySelectorAll('[data-k]')) el.classList.toggle('sel', sel.has(el.dataset.id)); paintSelBar(); }

// ---- selection bar: copy all of a group at once -------------------------------------------------------------------
function paintSelBar() {
  const bar = $('#selbar'), n = [...sel].filter((id) => find(id)).length;
  bar.classList.toggle('on', n >= 2);
  if (n >= 2) $('#selbar-n').textContent = `${n} seleccionados`;
  bar.classList.toggle('no-arrange', !arrangeKind());
}
function groupText() {
  const line = ({ k, o }) => k === 'd' ? (o.book ? `# ${o.name}\n\n${bookText(o)}` : titleOf(o.text) ? readable(o.text) : `# ${o.name}\n${readable(o.text)}`)
    : k === 'p' || k === 'x' ? o.text : k === 'i' ? `💡 ${o.text}` : k === 't' ? `- [${o.done ? 'x' : ' '}] ${o.text}` : '';
  const order = (p, q) => (p.o.y - q.o.y) || (p.o.x - q.o.x);
  const done = new Set(), parts = [];
  const withRiders = (o) => [o, ...(find(o.id)?.k === 'd' ? docked(o) : []), ...pinnedTo(o.id).filter((t) => t.pin.side !== 'desc')];
  const frames = [...sel].map(find).filter((f) => f?.k === 'f').map((f) => f.o).sort((p, q) => (p.y - q.y) || (p.x - q.x));
  for (const f of frames) {
    done.add(f.id);
    const head = [f.title ? `# ${f.title}` : '', f.desc || ''].filter(Boolean).join('\n');
    const tabs = tabsOf(f), multi = tabs.length > 1, body = [];
    for (const t of tabs) {
      const strip = pinnedTo(f.id).filter((x) => x.pin.side === 'desc' && (x.pin.tab || tabs[0].id) === t.id);
      const inTab = multi ? things().filter((o) => o.ftab?.f === f.id && o.ftab.t === t.id)
        : [...sel].filter((id) => id !== f.id).map(find).filter(Boolean).map((x) => x.o);
      const items = [...strip, ...inTab.flatMap(withRiders)].filter((o) => !done.has(o.id));
      for (const o of items) done.add(o.id);
      const txt = items.map((o) => find(o.id)).filter(Boolean).sort(order).map(line).filter((p) => p.trim()).join('\n\n');
      if (multi) body.push(`## ${t.title || 'Pestaña'}` + (txt ? '\n\n' + txt : ''));
      else if (txt) body.push(txt);
    }
    parts.push([head, ...body].filter(Boolean).join('\n\n'));
  }
  const rest = [...sel].filter((id) => !done.has(id)).map(find).filter(Boolean).sort(order);
  for (const x of rest) parts.push(line(x));
  return parts.filter((p) => p.trim()).join('\n\n');
}
function moveWith(o, dx, dy) {
  if (!dx && !dy) return;
  const keep = new Set(sel); sel.clear(); sel.add(o.id);
  const group = collectMoving(false); sel.clear(); for (const id of keep) sel.add(id);
  for (const m of group) { m.o.x = Math.round(m.o.x + dx); m.o.y = Math.round(m.o.y + dy); }
}
// The kind the group bar arranges: the most common among the selected (documents, post-its, texts), if two or more.
function arrangeKind() {
  const n = {}; for (const id of sel) { const f = find(id); if (f && !['f', 'i', 't'].includes(f.k) && !f.o.pin && !f.o.dock) n[f.k] = (n[f.k] || 0) + 1; }
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}
function arrange(how) {
  const pool = [...sel].map(find).filter((x) => x && !['f', 'i', 't'].includes(x.k) && !x.o.pin && !x.o.dock);
  const kind = arrangeKind(); if (!kind) return;
  const list = pool.filter((x) => x.k === kind).map((x) => {
    const el = elOf(x.o.id), [w, h] = el ? sizeOf(el, x.o) : [0, 0]; return { o: x.o, w, h };
  });
  // only the top-level ones (not those inside another selected thing)
  const { ownerOf } = owners(), ids = new Set(list.map((x) => x.o.id));
  const top = list.filter((x) => { let own = ownerOf.get(x.o.id); while (own) { if (ids.has(own)) return false; own = ownerOf.get(own); } return true; });
  if (top.length < 2) return toast('Selecciona al menos dos cosas sueltas');
  snap();
  if (how === 'left') { const x0 = Math.min(...top.map((t) => t.o.x)); for (const t of top) moveWith(t.o, x0 - t.o.x, 0); }
  if (how === 'top') { const y0 = Math.min(...top.map((t) => t.o.y)); for (const t of top) moveWith(t.o, 0, y0 - t.o.y); }
  if (how === 'h' || how === 'v') {
    const X = how === 'h' ? 'x' : 'y', W = how === 'h' ? 'w' : 'h';
    const sorted = [...top].sort((a, b) => a.o[X] - b.o[X]);
    const span = sorted.at(-1).o[X] + sorted.at(-1)[W] - sorted[0].o[X], used = sorted.reduce((a, t) => a + t[W], 0);
    const gap = Math.max(16, (span - used) / (sorted.length - 1));
    let at = sorted[0].o[X];
    for (const t of sorted) { moveWith(t.o, X === 'x' ? at - t.o.x : 0, X === 'y' ? at - t.o.y : 0); at += t[W] + gap; }
  }
  enforceStack(); save(); render(); paintSel();
}
for (const [id, how] of [['sb-left', 'left'], ['sb-top', 'top'], ['sb-h', 'h'], ['sb-v', 'v']]) $('#' + id).onclick = () => arrange(how);
$('#selbar-copy').onclick = async () => { await navigator.clipboard.writeText(groupText()); toast('Copiado todo el grupo'); };
$('#selbar-del').onclick = () => removeIds([...sel]);

// ---- creating ------------------------------------------------------------------------------------------------------
function nextBookName() { const names = new Set(S.docs.map((d) => d.name)); let i = 1; while (names.has(`Libreta ${i}`)) i++; return `Libreta ${i}`; }
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
  d.name = name; if (!d.book) d.text = withTitle(d.text, name); d.updated = Date.now();
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
  } else if (kind === 'book') {
    const d = newDoc({ name: nextBookName(), place: inStash ? 'stash' : 'canvas', x: w.x - DOC_W / 2, y: w.y - 30 });
    const p = { id: uid(), title: 'Página 1', text: '' };
    Object.assign(d, { book: true, text: '', pages: [p], page: p.id });
    if (inStash) putInTray([d], inStash);
    log('crear', `Libreta «${d.name}»`, { ref: d.id });
    sel.clear(); save(); render();
    if (w.free || inStash) { const el = inStash ? stash.querySelector(`.chip[data-id="${d.id}"] b`) : elOf(d.id)?.querySelector('.dtitle'); if (el) editInline(el, (v) => { if (v) { renameDoc(d, v); render(); } }); }
    else openEditor(d.id);
  } else if (kind === 'shape') {
    const g = { id: uid(), x: Math.round(w.x - 80), y: Math.round(w.y - 55), w: 160, h: 110, z: topZ(), form: 'round', color: SHAPE_COLORS[(S.shapes.length) % 8] };
    S.shapes.push(g); sel.clear(); sel.add(g.id); log('crear', 'Forma', { ref: g.id }); save(); render();
    elOf(g.id)?.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' });
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
    if (w.dock) { const list = w.dock.others; list.splice(w.dock.at, 0, it); list.forEach((x, i) => { x.dock = w.dock.d.id; x.dockAt = i; }); }
    else if (w.pin) { it.pin = { ...w.pin, at: w.pin.side === 'tab' ? 99 : w.pin.at }; }
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
const stackable = () => [...S.docs.filter((d) => d.place === 'canvas'), ...S.postits, ...S.texts, ...S.ideas, ...S.tasks];
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
    if (o.pin && find(o.pin.host)?.k === 'f') continue;
    if (o.x + w > R.x && o.x < R.x + R.w && o.y + h > R.y && o.y < R.y + R.h) boxes.push([o.x, o.y, w, h]);
  }
  if (!boxes.length) return false;
  const pad = FIT_PAD;
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2])), y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  f.x = Math.round(x0 - pad); f.y = Math.round(y0 - pad); f.w = Math.round(x1 - x0 + pad * 2); f.h = Math.round(y1 - y0 + pad * 2);
  return true;
}
// ---- deleting a frame or a tab: it warns, and says how much goes ----
function askChoice(anchor, title, note, options) {
  const pop = $('#pick'), r = anchor.getBoundingClientRect();
  pop.innerHTML = `<div class="pk-h">${title}</div>${note ? `<p class="pk-note">${note}</p>` : ''}<div class="pk-opts">${options.map((o, i) => `<button class="pk-opt${o.danger ? ' danger' : ''}" data-i="${i}">${o.label}</button>`).join('')}<button class="pk-opt cancel">Cancelar</button></div>`;
  Object.assign(pop.style, { left: Math.min(innerWidth - 330, Math.max(8, r.left - 20)) + 'px', top: Math.min(innerHeight - 260, r.bottom + 8) + 'px' });
  pop.classList.add('on');
  pop.onclick = (e) => { const b = e.target.closest('.pk-opt'); if (!b) return; pop.classList.remove('on'); if (b.dataset.i != null) options[+b.dataset.i].run(); };
}
// what a frame holds, in every tab: things inside, their edge and docked circles, nested frames; and its own circles
function frameHoldings(f) {
  const keep = new Set(sel); sel.clear(); sel.add(f.id);
  const ids = new Set(collectMoving(false).map((m) => m.o.id)); sel.clear(); for (const id of keep) sel.add(id);
  for (const o of things()) if (o.ftab?.f === f.id) { ids.add(o.id); for (const t of [...pinnedTo(o.id), ...(S.docs.includes(o) ? docked(o) : [])]) ids.add(t.id); }
  for (const t of pinnedTo(f.id)) ids.add(t.id);
  for (const it of [...S.ideas, ...S.tasks]) if (it.stackOf && ids.has(it.stackOf)) ids.add(it.id);
  ids.delete(f.id);
  return [...ids].filter((id) => find(id));
}
function tabHoldings(f, tid) {
  const ids = new Set();
  for (const o of things()) if (o.ftab?.f === f.id && o.ftab.t === tid) { ids.add(o.id); for (const t of [...pinnedTo(o.id), ...(S.docs.includes(o) ? docked(o) : [])]) ids.add(t.id); }
  for (const t of pinnedTo(f.id)) if (t.pin.side === 'desc' && t.pin.tab === tid) ids.add(t.id);
  for (const g of S.frames) if (g !== f && ids.size && g.ftab?.f === f.id && g.ftab.t === tid) ids.add(g.id);
  for (const it of [...S.ideas, ...S.tasks]) if (it.stackOf && ids.has(it.stackOf)) ids.add(it.id);
  return [...ids].filter((id) => find(id));
}
const isCircle = (id) => { const k = find(id)?.k; return k === 'i' || k === 't'; };
const countText = (ids) => { const n = ids.filter((id) => !isCircle(id)).length, c = ids.length - n; return [n ? `${n} ${n === 1 ? 'cosa' : 'cosas'}` : '', c ? `${c} ${c === 1 ? 'idea o tarea' : 'ideas y tareas'}` : ''].filter(Boolean).join(' y '); };
function askFrameDelete(f, anchor) {
  const all = frameHoldings(f), circles = all.filter(isCircle), name = esc(f.title || 'sin título');
  if (!all.length) return removeIds([f.id]);
  askChoice(anchor, `¿Borrar el marco «${name}»?`, `Tiene ${countText(all)}, en todas sus pestañas.`, [
    { label: 'Borrar el marco y todo lo que tiene', danger: true, run: () => removeIds([f.id, ...all]) },
    ...(circles.length ? [{ label: `Borrar solo sus ideas y tareas (${circles.length})`, run: () => removeIds(circles) }] : []),
    { label: 'Borrar solo el marco: lo de dentro se queda', run: () => removeIds([f.id]) },
  ]);
}
function askTabDelete(f, tid, anchor) {
  const t = tabsOf(f).find((x) => x.id === tid), all = tabHoldings(f, tid), circles = all.filter(isCircle);
  const dropTab = () => {
    snap();
    if (t === tabsOf(f)[0]) f.title = tabsOf(f)[1].title;            // the next tab now names the frame
    f.tabs = tabsOf(f).filter((x) => x.id !== tid); f.active = tabsOf(f)[0].id;
    for (const o of things()) if (o.ftab?.f === f.id && o.ftab.t === tid) delete o.ftab;
  };
  if (!all.length) { dropTab(); save(); render(); return toast('Pestaña borrada', [['Deshacer', doUndo]]); }
  askChoice(anchor, `¿Borrar la pestaña «${esc(t.title || 'sin título')}»?`, `Tiene ${countText(all)}. Las otras pestañas no se tocan.`, [
    { label: 'Borrar la pestaña y todo lo suyo', danger: true, run: () => { removeIds(all); dropTab(); save(); render(); } },
    ...(circles.length ? [{ label: `Borrar solo sus ideas y tareas (${circles.length})`, run: () => removeIds(circles) }] : []),
  ]);
}
// Frames holding f (bigger, wholly around it), smallest first.
const holdersOf = (f) => S.frames.filter((g) => g !== f && inside(f, g)).sort((p, q) => p.w * p.h - q.w * q.h);
// Grow g (never shrink) so box fits in it with a margin; box includes the tab above a frame.
function growToHold(g, box, m = 24) {
  const x0 = Math.min(g.x, box.x0 - m), y0 = Math.min(g.y, box.y0 - m), x1 = Math.max(g.x + g.w, box.x1 + m), y1 = Math.max(g.y + g.h, box.y1 + m);
  Object.assign(g, { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
}
function growChain(f, chain) {
  let box = { x0: f.x, y0: f.y - TAB_H, x1: f.x + f.w, y1: f.y + f.h };
  for (const g of chain) { growToHold(g, box); box = { x0: g.x, y0: g.y - TAB_H, x1: g.x + g.w, y1: g.y + g.h }; }
}
// A tab label wider than its frame: the frame widens to show it whole, and so do the frames holding it (then they make room).
function fitTabs() {
  const grown = new Map();                                   // frame → its width before
  for (const f of S.frames) {
    const t = elOf(f.id)?.querySelector('.ftabs'); if (!t) continue;
    const need = Math.ceil(t.scrollWidth + 16 + 24);
    if (need > f.w) { grown.set(f, f.w); f.w = need; }
  }
  if (!grown.size) return;
  for (const [f, w0] of [...grown]) {
    const chain = S.frames.filter((g) => g !== f && f.x >= g.x && f.y >= g.y && f.x + w0 <= g.x + g.w && f.y + f.h <= g.y + g.h && w0 * f.h < g.w * g.h).sort((p, q) => p.w * p.h - q.w * q.h);
    for (const g of chain) if (!grown.has(g)) grown.set(g, g.w);
    growChain(f, chain);
  }
  pushApart([...grown.keys()]);
  for (const f of S.frames) paintFrame(f);
  layoutPins(); save();
}
// A frame inside a frame: first, which of the things in it go inside the new one (a menu with ticks).
function frameInside(outer) {
  const holds = (o, el) => { const [w, h] = el ? sizeOf(el, o) : [0, 0]; const cx = o.x + w / 2, cy = o.y + h / 2; return cx > outer.x && cx < outer.x + outer.w && cy > outer.y && cy < outer.y + outer.h; };
  const cands = [];
  for (const el of itemsEl.querySelectorAll('[data-k="d"], [data-k="p"], [data-k="x"]')) { const f = find(el.dataset.id); if (f && holds(f.o, el)) cands.push(f); }
  for (const g of S.frames) if (g !== outer && g.x >= outer.x && g.y >= outer.y && g.x + g.w <= outer.x + outer.w && g.y + g.h <= outer.y + outer.h) cands.push({ k: 'f', o: g });
  const pop = $('#pick'), tab = elOf(outer.id)?.querySelector('.ftabs')?.getBoundingClientRect() || { left: 200, bottom: 200 };
  const icon = { d: '📄', p: '🗒️', x: 'Aa', f: '⬚' };
  const label = (c) => c.k === 'd' ? c.o.name : c.k === 'f' ? (c.o.title || 'Marco sin título') : (c.o.text || '').split('\n')[0] || (c.k === 'p' ? 'Post-it' : 'Texto');
  pop.innerHTML = `<div class="pk-h">¿Qué va dentro del marco nuevo?</div>
    ${cands.length ? cands.map((c, i) => `<label class="pk-r"><input type="checkbox" data-i="${i}"><span class="pk-i">${icon[c.k]}</span><span>${esc(label(c))}</span></label>`).join('')
      : '<p class="pk-none">Este marco está vacío: el nuevo saldrá vacío.</p>'}
    <div class="pk-b"><button class="pk-cancel">Cancelar</button><button class="pk-ok">Crear marco</button></div>`;
  Object.assign(pop.style, { left: Math.min(innerWidth - 330, Math.max(8, tab.left)) + 'px', top: Math.min(innerHeight - 340, tab.bottom + 8) + 'px' });
  pop.classList.add('on');
  pop.onclick = (e) => {
    if (e.target.closest('.pk-cancel')) return pop.classList.remove('on');
    if (!e.target.closest('.pk-ok')) return;
    const chosen = [...pop.querySelectorAll('input:checked')].map((x) => cands[+x.dataset.i]);
    pop.classList.remove('on');
    snap();
    const f = { id: uid(), title: '', color: PASTEL[(PASTEL.indexOf(outer.color) + 2) % PASTEL.length] };
    if (chosen.length) {                              // it wraps what was chosen, with the usual margin
      const boxes = chosen.map((c) => { if (c.k === 'f') return [c.o.x, c.o.y - 34, c.o.w, c.o.h + 34]; const el = elOf(c.o.id), [w, h] = sizeOf(el, c.o); return [c.o.x, c.o.y, w, h]; });
      const x0 = Math.min(...boxes.map((q) => q[0])), y0 = Math.min(...boxes.map((q) => q[1])), x1 = Math.max(...boxes.map((q) => q[0] + q[2])), y1 = Math.max(...boxes.map((q) => q[1] + q[3]));
      Object.assign(f, { x: Math.round(x0 - FIT_PAD), y: Math.round(y0 - FIT_PAD), w: Math.round(x1 - x0 + FIT_PAD * 2), h: Math.round(y1 - y0 + FIT_PAD * 2) });
    } else Object.assign(f, { x: outer.x + 28, y: outer.y + 48, w: Math.max(180, Math.round(outer.w * 0.5)), h: Math.max(120, Math.round(outer.h * 0.45)) });
    // nested: the outer frame grows (never shrinks) to hold the new one with its tab and margin
    const m = 24, nx0 = Math.min(outer.x, f.x - m), ny0 = Math.min(outer.y, f.y - 34 - m), nx1 = Math.max(outer.x + outer.w, f.x + f.w + m), ny1 = Math.max(outer.y + outer.h, f.y + f.h + m);
    Object.assign(outer, { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 });
    S.frames.push(f);
    pushApart([outer]);
    sel.clear(); sel.add(f.id); save(); render();
    editInline(elOf(f.id).querySelector('.ftitle'), (v) => { f.title = v || ''; save(); render(); }, true);
  };
}
addEventListener('pointerdown', (e) => { if (!e.target.closest('#pick, .f-add')) $('#pick')?.classList.remove('on'); }, true);
const RIBBON_RED = '#d9534f';
const RIBBON_COLORS = [RIBBON_RED, '#e8973a', '#e5c33f', '#5cae6b', '#4a90d9', '#8e6bd1', '#d96aa6', '#6b6470'];
function dropSign(e) {
  const sp = signSpot(e);
  if (!sp) return toast('Suéltalo junto al borde de un documento, post-it, idea, tarea o marco');
  snap();
  const g = { id: uid(), host: sp.hostEl.dataset.id, edge: sp.edge, t: sp.t, text: '', color: RIBBON_RED };
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
  for (const g of (S.shapes || []).filter((g) => set.has(g.id))) log('borrar', 'Forma', { restore: { k: 'g', o: g } });
  S.texts = (S.texts || []).filter((x) => !set.has(x.id));
  S.shapes = (S.shapes || []).filter((g) => !set.has(g.id));
  S.postits = S.postits.filter((p) => !set.has(p.id));
  for (const o of things()) if (o.ftab && set.has(o.ftab.f)) delete o.ftab;
  S.frames = S.frames.filter((f) => !set.has(f.id));
  for (const it of [...S.ideas, ...S.tasks].filter((x) => set.has(x.id) && !x.stackOf)) {
    const rest = stackMembers(it).filter((x) => !set.has(x.id));
    if (rest.length) { const nb = rest[0]; delete nb.stackOf; Object.assign(nb, { x: it.x, y: it.y, pin: it.pin, dock: it.dock, dockAt: it.dockAt, z: it.z }); for (const x of rest.slice(1)) x.stackOf = nb.id; }
  }
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
  snap();
  if (k === 'd') { S.docs.push({ ...o }); }
  else if (k === 'p') S.postits.push({ ...o });
  else if (k === 'g') S.shapes.push({ ...o });
  else if (k === 'f') S.frames.push({ ...o });
  else { if (getItem(k, o.n)) return toast('Ya está'); listOf(k).push({ ...o, onCanvas: true }); }
  log('restaurar', h.msg, { ref: o.id }); h.restored = true; changed(); toast('Restaurado');
}

// ---- actions on the plane ------------------------------------------------------------------------------------------
async function docAction(a, d) {
  if (a === 'read') { const el = elOf(d.id); if (el) { mountInline(el); $('#editpill').dataset.id = d.id; $('#editpill b').textContent = d.name; $('#editpill').classList.add('on'); } return; }
  if (a === 'edit') return openEditor(d.id);
  if (a === 'copy') { await navigator.clipboard.writeText(d.book ? `# ${d.name}\n\n${bookText(d)}` : readable(d.text)); return toast(`Copiado «${d.name}»`); }
  let clip;
  try { clip = (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'); } catch { return toast('El navegador no deja leer el portapapeles'); }
  if (!clip) return toast('El portapapeles está vacío');
  snap();
  const before = d.text;
  d.text = a === 'add' ? (d.text ? d.text.replace(/\n*$/, '\n') + clip : clip) : clip;
  d.updated = Date.now(); d.name = titleOf(d.text) || d.name;
  log('editar', `${a === 'add' ? 'Añadiste a' : 'Reemplazaste'} «${d.name}»`, { docId: d.id, before });
  changed();
  toast(a === 'add' ? `Añadido al final de «${d.name}»` : `«${d.name}» reemplazado`, [['Deshacer', doUndo]]);
}

// ---- pointer: pan, box select, move, resize ------------------------------------------------------------------------
let act = null, space = false;
vp.addEventListener('contextmenu', (e) => e.preventDefault());
vp.addEventListener('dblclick', (e) => { if (inline && e.target.closest('.doc.live')) { e.stopPropagation(); $('#ep-edit').click(); } }, true);
vp.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.ied, .dhov button, .cin button, .shp-tools')) return;                       // selecting text in the page being read
  const ae = document.activeElement;
  if (ae?.isContentEditable && !e.target.closest('[contenteditable="true"]')) ae.blur();   // a click elsewhere = Enter
  if (e.target.closest('.dgroup')) return;
  const sgEl = e.target.closest('.sign');
  if (sgEl) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    act = { k: 'sign', g: S.signs.find((x) => x.id === sgEl.dataset.sign), el: sgEl, sx: e.clientX, sy: e.clientY, moved: false };
    return;
  }
  if (e.target.closest('.acts, .x, .pal, .chk, .f-add, .tab-add, .wtext, [contenteditable="true"]')) return;
  const it = e.target.closest('[data-k]');
  // pan: dragging the empty grid (the common thing), or middle/right button, or Space + drag; Ctrl + drag selects a group
  if (e.button === 1 || e.button === 2 || (e.button === 0 && (space || (!it && !e.ctrlKey && !e.metaKey)))) {
    e.preventDefault();
    act = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, empty: !it }; vp.classList.add('panning'); return;
  }
  if (e.button !== 0) return;
  document.activeElement?.blur?.();
  const rs = e.target.closest('.rs');
  const tb = e.target.closest('.ftext .tb, .shape .tb');
  if (tb && e.button === 0) {
    e.stopPropagation();
    const host = tb.closest('.ftext, .shape'), x = find(host.dataset.id).o;
    act = { k: 'tbox', x, el: host, d: tb.dataset.d, sx: e.clientX, sy: e.clientY, w0: host.offsetWidth, h0: host.offsetHeight }; return;
  }
  const prs = e.target.closest('.prs');
  if (prs) {
    const host = prs.closest('[data-k]'), p = find(host.dataset.id).o;
    if (p.pin || p.dock) return;                   // an edge thing has its host's size
    const keep = new Set(sel); sel.clear(); sel.add(p.id);
    const deps = collectMoving(e.altKey).filter((m) => m.o !== p).map((m) => ({ ...m, s0: m.o.s || 1, w0: m.o.w, h0: m.o.h }));
    sel.clear(); for (const id of keep) sel.add(id); sel.add(p.id); paintSel();
    // the other selected things (not frames, not on an edge) scale along, each from its own corner, with what they hold
    const co = [...sel].map(find).filter((x) => x && x.o !== p && x.k !== 'f' && !x.o.pin && !x.o.dock).map((x) => {
      const el = elOf(x.o.id); if (!el) return null;
      const keep2 = new Set(sel); sel.clear(); sel.add(x.o.id);
      const d2 = collectMoving(false).filter((m) => m.o !== x.o).map((m) => ({ ...m, s0: m.o.s || 1, w0: m.o.w, h0: m.o.h }));
      sel.clear(); for (const id of keep2) sel.add(id);
      return { o: x.o, el, s0: x.o.s || 1, deps: d2 };
    }).filter(Boolean);
    act = { k: 'scale', p, sx: e.clientX, s0: p.s || 1, w0: host.offsetWidth, el: host, deps, co }; return;
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
        if (m.o === f || m.o.pin?.host === f.id) continue;        // its own edge things are not contents
        const [w, h] = m.k === 'f' ? [m.o.w, m.o.h] : sizeOf(m.el, m.o), y0 = m.k === 'f' ? m.o.y - 34 : m.o.y;
        hold = hold ? { x0: Math.min(hold.x0, m.o.x), y0: Math.min(hold.y0, y0), x1: Math.max(hold.x1, m.o.x + w), y1: Math.max(hold.y1, m.o.y + h) }
          : { x0: m.o.x, y0, x1: m.o.x + w, y1: m.o.y + h };
      }
      sel.clear(); for (const id of keep) sel.add(id);
    }
    const chain = holdersOf(f), chainOrig = chain.map((g) => ({ g, x: g.x, y: g.y, w: g.w, h: g.h }));
    act = { k: 'resize', f, sx: e.clientX, sy: e.clientY, x: f.x, y: f.y, w: f.w, h: f.h, c: rs.dataset.c || 'br', el: rs.closest('.frame'), deps, hold, chain, chainOrig }; return;
  }
  if (it) {
    const id = it.dataset.id, toggle = e.shiftKey || e.ctrlKey || e.metaKey, selBefore = new Set(sel);
    if (toggle) { sel.has(id) ? sel.delete(id) : sel.add(id); }
    else if (!sel.has(id)) { sel.clear(); sel.add(id); }
    paintSel();
    act = { k: 'move', sx: e.clientX, sy: e.clientY, moving: collectMoving(e.altKey), moved: false, id, kind: it.dataset.k, toggle, selBefore, tabEl: e.target.closest('.ftab'), title: e.target.closest('.ftitle, .dtitle, .fdesc') };
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
const RANK = { f: 4, d: 3, p: 2, i: 2, t: 2, x: 2, g: 1 };   // a shape holds nothing: it is colour on the plane
function collectMoving(alone) {
  const out = new Map();
  const add = (id) => { const f = find(id), el = elOf(id); if (f && el && !out.has(id)) out.set(id, { k: f.k, o: f.o, el, x0: f.o.x, y0: f.o.y }); };
  for (const id of sel) add(id);
  if (alone) return [...out.values()];
  const inside = (p, q) => p !== q && p.w * p.h < q.w * q.h && p.x >= q.x && p.y >= q.y && p.x + p.w <= q.x + q.w && p.y + p.h <= q.y + q.h;   // strictly smaller: two equal frames never hold each other
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
  } else if (act.k === 'tbox') {
    if (!act.snapped) { act.snapped = true; snap(); document.body.classList.add('dragging'); }
    const s2 = (act.x.s || 1) * z;
    const shp = act.el.classList.contains('shape'), mw = shp ? 16 : 60, mh = shp ? 16 : 30;
    if (act.d.includes('w')) { act.x.w = Math.round(Math.max(mw, act.w0 + (e.clientX - act.sx) / s2)); act.el.style.width = act.x.w + 'px'; }
    if (act.d.includes('h')) { act.x.h = Math.round(Math.max(mh, act.h0 + (e.clientY - act.sy) / s2)); act.el.style.height = act.x.h + 'px'; }
  } else if (act.k === 'scale') {
    if (!act.snapped) { act.snapped = true; snap(); document.body.classList.add('dragging'); }
    const ns = Math.round(Math.min(4, Math.max(0.25, act.s0 * (1 + (e.clientX - act.sx) / z / (act.w0 * act.s0)))) * 100) / 100;
    const f = ns / act.s0, p = act.p;
    p.s = ns; act.el.style.setProperty('--s', ns);
    scaleDeps(act.deps, p.x, p.y, f, f);
    for (const c of act.co || []) { c.o.s = Math.round(c.s0 * f * 100) / 100; c.el.style.setProperty('--s', c.o.s); scaleDeps(c.deps, c.o.x, c.o.y, f, f); }
  } else if (act.k === 'resize') {
    if (!act.snapped) { act.snapped = true; snap(); document.body.classList.add('dragging'); }
    const dx = (e.clientX - act.sx) / z, dy = (e.clientY - act.sy) / z, c = act.c, f = act.f;
    let W = Math.max(160, Math.round(c.includes('l') ? act.w - dx : act.w + dx)), H = Math.max(100, Math.round(c.includes('t') ? act.h - dy : act.h + dy));
    if (act.hold) {                                // never smaller than what it holds
      const p = FIT_PAD, hd = act.hold, top = p + descBox({ o: act.f });
      W = Math.max(W, c.includes('l') ? act.x + act.w - (hd.x0 - p) : hd.x1 + p - act.x);
      H = Math.max(H, c.includes('t') ? act.y + act.h - (hd.y0 - top) : hd.y1 + p - act.y);
    }
    f.w = W; f.h = H; f.x = c.includes('l') ? act.x + act.w - W : act.x; f.y = c.includes('t') ? act.y + act.h - H : act.y;
    Object.assign(act.el.style, { left: f.x + 'px', top: f.y + 'px', width: W + 'px', height: H + 'px' });
    if (act.deps.length) scaleDeps(act.deps, c.includes('l') ? act.x + act.w : act.x, c.includes('t') ? act.y + act.h : act.y, W / act.w, H / act.h);
    if (act.chain?.length) { for (const o of act.chainOrig) Object.assign(o.g, { x: o.x, y: o.y, w: o.w, h: o.h }); growChain(f, act.chain); for (const g of act.chain) paintFrame(g); }
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
      // dropped onto another circle: it joins that circle's stack
      if ((m.k === 't' || m.k === 'i') && m.o.id === a.id) {
        const onto = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest?.('.item.circle')).find((x) => x && x.dataset.id !== m.o.id);
        if (onto) {
          const base = find(onto.dataset.id).o, root = stackBase(base) || base;
          for (const x of [m.o, ...stackMembers(m.o)]) { x.stackOf = root.id; delete x.pin; delete x.dock; }
          continue;
        }
      }
      // only the circle you grabbed is re-placed by where the pointer is; everything carried keeps its edge
      if ((m.k !== 't' && m.k !== 'i') || m.o.id !== a.id || (m.o.dock && movedDocs.has(m.o.dock))) continue;
      const wp = toWorld(e.clientX, e.clientY), tg = dockAt(wp.x, wp.y, m.o);
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
    }
    const movedF = a.moving.filter((m) => m.k === 'f').map((m) => m.o), movingSet = new Set(movedF), embedded = [];
    for (const f of movedF) {
      if (movedF.some((g) => g !== f && inside(f, g))) continue;            // it travels inside another moved frame
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const host = S.frames.filter((g) => !movingSet.has(g) && g.w * g.h > f.w * f.h && cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h)
        .sort((p, q) => p.w * p.h - q.w * q.h)[0];
      if (!host) continue;
      // it takes a free place in there: beside what the host already holds, never over it
      const others = [];
      for (const el of itemsEl.querySelectorAll('[data-k="d"], [data-k="p"], [data-k="x"], [data-k="g"]')) {
        const o = find(el.dataset.id)?.o; if (!o || a.moving.some((m) => m.o === o)) continue;
        const [w, h] = sizeOf(el, o), ox = o.x + w / 2, oy = o.y + h / 2;
        if (ox > host.x && ox < host.x + host.w && oy > host.y && oy < host.y + host.h) others.push({ x0: o.x, y0: o.y, x1: o.x + w, y1: o.y + h });
      }
      for (const g of S.frames) if (g !== host && g !== f && !movingSet.has(g) && inside(g, host)) others.push({ x0: g.x, y0: g.y - TAB_H, x1: g.x + g.w, y1: g.y + g.h });
      for (let k = 0; k < 12; k++) {
        const fb = { x0: f.x, y0: f.y - TAB_H, x1: f.x + f.w, y1: f.y + f.h };
        const hit = others.find((q) => q.x0 < fb.x1 + 12 && fb.x0 < q.x1 + 12 && q.y0 < fb.y1 + 12 && fb.y0 < q.y1 + 12);
        if (!hit) break;
        shiftFrame(f, hit.x1 + 24 - f.x, 0);
      }
      paintFrame(f, true);
      const chain = [host, ...holdersOf(host)];
      growChain(f, chain); embedded.push(...chain);
    }
    if (embedded.length) for (const g of embedded) paintFrame(g, true);
    for (const m of a.moving) if (m.k === 'f') shiftHidden(m.o, m.o.x - m.x0, m.o.y - m.y0);
    pushApart([...a.moving.filter((m) => m.k === 'f').map((m) => m.o), ...(a.fitOrig ? a.fitOrig.keys() : []), ...embedded]);
    enforceStack();
    assignTabs();
    save(); render();
  } else if (a.k === 'move' && a.kind === 'f' && !a.toggle && a.tabEl && !a.tabEl.classList.contains('on')) {
    const f = find(a.id).o; f.active = a.tabEl.dataset.tab; save(); renderItems(); paintSel();       // open that tab
  } else if (a.k === 'move' && a.title && !a.toggle) {
    const f = find(a.id).o;                              // one click on a frame's or a document's title edits it
    if (a.kind === 'd') editInline(a.title, (v) => { if (v) { renameDoc(f, v); render(); } });
    else if (a.title.classList.contains('fdesc')) editInline(a.title, (v) => { if (v !== null) { snap(); f.desc = v; save(); render(); } }, true);
    else {
      const tid = a.title.closest('.ftab')?.dataset.tab, t = tabsOf(f).find((x) => x.id === tid) || tabsOf(f)[0];
      editInline(a.title, (v) => { if (v !== null && v !== t.title) { snap(); t.title = v; if (t === tabsOf(f)[0]) f.title = v; save(); render(); } }, true);
    }
  } else if (a.k === 'move' && !a.toggle && (a.kind === 'i' || a.kind === 't')) {
    const it = find(a.id).o, kin = siblingsOf(it).map((x) => x.id);
    const wasAll = kin.length > 1 && a.selBefore && a.selBefore.size === kin.length && kin.every((id) => a.selBefore.has(id));
    sel.clear(); for (const id of wasAll || kin.length < 2 ? [it.id] : kin) sel.add(id);
    paintSel();
  } else if (a.k === 'move' && !a.toggle && a.kind === 'f') {
    const f = find(a.id).o, keep = new Set([f.id]);
    const fr = elOf(f.id).getBoundingClientRect(), top = fr.top + (Math.max(30, descBox({ o: f })) + 22) * S.view.z;
    const body = !a.tabEl && a.sy > top && a.sy < fr.bottom - 18 && a.sx > fr.left + 18 && a.sx < fr.right - 18;
    sel.clear(); sel.add(f.id);
    const all = collectMoving(false).map((m) => m.o.id);
    const wasAll = !body || (a.selBefore && a.selBefore.size === all.length && all.every((id) => a.selBefore.has(id)));
    sel.clear(); for (const id of wasAll ? keep : all) sel.add(id);
    paintSel();
  } else if (a.k === 'move' && !a.toggle && a.kind === 'g') {
    sel.clear(); sel.add(a.id); paintSel();
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
  } else if (a.k === 'resize') { pushApart([a.f, ...(a.chain || [])]); save(); render(); }
  else if (a.k === 'scale' || a.k === 'tbox') save();
});

vp.addEventListener('click', (e) => {
  const grp = e.target.closest('.dgroup');
  if (grp) return openGroup(grp);
  if (e.target.closest('.sign')) return;                // a tag is read on pointerup (a click), or dragged
  const b = e.target.closest('.acts button, .dhov button');
  if (b) {
    const host = b.closest('[data-k]'), f = find(host.dataset.id);
    if (b.dataset.a === 'front' || b.dataset.a === 'back') return restack(sel.has(f.o.id) ? [...sel].map(find).filter(Boolean).map((x) => x.o) : [f.o], b.dataset.a === 'front');
    if (f.k === 'd') return docAction(b.dataset.a, f.o);
    if (b.dataset.a === 'ref') { navigator.clipboard.writeText(token(f.o)); return toast('Copiada. Pégala en un documento o en otro sitio del plano (Ctrl+V)'); }
  }
  const chk = e.target.closest('.chk');
  if (chk) return toggleTask(find(chk.closest('[data-k]').dataset.id).o);
  const ta = e.target.closest('.tab-add');
  if (ta) {
    const f = find(ta.closest('.frame').dataset.id).o; snap();
    assignTabs();                                          // what is there now stays in the tab it was in
    for (const o of things()) if (!o.ftab && o.pin == null && o.dock == null) {
      const el = elOf(o.id); if (!el) continue; const [w, h] = sizeOf(el, o), cx = o.x + w / 2, cy = o.y + h / 2;
      if (cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h) o.ftab = { f: f.id, t: activeTab(f) };
    }
    const t = { id: 'tab-' + uid(), title: '' }; tabsOf(f).push(t); f.active = t.id; save(); render();
    const nt = elOf(f.id)?.querySelector(`.ftab[data-tab="${t.id}"] .ftitle`);
    if (nt) editInline(nt, (v) => { t.title = v || `Pestaña ${tabsOf(f).length}`; save(); render(); }, true);
    return;
  }
  const tx = e.target.closest('.ftab .x');
  if (tx) {
    const f = find(tx.closest('.frame').dataset.id).o, tid = tx.closest('.ftab').dataset.tab;
    return tabsOf(f).length > 1 ? askTabDelete(f, tid, tx) : askFrameDelete(f, tx);
  }
  const fa = e.target.closest('.f-add');
  if (fa) return frameInside(find(fa.closest('.frame').dataset.id).o);
  const sf = e.target.closest('.shp-forms button, .shp-cols b');
  if (sf) { const g = find(sf.closest('.shape').dataset.id).o; snap(); if (sf.dataset.form) g.form = sf.dataset.form; else g.color = sf.dataset.sc; save(); render(); return; }
  const cin = e.target.closest('.cin button');
  if (cin) { const it = find(cin.closest('[data-k]').dataset.id).o; $('#ipeek')?.classList.remove('on'); return cin.dataset.c === 'done' ? toggleTask(it) : removeIds([it.id]); }
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
    it.onCanvas = true; it.x = Math.round(w.x - 19); it.y = Math.round(w.y - 19); it.z = topZ(); delete it.pin; delete it.dock;
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
  const reading = document.body.classList.contains('reading');
  return { l: 24, r: innerWidth - (panelOpen ? 340 : 24), t: reading ? 20 : 70, b: innerHeight - (reading ? 84 : 20) };
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
      if (o.pin && find(o.pin.host)?.k === 'f') continue;        // a frame's own edge things follow it, they do not size it
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
    const all = [inner, ...contents(f)], top = FIT_PAD + descBox({ o: f });
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
const inside = (a, b) => a !== b && a.w * a.h < b.w * b.h && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;   // a within b (strictly smaller)
function shiftFrame(f, dx, dy) {
  const keep = new Set(sel); sel.clear(); sel.add(f.id);
  const group = collectMoving(false); sel.clear(); for (const id of keep) sel.add(id);
  for (const m of group) { m.o.x = Math.round(m.o.x + dx); m.o.y = Math.round(m.o.y + dy); }
  shiftHidden(f, dx, dy);
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
  const hr = host.getBoundingClientRect(), mine = new Set([...pinnedTo(host.dataset.id), ...(host.dataset.k === 'd' ? docked(find(host.dataset.id).o) : [])].map((t) => t.id));
  const crossing = [...itemsEl.querySelectorAll('[data-k]')].some((o) => o !== host && !mine.has(o.dataset.id) && !o.contains(host) && !host.contains(o)
    && (() => { const q = o.getBoundingClientRect(); return q.left < hr.right && hr.left < q.right && q.top < hr.bottom && hr.top < q.bottom; })());
  acts.classList.toggle('no-z', !crossing);
  const pal = host.querySelector(':scope > .pal'); if (pal) { const pr = pal.getBoundingClientRect(); others.push({ left: pr.left, top: pr.top - 16, right: pr.right, bottom: pr.bottom + 4 }); }
  // circles keep 'below' for what they say (the unfolding preview): their buttons go to a side
  const pref = host.dataset.k === 'd' ? ACT_SIDES : host.classList.contains('circle') ? ['at-right', 'at-left', 'at-top', 'at-bottom'] : ['at-bottom', 'at-top', 'at-right', 'at-left'];
  acts.classList.add('measuring');                 // measured at their real size, not mid-animation
  for (const side of pref) {
    acts.classList.remove(...ACT_SIDES); acts.classList.add(side);
    const r = [...acts.children].reduce((u, b) => { const q = b.getBoundingClientRect(); return u ? { left: Math.min(u.left, q.left), top: Math.min(u.top, q.top), right: Math.max(u.right, q.right), bottom: Math.max(u.bottom, q.bottom) } : q; }, null);
    if (r && !hit({ left: r.left - 6, top: r.top - 6, right: r.right + 6, bottom: r.bottom + 6 })) { acts.classList.remove('measuring'); return; }
  }
  acts.classList.remove(...ACT_SIDES, 'measuring'); acts.classList.add(pref[0]);
}
itemsEl.addEventListener('pointerover', (e) => {
  const host = e.target.closest('[data-k]'); if (!host || act || gh) return;
  if (e.relatedTarget && host.contains(e.relatedTarget)) return;       // still inside the same thing
  placeActs(host);
});

// ---- hovering an idea or a task: what it says unfolds just under it, like a drawer (all of it when short) ----
let ipeekT = null;
itemsEl.addEventListener('pointerover', (e) => {
  const el = e.target.closest('.item'), box = $('#ipeek');
  if (!el || act || gh) return;
  if (e.relatedTarget && el.contains(e.relatedTarget)) return;
  clearTimeout(ipeekT);
  ipeekT = setTimeout(() => {
    const it = find(el.dataset.id)?.o; if (!it || !el.isConnected || el.classList.contains('writing')) return;
    const r = el.getBoundingClientRect(), txt = it.text || '…';
    const kind = it.kind === 'idea' ? '💡 Idea' : it.done ? '☑ Tarea hecha' : '☐ Tarea';
    box.innerHTML = `<span class="ip-k">${kind}</span>${esc(txt.length > 280 ? txt.slice(0, 280) + '…' : txt)}`;
    Object.assign(box.style, { left: Math.min(innerWidth - 300, Math.max(8, r.left + r.width / 2 - 140)) + 'px', top: r.bottom + 8 + 'px' });
    box.classList.add('on');
  }, 220);
});
itemsEl.addEventListener('pointerout', (e) => {
  const el = e.target.closest('.item'); if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
  clearTimeout(ipeekT); $('#ipeek').classList.remove('on');
});
addEventListener('pointerdown', () => { clearTimeout(ipeekT); $('#ipeek')?.classList.remove('on'); }, true);

let fanFor = null, fanT = null;
itemsEl.addEventListener('pointerover', (e) => {
  const el = e.target.closest('.item.stacked'); if (!el || act || gh || fanFor === el.dataset.id) return;
  clearTimeout(fanT); fanT = setTimeout(() => openFan(el), 160);
});
function openFan(el) {
  const base = find(el.dataset.id)?.o; if (!base) return;
  closeFan(); fanFor = base.id;
  const fan = $('#fan'), r = el.getBoundingClientRect(), list = [base, ...stackMembers(base)];
  fan.innerHTML = list.map((it, i) => `<div class="fan-c ${it.kind}${it.done ? ' done' : ''}" data-id="${it.id}" style="--i:${i}" title="${esc(it.text)}">${it.kind === 'idea' ? '💡' : it.done ? '✔' : '<i></i>'}</div>`).join('');
  const goRight = r.right + list.length * 46 + 20 < innerWidth - 340;
  Object.assign(fan.style, { left: (goRight ? r.right + 6 : r.left - 6 - list.length * 46) + 'px', top: r.top + 'px', height: r.height + 'px' });
  fan.classList.toggle('left', !goRight);
  requestAnimationFrame(() => fan.classList.add('on'));
}
function closeFan() { clearTimeout(fanT); fanFor = null; const f = $('#fan'); f.classList.remove('on'); f.innerHTML = ''; }
addEventListener('pointermove', (e) => {
  if (!fanFor || act) return;
  if (e.target.closest?.('#fan') || e.target.closest?.(`.item[data-id="${fanFor}"]`)) return;
  closeFan();
});
$('#fan').addEventListener('pointerover', (e) => {
  const c = e.target.closest('.fan-c'); if (!c) return;
  const it = find(c.dataset.id)?.o, box = $('#ipeek'), r = c.getBoundingClientRect(); if (!it) return;
  box.innerHTML = `<span class="ip-k">${it.kind === 'idea' ? '💡 Idea' : it.done ? '☑ Tarea hecha' : '☐ Tarea'}</span>${esc(it.text || '…')}`;
  Object.assign(box.style, { left: Math.min(innerWidth - 300, Math.max(8, r.left + r.width / 2 - 140)) + 'px', top: r.bottom + 8 + 'px' });
  box.classList.add('on');
});
$('#fan').addEventListener('pointerdown', (e) => {
  const c = e.target.closest('.fan-c'); if (!c || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const it = find(c.dataset.id)?.o; if (!it) return;
  const sx = e.clientX, sy = e.clientY;
  const up = (ev) => {
    removeEventListener('pointerup', up);
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) { closeFan(); return openItem(it); }   // a click reads it
    // dragged out: it leaves the stack and lands where it was dropped (the base hands over if it was the base)
    snap();
    const base = stackBase(it) || it, rest = stackMembers(base).filter((x) => x !== it);
    if (it === base && rest.length) { const nb = rest[0]; delete nb.stackOf; Object.assign(nb, { x: it.x, y: it.y, pin: it.pin, dock: it.dock, z: it.z }); for (const x of rest.slice(1)) x.stackOf = nb.id; delete it.pin; delete it.dock; }
    delete it.stackOf;
    const w = toWorld(ev.clientX, ev.clientY); it.x = Math.round(w.x - 19); it.y = Math.round(w.y - 19); it.z = topZ();
    closeFan(); $('#ipeek').classList.remove('on'); changed();
  };
  addEventListener('pointerup', up);
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
    if (sp) sp.hostEl.insertAdjacentHTML('beforeend', signHTML({ id: 'preview', edge: sp.edge, t: sp.t, color: RIBBON_RED }, ' preview'));
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
      d.place = 'canvas'; d.x = Math.round(w.x - DOC_W / 2); d.y = Math.round(w.y - 20); d.z = topZ(); releaseRiders(d);
      sel.clear(); sel.add(d.id); save(); render();
    }
    return;
  }
  if (g.kind === 'sign') { if (g.moved) dropSign(e); else toast('Arrastra el ribete hasta el borde de un documento, post-it o marco'); return; }
  if (!g.moved) return create(g.kind, centerWorld(), false);
  const tray = trayAt;
  if (tray) { if (g.kind === 'doc') create('doc', { x: 0, y: 0 }, tray); return; }
  $('#pinhint').classList.remove('on');
  const wpt = toWorld(e.clientX, e.clientY), isItem = g.kind === 'idea' || g.kind === 'tarea';
  const dk = isItem ? dockAt(wpt.x, wpt.y, { id: '__new' }) : null;
  if (overCanvas(e)) create(g.kind, { ...wpt, free: true, dock: dk, pin: isItem && !dk ? pinTarget({ id: '__new' }, e) : null }, false);
}

const TOOLS = [
  ['doc', '📄', 'Documento', '#ffffff', 'Una página que se abre y se escribe'],
  ['postit', '🗒️', 'Post-it', '#fff1b8', 'Se escribe encima; no se abre'],
  ['idea', '💡', 'Idea', '#cdeedd', 'Una idea que puedes pegar en el plano y dentro de documentos'],
  ['tarea', '☑️', 'Tarea', '#cfe5fb', 'Una tarea que puedes pegar en el plano y dentro de documentos'],
  ['book', '📓', 'Libreta', '#fde2c8', 'Como un documento, pero con sus propias pestañas dentro'],
  ['text', 'Aa', 'Texto', '#f1eef4', 'Texto suelto, escrito directamente en el plano'],
  ['shape', '◆', 'Forma', '#f6c1d6', 'Una forma de color: rectángulo, círculo, triángulo o rombo'],
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
function nestPath(o) {
  const { ownerOf } = owners(), parts = [];
  let cur = o, k = kindOfObj(o), guard = 0;
  while (cur && guard++ < 8) {
    const p = parentOf(cur, k, ownerOf); if (!p) break;
    if (p.tray) { parts.unshift('cajón «' + (p.tray.name || 'Cajón') + '»'); break; }
    const pk = kindOfObj(p.o), nm = pk === 'f' ? (p.o.title || 'marco') : pk === 'd' ? '«' + p.o.name + '»' : pk === 'p' ? 'post-it' : pk === 'i' || pk === 't' ? 'pila' : '';
    const tt = p.tab && pk === 'f' && tabsOf(p.o).length > 1 ? tabsOf(p.o).find((t) => t.id === p.tab) : null;
    const tab = tt && tt !== tabsOf(p.o)[0] ? ' › ' + (tt.title || 'pestaña') : '';
    parts.unshift(nm + tab + (cur === o && p.rel ? ' (' + p.rel + ')' : ''));
    cur = p.o; k = pk;
  }
  return parts.join(' › ');
}
function whereOf(it) {
  const np = nestPath(it); if (np) return np;
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
  if (stackBase(it)) return groupOf(stackBase(it));
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
  if (f.k === 'd') return openEditor(f.o.id);
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
// ---- the map of nestings: everything, as a tree of what holds what (frames › tabs › pages › circles) ----
const KINDS = [['f', 'Marcos', '⬚'], ['d', 'Documentos', '📄'], ['p', 'Post-its', '🗒️'], ['x', 'Textos', 'Aa'], ['g', 'Formas', '◆'], ['i', 'Ideas', '💡'], ['t', 'Tareas', '☐']];
let mapKinds = new Set(JSON.parse(localStorage.getItem('meadow.mapKinds') || '[]'));
const kindOfObj = (o) => find(o.id)?.k || (S.docs.includes(o) ? 'd' : null);
// What holds a thing, and how: { o, rel, tab } (null: it lies on the open plane)
function parentOf(o, k, ownerOf) {
  const smallestFrame = (x, y, not) => S.frames.filter((f) => f !== not && x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h).sort((p, q) => p.w * p.h - q.w * q.h)[0];
  const ctr = (q) => { const el = elOf(q.id); const [w, h] = el ? sizeOf(el, q) : [q.w || 0, q.h || 0]; return [q.x + w / 2, q.y + h / 2]; };
  if (k === 'i' || k === 't') {
    if (o.stackOf && stackBase(o)) return { o: stackBase(o), rel: 'en su pila' };
    if (o.pin && find(o.pin.host)) { const h = find(o.pin.host).o; return { o: h, rel: o.pin.side === 'desc' ? 'en la descripción' : 'en el borde', tab: o.pin.side === 'desc' ? o.pin.tab : null, edge: true }; }
    if (o.dock && docById(o.dock)) return { o: docById(o.dock), rel: 'debajo' };
    if (!o.onCanvas) { const d = docsUsing(o)[0]; return d ? { o: d, rel: 'en el texto' } : null; }
  }
  if (k === 'f') { const g = S.frames.filter((g) => g !== o && o.x >= g.x && o.y >= g.y && o.x + o.w <= g.x + g.w && o.y + o.h <= g.y + g.h).sort((p, q) => p.w * p.h - q.w * q.h)[0]; return g ? { o: g, rel: '' } : null; }
  if (k === 'd' && o.place !== 'canvas') { const t = S.trays.find((t) => t.id === o.tray); return { tray: t || { id: 'tray', name: 'Cajón' } }; }
  if (o.ftab && S.frames.find((f) => f.id === o.ftab.f)) return { o: S.frames.find((f) => f.id === o.ftab.f), rel: '', tab: o.ftab.t };
  const own = ownerOf.get(o.id); if (own && find(own)) return { o: find(own).o, rel: 'encima' };
  const [cx, cy] = ctr(o), f = smallestFrame(cx, cy); return f ? { o: f, rel: '' } : null;
}
function mapTree() {
  const { ownerOf } = owners();
  const nodes = [...S.frames.map((o) => ['f', o]), ...S.docs.map((o) => ['d', o]), ...S.postits.map((o) => ['p', o]), ...S.texts.map((o) => ['x', o]), ...(S.shapes || []).map((o) => ['g', o]),
    ...S.ideas.map((o) => ['i', o]), ...S.tasks.map((o) => ['t', o])];
  const kids = new Map(), roots = [], trays = new Map();
  const push = (key, n) => { if (!kids.has(key)) kids.set(key, []); kids.get(key).push(n); };
  for (const [k, o] of nodes) {
    const p = parentOf(o, k, ownerOf), n = { k, o, rel: p?.rel || '' };
    if (!p) roots.push(n);
    else if (p.tray) { if (!trays.has(p.tray.id)) trays.set(p.tray.id, { tray: p.tray, list: [] }); trays.get(p.tray.id).list.push(n); }
    else if (find(p.o.id)?.k === 'f' && tabsOf(p.o).length > 1 && !p.edge) push(p.o.id + '|' + (p.tab || activeTab(p.o)), n);
    else if (p.tab && tabsOf(p.o).length > 1) push(p.o.id + '|' + p.tab, n);
    else push(p.o.id, n);
  }
  return { kids, roots, trays };
}
function mapHTML() {
  const { kids, roots, trays } = mapTree();
  const want = (k) => !mapKinds.size || mapKinds.has(k);
  const label = (n) => n.k === 'f' ? (n.o.title || 'Marco sin título') : n.k === 'd' ? n.o.name : (n.o.text || '').split('\n')[0] || (n.k === 'p' ? 'Post-it' : n.k === 'x' ? 'Texto' : n.k === 'g' ? 'Forma' : '…');
  const TOOLK = { f: 'frame', d: 'doc', p: 'postit', i: 'idea', t: 'tarea', x: 'text', g: 'shape' };
  const icon = (n) => { const t = TOOLS.find((q) => q[0] === (n.k === 'd' && n.o.book ? 'book' : TOOLK[n.k])); return `<span class="mk mk-${n.k}${n.k === 't' && n.o.done ? ' done' : ''}" style="--c:${n.k === 'g' && n.o.color ? n.o.color : t[3]}">${n.k === 't' ? (n.o.done ? '✔' : '') : t[1]}</span>`; };
  const order = (a, b) => 'itdpxgf'.indexOf(a.k) - 'itdpxgf'.indexOf(b.k) || (a.o.y || 0) - (b.o.y || 0) || (a.o.x || 0) - (b.o.x || 0);
  const childrenOf = (n) => {
    const own = [...(kids.get(n.o.id) || [])];
    const tabs = n.k === 'f' && tabsOf(n.o).length > 1 ? tabsOf(n.o).map((t) => ({ tab: t, f: n.o, list: kids.get(n.o.id + '|' + t.id) || [] })) : [];
    return { own: own.sort(order), tabs };
  };
  const draw = (n, depth) => {
    const { own, tabs } = childrenOf(n);
    const circ = own.filter((c) => c.k === 'i' || c.k === 't'), rest = own.filter((c) => c.k !== 'i' && c.k !== 't');
    const inner = [...circ.map((c) => draw(c, depth + 1)), ...tabs.map((t) => drawTab(t, depth + 1)), ...rest.map((c) => draw(c, depth + 1))].filter(Boolean).join('');
    const mine = want(n.k);
    if (!mine && !inner) return '';
    return `<div class="mp-n${mine ? '' : ' ctx'}" style="--d:${depth}"><button class="mp-row" data-loc2="${n.o.id}">${icon(n)}<span class="mp-l">${esc(label(n))}</span>${n.rel ? `<span class="mp-rel">${n.rel}</span>` : ''}</button>${inner}</div>`;
  };
  const drawTab = (t, depth) => {
    const inner = t.list.sort(order).map((c) => draw(c, depth + 1)).filter(Boolean).join('');
    if (!inner && mapKinds.size) return '';
    return `<div class="mp-n tab" style="--d:${depth}"><button class="mp-row" data-tabgo="${t.f.id}|${t.tab.id}"><span class="mk mk-tab"></span><span class="mp-l">Pestaña «${esc(t.tab.title || 'sin título')}»</span>${t.tab.id === activeTab(t.f) ? '<span class="mp-rel">abierta</span>' : ''}</button>${inner || '<div class="mp-empty" style="--d:' + (depth + 1) + '">vacía</div>'}</div>`;
  };
  const plane = roots.sort(order).map((n) => draw(n, 0)).filter(Boolean).join('');
  const drawers = [...trays.values()].map(({ tray, list }) => { const inner = list.sort(order).map((c) => draw(c, 1)).filter(Boolean).join(''); return inner ? `<div class="mp-n ctx" style="--d:0"><div class="mp-row"><span class="mk mk-tray">🗄</span><span class="mp-l">${esc(tray.name || 'Cajón')}</span></div>${inner}</div>` : ''; }).join('');
  const names = mapKinds.size ? KINDS.filter((q) => mapKinds.has(q[0])).map((q) => q[1].toLowerCase()) : [];
  const viewing = names.length ? 'Solo ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' y ' + names.at(-1) : names[0]) : 'Todo';
  return `<div class="mp-head"><b>Viendo:</b> ${viewing}</div>
    <div class="filt mp-filt"><button data-mk="" class="${mapKinds.size ? '' : 'on'}">Todo</button>${KINDS.map(([k, l]) => `<button data-mk="${k}" class="${mapKinds.has(k) ? 'on' : ''}">${icon({ k, o: {} })}${l}</button>`).join('')}</div>
    <div class="mp-tree">${plane ? '<div class="mp-sec">En el plano</div>' + plane : ''}${drawers ? '<div class="mp-sec">En los cajones</div>' + drawers : ''}${plane || drawers ? '' : '<p class="none">Nada de esto todavía.</p>'}</div>`;
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
  } else if (tab === 'mapa') {
    html = mapHTML();
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
  const mk = e.target.closest('[data-mk]');
  if (mk) { const k = mk.dataset.mk; if (!k) mapKinds.clear(); else if (mapKinds.has(k)) mapKinds.delete(k); else mapKinds.add(k); localStorage.setItem('meadow.mapKinds', JSON.stringify([...mapKinds])); return renderPanel(); }
  const tg = e.target.closest('[data-tabgo]');
  if (tg) { const [fid, tid] = tg.dataset.tabgo.split('|'), f = S.frames.find((x) => x.id === fid); if (f) { f.active = tid; save(); render(); goTo(fid); } return; }
  const l2 = e.target.closest('[data-loc2]');
  if (l2) { const f = find(l2.dataset.loc2); if (!f) return; if (f.k === 'i' || f.k === 't') return locate(f.o); if (f.k === 'd' && f.o.place !== 'canvas') return openEditor(f.o.id);
    if (f.o.ftab) { const fr = S.frames.find((x) => x.id === f.o.ftab.f); if (fr && fr.active !== f.o.ftab.t) { fr.active = f.o.ftab.t; save(); render(); } }
    if (edOpen()) closeEditor(); const el = elOf(f.o.id); if (el) { centerOn(f.o, el); sel.clear(); sel.add(f.o.id); paintSel(); } return; }
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
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor, .ied');
addEventListener('keydown', (e) => {
  document.body.classList.toggle('ctrl', e.ctrlKey || e.metaKey);
  if ($('#reader').classList.contains('open')) { if (e.key === 'Escape') closeReader(); return; }
  if (edOpen()) { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.pop')) closeEditor(); return; }
  if (typing(e)) return;
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (e.key === 'Enter' && $('#backpill').classList.contains('on')) { e.preventDefault(); $('#backpill').click(); }
  else if (e.key === ' ') { space = true; vp.classList.add('space'); e.preventDefault(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
    const only = sel.size === 1 && find([...sel][0]);
    if (only?.k === 'f') { const el = elOf(only.o.id)?.querySelector('.ftab.on') || elOf(only.o.id); return askFrameDelete(only.o, el); }   // a frame alone: it warns
    removeIds([...sel]);
  }
  else if (mod && key === 'z') { e.preventDefault(); doUndo(); }
  else if (mod && key === 'a') { e.preventDefault(); for (const el of world.querySelectorAll('[data-k]')) sel.add(el.dataset.id); paintSel(); }
  else if (mod && key === 'c' && sel.size) {
    e.preventDefault();
    if (sel.size === 1) { const f = find([...sel][0]); if (f && (f.k === 'i' || f.k === 't')) { navigator.clipboard.writeText(token(f.o)); return toast('Copiada para pegar'); } }
    navigator.clipboard.writeText(groupText()); toast(sel.size === 1 ? 'Copiado' : 'Copiado todo el grupo');
  } else if (e.key === 'Escape') { if ($('#editpill').classList.contains('on')) return $('#ep-back').click(); sel.clear(); paintSel(); if (traysShown) showTrays(false); }
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
    if (d.book) { const p = d.pages?.find((x) => x.id === d.page); if (p) p.text = text; }
    const t = !d.book && titleOf(text); if (t && t !== d.name) { d.name = t; if (document.activeElement !== $('#ed-name')) $('#ed-name').value = t; }
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
  unmountInline();
  if (curId && push && curId !== id && ed) hist.push({ id: curId, pos: ed.view.state.selection.main.head, top: ed.view.scrollDOM.scrollTop });
  closeSession(); session = { id, before: d.text || '' };
  curId = id;
  $('#ed').classList.add('open');
  if (!ed) ed = createEditor($('#ed-body'), edApi);
  ed.setDoc(d.text || '');
  const tint = docTint(d); $('#ed').classList.toggle('tinted', !!tint); if (tint) $('#ed').style.setProperty('--tint', tint); else $('#ed').style.removeProperty('--tint');
  fillHead(); ed.focus();
}
function renderBookTabs() {
  const d = docById(curId), bar = $('#ed-tabs'); if (!bar) return;
  if (!d?.book) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = d.pages.map((p) => `<div class="bt${p.id === d.page ? ' on' : ''}" data-pg="${p.id}"><span class="bt-t">${esc(p.title)}</span>${p.id === d.page && d.pages.length > 1 ? '<button class="bt-x" title="Borrar esta pestaña">×</button>' : ''}</div>`).join('')
    + '<button class="bt-add" title="Nueva pestaña">＋</button>';
}
function switchPage(d, id) {
  if (!d.book || d.page === id) return;
  const cur = d.pages.find((p) => p.id === d.page); if (cur) cur.text = d.text;
  const nx = d.pages.find((p) => p.id === id); if (!nx) return;
  d.page = id; d.text = nx.text || ''; save();
  ed.setDoc(d.text); renderBookTabs(); render(); ed.focus();
}
$('#ed-tabs')?.addEventListener('click', (e) => {
  const d = docById(curId); if (!d?.book) return;
  if (e.target.closest('.bt-add')) {
    snap(); const cur = d.pages.find((p) => p.id === d.page); if (cur) cur.text = d.text;
    const p = { id: uid(), title: `Página ${d.pages.length + 1}`, text: '' }; d.pages.push(p); save();
    switchPage(d, p.id);
    const t = $(`#ed-tabs .bt[data-pg="${p.id}"] .bt-t`); if (t) editInline(t, (v) => { if (v) { p.title = v; save(); renderBookTabs(); render(); } }, true);
    return;
  }
  const x = e.target.closest('.bt-x');
  if (x) {
    const p = d.pages.find((q) => q.id === d.page);
    const drop = () => { snap(); const i = d.pages.indexOf(p); d.pages.splice(i, 1); const nx = d.pages[Math.max(0, i - 1)]; d.page = nx.id; d.text = nx.text || ''; save(); ed.setDoc(d.text); renderBookTabs(); render(); toast('Pestaña borrada', [['Deshacer', doUndo]]); };
    if (!(d.text || '').trim()) return drop();
    return askChoice(x, `¿Borrar la pestaña «${esc(p.title)}»?`, 'Se borra lo que tiene escrito. Las otras pestañas no se tocan.', [{ label: 'Borrar la pestaña y su texto', danger: true, run: drop }]);
  }
  const t = e.target.closest('.bt');
  if (t) switchPage(d, t.dataset.pg);
});
$('#ed-tabs')?.addEventListener('dblclick', (e) => {
  const d = docById(curId), t = e.target.closest('.bt'); if (!d?.book || !t) return;
  const p = d.pages.find((q) => q.id === t.dataset.pg), el = t.querySelector('.bt-t');
  editInline(el, (v) => { if (v && v !== p.title) { snap(); p.title = v; save(); } renderBookTabs(); render(); }, true);
});
function fillHead() {
  const d = docById(curId); if (!d) return;
  $('#ed-ico').textContent = d.book ? '📓' : '📄';
  renderBookTabs();
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
function closeEditor() { closeSession(); $('#ed').classList.remove('open'); curId = null; hist = []; render(); nearDocs(); }
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
