// Meadow: everything is nesting. One kind of thing, the node: it has a title and lives inside another. What it is
// comes from where it is, along one ladder:
//   Proyecto › Marco › Pestaña de marco › (Marco › Pestaña …) › Documento › Pestaña de documento › # › ## › … › líneas
// Dragging a node to another rung converts it, and everything it holds moves the same number of rungs (a # title
// dropped on a frame's tabs becomes a tab; its ## sections become documents; their text goes inside).
// Ideas and tasks hang on any node, or on a line (written in the text).
import { createEditor, LINK_RE, TAG_RE, TOKEN_RE } from './editor.bundle.js';
import { flip, measure, EASE } from './motion.js';

const PASTEL = ['#fff1b8', '#ffd9c2', '#f9d0e3', '#e3d9f7', '#cfe5fb', '#cdeedd', '#e4ebd3', '#eceef2'];
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stage = $('#stage');

// ---- the store ------------------------------------------------------------------------------------------------------
let S = null, rev = 0;
const nd = (id) => S.nodes[id];
let PAR = new Map();                                         // child id → parent id (rebuilt on every change)
function reindex() { PAR = new Map(); for (const n of Object.values(S.nodes)) for (const k of n.kids || []) PAR.set(k, n.id); }
const parent = (id) => nd(PAR.get(id));
const pathOf = (id) => { const p = []; for (let c = nd(id); c; c = parent(c.id)) p.unshift(c); return p; };
const isIn = (id, anc) => { for (let c = id; c; c = PAR.get(c)) if (c === anc) return true; return false; };
const docs = () => Object.values(S.nodes).filter((n) => n.kind === 'doc');
const listOf = (kind) => (kind === 'idea' ? S.ideas : S.tasks);
const token = (it) => `{${it.kind} ${it.n}}`;
function mk(kind, title, extra = {}) {
  const n = { id: uid(), kind, title: title ?? '', kids: [], ...extra };
  if (kind === 'dtab' && n.text == null) n.text = '';
  if (kind === 'doc' && n.n == null) n.n = ++S.seq.doc;
  S.nodes[n.id] = n; return n;
}
function removeTree(id) { const n = nd(id); if (!n) return; for (const k of n.kids) removeTree(k); delete S.nodes[id]; }
function detach(id) { const p = parent(id); if (p) p.kids = p.kids.filter((k) => k !== id); S.drawer = S.drawer.filter((k) => k !== id); }
// a frame always has a tab, a document always a page
function ensureTab(n) {
  if (n.kind === 'frame' && !n.kids.length) n.kids.push(mk('ftab', 'General').id);
  if (n.kind === 'doc' && !n.kids.length) n.kids.push(mk('dtab', 'Página 1').id);
}
const activeTab = (n) => { ensureTab(n); return n.kids.includes(n.active) ? n.active : n.kids[0]; };
const docText = (d) => d.kids.map((k) => nd(k)?.text || '').join('\n');
const docsUsing = (it) => docs().filter((d) => docText(d).includes(token(it)));
const readable = (t) => (t || '')
  .replace(LINK_RE, (m, label) => label)
  .replace(TOKEN_RE, (m, kind, n) => { const it = listOf(kind).find((x) => x.n === +n); return it ? `${kind === 'idea' ? '💡' : it.done ? '☑' : '☐'} ${it.text}` : ''; });

// ---- loading, saving, the old board turned into the tree -------------------------------------------------------------
async function load() {
  const j = await (await fetch('/api/state')).json();
  rev = j.rev || 0;
  const st = j.state;
  if (st?.v === 2) S = st;
  else if (st) { S = migrate(st); save(); setTimeout(() => toast('Tu Meadow ahora es un árbol: marcos, pestañas, documentos. (Hay copia de lo de antes.)', [], 7000), 400); }
  else S = fresh();
  S.ideas ||= []; S.tasks ||= []; S.drawer ||= []; S.seq ||= { idea: 0, tarea: 0, doc: 0 }; S.focus ||= S.root;
  renderAll();
}
function fresh() {
  return { v: 2, root: 'root', focus: 'root', drawer: [], ideas: [], tasks: [], seq: { idea: 0, tarea: 0, doc: 0 }, history: [],
    nodes: { root: { id: 'root', kind: 'project', title: 'GGUF.OS', kids: [] } } };
}
function migrate(o) {
  S = fresh(); S.history = o.history || []; S.ideas = o.ideas || []; S.tasks = o.tasks || [];
  S.seq.idea = o.seq?.idea || 0; S.seq.tarea = o.seq?.tarea || 0;
  const root = S.nodes.root, frames = o.frames || [], area = (f) => f.w * f.h;
  const inside = (a, b) => a !== b && area(a) < area(b) && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const smallestAt = (x, y) => frames.filter((g) => x > g.x && x < g.x + g.w && y > g.y && y < g.y + g.h).sort((p, q) => area(p) - area(q))[0];
  const byYX = (a, b) => (a.y - b.y) || (a.x - b.x);
  const fNode = new Map(), tabNode = new Map();
  for (const f of frames) {
    const n = mk('frame', f.title || 'Marco', { id: f.id, color: f.color });
    const tabs = f.tabs?.length ? f.tabs : [{ id: 'tab-' + f.id, title: '' }];
    tabs.forEach((t, i) => { const tn = mk('ftab', tabs.length === 1 ? 'General' : (i === 0 ? (f.title || 'Pestaña 1') : (t.title || `Pestaña ${i + 1}`))); n.kids.push(tn.id); tabNode.set(t.id, tn); });
    n.active = tabNode.get(f.active)?.id || n.kids[0];
    fNode.set(f.id, n);
  }
  const tabFor = (f, tid) => (tid && tabNode.get(tid)) || nd(fNode.get(f.id).active);
  for (const f of [...frames].sort(byYX)) {
    const p = frames.filter((g) => inside(f, g)).sort((a, b) => area(a) - area(b))[0];
    (p ? tabFor(p, f.ftab?.t).kids : root.kids).push(fNode.get(f.id).id);
  }
  let loose = null;
  const looseTab = () => { if (!loose) { loose = mk('frame', 'Sin marco', { color: PASTEL[7] }); loose.kids.push(mk('ftab', 'General').id); root.kids.push(loose.id); } return nd(loose.kids[0]); };
  const docN = new Map();
  (o.docs || []).forEach((d, i) => {
    const n = mk('doc', d.name || 'Documento', { id: d.id, n: i + 1 });
    const strip = (t) => { const ls = (t || '').split('\n'); const k = ls.findIndex((l) => l.trim()); if (k >= 0 && /^#{1,6}\s+/.test(ls[k]) && ls[k].replace(/^#{1,6}\s+/, '').trim() === (d.name || '').trim()) ls.splice(k, 1); return ls.join('\n').replace(/^\n+/, ''); };
    if (d.book && d.pages?.length) for (const p of d.pages) n.kids.push(mk('dtab', p.title || 'Página', { text: p.id === d.page ? (d.text || '') : (p.text || '') }).id);
    else n.kids.push(mk('dtab', 'Página 1', { text: strip(d.text) }).id);
    n.active = n.kids[0]; docN.set(d.id, n);
  });
  S.seq.doc = (o.docs || []).length;
  for (const d of [...(o.docs || [])].sort(byYX)) {
    const n = docN.get(d.id);
    if (d.place !== 'canvas') { S.drawer.push(n.id); continue; }
    const f = smallestAt(d.x + 100, d.y + 130);
    (f ? tabFor(f, d.ftab?.t) : looseTab()).kids.push(n.id);
  }
  const notes = [...(o.postits || []), ...(o.texts || [])].map((p) => (p.text || '').trim()).filter(Boolean);
  if (notes.length) { const n = mk('doc', 'Notas sueltas'); n.kids.push(mk('dtab', 'Página 1', { text: notes.map((x) => '- ' + x.replace(/\n/g, ' ')).join('\n') }).id); looseTab().kids.push(n.id); }
  const host = (id) => fNode.get(id) || docN.get(id) || null;
  for (const it of [...S.ideas, ...S.tasks]) {
    let at = null;
    if (it.pin?.host) {
      if (it.pin.side === 'desc' && tabNode.get(it.pin.tab)) at = tabNode.get(it.pin.tab).id;
      else at = host(it.pin.host)?.id || null;
      if (!at) { const p = (o.postits || []).find((x) => x.id === it.pin.host); const f = p && smallestAt(p.x + 85, p.y + 75); at = f ? fNode.get(f.id).id : null; }
    } else if (it.dock) at = docN.get(it.dock)?.id || null;
    else if (it.onCanvas) { const f = smallestAt(it.x + 19, it.y + 19); at = f ? fNode.get(f.id).id : 'root'; }
    for (const k of ['pin', 'dock', 'dockAt', 'x', 'y', 'z', 's', 'onCanvas', 'stackOf', 'riding', 'rdx', 'rdy', 'ftab']) delete it[k];
    it.at = at;
  }
  return S;
}
let saveT = null, dirty = false;
function save() { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 400); }
async function flush() {
  saveT = null; if (!dirty) return; dirty = false;
  try {
    const r = await fetch('/api/state?rev=' + rev, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(S) });
    if (r.status === 409) { toast('Meadow ha cambiado en otra pestaña. Recarga esta para seguir.', [['Recargar', () => location.reload()]], 0); return; }
    if (!r.ok) { dirty = true; toast('No se pudo guardar (' + r.status + ')'); return; }
    rev = (await r.json()).rev;
  } catch { dirty = true; toast('No se pudo guardar; reintento en 2 s'); setTimeout(flush, 2000); }
}
addEventListener('beforeunload', () => { if (dirty) navigator.sendBeacon?.('/api/state?rev=' + rev, new Blob([JSON.stringify(S)], { type: 'application/json' })); });

