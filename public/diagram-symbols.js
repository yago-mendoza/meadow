// Meadow diagrams: the symbol catalogue. Plain data and pure functions (no DOM), so thumbnails draw the same thing.
//
// HOW TO NAME PIECES IN JSON (for agents writing a diagram by hand)
//   Every node has one `shape`: an id from this file, lower-case ASCII kebab, in English ('database', 'queue',
//   'load-balancer'). Spanish names and the usual synonyms are accepted too and saved back as the id: 'base de datos',
//   'cola', 'balanceador', 'postgres' → database, 'redis' → cache, 'kafka' → stream, 's3' → bucket, 'k8s' → cluster…
//   A shape this file does not know is kept as written and drawn as a plain box with its text.
//   Words go in `text` (under a symbol) and `sub` (a quieter second line: «Postgres», «Node»). Brands never get a
//   drawing of their own: they live in `sub` and in the search keywords.
//   Optional, per node: form: 'icon'|'card' (a card is a box with the glyph on the left and the words inside),
//   labelAt: 'below'|'right', count: 2..99 (several of the same, drawn stacked with ×N), icon: <symbol id> (a frame's
//   little glyph), to: <node id> and tip: {dx, dy} (where a callout points), items: [{shape?, dash?, text}] (a legend's
//   rows; without it the legend lists what the diagram uses).
//   Frames (group, lane, vpc, subnet, region, zone, namespace, env, machine) hold whatever lies inside them; `kids`
//   lays them out around those ids when nothing has coordinates yet.
//   Example: { nodes: [{ id: 'web', shape: 'browser', text: 'Web' }, { id: 'api', shape: 'api-gateway', text: 'Entrada' },
//     { id: 'db', shape: 'base-de-datos', text: 'Pedidos', sub: 'Postgres' }, { id: 'q', shape: 'cola', text: 'Correos' },
//     { id: 'p', shape: 'vpc', text: 'Producción', kids: ['api', 'db', 'q'] }],
//     edges: [{ from: 'web', to: 'api' }, { from: 'api', to: 'db', verb: 'lee' }, { from: 'api', to: 'q', verb: 'añade' }] }
//
// THE DRAWING GRAMMAR
//   A shape says WHAT a thing is; a tint says WHICH FAMILY. Each category has one tint with one meaning. A symbol is a
//   shell (tile, circle, hexagon, cylinder, tube, document, shield, triangle, cloud, or a device silhouette) with a
//   glyph inside, drawn on a 24-unit grid with round strokes, like Meadow's icons. Words hang under it.

import { ICONS } from './icons.js';

const dot = (x, y, r = 1.15) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

