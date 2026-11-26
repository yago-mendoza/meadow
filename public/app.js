// Meadow: a zoomable grid of documents, post-its and frames, a stash at the bottom left, and a Notepad-like editor.
import { createEditor, LINK_RE, TAG_RE } from './editor.bundle.js';

const TYPES = [
  { id: 'nota', name: 'Nota', icon: '📝', color: '#fff1b8' },
  { id: 'idea', name: 'Idea', icon: '💡', color: '#cdeedd' },
  { id: 'tarea', name: 'Tarea', icon: '☑️', color: '#cfe5fb' },
  { id: 'ref', name: 'Referencia', icon: '📎', color: '#e3d9f7' },
  { id: 'diario', name: 'Diario', icon: '📓', color: '#ffd9c2' },
  { id: 'borrador', name: 'Borrador', icon: '✏️', color: '#eceef2' },
];
const PASTEL = ['#fff1b8', '#ffd9c2', '#f9d0e3', '#e3d9f7', '#cfe5fb', '#cdeedd', '#e4ebd3', '#eceef2'];
const T = (id) => TYPES.find((t) => t.id === id) || TYPES[0];
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CARD_W = 230;

let S = { docs: [], postits: [], frames: [], view: { x: 140, y: 80, z: 1 } };
let rev = 0;
const sel = new Set();
const vp = $('#vp'), grid = $('#grid'), world = $('#world'), itemsEl = $('#items'), framesEl = $('#frames');
const stash = $('#stash'), stashList = $('#stash-list');

const N = (d) => S.docs.indexOf(d) + 1;
const docById = (id) => S.docs.find((d) => d.id === id);
function find(id) {
  for (const [k, list] of [['d', S.docs], ['p', S.postits], ['f', S.frames]]) {
    const o = list.find((x) => x.id === id); if (o) return { k, o };
  }
  return null;
}
const elOf = (id) => world.querySelector(`[data-id="${id}"]`);

// ---- saving --------------------------------------------------------------------------------------------------------
async function load() {
  const j = await (await fetch('/api/state')).json();
  rev = j.rev || 0;
  if (j.state) S = { ...S, ...j.state };
  else S.view = { x: Math.round(innerWidth / 2 - 115), y: Math.round(innerHeight / 2 - 120), z: 1 };
  S.postits ||= []; S.frames ||= [];
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
  if (dirty) navigator.sendBeacon('/api/state?rev=' + rev, new Blob([JSON.stringify(S)], { type: 'application/json' }));
});

const undo = [];
function snap() { undo.push(JSON.stringify({ docs: S.docs, postits: S.postits, frames: S.frames })); if (undo.length > 80) undo.shift(); }
function doUndo() {
  const s = undo.pop(); if (!s) return toast('Nada que deshacer');
  Object.assign(S, JSON.parse(s)); sel.clear();
  if (curId) { const d = docById(curId); if (!d) closeEditor(); else { ed.replaceText(d.text || ''); fillHead(); } }
  render(); save();
}