const undo = [];
function snap() { undo.push(JSON.stringify({ nodes: S.nodes, drawer: S.drawer, ideas: S.ideas, tasks: S.tasks, seq: S.seq })); if (undo.length > 80) undo.shift(); }
function doUndo() {
  const s = undo.pop(); if (!s) return toast('Nada que deshacer');
  Object.assign(S, JSON.parse(s)); reindex();
  if (cur && !nd(cur)) closeDoc(); else if (cur) showTab(activeTab(nd(cur)));
  save(); renderAll();
}

// ---- text: titles inside a page, as a tree ---------------------------------------------------------------------------
const HEAD = /^(#{1,6})\s+(.*)$/;
const trimBlank = (s) => s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').replace(/^\n+|\n+$/g, '');
function parseText(text) {                                   // → { body, kids: [{ kind:'h', d, title, body, kids, line }] }
  const root = { d: 0, body: [], kids: [] }, st = [root];
  (text || '').split('\n').forEach((l, i) => {
    const m = l.match(HEAD);
    if (m) { const h = { kind: 'h', d: m[1].length, title: m[2].trim(), body: [], kids: [], line: i + 1 }; while (st.length > 1 && st.at(-1).d >= h.d) st.pop(); st.at(-1).kids.push(h); st.push(h); }
    else st.at(-1).body.push(l);
  });
  const fin = (n) => { n.body = trimBlank(n.body.join('\n')); n.kids.forEach(fin); }; fin(root);
  return root;
}
// G (any node or title) back to text, as titles from depth d down; a frame's or page's only tab adds no level
function serialize(gs, d) {
  const out = [];
  for (const g of gs) {
    if (g.implicit) { if (g.body) out.push(g.body); if (g.kids.length) out.push(serialize(g.kids, d)); continue; }
    out.push('#'.repeat(Math.min(6, d)) + ' ' + (g.title || 'Sin título'));
    if (g.body) out.push(g.body);
    if (g.kids.length) out.push(serialize(g.kids, d + 1));
  }
  return out.join('\n');
}
const joinText = (a, b) => [trimBlank(a || ''), b].filter((x) => x && x.trim()).join('\n');
function toG(id) {
  const n = nd(id);
  if (n.kind === 'dtab') { const p = parseText(n.text); return { kind: 'dtab', title: n.title, body: p.body, kids: p.kids, id }; }
  const g = { kind: n.kind, title: n.title, body: '', kids: n.kids.map(toG), id, color: n.color, n: n.n };
  if ((n.kind === 'frame' || n.kind === 'doc') && g.kids.length === 1) g.kids[0].implicit = true;
  return g;
}
// the section of a title in a page: cut out of the text, as G
function cutHead(tabId, line) {
  const t = nd(tabId), ls = (t.text || '').split('\n'), i = line - 1, m = ls[i]?.match(HEAD); if (!m) return null;
  let j = i + 1; while (j < ls.length) { const h = ls[j].match(HEAD); if (h && h[1].length <= m[1].length) break; j++; }
  const g = parseText(ls.slice(i, j).join('\n')).kids[0];
  ls.splice(i, j - i); t.text = ls.join('\n');
  return { g, from: i + 1, count: j - i };
}
// What a thing becomes inside a parent of each kind
function childKind(pk, g) {
  if (pk === 'project') return 'frame';
  if (pk === 'frame') return 'ftab';
  if (pk === 'ftab') return g.kind === 'frame' || g.kind === 'project' ? 'frame' : 'doc';
  if (pk === 'doc') return 'dtab';
  return 'h';
}
// G made real as a node of this kind; nothing written is ever lost (text with no page to live in becomes a document)
function build(g, kind) {
  const keep = g.id && !S.nodes[g.id] ? { id: g.id } : {};
  const n = mk(kind, g.title || '', { ...keep, ...(g.color ? { color: g.color } : {}), ...(kind === 'doc' && g.kind === 'doc' && g.n && !docs().some((d) => d.n === g.n) ? { n: g.n } : {}) });
  if (kind === 'dtab') { n.text = joinText(g.body, serialize(g.kids, 1)); if (!n.title) n.title = 'Página'; return n.id; }
  const notesDoc = () => { const d = mk('doc', g.title || 'Notas'); d.kids.push(mk('dtab', 'Página 1', { text: g.body }).id); return d.id; };
  if (kind === 'frame') {
    if (!n.title) n.title = 'Marco';
    if (g.kids.length && g.kids.every((k) => k.kind === 'ftab' || k.implicit || k.kind === 'h' || k.kind === 'doc' || k.kind === 'dtab' || k.kind === 'frame')) for (const k of g.kids) n.kids.push(build(k, 'ftab'));
    if (g.body) { ensureTab(n); nd(n.kids[0]).kids.unshift(notesDoc()); }
    ensureTab(n); n.active = n.kids[0];
  } else if (kind === 'ftab') {
    if (!n.title) n.title = 'Pestaña';
    if (g.body) n.kids.push(notesDoc());
    for (const k of g.kids) n.kids.push(build(k, childKind('ftab', k)));
  } else if (kind === 'doc') {
    if (!n.title) n.title = 'Documento';
    if (g.body && g.kids.length) n.kids.push(mk('dtab', 'Inicio', { text: g.body }).id);
    else if (g.body || !g.kids.length) n.kids.push(mk('dtab', 'Página 1', { text: g.body || '' }).id);
    for (const k of g.kids) n.kids.push(build(k, 'dtab'));
    n.active = n.kids[0];
  }
  return n.id;
}
// Take a thing out of where it is, as G (nodes leave the store; their ids come back if they are rebuilt)
function extract(src) {
  if (src.head) { const c = cutHead(src.head.tab, src.head.line); return c && { g: c.g, cut: c, tab: src.head.tab }; }
  const id = src.node; if (!nd(id)) return null;
  const g = toG(id); delete g.implicit; detach(id); removeTree(id);
  return { g };
}
// Put G under a parent, at an index; its kind comes from the parent (unless the slot says it)
function place(g, pid, idx, forced) {
  const P = nd(pid); if (!P) return null;
  const kind = forced || childKind(P.kind, g);
  if (kind === 'h') { P.text = joinText(P.text, serialize([g], 1)); return P.id; }
  const id = build(g, kind);
  P.kids.splice(idx == null ? P.kids.length : Math.min(idx, P.kids.length), 0, id);
  if (kind === 'ftab' || kind === 'dtab') P.active = id;
  return id;
}
// …or under a title of a page (as a subtitle, at the end of that title's section)
function placeUnderHead(g, tabId, line) {
  const t = nd(tabId), ls = (t.text || '').split('\n'), m = ls[line - 1]?.match(HEAD); if (!m) return place(g, tabId);
  let j = line; while (j < ls.length) { const h = ls[j].match(HEAD); if (h && h[1].length <= m[1].length) break; j++; }
  ls.splice(j, 0, serialize([g], m[1].length + 1)); t.text = ls.join('\n'); return tabId;
}
function tidy() {
  reindex();
  for (const n of Object.values(S.nodes)) if (n.kind === 'frame' || n.kind === 'doc') ensureTab(n);
  for (const it of [...S.ideas, ...S.tasks]) if (it.at && !nd(it.at)) it.at = null;
  if (!nd(S.focus) || !['project', 'frame'].includes(nd(S.focus).kind) || (S.focus !== S.root && !PAR.has(S.focus))) S.focus = S.root;
  reindex();
}

// ---- drawing ---------------------------------------------------------------------------------------------------------
const itemsAt = (id) => [...S.tasks, ...S.ideas].filter((t) => t.at === id);
const circles = (id) => { const l = itemsAt(id); return l.length ? `<span class="its">${l.map((it) => `<i class="it ${it.kind}${it.done ? ' done' : ''}" data-it="${it.id}" data-drag="item:${it.id}">${it.kind === 'idea' ? '💡' : it.done ? '✔' : ''}</i>`).join('')}</span>` : ''; };
function frameHTML(id, depth) {
  const f = nd(id), at = activeTab(f), t = nd(at), tabs = f.kids.map(nd);
  const kids = t.kids.map((k) => (nd(k).kind === 'frame' ? (depth < 2 ? frameHTML(k, depth + 1) : stubHTML(k)) : docHTML(k))).join('');
  return `<section class="fr d${depth}" data-id="${id}" style="--bg:${f.color || PASTEL[4]}">
    <div class="fr-head">
      <span class="fr-title" data-drag="${id}" title="Arrastra para moverlo · doble clic: renombrar">${esc(f.title)}</span>
      <span class="fr-tabs" data-drop="tabs" data-id="${id}">${tabs.length > 1 ? tabs.map((x) => `<span class="ft${x.id === at ? ' on' : ''}" data-tab="${x.id}" data-drag="${x.id}" data-id="${x.id}">${esc(x.title)}${x.id === at ? '<button class="ft-x" title="Borrar esta pestaña">×</button>' : ''}</span>`).join('') : ''}<button class="ft-add" title="Nueva pestaña">＋</button></span>
      ${circles(id)}${tabs.length > 1 ? circles(at) : ''}
      <span class="grow"></span>
      <span class="fr-pal">${PASTEL.map((c) => `<i data-c="${c}" style="--d:${c}"></i>`).join('')}</span>
      ${depth || S.focus !== id ? '<button class="fr-in" title="Entrar">⤢</button>' : ''}<button class="fr-x" title="Borrar o guardar en el cajón">×</button>
    </div>
    <div class="fr-body" data-drop="into" data-id="${at}">${kids || '<div class="hint">Vacío · arrastra aquí documentos o marcos</div>'}</div>
  </section>`;
}
const stubHTML = (id) => { const f = nd(id), n = countIn(id); return `<section class="fr stub" data-id="${id}" style="--bg:${f.color || PASTEL[4]}" data-drag="${id}"><div class="fr-head"><span class="fr-title">${esc(f.title)}</span><span class="grow"></span><button class="fr-in" title="Entrar">⤢</button></div><div class="stub-n">${n} dentro</div></section>`; };
const countIn = (id) => { let c = 0; const w = (x) => { for (const k of nd(x).kids) { if (['frame', 'doc'].includes(nd(k).kind)) c++; w(k); } }; w(id); return c; };
function docHTML(id) {
  const d = nd(id), at = activeTab(d), text = nd(at).text || '';
  const prev = readable(text).split('\n').filter((l, i, a) => l.trim() || (i && a[i - 1].trim())).slice(0, 12).join('\n');
  return `<article class="dc" data-id="${id}" data-drag="${id}" data-drop="doc">
    ${d.kids.length > 1 ? `<div class="dc-tabs">${d.kids.map((k) => `<span class="${k === at ? 'on' : ''}">${esc(nd(k).title)}</span>`).join('')}</div>` : ''}
    <h3 class="dc-title" title="Doble clic: renombrar">${esc(d.title)}</h3>
    <div class="dc-prev">${prev ? esc(prev).replace(/^(#{1,6})\s+(.*)$/gm, '<b class="h$1">$2</b>') : '<span class="dc-empty">Página en blanco</span>'}</div>
    ${circles(id)}<button class="dc-x" title="Borrar o guardar en el cajón">×</button>
  </article>`;
}
function renderStage() {
  const f = nd(S.focus);
  const before = measure(stage, '.fr[data-id], .dc[data-id]');
  stage.innerHTML = f.kind === 'project'
    ? `<div class="grid">${f.kids.map((k) => frameHTML(k, 0)).join('')}<div class="fr-new" data-drop="into" data-id="${f.id}"><button class="new-frame">＋ Marco</button></div></div>`
    : `<div class="solo">${frameHTML(f.id, 0)}</div>`;
  if (!skipFlip) flip(stage, before, () => 1, { sel: '.dc[data-id]', appear: false });
}
let skipFlip = false;
function renderTop() {
  const p = pathOf(S.focus);
  $('#crumbs').innerHTML = p.map((n, i) => `${i ? '<span class="sep">›</span>' : ''}<button class="cr${i === p.length - 1 ? ' on' : ''}" data-go="${n.id}" data-drop="into" data-id="${n.kind === 'frame' ? activeTab(n) : n.id}" title="${i === 0 ? 'Doble clic: renombrar el proyecto' : ''}">${esc(n.title)}</button>`).join('');
}
const TOOLS = [['frame', '⬚', 'Marco'], ['doc', '📄', 'Documento'], ['idea', '💡', 'Idea'], ['tarea', '☑️', 'Tarea']];
$('#tools').innerHTML = TOOLS.map(([k, ico, name]) => `<button class="tool t-${k}" data-drag="new:${k}" title="Clic: crear aquí · arrastra: crear donde lo sueltes"><span class="ico">${ico}</span>${name}</button>`).join('');

// the map: every node as a rectangle inside its parent; a frame's (or page's) only tab adds no level
function vtree(id) {
  const n = nd(id);
  if (n.kind === 'dtab') { const p = parseText(n.text); const h = (x) => ({ head: { tab: id, line: x.line }, kind: 'head', title: x.title, kids: x.kids.map(h) }); return { id, kind: 'dtab', title: n.title, kids: p.kids.map(h) }; }
  let kids = n.kids;
  if ((n.kind === 'frame' || n.kind === 'doc') && kids.length === 1) return { id, kind: n.kind, title: n.title, color: n.color, via: kids[0], kids: vtree(kids[0]).kids };
  return { id, kind: n.kind, title: n.title, color: n.color, kids: kids.map(vtree) };
}
const weight = (v) => (v.w ??= v.kids.length ? v.kids.reduce((a, k) => a + weight(k), 0) + 0.3 : 1);
let mapZ = 1, mapX = 0, mapY = 0, mapBig = false;
function renderMap() {
  const box = $('#map'), W = box.clientWidth, H = box.clientHeight, out = [];
  const root = vtree(S.root); weight(root);
  const open = cur ? cur : S.focus;
  const lay = (v, x, y, w, h, depth) => {
    const cls = `mr k-${v.kind}${(v.id && (v.id === open || v.via === open)) ? ' cur' : ''}`;
    const label = w > 26 && h > 11;
    const attrs = v.head ? `data-head="${v.head.tab}:${v.head.line}" data-drag="head:${v.head.tab}:${v.head.line}"` : `data-id="${v.id}"${v.kind !== 'project' ? ` data-drag="${v.id}"` : ''}`;
    out.push(`<div class="${cls}" ${attrs} data-drop="map" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px${v.color ? ';--bg:' + v.color : ''}">${label ? `<b>${esc(v.title)}</b>` : ''}</div>`);
    if (!v.kids.length) return;
    const pad = 2, top = label ? 12 : pad, ix = x + pad, iy = y + top, iw = w - pad * 2, ih = h - top - pad;
    if (iw < 4 || ih < 4) return;
    const horiz = iw >= ih, total = v.kids.reduce((a, k) => a + k.w, 0), gap = 2;
    let off = 0; const span = (horiz ? iw : ih) - gap * (v.kids.length - 1);
    for (const k of v.kids) {
      const s = span * k.w / total;
      if (horiz) lay(k, ix + off, iy, s, ih, depth + 1); else lay(k, ix, iy + off, iw, s, depth + 1);
      off += s + gap;
    }
  };
  lay(root, 4, 4, W - 8, H - 8, 0);
  $('#map-in').innerHTML = `<div class="map-zoom" style="transform:translate(${mapX}px,${mapY}px) scale(${mapZ})">${out.join('')}</div>`;
}
function renderDrawer() {
  $('#dr-n').textContent = S.drawer.length || '';
  const icon = { frame: '⬚', ftab: '▭', doc: '📄', dtab: '📄', project: '⬚' };
  $('#dr-list').innerHTML = S.drawer.length ? S.drawer.map((id) => { const n = nd(id); return n ? `<div class="dr-chip" data-drag="${id}" data-id="${id}"><span>${icon[n.kind]}</span>${esc(n.title)}<button class="dr-x" title="Borrar para siempre">×</button></div>` : ''; }).join('')
    : '<p class="dr-none">Arrastra aquí lo que quieras apartar del árbol.</p>';
}
let listTab = 'tareas';
function nestPath(id) { return id ? pathOf(id).filter((n) => n.kind !== 'project' && !(n.kind === 'ftab' && parent(n.id)?.kids.length === 1) && !(n.kind === 'dtab' && parent(n.id)?.kids.length === 1)).map((n) => n.title).join(' › ') : ''; }
function renderList() {
  const rows = (l) => l.map((it) => `<div class="lrow${it.done ? ' done' : ''}" data-at="${it.at || ''}" data-it="${it.id}">${it.kind === 'idea' ? '<span class="lic">💡</span>' : `<button class="lchk${it.done ? ' on' : ''}" data-chk="${it.id}">${it.done ? '✔' : ''}</button>`}<div><div class="ltx">${esc(it.text) || '…'}</div><div class="lsub">${esc(nestPath(it.at) || (docsUsing(it).length ? 'en «' + docsUsing(it)[0].title + '»' : 'sin sitio'))}</div></div></div>`).join('');
  for (const b of document.querySelectorAll('#list nav button')) b.classList.toggle('on', b.dataset.l === listTab);
  const l = listTab === 'tareas' ? [...S.tasks].sort((a, b) => a.done - b.done) : S.ideas;
  $('#list-body').innerHTML = rows(l) || `<p class="none">${listTab === 'tareas' ? 'Sin tareas. Arrastra «Tarea» a cualquier sitio.' : 'Sin ideas todavía.'}</p>`;
}
function renderAll() { tidy(); renderTop(); renderStage(); renderMap(); renderDrawer(); renderList(); if (cur) renderEdHead(); }

// ---- zooming in and out of frames (the frame grows from where it was / shrinks back to its place) -------------------
function glideFrom(el, r0, ms = 420) {
  if (!el || !r0) return;
  const r1 = el.getBoundingClientRect(); if (!r1.width || !r1.height) return;
  el.animate([{ transformOrigin: '0 0', transform: `translate(${r0.left - r1.left}px,${r0.top - r1.top}px) scale(${r0.width / r1.width},${r0.height / r1.height})`, opacity: .85 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 }], { duration: ms, easing: EASE.smooth });
}
function focusTo(id) {
  let n = nd(id); if (!n) return;
  if (n.kind === 'ftab') { const f = parent(id); f.active = id; n = f; }
  if (n.kind === 'doc' || n.kind === 'dtab') { const d = n.kind === 'dtab' ? parent(id) : n; return openDoc(d.id, n.kind === 'dtab' ? id : null); }
  if (n.id === S.focus) return renderAll();
  const going = n.id, coming = S.focus;
  const r0 = stage.querySelector(`.fr[data-id="${going}"]`)?.getBoundingClientRect();
  const out = isIn(coming, going);                          // going up: the frame we leave shrinks back into place
  const r1 = out ? stage.querySelector(`.solo > .fr`)?.getBoundingClientRect() : null;
  S.focus = going; save(); skipFlip = true; renderAll(); skipFlip = false;
  if (out) glideFrom(stage.querySelector(`.fr[data-id="${coming}"]`), r1);
  else glideFrom(stage.querySelector('.solo > .fr'), r0);
}
function zoomOut() {
  const f = nd(S.focus); if (f.kind === 'project') return;
  const up = pathOf(f.id).slice(0, -1).reverse().find((n) => n.kind === 'frame' || n.kind === 'project');
  focusTo(up.id);
}

// ---- drag and drop: one controller for every thing ------------------------------------------------------------------
let drag = null, justDragged = false;
const ghost = $('#ghost'), bar = $('#drop-bar');
addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const src = e.target.closest('[data-drag]'); if (!src) return;
  if (e.target.closest('button:not([data-drag]), input, [contenteditable="true"], .fr-pal')) return;
  drag = { key: src.dataset.drag, el: src, sx: e.clientX, sy: e.clientY, on: false };
}, true);
function srcOf(key) {
  if (key.startsWith('head:')) { const [, tab, line] = key.split(':'); return { head: { tab, line: +line } }; }
  if (key.startsWith('item:')) return { item: key.slice(5) };
  if (key.startsWith('new:')) return { make: key.slice(4) };
  return { node: key };
}
function labelOf(src) {
  if (src.head) { const l = (nd(src.head.tab)?.text || '').split('\n')[src.head.line - 1] || ''; return l.replace(/^#+\s*/, '# '); }
  if (src.item) { const it = [...S.ideas, ...S.tasks].find((x) => x.id === src.item); return it ? (it.kind === 'idea' ? '💡 ' : '☐ ') + it.text : ''; }
  if (src.make) return { frame: '⬚ Marco nuevo', doc: '📄 Documento nuevo', idea: '💡 Idea nueva', tarea: '☐ Tarea nueva' }[src.make];
  const n = nd(src.node); return n ? ({ frame: '⬚ ', ftab: '▭ ', doc: '📄 ', dtab: '▭ ' }[n.kind] || '') + n.title : '';
}
addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.on = true; drag.src = srcOf(drag.key);
    ghost.textContent = labelOf(drag.src); ghost.classList.add('on'); document.body.classList.add('dragging');
    drag.el.classList.add('lifted'); $('#drawer').classList.add('near');
  }
  Object.assign(ghost.style, { left: e.clientX + 12 + 'px', top: e.clientY + 10 + 'px' });
  drag.t = targetAt(e.clientX, e.clientY);
  paintTarget(drag.t);
});
addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.on) return;
  justDragged = true; setTimeout(() => { justDragged = false; }, 0);
  ghost.classList.remove('on'); document.body.classList.remove('dragging'); d.el.classList.remove('lifted'); $('#drawer').classList.remove('near');
  paintTarget(null);
  if (d.t?.ok) drop(d.src, d.t);
});
// Where a drop would land: { kind, pid, idx, forced, el, ok }
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y); if (!el) return null;
  const src = drag.src;
  if (src.item) { const h = el.closest('[data-id]'); const id = h?.dataset.id; return id && nd(id) ? { kind: 'hang', pid: id, el: h, ok: true } : null; }
  const t = el.closest('[data-drop]'); if (!t) return null;
  const mode = t.dataset.drop, id = t.dataset.id;
  let spec = null;
  if (mode === 'drawer') spec = { kind: 'drawer', el: t };
  else if (mode === 'tabs') spec = { kind: 'place', pid: id, idx: indexByX(t.querySelectorAll('.ft'), x), forced: 'ftab', el: t };
  else if (mode === 'dtabs') spec = { kind: 'place', pid: id, idx: indexByX(t.querySelectorAll('.bt'), x), forced: 'dtab', el: t };
  else if (mode === 'into') spec = { kind: 'place', pid: id, idx: indexInFlow(t, x, y), el: t };
  else if (mode === 'doc') {
    const r = t.getBoundingClientRect(), fx = (x - r.left) / r.width, p = PAR.get(id), i = nd(p)?.kids.indexOf(id);
    spec = fx < 0.25 ? { kind: 'place', pid: p, idx: i, el: t, side: 'l' } : fx > 0.75 ? { kind: 'place', pid: p, idx: i + 1, el: t, side: 'r' } : { kind: 'place', pid: id, forced: 'dtab', el: t };
  } else if (mode === 'map') {
    const r = t.getBoundingClientRect(), labelZone = y - r.top < 12 * mapZ;
    if (t.dataset.head) { const [tab, line] = t.dataset.head.split(':'); spec = { kind: 'head', tab, line: +line, el: t }; }
    else {
      const n = nd(id);
      if (n.kind === 'frame') spec = labelZone ? { kind: 'place', pid: id, forced: 'ftab', el: t } : { kind: 'place', pid: activeTab(n), el: t };
      else if (n.kind === 'doc') spec = labelZone ? { kind: 'place', pid: id, forced: 'dtab', el: t } : { kind: 'place', pid: activeTab(n), el: t };
      else spec = { kind: 'place', pid: id, el: t };
    }
  }
  if (!spec) return null;
  spec.ok = valid(src, spec);
  return spec;
}
function valid(src, t) {
  if (src.make) return t.kind !== 'drawer' && t.kind !== 'head' || src.make === 'doc' || src.make === 'frame';
  const own = src.node || (src.head && src.head.tab);
  if (t.kind === 'place' && src.node && (t.pid === src.node || isIn(t.pid, src.node))) return false;
  if (t.kind === 'head' && src.node && isIn(t.tab, src.node)) return false;
  if (t.kind === 'head' && src.head && src.head.tab === t.tab) { const ls = (nd(t.tab).text || '').split('\n'), m = ls[src.head.line - 1]?.match(HEAD); let j = src.head.line; while (j < ls.length) { const h = ls[j].match(HEAD); if (h && h[1].length <= m[1].length) break; j++; } if (t.line >= src.head.line && t.line <= j) return false; }
  if (t.kind === 'drawer' && src.node && S.drawer.includes(src.node)) return false;
  return !!own || !!src.make;
}
const indexByX = (els, x) => { let i = 0; for (const el of els) { const r = el.getBoundingClientRect(); if (x > r.left + r.width / 2) i++; } return i; };
function indexInFlow(body, x, y) {
  const kids = [...body.children].filter((c) => c.dataset?.id); let i = 0;
  for (const c of kids) { const r = c.getBoundingClientRect(); if (y > r.bottom || (y >= r.top && x > r.left + r.width / 2)) i++; }
  return i;
}
function paintTarget(t) {
  for (const el of document.querySelectorAll('.drop-on, .drop-bad')) el.classList.remove('drop-on', 'drop-bad');
  bar.classList.remove('on');
  if (!t?.el) return;
  t.el.classList.add(t.ok ? 'drop-on' : 'drop-bad');
  if (!t.ok) return;
  // where exactly: a bar between things
  if (t.side) { const r = t.el.getBoundingClientRect(); Object.assign(bar.style, { left: (t.side === 'l' ? r.left - 8 : r.right + 5) + 'px', top: r.top + 'px', width: '3px', height: r.height + 'px' }); bar.classList.add('on'); }
  else if (t.kind === 'place' && t.idx != null && t.el.matches('.fr-body')) {
    const kids = [...t.el.children].filter((c) => c.dataset?.id), k = kids[t.idx] || kids.at(-1);
    if (k) { const r = k.getBoundingClientRect(), after = !kids[t.idx]; Object.assign(bar.style, { left: (after ? r.right + 5 : r.left - 8) + 'px', top: r.top + 'px', width: '3px', height: r.height + 'px' }); bar.classList.add('on'); }
  } else if ((t.forced === 'ftab' || t.forced === 'dtab') && t.idx != null) {
    const chips = t.el.querySelectorAll(t.forced === 'ftab' ? '.ft' : '.bt'), k = chips[t.idx] || chips[chips.length - 1];
    if (k) { const r = k.getBoundingClientRect(), after = !chips[t.idx]; Object.assign(bar.style, { left: (after ? r.right + 2 : r.left - 4) + 'px', top: r.top + 'px', width: '3px', height: r.height + 'px' }); bar.classList.add('on'); }
  }
}
function drop(src, t) {
  snap();
  if (src.item) { const it = [...S.ideas, ...S.tasks].find((x) => x.id === src.item); if (it) it.at = t.pid; save(); renderAll(); return; }
  if (src.make) return makeAt(src.make, t);
  const before = src.node ? nd(src.node)?.kind : 'h';
  const becomes = t.kind === 'head' ? 'h' : t.kind === 'drawer' ? null : (t.forced || childKind(nd(t.pid).kind, { kind: before }));
  if (src.node && t.kind === 'place' && t.idx != null && PAR.get(src.node) === t.pid) { const oi = nd(t.pid).kids.indexOf(src.node); if (oi < t.idx) t.idx--; }
  const ex = extract(src); if (!ex) return;
  let landed = null;
  if (t.kind === 'drawer') { const k = ex.g.kind === 'h' || ex.g.kind === 'dtab' ? 'doc' : ex.g.kind === 'project' ? 'frame' : ex.g.kind; landed = build(ex.g, k); S.drawer.push(landed); }
  else if (t.kind === 'head') {
    let line = t.line;
    if (ex.cut && ex.tab === t.tab && line > ex.cut.from) line -= ex.cut.count;
    landed = placeUnderHead(ex.g, t.tab, line);
  } else {
    // a drop in the same parent after its own old place: the index shifts by one
    landed = place(ex.g, t.pid, t.idx, t.forced);
  }
  tidy();
  const now = becomes;
  if (now && now !== before) toast(`${{ frame: 'Marco', ftab: 'Pestaña', doc: 'Documento', dtab: 'Pestaña', h: 'Título' }[before]} → ${{ frame: 'marco', ftab: 'pestaña de marco', doc: 'documento', dtab: 'pestaña de documento', h: 'título' }[now]}`, [['Deshacer', doUndo]]);
  save(); renderAll();
  if (cur) { if (!nd(cur)) closeDoc(); else showTab(nd(curTab) ? curTab : activeTab(nd(cur))); }
}
// creating: where it was dropped, or (a click) where you are
function makeAt(kind, t) {
  if (kind === 'idea' || kind === 'tarea') {
    const at = t?.kind === 'place' ? (nd(t.pid).kind === 'ftab' ? parent(t.pid).id : t.pid) : t?.kind === 'head' ? t.tab : (cur || S.focus);
    const it = newItem(kind, '', at); save(); renderAll();
    const el = document.querySelector(`[data-it="${it.id}"]`) || $('#tools .t-' + kind);
    popEdit(el, '', (v) => { if (!v) { listOf(kind).splice(listOf(kind).indexOf(it), 1); } else it.text = v; save(); renderAll(); });
    return;
  }
  const g = { kind, title: kind === 'frame' ? 'Marco nuevo' : 'Documento nuevo', body: '', kids: [] };
  let id;
  if (t?.kind === 'head') { placeUnderHead(g, t.tab, t.line); save(); renderAll(); return; }
  if (t?.kind === 'drawer') { id = build(g, kind); S.drawer.push(id); }
  else if (t?.kind === 'place') id = place(g, t.pid, t.idx, t.forced);
  else id = place(g, defaultHome(kind));
  save(); renderAll();
  const el = stage.querySelector(`[data-id="${id}"] .fr-title, .dc[data-id="${id}"] .dc-title`);
  if (el) { el.scrollIntoView({ block: 'nearest' }); editInline(el, (v) => { if (v) { nd(id).title = v; save(); renderAll(); } }); }
}
function defaultHome(kind) {
  const f = nd(S.focus);
  if (kind === 'frame') return f.kind === 'project' ? f.id : activeTab(f);
  if (f.kind === 'frame') return activeTab(f);
  let first = f.kids.map(nd).find((x) => x.kind === 'frame');
  if (!first) { first = mk('frame', 'General'); f.kids.push(first.id); reindex(); }
  return activeTab(first);
}
function newItem(kind, text, at) {
  const n = ++S.seq[kind];
  const it = { id: (kind === 'idea' ? 'i' : 't') + n + '-' + uid().slice(0, 3), kind, n, text, created: Date.now(), done: false, at: at || null };
  listOf(kind).push(it); return it;
}

