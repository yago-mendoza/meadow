// Meadow diagrams: «Disponer», the big arranging gestures. A few recognisable shapes a selection can take at once —
// a chain, layers, a tree, a grid, a hub — each a pure function of the pieces and the arrows among them. They read the
// glyph box (x, y, w, h) for alignment and the full extent (words included) for room, keep the selection's centre where
// it was, and write only x/y. The editor previews each one as a thumbnail and a set of ghost outlines before he picks.

const GAP_X = 72, GAP_Y = 44;           // room between full extents (words included)

export const ARRANGE = [
  { id: 'chain', name: 'Cadena' },
  { id: 'layers', name: 'Capas' },
  { id: 'tree', name: 'Árbol' },
  { id: 'hub', name: 'Eje' },
  { id: 'grid', name: 'Rejilla' },
  { id: 'column', name: 'Columna' },
];

function graphOf(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const out = new Map(nodes.map((n) => [n.id, []])), inn = new Map(nodes.map((n) => [n.id, []]));
  for (const e of es) { out.get(e.from).push(e.to); inn.get(e.to).push(e.from); }
  return { es, out, inn };
}
// Topological order (reading order breaks ties; a cycle is broken at its top-left piece).
function topo(nodes, g) {
  const byId = new Map(nodes.map((n) => [n.id, n])), indeg = new Map(nodes.map((n) => [n.id, g.inn.get(n.id).length]));
  const rd = (a, b) => (byId.get(a).x - byId.get(b).x) || (byId.get(a).y - byId.get(b).y);
  const done = new Set(), order = [];
  while (order.length < nodes.length) {
    let ready = nodes.filter((n) => !done.has(n.id) && indeg.get(n.id) <= 0).map((n) => n.id).sort(rd);
    if (!ready.length) ready = nodes.filter((n) => !done.has(n.id)).map((n) => n.id).sort(rd).slice(0, 1);
    const id = ready[0];
    done.add(id); order.push(id);
    for (const t of g.out.get(id)) indeg.set(t, indeg.get(t) - 1);
  }
  return order;
}
const isPath = (nodes, g) => g.es.length === nodes.length - 1 && nodes.every((n) => g.out.get(n.id).length <= 1 && g.inn.get(n.id).length <= 1);
function hasCycle(nodes, g) {
  const st = new Map();
  const dfs = (id) => { st.set(id, 1); for (const t of g.out.get(id)) { if (st.get(t) === 1) return true; if (!st.get(t) && dfs(t)) return true; } st.set(id, 2); return false; };
  return nodes.some((n) => !st.get(n.id) && dfs(n.id));
}
const isTree = (nodes, g) => !hasCycle(nodes, g) && nodes.every((n) => g.inn.get(n.id).length <= 1) && nodes.filter((n) => !g.inn.get(n.id).length).length >= 1 && g.es.length > 0;

// Why a shape cannot apply to this selection ('' when it can).
export function arrangeFits(kind, nodes, edges) {
  const g = graphOf(nodes, edges);
  if (nodes.length < 2) return 'Necesita dos piezas';
  if (kind === 'tree' && !isTree(nodes, g)) return hasCycle(nodes, g) ? 'Tiene ciclos' : 'No es un árbol';
  if (kind === 'hub' && nodes.length < 3) return 'Necesita tres piezas';
  if ((kind === 'layers') && !g.es.length) return 'Sin flechas entre ellas';
  return '';
}
// The shape that fits best, for a soft ring on its tile.
export function suggestArrange(nodes, edges) {
  const g = graphOf(nodes, edges);
  if (!g.es.length) return nodes.length > 3 ? 'grid' : 'chain';
  if (isPath(nodes, g)) return 'chain';
  const deg = (id) => g.out.get(id).length + g.inn.get(id).length;
  if (nodes.length >= 4 && nodes.some((n) => deg(n.id) > (nodes.length - 1) / 2 && deg(n.id) >= 3)) return 'hub';
  if (isTree(nodes, g)) return 'tree';
  return 'layers';
}