// ---- view, zoom and grid -------------------------------------------------------------------------------------------
function applyView() {
  const { x, y, z } = S.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  $('#z-val').textContent = Math.round(z * 100) + ' %';
  drawGrid();
}
function drawGrid() {
  const dpr = devicePixelRatio || 1, w = vp.clientWidth, h = vp.clientHeight;
  if (grid.width !== w * dpr || grid.height !== h * dpr) { grid.width = w * dpr; grid.height = h * dpr; }
  const c = grid.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#f7f7fb'; c.fillRect(0, 0, w, h);
  const { x, y, z } = S.view;
  let step = 1; const seq = [2, 2.5, 2]; let k = 0;
  while (step * z < 14) step *= seq[k++ % 3];
  const lines = (s, col) => {
    c.strokeStyle = col; c.lineWidth = 1; c.beginPath();
    for (let wx = Math.floor(-x / z / s) * s; wx * z + x <= w; wx += s) { const sx = Math.round(wx * z + x) + 0.5; c.moveTo(sx, 0); c.lineTo(sx, h); }
    for (let wy = Math.floor(-y / z / s) * s; wy * z + y <= h; wy += s) { const sy = Math.round(wy * z + y) + 0.5; c.moveTo(0, sy); c.lineTo(w, sy); }
    c.stroke();
  };
  lines(step, '#ececf3'); lines(step * 5, '#dedce8');
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
const centerWorld = () => toWorld(innerWidth / 2 + 50, innerHeight / 2 - 60);
addEventListener('resize', drawGrid);

$('#z-val').onclick = () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / S.view.z);
$('#z-fit').onclick = () => {
  const boxes = [];
  for (const d of S.docs) if (d.place === 'canvas') { const el = elOf(d.id); boxes.push([d.x, d.y, CARD_W, el ? el.offsetHeight : 120]); }
  for (const p of S.postits) boxes.push([p.x, p.y, 170, 160]);
  for (const f of S.frames) boxes.push([f.x, f.y - 34, f.w, f.h + 34]);
  if (!boxes.length) return;
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2])), y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  const aw = innerWidth - 150, ah = innerHeight - 220;
  const z = Math.min(2, aw / (x1 - x0 + 80), ah / (y1 - y0 + 80));
  S.view = { z, x: 120 + (aw - (x1 - x0) * z) / 2 - x0 * z, y: 20 + (ah - (y1 - y0) * z) / 2 - y0 * z };
  applyView(); saveView();
};

// ---- rendering -----------------------------------------------------------------------------------------------------
const palHTML = () => `<div class="pal">${PASTEL.map((c) => `<i data-c="${c}" style="--d:${c}"></i>`).join('')}</div>`;
function cardHTML(d, n) {
  const t = T(d.type);
  const preview = (d.text || '').split('\n').slice(0, 9).join('\n');
  const len = (d.text || '').length, stack = len > 600 ? ' s2' : len > 0 ? ' s1' : '';
  return `<div class="card${stack}${sel.has(d.id) ? ' sel' : ''}" data-id="${d.id}" data-k="d" style="left:${d.x}px;top:${d.y}px;--c:${t.color}">
    <div class="sheet">
      <div class="tab"><span class="ico">${t.icon}</span><span class="name">${esc(d.name)}</span><span class="num">${n}</span></div>
      <div class="body">${d.text ? esc(preview) : '<em>en blanco</em>'}</div>
    </div>
    <button class="x" title="Borrar">×</button>
    <div class="acts">
      <button data-a="copy">⧉<b>Copiar</b></button>
      <button data-a="add">＋<b>Añadir lo copiado</b></button><button data-a="replace">⇄<b>Reemplazar</b></button>
    </div></div>`;
}
const postitHTML = (p) => `<div class="postit${sel.has(p.id) ? ' sel' : ''}" data-id="${p.id}" data-k="p" style="left:${p.x}px;top:${p.y}px;--bg:${p.color}">
  <div class="ptext">${esc(p.text)}</div><button class="x" title="Borrar">×</button>${palHTML()}</div>`;
const frameHTML = (f) => `<div class="frame${sel.has(f.id) ? ' sel' : ''}" data-id="${f.id}" data-k="f" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;--bg:${f.color}">
  <div class="ftab"><span class="ftitle">${esc(f.title)}</span><button class="x" title="Borrar el marco (no lo de dentro)">×</button>${palHTML()}</div>
  <div class="edge e-t"></div><div class="edge e-b"></div><div class="edge e-l"></div><div class="edge e-r"></div><div class="rs"></div></div>`;

