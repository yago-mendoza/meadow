// Meadow diagrams: boxes and arrows on an unbounded canvas. Plain DOM + SVG, no dependencies.
//
// The data is the contract (plain JSON, easy for an agent to read and write):
//   { v: 1,
//     nodes: [{ id, x, y, w, h, text, shape: 'box'|'ellipse'|'diamond'|'note', color }],
//     edges: [{ id, from, to, text, dashed }] }
// Coordinates are diagram units. Missing fields get defaults; nodes without x/y are laid out automatically
// (left to right along the arrows) and keep that place from then on. Unknown extra fields are kept as they are.
//
// createDiagram(container, { data, onChange, title, panOnDrag }) → { destroy, getData, setData, fit }
// diagramThumbSVG(data, w, h) → SVG markup of the whole diagram fitted into w×h, no UI.

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#f7e4ec', '#e3edf9', '#e5f3e4', '#f9eedb', '#ece3f7', '#dff2f0', '#ffffff', '#f6f2f7'];
const COLOR_NAMES = ['Rosa', 'Azul', 'Verde', 'Arena', 'Lila', 'Agua', 'Blanco', 'Niebla'];
const SHAPES = ['box', 'ellipse', 'diamond', 'note'];
const SHAPE_NAMES = { box: 'Caja', ellipse: 'Óvalo', diamond: 'Rombo', note: 'Nota' };
const SIZE = { box: [160, 70], ellipse: [160, 84], diamond: [180, 110], note: [150, 120] };
const FONT = '"Segoe UI", sans-serif';
const FS = 14, LH = 19;          // node text: size and line height
const LFS = 12.5, LLH = 16;      // arrow labels
const INK = '#3a2f3f', EDGE = '#8a7d8e', ACCENT = '#714b67', LABEL_INK = '#5b4f60';
const AH = 9;                    // arrowhead length
const GLIDE = 260;               // view glides: same duration as motion.js «smooth»

const ICON = {
  box: '<rect x="4" y="6" width="16" height="12" rx="3"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  diamond: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12Z"/>',
  note: '<path d="M5 5h14v9l-5 5H5Z"/><path d="M14 19v-5h5"/>',
  solid: '<path d="M4 12h16"/>',
  dashed: '<path d="M4 12h3M10.5 12h3M17 12h3"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;

// ---------- small helpers ----------

const f = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {                                   // mulberry32: the same id always wobbles the same way
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- colour ----------

const rgb = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const p = rgb(a), q = rgb(b); return toHex(...p.map((v, i) => v + (q[i] - v) * t)); };

const darkCache = new Map();
function darken(hex) {                                 // the outline: same hue, a little deeper
  if (darkCache.has(hex)) return darkCache.get(hex);
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = 60 * (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
    if (h < 0) h += 360;
  }
  if (s < 0.05) { h = 290; s = 0.1; }                 // greys and white get a faint lilac outline
  s = Math.min(0.6, s * 0.75 + 0.1);
  const L = Math.max(0.35, l - 0.22), c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const out = toHex((R + m) * 255, (G + m) * 255, (B + m) * 255);
  darkCache.set(hex, out);
  return out;
}

// ---------- text ----------

let ctx, ctxFont = '';
function measure(s, fs) {
  if (ctx === undefined) { try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; } }
  if (!ctx) return s.length * fs * 0.52;
  const font = `${fs}px ${FONT}`;
  if (ctxFont !== font) { ctx.font = font; ctxFont = font; }
  return ctx.measureText(s).width;
}

const wrapCache = new Map();
function wrap(text, maxW, fs = FS) {                   // word wrap; long words break by characters
  const key = fs + '|' + Math.round(maxW) + '|' + text;
  if (wrapCache.has(key)) return wrapCache.get(key);
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (measure(cand, fs) <= maxW) { line = cand; continue; }
      if (line) out.push(line);
      line = word;
      while (line.length > 1 && measure(line, fs) > maxW) {
        let i = line.length - 1;
        while (i > 1 && measure(line.slice(0, i), fs) > maxW) i--;
        out.push(line.slice(0, i));
        line = line.slice(i);
      }
    }
    out.push(line);
  }
  if (wrapCache.size > 4000) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}

// The room a shape leaves for its text, and the height its text needs.
const textW = (n) => Math.max(20, n.shape === 'ellipse' ? n.w * 0.74 - 10 : n.shape === 'diamond' ? n.w * 0.55 - 6 : n.w - (n.shape === 'note' ? 26 : 24));
function minH(n) {
  const t = wrap(n.text, textW(n)).length * LH;
  return Math.ceil(n.shape === 'ellipse' ? (t + 10) / 0.74 : n.shape === 'diamond' ? (t + 6) / 0.55 : t + (n.shape === 'note' ? 28 : 22));
}

function textSVG(lines, cx, top, fs, lh, fill) {
  return `<text font-family="Segoe UI, sans-serif" font-size="${fs}" fill="${fill}" text-anchor="middle" dominant-baseline="central">` +
    lines.map((l, i) => `<tspan x="${f(cx)}" y="${f(top + lh * (i + 0.5))}">${esc(l)}</tspan>`).join('') + '</text>';
}

// ---------- data ----------

const NODE_KEYS = ['id', 'x', 'y', 'w', 'h', 'text', 'shape', 'color'];
const EDGE_KEYS = ['id', 'from', 'to', 'text', 'dashed'];
const extras = (r, keys) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));

