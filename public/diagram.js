// Meadow diagrams: boxes, symbols and arrows on an unbounded canvas. Plain DOM + SVG, no dependencies.
//
// The visual language is inherited from GGUF.OS (cockpit/cadena.js and its sketches): a shape says what a thing is,
// each kind has one tint, operations carry ports, a status dot and a subtitle, triggers sit beside them as a small
// dial (schedule) or pulse (something arrives), arrows say what travels with a verb, one dashed line is the frontier
// (what is outside sits beyond it; a line that crosses it carries a small shield), and one topology can be read in
// several ways: switching the reading changes annotations only, never moves a piece.
//
// The data is the contract (plain JSON; everything except the arrays is optional):
//   { v: 1, theme: 'light'|'dark',
//     nodes: [{ id, x, y, w, h, text, shape, color,          // shape: box ellipse diamond note (classic, any colour)
//               sub, status: 'ok'|'idle'|'bad',              //   operation agent capability store book resource clock
//               clock: { kind: 'clock'|'event', words },     //   event permission incident user external (one tint each)
//               outside: true, kids: [ids] }],               //   group (a dashed container; `kids` only for layout)
//     edges: [{ id, from, to, text, verb, dash: 'solid'|'dashed'|'dashdot', route: 'curve'|'elbow' }],
//     frontier: { y, label, out },
//     readings: ['Datos', 'Autoridad'], notes: { Datos: { nodeId: 'texto', 'edge:e1': { text, tone: 'ok'|'warn'|'bad' } } } }
// Coordinates are diagram units. Nodes without x/y are laid out automatically and keep that place from then on.
// Unknown extra fields are kept as they are. The old edge boolean `dashed` is still read.
//
// createDiagram(container, { data, onChange, title, panOnDrag }) → { destroy, getData, setData, fit }
// diagramThumbSVG(data, w, h) → SVG markup of the whole diagram fitted into w×h, no UI.

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#f7e4ec', '#e3edf9', '#e5f3e4', '#f9eedb', '#ece3f7', '#dff2f0', '#ffffff', '#f6f2f7'];
const COLOR_NAMES = ['Rosa', 'Azul', 'Verde', 'Arena', 'Lila', 'Agua', 'Blanco', 'Niebla'];
const CLASSIC = ['box', 'ellipse', 'diamond', 'note'];
const SYMBOLS = ['operation', 'agent', 'capability', 'store', 'book', 'resource', 'clock', 'event', 'permission', 'incident', 'user', 'external'];
const SHAPES = [...CLASSIC, ...SYMBOLS];
const ICONS = new Set(SYMBOLS.filter((s) => s !== 'operation'));          // symbols whose words sit under them
const NAMES = {
  box: 'Caja', ellipse: 'Óvalo', diamond: 'Rombo', note: 'Nota', operation: 'Operación', agent: 'Agente', capability: 'Capacidad',
  store: 'Almacén', book: 'Libro', resource: 'Recurso', clock: 'Reloj', event: 'Evento', permission: 'Permiso', incident: 'Incidencia',
  user: 'Usuario', external: 'Frontera externa', group: 'Agrupación', frontier: 'Frontera',
};
const SIZE = {
  box: [160, 70], ellipse: [160, 84], diamond: [180, 110], note: [150, 120], operation: [210, 78], agent: [72, 72], capability: [76, 76],
  store: [86, 68], book: [64, 78], resource: [72, 78], clock: [62, 62], event: [66, 66], permission: [56, 64], incident: [72, 64],
  user: [68, 68], external: [62, 62], group: [400, 280],
};
const TINT_OF = { agent: 'orange', operation: 'slate', capability: 'lilac', resource: 'lilac', store: 'sand', book: 'sand', clock: 'clock', event: 'green', permission: 'green', incident: 'amber', user: 'grey', external: 'grey' };
const DASHES = ['solid', 'dashed', 'dashdot'];
const DASH_ARRAY = { solid: '', dashed: '7 5', dashdot: '11 4 2 4' };
const STATUS = ['ok', 'idle', 'bad'];

// Each theme: the canvas, the lines, and one tint per kind (s = outline, f = fill, g = glyph, ink = its words).
const THEME = {
  light: {
    bg: '#fdfbfe', ink: '#3a2f3f', muted: '#8b8492', flow: '#7fa18b', alt: '#a593c9', accent: '#714b67', frame: '#aab2ba', frameInk: '#8d969e',
    ok: '#6fa57f', idle: '#bdb6c1', bad: '#d9776f', warn: '#c99a45',
    tint: {
      orange: { s: '#d39a78', f: '#fbebe1', g: '#e3a582', ink: '#a8694a', eye: '#7a4a33' },
      slate: { s: '#8197ac', f: '#eef2f6', g: '#8197ac', ink: '#3d4f60', sub: '#7d8b98' },
      lilac: { s: '#a593c9', f: '#f1edf8', g: '#b9a6dd', ink: '#6f5c96' },
      sand: { s: '#c4a66c', f: '#f8f0de', g: '#c4a66c', ink: '#8a6d2f' },
      clock: { s: '#8ea3b6', f: '#f0f4f7', g: '#7f95aa', ink: '#5d7183' },
      green: { s: '#8db699', f: '#e9f3eb', g: '#7fac8c', ink: '#4f7d5d' },
      amber: { s: '#d2ad64', f: '#fbf2de', g: '#b98d3c', ink: '#9a7330' },
      grey: { s: '#a3acb5', f: '#f2f4f6', g: '#99a3ad', ink: '#6b747c' },
    },
  },
  dark: {
    bg: '#1b1f24', ink: '#e2e6eb', muted: '#8d98a3', flow: '#8fbf9f', alt: '#b7a5d6', accent: '#c9a3c0', frame: '#76828c', frameInk: '#8f9ba5',
    ok: '#8fbf9f', idle: '#76828c', bad: '#e08a80', warn: '#d4b77a',
    tint: {
      orange: { s: '#d4916b', f: '#3a2a22', g: '#d99a76', ink: '#e2a684', eye: '#3a2a22' },
      slate: { s: '#9fb3c8', f: '#27313b', g: '#9fb3c8', ink: '#e3e9ef', sub: '#8d9aa7' },
      lilac: { s: '#b7a5d6', f: '#2f2a3b', g: '#c9b8e6', ink: '#c9b8e6' },
      sand: { s: '#c9b07a', f: '#3a3427', g: '#c9b07a', ink: '#d6bf8c' },
      clock: { s: '#9fb3c8', f: '#232a31', g: '#b9c7d4', ink: '#b9c7d4' },
      green: { s: '#9cc4a4', f: '#263329', g: '#a9d1b1', ink: '#a9d1b1' },
      amber: { s: '#d4b77a', f: '#3a3327', g: '#dcc189', ink: '#dcc189' },
      grey: { s: '#a7b1bb', f: '#262b31', g: '#a7b1bb', ink: '#b9c2ca' },
    },
  },
};
const themeOf = (d) => THEME[d?.theme === 'dark' ? 'dark' : 'light'];

const FONT = '"Segoe UI", sans-serif';
const FS = 14, LH = 19;          // words inside a box
const LBF = 14, LBL = 18;        // words under a symbol
const EFS = 10.5, ELH = 13;      // arrow labels (small capitals)
const AH = 10;                   // arrowhead length
const GLIDE = 260;               // view glides: same duration as motion.js «smooth»

const LINE_ICON = {
  solid: '<path d="M4 12h16"/>',
  dashed: '<path d="M4 12h3M10.5 12h3M17 12h3"/>',
  dashdot: '<path d="M3 12h6M12 12h.5M15.5 12h5.5"/>',
  curve: '<path d="M4 18c7 0 9-12 16-12"/>',
  elbow: '<path d="M4 18h8V6h8"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  chev: '<path d="m14 6-6 6 6 6"/>',
};
const lineIcon = (k) => `<svg viewBox="0 0 24 24">${LINE_ICON[k]}</svg>`;

// ---------- small helpers ----------

const f = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const upper = (s) => String(s).toLocaleUpperCase('es');
const clone = (x) => JSON.parse(JSON.stringify(x));

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
function darken(hex) {                                 // a classic shape's outline: same hue, a little deeper
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
// A classic shape's colours in a theme: in the dark the pastel becomes a deep tint with the same outline.
function classicColours(n, th) {
  const s = darken(n.color);
  return th === THEME.dark ? { f: mix(s, th.bg, 0.78), s, ink: th.ink } : { f: n.color, s, ink: th.ink };
}

// ---------- text ----------

let ctx, ctxFont = '';
function measure(s, fs, bold = false) {
  if (ctx === undefined) { try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; } }
  if (!ctx) return s.length * fs * (bold ? 0.56 : 0.52);
  const font = `${bold ? '600 ' : ''}${fs}px ${FONT}`;
  if (ctxFont !== font) { ctx.font = font; ctxFont = font; }
  return ctx.measureText(s).width;
}