function renderItems() {
  framesEl.innerHTML = S.frames.map(frameHTML).join('');
  itemsEl.innerHTML = S.docs.map((d, i) => (d.place === 'canvas' ? cardHTML(d, i + 1) : '')).join('') + S.postits.map(postitHTML).join('');
  $('#empty').classList.toggle('on', !S.frames.length && !S.postits.length && !S.docs.some((d) => d.place === 'canvas'));
}
function renderStash() {
  const ds = S.docs.map((d, i) => [d, i + 1]).filter(([d]) => d.place === 'stash');
  $('#stash-n').textContent = ds.length || '';
  stashList.innerHTML = ds.map(([d, n]) => `<div class="chip" data-id="${d.id}" style="--c:${T(d.type).color}" title="Clic para abrir · arrástralo al plano">
    <span>${T(d.type).icon}</span><b>${esc(d.name)}</b><i>*${n}</i><button class="x" title="Borrar">×</button></div>`).join('');
  stash.classList.toggle('empty', !ds.length);
}
function render() { renderItems(); renderStash(); applyView(); }
function paintSel() { for (const el of world.querySelectorAll('[data-k]')) el.classList.toggle('sel', sel.has(el.dataset.id)); }

// ---- creating ------------------------------------------------------------------------------------------------------
function nextName(base) {
  const names = new Set(S.docs.map((d) => d.name)); let i = 1;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}
function newDoc({ name, type = 'nota', place = 'canvas', x = 0, y = 0, text = '' }) {
  const d = { id: uid(), name: name || nextName(T(type).name), type, text, x: Math.round(x), y: Math.round(y), place, created: Date.now(), updated: Date.now() };
  S.docs.push(d); return d;
}
function create(kind, type, w, inStash) {
  snap();
  if (kind === 'type') {
    const d = newDoc({ type, place: inStash ? 'stash' : 'canvas', x: w.x - CARD_W / 2, y: w.y - 24 });
    sel.clear(); if (!inStash) sel.add(d.id);
    save(); render();
    const el = inStash ? stashList.querySelector(`[data-id="${d.id}"] b`) : elOf(d.id)?.querySelector('.name');
    if (el) editInline(el, (v) => { if (v) { d.name = v; save(); render(); } });
  } else if (kind === 'postit') {
    const p = { id: uid(), x: Math.round(w.x - 85), y: Math.round(w.y - 75), text: '', color: PASTEL[0] };
    S.postits.push(p); sel.clear(); sel.add(p.id); save(); render(); editPostit(p);
  } else if (kind === 'frame') {
    const f = { id: uid(), x: Math.round(w.x - 220), y: Math.round(w.y - 140), w: 440, h: 300, title: '', color: PASTEL[4] };
    S.frames.push(f); sel.clear(); sel.add(f.id); save(); render();
    editInline(elOf(f.id).querySelector('.ftitle'), (v) => { f.title = v; save(); render(); }, true);
  }
}