// Glyphs that icons.js does not have, in the same grammar (24 grid, strokes; tiny dots filled).
const G = {
  zone: '<rect x="5" y="3.8" width="14" height="16.4" rx="1.6"/><path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h7.2"/>',
  subnet: '<path d="M7.6 5H5v14h2.6M16.4 5H19v14h-2.6"/>' + dot(9, 12, 1.4) + dot(12, 12, 1.4) + dot(15, 12, 1.4),
  cube: '<path d="M12 3.2 19.6 7.5v9L12 20.8l-7.6-4.3v-9z"/><path d="M4.4 7.5 12 11.8l7.6-4.3M12 11.8v9"/>',
  'cube-s': '<path d="M12 7.6 16.4 10v4.8L12 17.2l-4.4-2.4V10z"/><path d="M7.6 10 12 12.4l4.4-2.4M12 12.4v4.8"/>',
  fn: '<path d="M15.8 4.3h-1.3A2.6 2.6 0 0 0 12 6.6l-1.9 10.8a2.6 2.6 0 0 1-2.6 2.3H6.2M8.3 10.2h7"/>',
  api: '<path d="M8 7 3.5 12 8 17M16 7l4.5 5-4.5 5M13.6 5.2l-3.2 13.6"/>',
  windows: '<rect x="4.5" y="7.5" width="13" height="9.5" rx="1.5"/><path d="M8 4.5h10a1.5 1.5 0 0 1 1.5 1.5v8"/>',
  pod: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z"/><path d="M12 8.2 15.6 10.2v4L12 16.2l-3.6-2v-4z"/><path d="m8.4 10.2 3.6 2 3.6-2M12 12.2v4"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><circle cx="16.5" cy="16.5" r="3.5"/>',
  worker: '<path d="M18.9 13.2A7 7 0 0 1 6.3 16.6M5.1 10.8a7 7 0 0 1 12.6-3.4"/><path d="M18 3.8v3.8h-3.8M6 20.2v-3.8h3.8"/>' + dot(12, 12, 1.7),
  layers: '<path d="M3.8 8 12 4.2 20.2 8 12 11.8z"/><path d="M3.8 12.2 12 16l8.2-3.8M3.8 16.2 12 20l8.2-3.8"/>',
  gpu: '<rect x="3" y="6.5" width="18" height="10.5" rx="1.5"/><circle cx="9" cy="11.75" r="2.6"/><circle cx="15.5" cy="11.75" r="2.6"/><path d="M6 17v2.5M9.5 17v2.5M13 17v2.5M16.5 17v2.5"/>',
  memory: '<rect x="3" y="6" width="18" height="10" rx="1"/><path d="M6.5 9h2.6v4H6.5zM10.7 9h2.6v4h-2.6zM14.9 9h2.6v4h-2.6z"/><path d="M5.5 16v2.5M9 16v2.5M12 16v2.5M15 16v2.5M18.5 16v2.5"/>',
  rack: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 8h14M5 13h14M5 18h14M11 5.5h5M11 10.5h5M11 15.5h5"/>' + dot(8, 5.5, 0.9) + dot(8, 10.5, 0.9) + dot(8, 15.5, 0.9),
  braces: '<path d="M9 4.5H8a2 2 0 0 0-2 2v3a2.5 2.5 0 0 1-2 2.5 2.5 2.5 0 0 1 2 2.5v3a2 2 0 0 0 2 2h1M15 4.5h1a2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 2 2.5 2.5 2.5 0 0 0-2 2.5v3a2 2 0 0 1-2 2h-1"/>',
  kv: '<rect x="3.5" y="5" width="7" height="5" rx="1"/><rect x="13.5" y="5" width="7" height="5" rx="1"/><rect x="3.5" y="14" width="7" height="5" rx="1"/><rect x="13.5" y="14" width="7" height="5" rx="1"/><path d="M10.5 7.5h3M10.5 16.5h3"/>',
  bucket: '<path d="M4.5 7.5h15l-1.7 11.3a2 2 0 0 1-2 1.7H8.2a2 2 0 0 1-2-1.7z"/><ellipse cx="12" cy="7.5" rx="7.5" ry="2.2"/>',
  lines: '<path d="M7 8.5h10M7 12.5h10M7 16.5h6"/>',
  grid: '<rect x="5" y="5.5" width="14" height="13" rx="1"/><path d="M5 10h14M5 14.3h14M10 5.5v13"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.2h17M9.3 9.5V19M14.8 9.5V19"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  disk: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="m13.6 13.6 3.6 3.6"/>',
  vectors: '<path d="M5 19 17.5 6.5M5 19 8.5 5.5M5 19l14.5-4"/>' + dot(17.5, 6.5, 1.5) + dot(8.5, 5.5, 1.5) + dot(19.5, 15, 1.5),
  graph: '<circle cx="6.5" cy="7" r="2.3"/><circle cx="17.5" cy="9" r="2.3"/><circle cx="10" cy="17.5" r="2.3"/><path d="m8.8 7.4 6.4 1.2M7.3 9.2l1.9 6.1M16 10.8l-4.4 5"/>',
  spark: '<path d="M3.5 15.5 8 10l3.5 3 4-6 5 5.5"/>',
  entities: '<rect x="4" y="4" width="8.5" height="6" rx="1"/><rect x="11.5" y="14" width="8.5" height="6" rx="1"/><path d="M8.2 10v7h3.3"/>',
  slots: '<path d="M7 7v10M11 7v10M15 7v10"/>',
  cross: '<path d="m8 8 8 8M16 8l-8 8"/>',
  topic: '<circle cx="5.5" cy="12" r="2.2"/><path d="M7.7 12H12M12 12l6.5-6.5M12 12h7M12 12l6.5 6.5"/>',
  waves: '<path d="M3 9c3-2.6 6 2.6 9 0s6-2.6 9 0M3 15c3-2.6 6 2.6 9 0s6-2.6 9 0"/>',
  bus: '<path d="M3 12h18M6.5 12V6.5M12 12V6.5M17.5 12V6.5M9.25 12v5.5M14.75 12v5.5"/>' + dot(6.5, 5.6, 1.5) + dot(12, 5.6, 1.5) + dot(17.5, 5.6, 1.5) + dot(9.25, 18.4, 1.5) + dot(14.75, 18.4, 1.5),
  sms: '<rect x="6" y="3" width="12" height="18" rx="2.6"/><path d="M9 8.5h6M9 12h4"/>' + dot(12, 17.6, 0.9),
  broker: '<path d="M3.5 7.5h4.5l4 4.5 4-4.5h4.5M3.5 16.5h4.5l4-4.5 4 4.5h4.5"/>',
  router: '<path d="M8 3.5v6.5M5.5 6 8 3.5 10.5 6M16 20.5V14M13.5 18l2.5 2.5 2.5-2.5M3.5 16H10M6 13.5 3.5 16 6 18.5M20.5 8H14M18 5.5 20.5 8 18 10.5"/>',
  switch: '<path d="M4 8.5h15M16 5.5l3 3-3 3M20 15.5H5M8 12.5l-3 3 3 3"/>',
  lb: '<circle cx="12" cy="5.5" r="2.1"/><path d="M12 7.6V11M5 18V14h14v4M12 11v7"/><circle cx="5" cy="19" r="1.3"/><circle cx="12" cy="19" r="1.3"/><circle cx="19" cy="19" r="1.3"/>',
  gateway: '<path d="M3.5 12h10.5M10.5 8.5 14 12l-3.5 3.5"/><path d="M16.5 4.5h2A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-2"/>',
  cdn: '<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="5.5" r="1.7"/><circle cx="19" cy="5.5" r="1.7"/><circle cx="5" cy="18.5" r="1.7"/><circle cx="19" cy="18.5" r="1.7"/><path d="m6.3 6.7 3.9 3.6M17.7 6.7l-3.9 3.6M6.3 17.3l3.9-3.6M17.7 17.3l-3.9-3.6"/>',
  sign: '<path d="M12 3v18M12 5.5h6.3l2.2 2.3-2.2 2.2H12M12 12H5.7l-2.2 2.3 2.2 2.2H12M9 21h6"/>',
  proxy: '<path d="M3 12h4M17 12h4M18.5 9.5 21 12l-2.5 2.5"/><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 12h4"/>',
  tunnel: '<path d="M3.5 20V11.5a8.5 8.5 0 0 1 17 0V20"/><path d="M8 20v-7.5a4 4 0 0 1 8 0V20"/>',
  antenna: '<path d="M9.2 7.4a3.9 3.9 0 0 0 0 5.4M14.8 7.4a3.9 3.9 0 0 1 0 5.4M6.4 4.6a7.9 7.9 0 0 0 0 11M17.6 4.6a7.9 7.9 0 0 1 0 11M12 11.5V21"/>' + dot(12, 10.1, 1.6),
  nodes3: '<circle cx="12" cy="5.5" r="2.2"/><circle cx="5.5" cy="18" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/><path d="M11 7.5 6.5 16M13 7.5l4.5 8.5M7.7 18h8.6"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5"/>',
  mesh: '<circle cx="6" cy="6" r="1.9"/><circle cx="18" cy="6" r="1.9"/><circle cx="6" cy="18" r="1.9"/><circle cx="18" cy="18" r="1.9"/><path d="M7.9 6h8.2M7.9 18h8.2M6 7.9v8.2M18 7.9v8.2M7.4 7.4l9.2 9.2M16.6 7.4l-9.2 9.2"/>',
  bricks: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M3.5 9.7h17M3.5 14.3h17M9 5v4.7M15 5v4.7M12 9.7v4.6M6.5 14.3V19M17.5 14.3V19"/>',
  secret: '<rect x="3" y="7" width="18" height="10" rx="2.2"/><path d="M7.5 10v4M5.8 11l3.4 2M5.8 13l3.4-2M12.5 10v4M10.8 11l3.4 2M10.8 13l3.4-2M16.5 14h2.5"/>',
  ribbon: '<circle cx="12" cy="9.5" r="4.2"/><path d="M9.4 12.8 8.5 20l3.5-2 3.5 2-.9-7.2"/>',
  login: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M3.5 12h11M11 8.5l3.5 3.5-3.5 3.5"/>',
  star6: '<path d="M12 4.5v15M5.5 8.25l13 7.5M5.5 15.75l13-7.5"/>',
  mfa: '<rect x="6.5" y="3" width="11" height="18" rx="2.6"/><path d="m9.5 12 2 2 3.5-4"/>',
  check: '<path d="m7.5 12.5 3 3 6-6.5"/>',
  finger: '<path d="M7.3 18c.9-1.6 1.2-3.3 1.2-6a3.5 3.5 0 0 1 7 0c0 1.5-.1 3-.4 4.5M12 12c0 3.1-.6 5.6-2 7.8M4.6 14.5c.4-.9.6-1.9.6-3A6.8 6.8 0 0 1 18 8.6M18.8 12c0 1.8-.2 3.5-.6 5.2"/>',
  admin: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20a6.5 6.5 0 0 1 10.4-5.2"/><circle cx="17.5" cy="17" r="2.2"/><path d="M17.5 13.2v1.6M17.5 19.2v1.6M13.7 17h1.6M19.7 17h1.6"/>',
  sparkles: '<path d="M11 4.5 12.7 10.3 18.5 12 12.7 13.7 11 19.5 9.3 13.7 3.5 12 9.3 10.3z"/><path d="M18.5 3.5v3.4M16.8 5.2h3.4"/>',
  net: '<circle cx="5.5" cy="7" r="1.7"/><circle cx="5.5" cy="17" r="1.7"/><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/><path d="M7.1 7.6 10.4 11M7.1 16.4l3.3-3.4M13.7 12h3.1M13.4 5.9l3.8 5M13.4 18.1l3.8-5"/>',
  embed: '<path d="M7.5 4H5v16h2.5M16.5 4H19v16h-2.5"/>' + dot(12, 7.5, 1.4) + dot(12, 12, 1.4) + dot(12, 16.5, 1.4),
  prompt: '<path d="m7 9.5 3.2 2.7L7 15M12.5 15.5H17"/>',
  dots6: dot(8, 9, 1.5) + dot(12, 9, 1.5) + dot(16, 9, 1.5) + dot(8, 13.5, 1.5) + dot(12, 13.5, 1.5) + dot(16, 13.5, 1.5),
  train: '<path d="M4 18 9.5 12l3.5 3L20 7"/><path d="M15 7h5v5"/>',
  infer: '<rect x="3.5" y="7" width="9" height="10" rx="2"/><path d="M12.5 12h8M17 8.5l3.5 3.5-3.5 3.5"/>',
  rag: '<path d="M13 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H11M13 3.5l4.5 4.5v2"/><circle cx="16" cy="15.5" r="3.4"/><path d="m18.5 18 2.5 2.5"/>',
  logs: '<path d="M5 6h2M10 6h9M5 10h2M10 10h9M5 14h2M10 14h6M5 18h2M10 18h8"/>',
  metrics: '<path d="M4 4v16h16"/><path d="m7.5 14 3.5-4 3 3 5-6"/>',
  trace: '<path d="M4 6h9M7 10.5h10M10 15h6M12.5 19.5h7.5"/>',
  bang: '<path d="M12 6.5v7.5"/>' + dot(12, 17.8, 1.5),
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="1.5"/><path d="M8.5 20h7M12 16.5V20M6 10.5h3l1.5-2.5 2.5 5 1.5-2.5h3.5"/>',
  cron: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.6 2M9.5 3h5"/>',
  timer: '<path d="M12 4.5a7.5 7.5 0 1 1-7.5 7.5"/><path d="M12 12 7 7"/>' + dot(12, 12, 1.6),
  repo: '<path d="M6 4.6A1.6 1.6 0 0 1 7.6 3H18v13.5H7.6A1.6 1.6 0 0 0 6 18.1zM6 18.1a1.6 1.6 0 0 0 1.6 1.6H9M15 19.7h3"/><path d="M10.2 16.5V21l1.6-1.2 1.6 1.2v-4.5"/>',
  branch: '<circle cx="7" cy="5.5" r="2.1"/><circle cx="7" cy="18.5" r="2.1"/><circle cx="17" cy="8" r="2.1"/><path d="M7 7.6v8.8M17 10.1c0 4-10 2.4-10 6.3"/>',
  commit: '<circle cx="12" cy="12" r="3.6"/><path d="M3 12h5.4M15.6 12H21"/>',
  pr: '<circle cx="6.5" cy="5.5" r="2.1"/><circle cx="6.5" cy="18.5" r="2.1"/><circle cx="17.5" cy="18.5" r="2.1"/><path d="M6.5 7.6v8.8M17.5 16.4V10a3 3 0 0 0-3-3h-4M12.5 4.5 10 7l2.5 2.5"/>',
  pipeline: '<circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="19" cy="12" r="2.1"/><path d="M7.1 12h2.8M14.1 12h2.8"/>',
  build: '<rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>',
  registry: '<path d="M7.5 3.8 11 5.8v4l-3.5 2-3.5-2v-4zM16.5 3.8l3.5 2v4l-3.5 2-3.5-2v-4zM12 12.2l3.5 2v4l-3.5 2-3.5-2v-4z"/>',
  bug: '<rect x="8" y="7.5" width="8" height="11.5" rx="4"/><path d="M12 11v8M8 12.5H4.5M16 12.5h3.5M8.2 16.5H5M15.8 16.5H19M9.5 7.8 7.8 5M14.5 7.8 16.2 5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.1"/><circle cx="9" cy="17" r="2.1"/>',
  toggle: '<rect x="3.5" y="7.5" width="17" height="9" rx="4.5"/><circle cx="16" cy="12" r="2.4"/>',
  team: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M16.2 14.2a5 5 0 0 1 5.3 5.3"/>',
  ticket: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2.3a2.2 2.2 0 0 0 0 4.4v2.3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2.3a2.2 2.2 0 0 0 0-4.4z"/><path d="M14 6.5v11" stroke-dasharray="1.6 2"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
};
const glyphMarkup = (k) => (k ? G[k] ?? ICONS[k]?.svg ?? '' : '');