// Turns whatever came in (an agent may write only ids and texts) into complete data. `fixed` says whether anything
// had to be filled in that should be saved back (positions, ids).
function normalize(raw) {
  let src = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src); } catch { src = null; } }
  if (!src || typeof src !== 'object') src = {};
  const d = { ...extras(src, ['v', 'nodes', 'edges']), v: 1, nodes: [], edges: [] };
  const seen = new Set();
  let fixed = false;
  const uid = (want, prefix) => {
    let id = want === null || want === undefined || want === '' ? '' : String(want);
    if (!id || seen.has(id)) { let i = seen.size + 1; while (seen.has(prefix + i)) i++; id = prefix + i; fixed = true; }
    seen.add(id);
    return id;
  };
  const todo = [];
  for (const r of Array.isArray(src.nodes) ? src.nodes : []) {
    if (!r || typeof r !== 'object') continue;
    const shape = SHAPES.includes(r.shape) ? r.shape : 'box';
    const [dw, dh] = SIZE[shape];
    const w = num(r.w), h = num(r.h);
    const n = {
      id: uid(r.id, 'n'), x: num(r.x), y: num(r.y), w: w >= 20 ? w : dw, h: h >= 20 ? h : dh,
      text: r.text === null || r.text === undefined ? '' : String(r.text), shape,
      color: isHex(r.color) ? r.color.toLowerCase() : PALETTE[0], ...extras(r, NODE_KEYS),
    };
    n.h = Math.max(n.h, minH(n));
    if (n.x === null || n.y === null) todo.push(n);
    d.nodes.push(n);
  }
  const ids = new Set(d.nodes.map((n) => n.id));
  for (const r of Array.isArray(src.edges) ? src.edges : []) {
    if (!r || !ids.has(String(r.from)) || !ids.has(String(r.to))) continue;
    d.edges.push({
      id: uid(r.id, 'e'), from: String(r.from), to: String(r.to),
      text: r.text === null || r.text === undefined ? '' : String(r.text), dashed: !!r.dashed, ...extras(r, EDGE_KEYS),
    });
  }
  if (todo.length) { layout(d, todo); fixed = true; }
  return { d, fixed };
}

// Places nodes that came without coordinates: columns by arrow depth (left to right), next to the placed nodes they
// connect to, or below everything else; then pushed down until they overlap nothing.
function layout(d, todo) {
  const set = new Set(todo.map((n) => n.id));
  const rank = new Map(todo.map((n) => [n.id, 0]));
  for (let pass = 0; pass < todo.length; pass++) {
    let moved = false;
    for (const e of d.edges) {
      if (!set.has(e.from) || !set.has(e.to) || e.from === e.to) continue;
      const r = rank.get(e.from) + 1;
      if (r > rank.get(e.to) && r < todo.length) { rank.set(e.to, r); moved = true; }
    }
    if (!moved) break;
  }
  const placed = d.nodes.filter((n) => !set.has(n.id));
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const near = [];
  for (const e of d.edges) {
    if (set.has(e.from) && !set.has(e.to)) near.push(byId.get(e.to));
    if (set.has(e.to) && !set.has(e.from)) near.push(byId.get(e.from));
  }
  let ox = 0, oy = 0;
  if (near.length) { ox = Math.max(...near.map((n) => n.x + n.w)) + 90; oy = Math.min(...near.map((n) => n.y)); }
  else if (placed.length) { ox = Math.min(...placed.map((n) => n.x)); oy = Math.max(...placed.map((n) => n.y + n.h)) + 90; }
  const cols = [];
  for (const n of todo) (cols[rank.get(n.id)] ||= []).push(n);
  const colH = (c) => c.reduce((s, n) => s + n.h, 0) + (c.length - 1) * 50;
  const tallest = Math.max(...cols.filter(Boolean).map(colH));
  let x = ox;
  for (const col of cols) {
    if (!col) continue;
    const cw = Math.max(...col.map((n) => n.w));
    let y = oy + (tallest - colH(col)) / 2;
    for (const n of col) { n.x = Math.round(x + (cw - n.w) / 2); n.y = Math.round(y); y += n.h + 50; }
    x += cw + 90;
  }
  const hits = () => todo.some((a) => placed.some((b) => a.x < b.x + b.w + 20 && b.x < a.x + a.w + 20 && a.y < b.y + b.h + 20 && b.y < a.y + a.h + 20));
  for (let i = 0; i < 400 && hits(); i++) for (const n of todo) n.y += 40;
}

function bounds(nodes) {
  if (!nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { x: x0 - 4, y: y0 - 4, w: x1 - x0 + 8, h: y1 - y0 + 8 };
}

// ---------- shapes ----------

// Outline of a node in its own coordinates, with a slight hand-made wobble seeded by its id.
function outline(n) {
  const { w, h } = n, R = rng(hash(n.id));
  const j = (a = 0.7) => (R() - 0.5) * 2 * a;
  const P = (x, y) => [f(x + j()), f(y + j())];
  if (n.shape === 'ellipse') {
    const rx = w / 2, ry = h / 2, K = () => 0.5523 * (1 + j(0.03));
    const E = P(w, ry), S = P(rx, h), W = P(0, ry), N = P(rx, 0);
    return { d: `M${E} C${E[0]},${f(E[1] + ry * K())} ${f(S[0] + rx * K())},${S[1]} ${S} C${f(S[0] - rx * K())},${S[1]} ${W[0]},${f(W[1] + ry * K())} ${W}` +
      ` C${W[0]},${f(W[1] - ry * K())} ${f(N[0] - rx * K())},${N[1]} ${N} C${f(N[0] + rx * K())},${N[1]} ${E[0]},${f(E[1] - ry * K())} ${E}Z` };
  }
  if (n.shape === 'diamond') {
    const V = [P(w / 2, 0), P(w, h / 2), P(w / 2, h), P(0, h / 2)];
    const cut = (a, b, t) => [f(a[0] + (b[0] - a[0]) * t), f(a[1] + (b[1] - a[1]) * t)];
    const t = Math.min(0.2, 11 / Math.hypot(w / 2, h / 2));
    let d = `M${cut(V[0], V[1], t)}`;
    for (const i of [1, 2, 3, 0]) d += ` L${cut(V[i], V[(i + 3) % 4], t)} Q${V[i]} ${cut(V[i], V[(i + 1) % 4], t)}`;
    return { d: d + 'Z' };
  }
  if (n.shape === 'note') {
    const r = 4, fd = Math.min(18, w / 5, h / 5);
    const a = P(r, 0), b = P(w - r, 0), c = P(w, r), dd = P(w, h - fd), e = P(w - fd, h), g = P(r, h), i = P(0, h - r), k = P(0, r);
    return {
      d: `M${a} Q${f(w / 2)},${f(j(1))} ${b} Q${w},0 ${c} Q${f(w + j(1))},${f(h / 2)} ${dd} L${e} Q${f(w / 2)},${f(h + j(1))} ${g} Q0,${h} ${i} Q${f(j(1))},${f(h / 2)} ${k} Q0,0 ${a}Z`,
      fold: `M${dd} L${f(w - fd + 1)},${f(h - fd + 1)} L${e}Z`,
    };
  }
  const r = Math.min(12, w / 4, h / 4);
  const a = P(r, 0), b = P(w - r, 0), c = P(w, r), dd = P(w, h - r), e = P(w - r, h), g = P(r, h), i = P(0, h - r), k = P(0, r);
  return { d: `M${a} Q${f(w / 2)},${f(j(1))} ${b} Q${w},0 ${c} Q${f(w + j(1))},${f(h / 2)} ${dd} Q${w},${h} ${e} Q${f(w / 2)},${f(h + j(1))} ${g} Q0,${h} ${i} Q${f(j(1))},${f(h / 2)} ${k} Q0,0 ${a}Z` };
}

function nodeInner(n, hideText = false) {
  const stroke = darken(n.color), o = outline(n);
  let s = `<path d="${o.d}" fill="${n.color}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"` +
    (n.shape === 'note' ? ' style="filter:drop-shadow(0 2px 3px rgba(90,60,90,.13))"' : '') + '/>';
  if (o.fold) s += `<path d="${o.fold}" fill="${mix(n.color, stroke, 0.35)}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"/>`;
  if (!hideText && n.text) {
    const lines = wrap(n.text, textW(n));
    s += textSVG(lines, n.w / 2, n.h / 2 - (lines.length * LH) / 2, FS, LH, INK);
  }
  return s;
}

// ---------- arrows ----------

const NORMAL = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };
const OPP = { r: 'l', l: 'r', t: 'b', b: 't' };