// Inline text editing (names, frame titles). onDone gets the trimmed text, or null when cancelled.
function editInline(el, onDone, allowEmpty = false) {
  const before = el.textContent;
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    el.contentEditable = 'false';
    const v = el.textContent.replace(/\s+/g, ' ').trim();
    if (!ok) { el.textContent = before; onDone(null); return; }
    if (!v && !allowEmpty) { el.textContent = before; onDone(null); return; }
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

// ---- deleting (document numbers close the gap, as if the deleted one never existed) ---------------------------------
function renumber(text, k) {
  return (text || '').replace(LINK_RE, (m, label, n) => {
    n = +n;
    if (n === k) return `[${label}]`;
    return n > k ? `[${label}*${n - 1}]` : m;
  });
}
function removeIds(ids) {
  if (!ids.length) return;
  snap();
  const set = new Set(ids);
  const idx = S.docs.map((d, i) => (set.has(d.id) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
  for (const i of idx) {
    S.docs.splice(i, 1);
    for (const d of S.docs) d.text = renumber(d.text, i + 1);
  }
  S.postits = S.postits.filter((p) => !set.has(p.id));
  S.frames = S.frames.filter((f) => !set.has(f.id));
  for (const id of ids) sel.delete(id);
  if (curId) { const d = docById(curId); if (!d) closeEditor(); else { ed.replaceText(d.text || ''); fillHead(); } }
  save(); render();
  toast(ids.length === 1 ? 'Borrado' : `${ids.length} elementos borrados`, [['Deshacer', doUndo]]);
}

// ---- card actions --------------------------------------------------------------------------------------------------
async function cardAction(a, d, btn) {
  if (a === 'open') return openEditor(d.id);
  if (a === 'copy') { await navigator.clipboard.writeText(d.text || ''); return toast(`Copiado «${d.name}»`); }
  let clip;
  try { clip = (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'); } catch { return toast('El navegador no deja leer el portapapeles'); }
  if (!clip) return toast('El portapapeles está vacío');
  snap();
  d.text = a === 'add' ? (d.text ? d.text.replace(/\n*$/, '\n') + clip : clip) : clip;
  d.updated = Date.now(); save(); render();
  toast(a === 'add' ? `Añadido al final de «${d.name}»` : `«${d.name}» reemplazado`, [['Deshacer', doUndo]]);
}

// ---- pointer: pan, box select, move, resize ------------------------------------------------------------------------
let act = null, space = false;
vp.addEventListener('contextmenu', (e) => e.preventDefault());
vp.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.acts, .x, .pal, [contenteditable="true"]')) return;
  if (e.button === 1 || e.button === 2 || (e.button === 0 && space)) {
    e.preventDefault();
    act = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y }; vp.classList.add('panning'); return;
  }
  if (e.button !== 0) return;
  document.activeElement?.blur?.();
  const rs = e.target.closest('.rs');
  if (rs) { const f = find(rs.closest('.frame').dataset.id).o; act = { k: 'resize', f, sx: e.clientX, sy: e.clientY, w: f.w, h: f.h, el: rs.closest('.frame') }; return; }
  const it = e.target.closest('[data-k]');
  if (it) {
    const id = it.dataset.id;
    if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
    else if (!sel.has(id)) { sel.clear(); sel.add(id); }
    paintSel();
    act = { k: 'move', sx: e.clientX, sy: e.clientY, moving: collectMoving(e.altKey), moved: false, id, kind: it.dataset.k, shift: e.shiftKey };
    return;
  }
  act = { k: 'box', sx: e.clientX, sy: e.clientY, add: e.shiftKey, base: new Set(sel), moved: false };
});

// What moves with the selection: the selected items, and whatever sits inside a selected frame (Alt: the frame alone).
function collectMoving(frameAlone) {
  const out = new Map();
  const add = (id) => { const f = find(id), el = elOf(id); if (f && el && (f.k !== 'd' || f.o.place === 'canvas')) out.set(id, { k: f.k, o: f.o, el, x0: f.o.x, y0: f.o.y }); };
  for (const id of sel) add(id);
  if (!frameAlone) {
    for (const id of sel) {
      const f = find(id); if (!f || f.k !== 'f') continue;
      const fr = f.o;
      for (const el of itemsEl.querySelectorAll('[data-k]')) {
        const o = find(el.dataset.id).o;
        const cx = o.x + el.offsetWidth / 2, cy = o.y + el.offsetHeight / 2;
        if (cx > fr.x && cx < fr.x + fr.w && cy > fr.y && cy < fr.y + fr.h) add(el.dataset.id);
      }
    }
  }
  return [...out.values()];
}
const overStash = (e) => { const r = stash.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
const overCanvas = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); return !!el && !el.closest('#side, #stash, #zoom, #ed') && !!el.closest('#vp'); };

addEventListener('pointermove', (e) => {
  if (gh) return moveGhost(e);
  if (!act) return;
  const z = S.view.z;
  if (act.k === 'pan') { S.view.x = act.vx + e.clientX - act.sx; S.view.y = act.vy + e.clientY - act.sy; applyView(); }
  else if (act.k === 'move') {
    if (!act.moved && Math.hypot(e.clientX - act.sx, e.clientY - act.sy) < 3) return;
    if (!act.moved) { act.moved = true; snap(); document.body.classList.add('dragging'); }
    const dx = (e.clientX - act.sx) / z, dy = (e.clientY - act.sy) / z;
    for (const m of act.moving) { m.o.x = Math.round(m.x0 + dx); m.o.y = Math.round(m.y0 + dy); m.el.style.left = m.o.x + 'px'; m.el.style.top = m.o.y + 'px'; }
    stash.classList.toggle('hot', overStash(e) && act.moving.some((m) => m.k === 'd'));
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
  } else if (act.k === 'resize') {
    if (!act.snapped) { act.snapped = true; snap(); }
    act.f.w = Math.max(160, Math.round(act.w + (e.clientX - act.sx) / z));
    act.f.h = Math.max(100, Math.round(act.h + (e.clientY - act.sy) / z));
    act.el.style.width = act.f.w + 'px'; act.el.style.height = act.f.h + 'px';
  }
});
addEventListener('pointerup', (e) => {
  if (gh) return dropGhost(e);
  if (!act) return;
  const a = act; act = null;
  vp.classList.remove('panning'); document.body.classList.remove('dragging'); stash.classList.remove('hot');
  if (a.k === 'pan') saveView();
  else if (a.k === 'move' && a.moved) {
    if (overStash(e)) {
      const ds = a.moving.filter((m) => m.k === 'd');
      for (const m of ds) { m.o.x = m.x0; m.o.y = m.y0; m.o.place = 'stash'; sel.delete(m.o.id); }
      if (ds.length) toast(ds.length === 1 ? `«${ds[0].o.name}» en la bandeja` : `${ds.length} documentos en la bandeja`);
    }
    save(); render();
  } else if (a.k === 'move' && a.kind === 'd' && !a.shift) {
    sel.clear(); paintSel(); openEditor(a.id);          // a click on a document opens it
  } else if (a.k === 'box') {
    $('#selrect').style.display = 'none';
    if (!a.moved && !a.add) { sel.clear(); paintSel(); }
  } else if (a.k === 'resize') save();
});

vp.addEventListener('click', (e) => {
  const b = e.target.closest('.acts button');
  if (b) return cardAction(b.dataset.a, docById(b.closest('.card').dataset.id), b);
  const x = e.target.closest('.x');
  if (x) return removeIds([x.closest('[data-k]').dataset.id]);
  const dot = e.target.closest('.pal i');
  if (dot) { const f = find(dot.closest('[data-k]').dataset.id); snap(); f.o.color = dot.dataset.c; save(); render(); }
});
vp.addEventListener('dblclick', (e) => {
  const pt = e.target.closest('.postit');
  if (pt) return editPostit(find(pt.dataset.id).o);
  const ft = e.target.closest('.ftab');
  if (ft) { const f = find(ft.closest('.frame').dataset.id).o; return editInline(ft.querySelector('.ftitle'), (v) => { if (v !== null) { f.title = v; save(); render(); } }, true); }
});

// ---- dragging from the sidebar and the stash (a ghost follows the pointer) ------------------------------------------
let gh = null;
const ghost = $('#ghost');
function startGhost(e, info) { gh = { ...info, sx: e.clientX, sy: e.clientY, moved: false }; }
function moveGhost(e) {
  if (!gh.moved && Math.hypot(e.clientX - gh.sx, e.clientY - gh.sy) < 4) return;
  if (!gh.moved) { gh.moved = true; ghost.innerHTML = gh.label; ghost.style.display = 'flex'; document.body.classList.add('dragging'); }
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  stash.classList.toggle('hot', overStash(e) && gh.kind !== 'chip' && (gh.kind === 'type'));
}
function dropGhost(e) {
  const g = gh; gh = null;
  ghost.style.display = 'none'; document.body.classList.remove('dragging'); stash.classList.remove('hot');
  if (g.kind === 'chip') {
    const d = docById(g.id); if (!d) return;
    if (!g.moved) return openEditor(d.id);
    if (!overStash(e) && overCanvas(e)) {
      snap(); const w = toWorld(e.clientX, e.clientY);
      d.place = 'canvas'; d.x = Math.round(w.x - CARD_W / 2); d.y = Math.round(w.y - 20);
      sel.clear(); sel.add(d.id); save(); render();
    }
    return;
  }
  if (!g.moved) return create(g.kind, g.type, centerWorld(), false);
  if (overStash(e)) { if (g.kind === 'type') create('type', g.type, { x: 0, y: 0 }, true); return; }
  if (overCanvas(e)) create(g.kind, g.type, toWorld(e.clientX, e.clientY), false);
}

$('#types').innerHTML = TYPES.map((t) => `<div class="tool" data-kind="type" data-type="${t.id}" style="--c:${t.color}" title="Clic o arrastra al plano">
  <span class="ico">${t.icon}</span><span>${t.name}</span></div>`).join('');
$('#tools').innerHTML = `<div class="tool" data-kind="postit" style="--c:#fff1b8" title="Post-it"><span class="ico">🗒️</span><span>Post-it</span></div>
  <div class="tool" data-kind="frame" style="--c:#cfe5fb" title="Marco para agrupar"><span class="ico">⬚</span><span>Marco</span></div>`;
$('#side').addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.tool'); if (!t || e.button !== 0) return;
  e.preventDefault(); startGhost(e, { kind: t.dataset.kind, type: t.dataset.type, label: t.innerHTML });
});
stashList.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.x, [contenteditable="true"]')) return;
  const c = e.target.closest('.chip'); if (!c) return;
  e.preventDefault(); startGhost(e, { kind: 'chip', id: c.dataset.id, label: c.innerHTML.replace(/<button[\s\S]*<\/button>/, '') });
});
stashList.addEventListener('click', (e) => { const x = e.target.closest('.x'); if (x) removeIds([x.closest('.chip').dataset.id]); });