const wrapCache = new Map();
function wrap(text, maxW, fs = FS, bold = false) {     // word wrap; long words break by characters
  const key = fs + (bold ? 'b' : '') + '|' + Math.round(maxW) + '|' + text;
  if (wrapCache.has(key)) return wrapCache.get(key);
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (measure(cand, fs, bold) <= maxW) { line = cand; continue; }
      if (line) out.push(line);
      line = word;
      while (line.length > 1 && measure(line, fs, bold) > maxW) {
        let i = line.length - 1;
        while (i > 1 && measure(line.slice(0, i), fs, bold) > maxW) i--;
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

function textSVG(lines, x, top, fs, lh, fill, { anchor = 'middle', weight = '', spacing = '', halo = '' } = {}) {
  return `<text font-family="Segoe UI, sans-serif" font-size="${fs}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central"` +
    `${weight ? ` font-weight="${weight}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}` +
    `${halo ? ` paint-order="stroke" stroke="${halo}" stroke-width="4" stroke-linejoin="round"` : ''}>` +
    lines.map((l, i) => `<tspan x="${f(x)}" y="${f(top + lh * (i + 0.5))}">${esc(l)}</tspan>`).join('') + '</text>';
}

// The words of an operation: a title and a subtitle (its `sub`, or else the lines after the first).
function opWords(n) {
  const tw = n.w - 30, [first, ...rest] = String(n.text).split('\n');
  const title = n.sub !== undefined ? n.text : first, sub = n.sub !== undefined ? String(n.sub) : rest.join('\n');
  return { title: title ? wrap(title, tw, 15, true) : [], sub: sub ? wrap(sub, tw, 13) : [] };
}
// Words under a symbol: its text, then its `sub` in a quieter line.
const labelW = (n) => Math.max(n.w + 60, 140);
function iconWords(n) {
  return { lines: n.text ? wrap(n.text, labelW(n), LBF) : [], sub: n.sub ? wrap(String(n.sub), labelW(n), 12) : [] };
}
function labelH(n) {
  const { lines, sub } = iconWords(n);
  return lines.length || sub.length ? lines.length * LBL + sub.length * 16 + 8 : 0;
}

// The room a shape leaves for its text, and the height its text needs.
const textW = (n) => Math.max(20, n.shape === 'ellipse' ? n.w * 0.74 - 10 : n.shape === 'diamond' ? n.w * 0.55 - 6 : n.w - (n.shape === 'note' ? 26 : n.shape === 'operation' ? 30 : 24));
function minH(n) {
  if (ICONS.has(n.shape) || n.shape === 'group') return 0;
  if (n.shape === 'operation') { const { title, sub } = opWords(n); return Math.ceil(title.length * 20 + sub.length * 17 + (sub.length ? 4 : 0) + 30); }
  const t = wrap(n.text, textW(n)).length * LH;
  return Math.ceil(n.shape === 'ellipse' ? (t + 10) / 0.74 : n.shape === 'diamond' ? (t + 6) / 0.55 : t + (n.shape === 'note' ? 28 : 22));
}

// ---------- data ----------

const NODE_KEYS = ['id', 'x', 'y', 'w', 'h', 'text', 'shape', 'color'];
const EDGE_KEYS = ['id', 'from', 'to', 'text', 'dash', 'dashed', 'route'];
const extras = (r, keys) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));
const symbolic = (n) => !CLASSIC.includes(n.shape);
const defaultRoute = (a, b) => (symbolic(a) || symbolic(b) ? 'elbow' : 'curve');

// Turns whatever came in (an agent may write only ids and texts) into complete data. `fixed` says whether anything
// had to be filled in that should be saved back (positions, ids).
function normalize(raw) {
  let src = raw;
  if (typeof src === 'string') { try { src = JSON.parse(src); } catch { src = null; } }
  if (!src || typeof src !== 'object') src = {};
  const d = { ...extras(src, ['v', 'theme', 'nodes', 'edges']), v: 1, theme: src.theme === 'dark' ? 'dark' : 'light', nodes: [], edges: [] };
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
    const shape = SHAPES.includes(r.shape) || r.shape === 'group' ? r.shape : 'box';
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
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  for (const r of Array.isArray(src.edges) ? src.edges : []) {
    if (!r || !byId.has(String(r.from)) || !byId.has(String(r.to))) continue;
    const a = byId.get(String(r.from)), b = byId.get(String(r.to));
    d.edges.push({
      id: uid(r.id, 'e'), from: a.id, to: b.id, text: r.text === null || r.text === undefined ? '' : String(r.text),
      dash: DASHES.includes(r.dash) ? r.dash : r.dashed ? 'dashed' : 'solid',
      route: r.route === 'curve' || r.route === 'elbow' ? r.route : defaultRoute(a, b), ...extras(r, EDGE_KEYS),
    });
  }
  if (todo.length || (d.frontier && num(d.frontier.y) === null)) { layout(d, todo); fixed = true; }
  return { d, fixed };
}

// Where a node really reaches: a symbol's words hang under it.
function ext(n) {
  if (!ICONS.has(n.shape)) return { x: n.x, y: n.y, w: n.w, h: n.h };
  const { lines, sub } = iconWords(n);
  const lw = Math.max(n.w, ...lines.map((l) => measure(l, LBF) + 4), ...sub.map((l) => measure(l, 12) + 4));
  return { x: n.x + n.w / 2 - lw / 2, y: n.y, w: lw, h: n.h + labelH(n) };
}

// Places nodes that came without coordinates: columns by arrow depth (left to right), next to the placed nodes they
// connect to, or below everything else; outside things go beyond the frontier; a group wraps its `kids`.
function layout(d, todo) {
  const flow = todo.filter((n) => n.shape !== 'group'), set = new Set(flow.map((n) => n.id));
  const rank = new Map(flow.map((n) => [n.id, 0]));
  for (let pass = 0; pass < flow.length; pass++) {
    let moved = false;
    for (const e of d.edges) {
      if (!set.has(e.from) || !set.has(e.to) || e.from === e.to) continue;
      const r = rank.get(e.from) + 1;
      if (r > rank.get(e.to) && r < flow.length) { rank.set(e.to, r); moved = true; }
    }
    if (!moved) break;
  }
  const todoIds = new Set(todo.map((n) => n.id));
  const placed = d.nodes.filter((n) => !todoIds.has(n.id) && n.shape !== 'group');
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const near = [];
  for (const e of d.edges) {
    if (set.has(e.from) && !todoIds.has(e.to)) near.push(byId.get(e.to));
    if (set.has(e.to) && !todoIds.has(e.from)) near.push(byId.get(e.from));
  }
  let ox = 0, oy = 0;
  if (near.length) { ox = Math.max(...near.map((n) => ext(n).x + ext(n).w)) + 90; oy = Math.min(...near.map((n) => n.y)); }
  else if (placed.length) { ox = Math.min(...placed.map((n) => ext(n).x)); oy = Math.max(...placed.map((n) => ext(n).y + ext(n).h)) + 90; }
  const cols = [];
  for (const n of flow) (cols[rank.get(n.id)] ||= []).push(n);
  const colH = (c) => c.reduce((s, n) => s + ext(n).h, 0) + (c.length - 1) * 56;
  const tallest = Math.max(0, ...cols.filter(Boolean).map(colH));
  let x = ox;
  for (const col of cols) {
    if (!col) continue;
    const cw = Math.max(...col.map((n) => Math.max(n.w, ext(n).w)));
    let y = oy + (tallest - colH(col)) / 2;
    for (const n of col) { n.x = Math.round(x + (cw - n.w) / 2); n.y = Math.round(y); y += ext(n).h + 56; }
    x += cw + 100;
  }
  const overlaps = (a, b, m = 20) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
  for (let i = 0; i < 400 && flow.some((a) => placed.some((b) => overlaps(ext(a), ext(b)))); i++) for (const n of flow) n.y += 40;

  // groups: around their kids, or beside everything
  for (const g of todo.filter((n) => n.shape === 'group')) {
    const kids = (Array.isArray(g.kids) ? g.kids : []).map((id) => byId.get(String(id))).filter((n) => n && n !== g && num(n.x) !== null);
    if (kids.length) {
      const b = bounds(kids, true);
      g.x = Math.round(b.x - 36); g.y = Math.round(b.y - 56); g.w = Math.round(b.w + 72); g.h = Math.round(b.h + 92);
      const k = new Set(kids.map((n) => n.id));
      for (const n of flow) if (!k.has(n.id) && overlaps(ext(n), g, 10)) n.y = Math.round(g.y + g.h + 50);
    } else {
      const all = d.nodes.filter((n) => n !== g && num(n.x) !== null);
      const b = all.length ? bounds(all) : { x: 0, y: 0, w: 0, h: 0 };
      g.x = Math.round(b.x + b.w + 80); g.y = Math.round(b.y);
    }
  }

  // the frontier: what is outside sits above its line, the rest below
  const fr = d.frontier && typeof d.frontier === 'object' ? d.frontier : null;
  if (fr) {
    const inner = todo.filter((n) => !n.outside), outside = flow.filter((n) => n.outside);
    const insideAll = d.nodes.filter((n) => !n.outside && num(n.x) !== null);
    if (num(fr.y) === null) fr.y = Math.round((insideAll.length ? Math.min(...insideAll.map((n) => n.y)) : 0) - 44);
    const top = inner.length ? Math.min(...inner.map((n) => n.y)) : Infinity;
    if (top < fr.y + 40) for (const n of inner) n.y += Math.round(fr.y + 40 - top);
    for (const n of outside) {
      // straight above the inside piece it talks to, so its line crosses the frontier once and square
      const e = d.edges.find((x) => (x.from === n.id || x.to === n.id) && !byId.get(x.from === n.id ? x.to : x.from)?.outside);
      const m = e && byId.get(e.from === n.id ? e.to : e.from);
      if (m && m.shape !== 'group' && num(m.x) !== null) n.x = Math.round(m.x + m.w / 2 - n.w / 2);
      while (outside.some((o) => o !== n && o.y !== null && Math.abs(o.x - n.x) < Math.max(o.w, n.w) + 40 && outside.indexOf(o) < outside.indexOf(n))) n.x += 60;
      n.y = Math.round(Math.min(n.y, fr.y - 50 - ext(n).h));
    }
  }
}

function bounds(nodes, withExtras = false) {
  if (!nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const e = ext(n), left = withExtras && n.clock ? Math.min(e.x, n.x - 52) : e.x;
    x0 = Math.min(x0, left); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h);
  }
  return { x: x0 - 4, y: y0 - 4, w: x1 - x0 + 8, h: y1 - y0 + 8 };
}
function frontierSpan(d) {
  const b = bounds(d.nodes.filter((n) => n.shape !== 'group'), true) || { x: -200, w: 400 };
  return [b.x - 40, b.x + b.w + 40];
}

// ---------- shapes ----------

// Outline of a classic node in its own coordinates, with a slight hand-made wobble seeded by its id.
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