// A point on the node's border on one side, `o` units off that side's middle, with the side's outward normal.
function borderPoint(n, side, o) {
  const vert = side === 'l' || side === 'r';
  const hw = n.w / 2, hh = n.h / 2, t = clamp(o / (vert ? hh : hw), -1, 1);
  const reach = n.shape === 'ellipse' ? Math.sqrt(1 - t * t) : n.shape === 'diamond' ? 1 - Math.abs(t) : 1;
  const [nx, ny] = NORMAL[side], cx = n.x + hw, cy = n.y + hh;
  return vert ? { x: cx + nx * hw * reach, y: cy + o, nx, ny } : { x: cx + o, y: cy + ny * hh * reach, nx, ny };
}

// The side of `n` that faces a point.
function facing(n, p) {
  const dx = p.x - n.x - n.w / 2, dy = p.y - n.y - n.h / 2;
  return borderPoint(n, Math.abs(dx) / n.w > Math.abs(dy) / n.h ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't'), 0);
}

// A smooth curve leaving p along its normal and arriving at q against q's normal, with a round arrowhead at q.
function curve(p, q, reach) {
  const bx = q.x + q.nx * AH, by = q.y + q.ny * AH;
  const c = reach ?? clamp(Math.hypot(bx - p.x, by - p.y) * 0.42, 16, 130);
  const c1x = p.x + p.nx * c, c1y = p.y + p.ny * c, c2x = bx + q.nx * c, c2y = by + q.ny * c;
  const mx = 0.125 * p.x + 0.375 * c1x + 0.375 * c2x + 0.125 * bx, my = 0.125 * p.y + 0.375 * c1y + 0.375 * c2y + 0.125 * by;
  const px = -q.ny * 4.6, py = q.nx * 4.6;
  return {
    d: `M${f(p.x)},${f(p.y)} C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(bx)},${f(by)}`,
    head: `M${f(q.x)},${f(q.y)} L${f(bx + px)},${f(by + py)} L${f(bx - px)},${f(by - py)}Z`,
    mx, my,
  };
}

// Geometry of every arrow. Each end takes the side facing the other node; arrows sharing a side spread along it.
function edgeGeoms(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map(), ends = new Map(), out = new Map();
  const add = (node, side, other, e, which) => {
    const k = node.id + '\u0001' + side;
    if (!groups.has(k)) groups.set(k, { node, side, list: [] });
    groups.get(k).list.push({ e, which, other });
  };
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    if (a === b) { out.set(e.id, curve(borderPoint(a, 'r', -a.h * 0.25), borderPoint(a, 't', a.w * 0.3), 46)); continue; }
    const dx = b.x + b.w / 2 - a.x - a.w / 2, dy = b.y + b.h / 2 - a.y - a.h / 2;
    const side = Math.abs(dx) - (a.w + b.w) / 2 >= Math.abs(dy) - (a.h + b.h) / 2 ? (dx >= 0 ? 'r' : 'l') : (dy >= 0 ? 'b' : 't');
    add(a, side, b, e, 0);
    add(b, OPP[side], a, e, 1);
  }
  for (const { node, side, list } of groups.values()) {
    const vert = side === 'l' || side === 'r';
    const along = (o) => (vert ? o.y + o.h / 2 : o.x + o.w / 2);
    list.sort((p, q) => along(p.other) - along(q.other));
    const span = Math.min((vert ? node.h : node.w) * 0.6, (list.length - 1) * 22);
    list.forEach((it, i) => {
      const o = list.length === 1 ? 0 : (i / (list.length - 1) - 0.5) * span;
      if (!ends.has(it.e.id)) ends.set(it.e.id, []);
      ends.get(it.e.id)[it.which] = borderPoint(node, side, o);
    });
  }
  for (const [id, [p, q]] of ends) out.set(id, curve(p, q));
  return out;
}

function labelSVG(text, mx, my) {
  const lines = wrap(text, 180, LFS);
  const w = Math.max(...lines.map((l) => measure(l, LFS))) + 16, h = lines.length * LLH + 6;
  return `<rect x="${f(mx - w / 2)}" y="${f(my - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(Math.min(h / 2, 10))}" fill="#fff" stroke="#e2d8e5"/>` +
    textSVG(lines, mx, my - (lines.length * LLH) / 2, LFS, LLH, LABEL_INK);
}

