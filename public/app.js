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
const P = new URLSearchParams(location.search).get('p');
const nd = (id) => S.nodes[id];
let PAR = new Map();                                         // child id → parent id (rebuilt on every change)
function reindex() { PAR = new Map(); for (const n of Object.values(S.nodes)) for (const k of n.kids || []) PAR.set(k, n.id); }
const parent = (id) => nd(PAR.get(id));
const pathOf = (id) => { const p = []; for (let c = nd(id); c; c = parent(c.id)) p.unshift(c); return p; };
const isIn = (id, anc) => { for (let c = id; c; c = PAR.get(c)) if (c === anc) return true; return false; };
const docs = () => Object.values(S.nodes).filter((n) => n.kind === 'doc');
const listOf = (kind) => (kind === 'idea' ? S.ideas : S.tasks);
// what each one is (said where you meet them)
const DEF = { tarea: 'Tarea: algo que hay que hacer fuera de Meadow.', idea: 'Idea: algo que se podría hacer más adelante en el propio Meadow (ampliar una definición, una información…).' };
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
  if (!P) return showHome();
  const r = await fetch('/api/state?p=' + encodeURIComponent(P)); if (!r.ok) return showHome('Ese proyecto ya no está en la lista.');
  const j = await r.json();
  document.title = (j.project?.name || 'Meadow') + ' · Meadow';
  fetch('/api/projects/opened', { method: 'POST', body: JSON.stringify({ id: P }) });
  rev = j.rev || 0;
  const st = j.state;
  if (st?.v === 2) S = st;
  else if (st) { S = migrate(st); save(); setTimeout(() => toast('Tu Meadow ahora es un árbol: marcos, pestañas, documentos. (Hay copia de lo de antes.)', [], 7000), 400); }
  else S = fresh();
  S.ideas ||= []; S.tasks ||= []; S.drawings ||= []; S.drawer ||= []; S.seq ||= { idea: 0, tarea: 0, doc: 0 }; S.focus ||= S.root;
  ensureAreas();
  renderAll();
}
function ensureAreas() {
  const root = nd(S.root);
  if (root.kids.length && root.kids.every((k) => nd(k)?.kind === 'area' || nd(k)?.kind === 'doc')) return;
  const frames = root.kids.filter((k) => nd(k)?.kind !== 'area' && nd(k)?.kind !== 'doc'), areas = root.kids.filter((k) => nd(k)?.kind === 'area');
  if (!areas.length) { const g = mk('area', 'General'); g.kids.push(...frames); root.kids = [g.id]; S.area = g.id; } else { nd(areas[0]).kids.push(...frames); root.kids = areas; }
  save();
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
    const r = await fetch('/api/state?p=' + encodeURIComponent(P) + '&rev=' + rev, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(S) });
    if (r.status === 409) { toast('Meadow ha cambiado en otra pestaña. Recarga esta para seguir.', [['Recargar', () => location.reload()]], 0); return; }
    if (!r.ok) { dirty = true; toast('No se pudo guardar (' + r.status + ')'); return; }
    rev = (await r.json()).rev;
  } catch { dirty = true; toast('No se pudo guardar; reintento en 2 s'); setTimeout(flush, 2000); }
}
addEventListener('beforeunload', () => { if (dirty) navigator.sendBeacon?.('/api/state?p=' + encodeURIComponent(P) + '&rev=' + rev, new Blob([JSON.stringify(S)], { type: 'application/json' })); });

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
// Areas can hold areas (a column more on the left), up to MAXCOLS levels; a group remembers which one was open
const MAXCOLS = 4;
const isGroup = (n) => n?.kind === 'area' && n.kids.some((k) => nd(k)?.kind === 'area');
function leafOf(id) {
  let n = nd(id);
  while (isGroup(n)) n = nd(nd(n.active)?.kind === 'area' && n.kids.includes(n.active) ? n.active : n.kids.find((k) => nd(k)?.kind === 'area'));
  return n.id;
}
const areaDepth = (id) => { const subs = nd(id).kids.filter((k) => nd(k)?.kind === 'area'); return subs.length ? 1 + Math.max(...subs.map(areaDepth)) : 1; };
const colsDepth = () => Math.max(1, ...nd(S.root).kids.filter((k) => nd(k)?.kind === 'area').map(areaDepth));
// What a thing becomes inside a parent of each kind
function childKind(pk, g) {
  if (pk === 'project') return 'area';
  if (pk === 'area') return g.kind === 'doc' || g.kind === 'dtab' || g.kind === 'h' ? 'doc' : 'frame';
  if (pk === 'frame') return 'ftab';
  if (pk === 'ftab') return g.kind === 'frame' || g.kind === 'project' || g.kind === 'area' ? 'frame' : 'doc';
  if (pk === 'doc') return 'dtab';
  return 'h';
}
// G made real as a node of this kind; nothing written is ever lost (text with no page to live in becomes a document)
function build(g, kind) {
  const keep = g.id && !S.nodes[g.id] ? { id: g.id } : {};
  const n = mk(kind, g.title || '', { ...keep, ...(g.color ? { color: g.color } : {}), ...(kind === 'doc' && g.kind === 'doc' && g.n && !docs().some((d) => d.n === g.n) ? { n: g.n } : {}) });
  if (kind === 'dtab') { n.text = joinText(g.body, serialize(g.kids, 1)); if (!n.title) n.title = 'Página'; return n.id; }
  const notesDoc = () => { const d = mk('doc', g.title || 'Notas'); d.kids.push(mk('dtab', 'Página 1', { text: g.body }).id); return d.id; };
  if (kind === 'area') {
    if (!n.title) n.title = 'Apartado';
    for (const k of g.kids) n.kids.push(build(k, k.kind === 'area' ? 'area' : 'frame'));
    if (g.body) { const f = mk('frame', 'Notas'); f.kids.push(mk('ftab', 'General').id); nd(f.kids[0]).kids.push(notesDoc()); n.kids.unshift(f.id); }
    return n.id;
  }
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
  let P = nd(pid); if (!P) return null;
  if (isGroup(P) && g.kind !== 'area' && !forced) { P = nd(leafOf(P.id)); idx = null; }   // frames go to the open area inside
  const kind = forced || (isGroup(P) && g.kind === 'area' ? 'area' : childKind(P.kind, g));
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
  for (const a of Object.values(S.nodes)) if (a.kind === 'area' && isGroup(a) && a.kids.some((k) => !['area', 'doc'].includes(nd(k)?.kind))) {
    const loose = a.kids.filter((k) => !['area', 'doc'].includes(nd(k)?.kind)), g = mk('area', 'General'); g.kids = loose;
    a.kids = [g.id, ...a.kids.filter((k) => ['area', 'doc'].includes(nd(k)?.kind))];
  }
  reindex();
  if (S.nodes[S.root] && !nd(S.root).kids.some((k) => nd(k)?.kind === 'area')) { const g = mk('area', 'General'); nd(S.root).kids.push(g.id); reindex(); }
  for (const n of Object.values(S.nodes)) if (n.kind === 'frame' || n.kind === 'doc') ensureTab(n);
  for (const it of [...S.ideas, ...S.tasks]) if (it.at && !nd(it.at)) it.at = null;
  if (nd(S.area)?.kind === 'area' && PAR.has(S.area)) S.area = leafOf(S.area);
  else { const a0 = nd(S.root).kids.find((k) => nd(k)?.kind === 'area'); S.area = a0 ? leafOf(a0) : null; }
  if (!nd(S.focus) || !['project', 'area', 'frame'].includes(nd(S.focus).kind) || (S.focus !== S.root && !PAR.has(S.focus))) S.focus = S.area || S.root;
  if (S.focus === S.root && S.area) S.focus = S.area;
  if (isGroup(nd(S.focus))) S.focus = leafOf(S.focus);
  const ars = pathOf(S.focus).filter((n) => n.kind === 'area'); if (ars.length) S.area = ars.at(-1).id;
  for (const a of pathOf(S.area)) { const p = nd(PAR.get(a.id)); if (p?.kind === 'area') p.active = a.id; }
  reindex();
}