// A symbol in its own coordinates (0..w, 0..h): crisp, like a circuit symbol.
function symbol(n, T, th) {
  const { w, h } = n, cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 1, m = Math.min(w, h);
  const S = `stroke="${T.s}" stroke-width="1.6" stroke-linejoin="round"`;
  const G = (sw = Math.max(1.5, m / 36)) => `fill="none" stroke="${T.g}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (n.shape) {
    case 'operation': {
      const c = Math.min(13, w * 0.12, h * 0.26), q = Math.min(6, h / 6), pr = Math.min(4.2, h * 0.07);
      let s = `<path d="M${q},0H${f(w - c)}L${w},${f(c)}V${f(h - q)}A${q},${q} 0 0 1 ${f(w - q)},${h}H${q}A${q},${q} 0 0 1 0,${f(h - q)}V${q}A${q},${q} 0 0 1 ${q},0Z" fill="${T.f}" ${S}/>`;
      s += `<circle cx="0" cy="${f(cy)}" r="${f(pr)}" fill="${th.bg}" stroke="${T.s}" stroke-width="1.4"/><circle cx="${w}" cy="${f(cy)}" r="${f(pr)}" fill="${T.s}"/>`;
      if (!n.text && !n.sub) { const u = Math.min(h * 0.42, 30); s += `<path d="M${f(cx - u * 0.55)},${f(cy - u * 0.42)}l${f(u * 0.36)},${f(u * 0.42)}l${f(-u * 0.36)},${f(u * 0.42)}M${f(cx + u * 0.02)},${f(cy + u * 0.44)}h${f(u * 0.5)}" ${G(Math.max(1.6, u / 13))}/>`; }
      return s;
    }
    case 'agent':
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${T.f}" ${S}/>` +
        `<rect x="${f(cx - r * 0.36)}" y="${f(cy - r * 0.4)}" width="${f(r * 0.72)}" height="${f(r * 0.86)}" rx="${f(r * 0.3)}" fill="${T.g}"/>` +
        `<circle cx="${f(cx - r * 0.14)}" cy="${f(cy - r * 0.04)}" r="${f(r * 0.075)}" fill="${T.eye}"/><circle cx="${f(cx + r * 0.14)}" cy="${f(cy - r * 0.04)}" r="${f(r * 0.075)}" fill="${T.eye}"/>` +
        `<path d="M${f(cx + r * 0.36)},${f(cy + r * 0.12)}q${f(r * 0.24)},${f(-r * 0.04)} ${f(r * 0.2)},${f(-r * 0.46)}" fill="none" stroke="${T.g}" stroke-width="${f(r * 0.14)}" stroke-linecap="round"/>`;
    case 'capability': {
      const u = h * 0.17, P = [[0.25, -1.1], [-0.75, 0.15], [-0.05, 0.15], [-0.3, 1.1], [0.75, -0.18], [0.05, -0.18]];
      return `<path d="M${f(cx)},1L${w - 1},${f(cy)}L${f(cx)},${h - 1}L1,${f(cy)}Z" fill="${T.f}" ${S}/>` +
        `<path d="M${P.map(([a, b]) => `${f(cx + a * u)},${f(cy + b * u)}`).join('L')}Z" fill="${T.g}" stroke="${T.g}" stroke-width="1" stroke-linejoin="round"/>`;
    }
    case 'store': {
      const ry = Math.min(h * 0.16, 11);
      return `<path d="M0,${f(ry)}A${f(cx)},${f(ry)} 0 0 1 ${w},${f(ry)}V${f(h - ry)}A${f(cx)},${f(ry)} 0 0 1 0,${f(h - ry)}Z" fill="${T.f}" ${S}/>` +
        `<path d="M0,${f(h * 0.54)}A${f(cx)},${f(ry)} 0 0 0 ${w},${f(h * 0.54)}" fill="none" stroke="${T.s}" stroke-width="1.2"/>` +
        `<ellipse cx="${f(cx)}" cy="${f(ry)}" rx="${f(cx)}" ry="${f(ry)}" fill="${mix(T.f, T.s, 0.2)}" ${S}/>`;
    }
    case 'book':
      return `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="${f(Math.min(5, w * 0.08))}" fill="${T.f}" ${S}/>` +
        `<path d="M${f(w * 0.2)},.5V${h - 0.5}" stroke="${T.s}" stroke-width="1.4"/>` +
        `<path d="M${f(w * 0.38)},${f(h * 0.32)}H${f(w * 0.78)}M${f(w * 0.38)},${f(h * 0.46)}H${f(w * 0.78)}M${f(w * 0.38)},${f(h * 0.6)}H${f(w * 0.64)}" ${G()}/>`;
    case 'resource': {
      const pts = [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 180) * (60 * i - 90); return `${f(cx + (w / 2 / 0.866) * Math.cos(a))},${f(cy + (h / 2) * Math.sin(a))}`; });
      const q = m * 0.17, p = q * 0.42, l = q * 0.42;
      let pins = '';
      for (const o of [-p, p]) pins += `M${f(cx + o)},${f(cy - q)}v${f(-l)}M${f(cx + o)},${f(cy + q)}v${f(l)}M${f(cx - q)},${f(cy + o)}h${f(-l)}M${f(cx + q)},${f(cy + o)}h${f(l)}`;
      return `<path d="M${pts.join('L')}Z" fill="${T.f}" ${S}/><rect x="${f(cx - q)}" y="${f(cy - q)}" width="${f(2 * q)}" height="${f(2 * q)}" rx="${f(q * 0.25)}" ${G()}/><path d="${pins}" ${G()}/>`;
    }
    case 'clock': {
      let ticks = '';
      for (let i = 0; i < 12; i++) { const a = (Math.PI / 6) * i, r0 = r * (i % 3 ? 0.66 : 0.6), r1 = r * 0.74; ticks += `M${f(cx + r0 * Math.sin(a))},${f(cy - r0 * Math.cos(a))}L${f(cx + r1 * Math.sin(a))},${f(cy - r1 * Math.cos(a))}`; }
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${T.f}" ${S}/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.86)}" fill="none" stroke="${T.s}" stroke-width="1"/>` +
        `<path d="${ticks}" ${G(Math.max(1, m / 60))}/><path d="M${f(cx)},${f(cy - r * 0.5)}V${f(cy)}L${f(cx + r * 0.3)},${f(cy + r * 0.24)}" ${G(Math.max(1.5, m / 34))}/>`;
    }
    case 'event':
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${T.f}" ${S}/>` +
        `<path d="M${f(cx - r * 0.56)},${f(cy)}h${f(r * 0.24)}l${f(r * 0.12)},${f(-r * 0.42)}l${f(r * 0.2)},${f(r * 0.84)}l${f(r * 0.12)},${f(-r * 0.42)}h${f(r * 0.24)}" ${G()}/>`;
    case 'permission':
      return `<path d="M${f(cx)},1L${w - 1},${f(h * 0.17)}V${f(h * 0.5)}C${w - 1},${f(h * 0.76)} ${f(w * 0.74)},${f(h * 0.9)} ${f(cx)},${h - 1}C${f(w * 0.26)},${f(h * 0.9)} 1,${f(h * 0.76)} 1,${f(h * 0.5)}V${f(h * 0.17)}Z" fill="${T.f}" ${S}/>` +
        `<path d="M${f(w * 0.3)},${f(h * 0.5)}L${f(w * 0.45)},${f(h * 0.64)}L${f(w * 0.72)},${f(h * 0.36)}" ${G(Math.max(1.6, m / 24))}/>`;
    case 'incident':
      return `<path d="M${f(cx)},2L${w - 2},${h - 2}H2Z" fill="${T.f}" ${S}/>` +
        `<path d="M${f(cx)},${f(h * 0.38)}V${f(h * 0.66)}" ${G(Math.max(2, m / 22))}/><circle cx="${f(cx)}" cy="${f(h * 0.8)}" r="${f(Math.max(1.4, m / 34))}" fill="${T.g}"/>`;
    case 'user':
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${T.f}" stroke="${T.s}" stroke-width="1.6" stroke-dasharray="${f(Math.max(3, m / 14))} ${f(Math.max(2.4, m / 18))}"/>` +
        `<circle cx="${f(cx)}" cy="${f(cy - r * 0.24)}" r="${f(r * 0.24)}" fill="${T.g}"/>` +
        `<path d="M${f(cx - r * 0.5)},${f(cy + r * 0.56)}Q${f(cx - r * 0.5)},${f(cy + r * 0.08)} ${f(cx)},${f(cy + r * 0.08)}Q${f(cx + r * 0.5)},${f(cy + r * 0.08)} ${f(cx + r * 0.5)},${f(cy + r * 0.56)}Z" fill="${T.g}"/>`;
    case 'external':
      return `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="3" fill="${T.f}" stroke="${T.s}" stroke-width="1.6" stroke-dasharray="${f(Math.max(3, m / 12))} ${f(Math.max(2.4, m / 16))}"/>` +
        `<path d="M${f(w * 0.5)},${f(h * 0.3)}H${f(w * 0.28)}V${f(h * 0.72)}H${f(w * 0.7)}V${f(h * 0.5)}M${f(w * 0.46)},${f(h * 0.54)}L${f(w * 0.74)},${f(h * 0.26)}M${f(w * 0.56)},${f(h * 0.26)}H${f(w * 0.74)}V${f(h * 0.44)}" ${G()}/>`;
  }
  return '';
}

// A trigger beside a node: a small dial (on a schedule) or a pulse (when something arrives), with its short words.
function triggerSVG(n, th) {
  const c = n.clock;
  if (!c || typeof c !== 'object') return '';
  const T = th.tint.clock, x = -30, y = Math.min(n.h / 2, 24), r = 12;
  const mark = c.kind === 'event'
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${th.bg}" stroke="${T.s}" stroke-width="1.4" stroke-dasharray="3 2.4"/><path d="M${x - 7},${y}h3l2-4.5 3 9 2-4.5h3" fill="none" stroke="${T.g}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="${x}" cy="${y}" r="${r}" fill="${th.bg}" stroke="${T.s}" stroke-width="1.4"/><path d="M${x},${y - 6.5}V${y}l4.5 3" fill="none" stroke="${T.g}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return mark + (c.words ? textSVG([String(c.words)], x, y + r + 4, 11, 14, T.ink) : '');
}
const statusDot = (n, th) => {
  if (!STATUS.includes(n.status)) return '';
  const [x, y] = n.shape === 'operation' ? [n.w - 22, 15] : [n.w - 3, 3];
  return `<circle cx="${f(x)}" cy="${y}" r="4.5" fill="${th[n.status]}" stroke="${th.bg}" stroke-width="${n.shape === 'operation' ? 0 : 2}"/>`;
};
const noteText = (v) => (v && typeof v === 'object' ? String(v.text ?? '') : v === null || v === undefined ? '' : String(v));
const noteTone = (v, th) => (v && typeof v === 'object' && th[v.tone === 'warn' ? 'warn' : v.tone] ? th[v.tone === 'warn' ? 'warn' : v.tone] : null);