function edgeInner(e, g, sel = false, hideLabel = false) {
  const c = sel ? ACCENT : EDGE;
  return `<path d="${g.d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"${e.dashed ? ' stroke-dasharray="6 5"' : ''}/>` +
    `<path d="${g.head}" fill="${c}" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/>` +
    (e.text && !hideLabel ? labelSVG(e.text, g.mx, g.my) : '');
}

// ---------- thumbnail ----------

export function diagramThumbSVG(data, w = 240, h = 160) {
  const { d } = normalize(data);
  const head = `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  const b = bounds(d.nodes);
  if (!b) return head + '</svg>';
  const pad = 8, s = Math.min((w - 2 * pad) / b.w, (h - 2 * pad) / b.h, 1);
  const tx = w / 2 - (b.x + b.w / 2) * s, ty = h / 2 - (b.y + b.h / 2) * s;
  const geoms = edgeGeoms(d.nodes, d.edges);
  const body = d.edges.map((e) => (geoms.has(e.id) ? edgeInner(e, geoms.get(e.id)) : '')).join('') +
    d.nodes.map((n) => `<g transform="translate(${n.x},${n.y})">${nodeInner(n)}</g>`).join('');
  return `${head}<g transform="translate(${f(tx)},${f(ty)}) scale(${s.toFixed(4)})">${body}</g></svg>`;
}

// ---------- editor ----------

export function createDiagram(container, { data: initial, onChange, title, panOnDrag = false } = {}) {
  let { d: data, fixed } = normalize(initial);
  const view = { x: 0, y: 0, k: 1 };
  let selN = new Set(), selE = new Set();
  let hover = null, mode = null, editing = null, spaceHeld = false;
  let undo = [], redo = [], lastTag = null, lastTime = 0;
  let clip = null, pasteN = 0;
  const style = { shape: 'box', color: PALETTE[0] };       // what a new box looks like: the last choice made
  let raf = 0, timer = 0, anim = 0, fitted = false, geoms = new Map(), barKey = '';

  const root = document.createElement('div');
  root.className = 'dg';
  root.tabIndex = 0;
  root.innerHTML = `<svg class="dg-svg" xmlns="${NS}"><g class="dg-world"><g class="dg-edges"></g><g class="dg-nodes"></g><g class="dg-over"></g></g>` +
    '<rect class="dg-band" visibility="hidden"/></svg><div class="dg-hint">Doble clic para empezar</div>' +
    (title ? `<div class="dg-title">${esc(title)}</div>` : '') +
    `<div class="dg-bar" hidden></div><div class="dg-zoom"><button data-z="fit" title="Encajar">${icon('fit')}</button><button data-z="one" title="Tamaño real"></button></div>`;
  container.append(root);
  const $ = (s) => root.querySelector(s);
  const svg = $('.dg-svg'), world = $('.dg-world'), edgeLayer = $('.dg-edges'), nodeLayer = $('.dg-nodes'), over = $('.dg-over');
  const band = $('.dg-band'), hint = $('.dg-hint'), bar = $('.dg-bar'), zoomOne = $('[data-z="one"]');
  const nodeEls = new Map(), edgeEls = new Map();

  const index = () => new Map(data.nodes.map((n) => [n.id, n]));
  const snap = () => JSON.stringify(data);
  const getData = () => JSON.parse(snap());

  function newId(prefix) {
    const used = new Set([...data.nodes, ...data.edges].map((x) => x.id));
    let i = data.nodes.length + data.edges.length + 1;
    while (used.has(prefix + i)) i++;
    return prefix + i;
  }

  // ----- history and saving -----

  function scheduleChange() { clearTimeout(timer); timer = setTimeout(flush, 300); }
  function flush() { timer = 0; onChange?.(getData()); }

  // Records the state from before an edit; edits with the same tag in quick succession (nudges) make one step.
  function commit(before, tag = null) {
    if (before === null || before === snap()) return;
    const now = Date.now();
    if (!(tag && tag === lastTag && now - lastTime < 1000)) { undo.push(before); if (undo.length > 300) undo.shift(); }
    lastTag = tag; lastTime = now; redo = [];
    scheduleChange();
  }
  function edit(fn, tag) { const before = snap(); fn(); commit(before, tag); paint(); }

  function prune() {
    const n = new Set(data.nodes.map((x) => x.id)), e = new Set(data.edges.map((x) => x.id));
    selN = new Set([...selN].filter((id) => n.has(id)));
    selE = new Set([...selE].filter((id) => e.has(id)));
    hover = null;
  }
  function step(from, to) {
    if (!from.length) return;
    to.push(snap());
    data = JSON.parse(from.pop());
    lastTag = null;
    prune(); scheduleChange(); paint();
  }

  // ----- drawing -----

  const paint = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function draw() {
    cancelAnimationFrame(raf); raf = 0;
    const k = view.k;
    world.setAttribute('transform', `translate(${f(view.x)},${f(view.y)}) scale(${k})`);
    const grid = 24 * k * (k < 0.25 ? 4 : k < 0.5 ? 2 : 1);
    root.style.backgroundSize = `${grid}px ${grid}px`;
    root.style.backgroundPosition = `${view.x}px ${view.y}px`;

    // nodes: keyed, redrawn only when their look changes
    const aliveN = new Set(data.nodes.map((n) => n.id));
    for (const [id, rec] of nodeEls) if (!aliveN.has(id)) { rec.el.remove(); nodeEls.delete(id); }
    data.nodes.forEach((n, i) => {
      let rec = nodeEls.get(n.id);
      if (!rec) {
        const el = document.createElementNS(NS, 'g');
        el.setAttribute('data-n', n.id);
        rec = { el, sig: '', pos: '' };
        nodeEls.set(n.id, rec);
      }
      const hidden = editing?.kind === 'node' && editing.id === n.id;
      const sig = `${n.shape}|${n.color}|${n.w}|${n.h}|${hidden ? '' : n.text}`;
      if (rec.sig !== sig) { rec.el.innerHTML = nodeInner(n, hidden); rec.sig = sig; }
      const pos = `translate(${n.x},${n.y})`;
      if (rec.pos !== pos) { rec.el.setAttribute('transform', pos); rec.pos = pos; }
      if (nodeLayer.children[i] !== rec.el) nodeLayer.insertBefore(rec.el, nodeLayer.children[i] || null);
    });

    // edges
    geoms = edgeGeoms(data.nodes, data.edges);
    const aliveE = new Set(data.edges.filter((e) => geoms.has(e.id)).map((e) => e.id));
    for (const [id, rec] of edgeEls) if (!aliveE.has(id)) { rec.el.remove(); edgeEls.delete(id); }
    let ei = 0;
    for (const e of data.edges) {
      const g = geoms.get(e.id);
      if (!g) continue;
      let rec = edgeEls.get(e.id);
      if (!rec) {
        const el = document.createElementNS(NS, 'g');
        el.setAttribute('data-e', e.id);
        rec = { el, sig: '' };
        edgeEls.set(e.id, rec);
      }
      const sel = selE.has(e.id), hidden = editing?.kind === 'edge' && editing.id === e.id;
      const sig = `${g.d}|${e.dashed}|${sel}|${hidden ? '' : e.text}`;
      if (rec.sig !== sig) {
        rec.el.innerHTML = `<path d="${g.d}" fill="none" stroke="transparent" stroke-width="14"/>` + edgeInner(e, g, sel, hidden);
        rec.sig = sig;
      }
      if (edgeLayer.children[ei] !== rec.el) edgeLayer.insertBefore(rec.el, edgeLayer.children[ei] || null);
      ei++;
    }

    over.innerHTML = overlay();
    if (mode?.type === 'band') {
      const x = Math.min(mode.a.sx, mode.b.sx), y = Math.min(mode.a.sy, mode.b.sy);
      band.setAttribute('x', x); band.setAttribute('y', y);
      band.setAttribute('width', Math.abs(mode.a.sx - mode.b.sx)); band.setAttribute('height', Math.abs(mode.a.sy - mode.b.sy));
      band.setAttribute('visibility', 'visible');
    } else band.setAttribute('visibility', 'hidden');
    hint.hidden = data.nodes.length > 0 || !!editing;
    zoomOne.textContent = `${Math.round(k * 100)} %`;
    if (editing) placeEditor();
    placeBar();
  }

  // Selection outlines, connection dots, resize handle and the arrow being drawn. Sizes are divided by the zoom so
  // they look the same at any zoom.
  function overlay() {
    const k = view.k, s = (v) => f(v / k), map = index();
    let h = '';
    for (const id of selN) {
      const n = map.get(id);
      if (!n) continue;
      const line = `fill="none" stroke="${ACCENT}" stroke-width="${s(1.3)}" stroke-dasharray="${s(5)} ${s(4)}"`;
      h += n.shape === 'ellipse'
        ? `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + n.h / 2}" rx="${f(n.w / 2 + 5 / k)}" ry="${f(n.h / 2 + 5 / k)}" ${line}/>`
        : `<rect x="${f(n.x - 5 / k)}" y="${f(n.y - 5 / k)}" width="${f(n.w + 10 / k)}" height="${f(n.h + 10 / k)}" rx="${f((n.shape === 'note' ? 4 : 12) + 5 / k)}" ${line}/>`;
    }
    if (editing || (mode && (mode.type === 'pan' || mode.type === 'band' || mode.type === 'resize' || (mode.type === 'move' && mode.moved)))) return h;

    if (mode?.type === 'connect') {
      const a = map.get(mode.from), p = borderPoint(a, mode.side, 0), cur = mode.cur;
      let q = null;
      if (mode.target) {
        const t = mode.target;
        q = facing(t, p);
        h += `<rect x="${f(t.x - 5 / k)}" y="${f(t.y - 5 / k)}" width="${f(t.w + 10 / k)}" height="${f(t.h + 10 / k)}" rx="${f(12 + 5 / k)}" fill="none" stroke="${ACCENT}" stroke-opacity=".45" stroke-width="${s(2)}"/>`;
      } else if (cur) {
        const dx = cur.x - p.x, dy = cur.y - p.y;
        q = Math.abs(dx) > Math.abs(dy) ? { x: cur.x, y: cur.y, nx: -Math.sign(dx) || -1, ny: 0 } : { x: cur.x, y: cur.y, nx: 0, ny: -Math.sign(dy) || -1 };
        if (mode.far) {                                   // where the new box would land
          const [, dh] = SIZE[a.shape];
          h += `<rect x="${f(cur.x - a.w / 2)}" y="${f(cur.y - dh / 2)}" width="${a.w}" height="${dh}" rx="12" fill="none" stroke="${darken(a.color)}" stroke-width="${s(1.3)}" stroke-dasharray="${s(5)} ${s(4)}"/>`;
          q = facing({ x: cur.x - a.w / 2, y: cur.y - dh / 2, w: a.w, h: dh, shape: 'box' }, p);
        }
      }
      if (q) {
        const c = curve(p, q);
        h += `<path d="${c.d}" fill="none" stroke="${ACCENT}" stroke-width="1.6" stroke-linecap="round"/><path d="${c.head}" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="1.4" stroke-linejoin="round"/>`;
      }
      return h;
    }

    const single = selN.size === 1 && !selE.size ? [...selN][0] : null;
    for (const id of new Set([hover, single].filter(Boolean))) {
      const n = map.get(id);
      if (!n) continue;
      for (const side of ['t', 'r', 'b', 'l']) {
        const b = borderPoint(n, side, 0);
        h += `<g class="dg-dot" data-dot="${esc(n.id)}" data-side="${side}" transform="translate(${f(b.x)},${f(b.y)}) scale(${(1 / k).toFixed(4)})"><circle r="10" fill="transparent"/><circle r="4.2"/></g>`;
      }
    }
    const n = single && map.get(single);
    if (n) h += `<rect class="dg-rs" data-rs="${esc(n.id)}" transform="translate(${f(n.x + n.w + 5 / k)},${f(n.y + n.h + 5 / k)}) scale(${(1 / k).toFixed(4)})" x="-4.5" y="-4.5" width="9" height="9" rx="2.5"/>`;
    return h;
  }

  // ----- floating bar -----

  function barHTML() {
    const map = index();
    const nodes = [...selN].map((id) => map.get(id)).filter(Boolean), edges = data.edges.filter((e) => selE.has(e.id));
    let h = '';
    if (nodes.length) {
      const all = (k, v) => nodes.every((n) => n[k] === v);
      h += SHAPES.map((s) => `<button data-shape="${s}" title="${SHAPE_NAMES[s]}"${all('shape', s) ? ' class="on"' : ''}>${icon(s)}</button>`).join('');
      h += '<i class="dg-sep"></i>';
      h += PALETTE.map((c, i) => `<button class="dg-sw${all('color', c) ? ' on' : ''}" data-color="${c}" title="${COLOR_NAMES[i]}"><span style="background:${c};border-color:${darken(c)}"></span></button>`).join('');
    }
    if (edges.length) {
      if (h) h += '<i class="dg-sep"></i>';
      h += `<button data-dashed="0" title="Línea continua"${edges.every((e) => !e.dashed) ? ' class="on"' : ''}>${icon('solid')}</button>`;
      h += `<button data-dashed="1" title="Línea discontinua"${edges.every((e) => e.dashed) ? ' class="on"' : ''}>${icon('dashed')}</button>`;
    }
    return h;
  }

  function placeBar() {
    const show = (selN.size || selE.size) && !editing && !(mode && (mode.type !== 'move' || mode.moved));
    if (!show) { bar.hidden = true; return; }
    const html = barHTML();
    if (html !== barKey) { bar.innerHTML = html; barKey = html; }
    bar.hidden = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const map = index();
    for (const id of selN) { const n = map.get(id); if (n) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); } }
    for (const id of selE) { const g = geoms.get(id); if (g) { x0 = Math.min(x0, g.mx); y0 = Math.min(y0, g.my); x1 = Math.max(x1, g.mx); y1 = Math.max(y1, g.my); } }
    const k = view.k, W = root.clientWidth, H = root.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = view.y + y0 * k - bh - 16;
    if (top < 8) top = view.y + y1 * k + 16;
    const left = view.x + ((x0 + x1) / 2) * k - bw / 2;
    bar.style.transform = `translate(${Math.round(clamp(left, 8, W - bw - 8))}px, ${Math.round(clamp(top, 8, H - bh - 8))}px)`;
  }

  bar.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const map = index(), nodes = [...selN].map((id) => map.get(id)).filter(Boolean);
    edit(() => {
      if (b.dataset.shape) { style.shape = b.dataset.shape; for (const n of nodes) { n.shape = style.shape; n.h = Math.max(n.h, minH(n)); } }
      if (b.dataset.color) { style.color = b.dataset.color; for (const n of nodes) n.color = style.color; }
      if (b.dataset.dashed) for (const ed of data.edges) if (selE.has(ed.id)) ed.dashed = b.dataset.dashed === '1';
    });
  });

  // ----- text editing -----

  function startEdit(kind, id, { before = snap(), isNew = false } = {}) {
    const item = kind === 'node' ? index().get(id) : data.edges.find((x) => x.id === id);
    if (!item) return;
    if (editing) finishEdit();
    const ta = document.createElement('textarea');
    ta.className = kind === 'node' ? 'dg-ta' : 'dg-ta dg-ta-e';
    ta.value = item.text;
    ta.spellcheck = false;
    ta.rows = 1;
    editing = { kind, id, item, ta, before, isNew, h0: item.h };
    root.append(ta);
    ta.addEventListener('input', () => {
      item.text = ta.value;
      if (kind === 'node') item.h = Math.max(editing.h0, minH(item));
      draw();
      scheduleChange();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); finishEdit(true); }
    });
    ta.addEventListener('blur', () => finishEdit());
    hover = null;
    draw();
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function finishEdit(refocus = false) {
    const ed = editing;
    if (!ed) return;
    editing = null;
    ed.ta.remove();
    ed.item.text = ed.item.text.trim();
    if (ed.kind === 'node') {
      if (ed.isNew && !ed.item.text) { data = JSON.parse(ed.before); prune(); }   // an empty new box was a slip: gone
      else ed.item.h = Math.max(ed.h0, minH(ed.item));
    }
    commit(ed.before);
    scheduleChange();
    draw();
    if (refocus) root.focus({ preventScroll: true });
  }

  // The textarea sits exactly where the text is drawn, at the same size.
  function placeEditor() {
    const { kind, item, ta } = editing, k = view.k;
    if (kind === 'node') {
      const tw = textW(item), lines = wrap(item.text, tw).length;
      Object.assign(ta.style, {
        left: view.x + (item.x + item.w / 2 - tw / 2) * k - 1 + 'px', width: tw * k + 2 + 'px',
        top: view.y + (item.y + item.h / 2 - (lines * LH) / 2) * k + 'px', height: lines * LH * k + 'px',
        fontSize: FS * k + 'px', lineHeight: LH * k + 'px',
      });
    } else {
      const g = geoms.get(item.id);
      if (!g) return;
      const lines = wrap(item.text, 180, LFS), tw = Math.max(40, ...lines.map((l) => measure(l, LFS))) + 4;
      Object.assign(ta.style, {
        left: view.x + (g.mx - tw / 2 - 8) * k + 'px', width: tw * k + 'px',
        top: view.y + (g.my - (lines.length * LLH) / 2 - 3) * k + 'px', height: lines.length * LLH * k + 'px',
        padding: `${3 * k}px ${8 * k}px`, fontSize: LFS * k + 'px', lineHeight: LLH * k + 'px', borderRadius: 10 * k + 'px',
      });
    }
  }

  // ----- creating -----

  function makeNode(p, shape, color, w) {
    const [dw, dh] = SIZE[shape];
    w ??= dw;
    const n = { id: newId('n'), x: Math.round(p.x - w / 2), y: Math.round(p.y - dh / 2), w, h: dh, text: '', shape, color };
    data.nodes.push(n);
    selN = new Set([n.id]);
    selE.clear();
    return n;
  }

  function finishConnect(m) {
    if (m.target) {
      if (!data.edges.some((x) => x.from === m.from && x.to === m.target.id)) edit(() => data.edges.push({ id: newId('e'), from: m.from, to: m.target.id, text: '', dashed: false }));
    } else if (m.far && m.cur) {
      const src = index().get(m.from), before = snap();
      const n = makeNode(m.cur, src.shape, src.color, src.w);
      data.edges.push({ id: newId('e'), from: src.id, to: n.id, text: '', dashed: false });
      startEdit('node', n.id, { before, isNew: true });
    }
  }

  // ----- clipboard -----

  function selectionCopy() {
    const nodes = data.nodes.filter((n) => selN.has(n.id));
    return { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(data.edges.filter((e) => selN.has(e.from) && selN.has(e.to)))) };
  }
  function insert(c, off) {
    if (!c?.nodes.length) return;
    edit(() => {
      const ids = new Map();
      selN = new Set(); selE = new Set();
      for (const n of c.nodes) {
        const m = { ...JSON.parse(JSON.stringify(n)), id: newId('n'), x: n.x + off, y: n.y + off };
        ids.set(n.id, m.id);
        data.nodes.push(m);
        selN.add(m.id);
      }
      for (const e of c.edges) data.edges.push({ ...JSON.parse(JSON.stringify(e)), id: newId('e'), from: ids.get(e.from), to: ids.get(e.to) });
    });
  }
  function remove() {
    if (!selN.size && !selE.size) return;
    edit(() => {
      data.nodes = data.nodes.filter((n) => !selN.has(n.id));
      data.edges = data.edges.filter((e) => !selE.has(e.id) && !selN.has(e.from) && !selN.has(e.to));
      selN.clear(); selE.clear();
    });
  }

  // ----- view -----

  const stopGlide = () => { cancelAnimationFrame(anim); anim = 0; };
  function glide(to) {
    stopGlide();
    const from = { ...view }, t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / GLIDE), e = 1 - Math.pow(1 - t, 4);
      view.x = from.x + (to.x - from.x) * e; view.y = from.y + (to.y - from.y) * e; view.k = from.k + (to.k - from.k) * e;
      draw();
      anim = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    anim = requestAnimationFrame(tick);
  }
  function zoomTo(k, sx, sy) { return { k, x: sx - ((sx - view.x) * k) / view.k, y: sy - ((sy - view.y) * k) / view.k }; }
  function fitView(animate = true) {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    const b = bounds(data.nodes);
    let to = { x: W / 2, y: H / 2, k: 1 };
    if (b) {
      const k = clamp(Math.min((W - 128) / b.w, (H - 128) / b.h, 1), 0.1, 4);
      to = { k, x: W / 2 - (b.x + b.w / 2) * k, y: H / 2 - (b.y + b.h / 2) * k };
    }
    if (animate) glide(to); else { Object.assign(view, to); draw(); }
  }

  $('.dg-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.z === 'fit') fitView();
    else glide(zoomTo(1, root.clientWidth / 2, root.clientHeight / 2));
    root.focus({ preventScroll: true });
  });

  // ----- pointer -----

  const pt = (e) => {
    const r = svg.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };
  function nodeAt(p, m = 0) {
    for (let i = data.nodes.length - 1; i >= 0; i--) {
      const n = data.nodes[i];
      if (p.x >= n.x - m && p.x <= n.x + n.w + m && p.y >= n.y - m && p.y <= n.y + n.h + m) return n;
    }
    return null;
  }

  svg.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll on middle click
  svg.addEventListener('pointerdown', (e) => {
    stopGlide();
    if (editing) finishEdit();
    root.focus({ preventScroll: true });
    const p = pt(e), add = e.shiftKey || e.ctrlKey || e.metaKey, t = e.target;
    const dot = t.closest('[data-dot]'), rs = t.closest('[data-rs]'), ng = t.closest('[data-n]'), eg = t.closest('[data-e]');
    if (e.button === 1 || (e.button === 0 && spaceHeld) || (e.button === 0 && panOnDrag && !add && !dot && !rs && !ng && !eg)) {
      mode = { type: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y };
      root.classList.add('dg-panning');
    } else if (e.button !== 0) return;
    else if (dot) mode = { type: 'connect', from: dot.dataset.dot, side: dot.dataset.side, p, cur: null, target: null, far: false };
    else if (rs) { const n = index().get(rs.dataset.rs); mode = { type: 'resize', n, p, w: n.w, h: n.h, before: snap() }; }
    else if (ng) {
      const id = ng.getAttribute('data-n');
      if (add && selN.has(id)) { selN.delete(id); paint(); return; }
      if (add) selN.add(id);
      else if (!selN.has(id)) { selN = new Set([id]); selE.clear(); }
      const map = index();
      mode = { type: 'move', p, id, add, moved: false, before: null, orig: [...selN].map((i) => map.get(i)).filter(Boolean).map((n) => ({ n, x: n.x, y: n.y })) };
    } else if (eg) {
      const id = eg.getAttribute('data-e');
      if (add) selE.has(id) ? selE.delete(id) : selE.add(id);
      else { selN.clear(); selE = new Set([id]); }
      paint();
      return;
    } else {
      if (!add) { selN.clear(); selE.clear(); }
      mode = { type: 'band', a: p, b: p, baseN: new Set(selN), baseE: new Set(selE) };
    }
    svg.setPointerCapture(e.pointerId);
    paint();
  });

  svg.addEventListener('pointermove', (e) => {
    const p = pt(e);
    if (!mode) {
      const h = editing ? null : nodeAt(p, 14 / view.k)?.id ?? null;
      if (h !== hover) { hover = h; paint(); }
      return;
    }
    if (mode.type === 'pan') { view.x = mode.vx + p.sx - mode.sx; view.y = mode.vy + p.sy - mode.sy; }
    else if (mode.type === 'move') {
      if (!mode.moved) {
        if (Math.hypot(p.sx - mode.p.sx, p.sy - mode.p.sy) < 3) return;
        mode.moved = true;
        mode.before = snap();
      }
      const dx = p.x - mode.p.x, dy = p.y - mode.p.y;
      for (const o of mode.orig) { o.n.x = Math.round(o.x + dx); o.n.y = Math.round(o.y + dy); }
    } else if (mode.type === 'resize') {
      const n = mode.n;
      n.w = Math.max(60, Math.round(mode.w + p.x - mode.p.x));
      n.h = Math.max(30, Math.round(mode.h + p.y - mode.p.y), minH(n));
    } else if (mode.type === 'connect') {
      mode.cur = p;
      mode.far ||= Math.hypot(p.sx - mode.p.sx, p.sy - mode.p.sy) > 24;
      const t = nodeAt(p);
      mode.target = t && t.id !== mode.from ? t : null;
    } else if (mode.type === 'band') {
      mode.b = p;
      const x0 = Math.min(mode.a.x, p.x), x1 = Math.max(mode.a.x, p.x), y0 = Math.min(mode.a.y, p.y), y1 = Math.max(mode.a.y, p.y);
      selN = new Set(mode.baseN);
      for (const n of data.nodes) if (n.x >= x0 && n.x + n.w <= x1 && n.y >= y0 && n.y + n.h <= y1) selN.add(n.id);
      selE = new Set(mode.baseE);
      for (const ed of data.edges) { const g = geoms.get(ed.id); if (g && g.mx >= x0 && g.mx <= x1 && g.my >= y0 && g.my <= y1) selE.add(ed.id); }
    }
    paint();
  });

  const up = () => {
    const m = mode;
    if (!m) return;
    mode = null;
    root.classList.remove('dg-panning');
    if (m.type === 'move') {
      if (m.moved) commit(m.before);
      else if (!m.add && selN.size > 1) { selN = new Set([m.id]); selE.clear(); }   // a plain click inside a group picks one
    } else if (m.type === 'resize') commit(m.before);
    else if (m.type === 'connect') finishConnect(m);
    paint();
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('pointerleave', () => { if (!mode && hover) { hover = null; paint(); } });

  svg.addEventListener('dblclick', (e) => {
    if (spaceHeld) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const nid = hit?.closest?.('[data-n]')?.getAttribute('data-n') ?? hit?.closest?.('[data-dot]')?.dataset.dot;
    const eid = hit?.closest?.('[data-e]')?.getAttribute('data-e');
    if (nid) { selN = new Set([nid]); selE.clear(); startEdit('node', nid); }
    else if (eid) { selN.clear(); selE = new Set([eid]); startEdit('edge', eid); }
    else { const before = snap(), n = makeNode(pt(e), style.shape, style.color); startEdit('node', n.id, { before, isNew: true }); }
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopGlide();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1, p = pt(e);
    if (e.ctrlKey || e.metaKey) Object.assign(view, zoomTo(clamp(view.k * Math.exp(-e.deltaY * unit * 0.0015), 0.1, 4), p.sx, p.sy));
    else if (e.shiftKey && !e.deltaX) view.x -= e.deltaY * unit;
    else { view.x -= e.deltaX * unit; view.y -= e.deltaY * unit; }
    paint();
  }, { passive: false });

  // ----- keyboard -----

  root.addEventListener('keydown', (e) => {
    if (editing || e.target.tagName === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let done = true;
    if (key === ' ') { spaceHeld = true; root.classList.add('dg-grab'); }
    else if (mod && key === 'z') e.shiftKey ? step(redo, undo) : step(undo, redo);
    else if (mod && key === 'y') step(redo, undo);
    else if (mod && key === 'a') { selN = new Set(data.nodes.map((n) => n.id)); selE = new Set(data.edges.map((x) => x.id)); }
    else if (mod && key === 'c') { if (selN.size) { clip = selectionCopy(); pasteN = 0; } }
    else if (mod && key === 'x') { if (selN.size) { clip = selectionCopy(); pasteN = 0; } remove(); }
    else if (mod && key === 'v') insert(clip, 24 * ++pasteN);
    else if (mod && key === 'd') insert(selectionCopy(), 24);
    else if (key === 'Delete' || key === 'Backspace') remove();
    else if (arrows[key] && selN.size) {
      const s = e.shiftKey ? 10 : 1, [dx, dy] = arrows[key];
      edit(() => { for (const n of data.nodes) if (selN.has(n.id)) { n.x += dx * s; n.y += dy * s; } }, 'nudge');
    } else if (key === 'Enter' && selN.size === 1 && !selE.size) startEdit('node', [...selN][0]);
    else if (key === 'Escape' && (mode || selN.size || selE.size)) { if (mode?.type === 'connect') mode = null; selN.clear(); selE.clear(); }
    else done = false;          // anything else (an Escape with nothing selected) stays with the host
    if (done) { e.preventDefault(); e.stopPropagation(); paint(); }
  });
  const releaseSpace = () => { spaceHeld = false; root.classList.remove('dg-grab'); };
  root.addEventListener('keyup', (e) => { if (e.key === ' ') releaseSpace(); });
  root.addEventListener('blur', releaseSpace);

  // ----- life -----

  const ro = new ResizeObserver(() => {
    if (!fitted && root.clientWidth && root.clientHeight) { fitted = true; fitView(false); } else paint();
  });
  ro.observe(root);
  draw();
  root.focus({ preventScroll: true });
  if (fixed) scheduleChange();          // auto-placed positions are saved back, so they stay put

  return {
    getData,
    setData(d) {
      if (editing) { const { ta } = editing; editing = null; ta.remove(); }
      ({ d: data, fixed } = normalize(d));
      undo = []; redo = []; lastTag = null; mode = null;
      prune();
      if (fixed) scheduleChange();
      draw();
    },
    fit: () => fitView(true),
    destroy() {
      finishEdit();
      ro.disconnect();
      stopGlide();
      cancelAnimationFrame(raf);
      if (timer) { clearTimeout(timer); flush(); }
      root.remove();
    },
  };
}