// ---- drawing ---------------------------------------------------------------------------------------------------------
const itemsAt = (id) => [...S.tasks, ...S.ideas].filter((t) => t.at === id);
const circles = (id) => { const l = itemsAt(id); return l.length ? `<span class="its">${l.map((it) => `<i class="it ${it.kind}${it.done ? ' done' : ''}${' st-' + stOf(it) + (whoOf(it.who) === 'Agente' ? ' agent' : '') + (it.kind === 'tarea' && stOf(it) === 'bloqueada' && activeBlockers(it).length ? ' dep' : '')}" data-it="${it.id}" data-drag="item:${it.id}">${it.kind === 'idea' ? '💡' : ''}</i>`).join('')}</span>` : ''; };
function frameHTML(id, depth) {
  const f = nd(id), at = activeTab(f), t = nd(at), tabs = f.kids.map(nd);
  const kids = t.kids.map((k) => (nd(k).kind === 'frame' ? (depth < 2 ? frameHTML(k, depth + 1) : stubHTML(k)) : docHTML(k))).join('');
  return `<section class="fr d${depth}" data-id="${id}" style="--bg:${f.color || PASTEL[4]}">
    <div class="fr-head">
      <span class="fr-title${tabs.length > 1 && at === tabs[0].id ? ' on' : ''}" data-drag="${id}" data-tab0="${tabs[0].id}" title="${tabs.length > 1 ? 'Clic: su primera pestaña · ' : ''}Arrastra para moverlo · doble clic: renombrar">${esc(f.title)}</span>${nb(id)}${tabs.length > 1 && at === tabs[0].id ? `<button class="fr-tx" data-tab0="${tabs[0].id}" title="Borrar esta pestaña (la siguiente pasa a ser la primera)">×</button>` : ''}
      <span class="fr-tabs" data-drop="tabs" data-id="${id}">${tabs.length > 1 ? tabs.slice(1).map((x) => `<span class="ft${x.id === at ? ' on' : ''}" data-tab="${x.id}" data-drag="${x.id}" data-id="${x.id}">${esc(x.title)}${nb(x.id)}${x.id === at ? '<button class="ft-x" title="Borrar esta pestaña">×</button>' : ''}</span>`).join('') : ''}<button class="ft-add" title="Nueva pestaña">＋</button></span>
      ${circles(id)}${tabs.length > 1 ? circles(at) : ''}${thumbs(id)}
      <span class="grow"></span>
      <span class="fr-pal">${PASTEL.map((c) => `<i data-c="${c}" style="--d:${c}"></i>`).join('')}</span>
      ${depth || S.focus !== id ? '<button class="fr-in" title="Entrar">⤢</button>' : '<button class="fr-out" title="Salir (Esc)">⤡ Salir</button>'}<button class="fr-x" title="Borrar o guardar en el cajón">×</button>
    </div>
    <div class="fr-body" data-drop="into" data-id="${at}">${kids || '<div class="hint">Vacío · arrastra aquí documentos o marcos</div>'}</div>
  </section>`;
}
const stubHTML = (id) => { const f = nd(id), n = countIn(id); return `<section class="fr stub" data-id="${id}" style="--bg:${f.color || PASTEL[4]}" data-drag="${id}"><div class="fr-head"><span class="fr-title">${esc(f.title)}</span><span class="grow"></span><button class="fr-in" title="Entrar">⤢</button></div><div class="stub-n">${n} dentro</div></section>`; };
function nIn(id) {
  const n = nd(id); if (!n) return 0;
  const titles = (t) => ((t || '').match(/^#{1,6}\s/gm) || []).length;
  // only what leads to a document counts: a chain of containers with nothing at the end is 0
  const full = (k) => { const x = nd(k); return !!x && (x.kind === 'doc' || x.kids.some(full)); };
  if (n.kind === 'frame') return n.kids.length > 1 ? n.kids.filter(full).length : (nd(n.kids[0])?.kids.filter(full).length || 0);
  if (n.kind === 'doc') return n.kids.length > 1 ? n.kids.length : titles(nd(n.kids[0])?.text);
  if (n.kind === 'dtab') return titles(n.text);
  return n.kids.filter(full).length;
}
const nb = (id) => { const k = nIn(id); return k ? `<i class="nb" title="${k} dentro">${k}</i>` : ''; };
const countIn = (id) => { let c = 0; const w = (x) => { for (const k of nd(x).kids) { if (['frame', 'doc'].includes(nd(k).kind)) c++; w(k); } }; w(id); return c; };
function docHTML(id) {
  const d = nd(id), at = activeTab(d), text = nd(at).text || '';
  const prev = readable(text).split('\n').filter((l, i, a) => l.trim() || (i && a[i - 1].trim())).slice(0, 12).join('\n');
  const many = d.kids.length > 1;          // with tabs: its name, and its tabs right under it (what each holds stays inside)
  return `<article class="dc${many ? ' many' : ''}" data-id="${id}" data-drag="${id}" data-drop="doc">
    <h3 class="dc-title" title="Doble clic: renombrar">${esc(d.title)}${nb(id)}</h3>
    ${many ? `<div class="dc-tabs">${d.kids.map((k) => `<span data-pg="${k}" class="${k === at ? 'on' : ''}">${esc(nd(k).title)}${nb(k)}</span>`).join('')}</div>`
      : `<div class="dc-prev">${prev ? esc(prev).replace(/^(#{1,6})\s+(.*)$/gm, '<b class="h$1">$2</b>') : '<span class="dc-empty">Página en blanco</span>'}</div>`}
    ${thumbs(id)}${circles(id)}<button class="dc-x" title="Borrar o guardar en el cajón">×</button>
  </article>`;
}
function renderStage() {
  const f = nd(S.focus);
  const before = measure(stage, '.fr[data-id], .dc[data-id]');
  stage.innerHTML = f.kind === 'project' || f.kind === 'area'
    ? `<div class="grid" data-drop="into" data-id="${f.id}">${itemsAt(f.id).length ? `<div class="loose-its" data-id="${f.id}">${circles(f.id)}</div>` : ''}${f.kids.map((k) => (nd(k).kind === 'doc' ? docHTML(k) : frameHTML(k, 0))).join('')}<div class="fr-new" data-drop="into" data-id="${f.id}"><button class="new-frame">＋ Marco</button></div></div>`
    : `<div class="solo">${frameHTML(f.id, 0)}</div>`;
  if (!skipFlip) flip(stage, before, () => 1, { sel: '.dc[data-id]', appear: false });
}
let skipFlip = false;
let arPeek = null, arPids = [], arHtml = '';
const COLBG = ['#d9c9e2', '#e4d6eb', '#efe5f3', '#fdfbfe'];   // outer columns darker, the one you are in the lightest
const SCALES = ['#f7e4ec', '#e3edf9', '#e5f3e4', '#f9eedb', '#ece3f7', '#dff2f0'];
function renderAreas(peek) {
  const ids = (x) => pathOf(x).filter((n) => n.kind === 'area').map((n) => n.id);
  const real = ids(S.area), chain = peek && nd(peek) ? ids(leafOf(peek)) : real, cols = [];
  const depth = colsDepth();
  for (let lv = 0, pid = S.root; ; lv++) {
    cols.push({ pid, ids: nd(pid).kids.filter((k) => nd(k)?.kind === 'area' || (nd(k)?.kind === 'doc' && (pid === S.root || isGroup(nd(pid)) || !nd(pid).kids.some((x) => nd(x)?.kind === 'frame')))) });
    const nx = chain[lv]; if (!nx || lv + 1 >= depth) break; pid = nx;   // always as many columns as levels: an area with none inside shows an empty one
  }
  const btn = (k, i) => { const a = nd(k), g = isGroup(a); if (a.kind === 'doc') return `<div role="button" tabindex="0" class="ar ar-doc" data-area="${k}" data-id="${k}" data-drag="${k}" data-drop="area" title="Clic: abrirlo · doble clic: renombrar"><span class="ar-dico">📄</span><span class="ar-t">${esc(a.title)}</span>${nb(k)}<b class="ar-x" title="Borrar el documento o guardarlo en el cajón">×</b></div>`; return `<div role="button" tabindex="0" style="--sc:${SCALES[i % SCALES.length]};z-index:${40 - i}" class="ar${k === S.area ? ' on' : real.includes(k) ? ' path' : chain.includes(k) ? ' peek' : ''}${g ? ' grp' : ''}" data-area="${k}" data-id="${k}" data-drag="${k}" data-drop="area" title="Doble clic: renombrar · arrastra para ordenarlo"><i class="ar-sel" title="Elegir para el contexto"></i><span class="ar-t">${esc(a.title)}</span>${nb(k)}<b class="ar-x" title="Borrar el apartado (lo de dentro puede quedarse)">×</b></div>`; };
  const wrap = colsDepth() < MAXCOLS ? '<button class="ar-wrap" title="Columna encima: mete estos apartados dentro de uno nuevo (hasta 4 columnas)"></button>' : '';
  const html = cols.map((c, lv) => `<div style="z-index:${lv + 1};--cb:${COLBG[Math.max(0, COLBG.length - cols.length + lv)]}" class="ar-col${lv === cols.length - 1 ? ' last' : ''}${arPids[lv] && arPids[lv] !== c.pid ? ' in' : ''}">${lv < cols.length - 1 ? `<div class="ar-strip">${lv === 0 && wrap ? '<i class="ar-tab-add"></i>' : ''}${c.ids.map((k, i) => `<span class="ar-tab${real.includes(k) ? ' on' : chain.includes(k) ? ' peek' : ''}${nd(k).kind === 'doc' ? ' doc' : ''}" style="--sc:${SCALES[i % SCALES.length]}"><b>${esc(nd(k).title)}</b>${nb(k)}</span>`).join('')}</div>` : ''}${lv === 0 ? wrap : ''}${c.ids.map(btn).join('')}<span class="ar-adds"><button class="ar-add" data-pid="${c.pid}" title="Nuevo apartado en esta columna">＋ Apartado</button><button class="ar-adddoc" data-pid="${c.pid}" title="Un documento en esta columna">＋ 📄</button></span>${lv < cols.length - 1 ? `<button class="ar-dis" data-lv="${lv}" title="Sus apartados desaparecen y lo que tienen dentro se junta aquí">Quitar esta columna</button>` : ''}</div>`).join('');
  if (arHtml !== html) { arHtml = html; $('#areas').innerHTML = html; paintHov(); }   // unchanged: leave it (keeps hover, double clicks)
  arPids = cols.map((c) => c.pid);
  if (!peek) document.documentElement.style.setProperty('--areas-w', (cols.length - 1) * 48 + 172 + 'px');   // folded strips + the open column, whatever is hovered
}
// hovering a folded column opens it to read; only a click chooses. The hover is kept by hand so a redraw (after a
// click) does not fold and reopen it
let arHov = -1;
const paintHov = () => document.querySelectorAll('#areas .ar-col').forEach((c, i) => c.classList.toggle('hov', i === arHov));
let arShut = -1;   // a column folded by a click stays folded until the pointer goes to another one
$('#areas').addEventListener('pointermove', (e) => { const c = e.target.closest('.ar-col'); let i = c ? [...c.parentNode.children].indexOf(c) : -1; if (!c) return; if (c.classList.contains('last')) i = -1; else if (i !== arShut) arShut = -1; if (i === arShut && i !== -1) return; if (i !== arHov) { arHov = i; paintHov(); } });
$('#areas').addEventListener('pointerleave', () => { arHov = -1; arShut = -1; paintHov(); });
function renderTop() {
  const p = pathOf(S.focus);
  $('#crumbs').innerHTML = p.map((n, i) => `${i ? '<span class="sep">›</span>' : ''}<button class="cr${i === p.length - 1 ? ' on' : ''}" data-go="${n.id}" data-drop="into" data-id="${n.kind === 'frame' ? activeTab(n) : n.id}" title="${i === 0 ? 'Doble clic: renombrar el proyecto' : ''}">${esc(n.title)}</button>`).join('');
}
const TOOLS = [['frame', '⬚', 'Marco'], ['doc', '📄', 'Documento'], ['idea', '💡', 'Idea'], ['tarea', '☑️', 'Tarea'], ['dibujo', '🖍', 'Dibujo']];
$('#tools').innerHTML = TOOLS.map(([k, ico, name]) => `<button class="tool t-${k}" data-drag="new:${k}" title="${k === 'tarea' || k === 'idea' ? DEF[k].replace(/'/g, '') + ' ' : ''}Clic: crear aquí · arrastra: crear donde lo sueltes"><span class="ico">${ico}</span>${name}</button>`).join('');

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
  const box = $('#map'); if (box.classList.contains('mini')) { $('#map-in').innerHTML = ''; return; }
  const W = box.clientWidth, H = box.clientHeight, out = [];
  const root = vtree(S.root); weight(root);
  const open = cur ? cur : S.focus;
  const lay = (v, x, y, w, h, depth) => {
    const whole = v.kind === 'project';
    const cls = `mr k-${v.kind}${(v.id && (v.id === open || v.via === open)) ? ' cur' : ''}`;
    const label = w > 30 && h > 15;
    const attrs = v.head ? `data-head="${v.head.tab}:${v.head.line}" data-drag="head:${v.head.tab}:${v.head.line}"` : `data-id="${v.id}"${v.kind !== 'project' ? ` data-drag="${v.id}"` : ''}`;
    if (!whole) out.push(`<div class="${cls}" ${attrs} data-drop="map" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px${v.color ? ';--bg:' + v.color : ''}">${label ? `<b>${esc(v.title)}</b>` : ''}</div>`);
    if (!v.kids.length) return;
    const pad = whole ? 0 : 3, top = whole ? 0 : label ? 15 : pad, ix = x + pad, iy = y + top, iw = w - pad * 2, ih = h - top - pad;
    if (iw < 4 || ih < 4) return;
    const horiz = iw >= ih, total = v.kids.reduce((a, k) => a + k.w, 0), gap = 2;
    let off = 0; const span = (horiz ? iw : ih) - gap * (v.kids.length - 1);
    for (const k of v.kids) {
      const s = span * k.w / total;
      if (horiz) lay(k, ix + off, iy, s, ih, depth + 1); else lay(k, ix, iy + off, iw, s, depth + 1);
      off += s + gap;
    }
  };
  lay(root, 6, 6, W - 12, H - 12, 0);
  $('#map-in').innerHTML = `<div class="map-zoom" style="transform:translate(${mapX}px,${mapY}px) scale(${mapZ})">${out.join('')}</div>`;
}
function renderDrawer() {
  $('#dr-n').textContent = S.drawer.length || '';
  const icon = { area: '▤', frame: '⬚', ftab: '▭', doc: '📄', dtab: '📄', project: '⬚' };
  const KIND = { area: 'Apartado', frame: 'Marco', ftab: 'Pestaña', doc: 'Documento', dtab: 'Página', project: 'Marco' };
  const rows = S.drawer.map((id) => { const n = nd(id); if (!n) return ''; const c = countIn(id);
    return `<div class="dr-chip" data-drag="${id}" data-id="${id}"><span class="dr-ico k-${n.kind}">${icon[n.kind]}</span><span class="dr-t"><b>${esc(n.title)}</b><small>${KIND[n.kind]}${c ? ' · ' + c + ' dentro' : ''}</small></span><button class="dr-x" title="Borrar para siempre">×</button></div>`; }).join('');
  $('#dr-list').innerHTML = `<div class="dr-h"><b>Cajón</b>${S.drawer.length ? '<button class="dr-empty">Vaciar</button>' : ''}</div>`
    + (rows ? `<div class="dr-rows">${rows}</div>` : '<div class="dr-none"><span class="dr-big">🗄</span>Arrastra aquí lo que quieras apartar; vuelve a sacarlo cuando quieras.</div>');
}
function nestPath(id) { return id ? pathOf(id).filter((n) => n.kind !== 'project' && !(n.kind === 'ftab' && parent(n.id)?.kids.length === 1) && !(n.kind === 'dtab' && parent(n.id)?.kids.length === 1)).map((n) => n.title).join(' › ') : ''; }
// ---- the list of tasks or ideas: search, where (everything, here, one container or page), state, for whom; flat or nested
let listTab = 'tareas', listWho = 'Todas', listScope = null, listQ = '', listNested = false, listWQ = '';
const PLACE_ICO = { area: '▤', frame: '⬚', ftab: '▭', doc: '📄', dtab: '▭' };
function whereSug() {
  const q = listWQ.trim().toLowerCase(); if (!q) return '';
  const hits = Object.values(S.nodes).filter((n) => PLACE_ICO[n.kind] && PAR.has(n.id) && !((n.kind === 'ftab' || n.kind === 'dtab') && parent(n.id)?.kids.length === 1) && (n.title || '').toLowerCase().includes(q)).slice(0, 8);
  return hits.length ? hits.map((n) => `<button data-wpick="${n.id}"><span>${PLACE_ICO[n.kind]}</span><b>${esc(n.title)}</b><small>${esc(nestPath(PAR.get(n.id)))}</small></button>`).join('') : '<p class="none">Nada con ese nombre.</p>';
}
const listSt = { tarea: null, idea: null };                                  // null: everything except finished / discarded
const tabsUsing = (it) => Object.values(S.nodes).filter((n) => n.kind === 'dtab' && (n.text || '').includes(token(it))).map((n) => n.id);
const placeOf = (it) => (it.at && nd(it.at) ? it.at : tabsUsing(it)[0] || null);
const hereId = () => (cur ? cur : S.focus);
function inScope(it, sid) { const n = nd(sid); if (!n) return true; return [it.at, ...tabsUsing(it)].filter(Boolean).some((p) => p === sid || isIn(p, sid)); }
function openList(kind, scope) { listTab = kind === 'idea' ? 'ideas' : 'tareas'; listScope = scope || null; $('#list').classList.remove('closed'); renderList(); }
const scopeName = (id) => { const n = nd(id); if (!n) return ''; return n.kind === 'dtab' ? parent(id).title + ' › ' + n.title : n.title; };
function renderList() {
  const kind = listTab === 'ideas' ? 'idea' : 'tarea', all = listOf(kind), states = STATES[kind];
  const on = listSt[kind] || new Set(states.map((s) => s[0]).filter((k) => k !== 'hecha' && k !== 'descartada'));
  const scope = listScope === 'here' ? hereId() : listScope;
  const q = listQ.trim().toLowerCase();
  const l = all.filter((it) => on.has(stOf(it)) && (listWho === 'Todas' || whoOf(it.who) === listWho) && (!scope || inScope(it, scope))
    && (!q || [it.text, it.body, it.notes].some((x) => (x || '').toLowerCase().includes(q))))
    .sort((a, b) => states.findIndex((s) => s[0] === stOf(a)) - states.findIndex((s) => s[0] === stOf(b)));
  const row = (it, d = 0) => `<div class="lrow st-${stOf(it)}${it.done ? ' done' : ''}" style="--d:${d}" data-it="${it.id}">${kind === 'idea' ? '<span class="lic">💡</span>' : `<button class="lchk${it.done ? ' on' : ''}" data-chk="${it.id}" title="${it.done ? 'Reabrir' : 'Hecha'}"></button>`}<div><div class="ltx">${esc(it.text) || '…'}</div><div class="lsub">${whoOf(it.who) === 'Agente' ? '<b class="lwho">Agente</b>' : ''}<b class="lst s-${stOf(it)}">${stLabel(it)}</b>${listNested ? '' : esc(nestPath(placeOf(it)) || 'sin sitio')}</div></div></div>`;
  let body = '';
  if (!listNested) body = l.map((it) => row(it)).join('');
  else {   // nested: under the containers they hang on, as in the tree
    const root = { kids: new Map(), items: [] };
    for (const it of l) {
      const p = placeOf(it); let node = root;
      for (const n of p ? pathOf(p).filter((n) => n.kind !== 'project' && !(n.kind === 'ftab' && parent(n.id)?.kids.length === 1) && !(n.kind === 'dtab' && parent(n.id)?.kids.length === 1)) : [{ id: '-', title: 'Sin sitio', kind: '' }]) {
        if (!node.kids.has(n.id)) node.kids.set(n.id, { n, kids: new Map(), items: [] }); node = node.kids.get(n.id);
      }
      node.items.push(it);
    }
    const ico = { area: '▤', frame: '⬚', ftab: '▭', doc: '📄', dtab: '▭' };
    const walk = (node, d) => {
      if (node.n) body += `<div class="lgrp" style="--d:${d}"${node.n.id !== '-' ? ` data-scope="${node.n.id}" title="Ver solo lo de aquí"` : ''}><span>${ico[node.n.kind] || '·'}</span>${esc(node.n.title)}</div>`;
      body += node.items.map((it) => row(it, node.n ? d + 1 : d)).join('');
      for (const k of node.kids.values()) walk(k, node.n ? d + 1 : d);
    };
    walk(root, 0);
  }
  const chip = (attr, label, sel, extra = '') => `<button ${attr} class="${sel ? 'on' : ''}"${extra}>${label}</button>`;
  $('#list-body').innerHTML = `<div class="lfil">
      <div class="lw">${listScope ? `<span class="lw-on">${PLACE_ICO[nd(scope)?.kind] || ''} ${esc(scopeName(scope))}<button data-lscope="" title="En todas partes">×</button></span>` : `<input class="lwq" placeholder="Dónde: un apartado, marco, documento…" value="${esc(listWQ)}">`}${listScope === 'here' ? '' : `<button class="lw-here" data-lscope="here" title="Lo que estás viendo">Aquí</button>`}<div class="lw-sug">${listScope ? '' : whereSug()}</div></div>
      <input class="lq" placeholder="Buscar en el texto de las ${kind === 'idea' ? 'ideas' : 'tareas'}…" value="${esc(listQ)}">
      <div class="lf-row"><span>Estado</span>${states.map(([k, lab]) => chip(`data-lst="${k}"`, lab, on.has(k))).join('')}</div>
      <div class="lf-row"><span>Para</span>${['Todas', ...WHO].map((w) => chip(`data-lw="${w}"`, w, w === listWho)).join('')}<span class="lf-gap"></span>${chip('data-lnest', '⌥ Anidadas', listNested, ' title="Agruparlas bajo donde están"')}</div>
    </div>${body || `<p class="none">${all.length ? 'Nada con estos filtros.' : kind === 'tarea' ? 'Sin tareas todavía.' : 'Sin ideas todavía.'}</p>`}`;
  for (const b of document.querySelectorAll('#list nav button')) b.classList.toggle('on', b.dataset.l === listTab);
}
function renderAll() { tidy(); renderAreas(); renderTop(); renderStage(); renderMap(); renderDrawer(); renderList(); renderDock(); if (cur) renderEdHead(); paintSel(); }

// ---- zooming in and out of frames (the frame grows from where it was / shrinks back to its place) -------------------
function glideFrom(el, r0, ms = 420) {
  if (!el || !r0) return;
  const r1 = el.getBoundingClientRect(); if (!r1.width || !r1.height) return;
  return el.animate([{ transformOrigin: '0 0', transform: `translate(${r0.left - r1.left}px,${r0.top - r1.top}px) scale(${r0.width / r1.width},${r0.height / r1.height})`, opacity: .85 },
    { transformOrigin: '0 0', transform: 'none', opacity: 1 }], { duration: ms, easing: EASE.smooth });
}
function focusTo(id) {
  let n = nd(id); if (!n) return;
  if (n.kind === 'ftab') { const f = parent(id); f.active = id; n = f; }
  if (n.kind === 'project') n = nd(S.area) || n;
  if (isGroup(n)) n = nd(leafOf(n.id));
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
  if (f.kind === 'area') return;
  const up = pathOf(f.id).slice(0, -1).reverse().find((n) => n.kind === 'frame' || n.kind === 'area');
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
  if (src.make) return { frame: '⬚ Marco nuevo', doc: '📄 Documento nuevo', idea: '💡 Idea nueva', tarea: '☐ Tarea nueva', dibujo: '🖍 Dibujo nuevo' }[src.make];
  const n = nd(src.node); return n ? ({ area: '▤ ', frame: '⬚ ', ftab: '▭ ', doc: '📄 ', dtab: '▭ ' }[n.kind] || '') + n.title : '';
}
addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    drag.on = true; drag.src = srcOf(drag.key);
    ghost.textContent = labelOf(drag.src); ghost.classList.add('on'); document.body.classList.add('dragging'); if (drag.src.item || drag.src.make === 'idea' || drag.src.make === 'tarea') document.body.classList.add('drag-hang');
    if (drag.src.make === 'dibujo') document.body.classList.add('drag-draw');
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
  ghost.classList.remove('on'); document.body.classList.remove('dragging', 'drag-hang', 'drag-draw'); d.el.classList.remove('lifted'); $('#drawer').classList.remove('near');
  paintTarget(null);
  if (d.t?.ok) drop(d.src, d.t);
});
// Where a drop would land: { kind, pid, idx, forced, el, ok }
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y); if (!el) return null;
  const src = drag.src;
  if ((src.item || src.make === 'idea' || src.make === 'tarea' || src.make === 'dibujo') && el.closest('#areas')) {   // on an area of the column: loose in that area
    const arEl = el.closest('.ar[data-area]'); if (!arEl || src.make === 'dibujo') return null;
    const pid = leafOf(arEl.dataset.area);
    return src.item ? { kind: 'hang', pid, el: arEl, ok: true } : { kind: 'place', pid, el: arEl, ok: true };
  }
  const bg = el.closest('#stage') && !el.closest('.fr, .dc') ? stage.querySelector(':scope > .grid') : null;   // the empty space of an area counts as the area
  // an idea, a task or a drawing hangs on the thing it is over (a document, a tab, a frame, the area): no bars beside
  if (src.item || src.make === 'idea' || src.make === 'tarea' || src.make === 'dibujo') {
    const h = el.closest('.dc[data-id], .ft[data-tab], .fr[data-id]') || bg; if (!h) return null;
    const id = h.dataset.tab || h.dataset.id; if (!nd(id)) return null;
    if (src.make === 'dibujo' && !['frame', 'doc', 'ftab'].includes(nd(id).kind)) return null;
    return { kind: src.item ? 'hang' : 'place', pid: id, el: h, ok: true, slot: true };
  }
  const t = el.closest('[data-drop]') || bg; if (!t) return null;
  const mode = t.dataset.drop, id = t.dataset.id;
  let spec = null;
  if (mode === 'drawer') spec = { kind: 'drawer', el: t };
  else if (mode === 'tabs') spec = { kind: 'place', pid: id, idx: indexByX(t.querySelectorAll('.ft'), x), forced: 'ftab', el: t };
  else if (mode === 'dtabs') spec = { kind: 'place', pid: id, idx: indexByX(t.querySelectorAll('.bt'), x), forced: 'dtab', el: t };
  else if (mode === 'into') spec = { kind: 'place', pid: id, idx: indexInFlow(t, x, y), el: t };
  else if (mode === 'area') {
    const r = t.getBoundingClientRect(), fy = (y - r.top) / r.height, pp = PAR.get(id), i = nd(pp).kids.indexOf(id);
    const docIn = (src.node && nd(src.node)?.kind === 'doc') || src.make === 'doc';
    if (docIn && (nd(id).kind === 'doc' || fy < .3 || fy > .7)) spec = { kind: 'place', pid: pp, idx: fy < .5 ? i : i + 1, forced: 'doc', el: t, side: fy < .5 ? 't' : 'b' };
    else if (nd(id).kind === 'doc') spec = null;
    else spec = src.node && nd(src.node)?.kind === 'area'
      ? (fy < .3 || fy > .7 ? { kind: 'place', pid: pp, idx: fy < .5 ? i : i + 1, forced: 'area', el: t, side: fy < .5 ? 't' : 'b' } : { kind: 'place', pid: id, forced: 'area', into: true, el: t })
      : { kind: 'place', pid: leafOf(id), el: t };
  } else if (mode === 'doc') {
    const r = t.getBoundingClientRect(), fx = (x - r.left) / r.width, p = PAR.get(id), i = nd(p)?.kids.indexOf(id);
    spec = fx < 0.25 ? { kind: 'place', pid: p, idx: i, el: t, side: 'l' } : fx > 0.75 ? { kind: 'place', pid: p, idx: i + 1, el: t, side: 'r' } : { kind: 'place', pid: id, forced: 'dtab', el: t };
  } else if (mode === 'map') {
    const r = t.getBoundingClientRect(), labelZone = y - r.top < 15 * mapZ;
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
  if (t.into && src.node && (src.node === t.pid || pathOf(t.pid).filter((n) => n.kind === 'area').length + areaDepth(src.node) > MAXCOLS)) return false;   // no more than 4 columns
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
  document.querySelector('.it-slot')?.remove();
  if (t?.slot && t.el) {   // where the circle will go: a dashed one, right there
    const slot = document.createElement('i'); slot.className = 'it-slot' + (drag?.src?.make === 'dibujo' ? ' draw' : '');
    const fr = t.el.matches('.fr') ? t.el : t.el.matches('.ft') ? t.el.closest('.fr') : null;
    if (fr) fr.querySelector(':scope > .fr-head .grow')?.before(slot);
    else if (t.el.matches('.dc')) { let its = t.el.querySelector(':scope > .its'); if (!its) { its = document.createElement('span'); its.className = 'its'; t.el.append(its); } its.append(slot); }
    else if (t.el.matches('.grid')) { let l = t.el.querySelector(':scope > .loose-its'); if (!l) { l = document.createElement('div'); l.className = 'loose-its'; t.el.prepend(l); } l.append(slot); }
  }
  bar.classList.remove('on');
  if (!t?.el) return;
  t.el.classList.add(t.ok ? 'drop-on' : 'drop-bad');
  if (!t.ok) return;
  // where exactly: a bar between things
  if (t.side === 't' || t.side === 'b') { const r = t.el.getBoundingClientRect(); Object.assign(bar.style, { left: r.left + 'px', top: (t.side === 't' ? r.top - 3 : r.bottom + 1) + 'px', width: r.width + 'px', height: '3px' }); bar.classList.add('on'); }
  else if (t.side) { const r = t.el.getBoundingClientRect(); Object.assign(bar.style, { left: (t.side === 'l' ? r.left - 8 : r.right + 5) + 'px', top: r.top + 'px', width: '3px', height: r.height + 'px' }); bar.classList.add('on'); }
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
  if (now && now !== before && before !== 'area') toast(`${{ frame: 'Marco', ftab: 'Pestaña', doc: 'Documento', dtab: 'Pestaña', h: 'Título' }[before]} → ${{ frame: 'marco', ftab: 'pestaña de marco', doc: 'documento', dtab: 'pestaña de documento', h: 'título' }[now]}`, [['Deshacer', doUndo]]);
  save(); renderAll();
  if (cur) { if (!nd(cur)) closeDoc(); else showTab(nd(curTab) ? curTab : activeTab(nd(cur))); }
}
// creating: where it was dropped, or (a click) where you are
function makeAt(kind, t) {
  if (kind === 'dibujo') return newDrawing(t?.kind === 'place' ? t.pid : t?.kind === 'head' ? t.tab : cur || S.focus);
  if (kind === 'idea' || kind === 'tarea') {
    const at = t?.kind === 'place' ? (nd(t.pid).kind === 'ftab' ? parent(t.pid).id : t.pid) : t?.kind === 'head' ? t.tab : (cur || S.focus);
    const it = newItem(kind, '', at); save(); renderAll();
    it.fresh = true; return openTask(it);                     // an idea or a task is born as its card
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
  if (kind === 'frame') return f.kind === 'project' || f.kind === 'area' ? (f.kind === 'area' ? f.id : S.area) : activeTab(f);
  if (f.kind === 'frame') return activeTab(f);
  if (f.kind === 'area' && kind === 'doc') return f.id;
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
  if (t.closest('.new-frame')) { snap(); return makeAt('frame', { kind: 'place', pid: S.area || S.root }); }
  const arx = t.closest('.ar-x'); if (arx) return askDelete(arx.closest('.ar').dataset.area, arx);
  const ar = t.closest('.ar'); if (ar) {
    const id = ar.dataset.area;   // the second click of a double click lands on the redrawn button: it renames
    if (e.detail >= 2) { const el = $(`.ar[data-area="${id}"] .ar-t`); return el && editInline(el, (v) => { if (v && v !== nd(id).title) { snap(); nd(id).title = v; save(); } renderAll(); }); }
    arPeek = null;
    const col = ar.closest('.ar-col'); if (col && !col.classList.contains('last')) { arShut = [...col.parentNode.children].indexOf(col); arHov = -1; }   // chosen: fold it, show the next column
    return focusTo(id);
  }
  const addd = t.closest('.ar-adddoc'); if (addd) {
    snap(); const P = nd(addd.dataset.pid), d = mk('doc', 'Documento nuevo'); d.kids.push(mk('dtab', 'Página 1', { text: '' }).id); d.active = d.kids[0]; P.kids.push(d.id); reindex(); save(); renderAll();
    const el = $(`.ar[data-area="${d.id}"] .ar-t`); if (el) editInline(el, (v) => { if (v) { d.title = v; save(); } renderAll(); }); return;
  }
  const add = t.closest('.ar-add'); if (add) {
    snap(); const P = nd(add.dataset.pid), a = mk('area', 'Apartado nuevo'); P.kids.push(a.id);
    // next to groups, it gets the same columns inside, so it can be filled at once
    const deep = Math.max(1, ...P.kids.filter((k) => k !== a.id && nd(k)?.kind === 'area').map(areaDepth));
    let x = a; for (let i = 1; i < deep; i++) { const c = mk('area', 'General'); x.kids.push(c.id); x = c; }
    const loose = P.kids.filter((k) => nd(k)?.kind !== 'area');   // the frames of an area that now gets areas inside move into the new one
    if (P.kind === 'area' && loose.length) { P.kids = P.kids.filter((k) => nd(k)?.kind === 'area'); x.kids.push(...loose); }
    reindex(); S.area = x.id; S.focus = x.id; save(); renderAll();
    const el = $(`.ar[data-area="${a.id}"] .ar-t`); if (el) editInline(el, (v) => { if (v) { a.title = v; save(); } renderAll(); }); return;
  }
  const dis = t.closest('.ar-dis'); if (dis) {
    const lv = +dis.dataset.lv, at = [];
    const walk = (id, d) => { for (const k of nd(id).kids) if (nd(k)?.kind === 'area') { if (d === lv) { if (isGroup(nd(k))) at.push(k); } else walk(k, d + 1); } };
    walk(S.root, 0);
    return askChoice(dis, '¿Quitar esta columna?', `${at.length === 1 ? 'Su apartado desaparece' : `Sus ${at.length} apartados desaparecen`} y lo que tiene${at.length === 1 ? '' : 'n'} dentro sube a su sitio. No se borra nada más.`, [{ label: 'Quitar la columna', run: () => {
      snap(); reindex();
      for (const id of at) { const p = nd(PAR.get(id)), i = p.kids.indexOf(id); p.kids.splice(i, 1, ...nd(id).kids); delete S.nodes[id]; }
      tidy(); save(); renderAll(); toast('Columna quitada', [['Deshacer', doUndo]]);
    } }]);
  }
  if (t.closest('.ar-wrap')) {
    if (colsDepth() >= MAXCOLS) return toast('Como mucho, 4 columnas');
    snap(); const root = nd(S.root), g = mk('area', 'Apartado nuevo');
    g.kids = root.kids.filter((k) => nd(k)?.kind === 'area'); root.kids = [g.id, ...root.kids.filter((k) => nd(k)?.kind !== 'area')];
    reindex(); save(); renderAll();
    const el = $(`.ar[data-area="${g.id}"] .ar-t`); if (el) editInline(el, (v) => { if (v) { g.title = v; save(); } renderAll(); }); return;
  }
  if (t.closest('.fr-out')) return zoomOut();
  const see = t.closest('.fr-see'); if (see) return openList(see.dataset.see, see.closest('.fr').dataset.id);
  const fin = t.closest('.fr-in'); if (fin) return focusTo(fin.closest('.fr').dataset.id);
  const pal = t.closest('.fr-pal i'); if (pal) { snap(); nd(pal.closest('.fr').dataset.id).color = pal.dataset.c; save(); return renderAll(); }
  const ftx0 = t.closest('.fr-tx'); if (ftx0) return askDelete(ftx0.dataset.tab0, ftx0);
  const ftx = t.closest('.ft-x'); if (ftx) return askDelete(ftx.closest('.ft').dataset.tab, ftx);
  const ttl = t.closest('.fr-title[data-tab0]'); if (ttl && nd(ttl.closest('.fr').dataset.id).kids.length > 1) { const f = nd(ttl.closest('.fr').dataset.id); f.active = ttl.dataset.tab0; save(); return renderAll(); }
  const ft = t.closest('.ft'); if (ft) { const f = nd(ft.closest('.fr').dataset.id); f.active = ft.dataset.tab; save(); return renderAll(); }
  const fta = t.closest('.ft-add'); if (fta) {
    snap(); const f = nd(fta.closest('.fr').dataset.id);
    const tab = mk('ftab', `Pestaña ${f.kids.length + 1}`); f.kids.push(tab.id); f.active = tab.id; save(); renderAll();
    const el = stage.querySelector(`.ft[data-tab="${tab.id}"]`); if (el) editInline(el.firstChild?.nodeType === 3 ? wrapText(el) : el, (v) => { if (v) { tab.title = v; save(); renderAll(); } });
    return;
  }
  const fx = t.closest('.fr-x'); if (fx) return askDelete(fx.closest('.fr').dataset.id, fx);
  const dx = t.closest('.dc-x'); if (dx) return askDelete(dx.closest('.dc').dataset.id, dx);
  const itc = t.closest('.it'); if (itc) return itemClick(itc.dataset.it, itc);
  const pg = t.closest('.dc-tabs span[data-pg]'); if (pg) { const dc2 = pg.closest('.dc'); return openDoc(dc2.dataset.id, pg.dataset.pg, dc2); }   // a tab of a document opens it there
  const dc = t.closest('.dc'); if (dc && !t.closest('.its')) return openDoc(dc.dataset.id, null, dc);
  const stub = t.closest('.fr.stub'); if (stub) return focusTo(stub.dataset.id);
  const mr = t.closest('.mr'); if (mr && !mr.classList.contains('k-project')) mapOpen(false);
  if (mr) { if (mr.dataset.head) { const [tab, line] = mr.dataset.head.split(':'); const d = parent(tab); openDoc(d.id, tab); setTimeout(() => ed?.gotoLine(+line), 60); } else focusTo(mr.dataset.id); return; }
  if (t.closest('.dr-pull')) return $('#drawer').classList.toggle('open');
  if (!t.closest('#drawer')) $('#drawer').classList.remove('open');
  const dre = t.closest('.dr-empty'); if (dre) return askChoice(dre, '¿Vaciar el cajón?', `Se borra lo que hay dentro (${S.drawer.length}). Se puede deshacer.`, [{ label: 'Vaciar', danger: true, run: () => { snap(); for (const id of [...S.drawer]) { detach(id); removeTree(id); } S.drawer = []; tidy(); save(); renderAll(); toast('Cajón vacío', [['Deshacer', doUndo]]); } }]);
  const drx = t.closest('.dr-x'); if (drx) { const id = drx.closest('.dr-chip').dataset.id; return askChoice(drx, `¿Borrar «${esc(nd(id).title)}» para siempre?`, 'Sale del cajón y no vuelve (salvo con Deshacer).', [{ label: 'Borrar', danger: true, run: () => { snap(); detach(id); removeTree(id); save(); renderAll(); } }]); }
  const drc = t.closest('.dr-chip'); if (drc) { const n = nd(drc.dataset.id); if (n.kind === 'doc') openDoc(n.id); return; }
  const lchk = t.closest('[data-chk]'); if (lchk) return toggleTask(S.tasks.find((x) => x.id === lchk.dataset.chk));
  const lw = t.closest('[data-lw]'); if (lw) { listWho = lw.dataset.lw; return renderList(); }
  const wp = t.closest('[data-wpick]'); if (wp) { listScope = wp.dataset.wpick; listWQ = ''; return renderList(); }
  const lsc = t.closest('[data-lscope]'); if (lsc) { listScope = lsc.dataset.lscope || null; return renderList(); }
  const lgr = t.closest('.lgrp[data-scope]'); if (lgr) { listScope = lgr.dataset.scope; return renderList(); }
  const lst = t.closest('[data-lst]'); if (lst) { const k = listTab === 'ideas' ? 'idea' : 'tarea'; const on = listSt[k] || new Set(STATES[k].map((x) => x[0]).filter((x) => x !== 'hecha' && x !== 'descartada')); on.has(lst.dataset.lst) ? on.delete(lst.dataset.lst) : on.add(lst.dataset.lst); listSt[k] = on; return renderList(); }
  if (t.closest('[data-lnest]')) { listNested = !listNested; return renderList(); }
  const lrow = t.closest('.lrow'); if (lrow && !t.closest('[data-chk]')) return openTask([...S.tasks, ...S.ideas].find((x) => x.id === lrow.dataset.it));
  if (lrow) { const it = [...S.ideas, ...S.tasks].find((x) => x.id === lrow.dataset.it); if (it?.at) return focusTo(nd(it.at).kind === 'ftab' ? parent(it.at).id : it.at); const d = it && docsUsing(it)[0]; if (d) openDoc(d.id); return; }
  const lb = t.closest('#list nav button'); if (lb) { listTab = lb.dataset.l; return renderList(); }
});
const wrapText = (el) => { const s = document.createElement('span'); s.textContent = el.firstChild.textContent; el.firstChild.replaceWith(s); return s; };
addEventListener('dblclick', (e) => {
  const t = e.target;
  const ttl = t.closest('.fr-title, .dc-title'); if (ttl) { const id = ttl.closest('[data-id]').dataset.id; return editInline(ttl, (v) => { if (v && v !== nd(id).title) { snap(); nd(id).title = v; save(); } renderAll(); }); }
  const arn = t.closest('.ar'); if (arn) { const id = arn.dataset.area, el = $(`.ar[data-area="${id}"] .ar-t`); if (!el) return; return editInline(el, (v) => { if (v && v !== nd(id).title) { snap(); nd(id).title = v; save(); } renderAll(); }); }
  const ft = t.closest('.ft'); if (ft) { const id = ft.dataset.tab; return editInline(wrapText(ft), (v) => { if (v && v !== nd(id).title) { snap(); nd(id).title = v; save(); } renderAll(); }); }
  const cr = t.closest('.cr[data-go="' + S.root + '"]'); if (cr) return editInline(cr, (v) => { if (v) { snap(); nd(S.root).title = v; save(); } renderAll(); });
  const it = t.closest('.it'); if (it) { const x = [...S.ideas, ...S.tasks].find((y) => y.id === it.dataset.it); return popEdit(it, x.text, (v) => setItemText(x, v)); }
});
function itemClick(id, el) {
  const it = [...S.ideas, ...S.tasks].find((x) => x.id === id); if (!it) return;
  if (it.kind === 'tarea' || el?.closest?.('#stage')) return openTask(it);
  if (el?.closest?.('#stage')) { clearTimeout(peekT); return showPeek(el, true); }
  popEdit(el, it.text, (v) => setItemText(it, v));
}
function setItemText(it, v) {
  if (v == null) return;
  snap();
  if (!v) { if (docsUsing(it).length) it.at = null; else listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1); toast('Quitada', [['Deshacer', doUndo]]); }
  else it.text = v;
  save(); renderAll(); ed?.refresh?.();
}
function toggleTask(it) { if (!it) return; if (stOf(it) === 'bloqueada' && activeBlockers(it).length) return toast('La bloquean tareas sin hacer'); snap(); setState(it, it.done ? 'pendiente' : 'hecha'); save(); renderAll(); ed?.refresh?.(); if (taskOpen) paintTask(); }
// Deleting asks when there is something inside; «al cajón» keeps it aside
function canLift(n) {
  const p = nd(PAR.get(n.id)); if (!p || !n.kids.length) return false;
  if (n.kind === 'area') return isGroup(n) || p.kids.some((k) => k !== n.id && nd(k)?.kind === 'area' && !isGroup(nd(k)));
  if (n.kind === 'frame') return true;
  if (n.kind === 'ftab') return p.kids.length > 1;
  if (n.kind === 'doc') return n.kids.length > 1;
  return false;
}
function lift(id) {
  const n = nd(id), p = nd(PAR.get(id)), i = p.kids.indexOf(id); let put = [];
  if (n.kind === 'area') {
    if (isGroup(n)) put = n.kids;
    else { const sib = p.kids.filter((k) => k !== id && nd(k)?.kind === 'area' && !isGroup(nd(k))); const near = sib.filter((k) => p.kids.indexOf(k) < i).pop() || sib[0]; nd(near).kids.push(...n.kids); }
  } else if (n.kind === 'frame') {
    if (p.kind === 'ftab') put = n.kids.flatMap((t) => nd(t).kids);
    else for (const t of n.kids) {                       // in an area: each tab becomes a frame; a lone tab lets its frames out as they are
      const T = nd(t);
      if (n.kids.length === 1) { put.push(...T.kids); delete S.nodes[t]; continue; }
      const f = mk('frame', T.title, n.color ? { color: n.color } : {}); f.kids = [t]; f.active = t; put.push(f.id);
    }
  } else if (n.kind === 'ftab') { const near = p.kids[i - 1] ?? p.kids[i + 1]; nd(near).kids.push(...n.kids); p.active = near; }
  else if (n.kind === 'doc') put = n.kids.map((t) => { const d = mk('doc', n.title + ' · ' + nd(t).title); d.kids = [t]; d.active = t; return d.id; });
  p.kids.splice(i, 1, ...put); delete S.nodes[id];
  for (const it of [...S.ideas, ...S.tasks]) if (it.at === id) it.at = p.id;
}
function askDelete(id, anchor) {
  const n = nd(id); if (!n) return;
  const inside = countIn(id) + (n.kind === 'doc' ? (docText(n).trim() ? 1 : 0) : 0);
  const name = { area: 'el apartado', frame: 'el marco', ftab: 'la pestaña', doc: 'el documento' }[n.kind];
  const drop = () => { snap(); detach(id); removeTree(id); tidy(); save(); renderAll(); toast('Borrado', [['Deshacer', doUndo]]); };
  const aside = () => { snap(); detach(id); const k = n.kind === 'ftab' ? 'ftab' : n.kind; S.drawer.push(id); n.kind = k; tidy(); save(); renderAll(); toast('Al cajón', [['Deshacer', doUndo]]); };
  const keep = () => { snap(); lift(id); tidy(); save(); renderAll(); toast('Borrado; lo de dentro sigue ahí', [['Deshacer', doUndo]]); };
  if (!inside && n.kind !== 'ftab') return drop();
  askChoice(anchor, `¿Qué hago con ${name} «${esc(n.title)}»?`, inside ? 'Tiene cosas dentro.' : '', [
    ...(canLift(n) ? [{ label: `Borrar solo ${name}: lo de dentro se queda en su sitio`, run: keep }] : []),
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
let mapPill = null;
function mapOpen(on) {
  const m = $('#map'); if (on === !m.classList.contains('mini')) return;
  const pr = $('#map-pill').getBoundingClientRect(); if (pr.width) mapPill = pr; const pill = mapPill || { top: innerHeight - 50, bottom: innerHeight - 14, left: 14, right: 94 };
  const clipTo = () => { const r = m.getBoundingClientRect(); return `inset(${pill.top - r.top}px ${r.right - pill.right}px ${r.bottom - pill.bottom}px ${pill.left - r.left}px round 12px)`; };
  mapZ = 1; mapX = 0; mapY = 0;
  if (on) {
    m.classList.remove('mini'); renderMap();
    m.animate([{ clipPath: clipTo(), opacity: .6 }, { clipPath: 'inset(0 0 0 0 round 0)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.85,.25,1)' });
  } else {
    const an = m.animate([{ clipPath: 'inset(0 0 0 0 round 0)', opacity: 1 }, { clipPath: clipTo(), opacity: .4 }], { duration: 300, easing: 'cubic-bezier(.5,0,.3,1)' });
    const done = () => { m.classList.add('mini'); renderMap(); };
    an.finished.then(done, done);
  }
}
$('#map-pill').onclick = () => mapOpen(true);
$('#map-size').onclick = () => mapOpen(false);
// carrying something over the closed map opens it, to drop it anywhere in the tree
let mapHoverT = null;
addEventListener('pointermove', (e) => {
  if (!drag?.on) return;
  const over = e.target.closest?.('#map-pill');
  if (over && !mapHoverT) mapHoverT = setTimeout(() => { mapOpen(true); mapHoverT = null; }, 350);
  if (!over && mapHoverT) { clearTimeout(mapHoverT); mapHoverT = null; }
});
$('#list-btn').onclick = () => $('#list').classList.toggle('closed');
// a click anywhere else closes the side list
addEventListener('pointerdown', (e) => { if (!$('#list').classList.contains('closed') && !e.target.closest('#list, #list-btn, #pick, #toasts, #ipeek, #task, .pop')) $('#list').classList.add('closed'); }, true);
addEventListener('resize', () => renderMap());
$('#list').addEventListener('input', (e) => { if (e.target.matches('.lwq')) { listWQ = e.target.value; $('#list .lw-sug').innerHTML = whereSug(); return; } if (!e.target.matches('.lq')) return; listQ = e.target.value; const at = e.target.selectionStart; renderList(); const q = $('#list .lq'); q.focus(); q.setSelectionRange(at, at); });

// ---- what an idea or a task says, on hover --------------------------------------------------------------------------
let peekT = null;
const peekBox = $('#ipeek'), peekTxt = () => peekBox.querySelector('.ip-t');
const peekEditing = () => peekBox.classList.contains('on') && document.activeElement === peekTxt();
// one card: hovering shows it, clicking an idea (or into the card) writes in it; no second box
function showPeek(el, focus) {
  const it = [...S.ideas, ...S.tasks].find((x) => x.id === el.dataset.it); if (!it) return;
  const r = el.getBoundingClientRect();
  peekBox.dataset.id = it.id;
  peekBox.className = 'k-' + it.kind + (it.done ? ' done' : '') + ' st-' + stOf(it);
  peekBox.innerHTML = `<div class="ip-h"><span class="ip-k">${it.kind === 'idea' ? '💡 Idea · ' + stLabel(it) : 'Tarea · ' + stLabel(it) + (whoOf(it.who) === 'Agente' ? ' · para el agente' : '')}</span>${it.kind === 'tarea' ? `<button class="ip-done" data-ip="done">${it.done ? '✓ Hecha' : 'Marcar hecha'}</button>` : ''}<button class="ip-rm" data-ip="rm" title="Quitar"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/></svg><span>Quitar</span></button></div>${true ? `<div class="ip-t ip-open" title="Abrir">${esc(it.text || '…')}${it.body ? `<small>${esc(it.body.slice(0, 160))}${it.body.length > 160 ? '…' : ''}</small>` : ''}</div>` : `<div class="ip-t" contenteditable="true" spellcheck="false" data-ph="Escribe…">${esc(it.text || '')}</div>`}`;
  const left = Math.min(innerWidth - 300, Math.max(8, r.left + r.width / 2 - 145));
  Object.assign(peekBox.style, { left: left + 'px', top: r.bottom + 10 + 'px' }); peekBox.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');
  peekBox.classList.add('on');
  if (focus) { const t = peekTxt(); t.focus(); const g = getSelection(); g.selectAllChildren(t); g.collapseToEnd(); }
}
function hidePeek() { if (peekEditing()) peekTxt().blur(); peekBox.classList.remove('on'); }
addEventListener('pointerover', (e) => {
  if (e.target.closest('#ipeek')) return clearTimeout(peekT);       // on its way to the card: stay
  if (peekEditing()) return;                                         // writing: it stays until you click elsewhere
  const el = e.target.closest('.it');
  if (!el || drag?.on) { clearTimeout(peekT); if (peekBox.classList.contains('on')) peekT = setTimeout(hidePeek, drag?.on ? 0 : 350); return; }
  if (peekBox.classList.contains('on') && peekBox.dataset.id === el.dataset.it) return clearTimeout(peekT);
  clearTimeout(peekT); peekT = setTimeout(() => showPeek(el), 200);
});
addEventListener('pointerdown', (e) => { if (peekBox.classList.contains('on') && !e.target.closest('#ipeek, .it')) hidePeek(); }, true);
peekBox.addEventListener('focusout', () => {                         // what was written is kept when you leave the text
  const it = [...S.ideas, ...S.tasks].find((x) => x.id === peekBox.dataset.id), t = peekTxt(); if (!it || !t) return;
  const v = t.innerText.replace(/s+$/, '');
  if (v !== (it.text || '')) { snap(); it.text = v; save(); renderAll(); ed?.refresh?.(); }
});
peekBox.addEventListener('keydown', (e) => {
  if (!e.target.closest('.ip-t')) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); hidePeek(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const it = [...S.ideas, ...S.tasks].find((x) => x.id === peekBox.dataset.id); peekTxt().innerText = it?.text || ''; hidePeek(); }
});
peekBox.addEventListener('click', (e) => {
  if (e.target.closest('.ip-open')) return openTask([...S.tasks, ...S.ideas].find((x) => x.id === peekBox.dataset.id));
  const bt = e.target.closest('[data-ip]'); if (!bt) return;
  const it = [...S.ideas, ...S.tasks].find((x) => x.id === peekBox.dataset.id); if (!it) return;
  if (bt.dataset.ip === 'done') { toggleTask(it); const el = $(`.it[data-it="${it.id}"]`); return el ? showPeek(el) : hidePeek(); }
  peekBox.classList.remove('on');
  snap(); if (docsUsing(it).length) it.at = null; else listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1);
  save(); renderAll(); ed?.refresh?.(); toast('Quitada', [['Deshacer', doUndo]]);
});

// ---- a task is a small document: its plan (with versions), what to keep in mind, its state, who it is for, comments -
const STATES = {
  tarea: [['pendiente', 'Por empezar'], ['plan', 'Plan revisado'], ['curso', 'En curso'], ['hecha', 'Hecha'], ['bloqueada', 'Bloqueada']],
  idea: [['cruda', 'Cruda'], ['madurando', 'Madurando'], ['lista', 'Lista'], ['hecha', 'Hecha'], ['descartada', 'Descartada']],
};
const TSTATES = STATES.tarea;
const stOf = (it) => it.state || (it.done ? 'hecha' : it.kind === 'idea' ? 'cruda' : 'pendiente');
const stLabel = (it) => STATES[it.kind].find((x) => x[0] === stOf(it))?.[1] || '';
const WHO = ['Yo', 'Agente'];
const whoOf = (w) => (!w || w === 'Yo' ? 'Yo' : 'Agente');            // older names (Claude, Qwen…) are the agent
const whoList = () => WHO;
const whenStr = (t) => new Date(t).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const taskById = (id) => S.tasks.find((t) => t.id === id);
const blockers = (it) => (it.blockedBy || []).map(taskById).filter(Boolean);
const activeBlockers = (it) => blockers(it).filter((t) => !t.done);
const dependents = (it) => S.tasks.filter((d) => (d.blockedBy || []).includes(it.id) && stOf(d) === 'bloqueada');
const dependsOn = (a, b, seen = new Set()) => { if (seen.has(a.id)) return false; seen.add(a.id); return blockers(a).some((x) => x.id === b.id || dependsOn(x, b, seen)); };
function setState(it, st) {
  if (stOf(it) === st) return true;
  if (stOf(it) === 'bloqueada' && activeBlockers(it).length) { toast('La bloquean tareas sin hacer: se desbloquea sola cuando estén hechas'); return false; }
  if (st === 'bloqueada') it.before = stOf(it);
  it.state = st; it.done = st === 'hecha'; it.doneAt = it.done ? Date.now() : null;
  if (it.done) for (const d of S.tasks.filter((x) => (x.blockedBy || []).includes(it.id) && stOf(x) === 'bloqueada' && !activeBlockers(x).length)) {
    d.state = d.before && d.before !== 'bloqueada' ? d.before : 'pendiente'; toast(`«${d.text || 'Tarea'}» ya no está bloqueada`);
  }
  return true;
}
let blockPick = null, blockQ = '';          // the picker: which tasks block this one (a Set), and its search
function blockListHTML(it) {
  const q = blockQ.trim().toLowerCase();
  const cand = S.tasks.filter((t) => t.id !== it.id && !t.done && !dependsOn(t, it) && (!q || (t.text || '').toLowerCase().includes(q)))
    .sort((a, b) => blockPick.has(b.id) - blockPick.has(a.id));
  return cand.length ? cand.slice(0, 40).map((t) => `<button class="tk-bl-row${blockPick.has(t.id) ? ' on' : ''}" data-pick="${t.id}"><i></i><span><b>${esc(t.text || '…')}</b><small>${stLabel(t)}${placeOf(t) ? ' · ' + esc(nestPath(placeOf(t))) : ''}</small></span></button>`).join('')
    : `<p class="tk-none">${q ? 'Ninguna tarea con ese nombre.' : 'No hay otras tareas sin hacer.'}</p>`;
}
// the plan has versions: the last is the current one; the older ones stay, to look back with the arrows
const plansOf = (it) => (it.plans ||= [{ t: it.created || Date.now(), text: it.body || '' }]);
let taskOpen = null, taskSnapped = false, planAt = 0, commentBy = 'Yo';
const taskNow = () => [...S.tasks, ...S.ideas].find((x) => x.id === taskOpen);
function taskEdit(fn) { if (!taskSnapped) { snap(); taskSnapped = true; } fn(); save(); }
function openTask(it) {
  if (!it) return;
  clearTimeout(peekT); peekBox.classList.remove('on');
  taskOpen = it.id; taskSnapped = false; blockPick = null; planAt = plansOf(it).length - 1; paintTask();
  const box = $('#task'); box.hidden = false;
  box.querySelector('.tk-in').animate([{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
  if (!it.text) box.querySelector('.tk-title').focus();
}
function closeTask() {
  if (!taskOpen) return;
  if (document.activeElement?.closest?.('#task')) document.activeElement.blur();
  const it = taskNow();                                     // left empty: it was never made
  const written = it && (it.text || it.body || it.notes || (it.plans || []).some((p) => p.text) || (it.log || []).some((e) => !e.auto));
  if (it?.fresh && !written) listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1);
  if (it) delete it.fresh;
  taskOpen = null; $('#task').hidden = true; renderAll(); ed?.refresh?.();
}
function paintTask() {
  const it = taskNow(); if (!it) return closeTask();
  const idea = it.kind === 'idea', st = idea ? 'idea' : stOf(it), where = it.at && nd(it.at) ? nestPath(it.at) : '', inDocs = docsUsing(it);
  const plans = plansOf(it), pl = plans[planAt];
  const comments = (it.log || []).map((e, i) => ({ ...e, i })).filter((e) => !e.auto);
  $('#task .tk-in').innerHTML = `
    <header class="tk-h st-${st}">
      <span class="tk-k" title="${DEF[it.kind]}">${idea ? '💡 Idea' : 'Tarea'}</span>
      ${`<span class="tk-st${!idea && st === 'bloqueada' && activeBlockers(it).length ? ' locked' : ''}">${STATES[it.kind].map(([k, l]) => `<button data-st="${k}" class="s-${k}${k === st ? ' on' : ''}">${l}</button>`).join('')}</span>`}
      <button class="tk-x" title="Cerrar (Esc)">×</button>
    </header>
    ${idea ? '' : blockPick ? `<div class="tk-block">
      <div class="tk-bl-h"><b>¿Qué la bloquea?</b><span>Elige las tareas que tienen que estar hechas antes.</span></div>
      <p class="tk-warn">Mientras alguna esté sin hacer, esta no podrá cambiar de estado. Cuando estén todas hechas se desbloquea sola.</p>
      <input class="tk-bl-q" placeholder="Buscar una tarea…" value="${esc(blockQ)}">
      <div class="tk-bl-list">${blockListHTML(it)}</div>
      <div class="tk-bl-act"><button class="tk-bl-cancel">Cancelar</button><button class="tk-bl-ok">${blockPick.size ? `Bloquear por ${blockPick.size === 1 ? 'esta tarea' : 'estas ' + blockPick.size + ' tareas'}` : 'Bloquear sin tarea concreta'}</button></div>
    </div>` : st === 'bloqueada' ? `<div class="tk-blocked${activeBlockers(it).length ? ' hard' : ''}">
      <span class="tk-bl-lab">${blockers(it).length ? (activeBlockers(it).length ? '🔒 La bloquean' : 'Ya están hechas las que la bloqueaban') : 'Bloqueada: espera a algo de fuera'}</span>
      ${blockers(it).map((t) => `<span class="tk-dep${t.done ? ' done' : ''}"><button data-open="${t.id}" title="Abrir">${esc(t.text || '…')}</button><button data-unblock="${t.id}" title="Ya no la bloquea">×</button></span>`).join('')}
      <button class="tk-bl-add" title="Añadir una tarea que la bloquea">＋</button>
    </div>` : ''}
    <div class="tk-body">
      <div class="tk-title" contenteditable="true" spellcheck="false" data-ph="${idea ? 'La idea, en una línea…' : 'Qué hay que hacer, en una línea…'}">${esc(it.text || '')}</div>
      <div class="tk-meta">
        ${`<span class="tk-lab">Para</span>${WHO.map((w) => `<button class="tk-who w-${w === 'Yo' ? 'yo' : 'ag'}${whoOf(it.who) === w ? ' on' : ''}" data-who="${w}">${w}</button>`).join('')}`}
        ${where || inDocs.length ? `<span class="tk-where"><span class="tk-lab">En</span>${where ? `<button data-go-at title="Ir allí">${esc(where)}</button>` : ''}${inDocs.map((d) => `<button data-go-doc="${d.id}" title="Abrir el documento">📄 ${esc(d.title)}</button>`).join('')}</span>` : ''}
      </div>
      ${`<div class="tk-sec tk-plan-h"><span>${idea ? 'La idea' : 'El plan'}</span>
        <span class="tk-ver">${plans.length > 1 ? `<button data-pv="-1" ${planAt ? '' : 'disabled'} title="Versión anterior">‹</button><span>Versión ${planAt + 1} de ${plans.length} · ${whenStr(pl.t)}</span><button data-pv="1" ${planAt < plans.length - 1 ? '' : 'disabled'} title="Versión siguiente">›</button>` : ''}
        <button class="tk-newver" title="Guarda esta versión tal como está y empieza otra a partir de ella">＋ Nueva versión</button></span></div>
      <div class="tk-area${planAt < plans.length - 1 ? ' old' : ''}" contenteditable="true" spellcheck="false" data-plan="${planAt}" data-ph="${idea ? 'Cuéntala…' : 'Cómo se va a hacer…'}">${esc(pl.text || '')}</div>`}
      <div class="tk-sec">A tener en cuenta</div>
      <div class="tk-area" contenteditable="true" spellcheck="false" data-f="notes" data-ph="${idea ? 'Lo que la limita o la condiciona…' : 'Lo importante para hacerla bien…'}">${esc(it.notes || '')}</div>
      ${`<div class="tk-sec">Comentarios</div>
      <div class="tk-log">${comments.length ? comments.map((e) => `<div class="tk-e by-${whoOf(e.by) === 'Yo' ? 'yo' : 'ag'}"><div class="tk-e-h"><b>${whoOf(e.by)}</b><time>${whenStr(e.t)}</time><button data-rm-log="${e.i}" title="Borrar el comentario">×</button></div><span>${esc(e.text)}</span></div>`).join('') : '<p class="tk-none">Por ahora nadie ha dejado aquí un comentario.</p>'}</div>
      <div class="tk-say"><span class="tk-by">${WHO.map((w) => `<button class="w-${w === 'Yo' ? 'yo' : 'ag'}${commentBy === w ? ' on' : ''}" data-by="${w}">${w}</button>`).join('')}</span>
        <div class="tk-log-in" contenteditable="true" spellcheck="false" data-ph="Lo que se ha hecho, lo que se piensa… (Enter)"></div></div>`}
      ${!idea && dependents(it).length ? `<div class="tk-sec">Al terminarla se desbloquean</div><div class="tk-frees">${dependents(it).map((d) => `<button data-open="${d.id}">🔓 ${esc(d.text || '…')}</button>`).join('')}</div>` : ''}
    </div>
    <footer><button class="tk-rm">${idea ? 'Quitar la idea' : 'Quitar la tarea'}</button></footer>`;
}
$('#task').addEventListener('input', (e) => {
  const it = taskNow(); if (!it) return;
  const t = e.target;
  if (t.matches('.tk-bl-q')) { blockQ = t.value; $('#task .tk-bl-list').innerHTML = blockListHTML(it); return; }
  if (t.classList.contains('tk-title')) taskEdit(() => { it.text = t.innerText.replace(/\s+/g, ' ').trim(); });
  else if (t.dataset.plan != null) taskEdit(() => { const ps = plansOf(it), k = +t.dataset.plan; ps[k].text = t.innerText.replace(/\n$/, ''); if (k === ps.length - 1) it.body = ps[k].text; });
  else if (t.dataset.f) taskEdit(() => { it[t.dataset.f] = t.innerText.replace(/\n$/, ''); });
});
$('#task').addEventListener('keydown', (e) => {
  const it = taskNow(); if (!it) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeTask(); }
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (e.target.classList.contains('tk-title')) { e.preventDefault(); $('#task .tk-area').focus(); }
  if (e.target.classList.contains('tk-log-in')) {
    e.preventDefault(); const v = e.target.innerText.trim(); if (!v) return;
    taskEdit(() => (it.log ||= []).push({ t: Date.now(), text: v, by: commentBy })); paintTask();
    const box = $('#task .tk-body'); box.scrollTop = box.scrollHeight; $('#task .tk-log-in').focus();
  }
});
$('#task').addEventListener('click', (e) => {
  const it = taskNow(); if (!it) return;
  const t = e.target;
  if (t === $('#task') || t.closest('.tk-x')) return closeTask();
  const s = t.closest('[data-st]');
  if (s && it.kind === 'tarea' && s.dataset.st === 'bloqueada' && stOf(it) !== 'bloqueada') { blockPick = new Set(it.blockedBy || []); blockQ = ''; paintTask(); return $('#task .tk-bl-q')?.focus(); }
  if (s) { if (s.dataset.st !== stOf(it)) taskEdit(() => setState(it, s.dataset.st)); paintTask(); return renderAll(); }
  const pk = t.closest('[data-pick]'); if (pk) { blockPick.has(pk.dataset.pick) ? blockPick.delete(pk.dataset.pick) : blockPick.add(pk.dataset.pick); return paintTask(); }
  if (t.closest('.tk-bl-cancel')) { blockPick = null; return paintTask(); }
  if (t.closest('.tk-bl-ok')) { const ids = [...blockPick]; blockPick = null; taskEdit(() => { it.blockedBy = ids; if (stOf(it) !== 'bloqueada') setState(it, 'bloqueada'); }); paintTask(); return renderAll(); }
  if (t.closest('.tk-bl-add')) { blockPick = new Set(it.blockedBy || []); blockQ = ''; paintTask(); return $('#task .tk-bl-q')?.focus(); }
  const ub = t.closest('[data-unblock]'); if (ub) { taskEdit(() => { it.blockedBy = (it.blockedBy || []).filter((x) => x !== ub.dataset.unblock); }); paintTask(); return renderAll(); }
  const op = t.closest('[data-open]'); if (op) { blockPick = null; const o = taskById(op.dataset.open); if (o) openTask(o); return; }
  const w = t.closest('[data-who]'); if (w) { taskEdit(() => { it.who = w.dataset.who; }); return paintTask(); }
  const by = t.closest('[data-by]'); if (by) { commentBy = by.dataset.by; paintTask(); return $('#task .tk-log-in').focus(); }
  const pv = t.closest('[data-pv]'); if (pv) { planAt = Math.max(0, Math.min(plansOf(it).length - 1, planAt + +pv.dataset.pv)); return paintTask(); }
  if (t.closest('.tk-newver')) {
    taskEdit(() => { const ps = plansOf(it); ps.push({ t: Date.now(), text: ps[planAt].text }); it.body = ps.at(-1).text; });
    planAt = plansOf(it).length - 1; paintTask(); const ta = $('#task [data-plan]'); ta.focus(); const g = getSelection(); g.selectAllChildren(ta); g.collapseToEnd(); return;
  }
  const rl = t.closest('[data-rm-log]'); if (rl) { taskEdit(() => it.log.splice(+rl.dataset.rmLog, 1)); return paintTask(); }
  if (t.closest('[data-go-at]')) { const at = it.at; closeTask(); return focusTo(nd(at).kind === 'ftab' ? parent(at).id : at); }
  const gd = t.closest('[data-go-doc]'); if (gd) { closeTask(); return openDoc(gd.dataset.goDoc); }
  if (t.closest('.tk-rm')) {
    taskOpen = null; $('#task').hidden = true;
    snap(); if (docsUsing(it).length) it.at = null; else listOf(it.kind).splice(listOf(it.kind).indexOf(it), 1);
    save(); renderAll(); ed?.refresh?.(); return toast(it.kind === 'idea' ? 'Idea quitada' : 'Tarea quitada', [['Deshacer', doUndo]]);
  }
});

// ---- selecting, to copy context by hand -------------------------------------------------------------------------------
// Ctrl+click puts something in (with everything inside) or takes it out, and it adds up; a plain click still navigates.
// While something is chosen, a bar at the bottom says what is in and copies it as one Markdown text.
const SEL = new Map(JSON.parse(localStorage.getItem('meadow.sel.' + P) || '[]'));   // id → 'all' | 'self'
const selInc = Object.assign({ ideas: true, tareas: true, texto: true }, JSON.parse(localStorage.getItem('meadow.selinc') || '{}'));
let selMode = false;
const selKeep = () => { localStorage.setItem('meadow.sel.' + P, JSON.stringify([...SEL])); localStorage.setItem('meadow.selinc', JSON.stringify(selInc)); };
const isItemId = (id) => [...S.tasks, ...S.ideas].some((x) => x.id === id);
for (const [k, m] of SEL) if (m !== 'all') SEL.set(k, 'all');       // older «only itself» choices count whole
let selHidden = false;                                                 // the bar put away (the choice stays)
function selRotate(id) { SEL.has(id) ? SEL.delete(id) : SEL.set(id, 'all'); selHidden = false; selKeep(); paintSel(); }
function setSelMode() { if (!SEL.size) return toast('Ctrl+clic en un marco, documento, página, apartado, idea o tarea para elegirlo como contexto'); selHidden = !selHidden; paintSel(); }
// what is inside something chosen «with everything» is in too (lighter)
function selUnder(id) { for (const [k, m] of SEL) if (m === 'all' && k !== id && nd(k) && nd(id) && isIn(id, k)) return true; return false; }
function paintSel() {
  for (const el of document.querySelectorAll('.sel-all, .sel-self, .sel-in')) el.classList.remove('sel-all', 'sel-self', 'sel-in');
  if (!SEL.size || selHidden) return paintSelPill();   // the marks show while the bar does
  const mark = (el, id) => { const m = SEL.get(id); if (m) el.classList.add(m === 'all' ? 'sel-all' : 'sel-self'); else if (selUnder(id)) el.classList.add('sel-in'); };
  for (const el of document.querySelectorAll('#stage .fr[data-id], #stage .dc[data-id], #areas .ar[data-area]')) mark(el, el.dataset.id || el.dataset.area);
  for (const el of document.querySelectorAll('#stage .ft[data-tab]')) mark(el, el.dataset.tab);
  for (const el of document.querySelectorAll('#stage [data-pg]')) mark(el, el.dataset.pg);
  for (const el of document.querySelectorAll('#stage .it[data-it]')) { const it = [...S.tasks, ...S.ideas].find((x) => x.id === el.dataset.it); if (SEL.has(el.dataset.it)) el.classList.add('sel-all'); else if (it && placeOf(it) && (SEL.get(placeOf(it)) === 'all' || selUnder(placeOf(it)))) el.classList.add('sel-in'); }
  paintSelPill();
}
// ---- the context, as Markdown ----
const KNAME = { area: 'Apartado', frame: 'Marco', ftab: 'Pestaña', doc: 'Documento', dtab: 'Página' };
function itemMD(it, pad = '') {
  const head = it.kind === 'idea' ? `${pad}- 💡 ${it.text || '…'} (idea · ${stLabel(it)})` : `${pad}- [${it.done ? 'x' : ' '}] ${it.text || '…'} (tarea · ${stLabel(it)}${whoOf(it.who) === 'Agente' ? ' · para el agente' : ''})`;
  const plan = (it.plans?.length ? it.plans.at(-1).text : it.body) || '';
  const lines = [head];
  if (plan.trim()) lines.push(`${pad}  ${it.kind === 'idea' ? 'La idea' : 'El plan'}: ${plan.trim().replace(/\n/g, '\n' + pad + '  ')}`);
  if ((it.notes || '').trim()) lines.push(`${pad}  A tener en cuenta: ${it.notes.trim().replace(/\n/g, '\n' + pad + '  ')}`);
  const bl = it.kind === 'tarea' ? blockers(it).filter((x) => !x.done) : [];
  if (bl.length) lines.push(`${pad}  La bloquean: ${bl.map((x) => '«' + (x.text || '…') + '»').join(', ')}`);
  for (const e of (it.log || []).filter((e) => !e.auto)) lines.push(`${pad}  ${whoOf(e.by)} (${whenStr(e.t)}): ${e.text}`);
  return lines.join('\n');
}
const itemOn = (it) => (it.kind === 'idea' ? selInc.ideas : selInc.tareas);
function buildContext() {
  const out = [`# Contexto · ${nd(S.root).title}`], stats = { docs: 0, pages: 0, titles: 0, tareas: 0, ideas: 0, frames: 0 };
  const seenItems = new Set();
  const implicit = (n) => (n.kind === 'ftab' || n.kind === 'dtab') && parent(n.id)?.kids.length === 1;
  const textOf = (t) => (t || '').replace(TOKEN_RE, (m, k, n) => { const it = listOf(k).find((x) => x.n === +n); return it ? `[${k}: ${it.text || '…'}]` : m; });
  // Markdown has six levels and the tree is deeper: every container is a «##» section named by its whole path,
  // a page is «###», and the titles inside a text go three levels down. A container with nothing of its own shows
  // no empty heading (its path is in what follows), unless it was chosen «only itself».
  const where = (id) => pathOf(id).filter((x) => x.kind !== 'project' && !implicit(x)).map((x) => x.title).join(' › ');
  const take = (list) => { const l = list.filter((it) => itemOn(it) && !seenItems.has(it.id)); l.forEach((it) => { seenItems.add(it.id); stats[it.kind === 'idea' ? 'ideas' : 'tareas']++; }); return l; };
  const walk = (id, inherit) => {
    const n = nd(id); if (!n) return;
    const mode = SEL.get(id) || (inherit ? 'all' : null);
    if (mode && n.kind !== 'project' && !(n.kind === 'ftab' && implicit(n))) {
      const here = mode === 'all' ? take(itemsAt(id)) : [];
      if (n.kind === 'frame') stats.frames++;
      if (n.kind === 'doc') { stats.docs++; out.push('', `## Documento: ${where(id)}`); }
      else if (n.kind === 'dtab') {
        stats.pages++;
        if (!implicit(n)) out.push('', `### Página: ${n.title}`);
        else if (SEL.get(id) || !SEL.get(parent(id).id) && !inherit) out.push('', `## Documento: ${where(parent(id).id)}`);
        if (mode === 'all' && selInc.texto && (n.text || '').trim()) {
          out.push('', textOf(n.text).trim().replace(/^(#{1,6})(?=\s)/gm, (h) => '#'.repeat(Math.min(6, h.length + 3))));
          stats.titles += (n.text.match(/^#{1,6}\s/gm) || []).length;
        }
        if (mode === 'all') here.push(...take([...S.tasks, ...S.ideas].filter((it) => (n.text || '').includes(token(it)))));
      } else if (mode === 'self' || here.length) out.push('', `## ${KNAME[n.kind] || ''}: ${where(id)}`);
      if (here.length) out.push('', here.map((it) => itemMD(it)).join('\n'));
    }
    for (const k of n.kids) walk(k, mode === 'all');
  };
  walk(S.root, false);
  const loose = [...S.tasks, ...S.ideas].filter((it) => SEL.has(it.id) && !seenItems.has(it.id));
  if (loose.length) {
    out.push('', '## Tareas e ideas');
    for (const it of loose) { const p = placeOf(it); out.push('', itemMD(it) + (p ? `\n  En: ${nestPath(p)}` : '')); stats[it.kind === 'idea' ? 'ideas' : 'tareas']++; }
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { text, stats, words: (text.match(/\S+/g) || []).length, bytes: new Blob([text]).size };
}
function paintSelPill() {
  // only while selecting; what was chosen stays for the next time
  const pill = $('#selpill'), show = SEL.size > 0 && !selHidden;
  pill.classList.toggle('on', show); $('#sel-btn').classList.toggle('on', show);
  if (!show) return;
  const c = buildContext(), s = c.stats;
  const kb = c.bytes < 1024 ? c.bytes + ' B' : (c.bytes / 1024).toLocaleString('es', { maximumFractionDigits: 1 }) + ' KB';
  const counts = [[s.frames, '⬚', 'marcos'], [s.docs, '📄', 'documentos'], [s.pages, '▭', 'páginas'], [s.titles, '#', 'títulos'], [s.tareas, '☐', 'tareas'], [s.ideas, '💡', 'ideas']]
    .filter((x) => x[0]).map(([n, ico, what]) => `<span class="sp-c" title="${n} ${what}"><span>${ico}</span>${n}</span>`).join('');
  pill.innerHTML = `<span class="sp-counts">${counts}</span>
    <span class="sp-size"><b>${c.words.toLocaleString('es')}</b> palabras<small>${kb}</small></span>
    <span class="sp-inc"><button data-inc="texto" class="${selInc.texto ? 'on' : ''}" title="${selInc.texto ? 'Con' : 'Sin'} el texto de las páginas">¶</button><button data-inc="tareas" class="${selInc.tareas ? 'on' : ''}" title="${selInc.tareas ? 'Con' : 'Sin'} las tareas"><span class="ed-task-ico"></span></button><button data-inc="ideas" class="${selInc.ideas ? 'on' : ''}" title="${selInc.ideas ? 'Con' : 'Sin'} las ideas">💡</button></span>
    <button class="sp-clear" title="Quitar toda la selección">Vaciar</button><button class="sp-copy">Copiar contexto</button><button class="sp-done" title="Guardar la barra; lo elegido se queda (Ctrl+clic la vuelve a sacar)">–</button>`;
}
async function copyContext() {
  const { text, words } = buildContext();
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  window.__lastContext = text;
  toast(`Contexto copiado · ${words.toLocaleString('es')} palabras`);
}
$('#sel-btn').onclick = () => setSelMode();
$('#selpill').addEventListener('click', (e) => {
  const t = e.target;
  const inc = t.closest('[data-inc]'); if (inc) { selInc[inc.dataset.inc] = !selInc[inc.dataset.inc]; selKeep(); return paintSelPill(); }
  if (t.closest('.sp-clear')) { SEL.clear(); selKeep(); return paintSel(); }
  if (t.closest('.sp-copy')) return copyContext();
  if (t.closest('.sp-done')) { selHidden = true; return paintSel(); }
});
// Ctrl+click chooses (nothing opens, nothing is deleted); a plain click does what it always did
addEventListener('click', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const t = e.target;
  if (t.closest('#selpill, #top, #ed, #task, #draw, #pick, #toasts, #list, #map')) return;
  const arEl = t.closest('#areas .ar[data-area]');
  const it = t.closest('#stage .it[data-it]'), pg = t.closest('#stage [data-pg]'), ft = t.closest('#stage .ft[data-tab]'), dc = t.closest('#stage .dc[data-id]'), fr = t.closest('#stage .fr[data-id]');
  const id = it ? it.dataset.it : pg ? pg.dataset.pg : ft ? ft.dataset.tab : dc ? dc.dataset.id : fr ? fr.dataset.id : arEl ? arEl.dataset.area : null;
  if (!id) return;
  e.preventDefault(); e.stopPropagation(); selRotate(id);
}, true);

// ---- drawings: quick sketches hung on a frame or a document ------------------------------------------------------------
// Figures only (rectangle, circle, triangle, diamond, line), chosen by passing over them and put on the sheet by dragging.
// Stored as figures, never pixels; painted pixel by pixel on a small sheet (96 × 64), so they look like pixel art.
const DW_W = 96, DW_H = 64;
const DW_COLORS = {
  top: ['#f6c9d6', '#f9d8b8', '#f8eaa6', '#cfeccd', '#c4e3f3', '#cfd3f5', '#e3cdf1', '#f2f0ee'],
  left: ['#2f2735', '#3d5a80', '#7a2e3a', '#2e6b4a', '#8a5a2b', '#6b6670'],
  right: ['#e0607e', '#f0954a', '#e8c547', '#56b37f', '#4a9fd8', '#8f78d6'],
};
const DW_SHAPES = [['rect', 'Rectángulo'], ['ellipse', 'Círculo'], ['tri', 'Triángulo'], ['diamond', 'Rombo'], ['line', 'Línea']];
const drawsAt = (id) => (S.drawings || []).filter((d) => d.at === id);
const darker = (hex, k = 0.72) => { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.round(v * k).toString(16).padStart(2, '0'); return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255); };
// is a point inside a figure (in sheet units)
function inside(s, x, y) {
  if (s.t === 'rect') return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
  if (s.t === 'ellipse') { const rx = s.w / 2, ry = s.h / 2; return rx > 0 && ry > 0 && ((x - s.x - rx) / rx) ** 2 + ((y - s.y - ry) / ry) ** 2 <= 1; }
  if (s.t === 'diamond') { const rx = s.w / 2, ry = s.h / 2; return rx > 0 && ry > 0 && Math.abs(x - s.x - rx) / rx + Math.abs(y - s.y - ry) / ry <= 1; }
  if (s.t === 'tri') { if (y < s.y || y > s.y + s.h || !s.h) return false; const half = (s.w / 2) * (y - s.y) / s.h; return Math.abs(x - s.x - s.w / 2) <= half; }
  return false;
}
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
// paint the figures pixel by pixel on a sheet-sized context (older drawings were on a 192 × 128 sheet)
function paintShapes(ctx, shapes, base = DW_W) {
  const k = DW_W / base;
  ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, DW_W, DW_H);
  for (const s0 of shapes) {
    const s = { ...s0 }; for (const p of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2']) if (s[p] != null) s[p] *= k;
    if (s.t === 'line' || s.t === 'path') {
      const segs = s.t === 'line' ? [[s.x1, s.y1, s.x2, s.y2]] : s.pts.slice(1).map((p, i) => [s.pts[i][0] * k, s.pts[i][1] * k, p[0] * k, p[1] * k]);
      ctx.fillStyle = s.c;
      for (const [ax, ay, bx, by] of segs) for (let y = Math.floor(Math.min(ay, by) - 1); y <= Math.max(ay, by) + 1; y++) for (let x = Math.floor(Math.min(ax, bx) - 1); x <= Math.max(ax, bx) + 1; x++) if (segDist(x + 0.5, y + 0.5, ax, ay, bx, by) <= 0.62) ctx.fillRect(x, y, 1, 1);
      continue;
    }
    const x0 = Math.floor(s.x), y0 = Math.floor(s.y), x1 = Math.ceil(s.x + s.w), y1 = Math.ceil(s.y + s.h), edge = darker(s.c);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!inside(s, x + 0.5, y + 0.5)) continue;
      const rim = !inside(s, x - 0.5, y + 0.5) || !inside(s, x + 1.5, y + 0.5) || !inside(s, x + 0.5, y - 0.5) || !inside(s, x + 0.5, y + 1.5);
      ctx.fillStyle = rim ? edge : s.c; ctx.fillRect(x, y, 1, 1);
    }
  }
}
const thumbCache = new Map();
function drawThumb(d) {
  const key = d.id + ':' + (d.v || 0) + ':' + d.shapes.length;
  if (!thumbCache.has(key)) { const c = document.createElement('canvas'); c.width = DW_W; c.height = DW_H; paintShapes(c.getContext('2d'), d.shapes, d.base || 192); thumbCache.set(key, c.toDataURL()); }
  return thumbCache.get(key);
}
const thumbs = (id) => drawsAt(id).map((d) => `<img class="dw-th" data-draw="${d.id}" src="${drawThumb(d)}" alt="" title="Dibujo · clic para abrirlo">`).join('');

// the sheet
let dwOpen = null, dwColor = DW_COLORS.top[4], dwShape = 'rect', dwSnapped = false;
const dwNow = () => (S.drawings || []).find((d) => d.id === dwOpen);
const shapeIco = (t) => `<svg viewBox="0 0 20 20" width="18" height="18">${{ rect: '<rect x="3" y="5" width="14" height="10"/>', ellipse: '<circle cx="10" cy="10" r="7"/>', tri: '<path d="M10 3 L17 16 L3 16 Z"/>', diamond: '<path d="M10 2 L18 10 L10 18 L2 10 Z"/>', line: '<path d="M3 17 L17 3" stroke-width="2.4" fill="none"/>' }[t]}</svg>`;
function openDrawing(d) {
  if (!d) return;
  dwOpen = d.id; dwSnapped = false;
  const box = $('#draw');
  box.querySelector('.dw-top').innerHTML = DW_COLORS.top.map((c) => `<i data-col="${c}" style="--c:${c}"></i>`).join('');
  box.querySelector('.dw-left').innerHTML = DW_COLORS.left.map((c) => `<i data-col="${c}" style="--c:${c}"></i>`).join('');
  box.querySelector('.dw-right').innerHTML = DW_COLORS.right.map((c) => `<i data-col="${c}" style="--c:${c}"></i>`).join('');
  box.querySelector('.dw-shapes').innerHTML = DW_SHAPES.map(([t, name]) => `<b data-shape="${t}" title="${name}">${shapeIco(t)}</b>`).join('');
  box.querySelector('.dw-where').textContent = nestPath(d.at) || '';
  box.hidden = false; dwPaint(); dwPickColor(dwColor); dwPickShape(dwShape);
  box.querySelector('.dw-in').animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
}
function closeDrawing() {
  const d = dwNow(); if (!dwOpen) return;
  if (d?.fresh && !d.shapes.length) S.drawings.splice(S.drawings.indexOf(d), 1);
  if (d) delete d.fresh;
  dwOpen = null; $('#draw').hidden = true; save(); renderAll();
}
function dwPaint(preview) {
  const d = dwNow(); if (!d) return;
  paintShapes($('#dw-c').getContext('2d'), preview ? [...d.shapes.map((s) => ({ ...s })), preview] : d.shapes, d.base || 192);
}
function dwPickColor(c) { dwColor = c; for (const el of document.querySelectorAll('#draw [data-col]')) el.classList.toggle('on', el.dataset.col === c); $('#draw .dw-cur').style.background = c; for (const el of document.querySelectorAll('#draw [data-shape]')) el.style.color = c; }
function dwPickShape(t) { dwShape = t; for (const el of document.querySelectorAll('#draw [data-shape]')) el.classList.toggle('on', el.dataset.shape === t); }
function dwEdit(fn) { if (!dwSnapped) { snap(); dwSnapped = true; } fn(); const d = dwNow(); d.v = (d.v || 0) + 1; save(); dwPaint(); }
// colours and figures are taken by passing over them, no click
let dwHoverT = null;
$('#draw').addEventListener('pointerover', (e) => {
  const sw = e.target.closest('[data-col]'), sh = e.target.closest('[data-shape]'); clearTimeout(dwHoverT);
  if (sw) dwHoverT = setTimeout(() => dwPickColor(sw.dataset.col), 90);
  if (sh) dwHoverT = setTimeout(() => dwPickShape(sh.dataset.shape), 90);
});
// a figure is put on the sheet by dragging its box (a line: from where you press to where you let go)
$('#dw-c').addEventListener('pointerdown', (e) => {
  const d = dwNow(); if (!d) return;
  const c = e.currentTarget, r = c.getBoundingClientRect(), k = (d.base || 192) / DW_W;   // figures are kept in the drawing's own units
  const at = (ev) => [Math.max(0, Math.min(DW_W, Math.round((ev.clientX - r.left) * DW_W / r.width))), Math.max(0, Math.min(DW_H, Math.round((ev.clientY - r.top) * DW_H / r.height)))];
  const p0 = at(e); c.setPointerCapture(e.pointerId);
  const fig = (p1) => {
    if (dwShape === 'line') return { t: 'line', x1: p0[0] * k, y1: p0[1] * k, x2: p1[0] * k, y2: p1[1] * k, c: dwColor };
    const x = Math.min(p0[0], p1[0]), y = Math.min(p0[1], p1[1]);
    return { t: dwShape, x: x * k, y: y * k, w: Math.abs(p1[0] - p0[0]) * k, h: Math.abs(p1[1] - p0[1]) * k, c: dwColor };
  };
  let last = p0;
  const mv = (ev) => { last = at(ev); dwPaint(fig(last)); };
  const up = () => {
    c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up);
    const s = fig(last), big = s.t === 'line' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= k : s.w >= k && s.h >= k;
    if (!big) return dwPaint();
    dwEdit(() => dwNow().shapes.push(s));
  };
  c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up);
});
$('#draw').addEventListener('click', (e) => {
  const d = dwNow(); if (!d) return; const t = e.target;
  if (t === $('#draw') || t.closest('.dw-close')) return closeDrawing();
  if (t.closest('.dw-undo')) return d.shapes.length && dwEdit(() => d.shapes.pop());
  if (t.closest('.dw-clear')) return d.shapes.length && dwEdit(() => { d.shapes = []; });
  if (t.closest('.dw-rm')) { dwOpen = null; $('#draw').hidden = true; snap(); S.drawings.splice(S.drawings.indexOf(d), 1); save(); renderAll(); return toast('Dibujo quitado', [['Deshacer', doUndo]]); }
});
addEventListener('keydown', (e) => {
  if (!dwOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDrawing(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); const d = dwNow(); if (d.shapes.length) dwEdit(() => d.shapes.pop()); }
}, true);
// a new drawing, on the container it was dropped on (only frames and documents)
function newDrawing(at) {
  let n = nd(at); if (n?.kind === 'ftab') n = parent(at); if (n?.kind === 'dtab') n = parent(at);
  if (!n || (n.kind !== 'frame' && n.kind !== 'doc')) return toast('Un dibujo va en un marco o en un documento: arrástralo encima de uno');
  snap(); S.drawings ||= []; S.seq.dibujo = (S.seq.dibujo || 0) + 1;
  const d = { id: 'd' + S.seq.dibujo + '-' + uid().slice(0, 3), n: S.seq.dibujo, at: n.id, shapes: [], base: DW_W, created: Date.now(), fresh: true };
  S.drawings.push(d); save(); renderAll(); openDrawing(d);
}
addEventListener('click', (e) => { const th = e.target.closest('.dw-th'); if (!th || selMode) return; e.preventDefault(); e.stopPropagation(); openDrawing((S.drawings || []).find((d) => d.id === th.dataset.draw)); }, true);

// ---- the editor: a document, its tabs (pages), the writing ----------------------------------------------------------
let ed = null, cur = null, curTab = null;
const $ed = $('#ed');
function openDoc(id, tabId, fromEl) {
  const d = nd(id); if (!d) return;
  ensureTab(d);
  cur = id; curTab = tabId && d.kids.includes(tabId) ? tabId : activeTab(d); d.active = curTab;
  if (mins.some((m) => m.id === id)) { mins = mins.filter((m) => m.id !== id); renderDock(); }
  if (!ed) ed = createEditor($('#ed-body'), edApi);
  $ed.classList.add('open');
  ed.setDoc(nd(curTab).text || '');
  renderEdHead(); renderMap();
  const an = fromEl && (fromEl.closest?.('#dock') ? restoreFrom(fromEl) : glideFrom($('.ed-panel'), fromEl.getBoundingClientRect(), 360));
  const settle = () => { ed.view.requestMeasure(); ed.refresh?.(); };
  if (an) an.finished.then(settle, settle); else requestAnimationFrame(settle);
  ed.focus();
}
function showTab(tabId) { if (!cur) return; const d = nd(cur); curTab = tabId; d.active = tabId; ed.setDoc(nd(tabId).text || ''); renderEdHead(); renderMap(); }
function closeDoc() {
  if (!cur) return;
  const id = cur; cur = null; curTab = null; $ed.classList.remove('open'); trail = []; $('#ed-back').hidden = true; $('#linkpill').classList.remove('on'); save(); renderAll();
  const el = stage.querySelector(`.dc[data-id="${id}"]`); el?.animate([{ transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 320, easing: EASE.snap });
}
function renderEdHead() {
  const d = nd(cur); if (!d) return;
  backlinks();
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
let mins = JSON.parse(localStorage.getItem('meadow.mins') || '[]');
function renderDock() {
  mins = mins.filter((m) => nd(m.id)); localStorage.setItem('meadow.mins', JSON.stringify(mins));
  $('#dock').innerHTML = mins.map((m) => `<div class="dk" data-doc="${m.id}" title="Volver a «${esc(nd(m.id).title)}»"><span>📄</span>${esc(nd(m.id).title)}<button class="dk-x" title="Quitar de aquí">×</button></div>`).join('');
}
function minimize() {
  if (!cur) return;
  const id = cur, tab = curTab;
  mins = mins.filter((m) => m.id !== id); mins.push({ id, tab });
  renderDock();
  const chip = $(`#dock .dk[data-doc="${id}"]`), panel = $('.ed-panel'), back = $('.ed-back');
  if (!chip) return closeDoc();
  const a = panel.getBoundingClientRect(), b = chip.getBoundingClientRect(), k = Math.max(b.width / a.width, 0.1);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anims = [
    panel.animate([{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.45 }, { transform: `translate(${dx}px,${dy}px) scale(${k})`, opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' }),
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }),
  ];
  chip.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(.5)', offset: 0.55 }, { opacity: 1, transform: 'scale(1.08)', offset: 0.85 }, { opacity: 1, transform: 'none' }],
    { duration: 560, easing: 'ease-out' });
  const done = () => { closeDoc(); anims.forEach((x) => x.cancel()); };
  anims[0].finished.then(done, done);
}
function restoreFrom(el) {   // the reverse: out of the dock, growing whole into place
  const panel = $('.ed-panel'), a = panel.getBoundingClientRect(), b = el.getBoundingClientRect(), k = Math.max(b.width / a.width, 0.1);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  return panel.animate([{ transform: `translate(${dx}px,${dy}px) scale(${k})`, opacity: 0 }, { opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }],
    { duration: 400, easing: 'cubic-bezier(.2,.8,.25,1)' });
}
$('#ed-min').onclick = minimize;
function edItemMenu(kind, anchor) {
  if (!ed || !cur) return;
  const d = nd(cur), name = kind === 'idea' ? 'idea' : 'tarea', plural = kind === 'idea' ? 'ideas' : 'tareas';
  const insert = { label: kind === 'idea' ? '💡 Insertar una idea aquí' : '☐ Insertar una tarea aquí', run: () => { const it = newItem(kind, '', null); save(); ed.insertAtCursor('{' + kind + ' ' + it.n + '}'); openTask(it); } };
  const see = d.kids.length > 1
    ? [{ label: `Ver las ${plural} de todo el documento`, run: () => openList(kind, cur) }, ...d.kids.map((k) => ({ label: `Ver las de la pestaña «${nd(k).title}»`, run: () => openList(kind, k) }))]
    : [{ label: `Ver las ${plural} de este documento`, run: () => openList(kind, cur) }];
  askChoice(anchor, kind === 'idea' ? 'Ideas' : 'Tareas', '', [insert, ...see]);
}
const edInsert = (kind) => { if (!ed || !cur) return; const it = newItem(kind, '', null); save(); ed.insertAtCursor('{' + kind + ' ' + it.n + '}'); openTask(it); };
$('#ed-task').onclick = () => edInsert('tarea');
$('#ed-idea').onclick = () => edInsert('idea');
$('#dock').addEventListener('click', (e) => {
  const x = e.target.closest('.dk-x'), k = e.target.closest('.dk'); if (!k) return;
  const id = k.dataset.doc, m = mins.find((q) => q.id === id);
  const ghostChip = k.cloneNode(true); Object.assign(ghostChip.style, { position: 'fixed', left: k.getBoundingClientRect().left + 'px', top: k.getBoundingClientRect().top + 'px', margin: 0, pointerEvents: 'none', zIndex: 29 });
  mins = mins.filter((q) => q.id !== id); renderDock();
  if (x) return;
  document.body.append(ghostChip); openDoc(id, m?.tab, ghostChip);
  ghostChip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(() => ghostChip.remove());
});
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
  openItem(kind, n) { openTask(listOf(kind).find((x) => x.n === n)); },
  editItem(kind, n, el) { const it = listOf(kind).find((x) => x.n === n); if (it) openTask(it); },
  createDoc(name, text = '', o = {}) {
    const p = PAR.get(cur), d = mk('doc', name); d.kids.push(mk('dtab', 'Página 1', { text }).id);
    if (p) { const P = nd(p); P.kids.splice(P.kids.indexOf(cur) + 1, 0, d.id); } else S.drawer.push(d.id);
    reindex(); save(); renderAll();
    if (o.announce) toast(`«${name}» creado al lado`, [['Abrir', () => openDoc(d.id)]], 6000);
    return d.n;
  },
  openDoc(n) { const d = docs().find((x) => x.n === n); if (!d) return toast('Ese documento ya no existe'); pushTrail(); openDoc(d.id); },
  openRef(ref, head) { pushTrail(); openRef(ref, head); },
  toast: (m) => toast(m),
  onOutline(heads, current) {
    $('#toc-list').innerHTML = heads.length
      ? heads.map((h) => `<button class="toc d${Math.min(h.d, 3)}${h.line === current ? ' on' : ''}" data-line="${h.line}" data-drag="head:${curTab}:${h.line}" title="Clic: ir · arrastra: llevarlo a otro sitio (se convierte)">${esc(h.text)}</button>`).join('')
      : '<p class="none">Escribe <b># Título</b> para dividir la página en secciones; aparecerán aquí, y podrás arrastrarlas a otro sitio.</p>';
  },
  onLevel(l) { level = l; for (const b of document.querySelectorAll('#ed-lv [data-l]')) b.classList.toggle('on', +b.dataset.l === l); },
};

// ---- links: to anything of the tree, at any level (frames, tabs, documents, pages, titles) ----------------------------
let trail = [];
function pushTrail() { if (cur) { trail.push({ id: cur, tab: curTab, pos: ed.view.state.selection.main.head, top: ed.view.scrollDOM.scrollTop }); $('#ed-back').hidden = false; } }
$('#ed-back').onclick = () => {
  const t = trail.pop(); $('#ed-back').hidden = !trail.length; if (!t || !nd(t.id)) return;
  openDoc(t.id, t.tab);
  setTimeout(() => { ed.view.dispatch({ selection: { anchor: Math.min(t.pos, ed.view.state.doc.length) } }); ed.view.scrollDOM.scrollTop = t.top; }, 30);
};
function headLine(tabId, title) { const ls = (nd(tabId)?.text || '').split('\n'); const i = ls.findIndex((l) => { const m = l.match(HEAD); return m && m[2].trim() === title; }); return i < 0 ? null : i + 1; }
function openRef(ref, head) {
  const n = nd(ref); if (!n) return toast('Eso ya no existe');
  if (['project', 'area', 'frame', 'ftab'].includes(n.kind)) { if (cur) closeDoc(); return focusTo(n.id); }
  const d = n.kind === 'doc' ? n : parent(n.id), tab = n.kind === 'dtab' ? n.id : null;
  openDoc(d.id, tab);
  if (head) { const ln = headLine(curTab, head); if (ln) setTimeout(() => ed.gotoLine(ln), 40); else toast(`El título «${head}» ya no está`); }
}
// everything that can be linked, as a tree of entries: { ref, head, kind, title, kids() }
function entryOf(id) {
  const n = nd(id);
  const e = { ref: id, kind: n.kind, title: n.title };
  e.kids = () => {
    if (n.kind === 'dtab') { const hs = (x) => x.kids.map((k) => ({ ref: id, head: k.title, kind: 'h', d: k.d, title: k.title, kids: () => hs(k) })); return hs(parseText(n.text)); }
    if ((n.kind === 'frame' || n.kind === 'doc') && n.kids.length === 1) return entryOf(n.kids[0]).kids();   // its only tab adds no level
    return n.kids.map(entryOf);
  };
  return e;
}
function allEntries() {
  const out = [], walk = (e, path) => { if (e.kind !== 'project') out.push({ ...e, path }); for (const k of e.kids()) walk(k, e.kind === 'project' ? [] : [...path, e.title]); };
  walk(entryOf(S.root), []);
  for (const id of S.drawer) if (nd(id)) walk(entryOf(id), ['Cajón']);
  return out;
}
const KICON = { area: '▤', frame: '⬚', ftab: '▭', doc: '📄', dtab: '▭', h: '#' };
const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let lk = null;                                               // { from, to, text, stack: [entry], list: [entry], i }
function openLinker() {
  if (!cur) return;
  const r = ed.view.state.selection.main; if (r.empty) return toast('Selecciona primero el texto que quieres enlazar');
  lk = { from: r.from, to: r.to, text: ed.view.state.sliceDoc(r.from, r.to).replace(/\n/g, ' ').trim(), stack: [entryOf(S.root)], i: 0 };
  $('#linkpill').classList.remove('on');
  const c = ed.view.coordsAtPos(r.to) || { left: innerWidth / 2, bottom: innerHeight / 3 }, box = $('#linker');
  Object.assign(box.style, { left: Math.max(12, Math.min(innerWidth - 470, c.left - 60)) + 'px', top: Math.max(70, Math.min(innerHeight - 440, c.bottom + 10)) + 'px' });
  box.querySelector('.lk-sel').textContent = '«' + lk.text.slice(0, 40) + (lk.text.length > 40 ? '…' : '') + '»';
  $('#lk-q').value = ''; box.classList.add('on'); paintLinker(); $('#lk-q').focus();
}
function closeLinker() { lk = null; $('#linker').classList.remove('on'); ed?.focus(); }
function paintLinker() {
  const q = fold($('#lk-q').value.trim());
  if (q) { lk.list = allEntries().filter((e) => fold(e.title).includes(q)).slice(0, 60); $('#lk-crumbs').innerHTML = '<span class="lk-mode">Buscando en todo</span>'; }
  else {
    lk.list = lk.stack.at(-1).kids();
    $('#lk-crumbs').innerHTML = lk.stack.map((e, i) => `${i ? '<span class="sep">›</span>' : ''}<button data-lk-up="${i}">${esc(e.title)}</button>`).join('');
  }
  lk.i = Math.min(lk.i, Math.max(0, lk.list.length - 1));
  $('#lk-list').innerHTML = lk.list.map((e, i) => {
    const deeper = e.kids().length;
    return `<div class="lk-row${i === lk.i ? ' on' : ''}" data-i="${i}"><span class="lk-k k-${e.kind}">${e.kind === 'h' ? '#'.repeat(Math.min(e.d, 3)) : KICON[e.kind]}</span><div class="lk-t"><div>${esc(e.title)}</div>${q && e.path.length ? `<small>${esc(e.path.join(' › '))}</small>` : ''}</div>${deeper && !q ? `<button class="lk-in" data-in="${i}" title="Ver lo de dentro">›</button>` : ''}</div>`;
  }).join('') || '<p class="none">Nada con ese nombre.</p>';
  $('#lk-list .lk-row.on')?.scrollIntoView({ block: 'nearest' });
}
function pickLink(e) {
  const ref = e.head ? `${e.ref}#${e.head}` : e.ref, label = lk.text.replace(/[\[\]]/g, '');
  const ins = `[${label}@${ref}]`;
  ed.view.dispatch({ changes: { from: lk.from, to: lk.to, insert: ins }, selection: { anchor: lk.from + ins.length } });
  toast(`Enlazado a «${e.title}»`); closeLinker();
}
$('#lk-q').addEventListener('input', () => { lk.i = 0; paintLinker(); });
$('#lk-q').addEventListener('keydown', (e) => {
  if (!lk) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); lk.i = Math.min(lk.list.length - 1, lk.i + 1); paintLinker(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); lk.i = Math.max(0, lk.i - 1); paintLinker(); }
  else if (e.key === 'Enter') { e.preventDefault(); const x = lk.list[lk.i]; if (x) pickLink(x); }
  else if (e.key === 'ArrowRight' && !$('#lk-q').value) { e.preventDefault(); const x = lk.list[lk.i]; if (x?.kids().length) { lk.stack.push(x); lk.i = 0; paintLinker(); } }
  else if ((e.key === 'ArrowLeft' || (e.key === 'Backspace' && !$('#lk-q').value)) && lk.stack.length > 1 && !$('#lk-q').value) { e.preventDefault(); lk.stack.pop(); lk.i = 0; paintLinker(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLinker(); }
});
$('#linker').addEventListener('mousedown', (e) => {
  if (e.target === $('#lk-q')) return;
  e.preventDefault();
  const up = e.target.closest('[data-lk-up]'); if (up) { lk.stack = lk.stack.slice(0, +up.dataset.lkUp + 1); lk.i = 0; $('#lk-q').value = ''; return paintLinker(); }
  const inn = e.target.closest('[data-in]'); if (inn) { lk.stack.push(lk.list[+inn.dataset.in]); lk.i = 0; return paintLinker(); }
  const row = e.target.closest('.lk-row'); if (row) pickLink(lk.list[+row.dataset.i]);
});
addEventListener('mousedown', (e) => { if (lk && !e.target.closest('#linker')) closeLinker(); }, true);
// selecting text in a page: a small «Enlazar» appears by the selection
function paintLinkPill() {
  const pill = $('#linkpill');
  if (!cur || lk) return pill.classList.remove('on');
  const r = ed.view.state.selection.main;
  if (r.empty || ed.view.state.sliceDoc(r.from, r.to).includes('\n')) return pill.classList.remove('on');
  const c = ed.view.coordsAtPos(r.from), c2 = ed.view.coordsAtPos(r.to); if (!c || !c2) return pill.classList.remove('on');
  Object.assign(pill.style, { left: (c.left + c2.left) / 2 + 'px', top: c.top - 34 + 'px' });
  pill.classList.add('on');
}
$('#ed-body').addEventListener('mouseup', () => setTimeout(paintLinkPill, 0));
$('#ed-body').addEventListener('keyup', (e) => { if (e.shiftKey || e.key.startsWith('Arrow')) paintLinkPill(); });
$('#ed-body').addEventListener('mousedown', () => $('#linkpill').classList.remove('on'));
$('#linkpill').addEventListener('mousedown', (e) => { e.preventDefault(); openLinker(); });
// who links here: at the foot of the page
function backlinks() {
  const d = nd(cur); if (!d) return;
  const mine = new Set([d.id, ...d.kids]);
  const re = new RegExp(`\\[[^\\[\\]\\n]*?(?:\\*${d.n}|@(${[...mine].join('|')}))(?:#[^\\]\\n]*)?\\]`);
  const from = docs().filter((o) => o !== d && re.test(docText(o)));
  $('#ed-foot').innerHTML = from.length
    ? '<span>Enlazado desde</span>' + from.map((o) => `<button data-bl="${o.id}">📄 ${esc(o.title)}</button>`).join('')
    : '<span>Selecciona un texto y pulsa <b>🔗 Enlazar</b> (o Ctrl+K) para enlazarlo a cualquier marco, pestaña, documento o título · <b>[]</b> crea una tarea en la línea</span>';
}
$('#ed-foot').addEventListener('click', (e) => { const b = e.target.closest('[data-bl]'); if (b) { pushTrail(); openDoc(b.dataset.bl); } });

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
    if (taskOpen) { e.preventDefault(); return closeTask(); }
    if ($('#pick').classList.contains('on')) return $('#pick').classList.remove('on');
    if (document.querySelector('.pop')) return;
    if (!$('#map').classList.contains('mini')) return mapOpen(false);
    if (cur) { e.preventDefault(); return closeDoc(); }
    if (!typing) return zoomOut();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && cur) { e.preventDefault(); return openLinker(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && !cur) { e.preventDefault(); doUndo(); }
});

// ---- the start screen: every project, new, open a folder, move, where they are kept ----------------------------------
const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' }); };
async function api(url, body) { const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status); return j; }
async function showHome(note) {
  $('#home').hidden = false; document.title = 'Meadow';
  if (note) toast(note);
  paintHome(await api('/api/projects'));
}
function paintHome(L) {
  $('#hm-root').textContent = L.root;
  const ps = [...L.projects].sort((a, b) => (b.opened || b.updated || '').localeCompare(a.opened || a.updated || ''));
  $('#hm-list').innerHTML = ps.map((p) => `<div class="hm-p${p.exists ? '' : ' gone'}" data-p="${p.id}">
      <div class="hm-ico">🌿</div><div class="hm-t"><b>${esc(p.name)}</b><small>${esc(p.path)}</small></div>
      <span class="hm-when">${p.exists ? esc(ago(p.opened || p.updated)) : 'no está en su carpeta'}</span>
      <span class="hm-acts"><button data-mv="${p.id}" title="Moverlo a otra carpeta">Mover…</button><button data-rm="${p.id}" title="Quitarlo de la lista (no borra nada)">Quitar</button></span>
    </div>`).join('') || '<p class="none">Todavía no hay proyectos. Crea uno.</p>';
}
$('#home').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.closest('#hm-new')) {
      const box = document.createElement('div'); box.className = 'hm-p hm-newrow'; box.innerHTML = '<div class="hm-ico">🌿</div><input placeholder="Nombre del proyecto…">';
      $('#hm-list').prepend(box); const inp = box.querySelector('input'); inp.focus();
      inp.onkeydown = async (ev) => { if (ev.key === 'Escape') box.remove(); if (ev.key === 'Enter' && inp.value.trim()) { const j = await api('/api/projects', { name: inp.value.trim() }); location.href = '/?p=' + j.id; } };
      return;
    }
    if (t.closest('#hm-add')) { toast('Elige la carpeta en la ventana que se abre…'); const j = await api('/api/projects/add', {}); if (j.id) location.href = '/?p=' + j.id; return; }
    const mv = t.closest('[data-mv]'); if (mv) { toast('Elige a dónde moverlo en la ventana que se abre…'); paintHome(await api('/api/projects/move', { id: mv.dataset.mv })); return toast('Movido'); }
    const rm = t.closest('[data-rm]'); if (rm) return askChoice(rm, '¿Quitarlo de la lista?', 'Su carpeta y sus datos se quedan donde están; puedes volver a abrirlo con «Abrir carpeta…».', [{ label: 'Quitar de la lista', danger: true, run: async () => paintHome(await api('/api/projects/remove', { id: rm.dataset.rm })) }]);
    if (t.closest('#hm-root-ch')) return askChoice(t.closest('#hm-root-ch'), '¿Dónde guardo los proyectos?', 'Eliges la carpeta en la ventana que se abre.', [
      { label: 'Cambiar la carpeta y llevar allí los proyectos que hay en la actual', run: async () => { const j = await api('/api/root', { move: true }); if (!j.cancelled) { paintHome(j); toast(j.failed.length ? `Movidos ${j.moved.length}; no pude mover ${j.failed.length}` : `Hecho: ${j.moved.length} movidos`); } } },
      { label: 'Solo para los proyectos nuevos', run: async () => { const j = await api('/api/root', { move: false }); if (!j.cancelled) paintHome(j); } },
    ]);
    const card = t.closest('.hm-p[data-p]'); if (card && !card.classList.contains('gone')) location.href = '/?p=' + card.dataset.p;
  } catch (err) { toast('No se pudo: ' + err.message); }
});
$('#to-home').onclick = () => { flush(); location.href = '/'; };

window.meadow = { get S() { return S; }, render: () => renderAll() };   // for tests and the console
load();