// ---- clicks on the stage ------------------------------------------------------------------------------------------------
addEventListener('click', (e) => {
  if (justDragged) return;
  const t = e.target;
  const tool = t.closest('#tools .tool'); if (tool) { snap(); return makeAt(tool.dataset.drag.slice(4), null); }
  const go = t.closest('[data-go]'); if (go) return focusTo(go.dataset.go);
  if (t.closest('.new-frame')) { snap(); return makeAt('frame', { kind: 'place', pid: S.root }); }
  const fin = t.closest('.fr-in'); if (fin) return focusTo(fin.closest('.fr').dataset.id);
  const pal = t.closest('.fr-pal i'); if (pal) { snap(); nd(pal.closest('.fr').dataset.id).color = pal.dataset.c; save(); return renderAll(); }
  const ftx = t.closest('.ft-x'); if (ftx) return askDelete(ftx.closest('.ft').dataset.tab, ftx);
  const ft = t.closest('.ft'); if (ft) { const f = nd(ft.closest('.fr').dataset.id); f.active = ft.dataset.tab; save(); return renderAll(); }
  const fta = t.closest('.ft-add'); if (fta) {
    snap(); const f = nd(fta.closest('.fr').dataset.id);
    if (f.kids.length === 1 && nd(f.kids[0]).title === 'General') nd(f.kids[0]).title = f.title;
    const tab = mk('ftab', `Pestaña ${f.kids.length + 1}`); f.kids.push(tab.id); f.active = tab.id; save(); renderAll();
    const el = stage.querySelector(`.ft[data-tab="${tab.id}"]`); if (el) editInline(el.firstChild?.nodeType === 3 ? wrapText(el) : el, (v) => { if (v) { tab.title = v; save(); renderAll(); } });
    return;
  }
  const fx = t.closest('.fr-x'); if (fx) return askDelete(fx.closest('.fr').dataset.id, fx);
  const dx = t.closest('.dc-x'); if (dx) return askDelete(dx.closest('.dc').dataset.id, dx);
  const itc = t.closest('.it'); if (itc) return itemClick(itc.dataset.it, itc);
  const dc = t.closest('.dc'); if (dc && !t.closest('.its')) return openDoc(dc.dataset.id, null, dc);
  const stub = t.closest('.fr.stub'); if (stub) return focusTo(stub.dataset.id);
  const mr = t.closest('.mr'); if (mr) { if (mr.dataset.head) { const [tab, line] = mr.dataset.head.split(':'); const d = parent(tab); openDoc(d.id, tab); setTimeout(() => ed?.gotoLine(+line), 60); } else focusTo(mr.dataset.id); return; }
  const drx = t.closest('.dr-x'); if (drx) { const id = drx.closest('.dr-chip').dataset.id; return askChoice(drx, `¿Borrar «${esc(nd(id).title)}» para siempre?`, 'Sale del cajón y no vuelve (salvo con Deshacer).', [{ label: 'Borrar', danger: true, run: () => { snap(); detach(id); removeTree(id); save(); renderAll(); } }]); }
  const drc = t.closest('.dr-chip'); if (drc) { const n = nd(drc.dataset.id); if (n.kind === 'doc') openDoc(n.id); return; }
  const lchk = t.closest('[data-chk]'); if (lchk) return toggleTask(S.tasks.find((x) => x.id === lchk.dataset.chk));
  const lrow = t.closest('.lrow'); if (lrow) { const it = [...S.ideas, ...S.tasks].find((x) => x.id === lrow.dataset.it); if (it?.at) return focusTo(nd(it.at).kind === 'ftab' ? parent(it.at).id : it.at); const d = it && docsUsing(it)[0]; if (d) openDoc(d.id); return; }
  const lb = t.closest('#list nav button'); if (lb) { listTab = lb.dataset.l; return renderList(); }
});
const wrapText = (el) => { const s = document.createElement('span'); s.textContent = el.firstChild.textContent; el.firstChild.replaceWith(s); return s; };
addEventListener('dblclick', (e) => {
  const t = e.target;
  const ttl = t.closest('.fr-title, .dc-title'); if (ttl) { const id = ttl.closest('[data-id]').dataset.id; return editInline(ttl, (v) => { if (v && v !== nd(id).title) { snap(); nd(id).title = v; save(); } renderAll(); }); }
  const ft = t.closest('.ft'); if (ft) { const id = ft.dataset.tab; return editInline(wrapText(ft), (v) => { if (v && v !== nd(id).title) { snap(); nd(id).title = v; save(); } renderAll(); }); }
  const cr = t.closest('.cr[data-go="' + S.root + '"]'); if (cr) return editInline(cr, (v) => { if (v) { snap(); nd(S.root).title = v; save(); } renderAll(); });
  const it = t.closest('.it'); if (it) { const x = [...S.ideas, ...S.tasks].find((y) => y.id === it.dataset.it); return popEdit(it, x.text, (v) => setItemText(x, v)); }
});
function itemClick(id, el) {
  const it = [...S.ideas, ...S.tasks].find((x) => x.id === id); if (!it) return;
  if (it.kind === 'tarea') return toggleTask(it);
  popEdit(el, it.text, (v) => setItemText(it, v));
}
function setItemText(it, v) {
  if (v == null) return;
  snap();
  if (!v) { if (docsUsing(it).length) it.at = null; else listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1); toast('Quitada', [['Deshacer', doUndo]]); }
  else it.text = v;
  save(); renderAll(); ed?.refresh?.();
}
function toggleTask(it) { if (!it) return; snap(); it.done = !it.done; it.doneAt = it.done ? Date.now() : null; save(); renderAll(); ed?.refresh?.(); }
// Deleting asks when there is something inside; «al cajón» keeps it aside
function askDelete(id, anchor) {
  const n = nd(id); if (!n) return;
  const inside = countIn(id) + (n.kind === 'doc' ? (docText(n).trim() ? 1 : 0) : 0);
  const name = { frame: 'el marco', ftab: 'la pestaña', doc: 'el documento' }[n.kind];
  const drop = () => { snap(); detach(id); removeTree(id); tidy(); save(); renderAll(); toast('Borrado', [['Deshacer', doUndo]]); };
  const aside = () => { snap(); detach(id); const k = n.kind === 'ftab' ? 'ftab' : n.kind; S.drawer.push(id); n.kind = k; tidy(); save(); renderAll(); toast('Al cajón', [['Deshacer', doUndo]]); };
  if (!inside && n.kind !== 'ftab') return drop();
  askChoice(anchor, `¿Qué hago con ${name} «${esc(n.title)}»?`, inside ? 'Tiene cosas dentro.' : '', [
    { label: 'Guardarlo en el cajón', run: aside },
    { label: `Borrar ${name} y todo lo suyo`, danger: true, run: drop },
  ]);
}