// Everything a node draws, in its own coordinates. `hit` adds transparent areas the editor needs for picking.
function nodeInner(n, th, { hideText = false, note, hit = false } = {}) {
  if (n.shape === 'group') {
    const title = n.text && !hideText ? textSVG([upper(n.text)], 20, 12, 12, 20, th.frameInk, { anchor: 'start', spacing: '.08em' }) : '';
    return `<rect x="0" y="0" width="${n.w}" height="${n.h}" rx="16" fill="none" stroke="${th.frame}" stroke-width="1.4" stroke-dasharray="9 7"/>` + title +
      (hit ? `<rect x="0" y="0" width="${n.w}" height="${n.h}" rx="16" fill="none" stroke="transparent" stroke-width="14"/><rect x="10" y="6" width="${f(Math.min(n.w - 20, measure(upper(n.text || ''), 12) * 1.1 + 24))}" height="28" fill="transparent"/>` : '');
  }
  let s = '';
  const nt = noteText(note), tone = noteTone(note, th);
  if (CLASSIC.includes(n.shape)) {
    const C = classicColours(n, th), o = outline(n);
    s += `<path d="${o.d}" fill="${C.f}" stroke="${C.s}" stroke-width="1.5" stroke-linejoin="round"` +
      (n.shape === 'note' ? ' style="filter:drop-shadow(0 2px 3px rgba(40,30,50,.13))"' : '') + '/>';
    if (o.fold) s += `<path d="${o.fold}" fill="${mix(C.f, C.s, 0.35)}" stroke="${C.s}" stroke-width="1.2" stroke-linejoin="round"/>`;
    if (!hideText && n.text) { const lines = wrap(n.text, textW(n)); s += textSVG(lines, n.w / 2, n.h / 2 - (lines.length * LH) / 2, FS, LH, C.ink); }
  } else {
    const T = th.tint[TINT_OF[n.shape]];
    s += symbol(n, T, th);
    if (n.shape === 'operation') {
      if (!hideText) {
        const { title, sub } = opWords(n), blockH = title.length * 20 + sub.length * 17 + (sub.length && title.length ? 4 : 0);
        const top = n.h / 2 - blockH / 2;
        if (title.length) s += textSVG(title, n.w / 2, top, 15, 20, T.ink, { weight: 600 });
        if (sub.length) s += textSVG(sub, n.w / 2, top + title.length * 20 + (title.length ? 4 : 0), 13, 17, T.sub);
      }
    } else {
      const { lines, sub } = iconWords(n);
      if (!hideText && lines.length) s += textSVG(lines, n.w / 2, n.h + 6, LBF, LBL, T.ink);
      if (sub.length) s += textSVG(sub, n.w / 2, n.h + 6 + lines.length * LBL, 12, 16, th.muted);
      if (hit) { const e = ext(n); s += `<rect x="${f(e.x - n.x)}" y="${n.h}" width="${f(e.w)}" height="${f(Math.max(4, e.h - n.h))}" fill="transparent"/>`; }
    }
  }
  s += statusDot(n, th) + triggerSVG(n, th);
  if (nt) {
    const y = ICONS.has(n.shape) ? n.h + labelH(n) + 2 : n.h + 6;
    s += textSVG(wrap(nt, Math.max(n.w + 40, 150), 11.5), n.w / 2, y, 11.5, 15, tone || th.muted, { halo: th.bg });
  }
  return s;
}

// ---------- arrows ----------

const NORMAL = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };
const OPP = { r: 'l', l: 'r', t: 'b', b: 't' };
const ROUND = new Set(['ellipse', 'agent', 'clock', 'event', 'user']);

// How far toward a side's border a point `t` (−1..1 along that side) reaches, as a share of the half size.
function reach(shape, side, t) {
  const vert = side === 'l' || side === 'r';
  if (ROUND.has(shape)) return Math.sqrt(1 - t * t);
  if (shape === 'diamond' || shape === 'capability') return 1 - Math.abs(t);
  if (shape === 'resource') return vert ? (Math.abs(t) < 0.5 ? 1 : 1.5 - Math.abs(t)) : 1 - Math.abs(t) * 0.5;
  if (shape === 'incident') return side === 'b' ? 1 : side === 't' ? 1 - Math.abs(t) : 0.5;
  return 1;
}
// A point on the node's border on one side, `o` units off that side's middle, with the side's outward normal.
// A symbol's lower side is under its words, so arrows never cross them.
function borderPoint(n, side, o) {
  const vert = side === 'l' || side === 'r';
  const hw = n.w / 2, hh = n.h / 2, t = clamp(o / (vert ? hh : hw), -1, 1), k = reach(n.shape, side, t);
  const [nx, ny] = NORMAL[side], cx = n.x + hw, cy = n.y + hh;
  if (vert) return { x: cx + nx * hw * k, y: cy + o, nx, ny };
  if (side === 'b' && ICONS.has(n.shape) && labelH(n)) return { x: cx + o, y: n.y + n.h + labelH(n) + 2, nx, ny };
  return { x: cx + o, y: cy + ny * hh * k, nx, ny };
}

// The side of `n` that faces a point.
function facing(n, p) {
  const dx = p.x - n.x - n.w / 2, dy = p.y - n.y - n.h / 2;
  return borderPoint(n, Math.abs(dx) / n.w > Math.abs(dy) / n.h ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't'), 0);
}

const chevron = (tip, dx, dy) => {                     // an open arrowhead at `tip`, pointing along (dx, dy)
  const px = -dy * 5.4, py = dx * 5.4, bx = tip.x - dx * AH, by = tip.y - dy * AH;
  return `M${f(bx + px)},${f(by + py)}L${f(tip.x)},${f(tip.y)}L${f(bx - px)},${f(by - py)}`;
};

// A smooth curve leaving p along its normal and arriving at q against q's normal.
function curve(p, q, reachLen) {
  const c = reachLen ?? clamp(Math.hypot(q.x - p.x, q.y - p.y) * 0.42, 16, 130);
  const c1x = p.x + p.nx * c, c1y = p.y + p.ny * c, c2x = q.x + q.nx * c, c2y = q.y + q.ny * c;
  const mx = 0.125 * p.x + 0.375 * c1x + 0.375 * c2x + 0.125 * q.x, my = 0.125 * p.y + 0.375 * c1y + 0.375 * c2y + 0.125 * q.y;
  const at = (t) => { const u = 1 - t; return { x: u * u * u * p.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * q.x, y: u * u * u * p.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * q.y }; };
  return {
    d: `M${f(p.x)},${f(p.y)} C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(q.x)},${f(q.y)}`,
    head: chevron(q, -q.nx, -q.ny), mx, my, lx: mx, ly: my - 9, anchor: 'middle',
    poly: Array.from({ length: 41 }, (_, i) => at(i / 40)),
  };
}

// Square routing, as on a circuit: out along the normal, across, and in; corners gently rounded.
function elbow(p, q) {
  const S = 22, a = { x: p.x + p.nx * S, y: p.y + p.ny * S }, b = { x: q.x + q.nx * S, y: q.y + q.ny * S };
  const hp = p.nx !== 0, hq = q.nx !== 0;
  let pts;
  if (hp && hq) {
    if (Math.abs(p.y - q.y) < 6) pts = [p, { x: q.x, y: p.y }];
    else if ((b.x - a.x) * p.nx >= 0) { const mx = (p.x + q.x) / 2; pts = [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q]; }
    else { const my = (p.y + q.y) / 2; pts = [p, a, { x: a.x, y: my }, { x: b.x, y: my }, b, q]; }
  } else if (!hp && !hq) {
    if (Math.abs(p.x - q.x) < 6) pts = [p, { x: p.x, y: q.y }];
    else if ((b.y - a.y) * p.ny >= 0) { const my = (p.y + q.y) / 2; pts = [p, { x: p.x, y: my }, { x: q.x, y: my }, q]; }
    else { const mx = (p.x + q.x) / 2; pts = [p, a, { x: mx, y: a.y }, { x: mx, y: b.y }, b, q]; }
  } else if (hp) pts = (q.x - p.x) * p.nx > 0 && (p.y - q.y) * q.ny > 0 ? [p, { x: q.x, y: p.y }, q] : [p, a, { x: a.x, y: b.y }, b, q];
  else pts = (q.y - p.y) * p.ny > 0 && (p.x - q.x) * q.nx > 0 ? [p, { x: p.x, y: q.y }, q] : [p, a, { x: b.x, y: a.y }, b, q];
  pts = pts.filter((pt, i) => i === 0 || Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y) > 0.5);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], B = pts[i], C = pts[i + 1], l1 = Math.hypot(B.x - A.x, B.y - A.y), l2 = Math.hypot(C.x - B.x, C.y - B.y), rr = Math.min(7, l1 / 2, l2 / 2);
    d += ` L${f(B.x - ((B.x - A.x) / l1) * rr)},${f(B.y - ((B.y - A.y) / l1) * rr)} Q${f(B.x)},${f(B.y)} ${f(B.x + ((C.x - B.x) / l2) * rr)},${f(B.y + ((C.y - B.y) / l2) * rr)}`;
  }
  const L = pts[pts.length - 1], P = pts[pts.length - 2], ll = Math.hypot(L.x - P.x, L.y - P.y) || 1;
  d += ` L${f(L.x)},${f(L.y)}`;
  let best = 0, bi = 1;                                 // the label rides the longest stretch
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > best) { best = l; bi = i; } }
  const s0 = pts[bi - 1], s1 = pts[bi], mx = (s0.x + s1.x) / 2, my = (s0.y + s1.y) / 2, horiz = Math.abs(s1.y - s0.y) < 1;
  return {
    d, head: chevron(L, (L.x - P.x) / ll, (L.y - P.y) / ll), mx, my,
    lx: horiz ? mx : mx + 8, ly: horiz ? my - 9 : my, anchor: horiz ? 'middle' : 'start',
    poly: pts,
  };
}