// The categories, in gallery order. `tint` names a THEME.tint entry (null: the user's own palette, 'frame': frames).
export const CATS = [
  { id: 'basic', name: 'Básicos', tint: null, meaning: 'texto y cajas' },
  { id: 'frame', name: 'Contenedores', tint: 'frame', meaning: 'agrupa' },
  { id: 'compute', name: 'Cómputo', tint: 'slate', meaning: 'ejecuta' },
  { id: 'data', name: 'Datos', tint: 'sand', meaning: 'guarda' },
  { id: 'messaging', name: 'Mensajería y eventos', tint: 'teal', meaning: 'viaja o llega' },
  { id: 'network', name: 'Red y nube', tint: 'sky', meaning: 'conecta' },
  { id: 'security', name: 'Seguridad', tint: 'green', meaning: 'protege' },
  { id: 'people', name: 'Personas y dispositivos', tint: 'grey', meaning: 'quién y desde dónde' },
  { id: 'ai', name: 'IA y modelos', tint: 'lilac', meaning: 'razona o aprende' },
  { id: 'observe', name: 'Observabilidad', tint: 'rose', meaning: 'vigila y avisa' },
  { id: 'time', name: 'Tiempo', tint: 'clock', meaning: 'cuándo' },
  { id: 'dev', name: 'Desarrollo y entrega', tint: 'orange', meaning: 'se construye y se publica' },
  { id: 'flow', name: 'Flujo', tint: null, meaning: 'diagrama de flujo' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));

// Default sizes per shell [w, h].
export const SHELL_SIZE = {
  tile: [64, 64], circle: [64, 64], hex: [66, 72], cyl: [70, 64], cyl2: [76, 70], tube: [96, 46], doc: [54, 66], shield: [56, 64],
  tri: [70, 62], cloud: [96, 62], phone: [42, 68], tablet: [56, 70], laptop: [86, 58], desktop: [78, 66], browser: [86, 62],
};

