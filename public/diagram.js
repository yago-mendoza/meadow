// Meadow diagrams: boxes, symbols and arrows on an unbounded canvas. Plain DOM + SVG, no dependencies.
//
// The visual language: a shape says what a thing is and each kind of symbol has one tint; operations carry ports, a
// status dot and a subtitle; triggers sit beside them as a small dial (schedule) or pulse (something arrives); arrows
// say what travels with a verb; one dashed line is the frontier (what is outside sits beyond it, and a line that
// crosses it carries a small shield); one topology can be read in several ways: switching the reading changes
// annotations only, never moves a piece.
//
// The data is the contract (plain JSON; everything except the arrays is optional, and every field below that an older
// version does not know is simply ignored by it):
//   { v: 1, theme: 'light'|'dark',
//     nodes: [{ id, x, y, w, h, text, shape, color,          // shape: an id from diagram-symbols.js (165 of them: box,
//               sub, status: 'ok'|'idle'|'bad',              //   note, text, server, database, queue, load-balancer…);
//               clock: { kind: 'clock'|'event', words },     //   Spanish names and synonyms are read too ('cola',
//               outside: true, kids: [ids],                  //   'redis'); unknown shapes are kept and drawn as a box
//               locked: true, fitW: true,                    // locked: cannot be moved, resized or deleted by accident
//               size: 'title'|'text'|'small',                // text level of classic pieces
//               frame: 'dashed'|'lane'|'fill'|'none',        // how a group looks ('none': an invisible logical group)
//               form: 'icon'|'card', labelAt: 'below'|'right', count: 2..99,   // how a symbol shows
//               to, tip: { dx, dy }, items: [{ shape, dash, text }], icon, dir: 'v' }],   // callout, legend, frames, lanes
//     edges: [{ id, from, to, text, verb, dash: 'solid'|'dashed'|'dashdot', route: 'curve'|'elbow'|'straight',
//               head: 'end'|'both'|'none', locked: true,
//               flow: true|'slow'|'fast'|{ speed, dir: 'back'|'both', rate: events per minute },   // data travelling
//               fromSide, toSide: 't'|'r'|'b'|'l', fromAt, toAt: 0..1,   // the port he chose: the side, and its order on it
//               bus: false }],
//     frontier: { y, label, out },
//     readings: ['Datos', 'Autoridad'], notes: { Datos: { nodeId: 'texto', 'edge:e1': { text, tone: 'ok'|'warn'|'bad' } } },
//     tour: ['wa', 'puente', { show: ['libro', 'inter'], say: 'Se guarda y se avisa', reading: 'Actividad' }] }
//       (the order «Presentar» walks; without it the chain is walked from its sources, a fork shown as one step)
// Motion (diagram-motion.js) is visual only and the viewer's choice: flowing arrows carry packets (an idle source holds
// them still, a failing one in its fault colour), a fault pulses, new things grow in; paused with M or the zoom-corner
// button, still under prefers-reduced-motion. Thumbnails never move.
// Coordinates are diagram units. Nodes without x/y are laid out automatically and keep that place from then on.
// Unknown extra fields are kept as they are. The old edge boolean `dashed` is still read. Routes, ports and label
// spots are computed (diagram-layout.js), never saved: arrows avoid pieces and labels never sit on anything.
//
// createDiagram(container, { data, onChange, title, panOnDrag }) → { destroy, getData, setData, fit }
// diagramThumbSVG(data, w, h) → SVG markup of the whole diagram fitted into w×h, no UI.
// diagramSymbols() → [{ id, name, cat, catName, keywords }]: every symbol an agent can name.

import { EASE, DUR, EASES, reducedMotion, phaseDelay, flowOf as flowSpec, flowValue, packetPath, packetColour, polyLength, PERIOD, tourSteps, tactile } from './diagram-motion.js';
import { ARRANGE, arrangeMut, arrangeFits, suggestArrange } from './diagram-arrange.js';
export { diagramSymbols } from './diagram-symbols.js';
import { SYMS, CATS, isCatalogueSymbol, tintOf, nameOf, resolveShape, searchSymbols, catalogue, drawSymbol, shellSVG, glyphSVG, frameGlyph, countOf, reachKind, norm } from './diagram-symbols.js';
import { SpatialHash, orthoRoute, nudge, placeLabels, pushApart, findFree, snapLines, snapTo, inflate, overlaps, union, polyHitsRect, segHitsRect, simplify } from './diagram-layout.js';

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = ['#f7e4ec', '#e3edf9', '#e5f3e4', '#f9eedb', '#ece3f7', '#dff2f0', '#ffffff', '#f6f2f7'];
const COLOR_NAMES = ['Rosa', 'Azul', 'Verde', 'Arena', 'Lila', 'Agua', 'Blanco', 'Niebla'];
// The pieces this file draws itself: classic boxes (any of the 8 colours, words inside), the legacy symbols (one tint
// each), frames and annotation pieces. Everything else comes from the catalogue (diagram-symbols.js): shell + glyph.
const CLASSIC = ['box', 'ellipse', 'diamond', 'note', 'text', 'callout', 'step', 'start-end', 'io', 'subprocess', 'delay', 'prep', 'manual', 'connector'];
const CLASSIC_SET = new Set(CLASSIC);
const LEGACY = ['operation', 'agent', 'capability', 'store', 'book', 'resource', 'clock', 'event', 'permission', 'incident', 'user', 'external'];
const FRAME_SET = new Set(Object.values(SYMS).filter((s) => s.kind === 'frame').map((s) => s.id));
const KNOWN = new Set([...CLASSIC, ...LEGACY, ...Object.keys(SYMS)]);
// symbols whose words sit under them: the legacy ones but the operation, and every catalogue symbol
const ICONS = new Set([...LEGACY.filter((s) => s !== 'operation'), ...Object.keys(SYMS).filter(isCatalogueSymbol)]);
const NAMES = new Proxy({ frontier: 'Frontera', agent: 'Agente' }, { get: (t, k) => t[k] ?? nameOf(k) ?? 'Caja' });
const SIZE = new Proxy({
  box: [160, 70], ellipse: [160, 84], diamond: [180, 110], note: [150, 120], text: [160, 36], operation: [210, 78], agent: [64, 64], capability: [76, 76],
  store: [86, 68], book: [64, 78], resource: [72, 78], clock: [62, 62], event: [66, 66], permission: [56, 64], incident: [72, 64],
  user: [68, 68], external: [62, 62], group: [400, 280],
  ...Object.fromEntries(Object.values(SYMS).filter((s) => s.size).map((s) => [s.id, s.size])),
}, { get: (t, k) => t[k] ?? (FRAME_SET.has(k) ? [400, 280] : [160, 70]) });
const TINT_OF = new Proxy({ operation: 'slate', capability: 'lilac', resource: 'lilac', store: 'sand', book: 'sand', clock: 'clock', event: 'teal', permission: 'green', incident: 'rose', user: 'grey', external: 'grey', agent: 'lilac' },
  { get: (t, k) => t[k] ?? tintOf(k) ?? 'grey' });
const isClassic = (s) => CLASSIC_SET.has(s) || !KNOWN.has(s) || s === 'title';   // unknown shapes are drawn as a box with their text
const drawAs = (s) => SYMS[s]?.drawAs || s;
const iconic = (n) => ICONS.has(n.shape) && n.form !== 'card';
const isCard = (n) => ICONS.has(n.shape) && n.form === 'card' && isCatalogueSymbol(drawAs(n.shape));
const DASHES = ['solid', 'dashed', 'dashdot'];
const DASH_ARRAY = { solid: '', dashed: '7 5', dashdot: '11 4 2 4' };
const ROUTES = ['curve', 'elbow', 'straight'];
const HEADS = ['end', 'both', 'none'];
const FRAMES = ['dashed', 'lane', 'fill', 'none'];
const STATUS = ['ok', 'idle', 'bad'];
const TEXT_SIZES = { title: [20, 26, 600], text: [14, 19, 0], small: [12, 16, 0] };
const FLOW_SPEED = { slow: 30, normal: 60, fast: 120 };   // diagram units per second
const GRID = 12;

// Each theme: the canvas, the lines, and one tint per kind (s = outline, f = fill, g = glyph, ink = its words).
const THEME = {
  light: {
    bg: '#fdfbfe', ink: '#3a2f3f', muted: '#8b8492', flow: '#7fa18b', alt: '#a593c9', accent: '#714b67', frame: '#aab2ba', frameInk: '#8d969e',
    ok: '#6fa57f', idle: '#bdb6c1', bad: '#d9776f', warn: '#c99a45',
    tint: {
      orange: { s: '#d39a78', f: '#fbebe1', g: '#d08a62', ink: '#a8694a' },
      slate: { s: '#8197ac', f: '#eef2f6', g: '#7a90a6', ink: '#3d4f60', sub: '#7d8b98' },
      lilac: { s: '#a593c9', f: '#f1edf8', g: '#b9a6dd', gs: '#9f8bcf', ink: '#6f5c96' },
      sand: { s: '#c4a66c', f: '#f8f0de', g: '#b8975a', ink: '#8a6d2f' },
      clock: { s: '#8ea3b6', f: '#f0f4f7', g: '#7f95aa', ink: '#5d7183' },
      green: { s: '#8db699', f: '#e9f3eb', g: '#7fac8c', ink: '#4f7d5d' },
      amber: { s: '#d2ad64', f: '#fbf2de', g: '#b98d3c', ink: '#9a7330' },
      grey: { s: '#a3acb5', f: '#f2f4f6', g: '#8f99a3', ink: '#6b747c' },
      teal: { s: '#7fb5ad', f: '#e4f3f0', g: '#5f9f95', ink: '#3f7770' },
      sky: { s: '#86a9d2', f: '#e9f0fa', g: '#6f97c6', ink: '#456a93' },
      rose: { s: '#cf93a8', f: '#faeaf0', g: '#c07c95', ink: '#995a72' },
    },
  },
  dark: {
    bg: '#1b1f24', ink: '#e2e6eb', muted: '#8d98a3', flow: '#8fbf9f', alt: '#b7a5d6', accent: '#c9a3c0', frame: '#76828c', frameInk: '#8f9ba5',
    ok: '#8fbf9f', idle: '#76828c', bad: '#e08a80', warn: '#d4b77a',
    tint: {
      orange: { s: '#d4916b', f: '#3a2a22', g: '#e2a684', ink: '#e2a684' },
      slate: { s: '#9fb3c8', f: '#27313b', g: '#9fb3c8', gs: '#b4c5d6', ink: '#e3e9ef', sub: '#8d9aa7' },
      lilac: { s: '#b7a5d6', f: '#2f2a3b', g: '#c9b8e6', ink: '#c9b8e6' },
      sand: { s: '#c9b07a', f: '#3a3427', g: '#c9b07a', gs: '#d6bf8c', ink: '#d6bf8c' },
      clock: { s: '#9fb3c8', f: '#232a31', g: '#b9c7d4', ink: '#b9c7d4' },
      green: { s: '#9cc4a4', f: '#263329', g: '#a9d1b1', ink: '#a9d1b1' },
      amber: { s: '#d4b77a', f: '#3a3327', g: '#dcc189', ink: '#dcc189' },
      grey: { s: '#a7b1bb', f: '#262b31', g: '#b9c2ca', ink: '#b9c2ca' },
      teal: { s: '#8cc4bb', f: '#22332f', g: '#a3d3cb', ink: '#a3d3cb' },
      sky: { s: '#8fb3d9', f: '#232f3c', g: '#a9c7e6', ink: '#a9c7e6' },
      rose: { s: '#d29bb0', f: '#37262e', g: '#e3b3c5', ink: '#e3b3c5' },
    },
  },
};
const themeOf = (d) => THEME[d?.theme === 'dark' ? 'dark' : 'light'];

const FONT = '"Segoe UI", sans-serif';
const FS = 14, LH = 19;          // words inside a box
const LBF = 14, LBL = 18;        // words under a symbol
const EFS = 10.5, ELH = 13;      // arrow labels (small capitals)
const AH = 10;                   // arrowhead length

// Line icons for the controls (24-unit grid, strokes only, like Meadow's icons).
const LINE_ICON = {
  solid: '<path d="M4 12h16"/>',
  dashed: '<path d="M4 12h3M10.5 12h3M17 12h3"/>',
  dashdot: '<path d="M3 12h6M12 12h.5M15.5 12h5.5"/>',
  curve: '<path d="M4 18c7 0 9-12 16-12"/>',
  elbow: '<path d="M4 18h8V6h8"/>',
  straight: '<path d="M4 18 20 6"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  gallery: '<rect x="4" y="4" width="6.8" height="6.8" rx="1.6"/><rect x="13.2" y="4" width="6.8" height="6.8" rx="1.6"/><rect x="4" y="13.2" width="6.8" height="6.8" rx="1.6"/><rect x="13.2" y="13.2" width="6.8" height="6.8" rx="1.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  swap: '<path d="M4 8h13M14 4.5 17.5 8 14 11.5M20 16H7M10 12.5 6.5 16l3.5 3.5"/>',
  lbelow: '<rect x="8" y="3.5" width="8" height="8" rx="2"/><path d="M6 15.5h12M8.5 19.5h7"/>',
  lright: '<rect x="3.5" y="8" width="8" height="8" rx="2"/><path d="M14.5 10.5h6M14.5 14h4"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="3"/><rect x="6" y="9.5" width="5" height="5" rx="1"/><path d="M13.5 10.5h4.5M13.5 13.5h3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  chev: '<path d="m14 6-6 6 6 6"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  brush: '<path d="M14.5 4.5 19.5 9.5l-6 6-5-5z"/><path d="M8.5 10.5 5 14c-1.2 1.2-1 3.5-2 5.5 2-1 4.3-.8 5.5-2l3.5-3.5"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  left: '<path d="M5 4v16M8 8h10M8 16h6"/>',
  right: '<path d="M19 4v16M6 8h10M10 16h6"/>',
  top: '<path d="M4 5h16M8 8v10M16 8v6"/>',
  bottom: '<path d="M4 19h16M8 6v10M16 10v6"/>',
  cx: '<path d="M12 3v18M6 8h12M8.5 16h7"/>',
  cy: '<path d="M3 12h18M8 6v12M16 8.5v7"/>',
  disth: '<path d="M4 4v16M20 4v16"/><rect x="9.5" y="8" width="5" height="8" rx="1"/>',
  distv: '<path d="M4 4h16M4 20h16"/><rect x="8" y="9.5" width="8" height="5" rx="1"/>',
  same: '<rect x="3.5" y="7" width="7" height="10" rx="1.5"/><rect x="13.5" y="7" width="7" height="10" rx="1.5"/>',
  samew: '<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
  sameh: '<path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3"/>',
  group: '<rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke-dasharray="3 2.5"/><rect x="7" y="9" width="4.5" height="4.5" rx="1"/><rect x="12.5" y="11" width="4.5" height="4.5" rx="1"/>',
  ungroup: '<rect x="4" y="5" width="6" height="6" rx="1.2"/><rect x="14" y="13" width="6" height="6" rx="1.2"/><path d="M13 5h3a3 3 0 0 1 3 3v1M11 19H8a3 3 0 0 1-3-3v-1" stroke-dasharray="2 2"/>',
  fitg: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/><path d="M8 12h8M12 8v8"/>',
  frame: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 9.5h16"/>',
  label: '<path d="M5 7h14M12 7v11M9 18h6"/>',
  flow: '<path d="M3 12h13"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/><circle cx="14" cy="12" r="1.3"/><path d="m16 8 4 4-4 4"/>',
  'sp-slow': '<path d="m10 7 5 5-5 5"/>',
  'sp-normal': '<path d="m7 7 5 5-5 5M13 7l5 5-5 5"/>',
  'sp-fast': '<path d="m4.5 7 5 5-5 5M10 7l5 5-5 5M15.5 7l5 5-5 5"/>',
  'dir-fwd': '<path d="M4 12h15M15 8l4 4-4 4"/><circle cx="8" cy="12" r="1.2"/>',
  'dir-back': '<path d="M20 12H5M9 8l-4 4 4 4"/><circle cx="16" cy="12" r="1.2"/>',
  'dir-both': '<path d="M4 9h15M15 5.5 18.5 9 15 12.5M20 15H5M9 11.5 5.5 15 9 18.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  present: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M10.5 8v5l4-2.5zM12 16.5v3M8.5 19.5h7"/>',
  prev: '<path d="m14.5 6-6 6 6 6"/>',
  next: '<path d="m9.5 6 6 6-6 6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  arrange: '<rect x="3.5" y="9.5" width="5" height="5" rx="1.2"/><rect x="15.5" y="4" width="5" height="5" rx="1.2"/><rect x="15.5" y="15" width="5" height="5" rx="1.2"/><path d="M8.5 12h3.5M12 6.5V17.5M12 6.5h3.5M12 17.5h3.5"/>',
  home: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"/>',
  hend: '<path d="M4 12h15M15 8l4 4-4 4"/>',
  hboth: '<path d="M5 12h14M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  hnone: '<path d="M4 12h16"/>',
  status: '<circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>',
  trigger: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  tsize: '<path d="M4 7V5h10v2M9 5v14M7 19h4M14 12v-1.5h6V12M17 10.5V19M15.8 19h2.4"/>',
  tidy: '<path d="M5 6h14M5 12h9M5 18h12"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><circle cx="12" cy="17" r=".6"/>',
  front: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V7a2 2 0 0 1 2-2h8"/>',
  back: '<rect x="5" y="5" width="11" height="11" rx="2"/><path d="M19 9v8a2 2 0 0 1-2 2H9"/>',
  fwd: '<path d="M12 19V6M7 11l5-5 5 5"/>',
  bwd: '<path d="M12 5v13M7 13l5 5 5-5"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5H6a2 2 0 0 0-2 2v9"/>',
  cut: '<circle cx="7" cy="17" r="2.6"/><circle cx="17" cy="17" r="2.6"/><path d="M8.8 15 16 4M15.2 15 8 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5H6a2 2 0 0 0-2 2v9"/>',
  paste: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9.5 5V3.5h5V5M9 11h6M9 15h4"/>',
  same2: '<rect x="4" y="6" width="7" height="7" rx="1.5"/><rect x="13" y="11" width="7" height="7" rx="1.5"/><path d="M7.5 16.5h2M16.5 7.5v2"/>',
  reverse: '<path d="M4 9h15M15 5l4 4-4 4M20 15H5M9 19l-4-4 4-4"/>',
  all: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  none: '<circle cx="12" cy="12" r="7"/><path d="M7 17 17 7"/>',
  fail: '<circle cx="6" cy="12" r="2.5"/><path d="M8.5 12h4"/><circle cx="18" cy="6.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="m14 9.5 2-1.5M14 14.5l2 1.5"/>',
  origin: '<circle cx="18" cy="12" r="2.5"/><path d="M11 12h4.5"/><circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.5 7.5 11 12l-2.5 4.5"/>',
};
const lineIcon = (k) => `<svg viewBox="0 0 24 24">${LINE_ICON[k] || ''}</svg>`;

// ---------- small helpers ----------

const f = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const upper = (s) => String(s).toLocaleUpperCase('es');
const clone = (x) => JSON.parse(JSON.stringify(x));
const snapG = (v, g = GRID) => Math.round(v / g) * g;

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
const measureCache = new Map();
function measure(s, fs, bold = false) {
  if (ctx === undefined) { try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; } }
  if (!ctx) return s.length * fs * (bold ? 0.56 : 0.52);
  const key = fs + (bold ? 'b|' : '|') + s;
  let w = measureCache.get(key);
  if (w !== undefined) return w;
  const font = `${bold ? '600 ' : ''}${fs}px ${FONT}`;
  if (ctxFont !== font) { ctx.font = font; ctxFont = font; }
  w = ctx.measureText(s).width;
  if (measureCache.size > 20000) measureCache.clear();
  measureCache.set(key, w);
  return w;
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

// The text level of a classic piece: [font size, line height, weight].
const SMALL_DISC = { step: [13, 16, 600], connector: [12, 15, 600] };
const fsOf = (n) => SMALL_DISC[n.shape] || (isClassic(n.shape) && TEXT_SIZES[n.size]) || TEXT_SIZES.text;

// The words of an operation: a title and a subtitle (its `sub`, or else the lines after the first).
function opWords(n) {
  const tw = n.w - 30, [first, ...rest] = String(n.text).split('\n');
  const title = n.sub !== undefined ? n.text : first, sub = n.sub !== undefined ? String(n.sub) : rest.join('\n');
  return { title: title ? wrap(title, tw, 15, true) : [], sub: sub ? wrap(sub, tw, 13) : [] };
}
// The words of a symbol drawn as a card: a title and a subtitle inside, left of the glyph.
const CARD_X = 46;
function cardWords(n) {
  const tw = Math.max(30, n.w - CARD_X - 12);
  return { title: n.text ? wrap(n.text, tw, 15, true) : [], sub: n.sub ? wrap(String(n.sub), tw, 13) : [] };
}
// Words under a symbol (or on its right, with labelAt 'right'): its text, then its `sub` in a quieter line.
const rightLabel = (n) => n.labelAt === 'right' && iconic(n);
const labelW = (n) => (rightLabel(n) ? 160 : Math.max(n.w + 60, 140));
function iconWords(n) {
  return { lines: n.text ? wrap(n.text, labelW(n), LBF) : [], sub: n.sub ? wrap(String(n.sub), labelW(n), 12) : [] };
}
const wordsBlockH = (n) => { const { lines, sub } = iconWords(n); return lines.length * LBL + sub.length * 16; };
// Words under a short symbol start a little lower, at the same distance from its centre as under a standard 72-unit one,
// so symbols lined up by their centres (a queue beside a hexagon) have their words on one line.
const CAP_HALF = 36;
const capDrop = (n) => (iconic(n) && !rightLabel(n) ? Math.max(0, Math.round(CAP_HALF - n.h / 2)) : 0);
// How far the words hang under the symbol (none when they sit on its right).
function labelH(n) {
  if (rightLabel(n)) return 0;
  const b = wordsBlockH(n);
  return b ? b + 8 + capDrop(n) : 0;
}

// The room a shape leaves for its text, and the height its text needs.
const SKEW = { io: (n) => Math.min(n.w * 0.2, n.h * 0.45), prep: (n) => Math.min(n.w * 0.18, n.h / 2), manual: (n) => Math.min(n.w * 0.14, n.h * 0.4) };
function textRoom(n) {
  switch (n.shape) {
    case 'ellipse': return n.w * 0.74 - 10;
    case 'diamond': return n.w * 0.55 - 6;
    case 'note': return n.w - 26;
    case 'operation': return n.w - 30;
    case 'text': return n.w - 8;
    case 'io': return n.w - SKEW.io(n) - 20;
    case 'prep': return n.w - 2 * SKEW.prep(n) - 8;
    case 'manual': return n.w - 2 * SKEW.manual(n) - 12;
    case 'delay': return n.w - n.h / 2 - 18;
    case 'subprocess': return n.w - 40;
    case 'start-end': return n.w - n.h * 0.5 - 12;
    case 'step': case 'connector': return n.w - 2;
    default: return n.w - 24;
  }
}
const textW = (n) => Math.max(20, textRoom(n));
const classicLines = (n) => { const [fs, , wt] = fsOf(n); return wrap(n.text, textW(n), fs, !!wt); };
function minH(n) {
  if (iconic(n) || isFrame(n) || n.shape === 'legend' || SMALL_DISC[n.shape]) return 0;
  if (n.shape === 'operation') { const { title, sub } = opWords(n); return Math.ceil(title.length * 20 + sub.length * 17 + (sub.length ? 4 : 0) + 30); }
  if (isCard(n)) { const { title, sub } = cardWords(n); return Math.max(48, Math.ceil(title.length * 20 + sub.length * 17 + (sub.length && title.length ? 2 : 0) + 24)); }
  const t = classicLines(n).length * fsOf(n)[1];
  return Math.ceil(n.shape === 'ellipse' ? (t + 10) / 0.74 : n.shape === 'diamond' ? (t + 6) / 0.55 : n.shape === 'text' ? Math.max(28, t + 8) : t + (n.shape === 'note' ? 28 : 22));
}
// How wide a piece that fits its words would like to be (auto-width), in 24-unit steps, never below its default.
function fitWidth(n) {
  const [fs, , wt] = fsOf(n), dw = SIZE[n.shape]?.[0] ?? 160;
  const longest = Math.max(0, ...String(n.text).split('\n').map((l) => measure(l, fs, !!wt)));
  let need = longest + (n.w - textRoom(n)) + 4;
  if (n.shape === 'ellipse') need = (longest + 10) / 0.74 + 4;
  if (n.shape === 'diamond') need = (longest + 6) / 0.55 + 4;
  const max = n.shape === 'diamond' ? 360 : n.shape === 'ellipse' ? 320 : n.shape === 'text' ? (n.size === 'title' ? 600 : 420) : 280;
  return clamp(Math.ceil(need / 24) * 24, dw, Math.max(dw, max));
}

// ---------- data ----------

const NODE_KEYS = ['id', 'x', 'y', 'w', 'h', 'text', 'shape', 'color'];
const EDGE_KEYS = ['id', 'from', 'to', 'text', 'dash', 'dashed', 'route'];
const extras = (r, keys) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));
const isFrame = (n) => FRAME_SET.has(n?.shape);
const isLegend = (n) => n?.shape === 'legend';
const symbolic = (n) => !isClassic(n.shape);
const defaultRoute = (a, b) => (symbolic(a) || symbolic(b) ? 'elbow' : 'curve');
const SIDES = ['t', 'r', 'b', 'l'];

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
    // the shape: a catalogue id is kept; a Spanish name or a synonym becomes its id (saved back); anything else is kept
    // as written and drawn as a box with its text
    let shape = typeof r.shape === 'string' && r.shape ? r.shape : 'box', preset = null;
    const known = resolveShape(shape);
    if (known && known !== shape) { shape = known; fixed = true; }
    if (SYMS[shape]?.kind === 'preset') { preset = SYMS[shape].as; shape = preset.shape; fixed = true; }
    if (shape === 'frontier') shape = 'box';
    const [dw, dh] = r.form === 'card' && ICONS.has(shape) ? [200, 72] : SIZE[shape];
    const w = num(r.w), h = num(r.h);
    const n = {
      id: uid(r.id, 'n'), x: num(r.x), y: num(r.y), w: w >= 20 ? w : dw, h: h >= 20 ? h : dh,
      text: r.text === null || r.text === undefined ? '' : String(r.text), shape,
      color: isHex(r.color) ? r.color.toLowerCase() : PALETTE[0], ...extras(r, NODE_KEYS),
    };
    if (preset) for (const [k, v] of Object.entries(preset)) if (k !== 'shape' && n[k] === undefined) n[k] = v;
    // words an agent wrote get the room they need: a step with a word becomes a pill, a text or a fitW piece its width
    if (!(w >= 20) && SMALL_DISC[n.shape] && n.text.length > 2) n.w = Math.max(n.h, Math.ceil(measure(n.text, SMALL_DISC[n.shape][0], true) + 24));
    else if (isClassic(n.shape) && !SMALL_DISC[n.shape] && (n.fitW === true || (!(w >= 20) && n.shape === 'text'))) n.w = fitWidth(n);
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
      route: ROUTES.includes(r.route) ? r.route : defaultRoute(a, b), ...extras(r, EDGE_KEYS),
    });
  }
  fitLegends(d);
  // a callout that names its piece waits for that piece's place, then sits just above it
  const pinned = todo.filter((n) => n.shape === 'callout' && n.to !== undefined && byId.has(String(n.to)) && byId.get(String(n.to)) !== n);
  const rest = todo.filter((n) => !pinned.includes(n));
  if (rest.length || (d.frontier && num(d.frontier.y) === null)) { layout(d, rest); fixed = true; }
  if (pinned.length) {
    const h = new SpatialHash();
    for (const m of d.nodes) if (!isFrame(m) && !pinned.includes(m) && m.x !== null) h.insert(m.id, blockRect(m));
    for (const n of pinned) {
      const t = byId.get(String(n.to));
      if (t.x === null) { n.x = 0; n.y = 0; continue; }
      const want = { x: Math.round(t.x + t.w / 2 + 24), y: Math.round(ext(t).y - n.h - 48), w: n.w, h: n.h };
      const to = findFree(want, h, { C: 16, step: 12, rings: 30 });
      n.x = to.x; n.y = to.y;
      h.insert(n.id, blockRect(n));
    }
    fixed = true;
  }
  return { d, fixed };
}

// A legend takes the size its rows need (they follow what the diagram uses). Returns whether any changed.
function fitLegends(d) {
  let changed = false;
  for (const n of d.nodes) {
    if (!isLegend(n)) continue;
    const [w, h] = legendSize(n, { nodes: d.nodes, edges: d.edges });
    if (n.w !== w || n.h !== h) { n.w = w; n.h = h; changed = true; }
  }
  return changed;
}

// Where a node really reaches: a symbol's words hang under it.
function ext(n) {
  if (!iconic(n)) return { x: n.x, y: n.y, w: n.w, h: n.h };
  const { lines, sub } = iconWords(n), c = countOf(n) ? 10 : 0;
  const tw = Math.max(0, ...lines.map((l) => measure(l, LBF) + 4), ...sub.map((l) => measure(l, 12) + 4));
  if (rightLabel(n)) {
    const bh = wordsBlockH(n), y0 = Math.min(n.y - c, n.y + n.h / 2 - bh / 2), y1 = Math.max(n.y + n.h, n.y + n.h / 2 + bh / 2);
    return { x: n.x, y: y0, w: n.w + Math.max(c, tw ? 10 + tw : 0), h: y1 - y0 };
  }
  const lw = Math.max(n.w + c, tw);
  return { x: n.x + n.w / 2 - lw / 2 + (lw === n.w + c ? c / 2 : 0), y: n.y - c, w: lw, h: n.h + labelH(n) + c };
}
// What a node blocks for lines: its words, its trigger on the left and its status dot.
function blockRect(n) {
  const e = ext(n);
  let x0 = e.x, y0 = e.y, x1 = e.x + e.w, y1 = e.y + e.h;
  if (n.clock && typeof n.clock === 'object') { x0 = Math.min(x0, n.x - 46); y1 = Math.max(y1, n.y + Math.min(n.h / 2, 24) + (n.clock.words ? 30 : 14)); }
  if (STATUS.includes(n.status)) { x1 = Math.max(x1, n.x + n.w + 3); y0 = Math.min(y0, n.y - 3); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const box = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h });
const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// Places nodes that came without coordinates (an agent may write only ids, texts and kids). A compound layout: each
// frame lays out its own members first (pieces and nested frames, innermost first) and then counts as one block in
// its parent. Inside every container pieces go in columns by arrow depth, left to right (the arrows that close a loop
// are ignored, so a cycle does not push ranks around); a very long column wraps; pieces with no arrows sit in a tidy
// grid below; a title goes on top. The new block then goes next to the placed nodes it talks to, or below them, where
// it touches nothing. Outside things go beyond the frontier, each above the inside piece it talks to.
const LAY = { col: 100, row: 56, maxCol: 6 };
function layout(d, todo) {
  const todoIds = new Set(todo.map((n) => n.id));
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const fr = d.frontier && typeof d.frontier === 'object' ? d.frontier : null;
  const out = (n) => !!(fr && n.outside && !isFrame(n));
  // who holds whom: a node belongs to the deepest frame that lists it in `kids` (never in a loop)
  const frames = d.nodes.filter(isFrame);
  const listers = new Map();
  for (const g of frames) for (const k of Array.isArray(g.kids) ? g.kids : []) {
    const n = byId.get(String(k));
    if (!n || n === g || !todoIds.has(n.id) || out(n)) continue;
    if (!listers.has(n.id)) listers.set(n.id, []);
    listers.get(n.id).push(g);
  }
  const parent = new Map();
  const chain = (g) => { const seen = []; for (let p = g; p && !seen.includes(p); p = parent.get(p.id)) seen.push(p); return seen; };
  for (let pass = 0; pass < 3; pass++) {                  // a few passes, so the order frames are written in does not matter
    for (const g of frames) {
      if (!todoIds.has(g.id)) continue;
      const ls = (listers.get(g.id) || []).filter((p) => !chain(p).includes(g));
      if (ls.length) parent.set(g.id, ls.sort((a, b) => chain(b).length - chain(a).length || a.w * a.h - b.w * b.h)[0]);
    }
  }
  for (const n of todo) if (!isFrame(n) && listers.has(n.id)) parent.set(n.id, listers.get(n.id).sort((a, b) => chain(b).length - chain(a).length)[0]);
  const kidsOf = new Map();
  for (const n of todo) {
    if (out(n)) continue;
    const p = parent.get(n.id) || null;
    if (!kidsOf.has(p)) kidsOf.set(p, []);
    kidsOf.get(p).push(n);
  }
  const desc = (g) => (kidsOf.get(g) || []).flatMap((m) => [m, ...(isFrame(m) ? desc(m) : [])]);
  const shift = (m, dx, dy) => { for (const n of [m, ...(isFrame(m) ? desc(m) : [])]) { n.x += dx; n.y += dy; } };
  const rectOf = (m) => (isFrame(m) ? box(m) : blockRect(m));
  const repIn = (C, id) => {                              // the member of C that holds `id` (itself, or a frame around it)
    let n = byId.get(id);
    for (let i = 0; n && i < 40; i++) {
      if (!todoIds.has(n.id) || out(n)) return null;
      const p = parent.get(n.id) || null;
      if (p === C) return n;
      n = p;
    }
    return null;
  };

  function arrange(C) {                                   // lays out C's members with their top-left at 0,0; returns the size
    const mem = kidsOf.get(C) || [];
    if (!mem.length) return null;
    for (const g of mem.filter(isFrame)) {
      g.x = 0; g.y = 0;
      const inner = arrange(g);
      const tw = Math.ceil(measure(String(g.text || ''), 13, true)) + 60;
      if (inner) {
        for (const m of kidsOf.get(g)) shift(m, PAD_WRAP.l, PAD_WRAP.t);
        g.w = Math.max(tw, Math.round(inner.w + PAD_WRAP.l + PAD_WRAP.r)); g.h = Math.round(inner.h + PAD_WRAP.t + PAD_WRAP.b);
      } else g.w = Math.max(g.w, tw);
    }
    for (const n of mem) if (!isFrame(n)) { n.x = 0; n.y = 0; }
    // arrows between members (an arrow into a nested frame counts for that frame)
    const ids = new Set(mem.map((m) => m.id)), adj = new Map(mem.map((m) => [m.id, []])), pairs = [];
    for (const e of d.edges) {
      const a = repIn(C, e.from), b = repIn(C, e.to);
      if (!a || !b || a === b || !ids.has(a.id) || !ids.has(b.id)) continue;
      adj.get(a.id).push(b.id); pairs.push([a.id, b.id]);
    }
    const deg = new Map(mem.map((m) => [m.id, 0]));
    for (const [a, b] of pairs) { deg.set(a, deg.get(a) + 1); deg.set(b, deg.get(b) + 1); }
    const flowM = mem.filter((m) => deg.get(m.id) > 0);
    const loose = mem.filter((m) => !deg.get(m.id));
    const titles = loose.filter((m) => m.shape === 'text' && m.size === 'title');
    const grid = loose.filter((m) => !titles.includes(m));
    // ranks: a depth-first walk drops the arrows that close a loop, then the longest path; a source sits just before
    // the first piece it feeds
    const state = new Map(), keep = [];
    const indeg = new Map(flowM.map((m) => [m.id, 0]));
    for (const [, b] of pairs) indeg.set(b, indeg.get(b) + 1);
    const visit = (u) => { state.set(u, 1); for (const v of adj.get(u)) { if (state.get(v) === 1) continue; keep.push([u, v]); if (!state.get(v)) visit(v); } state.set(u, 2); };
    for (const m of flowM) if (!indeg.get(m.id) && !state.get(m.id)) visit(m.id);
    for (const m of flowM) if (!state.get(m.id)) visit(m.id);
    const rank = new Map(flowM.map((m) => [m.id, 0]));
    for (let pass = 0, moved = true; moved && pass <= flowM.length; pass++) {
      moved = false;
      for (const [a, b] of keep) if (rank.get(a) + 1 > rank.get(b)) { rank.set(b, rank.get(a) + 1); moved = true; }
    }
    const inK = new Map(), outK = new Map();
    for (const [a, b] of keep) {
      if (!inK.has(b)) inK.set(b, []); inK.get(b).push(a);
      if (!outK.has(a)) outK.set(a, []); outK.get(a).push(b);
    }
    for (const m of flowM) if (!inK.get(m.id) && outK.get(m.id)) rank.set(m.id, Math.max(rank.get(m.id), Math.min(...outK.get(m.id).map((b) => rank.get(b))) - 1));
    let cols = [];
    for (const m of flowM) (cols[rank.get(m.id)] ||= []).push(m);
    cols = cols.filter(Boolean);
    // order inside a column: by where what feeds it sits, then by where what it feeds sits
    const pos = new Map();
    const index = () => { for (const c of cols) c.forEach((m, i) => pos.set(m.id, i - (c.length - 1) / 2)); };
    index();
    const bary = (m, nb) => { const ps = (nb.get(m.id) || []).filter((x) => pos.has(x)); return ps.length ? ps.reduce((s, x) => s + pos.get(x), 0) / ps.length : null; };
    for (const [list, nb] of [[cols, inK], [[...cols].reverse(), outK], [cols, inK]]) {
      for (const c of list) {
        const key = new Map(c.map((m, i) => [m.id, bary(m, nb) ?? pos.get(m.id) ?? i]));
        c.sort((a, b) => key.get(a.id) - key.get(b.id));
        index();
      }
    }
    // a piece's words hang under it, so a column stacks what each really covers; a lone piece is centred on its shape,
    // so a chain lines up shape to shape and its arrows run straight. A very long column wraps into a few columns side
    // by side whose rows line up, so the arrows fanning into it run between the rows.
    const R = (m) => { const r = rectOf(m); return { ox: r.x - m.x, oy: r.y - m.y, w: r.w, h: r.h, cy: m.y + m.h / 2 - r.y }; };
    const blocks = cols.map((c) => {
      const k = c.length > LAY.maxCol ? Math.ceil(c.length / LAY.maxCol) : 1, cw = Math.max(...c.map((m) => R(m).w));
      const rows = [];
      for (let i = 0; i < c.length; i += k) rows.push(c.slice(i, i + k));
      const rh = rows.map((r) => Math.max(...r.map((m) => R(m).h)));
      return { c, k, cw, rows, rh, w: k * cw + (k - 1) * 60, h: rh.reduce((s, v) => s + v, 0) + (rows.length - 1) * LAY.row };
    });
    const mid = Math.max(0, ...blocks.map((b) => (b.c.length === 1 ? R(b.c[0]).cy : b.h / 2)));
    let x = 0;
    for (const b of blocks) {
      let y = b.c.length === 1 ? mid - R(b.c[0]).cy : mid - b.h / 2;
      b.rows.forEach((row, i) => {
        row.forEach((m, j) => { const r = R(m); shift(m, Math.round(x + j * (b.cw + 60) + (b.cw - r.w) / 2 - r.ox) - m.x, Math.round(y - r.oy) - m.y); });
        y += b.rh[i] + LAY.row;
      });
      x += b.w + LAY.col;
    }
    // pieces with no arrows: a grid under the flow, each row lined up on its shapes' centres
    let top = cols.length ? Math.max(...cols.flat().map((m) => rectOf(m).y + rectOf(m).h)) + 70 : 0;
    if (grid.length) {
      const nc = Math.max(1, Math.min(grid.length, Math.ceil(Math.sqrt(grid.length * 1.6)))), cw = Math.max(...grid.map((m) => R(m).w));
      for (let i = 0; i < grid.length; i += nc) {
        const row = grid.slice(i, i + nc), cy = Math.max(...row.map((m) => R(m).cy)), rh = Math.max(...row.map((m) => cy - R(m).cy + R(m).h));
        row.forEach((m, j) => { const r = R(m); shift(m, Math.round(j * (cw + 60) + (cw - r.w) / 2 - r.ox) - m.x, Math.round(top + cy - r.cy - r.oy) - m.y); });
        top += rh + 48;
      }
    }
    // a title goes above everything, on the left
    let ty = 0;
    for (const t of [...titles].reverse()) { const r = R(t); ty -= r.h + 28; shift(t, -r.ox - t.x, ty - r.oy - t.y); }
    const b = union(mem.map(rectOf));
    for (const m of mem) shift(m, -b.x, -b.y);
    return { w: b.w, h: b.h };
  }

  // new pieces listed by a frame that already has its place go inside it, and it grows to hold them
  const inPlaced = [];
  for (const g of frames) {
    if (todoIds.has(g.id) || !(kidsOf.get(g) || []).length) continue;
    const s = arrange(g);
    if (!s) continue;
    for (const m of kidsOf.get(g)) shift(m, g.x + PAD_WRAP.l, g.y + PAD_WRAP.t);
    g.w = Math.max(g.w, Math.round(s.w + PAD_WRAP.l + PAD_WRAP.r)); g.h = Math.max(g.h, Math.round(s.h + PAD_WRAP.t + PAD_WRAP.b));
    inPlaced.push(...desc(g));
  }
  const roots = kidsOf.get(null) || [];
  const size = arrange(null);
  const placed = d.nodes.filter((n) => !todoIds.has(n.id) && !isFrame(n));
  if (size) {
    const near = [], mine = new Set(roots.flatMap((m) => [m, ...(isFrame(m) ? desc(m) : [])]).map((n) => n.id));
    const fixed = new Set([...placed, ...inPlaced].map((n) => n.id)), there = [...placed, ...inPlaced];
    for (const e of d.edges) {
      if (mine.has(e.from) && fixed.has(e.to)) near.push(byId.get(e.to));
      if (mine.has(e.to) && fixed.has(e.from)) near.push(byId.get(e.from));
    }
    let ox = 0, oy = 0;
    if (near.length) { ox = Math.max(...near.map((n) => ext(n).x + ext(n).w)) + 90; oy = Math.min(...near.map((n) => n.y)); }
    else if (there.length) { ox = Math.min(...there.map((n) => ext(n).x)); oy = Math.max(...there.map((n) => ext(n).y + ext(n).h)) + 90; }
    for (const m of roots) shift(m, ox, oy);
    // the new block goes, as one, to the nearest place where it touches nothing already placed
    if (placed.length || inPlaced.length) {
      const h = new SpatialHash();
      for (const n of [...placed, ...inPlaced]) h.insert(n.id, rectOf(n));
      for (const g of frames) if (!todoIds.has(g.id)) h.insert(g.id, box(g));
      const b = union(roots.map(rectOf));
      const to = findFree(b, h, { C: 20, step: 20, rings: 60 });
      for (const m of roots) shift(m, to.x - b.x, to.y - b.y);
    }
  }

  // the frontier: what is outside sits above its line, each above the inside piece it talks to, never on another
  if (fr) {
    const outside = todo.filter(out);
    const top = (ns) => (ns.length ? Math.min(...ns.map((n) => (isFrame(n) ? n.y : ext(n).y))) : Infinity);
    const insideAll = d.nodes.filter((n) => !n.outside && num(n.x) !== null && num(n.y) !== null);
    if (num(fr.y) === null) fr.y = Math.round((insideAll.length ? top(insideAll) : 0) - 44);
    const inner = todo.filter((n) => !n.outside), t = top(inner);
    if (t < fr.y + 40) for (const n of inner) n.y += Math.round(fr.y + 40 - t);
    const want = outside.map((n, i) => {
      const e = d.edges.find((x) => (x.from === n.id || x.to === n.id) && !byId.get(x.from === n.id ? x.to : x.from)?.outside);
      const m = e && byId.get(e.from === n.id ? e.to : e.from);
      return { n, i, cx: m && !isFrame(m) && num(m.x) !== null ? m.x + m.w / 2 : null };
    });
    const known = d.nodes.filter((n) => num(n.x) !== null && num(n.y) !== null && !todo.includes(n) || inner.includes(n));
    let free = (known.length ? Math.max(...known.map((n) => rectOf(n).x + rectOf(n).w)) : 0) + 80;
    for (const w of want) if (w.cx === null) { w.cx = free + w.n.w / 2; free += w.n.w + 80; }
    want.sort((a, b) => a.cx - b.cx || a.i - b.i);
    let right = -Infinity;
    for (const { n, cx } of want) {
      n.x = 0; n.y = 0;
      const e = ext(n), half = Math.max(e.w, n.w) / 2;
      const c = Math.max(cx, right + 40 + half);
      n.x = c - n.w / 2;
      n.y = fr.y - 50 - (e.y + e.h);
      right = c + half;
    }
  }
  for (const n of todo) { n.x = Math.round(n.x); n.y = Math.round(n.y); }
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
  const b = bounds(d.nodes, true) || { x: -200, w: 400 };   // frames count: a frontier spans what it separates
  return [b.x - 40, b.x + b.w + 40];
}
// Where the frontier's words start: at its left end, or just past the lines that cross it there (a line crossing the
// frontier runs roughly from the centre of the piece outside it).
function frontierLabelX(d) {
  const fr = d.frontier, [x0, x1] = frontierSpan(d);
  const words = Math.max(fr?.label ? measure(upper(fr.label), 12) * 1.12 : 0, fr?.out ? measure(upper(fr.out), 12) * 1.12 : 0) + 12;
  const byId = new Map(d.nodes.map((n) => [n.id, n])), above = (n) => n.y + n.h / 2 < fr.y, xs = [];
  for (const e of d.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || isFrame(a) || isFrame(b) || above(a) === above(b)) continue;
    for (const n of [a, b]) xs.push(n.x + n.w / 2);
  }
  xs.sort((u, v) => u - v);
  let x = x0 + 4;
  for (const c of xs) if (c > x - 10 && c < x + words + 10) x = c + 14;
  return x + words < x1 ? x : x0 + 4;
}

// ---------- groups: membership is what lies inside ----------

// The smallest frame that holds the centre of `n` (a frame holds another only if it is bigger).
function parentOf(n, nodes) {
  const c = centre(isFrame(n) ? box(n) : ext(n)), area = isFrame(n) ? n.w * n.h : 0;
  let best = null;
  for (const g of nodes) {
    if (!isFrame(g) || g === n || g.w * g.h <= area) continue;
    if (c.x >= g.x && c.x <= g.x + g.w && c.y >= g.y && c.y <= g.y + g.h && (!best || g.w * g.h < best.w * best.h)) best = g;
  }
  return best;
}
// Everything a frame carries when it moves: whatever has its centre inside it, nested frames included.
function contentsOf(g, nodes) {
  return nodes.filter((n) => n !== g && (() => { const c = centre(isFrame(n) ? box(n) : ext(n)); return c.x >= g.x && c.x <= g.x + g.w && c.y >= g.y && c.y <= g.y + g.h && (!isFrame(n) || n.w * n.h < g.w * g.h); })());
}
const PAD_WRAP = { l: 36, t: 56, r: 36, b: 36 }, PAD_GROW = { l: 24, t: 44, r: 24, b: 24 };
// A frame that holds something sticking out grows to wrap it (it never shrinks by itself). Bottom-up through nesting.
function growFrames(nodes, only = null) {
  const frames = nodes.filter(isFrame).sort((a, b) => a.w * a.h - b.w * b.h);
  let changed = false;
  for (const g of frames) {
    if (only && !only.has(g.id)) continue;
    const kids = nodes.filter((n) => n !== g && parentOf(n, nodes) === g);
    if (!kids.length) continue;
    const b = union(kids.map((n) => (isFrame(n) ? box(n) : blockRect(n))));
    const x0 = Math.min(g.x, Math.floor(b.x - PAD_GROW.l)), y0 = Math.min(g.y, Math.floor(b.y - PAD_GROW.t));
    const x1 = Math.max(g.x + g.w, Math.ceil(b.x + b.w + PAD_GROW.r)), y1 = Math.max(g.y + g.h, Math.ceil(b.y + b.h + PAD_GROW.b));
    if (x0 !== g.x || y0 !== g.y || x1 !== g.x + g.w || y1 !== g.y + g.h) { g.x = x0; g.y = y0; g.w = x1 - x0; g.h = y1 - y0; changed = true; }
  }
  return changed;
}
// A frame that grew (or was just drawn) pushes out of its way the pieces that are not its own.
function frameRoom(nodes, only = null) {
  for (const g of nodes.filter(isFrame).sort((a, b) => a.w * a.h - b.w * b.h)) {
    if (only && !only.has(g.id)) continue;
    const mine = new Set(contentsOf(g, nodes).map((n) => n.id));
    const others = nodes.filter((n) => !isFrame(n) && !mine.has(n.id) && overlaps(blockRect(n), g, 11.9)).map((n) => ({ id: n.id, r: blockRect(n) }));
    if (!others.length) continue;
    const disp = pushApart([{ id: g.id, r: box(g) }], others, { C: 12, fixed: new Set(nodes.filter((n) => n.locked === true).map((n) => n.id)), maxDepth: 1 });
    for (const [id, v] of disp) { const n = nodes.find((x) => x.id === id); n.x = Math.round(n.x + v.dx); n.y = Math.round(n.y + v.dy); }
  }
}
// «Ajustar al contenido»: the frame takes exactly its members plus the padding.
function fitFrame(g, nodes) {
  const kids = contentsOf(g, nodes).filter((n) => parentOf(n, nodes) === g);
  if (!kids.length) return;
  const b = union(kids.map((n) => (isFrame(n) ? box(n) : blockRect(n))));
  g.x = Math.round(b.x - PAD_WRAP.l); g.y = Math.round(b.y - PAD_WRAP.t); g.w = Math.round(b.w + PAD_WRAP.l + PAD_WRAP.r); g.h = Math.round(b.h + PAD_WRAP.t + PAD_WRAP.b);
}
// Keeps `kids` (a hint for agents and for layout) in step with what really lies inside.
function syncKids(nodes, ids) {
  for (const id of ids) {
    const n = nodes.find((x) => x.id === id);
    if (!n) continue;
    const p = parentOf(n, nodes);
    for (const g of nodes) {
      if (!isFrame(g) || g === n) continue;
      const has = Array.isArray(g.kids) && g.kids.includes(id);
      if (g === p && !has) g.kids = [...(Array.isArray(g.kids) ? g.kids : []), id];
      else if (g !== p && has) { g.kids = g.kids.filter((k) => k !== id); }
    }
  }
}

// ---------- shapes ----------

// Outline of a classic node in its own coordinates, with a slight hand-made wobble seeded by its id.
function outline(n, tip = null) {
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
  const poly = (pts) => ({ d: 'M' + pts.map((q) => P(q[0], q[1]).join(',')).join('L') + 'Z' });
  switch (n.shape) {
    case 'step': case 'connector': { const r = Math.min(w, h) / 2; if (w - h > 1) return { d: `M${f(r)},0L${f(w - r)},0A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}L${f(r)},${f(h)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z` }; return { d: `M${f(w / 2 - r)},${f(h / 2)}A${f(r)},${f(r)} 0 1 1 ${f(w / 2 + r)},${f(h / 2)}A${f(r)},${f(r)} 0 1 1 ${f(w / 2 - r)},${f(h / 2)}Z` }; }
    case 'start-end': { const r = Math.min(h / 2, w / 2), a = P(r, 0), b = P(w - r, 0), c = P(w - r, h), e = P(r, h); return { d: `M${a}L${b}A${f(r)},${f(h / 2)} 0 0 1 ${c}L${e}A${f(r)},${f(h / 2)} 0 0 1 ${a}Z` }; }
    case 'io': { const k = SKEW.io(n); return poly([[k, 0], [w, 0], [w - k, h], [0, h]]); }
    case 'prep': { const k = SKEW.prep(n); return poly([[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]]); }
    case 'manual': { const k = SKEW.manual(n); return poly([[0, 0], [w, 0], [w - k, h], [k, h]]); }
    case 'delay': { const r = Math.min(h / 2, w / 2), a = P(0, 0), b = P(w - r, 0), c = P(w - r, h), e = P(0, h); return { d: `M${a}L${b}A${f(r)},${f(h / 2)} 0 0 1 ${c}L${e}Z` }; }
    case 'callout': return { d: calloutPath(w, h, tip) };
  }
  const r = Math.min(12, w / 4, h / 4);
  const a = P(r, 0), b = P(w - r, 0), c = P(w, r), dd = P(w, h - r), e = P(w - r, h), g = P(r, h), i = P(0, h - r), k = P(0, r);
  const o = { d: `M${a} Q${f(w / 2)},${f(j(1))} ${b} Q${w},0 ${c} Q${f(w + j(1))},${f(h / 2)} ${dd} Q${w},${h} ${e} Q${f(w / 2)},${f(h + j(1))} ${g} Q0,${h} ${i} Q${f(j(1))},${f(h / 2)} ${k} Q0,0 ${a}Z` };
  if (n.shape === 'subprocess') o.extra = `M10,${f(j(0.4))}V${f(h + j(0.4))}M${w - 10},${f(j(0.4))}V${f(h + j(0.4))}`;
  return o;
}
// A callout: a rounded body with a tail from the side nearest its tip (in its own coordinates) to the tip.
function calloutPath(w, h, tip) {
  const r = Math.min(10, w / 4, h / 4), hb = 7;
  let side = null;
  if (tip) {
    const dx = tip.x - clamp(tip.x, 0, w), dy = tip.y - clamp(tip.y, 0, h);
    if (dx || dy) side = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'b' : 't') : (dx > 0 ? 'r' : 'l');
  }
  const bx = tip ? clamp((tip.x + w / 2) / 2, r + hb + 2, w - r - hb - 2) : 0, by = tip ? clamp((tip.y + h / 2) / 2, r + hb + 2, h - r - hb - 2) : 0;
  const T = tip ? `${f(tip.x)},${f(tip.y)}` : '';
  return `M${r},0` + (side === 't' ? `L${f(bx - hb)},0L${T}L${f(bx + hb)},0` : '') + `L${f(w - r)},0Q${w},0 ${w},${r}` +
    (side === 'r' ? `L${w},${f(by - hb)}L${T}L${w},${f(by + hb)}` : '') + `L${w},${f(h - r)}Q${w},${h} ${f(w - r)},${h}` +
    (side === 'b' ? `L${f(bx + hb)},${h}L${T}L${f(bx - hb)},${h}` : '') + `L${r},${h}Q0,${h} 0,${f(h - r)}` +
    (side === 'l' ? `L0,${f(by + hb)}L${T}L0,${f(by - hb)}` : '') + `L0,${r}Q0,0 ${r},0Z`;
}
// Where a callout points, in its own coordinates: just short of the piece it names (`to`), or its own `tip`.
function calloutTip(n, ctx) {
  const t = n.to !== undefined && ctx?.byId ? ctx.byId.get(String(n.to)) : null;
  if (t && t !== n) {
    const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 }, p = facing(t, c), d = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    return { x: p.x + ((c.x - p.x) / d) * 6 - n.x, y: p.y + ((c.y - p.y) / d) * 6 - n.y };
  }
  const tp = n.tip && typeof n.tip === 'object' ? n.tip : { dx: 22, dy: 34 };
  return { x: (num(tp.dx) ?? 22), y: n.h + (num(tp.dy) ?? 34) };
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
// A fault calls for attention, calmly: a ring breathes out of the dot (still under reduced motion or when paused).
// Only the editor draws it, never a thumbnail.
const statusDot = (n, th, pulse = null) => {
  if (!STATUS.includes(n.status)) return '';
  const [x, y] = n.shape === 'operation' ? [n.w - 22, 15] : [n.w - 3, 3];
  const ring = pulse && n.status === 'bad' ? (pulse === 'live'
    ? `<circle class="dg-pulse" cx="${f(x)}" cy="${y}" r="4.5" fill="none" stroke="${th.bad}" stroke-width="1.5"/>`
    : `<circle cx="${f(x)}" cy="${y}" r="7.5" fill="none" stroke="${th.bad}" stroke-opacity=".35" stroke-width="1.5"/>`) : '';
  return ring + `<circle cx="${f(x)}" cy="${y}" r="4.5" fill="${th[n.status]}" stroke="${th.bg}" stroke-width="${n.shape === 'operation' ? 0 : 2}"/>`;
};
const noteText = (v) => (v && typeof v === 'object' ? String(v.text ?? '') : v === null || v === undefined ? '' : String(v));
const noteTone = (v, th) => (v && typeof v === 'object' && th[v.tone === 'warn' ? 'warn' : v.tone] ? th[v.tone === 'warn' ? 'warn' : v.tone] : null);
const frameStyle = (n) => (FRAMES.includes(n.frame) ? n.frame : 'dashed');

/// A frame's own glyph (vpc, region, machine…, or a group's `icon`) and its tint.
const frameIcon = (n) => (n.shape !== 'group' && n.shape !== 'lane' ? n.shape : (SYMS[n.icon]?.glyph ? n.icon : null));
function frameTint(n, th) { const id = frameIcon(n), t = id && (SYMS[id]?.kind === 'frame' ? SYMS[id].ftint : TINT_OF[id]); return t ? th.tint[t] : null; }
const frameTitleX = (n) => (n.shape === 'lane' ? (n.dir === 'v' ? 16 : 48) : frameStyle(n) === 'lane' ? 16 : 20) + (frameIcon(n) ? 22 : 0);

// A group: a dashed frame (as always), a lane with a header band, a soft tint, or nothing at all (a logical group).
// Frames with an icon (a private network, a region, a machine…) carry their glyph before the title and their tint.
// A swimlane (`lane`) is a solid band on its left (or on top with dir 'v') with its title along it.
function frameSVG(n, th, { hideText = false, hit = false } = {}) {
  const st = frameStyle(n), title = n.text && !hideText ? upper(n.text) : '', FT = frameTint(n, th), icon = frameIcon(n);
  const stroke = FT ? FT.s : th.frame, ink = FT ? mix(FT.ink, th.frameInk, 0.35) : th.frameInk, tx = frameTitleX(n);
  const glyph = (x, y) => (icon ? frameGlyph(icon, x, y, FT ? FT.g : th.frameInk) : '');
  let s = '';
  if (n.shape === 'lane') {
    const band = mix(th.frame, th.bg, 0.88), v = n.dir === 'v', B = 34;
    s += `<rect x="0" y="0" width="${n.w}" height="${n.h}" rx="3" fill="none" stroke="${th.frame}" stroke-width="1.2"/>` +
      (v ? `<path d="M0,${B}V3A3,3 0 0 1 3,0H${n.w - 3}A3,3 0 0 1 ${n.w},3V${B}Z" fill="${band}"/><path d="M0,${B}H${n.w}" stroke="${th.frame}" stroke-opacity=".6" stroke-width="1"/>`
        : `<path d="M${B},0H3A3,3 0 0 0 0,3V${n.h - 3}A3,3 0 0 0 3,${n.h}H${B}Z" fill="${band}"/><path d="M${B},0V${n.h}" stroke="${th.frame}" stroke-opacity=".6" stroke-width="1"/>`);
    if (title) s += v ? textSVG([title], 16, 7, 12, 20, th.frameInk, { anchor: 'start', spacing: '.08em' })
      : `<g transform="translate(${B / 2},${f(n.h / 2)}) rotate(-90)">${textSVG([title], 0, -10, 12, 20, th.frameInk, { spacing: '.08em' })}</g>`;
    if (hit) s += (v ? `<rect x="0" y="0" width="${n.w}" height="${B}" fill="transparent"/>` : `<rect x="0" y="0" width="${B}" height="${n.h}" fill="transparent"/>`) +
      `<rect class="dg-fhit" x="0" y="0" width="${n.w}" height="${n.h}" fill="none" stroke="transparent" stroke-width="14"/>`;
    return s;
  }
  if (st === 'lane') {
    const band = mix(FT ? FT.s : th.frame, th.bg, 0.86);
    s += `<rect x="0" y="0" width="${n.w}" height="${n.h}" rx="10" fill="none" stroke="${stroke}" stroke-opacity=".7" stroke-width="1.2"/>` +
      `<path d="M0,36V10A10,10 0 0 1 10,0H${n.w - 10}A10,10 0 0 1 ${n.w},10V36Z" fill="${band}"/><path d="M0,36H${n.w}" stroke="${stroke}" stroke-opacity=".5" stroke-width="1"/>`;
    s += glyph(16, 10);
    if (title) s += textSVG([title], tx, 8, 12, 20, ink, { anchor: 'start', spacing: '.08em' });
  } else if (st === 'fill') {
    s += `<rect x="0" y="0" width="${n.w}" height="${n.h}" rx="16" fill="${mix(FT ? FT.s : th.frame, th.bg, 0.9)}" stroke="${stroke}" stroke-opacity=".35" stroke-width="1"/>`;
    s += glyph(20, 14);
    if (title) s += textSVG([title], tx, 12, 12, 20, ink, { anchor: 'start', spacing: '.08em' });
  } else if (st === 'dashed') {
    s += `<rect x="0" y="0" width="${n.w}" height="${n.h}" rx="16" fill="none" stroke="${stroke}"${FT ? ' stroke-opacity=".75"' : ''} stroke-width="1.4" stroke-dasharray="9 7"/>`;
    s += glyph(20, 14);
    if (title) s += textSVG([title], tx, 12, 12, 20, ink, { anchor: 'start', spacing: '.08em' });
  }
  if (hit && st !== 'none') {
    s += `<rect class="dg-fhit" x="0" y="0" width="${n.w}" height="${n.h}" rx="16" fill="none" stroke="transparent" stroke-width="14"/>` +
      `<rect x="10" y="4" width="${f(Math.max(60, Math.min(n.w - 20, measure(upper(n.text || ''), 12) * 1.1 + 24 + (icon ? 22 : 0))))}" height="30" fill="transparent"/>`;
  }
  return s;
}

// A catalogue symbol's tint, with what its drawing needs from the theme (stronger glyph, lid, canvas).
const tintCache = new Map();
function tintFor(shape, th) {
  const key = (th === THEME.dark ? 'd' : 'l') + TINT_OF[shape];
  if (!tintCache.has(key)) { const b = th.tint[TINT_OF[shape]] || th.tint.grey; tintCache.set(key, { ...b, g: b.gs || b.g, lid: mix(b.f, b.s, 0.2), bg: th.bg }); }
  return tintCache.get(key);
}

// A legend: every symbol the diagram uses (and every kind of line), or the rows written in `items`.
const DASH_NAMES = { solid: 'Continua', dashed: 'Discontinua', dashdot: 'Trazo y punto' };
function legendRows(n, ctx) {
  if (Array.isArray(n.items) && n.items.length) return n.items.filter((r) => r && typeof r === 'object').map((r) => ({ shape: r.shape ? resolveShape(String(r.shape)) || String(r.shape) : null, dash: DASHES.includes(r.dash) ? r.dash : null, text: String(r.text ?? '') }));
  const order = new Map(Object.keys(SYMS).map((id, i) => [id, i])), used = new Set();
  for (const m of ctx?.nodes || []) if (ICONS.has(m.shape)) used.add(drawAs(m.shape));
  const rows = [...used].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999)).map((id) => ({ shape: id, text: NAMES[id] }));
  const dashes = new Set((ctx?.edges || []).map((e) => (DASHES.includes(e.dash) ? e.dash : 'solid')));
  if (dashes.size > 1 || (dashes.size && rows.length)) for (const d of DASHES) if (dashes.has(d)) rows.push({ dash: d, text: DASH_NAMES[d] });
  return rows;
}
function legendSize(n, ctx) {
  const rows = legendRows(n, ctx), tw = Math.max(80, ...rows.map((r) => measure(r.text, 13)), n.text ? measure(upper(n.text), 11) * 1.12 : 0);
  return [Math.ceil(tw + 64), Math.max(40, rows.length * 24 + (n.text ? 30 : 10) + 12)];
}
function legendSVG(n, th, ctx, { hideText = false } = {}) {
  const rows = legendRows(n, ctx);
  let s = `<rect x=".5" y=".5" width="${n.w - 1}" height="${n.h - 1}" rx="10" fill="${mix(th.bg, th.ink, 0.03)}" stroke="${th.frame}" stroke-width="1"/>`;
  if (n.text && !hideText) s += textSVG([upper(n.text)], 14, 8, 11, 18, th.muted, { anchor: 'start', spacing: '.08em' });
  let y = n.text ? 32 : 10;
  if (!rows.length) s += textSVG(['—'], n.w / 2, y, 13, 22, th.muted);
  for (const r of rows) {
    if (r.shape && KNOWN.has(r.shape)) s += miniSVG(r.shape, th, 20).replace('<svg ', `<svg x="12" y="${f(y + 1)}" width="22" height="22" `);
    else if (r.dash) s += `<path d="M12,${f(y + 12)}h24" stroke="${th.flow}" stroke-width="1.8" stroke-dasharray="${DASH_ARRAY[r.dash]}"/>`;
    s += textSVG([r.text], 44, y + 2, 13, 20, th.ink, { anchor: 'start' });
    y += 24;
  }
  return s;
}

// A symbol drawn as a card: a soft box in its family's tint, the glyph on the left, its words inside.
function cardSVG(n, T, th, hideText) {
  const sym = SYMS[drawAs(n.shape)];
  let s = `<rect x=".8" y=".8" width="${f(n.w - 1.6)}" height="${f(n.h - 1.6)}" rx="10" fill="${T.f}" stroke="${T.s}" stroke-width="1.6"/>`;
  if (sym.glyph) s += glyphSVG(sym.glyph, [25, n.h / 2, 22], T.g);
  else {                                              // a silhouette without a glyph (a database, a cloud, a phone) shrinks into the slot
    const [w0, h0] = sym.size, k = 26 / Math.max(w0, h0), w = w0 * k, h = h0 * k;
    s += `<g transform="translate(${f(25 - w / 2)},${f(n.h / 2 - h / 2)}) scale(${k.toFixed(4)})">${shellSVG(sym.shell, w0, h0, T).svg}</g>`;
  }
  if (!hideText) {
    const { title, sub } = cardWords(n), bh = title.length * 20 + sub.length * 17 + (sub.length && title.length ? 2 : 0), top = n.h / 2 - bh / 2;
    if (title.length) s += textSVG(title, CARD_X, top, 15, 20, T.ink, { anchor: 'start', weight: 600 });
    if (sub.length) s += textSVG(sub, CARD_X, top + title.length * 20 + (title.length ? 2 : 0), 13, 17, T.sub || th.muted, { anchor: 'start' });
  }
  return s;
}

// Everything a node draws, in its own coordinates. `hit` adds transparent areas the editor needs for picking; `ctx`
// ({ byId, nodes, edges }) lets a callout find what it points at and a legend list what the diagram uses.
// A piece without a name shows a faint «Nombre» where its words would go (editor only; thumbnails stay clean).
function placeholderSVG(n, th) {
  if (n.text || isFrame(n) || isLegend(n) || n.shape === 'step' || n.shape === 'connector' || (n.sub && !isClassic(n.shape))) return '';
  const w = 'Nombre', g = (x, y, a = 'middle') => `<g opacity=".5">${textSVG([w], x, y, 13, 18, th.muted, { anchor: a })}</g>`;
  if (n.shape === 'text') return g(n.w / 2, n.h / 2 - 9);
  if (isClassic(n.shape)) return g(textCX(n), n.h / 2 - 9);
  if (n.shape === 'operation') return g(n.w / 2, n.h / 2 - 9);
  if (isCard(n)) return g(CARD_X, n.h / 2 - 9, 'start');
  if (rightLabel(n)) return g(n.w + 10, n.h / 2 - 9, 'start');
  return g(n.w / 2, n.h + 6 + capDrop(n));
}
function nodeInner(n, th, { hideText = false, note, hit = false, ctx = null, pulse = null, noteAt = null } = {}) {
  if (isFrame(n)) return frameSVG(n, th, { hideText, hit });
  if (isLegend(n)) return legendSVG(n, th, ctx, { hideText });
  let s = '';
  const nt = noteText(note), tone = noteTone(note, th);
  if (n.shape === 'text') {
    const [fs, lh, wt] = fsOf(n);
    if (hit) s += `<rect x="0" y="0" width="${n.w}" height="${n.h}" fill="transparent"/>`;
    if (!hideText && n.text) { const lines = classicLines(n); s += textSVG(lines, n.w / 2, n.h / 2 - (lines.length * lh) / 2, fs, lh, n.color && n.color !== PALETTE[0] && th !== THEME.dark ? darken(n.color) : th.ink, { weight: wt || '' }); }
  } else if (isClassic(n.shape)) {
    const C = classicColours(n, th), o = outline(n, n.shape === 'callout' ? calloutTip(n, ctx) : null);
    s += `<path d="${o.d}" fill="${C.f}" stroke="${C.s}" stroke-width="1.5" stroke-linejoin="round"` +
      (n.shape === 'note' ? ' style="filter:drop-shadow(0 2px 3px rgba(40,30,50,.13))"' : '') + '/>';
    if (o.fold) s += `<path d="${o.fold}" fill="${mix(C.f, C.s, 0.35)}" stroke="${C.s}" stroke-width="1.2" stroke-linejoin="round"/>`;
    if (o.extra) s += `<path d="${o.extra}" fill="none" stroke="${C.s}" stroke-width="1.3"/>`;
    if (!hideText && n.text) {
      const [fs, lh, wt] = fsOf(n), lines = classicLines(n);
      s += textSVG(lines, textCX(n), n.h / 2 - (lines.length * lh) / 2, fs, lh, C.ink, { weight: wt || '' });
    }
  } else {
    const shape = drawAs(n.shape), cat = isCatalogueSymbol(shape), T = cat ? tintFor(shape, th) : th.tint[TINT_OF[n.shape]];
    if (isCard(n)) s += cardSVG(n, T, th, hideText);
    else if (cat) s += drawSymbol({ ...n, shape }, T);
    else s += symbol(n, T, th);
    if (n.shape === 'operation') {
      if (!hideText) {
        const { title, sub } = opWords(n), blockH = title.length * 20 + sub.length * 17 + (sub.length && title.length ? 4 : 0);
        const top = n.h / 2 - blockH / 2;
        if (title.length) s += textSVG(title, n.w / 2, top, 15, 20, T.ink, { weight: 600 });
        if (sub.length) s += textSVG(sub, n.w / 2, top + title.length * 20 + (title.length ? 4 : 0), 13, 17, T.sub);
      }
    } else if (!isCard(n)) {
      const { lines, sub } = iconWords(n);
      if (rightLabel(n)) {
        const top = n.h / 2 - wordsBlockH(n) / 2;
        if (!hideText && lines.length) s += textSVG(lines, n.w + 10, top, LBF, LBL, T.ink, { anchor: 'start' });
        if (sub.length) s += textSVG(sub, n.w + 10, top + lines.length * LBL, 12, 16, th.muted, { anchor: 'start' });
        if (hit && (lines.length || sub.length)) { const e = ext(n); s += `<rect x="${n.w}" y="${f(e.y - n.y)}" width="${f(Math.max(4, e.w - n.w))}" height="${f(e.h)}" fill="transparent"/>`; }
      } else {
        if (!hideText && lines.length) s += textSVG(lines, n.w / 2, n.h + 6 + capDrop(n), LBF, LBL, T.ink);
        if (sub.length) s += textSVG(sub, n.w / 2, n.h + 6 + capDrop(n) + lines.length * LBL, 12, 16, th.muted);
        if (hit) { const e = ext(n); s += `<rect x="${f(e.x - n.x)}" y="${n.h}" width="${f(e.w)}" height="${f(Math.max(4, e.y + e.h - n.y - n.h))}" fill="transparent"/>`; }
      }
    }
  }
  s += statusDot(n, th, pulse) + triggerSVG(n, th);
  if (nt) {
    const y = iconic(n) ? n.h + labelH(n) + 2 : n.h + 6;
    const at = noteAt ? ` transform="translate(${f(noteAt.dx)},${f(noteAt.dy)})"` : '';
    s += `<g class="dg-note"${at}>` + textSVG(wrap(nt, Math.max(n.w + 40, 150), 11.5), n.w / 2, y, 11.5, 15, tone || th.muted, { halo: th.bg }) + '</g>';
  }
  return s;
}
// Where the words of a classic piece are centred (a D-shape's text sits in its square part).
const textCX = (n) => (n.shape === 'delay' ? (n.w - Math.min(n.h / 2, n.w / 2) / 2) / 2 + 2 : n.shape === 'io' ? n.w / 2 : n.w / 2);
// Where a node's reading note sits (edge labels keep clear of it).
function noteRect(n, note) {
  const nt = noteText(note);
  if (!nt) return null;
  const lines = wrap(nt, Math.max(n.w + 40, 150), 11.5), w = Math.max(...lines.map((l) => measure(l, 11.5))) + 6;
  const y = iconic(n) ? n.y + n.h + labelH(n) + 2 : n.y + n.h + 6;
  return { x: n.x + n.w / 2 - w / 2, y, w, h: lines.length * 15 };
}

// ---------- arrows ----------

const NORMAL = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };
const OPP = { r: 'l', l: 'r', t: 'b', b: 't' };
const ROUND = new Set(['ellipse', 'agent', 'clock', 'event', 'user', 'step', 'connector']);
const POINTED = new Set(['diamond', 'capability', 'resource', 'incident']);
// catalogue symbols meet arrows like the legacy shape with the same outline
const REACH_AS = {};
for (const id of Object.keys(SYMS)) {
  const r = reachKind(id);
  if (r === 'round') { ROUND.add(id); REACH_AS[id] = 'ellipse'; }
  if (r === 'hex') { POINTED.add(id); REACH_AS[id] = 'resource'; }
  if (r === 'tri') { POINTED.add(id); REACH_AS[id] = 'incident'; }
}

// How far toward a side's border a point `t` (−1..1 along that side) reaches, as a share of the half size.
function reach(shape, side, t) {
  const vert = side === 'l' || side === 'r';
  shape = REACH_AS[shape] || shape;
  if (ROUND.has(shape)) return Math.sqrt(Math.max(0, 1 - t * t));
  if (shape === 'diamond' || shape === 'capability') return 1 - Math.abs(t);
  if (shape === 'resource') return vert ? (Math.abs(t) < 0.5 ? 1 : 1.5 - Math.abs(t)) : 1 - Math.abs(t) * 0.5;
  if (shape === 'incident') return side === 'b' ? 1 : side === 't' ? 1 - Math.abs(t) : 0.5;
  return 1;
}
// A point on the node's border on one side, `o` units off that side's middle, with the side's outward normal.
// A symbol's lower side is under its words, so arrows never cross them.
function borderPoint(n, side, o) {
  const vert = side === 'l' || side === 'r';
  const hw = n.w / 2, hh = n.h / 2, t = clamp(o / (vert ? hh : hw), -1, 1), k = isCard(n) ? 1 : reach(n.shape, side, t);
  const [nx, ny] = NORMAL[side], cx = n.x + hw, cy = n.y + hh;
  if (side === 'r' && rightLabel(n) && wordsBlockH(n)) { const e = ext(n); return { x: e.x + e.w + 2, y: cy + o, nx, ny }; }
  if (vert) return { x: cx + nx * hw * k, y: cy + o, nx, ny };
  if (side === 'b' && iconic(n) && labelH(n)) return { x: cx + o, y: n.y + n.h + labelH(n) + 2, nx, ny };
  return { x: cx + o, y: cy + ny * hh * k, nx, ny };
}
// Where on its side an arrow end was pinned (0..1 along the side), or null. Only meaningful with a pinned side.
function pinnedAt(e, which) {
  const side = which ? e.toSide : e.fromSide, at = which ? e.toAt : e.fromAt;
  return SIDES.includes(side) && at !== null && at !== undefined && at !== '' && Number.isFinite(+at) ? clamp(+at, 0, 1) : null;
}
// The side of a that faces b.
function sideToward(a, b) {
  const dx = b.x + b.w / 2 - a.x - a.w / 2, dy = b.y + b.h / 2 - a.y - a.h / 2;
  return Math.abs(dx) - (a.w + b.w) / 2 >= Math.abs(dy) - (a.h + b.h) / 2 ? (dx >= 0 ? 'r' : 'l') : (dy >= 0 ? 'b' : 't');
}
// The side of `n` that faces a point.
function facingSide(n, p) {
  const dx = p.x - n.x - n.w / 2, dy = p.y - n.y - n.h / 2;
  return Math.abs(dx) / n.w > Math.abs(dy) / n.h ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
}
const facing = (n, p) => borderPoint(n, facingSide(n, p), 0);

const chevron = (tip, dx, dy) => {                     // an open arrowhead at `tip`, pointing along (dx, dy)
  const px = -dy * 5.4, py = dx * 5.4, bx = tip.x - dx * AH, by = tip.y - dy * AH;
  return `M${f(bx + px)},${f(by + py)}L${f(tip.x)},${f(tip.y)}L${f(bx - px)},${f(by - py)}`;
};

// A smooth curve leaving p along its normal and arriving at q against q's normal.
function curve(p, q, reachLen) {
  const c = reachLen ?? clamp(Math.hypot(q.x - p.x, q.y - p.y) * 0.42, 16, 130);
  const c1x = p.x + p.nx * c, c1y = p.y + p.ny * c, c2x = q.x + q.nx * c, c2y = q.y + q.ny * c;
  const at = (t) => { const u = 1 - t; return { x: u * u * u * p.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * q.x, y: u * u * u * p.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * q.y }; };
  const poly = Array.from({ length: 41 }, (_, i) => at(i / 40)), m = at(0.5);
  const end = poly[39], dl = Math.hypot(q.x - end.x, q.y - end.y) || 1;
  const s0 = poly[1], dl0 = Math.hypot(s0.x - p.x, s0.y - p.y) || 1;
  return {
    d: `M${f(p.x)},${f(p.y)} C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(q.x)},${f(q.y)}`,
    tail: [(p.x - s0.x) / dl0, (p.y - s0.y) / dl0], dir: [(q.x - end.x) / dl, (q.y - end.y) / dl], mx: m.x, my: m.y, poly, curve: true,
  };
}

// Square routing, as on a circuit: out along the normal, across, and in.
// `mid`: where the middle stretch runs (lines that share a port split at the same place, like a bus).
function elbowPts(p, q, mid = null) {
  const S = 22, a = { x: p.x + p.nx * S, y: p.y + p.ny * S }, b = { x: q.x + q.nx * S, y: q.y + q.ny * S };
  const hp = p.nx !== 0, hq = q.nx !== 0;
  let pts;
  if (hp && hq) {
    if (Math.abs(p.y - q.y) < 1) pts = [p, { x: q.x, y: p.y }];
    else if ((b.x - a.x) * p.nx >= 0) { const mx = mid ?? (p.x + q.x) / 2; pts = [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q]; }
    else { const my = (p.y + q.y) / 2; pts = [p, a, { x: a.x, y: my }, { x: b.x, y: my }, b, q]; }
  } else if (!hp && !hq) {
    if (Math.abs(p.x - q.x) < 1) pts = [p, { x: p.x, y: q.y }];
    else if ((b.y - a.y) * p.ny >= 0) { const my = mid ?? (p.y + q.y) / 2; pts = [p, { x: p.x, y: my }, { x: q.x, y: my }, q]; }
    else { const mx = (p.x + q.x) / 2; pts = [p, a, { x: mx, y: a.y }, { x: mx, y: b.y }, b, q]; }
  } else if (hp) pts = (q.x - p.x) * p.nx > 0 && (p.y - q.y) * q.ny > 0 ? [p, { x: q.x, y: p.y }, q] : [p, a, { x: a.x, y: b.y }, b, q];
  else pts = (q.y - p.y) * p.ny > 0 && (p.x - q.x) * q.nx > 0 ? [p, { x: p.x, y: q.y }, q] : [p, a, { x: b.x, y: a.y }, b, q];
  return simplify(pts);
}
// A polyline drawn with rounded corners (radius r), plus what the label and arrowheads need.
function polyGeom(pts, r = 7) {
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], B = pts[i], C = pts[i + 1], l1 = Math.hypot(B.x - A.x, B.y - A.y) || 1, l2 = Math.hypot(C.x - B.x, C.y - B.y) || 1, rr = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${f(B.x - ((B.x - A.x) / l1) * rr)},${f(B.y - ((B.y - A.y) / l1) * rr)} Q${f(B.x)},${f(B.y)} ${f(B.x + ((C.x - B.x) / l2) * rr)},${f(B.y + ((C.y - B.y) / l2) * rr)}`;
  }
  const L = pts[pts.length - 1], P = pts[pts.length - 2], ll = Math.hypot(L.x - P.x, L.y - P.y) || 1;
  const F = pts[0], N1 = pts[1], lf = Math.hypot(N1.x - F.x, N1.y - F.y) || 1;
  d += ` L${f(L.x)},${f(L.y)}`;
  let best = 0, bi = 1;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (l > best) { best = l; bi = i; } }
  const s0 = pts[bi - 1], s1 = pts[bi];
  return { d, dir: [(L.x - P.x) / ll, (L.y - P.y) / ll], tail: [(F.x - N1.x) / lf, (F.y - N1.y) / lf], mx: (s0.x + s1.x) / 2, my: (s0.y + s1.y) / 2, poly: pts };
}

// Every arrow's geometry, computed the same way for the editor and the thumbnails:
// 1 sides (pinned or facing) · 2 straight when the two pieces face each other · 3 ports spread along each side
// (square lines leaving one side together share a port: a bus) · 4 the plain route, or an A* detour when it would cross a
// piece · 5 parallel lines kept apart · 6 labels where they touch nothing.
// opts: { cache: Map, words: (e) => string, notes: {nodeId: note}, deadline: ms timestamp } → Map edgeId → geom
// (geom.incomplete is set on the map when the time budget ran out and some detours wait for the next frame).
function routeAll(d, nodes, opts = {}) {
  const edges = d.edges, byId = new Map(nodes.map((n) => [n.id, n])), out = new Map();
  const cache = opts.cache || null, deadline = opts.deadline ?? Infinity;
  const hash = new SpatialHash();
  for (const n of nodes) if (!isFrame(n)) hash.insert(n.id, blockRect(n));
  const frames = nodes.filter((n) => isFrame(n) && frameStyle(n) !== 'none');
  for (const g of frames) if (g.text) { const lane = frameStyle(g) === 'lane'; hash.insert('t' + g.id, { x: g.x + (lane ? 12 : 16), y: g.y + (lane ? 6 : 10), w: measure(upper(g.text), 12) * 1.1 + 10, h: 22 }); }   // a frame's title is never crossed
  const fr = d.frontier && num(d.frontier.y) !== null ? d.frontier : null;
  const items = [];
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    if (a === b) { const g = curve(borderPoint(a, 'r', -a.h * 0.25), borderPoint(a, 't', a.w * 0.3), 46); out.set(e.id, finishGeom(e, g)); continue; }
    const route = ROUTES.includes(e.route) ? e.route : defaultRoute(a, b);
    let sa = SIDES.includes(e.fromSide) ? e.fromSide : sideToward(a, b), sb = SIDES.includes(e.toSide) ? e.toSide : (SIDES.includes(e.fromSide) ? sideToward(b, a) : OPP[sa]);
    // a symbol's words hang under it: an arrow that would meet it from below, while the two sit side by side, comes in
    // from the side instead, so it points at the symbol and not at its words
    if (!SIDES.includes(e.fromSide) && !SIDES.includes(e.toSide) && (sa === 'b' || sb === 'b') && ((sb === 'b' && iconic(b) && labelH(b)) || (sa === 'b' && iconic(a) && labelH(a)))) {
      const ea = ext(a), eb = ext(b), gx = Math.max(eb.x - (ea.x + ea.w), ea.x - (eb.x + eb.w));
      if (gx > 30) { sa = eb.x > ea.x ? 'r' : 'l'; sb = OPP[sa]; }
    }
    items.push({ e, a, b, sa, sb, route, straight: null });
  }
  // 2 · straight when the projections overlap enough (the ports slide along their sides)
  const range = (n, side) => {
    const vert = side === 'l' || side === 'r', inset = ROUND.has(n.shape) || POINTED.has(n.shape) ? 0.25 : 0.08;
    return vert ? [n.y + n.h * inset, n.y + n.h * (1 - inset)] : [n.x + n.w * inset, n.x + n.w * (1 - inset)];
  };
  for (const it of items) {
    if (OPP[it.sa] !== it.sb) continue;
    if (it.route === 'curve') {                          // a curve between two pieces almost in line is drawn level
      const v = it.sa === 'l' || it.sa === 'r', ca = v ? it.a.y + it.a.h / 2 : it.a.x + it.a.w / 2, cb = v ? it.b.y + it.b.h / 2 : it.b.x + it.b.w / 2;
      if (Math.abs(ca - cb) >= 10 || Math.abs(ca - cb) < 0.5) continue;
    }
    if (pinnedAt(it.e, 0) !== null || pinnedAt(it.e, 1) !== null) continue;   // a chosen port keeps its place in the order
    const [a0, a1] = range(it.a, it.sa), [b0, b1] = range(it.b, it.sb), lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    if (hi - lo >= 16 || (hi - lo >= 0 && it.route === 'straight')) it.straight = (lo + hi) / 2;
  }
  // 3 · ports along each side
  const sides = new Map();
  const addSide = (node, side, it, which) => {
    const k = node.id + '\u0001' + side;
    if (!sides.has(k)) sides.set(k, { node, side, list: [] });
    sides.get(k).list.push({ it, which });
  };
  for (const it of items) { addSide(it.a, it.sa, it, 0); addSide(it.b, it.sb, it, 1); }
  for (const { node, side, list } of sides.values()) {
    const vert = side === 'l' || side === 'r', mid = vert ? node.y + node.h / 2 : node.x + node.w / 2;
    const other = (x) => (x.which ? x.it.a : x.it.b);
    // a port he chose keeps its order on the side (fromAt/toAt: 0..1 along it); the others follow their far end
    const along = (x) => { const a = pinnedAt(x.it.e, x.which); if (a !== null) return vert ? node.y + node.h * a : node.x + node.w * a; const o = other(x); return vert ? o.y + o.h / 2 : o.x + o.w / 2; };
    const units = new Map();
    for (const x of list) {
      if (x.it.straight !== null) { (x.it.ends ||= [])[x.which] = borderPoint(node, side, x.it.straight - mid); continue; }
      const e = x.it.e, bus = x.it.route === 'elbow' && e.bus !== false && pinnedAt(e, x.which) === null ? `bus|${x.which}|${e.dash}` : 'own|' + e.id + '|' + x.which;
      if (!units.has(bus)) units.set(bus, { members: [], sum: 0 });
      const u = units.get(bus);
      u.members.push(x); u.sum += along(x);
    }
    const us = [...units.values()].sort((p, q) => p.sum / p.members.length - q.sum / q.members.length);
    const len = vert ? node.h : node.w, usable = len * (ROUND.has(node.shape) || POINTED.has(node.shape) ? 0.5 : 0.7);
    const step = us.length > 1 ? Math.min(24, usable / (us.length - 1)) : 0;
    us.forEach((u, i) => {
      const o = (i - (us.length - 1) / 2) * step;
      for (const x of u.members) { (x.it.ends ||= [])[x.which] = borderPoint(node, side, o); x.it.bus ??= []; x.it.bus[x.which] = node.id + side + (u.members.length > 1 ? '#b' + i : '#' + x.it.e.id); }
    });
  }
  // a bus splits at one place: halfway to its nearest member
  const busMid = new Map();
  for (const it of items) {
    if (!it.bus || it.straight !== null || it.route !== 'elbow') continue;
    for (const which of [0, 1]) {
      const k = it.bus[which];
      if (!/#b\d+$/.test(k)) continue;
      const [p, q] = which ? [it.ends[1], it.ends[0]] : it.ends, ax = p.nx !== 0 ? 'x' : 'y';
      const half = (q[ax] - p[ax]) / 2;
      if (half * (ax === 'x' ? p.nx : p.ny) <= 0) continue;
      const cur = busMid.get(k);
      if (cur === undefined || Math.abs(half) < Math.abs(cur.half)) busMid.set(k, { half, v: p[ax] + half });
    }
  }
  // 4 · routes, short ones first so they get the good channels
  const routed = [];
  const order = items.slice().sort((p, q) => {
    const lp = Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y), lq = Math.abs(q.a.x - q.b.x) + Math.abs(q.a.y - q.b.y);
    return lp - lq || edges.indexOf(p.e) - edges.indexOf(q.e);
  });
  let incomplete = false;
  const inside = (n, g) => { const c = centre(ext(n)); return c.x >= g.x && c.x <= g.x + g.w && c.y >= g.y && c.y <= g.y + g.h; };
  for (const it of order) {
    const { e, a, b, route } = it, [p, q] = it.ends;
    let pts = null, geom = null;
    const obstaclesNear = (r) => hash.queryRect(r).filter((id) => id !== a.id && id !== b.id);
    if (route === 'straight') { pts = [p, q]; }
    else if (route === 'curve') {
      const c = curve(p, q);
      const box0 = union([{ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) }, ...c.poly.map((pt) => ({ x: pt.x, y: pt.y, w: 0, h: 0 }))]);
      const near = obstaclesNear(inflate(box0, 4));
      if (!near.some((id) => polyHitsRect(c.poly, inflate(hash.rect(id), 4)))) geom = c;
    } else if (it.straight !== null) {
      const bb = union([{ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) }]);
      if (!obstaclesNear(inflate(bb, 8)).some((id) => polyHitsRect([p, q], inflate(hash.rect(id), 6)))) pts = [p, q];
    } else {
      const mid = busMid.get(it.bus?.[0])?.v ?? busMid.get(it.bus?.[1])?.v ?? null;
      const fast = elbowPts(p, q, mid), bb = union(fast.map((pt) => ({ x: pt.x, y: pt.y, w: 0, h: 0 })));
      const near = obstaclesNear(inflate(bb, 8));
      if (!near.some((id) => polyHitsRect(fast, inflate(hash.rect(id), 6)))) pts = fast;
    }
    if (!pts && !geom) {
      // the detour: A* from any side of a to any side of b (the facing pair costs least), unless sides are pinned
      const pin = (n, s, side0) => (s ? [{ ...it.ends[n === a ? 0 : 1], pen: 0 }] : SIDES.map((sd) => ({ ...(sd === side0 ? it.ends[n === a ? 0 : 1] : borderPoint(n, sd, 0)), pen: (sd === side0 ? 0 : sd === OPP[side0] ? 60 : 20) + (sd === 'b' && sd !== side0 && iconic(n) && labelH(n) ? 70 : 0) })));   // under its words is the last way into a symbol
      const starts = route === 'curve' ? [{ ...p, pen: 0 }] : pin(a, SIDES.includes(e.fromSide), it.sa);
      const goals = route === 'curve' ? [{ ...q, pen: 0 }] : pin(b, SIDES.includes(e.toSide), it.sb);
      const ra = blockRect(a), rb = blockRect(b), span = union([ra, rb]);
      const sig = [p.x, p.y, q.x, q.y, p.nx, p.ny, q.nx, q.ny, route, e.fromSide, e.toSide].join(',');
      let cor = inflate(span, 160);
      const near = hash.queryRect(cor).filter((id) => id !== a.id && id !== b.id);
      const key = sig + '|' + near.map((id) => { const r = hash.rect(id); return id + ':' + r.x + ',' + r.y + ',' + r.w + ',' + r.h; }).join(';');
      const hit = cache?.get(e.id);
      if (hit && hit.key === key) { pts = hit.pts.length >= 2 ? hit.pts.map((pt) => ({ ...pt })) : null; if (!pts) { if (route === 'curve') geom = curve(p, q); else pts = elbowPts(p, q); } }
      else if (performance.now() > deadline) { incomplete = true; pts = hit?.pts?.length && hit.sig === sig ? hit.pts.map((pt) => ({ ...pt })) : (route === 'curve' ? null : elbowPts(p, q)); if (!pts) geom = curve(p, q); }
      else {
        const soft = { cross: [], along: [], bands: [] };
        for (const s of routed) {
          if (s.x0 > cor.x + cor.w || s.x1 < cor.x || s.y0 > cor.y + cor.h || s.y1 < cor.y) continue;
          soft.cross.push({ ...s, c: 25 }); soft.along.push(s);
        }
        for (const g of frames) {
          if (!overlaps(g, cor)) continue;
          const ia = inside(a, g), ib = inside(b, g);
          if (ia !== ib) continue;
          for (const s of [[g.x, g.y, g.x + g.w, g.y], [g.x, g.y + g.h, g.x + g.w, g.y + g.h], [g.x, g.y, g.x, g.y + g.h], [g.x + g.w, g.y, g.x + g.w, g.y + g.h]]) soft.cross.push({ x0: s[0], y0: s[1], x1: s[2], y1: s[3], c: 60 });
          if (!ia) soft.bands.push({ x: g.x, y: g.y, w: g.w, h: 36, c: 200 });
        }
        if (fr && (a.y + a.h / 2 < fr.y) === (b.y + b.h / 2 < fr.y)) { const [x0, x1] = frontierSpan(d); soft.cross.push({ x0, y0: fr.y, x1, y1: fr.y, c: 200 }); }
        const obs = near.map((id) => hash.rect(id));
        let r = orthoRoute(starts, goals, obs, { corridor: cor, ...soft });
        if (!r) {
          const all = union(nodes.filter((n) => !isFrame(n)).map(blockRect));
          cor = inflate(all, 200);
          r = orthoRoute(starts, goals, hash.queryRect(cor).filter((id) => id !== a.id && id !== b.id).map((id) => hash.rect(id)), { corridor: cor, ...soft });
          // pieces packed close together: any side of each, and a narrower margin, rather than a line through a piece
          if (!r) r = orthoRoute(pin(a, SIDES.includes(e.fromSide), it.sa), pin(b, SIDES.includes(e.toSide), it.sb), hash.queryRect(cor).filter((id) => id !== a.id && id !== b.id).map((id) => hash.rect(id)), { corridor: cor, ...soft, M: 5, STUB: 9 });
        }
        pts = r ? r.pts : (route === 'curve' ? null : elbowPts(p, q));
        if (!pts) geom = curve(p, q);
        cache?.set(e.id, { key, sig, pts: pts ? pts.map((pt) => ({ ...pt })) : [] });
      }
    }
    if (pts) {
      for (let i = 1; i < pts.length; i++) {
        const A = pts[i - 1], B = pts[i];
        if (Math.abs(A.x - B.x) < 0.01 || Math.abs(A.y - B.y) < 0.01) routed.push({ x0: Math.min(A.x, B.x), y0: Math.min(A.y, B.y), x1: Math.max(A.x, B.x), y1: Math.max(A.y, B.y) });
      }
    }
    if (pts && pts.length < 2) pts = elbowPts(p, q);
    it.pts = pts; it.geom = geom;
  }
  // 5 · parallel lines kept apart
  const ortho = items.filter((it) => it.pts && it.pts.length >= 4 && it.route !== 'straight');
  const shared = (k) => k && /#b\d+$/.test(k);
  nudge(ortho.map((it) => ({ id: it.e.id, bus: it.bus && shared(it.bus[0]) ? 'S' + it.bus[0] : it.bus && shared(it.bus[1]) ? 'T' + it.bus[1] : null, pts: it.pts })), { obstacles: [] });
  for (const it of items) {
    let g = it.geom;
    if (!g) g = polyGeom(it.pts, it.route === 'curve' ? 28 : 7);
    out.set(it.e.id, finishGeom(it.e, g));
  }
  // 6 · labels
  // a reading's note under a piece steps aside from the lines that leave it, so no line runs through its words
  const polys = [...out.values()].map((g) => g.poly);
  out.noteAt = new Map();
  if (opts.notes) {
    const body = new SpatialHash();
    for (const n of nodes) if (!isFrame(n)) body.insert(n.id, blockRect(n));
    for (const n of nodes) {
      if (isFrame(n)) continue;
      const nr = noteRect(n, opts.notes[n.id]);
      if (!nr) continue;
      const side = nr.w / 2 + 10;
      let best = null;
      for (const [dx, pen] of [[0, 0], [side, 1], [-side, 2]]) {
        const r = { x: nr.x + dx, y: nr.y, w: nr.w, h: nr.h };
        let sc = pen;
        for (const P of polys) for (let i = 1; i < P.length; i++) if (segHitsRect(P[i - 1], P[i], inflate(r, 2))) { sc += 100; break; }
        for (const id of body.queryRect(r)) if (id !== n.id && overlaps(r, body.rect(id), 0)) sc += 100;
        if (!best || sc < best.sc) best = { sc, dx };
      }
      if (best.dx) out.noteAt.set(n.id, { dx: best.dx, dy: 0 });
    }
  }
  if (opts.words) {
    const blockers = new SpatialHash();
    for (const n of nodes) {
      if (isFrame(n)) continue;
      blockers.insert(n.id, blockRect(n));
      const nr = opts.notes && noteRect(n, opts.notes[n.id]);
      if (nr) { const o = out.noteAt.get(n.id); blockers.insert('note:' + n.id, o ? { ...nr, x: nr.x + o.dx } : nr); }
    }
    // a label never sits on a frame's border or title, nor on the frontier
    for (const g of frames) {
      for (const r of [{ x: g.x, y: g.y - 3, w: g.w, h: 6 }, { x: g.x, y: g.y + g.h - 3, w: g.w, h: 6 }, { x: g.x - 3, y: g.y, w: 6, h: g.h }, { x: g.x + g.w - 3, y: g.y, w: 6, h: g.h }]) blockers.insert('fb' + blockers.items.size, r);
      if (g.text) { const lane = frameStyle(g) === 'lane'; blockers.insert('ft' + g.id, { x: g.x + (lane ? 12 : 16), y: g.y + (lane ? 6 : 10), w: measure(upper(g.text), 12) * 1.1 + 10, h: 22 }); }
    }
    if (fr) { const [x0, x1] = frontierSpan(d); blockers.insert('fr:line', { x: x0, y: fr.y - 3, w: x1 - x0, h: 6 }); }
    if (fr) { const x0 = frontierLabelX(d) - 4; if (fr.label) blockers.insert('fr:l', { x: x0, y: fr.y + 6, w: measure(upper(fr.label), 12) * 1.12 + 12, h: 22 }); if (fr.out) blockers.insert('fr:o', { x: x0, y: fr.y - 30, w: measure(upper(fr.out), 12) * 1.12 + 12, h: 22 }); }
    const labels = [];
    for (const e of edges) {
      const g = out.get(e.id);
      if (!g) continue;
      const words = opts.words(e);
      if (!words) continue;
      const lines = upper(words).split('\n');
      labels.push({ id: e.id, w: Math.max(...lines.map((l) => measure(l, EFS) * 1.08)) + 8, h: lines.length * ELH + 2, pts: g.poly, curve: !!g.curve });
    }
    const spots = placeLabels(labels, blockers, [...out.values()].map((g) => g.poly));
    for (const [id, s] of spots) { const g = out.get(id); g.lx = s.x; g.ly = s.y; g.anchor = 'middle'; }
  }
  for (const g of out.values()) if (g.lx === undefined) { g.lx = g.mx; g.ly = g.my - 9; g.anchor = 'middle'; }
  if (incomplete) out.incomplete = true;
  return out;
}
// Arrowheads: at the end (always), at both ends, or none.
function finishGeom(e, g) {
  const head = HEADS.includes(e.head) ? e.head : 'end', P = g.poly;
  const L = P[P.length - 1], F = P[0];
  g.head = head === 'none' ? '' : chevron(L, g.dir[0], g.dir[1]) + (head === 'both' ? chevron(F, g.tail[0], g.tail[1]) : '');
  return g;
}

// The colour of an arrow says what it is: going out of this computer, using something, or carrying data in.
function edgeColour(e, byId, th, tone) {
  if (tone) return tone;
  const a = byId.get(e.from), b = byId.get(e.to);
  if (a && b && b.outside && !a.outside) return th.alt;      // leaving this computer
  if (e.verb === 'usa') return th.tint.slate.s;
  return th.flow;
}
const flowOf = (e) => flowSpec(e)?.speed ?? null;
// Data travelling along an arrow: capsules 8 units long, one every 84, running from → to (or back, or both ways) at a
// speed in diagram units per second, in phase with the clock so a rebuilt line never jumps. What the source is doing
// shows: an idle source holds its packets still and faint, a failing one holds them in the fault colour.
// opts: { live: animate or hold still, src: the source node, dark }
function packetsSVG(e, g, th, colour, { live = true, src = null, dark = false, force = null } = {}) {
  const spec = force || flowSpec(e);
  if (!spec || !g) return '';
  const pp = packetPath(g, ROUTES.includes(e.route) ? e.route : (g.curve ? 'curve' : 'elbow'), HEADS.includes(e.head) ? e.head : 'end');
  if (!pp) return '';
  let c = packetColour(colour, dark, th.ink), op = 0.9, moving = live;
  if (src?.status === 'idle') { moving = false; op = 0.45; }
  if (src?.status === 'bad') { moving = false; op = 0.7; c = th.bad; }
  const dur = PERIOD / spec.ups, ms = dur * 1000;
  const one = (back, shift) => {
    const delay = moving ? phaseDelay(ms) - shift * ms : 0;
    return `<path class="dg-flow${moving ? ' dg-flow-on' : ''}" d="${pp.d}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 76"` +
      (moving ? ` style="animation-duration:${dur.toFixed(3)}s;animation-delay:${Math.round(delay)}ms${back ? ';animation-direction:reverse' : ''}"` : (shift ? ` stroke-dashoffset="42"` : '')) + '/>';
  };
  if (spec.dir === 'both') return one(false, 0) + one(true, 0.5);
  return one(spec.dir === 'back', 0);
}
function edgeInner(e, g, th, colour, { sel = false, hideLabel = false, note, hit = false, packets = '' } = {}) {
  const c = sel ? th.accent : colour, dash = DASH_ARRAY[e.dash] ? ` stroke-dasharray="${DASH_ARRAY[e.dash]}"` : '';
  const words = noteText(note) || e.text || (e.verb ? String(e.verb) : '');
  let s = (hit ? `<path d="${g.d}" fill="none" stroke="transparent" stroke-width="14"/>` : '') +
    `<path class="dg-l" d="${g.d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
  s += packets;
  if (g.head) s += `<path d="${g.head}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
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
  const lx = frontierLabelX(d);
  if (fr.label && !hideLabel) s += textSVG([upper(fr.label)], lx, y + 8, 12, 20, th.frameInk, { anchor: 'start', spacing: '.08em' });
  if (fr.out) s += textSVG([upper(fr.out)], lx, y - 28, 12, 20, th.alt, { anchor: 'start', spacing: '.08em' });
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
function shields(d, geoms, th, nodes = d.nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n])), fr = d.frontier && num(d.frontier.y) !== null ? d.frontier : null;
  const groups = nodes.filter((n) => isFrame(n) && frameStyle(n) !== 'none').sort((a, b) => a.w * a.h - b.w * b.h);
  let s = '';
  for (const e of d.edges) {
    const a = byId.get(e.from), b = byId.get(e.to), g = geoms.get(e.id);
    if (!a || !b || !g || !!a.outside === !!b.outside) continue;
    let p = null;
    if (fr) p = meet(g.poly, 'y', fr.y, -Infinity, Infinity);
    else {
      const inner = ext(a.outside ? b : a), box0 = groups.find((G) => inner.x >= G.x && inner.y >= G.y && inner.x + inner.w <= G.x + G.w && inner.y + inner.h <= G.y + G.h);
      if (box0) p = meet(g.poly, 'y', box0.y, box0.x, box0.x + box0.w) || meet(g.poly, 'y', box0.y + box0.h, box0.x, box0.x + box0.w) || meet(g.poly, 'x', box0.x, box0.y, box0.y + box0.h) || meet(g.poly, 'x', box0.x + box0.w, box0.y, box0.y + box0.h);
    }
    if (p) s += shieldSVG(p.x, p.y, th);
  }
  return s;
}
const wordsOf = (notes) => (e) => noteText(notes['edge:' + e.id]) || e.text || (e.verb ? String(e.verb) : '');

// The whole drawing (no UI), in diagram coordinates; used by thumbnails.
// opts.budget (ms): a thumbnail of a very big diagram stops detouring when its time is up; the route cache that
// thumbnails share finishes the job on the next call (such a thumbnail is not kept in the thumbnail cache).
const thumbRoutes = new Map();
let sceneIncomplete = false;
function sceneSVG(d, th, reading, { budget = Infinity, cache = null } = {}) {
  if (cache && cache.size > 4000) cache.clear();
  const notes = notesOf(d, reading), geoms = routeAll(d, d.nodes, { words: wordsOf(notes), notes, cache, deadline: performance.now() + budget }), byId = new Map(d.nodes.map((n) => [n.id, n]));
  sceneIncomplete = !!geoms.incomplete;
  const ctx = { byId, nodes: d.nodes, edges: d.edges };
  const g = (n) => `<g transform="translate(${n.x},${n.y})">${nodeInner(n, th, { note: notes[n.id], ctx, noteAt: geoms.noteAt?.get(n.id) })}</g>`;
  return d.nodes.filter(isFrame).map(g).join('') + frontierSVG(d, th) +
    d.edges.map((e) => (geoms.has(e.id) ? edgeInner(e, geoms.get(e.id), th, edgeColour(e, byId, th, noteTone(notes['edge:' + e.id], th)), { note: notes['edge:' + e.id] }) : '')).join('') +
    shields(d, geoms, th) + d.nodes.filter((n) => !isFrame(n)).map(g).join('');
}
function notesOf(d, reading) {
  const r = Array.isArray(d.readings) ? d.readings[reading] : undefined;
  return (r !== undefined && d.notes && typeof d.notes === 'object' && d.notes[r] && typeof d.notes[r] === 'object') ? d.notes[r] : {};
}

/// A piece drawn small, for the palette, the gallery, the bar and the legend. Every catalogue id works.
const MINI_COLOUR = { box: PALETTE[0], ellipse: PALETTE[4], diamond: PALETTE[0], note: PALETTE[3], callout: PALETTE[7], step: PALETTE[3], connector: PALETTE[5], 'start-end': PALETTE[2], io: PALETTE[1], subprocess: PALETTE[4], delay: PALETTE[0], prep: PALETTE[5], manual: PALETTE[3] };
const miniCache = new Map();
function miniSVG(shape, th, size = 30) {
  const key = (th === THEME.dark ? 'd' : 'l') + shape + '|' + size;
  if (!miniCache.has(key)) miniCache.set(key, miniDraw(shape, th, size));
  return miniCache.get(key);
}
function miniDraw(shape, th, size) {
  const line = (d, c = th.muted, w = 1.7) => `<svg viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (shape === 'frontier') return `<svg viewBox="-2 -2 ${size + 4} ${size + 4}"><path d="M0,${f(size * 0.6)}H${size}" stroke="${th.frame}" stroke-width="1.6" stroke-dasharray="5 4"/>${shieldSVG(size / 2, size * 0.58, th, 0.8)}</svg>`;
  if (shape === 'text') return line('M6 6.5V5h12v1.5M12 5v14M9.5 19h5');
  if (shape === 'title') return line('M5 7V5h14v2M12 5v14M9 19h6', th.ink, 2.3);
  if (shape === 'legend') {
    const T = th.tint;
    return `<svg viewBox="0 0 24 24"><rect x="2.5" y="3.5" width="19" height="17" rx="3" fill="${mix(th.bg, th.ink, 0.03)}" stroke="${th.frame}" stroke-width="1.2"/>` +
      `<rect x="5.5" y="7" width="4" height="4" rx="1" fill="${T.slate.f}" stroke="${T.slate.s}" stroke-width="1"/><circle cx="7.5" cy="15.5" r="2" fill="${T.teal.f}" stroke="${T.teal.s}" stroke-width="1"/>` +
      `<path d="M12 9h6.5M12 15.5h5" stroke="${th.muted}" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }
  if (FRAME_SET.has(shape)) {
    const s = 22, FT = SYMS[shape]?.ftint ? th.tint[SYMS[shape].ftint] : null, c = FT ? FT.s : th.frame;
    let in_ = shape === 'lane'
      ? `<rect x="1" y="4" width="${s}" height="${s - 6}" rx="1.5" fill="none" stroke="${th.frame}" stroke-width="1.3"/><path d="M7 4v${s - 6}" stroke="${th.frame}" stroke-width="1.3"/><rect x="1.6" y="4.6" width="4.8" height="${s - 7.2}" fill="${mix(th.frame, th.bg, 0.8)}"/>`
      : `<rect x="1" y="2" width="${s}" height="${s - 2}" rx="5" fill="none" stroke="${c}" stroke-width="1.4" stroke-dasharray="3.6 2.8"/>`;
    if (SYMS[shape]?.glyph && shape !== 'lane') in_ += frameGlyph(shape, 5, 6, FT ? FT.g : th.frameInk).replace(/stroke-width="[\d.]+"/, 'stroke-width="2"');
    return `<svg viewBox="-1 -1 26 26">${in_}</svg>`;
  }
  const sym = SYMS[drawAs(shape)], cat = isCatalogueSymbol(drawAs(shape));
  const [dw, dh] = SIZE[shape], k = Math.min(size / dw, size / dh) * (isClassic(shape) || shape === 'operation' ? 1 : 0.92);
  const w = Math.max(10, Math.round(dw * k)), h = Math.max(10, Math.round(dh * k));
  const n = { id: 'mini-' + shape, shape, w, h, text: shape === 'step' ? '1' : '', color: MINI_COLOUR[shape] || PALETTE[0], _px: (size + 6) / size };
  if (shape === 'callout') { n.w = w; n.h = Math.round(h * 0.72); n.tip = { dx: Math.round(w * 0.22), dy: Math.round(h * 0.26) }; }
  const inner = cat && sym ? drawSymbol({ ...n, shape: drawAs(shape) }, tintFor(drawAs(shape), th)) : nodeInner(n, th).replace(/ style="filter:[^"]*"/, '');
  return `<svg viewBox="${f((w - size) / 2 - 3)} ${f((h - size) / 2 - 3)} ${size + 6} ${size + 6}">${inner}</svg>`;
}

// ---------- thumbnail ----------

const thumbCache = new Map();
export function diagramThumbSVG(data, w = 240, h = 160) {
  let key = null;
  try { key = w + 'x' + h + '|' + hash(typeof data === 'string' ? data : JSON.stringify(data)); } catch { /* unserialisable: no cache */ }
  if (key && thumbCache.has(key)) { const v = thumbCache.get(key); thumbCache.delete(key); thumbCache.set(key, v); return v; }
  const { d } = normalize(data), th = themeOf(d);
  const bg = d.theme === 'dark' ? `<rect width="${w}" height="${h}" fill="${th.bg}"/>` : '';
  const head = `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}`;
  let b = bounds(d.nodes, true), out;
  sceneIncomplete = false;
  if (!b) out = head + '</svg>';
  else {
    if (d.frontier && num(d.frontier.y) !== null) { const y0 = Math.min(b.y, d.frontier.y - 40), y1 = Math.max(b.y + b.h, d.frontier.y + 30); b = { ...b, y: y0, h: y1 - y0 }; }
    const pad = 8, s = Math.min((w - 2 * pad) / b.w, (h - 2 * pad) / b.h, 1);
    const tx = w / 2 - (b.x + b.w / 2) * s, ty = h / 2 - (b.y + b.h / 2) * s;
    out = `${head}<g transform="translate(${f(tx)},${f(ty)}) scale(${s.toFixed(4)})">${sceneSVG(d, th, 0, { budget: 80, cache: thumbRoutes })}</g></svg>`;
  }
  if (key && !sceneIncomplete) { thumbCache.set(key, out); if (thumbCache.size > 16) thumbCache.delete(thumbCache.keys().next().value); }
  return out;
}

// ---------- editor ----------
//
// Sections, in order: state and DOM · history (one undo step per action, undo glides back) · geometry helpers ·
// drawing (nodes, edges, overlay: halos, dots, handles, guides, previews) · actions (one table: every bar button, menu
// row and key runs through it, and each can be previewed on a scratch copy) · arranging (align, distribute, same size,
// group, order, lock, style, tidy) · the contextual bar and its popovers · text editing (text never gets lost) ·
// creating and quick-connect · clipboard · safe delete · view · pointer gestures · keyboard (one table, which also
// draws the «?» overlay) · context menu · life.

export function createDiagram(container, { data: initial, onChange, title, panOnDrag = false } = {}) {
  let { d: data, fixed } = normalize(initial);
  const view = { x: 0, y: 0, k: 1 };
  let selN = new Set(), selE = new Set(), selF = false, keyId = null;
  let hover = null, hoverE = null, hoverG = null, hoverLong = false, hoverTimer = 0, flowHover = null, flowTimer = 0;
  let mode = null, editing = null, typeahead = null, spaceHeld = false, reading = 0;
  let undo = [], redo = [], lastTag = null, lastTime = 0;
  let clip = null, pasteN = 0, styleClip = null, brush = null;
  let pv = null;                                       // a preview: { data } re-rendered, { ghosts } outlines, { wash } victims
  const tweens = new Map(), follow = new Map();        // what is drawn while it glides (data already holds the target)
  const fresh = new Set(), freshBase = new Map();      // pieces created here and never written on (and the state before them)
  const vanishable = new Set();                        // boxes made by a double-click on empty space: Esc on them empty takes them away
  const style = { shape: 'box', color: PALETTE[0] };   // what a new box looks like: the last choice made
  let raf = 0, timer = 0, anim = 0, fitted = false, geoms = new Map(), geomKey = '', barKey = '', chromeKey = '', barShownAt = 0, barSel = '';
  const routeCache = new Map();
  let pointer = null;                                  // last pointer position over the canvas, null when outside
  let lastAlign = null, lastDist = null, confirmDel = null, flash = null, lockPulse = null, pillTimer = 0, sayTimer = 0;
  let palOpen = true, snapOn = true;
  // motion is the viewer's preference (never in the data): on unless he paused it or asked the system for less motion
  let motionPref = null;
  try { motionPref = localStorage.getItem('meadow.dg.motion'); } catch { /* storage may be blocked */ }
  const motionOn = () => motionPref === 'on' || (motionPref !== 'off' && !reducedMotion());
  let show = null;                                     // the presentation, while it runs
  try { palOpen = localStorage.getItem('meadow.dg.palette') !== 'off'; snapOn = localStorage.getItem('meadow.dg.snap') !== 'off'; } catch { /* storage may be blocked */ }

  const root = document.createElement('div');
  root.className = 'dg';
  root.tabIndex = 0;
  root.innerHTML = `<svg class="dg-svg" xmlns="${NS}"><g class="dg-world"><g class="dg-groups"></g><g class="dg-front"></g><g class="dg-edges"></g><g class="dg-shields"></g><g class="dg-under"></g><g class="dg-nodes"></g><g class="dg-over"></g><g class="dg-fade"></g></g>` +
    '<rect class="dg-band" visibility="hidden"/></svg><div class="dg-hint"></div>' +
    (title ? `<div class="dg-title">${esc(title)}</div>` : '') +
    '<div class="dg-pal"></div><div class="dg-gal" hidden></div><div class="dg-quick" hidden></div><div class="dg-reads" hidden></div><div class="dg-bar" hidden></div><div class="dg-pop" hidden></div><div class="dg-menu" hidden></div>' +
    `<button class="dg-back" hidden data-tip="Encajar todo" data-key="Mayús+1">${lineIcon('home')}<span>Volver al dibujo</span></button>` + '<div class="dg-steps" hidden></div><div class="dg-tip" hidden></div><div class="dg-say" hidden></div><div class="dg-pill" hidden></div><div class="dg-help" hidden></div>' +
    `<div class="dg-zoom"><button data-z="help" data-tip="Atajos" data-key="?">${lineIcon('help')}</button><button data-z="tidy" data-tip="Ordenar" data-key="Alt+T">${lineIcon('tidy')}</button>` +
    `<button data-z="motion" hidden></button><button data-z="present" data-tip="Presentar" data-key="F5">${lineIcon('present')}</button><button data-z="theme"></button><button data-z="fit" data-tip="Encajar" data-key="Mayús+1">${lineIcon('fit')}</button><button data-z="one" data-tip="Tamaño real" data-key="Ctrl+0"></button></div>`;
  container.append(root);
  const $ = (s) => root.querySelector(s);
  const svg = $('.dg-svg'), world = $('.dg-world'), groupLayer = $('.dg-groups'), frontLayer = $('.dg-front'), edgeLayer = $('.dg-edges');
  const shieldLayer = $('.dg-shields'), underLayer = $('.dg-under'), nodeLayer = $('.dg-nodes'), over = $('.dg-over'), fadeLayer = $('.dg-fade');
  const band = $('.dg-band'), hint = $('.dg-hint'), bar = $('.dg-bar'), pal = $('.dg-pal'), reads = $('.dg-reads'), zoomOne = $('[data-z="one"]'), themeBtn = $('[data-z="theme"]');
  const pop = $('.dg-pop'), menu = $('.dg-menu'), tip = $('.dg-tip'), say = $('.dg-say'), pill = $('.dg-pill'), help = $('.dg-help');
  const nodeEls = new Map(), edgeEls = new Map();
  const backBtn = $('.dg-back');
  backBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  backBtn.addEventListener('click', () => { fitView(); root.focus({ preventScroll: true }); });

  const th = () => themeOf(data);
  const index = (D = data) => new Map(D.nodes.map((n) => [n.id, n]));
  const snap = () => JSON.stringify(data);
  const getData = () => JSON.parse(snap());
  const notes = () => notesOf(data, reading);
  const now = () => performance.now();
  const selNodes = (D = data) => D.nodes.filter((n) => selN.has(n.id));
  const pieces = (D = data) => selNodes(D).filter((n) => !isFrame(n));

  function newId(prefix, D = data) {
    const used = new Set([...D.nodes, ...D.edges].map((x) => x.id));
    let i = D.nodes.length + D.edges.length + 1;
    while (used.has(prefix + i)) i++;
    return prefix + i;
  }

  // ----- history and saving -----

  function scheduleChange() { clearTimeout(timer); timer = setTimeout(flush, 300); }
  function flush() { timer = 0; onChange?.(getData()); }

  // Records the state from before an edit; edits with the same tag in quick succession (nudges) make one step.
  // The selection each history state was left with, so undo and redo come back to what he was working on (and not to
  // everything that a push happened to move).
  const selAt = new Map();
  const rememberSel = (k) => { selAt.set(k, { n: [...selN], e: [...selE] }); if (selAt.size > 700) selAt.delete(selAt.keys().next().value); };
  function commit(before, tag = null) {
    if (before === null || before === snap()) return false;
    const t = Date.now();
    if (!(tag && tag === lastTag && t - lastTime < 1000)) { undo.push(before); rememberSel(before); if (undo.length > 300) undo.shift(); }
    lastTag = tag; lastTime = t; redo = [];
    scheduleChange();
    hidePill(true);
    return true;
  }
  // Every action: one undo step; `glide` lets the pieces that moved travel to their new place so he sees what moved.
  function edit(fn, tag, { glide = false } = {}) {
    const before = snap(), geo = glide ? geometry(data) : null;
    fn();
    if (glide) glideFrom(geo);
    commit(before, tag);
    paint();
  }
  const geometry = (D) => new Map(D.nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
  function glideFrom(geo, { dur = DUR.snap, ease = EASES.snap } = {}) {
    if (reducedMotion() || !geo) return;
    const t0 = now();
    let count = 0;
    for (const n of data.nodes) {
      const a = geo.get(n.id);
      if (!a || (a.x === n.x && a.y === n.y && a.w === n.w && a.h === n.h)) continue;
      if (++count > 400) { tweens.clear(); return; }
      const cur = shownGeom(n.id, t0) || a;
      tweens.set(n.id, { from: { ...cur }, t0, dur, ease });
    }
  }
  function shownGeom(id, t) {
    const tw = tweens.get(id);
    if (!tw) { const fo = follow.get(id); return fo ? { ...fo } : null; }
    const n = data.nodes.find((x) => x.id === id);
    if (!n) return null;
    const e = tw.ease(clamp((t - tw.t0) / tw.dur, 0, 1));
    return { x: tw.from.x + (n.x - tw.from.x) * e, y: tw.from.y + (n.y - tw.from.y) * e, w: tw.from.w + (n.w - tw.from.w) * e, h: tw.from.h + (n.h - tw.from.h) * e };
  }

  function prune() {
    const n = new Set(data.nodes.map((x) => x.id)), e = new Set(data.edges.map((x) => x.id));
    selN = new Set([...selN].filter((id) => n.has(id)));
    selE = new Set([...selE].filter((id) => e.has(id)));
    selF = selF && !!data.frontier;
    if (keyId && !selN.has(keyId)) keyId = null;
    hover = null; hoverE = null; hoverG = null;
  }
  // Undo and redo glide the changed pieces back, and select what the step touched.
  function step(from, to) {
    if (!from.length) return;
    if (editing) finishEdit();
    const old = data, geo = geometry(old), cur = snap();
    rememberSel(cur);
    to.push(cur);
    const back = from.pop();
    data = JSON.parse(back);
    const kept = selAt.get(back);
    lastTag = null;
    const was = new Map(old.nodes.map((n) => [n.id, JSON.stringify(n)])), wasE = new Map(old.edges.map((e) => [e.id, JSON.stringify(e)]));
    const touchedN = data.nodes.filter((n) => was.get(n.id) !== JSON.stringify(n)).map((n) => n.id);
    const touchedE = data.edges.filter((e) => wasE.get(e.id) !== JSON.stringify(e)).map((e) => e.id);
    // what changed is selected, but a frame that only grew around one of its pieces is not: selecting it too would
    // make the next drag of that piece carry the whole frame. A frame that moved with everything in it stays selected
    // alone (it carries its pieces).
    const sel = new Set(touchedN);
    for (const g of data.nodes.filter((n) => isFrame(n) && sel.has(n.id)).sort((a, b) => b.w * b.h - a.w * a.h)) {
      if (!sel.has(g.id)) continue;
      const inside = contentsOf(g, data.nodes);
      if (inside.length && inside.every((n) => sel.has(n.id))) for (const n of inside) sel.delete(n.id);
      else if (inside.some((n) => sel.has(n.id))) sel.delete(g.id);
    }
    selN = sel; selE = new Set(touchedE); selF = false;
    if (kept) {                                          // what he had selected when he did it, if it is still there
      const ids = new Set(data.nodes.map((n) => n.id)), eids = new Set(data.edges.map((e) => e.id));
      const n = kept.n.filter((id) => ids.has(id)), e = kept.e.filter((id) => eids.has(id));
      if (n.length || e.length) { selN = new Set(n); selE = new Set(e); }
    }
    glideFrom(geo, { dur: DUR.smooth, ease: EASES.smooth });
    prune(); scheduleChange(); hidePill(true); paint();
  }
  const clearSel = () => { selN = new Set(); selE = new Set(); selF = false; keyId = null; };
  const select = (ids = [], eids = []) => { selN = new Set(ids); selE = new Set(eids); selF = false; keyId = null; };

  // ----- geometry helpers -----

  const isLocked = (x) => x?.locked === true;
  const viewRect = (m = 0) => ({ x: (-view.x) / view.k - m, y: (-view.y) / view.k - m, w: root.clientWidth / view.k + 2 * m, h: root.clientHeight / view.k + 2 * m });
  const toScreen = (x, y) => ({ x: view.x + x * view.k, y: view.y + y * view.k });
  function blockers(D = data, skip = new Set()) {
    const h = new SpatialHash();
    for (const n of D.nodes) if (!isFrame(n) && !skip.has(n.id)) h.insert(n.id, blockRect(n));
    return h;
  }
  // The topmost piece under a point (frames are not pieces).
  function nodeAt(p, m = 0, D = data) {
    for (let i = D.nodes.length - 1; i >= 0; i--) {
      const n = D.nodes[i];
      if (isFrame(n)) continue;
      const e = ext(n);
      if (p.x >= e.x - m && p.x <= e.x + e.w + m && p.y >= e.y - m && p.y <= e.y + e.h + m) return n;
    }
    return null;
  }
  // The smallest frame holding a point, leaving out some (the ones being moved).
  function frameAt(p, skip = new Set()) {
    let best = null;
    for (const g of data.nodes) if (isFrame(g) && !skip.has(g.id) && p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h && (!best || g.w * g.h < best.w * best.h)) best = g;
    return best;
  }
  // The arrow nearest a point (within tol units), and where on it.
  function edgeNear(p, tol, skip = null, G = geoms) {
    let best = null;
    for (const e of data.edges) {
      if (skip && skip(e)) continue;
      const g = G.get(e.id);
      if (!g) continue;
      const P = g.poly;
      for (let i = 1; i < P.length; i++) {
        const A = P[i - 1], B = P[i], dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
        const t = clamp(((p.x - A.x) * dx + (p.y - A.y) * dy) / l2, 0, 1), x = A.x + dx * t, y = A.y + dy * t, d = Math.hypot(p.x - x, p.y - y);
        if (d <= tol && (!best || d < best.d)) best = { e, d, x, y, seg: [A, B] };
      }
    }
    return best;
  }
  // Moves a piece; a frame carries what lies inside it.
  function moveBy(D, ids, dx, dy) {
    const moved = new Set();
    for (const id of ids) {
      const n = D.nodes.find((x) => x.id === id);
      if (!n || moved.has(n.id)) continue;
      const list = isFrame(n) ? [n, ...contentsOf(n, D.nodes)] : [n];
      for (const m of list) if (!moved.has(m.id) && !(m !== n && isLocked(m))) { m.x = Math.round(m.x + dx); m.y = Math.round(m.y + dy); moved.add(m.id); }
    }
    return moved;
  }
  // After arranging: whatever now sits under what moved steps aside, and frames wrap what they hold.
  // Two pieces joined by an arrow keep room for it between them when one pushes the other.
  const LINK_GAP = 56;
  function linkGap(D) {
    const s = new Set();
    for (const e of D.edges) { s.add(e.from + '>' + e.to); s.add(e.to + '>' + e.from); }
    return (a, b) => (s.has(a + '>' + b) ? LINK_GAP : 16);
  }
  function settle(D, moved) {
    const ids = new Set(moved);
    const movers = D.nodes.filter((n) => ids.has(n.id) && !isFrame(n)).map((n) => ({ id: n.id, r: blockRect(n) }));
    const others = D.nodes.filter((n) => !ids.has(n.id) && !isFrame(n)).map((n) => ({ id: n.id, r: blockRect(n) }));
    if (movers.length && others.length) {
      const disp = pushApart(movers, others, { C: 16, CMax: LINK_GAP, gap: linkGap(D), fixed: new Set(D.nodes.filter(isLocked).map((n) => n.id)) });
      for (const [id, v] of disp) { const n = D.nodes.find((x) => x.id === id); n.x = Math.round(n.x + v.dx); n.y = Math.round(n.y + v.dy); }
    }
    growFrames(D.nodes);
  }

  // ----- drawing -----

  const paint = () => { if (!raf) raf = requestAnimationFrame(draw); };

  // What is drawn: the data (or a preview of it), with gliding pieces at their in-between place.
  function shownNodes(D, t) {
    if (!tweens.size && !follow.size) return D.nodes;
    for (const [id, tw] of tweens) if (t - tw.t0 >= tw.dur) tweens.delete(id);
    return D.nodes.map((n) => { const s = D === data ? shownGeom(n.id, t) : null; return s ? { ...n, ...s } : n; });
  }
  function stepFollow(dt) {                             // pushed pieces ease toward their target, never overshooting
    const a = 1 - Math.exp(-dt / 70), map = index();
    for (const [id, s] of follow) {
      const n = map.get(id);
      if (!n) { follow.delete(id); continue; }
      s.x += (n.x - s.x) * a; s.y += (n.y - s.y) * a; s.w = n.w; s.h = n.h;
      if (Math.abs(n.x - s.x) < 0.4 && Math.abs(n.y - s.y) < 0.4) follow.delete(id);
    }
  }
  let lastDraw = 0, drawnOnce = false;
  // A new arrow draws itself from its source, then its head and words fade in; a single packet confirms the direction.
  function drawOn(el, e, g, confirm) {
    const line = el.querySelector('.dg-l'), L = polyLength(g.poly);
    if (line && !DASH_ARRAY[e.dash] && L > 8) {
      line.style.strokeDasharray = `${L} ${L}`;
      const a = line.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: DUR.smooth, easing: EASE.smooth });
      a.onfinish = a.oncancel = () => { line.style.strokeDasharray = ''; };
    }
    for (const c of el.children) {
      if (c === line || c.getAttribute('stroke') === 'transparent' || c.getAttribute('fill') === 'transparent' || c.classList.contains('dg-flow')) continue;
      c.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: DUR.smooth, easing: EASE.smooth });
    }
    if (confirm) setTimeout(() => onePacket(e, 600), DUR.smooth);
  }
  // One packet along an arrow, once (the confirmation of a new line, the step of a presentation).
  function onePacket(e, dur = 700) {
    const g = geoms.get(e.id), pp = g && packetPath(g, ROUTES.includes(e.route) ? e.route : (g.curve ? 'curve' : 'elbow'), e.head);
    if (!pp || reducedMotion()) return;
    const T = th(), el = document.createElementNS(NS, 'path');
    el.setAttribute('d', pp.d); el.setAttribute('fill', 'none'); el.setAttribute('stroke-width', '4.5'); el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke', packetColour(edgeColour(e, index(), T, null), data.theme === 'dark', T.ink));
    el.setAttribute('stroke-dasharray', `10 ${Math.ceil(pp.len + 40)}`);
    fadeLayer.append(el);
    el.animate([{ strokeDashoffset: 10 }, { strokeDashoffset: -pp.len }], { duration: dur, easing: EASE.smooth }).onfinish = () => el.remove();
  }
  function draw() {
    cancelAnimationFrame(raf); raf = 0;
    const t = now(), dt = Math.min(64, t - (lastDraw || t));
    lastDraw = t;
    if (follow.size) stepFollow(dt || 16);
    if (data.nodes.some(isLegend) && fitLegends(data) && !mode) settle(data, data.nodes.filter(isLegend).map((n) => n.id));   // a legend follows what the diagram uses, and makes room
    if (pv?.data?.nodes.some(isLegend)) fitLegends(pv.data);
    const D = pv?.data || data, nodes = shownNodes(D, t);
    const k = view.k, T = th(), dark = data.theme === 'dark', N = notesOf(D, reading), byId = new Map(nodes.map((n) => [n.id, n]));
    root.classList.toggle('dg-dark', dark);
    world.setAttribute('transform', `translate(${f(view.x)},${f(view.y)}) scale(${k})`);
    const grid = 24 * k * (k < 0.25 ? 4 : k < 0.5 ? 2 : 1);
    root.style.backgroundSize = `${grid}px ${grid}px`;
    root.style.backgroundPosition = `${view.x}px ${view.y}px`;
    paintChrome();

    // nodes: keyed, redrawn only when their look changes; groups sit behind everything
    const aliveN = new Set(nodes.map((n) => n.id));
    for (const [id, rec] of nodeEls) if (!aliveN.has(id)) { rec.el.remove(); nodeEls.delete(id); }
    let gi = 0, ni = 0;
    const dimmed = mode?.type === 'move' && mode.dupOf ? mode.dupOf : null;
    const byIdN = new Map(nodes.map((n) => [n.id, n])), ctx = { byId: byIdN, nodes, edges: D.edges };
    const legendKey = nodes.some(isLegend) ? JSON.stringify([[...new Set(nodes.map((n) => n.shape))], [...new Set(D.edges.map((e) => e.dash))]]) : '';
    const born = [], hovEnds = new Set();
    if (hoverE && !mode && !editing) { const he = D.edges.find((x) => x.id === hoverE); if (he) { hovEnds.add(he.from); hovEnds.add(he.to); } }
    for (const n of nodes) {
      let rec = nodeEls.get(n.id);
      if (!rec) {
        const el = document.createElementNS(NS, 'g');
        el.setAttribute('data-n', n.id);
        rec = { el, sig: '', pos: '' };
        nodeEls.set(n.id, rec);
        if (drawnOnce && !pv) born.push(rec);
      }
      const hidden = (editing?.kind === 'node' && editing.id === n.id), note = N[n.id];
      const { x: _x, y: _y, locked: _l, kids: _k, ...look } = n;
      const tgt = n.shape === 'callout' && n.to !== undefined ? byIdN.get(String(n.to)) : null;
      const pulse = n.status === 'bad' ? (motionOn() ? 'live' : 'still') : null;
      const sig = JSON.stringify([data.theme, look, hidden, note, tgt && [tgt.x - n.x, tgt.y - n.y, tgt.w, tgt.h, tgt.shape], isLegend(n) && legendKey, pulse]);
      if (rec.sig !== sig) {
        // the drawing sits in an inner wrapper, so it can scale and fade (appear, settle) under the outer translate
        rec.el.innerHTML = `<g class="dg-in">${nodeInner(n, T, { hideText: hidden, note, hit: true, ctx, pulse })}${hidden ? '' : placeholderSVG(n, T)}</g>`;
        rec.sig = sig;
      }
      const pos = `translate(${f(n.x)},${f(n.y)})`;
      if (rec.pos !== pos) { rec.el.setAttribute('transform', pos); rec.pos = pos; }
      rec.el.classList.toggle('dg-locked', isLocked(n));
      rec.el.classList.toggle('dg-dimmed', !!dimmed?.has(n.id));
      rec.el.classList.toggle('dg-nf', isFrame(n) && frameStyle(n) === 'none');
      // what the pointer is about to touch glows; while presenting, what comes later waits faint
      const calm = !show && !mode && !editing && !isFrame(n);
      rec.el.classList.toggle('dg-hov', calm && hover === n.id && !isLocked(n));
      rec.el.classList.toggle('dg-hov2', calm && hover !== n.id && hovEnds.has(n.id));
      const ghost = !!show && !isFrame(n) && (!show.seen.has(n.id) || (show.cur.has(n.id) && t < show.arrive));
      rec.el.classList.toggle('dg-ghost', ghost);
      rec.el.classList.toggle('dg-cur', !!show && !ghost && show.cur.has(n.id));
      const layer = isFrame(n) ? groupLayer : nodeLayer, i = isFrame(n) ? gi++ : ni++;
      if (layer.children[i] !== rec.el) layer.insertBefore(rec.el, layer.children[i] || null);
    }

    // edges, the frontier and its shields
    const gk = JSON.stringify([nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.shape, n.text, n.sub, n.status, n.clock?.words, !!n.clock, n.frame, n.size, n.form, n.labelAt, n.count]), D.edges, D.frontier, N]);
    if (gk !== geomKey) {
      geoms = routeAll(D, nodes, { cache: routeCache, words: wordsOf(N), notes: N, deadline: t + (mode ? 7 : 60) });
      geomKey = geoms.incomplete ? '' : gk;
    }
    for (const n of nodes) {
      if (!N[n.id]) continue;
      const el = nodeEls.get(n.id)?.el.querySelector('.dg-note'), o = geoms.noteAt?.get(n.id), tf = o ? `translate(${f(o.dx)},${f(o.dy)})` : '';
      if (el && (el.getAttribute('transform') || '') !== tf) { if (tf) el.setAttribute('transform', tf); else el.removeAttribute('transform'); }
    }
    const aliveE = new Set(D.edges.filter((e) => geoms.has(e.id)).map((e) => e.id));
    for (const [id, rec] of edgeEls) if (!aliveE.has(id)) { rec.el.remove(); edgeEls.delete(id); }
    const vr = viewRect(100 / k), flowing = D.edges.filter((e) => e.flow).length;
    const live = motionOn() && k >= 0.4 && flowing <= 120 && !show?.hold;
    const nearE = new Set(), hn = hoverLong && !mode ? hover : null;
    if (hn) for (const e of D.edges) if (e.from === hn || e.to === hn) nearE.add(e.id);
    let ei = 0;
    const bornE = [];
    for (const e of D.edges) {
      const g = geoms.get(e.id);
      if (!g) continue;
      let rec = edgeEls.get(e.id);
      if (!rec) {
        const el = document.createElementNS(NS, 'g');
        el.setAttribute('data-e', e.id);
        rec = { el, sig: '' };
        edgeEls.set(e.id, rec);
        if (drawnOnce && !pv) bornE.push([rec, e, g]);
      }
      const sel = selE.has(e.id), hidden = editing?.kind === 'edge' && editing.id === e.id, note = N['edge:' + e.id];
      const colour = edgeColour(e, byId, T, noteTone(note, T));
      const force = !e.flow && ((flowHover && e.from === flowHover) || show?.visited?.has(e.id) && show.flowAll) ? flowSpec({ flow: true }) : null;
      const spec = show && !show.visited.has(e.id) ? null : (force || flowSpec(e)), src = byId.get(e.from);
      const seen = !spec || (() => { const P = g.poly; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of P) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return overlaps({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, vr); })();
      const sig = JSON.stringify([data.theme, g.d, g.head, g.lx, g.ly, e.dash, sel, hidden ? '' : e.text, e.verb, note, colour, spec && seen && [spec, live, src?.status, e.route, e.head]]);
      if (rec.sig !== sig) {
        const packets = spec && seen ? packetsSVG(e, g, T, colour, { live, src, dark, force }) : '';
        rec.el.innerHTML = edgeInner(e, g, T, colour, { sel, hideLabel: hidden, note, hit: true, packets });
        rec.sig = sig;
      }
      rec.el.classList.toggle('dg-near', nearE.has(e.id));
      rec.el.classList.toggle('dg-hov', hoverE === e.id && !mode);
      rec.el.classList.toggle('dg-flash', flash?.id === e.id && t - flash.t < 320);
      rec.el.classList.toggle('dg-ghost', !!show && !show.visited.has(e.id));
      if (edgeLayer.children[ei] !== rec.el) edgeLayer.insertBefore(rec.el, edgeLayer.children[ei] || null);
      ei++;
    }
    // what was just made arrives softly: pieces grow in, arrows draw themselves and carry one packet to say which way
    if (born.length) for (const rec of born) tactile(born.length > 40 ? 'fadein' : 'appear', rec.el.firstElementChild);
    if (bornE.length && bornE.length <= 40 && !reducedMotion()) for (const [rec, e, g] of bornE) drawOn(rec.el, e, g, bornE.length <= 3);
    drawnOnce = true;
    frontLayer.innerHTML = frontierSVG(D, T, { hit: true, sel: selF, hideLabel: editing?.kind === 'frontier' });
    shieldLayer.innerHTML = shields(D, geoms, T, nodes);

    underLayer.innerHTML = halos(byId);
    over.innerHTML = overlay(byId);
    if (mode?.type === 'band') {
      const x = Math.min(mode.a.sx, mode.b.sx), y = Math.min(mode.a.sy, mode.b.sy);
      band.setAttribute('x', x); band.setAttribute('y', y);
      band.setAttribute('width', Math.abs(mode.a.sx - mode.b.sx)); band.setAttribute('height', Math.abs(mode.a.sy - mode.b.sy));
      band.setAttribute('visibility', 'visible');
      band.classList.toggle('dg-band-touch', mode.b.sx < mode.a.sx);
    } else band.setAttribute('visibility', 'hidden');
    hint.hidden = data.nodes.length > 0 || !!editing;
    // never lost: when the drawing is entirely out of view, one click glides back to it
    const all = data.nodes.length ? bounds(data.nodes, true) : null;
    backBtn.hidden = !all || !!mode || !!show || overlaps(all, viewRect(-40 / k));
    zoomOne.textContent = `${Math.round(k * 100)} %`;
    if (editing) placeEditor();
    placeBar();
    if (lens) paintLens();
    if (tweens.size || follow.size || geoms.incomplete || (flash && t - flash.t < 340) || (lockPulse && t - lockPulse.t < 220)) paint();
  }

  // The palette, the readings and the theme button change rarely: rebuilt only when what they show changes.
  function paintChrome() {
    const rs = Array.isArray(data.readings) ? data.readings.map(String) : [];
    if (reading >= rs.length) reading = 0;
    const quickIds = quickKinds(6);
    const key = JSON.stringify([data.theme, palOpen, rs, reading, quickIds, !!galMode, motionOn(), data.edges.some((e) => e.flow)]);
    if (key === chromeKey) return;
    chromeKey = key;
    const T = th(), dark = data.theme === 'dark';
    const item = (s, cls = '') => `<button${cls ? ` class="${cls}"` : ''} data-add="${s}" data-tip="${NAMES[s]}">${miniSVG(s, T)}</button>`;
    pal.classList.toggle('dg-pal-off', !palOpen);
    pal.innerHTML = `<button class="dg-pal-t" data-tip="${palOpen ? 'Recoger los símbolos' : 'Símbolos'}">${lineIcon('chev')}</button>` +
      (palOpen ? `<div class="dg-pal-g">${BASICS.map((s) => item(s)).join('')}<i></i>${quickIds.map((s) => item(s, 'dg-pal-q')).join('')}<i></i>` +
        `<button class="dg-pal-gal${galMode ? ' on' : ''}" data-tip="Galería de símbolos" data-key="Ctrl+/">${lineIcon('gallery')}</button></div>` : '');
    reads.hidden = !rs.length;
    reads.innerHTML = rs.map((r, i) => `<button data-r="${i}"${i === reading ? ' class="on"' : ''}>${esc(r)}</button>`).join('');
    themeBtn.innerHTML = lineIcon(dark ? 'sun' : 'moon');
    const mb = $('[data-z="motion"]'), anyFlow = data.edges.some((e) => flowSpec(e));
    mb.hidden = !anyFlow;
    mb.innerHTML = lineIcon(motionOn() ? 'pause' : 'play');
    mb.dataset.tip = motionOn() ? 'Pausar el movimiento' : 'Mover los datos';
    mb.dataset.key = 'M';
    themeBtn.dataset.tip = dark ? 'Tema claro' : 'Tema oscuro';
  }

  // The soft halo behind what the pointer is about to touch (no delay), and the faint ring on its neighbours.
  function halos(byId) {
    if (mode && mode.type !== 'connect' && mode.type !== 'reanchor') return '';
    const k = view.k, A = th().accent, out = [];
    const ring = (n, w, op) => {
      if (!n) return '';
      if (n.shape === 'diamond' || n.shape === 'capability') { const p = 3 / k; return `<path d="M${f(n.x + n.w / 2)},${f(n.y - p)}L${f(n.x + n.w + p)},${f(n.y + n.h / 2)}L${f(n.x + n.w / 2)},${f(n.y + n.h + p)}L${f(n.x - p)},${f(n.y + n.h / 2)}Z" fill="none" stroke="${A}" stroke-opacity="${op}" stroke-width="${f(w / k)}" stroke-linejoin="round"/>`; }
      if (ROUND.has(n.shape)) return `<ellipse cx="${f(n.x + n.w / 2)}" cy="${f(n.y + n.h / 2)}" rx="${f(n.w / 2 + 2 / k)}" ry="${f(n.h / 2 + 2 / k)}" fill="none" stroke="${A}" stroke-opacity="${op}" stroke-width="${f(w / k)}"/>`;
      const e = isFrame(n) ? box(n) : iconic(n) ? box(n) : ext(n);
      return `<rect x="${f(e.x - 2 / k)}" y="${f(e.y - 2 / k)}" width="${f(e.w + 4 / k)}" height="${f(e.h + 4 / k)}" rx="${f((n.shape === 'note' ? 5 : 11) + 2 / k)}" fill="none" stroke="${A}" stroke-opacity="${op}" stroke-width="${f(w / k)}"/>`;
    };
    if (mode?.type === 'connect' || mode?.type === 'reanchor') { if (mode.target) out.push(ring(byId.get(mode.target.id), 6, 0.22)); return out.join(''); }
    const h = byId.get(hover);
    if (h && !editing && !isLocked(h)) out.push(ring(h, 6, 0.16));
    if (h && hoverLong) for (const e of data.edges) { const o = e.from === h.id ? e.to : e.to === h.id ? e.from : null; if (o && o !== h.id) out.push(ring(byId.get(o), 1.4, 0.24)); }
    if (hoverE && !editing) { const e = data.edges.find((x) => x.id === hoverE); if (e) { const g = geoms.get(e.id); if (g) for (const p of [g.poly[0], g.poly[g.poly.length - 1]]) out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(5 / k)}" fill="none" stroke="${A}" stroke-opacity=".5" stroke-width="${f(1.4 / k)}"/>`); } }
    return out.join('');
  }

  // Selection outlines, connection dots, handles, guides and previews. Sizes are divided by the zoom so they look the
  // same at any zoom.
  function overlay(byId) {
    const k = view.k, s = (v) => f(v / k), T = th(), A = T.accent;
    const line = `fill="none" stroke="${A}" stroke-width="${s(1.3)}" stroke-dasharray="${s(5)} ${s(4)}"`;
    let h = '';
    const outlineOf = (n, attrs, pad = 5) => {
      const e = isFrame(n) ? box(n) : ext(n);
      return n.shape === 'ellipse'
        ? `<ellipse cx="${f(n.x + n.w / 2)}" cy="${f(n.y + n.h / 2)}" rx="${f(n.w / 2 + pad / k)}" ry="${f(n.h / 2 + pad / k)}" ${attrs}/>`
        : `<rect x="${f(e.x - pad / k)}" y="${f(e.y - pad / k)}" width="${f(e.w + 2 * pad / k)}" height="${f(e.h + 2 * pad / k)}" rx="${f((isFrame(n) ? 16 : n.shape === 'note' ? 4 : 10) + pad / k)}" ${attrs}/>`;
    };
    // what a delete would take, washed in the «bad» colour
    if (pv?.wash) {
      const B = T.bad;
      for (const id of pv.wash.nodes) { const n = byId.get(id); if (n) h += outlineOf(n, `fill="${B}" fill-opacity=".22" stroke="${B}" stroke-width="${s(1.5)}"`, 3); }
      for (const id of pv.wash.edges) { const g = geoms.get(id); if (g) h += `<path d="${g.d}" fill="none" stroke="${B}" stroke-opacity=".55" stroke-width="${s(5)}" stroke-linecap="round"/>`; }
    }
    // where things would go (align, distribute, tidy…)
    if (pv?.ghosts) for (const r of pv.ghosts) h += `<rect x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" rx="${f(8)}" fill="${A}" fill-opacity=".04" stroke="${A}" stroke-width="${s(1.2)}" stroke-dasharray="${s(5)} ${s(4)}"/>`;
    for (const id of selN) {
      const n = byId.get(id);
      if (!n) continue;
      h += outlineOf(n, line);
      if (keyId === id && selN.size > 1) h += outlineOf(n, `fill="none" stroke="${A}" stroke-width="${s(2)}"`, 9);
    }
    // a member of an invisible group is selected: the group shows as a faint outline
    for (const g of data.nodes) {
      if (!isFrame(g) || frameStyle(g) !== 'none' || selN.has(g.id)) continue;
      const inSel = [...selN].some((id) => { const n = byId.get(id); return n && parentOf(n, data.nodes) === g; });
      if (inSel) h += `<rect x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" rx="14" fill="none" stroke="${A}" stroke-opacity=".35" stroke-width="${s(1)}" stroke-dasharray="${s(3)} ${s(4)}"/>`;
    }
    if (editing?.kind === 'node') { const n = byId.get(editing.id); if (n && !isFrame(n)) h += outlineOf(n, `fill="none" stroke="${A}" stroke-opacity=".7" stroke-width="${s(1.5)}"`, 4); }
    // the group under a dragged piece, which would take it in; the arrow it would be spliced into
    if (hoverG && (mode?.type === 'move' || mode?.type === 'palette' || !mode)) {
      const g = byId.get(hoverG);
      if (g) {
        h += `<rect x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" rx="16" fill="${A}" fill-opacity=".04" stroke="${A}" stroke-opacity=".8" stroke-width="${s(1.4)}"/>`;
        if (!mode) for (const n of contentsOf(g, data.nodes)) if (!isFrame(n)) h += outlineOf(n, `fill="${A}" fill-opacity=".06" stroke="none"`, 3);
      }
    }
    const splice = mode?.splice || null;
    if (splice) {
      const g = (mode.geo0 || geoms).get(splice);
      if (g) h += `<path d="${g.d}" fill="none" stroke="${A}" stroke-width="${s(2.4)}" stroke-linecap="round"/><g transform="translate(${f(g.mx)},${f(g.my)}) scale(${(1 / k).toFixed(4)})"><circle r="9" fill="${T.bg}" stroke="${A}" stroke-width="1.4"/><path d="M-4.5 0h9M0-4.5v9" stroke="${A}" stroke-width="1.6" stroke-linecap="round"/></g>`;
    }
    // locked pieces: a small lock on hover instead of the halo (it pulses once when a drag is refused)
    const lockAt = (n, sc = 1) => { const x = n.x + n.w, y = n.y; return `<g transform="translate(${f(x)},${f(y)}) scale(${(sc / k).toFixed(4)})"><circle r="9" fill="${T.bg}" stroke="${T.frame}" stroke-width="1"/><g transform="translate(-6,-6) scale(.5)" fill="none" stroke="${T.muted}" stroke-width="2.4" stroke-linecap="round">${LINE_ICON.lock}</g></g>`; };
    const hn = byId.get(hover);
    if (hn && isLocked(hn) && !mode) h += lockAt(hn);
    if (lockPulse) { const n = byId.get(lockPulse.id), p = clamp((now() - lockPulse.t) / 200, 0, 1); if (n && p < 1) h += lockAt(n, 1 + 0.15 * Math.sin(p * Math.PI)); }
    // guides while arranging: thin accent lines and equal-gap ticks
    if (mode?.guides) h += guidesSVG(mode.guides, mode.gbox);
    if (mode?.type === 'move' && mode.axis) {
      const p0 = mode.p;
      h += mode.axis === 'x' ? `<path d="M${f(p0.x - 4000)},${f(p0.y)}H${f(p0.x + 4000)}" stroke="${A}" stroke-opacity=".35" stroke-width="${s(1)}"/>` : `<path d="M${f(p0.x)},${f(p0.y - 4000)}V${f(p0.y + 4000)}" stroke="${A}" stroke-opacity=".35" stroke-width="${s(1)}"/>`;
    }
    // while a piece is being named its dots stay, so an arrow can start from it at once
    if ((editing && editing.kind !== 'node') || (mode && (mode.type === 'pan' || mode.type === 'band' || mode.type === 'resize' || mode.type === 'frontier' || mode.type === 'palette' || (mode.type === 'move' && mode.moved)))) return h;

    if (mode?.type === 'connect' || mode?.type === 'reanchor') return h + connectPreview(byId);

    // On the hovered piece (and a single selected one): the roots of its arrows, as small solid grips (drag one to move
    // that end to another spot, side or piece), and one free port per side, a hollow ring (drag from it to draw a new
    // arrow). A side that already has arrows offers its free port in the widest gap, so two arrows leave it from two
    // distinct points. The ports take the pointer only exactly on them; the rest of the border moves the piece.
    const single = editing ? (editing.kind === 'node' ? editing.id : null) : selN.size === 1 && !selE.size ? [...selN][0] : null;
    for (const id of new Set([editing ? null : hover, single].filter(Boolean))) {
      const n = byId.get(id);
      if (!n || isFrame(n) || isLegend(n)) continue;
      const out = id === single && !isLocked(n) ? 20 / k : 0;            // beside the resize handles when selected
      const roots = rootsOf(n, byId);
      for (const side of SIDES) {
        const { o, at, busy } = freePort(n, side, roots.filter((r) => r.side === side));
        const b0 = borderPoint(n, side, o), b = { x: b0.x + NORMAL[side][0] * out, y: b0.y + NORMAL[side][1] * out };
        h += `<g class="dg-dot${busy ? ' dg-dot2' : ''}" data-dot="${esc(n.id)}" data-side="${side}"${busy ? ` data-at="${at.toFixed(3)}"` : ''} transform="translate(${f(b.x)},${f(b.y)}) scale(${(1 / k).toFixed(4)})"><circle r="7" fill="transparent"/><circle r="4.2"/><path class="dg-dot-a" d="M${NORMAL[side][0] * 8},${NORMAL[side][1] * 8}L${NORMAL[side][0] * 40 * k},${NORMAL[side][1] * 40 * k}"/></g>`;
      }
      if (!mode && !editing) for (const r of roots) {
        if (isLocked(r.e)) continue;
        h += `<g class="dg-end dg-root" data-end="${r.which}" data-eid="${esc(r.e.id)}" transform="translate(${f(r.x)},${f(r.y)}) scale(${(1 / k).toFixed(4)})"><circle r="6.5" fill="transparent"/><circle r="3.4" style="fill:${r.colour}"/></g>`;
      }
    }
    // resize handles: 8 on a box or a frame, the 4 corners on a symbol (it keeps its proportions)
    const n = single && !editing && byId.get(single);
    if (n && !isLocked(n)) {
      const e = isFrame(n) || !iconic(n) ? box(n) : box(n), pad = 5 / k;
      const x0 = e.x - pad, y0 = e.y - pad, x1 = e.x + e.w + pad, y1 = e.y + e.h + pad, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const hs = iconic(n) ? [['nw', x0, y0], ['ne', x1, y0], ['se', x1, y1], ['sw', x0, y1]]
        : [['nw', x0, y0], ['n', mx, y0], ['ne', x1, y0], ['e', x1, my], ['se', x1, y1], ['s', mx, y1], ['sw', x0, y1], ['w', x0, my]];
      for (const [dir, x, y] of hs) h += `<rect class="dg-rs dg-rs-${dir}" data-rs="${esc(n.id)}" data-h="${dir}" transform="translate(${f(x)},${f(y)}) scale(${(1 / k).toFixed(4)})" x="-4.5" y="-4.5" width="9" height="9" rx="2.5"/>`;
    }
    // a callout's tip: drag it onto the piece it names, or anywhere
    if (n && !isLocked(n) && n.shape === 'callout') {
      const tp = calloutTip(n, { byId });
      h += `<g class="dg-tiph" data-tiph="${esc(n.id)}" transform="translate(${f(n.x + tp.x)},${f(n.y + tp.y)}) scale(${(1 / k).toFixed(4)})"><circle r="9" fill="transparent"/><circle r="4.2"/></g>`;
    }
    // the two ends of a selected (or hovered) arrow can be dragged to another piece
    const eid = selE.size === 1 && !selN.size ? [...selE][0] : null;
    for (const id of new Set([eid, hoverE].filter(Boolean))) {
      const e = data.edges.find((x) => x.id === id), g = geoms.get(id);
      if (!e || !g || isLocked(e)) continue;
      const P = g.poly;
      for (const [which, p] of [['from', P[0]], ['to', P[P.length - 1]]]) h += `<g class="dg-end" data-end="${which}" data-eid="${esc(id)}" transform="translate(${f(p.x)},${f(p.y)}) scale(${(1 / k).toFixed(4)})"><circle r="9" fill="transparent"/><circle r="4"/></g>`;
    }
    return h;
  }
  // Where each arrow attached to n meets it: its side (from the direction the line leaves or arrives), its position
  // along that side, and its colour.
  function rootsOf(n, byId) {
    const out = [], T = th();
    for (const e of data.edges) {
      if (e.from === e.to || (e.from !== n.id && e.to !== n.id)) continue;
      const g = geoms.get(e.id);
      if (!g || g.poly.length < 2) continue;
      for (const which of ['from', 'to']) {
        if (e[which] !== n.id) continue;
        const P = g.poly, p = which === 'from' ? P[0] : P[P.length - 1];
        let q = null;
        for (let i = 1; i < P.length && !q; i++) { const c = which === 'from' ? P[i] : P[P.length - 1 - i]; if (Math.hypot(c.x - p.x, c.y - p.y) > 1) q = c; }
        if (!q) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
        out.push({ e, which, side, x: p.x, y: p.y, along: side === 'l' || side === 'r' ? p.y : p.x, colour: edgeColour(e, byId, T, null) });
      }
    }
    return out;
  }
  // The free port on a side: its middle if nothing leaves there, otherwise the middle of the widest gap between the
  // arrows already on it. o: offset from the side's middle; at: 0..1 along the side (the order it will keep).
  function freePort(n, side, roots) {
    const vert = side === 'l' || side === 'r', len = vert ? n.h : n.w, start = vert ? n.y : n.x, mid = start + len / 2;
    if (!roots.length || roots.every((r) => Math.abs(r.along - mid) > 14)) return { o: 0, at: 0.5, busy: false };
    const inset = ROUND.has(n.shape) || POINTED.has(n.shape) ? 0.25 : 0.08, lo = start + len * inset, hi = start + len * (1 - inset);
    const xs = [lo, ...roots.map((r) => clamp(r.along, lo, hi)).sort((a, b) => a - b), hi];
    let best = null;
    for (let i = 1; i < xs.length; i++) { const g = xs[i] - xs[i - 1]; if (!best || g > best.g) best = { g, v: (xs[i] + xs[i - 1]) / 2 }; }
    return { o: best.v - mid, at: (best.v - start) / len, busy: true };
  }
  function guidesSVG(gd, b) {
    const k = view.k, A = th().accent, s = (v) => f(v / k);
    let h = '';
    const ln = (x0, y0, x1, y1) => `<path d="M${f(x0)},${f(y0)}L${f(x1)},${f(y1)}" stroke="${A}" stroke-opacity=".55" stroke-width="${s(1)}"/>`;
    const cross = (x, y) => `<path d="M${f(x - 3 / k)},${f(y - 3 / k)}l${s(6)},${s(6)}M${f(x + 3 / k)},${f(y - 3 / k)}l${s(-6)},${s(6)}" stroke="${A}" stroke-opacity=".7" stroke-width="${s(1)}"/>`;
    if (gd.gx && b) {
      const v = gd.gx.v, ys = [b.y, b.y + b.h, ...gd.gx.hits.map((c) => c.b.y), ...gd.gx.hits.map((c) => c.b.y + c.b.h)];
      h += ln(v, Math.min(...ys) - 8, v, Math.max(...ys) + 8);
      for (const c of gd.gx.hits) h += cross(v, c.b.y + c.b.h / 2);
    }
    if (gd.gy && b) {
      const v = gd.gy.v, xs = [b.x, b.x + b.w, ...gd.gy.hits.map((c) => c.b.x), ...gd.gy.hits.map((c) => c.b.x + c.b.w)];
      h += ln(Math.min(...xs) - 8, v, Math.max(...xs) + 8, v);
      for (const c of gd.gy.hits) h += cross(c.b.x + c.b.w / 2, v);
    }
    for (const g of gd.gaps || []) {
      if (g.axis === 'x') h += ln(g.a, g.at, g.c, g.at) + ln(g.a, g.at - 4 / k, g.a, g.at + 4 / k) + ln(g.c, g.at - 4 / k, g.c, g.at + 4 / k);
      else h += ln(g.at, g.a, g.at, g.c) + ln(g.at - 4 / k, g.a, g.at + 4 / k, g.a) + ln(g.at - 4 / k, g.c, g.at + 4 / k, g.c);
    }
    return h;
  }
  // While drawing a new arrow (or moving an end): the real route it will take, the port it will use, and the ghost of the
  // piece a drop on empty space would create.
  function connectPreview(byId) {
    const m = mode, k = view.k, T = th(), A = T.accent;
    let h = '';
    const src = byId.get(m.type === 'connect' ? m.from : m.fixed);
    if (!src) return '';
    let tgt = m.target ? byId.get(m.target.id) : null, phantom = null;
    if (!tgt && m.cur && (m.far || m.type === 'reanchor')) {
      phantom = m.ghost || { id: '\u0000ghost', shape: src.shape, x: m.cur.x - 30, y: m.cur.y - 20, w: 60, h: 40, text: '' };
      if (m.ghost && m.type === 'connect') h += `<rect x="${f(phantom.x)}" y="${f(phantom.y)}" width="${f(phantom.w)}" height="${f(phantom.h)}" rx="10" fill="none" stroke="${A}" stroke-opacity=".5" stroke-width="${f(1.3 / k)}" stroke-dasharray="${f(5 / k)} ${f(4 / k)}"/>`;
      if (m.type === 'reanchor' || !m.ghost) phantom = { ...phantom, x: m.cur.x - 1, y: m.cur.y - 1, w: 2, h: 2, shape: 'box' };
    }
    const other = tgt || phantom;
    if (!other) return h;
    const [a, b] = m.type === 'reanchor' && m.which === 'from' ? [other, src] : [src, other];
    const tmpE = { id: '\u0000tmp', from: a.id, to: b.id, dash: 'solid', route: m.route || defaultRoute(a, b), text: '' };
    if (m.type === 'connect' && m.side && a === src) tmpE.fromSide = m.side;
    if (m.portSide) tmpE[m.type === 'reanchor' && m.which === 'from' ? 'fromSide' : 'toSide'] = m.portSide;
    const ns = data.nodes.filter((n) => n.id !== a.id && n.id !== b.id).concat(a.id === b.id ? [a] : [a, b]);
    const g = routeAll({ ...data, edges: [tmpE] }, ns, {}).get(tmpE.id);
    if (g) {
      h += `<path d="${g.d}" fill="none" stroke="${A}" stroke-width="1.8" stroke-linecap="round"/>${g.head ? `<path d="${g.head}" fill="none" stroke="${A}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}`;
      if (tgt) { const q = m.type === 'reanchor' && m.which === 'from' ? g.poly[0] : g.poly[g.poly.length - 1]; h += `<circle cx="${f(q.x)}" cy="${f(q.y)}" r="${f(4.5 / k)}" fill="${A}"/>`; }
    }
    return h;
  }

  // ----- arranging (all of it works on a data object, so it can be previewed on a copy first) -----

  // Align on the glyph (x, y, w, h), never on the hanging words: centre-aligned symbols put their ports on one line.
  // The key object (the last one Shift+clicked) stays put; otherwise the reference is the selection's box.
  function alignMut(D, how) {
    const ns = D.nodes.filter((n) => selN.has(n.id) && !isLocked(n));
    if (ns.length + D.nodes.filter((n) => selN.has(n.id) && isLocked(n)).length < 2) return;
    const keyN = D.nodes.find((n) => n.id === keyId && selN.has(n.id)) || D.nodes.find((n) => selN.has(n.id) && isLocked(n));
    const ref = keyN ? box(keyN) : union(ns.map(box));
    const moved = new Set();
    for (const n of ns) {
      if (n === keyN) continue;
      let x = n.x, y = n.y;
      if (how === 'left') x = ref.x; else if (how === 'right') x = ref.x + ref.w - n.w; else if (how === 'cx') x = ref.x + ref.w / 2 - n.w / 2;
      else if (how === 'top') y = ref.y; else if (how === 'bottom') y = ref.y + ref.h - n.h; else if (how === 'cy') y = ref.y + ref.h / 2 - n.h / 2;
      for (const id of moveBy(D, [n.id], Math.round(x) - n.x, Math.round(y) - n.y)) moved.add(id);
    }
    separate(D, ns, how === 'left' || how === 'right' || how === 'cx' ? 'y' : 'x');
    settle(D, [...moved, ...ns.map((n) => n.id)]);
  }
  // Pieces that now share a row (or column) and overlap are spread along it, keeping their order.
  function separate(D, ns, axis) {
    const pos = (n) => (axis === 'x' ? blockRect(n).x : blockRect(n).y), size = (n) => (axis === 'x' ? blockRect(n).w : blockRect(n).h);
    const list = ns.slice().sort((a, b) => pos(a) - pos(b) || D.nodes.indexOf(a) - D.nodes.indexOf(b));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], n = list[i];
      const a = blockRect(prev), b = blockRect(n);
      const crossOverlap = axis === 'x' ? a.y < b.y + b.h && b.y < a.y + a.h : a.x < b.x + b.w && b.x < a.x + a.w;
      if (!crossOverlap) continue;
      const need = pos(prev) + size(prev) + 24 - pos(n);
      if (need > 0) moveBy(D, [n.id], axis === 'x' ? need : 0, axis === 'y' ? need : 0);
    }
  }
  const spread = (ns, ax) => { const v = ns.map((n) => (ax === 'x' ? n.x + n.w / 2 : n.y + n.h / 2)); return Math.max(...v) - Math.min(...v); };
  // A: row centres when the selection spreads more across than down, otherwise column centres; again cycles.
  function smartAlign() {
    const ns = data.nodes.filter((n) => selN.has(n.id));
    if (ns.length < 2) return null;
    const row = spread(ns, 'x') > spread(ns, 'y'), seq = row ? ['cy', 'top', 'bottom'] : ['cx', 'left', 'right'];
    const i = lastAlign && now() - lastAlign.t < 1500 && lastAlign.row === row ? (lastAlign.i + 1) % 3 : 0;
    return { how: seq[i], row, i };
  }
  const ALIGN_NAMES = { left: 'Bordes izquierdos', right: 'Bordes derechos', top: 'Bordes de arriba', bottom: 'Bordes de abajo', cx: 'Centros en columna', cy: 'Centros en fila' };

  // D: the two outermost stay, the gaps between the glyphs become equal. Again: the other axis.
  function distMut(D, axis) {
    const ns = D.nodes.filter((n) => selN.has(n.id) && !isLocked(n));
    if (ns.length < 3) return;
    const P = axis === 'x' ? 'x' : 'y', S = axis === 'x' ? 'w' : 'h';
    const list = ns.slice().sort((a, b) => a[P] - b[P] || D.nodes.indexOf(a) - D.nodes.indexOf(b));
    const first = list[0], last = list[list.length - 1];
    const inner = list.slice(1, -1).reduce((s, n) => s + n[S], 0);
    const gap = (last[P] - (first[P] + first[S]) - inner) / (list.length - 1);
    let at = first[P] + first[S] + gap;
    const moved = new Set();
    for (const n of list.slice(1, -1)) { for (const id of moveBy(D, [n.id], P === 'x' ? Math.round(at) - n.x : 0, P === 'y' ? Math.round(at) - n.y : 0)) moved.add(id); at += n[S] + gap; }
    settle(D, moved);
  }
  const distAxis = () => {
    const ns = data.nodes.filter((n) => selN.has(n.id));
    const base = spread(ns, 'x') >= spread(ns, 'y') ? 'x' : 'y';
    return lastDist && now() - lastDist.t < 1500 ? (lastDist.axis === 'x' ? 'y' : 'x') : base;
  };

  // Same size as the largest (or the key object). Boxes take its width/height; symbols scale and keep their proportions.
  function sameMut(D, which = 'both') {
    const ns = D.nodes.filter((n) => selN.has(n.id) && !isLocked(n) && !isFrame(n));
    if (ns.length < 2) return;
    const ref = D.nodes.find((n) => n.id === keyId && selN.has(n.id)) || ns.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    for (const n of ns) {
      if (n === ref) continue;
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      if (iconic(n)) { const s = Math.max(ref.w, ref.h) / Math.max(n.w, n.h); n.w = Math.round(n.w * s); n.h = Math.round(n.h * s); }
      else {
        if (which !== 'h') n.w = ref.w;
        if (which !== 'w') n.h = ref.h;
        n.h = Math.max(n.h, minH(n));
        delete n.fitW;
      }
      n.x = Math.round(cx - n.w / 2); n.y = Math.round(cy - n.h / 2);
    }
    settle(D, ns.map((n) => n.id));
  }

  // Group: a frame around the selection (or, with one frame and loose pieces selected, the loose ones join it).
  function groupMut(D, kind = 'group') {
    const sel = D.nodes.filter((n) => selN.has(n.id));
    if (!sel.length) return null;
    const frames = sel.filter(isFrame), loose = sel.filter((n) => !isFrame(n) && !frames.some((g) => contentsOf(g, D.nodes).includes(n)));
    if (frames.length === 1 && loose.length) {
      const g = frames[0], b = union([box(g), ...loose.map((n) => inflate(blockRect(n), 0))].map((r, i) => (i ? { x: r.x - PAD_WRAP.l, y: r.y - PAD_WRAP.t, w: r.w + PAD_WRAP.l + PAD_WRAP.r, h: r.h + PAD_WRAP.t + PAD_WRAP.b } : r)));
      Object.assign(g, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
      g.kids = [...new Set([...(Array.isArray(g.kids) ? g.kids : []), ...loose.map((n) => n.id)])];
      growFrames(D.nodes);
      return g.id;
    }
    const b = union(sel.map((n) => (isFrame(n) ? box(n) : blockRect(n))));
    const g = { id: newId('g', D), x: Math.round(b.x - PAD_WRAP.l), y: Math.round(b.y - PAD_WRAP.t), w: Math.round(b.w + PAD_WRAP.l + PAD_WRAP.r), h: Math.round(b.h + PAD_WRAP.t + PAD_WRAP.b), text: '', shape: FRAME_SET.has(kind) ? kind : 'group', color: PALETTE[0], kids: sel.map((n) => n.id) };
    if (g.shape === 'lane') { g.x -= 34; g.w += 34; }
    const first = Math.min(...sel.map((n) => D.nodes.indexOf(n)));
    D.nodes.splice(first, 0, g);
    growFrames(D.nodes);
    frameRoom(D.nodes, new Set([g.id]));
    return g.id;
  }
  function ungroupMut(D) {
    const gs = D.nodes.filter((n) => selN.has(n.id) && isFrame(n) && !isLocked(n));
    const kids = new Set();
    for (const g of gs) for (const n of D.nodes) if (parentOf(n, D.nodes) === g) kids.add(n.id);
    D.nodes = D.nodes.filter((n) => !gs.includes(n));
    return [...kids];
  }

  // Paint order: the order of the list (frames always behind). Forward/back step past the next piece that overlaps.
  function orderMut(D, how) {
    const sel = D.nodes.filter((n) => selN.has(n.id));
    if (!sel.length) return;
    const rest = D.nodes.filter((n) => !selN.has(n.id));
    if (how === 'front') { D.nodes = [...rest, ...sel]; return; }
    if (how === 'back') { const i = rest.findIndex((n) => !isFrame(n)); rest.splice(i < 0 ? rest.length : i, 0, ...sel); D.nodes = rest; return; }
    const list = D.nodes.slice(), idx = sel.map((n) => list.indexOf(n));
    if (how === 'fwd') {
      const hi = Math.max(...idx);
      for (let j = hi + 1; j < list.length; j++) {
        const o = list[j];
        if (isFrame(o) || !sel.some((n) => overlaps(ext(n), ext(o)))) continue;
        const without = list.filter((n) => !selN.has(n.id)), at = without.indexOf(o) + 1;
        without.splice(at, 0, ...sel); D.nodes = without; return;
      }
    } else {
      const lo = Math.min(...idx);
      for (let j = lo - 1; j >= 0; j--) {
        const o = list[j];
        if (isFrame(o) || !sel.some((n) => overlaps(ext(n), ext(o)))) continue;
        const without = list.filter((n) => !selN.has(n.id)), at = without.indexOf(o);
        without.splice(at, 0, ...sel); D.nodes = without; return;
      }
    }
  }
  const canOrder = (how) => {
    const sel = data.nodes.filter((n) => selN.has(n.id) && !isFrame(n));
    if (!sel.length) return false;
    const D = clone(data); orderMut(D, how);
    return JSON.stringify(D.nodes.map((n) => n.id)) !== JSON.stringify(data.nodes.map((n) => n.id));
  };

  function lockMut(D) {
    const ns = D.nodes.filter((n) => selN.has(n.id)), es = D.edges.filter((e) => selE.has(e.id));
    const all = [...ns, ...es], to = !all.every(isLocked);
    for (const x of all) { if (to) x.locked = true; else delete x.locked; }
  }

  // Copy style: a node gives its colour, text level and frame look (and its size, to the same kind of symbol); an arrow
  // its line, route, ends and flow.
  function styleOfSel() {
    const n = data.nodes.find((x) => selN.has(x.id)), e = data.edges.find((x) => selE.has(x.id));
    if (n && selN.size + selE.size === 1) return { node: { color: n.color, size: n.size, frame: n.frame, shape: n.shape, w: n.w, h: n.h } };
    if (e && selN.size + selE.size === 1) return { edge: { dash: e.dash, route: e.route, head: e.head, flow: e.flow } };
    return null;
  }
  function styleMut(D, st, onlyIds = null) {
    if (!st) return;
    const pickN = (n) => (onlyIds ? onlyIds.has(n.id) : selN.has(n.id)) && !isLocked(n), pickE = (e) => (onlyIds ? onlyIds.has(e.id) : selE.has(e.id)) && !isLocked(e);
    if (st.node) for (const n of D.nodes.filter(pickN)) {
      if (isFrame(n) !== isFrame({ shape: st.node.shape })) continue;
      if (isClassic(n.shape)) n.color = st.node.color;
      for (const k of ['size', 'frame']) { if (st.node[k] === undefined) delete n[k]; else n[k] = st.node[k]; }
      if (!isClassic(n.shape)) delete n.size;
      if (!isFrame(n)) delete n.frame;
      if (n.shape === st.node.shape && iconic(n)) { const cx = n.x + n.w / 2, cy = n.y + n.h / 2; n.w = st.node.w; n.h = st.node.h; n.x = Math.round(cx - n.w / 2); n.y = Math.round(cy - n.h / 2); }
      n.h = Math.max(n.h, minH(n));
    }
    if (st.edge) for (const e of D.edges.filter(pickE)) for (const k of ['dash', 'route', 'head', 'flow']) { if (st.edge[k] === undefined) delete e[k]; else e[k] = st.edge[k]; }
  }

  // Changing what a thing is keeps its centre. Across forms (a box and a symbol) the piece takes the new kind's own
  // size; from one symbol to another it keeps its scale. A frame only becomes another frame, a piece another piece.
  function reshape(n, shape) {
    if (isLocked(n)) return;
    let extra = null;
    if (SYMS[shape]?.kind === 'preset') { extra = SYMS[shape].as; shape = extra.shape; }
    if (n.shape === shape && !extra) return;
    if (isFrame(n) !== FRAME_SET.has(shape) || shape === 'frontier' || shape === 'legend' || isLegend(n)) return;
    if (isFrame(n)) { n.shape = shape; return; }
    const was = n.shape, cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const form = (s) => (ICONS.has(s) ? (n.form === 'card' && isCatalogueSymbol(drawAs(s)) ? 'card' : 'icon') : s === 'operation' ? 'op' : s === 'text' ? 'text' : SMALL_DISC[s] ? 'disc' : 'box');
    const f0 = form(was), f1 = form(shape);
    if (f0 !== f1 || f1 === 'icon' || f1 === 'disc') {
      let [w, h] = SIZE[shape];
      if (f0 === 'icon' && f1 === 'icon') { const k = Math.max(n.w, n.h) / Math.max(...SIZE[was]); if (k > 0.5 && k < 4) { w = Math.round(w * k); h = Math.round(h * k); } }
      n.w = w; n.h = h;
    }
    n.shape = shape;
    if (extra) for (const [k, v] of Object.entries(extra)) if (k !== 'shape') n[k] = v;
    if (!isClassic(shape)) { delete n.size; delete n.fitW; }
    if (!ICONS.has(shape)) { delete n.form; delete n.labelAt; delete n.count; }
    if (n.form === 'card' && !isCatalogueSymbol(drawAs(shape))) delete n.form;
    if (n.fitW) n.w = fitWidth(n);
    n.h = Math.max(n.h, minH(n));
    n.x = Math.round(cx - n.w / 2); n.y = Math.round(cy - n.h / 2);
  }
  // How a symbol shows: on its own with the words under it or on its right, or as a card with the words inside.
  function formMut(n, v) {
    if (!ICONS.has(n.shape) || isLocked(n)) return;
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2, wasCard = n.form === 'card';
    if (v === 'card') { if (!isCatalogueSymbol(drawAs(n.shape))) return; if (!wasCard) { n.form = 'card'; n.w = 200; n.h = 72; } delete n.labelAt; }
    else { delete n.form; if (v === 'right') n.labelAt = 'right'; else delete n.labelAt; if (wasCard) [n.w, n.h] = SIZE[n.shape]; }
    n.h = Math.max(n.h, minH(n));
    n.x = Math.round(cx - n.w / 2); n.y = Math.round(cy - n.h / 2);
  }

  // Ordenar: straighten nearly-straight arrows, align near-aligned centres, even out near-even gaps, take overlaps apart,
  // fit frames. Running it twice moves nothing the second time.
  function tidyMut(D, scope) {
    const ns = D.nodes.filter((n) => !isFrame(n) && (!scope || scope.has(n.id)));
    if (!ns.length) return;
    const deg = new Map(ns.map((n) => [n.id, 0]));
    for (const e of D.edges) { if (deg.has(e.from)) deg.set(e.from, deg.get(e.from) + 1); if (deg.has(e.to)) deg.set(e.to, deg.get(e.to) + 1); }
    const anchorOf = (list) => list.slice().sort((a, b) => (isLocked(b) - isLocked(a)) || (deg.get(b.id) - deg.get(a.id)) || (b.w * b.h - a.w * a.h) || (D.nodes.indexOf(a) - D.nodes.indexOf(b)))[0];
    const cx = (n) => n.x + n.w / 2, cy = (n) => n.y + n.h / 2;
    const setC = (n, ax, v) => { if (isLocked(n)) return; if (ax === 'x') n.x = Math.round(v - n.w / 2); else n.y = Math.round(v - n.h / 2); };
    // steps 1–3 repeat until nothing changes, so a second run moves nothing
    for (let round = 0; round < 6; round++) {
    const was = JSON.stringify(ns.map((n) => [n.x, n.y]));
    // 1 · straighten: union-find over arrows whose ends are within 24 of being in line
    for (const ax of ['x', 'y']) {
      const par = new Map(ns.map((n) => [n.id, n.id])), find = (i) => (par.get(i) === i ? i : (par.set(i, find(par.get(i))), par.get(i)));
      const byId = new Map(ns.map((n) => [n.id, n]));
      for (const e of D.edges) {
        const a = byId.get(e.from), b = byId.get(e.to);
        if (!a || !b || a === b) continue;
        const horiz = Math.abs(cx(a) - cx(b)) > Math.abs(cy(a) - cy(b));
        if ((ax === 'y') !== horiz) continue;
        const d = ax === 'y' ? Math.abs(cy(a) - cy(b)) : Math.abs(cx(a) - cx(b));
        if (d > 0 && d <= 24) par.set(find(a.id), find(b.id));
      }
      const sets = new Map();
      for (const n of ns) { const r = find(n.id); if (!sets.has(r)) sets.set(r, []); sets.get(r).push(n); }
      for (const list of sets.values()) { if (list.length < 2) continue; const a = anchorOf(list), v = ax === 'x' ? cx(a) : cy(a); for (const n of list) setC(n, ax, v); }
    }
    // 2 · align: centres within 16 become one (single linkage), among pieces that are stacked along the other axis
    for (const ax of ['x', 'y']) {
      const c = ax === 'x' ? cx : cy, list = ns.slice().sort((a, b) => c(a) - c(b));
      let cl = [list[0]];
      const done = () => { if (cl.length > 1) { const a = anchorOf(cl), v = c(a); for (const n of cl) setC(n, ax, v); } };
      for (let i = 1; i < list.length; i++) { if (c(list[i]) - c(list[i - 1]) <= 16) cl.push(list[i]); else { done(); cl = [list[i]]; } }
      done();
    }
    // 3 · even gaps in rows and columns of three or more that are already nearly even
    for (const ax of ['x', 'y']) {
      const o = ax === 'x' ? cy : cx, groups = new Map();
      for (const n of ns) { const k2 = Math.round(o(n)); if (!groups.has(k2)) groups.set(k2, []); groups.get(k2).push(n); }
      for (const row of groups.values()) {
        if (row.length < 3) continue;
        const P = ax, S = ax === 'x' ? 'w' : 'h';
        row.sort((a, b) => a[P] - b[P]);
        const gaps = row.slice(1).map((n, i) => n[P] - (row[i][P] + row[i][S]));
        if (gaps.some((g) => g <= 0)) continue;
        const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        if (!gaps.every((g) => Math.abs(g - med) <= med * 0.25)) continue;
        const want = Math.max(24, Math.round(med / 12) * 12);
        let at = row[0][P] + row[0][S];
        for (const n of row.slice(1)) { if (!isLocked(n)) n[P] = Math.round(at + want); at = n[P] + n[S]; }
      }
    }
    if (JSON.stringify(ns.map((n) => [n.x, n.y])) === was) break;
    }
    // 4 · nothing on top of anything
    for (let pass = 0; pass < 40; pass++) {
      let any = false;
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j], ra = blockRect(a), rb = blockRect(b);
        if (!overlaps(ra, rb, 23.9)) continue;
        const mover = isLocked(b) ? a : b, other = mover === a ? b : a, rm = blockRect(mover), ro = blockRect(other);
        if (isLocked(mover)) continue;
        const sx = cx(mover) >= cx(other) ? 1 : -1, sy = cy(mover) >= cy(other) ? 1 : -1;
        const px = sx > 0 ? ro.x + ro.w + 24 - rm.x : rm.x + rm.w + 24 - ro.x, py = sy > 0 ? ro.y + ro.h + 24 - rm.y : rm.y + rm.h + 24 - ro.y;
        if (px <= py) mover.x += sx * Math.ceil(px); else mover.y += sy * Math.ceil(py);
        any = true;
      }
      if (!any) break;
    }
    // 5 · frames take exactly what they hold (the innermost first)
    for (const g of D.nodes.filter((n) => isFrame(n) && !isLocked(n)).sort((a, b) => a.w * a.h - b.w * b.h)) if (!scope || contentsOf(g, D.nodes).some((n) => scope.has(n.id))) fitFrame(g, D.nodes);
  }

  // Splices a piece into an arrow: A→B becomes A→N→B (the first half keeps the words and the look).
  function spliceMut(D, nid, eid) {
    const e = D.edges.find((x) => x.id === eid), n = D.nodes.find((x) => x.id === nid);
    if (!e || !n || e.from === nid || e.to === nid) return;
    const to = e.to;
    e.to = nid;
    delete e.toSide;
    const b = D.nodes.find((x) => x.id === to), a = D.nodes.find((x) => x.id === e.from);
    D.edges.push({ id: newId('e', D), from: nid, to, text: '', dash: e.dash, route: ROUTES.includes(e.route) ? e.route : defaultRoute(n, b), ...(e.head ? { head: e.head } : {}), ...(e.flow ? { flow: e.flow } : {}) });
    // room along the flow: the new piece keeps a clear gap after its source, and what comes after it is pushed on
    if (a && b && a !== b) {
      const ax = Math.abs(b.x + b.w / 2 - a.x - a.w / 2) >= Math.abs(b.y + b.h / 2 - a.y - a.h / 2) ? 'x' : 'y', S = ax === 'x' ? 'w' : 'h';
      const dir = Math.sign((b[ax] + b[S] / 2) - (a[ax] + a[S] / 2)) || 1, GAP = 48, ra = blockRect(a), rn = blockRect(n);
      const aEnd = dir > 0 ? ra[ax] + ra[S] : ra[ax], nStart = dir > 0 ? rn[ax] : rn[ax] + rn[S];
      const need = dir > 0 ? aEnd + GAP - nStart : nStart - (aEnd - GAP);
      if (need > 0) n[ax] += dir * Math.round(need);
      // the rest of the chain moves on as one block (so its own spacing stays as it was)
      const rn2 = blockRect(n), rb = blockRect(b), nEnd = dir > 0 ? rn2[ax] + rn2[S] : rn2[ax], bStart = dir > 0 ? rb[ax] : rb[ax] + rb[S];
      const shift = dir > 0 ? nEnd + GAP - bStart : bStart - (nEnd - GAP);
      if (shift > 0) {
        const down = new Set([b.id]), queue = [b.id];
        while (queue.length) { const id = queue.shift(); for (const x of D.edges) if (x.from === id && !down.has(x.to) && x.to !== nid && x.to !== a.id) { down.add(x.to); queue.push(x.to); } }
        for (const m of D.nodes) if (down.has(m.id) && !isLocked(m) && !isFrame(m)) m[ax] += dir * Math.round(shift);
        settle(D, [...down]);
      }
    }
    settle(D, [nid]);
  }

  // ----- actions: every button, menu row and key goes through here -----

  const NODE_MUT = (fn) => (D, arg) => { for (const n of D.nodes) if (selN.has(n.id) && !isLocked(n)) fn(n, arg, D); };
  const EDGE_MUT = (fn) => (D, arg) => { for (const e of D.edges) if (selE.has(e.id) && !isLocked(e)) fn(e, arg, D); };
  const ACTS = {
    kind: { mut: NODE_MUT((n, s) => reshape(n, s)), after: (s) => { useKind(s); if (isClassic(s) && !SMALL_DISC[s] && !FRAME_SET.has(s)) style.shape = s; } },
    form: { mut: NODE_MUT((n, v) => formMut(n, v)) },
    color: { mut: NODE_MUT((n, c) => { if (isClassic(n.shape)) n.color = c; }), after: (c) => { style.color = c; } },
    size: { mut: NODE_MUT((n, s) => { if (!isClassic(n.shape)) return; if (s === 'text') delete n.size; else n.size = s; if (n.fitW) { const cx = n.x + n.w / 2; n.w = fitWidth(n); n.x = Math.round(cx - n.w / 2); } n.h = Math.max(SIZE[n.shape][1], minH(n)); }) },
    status: { mut: NODE_MUT((n, s) => { if (isFrame(n)) return; if (s) n.status = s; else delete n.status; }) },
    trigger: { mut: NODE_MUT((n, s) => { if (isFrame(n)) return; if (s) n.clock = { ...(n.clock && typeof n.clock === 'object' ? n.clock : {}), kind: s }; else delete n.clock; }) },
    frame: { mut: NODE_MUT((n, s) => { if (!isFrame(n)) return; if (s === 'dashed') delete n.frame; else n.frame = s; }) },
    fitg: { mut: NODE_MUT((n, _, D) => { if (isFrame(n)) fitFrame(n, D.nodes); }), glide: true },
    dash: { mut: EDGE_MUT((e, s) => { e.dash = s; }) },
    route: { mut: EDGE_MUT((e, s) => { e.route = s; }) },
    head: { mut: EDGE_MUT((e, s) => { if (s === 'end') delete e.head; else e.head = s; }) },
    // data in motion: the button switches it on or off for every selected arrow; speed and direction sit beside it
    flow: { mut: (D) => { const es = D.edges.filter((e) => selE.has(e.id) && !isLocked(e)), on = es.length && es.every((e) => flowSpec(e)); for (const e of es) { if (on) delete e.flow; else e.flow = true; } } },
    speed: { mut: (D, sp) => { for (const e of D.edges.filter((x) => selE.has(x.id) && !isLocked(x))) e.flow = flowValue(sp, flowSpec(e)?.dir); } },
    flowdir: { mut: (D) => { const es = D.edges.filter((x) => selE.has(x.id) && !isLocked(x)), next = { fwd: 'back', back: 'both', both: 'fwd' }[flowSpec(es[0])?.dir || 'fwd']; for (const e of es) e.flow = flowValue(flowSpec(e)?.speed || 'normal', next); } },
    reverse: { mut: EDGE_MUT((e) => { [e.from, e.to] = [e.to, e.from]; [e.fromSide, e.toSide] = [e.toSide, e.fromSide]; if (e.fromSide === undefined) delete e.fromSide; if (e.toSide === undefined) delete e.toSide; }) },
    align: { mut: (D, how) => alignMut(D, how), glide: true, after: (how) => { lastAlign = { ...(lastAlign || {}), how, t: now() }; } },
    dist: { mut: (D, ax) => distMut(D, ax), glide: true, after: (ax) => { lastDist = { axis: ax, t: now() }; } },
    same: { mut: (D, w) => sameMut(D, w), glide: true },
    arrange: { mut: (D, kind) => { const ids = arrangeIds(D); if (arrangeMut(D, ids, kind, ext)) { settle(D, ids); syncKids(D.nodes, [...ids]); } }, glide: true, after: (kind) => sayIt(ARRANGE.find((a) => a.id === kind)?.name || '') },
    tidy: { mut: (D) => tidyMut(D, selN.size >= 2 ? new Set(selN) : null), glide: true },
    lock: { mut: (D) => lockMut(D) },
    order: { mut: (D, how) => orderMut(D, how) },
    paintstyle: { mut: (D) => styleMut(D, styleClip) },
    del: { run: () => removeSel() },
    group: { run: () => doGroup() },
    ungroup: { run: () => doUngroup() },
    dup: { run: () => duplicate() },
    copystyle: { run: () => { styleClip = styleOfSel(); if (styleClip) sayIt('Estilo copiado'); } },
    label: { run: () => { const id = [...selE][0]; if (id) startEdit('edge', id); } },
    title: { run: () => { const id = [...selN][0]; if (id) startEdit('node', id); } },
  };
  function doAct(name, arg) {
    const a = ACTS[name];
    if (!a) return;
    clearPreview();
    if (a.run) a.run(arg);
    else edit(() => a.mut(data, arg), null, { glide: !!a.glide });
    a.after?.(arg);
    paint();
  }
  // Show the effect before it happens: positions become dashed outlines, looks are drawn on a scratch copy, and a delete
  // washes what it would take. No undo step, no onChange.
  function previewAct(name, arg) {
    const a = ACTS[name];
    if (name === 'del') { pv = { wash: victims() }; paint(); return; }
    if (!a?.mut) return;
    const D = clone(data);
    a.mut(D, arg);
    const was = index(), ghosts = [];
    let looks = false;
    for (const n of D.nodes) {
      const o = was.get(n.id);
      if (!o) { looks = true; continue; }
      const { x, y, w, h, ...rest } = n, { x: x0, y: y0, w: w0, h: h0, ...rest0 } = o;
      if (JSON.stringify(rest) !== JSON.stringify(rest0)) looks = true;
      if (x !== x0 || y !== y0 || w !== w0 || h !== h0) ghosts.push(isFrame(n) ? box(n) : box(n));
    }
    if (D.nodes.length !== data.nodes.length || JSON.stringify(D.edges) !== JSON.stringify(data.edges) || JSON.stringify(D.nodes.map((n) => n.id)) !== JSON.stringify(data.nodes.map((n) => n.id))) looks = true;
    pv = looks ? { data: D } : { ghosts };
    paint();
  }
  function clearPreview() { if (pv) { pv = null; paint(); } }

  // What «Disponer» arranges: the selected pieces, or what a single selected frame holds (never what is locked).
  function arrangeIds(D) {
    const sel = D.nodes.filter((n) => selN.has(n.id));
    const list = sel.length === 1 && isFrame(sel[0]) ? contentsOf(sel[0], D.nodes).filter((n) => !isFrame(n)) : sel.filter((n) => !isFrame(n));
    return new Set(list.filter((n) => !isLocked(n)).map((n) => n.id));
  }
  function arrangeThumb(kind, ids) {
    const D = clone(data);
    arrangeMut(D, ids, kind, ext);
    // a schematic, not a picture: the pieces as soft blocks and the arrows as thin lines, so the shape reads at a glance
    const ns = D.nodes.filter((n) => ids.has(n.id)), es = D.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to), T = th();
    const u = union(ns.map(box)), W = 84, H = 52, pad = 5, s = Math.min((W - 2 * pad) / u.w, (H - 2 * pad) / u.h);
    const X = (x) => W / 2 + (x - u.x - u.w / 2) * s, Y = (y) => H / 2 + (y - u.y - u.h / 2) * s, by = new Map(ns.map((n) => [n.id, n]));
    let h = `<svg viewBox="0 0 ${W} ${H}">`;
    for (const e of es) { const a = by.get(e.from), c = by.get(e.to); h += `<path d="M${f(X(a.x + a.w / 2))},${f(Y(a.y + a.h / 2))}L${f(X(c.x + c.w / 2))},${f(Y(c.y + c.h / 2))}" stroke="${T.muted}" stroke-opacity=".7" stroke-width="1" fill="none"/>`; }
    for (const n of ns) {
      const w = Math.max(4, n.w * s), hh = Math.max(3.5, n.h * s), cx = X(n.x + n.w / 2), cy = Y(n.y + n.h / 2);
      h += `<rect x="${f(cx - w / 2)}" y="${f(cy - hh / 2)}" width="${f(w)}" height="${f(hh)}" rx="${f(Math.min(w, hh) / 3)}" fill="${mix(T.accent, T.bg, 0.78)}" stroke="${T.accent}" stroke-opacity=".6" stroke-width=".9"/>`;
    }
    return h + '</svg>';
  }
  function doGroup(kind = 'group') {
    if (!selN.size) return;
    if (data.nodes.filter((n) => selN.has(n.id)).every(isLocked)) return refuse();
    const before = snap();
    const gid = groupMut(data, kind);
    if (!gid) return;
    select([gid]);
    startEdit('node', gid, { before });
  }
  function doUngroup() {
    let gs = data.nodes.filter((n) => selN.has(n.id) && isFrame(n));
    if (!gs.length) {                                   // a piece inside a group: undo that group
      gs = [...new Set(data.nodes.filter((n) => selN.has(n.id)).map((n) => parentOf(n, data.nodes)).filter(Boolean))];
      if (!gs.length) { sayIt('No está en un grupo'); return; }
      selN = new Set(gs.map((g) => g.id));
    }
    let kids = [];
    edit(() => { kids = ungroupMut(data); });
    select(kids);
    showPill();
  }

  // ----- the contextual bar: the few actions that fit what is selected, next to it, never on it -----

  const btn = (act, icon, tipText, { key = '', arg, on = false, dim = '', pop: popName = '' } = {}) =>
    `<button data-act="${act}"${arg !== undefined ? ` data-arg="${esc(arg)}"` : ''}${popName ? ` data-pop="${popName}"` : ''} data-tip="${esc(tipText)}"${key ? ` data-key="${esc(key)}"` : ''}${dim ? ` data-need="${esc(dim)}" class="dg-dim"` : on ? ' class="on"' : ''}>${icon}</button>`;
  const SEP = '<i class="dg-sep"></i>';
  function barHTML() {
    const T = th(), sel = data.nodes.filter((n) => selN.has(n.id)), ns = sel.filter((n) => !isFrame(n)), gs = sel.filter(isFrame), es = data.edges.filter((e) => selE.has(e.id));
    const all = (list, fn) => list.length && list.every(fn);
    const lockB = (list) => btn('lock', lineIcon(all(list, isLocked) ? 'unlock' : 'lock'), all(list, isLocked) ? 'Desbloquear' : 'Bloquear', { key: 'Ctrl+Mayús+L', on: all(list, isLocked) });
    const more = btn('more', lineIcon('more'), 'Más', { pop: 'more' }), trash = btn('del', lineIcon('trash'), 'Quitar', { key: 'Supr' });
    const items = [...sel, ...es];
    if (!items.length && !selF) return '';
    if (selF && !items.length) return btn('frontier-label', lineIcon('label'), 'Nombre', { key: 'Intro' }) + SEP + trash;
    if (items.length && all(items, isLocked)) return lockB(items) + (items.length === 1 ? btn('copystyle', lineIcon('brush'), 'Copiar estilo', { key: 'Alt+C', on: !!brush }) : '');
    let h = '';
    if (ns.length === 1 && !gs.length && !es.length) {
      const n = ns[0];
      if (isLegend(n)) return btn('title', lineIcon('label'), 'Título', { key: 'Intro' }) + SEP + lockB([n]) + more + trash;
      h += btn('kind', miniSVG(n.shape === 'text' && n.size === 'title' ? 'title' : n.shape, T, 22), NAMES[n.shape] || 'Tipo', { pop: 'kind', key: 'Ctrl+Espacio' });
      if (ICONS.has(n.shape)) h += btn('form', lineIcon(isCard(n) ? 'card' : rightLabel(n) ? 'lright' : 'lbelow'), 'Forma', { pop: 'form' });
      if (isClassic(n.shape)) h += btn('color', `<span class="dg-swatch" style="background:${data.theme === 'dark' ? mix(darken(n.color), T.bg, 0.6) : n.color};border-color:${darken(n.color)}"></span>`, 'Color', { pop: 'color' });
      if (isClassic(n.shape)) h += btn('size', lineIcon('tsize'), 'Tamaño del texto', { pop: 'size' });
      if (!isClassic(n.shape)) h += btn('status', STATUS.includes(n.status) ? `<span class="dg-stat" style="background:${T[n.status]}"></span>` : lineIcon('status'), 'Estado', { pop: 'status' });
      if (!isClassic(n.shape) && (n.clock || n.shape === 'operation' || ['compute', 'ai', 'dev', 'messaging'].includes(SYMS[n.shape]?.cat))) h += btn('trigger', lineIcon('trigger'), 'Disparador', { pop: 'trigger', on: !!n.clock });
      h += SEP + btn('copystyle', lineIcon('brush'), 'Copiar estilo', { key: 'Alt+C', on: !!brush }) + lockB([n]) + more + trash;
      return h;
    }
    if (gs.length === 1 && !ns.length && !es.length) {
      const g = gs[0];
      h += btn('kind', miniSVG(g.shape, T, 22), NAMES[g.shape], { pop: 'kind', key: 'Ctrl+Espacio' });
      h += btn('title', lineIcon('label'), 'Título', { key: 'Intro' }) + (g.shape === 'lane' ? '' : btn('frame', lineIcon('frame'), 'Estilo del marco', { pop: 'frame' })) + btn('fitg', lineIcon('fitg'), 'Ajustar al contenido');
      if (arrangeIds(data).size >= 2) h += btn('arrange', lineIcon('arrange'), 'Disponer lo de dentro', { pop: 'arrange', key: 'Mayús+A' });
      h += btn('ungroup', lineIcon('ungroup'), 'Desagrupar', { key: 'Ctrl+Mayús+G' }) + SEP + lockB([g]) + more + trash;
      return h;
    }
    if (es.length && !sel.length) {
      const e0 = es[0], head = HEADS.includes(e0.head) ? e0.head : 'end';
      h += btn('dash', lineIcon(DASHES.includes(e0.dash) ? e0.dash : 'solid'), 'Línea', { pop: 'dash' });
      h += btn('route', lineIcon(ROUTES.includes(e0.route) ? e0.route : 'curve'), 'Recorrido', { pop: 'route' });
      h += btn('head', lineIcon({ end: 'hend', both: 'hboth', none: 'hnone' }[head]), 'Puntas', { pop: 'head' });
      const fs0 = flowSpec(e0), allOn = es.every((x) => flowSpec(x));
      h += SEP + btn('flow', lineIcon('flow'), allOn ? 'Quieto' : 'Datos en movimiento', { on: allOn });
      if (allOn) {
        for (const [sp, name] of [['slow', 'Lento'], ['normal', 'Normal'], ['fast', 'Rápido']]) h += btn('speed', lineIcon('sp-' + sp), name, { arg: sp, on: fs0.speed === sp });
        h += btn('flowdir', lineIcon('dir-' + fs0.dir), { fwd: 'Sentido: hacia la punta', back: 'Sentido: al revés', both: 'Sentido: en los dos' }[fs0.dir]);
      }
      h += SEP;
      if (es.length === 1) h += btn('label', lineIcon('label'), 'Texto', { key: 'Intro' });
      h += SEP + btn('copystyle', lineIcon('brush'), 'Copiar estilo', { key: 'Alt+C', on: !!brush }) + lockB(es) + more + trash;
      return h;
    }
    // several pieces (or a mix)
    const movable = sel.filter((n) => !isLocked(n));
    if (sel.length >= 2) {
      const sa = smartAlign();
      h += btn('align', lineIcon(sa ? sa.how : 'cy'), sa ? 'Alinear · ' + ALIGN_NAMES[sa.how] : 'Alinear', { key: 'A', pop: 'align', dim: movable.length < 2 && !sel.some(isLocked) ? 'Necesita dos piezas' : '' });
      h += btn('same', lineIcon('same'), 'Igualar tamaño', { pop: 'same', dim: ns.length < 2 ? 'Necesita dos piezas' : '' });
      h += btn('arrange', lineIcon('arrange'), 'Disponer', { pop: 'arrange', key: 'Mayús+A', dim: movable.filter((n) => !isFrame(n)).length < 2 ? 'Necesita dos piezas' : '' });
      h += btn('group', lineIcon('group'), 'Agrupar', { key: 'Ctrl+G' });
    }
    if (ns.length && all(ns, (n) => isClassic(n.shape)) && !gs.length) { const c = ns[0].color; h += btn('color', `<span class="dg-swatch" style="background:${data.theme === 'dark' ? mix(darken(c), T.bg, 0.6) : c};border-color:${darken(c)}"></span>`, 'Color', { pop: 'color' }); }
    if (ns.length && !gs.length && all(ns, (n) => n.shape === ns[0].shape)) h += btn('kind', miniSVG(ns[0].shape, T, 22), NAMES[ns[0].shape], { pop: 'kind' });
    if (h) h += SEP;
    h += lockB(items) + more + trash;
    return h;
  }

  // Four slots, in order: above, below, right, left. The first that fits in the view and covers nothing selected wins
  // (fewest other pieces covered breaks ties). It does not move while the selection stays the same.
  function placeBar() {
    const busy = editing || show || brush === 'x' || (mode && (mode.type !== 'move' || mode.moved));
    const html = !busy && (selN.size || selE.size || selF) ? barHTML() : '';
    if (!html) { if (!bar.hidden) { bar.hidden = true; bar.classList.remove('in'); } barSel = ''; return; }
    if (html !== barKey) { bar.innerHTML = html; barKey = html; }
    const selSig = [...selN, '|', ...selE, selF].join(',');
    const map = index();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rects = [];
    for (const id of selN) { const n = map.get(id); if (n) { const e = isFrame(n) ? box(n) : blockRect(n); rects.push(e); x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); } }
    for (const id of selE) {
      const g = geoms.get(id);
      if (!g) continue;
      const eb = union(g.poly.map((p) => ({ x: p.x - 6, y: p.y - 6, w: 12, h: 12 })));
      rects.push(eb); x0 = Math.min(x0, eb.x); y0 = Math.min(y0, eb.y); x1 = Math.max(x1, eb.x + eb.w); y1 = Math.max(y1, eb.y + eb.h);
    }
    if (selF && data.frontier) { const [a, b] = frontierSpan(data); x0 = Math.min(x0, a); x1 = Math.max(x1, b); y0 = Math.min(y0, data.frontier.y - 4); y1 = Math.max(y1, data.frontier.y + 24); }
    if (x0 === Infinity) { bar.hidden = true; return; }
    const k = view.k, W = root.clientWidth, H = root.clientHeight;
    const was = bar.hidden;
    bar.hidden = false;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const S = { l: view.x + x0 * k, t: view.y + y0 * k, r: view.x + x1 * k, b: view.y + y1 * k };
    const cxs = (S.l + S.r) / 2 - bw / 2, gap = 12;
    // the four close slots first; when each of them would cover a piece, the same directions a little farther out
    const slots = [[cxs, S.t - gap - bh], [cxs, S.b + gap], [S.r + gap, S.t], [S.l - gap - bw, S.t]];
    for (const d of [36, 64]) slots.push([cxs, S.t - d - bh], [cxs, S.b + d], [S.r + d, S.t], [S.l - d - bw, S.t]);
    const scr = (r) => ({ x: view.x + r.x * k, y: view.y + r.y * k, w: r.w * k, h: r.h * k });
    const selScr = rects.map(scr), others = data.nodes.filter((n) => !selN.has(n.id) && !isFrame(n)).map((n) => scr(blockRect(n)));
    let best = null;
    for (const [sx, sy] of slots) {
      const x = clamp(sx, 8, W - bw - 8), r = { x, y: sy, w: bw, h: bh };
      if (sy < 8 || sy + bh > H - 8) continue;
      if (selScr.some((s) => overlaps(r, s))) continue;
      // a piece under it costs most; an arrow or its label (above all the selection's own arrows) costs too
      const rd = { x: (x - view.x) / k, y: (sy - view.y) / k, w: bw / k, h: bh / k };
      let cover = others.filter((o) => overlaps(r, o)).length;
      for (const ed of data.edges) {
        const g = geoms.get(ed.id);
        if (!g) continue;
        const own = selN.has(ed.from) || selN.has(ed.to) || selE.has(ed.id) ? 2 : 1;
        if (polyHitsRect(g.poly, rd)) cover += 0.3 * own;
        if (g.lx !== undefined && overlaps(rd, { x: g.lx - 22, y: g.ly - 8, w: 44, h: 16 })) cover += 0.4 * own;
      }
      if (!best || cover < best.cover - 0.01) best = { x, y: sy, cover };
      if (cover === 0) break;
    }
    if (!best) best = { x: clamp(cxs, 8, W - bw - 8), y: clamp(S.t - gap - bh, 8, H - bh - 8) };
    if (barSel === selSig && bar.dataset.k && Math.abs(+bar.dataset.k - k) / k < 0.1 && !mode && bar.dataset.p === `${Math.round(view.x)},${Math.round(view.y)}` && bar.dataset.w === String(bw)) return;
    bar.dataset.k = k; bar.dataset.p = `${Math.round(view.x)},${Math.round(view.y)}`; bar.dataset.w = String(bw);   // a bar that grew is placed again
    bar.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px)`;
    if (was || barSel !== selSig) {
      bar.classList.remove('in');
      clearTimeout(barShownAt);
      barShownAt = setTimeout(() => bar.classList.add('in'), was ? 120 : 0);
    }
    barSel = selSig;
  }

  // Popovers anchored to their button: the options of one action.
  const pick = (act, arg, icon, label, { on = false, key = '' } = {}) =>
    `<button data-act="${act}" data-arg="${esc(arg)}" data-tip="${esc(label)}"${key ? ` data-key="${esc(key)}"` : ''}${on ? ' class="on"' : ''}>${icon}</button>`;
  const row = (act, arg, icon, label, { key = '', on = false, dim = '' } = {}) =>
    `<button class="dg-row${on ? ' on' : ''}${dim ? ' dg-dim' : ''}" data-act="${act}"${arg !== undefined ? ` data-arg="${esc(arg)}"` : ''}${dim ? ` data-need="${esc(dim)}"` : ''}><span class="dg-ri">${icon}</span><span class="dg-rl">${esc(label)}</span>${key ? `<kbd>${esc(key)}</kbd>` : ''}</button>`;
  function popHTML(name) {
    const T = th(), sel = data.nodes.filter((n) => selN.has(n.id)), n = sel[0], e0 = data.edges.find((e) => selE.has(e.id));
    switch (name) {
      case 'kind': return `<label class="dg-gal-s dg-ks">${lineIcon('search')}<input type="text" placeholder="Buscar" spellcheck="false" autocomplete="off" aria-label="Buscar"></label><div class="dg-pgrid dg-pg4 dg-kgrid">${kindCells(n, '')}</div>`;
      case 'form': {
        const cur = isCard(n) ? 'card' : rightLabel(n) ? 'right' : 'below';
        return row('form', 'below', lineIcon('lbelow'), 'Palabras debajo', { on: cur === 'below' }) + row('form', 'right', lineIcon('lright'), 'Palabras a la derecha', { on: cur === 'right' }) +
          (isCatalogueSymbol(drawAs(n.shape)) ? row('form', 'card', lineIcon('card'), 'Ficha', { on: cur === 'card' }) : '');
      }
      case 'color': return `<div class="dg-pcols">${PALETTE.map((c, i) => pick('color', c, `<span class="dg-swatch" style="background:${data.theme === 'dark' ? mix(darken(c), T.bg, 0.6) : c};border-color:${darken(c)}"></span>`, COLOR_NAMES[i], { on: n?.color === c })).join('')}</div>`;
      case 'size': return [['title', 'Título'], ['text', 'Texto'], ['small', 'Nota pequeña']].map(([s, l]) => row('size', s, `<b class="dg-ts dg-ts-${s}">Aa</b>`, l, { on: (n?.size || 'text') === s })).join('');
      case 'status': return [['ok', 'Bien'], ['idle', 'Parado'], ['bad', 'Con fallo'], ['', 'Sin estado']].map(([s, l]) => row('status', s, s ? `<span class="dg-stat" style="background:${T[s]}"></span>` : lineIcon('none'), l, { on: (n?.status || '') === s })).join('');
      case 'trigger': return [['', 'Sin disparador', 'none'], ['clock', 'Reloj', 'trigger'], ['event', 'Evento', 'flow']].map(([s, l, ic]) => row('trigger', s, lineIcon(ic), l, { on: (n?.clock?.kind === 'event' ? 'event' : n?.clock ? 'clock' : '') === s })).join('');
      case 'frame': return [['dashed', 'Marco discontinuo'], ['lane', 'Carril'], ['fill', 'Fondo suave'], ['none', 'Invisible']].map(([s, l]) => row('frame', s, `<i class="dg-fr dg-fr-${s}"></i>`, l, { on: frameStyle(n || {}) === s })).join('');
      case 'dash': return DASHES.map((x) => pick('dash', x, lineIcon(x), { solid: 'Continua', dashed: 'Discontinua', dashdot: 'Trazo y punto' }[x], { on: e0?.dash === x })).join('');
      case 'route': return ROUTES.map((x) => pick('route', x, lineIcon(x), { curve: 'Curva', elbow: 'En ángulo recto', straight: 'Recta' }[x], { on: e0?.route === x })).join('');
      case 'head': return HEADS.map((x) => pick('head', x, lineIcon({ end: 'hend', both: 'hboth', none: 'hnone' }[x]), { end: 'Una punta', both: 'Dos puntas', none: 'Sin puntas' }[x], { on: (HEADS.includes(e0?.head) ? e0.head : 'end') === x })).join('');
      case 'align': {
        const three = data.nodes.filter((x) => selN.has(x.id) && !isLocked(x)).length >= 3;
        return '<div class="dg-pgrid dg-pg3">' + ['left', 'cx', 'right', 'top', 'cy', 'bottom'].map((x) => pick('align', x, lineIcon(x), ALIGN_NAMES[x], { key: { left: 'Ctrl+Mayús+←', right: 'Ctrl+Mayús+→', top: 'Ctrl+Mayús+↑', bottom: 'Ctrl+Mayús+↓' }[x] || '' })).join('') + '</div>' +
          row('dist', 'x', lineIcon('disth'), 'Distribuir en horizontal', { key: 'D', dim: three ? '' : 'Necesita tres piezas' }) + row('dist', 'y', lineIcon('distv'), 'Distribuir en vertical', { dim: three ? '' : 'Necesita tres piezas' });
      }
      case 'arrange': {
        // each shape drawn as it would leave the selection, the one that fits best ringed; keys 1–6
        const ids = arrangeIds(data), ns = data.nodes.filter((x) => ids.has(x.id)), sug = suggestArrange(ns, data.edges);
        return '<div class="dg-atiles">' + ARRANGE.map((a, i) => {
          const why = arrangeFits(a.id, ns, data.edges);
          return `<button class="dg-atile${a.id === sug && !why ? ' sug' : ''}${why ? ' dg-dim' : ''}" data-act="arrange" data-arg="${a.id}" data-tip="${esc(a.name)}" data-key="${i + 1}"${why ? ` data-need="${esc(why)}"` : ''}>${why ? '<i></i>' : arrangeThumb(a.id, ids)}<span>${esc(a.name)}</span></button>`;
        }).join('') + '</div>';
      }
      case 'same': return row('same', 'w', lineIcon('samew'), 'Mismo ancho') + row('same', 'h', lineIcon('sameh'), 'Mismo alto') + row('same', 'both', lineIcon('same'), 'Mismo tamaño');
      case 'more': {
        const hasN = sel.length > 0;
        let h = '';
        if (hasN) h += row('order', 'fwd', lineIcon('fwd'), 'Traer adelante', { key: 'RePág', dim: canOrder('fwd') ? '' : 'Nada encima' }) + row('order', 'bwd', lineIcon('bwd'), 'Enviar atrás', { key: 'AvPág', dim: canOrder('bwd') ? '' : 'Nada debajo' }) +
          row('order', 'front', lineIcon('front'), 'Al frente', { key: 'Inicio' }) + row('order', 'back', lineIcon('back'), 'Al fondo', { key: 'Fin' }) + '<i class="dg-hr"></i>' + row('dup', undefined, lineIcon('dup'), 'Duplicar', { key: 'Ctrl+D' });
        if (selE.size) h += row('reverse', undefined, lineIcon('reverse'), 'Invertir sentido');
        if (styleClip) h += row('paintstyle', undefined, lineIcon('brush'), 'Pegar estilo', { key: 'Alt+V' });
        h += row('del', undefined, lineIcon('trash'), 'Quitar', { key: 'Supr' });
        return h;
      }
    }
    return '';
  }
  // The kinds a piece can become, close at hand: its siblings (same family; recents first), or what the search finds.
  const FRAME_KINDS = ['group', 'vpc', 'subnet', 'region', 'zone', 'namespace', 'env', 'machine'];
  const CLASSIC_KINDS = ['box', 'ellipse', 'diamond', 'note', 'start-end', 'io', 'subprocess', 'callout'];
  function siblingsOf(n) {
    if (!n) return CLASSIC_KINDS;
    const lead = (list, cur) => (list.includes(cur) ? [cur, ...list.filter((x) => x !== cur)] : [cur, ...list]).slice(0, 7);
    if (isFrame(n)) return lead(FRAME_KINDS, n.shape);
    if (isClassic(n.shape)) return lead(CLASSIC_KINDS, n.shape === 'text' && n.size === 'title' ? 'title' : n.shape);
    const cur = drawAs(n.shape), cat = SYMS[cur]?.cat, ids = catalogue().find((c) => c.id === cat)?.ids || [];
    const out = [n.shape === 'agent' ? 'ai-agent' : n.shape];
    for (const id of [...recent.filter((r) => SYMS[r]?.cat === cat), ...ids]) if (!out.includes(id) && out.length < 7) out.push(id);
    return out;
  }
  function kindCells(n, q) {
    const T = th(), filter = replaceFilter();
    const ids = q.trim() ? searchSymbols(q, { boost: new Set([...fav, ...recent]) }).filter(filter).slice(0, 7) : siblingsOf(n);
    const cur = n && (n.shape === 'text' && n.size === 'title' ? 'title' : n.shape === 'agent' ? 'ai-agent' : n.shape);
    return ids.map((id) => pick('kind', id, miniSVG(id, T, 24), NAMES[id], { on: cur === id })).join('') +
      `<button data-act="gallery-replace" data-tip="Todos los símbolos" data-key="Ctrl+Espacio">${lineIcon('gallery')}</button>`;
  }
  pop.addEventListener('input', (e) => {
    if (!e.target.matches('.dg-ks input')) return;
    const n = data.nodes.find((x) => selN.has(x.id));
    pop.querySelector('.dg-kgrid').innerHTML = kindCells(n, e.target.value);
  });
  pop.addEventListener('keydown', (e) => {
    if (!e.target.matches('input')) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closePop(); root.focus({ preventScroll: true }); }
    else if (e.key === 'Enter') { e.preventDefault(); const b = pop.querySelector('.dg-kgrid [data-act="kind"]'); if (b && e.target.value.trim()) { closePop(); doAct('kind', b.dataset.arg); root.focus({ preventScroll: true }); } }
  });
  let popFor = null;
  function openPop(name, anchor, { at = null } = {}) {
    closeMenu();
    if (popFor === name && !at) { closePop(); return; }
    popFor = name;
    hideTip();                                           // the button's tooltip never sits on its own popover
    pop.innerHTML = popHTML(name);
    pop.className = 'dg-pop' + (pop.querySelector('.dg-row') ? ' dg-pop-rows' : '') + (name === 'kind' ? ' dg-pop-kind' : '');
    pop.hidden = false;
    const r = root.getBoundingClientRect(), W = root.clientWidth, H = root.clientHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x, y;
    if (at) { x = at.x + 16; y = at.y + 16; if (x + pw > W - 8) x = at.x - 16 - pw; if (y + ph > H - 8) y = at.y - 16 - ph; }
    else {
      // it opens on the side of the bar away from the selection, so it never covers what it changes
      const b = anchor.getBoundingClientRect(), br = bar.getBoundingClientRect(), sel = selectionScreen();
      x = b.left - r.left + b.width / 2 - pw / 2;
      if (sel && br.left - r.left >= sel.x + sel.w - 2) x = Math.max(x, br.left - r.left);          // the bar beside the selection: so is the popover
      if (sel && br.right - r.left <= sel.x + 2) x = Math.min(x, br.right - r.left - pw);
      const above = br.top - r.top - 6 - ph, below = br.bottom - r.top + 6;
      const barAbove = sel ? br.top - r.top < sel.y : false;
      y = barAbove ? (above >= 8 ? above : below) : (below + ph <= H - 8 ? below : above);
    }
    pop.style.transform = `translate(${Math.round(clamp(x, 8, W - pw - 8))}px, ${Math.round(clamp(y, 8, H - ph - 8))}px)`;
    pop.classList.remove('in');
    requestAnimationFrame(() => pop.classList.add('in'));
    if (editing) finishEdit({ keepEmpty: true });
    pop.querySelector('.dg-ks input')?.focus({ preventScroll: true });
  }
  function selectionScreen() {
    const map = index(), rs = [...selN].map((id) => map.get(id)).filter(Boolean).map((n) => (isFrame(n) ? box(n) : blockRect(n)));
    for (const id of selE) { const g = geoms.get(id); if (g) rs.push(union(g.poly.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))); }
    const u = union(rs);
    return u && { x: view.x + u.x * view.k, y: view.y + u.y * view.k, w: u.w * view.k, h: u.h * view.k };
  }
  function closePop() { if (!pop.hidden) { pop.hidden = true; popFor = null; clearPreview(); if (root.contains(document.activeElement) && document.activeElement.closest?.('.dg-pop')) root.focus({ preventScroll: true }); } }

  // Tooltips: the name and, in grey, its key. They wait 450 ms.
  let tipTimer = 0, tipFor = null;
  function showTip(el) {
    if (tipFor === el) return;
    hideTip();
    tipFor = el;
    tipTimer = setTimeout(() => {
      if (!el.isConnected || !el.dataset.tip) return;
      const need = el.dataset.need;
      tip.innerHTML = `<span>${esc(need || el.dataset.tip)}</span>${el.dataset.key && !need ? `<kbd>${esc(el.dataset.key)}</kbd>` : ''}`;
      tip.hidden = false;
      const r = root.getBoundingClientRect(), b = el.getBoundingClientRect(), tw = tip.offsetWidth, tH = tip.offsetHeight;
      let y = b.top - r.top - tH - 6;
      if (y < 4) y = b.bottom - r.top + 6;
      tip.style.transform = `translate(${Math.round(clamp(b.left - r.left + b.width / 2 - tw / 2, 4, root.clientWidth - tw - 4))}px, ${Math.round(y)}px)`;
    }, 450);
  }
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.hidden = true; }
  root.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && !svg.contains(el)) showTip(el); else if (!el) hideTip(); });
  root.addEventListener('pointerout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });

  // Hovering a button or a row for 120 ms previews it; leaving puts everything back.
  let pvTimer = 0, pvFor = null;
  const PREVIEWABLE = new Set(['arrange', 'flow', 'speed', 'flowdir', 'kind', 'form', 'color', 'size', 'status', 'trigger', 'frame', 'fitg', 'dash', 'route', 'head', 'align', 'dist', 'same', 'tidy', 'del', 'reverse', 'paintstyle', 'order']);
  function hoverAct(el) {
    if (pvFor === el) return;
    pvFor = el;
    clearTimeout(pvTimer);
    const act = el?.dataset.act;
    if (!el || el.classList.contains('dg-dim') || !PREVIEWABLE.has(act) || el.dataset.pop) { if (!el?.dataset.pop || act === 'align') clearPreview(); if (act === 'align' && el.dataset.pop) pvTimer = setTimeout(() => { const sa = smartAlign(); if (sa) previewAct('align', sa.how); }, 120); return; }
    pvTimer = setTimeout(() => previewAct(act, el.dataset.arg ?? undefined), 120);
  }
  for (const el of [bar, pop, menu]) {
    el.addEventListener('pointerover', (e) => hoverAct(e.target.closest('[data-act]')));
    el.addEventListener('pointerleave', () => { clearTimeout(pvTimer); pvFor = null; if (!(el === bar && !pop.hidden)) clearPreview(); });
  }
  for (const el of [bar, pal, reads, pop, menu, help, pill, $('.dg-zoom')]) el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (el !== pal && !e.target.closest('input')) e.preventDefault(); });
  function onActClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.classList.contains('dg-dim')) { refuse(b); return; }
    const act = b.dataset.act, arg = b.dataset.arg;
    if (b.dataset.pop) { openPop(b.dataset.pop, b); return; }
    if (act === 'align' && !b.dataset.arg) { keyAlign(); return; }
    if (act === 'more') return;
    if (act === 'gallery-replace') { closePop(); openGallery({ replace: true }); return; }
    if (act === 'copystyle') {                           // the brush: one click arms it once, a double click keeps it
      if (brush) { brush = null; paint(); return; }
      styleClip = styleOfSel();
      if (!styleClip) return;
      brush = e.detail >= 2 ? 'sticky' : 'once';
      root.classList.add('dg-brush');
      paint();
      return;
    }
    if (act === 'frontier-label') { startEdit('frontier'); return; }
    closePop(); closeMenu();
    doAct(act, arg === '' ? '' : arg);
    if (act === 'dist') lastDist = { axis: arg, t: now() };
  }
  bar.addEventListener('click', onActClick);
  bar.addEventListener('dblclick', (e) => { const b = e.target.closest('[data-act="copystyle"]'); if (b && styleOfSel()) { styleClip = styleOfSel(); brush = 'sticky'; root.classList.add('dg-brush'); paint(); } });
  pop.addEventListener('click', onActClick);
  reads.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { reading = +b.dataset.r; paint(); } });

  // Something that cannot be done says no without words: a short shake.
  function refuse(el = null, id = null) {
    if (el?.animate && !reducedMotion()) el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 180, easing: EASE.out });
    if (id) { lockPulse = { id, t: now() }; paint(); }
    if (el?.dataset?.need) showTip(el);
  }
  // A short word beside the bar for what a key just did («Centros en fila»).
  function sayIt(text) {
    say.textContent = text;
    say.hidden = false;
    const r = bar.hidden ? { x: root.clientWidth / 2, y: 40 } : (() => { const b = bar.getBoundingClientRect(), rr = root.getBoundingClientRect(); return { x: b.left - rr.left + b.width / 2, y: b.top - rr.top - 10 }; })();
    say.style.transform = `translate(${Math.round(clamp(r.x - say.offsetWidth / 2, 8, root.clientWidth - say.offsetWidth - 8))}px, ${Math.round(Math.max(8, r.y - say.offsetHeight))}px)`;
    say.classList.remove('in'); void say.offsetWidth; say.classList.add('in');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { say.hidden = true; }, 1200);
  }
  // After a big delete, an ungroup or a big paste: a small «Deshacer» pill for 4 s.
  function showPill() {
    pill.innerHTML = `<button data-undo="1">Deshacer <kbd>Ctrl+Z</kbd></button>`;
    pill.hidden = false;
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => hidePill(), 4000);
    pill.dataset.at = undo.length;
  }
  function hidePill(onAction = false) { if (pill.hidden) return; if (onAction && +pill.dataset.at === undo.length) return; pill.hidden = true; clearTimeout(pillTimer); }
  pill.addEventListener('click', (e) => { if (e.target.closest('[data-undo]')) { hidePill(); step(undo, redo); } });

  // ----- text editing: text never gets lost -----

  // What can be written on: a node's text, an arrow's label, the frontier's name.
  function target(kind, id) {
    if (kind === 'node') { const n = index().get(id); return n && { item: n, get: () => n.text, set: (v) => { n.text = v; } }; }
    if (kind === 'edge') { const e = data.edges.find((x) => x.id === id); return e && { item: e, get: () => e.text, set: (v) => { e.text = v; } }; }
    const fr = data.frontier;
    return fr && { item: fr, get: () => String(fr.label ?? ''), set: (v) => { fr.label = v; } };
  }

  // The textarea is created and focused right here, in the same event that asked for it (never later), so the first
  // key already lands in it.
  function startEdit(kind, id, { before = snap(), isNew = false, caret = 'end', keep = false, vanish = false } = {}) {
    const t = target(kind, id);
    if (!t) return;
    if (editing) finishEdit();
    const n = kind === 'node' ? t.item : null;
    if (n && isLocked(n)) return refuse(null, n.id);
    closePop(); closeMenu(); hideTip(); clearPreview();
    const ta = document.createElement('textarea');
    ta.className = 'dg-ta' + (kind !== 'node' || isFrame(n) || isLegend(n) ? ' dg-ta-up' : '') + (kind === 'frontier' || isFrame(n) || isLegend(n) || (n && (rightLabel(n) || isCard(n))) ? ' dg-ta-left' : '') + (kind === 'edge' ? ' dg-ta-e' : '');
    ta.value = t.get();
    ta.spellcheck = false;
    ta.rows = 1;
    if (vanish && n) vanishable.add(n.id);
    editing = { kind, id, t, ta, before, isNew, keep, h0: n?.h, t0: now(), lost: false, vanish: !!(n && vanishable.has(n.id)) };
    if (isNew && n) freshBase.set(n.id, before);
    root.append(ta);
    ta.addEventListener('input', () => {
      if (!editing || editing.ta !== ta) return;
      t.set(ta.value);
      if (n) {
        if (ta.value) fresh.delete(n.id);
        if (n.fitW && isClassic(n.shape)) { const cx = n.x + n.w / 2, w = fitWidth(n); if (w !== n.w) { n.w = w; n.x = Math.round(cx - w / 2); } }
        else if (SMALL_DISC[n.shape]) { const cx = n.x + n.w / 2, w = ta.value.length > 2 ? Math.max(n.h, Math.ceil(measure(ta.value, SMALL_DISC[n.shape][0], true) + 24)) : n.h; if (w !== n.w) { n.w = w; n.x = Math.round(cx - w / 2); } }
        n.h = Math.max(editing.h0, minH(n));
      }
      draw();
      scheduleChange();
    });
    // Pressing on the words being written and moving: the naming ends quietly (the piece stays, named or not) and the
    // piece moves, as if the press had been on the piece itself. A press without moving just places the caret.
    if (n && !isFrame(n)) ta.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p0 = pt(e), id0 = n.id;
      const mv = (ev) => {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        off();
        if (!editing || editing.ta !== ta) return;
        ev.preventDefault();
        finishEdit();
        root.focus({ preventScroll: true });
        if (!index().get(id0) || isLocked(index().get(id0))) return;
        select([id0]);
        mode = { type: 'move', p: p0, id: id0, add: false, wasSel: true, moved: false, before: null, orig: [], ctrl: false };
        try { svg.setPointerCapture(ev.pointerId); } catch { /* the pointer may be gone */ }
        onMove(ev);
      };
      const off = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', off, true); };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', off, true);
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); finishEdit({ refocus: true, esc: e.key === 'Escape' }); }
      else if (e.key === 'Tab' && kind === 'node' && !isFrame(n)) {
        e.preventDefault();
        const empty = !ta.value.trim();
        finishEdit({ refocus: true });
        if (!empty && index().get(n.id)) chain(e.shiftKey ? 'sibling' : 'next', n.id);
      } else if (e.key === 'Tab') { e.preventDefault(); finishEdit({ refocus: true }); }
    });
    // A blur only ends the edit when he chose to go somewhere else: not when the window lost focus (it comes back
    // here), not when our own controls took it, and not in the first moments after the piece was made.
    ta.addEventListener('blur', (e) => {
      if (!editing || editing.ta !== ta) return;
      const rt = e.relatedTarget;
      if (rt && root.contains(rt) && rt.tagName !== 'INPUT') { setTimeout(() => { if (editing?.ta === ta) ta.focus({ preventScroll: true }); }, 0); return; }
      if (!rt && !document.hasFocus()) { editing.lost = true; return; }
      if (!rt && now() - editing.t0 < 250) { setTimeout(() => { if (editing?.ta === ta) ta.focus({ preventScroll: true }); }, 0); return; }
      finishEdit({ keepEmpty: true });
    });
    hover = null;
    draw();
    ta.focus({ preventScroll: true });
    const c = caret === 'end' ? ta.value.length : clamp(caret, 0, ta.value.length);
    ta.setSelectionRange(c, c);
  }
  addEventListener('focus', onWinFocus);
  function onWinFocus() { if (editing?.lost) { editing.lost = false; editing.ta.focus({ preventScroll: true }); } }

  // A piece is never thrown away for having no name: whatever made it (an arrow dropped on empty space, the palette,
  // a key, Tab, a paste) it stays, and shows a faint placeholder. The one exception is a box made by double-clicking
  // empty space and left empty with Esc: that was a slip, so it goes, and one Ctrl+Z brings it back.
  // (keepEmpty is still accepted from older callers; nothing else removes a piece now.)
  function finishEdit({ refocus = false, keepEmpty = false, esc = false } = {}) {
    const ed = editing;
    if (!ed) return;
    editing = null;
    ed.ta.remove();
    ed.t.set(ed.t.get().replace(/^\s+|\s+$/g, ''));
    if (ed.kind === 'node') {
      const n = ed.t.item;
      if (ed.isNew && ed.vanish && esc && !n.text && !keepEmpty && !isFrame(n)) {
        const withPiece = snap();
        data = JSON.parse(ed.before); fresh.delete(n.id); vanishable.delete(n.id); prune();
        undo.push(ed.before, withPiece); redo = []; lastTag = null;       // Ctrl+Z: the empty box comes back
        typeahead = null; scheduleChange(); draw();
        if (refocus) root.focus({ preventScroll: true });
        return;
      }
      if (n.text) vanishable.delete(n.id);
      if (esc) fresh.delete(n.id);                       // he chose to stop naming it: the next key is a shortcut again
      {
        if (n.fitW && isClassic(n.shape)) { const cx = n.x + n.w / 2; n.w = fitWidth(n); n.x = Math.round(cx - n.w / 2); }
        if (!isFrame(n)) n.h = Math.max(ed.h0, minH(n));
        if (iconic(n)) {                                  // «×3» at the end of a symbol's words: three of them
          const m = /(^|\s)[×xX](\d{1,2})$/.exec(n.text);
          if (m && +m[2] >= 2) { n.count = +m[2]; n.text = n.text.slice(0, m.index).trim(); }
        }
        if (n.text) fresh.delete(n.id);
        growFrames(data.nodes);
        settleText(n);
      }
    }
    typeahead = null;
    commit(ed.before);
    scheduleChange();
    draw();
    if (refocus) root.focus({ preventScroll: true });
  }
  // A piece that grew while being written pushes its neighbours out of the way.
  function settleText(n) {
    const others = data.nodes.filter((m) => m !== n && !isFrame(m) && overlaps(blockRect(m), blockRect(n), 15.9));
    if (!others.length) return;
    const geo = geometry(data);
    settle(data, [n.id]);
    glideFrom(geo, { dur: DUR.smooth, ease: EASES.smooth });
  }

  // The textarea sits exactly where the words are drawn, at the same size.
  function placeEditor() {
    const { kind, t, ta } = editing, k = view.k, T = th();
    const put = (left, top, width, lines, fs, lh, colour, weight = 400) => Object.assign(ta.style, {
      left: view.x + left * k + 'px', top: view.y + top * k + 'px', width: width * k + 2 + 'px', height: Math.max(1, lines) * lh * k + 'px',
      fontSize: fs * k + 'px', lineHeight: lh * k + 'px', color: colour, fontWeight: weight,
    });
    if (kind === 'node') {
      const n = t.item;
      if (isFrame(n)) { const tx = frameTitleX(n), ty = n.shape === 'lane' ? (n.dir === 'v' ? 7 : 8) : frameStyle(n) === 'lane' ? 8 : 12; put(n.x + tx, n.y + ty, Math.max(120, n.w - tx - 20), 1, 12, 20, T.frameInk); }
      else if (isLegend(n)) put(n.x + 14, n.y + 8, n.w - 28, 1, 11, 18, T.muted);
      else if (isCard(n)) { const tw = Math.max(30, n.w - CARD_X - 12), lines = Math.max(1, wrap(n.text, tw, 15, true).length); put(n.x + CARD_X, n.y + n.h / 2 - (lines * 20) / 2, tw, lines, 15, 20, tintFor(drawAs(n.shape), T).ink, 600); }
      else if (rightLabel(n)) { const lines = Math.max(1, wrap(n.text, 160, LBF).length); put(n.x + n.w + 10, n.y + n.h / 2 - (lines * LBL) / 2, 160, lines, LBF, LBL, tintFor(drawAs(n.shape), T).ink); }
      else if (iconic(n)) { const lw = labelW(n); put(n.x + n.w / 2 - lw / 2, n.y + n.h + 6 + capDrop(n), lw, wrap(n.text, lw, LBF).length, LBF, LBL, (ICONS.has(n.shape) && isCatalogueSymbol(drawAs(n.shape)) ? tintFor(drawAs(n.shape), T) : T.tint[TINT_OF[n.shape]]).ink); }
      else {
        const tw = textW(n), [fs, lh, wt] = n.shape === 'operation' ? [FS, LH, 0] : fsOf(n), lines = n.shape === 'operation' ? wrap(n.text, tw).length : classicLines(n).length;
        const ink = n.shape === 'operation' ? T.tint.slate.ink : T.ink;
        put(n.x + (n.shape === 'operation' ? n.w / 2 : textCX(n)) - tw / 2 - 1, n.y + n.h / 2 - (lines * lh) / 2, tw, lines, fs, lh, ink, wt || 400);
      }
    } else if (kind === 'edge') {
      const g = geoms.get(t.item.id);
      if (!g) return;
      const lines = (t.item.text || ' ').split('\n'), w = Math.max(50, ...lines.map((l) => measure(upper(l), EFS) * 1.1)) + 6;
      put(g.lx - w / 2, g.ly - (lines.length * ELH) / 2, w, lines.length, EFS, ELH, '');
    } else {
      put(frontierLabelX(data), data.frontier.y + 8, 300, 1, 12, 20, T.frameInk);
    }
  }

  // The caret goes where he double-clicked: the nearest gap between letters on the clicked line.
  function caretAt(n, p) {
    let lines, top, lh, fs, bold = false, cxl = n.x + n.w / 2;
    let left = null;
    if (isCard(n) || isLegend(n) || isFrame(n)) return 'end';
    if (rightLabel(n)) { lines = n.text ? wrap(n.text, 160, LBF) : []; lh = LBL; fs = LBF; top = n.y + n.h / 2 - (lines.length * LBL) / 2; left = n.x + n.w + 10; }
    else if (iconic(n)) { lines = n.text ? wrap(n.text, labelW(n), LBF) : []; top = n.y + n.h + 6 + capDrop(n); lh = LBL; fs = LBF; }
    else if (isClassic(n.shape)) { [fs, lh] = fsOf(n); bold = !!fsOf(n)[2]; lines = classicLines(n); top = n.y + n.h / 2 - (lines.length * lh) / 2; }
    else return 'end';
    if (!lines.length || !n.text) return 'end';
    const li = clamp(Math.floor((p.y - top) / lh), 0, lines.length - 1);
    let pos = 0;
    const starts = lines.map((l) => { const i = n.text.indexOf(l, pos); const s = i < 0 ? pos : i; pos = s + l.length; return s; });
    const line = lines[li], x0 = left ?? (isClassic(n.shape) ? n.x + textCX(n) : cxl) - measure(line, fs, bold) / 2;
    let best = 0, bd = Infinity;
    for (let i = 0; i <= line.length; i++) { const d = Math.abs(x0 + measure(line.slice(0, i), fs, bold) - p.x); if (d < bd) { bd = d; best = i; } }
    return starts[li] + best;
  }

  // Sends a printable key into a piece's text when the textarea does not have it (typeahead after creation).
  function typeInto(ch) {
    const ta = editing?.ta;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    if (ch === 'Dead') return;
    ta.setRangeText(ch, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }

  // ----- creating -----

  // A new piece, centred on p (on the grid). `free`: it looks for an empty spot nearby and glides there.
  function makeNode(p, shape, color, { free = false, w: wantW, h: wantH } = {}) {
    const [dw, dh] = SIZE[shape];
    const w = wantW ?? dw, h = wantH ?? dh;
    const c = { x: snapG(p.x), y: snapG(p.y) };
    let x = Math.round(c.x - w / 2), y = Math.round(c.y - h / 2);
    const n = { id: newId(isFrame({ shape }) ? 'g' : 'n'), x, y, w, h, text: '', shape, color };
    if (isClassic(shape) && !SMALL_DISC[shape]) n.fitW = true;
    if (free && !isFrame(n)) {
      const r0 = blockRect(n), to = findFree(r0, blockers(), { C: 24, step: GRID });
      if (to.x !== r0.x || to.y !== r0.y) {
        n.x += to.x - r0.x; n.y += to.y - r0.y;
        if (!reducedMotion()) tweens.set(n.id, { from: { x, y, w, h }, t0: now(), dur: DUR.quick, ease: EASES.smooth });
      }
    }
    data.nodes.push(n);
    fresh.add(n.id);
    select([n.id]);
    typeahead = { id: n.id, t: now() };
    syncKids(data.nodes, [n.id]);
    return n;
  }
  const newEdge = (a, b, extra = {}) => ({ id: newId('e'), from: a.id, to: b.id, text: '', dash: 'solid', route: defaultRoute(a, b), ...extra });

  // Which way a chain is going at a piece: the direction of its incoming arrow, otherwise to the right.
  function flowDir(n) {
    const map = index(), e = data.edges.find((x) => x.to === n.id && x.from !== n.id);
    const p = e && map.get(e.from);
    if (!p) return 'r';
    const dx = n.x + n.w / 2 - (p.x + p.w / 2), dy = n.y + n.h / 2 - (p.y + p.h / 2);
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'r' : 'l') : (dy >= 0 ? 'b' : 't');
  }
  // Where the next piece goes beside `src` on side `dir`: 96 across, 72 down, aligned with it, on the grid; if that is
  // taken it slides sideways (24 at a time, both ways) and never lands in a frame that is not its source's.
  function spotBeside(src, dir, shape) {
    const [w, h] = SIZE[shape], se = blockRect(src), gap = dir === 'l' || dir === 'r' ? 96 : 72;
    let cx = src.x + src.w / 2, cy = src.y + src.h / 2;
    if (dir === 'r') cx = snapG(se.x + se.w + gap + w / 2); else if (dir === 'l') cx = snapG(se.x - gap - w / 2);
    else if (dir === 'b') cy = snapG(se.y + se.h + gap + h / 2); else cy = snapG(se.y - gap - h / 2 - (ICONS.has(shape) ? 26 : 0));
    const hb = blockers(), home = parentOf(src, data.nodes);
    const probe = { id: '\u0000', shape, w, h, text: '', x: 0, y: 0 };
    const ok = (x, y) => {
      probe.x = Math.round(x - w / 2); probe.y = Math.round(y - h / 2);
      const r = blockRect(probe);
      if (hb.queryRect(r, 16).some((id) => overlaps(r, hb.rect(id), 15.9))) return false;
      return parentOf(probe, data.nodes) === home;
    };
    const along = dir === 'l' || dir === 'r' ? [0, 1] : [1, 0];
    for (let i = 0; i < 25; i++) {
      const s = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 24;
      const x = cx + along[0] * s, y = cy + along[1] * s;
      if (ok(x, y)) return { x, y };
    }
    const r = findFree({ x: cx - w / 2, y: cy - h / 2, w, h }, hb, { C: 16, step: GRID });
    return { x: r.x + w / 2, y: r.y + h / 2 };
  }
  // Tab: the next piece in the chain (same kind and colour, connected from this one). Shift+Tab: a sibling (beside it,
  // connected from the same source).
  function chain(kind, id) {
    const src = index().get(id);
    if (!src || isFrame(src)) return;
    const before = snap();
    let n;
    if (kind === 'next') {
      const dir = flowDir(src), p = spotBeside(src, dir, src.shape);
      n = makeNode(p, src.shape, src.color);
      data.edges.push(newEdge(src, n));
    } else {
      const inE = data.edges.find((x) => x.to === src.id && x.from !== src.id), parent = inE && index().get(inE.from);
      const dir = flowDir(src), side = dir === 'l' || dir === 'r' ? 'b' : 'r';
      const p = spotBeside(src, side, src.shape);
      n = makeNode(p, src.shape, src.color);
      if (parent) data.edges.push(newEdge(parent, n, inE.dash !== 'solid' ? { dash: inE.dash } : {}));
    }
    startEdit('node', n.id, { before, isNew: true });
  }
  // A letter key, a palette click, the gallery or the finder: a piece of that kind. Next to the single selected piece
  // (connected, in the flow direction), or at `at` (connected from `from` when given: the finder at the pointer), or at
  // the pointer, or in a free spot in the middle of the view. A symbol chosen from the gallery is kept even unnamed.
  function insertPiece(shape, at = null, { from = undefined, keep = false, text = '' } = {}) {
    if (shape === 'frontier') return addFrontier(at || pointer || viewCentre());
    useKind(shape);
    let extra = null;
    if (SYMS[shape]?.kind === 'preset') { extra = { ...SYMS[shape].as }; shape = extra.shape; delete extra.shape; }
    const before = snap(), sel = selN.size === 1 && !selE.size ? index().get([...selN][0]) : null;
    let n;
    if (isFrame({ shape })) {
      const lane = sel && sel.shape === 'lane' && shape === 'lane' ? sel : null;
      if (lane) {                                        // a lane after a lane: right below it, as wide
        n = makeNode({ x: lane.x + lane.w / 2, y: lane.y + lane.h + lane.h / 2 }, 'lane', style.color, { w: lane.w, h: lane.h });
        n.x = lane.x; n.y = lane.y + lane.h; if (lane.dir) n.dir = lane.dir;
        startEdit('node', n.id, { before });
      } else if (selN.size) doGroup(shape);
      else { n = makeNode(at || pointer || viewCentre(), shape, style.color, { free: false }); startEdit('node', n.id, { before }); }
      return;
    }
    const color = isClassic(shape) ? style.color : PALETTE[0];
    let src = from !== undefined ? (from ? index().get(from) : null) : sel;
    if (src && (isFrame(src) || isLegend(src))) src = null;
    if (src && !isFrame(src) && !at) {
      n = makeNode(spotBeside(src, flowDir(src), shape), shape, color);
      data.edges.push(newEdge(src, n));
    } else if (src && !isFrame(src) && at) {
      n = makeNode(at, shape, color, { free: true });
      data.edges.push(newEdge(src, n));
    } else n = makeNode(at || pointer || viewCentre(), shape, color, { free: true });
    if (extra) Object.assign(n, extra);
    if (shape === 'step') n.text = String(Math.max(0, ...data.nodes.filter((m) => m.shape === 'step' && m !== n).map((m) => parseInt(m.text, 10) || 0)) + 1);
    if (text) n.text = text;
    if (n.fitW && (extra || text)) { const cx = n.x + n.w / 2; n.w = fitWidth(n); n.x = Math.round(cx - n.w / 2); }
    n.h = Math.max(n.h, minH(n));
    if (isLegend(n)) { fitLegends(data); fresh.delete(n.id); typeahead = null; select([n.id]); commit(before); paint(); return; }
    if (isClassic(shape) && shape !== 'step') style.shape = shape;
    startEdit('node', n.id, { before, isNew: true, keep: keep || ICONS.has(shape) || !!text || shape === 'step' });
  }
  function addFrontier(p) {
    edit(() => { data.frontier = { ...(data.frontier || {}), y: Math.round(p.y), label: data.frontier?.label ?? 'Dentro', ...(data.frontier ? {} : { out: 'Fuera' }) }; clearSel(); selF = true; });
  }
  const viewCentre = () => ({ x: (root.clientWidth / 2 + (palOpen ? 50 : 0) - view.x) / view.k, y: (root.clientHeight / 2 - view.y) / view.k });

  // The end of drawing an arrow: onto a piece (connects; the same arrow twice is refused and the old one flashes), onto
  // empty space (a new piece there, already connected, ready to be named).
  function finishConnect(m) {
    const map = index(), src = map.get(m.from);
    if (!src) return;
    if (m.target) {
      const t = map.get(m.target.id);
      if (t === src && !m.loopOk) return;
      const dup = data.edges.find((x) => x.from === src.id && x.to === t.id);
      if (dup) { flash = { id: dup.id, t: now() }; paint(); return; }
      // the arrow stays where it was drawn from (that side, and that port when the side had others), and lands on the
      // port he pointed at
      edit(() => {
        const e = newEdge(src, t);
        if (m.side && t !== src) { e.fromSide = m.side; if (m.at !== null && m.at !== undefined) e.fromAt = m.at; }
        if (m.portSide && t !== src) { e.toSide = m.portSide; if (m.portAt !== null && m.portAt !== undefined) e.toAt = m.portAt; }
        data.edges.push(e);
      });
      select([], [data.edges[data.edges.length - 1].id]);
    } else if (m.far && m.cur) {
      const before = snap(), g = m.ghost;
      const n = makeNode({ x: g.x + g.w / 2, y: g.y + g.h / 2 }, src.shape, src.color, { w: g.w, h: g.h });
      n.x = g.x; n.y = g.y;                                  // exactly where the ghost showed it (in line with its source)
      data.edges.push(newEdge(src, n));
      startEdit('node', n.id, { before, isNew: true });
    }
  }
  // Where a piece dropped from an arrow onto empty space would land: on the grid, in line with its source when close
  // to it, never on top of anything.
  // Dragged out of a side's dot, it lines up with its source on that side's axis unless he clearly went sideways.
  function ghostFor(src, cur, side = null) {
    const [w, h] = isClassic(src.shape) || isCard(src) ? SIZE[src.shape] : [src.w, src.h];   // a symbol's twin is its size
    let cx = snapG(cur.x), cy = snapG(cur.y);
    const sx = src.x + src.w / 2, sy = src.y + src.h / 2, dx = Math.abs(cur.x - sx), dy = Math.abs(cur.y - sy);
    const vert = side === 't' || side === 'b', horiz = side === 'l' || side === 'r';
    if (dy < 48 || (horiz && dy < Math.max(110, dx * 0.9))) cy = sy;
    if (dx < 48 || (vert && dx < Math.max(110, dy * 0.9))) cx = sx;
    const probe = { id: '\u0000', shape: src.shape, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, text: '' };
    const r = blockRect(probe), to = findFree(r, blockers(), { C: 16, step: GRID });
    return { x: probe.x + to.x - r.x, y: probe.y + to.y - r.y, w, h, shape: src.shape };
  }

  // ----- the symbols: the rail on the left, the gallery beside it, the finder at the pointer -----
  //
  // A click on a symbol adds it next to the selection (connected) or in a free spot in the middle of the view; a drag
  // drops it where it lands (onto an arrow: spliced into it; onto a piece: that piece becomes this kind). Recents and
  // favourites belong to whoever is looking, not to the diagram: they live in localStorage (meadow.dg.recent/.fav).

  const listed = (id) => !!SYMS[id] && !SYMS[id].hidden;
  const loadList = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? [...new Set(v.filter(listed))].slice(0, 12) : []; } catch { return []; } };
  const saveList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } };
  let recent = loadList('meadow.dg.recent'), fav = loadList('meadow.dg.fav');
  const hiddenSeed = new Set();
  const BASICS = ['text', 'note', 'box', 'group'], SEED = ['server', 'database', 'queue', 'person', 'browser', 'api'];
  function useKind(id) {
    if (!listed(id)) return;
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, 12);
    saveList('meadow.dg.recent', recent);
  }
  function quickKinds(nb = 6, skip = BASICS) {
    const out = [];
    for (const id of [...fav, ...recent, ...SEED]) if (!out.includes(id) && !skip.includes(id) && !hiddenSeed.has(id) && listed(id)) out.push(id);
    return out.slice(0, nb);
  }
  const catDot = (c, T) => (c.tint === 'frame' ? T.frame : c.tint ? T.tint[c.tint].s : darken(c.id === 'flow' ? PALETTE[2] : PALETTE[1]));
  const STAR = '<svg viewBox="0 0 24 24"><path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/></svg>';

  // Who can become what in REPLACE mode: frames only frames, pieces only pieces.
  function replaceFilter() {
    const sel = data.nodes.filter((n) => selN.has(n.id) && !isLocked(n));
    const frames = sel.length && sel.every(isFrame);
    return (id) => (frames ? FRAME_SET.has(id) : !FRAME_SET.has(id) && id !== 'frontier' && id !== 'legend');
  }

  // The gallery: search on top, the categories as dots down the left, every symbol in a grid.
  const gal = $('.dg-gal'), quick = $('.dg-quick');
  let galMode = null, galHi = -1;
  const galCache = new Map();
  const cellHTML = (id, T, size = 34) => `<button class="dg-cell${fav.includes(id) ? ' fav' : ''}" data-add="${id}" aria-label="${esc(SYMS[id].name)}">${miniSVG(id, T, size)}<span>${esc(SYMS[id].name)}</span><b class="dg-star" data-star="${id}">${STAR}</b></button>`;
  function galSections(T, filter) {
    const key = (data.theme === 'dark' ? 'd' : 'l') + (galMode === 'replace' ? JSON.stringify([...selN]) : '') + fav.join();
    if (galCache.has(key)) return galCache.get(key);
    const html = catalogue().map((c) => {
      const ids = c.ids.filter(filter);
      return ids.length ? `<section data-sec="${c.id}"><h5><i style="background:${catDot(c, T)}"></i>${esc(c.name)}</h5><div class="dg-gal-c">${ids.map((id) => cellHTML(id, T)).join('')}</div></section>` : '';
    }).join('');
    galCache.clear(); galCache.set(key, html);
    return html;
  }
  function openGallery({ replace = false } = {}) {
    if (editing) finishEdit({ keepEmpty: true });
    closePop(); closeMenu(); closeQuick(); hideTip();
    if (replace && !data.nodes.some((n) => selN.has(n.id) && !isLocked(n))) replace = false;
    galMode = replace ? 'replace' : 'add';
    const T = th(), filter = replace ? replaceFilter() : listed;
    gal.innerHTML = `<label class="dg-gal-s">${lineIcon(replace ? 'swap' : 'search')}<input type="text" placeholder="Buscar" spellcheck="false" autocomplete="off" aria-label="Buscar"></label>` +
      `<div class="dg-gal-b"><nav class="dg-gal-n">${CATS.filter((c) => catalogue().find((x) => x.id === c.id).ids.some(filter)).map((c) => `<button data-cat="${c.id}" data-tip="${esc(c.name)}"><i style="background:${catDot(c, T)}"></i></button>`).join('')}</nav><div class="dg-gal-g"></div></div>`;
    gal.hidden = false;
    gal.style.left = (pal.offsetLeft + pal.offsetWidth + 8) + 'px';
    gal.classList.remove('in'); requestAnimationFrame(() => gal.classList.add('in'));
    renderGal('');
    gal.querySelector('input').focus({ preventScroll: true });
    chromeKey = ''; paintChrome();
  }
  function closeGallery(refocus = false) {
    if (gal.hidden) return;
    gal.hidden = true; galMode = null;
    clearPreview();
    chromeKey = ''; paintChrome();
    if (refocus) root.focus({ preventScroll: true });
  }
  function renderGal(q) {
    const T = th(), body = gal.querySelector('.dg-gal-g'), filter = galMode === 'replace' ? replaceFilter() : listed;
    const boost = new Set([...fav, ...recent]);
    gal.querySelector('.dg-gal-n')?.toggleAttribute('hidden', !!q.trim());   // the category dots mean nothing while searching
    if (q.trim()) {
      const ids = searchSymbols(q, { boost }).filter(filter);
      body.innerHTML = ids.length ? `<div class="dg-gal-c dg-gal-r">${ids.map((id) => cellHTML(id, T)).join('')}</div>`
        : `<p class="dg-none">Sin símbolo para «${esc(q.trim())}». <kbd>Intro</kbd>: caja con ese texto.</p>`;
      galHi = ids.length ? 0 : -1;
      body.scrollTop = 0;
    } else {
      body.innerHTML = galSections(T, filter);
      const cur = galMode === 'replace' ? data.nodes.find((n) => selN.has(n.id))?.shape : null;
      const cells = [...body.querySelectorAll('.dg-cell')];
      galHi = cur ? cells.findIndex((c) => c.dataset.add === cur) : -1;
      if (galHi >= 0) cells[galHi].scrollIntoView({ block: 'center' });
    }
    markHi(gal, galHi);
  }
  function markHi(panel, i) {
    const cells = [...panel.querySelectorAll('.dg-cell')];
    cells.forEach((c, j) => c.classList.toggle('hi', j === i));
    if (cells[i]) { const b = cells[i].closest('.dg-gal-g, .dg-quick-g'); const r = cells[i].getBoundingClientRect(), br = b.getBoundingClientRect(); if (r.top < br.top + 28 || r.bottom > br.bottom) cells[i].scrollIntoView({ block: 'nearest' }); }
  }
  // Arrow keys move through a grid by where the cells are (rows wrap per section).
  function gridMove(panel, i, key) {
    const cells = [...panel.querySelectorAll('.dg-cell')];
    if (!cells.length) return -1;
    if (i < 0) return 0;
    if (key === 'ArrowRight') return Math.min(cells.length - 1, i + 1);
    if (key === 'ArrowLeft') return Math.max(0, i - 1);
    const r = cells[i].getBoundingClientRect(), down = key === 'ArrowDown';
    let best = -1, bd = Infinity;
    cells.forEach((c, j) => {
      const q = c.getBoundingClientRect(), dy = down ? q.top - r.top : r.top - q.top;
      if (dy < 6) return;
      const d = dy * 4 + Math.abs(q.left - r.left);
      if (d < bd) { bd = d; best = j; }
    });
    return best < 0 ? i : best;
  }
  function galChoose(id, { stay = false } = {}) {
    if (!id) return;
    if (galMode === 'replace') { closeGallery(true); doAct('kind', id); return; }
    if (!stay) closeGallery(false);
    insertPiece(id, null, { keep: true });
    if (stay) { chromeKey = ''; paintChrome(); }
  }
  // Nothing matches: a box with what he typed (a dead end always has a way out).
  function boxWithText(q, at = null, from = undefined) {
    const t = q.trim();
    if (t) insertPiece('box', at, { from, text: t });
  }
  gal.addEventListener('input', (e) => { if (e.target.matches('input')) renderGal(e.target.value); });
  gal.addEventListener('keydown', (e) => {
    if (!e.target.matches('input')) return;
    e.stopPropagation();
    const input = e.target;
    if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; renderGal(''); } else closeGallery(true); return; }
    if (['ArrowDown', 'ArrowUp'].includes(e.key) || (['ArrowLeft', 'ArrowRight'].includes(e.key) && galHi >= 0 && !input.value)) {
      e.preventDefault(); galHi = gridMove(gal, galHi, e.key); markHi(gal, galHi); hoverCell(gal.querySelectorAll('.dg-cell')[galHi]); return;
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const secs = [...gal.querySelectorAll('section')], cells = [...gal.querySelectorAll('.dg-cell')];
      const cur = cells[galHi]?.closest('section'), si = Math.max(0, secs.indexOf(cur)), to = secs[clamp(si + (e.key === 'PageDown' ? 1 : -1), 0, secs.length - 1)];
      if (to) { galHi = cells.indexOf(to.querySelector('.dg-cell')); to.scrollIntoView({ block: 'start' }); markHi(gal, galHi); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cell = gal.querySelectorAll('.dg-cell')[galHi];
      if (cell) galChoose(cell.dataset.add, { stay: e.shiftKey });
      else if (input.value.trim() && galMode !== 'replace') { const v = input.value; closeGallery(false); boxWithText(v); }
      if (e.shiftKey && !gal.hidden) { if (editing) finishEdit({ keepEmpty: true }); input.focus({ preventScroll: true }); }
      return;
    }
    if (e.key === 'Tab') e.preventDefault();
  });
  gal.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    const sec = gal.querySelector(`[data-sec="${c.dataset.cat}"]`), body = gal.querySelector('.dg-gal-g');
    if (sec) { const input = gal.querySelector('input'); if (input.value) { input.value = ''; renderGal(''); } body.scrollTo({ top: gal.querySelector(`[data-sec="${c.dataset.cat}"]`).offsetTop - 2, behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  });
  // In REPLACE mode, hovering a cell redraws the selection as that kind (nothing is kept until the click).
  let cellFor = null;
  function hoverCell(cell) {
    if (cellFor === cell) return;
    cellFor = cell;
    clearTimeout(pvTimer);
    if (galMode !== 'replace' || !cell) return clearPreview();
    pvTimer = setTimeout(() => previewAct('kind', cell.dataset.add), 120);
  }
  gal.addEventListener('pointerover', (e) => hoverCell(e.target.closest('.dg-cell')));
  gal.addEventListener('pointerleave', () => { cellFor = null; clearTimeout(pvTimer); clearPreview(); });
  // the star keeps a symbol in the rail
  function toggleFav(id) {
    fav = fav.includes(id) ? fav.filter((x) => x !== id) : [id, ...fav].slice(0, 12);
    saveList('meadow.dg.fav', fav);
    for (const c of root.querySelectorAll(`.dg-cell[data-add="${id}"]`)) c.classList.toggle('fav', fav.includes(id));
    galCache.clear(); chromeKey = ''; paintChrome();
  }

  // The finder at the pointer («/»): a search and the best few; Enter places it there (connected from the selected
  // piece, if there is one; Ctrl+Enter without connecting).
  let quickAt = null, quickFrom = null, quickHi = 0;
  function openQuick() {
    if (editing) finishEdit({ keepEmpty: true });
    closePop(); closeMenu(); closeGallery(); hideTip();
    const s1 = one();
    quickFrom = s1 && !isFrame(s1) && !isLegend(s1) ? s1.id : null;
    quickAt = pointer ? { x: snapG(pointer.x, 24), y: snapG(pointer.y, 24) } : (() => { const c = viewCentre(); return { x: snapG(c.x, 24), y: snapG(c.y, 24) }; })();
    quick.innerHTML = `<label class="dg-gal-s">${lineIcon('search')}<input type="text" placeholder="Buscar" spellcheck="false" autocomplete="off" aria-label="Buscar"></label><div class="dg-quick-g"></div>`;
    quick.hidden = false;
    const sp = toScreen(quickAt.x, quickAt.y), W = root.clientWidth, H = root.clientHeight, qw = quick.offsetWidth;
    renderQuick('');
    const qh = Math.max(quick.offsetHeight, 150);
    let x = sp.x + 12, y = sp.y + 12;
    if (x + qw > W - 8) x = sp.x - 12 - qw;
    if (y + qh > H - 8) y = sp.y - 12 - qh;
    quick.style.transform = `translate(${Math.round(clamp(x, 8, W - qw - 8))}px, ${Math.round(clamp(y, 8, H - qh - 8))}px)`;
    quick.classList.remove('in'); requestAnimationFrame(() => quick.classList.add('in'));
    quick.querySelector('input').focus({ preventScroll: true });
    paint();
  }
  function closeQuick(refocus = false) {
    if (quick.hidden) return;
    quick.hidden = true; quickAt = null; quickFrom = null;
    paint();
    if (refocus) root.focus({ preventScroll: true });
  }
  function renderQuick(q) {
    const T = th(), g = quick.querySelector('.dg-quick-g');
    const ids = q.trim() ? searchSymbols(q, { boost: new Set([...fav, ...recent]) }).filter(listed).slice(0, 8) : quickKinds(4, []);
    g.innerHTML = ids.length ? `<div class="dg-gal-c">${ids.map((id) => cellHTML(id, T)).join('')}</div>` : `<p class="dg-none">Sin símbolo para «${esc(q.trim())}». <kbd>Intro</kbd>: caja con ese texto.</p>`;
    quickHi = ids.length ? 0 : -1;
    markHi(quick, quickHi);
  }
  function quickChoose(id, { connect = true } = {}) {
    const at = quickAt, from = connect ? quickFrom : null;
    closeQuick();
    if (id) insertPiece(id, at, { from, keep: true });
  }
  quick.addEventListener('input', (e) => { if (e.target.matches('input')) renderQuick(e.target.value); });
  quick.addEventListener('keydown', (e) => {
    if (!e.target.matches('input')) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeQuick(true); return; }
    if (e.key.startsWith('Arrow') && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || !e.target.value)) { e.preventDefault(); quickHi = gridMove(quick, quickHi, e.key); markHi(quick, quickHi); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cell = quick.querySelectorAll('.dg-cell')[quickHi];
      if (cell) quickChoose(cell.dataset.add, { connect: !(e.ctrlKey || e.metaKey) });
      else { const v = e.target.value, at = quickAt, from = e.ctrlKey || e.metaKey ? null : quickFrom; closeQuick(); boxWithText(v, at, from); }
      return;
    }
    if (e.key === 'Tab') e.preventDefault();
  });
  quick.addEventListener('click', (e) => { const c = e.target.closest('.dg-cell'); if (c) quickChoose(c.dataset.add, { connect: !(e.ctrlKey || e.metaKey) }); });
  for (const el of [gal, quick]) el.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!e.target.closest('input')) e.preventDefault(); });

  // Press on a symbol (rail or gallery): a click adds it, a drag drops it where it lands.
  function symbolDown(e, from) {
    const b = e.target.closest('[data-add]');
    if (!b || e.button !== 0) return;
    e.preventDefault();
    if (editing) finishEdit({ keepEmpty: true });
    const shape = b.dataset.add, x0 = e.clientX, y0 = e.clientY;
    const real = SYMS[shape]?.kind === 'preset' ? SYMS[shape].as.shape : shape;
    const replacing = from === 'gal' && galMode === 'replace';
    let ghost = null;
    const drop = { splice: null, replace: null };
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) {
        ghost = document.createElement('div'); ghost.className = 'dg-ghost'; ghost.innerHTML = miniSVG(shape, th(), 40); root.append(ghost);
        mode = { type: 'palette', shape };
        if (from === 'gal' && !replacing) gal.classList.add('dg-gal-drag');
      }
      if (!ghost) return;
      if (mode?.type !== 'palette') mode = { type: 'palette', shape, replace: drop.replace };
      const r = root.getBoundingClientRect();
      ghost.style.transform = `translate(${ev.clientX - r.left - 20}px, ${ev.clientY - r.top - 20}px)`;
      const p = pt(ev), hit = document.elementFromPoint(ev.clientX, ev.clientY), onCanvas = hit && (hit === svg || svg.contains(hit));
      // onto a piece: it would become this kind (shown at once, kept only on release)
      const over = onCanvas && !FRAME_SET.has(real) && real !== 'frontier' && real !== 'legend' ? nodeAt(p) : null;
      const target = over && !isLocked(over) && !isLegend(over) ? over : null;
      if ((target?.id ?? null) !== (mode.replace ?? null)) {
        mode.replace = target?.id ?? null;
        if (target) { const D = clone(data), n = D.nodes.find((x) => x.id === target.id); reshape(n, shape); pv = { data: D }; } else pv = null;
      }
      mode.splice = !target && onCanvas && !ev.altKey && !FRAME_SET.has(real) && real !== 'frontier' ? edgeNear(p, 14 / view.k)?.e.id ?? null : null;
      drop.splice = mode.splice; drop.replace = mode.replace ?? null;
      const g = onCanvas && real !== 'frontier' && !target ? frameAt(p) : null;
      hoverG = g ? g.id : null;
      paint();
    };
    const cancel = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', escKey, true); ghost?.remove(); ghost = null; gal.classList.remove('dg-gal-drag'); if (mode?.type === 'palette') mode = null; pv = null; hoverG = null; paint(); };
    const escKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); } };
    const up = (ev) => {
      const sp = drop.splice, rep = drop.replace, wasGhost = !!ghost;     // (kept here: other handlers may end the gesture first)
      cancel();
      if (wasGhost) {
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!(hit && (hit === svg || svg.contains(hit)))) return;
        const p = pt(ev);
        if (from === 'gal' && !ev.shiftKey) closeGallery(false);
        if (rep) { select([rep]); doAct('kind', shape); root.focus({ preventScroll: true }); return; }
        if (replacing) return;
        if (real === 'frontier') { addFrontier(p); return; }
        useKind(shape);
        const before = snap();
        clearSel();
        let extra = null;
        if (SYMS[shape]?.kind === 'preset') { extra = { ...SYMS[shape].as }; delete extra.shape; }
        const n = makeNode(p, real, isClassic(real) || FRAME_SET.has(real) ? style.color : PALETTE[0]);
        if (extra) Object.assign(n, extra);
        if (real === 'step') n.text = String(Math.max(0, ...data.nodes.filter((m) => m.shape === 'step' && m !== n).map((m) => parseInt(m.text, 10) || 0)) + 1);
        n.h = Math.max(n.h, minH(n));
        if (sp) spliceMut(data, n.id, sp);
        if (isLegend(n)) { fitLegends(data); fresh.delete(n.id); typeahead = null; commit(before); paint(); return; }
        startEdit('node', n.id, { before, isNew: !isFrame(n), keep: ICONS.has(real) || real === 'step' });
      } else {
        if (from === 'gal') { galChoose(shape, { stay: ev.shiftKey }); return; }
        insertPiece(shape, null, { keep: true });
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('keydown', escKey, true);
  }
  pal.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.dg-pal-t')) {
      palOpen = !palOpen;
      try { localStorage.setItem('meadow.dg.palette', palOpen ? 'on' : 'off'); } catch { /* storage may be blocked */ }
      if (!palOpen) closeGallery();
      paint();
      return;
    }
    if (e.target.closest('.dg-pal-gal')) { e.preventDefault(); if (galMode) closeGallery(true); else openGallery(); return; }
    symbolDown(e, 'pal');
  });
  // right click on a quick cell: it leaves the rail (out of favourites and recents)
  pal.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const b = e.target.closest('.dg-pal-q[data-add]');
    if (!b) return;
    const id = b.dataset.add;
    fav = fav.filter((x) => x !== id); recent = recent.filter((x) => x !== id);
    saveList('meadow.dg.fav', fav); saveList('meadow.dg.recent', recent);
    hiddenSeed.add(id);
    chromeKey = ''; paintChrome();
  });
  gal.addEventListener('pointerdown', (e) => {
    const st = e.target.closest('[data-star]');
    if (st) { e.preventDefault(); e.stopPropagation(); toggleFav(st.dataset.star); return; }
    symbolDown(e, 'gal');
  }, true);

  // ----- clipboard -----

  function selectionCopy(ids = selN) {
    const set = new Set(ids);
    for (const n of data.nodes) if (set.has(n.id) && isFrame(n)) for (const m of contentsOf(n, data.nodes)) set.add(m.id);
    const nodes = data.nodes.filter((n) => set.has(n.id));
    return { nodes: clone(nodes), edges: clone(data.edges.filter((e) => set.has(e.from) && set.has(e.to))) };
  }
  // Pastes a block of pieces: at `at` (centred) or `off` away from where they were, then to the nearest free spot.
  function insert(c, { off = 24, at = null } = {}) {
    if (!c?.nodes.length) return [];
    const ids = new Map(), added = [];
    edit(() => {
      const b = union(c.nodes.map((n) => (isFrame(n) ? box(n) : blockRect(n))));
      let dx = off, dy = off;
      if (at) { dx = Math.round(snapG(at.x) - (b.x + b.w / 2)); dy = Math.round(snapG(at.y) - (b.y + b.h / 2)); }
      const to = findFree({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, blockers(), { C: 16, step: GRID });
      dx = to.x - b.x; dy = to.y - b.y;
      clearSel();
      for (const n of c.nodes) {
        const m = { ...clone(n), id: newId(isFrame(n) ? 'g' : 'n'), x: n.x + dx, y: n.y + dy };
        delete m.locked;
        ids.set(n.id, m.id);
        data.nodes.push(m);
        selN.add(m.id);
        added.push(m.id);
      }
      for (const n of data.nodes) if (added.includes(n.id) && Array.isArray(n.kids)) n.kids = n.kids.map((k) => ids.get(k)).filter(Boolean);
      for (const e of c.edges) data.edges.push({ ...clone(e), id: newId('e'), from: ids.get(e.from), to: ids.get(e.to) });
    });
    if (added.length >= 5) showPill();
    return added;
  }
  const duplicate = () => insert(selectionCopy(), { off: 24 });
  function copySel(cut = false) {
    if (!selN.size) return;
    clip = selectionCopy(); pasteN = 0;
    try { navigator.clipboard?.writeText?.(JSON.stringify({ meadowDiagram: 1, ...clip })).catch(() => {}); } catch { /* not allowed: the internal copy still works */ }
    if (cut) removeSel({ force: true });
  }
  // Ctrl+V: what the system clipboard holds wins (pieces copied here, or plain text that becomes a Texto piece at the
  // pointer); if it cannot be read, the last internal copy.
  let pasteWait = 0;
  function pasteKey() {
    clearTimeout(pasteWait);
    pasteWait = setTimeout(() => { pasteWait = 0; pasteClip(); }, 80);
  }
  function pasteClip() {
    if (!clip) return;
    pasteN++;
    insert(clip, pointer ? { at: pointer } : { off: 24 * pasteN });
  }
  function pasteText(text) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* plain text */ }
    if (parsed?.meadowDiagram && Array.isArray(parsed.nodes)) { clip = { nodes: parsed.nodes, edges: parsed.edges || [] }; pasteClip(); return; }
    const t = text.replace(/\r/g, '').trim();
    if (!t) { pasteClip(); return; }
    const before = snap(), n = makeNode(pointer || viewCentre(), 'text', PALETTE[0], { free: true });
    n.text = t.slice(0, 2000);
    n.w = fitWidth(n); n.h = Math.max(n.h, minH(n));
    fresh.delete(n.id);
    typeahead = null;
    commit(before);
    paint();
  }
  root.addEventListener('paste', (e) => {
    if (editing || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    clearTimeout(pasteWait); pasteWait = 0;
    pasteText(text);
  });

  // ----- safe delete: what will go is shown first -----

  // The victims: the selected pieces (never locked ones), every arrow touching them, the selected arrows, the frontier.
  // A selected frame goes alone (its pieces stay); with Shift, its pieces go too.
  function victims(withContents = false) {
    const nodes = new Set(), edges = new Set();
    for (const n of data.nodes) {
      if (!selN.has(n.id) || isLocked(n)) continue;
      nodes.add(n.id);
      if (isFrame(n) && withContents) for (const m of contentsOf(n, data.nodes)) if (!isLocked(m)) nodes.add(m.id);
    }
    for (const e of data.edges) if ((selE.has(e.id) && !isLocked(e)) || nodes.has(e.from) || nodes.has(e.to)) edges.add(e.id);
    return { nodes, edges, frontier: selF };
  }
  function removeSel({ withContents = false, force = false } = {}) {
    const v = victims(withContents);
    if (!v.nodes.size && !v.edges.size && !v.frontier) { const locked = data.nodes.find((n) => selN.has(n.id) && isLocked(n)); if (locked) refuse(null, locked.id); return; }
    // off-screen victims: first glide to show them all, washed; a second Delete within 4 s confirms
    const vr = viewRect(), off = [...v.nodes].some((id) => { const n = index().get(id); return n && !overlaps(isFrame(n) ? box(n) : ext(n), vr); });
    if (off && !force && !(confirmDel && now() - confirmDel < 4000)) {
      confirmDel = now();
      pv = { wash: v };
      const b = union(data.nodes.filter((n) => v.nodes.has(n.id)).map((n) => (isFrame(n) ? box(n) : ext(n))));
      if (b) glide(fitTo(b, 96));
      paint();
      return;
    }
    confirmDel = null;
    clearPreview();
    fadeOut(v);
    const count = v.nodes.size;
    edit(() => {
      data.nodes = data.nodes.filter((n) => !v.nodes.has(n.id));
      data.edges = data.edges.filter((e) => !v.edges.has(e.id));
      if (v.frontier) delete data.frontier;
      clearSel();
    });
    if (count >= 3) showPill();
  }
  // Shift+Supr on a piece between exactly one arrow in and one out: it goes and its neighbours are joined.
  function removeAndJoin() {
    const n = data.nodes.find((x) => selN.has(x.id));
    if (selN.size !== 1 || !n || isLocked(n)) return removeSel({ withContents: true });
    const ins = data.edges.filter((e) => e.to === n.id && e.from !== n.id), outs = data.edges.filter((e) => e.from === n.id && e.to !== n.id);
    if (isFrame(n) || ins.length !== 1 || outs.length !== 1) return removeSel({ withContents: true });
    fadeOut(victims());
    edit(() => {
      const a = ins[0], b = outs[0];
      a.to = b.to; delete a.toSide;
      data.nodes = data.nodes.filter((x) => x !== n);
      data.edges = data.edges.filter((e) => e === a || (e.from !== n.id && e.to !== n.id));
      clearSel();
    });
  }
  // What goes fades out (the data is already gone; only a copy fades).
  function fadeOut(v) {
    if (reducedMotion()) return;
    for (const id of v.nodes) { const el = nodeEls.get(id)?.el; if (el) { const c = el.cloneNode(true); c.removeAttribute('data-n'); fadeLayer.append(c); c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.quick, easing: EASE.out }).onfinish = () => c.remove(); } }
    for (const id of v.edges) { const el = edgeEls.get(id)?.el; if (el) { const c = el.cloneNode(true); c.removeAttribute('data-e'); fadeLayer.append(c); c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.quick, easing: EASE.out }).onfinish = () => c.remove(); } }
  }

  // ----- presentation: walk the chain, one step at a time -----
  //
  // What comes later waits faint, what was shown stays, the current step glows; data travels the step's arrows once and
  // the piece lights up as it arrives. Drag and wheel still move the view; nothing can be edited. Esc goes back to where
  // he was, with his selection.

  const steps = $('.dg-steps');
  function startShow({ from = null } = {}) {
    if (show) return stopShow();
    if (editing) finishEdit();
    closePop(); closeMenu(); hideTip(); hideHelp(); closeQuick(); if (galMode) closeGallery();
    const list = tourSteps(data, isFrame);
    if (!list.length) return;
    let i = 0;
    if (from) { const at = list.findIndex((s) => s.nodes.includes(from)); if (at >= 0) i = at; }
    show = { steps: list, i: -1, view0: { ...view }, sel0: [new Set(selN), new Set(selE), selF], seen: new Set(), visited: new Set(), cur: new Set(), arrive: 0 };
    clearSel(); hover = hoverE = hoverG = null;
    root.classList.add('dg-show');
    for (let j = 0; j < i; j++) for (const id of list[j].nodes) show.seen.add(id);   // what comes before counts as shown
    showGo(i, true);
  }
  function stopShow() {
    if (!show) return;
    const s = show;
    show = null;
    fadeLayer.replaceChildren();
    steps.hidden = true;
    root.classList.remove('dg-show');
    [selN, selE, selF] = s.sel0;
    glide(s.view0, { dur: 520 });
    paint();
  }
  function showGo(i, first = false) {
    const s = show;
    if (!s) return;
    i = clamp(i, 0, s.steps.length - 1);
    if (i === s.i && !first) return;
    const back = i < s.i;
    if (back) { s.seen = new Set(); for (let j = 0; j < i; j++) for (const id of s.steps[j].nodes) s.seen.add(id); }
    else if (!first) for (let j = Math.max(0, s.i); j < i; j++) for (const id of s.steps[j].nodes) s.seen.add(id);
    const st = s.steps[i], cur = new Set(st.nodes), before = new Set(s.seen);
    s.i = i; s.cur = cur;
    for (const id of cur) s.seen.add(id);
    s.visited = new Set(data.edges.filter((e) => s.seen.has(e.from) && s.seen.has(e.to)).map((e) => e.id));
    if (st.reading !== undefined && Array.isArray(data.readings)) { const r = typeof st.reading === 'number' ? st.reading : data.readings.map(String).indexOf(String(st.reading)); if (r >= 0) reading = r; }
    // the step's arrows carry one packet each; the piece lights up when it arrives
    const incoming = data.edges.filter((e) => cur.has(e.to) && before.has(e.from));
    fadeLayer.replaceChildren();
    const play = !back && !first && incoming.length > 0 && !reducedMotion();
    s.arrive = play ? now() + 700 : 0;
    if (play) {
      const T = th(), byId = index();
      for (const e of incoming) {
        const g = geoms.get(e.id), pp = g && packetPath(g, ROUTES.includes(e.route) ? e.route : (g.curve ? 'curve' : 'elbow'), e.head);
        if (!pp) continue;
        const el = document.createElementNS(NS, 'path');
        el.setAttribute('d', pp.d); el.setAttribute('fill', 'none'); el.setAttribute('stroke-width', '4.5'); el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('stroke', packetColour(edgeColour(e, byId, T, null), data.theme === 'dark', T.ink));
        el.setAttribute('stroke-dasharray', `10 ${Math.ceil(pp.len + 40)}`);
        fadeLayer.append(el);
        el.animate([{ strokeDashoffset: 10 }, { strokeDashoffset: -pp.len }], { duration: 700, easing: EASE.smooth }).onfinish = () => el.remove();
      }
      setTimeout(paint, 720);
    }
    // the camera: the current pieces and where they came from, unless they are already comfortably in view
    const map = index(), focus = [...cur, ...incoming.map((e) => e.from)].map((id) => map.get(id)).filter(Boolean).map(ext);
    const b = union(focus);
    if (b) {
      const vr = viewRect(), m = 80 / view.k;
      const inView = b.x >= vr.x + m && b.y >= vr.y + m && b.x + b.w <= vr.x + vr.w - m && b.y + b.h <= vr.y + vr.h - m;
      if (!inView || first) {
        const all = bounds(data.nodes, true), kAll = all ? fitTo(all).k : 1;
        const band = { t: data.readings?.length ? 60 : 16, b: 70 };
        let to = fitTo(b, 120, 1.1, band);
        if (to.k < kAll) to = fitTo(b, 120, kAll, band);
        if (to.k < kAll) { const W = root.clientWidth, H = root.clientHeight; to = { k: kAll, x: W / 2 - (b.x + b.w / 2) * kAll, y: H / 2 - (b.y + b.h / 2) * kAll }; }
        glide(to, { dur: 520 });
      }
    }
    // the step bar: ‹ what this step is · where we are ›
    steps.innerHTML = `<button data-s="prev" data-tip="Anterior" data-key="←"${i === 0 ? ' class="dg-dim"' : ''}>${lineIcon('prev')}</button>` +
      `<span class="dg-steps-t">${esc(st.say || '')}</span><span class="dg-steps-n">${i + 1} / ${s.steps.length}</span>` +
      `<button data-s="next" data-tip="Siguiente" data-key="→"${i === s.steps.length - 1 ? ' class="dg-dim"' : ''}>${lineIcon('next')}</button><i class="dg-sep"></i>` +
      `<button data-s="close" data-tip="Terminar" data-key="Esc">${lineIcon('close')}</button>`;
    steps.hidden = false;
    paint();
  }
  function showKey(e) {
    const k = e.key, sh = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'Escape' || k === 'F5' || k.toLowerCase() === 'p') return stopShow();
    if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(k) || (k === ' ' && !sh)) return showGo(show.i + 1);
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k) || (k === ' ' && sh)) return showGo(show.i - 1);
    if (k === 'Home') return showGo(0);
    if (k === 'End') return showGo(show.steps.length - 1);
  }
  steps.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  steps.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || !show) return;
    if (b.dataset.s === 'close') stopShow(); else showGo(show.i + (b.dataset.s === 'next' ? 1 : -1));
    root.focus({ preventScroll: true });
  });

  // ----- view -----

  // Pause or play the data in motion: the viewer's own preference, remembered on this device, never in the drawing.
  function toggleMotion() {
    motionPref = motionOn() ? 'off' : 'on';
    try { localStorage.setItem('meadow.dg.motion', motionPref); } catch { /* storage may be blocked */ }
    sayIt(motionPref === 'on' ? 'En movimiento' : 'En pausa');
    paint();
  }

  const stopGlide = () => { cancelAnimationFrame(anim); anim = 0; };
  function glide(to, { dur = DUR.smooth } = {}) {
    stopGlide();
    if (reducedMotion()) { Object.assign(view, to); paint(); return; }
    const from = { ...view }, t0 = now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = EASES.smooth(p);
      view.x = from.x + (to.x - from.x) * e; view.y = from.y + (to.y - from.y) * e; view.k = from.k + (to.k - from.k) * e;
      draw();
      anim = p < 1 ? requestAnimationFrame(tick) : 0;
    };
    anim = requestAnimationFrame(tick);
  }
  function zoomTo(k, sx, sy) { return { k, x: sx - ((sx - view.x) * k) / view.k, y: sy - ((sy - view.y) * k) / view.k }; }
  // reserve: bands kept clear at the top and bottom (the pills of a presentation sit there)
  function fitTo(b, margin = 64, maxK = 1, reserve = { t: 0, b: 0 }) {
    const W = root.clientWidth, H = root.clientHeight - reserve.t - reserve.b, left = palOpen ? 100 : 0;
    const k = clamp(Math.min((W - left - 2 * margin) / b.w, (H - 2 * margin) / b.h, maxK), 0.1, 4);
    return { k, x: left + (W - left) / 2 - (b.x + b.w / 2) * k, y: reserve.t + H / 2 - (b.y + b.h / 2) * k };
  }
  function fitView(animate = true) {
    const W = root.clientWidth, H = root.clientHeight, left = palOpen ? 100 : 0;
    if (!W || !H) return;
    let b = bounds(data.nodes, true);
    if (b && data.frontier && num(data.frontier.y) !== null) { const y0 = Math.min(b.y, data.frontier.y - 40), y1 = Math.max(b.y + b.h, data.frontier.y + 30); b = { ...b, y: y0, h: y1 - y0 }; }
    const to = b ? fitTo(b) : { x: left + (W - left) / 2, y: H / 2, k: 1 };
    if (animate) glide(to); else { Object.assign(view, to); draw(); }
  }
  function zoomSel() {
    const b = union([...data.nodes.filter((n) => selN.has(n.id)).map((n) => (isFrame(n) ? box(n) : ext(n))), ...[...selE].map((id) => geoms.get(id)).filter(Boolean).map((g) => union(g.poly.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))))].filter(Boolean));
    if (b) glide(fitTo(b, 96, 2));
  }
  // A click on a piece that is mostly off-screen brings it fully into view.
  function reveal(n) {
    const e = isFrame(n) ? box(n) : ext(n), vr = viewRect();
    const ix = Math.max(0, Math.min(e.x + e.w, vr.x + vr.w) - Math.max(e.x, vr.x)), iy = Math.max(0, Math.min(e.y + e.h, vr.y + vr.h) - Math.max(e.y, vr.y));
    if ((ix * iy) / (e.w * e.h || 1) >= 0.6) return;
    const m = 48 / view.k;
    let dx = 0, dy = 0;
    if (e.x < vr.x + m) dx = vr.x + m - e.x; else if (e.x + e.w > vr.x + vr.w - m) dx = vr.x + vr.w - m - e.x - e.w;
    if (e.y < vr.y + m) dy = vr.y + m - e.y; else if (e.y + e.h > vr.y + vr.h - m) dy = vr.y + vr.h - m - e.y - e.h;
    glide({ k: view.k, x: view.x + dx * view.k, y: view.y + dy * view.k });
  }

  $('.dg-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const z = b.dataset.z;
    if (z === 'fit') fitView();
    else if (z === 'theme') {
      // the theme crossfades (a quick dissolve of the canvas only), where the browser can
      const flip = () => { edit(() => { data.theme = data.theme === 'dark' ? 'light' : 'dark'; }); draw(); };
      if (document.startViewTransition && !reducedMotion()) { root.style.viewTransitionName = 'dg-canvas'; const vt = document.startViewTransition(flip); vt.finished.finally(() => { root.style.viewTransitionName = ''; }); }
      else flip();
    }
    else if (z === 'help') toggleHelp();
    else if (z === 'motion') toggleMotion();
    else if (z === 'present') { startShow(); return; }
    else if (z === 'tidy') doAct('tidy');
    else glide(zoomTo(1, root.clientWidth / 2, root.clientHeight / 2));
    root.focus({ preventScroll: true });
  });
  $('.dg-zoom').addEventListener('pointerover', (e) => { const b = e.target.closest('[data-z="tidy"]'); if (b) { clearTimeout(pvTimer); pvTimer = setTimeout(() => previewAct('tidy'), 120); } });
  $('.dg-zoom').addEventListener('pointerout', (e) => { if (e.target.closest('[data-z="tidy"]') && !e.target.closest('[data-z="tidy"]').contains(e.relatedTarget)) { clearTimeout(pvTimer); clearPreview(); } });

  // ----- pointer -----

  const pt = (e) => {
    const r = svg.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };
  // The invisible group a click on `n` would pick first (PowerPoint: the first click takes the whole group).
  function groupFirst(n) {
    let g = parentOf(n, data.nodes), pick = null;
    while (g) {
      if (frameStyle(g) === 'none' && !selN.has(g.id)) pick = g;
      if (selN.has(g.id)) break;
      g = parentOf(g, data.nodes);
    }
    return pick;
  }

  svg.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll on middle click
  svg.addEventListener('pointerenter', (e) => { pointer = pt(e); });
  svg.addEventListener('pointerdown', (e) => {
    stopGlide();
    if (lens && e.button !== 2) closeLens();                 // any press ends a lens (it only looks)
    if (show) {                                          // presenting: drag moves the view, a click goes on
      if (e.button !== 0 && e.button !== 1) return;
      const p = pt(e);
      mode = { type: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y, p, show: true };
      root.classList.add('dg-panning');
      svg.setPointerCapture(e.pointerId);
      return;
    }
    closePop(); closeMenu(); hideTip(); hideHelp(); closeQuick(); if (galMode) closeGallery();
    // the second click of a double click on a connection dot: he wanted a loose piece there, not the connected one
    if (e.button === 0 && lastDotClick && now() - lastDotClick.t < 450 && Math.hypot(e.clientX - lastDotClick.cx, e.clientY - lastDotClick.cy) < 8) {
      if (editing) { const ta = editing.ta; editing = null; ta.remove(); }
      const before = lastDotClick.before;
      data = JSON.parse(before); lastDotClick = null; fresh.clear(); prune(); clearSel();
      const n = makeNode(pt(e), style.shape, style.color, { free: true });
      e.preventDefault();
      swallowDbl = now();
      startEdit('node', n.id, { before, isNew: true, vanish: true });
      return;
    }
    if (editing) finishEdit();
    root.focus({ preventScroll: true });
    if (confirmDel) { confirmDel = null; clearPreview(); }
    const p = pt(e), add = e.shiftKey || e.ctrlKey || e.metaKey, t = e.target;
    pointer = p;
    const dot = t.closest('[data-dot]'), rs = t.closest('[data-rs]'), endH = t.closest('[data-end]'), fr = t.closest('[data-f]'), eg = t.closest('[data-e]');
    // a piece is grabbed anywhere on it, its border included (a few pixels either side); only its port dots and arrow
    // roots, exactly on them, start or move an arrow instead
    let ng = t.closest('[data-n]');
    const nearN = !ng && !dot && !rs && !endH && !t.closest('[data-tiph]') ? nodeAt(p, 10 / view.k) : null;
    if (nearN) ng = nodeEls.get(nearN.id)?.el || null;
    if (e.button === 2) return;
    // the format painter: the next click applies the copied style
    if (brush && e.button === 0 && (ng || eg)) {
      const id = ng ? ng.getAttribute('data-n') : eg.getAttribute('data-e');
      edit(() => styleMut(data, styleClip, new Set([id])));
      if (brush === 'once') { brush = null; root.classList.remove('dg-brush'); }
      paint();
      return;
    }
    if (e.button === 1 || (e.button === 0 && spaceHeld) || (e.button === 0 && panOnDrag && !add && !dot && !rs && !endH && !fr && !ng && !eg)) {
      mode = { type: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y, p, empty: !ng && !eg && !dot && !fr };
      root.classList.add('dg-panning');
    } else if (e.button !== 0) return;
    else if (dot) {
      const src = index().get(dot.dataset.dot);
      mode = { type: 'connect', from: dot.dataset.dot, side: dot.dataset.side, at: dot.dataset.at !== undefined ? +dot.dataset.at : null, p, cx: e.clientX, cy: e.clientY, cur: null, target: null, far: false, t0: now(), route: src ? (symbolic(src) ? 'elbow' : 'curve') : 'curve' };
    } else if (rs) {
      const n = index().get(rs.dataset.rs);
      mode = { type: 'resize', n, dir: rs.dataset.h, p, o: box(n), before: snap(), lines: snapLines(snapBoxes(new Set([n.id]))) };
    } else if (endH) {
      const e0 = data.edges.find((x) => x.id === endH.dataset.eid);
      if (e0) mode = { type: 'reanchor', eid: e0.id, which: endH.dataset.end, fixed: endH.dataset.end === 'from' ? e0.to : e0.from, p, cur: p, target: null, before: snap(), route: e0.route };
    } else if (fr) { clearSel(); selF = true; mode = { type: 'frontier', p, y: data.frontier.y, before: snap() }; }
    else if (ng) {
      let id = ng.getAttribute('data-n');
      const n = index().get(id);
      if (!add) { const g = !isFrame(n) ? groupFirst(n) : null; if (g) id = g.id; }
      if (isLocked(index().get(id)) && !add) {
        if (!selN.has(id)) select([id]);
        lockPulse = { id, t: now() };
        mode = { type: 'pan', sx: p.sx, sy: p.sy, vx: view.x, vy: view.y, p, locked: id };
        root.classList.add('dg-panning');
      } else {
        const wasSel = selN.has(id);
        if (!add && !wasSel) select([id]);
        if (add && !wasSel) { selN.add(id); if (e.shiftKey) keyId = id; }
        selF = false;
        mode = { type: 'move', p, id, add, wasSel, moved: false, before: null, orig: [], ctrl: e.ctrlKey || e.metaKey, alt: e.altKey && !e.ctrlKey && !e.metaKey, shift: e.shiftKey };
      }
    } else if (eg) {
      const id = eg.getAttribute('data-e');
      if (add) selE.has(id) ? selE.delete(id) : selE.add(id);
      else { clearSel(); selE = new Set([id]); }
      paint();
      return;
    } else {
      mode = { type: 'band', a: p, b: p, baseN: add ? new Set(selN) : new Set(), baseE: add ? new Set(selE) : new Set() };
      if (!add) clearSel();
    }
    svg.setPointerCapture(e.pointerId);
    paint();
  });

  // The pieces whose lines can guide a move: on screen (± one screen), not moving; `link` marks the ones wired to what
  // moves (straightening an arrow wins over any other alignment).
  function snapBoxes(skip, links = new Set()) {
    const vr = viewRect(Math.max(root.clientWidth, root.clientHeight) / view.k);
    return data.nodes.filter((n) => !skip.has(n.id) && !isFrame(n) && overlaps(box(n), vr)).map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, link: links.has(n.id) }));
  }
  function startMove(m) {
    m.moved = true;
    m.before = snap();
    if (m.ctrl && !isLocked(index().get(m.id))) {          // Ctrl+drag: drag copies, the originals stay
      const ids = new Set(selN), copy = selectionCopy(ids), map = new Map(), added = [];
      for (const n of copy.nodes) { const c = { ...n, id: newId(isFrame(n) ? 'g' : 'n') }; delete c.locked; map.set(n.id, c.id); data.nodes.push(c); added.push(c.id); }
      for (const ed of copy.edges) data.edges.push({ ...ed, id: newId('e'), from: map.get(ed.from), to: map.get(ed.to) });
      m.dupOf = new Set(ids);
      select(added.filter((id) => ids.has([...map].find(([, v]) => v === id)?.[0])));
      m.id = map.get(m.id) || m.id;
    }
    const map = index(), carried = new Set();
    for (const id of selN) {
      const n = map.get(id);
      if (!n || isLocked(n)) continue;
      carried.add(n.id);
      if (isFrame(n)) for (const c of contentsOf(n, data.nodes)) if (!isLocked(c)) carried.add(c.id);
    }
    m.orig = [...carried].map((i) => map.get(i)).filter(Boolean).map((n) => ({ n, x: n.x, y: n.y }));
    m.ids = carried;
    const movers = m.orig.map((o) => o.n), glyph = movers.filter((n) => !isFrame(n));
    m.bbox0 = union((glyph.length ? glyph : movers).map(box));
    const links = new Set();
    for (const ed of data.edges) { if (carried.has(ed.from) && !carried.has(ed.to)) links.add(ed.to); if (carried.has(ed.to) && !carried.has(ed.from)) links.add(ed.from); }
    m.lines = snapLines(snapBoxes(carried, links));
    // what may be pushed, at its place now (pushes are always computed from here, so dragging back undoes them)
    m.others = data.nodes.filter((n) => !carried.has(n.id) && !isFrame(n)).map((n) => ({ n, x: n.x, y: n.y }));
    m.frames = data.nodes.filter((n) => isFrame(n) && !carried.has(n.id)).map((n) => ({ n, x: n.x, y: n.y, w: n.w, h: n.h }));
    m.single = glyph.length === 1 && movers.length === 1 && !data.edges.some((ed) => ed.from === glyph[0].id || ed.to === glyph[0].id) ? glyph[0] : null;
    m.t0 = now();
    m.geo0 = geoms;                                      // the arrows as they were: a piece dragged onto one is not avoided by it
  }
  function onMove(e) {
    const p = pt(e), m = mode;
    pointer = p;
    if (!m) { hoverAt(e, p); return; }
    if (m.type === 'pan') { view.x = m.vx + p.sx - m.sx; view.y = m.vy + p.sy - m.sy; m.panned ||= Math.hypot(p.sx - m.sx, p.sy - m.sy) > 3; }
    else if (m.type === 'move') {
      if (!m.moved) { if (Math.hypot(p.sx - m.p.sx, p.sy - m.p.sy) < 3) return; startMove(m); }
      let dx = p.x - m.p.x, dy = p.y - m.p.y;
      m.axis = null;
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; m.axis = 'x'; } else { dx = 0; m.axis = 'y'; } }
      m.guides = null; m.gbox = null;
      const free = e.altKey || !snapOn;
      if (!free && m.bbox0) {
        const b = { x: m.bbox0.x + dx, y: m.bbox0.y + dy, w: m.bbox0.w, h: m.bbox0.h };
        const s = snapTo(b, m.lines, { thr: 6 / view.k, linkThr: 10 / view.k, grid: GRID });
        if (m.axis !== 'y') dx += s.dx;
        if (m.axis !== 'x') dy += s.dy;
        m.guides = { gx: m.axis === 'y' ? null : s.gx, gy: m.axis === 'x' ? null : s.gy, gaps: s.gaps };
        m.gbox = { x: m.bbox0.x + dx, y: m.bbox0.y + dy, w: m.bbox0.w, h: m.bbox0.h };
      }
      for (const o of m.orig) { o.n.x = Math.round(o.x + dx); o.n.y = Math.round(o.y + dy); }
      // what is in the way steps aside (from where it was, so it comes back if he changes his mind)
      for (const o of m.others) { o.n.x = o.x; o.n.y = o.y; }
      for (const g of m.frames) Object.assign(g.n, { x: g.x, y: g.y, w: g.w, h: g.h });
      if (!free) {
        const movers = m.orig.map((o) => ({ id: o.n.id, r: isFrame(o.n) ? box(o.n) : blockRect(o.n) }));
        const fr = data.frontier && num(data.frontier.y) !== null ? data.frontier.y : null;
        const disp = pushApart(movers, m.others.map((o) => ({ id: o.n.id, r: blockRect(o.n) })), {
          C: 16, CMax: LINK_GAP, gap: m.gap ||= linkGap(data), axis: Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', fixed: new Set(m.others.filter((o) => isLocked(o.n)).map((o) => o.n.id)),
          block: fr === null ? null : (id, r, dyy) => (r.y + r.h / 2 - fr) * (r.y + r.h / 2 + dyy - fr) < 0,
        });
        const byId = new Map(m.others.map((o) => [o.n.id, o]));
        for (const [id, v] of disp) {
          const o = byId.get(id);
          if (!follow.has(id) && !reducedMotion()) follow.set(id, { x: o.n.x, y: o.n.y, w: o.n.w, h: o.n.h });
          o.n.x = Math.round(o.x + v.dx); o.n.y = Math.round(o.y + v.dy);
        }
        for (const o of m.others) if (!disp.has(o.n.id) && (o.n.x !== o.x || o.n.y !== o.y)) { o.n.x = o.x; o.n.y = o.y; }
        growFrames(data.nodes, new Set(m.frames.map((g) => g.n.id)));
      }
      // the frame that would take it in, and the arrow it would be spliced into
      const c = m.gbox ? centre(m.gbox) : p;
      const g = frameAt(c, m.ids);
      hoverG = g && !m.ids.has(g.id) ? g.id : null;
      if (m.single && !e.altKey) {
        const n = m.single, cc = { x: n.x + n.w / 2, y: n.y + n.h / 2 }, near = edgeNear(cc, 14 / view.k, (ed) => ed.from === n.id || ed.to === n.id, m.geo0);
        if (near?.e.id !== m.spliceCand) { m.spliceCand = near?.e.id ?? null; m.spliceT = now(); }
        m.splice = m.spliceCand && now() - m.spliceT > 300 ? m.spliceCand : null;
        if (m.spliceCand && !m.splice) setTimeout(() => { if (mode === m) onMove(m.lastE || e); }, 320);
      } else m.splice = null;
      m.lastE = e;
      autoPan(e);
    } else if (m.type === 'resize') resizeTo(m, p, e);
    else if (m.type === 'frontier') data.frontier.y = Math.round(m.y + p.y - m.p.y);
    else if (m.type === 'connect' || m.type === 'reanchor') {
      m.cur = p;
      m.far ||= Math.hypot(p.sx - m.p.sx, p.sy - m.p.sy) > 24;
      const map = index(), anchor = map.get(m.type === 'connect' ? m.from : m.fixed);
      let t = nodeAt(p);
      if (isLegend(t)) t = null;                           // a legend explains the drawing; it is not part of it
      if (!t) {                                            // a magnet: within 28 px of a piece it takes the arrow
        let best = null;
        for (const n of data.nodes) { if (isFrame(n) || isLegend(n)) continue; const r = blockRect(n), dxx = Math.max(r.x - p.x, 0, p.x - r.x - r.w), dyy = Math.max(r.y - p.y, 0, p.y - r.y - r.h), d = Math.hypot(dxx, dyy); if (d < 28 / view.k && (!best || d < best.d)) best = { n, d }; }
        t = best?.n || null;
      }
      if (t && t.id === anchor?.id && m.type === 'connect') {   // a loop only after resting on its own piece
        m.selfSince ??= now();
        if (now() - m.selfSince < 400) { setTimeout(() => { if (mode === m) { onMove(m.lastE || e); } }, 420); t = null; } else m.loopOk = true;
      } else { m.selfSince = null; m.loopOk = false; }
      m.target = t;
      // the exact port it will use, when he points at a side (its dot, or near its border): side and place along it
      m.portSide = null; m.portAt = null;
      if (t && t !== anchor) { const ps = portNear(t, p, m); if (ps) { m.portSide = ps.side; m.portAt = ps.at; } }
      m.ghost = !t && m.type === 'connect' && m.far && anchor ? ghostFor(anchor, p, m.side) : null;
      m.lastE = e;
      autoPan(e);
    } else if (m.type === 'band') {
      m.b = p;
      const x0 = Math.min(m.a.x, p.x), x1 = Math.max(m.a.x, p.x), y0 = Math.min(m.a.y, p.y), y1 = Math.max(m.a.y, p.y), r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const touch = p.sx < m.a.sx;                          // right to left: whatever the band touches
      selN = new Set(m.baseN);
      for (const n of data.nodes) {
        if (isLocked(n)) continue;
        const b = isFrame(n) ? box(n) : ext(n);
        if (touch ? overlaps(b, r) && !(isFrame(n) && b.x < x0 && b.y < y0 && b.x + b.w > x1 && b.y + b.h > y1) : b.x >= x0 && b.x + b.w <= x1 && b.y >= y0 && b.y + b.h <= y1) selN.add(n.id);
      }
      selE = new Set(m.baseE);
      for (const ed of data.edges) {
        if (isLocked(ed)) continue;
        const g = geoms.get(ed.id);
        if (!g) continue;
        if (touch ? g.poly.some((q, i) => i && segHitsRect(g.poly[i - 1], q, r)) || g.poly.some((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1) : g.poly.every((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1)) selE.add(ed.id);
      }
      autoPan(e);
    }
    paint();
  }
  // Resizing: 8 handles on boxes and frames, 4 on symbols (which keep their proportions). Shift keeps proportions, Alt
  // resizes about the centre; the moving edges snap to the lines of other pieces.
  function resizeTo(m, p, e) {
    const n = m.n, o = m.o, dir = m.dir;
    let dx = p.x - m.p.x, dy = p.y - m.p.y;
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    if (dir.includes('e')) x1 += dx; if (dir.includes('w')) x0 += dx; if (dir.includes('s')) y1 += dy; if (dir.includes('n')) y0 += dy;
    if (e.altKey) { if (dir.includes('e')) x0 -= dx; if (dir.includes('w')) x1 -= dx; if (dir.includes('s')) y0 -= dy; if (dir.includes('n')) y1 -= dy; }
    m.guides = null;
    if (!e.altKey && snapOn) {
      const thr = 6 / view.k, gs = { gx: null, gy: null, gaps: [] };
      const near = (v, cands) => { let b = null; for (const c of cands) { const d = Math.abs(c.v - v); if (d <= thr && (!b || d < b.d)) b = { d, c }; } return b; };
      if (dir.includes('e')) { const s = near(x1, m.lines.xs); if (s) { x1 = s.c.v; gs.gx = { v: s.c.v, hits: m.lines.xs.filter((c) => c.v === s.c.v) }; } }
      if (dir.includes('w')) { const s = near(x0, m.lines.xs); if (s) { x0 = s.c.v; gs.gx = { v: s.c.v, hits: m.lines.xs.filter((c) => c.v === s.c.v) }; } }
      if (dir.includes('s')) { const s = near(y1, m.lines.ys); if (s) { y1 = s.c.v; gs.gy = { v: s.c.v, hits: m.lines.ys.filter((c) => c.v === s.c.v) }; } }
      if (dir.includes('n')) { const s = near(y0, m.lines.ys); if (s) { y0 = s.c.v; gs.gy = { v: s.c.v, hits: m.lines.ys.filter((c) => c.v === s.c.v) }; } }
      m.guides = gs; m.gbox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    let w = x1 - x0, h = y1 - y0;
    const keep = iconic(n) || (e.shiftKey && dir.length === 2);
    const minW = isFrame(n) ? 80 : 32;
    if (keep) {
      const s = Math.max(32 / Math.min(o.w, o.h), Math.abs(w) / o.w, Math.abs(h) / o.h);
      w = o.w * s; h = o.h * s;
      if (dir.includes('w')) x0 = e.altKey ? o.x + o.w / 2 - w / 2 : o.x + o.w - w; else if (e.altKey) x0 = o.x + o.w / 2 - w / 2; else x0 = o.x;
      if (dir.includes('n')) y0 = e.altKey ? o.y + o.h / 2 - h / 2 : o.y + o.h - h; else if (e.altKey) y0 = o.y + o.h / 2 - h / 2; else y0 = o.y;
    } else {
      if (w < minW) { if (dir.includes('w')) x0 = x1 - minW; w = minW; }
      const mh = Math.max(isFrame(n) ? 60 : 28, minH({ ...n, w }));
      if (h < mh) { if (dir.includes('n')) y0 = y1 - mh; h = mh; }
    }
    n.x = Math.round(x0); n.y = Math.round(y0); n.w = Math.round(w); n.h = Math.round(h);
    if (!isFrame(n)) n.h = Math.max(n.h, minH(n));
    delete n.fitW;
    autoPan(e);
  }
  // The port a dragged arrow end would take on piece t at point p: a side when the pointer is on that side's dot or
  // within a few pixels of its border; `at` (its place along the side) only when that side already has other arrows,
  // so a lone arrow stays centred and the data stays plain.
  function portNear(t, p, m) {
    const k = view.k, b = box(t);
    let best = null;
    for (const s of SIDES) {
      const bp = borderPoint(t, s, 0), dDot = Math.hypot(bp.x - p.x, bp.y - p.y);
      const vert = s === 'l' || s === 'r', edge = s === 'l' ? b.x : s === 'r' ? b.x + b.w : s === 't' ? b.y : b.y + b.h;
      const across = vert ? Math.abs(p.x - edge) : Math.abs(p.y - edge), inSpan = vert ? p.y >= b.y - 4 && p.y <= b.y + b.h + 4 : p.x >= b.x - 4 && p.x <= b.x + b.w + 4;
      const d = Math.min(dDot < 14 / k ? dDot : Infinity, inSpan && across < 12 / k ? across : Infinity);
      if (d < Infinity && (!best || d < best.d)) best = { side: s, d };
    }
    if (!best) return null;
    const s = best.side, vert = s === 'l' || s === 'r';
    const at = clamp(vert ? (p.y - t.y) / t.h : (p.x - t.x) / t.w, 0, 1);
    const others = rootsOf(t, index()).filter((r) => r.side === s && !(m?.type === 'reanchor' && r.e.id === m.eid));
    return { side: s, at: others.length ? Math.round(at * 1000) / 1000 : null };
  }
  // Near the edge of the view while dragging, the view travels, gently: only in a narrow band at the very edge, slowly
  // at first and never fast, after a short rest there, and it stops the moment the pointer leaves the band (or the
  // canvas). Moving inside the view never moves the view.
  let panRaf = 0, panE = null, panSince = 0;
  const PAN_BAND = 28, PAN_MAX = 5, PAN_REST = 220;
  function autoPan(e) {
    panE = e;
    if (panRaf) return;
    // one loop only: panRaf stays set while a tick runs, so the onMove it calls cannot start a second loop (the old
    // code did, and every frame doubled the loops: the view ran away)
    const tick = () => {
      if (!mode || !panE || mode.type === 'pan' || mode.show) { panSince = 0; panRaf = 0; return; }
      const r = svg.getBoundingClientRect(), x = panE.clientX - r.left, y = panE.clientY - r.top;
      const inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
      const depth = (v, size) => (v < PAN_BAND ? (PAN_BAND - v) / PAN_BAND : v > size - PAN_BAND ? -(v - size + PAN_BAND) / PAN_BAND : 0);
      const dx = inside ? depth(x, r.width) : 0, dy = inside ? depth(y, r.height) : 0;
      if (!dx && !dy) { panSince = 0; panRaf = 0; return; }
      if (!panSince) panSince = now();
      if (now() - panSince >= PAN_REST) {
        const speed = (d) => Math.sign(d) * (0.6 + (PAN_MAX - 0.6) * d * d);   // eases in with depth, capped low
        view.x += speed(dx); view.y += speed(dy);
        onMove(panE);
      }
      panRaf = requestAnimationFrame(tick);
    };
    panRaf = requestAnimationFrame(tick);
  }
  // Hover: the piece (halo, then its wiring after 220 ms, its outgoing data after 600 ms), the arrow, the frame.
  function hoverAt(e, p) {
    if (editing || show) { if (hover || hoverE || hoverG) { hover = hoverE = hoverG = null; paint(); } return; }
    const t = e.target, eg = t.closest?.('[data-e]'), ng = t.closest?.('[data-n]');
    let h = nodeAt(p, 14 / view.k)?.id ?? null, he = null, hg = null;
    root.classList.toggle('dg-mv', !!nodeAt(p, 10 / view.k) && !t.closest?.('[data-n],[data-dot],[data-end],[data-rs],[data-tiph]'));
    const onDot = t.closest?.('[data-dot]');
    if (onDot && index().get(onDot.dataset.dot)) h = onDot.dataset.dot;      // on its connection dot the piece stays hovered
    if (eg && !h) he = eg.getAttribute('data-e');
    if (ng && !h) { const g = index().get(ng.getAttribute('data-n')); if (isFrame(g)) hg = g.id; }
    if (h !== hover) {
      hover = h; hoverLong = false; clearTimeout(hoverTimer); clearTimeout(flowTimer);
      if (flowHover) { flowHover = null; }
      if (h) { hoverTimer = setTimeout(() => { hoverLong = true; paint(); }, 220); flowTimer = setTimeout(() => { if (hover === h && !mode) { flowHover = h; paint(); } }, 600); }
      paint();
    }
    if (he !== hoverE || hg !== hoverG) { hoverE = he; hoverG = hg; paint(); }
  }
  svg.addEventListener('pointermove', onMove);

  const up = (e) => {
    const m = mode;
    if (!m) return;
    mode = null;
    root.classList.remove('dg-panning');
    hoverG = null;
    if (m.type === 'pan') {
      if (m.show) { if (!m.panned && show) showGo(show.i + 1); }
      else if (!m.panned && m.empty && !m.locked) clearSel();                          // a click on empty space clears
      if (m.locked && !m.panned) reveal(index().get(m.locked));
    } else if (m.type === 'move') {
      if (m.moved) {
        for (const [id, s] of follow) { const n = index().get(id); if (n && Math.abs(s.x - n.x) < 0.5 && Math.abs(s.y - n.y) < 0.5) follow.delete(id); }
        if (m.splice && m.single && !e.altKey) {
          const n = m.single, g = (m.geo0 || geoms).get(m.splice), s2 = g && nearestSeg(g.poly, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
          if (s2) { if (Math.abs(s2[0].y - s2[1].y) < 1) n.y = Math.round(s2[0].y - n.h / 2); else if (Math.abs(s2[0].x - s2[1].x) < 1) n.x = Math.round(s2[0].x - n.w / 2); }
          spliceMut(data, n.id, m.splice);
        }
        if (!e.altKey) {
          const geo = geometry(data);
          growFrames(data.nodes);
          const grew = new Set(m.frames.filter((g) => g.n.x !== g.x || g.n.y !== g.y || g.n.w !== g.w || g.n.h !== g.h).map((g) => g.n.id));
          if (grew.size) frameRoom(data.nodes, grew);
          glideFrom(geo, { dur: DUR.smooth, ease: EASES.smooth });
        }
        syncKids(data.nodes, [...m.ids, ...m.others.filter((o) => o.n.x !== o.x || o.n.y !== o.y).map((o) => o.n.id)]);
        if ((m.ids.size ?? m.ids.length) <= 12) for (const id of m.ids) tactile('settle', nodeEls.get(id)?.el.firstElementChild);   // it lands
        commit(m.before);
      } else if (m.alt) followFlow(m.id, m.shift ? 'up' : 'down');   // Alt+click: what it feeds (Alt+Shift: what feeds it)
      else if (m.add) {                                 // Shift/Ctrl+click toggles, on release, so a drag never deselects
        if (m.wasSel) { selN.delete(m.id); if (keyId === m.id) keyId = null; }
      } else {
        const n = index().get(m.id);
        if (selN.size > 1 && m.wasSel) select([m.id]);   // a plain click inside a multi-selection picks one
        else if (m.wasSel && n && !isFrame(n)) {           // a second click on a member of an invisible group: just it
          let g = parentOf(n, data.nodes);
          while (g && !selN.has(g.id)) g = parentOf(g, data.nodes);
          if (g && frameStyle(g) === 'none') select([n.id]);
        }
        if (n) reveal(n);
      }
    } else if (m.type === 'resize' || m.type === 'frontier') { if (m.type === 'resize') { growFrames(data.nodes); settleText(m.n); } commit(m.before); }
    else if (m.type === 'connect') {
      if (!m.far && Math.hypot((m.cur?.sx ?? m.p.sx) - m.p.sx, (m.cur?.sy ?? m.p.sy) - m.p.sy) < 4 && now() - m.t0 < 600) dotClick(m);
      else finishConnect(m);
    } else if (m.type === 'reanchor') finishReanchor(m);
    m.guides = null;
    paint();
  };
  function nearestSeg(P, p) {
    let best = null;
    for (let i = 1; i < P.length; i++) {
      const A = P[i - 1], B = P[i], dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1, t = clamp(((p.x - A.x) * dx + (p.y - A.y) * dy) / l2, 0, 1);
      const d = Math.hypot(p.x - A.x - dx * t, p.y - A.y - dy * t);
      if (!best || d < best.d) best = { d, s: [A, B] };
    }
    return best?.s;
  }
  // A click (no drag) on a connection dot: the next piece on that side, connected and ready to be named.
  let lastDotClick = null, swallowDbl = 0;
  function dotClick(m) {
    const src = index().get(m.from);
    if (!src) return;
    const before = snap(), shape = isFrame(src) ? style.shape : src.shape;
    lastDotClick = { t: now(), before, cx: m.cx, cy: m.cy };
    const n = makeNode(spotBeside(src, m.side, shape), shape, src.color);
    const e = newEdge(src, n);
    data.edges.push(e);
    startEdit('node', n.id, { before, isNew: true });
  }
  function finishReanchor(m) {
    const e = data.edges.find((x) => x.id === m.eid);
    if (!e) return;
    const t = m.target;
    if (!t || (t.id === m.fixed && !m.loopOk)) { data = JSON.parse(m.before); prune(); paint(); return; }   // dropped on nothing: back
    const S = m.which === 'from' ? 'fromSide' : 'toSide', A = m.which === 'from' ? 'fromAt' : 'toAt';
    e[m.which] = t.id;
    if (m.portSide) { e[S] = m.portSide; if (m.portAt !== null && m.portAt !== undefined) e[A] = m.portAt; else delete e[A]; }
    else { delete e[S]; delete e[A]; }
    commit(m.before);
  }
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('lostpointercapture', (e) => { if (mode && mode.type !== 'palette') up(e); });
  svg.addEventListener('pointerleave', () => { pointer = null; if (!mode && (hover || hoverE || hoverG)) { hover = hoverE = hoverG = null; flowHover = null; clearTimeout(hoverTimer); clearTimeout(flowTimer); paint(); } });

  // Esc during a gesture: everything back to exactly where it was, and no undo step.
  function cancelGesture() {
    const m = mode;
    if (!m) return false;
    mode = null;
    root.classList.remove('dg-panning');
    if (m.type === 'pan') { view.x = m.vx; view.y = m.vy; }
    else if ((m.type === 'move' && m.moved) || m.type === 'resize' || m.type === 'frontier' || m.type === 'reanchor') { if (m.before) { data = JSON.parse(m.before); follow.clear(); prune(); } if (m.dupOf) select([...m.dupOf]); }
    else if (m.type === 'band') { selN = new Set(m.baseN); selE = new Set(m.baseE); }
    hoverG = null;
    paint();
    return true;
  }

  // Dragging a callout's tip: over a piece it points at that piece (`to`), anywhere else it stays where it is dropped.
  svg.addEventListener('pointerdown', (e) => {
    const h = e.button === 0 && e.target.closest?.('[data-tiph]');
    if (!h) return;
    e.stopPropagation(); e.preventDefault();
    const n = index().get(h.dataset.tiph);
    if (!n) return;
    const before = snap(), was = { to: n.to, tip: n.tip };
    const put = (k, v) => { if (v === undefined) delete n[k]; else n[k] = v; };
    const move = (ev) => {
      const p = pt(ev), t = nodeAt(p);
      const ok = t && t !== n && !isLegend(t) && t.shape !== 'callout';
      if (ok) { n.to = t.id; delete n.tip; hover = t.id; }
      else { delete n.to; n.tip = { dx: Math.round(p.x - n.x), dy: Math.round(p.y - n.y - n.h) }; hover = null; }
      paint();
    };
    const end = (keep) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', esc, true);
      if (!keep) { put('to', was.to); put('tip', was.tip); } else commit(before);
      hover = null; paint();
    };
    const up = () => end(true);
    const esc = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('keydown', esc, true);
  }, true);

  svg.addEventListener('dblclick', (e) => {
    if (show) return;
    if (spaceHeld || brush || now() - swallowDbl < 500) return;
    const p = pt(e), hit = document.elementFromPoint(e.clientX, e.clientY);
    const dotEl = hit?.closest?.('[data-dot]');
    let nid = hit?.closest?.('[data-n]')?.getAttribute('data-n') ?? null;
    if (!nid && dotEl) {                                  // a hover dot counts as the piece only when the pointer is on the piece
      const n = index().get(dotEl.dataset.dot);
      if (n && (() => { const r = ext(n); return p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2; })()) nid = n.id;
    }
    const eid = hit?.closest?.('[data-e]')?.getAttribute('data-e');
    if (nid) {
      const n = index().get(nid);
      if (isLocked(n)) return refuse(null, nid);
      select([nid]);
      startEdit('node', nid, { caret: isFrame(n) ? 'end' : caretAt(n, p) });
    } else if (eid) { select([], [eid]); startEdit('edge', eid); }
    else if (hit?.closest?.('[data-f]')) { clearSel(); selF = true; startEdit('frontier'); }
    else { const before = snap(); clearSel(); const n = makeNode(p, style.shape, style.color, { free: true }); startEdit('node', n.id, { before, isNew: true, vanish: true }); }
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

  // ----- keyboard: one key per common action, one table that also draws the «?» overlay -----

  const mods = (e) => (e.ctrlKey || e.metaKey ? 'c' : '') + (e.shiftKey ? 's' : '') + (e.altKey ? 'a' : '');
  const L = (ch) => (e, k) => k === ch && !e.ctrlKey && !e.metaKey && !e.altKey;              // a letter (Shift ignored)
  const K = (key, m = '') => (e, k) => k === key && mods(e) === m;
  const CODE = (code, m) => (e) => e.code === code && mods(e) === m;
  const hasSel = () => selN.size > 0;
  const one = () => (selN.size === 1 && !selE.size ? index().get([...selN][0]) : null);
  const ARROW = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const SIDE_OF = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' };
  function keyAlign() {
    const sa = smartAlign();
    if (!sa) return;
    doAct('align', sa.how);
    lastAlign = { row: sa.row, i: sa.i, t: now() };
    sayIt(ALIGN_NAMES[sa.how]);
  }
  function keyDist() {
    if (data.nodes.filter((n) => selN.has(n.id) && !isLocked(n)).length < 3) { sayIt('Necesita tres piezas'); return; }
    const ax = distAxis();
    doAct('dist', ax);
    lastDist = { axis: ax, t: now() };
    sayIt(ax === 'x' ? 'Distribuido en horizontal' : 'Distribuido en vertical');
  }
  function nudgeSel(dx, dy, toGrid) {
    const ns = data.nodes.filter((n) => selN.has(n.id) && !isLocked(n));
    if (!ns.length && !selF) return;
    edit(() => {
      let ddx = dx, ddy = dy;
      if (toGrid && ns.length) {                         // to the next grid line in that direction
        const b = union(ns.map(box));
        if (dx) ddx = dx > 0 ? (Math.floor(b.x / GRID) + 1) * GRID - b.x : (Math.ceil(b.x / GRID) - 1) * GRID - b.x;
        if (dy) ddy = dy > 0 ? (Math.floor(b.y / GRID) + 1) * GRID - b.y : (Math.ceil(b.y / GRID) - 1) * GRID - b.y;
      } else if (toGrid) { ddx = dx * GRID; ddy = dy * GRID; }
      moveBy(data, ns.map((n) => n.id), ddx, ddy);
      if (selF) data.frontier.y += ddy;
      growFrames(data.nodes);
    }, 'nudge');
  }
  // Ctrl+arrows: the selection jumps to the nearest piece in that direction (within a 45° cone).
  function navigate(key) {
    const [ux, uy] = ARROW[key], map = index();
    const from = one() || (() => { const c = viewCentre(); return data.nodes.filter((n) => !isFrame(n)).sort((a, b) => Math.hypot(a.x + a.w / 2 - c.x, a.y + a.h / 2 - c.y) - Math.hypot(b.x + b.w / 2 - c.x, b.y + b.h / 2 - c.y))[0]; })();
    if (!from) return;
    if (!one()) { select([from.id]); reveal(from); return; }
    const c0 = centre(box(from));
    let best = null;
    for (const n of data.nodes) {
      if (n === from || isFrame(n)) continue;
      const c = centre(box(n)), dx = c.x - c0.x, dy = c.y - c0.y, along = dx * ux + dy * uy, across = Math.abs(dx * uy - dy * ux);
      if (along <= 0 || across > along) continue;
      const d = along + across * 2;
      if (!best || d < best.d) best = { n, d };
    }
    if (best) { select([best.n.id]); reveal(map.get(best.n.id)); }
  }
  const KEYS = [
    { g: 'Añadir', label: 'Caja', show: 'C', m: L('c'), run: () => insertPiece('box') },
    { g: 'Añadir', label: 'Óvalo', show: 'O', m: L('o'), run: () => insertPiece('ellipse') },
    { g: 'Añadir', label: 'Rombo', show: 'R', m: L('r'), run: () => insertPiece('diamond') },
    { g: 'Añadir', label: 'Nota', show: 'N', m: L('n'), run: () => insertPiece('note') },
    { g: 'Añadir', label: 'Texto', show: 'T', m: L('t'), run: () => insertPiece('text') },
    { g: 'Añadir', label: 'Frontera', show: 'F', m: L('f'), run: () => insertPiece('frontier') },
    { g: 'Añadir', label: 'Galería de símbolos', show: 'Ctrl+/', m: (e) => (e.key === '/' || e.code === 'NumpadDivide') && (e.ctrlKey || e.metaKey) && !e.altKey, run: () => { if (galMode) closeGallery(true); else openGallery(); } },
    { g: 'Añadir', label: 'Buscar un símbolo aquí', show: '/', m: (e) => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey, run: () => openQuick() },
    { g: 'Añadir', label: 'Cambiar el símbolo', show: 'Ctrl+Espacio', m: (e) => e.key === ' ' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey, when: () => data.nodes.some((n) => selN.has(n.id) && !isLocked(n)), run: () => openGallery({ replace: true }) },
    { g: 'Añadir', label: 'Pegar texto o piezas', show: 'Ctrl+V', m: K('v', 'c'), run: () => pasteKey(), keep: true },
    { g: 'Conectar', label: 'Siguiente pieza', show: 'Tab', m: K('Tab'), when: () => one() && !isFrame(one()) && !isLegend(one()), run: () => chain('next', one().id) },
    { g: 'Conectar', label: 'Pieza hermana', show: 'Mayús+Tab', m: K('Tab', 's'), when: () => one() && !isFrame(one()) && !isLegend(one()), run: () => chain('sibling', one().id) },
    { g: 'Conectar', label: 'Escribir', show: 'Intro', m: (e, k) => (k === 'Enter' || k === 'F2') && !mods(e), when: () => selN.size === 1 || selE.size === 1 || selF, run: () => { const n = one(); if (n) startEdit('node', n.id); else if (selE.size === 1 && !selN.size) startEdit('edge', [...selE][0]); else if (selF) startEdit('frontier'); } },
    { g: 'Conectar', label: 'Invertir la flecha', show: '', m: () => false, run: () => doAct('reverse') },
    { g: 'Ordenar', label: 'Alinear', show: 'A', m: (e, k) => L('a')(e, k) && !e.shiftKey, when: () => selN.size >= 2, run: keyAlign },
    { g: 'Ordenar', label: 'Distribuir', show: 'D', m: L('d'), when: () => selN.size >= 2, run: keyDist },
    { g: 'Ordenar', label: 'Alinear un borde', show: 'Ctrl+Mayús+flechas', m: (e, k) => ARROW[k] && mods(e) === 'cs', when: () => selN.size >= 2, run: (e) => { doAct('align', SIDE_OF[e.key]); sayIt(ALIGN_NAMES[SIDE_OF[e.key]]); } },
    { g: 'Ordenar', label: 'Agrupar', show: 'Ctrl+G', m: (e, k) => (k === 'g' && mods(e) === 'c') || L('g')(e, k), when: hasSel, run: () => doGroup() },
    { g: 'Ordenar', label: 'Desagrupar', show: 'Ctrl+Mayús+G', m: K('g', 'cs'), run: () => doUngroup() },
    { g: 'Ordenar', label: 'Traer adelante', show: 'RePág', m: K('PageUp'), when: hasSel, run: () => doAct('order', 'fwd') },
    { g: 'Ordenar', label: 'Enviar atrás', show: 'AvPág', m: K('PageDown'), when: hasSel, run: () => doAct('order', 'bwd') },
    { g: 'Ordenar', label: 'Al frente', show: 'Inicio', m: K('Home'), when: hasSel, run: () => doAct('order', 'front') },
    { g: 'Ordenar', label: 'Al fondo', show: 'Fin', m: K('End'), when: hasSel, run: () => doAct('order', 'back') },
    { g: 'Ordenar', label: 'Bloquear', show: 'Ctrl+Mayús+L', m: K('l', 'cs'), when: () => selN.size || selE.size, run: () => doAct('lock') },
    { g: 'Ordenar', label: 'Ordenar', show: 'Alt+T', m: K('t', 'a'), run: () => doAct('tidy') },
    { g: 'Ordenar', label: 'Mover', show: 'flechas', m: (e, k) => ARROW[k] && !e.ctrlKey && !e.metaKey && !e.altKey, when: () => selN.size || selF, run: (e) => { const [dx, dy] = ARROW[e.key]; nudgeSel(dx, dy, e.shiftKey); } },
    { g: 'Ordenar', label: 'Copiar estilo', show: 'Alt+C', m: K('c', 'a'), run: () => { styleClip = styleOfSel(); if (styleClip) sayIt('Estilo copiado'); } },
    { g: 'Ordenar', label: 'Pegar estilo', show: 'Alt+V', m: K('v', 'a'), when: () => styleClip, run: () => doAct('paintstyle') },
    { g: 'Editar', label: 'Duplicar', show: 'Ctrl+D', m: K('d', 'c'), when: hasSel, run: () => duplicate() },
    { g: 'Editar', label: 'Copiar', show: 'Ctrl+C', m: K('c', 'c'), when: hasSel, run: () => copySel(), keep: true },
    { g: 'Editar', label: 'Cortar', show: 'Ctrl+X', m: K('x', 'c'), when: hasSel, run: () => copySel(true) },
    { g: 'Editar', label: 'Quitar', show: 'Supr', m: (e, k) => (k === 'Delete' || k === 'Backspace') && !mods(e), run: () => { if (selN.size || selE.size || selF) removeSel(); } },
    { g: 'Editar', label: 'Quitar y unir sus vecinos', show: 'Mayús+Supr', m: (e, k) => (k === 'Delete' || k === 'Backspace') && mods(e) === 's', when: () => selN.size || selE.size, run: () => removeAndJoin() },
    { g: 'Editar', label: 'Deshacer', show: 'Ctrl+Z', m: K('z', 'c'), run: () => step(undo, redo) },
    { g: 'Editar', label: 'Rehacer', show: 'Ctrl+Y', m: (e, k) => (k === 'y' && mods(e) === 'c') || (k === 'z' && mods(e) === 'cs'), run: () => step(redo, undo) },
    { g: 'Editar', label: 'Seleccionar todo', show: 'Ctrl+A', m: K('a', 'c'), run: () => { selN = new Set(data.nodes.filter((n) => !isLocked(n)).map((n) => n.id)); selE = new Set(data.edges.filter((x) => !isLocked(x)).map((x) => x.id)); } },
    { g: 'Ver', label: 'Ir a la pieza de al lado', show: 'Ctrl+flechas', m: (e, k) => ARROW[k] && mods(e) === 'c', run: (e) => navigate(e.key) },
    { g: 'Ver', label: 'Encajar', show: 'Mayús+1', m: CODE('Digit1', 's'), run: () => fitView() },
    { g: 'Ver', label: 'Acercar a la selección', show: 'Mayús+2', m: CODE('Digit2', 's'), when: () => selN.size || selE.size, run: () => zoomSel() },
    { g: 'Ver', label: 'Tamaño real', show: 'Ctrl+0', m: (e) => (e.key === '0' || e.code === 'Digit0') && mods(e) === 'c', run: () => glide(zoomTo(1, root.clientWidth / 2, root.clientHeight / 2)) },
    { g: 'Ver', label: 'Acercar', show: 'Ctrl++', m: (e) => (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') && (e.ctrlKey || e.metaKey) && !e.altKey, run: () => glide(zoomTo(clamp(view.k * 1.25, 0.1, 4), root.clientWidth / 2, root.clientHeight / 2), { dur: DUR.quick }) },
    { g: 'Ver', label: 'Alejar', show: 'Ctrl+−', m: (e) => (e.key === '-' || e.code === 'NumpadSubtract') && (e.ctrlKey || e.metaKey) && !e.altKey, run: () => glide(zoomTo(clamp(view.k / 1.25, 0.1, 4), root.clientWidth / 2, root.clientHeight / 2), { dur: DUR.quick }) },
    { g: 'Ver', label: 'Mano', show: 'Espacio', m: () => false, run: () => {} },
    { g: 'Ver', label: 'Pausar o mover los datos', show: 'M', m: L('m'), when: () => !selN.size && !selE.size && data.edges.some((x) => flowSpec(x)), run: () => toggleMotion() },
    { g: 'Ver', label: 'Presentar', show: 'F5', m: (e, k) => (k === 'F5' && !mods(e)) || (L('p')(e, k) && !selN.size && !selE.size), run: () => startShow() },
    { g: 'Ver', label: 'Presentar desde aquí', show: 'Mayús+F5', m: K('F5', 's'), run: () => startShow({ from: one()?.id }) },
    { g: 'Ordenar', label: 'Disponer', show: 'Mayús+A', m: (e, k) => k === 'a' && mods(e) === 's', when: () => selN.size >= 2, run: () => { const b = bar.querySelector('[data-pop="arrange"]'); if (b) openPop('arrange', b); } },
    { g: 'Ver', label: 'Atajos', show: '?', m: (e) => e.key === '?' && !e.ctrlKey && !e.metaKey, run: () => toggleHelp() },
  ];
  let popAt = null;

  root.addEventListener('keydown', (e) => {
    if (e.target !== root && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
    if (!help.hidden) { hideHelp(); e.preventDefault(); e.stopPropagation(); return; }
    if (show) { showKey(e); return; }
    if (popFor === 'arrange' && !pop.hidden && /^[1-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation();
      const b = pop.querySelectorAll('.dg-atile')[+e.key - 1];
      if (b?.classList.contains('dg-dim')) refuse(b); else if (b) { closePop(); doAct('arrange', b.dataset.arg); }
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const printable = (e.key.length === 1 || e.key === 'Dead') && !e.ctrlKey && !e.metaKey && !e.altKey;
    // Text never gets lost: while a piece is being written, or just after one was made, printable keys are its text.
    if (printable && e.key !== ' ') {
      if (editing) { e.preventDefault(); e.stopPropagation(); typeInto(e.key); return; }
      const ta = typeahead && now() - typeahead.t < 600 ? typeahead.id : null;
      const n1 = one(), freshSel = n1 && fresh.has(n1.id) && !n1.text ? n1.id : null;
      const id = ta || freshSel;
      if (id && index().get(id)) {
        e.preventDefault(); e.stopPropagation();
        startEdit('node', id, { isNew: true, before: undoBase(id) });
        typeInto(e.key);
        return;
      }
    }
    if (e.key === ' ' && !mods(e)) { spaceHeld = true; root.classList.add('dg-grab'); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Escape') {
      if (lens && pop.hidden && menu.hidden) closeLens();
      else if (!pop.hidden || !menu.hidden) { closePop(); closeMenu(); }
      else if (brush) { brush = null; root.classList.remove('dg-brush'); }
      else if (cancelGesture()) { /* back where it was */ }
      else if (confirmDel || pv) { confirmDel = null; clearPreview(); }
      else if (selN.size || selE.size || selF) {
        const n = one(), g = n && parentOf(n, data.nodes);
        if (g) select([g.id]); else clearSel();
      } else return;                                   // nothing to cancel: the host may use Escape (to close)
      e.preventDefault(); e.stopPropagation(); paint();
      return;
    }
    if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
      e.preventDefault(); e.stopPropagation();
      const b = union(data.nodes.filter((n) => selN.has(n.id)).map(box));
      const c = b ? toScreen(b.x + b.w / 2, b.y + b.h / 2) : { x: root.clientWidth / 2, y: root.clientHeight / 2 };
      openMenu(c, selN.size ? 'sel' : selE.size ? 'edge' : 'empty');
      return;
    }
    // the host page never navigates away while the canvas has focus
    if ((e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || (e.key === 'Backspace' && !selN.size && !selE.size && !selF)) { e.preventDefault(); e.stopPropagation(); return; }
    for (const entry of KEYS) {
      if (!entry.m(e, k)) continue;
      if (entry.when && !entry.when()) continue;
      if (!entry.keep) e.preventDefault();
      e.stopPropagation();
      if (mode && entry.g !== 'Ver') return;
      entry.run(e);
      paint();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); }
  });
  // The state before a fresh piece was made (so Esc on it takes it away in one step).
  function undoBase(id) {
    const base = freshBase.get(id) ?? snap();
    if (undo[undo.length - 1] === base) undo.pop();     // the empty piece was kept once; writing on it is the same step
    return base;
  }
  const releaseSpace = () => { spaceHeld = false; root.classList.remove('dg-grab'); };
  root.addEventListener('keyup', (e) => { if (e.key === ' ') releaseSpace(); });
  root.addEventListener('blur', releaseSpace);

  // ----- the keyboard map («?») -----

  function toggleHelp() { if (!help.hidden) return hideHelp(); showHelp(); }
  function showHelp() {
    closePop(); closeMenu();
    const groups = ['Añadir', 'Conectar', 'Ordenar', 'Editar', 'Ver'];
    const extra = { Conectar: [['Arrastrar desde un punto', 'flecha'], ['Clic en un punto', 'pieza siguiente'], ['Arrastrar su punta', 'reconectar una flecha'], ['Arrastrar el borde', 'mover la pieza']], Ver: [['Arrastrar el fondo', 'mover la vista'], ['Ctrl+arrastrar', 'seleccionar'], ['Alt al arrastrar', 'sin imanes']] };
    help.innerHTML = '<div class="dg-help-p"><div class="dg-help-c">' + groups.map((g) => `<section><h4>${g}</h4>` +
      KEYS.filter((x) => x.g === g && x.show).map((x) => `<p><span>${esc(x.label)}</span><kbd>${esc(x.show)}</kbd></p>`).join('') +
      (extra[g] || []).map(([a, b]) => `<p><span>${esc(b[0].toUpperCase() + b.slice(1))}</span><kbd>${esc(a)}</kbd></p>`).join('') + '</section>').join('') + '</div></div>';
    help.hidden = false;
    help.classList.remove('in'); requestAnimationFrame(() => help.classList.add('in'));
  }
  function hideHelp() { help.hidden = true; }
  help.addEventListener('click', hideHelp);

  // ----- context menu -----

  function menuRows(kind) {
    const sel = data.nodes.filter((n) => selN.has(n.id)), hasFrame = sel.some(isFrame);
    const R = (act, arg, icon, label, key = '', dim = '') => row(act, arg, lineIcon(icon), label, { key, dim });
    if (kind === 'edge') {
      const e0 = data.edges.find((x) => selE.has(x.id));
      return `<div class="dg-mrow-tiles">${DASHES.map((x) => pick('dash', x, lineIcon(x), { solid: 'Continua', dashed: 'Discontinua', dashdot: 'Trazo y punto' }[x], { on: e0?.dash === x })).join('')}<i></i>${ROUTES.map((x) => pick('route', x, lineIcon(x), { curve: 'Curva', elbow: 'En ángulo recto', straight: 'Recta' }[x], { on: e0?.route === x })).join('')}</div>` +
        `<div class="dg-mrow-tiles">${HEADS.map((x) => pick('head', x, lineIcon({ end: 'hend', both: 'hboth', none: 'hnone' }[x]), { end: 'Una punta', both: 'Dos puntas', none: 'Sin puntas' }[x], { on: (HEADS.includes(e0?.head) ? e0.head : 'end') === x })).join('')}</div><i class="dg-hr"></i>` +
        R('flow', undefined, 'flow', 'Datos en movimiento') + R('reverse', undefined, 'reverse', 'Invertir sentido') + R('label', undefined, 'label', 'Texto', 'Intro') + '<i class="dg-hr"></i>' + R('del', undefined, 'trash', 'Quitar', 'Supr');
    }
    if (kind === 'sel') {
      const same = sel.length && sel.every((n) => n.shape === sel[0].shape);
      return R('cut', undefined, 'cut', 'Cortar', 'Ctrl+X') + R('copy', undefined, 'copy', 'Copiar', 'Ctrl+C') + R('paste', undefined, 'paste', 'Pegar', 'Ctrl+V', clip ? '' : 'Nada copiado') + R('dup', undefined, 'dup', 'Duplicar', 'Ctrl+D') + '<i class="dg-hr"></i>' +
        R('copystyle', undefined, 'brush', 'Copiar estilo', 'Alt+C') + R('paintstyle', undefined, 'brush', 'Pegar estilo', 'Alt+V', styleClip ? '' : 'Nada copiado') + '<i class="dg-hr"></i>' +
        (sel.length === 1 && hasFrame ? R('ungroup', undefined, 'ungroup', 'Desagrupar', 'Ctrl+Mayús+G') : R('group', undefined, 'group', 'Agrupar', 'Ctrl+G')) + '<i class="dg-hr"></i>' +
        R('order', 'fwd', 'fwd', 'Traer adelante', 'RePág', canOrder('fwd') ? '' : 'Nada encima') + R('order', 'bwd', 'bwd', 'Enviar atrás', 'AvPág', canOrder('bwd') ? '' : 'Nada debajo') + R('order', 'front', 'front', 'Al frente', 'Inicio') + R('order', 'back', 'back', 'Al fondo', 'Fin') + '<i class="dg-hr"></i>' +
        R('lock', undefined, sel.every(isLocked) ? 'unlock' : 'lock', sel.every(isLocked) ? 'Desbloquear' : 'Bloquear', 'Ctrl+Mayús+L') + (same ? R('same-kind', undefined, 'same2', 'Seleccionar los iguales') : '') + '<i class="dg-hr"></i>' +
        (sel.length === 1 && !hasFrame ? R('lensfail', undefined, 'fail', 'Si falla', 'I') + R('lensorigin', undefined, 'origin', 'De dónde viene', 'U') + '<i class="dg-hr"></i>' : '') + R('del', undefined, 'trash', 'Quitar', 'Supr');
    }
    return R('paste-here', undefined, 'paste', 'Pegar aquí', 'Ctrl+V', clip ? '' : 'Nada copiado') +
      `<div class="dg-mrow-tiles">${[...new Set([...recent, 'box', 'note', 'text', ...SEED])].filter((x) => listed(x) && !FRAME_SET.has(x) && x !== 'frontier').slice(0, 6).map((s) => pick('place', s, miniSVG(s, th(), 22), NAMES[s])).join('')}</div>` +
      R('all', undefined, 'all', 'Seleccionar todo', 'Ctrl+A') + R('fit', undefined, 'fit', 'Encajar', 'Mayús+1');
  }
  let menuAt = null;
  function openMenu(at, kind) {
    closePop();
    menuAt = { ...at, p: { x: (at.x - view.x) / view.k, y: (at.y - view.y) / view.k } };
    menu.innerHTML = menuRows(kind);
    menu.hidden = false;
    const W = root.clientWidth, H = root.clientHeight, mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = at.x, y = at.y;
    if (x + mw > W - 8) x = at.x - mw; if (y + mh > H - 8) y = Math.max(8, H - 8 - mh);
    menu.style.transform = `translate(${Math.round(clamp(x, 8, W - mw - 8))}px, ${Math.round(y)}px)`;
    menu.classList.remove('in'); requestAnimationFrame(() => menu.classList.add('in'));
  }
  function closeMenu() { if (!menu.hidden) { menu.hidden = true; clearPreview(); } }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.classList.contains('dg-dim')) { refuse(b); return; }
    const act = b.dataset.act, arg = b.dataset.arg;
    const at = menuAt?.p;
    closeMenu();
    if (act === 'cut') copySel(true);
    else if (act === 'copy') copySel();
    else if (act === 'paste' || act === 'paste-here') { if (clip) insert(clip, { at: act === 'paste-here' ? at : pointer || at }); }
    else if (act === 'place') insertPiece(arg, at, { from: null });
    else if (act === 'all') { selN = new Set(data.nodes.filter((n) => !isLocked(n)).map((n) => n.id)); selE = new Set(data.edges.filter((x) => !isLocked(x)).map((x) => x.id)); }
    else if (act === 'fit') fitView();
    else if (act === 'same-kind') { const s = data.nodes.find((n) => selN.has(n.id)); const cls = isClassic(s.shape); selN = new Set(data.nodes.filter((n) => n.shape === s.shape && (!cls || n.color === s.color) && !isLocked(n)).map((n) => n.id)); }
    else if (act === 'copystyle') { styleClip = styleOfSel(); }
    else doAct(act, arg);
    paint();
  });
  svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (show) return;
    if (editing) finishEdit();
    const t = e.target, ng = t.closest('[data-n]'), eg = t.closest('[data-e]'), r = root.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (ng) { const id = ng.getAttribute('data-n'); if (!selN.has(id)) select([id]); openMenu(at, 'sel'); }
    else if (eg) { const id = eg.getAttribute('data-e'); if (!selE.has(id)) select([], [id]); openMenu(at, 'edge'); }
    else openMenu(at, 'empty');
    paint();
  });
  addEventListener('pointerdown', onOutside, true);
  function onOutside(e) { if (!root.contains(e.target)) { closePop(); closeMenu(); hideHelp(); } else if (!menu.contains(e.target) && !pop.contains(e.target) && !bar.contains(e.target)) { closeMenu(); if (!svg.contains(e.target)) closePop(); } }

  // ----- following the flow and asking the drawing (builder 3b) -----
  //
  // Alt+click on a piece selects what it feeds (everything downstream); Alt+Shift+click what feeds it (upstream);
  // a second Alt+click on the same piece within 400 ms takes its whole connected part. The selection spreads hop by
  // hop, so he sees which way it followed. Two view-only lenses answer the questions one asks of a system: «Si falla»
  // (I: what goes down if this piece fails, and what only limps because it is also fed from elsewhere) and «De dónde
  // viene» (U: everything this piece's data comes from). A lens dims the rest, washes what it touches and sends packets
  // along the way; it writes nothing (no undo step, no onChange). Esc, a click anywhere or its chip's × closes it.

  const askLayer = document.createElementNS(NS, 'g');
  askLayer.setAttribute('class', 'dg-ask');
  world.insertBefore(askLayer, nodeLayer);
  const ringLayer = document.createElementNS(NS, 'g');
  ringLayer.setAttribute('class', 'dg-ask');
  world.insertBefore(ringLayer, over);
  const lensChip = document.createElement('div');
  lensChip.className = 'dg-lens-chip';
  lensChip.hidden = true;
  root.append(lensChip);
  lensChip.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
  lensChip.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) { closeLens(); root.focus({ preventScroll: true }); } });
  let lens = null, lastFollow = null;

  // Hop distances from a piece, along the arrows (dir 'down') or against them ('up'); frames are not pieces.
  function hops(id, dir) {
    const dist = new Map([[id, 0]]), q = [id], map = index();
    while (q.length) {
      const a = q.shift();
      for (const e of data.edges) {
        const [s, t] = dir === 'down' ? [e.from, e.to] : [e.to, e.from];
        if (s !== a || dist.has(t)) continue;
        const n = map.get(t);
        if (!n || isFrame(n)) continue;
        dist.set(t, dist.get(a) + 1); q.push(t);
      }
    }
    return dist;
  }
  function followFlow(id, dir) {
    const t = now(), again = lastFollow && lastFollow.id === id && t - lastFollow.t < 400, map = index();
    lastFollow = { id, t };
    let dist;
    if (again) {                                          // the whole connected part
      dist = hops(id, 'down');
      for (const [k, v] of hops(id, 'up')) if (!dist.has(k) || dist.get(k) > v) dist.set(k, v);
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of data.edges) {
          for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
            const nb = map.get(b);
            if (dist.has(a) && !dist.has(b) && nb && !isFrame(nb)) { dist.set(b, dist.get(a) + 1); grew = true; }
          }
        }
      }
    } else dist = hops(id, dir);
    const ids = [...dist.keys()].filter((x) => !isLocked(map.get(x)) || x === id);
    const eids = data.edges.filter((e) => dist.has(e.from) && dist.has(e.to)).map((e) => e.id);
    select(ids, eids);
    bloomHops(dist);
    if (dist.size > 1) sayIt(again ? 'Toda la parte conectada' : dir === 'down' ? 'Lo que alimenta' : 'Lo que lo alimenta');
    paint();
  }
  // A ring that blooms around each piece, one hop after the other (40 ms apart).
  function bloomHops(dist) {
    ringLayer.textContent = '';
    if (reducedMotion() || dist.size > 120) return;
    const k = view.k, A = th().accent, map = index();
    for (const [id, h] of dist) {
      const n = map.get(id);
      if (!n) continue;
      const r = iconic(n) ? box(n) : ext(n), p = 4 / k;
      const el = document.createElementNS(NS, 'rect');
      for (const [a, v] of Object.entries({ x: r.x - p, y: r.y - p, width: r.w + 2 * p, height: r.h + 2 * p, rx: 12, fill: 'none', stroke: A, 'stroke-width': 2 / k })) el.setAttribute(a, v);
      el.style.opacity = '0';
      ringLayer.append(el);
      el.animate([{ opacity: 0 }, { opacity: 0.7, offset: 0.35 }, { opacity: 0 }], { duration: 420, delay: h * 40, easing: EASE.out }).onfinish = () => el.remove();
    }
  }

  // ----- the lenses -----

  function openLens(kind, id = one()?.id) {
    const map = index(), n = id && map.get(id);
    if (!n || isFrame(n)) return;
    if (editing) finishEdit({ keepEmpty: true });
    closePop(); closeMenu();
    const dist = hops(id, kind === 'fail' ? 'down' : 'up');
    const down = new Set([id]), half = new Set();
    if (kind === 'fail') {
      // a piece is down when everything that feeds it is down; it limps when only part of what feeds it is
      const reach = [...dist.keys()].filter((x) => x !== id);
      for (let pass = 0; pass <= reach.length; pass++) {
        let changed = false;
        for (const x of reach) {
          const preds = data.edges.filter((e) => e.to === x && e.from !== x && map.get(e.from) && !isFrame(map.get(e.from))).map((e) => e.from);
          const allDown = preds.length > 0 && preds.every((p) => down.has(p)), some = preds.some((p) => down.has(p) || half.has(p));
          if (allDown && !down.has(x)) { down.add(x); half.delete(x); changed = true; }
          else if (!allDown && some && !down.has(x) && !half.has(x)) { half.add(x); changed = true; }
        }
        if (!changed) break;
      }
    } else for (const x of dist.keys()) down.add(x);
    const lit = new Set([...down, ...half]), edges = new Map(), far = Math.max(0, ...dist.values());
    for (const e of data.edges) {
      if (!lit.has(e.from) || !lit.has(e.to) || e.from === e.to) continue;
      const a = dist.get(e.from) ?? 0, b = dist.get(e.to) ?? 0;
      if (kind === 'fail' ? b <= a : a <= b) continue;     // only the way the trouble (or the data) travels, no loops back
      edges.set(e.id, kind === 'fail' ? a : far - a);
    }
    lens = { kind, id, down, half, lit, edges, key: '' };
    root.classList.add('dg-lens');
    const name = (x) => String(x.text || NAMES[x.shape] || '').split('\n')[0];
    const nDown = down.size - 1, nHalf = half.size;
    const what = kind === 'fail'
      ? (nDown || nHalf ? [nDown ? `${nDown} ${nDown === 1 ? 'pieza se para' : 'piezas se paran'}` : '', nHalf ? `${nHalf} a medias` : ''].filter(Boolean).join(', ') : 'nada más se para')
      : (dist.size > 1 ? `${dist.size - 1} ${dist.size === 2 ? 'pieza' : 'piezas'}` : 'nada lo alimenta');
    lensChip.innerHTML = `<span class="dg-lens-i${kind === 'fail' ? ' bad' : ''}"></span><span>${kind === 'fail' ? 'Si falla' : 'De dónde viene'} <b>${esc(name(n))}</b>: ${esc(what)}</span>` +
      `<button data-x="1" title="Cerrar (Esc)">${lineIcon('close')}</button>`;
    lensChip.hidden = false;
    lensChip.classList.remove('in'); requestAnimationFrame(() => lensChip.classList.add('in'));
    paint();
  }
  function closeLens() {
    if (!lens) return;
    lens = null;
    root.classList.remove('dg-lens');
    askLayer.textContent = '';
    for (const rec of [...nodeEls.values(), ...edgeEls.values()]) rec.el.classList.remove('dg-lit', 'dg-half');
    lensChip.hidden = true;
    paint();
  }
  // Called at the end of every draw while a lens is open: marks what it touches and (only when the drawing changed)
  // rebuilds the washes and the packets.
  function paintLens() {
    if (!lens) return;
    const map = index();
    if (!map.get(lens.id)) { closeLens(); return; }
    for (const [id, rec] of nodeEls) { const n = map.get(id); rec.el.classList.toggle('dg-lit', lens.lit.has(id) || (!!n && isFrame(n))); rec.el.classList.toggle('dg-half', lens.half.has(id)); }
    for (const [id, rec] of edgeEls) rec.el.classList.toggle('dg-lit', lens.edges.has(id));
    const key = geomKey + '|' + data.theme + '|' + view.k.toFixed(2) + '|' + data.nodes.length;
    if (key === lens.key) return;
    lens.key = key;
    const T = th(), k = view.k, c = lens.kind === 'fail' ? T.bad : T.accent;
    let s = '';
    for (const id of lens.lit) {
      const n = map.get(id);
      if (!n) continue;
      const r = ext(n), p = 7, op = id === lens.id ? 0.3 : lens.half.has(id) ? 0.1 : 0.2;
      s += `<rect x="${f(r.x - p)}" y="${f(r.y - p)}" width="${f(r.w + 2 * p)}" height="${f(r.h + 2 * p)}" rx="14" fill="${c}" fill-opacity="${op}"` +
        (lens.half.has(id) ? ` stroke="${c}" stroke-opacity=".55" stroke-width="${f(1.2 / k)}" stroke-dasharray="${f(5 / k)} ${f(4 / k)}"` : '') + '/>';
    }
    const still = reducedMotion(), ms = Math.round((PERIOD / 70) * 1000);
    for (const [eid, lv] of lens.edges) {
      const e = data.edges.find((x) => x.id === eid), g = geoms.get(eid);
      if (!e || !g) continue;
      const pp = packetPath(g, e.route, HEADS.includes(e.head) ? e.head : 'end');
      if (!pp) continue;
      s += `<path class="dg-flow${still ? '' : ' dg-flow-on'}" d="${pp.d}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 ${PERIOD - 8}"` +
        (still ? '' : ` style="animation-duration:${ms}ms;animation-delay:${lv * 180}ms"`) + '/>';
    }
    askLayer.innerHTML = s;
  }
  ACTS.lensfail = { run: () => openLens('fail') };
  ACTS.lensorigin = { run: () => openLens('origin') };
  {
    const at = KEYS.findIndex((x) => x.label === 'Atajos');
    const canLens = () => one() && !isFrame(one()) && !isLegend(one());
    KEYS.splice(at < 0 ? KEYS.length : at, 0,
      { g: 'Ver', label: 'Si falla', show: 'I', m: L('i'), when: canLens, run: () => (lens?.kind === 'fail' ? closeLens() : openLens('fail')) },
      { g: 'Ver', label: 'De dónde viene', show: 'U', m: L('u'), when: canLens, run: () => (lens?.kind === 'origin' ? closeLens() : openLens('origin')) },
      { g: 'Ver', label: 'Seguir el flujo', show: 'Alt+clic', m: () => false, run: () => {} });
  }
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
      tweens.clear(); follow.clear(); routeCache.clear(); pv = null; fresh.clear(); typeahead = null;
      prune();
      if (fixed) scheduleChange();
      draw();
    },
    fit: () => fitView(true),
    destroy() {
      finishEdit({ keepEmpty: true });
      ro.disconnect();
      stopGlide();
      cancelAnimationFrame(raf);
      removeEventListener('focus', onWinFocus);
      removeEventListener('pointerdown', onOutside, true);
      if (timer) { clearTimeout(timer); flush(); }
      root.remove();
    },
  };
}