// ---- the map: wheel zooms, drag on its empty part pans, double click resets ------------------------------------------
$('#map').addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = $('#map').getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const nz = Math.min(12, Math.max(1, mapZ * Math.exp(-e.deltaY * 0.0015)));
  mapX = px - (px - mapX) * nz / mapZ; mapY = py - (py - mapY) * nz / mapZ; mapZ = nz;
  if (mapZ === 1) { mapX = 0; mapY = 0; }
  $('#map .map-zoom').style.transform = `translate(${mapX}px,${mapY}px) scale(${mapZ})`;
}, { passive: false });
$('#map').addEventListener('dblclick', (e) => { if (e.target.closest('.mr:not(.k-project)')) return; mapZ = 1; mapX = 0; mapY = 0; renderMap(); });
$('#map').addEventListener('pointerdown', (e) => {
  if (e.target.closest('[data-drag], button') || mapZ === 1) return;
  const sx = e.clientX, sy = e.clientY, x0 = mapX, y0 = mapY;
  const mv = (ev) => { mapX = x0 + ev.clientX - sx; mapY = y0 + ev.clientY - sy; $('#map .map-zoom').style.transform = `translate(${mapX}px,${mapY}px) scale(${mapZ})`; };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
$('#map-size').onclick = () => { mapBig = !mapBig; $('#map').classList.toggle('big', mapBig); mapZ = 1; mapX = 0; mapY = 0; setTimeout(renderMap, 260); };
$('#list-btn').onclick = () => $('#list').classList.toggle('closed');
addEventListener('resize', () => renderMap());

// ---- what an idea or a task says, on hover --------------------------------------------------------------------------
let peekT = null;
addEventListener('pointerover', (e) => {
  const el = e.target.closest('.it'); const box = $('#ipeek');
  if (!el || drag?.on) { if (!e.target.closest('#ipeek')) { clearTimeout(peekT); box.classList.remove('on'); } return; }
  clearTimeout(peekT);
  peekT = setTimeout(() => {
    const it = [...S.ideas, ...S.tasks].find((x) => x.id === el.dataset.it); if (!it) return;
    const r = el.getBoundingClientRect();
    box.innerHTML = `<span class="ip-k">${it.kind === 'idea' ? '💡 Idea' : it.done ? '☑ Tarea hecha' : '☐ Tarea'}</span>${esc(it.text || '…')}`;
    Object.assign(box.style, { left: Math.min(innerWidth - 300, Math.max(8, r.left + r.width / 2 - 140)) + 'px', top: r.bottom + 8 + 'px' });
    box.classList.add('on');
  }, 200);
});

// ---- the editor: a document, its tabs (pages), the writing ----------------------------------------------------------
let ed = null, cur = null, curTab = null;
const $ed = $('#ed');
function openDoc(id, tabId, fromEl) {
  const d = nd(id); if (!d) return;
  ensureTab(d);
  cur = id; curTab = tabId && d.kids.includes(tabId) ? tabId : activeTab(d); d.active = curTab;
  if (!ed) ed = createEditor($('#ed-body'), edApi);
  $ed.classList.add('open');
  ed.setDoc(nd(curTab).text || '');
  renderEdHead(); renderMap();
  if (fromEl) glideFrom($('.ed-panel'), fromEl.getBoundingClientRect(), 360);
  ed.focus();
}
function showTab(tabId) { if (!cur) return; const d = nd(cur); curTab = tabId; d.active = tabId; ed.setDoc(nd(tabId).text || ''); renderEdHead(); renderMap(); }
function closeDoc() {
  if (!cur) return;
  const id = cur; cur = null; curTab = null; $ed.classList.remove('open'); save(); renderAll();
  const el = stage.querySelector(`.dc[data-id="${id}"]`); el?.animate([{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 320, easing: EASE.snap });
}
function renderEdHead() {
  const d = nd(cur); if (!d) return;
  $('#ed-name').value = d.title;
  const tint = pathOf(cur).reverse().find((n) => n.kind === 'frame')?.color;
  $ed.classList.toggle('tinted', !!tint); if (tint) $ed.style.setProperty('--tint', tint); else $ed.style.removeProperty('--tint');
  const p = pathOf(cur).slice(0, -1);
  $('#ed-crumbs').innerHTML = p.map((n, i) => `${i ? '<span class="sep">›</span>' : ''}<button class="cr" data-edgo="${n.id}">${esc(n.title)}</button>`).join('');
  $('#ed-tabs').dataset.drop = 'dtabs'; $('#ed-tabs').dataset.id = cur;
  $('#ed-tabs').innerHTML = d.kids.map((k) => `<div class="bt${k === curTab ? ' on' : ''}" data-pg="${k}" data-drag="${k}" data-id="${k}"><span class="bt-t">${esc(nd(k).title)}</span>${k === curTab && d.kids.length > 1 ? '<button class="bt-x" title="Borrar esta pestaña">×</button>' : ''}</div>`).join('')
    + '<button class="bt-add" title="Nueva pestaña">＋</button>';
}
$('#ed-tabs').addEventListener('click', (e) => {
  if (justDragged) return;
  const d = nd(cur); if (!d) return;
  if (e.target.closest('.bt-add')) {
    snap(); const p = mk('dtab', `Página ${d.kids.length + 1}`); d.kids.push(p.id); reindex(); save(); showTab(p.id);
    const t = $(`#ed-tabs .bt[data-pg="${p.id}"] .bt-t`); if (t) editInline(t, (v) => { if (v) { p.title = v; save(); } renderEdHead(); renderMap(); }, true);
    return;
  }
  const x = e.target.closest('.bt-x');
  if (x) {
    const p = nd(curTab), go = () => { snap(); const i = d.kids.indexOf(p.id); d.kids.splice(i, 1); removeTree(p.id); reindex(); save(); showTab(d.kids[Math.max(0, i - 1)]); renderAll(); toast('Pestaña borrada', [['Deshacer', doUndo]]); };
    if (!(p.text || '').trim()) return go();
    return askChoice(x, `¿Borrar la pestaña «${esc(p.title)}»?`, 'Se borra lo que tiene escrito. Las otras no se tocan.', [{ label: 'Borrar la pestaña y su texto', danger: true, run: go }]);
  }
  const t = e.target.closest('.bt'); if (t && t.dataset.pg !== curTab) showTab(t.dataset.pg);
});
$('#ed-tabs').addEventListener('dblclick', (e) => {
  const t = e.target.closest('.bt'); if (!t) return;
  const p = nd(t.dataset.pg); editInline(t.querySelector('.bt-t'), (v) => { if (v && v !== p.title) { snap(); p.title = v; save(); } renderEdHead(); renderMap(); }, true);
});
$('#ed-crumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-edgo]'); if (!b) return; const id = b.dataset.edgo; closeDoc(); focusTo(nd(id).kind === 'ftab' ? parent(id).id : id); });
$('#ed-name').addEventListener('input', (e) => { const d = nd(cur); if (d && e.target.value.trim()) { d.title = e.target.value.trim(); save(); clearTimeout(renderEdHead.t); renderEdHead.t = setTimeout(() => { renderMap(); renderStage(); }, 300); } });
$('#ed-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
$('#ed-close').onclick = closeDoc;
$('.ed-back').onclick = closeDoc;
for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.onclick = () => ed?.setLevel(+b.dataset.l === level ? 0 : +b.dataset.l);
$('#ed-foldall').onclick = () => { const folded = ed?.toggleFoldHeads(); $('#ed-foldall').classList.toggle('on', !!folded); };
$('#ed-plain').onclick = () => { const on = $('#ed-plain').classList.toggle('on'); ed?.setPlain(!on); };
$('#toc-list').addEventListener('click', (e) => { if (justDragged) return; const b = e.target.closest('.toc'); if (b) ed?.gotoLine(+b.dataset.line); });
let level = 0;
const edApi = {
  onChange(text) {
    const t = nd(curTab); if (!t || t.text === text) return;
    t.text = text; save();
    clearTimeout(edApi.t); edApi.t = setTimeout(() => { renderMap(); renderStage(); }, 500);
  },
  getDocs: () => docs().map((d) => ({ n: d.n, name: d.title, icon: '📄' })),
  getTags() {
    const count = new Map();
    for (const d of docs()) for (const line of docText(d).split('\n')) { const m = line.match(TAG_RE); if (m) { const t = m[2].trim(); count.set(t, (count.get(t) || 0) + 1); } }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  },
  getItem: (kind, n) => listOf(kind).find((x) => x.n === n),
  getItems: () => [...S.tasks.filter((t) => !t.done), ...S.ideas, ...S.tasks.filter((t) => t.done)],
  createItem(kind, text) { const it = newItem(kind, text, null); save(); renderList(); return it.n; },
  toggleTask(n) { toggleTask(S.tasks.find((x) => x.n === n)); },
  editItem(kind, n, el) { const it = listOf(kind).find((x) => x.n === n); if (it) popEdit(el, it.text, (v) => setItemText(it, v)); },
  createDoc(name, text = '', o = {}) {
    const p = PAR.get(cur), d = mk('doc', name); d.kids.push(mk('dtab', 'Página 1', { text }).id);
    if (p) { const P = nd(p); P.kids.splice(P.kids.indexOf(cur) + 1, 0, d.id); } else S.drawer.push(d.id);
    reindex(); save(); renderAll();
    if (o.announce) toast(`«${name}» creado al lado`, [['Abrir', () => openDoc(d.id)]], 6000);
    return d.n;
  },
  openDoc(n) { const d = docs().find((x) => x.n === n); d ? openDoc(d.id) : toast('Ese documento ya no existe'); },
  toast: (m) => toast(m),
  onOutline(heads, current) {
    $('#toc-list').innerHTML = heads.length
      ? heads.map((h) => `<button class="toc d${Math.min(h.d, 3)}${h.line === current ? ' on' : ''}" data-line="${h.line}" data-drag="head:${curTab}:${h.line}" title="Clic: ir · arrastra: llevarlo a otro sitio (se convierte)">${esc(h.text)}</button>`).join('')
      : '<p class="none">Escribe <b># Título</b> para dividir la página en secciones; aparecerán aquí, y podrás arrastrarlas a otro sitio.</p>';
  },
  onLevel(l) { level = l; for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.classList.toggle('on', +b.dataset.l === l); },
};

// ---- small shared pieces --------------------------------------------------------------------------------------------
function toast(msg, actions = [], ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 280); };
  for (const [label, fn] of actions) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn?.(); close(); }; el.append(b); }
  $('#toasts').append(el); requestAnimationFrame(() => el.classList.add('in'));
  if (ms) setTimeout(close, ms);
}
function editInline(el, onDone, allowEmpty = false) {
  const before = el.textContent;
  el.contentEditable = 'true'; el.focus();
  const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true; el.contentEditable = 'false';
    const v = el.textContent.replace(/\s+/g, ' ').trim();
    if (!ok) { el.textContent = before; return onDone(null); }
    if (!v && !allowEmpty) { el.textContent = before; return onDone(null); }
    onDone(v);
  };
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
  el.addEventListener('blur', () => finish(true), { once: true });
}
function popEdit(anchor, value, onDone) {
  const r = anchor.getBoundingClientRect();
  const box = document.createElement('input'); box.className = 'pop'; box.value = value || ''; box.placeholder = 'Escribe… (vacío: quitar)';
  Object.assign(box.style, { left: Math.min(innerWidth - 300, r.left) + 'px', top: r.bottom + 6 + 'px' });
  document.body.append(box); box.focus(); box.select();
  let done = false;
  const end = (ok) => { if (done) return; done = true; box.remove(); if (ok) onDone(box.value.trim()); };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') end(true); if (e.key === 'Escape') { e.stopPropagation(); end(false); } });
  box.addEventListener('blur', () => end(true));
}
function askChoice(anchor, title, note, options) {
  const pop = $('#pick'), r = anchor.getBoundingClientRect();
  pop.innerHTML = `<div class="pk-h">${title}</div>${note ? `<p class="pk-note">${note}</p>` : ''}<div class="pk-opts">${options.map((o, i) => `<button class="pk-opt${o.danger ? ' danger' : ''}" data-i="${i}">${o.label}</button>`).join('')}<button class="pk-opt cancel">Cancelar</button></div>`;
  Object.assign(pop.style, { left: Math.min(innerWidth - 330, Math.max(8, r.left - 20)) + 'px', top: Math.min(innerHeight - 220, r.bottom + 8) + 'px' });
  pop.classList.add('on');
  pop.onclick = (e) => { const b = e.target.closest('.pk-opt'); if (!b) return; pop.classList.remove('on'); if (b.dataset.i != null) options[+b.dataset.i].run(); };
}
addEventListener('pointerdown', (e) => { if (!e.target.closest('#pick')) $('#pick').classList.remove('on'); }, true);

// ---- keys -------------------------------------------------------------------------------------------------------------
addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, [contenteditable="true"], .cm-editor');
  if (e.key === 'Escape') {
    if ($('#pick').classList.contains('on')) return $('#pick').classList.remove('on');
    if (document.querySelector('.pop')) return;
    if (cur) { e.preventDefault(); return closeDoc(); }
    if (!typing) return zoomOut();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && !cur) { e.preventDefault(); doUndo(); }
});

window.meadow = { get S() { return S; } };   // for tests and the console
load();