// ---- keyboard ------------------------------------------------------------------------------------------------------
const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');
addEventListener('keydown', (e) => {
  document.body.classList.toggle('ctrl', e.ctrlKey || e.metaKey);
  if (edOpen()) { if (e.key === 'Escape' && !e.defaultPrevented) closeEditor(); return; }
  if (typing(e)) return;
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (e.key === ' ') { space = true; vp.classList.add('space'); e.preventDefault(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) removeIds([...sel]);
  else if (mod && key === 'z') { e.preventDefault(); doUndo(); }
  else if (mod && key === 'a') { e.preventDefault(); for (const el of world.querySelectorAll('[data-k]')) sel.add(el.dataset.id); paintSel(); }
  else if (mod && key === 'c' && sel.size) {
    const parts = [];
    for (const id of sel) { const f = find(id); if (f?.k === 'd') parts.push(`— ${f.o.name} —\n${f.o.text || ''}`); else if (f?.k === 'p') parts.push(f.o.text); }
    if (parts.length) { navigator.clipboard.writeText(parts.join('\n\n')); toast(parts.length === 1 ? 'Copiado' : `${parts.length} copiados en uno`); }
  } else if (e.key === 'Escape') { sel.clear(); paintSel(); }
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
let ed = null, curId = null, hist = [], plain = false, level = 0;
const edOpen = () => $('#ed').classList.contains('open');
function tagsInUse() {
  const count = new Map();
  for (const d of S.docs) for (const line of (d.text || '').split('\n')) {
    const m = line.match(TAG_RE); if (m) { const t = m[2].trim(); count.set(t, (count.get(t) || 0) + 1); }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}
const edApi = {
  onChange(text) {
    const d = docById(curId); if (!d || d.text === text) return;
    d.text = text; d.updated = Date.now(); save();
    clearTimeout(edApi.t); edApi.t = setTimeout(backlinks, 500);
  },
  getDocs: () => S.docs.map((d, i) => ({ n: i + 1, name: d.name, icon: T(d.type).icon })),
  getTags: tagsInUse,
  createDoc(name, text = '', o = {}) {
    const d = newDoc({ name, text, place: 'stash' });
    save(); renderStash();
    if (o.announce) toast(`«${name}» creado en la bandeja`, [['Abrir', () => openEditor(d.id)], ['Luego', null]], 6000);
    return N(d);
  },
  openDoc(n) { const d = S.docs[n - 1]; d ? openEditor(d.id) : toast('Ese documento ya no existe'); },
  toast: (m) => toast(m),
  onLevel(l) {
    level = l;
    for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.classList.toggle('on', +b.dataset.l === l);
    $('#ed-fold').classList.toggle('on', l > 0);
  },
};
function openEditor(id, push = true) {
  const d = docById(id); if (!d) return;
  if (curId && push && curId !== id) hist.push(curId);
  curId = id;
  $('#ed').classList.add('open');
  if (!ed) ed = createEditor($('#ed-body'), edApi);
  ed.setDoc(d.text || '');
  ed.setKeep(+$('#ed-keep').value);
  fillHead(); ed.focus();
}
function fillHead() {
  const d = docById(curId); if (!d) return;
  const t = T(d.type);
  $('#ed-ico').textContent = t.icon;
  $('#ed-name').value = d.name;
  $('#ed-n').textContent = '*' + N(d);
  $('#ed-prev').hidden = !hist.length;
  $('.ed-panel').style.setProperty('--c', t.color);
  backlinks();
}
function backlinks() {
  const d = docById(curId); if (!d) return;
  const n = N(d), re = new RegExp(`\\[[^\\[\\]\\n]*?\\*${n}\\]`);
  const from = S.docs.filter((o) => o !== d && re.test(o.text || ''));
  $('#ed-foot').innerHTML = from.length
    ? '<span>Enlazado desde</span>' + from.map((o) => `<button data-id="${o.id}">${T(o.type).icon} ${esc(o.name)} <i>*${N(o)}</i></button>`).join('')
    : '<span>Ctrl+clic en un enlace lo abre · <b>[nombre*]</b> crea un documento nuevo · <b>[</b> busca uno que ya existe · <b>[ETIQUETA]</b> al empezar la línea · <b># Título</b> hace secciones: clic en su # para moverlas</span>';
}
function closeEditor() { $('#ed').classList.remove('open'); curId = null; hist = []; render(); }
$('#ed-close').onclick = closeEditor;
$('.ed-back').onclick = closeEditor;
$('#ed-prev').onclick = () => { const id = hist.pop(); if (id) openEditor(id, false); };
$('#ed-foot').onclick = (e) => { const b = e.target.closest('button[data-id]'); if (b) openEditor(b.dataset.id); };
$('#ed-name').addEventListener('input', (e) => { const d = docById(curId); if (d) { d.name = e.target.value; save(); } });
$('#ed-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
$('#ed-plain').onclick = () => {
  plain = !plain; ed.setPlain(plain);
  $('#ed-plain').classList.toggle('off', plain);
  $('#ed-plain').textContent = plain ? 'Texto plano' : 'Formato';
  $('#ed-lv').classList.toggle('off', plain);
};
for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.onclick = () => ed.setLevel(level === +b.dataset.l ? 0 : +b.dataset.l);
$('#ed-keep').onchange = (e) => ed.setKeep(+e.target.value);
$('#ed-foldall').onclick = () => ed.foldAll(true);
$('#ed-unfoldall').onclick = () => ed.foldAll(false);

load();