// The catalogue: [id, name, shell, glyph, keywords]. Shell '' marks pieces drawn by the editor itself (classic boxes,
// frames, the legacy symbols, annotation pieces).
const L = (cat, rows) => rows.map(([id, name, shell, glyph, kw, extra]) => ({ id, cat, name, shell, glyph, kw, ...(extra || {}) }));
const LIST = [
  ...L('basic', [
    ['text', 'Texto', '', '', 'etiqueta rótulo textbox', { kind: 'classic' }],
    ['title', 'Título', '', '', 'encabezado cabecera heading', { kind: 'preset', as: { shape: 'text', size: 'title' } }],
    ['note', 'Nota', '', '', 'pósit post-it postit sticky', { kind: 'classic' }],
    ['callout', 'Llamada', '', '', 'bocadillo comentario globo', { kind: 'classic', size: [190, 70] }],
    ['box', 'Caja', '', '', 'rectángulo bloque proceso process', { kind: 'classic' }],
    ['ellipse', 'Óvalo', '', '', 'elipse círculo', { kind: 'classic' }],
    ['diamond', 'Rombo', '', '', 'decisión condición pregunta decision', { kind: 'classic' }],
    ['step', 'Paso', '', '', 'número orden secuencia', { kind: 'classic', size: [30, 30] }],
    ['legend', 'Leyenda', '', '', 'clave simbología', { kind: 'legend', size: [180, 80] }],
  ]),
  ...L('frame', [
    ['group', 'Agrupación', '', '', 'grupo dominio contenedor', { kind: 'frame' }],
    ['lane', 'Carril', '', '', 'calle swimlane responsable fase', { kind: 'frame', size: [720, 160] }],
    ['frontier', 'Frontera', '', '', 'límite dentro fuera', { kind: 'frontier' }],
    ['vpc', 'Red privada', '', 'nodes3', 'vpc vnet', { kind: 'frame', ftint: 'sky' }],
    ['subnet', 'Subred', '', 'subnet', 'segmento', { kind: 'frame', ftint: 'sky' }],
    ['region', 'Región', '', 'globe', 'zona geográfica', { kind: 'frame', ftint: 'sky' }],
    ['zone', 'Zona', '', 'zone', 'az zona de disponibilidad availability centro de datos', { kind: 'frame', ftint: 'sky' }],
    ['namespace', 'Espacio de nombres', '', 'cube', 'kubernetes k8s', { kind: 'frame', ftint: 'slate' }],
    ['env', 'Entorno', '', 'sliders', 'producción staging desarrollo local', { kind: 'frame', ftint: 'slate' }],
    ['machine', 'Máquina', '', 'server', 'host ordenador', { kind: 'frame', ftint: 'slate' }],
  ]),
  ...L('compute', [
    ['server', 'Servidor', 'tile', 'server', 'host backend web nginx apache'],
    ['vm', 'Máquina virtual', 'tile', 'windows', 'instancia ec2 vm'],
    ['container', 'Contenedor', 'tile', 'cube', 'docker imagen'],
    ['pod', 'Pod', 'tile', 'pod', 'kubernetes k8s'],
    ['cluster', 'Clúster', 'hex', 'cpu', 'nodos granja kubernetes k8s'],
    ['function', 'Función', 'tile', 'fn', 'serverless lambda faas'],
    ['service', 'Servicio', 'tile', 'gear', 'microservicio'],
    ['app', 'Aplicación', 'tile', 'apps', 'programa app'],
    ['worker', 'Proceso de fondo', 'tile', 'worker', 'worker trabajador segundo plano consumidor'],
    ['job', 'Tarea por lotes', 'tile', 'layers', 'batch lote job'],
    ['operation', 'Operación', '', '', 'proceso script', { kind: 'legacy' }],
    ['cpu', 'CPU', 'tile', 'cpu', 'procesador núcleo'],
    ['gpu', 'GPU', 'tile', 'gpu', 'gráfica cuda acelerador'],
    ['memory', 'Memoria', 'tile', 'memory', 'ram'],
    ['rack', 'Rack', 'tile', 'rack', 'armario'],
    ['datacenter', 'Centro de datos', 'tile', 'building', 'cpd'],
  ]),
  ...L('data', [
    ['database', 'Base de datos', 'cyl', '', 'bd db sql postgres mysql sqlite almacén'],
    ['replica', 'Réplica', 'cyl2', '', 'copia secundaria lectura'],
    ['nosql', 'Base documental', 'cyl', 'braces', 'mongo json documentos nosql'],
    ['kv', 'Clave-valor', 'tile', 'kv', 'kv dynamo'],
    ['cache', 'Caché', 'cyl', 'bolt', 'redis memcached rápido'],
    ['book', 'Libro', '', '', 'registro diario ledger', { kind: 'legacy', hidden: true }],
    ['bucket', 'Almacén de objetos', 'tile', 'bucket', 'bucket cubo s3 blob objetos almacenamiento'],
    ['file', 'Archivo', 'doc', '', 'fichero'],
    ['folder', 'Carpeta', 'tile', 'folder', 'directorio'],
    ['document', 'Documento', 'doc', 'lines', 'pdf informe texto'],
    ['spreadsheet', 'Hoja de cálculo', 'doc', 'grid', 'excel csv'],
    ['table', 'Tabla', 'tile', 'table', 'filas columnas'],
    ['data-lake', 'Lago de datos', 'cyl', 'waves', 'data lake crudo'],
    ['warehouse', 'Almacén analítico', 'cyl', 'chart-bar', 'bigquery snowflake olap'],
    ['search-index', 'Índice de búsqueda', 'tile', 'lens', 'elastic búsqueda'],
    ['backup', 'Copia de seguridad', 'cyl', 'history', 'respaldo backup'],
    ['disk', 'Disco', 'tile', 'disk', 'volumen ssd'],
    ['vector-db', 'Base vectorial', 'cyl', 'vectors', 'embeddings vectores'],
    ['graph-db', 'Base de grafos', 'cyl', 'graph', 'neo4j grafo'],
    ['timeseries', 'Serie temporal', 'cyl', 'spark', 'tsdb influx'],
    ['schema', 'Esquema', 'doc', 'entities', 'modelo de datos entidad'],
    ['store', 'Almacén', '', '', 'base de datos', { kind: 'legacy', hidden: true }],
  ]),
  ...L('messaging', [
    ['queue', 'Cola', 'tube', 'slots', 'fifo sqs rabbitmq'],
    ['dead-letter', 'Cola de fallidos', 'tube', 'cross', 'dlq'],
    ['topic', 'Tema', 'circle', 'topic', 'topic pub sub publicar suscribir'],
    ['stream', 'Flujo de eventos', 'tube', 'waves', 'stream kafka kinesis'],
    ['event-bus', 'Bus de eventos', 'tile', 'bus', 'eventbridge'],
    ['event', 'Evento', '', '', 'señal disparador', { kind: 'legacy' }],
    ['webhook', 'Aviso web', 'circle', 'link', 'webhook callback gancho'],
    ['notification', 'Notificación', 'circle', 'bell', 'push aviso'],
    ['email', 'Correo', 'tile', 'mail', 'email smtp'],
    ['chat', 'Mensaje', 'circle', 'chat', 'whatsapp telegram slack'],
    ['sms', 'SMS', 'tile', 'sms', 'mensaje de texto'],
    ['broker', 'Intermediario', 'hex', 'broker', 'broker mqtt'],
    ['inbox', 'Bandeja', 'tile', 'inbox', 'buzón entrada'],
  ]),
  ...L('network', [
    ['internet', 'Internet', 'circle', 'globe', 'web www red pública'],
    ['cloud', 'Nube', 'cloud', '', 'aws azure gcp proveedor'],
    ['router', 'Enrutador', 'circle', 'router', 'router encaminador'],
    ['switch', 'Conmutador', 'tile', 'switch', 'switch'],
    ['load-balancer', 'Balanceador', 'tile', 'lb', 'lb carga haproxy elb'],
    ['api-gateway', 'Pasarela de API', 'hex', 'gateway', 'gateway entrada'],
    ['api', 'API', 'hex', 'api', 'rest endpoint http graphql'],
    ['cdn', 'CDN', 'hex', 'cdn', 'caché de borde cloudflare'],
    ['dns', 'DNS', 'circle', 'sign', 'dominio nombre'],
    ['proxy', 'Proxy', 'tile', 'proxy', 'inverso nginx'],
    ['vpn', 'VPN', 'tile', 'tunnel', 'túnel tailscale wireguard'],
    ['wifi', 'Wi-Fi', 'circle', 'wifi', 'inalámbrico'],
    ['antenna', 'Antena', 'circle', 'antenna', 'radio 5g'],
    ['network', 'Red', 'circle', 'nodes3', 'lan topología'],
    ['port', 'Puerto', 'circle', 'plug', 'socket'],
    ['service-mesh', 'Malla de servicios', 'hex', 'mesh', 'istio mesh'],
  ]),
  ...L('security', [
    ['permission', 'Permiso', '', '', 'autorización', { kind: 'legacy' }],
    ['firewall', 'Cortafuegos', 'tile', 'bricks', 'waf'],
    ['lock', 'Candado', 'shield', 'lock', 'cifrado protegido'],
    ['key', 'Clave', 'circle', 'key', 'llave api key'],
    ['secret', 'Secreto', 'tile', 'secret', 'vault contraseña credencial'],
    ['certificate', 'Certificado', 'doc', 'ribbon', 'tls ssl https'],
    ['identity', 'Identidad', 'tile', 'id-card', 'iam cuenta sso'],
    ['auth', 'Autenticación', 'circle', 'login', 'login oauth inicio de sesión'],
    ['token', 'Ficha de acceso', 'circle', 'star6', 'token jwt sesión'],
    ['mfa', 'Doble factor', 'tile', 'mfa', '2fa otp'],
    ['policy', 'Política', 'doc', 'check', 'regla acl'],
    ['fingerprint', 'Huella', 'circle', 'finger', 'biometría'],
    ['audit', 'Auditoría', 'circle', 'eye', 'accesos vigilancia'],
  ]),
  ...L('people', [
    ['user', 'Usuario', '', '', 'cliente', { kind: 'legacy', hidden: true }],
    ['person', 'Persona', 'circle', 'person', 'humano'],
    ['team', 'Equipo', 'circle', 'team', 'usuarios grupo'],
    ['admin', 'Administrador', 'circle', 'admin', 'operador admin'],
    ['external', 'Sistema externo', '', '', 'tercero proveedor fuera', { kind: 'legacy' }],
    ['phone', 'Móvil', 'phone', '', 'teléfono smartphone iphone android mobile movil'],
    ['tablet', 'Tableta', 'tablet', '', 'ipad'],
    ['laptop', 'Portátil', 'laptop', '', 'ordenador'],
    ['desktop', 'Ordenador', 'desktop', '', 'sobremesa pc monitor'],
    ['browser', 'Navegador', 'browser', 'globe', 'web chrome frontend página'],
    ['iot', 'Sensor', 'hex', 'wifi', 'iot dispositivo'],
    ['camera', 'Cámara', 'tile', 'camera', 'vídeo'],
  ]),
  ...L('ai', [
    ['model', 'Modelo', 'hex', 'net', 'ml red neuronal'],
    ['llm', 'Modelo de lenguaje', 'hex', 'brain', 'llm gpt claude chat'],
    ['ai-agent', 'Agente', 'circle', 'sparkles', 'asistente bot ia'],
    ['resource', 'Motor', '', '', 'recurso', { kind: 'legacy', hidden: true }],
    ['capability', 'Habilidad', '', '', 'capacidad skill', { kind: 'legacy', hidden: true }],
    ['embedding', 'Incrustaciones', 'tile', 'embed', 'embeddings embedding vector representación'],
    ['prompt', 'Instrucción', 'doc', 'prompt', 'prompt plantilla'],
    ['dataset', 'Conjunto de datos', 'cyl', 'dots6', 'dataset entrenamiento'],
    ['training', 'Entrenamiento', 'tile', 'train', 'fine-tuning ajuste'],
    ['inference', 'Inferencia', 'tile', 'infer', 'predicción servir'],
    ['notebook', 'Cuaderno', 'tile', 'notebook', 'jupyter'],
    ['eval', 'Evaluación', 'tile', 'flask', 'eval experimento'],
    ['rag', 'Recuperación', 'tile', 'rag', 'rag búsqueda semántica'],
    ['tool', 'Herramienta', 'tile', 'wrench', 'tool mcp'],
    ['agent', 'Agente', 'circle', 'sparkles', 'asistente bot', { hidden: true, drawAs: 'ai-agent' }],
  ]),
  ...L('observe', [
    ['log', 'Registros', 'doc', 'logs', 'logs eventos'],
    ['metrics', 'Métricas', 'tile', 'metrics', 'prometheus gráfica'],
    ['trace', 'Traza', 'tile', 'trace', 'tracing span opentelemetry'],
    ['dashboard', 'Panel', 'tile', 'chart-bar', 'grafana dashboard'],
    ['alert', 'Alerta', 'circle', 'alarm', 'alarma pager'],
    ['incident', 'Incidencia', '', '', 'problema fallo grave', { kind: 'legacy' }],
    ['error', 'Error', 'circle', 'bang', 'fallo excepción'],
    ['health', 'Salud', 'circle', 'pulse', 'healthcheck latido ping'],
    ['monitor', 'Monitor', 'tile', 'monitor', 'uptime vigilancia'],
  ]),
  ...L('time', [
    ['clock', 'Reloj', '', '', 'hora', { kind: 'legacy', hidden: true }],
    ['cron', 'Programado', 'circle', 'cron', 'cron horario periódico'],
    ['scheduler', 'Planificador', 'tile', 'calendar-check', 'orquestador airflow'],
    ['timer', 'Temporizador', 'circle', 'timer', 'cuenta atrás'],
    ['calendar', 'Calendario', 'tile', 'calendar', 'fecha día'],
    ['retry', 'Reintento', 'circle', 'repeat', 'repetir'],
    ['timeout', 'Tiempo límite', 'circle', 'hourglass', 'ttl caducidad'],
  ]),
  ...L('dev', [
    ['repo', 'Repositorio', 'tile', 'repo', 'git github'],
    ['branch', 'Rama', 'circle', 'branch', 'branch'],
    ['commit', 'Cambio confirmado', 'circle', 'commit', 'commit cambio'],
    ['pull-request', 'Petición de cambio', 'circle', 'pr', 'pr merge revisión'],
    ['pipeline', 'Integración continua', 'tile', 'pipeline', 'pipeline ci cd despliegue'],
    ['build', 'Compilación', 'tile', 'build', 'build compilar'],
    ['test', 'Pruebas', 'tile', 'checklist', 'tests'],
    ['deploy', 'Despliegue', 'tile', 'rocket', 'publicar deploy'],
    ['release', 'Versión', 'tile', 'tag', 'release etiqueta'],
    ['package', 'Paquete', 'tile', 'box', 'npm librería dependencia'],
    ['artifact', 'Artefacto', 'doc', 'cube', 'binario'],
    ['registry', 'Registro de imágenes', 'tile', 'registry', 'docker hub'],
    ['code', 'Código', 'doc', 'api', 'fuente'],
    ['terminal', 'Terminal', 'tile', 'terminal', 'consola shell cli bash'],
    ['bug', 'Error de código', 'circle', 'bug', 'bug defecto fallo'],
    ['ticket', 'Tarea', 'tile', 'ticket', 'issue incidencia de trabajo'],
    ['config', 'Configuración', 'tile', 'sliders', 'yaml env ajustes'],
    ['feature-flag', 'Interruptor', 'circle', 'toggle', 'feature flag bandera'],
  ]),
  ...L('flow', [
    ['start-end', 'Inicio o fin', '', '', 'terminal empezar acabar', { kind: 'classic', size: [150, 56] }],
    ['io', 'Entrada o salida', '', '', 'datos paralelogramo', { kind: 'classic', size: [160, 70] }],
    ['subprocess', 'Subproceso', '', '', 'predefinido', { kind: 'classic', size: [170, 70] }],
    ['delay', 'Espera', '', '', 'retardo', { kind: 'classic', size: [140, 64] }],
    ['prep', 'Preparación', '', '', 'hexágono', { kind: 'classic', size: [160, 64] }],
    ['manual', 'Operación manual', '', '', 'trapecio', { kind: 'classic', size: [160, 64] }],
    ['connector', 'Conector', '', '', 'enlace círculo', { kind: 'classic', size: [30, 30] }],
  ]),
];