// Writes the new x/y into D for the pieces in `ids`. ext(n) gives the full extent (words, trigger, status dot).
export function arrangeMut(D, ids, kind, ext) {
  const nodes = D.nodes.filter((n) => ids.has(n.id));
  if (nodes.length < 2 || arrangeFits(kind, nodes, D.edges)) return false;
  const g = graphOf(nodes, D.edges);
  // the room each piece needs around its glyph box: words hang below (or right), triggers sit left
  const room = new Map(nodes.map((n) => { const e = ext(n); return [n.id, { l: n.x - e.x, r: e.x + e.w - n.x - n.w, t: n.y - e.y, b: e.y + e.h - n.y - n.h }]; }));
  const W = (id) => { const n = D.nodes.find((x) => x.id === id), r = room.get(id); return n.w + r.l + r.r; };
  const H = (id) => { const n = D.nodes.find((x) => x.id === id), r = room.get(id); return n.h + r.t + r.b; };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const c0 = centreOf(nodes);
  const pos = new Map();                                   // id → glyph centre
  // a row of pieces, centres on one line, gaps measured between full extents
  const row = (list, y, x0 = 0) => {
    let x = x0;
    for (const id of list) { const r = room.get(id), n = byId.get(id); pos.set(id, { x: x + r.l + n.w / 2, y }); x += W(id) + GAP_X; }
    return x - GAP_X - x0;
  };
  const col = (list, x, y0 = 0) => {
    let y = y0;
    for (const id of list) { const r = room.get(id), n = byId.get(id); pos.set(id, { x, y: y + r.t + n.h / 2 }); y += H(id) + GAP_Y; }
    return y - GAP_Y - y0;
  };
  const rd = (a, b) => (byId.get(a).y - byId.get(b).y) || (byId.get(a).x - byId.get(b).x);

  if (kind === 'chain') row(topo(nodes, g), 0);
  else if (kind === 'column') col(topo(nodes, g), 0);
  else if (kind === 'grid') {
    const list = nodes.map((n) => n.id).sort(rd), cols = Math.ceil(Math.sqrt(list.length));
    const cw = Math.max(...list.map(W)) + GAP_X, rh = Math.max(...list.map(H)) + GAP_Y;
    list.forEach((id, i) => { const r = room.get(id), n = byId.get(id); pos.set(id, { x: (i % cols) * cw + r.l + n.w / 2, y: Math.floor(i / cols) * rh + r.t + n.h / 2 }); });
  } else if (kind === 'layers') {
    // rank by longest path from the sources, then 4 barycenter sweeps inside each rank
    const order = topo(nodes, g), rank = new Map();
    for (const id of order) rank.set(id, Math.max(0, ...g.inn.get(id).filter((p) => rank.has(p)).map((p) => rank.get(p) + 1)));
    const ranks = [];
    for (const id of order) (ranks[rank.get(id)] ||= []).push(id);
    for (const r of ranks) r.sort(rd);
    const idx = () => new Map(ranks.flatMap((r) => r.map((id, i) => [id, i])));
    for (let s = 0; s < 4; s++) {
      const at = idx(), down = s % 2 === 0;
      for (let ri = down ? 1 : ranks.length - 2; down ? ri < ranks.length : ri >= 0; ri += down ? 1 : -1) {
        const bc = (id) => { const nb = (down ? g.inn : g.out).get(id).filter((x) => at.has(x)); return nb.length ? nb.reduce((a, x) => a + at.get(x), 0) / nb.length : at.get(id); };
        ranks[ri].sort((a, b) => bc(a) - bc(b));
      }
    }
    let x = 0;
    for (const r of ranks) {
      const w = Math.max(...r.map(W)), h = r.reduce((a, id) => a + H(id), 0) + GAP_Y * (r.length - 1);
      let y = -h / 2;
      for (const id of r) { const rm = room.get(id), n = byId.get(id); pos.set(id, { x: x + w / 2 - (rm.r - rm.l) / 2, y: y + rm.t + n.h / 2 }); y += H(id) + GAP_Y; }
      x += w + GAP_X + 24;
    }
  } else if (kind === 'tree') {
    // top-down: each subtree as wide as its leaves, parents centred over their children
    const roots = nodes.filter((n) => !g.inn.get(n.id).length).map((n) => n.id).sort(rd);
    const kids = (id) => g.out.get(id).slice().sort((a, b) => byId.get(a).x - byId.get(b).x);
    const width = new Map();
    const wOf = (id) => { if (width.has(id)) return width.get(id); const k = kids(id); const v = Math.max(W(id), k.reduce((a, c) => a + wOf(c), 0) + GAP_X * Math.max(0, k.length - 1)); width.set(id, v); return v; };
    const depthH = [];
    const depth = (id, d) => { depthH[d] = Math.max(depthH[d] || 0, H(id)); for (const c of kids(id)) depth(c, d + 1); };
    roots.forEach((r) => depth(r, 0));
    const yAt = (d) => depthH.slice(0, d).reduce((a, h) => a + h + GAP_Y + 28, 0);
    const place = (id, x0, d) => {
      const n = byId.get(id), r = room.get(id), w = wOf(id);
      pos.set(id, { x: x0 + w / 2 - (r.r - r.l) / 2, y: yAt(d) + r.t + n.h / 2 });
      let x = x0 + (w - (kids(id).reduce((a, c) => a + wOf(c), 0) + GAP_X * Math.max(0, kids(id).length - 1))) / 2;
      for (const c of kids(id)) { place(c, x, d + 1); x += wOf(c) + GAP_X; }
    };
    let x = 0;
    for (const r of roots) { place(r, x, 0); x += wOf(r) + GAP_X; }
  } else if (kind === 'hub') {
    // the most connected piece in the middle; its neighbours on a ring in the order they already sit (nobody swaps
    // sides); the rest on an outer ring at their parent's angle
    const deg = (id) => g.out.get(id).length + g.inn.get(id).length;
    const hub = nodes.map((n) => n.id).sort((a, b) => deg(b) - deg(a) || rd(a, b))[0], hn = byId.get(hub);
    const hc = { x: hn.x + hn.w / 2, y: hn.y + hn.h / 2 };
    const near = [...new Set([...g.out.get(hub), ...g.inn.get(hub)])], rest = nodes.map((n) => n.id).filter((id) => id !== hub && !near.includes(id));
    const ang = (id) => { const n = byId.get(id); return Math.atan2(n.y + n.h / 2 - hc.y, n.x + n.w / 2 - hc.x); };
    const big = Math.max(...nodes.map((n) => Math.max(W(n.id), H(n.id))));
    const R1 = Math.max(Math.max(W(hub), H(hub)) / 2 + big / 2 + GAP_X, (near.length * (big + 24)) / (2 * Math.PI));
    pos.set(hub, { x: 0, y: 0 });
    const ring = near.slice().sort((a, b) => ang(a) - ang(b)), a0 = ring.length ? ang(ring[0]) : 0;
    const at = new Map();
    ring.forEach((id, i) => { const a = a0 + (i * 2 * Math.PI) / ring.length; at.set(id, a); pos.set(id, { x: Math.cos(a) * R1 * 1.15, y: Math.sin(a) * R1 }); });
    const R2 = R1 + big + GAP_X;
    rest.sort((a, b) => ang(a) - ang(b)).forEach((id, i) => {
      const p = [...g.inn.get(id), ...g.out.get(id)].find((x) => at.has(x));
      const a = p !== undefined ? at.get(p) + (i % 2 ? 0.25 : -0.25) : ang(id);
      at.set(id, a);
      pos.set(id, { x: Math.cos(a) * R2 * 1.15, y: Math.sin(a) * R2 });
    });
  }
  // keep the selection's centre where it was; whole units
  const c1 = centreOf([...pos].map(([id, p]) => { const n = byId.get(id); return { x: p.x - n.w / 2, y: p.y - n.h / 2, w: n.w, h: n.h }; }));
  for (const [id, p] of pos) {
    const n = byId.get(id);
    n.x = Math.round(p.x - n.w / 2 + c0.x - c1.x);
    n.y = Math.round(p.y - n.h / 2 + c0.y - c1.y);
  }
  return true;
}
function centreOf(rs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