// Geometry of every arrow. Each end takes the side facing the other node; curved arrows sharing a side spread along
// it, square ones share the port (a bus, as on a circuit).
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
    const spread = list.filter((it) => it.e.route !== 'elbow').sort((p, q) => along(p.other) - along(q.other));
    const span = Math.min((vert ? node.h : node.w) * 0.6, (spread.length - 1) * 22);
    for (const it of list) {
      const i = spread.indexOf(it), o = i < 0 || spread.length === 1 ? 0 : (i / (spread.length - 1) - 0.5) * span;
      if (!ends.has(it.e.id)) ends.set(it.e.id, []);
      ends.get(it.e.id)[it.which] = borderPoint(node, side, o);
    }
  }
  const route = new Map(edges.map((e) => [e.id, e.route]));
  for (const [id, [p, q]] of ends) out.set(id, route.get(id) === 'elbow' ? elbow(p, q) : curve(p, q));
  return out;
}

// The colour of an arrow says what it is: going out of this computer, using something, or carrying data in.
function edgeColour(e, byId, th, tone) {
  if (tone) return tone;
  const a = byId.get(e.from), b = byId.get(e.to);
  if (a && b && b.outside && !a.outside) return th.alt;      // leaving this computer
  if (e.verb === 'usa') return th.tint.slate.s;
  return th.flow;
}
function edgeInner(e, g, th, colour, { sel = false, hideLabel = false, note, hit = false } = {}) {
  const c = sel ? th.accent : colour, dash = DASH_ARRAY[e.dash] ? ` stroke-dasharray="${DASH_ARRAY[e.dash]}"` : '';
  const words = noteText(note) || e.text || (e.verb ? String(e.verb) : '');
  let s = (hit ? `<path d="${g.d}" fill="none" stroke="transparent" stroke-width="14"/>` : '') +
    `<path d="${g.d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${dash}/>` +
    `<path d="${g.head}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (words && !hideLabel) {
    const lines = upper(words).split('\n'), top = g.ly - (lines.length * ELH) / 2;
    if (hit) { const w = Math.max(...lines.map((l) => measure(l, EFS) * 1.08)) + 8, x = g.anchor === 'start' ? g.lx - 4 : g.lx - w / 2; s += `<rect x="${f(x)}" y="${f(top - 2)}" width="${f(w)}" height="${f(lines.length * ELH + 4)}" fill="transparent"/>`; }
    s += `<text font-family="Segoe UI, sans-serif" font-size="${EFS}" letter-spacing=".06em" fill="${c}" text-anchor="${g.anchor}" dominant-baseline="central" paint-order="stroke" stroke="${th.bg}" stroke-width="4" stroke-linejoin="round">` +
      lines.map((l, i) => `<tspan x="${f(g.lx)}" y="${f(top + ELH * (i + 0.5))}">${esc(l)}</tspan>`).join('') + '</text>';
  }
  return s;
}

// A small shield where a line crosses the frontier.
function shieldSVG(x, y, th, k = 1) {
  const T = th.tint.green;
  return `<g transform="translate(${f(x)},${f(y)})${k === 1 ? '' : ` scale(${k})`}"><path d="M0,-11l9,3.4v6.2c0,5.4-3.8,9.2-9,11.2-5.2-2-9-5.8-9-11.2v-6.2z" fill="${T.f}" stroke="${T.s}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M-3.8,0.6l2.7,2.8 5-5.4" fill="none" stroke="${T.g}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
function frontierSVG(d, th, { hit = false, hideLabel = false, sel = false } = {}) {
  const fr = d.frontier;
  if (!fr || num(fr.y) === null) return '';
  const [x0, x1] = frontierSpan(d), y = fr.y, c = sel ? th.accent : th.frame;
  let s = (hit ? `<path data-f="1" d="M${f(x0)},${y}H${f(x1)}" stroke="transparent" stroke-width="14"/>` : '') +
    `<path d="M${f(x0)},${y}H${f(x1)}" stroke="${c}" stroke-width="1.4" stroke-dasharray="9 7" pointer-events="none"/>`;
  if (fr.label && !hideLabel) s += textSVG([upper(fr.label)], x0 + 4, y + 8, 12, 20, th.frameInk, { anchor: 'start', spacing: '.08em' });
  if (fr.out) s += textSVG([upper(fr.out)], x0 + 4, y - 28, 12, 20, th.alt, { anchor: 'start', spacing: '.08em' });
  return s;
}
// Where a line meets a horizontal (y) or vertical (x) border; null if it never does within [lo, hi] along it.
function meet(poly, axis, v, lo, hi) {
  const o = axis === 'y' ? 'x' : 'y';
  for (let i = 1; i < poly.length; i++) {
    const A = poly[i - 1], B = poly[i];
    if ((A[axis] - v) * (B[axis] - v) > 0 || A[axis] === B[axis]) continue;
    const at = A[o] + ((B[o] - A[o]) * (v - A[axis])) / (B[axis] - A[axis]);
    if (at >= lo && at <= hi) return axis === 'y' ? { x: at, y: v } : { x: v, y: at };
  }
  return null;
}
// A line between this computer and the outside carries a shield where it crosses the frontier: the frontier line if
// the diagram has one, or else the border of the group that holds its inside end.
function shields(d, geoms, th) {
  const byId = new Map(d.nodes.map((n) => [n.id, n])), fr = d.frontier && num(d.frontier.y) !== null ? d.frontier : null;
  const groups = d.nodes.filter((n) => n.shape === 'group').sort((a, b) => a.w * a.h - b.w * b.h);
  let s = '';
  for (const e of d.edges) {
    const a = byId.get(e.from), b = byId.get(e.to), g = geoms.get(e.id);
    if (!a || !b || !g || !!a.outside === !!b.outside) continue;
    let p = null;
    if (fr) p = meet(g.poly, 'y', fr.y, -Infinity, Infinity);
    else {
      const inner = ext(a.outside ? b : a), box = groups.find((G) => inner.x >= G.x && inner.y >= G.y && inner.x + inner.w <= G.x + G.w && inner.y + inner.h <= G.y + G.h);
      if (box) p = meet(g.poly, 'y', box.y, box.x, box.x + box.w) || meet(g.poly, 'y', box.y + box.h, box.x, box.x + box.w) || meet(g.poly, 'x', box.x, box.y, box.y + box.h) || meet(g.poly, 'x', box.x + box.w, box.y, box.y + box.h);
    }
    if (p) s += shieldSVG(p.x, p.y, th);
  }
  return s;
}

// The whole drawing (no UI), in diagram coordinates; used by thumbnails.
function sceneSVG(d, th, reading) {
  const geoms = edgeGeoms(d.nodes, d.edges), byId = new Map(d.nodes.map((n) => [n.id, n])), notes = notesOf(d, reading);
  const g = (n) => `<g transform="translate(${n.x},${n.y})">${nodeInner(n, th, { note: notes[n.id] })}</g>`;
  return d.nodes.filter((n) => n.shape === 'group').map(g).join('') + frontierSVG(d, th) +
    d.edges.map((e) => (geoms.has(e.id) ? edgeInner(e, geoms.get(e.id), th, edgeColour(e, byId, th, noteTone(notes['edge:' + e.id], th)), { note: notes['edge:' + e.id] }) : '')).join('') +
    shields(d, geoms, th) + d.nodes.filter((n) => n.shape !== 'group').map(g).join('');
}
function notesOf(d, reading) {
  const r = Array.isArray(d.readings) ? d.readings[reading] : undefined;
  return (r !== undefined && d.notes && typeof d.notes === 'object' && d.notes[r] && typeof d.notes[r] === 'object') ? d.notes[r] : {};
}

// A symbol drawn small, for the palette and the bar.
function miniSVG(shape, th, size = 30) {
  if (shape === 'frontier') return `<svg viewBox="-2 -2 ${size + 4} ${size + 4}"><path d="M0,${f(size * 0.6)}H${size}" stroke="${th.frame}" stroke-width="1.6" stroke-dasharray="5 4"/>${shieldSVG(size / 2, size * 0.58, th, 0.8)}</svg>`;
  const [dw, dh] = SIZE[shape], k = Math.min(size / dw, size / dh) * (CLASSIC.includes(shape) || shape === 'operation' || shape === 'group' ? 1 : 0.92);
  const w = Math.max(10, Math.round(dw * k)), h = Math.max(10, Math.round(dh * k));
  const n = { id: 'mini-' + shape, shape, w, h, text: '', color: { box: PALETTE[1], ellipse: PALETTE[4], diamond: PALETTE[0], note: PALETTE[3] }[shape] || PALETTE[0] };
  const inner = shape === 'group'
    ? `<rect x="0" y="0" width="${w}" height="${h}" rx="5" fill="none" stroke="${th.frame}" stroke-width="1.4" stroke-dasharray="4 3"/>`
    : nodeInner(n, th).replace(/ style="filter:[^"]*"/, '');
  return `<svg viewBox="${f((w - size) / 2 - 3)} ${f((h - size) / 2 - 3)} ${size + 6} ${size + 6}">${inner}</svg>`;
}

// ---------- thumbnail ----------

export function diagramThumbSVG(data, w = 240, h = 160) {
  const { d } = normalize(data), th = themeOf(d);
  const bg = d.theme === 'dark' ? `<rect width="${w}" height="${h}" fill="${th.bg}"/>` : '';
  const head = `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}`;
  let b = bounds(d.nodes, true);
  if (!b) return head + '</svg>';
  if (d.frontier && num(d.frontier.y) !== null) { const y0 = Math.min(b.y, d.frontier.y - 40), y1 = Math.max(b.y + b.h, d.frontier.y + 30); b = { ...b, y: y0, h: y1 - y0 }; }
  const pad = 8, s = Math.min((w - 2 * pad) / b.w, (h - 2 * pad) / b.h, 1);
  const tx = w / 2 - (b.x + b.w / 2) * s, ty = h / 2 - (b.y + b.h / 2) * s;
  return `${head}<g transform="translate(${f(tx)},${f(ty)}) scale(${s.toFixed(4)})">${sceneSVG(d, th, 0)}</g></svg>`;
}

// ---------- editor ----------

export function createDiagram(container, { data: initial, onChange, title, panOnDrag = false } = {}) {
  let { d: data, fixed } = normalize(initial);
  const view = { x: 0, y: 0, k: 1 };
  let selN = new Set(), selE = new Set(), selF = false;
  let hover = null, mode = null, editing = null, spaceHeld = false, reading = 0;
  let undo = [], redo = [], lastTag = null, lastTime = 0;
  let clip = null, pasteN = 0;
  const style = { shape: 'box', color: PALETTE[0] };       // what a new box looks like: the last choice made
  let raf = 0, timer = 0, anim = 0, fitted = false, geoms = new Map(), barKey = '', chromeKey = '';
  let palOpen = true;
  try { palOpen = localStorage.getItem('meadow.dg.palette') !== 'off'; } catch { /* storage may be blocked */ }

  const root = document.createElement('div');
  root.className = 'dg';
  root.tabIndex = 0;
  root.innerHTML = `<svg class="dg-svg" xmlns="${NS}"><g class="dg-world"><g class="dg-groups"></g><g class="dg-front"></g><g class="dg-edges"></g><g class="dg-shields"></g><g class="dg-nodes"></g><g class="dg-over"></g></g>` +
    '<rect class="dg-band" visibility="hidden"/></svg><div class="dg-hint">Doble clic para empezar</div>' +
    (title ? `<div class="dg-title">${esc(title)}</div>` : '') +
    '<div class="dg-pal"></div><div class="dg-reads" hidden></div><div class="dg-bar" hidden></div>' +
    `<div class="dg-zoom"><button data-z="theme"></button><button data-z="fit" title="Encajar">${lineIcon('fit')}</button><button data-z="one" title="Tamaño real"></button></div>`;
  container.append(root);
  const $ = (s) => root.querySelector(s);
  const svg = $('.dg-svg'), world = $('.dg-world'), groupLayer = $('.dg-groups'), frontLayer = $('.dg-front'), edgeLayer = $('.dg-edges');
  const shieldLayer = $('.dg-shields'), nodeLayer = $('.dg-nodes'), over = $('.dg-over');
  const band = $('.dg-band'), hint = $('.dg-hint'), bar = $('.dg-bar'), pal = $('.dg-pal'), reads = $('.dg-reads'), zoomOne = $('[data-z="one"]'), themeBtn = $('[data-z="theme"]');
  const nodeEls = new Map(), edgeEls = new Map();

  const th = () => themeOf(data);
  const index = () => new Map(data.nodes.map((n) => [n.id, n]));
  const snap = () => JSON.stringify(data);
  const getData = () => JSON.parse(snap());
  const notes = () => notesOf(data, reading);

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
    selF = selF && !!data.frontier;
    hover = null;
  }
  function step(from, to) {
    if (!from.length) return;
    to.push(snap());
    data = JSON.parse(from.pop());
    lastTag = null;
    prune(); scheduleChange(); paint();
  }
  const clearSel = () => { selN = new Set(); selE = new Set(); selF = false; };

  // ----- drawing -----

  const paint = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function draw() {
    cancelAnimationFrame(raf); raf = 0;
    const k = view.k, T = th(), dark = data.theme === 'dark', N = notes(), byId = index();
    root.classList.toggle('dg-dark', dark);
    world.setAttribute('transform', `translate(${f(view.x)},${f(view.y)}) scale(${k})`);
    const grid = 24 * k * (k < 0.25 ? 4 : k < 0.5 ? 2 : 1);
    root.style.backgroundSize = `${grid}px ${grid}px`;
    root.style.backgroundPosition = `${view.x}px ${view.y}px`;
    paintChrome();

    // nodes: keyed, redrawn only when their look changes; groups sit behind everything
    const aliveN = new Set(data.nodes.map((n) => n.id));
    for (const [id, rec] of nodeEls) if (!aliveN.has(id)) { rec.el.remove(); nodeEls.delete(id); }
    let gi = 0, ni = 0;
    for (const n of data.nodes) {
      let rec = nodeEls.get(n.id);
      if (!rec) {
        const el = document.createElementNS(NS, 'g');
        el.setAttribute('data-n', n.id);
        rec = { el, sig: '', pos: '' };
        nodeEls.set(n.id, rec);
      }
      const hidden = (editing?.kind === 'node' && editing.id === n.id), note = N[n.id];
      const sig = JSON.stringify([data.theme, n.shape, n.color, n.w, n.h, hidden ? '' : n.text, n.sub, n.status, n.clock, note]);
      if (rec.sig !== sig) { rec.el.innerHTML = nodeInner(n, T, { hideText: hidden, note, hit: true }); rec.sig = sig; }
      const pos = `translate(${n.x},${n.y})`;
      if (rec.pos !== pos) { rec.el.setAttribute('transform', pos); rec.pos = pos; }
      const layer = n.shape === 'group' ? groupLayer : nodeLayer, i = n.shape === 'group' ? gi++ : ni++;
      if (layer.children[i] !== rec.el) layer.insertBefore(rec.el, layer.children[i] || null);
    }

    // edges, the frontier and its shields
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
      const sel = selE.has(e.id), hidden = editing?.kind === 'edge' && editing.id === e.id, note = N['edge:' + e.id];
      const colour = edgeColour(e, byId, T, noteTone(note, T));
      const sig = JSON.stringify([data.theme, g.d, e.dash, sel, hidden ? '' : e.text, e.verb, note, colour]);
      if (rec.sig !== sig) { rec.el.innerHTML = edgeInner(e, g, T, colour, { sel, hideLabel: hidden, note, hit: true }); rec.sig = sig; }
      if (edgeLayer.children[ei] !== rec.el) edgeLayer.insertBefore(rec.el, edgeLayer.children[ei] || null);
      ei++;
    }
    frontLayer.innerHTML = frontierSVG(data, T, { hit: true, sel: selF, hideLabel: editing?.kind === 'frontier' });
    shieldLayer.innerHTML = shields(data, geoms, T);

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

  // The palette, the readings and the theme button change rarely: rebuilt only when what they show changes.
  function paintChrome() {
    const rs = Array.isArray(data.readings) ? data.readings.map(String) : [];
    if (reading >= rs.length) reading = 0;
    const key = JSON.stringify([data.theme, palOpen, rs, reading]);
    if (key === chromeKey) return;
    chromeKey = key;
    const T = th(), dark = data.theme === 'dark';
    const item = (s) => `<button data-add="${s}" title="${NAMES[s]}">${miniSVG(s, T)}</button>`;
    pal.classList.toggle('dg-pal-off', !palOpen);
    pal.innerHTML = `<button class="dg-pal-t" title="${palOpen ? 'Recoger los símbolos' : 'Símbolos'}">${lineIcon('chev')}</button>` +
      (palOpen ? `<div class="dg-pal-g">${CLASSIC.map(item).join('')}<i></i>${SYMBOLS.map(item).join('')}<i></i>${item('group')}${item('frontier')}</div>` : '');
    reads.hidden = !rs.length;
    reads.innerHTML = rs.map((r, i) => `<button data-r="${i}"${i === reading ? ' class="on"' : ''}>${esc(r)}</button>`).join('');
    themeBtn.innerHTML = lineIcon(dark ? 'sun' : 'moon');
    themeBtn.title = dark ? 'Tema claro' : 'Tema oscuro';
  }

  // Selection outlines, connection dots, resize handle and the arrow being drawn. Sizes are divided by the zoom so
  // they look the same at any zoom.
  function overlay() {
    const k = view.k, s = (v) => f(v / k), map = index(), A = th().accent;
    const line = `fill="none" stroke="${A}" stroke-width="${s(1.3)}" stroke-dasharray="${s(5)} ${s(4)}"`;
    let h = '';
    for (const id of selN) {
      const n = map.get(id);
      if (!n) continue;
      const e = ext(n);
      h += n.shape === 'ellipse'
        ? `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + n.h / 2}" rx="${f(n.w / 2 + 5 / k)}" ry="${f(n.h / 2 + 5 / k)}" ${line}/>`
        : `<rect x="${f(e.x - 5 / k)}" y="${f(e.y - 5 / k)}" width="${f(e.w + 10 / k)}" height="${f(e.h + 10 / k)}" rx="${f((n.shape === 'group' ? 16 : n.shape === 'note' ? 4 : 10) + 5 / k)}" ${line}/>`;
    }
    if (editing || (mode && (mode.type === 'pan' || mode.type === 'band' || mode.type === 'resize' || mode.type === 'frontier' || (mode.type === 'move' && mode.moved)))) return h;

    if (mode?.type === 'connect') {
      const a = map.get(mode.from), p = borderPoint(a, mode.side, 0), cur = mode.cur, elb = symbolic(a);
      let q = null;
      if (mode.target) {
        const t = mode.target, e = ext(t);
        q = facing(t, p);
        h += `<rect x="${f(e.x - 5 / k)}" y="${f(e.y - 5 / k)}" width="${f(e.w + 10 / k)}" height="${f(e.h + 10 / k)}" rx="${f(12 + 5 / k)}" fill="none" stroke="${A}" stroke-opacity=".45" stroke-width="${s(2)}"/>`;
      } else if (cur) {
        const dx = cur.x - p.x, dy = cur.y - p.y;
        q = Math.abs(dx) > Math.abs(dy) ? { x: cur.x, y: cur.y, nx: -Math.sign(dx) || -1, ny: 0 } : { x: cur.x, y: cur.y, nx: 0, ny: -Math.sign(dy) || -1 };
        if (mode.far) {                                   // where the new piece would land
          const [, dh] = SIZE[a.shape];
          h += `<rect x="${f(cur.x - a.w / 2)}" y="${f(cur.y - dh / 2)}" width="${a.w}" height="${dh}" rx="12" fill="none" stroke="${A}" stroke-opacity=".5" stroke-width="${s(1.3)}" stroke-dasharray="${s(5)} ${s(4)}"/>`;
          q = facing({ x: cur.x - a.w / 2, y: cur.y - dh / 2, w: a.w, h: dh, shape: 'box' }, p);
        }
      }
      if (q) {
        const c = elb ? elbow(p, q) : curve(p, q);
        h += `<path d="${c.d}" fill="none" stroke="${A}" stroke-width="1.8" stroke-linecap="round"/><path d="${c.head}" fill="none" stroke="${A}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return h;
    }

    const single = selN.size === 1 && !selE.size ? [...selN][0] : null;
    for (const id of new Set([hover, single].filter(Boolean))) {
      const n = map.get(id);
      if (!n || n.shape === 'group') continue;
      for (const side of ['t', 'r', 'b', 'l']) {
        const b = borderPoint(n, side, 0);
        h += `<g class="dg-dot" data-dot="${esc(n.id)}" data-side="${side}" transform="translate(${f(b.x)},${f(b.y)}) scale(${(1 / k).toFixed(4)})"><circle r="10" fill="transparent"/><circle r="4.2"/></g>`;
      }
    }
    const n = single && map.get(single);
    if (n) { const e = ext(n); h += `<rect class="dg-rs" data-rs="${esc(n.id)}" transform="translate(${f(e.x + e.w + 5 / k)},${f(e.y + e.h + 5 / k)}) scale(${(1 / k).toFixed(4)})" x="-4.5" y="-4.5" width="9" height="9" rx="2.5"/>`; }
    return h;
  }

  // ----- floating bar -----

  function barHTML() {
    const map = index(), T = th();
    const nodes = [...selN].map((id) => map.get(id)).filter((n) => n && n.shape !== 'group'), edges = data.edges.filter((e) => selE.has(e.id));
    let h = '';
    if (nodes.length) {
      const all = (k, v) => nodes.every((n) => n[k] === v);
      h += `<div class="dg-grid">${SHAPES.map((s) => `<button data-shape="${s}" title="${NAMES[s]}"${all('shape', s) ? ' class="on"' : ''}>${miniSVG(s, T, 22)}</button>`).join('')}</div>`;
      if (nodes.some((n) => CLASSIC.includes(n.shape))) {
        h += '<i class="dg-sep"></i><div class="dg-cols">' + PALETTE.map((c, i) => `<button class="dg-sw${all('color', c) ? ' on' : ''}" data-color="${c}" title="${COLOR_NAMES[i]}"><span style="background:${data.theme === 'dark' ? mix(darken(c), T.bg, 0.6) : c};border-color:${darken(c)}"></span></button>`).join('') + '</div>';
      }
    }
    if (edges.length) {
      if (h) h += '<i class="dg-sep"></i>';
      const names = { solid: 'Línea continua', dashed: 'Línea discontinua', dashdot: 'Línea de trazo y punto', curve: 'Curva', elbow: 'En ángulo recto' };
      h += DASHES.map((x) => `<button data-dash="${x}" title="${names[x]}"${edges.every((e) => e.dash === x) ? ' class="on"' : ''}>${lineIcon(x)}</button>`).join('');
      h += '<i class="dg-sep"></i>' + ['curve', 'elbow'].map((x) => `<button data-route="${x}" title="${names[x]}"${edges.every((e) => e.route === x) ? ' class="on"' : ''}>${lineIcon(x)}</button>`).join('');
    }
    return h;
  }

  function placeBar() {
    const show = (selN.size || selE.size) && !editing && !(mode && (mode.type !== 'move' || mode.moved));
    const html = show ? barHTML() : '';
    if (!html) { bar.hidden = true; return; }
    if (html !== barKey) { bar.innerHTML = html; barKey = html; }
    bar.hidden = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const map = index();
    for (const id of selN) { const n = map.get(id); if (n) { const e = ext(n); x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); } }
    for (const id of selE) { const g = geoms.get(id); if (g) { x0 = Math.min(x0, g.mx); y0 = Math.min(y0, g.my); x1 = Math.max(x1, g.mx); y1 = Math.max(y1, g.my); } }
    const k = view.k, W = root.clientWidth, H = root.clientHeight, bw = bar.offsetWidth, bh = bar.offsetHeight;
    let top = view.y + y0 * k - bh - 16;
    if (top < 8) top = view.y + y1 * k + 16;
    const left = view.x + ((x0 + x1) / 2) * k - bw / 2;
    bar.style.transform = `translate(${Math.round(clamp(left, 8, W - bw - 8))}px, ${Math.round(clamp(top, 8, H - bh - 8))}px)`;
  }

  // Changing what a thing is keeps its centre; a symbol takes its own size.
  function reshape(n, shape) {
    if (n.shape === shape) return;
    const resize = ICONS.has(n.shape) || ICONS.has(shape) || n.shape === 'operation' || shape === 'operation';
    if (resize) { const [w, h] = SIZE[shape], cx = n.x + n.w / 2, cy = n.y + n.h / 2; n.w = w; n.h = h; n.x = Math.round(cx - w / 2); n.y = Math.round(cy - h / 2); }
    n.shape = shape;
    n.h = Math.max(n.h, minH(n));
  }

  for (const el of [bar, pal, reads, $('.dg-zoom')]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar.addEventListener('pointerdown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const map = index(), nodes = [...selN].map((id) => map.get(id)).filter((n) => n && n.shape !== 'group');
    edit(() => {
      if (b.dataset.shape) { style.shape = b.dataset.shape; for (const n of nodes) reshape(n, style.shape); }
      if (b.dataset.color) { style.color = b.dataset.color; for (const n of nodes) if (CLASSIC.includes(n.shape)) n.color = style.color; }
      for (const ed of data.edges) {
        if (!selE.has(ed.id)) continue;
        if (b.dataset.dash) ed.dash = b.dataset.dash;
        if (b.dataset.route) ed.route = b.dataset.route;
      }
    });
  });
  reads.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { reading = +b.dataset.r; paint(); } });

  // ----- text editing -----

  // What can be written on: a node's text, an arrow's label, the frontier's name.
  function target(kind, id) {
    if (kind === 'node') { const n = index().get(id); return n && { item: n, get: () => n.text, set: (v) => { n.text = v; } }; }
    if (kind === 'edge') { const e = data.edges.find((x) => x.id === id); return e && { item: e, get: () => e.text, set: (v) => { e.text = v; } }; }
    const fr = data.frontier;
    return fr && { item: fr, get: () => String(fr.label ?? ''), set: (v) => { fr.label = v; } };
  }

  function startEdit(kind, id, { before = snap(), isNew = false } = {}) {
    const t = target(kind, id);
    if (!t) return;
    if (editing) finishEdit();
    const n = kind === 'node' ? t.item : null;
    const ta = document.createElement('textarea');
    ta.className = 'dg-ta' + (kind !== 'node' || n.shape === 'group' ? ' dg-ta-up' : '') + (kind === 'frontier' || n?.shape === 'group' ? ' dg-ta-left' : '') + (kind === 'edge' ? ' dg-ta-e' : '');
    ta.value = t.get();
    ta.spellcheck = false;
    ta.rows = 1;
    editing = { kind, id, t, ta, before, isNew, h0: n?.h };
    root.append(ta);
    ta.addEventListener('input', () => {
      t.set(ta.value);
      if (n) n.h = Math.max(editing.h0, minH(n));
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
    ed.t.set(ed.t.get().trim());
    if (ed.kind === 'node') {
      const n = ed.t.item;
      if (ed.isNew && !n.text) { data = JSON.parse(ed.before); prune(); }   // an empty new piece was a slip: gone
      else n.h = Math.max(ed.h0, minH(n));
    }
    commit(ed.before);
    scheduleChange();
    draw();
    if (refocus) root.focus({ preventScroll: true });
  }

  // The textarea sits exactly where the words are drawn, at the same size.
  function placeEditor() {
    const { kind, t, ta } = editing, k = view.k, T = th();
    const put = (left, top, width, lines, fs, lh, colour) => Object.assign(ta.style, {
      left: view.x + left * k + 'px', top: view.y + top * k + 'px', width: width * k + 2 + 'px', height: Math.max(1, lines) * lh * k + 'px',
      fontSize: fs * k + 'px', lineHeight: lh * k + 'px', color: colour,
    });
    if (kind === 'node') {
      const n = t.item;
      if (n.shape === 'group') put(n.x + 20, n.y + 12, n.w - 40, 1, 12, 20, T.frameInk);
      else if (ICONS.has(n.shape)) { const lw = labelW(n); put(n.x + n.w / 2 - lw / 2, n.y + n.h + 6, lw, wrap(n.text, lw, LBF).length, LBF, LBL, T.tint[TINT_OF[n.shape]].ink); }
      else {
        const tw = textW(n), lines = wrap(n.text, tw).length, ink = n.shape === 'operation' ? T.tint.slate.ink : T.ink;
        put(n.x + n.w / 2 - tw / 2 - 1, n.y + n.h / 2 - (lines * LH) / 2, tw, lines, FS, LH, ink);
      }
    } else if (kind === 'edge') {
      const g = geoms.get(t.item.id);
      if (!g) return;
      const lines = (t.item.text || ' ').split('\n'), w = Math.max(50, ...lines.map((l) => measure(upper(l), EFS) * 1.1)) + 6;
      put((g.anchor === 'start' ? g.lx : g.lx - w / 2), g.ly - (lines.length * ELH) / 2, w, lines.length, EFS, ELH, '');
    } else {
      const [x0] = frontierSpan(data);
      put(x0 + 4, data.frontier.y + 8, 300, 1, 12, 20, T.frameInk);
    }
  }

  // ----- creating -----

  function makeNode(p, shape, color, w, free = false) {
    const [dw, dh] = SIZE[shape];
    w ??= dw;
    let x = Math.round(p.x - w / 2), y = Math.round(p.y - dh / 2);
    if (free) {                                         // a piece added from the palette looks for an empty spot
      const busy = (b) => data.nodes.some((m) => m.shape !== 'group' && (() => { const e = ext(m); return b.x < e.x + e.w + 16 && e.x < b.x + b.w + 16 && b.y < e.y + e.h + 16 && e.y < b.y + b.h + 16; })());
      for (let i = 0; i < 60 && busy({ x, y, w, h: dh + 24 }); i++) x += 40;
    }
    const n = { id: newId(shape === 'group' ? 'g' : 'n'), x, y, w, h: dh, text: '', shape, color };
    data.nodes.push(n);
    selN = new Set([n.id]); selE = new Set(); selF = false;
    return n;
  }
  const newEdge = (a, b) => ({ id: newId('e'), from: a.id, to: b.id, text: '', dash: 'solid', route: defaultRoute(a, b) });

  function finishConnect(m) {
    const src = index().get(m.from);
    if (m.target) {
      if (!data.edges.some((x) => x.from === m.from && x.to === m.target.id)) edit(() => data.edges.push(newEdge(src, m.target)));
    } else if (m.far && m.cur) {
      const before = snap(), n = makeNode(m.cur, src.shape, src.color, ICONS.has(src.shape) ? undefined : src.w);
      data.edges.push(newEdge(src, n));
      startEdit('node', n.id, { before, isNew: true });
    }
  }

  // From the palette: a click adds the piece in the middle of the view, a drag drops it where it lands.
  function addFromPalette(shape, p) {
    if (shape === 'frontier') {
      edit(() => { data.frontier = { ...(data.frontier || {}), y: Math.round(p.y), label: data.frontier?.label ?? 'Este ordenador' }; clearSel(); selF = true; });
      return;
    }
    const before = snap(), n = makeNode(p, shape, style.color, undefined, p.free);
    startEdit('node', n.id, { before });
  }
  pal.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.dg-pal-t')) {
      palOpen = !palOpen;
      try { localStorage.setItem('meadow.dg.palette', palOpen ? 'on' : 'off'); } catch { /* storage may be blocked */ }
      paint();
      return;
    }
    const b = e.target.closest('[data-add]');
    if (!b) return;
    e.preventDefault();
    const shape = b.dataset.add, x0 = e.clientX, y0 = e.clientY;
    let ghost = null;
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) { ghost = document.createElement('div'); ghost.className = 'dg-ghost'; ghost.innerHTML = b.innerHTML; root.append(ghost); }
      if (ghost) { const r = root.getBoundingClientRect(); ghost.style.transform = `translate(${ev.clientX - r.left - 20}px, ${ev.clientY - r.top - 20}px)`; }
    };
    const up = (ev) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (ghost) {
        ghost.remove();
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        if (hit && (hit === svg || svg.contains(hit))) addFromPalette(shape, pt(ev));
      } else addFromPalette(shape, { x: (root.clientWidth / 2 + (palOpen ? 50 : 0) - view.x) / view.k, y: (root.clientHeight / 2 - view.y) / view.k, free: true });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  // ----- clipboard -----

  function selectionCopy() {
    const nodes = data.nodes.filter((n) => selN.has(n.id));
    return { nodes: clone(nodes), edges: clone(data.edges.filter((e) => selN.has(e.from) && selN.has(e.to))) };
  }
  function insert(c, off) {
    if (!c?.nodes.length) return;
    edit(() => {
      const ids = new Map();
      clearSel();
      for (const n of c.nodes) {
        const m = { ...clone(n), id: newId(n.shape === 'group' ? 'g' : 'n'), x: n.x + off, y: n.y + off };
        ids.set(n.id, m.id);
        data.nodes.push(m);
        selN.add(m.id);
      }
      for (const e of c.edges) data.edges.push({ ...clone(e), id: newId('e'), from: ids.get(e.from), to: ids.get(e.to) });
    });
  }
  function remove() {
    if (!selN.size && !selE.size && !selF) return;
    edit(() => {
      data.nodes = data.nodes.filter((n) => !selN.has(n.id));
      data.edges = data.edges.filter((e) => !selE.has(e.id) && !selN.has(e.from) && !selN.has(e.to));
      if (selF) delete data.frontier;
      clearSel();
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
    const W = root.clientWidth, H = root.clientHeight, left = palOpen ? 100 : 0;
    if (!W || !H) return;
    let b = bounds(data.nodes, true);
    if (b && data.frontier && num(data.frontier.y) !== null) { const y0 = Math.min(b.y, data.frontier.y - 40), y1 = Math.max(b.y + b.h, data.frontier.y + 30); b = { ...b, y: y0, h: y1 - y0 }; }
    let to = { x: left + (W - left) / 2, y: H / 2, k: 1 };
    if (b) {
      const k = clamp(Math.min((W - left - 128) / b.w, (H - 128) / b.h, 1), 0.1, 4);
      to = { k, x: left + (W - left) / 2 - (b.x + b.w / 2) * k, y: H / 2 - (b.y + b.h / 2) * k };
    }
    if (animate) glide(to); else { Object.assign(view, to); draw(); }
  }

  $('.dg-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.z === 'fit') fitView();
    else if (b.dataset.z === 'theme') edit(() => { data.theme = data.theme === 'dark' ? 'light' : 'dark'; });
    else glide(zoomTo(1, root.clientWidth / 2, root.clientHeight / 2));
    root.focus({ preventScroll: true });
  });

  // ----- pointer -----

  const pt = (e) => {
    const r = svg.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };
  function nodeAt(p, m = 0) {                           // the topmost piece under a point (groups are not pieces)
    for (let i = data.nodes.length - 1; i >= 0; i--) {
      const n = data.nodes[i];
      if (n.shape === 'group') continue;
      const e = ext(n);
      if (p.x >= e.x - m && p.x <= e.x + e.w + m && p.y >= e.y - m && p.y <= e.y + e.h + m) return n;
    }
    return null;
  }
  const inside = (a, g) => a.x >= g.x && a.y >= g.y && a.x + a.w <= g.x + g.w && a.y + a.h <= g.y + g.h;

  svg.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll on middle click
  svg.addEventListener('pointerdown', (e) => {
    stopGlide();
    if (editing) finishEdit();
    root.focus({ preventScroll: true });
    const p = pt(e), add = e.shiftKey || e.ctrlKey || e.metaKey, t = e.target;
    const dot = t.closest('[data-dot]'), rs = t.closest('[data-rs]'), fr = t.closest('[data-f]'), ng = t.closest('[data-n]'), eg = t.closest('[data-e]');
    if (e.button === 1 || (e.button === 0 && spaceHeld) || (e.button === 0 && panOnDrag && !add && !dot && !rs && !fr && !ng && !eg)) {
      mode = { type: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y };
      root.classList.add('dg-panning');
    } else if (e.button !== 0) return;
    else if (dot) mode = { type: 'connect', from: dot.dataset.dot, side: dot.dataset.side, p, cur: null, target: null, far: false };
    else if (rs) { const n = index().get(rs.dataset.rs); mode = { type: 'resize', n, p, w: n.w, h: n.h, before: snap() }; }
    else if (fr) { clearSel(); selF = true; mode = { type: 'frontier', p, y: data.frontier.y, before: snap() }; }
    else if (ng) {
      const id = ng.getAttribute('data-n');
      if (add && selN.has(id)) { selN.delete(id); paint(); return; }
      if (add) selN.add(id);
      else if (!selN.has(id)) { selN = new Set([id]); selE = new Set(); }
      selF = false;
      mode = { type: 'move', p, id, add, moved: false, before: null, orig: [] };
    } else if (eg) {
      const id = eg.getAttribute('data-e');
      if (add) selE.has(id) ? selE.delete(id) : selE.add(id);
      else { clearSel(); selE = new Set([id]); }
      paint();
      return;
    } else {
      if (!add) clearSel();
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
        // a group carries whatever lies inside it
        const map = index(), carried = new Set(selN);
        for (const id of selN) {
          const g = map.get(id);
          if (g?.shape === 'group') for (const n of data.nodes) if (n !== g && inside(ext(n), g)) carried.add(n.id);
        }
        mode.orig = [...carried].map((i) => map.get(i)).filter(Boolean).map((n) => ({ n, x: n.x, y: n.y }));
      }
      const dx = p.x - mode.p.x, dy = p.y - mode.p.y;
      for (const o of mode.orig) { o.n.x = Math.round(o.x + dx); o.n.y = Math.round(o.y + dy); }
    } else if (mode.type === 'resize') {
      const n = mode.n, dx = p.x - mode.p.x, dy = p.y - mode.p.y;
      if (ICONS.has(n.shape)) {                          // a symbol keeps its proportions
        const s = Math.max(32 / Math.min(mode.w, mode.h), (mode.w + dx) / mode.w, (mode.h + dy) / mode.h);
        n.w = Math.round(mode.w * s); n.h = Math.round(mode.h * s);
      } else {
        n.w = Math.max(60, Math.round(mode.w + dx));
        n.h = Math.max(30, Math.round(mode.h + dy), minH(n));
      }
    } else if (mode.type === 'frontier') data.frontier.y = Math.round(mode.y + p.y - mode.p.y);
    else if (mode.type === 'connect') {
      mode.cur = p;
      mode.far ||= Math.hypot(p.sx - mode.p.sx, p.sy - mode.p.sy) > 24;
      const t = nodeAt(p);
      mode.target = t && t.id !== mode.from ? t : null;
    } else if (mode.type === 'band') {
      mode.b = p;
      const x0 = Math.min(mode.a.x, p.x), x1 = Math.max(mode.a.x, p.x), y0 = Math.min(mode.a.y, p.y), y1 = Math.max(mode.a.y, p.y);
      selN = new Set(mode.baseN);
      for (const n of data.nodes) { const b = ext(n); if (b.x >= x0 && b.x + b.w <= x1 && b.y >= y0 && b.y + b.h <= y1) selN.add(n.id); }
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
      else if (!m.add && selN.size > 1) { selN = new Set([m.id]); selE = new Set(); }   // a plain click inside a group picks one
    } else if (m.type === 'resize' || m.type === 'frontier') commit(m.before);
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
    if (nid) { clearSel(); selN = new Set([nid]); startEdit('node', nid); }
    else if (eid) { clearSel(); selE = new Set([eid]); startEdit('edge', eid); }
    else if (hit?.closest?.('[data-f]')) { clearSel(); selF = true; startEdit('frontier'); }
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
    else if (arrows[key] && (selN.size || selF)) {
      const s = e.shiftKey ? 10 : 1, [dx, dy] = arrows[key];
      edit(() => {
        for (const n of data.nodes) if (selN.has(n.id)) { n.x += dx * s; n.y += dy * s; }
        if (selF) data.frontier.y += dy * s;
      }, 'nudge');
    } else if (key === 'Enter' && selN.size === 1 && !selE.size) startEdit('node', [...selN][0]);
    else if (key === 'Escape' && (mode || selN.size || selE.size || selF)) { if (mode?.type === 'connect') mode = null; clearSel(); }
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
      undo = []; redo = []; lastTag = null; mode = null; reading = 0;
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