export const SYMS = {};
for (const s of LIST) {
  const kind = s.kind || 'symbol';
  SYMS[s.id] = { ...s, kind, size: s.size || (s.shell ? SHELL_SIZE[s.shell] : undefined) };
}
// A catalogue symbol drawn by this module (shell + glyph), as opposed to the editor's own pieces.
export const isCatalogueSymbol = (id) => SYMS[id]?.kind === 'symbol';
export const tintOf = (id) => { const s = SYMS[id]; if (!s) return null; return s.kind === 'frame' ? (s.ftint || null) : CAT[s.cat]?.tint || null; };
export const nameOf = (id) => SYMS[id]?.name ?? null;

// ---------- names an agent may write ----------

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = (s) => norm(s).trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
export const ALIAS = {};
for (const s of LIST) { if (!s.hidden) ALIAS[slug(s.name)] = s.id; }
Object.assign(ALIAS, {
  db: 'database', bd: 'database', sql: 'database', postgres: 'database', postgresql: 'database', mysql: 'database', sqlite: 'database', 'base-datos': 'database',
  redis: 'cache', memcached: 'cache', kafka: 'stream', kinesis: 'stream', rabbitmq: 'queue', sqs: 'queue', fifo: 'queue', dlq: 'dead-letter',
  s3: 'bucket', blob: 'bucket', lambda: 'function', serverless: 'function', faas: 'function', k8s: 'cluster', kubernetes: 'cluster', docker: 'container',
  llm: 'llm', gpt: 'llm', sticky: 'note', postit: 'note', 'post-it': 'note', process: 'box', proceso: 'box', rectangle: 'box', rect: 'box', decision: 'diamond',
  swimlane: 'lane', textbox: 'text', label: 'text', heading: 'title', header: 'title', mobile: 'phone', movil: 'phone', smartphone: 'phone', web: 'browser',
  frontend: 'browser', pc: 'desktop', computer: 'desktop', ordenador: 'desktop', lb: 'load-balancer', 'load-balancer': 'load-balancer', gateway: 'api-gateway',
  'api-gateway': 'api-gateway', rest: 'api', endpoint: 'api', graphql: 'api', mongo: 'nosql', mongodb: 'nosql', dynamo: 'kv', elastic: 'search-index',
  elasticsearch: 'search-index', neo4j: 'graph-db', influx: 'timeseries', tsdb: 'timeseries', grafana: 'dashboard', prometheus: 'metrics', logs: 'log',
  cron: 'cron', airflow: 'scheduler', git: 'repo', github: 'repo', ci: 'pipeline', cicd: 'pipeline', 'ci-cd': 'pipeline', npm: 'package', vault: 'secret',
  password: 'secret', jwt: 'token', oauth: 'auth', login: 'auth', iam: 'identity', sso: 'identity', waf: 'firewall', tls: 'certificate', ssl: 'certificate',
  vnet: 'vpc', az: 'zone', namespace: 'namespace', host: 'server', backend: 'server', vm: 'vm', ec2: 'vm', ram: 'memory', cuda: 'gpu', bot: 'ai-agent',
  assistant: 'ai-agent', asistente: 'ai-agent', mcp: 'tool', jupyter: 'notebook', embeddings: 'embedding', ml: 'model', user: 'user', usuario: 'user',
  human: 'person', people: 'team', group: 'group', grupo: 'group', container: 'container', frame: 'group', ellipse: 'ellipse', circle: 'ellipse',
  oval: 'ellipse', note: 'note', email: 'email', mail: 'email', whatsapp: 'chat', telegram: 'chat', slack: 'chat', internet: 'internet', www: 'internet',
  aws: 'cloud', azure: 'cloud', gcp: 'cloud', router: 'router', mqtt: 'broker', iot: 'iot', sensor: 'iot', start: 'start-end', end: 'start-end',
  terminator: 'start-end', input: 'io', output: 'io', 'input-output': 'io', delay: 'delay', wait: 'delay', subroutine: 'subprocess', preparation: 'prep',
  connector: 'connector', step: 'step', callout: 'callout', legend: 'legend', leyenda: 'legend', store: 'store', almacen: 'store', agent: 'agent',
});
// The canonical id for whatever came in, or null when it names nothing known (the caller keeps it as written).
export function resolveShape(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  if (SYMS[raw]) return raw;
  const k = slug(raw);
  return SYMS[k] ? k : ALIAS[k] ?? null;
}

// ---------- search ----------

const words = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const stem = (t) => (t.length > 4 && /[^aeiou]es$/.test(t) ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
const INDEX = LIST.filter((s) => !s.hidden).map((s, order) => {
  const tok = new Map();
  const add = (list, wgt) => { for (const t of list) { const st = stem(t); if ((tok.get(st) ?? 0) < wgt) tok.set(st, wgt); } };
  add(words(CAT[s.cat].name), 0.5); add(words(s.kw), 1); add(s.id.split('-'), 2); add(words(s.name), 3);
  return { id: s.id, cat: s.cat, order, tok: [...tok], nname: norm(s.name) };
});
// Symbols matching a query, best first. `boost` (a Set of ids: favourites and recents) breaks near ties.
export function searchSymbols(q, { boost = null, limit = 200 } = {}) {
  const qt = words(q).map(stem), nq = norm(q).trim();
  if (!qt.length) return [];
  const out = [], alias = ALIAS[slug(q)] ?? null;
  // a query that names a whole family («datos», «seguridad») brings that family first
  const catHit = new Set(nq.length >= 4 ? CATS.filter((c) => { const ct = words(c.name).map(stem); return qt.every((t) => ct.some((w) => w.startsWith(t))); }).map((c) => c.id) : []);
  for (const r of INDEX) {
    let score = 0, ok = true;
    for (const t of qt) {
      let best = -1;
      for (const [w, wg] of r.tok) if (w.startsWith(t) && wg > best) best = wg;
      if (best < 0) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    if (r.nname === nq) score += 2; else if (r.nname.startsWith(nq)) score += 1;
    if (alias === r.id) score += 1.5;
    if (catHit.has(r.cat)) score += 3;
    if (boost?.has(r.id)) score += 0.5;
    out.push({ id: r.id, score, order: r.order });
  }
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.slice(0, limit).map((r) => r.id);
}
// Listed symbols, in gallery order, by category.
export function catalogue() {
  return CATS.map((c) => ({ ...c, ids: LIST.filter((s) => s.cat === c.id && !s.hidden).map((s) => s.id) }));
}
// For agents and the host: every listed symbol with its Spanish name and its keywords.
export function diagramSymbols() {
  return LIST.filter((s) => !s.hidden).map((s) => ({ id: s.id, name: s.name, cat: s.cat, catName: CAT[s.cat].name, keywords: s.kw }));
}

// ---------- drawing ----------

const f = (v) => Math.round(v * 10) / 10;

// A shell in its own coordinates (0..w, 0..h): its markup, the box its glyph sits in [cx, cy, side], and how a line
// meets it (as one of the editor's reach kinds: '' square, 'round', 'hex', 'tri').
export function shellSVG(kind, w, h, T) {
  const S = `fill="${T.f}" stroke="${T.s}" stroke-width="1.6" stroke-linejoin="round"`, cx = w / 2, cy = h / 2, m = Math.min(w, h);
  const line = (d, sw = 1.4) => `<path d="${d}" fill="none" stroke="${T.s}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  switch (kind) {
    case 'circle': return { svg: `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(m / 2 - 0.8)}" ${S}/>`, gb: [cx, cy, m * 0.5], reach: 'round' };
    case 'hex': {
      const p = [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 180) * (60 * i - 90); return `${f(cx + (w / 2 / 0.866) * Math.cos(a) * 0.985)},${f(cy + (h / 2) * Math.sin(a) * 0.985)}`; });
      return { svg: `<path d="M${p.join('L')}Z" ${S}/>`, gb: [cx, cy, m * 0.48], reach: 'hex' };
    }
    case 'cyl': case 'cyl2': {
      let s = '', x0 = 0.8, y0 = 0.8, W = w - 1.6, H = h - 1.6;
      if (kind === 'cyl2') {                           // a second one behind: a copy
        const o = Math.min(8, w * 0.1);
        const rb = Math.min((H - o) * 0.16, 10);
        s += `<path d="M${f(x0 + o)},${f(y0 + rb)}A${f((W - o) / 2)},${f(rb)} 0 0 1 ${f(x0 + W)},${f(y0 + rb)}V${f(y0 + H - o - rb)}A${f((W - o) / 2)},${f(rb)} 0 0 1 ${f(x0 + o)},${f(y0 + H - o - rb)}Z" ${S}/>` +
          `<ellipse cx="${f(x0 + o + (W - o) / 2)}" cy="${f(y0 + rb)}" rx="${f((W - o) / 2)}" ry="${f(rb)}" ${S}/>`;
        y0 += o; W -= o; H -= o;
      }
      const ry = Math.min(H * 0.16, 11), rx = W / 2, mx = x0 + rx;
      s += `<path d="M${f(x0)},${f(y0 + ry)}A${f(rx)},${f(ry)} 0 0 1 ${f(x0 + W)},${f(y0 + ry)}V${f(y0 + H - ry)}A${f(rx)},${f(ry)} 0 0 1 ${f(x0)},${f(y0 + H - ry)}Z" ${S}/>` +
        `<ellipse cx="${f(mx)}" cy="${f(y0 + ry)}" rx="${f(rx)}" ry="${f(ry)}" fill="${T.lid || T.f}" stroke="${T.s}" stroke-width="1.6"/>`;
      return { svg: s, gb: [mx, y0 + ry + (H - ry) / 2, Math.min(W, H) * 0.44], reach: '', band: { x0, y0, W, H, ry } };
    }
    case 'tube': {
      const rx = Math.min(w * 0.1, 10), ry = cy - 0.8;
      return {
        svg: `<path d="M${f(rx + 0.8)},0.8H${f(w - rx - 0.8)}A${f(rx)},${f(ry)} 0 0 1 ${f(w - rx - 0.8)},${f(h - 0.8)}H${f(rx + 0.8)}A${f(rx)},${f(ry)} 0 0 1 ${f(rx + 0.8)},0.8Z" ${S}/>` +
          `<ellipse cx="${f(w - rx - 0.8)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${T.lid || T.f}" stroke="${T.s}" stroke-width="1.6"/>`,
        gb: [cx - rx * 0.6, cy, h * 0.74], reach: '',
      };
    }
    case 'doc': {
      const c = m * 0.26;
      return { svg: `<path d="M.8,.8H${f(w - c)}L${f(w - 0.8)},${f(c)}V${f(h - 0.8)}H.8Z" ${S}/>` + line(`M${f(w - c)},.8V${f(c)}H${f(w - 0.8)}`), gb: [cx, cy + m * 0.06, m * 0.56], reach: '' };
    }
    case 'shield':
      return { svg: `<path d="M${f(cx)},1L${f(w - 1)},${f(h * 0.17)}V${f(h * 0.5)}C${f(w - 1)},${f(h * 0.76)} ${f(w * 0.74)},${f(h * 0.9)} ${f(cx)},${f(h - 1)}C${f(w * 0.26)},${f(h * 0.9)} 1,${f(h * 0.76)} 1,${f(h * 0.5)}V${f(h * 0.17)}Z" ${S}/>`, gb: [cx, h * 0.47, m * 0.5], reach: '' };
    case 'tri':
      return { svg: `<path d="M${f(cx)},2L${f(w - 2)},${f(h - 2)}H2Z" ${S}/>`, gb: [cx, h * 0.64, h * 0.42], reach: 'tri' };
    case 'cloud':
      return {
        svg: `<path d="M${f(w * 0.26)},${f(h - 1)}H${f(w * 0.77)}A${f(w * 0.2)},${f(h * 0.3)} 0 0 0 ${f(w * 0.8)},${f(h * 0.39)}A${f(w * 0.3)},${f(h * 0.38)} 0 0 0 ${f(w * 0.235)},${f(h * 0.43)}A${f(w * 0.22)},${f(h * 0.285)} 0 0 0 ${f(w * 0.26)},${f(h - 1)}Z" ${S}/>`,
        gb: [cx, h * 0.62, h * 0.46], reach: 'round',
      };
    case 'phone': {
      const r = Math.min(w * 0.2, 10);
      return { svg: `<rect x=".8" y=".8" width="${f(w - 1.6)}" height="${f(h - 1.6)}" rx="${f(r)}" ${S}/>` + line(`M${f(cx - w * 0.12)},${f(h - h * 0.085)}h${f(w * 0.24)}`, 1.6), gb: [cx, cy - h * 0.02, w * 0.6], reach: '' };
    }
    case 'tablet': {
      const r = Math.min(w * 0.12, 8);
      return { svg: `<rect x=".8" y=".8" width="${f(w - 1.6)}" height="${f(h - 1.6)}" rx="${f(r)}" ${S}/>` + line(`M${f(cx - w * 0.08)},${f(h - h * 0.065)}h${f(w * 0.16)}`, 1.6), gb: [cx, cy, w * 0.56], reach: '' };
    }
    case 'laptop': {
      const sh = h * 0.76;
      return {
        svg: `<rect x="${f(w * 0.1)}" y=".8" width="${f(w * 0.8)}" height="${f(sh - 0.8)}" rx="${f(Math.min(5, w * 0.06))}" ${S}/>` +
          `<path d="M.8,${f(sh + 1)}H${f(w - 0.8)}L${f(w - w * 0.06)},${f(h - 0.8)}H${f(w * 0.06)}Z" ${S}/>`,
        gb: [cx, sh / 2, sh * 0.56], reach: '',
      };
    }
    case 'desktop': {
      const sh = h * 0.74;
      return {
        svg: `<rect x=".8" y=".8" width="${f(w - 1.6)}" height="${f(sh - 0.8)}" rx="${f(Math.min(5, w * 0.06))}" ${S}/>` +
          line(`M${f(cx)},${f(sh)}V${f(h - 2)}M${f(cx - w * 0.2)},${f(h - 1.6)}H${f(cx + w * 0.2)}`, 1.6),
        gb: [cx, sh / 2, sh * 0.56], reach: '',
      };
    }
    case 'browser': {
      const bar = Math.max(9, h * 0.21);
      return {
        svg: `<rect x=".8" y=".8" width="${f(w - 1.6)}" height="${f(h - 1.6)}" rx="${f(Math.min(6, m * 0.1))}" ${S}/>` + line(`M.8,${f(bar)}H${f(w - 0.8)}`) +
          `<circle cx="${f(bar * 0.6)}" cy="${f(bar / 2 + 0.4)}" r="${f(bar * 0.13)}" fill="${T.s}"/><circle cx="${f(bar * 1.05)}" cy="${f(bar / 2 + 0.4)}" r="${f(bar * 0.13)}" fill="${T.s}"/>`,
        gb: [cx, (h + bar) / 2, (h - bar) * 0.6], reach: '',
      };
    }
    default: {                                         // tile
      return { svg: `<rect x=".8" y=".8" width="${f(w - 1.6)}" height="${f(h - 1.6)}" rx="${f(m * 0.17)}" ${S}/>`, gb: [cx, cy, m * 0.54], reach: '' };
    }
  }
}
// The reach kind of a catalogue symbol (for where arrows meet it).
export const reachKind = (id) => { const s = SYMS[id]; return s?.shell ? shellSVG(s.shell, 10, 10, { s: '', f: '' }).reach : ''; };

// A glyph inside a box [cx, cy, side], in the tint's glyph colour. The stroke never goes under `minPx` (1.25) screen
// units at scale `px` (node units per screen pixel), so the small ones stay legible.
export function glyphSVG(key, [gx, gy, gs], colour, { px = 1, minPx = 1.25 } = {}) {
  const g = glyphMarkup(key);
  if (!g || !(gs > 0)) return '';
  const k = gs / 24, sw = Math.max(1.8, (minPx * px) / k);
  return `<g transform="translate(${f(gx - gs / 2)},${f(gy - gs / 2)}) scale(${k.toFixed(4)})" fill="none" stroke="${colour}" color="${colour}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round">${g}</g>`;
}

// A catalogue symbol in its own coordinates: shell + glyph (+ copies behind for `count`). `T` is its tint.
export function drawSymbol(n, T) {
  const s = SYMS[n.shape];
  if (!s?.shell) return '';
  const { w, h } = n;
  const sh = shellSVG(s.shell, w, h, T);
  let out = '';
  const count = countOf(n);
  if (count) {
    for (const o of [10, 5]) out += `<g transform="translate(${o},${-o})" opacity=".55">${shellSVG(s.shell, w, h, T).svg}</g>`;
  }
  out += sh.svg;
  if (s.id === 'database' && sh.band) {             // the plain database keeps the store's band, so old and new look alike
    const { x0, y0, W, H, ry } = sh.band;
    out += `<path d="M${f(x0)},${f(y0 + H * 0.54)}A${f(W / 2)},${f(ry)} 0 0 0 ${f(x0 + W)},${f(y0 + H * 0.54)}" fill="none" stroke="${T.s}" stroke-width="1.2"/>`;
  }
  out += glyphSVG(s.glyph, sh.gb, T.g, { px: n._px || 1 });
  if (count) {
    const label = '×' + count, pw = 8 + label.length * 6.4, x = w + 10 - pw / 2 - 2, y = -10;
    out += `<rect x="${f(x - pw / 2)}" y="${f(y - 8)}" width="${f(pw)}" height="16" rx="8" fill="${T.bg || '#fff'}" stroke="${T.s}" stroke-width="1"/>` +
      `<text x="${f(x)}" y="${f(y + 0.5)}" text-anchor="middle" dominant-baseline="central" font-family='"Segoe UI", sans-serif' font-size="10.5" fill="${T.ink}">${label}</text>`;
  }
  return out;
}
export const countOf = (n) => { const c = Math.round(+n.count); return c >= 2 && c <= 99 ? c : 0; };

// A frame's little glyph (16 units) before its title.
export function frameGlyph(id, x, y, colour) {
  const s = SYMS[id], key = s?.glyph || SYMS[s?.icon]?.glyph;
  return key ? glyphSVG(key, [x + 8, y + 8, 16], colour, { minPx: 1 }) : '';
}
