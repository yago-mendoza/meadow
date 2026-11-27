// Meadow diagrams · the layout core: pure geometry, no DOM. Used by the editor and by thumbnails, so both draw the
// same lines. Everything here is computed, never saved: routes, ports, label spots and pushes.
//
// · SpatialHash        rectangles in 160-unit cells; insert / remove / query.
// · orthoRoute()       an orthogonal path that avoids rectangles: A* on a sparse grid with a bend penalty and soft costs
//                      (crossing other lines, frames, title bands, the frontier). Several start and goal ports at once,
//                      each with its own penalty, so the side is chosen by the search and lines never loop around.
// · nudge()            keeps parallel lines of different edges apart (7 units), ordered so they do not cross.
// · placeLabels()      puts every arrow label where it touches nothing (pieces, other labels, lines).
// · pushApart()        what a moving thing pushes out of its way, from the original positions (so it is reversible).
// · findFree()         the nearest spot where a rectangle touches nothing.
// · snapLines()/snapTo() alignment guides: centres and edges of other pieces, equal gaps, a soft grid.
// Determinism: ties are broken by input order, so the same JSON always draws the same picture.

export const CELL = 160;

// ---------- rectangles ----------

export const inflate = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
export const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
export const union = (rs) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
export const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// Does the segment a→b pass through the interior of r? (Liang–Barsky; touching the border does not count.)
export function segHitsRect(a, b, r) {
  const e = 0.01, x0 = r.x + e, y0 = r.y + e, x1 = r.x + r.w - e, y1 = r.y + r.h - e;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-6;
}
export const polyHitsRect = (pts, r) => { for (let i = 1; i < pts.length; i++) if (segHitsRect(pts[i - 1], pts[i], r)) return true; return false; };

// ---------- spatial hash ----------

export class SpatialHash {
  constructor(cell = CELL) { this.cell = cell; this.cells = new Map(); this.items = new Map(); this.seq = 0; }
  keys(r) {
    const c = this.cell, out = [];
    for (let i = Math.floor(r.x / c); i <= Math.floor((r.x + r.w) / c); i++) for (let j = Math.floor(r.y / c); j <= Math.floor((r.y + r.h) / c); j++) out.push(i + ',' + j);
    return out;
  }
  insert(id, r) {
    if (this.items.has(id)) this.remove(id);
    const ks = this.keys(r);
    this.items.set(id, { r, ks, o: this.seq++ });
    for (const k of ks) { let s = this.cells.get(k); if (!s) this.cells.set(k, (s = new Set())); s.add(id); }
  }
  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    for (const k of it.ks) this.cells.get(k)?.delete(id);
    this.items.delete(id);
  }
  rect(id) { return this.items.get(id)?.r; }
  // ids whose rectangle intersects [x0,x1]×[y0,y1], in insertion order
  query(x0, y0, x1, y1) {
    const c = this.cell, seen = new Set();
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
      const s = this.cells.get(i + ',' + j);
      if (!s) continue;
      for (const id of s) { if (seen.has(id)) continue; const r = this.items.get(id).r; if (r.x <= x1 && r.x + r.w >= x0 && r.y <= y1 && r.y + r.h >= y0) seen.add(id); }
    }
    if (seen.size < 2) return [...seen];
    const it = this.items;
    return [...seen].sort((a, b) => it.get(a).o - it.get(b).o);
  }
  queryRect(r, m = 0) { return this.query(r.x - m, r.y - m, r.x + r.w + m, r.y + r.h + m); }
}

// ---------- the router ----------

class Heap {
  constructor() { this.f = []; this.k = []; }
  get size() { return this.f.length; }
  push(k, f) {
    const F = this.f, K = this.k;
    let i = F.length;
    F.push(f); K.push(k);
    while (i) { const p = (i - 1) >> 1; if (F[p] <= f) break; F[i] = F[p]; K[i] = K[p]; i = p; }
    F[i] = f; K[i] = k;
  }
  pop() {
    const F = this.f, K = this.k, top = K[0], tf = F[0], lf = F.pop(), lk = K.pop();
    if (F.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = -1, mf = lf;
        if (l < F.length && F[l] < mf) { m = l; mf = F[l]; }
        if (r < F.length && F[r] < mf) m = r;
        if (m < 0) break;
        F[i] = F[m]; K[i] = K[m]; i = m;
      }
      F[i] = lf; K[i] = lk;
    }
    return [tf, top];
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dirOf = (nx, ny) => DIRS.findIndex(([u, v]) => u === nx && v === ny);
const lowerBound = (A, v) => { let lo = 0, hi = A.length; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < v) lo = m + 1; else hi = m; } return lo; };

// Drops points that repeat or sit in the middle of a straight run.
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue;
    out.push({ x: p.x, y: p.y });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) out.splice(i, 1);
  }
  return out;
}

// starts / goals: [{ x, y, nx, ny, pen }] — ports on a node's border with their outward normal and a side penalty.
// obstacles: rectangles (not inflated). opts: { M, STUB, BEND, corridor, cross: [{x0,y0,x1,y1,c}] axis-aligned lines that
// cost c to cross, along: [{x0,y0,x1,y1}] lines that cost 0.6·length to run beside, bands: [{x,y,w,h,c}] areas that cost c to
// enter }. Returns { pts, start, goal } or null.
export function orthoRoute(starts, goals, obstacles, opts = {}) {
  const M = opts.M ?? 12, STUB = opts.STUB ?? 16, BEND = opts.BEND ?? 30;
  const stub = (p) => ({ x: p.x + p.nx * STUB, y: p.y + p.ny * STUB });
  const S = starts.map((p) => ({ p, a: stub(p) })), G = goals.map((p) => ({ p, a: stub(p) }));
  const R = obstacles.map((r) => inflate(r, M));
  const cor = opts.corridor;
  const xs = new Set(), ys = new Set();
  for (const s of [...S, ...G]) { xs.add(s.a.x); ys.add(s.a.y); }
  if (cor) { xs.add(cor.x); xs.add(cor.x + cor.w); ys.add(cor.y); ys.add(cor.y + cor.h); }
  for (const r of R) { xs.add(r.x); xs.add(r.x + r.w); ys.add(r.y); ys.add(r.y + r.h); }
  const mids = (set) => { const v = [...set].sort((u, w) => u - w); for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > 3 * M) set.add((v[i] + v[i - 1]) / 2); };
  mids(xs); mids(ys);
  let X = [...xs].sort((u, v) => u - v), Y = [...ys].sort((u, v) => u - v);
  if (cor) { X = X.filter((v) => v >= cor.x - 0.01 && v <= cor.x + cor.w + 0.01); Y = Y.filter((v) => v >= cor.y - 0.01 && v <= cor.y + cor.h + 0.01); }
  const W = X.length, H = Y.length;
  if (!W || !H || W * H > 160000) return null;
  const ix = (v) => { const i = lowerBound(X, v - 0.01); return i < W && Math.abs(X[i] - v) < 0.02 ? i : -1; };
  const iy = (v) => { const j = lowerBound(Y, v - 0.01); return j < H && Math.abs(Y[j] - v) < 0.02 ? j : -1; };
  const blocked = new Uint8Array(W * H), hb = new Uint8Array(W * H), vb = new Uint8Array(W * H);
  const span = (A, lo, hi) => [lowerBound(A, lo - 0.01), lowerBound(A, hi + 0.011) - 1];
  for (const r of R) {
    const [i0, i1] = span(X, r.x, r.x + r.w), [j0, j1] = span(Y, r.y, r.y + r.h);
    if (i0 > i1 || j0 > j1) continue;
    // strictly inside: points; edges that pass through the interior
    for (let j = j0; j <= j1; j++) {
      const yIn = Y[j] > r.y + 0.01 && Y[j] < r.y + r.h - 0.01;
      for (let i = Math.max(0, i0 - 1); i <= Math.min(W - 1, i1); i++) {
        const xIn = X[i] > r.x + 0.01 && X[i] < r.x + r.w - 0.01;
        if (xIn && yIn) blocked[j * W + i] = 1;
        if (yIn && i + 1 < W && X[i] < r.x + r.w - 0.01 && X[i + 1] > r.x + 0.01) hb[j * W + i] = 1;
      }
    }
    for (let i = i0; i <= i1; i++) {
      const xIn = X[i] > r.x + 0.01 && X[i] < r.x + r.w - 0.01;
      if (!xIn) continue;
      for (let j = Math.max(0, j0 - 1); j <= Math.min(H - 1, j1); j++) if (j + 1 < H && Y[j] < r.y + r.h - 0.01 && Y[j + 1] > r.y + 0.01) vb[j * W + i] = 1;
    }
  }
  // soft costs per grid edge
  const hc = new Float32Array(W * H), vc = new Float32Array(W * H);
  for (const s of opts.cross || []) {
    if (Math.abs(s.x0 - s.x1) < 0.01) {           // a vertical line: horizontal moves that cross it
      const x = s.x0, i = lowerBound(X, x) - 1, [ja, jb] = span(Y, Math.min(s.y0, s.y1), Math.max(s.y0, s.y1));
      if (i < 0 || i + 1 >= W || !(X[i] < x && X[i + 1] > x)) continue;
      for (let j = ja; j <= jb; j++) hc[j * W + i] += s.c;
    } else {                                         // a horizontal line: vertical moves that cross it
      const y = s.y0, j = lowerBound(Y, y) - 1, [ia, ib] = span(X, Math.min(s.x0, s.x1), Math.max(s.x0, s.x1));
      if (j < 0 || j + 1 >= H || !(Y[j] < y && Y[j + 1] > y)) continue;
      for (let i = ia; i <= ib; i++) vc[j * W + i] += s.c;
    }
  }
  for (const s of opts.along || []) {
    if (Math.abs(s.y0 - s.y1) < 0.01) {
      const lo = Math.min(s.x0, s.x1), hi = Math.max(s.x0, s.x1), [ja, jb] = span(Y, s.y0 - 6, s.y0 + 6);
      for (let j = ja; j <= jb; j++) for (let i = Math.max(0, lowerBound(X, lo) - 1); i + 1 < W && X[i] < hi; i++) { const ov = Math.min(hi, X[i + 1]) - Math.max(lo, X[i]); if (ov > 0) hc[j * W + i] += 0.6 * ov; }
    } else if (Math.abs(s.x0 - s.x1) < 0.01) {
      const lo = Math.min(s.y0, s.y1), hi = Math.max(s.y0, s.y1), [ia, ib] = span(X, s.x0 - 6, s.x0 + 6);
      for (let i = ia; i <= ib; i++) for (let j = Math.max(0, lowerBound(Y, lo) - 1); j + 1 < H && Y[j] < hi; j++) { const ov = Math.min(hi, Y[j + 1]) - Math.max(lo, Y[j]); if (ov > 0) vc[j * W + i] += 0.6 * ov; }
    }
  }
  for (const b of opts.bands || []) {
    const [ia, ib] = span(X, b.x, b.x + b.w), [ja, jb] = span(Y, b.y, b.y + b.h);
    for (let j = Math.max(0, ja - 1); j <= jb; j++) for (let i = Math.max(0, ia - 1); i <= ib; i++) {
      if (i + 1 < W && Y[j] >= b.y && Y[j] <= b.y + b.h && X[i + 1] > b.x && X[i] < b.x + b.w) hc[j * W + i] += b.c;
      if (j + 1 < H && X[i] >= b.x && X[i] <= b.x + b.w && Y[j + 1] > b.y && Y[j] < b.y + b.h) vc[j * W + i] += b.c;
    }
  }

  const N = W * H * 4, g = new Float64Array(N + G.length).fill(Infinity), from = new Int32Array(N + G.length).fill(-1);
  const heap = new Heap();
  const goalAt = new Map();
  G.forEach((o, gi) => {
    const i = ix(o.a.x), j = iy(o.a.y);
    if (i < 0 || j < 0 || blocked[j * W + i]) return;
    const c = j * W + i;
    if (!goalAt.has(c)) goalAt.set(c, []);
    goalAt.get(c).push({ gi, d: dirOf(-o.p.nx, -o.p.ny), pen: o.p.pen || 0 });
  });
  if (!goalAt.size) return null;
  const goalPts = G.map((o) => o.a);
  const hx = (c) => { const x = X[c % W], y = Y[(c / W) | 0]; let m = Infinity; for (const p of goalPts) m = Math.min(m, Math.abs(x - p.x) + Math.abs(y - p.y)); return m; };
  const startOf = new Map();
  S.forEach((o, si) => {
    const i = ix(o.a.x), j = iy(o.a.y);
    if (i < 0 || j < 0 || blocked[j * W + i]) return;
    const k = (j * W + i) * 4 + dirOf(o.p.nx, o.p.ny), c0 = (o.p.pen || 0) + STUB;
    if (c0 < g[k]) { g[k] = c0; startOf.set(k, si); heap.push(k, c0 + hx(j * W + i)); }
  });
  if (!heap.size) return null;
  let end = -1, guard = 0;
  while (heap.size && guard++ < 400000) {
    const [fv, k] = heap.pop();
    if (k >= N) { end = k; break; }
    const c = k >> 2, d = k & 3;
    if (fv - hx(c) > g[k] + 1e-6) continue;
    const gs = goalAt.get(c);
    if (gs) for (const o of gs) {
      const cost = g[k] + (d === o.d ? 0 : BEND) + o.pen + STUB, tk = N + o.gi;
      if (cost < g[tk]) { g[tk] = cost; from[tk] = k; heap.push(tk, cost); }
    }
    const i = c % W, j = (c / W) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d ^ 1)) continue;
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nc = nj * W + ni;
      if (blocked[nc]) continue;
      const horiz = DIRS[nd][1] === 0, eidx = horiz ? j * W + Math.min(i, ni) : Math.min(j, nj) * W + i;
      if (horiz ? hb[eidx] : vb[eidx]) continue;
      const cost = g[k] + Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (nd === d ? 0 : BEND) + (horiz ? hc[eidx] : vc[eidx]), nk = nc * 4 + nd;
      if (cost < g[nk]) { g[nk] = cost; from[nk] = k; heap.push(nk, cost + hx(nc)); }
    }
  }
  if (end < 0) return null;
  const goal = G[end - N], cells = [];
  let k = from[end], first = k;
  while (k >= 0) { first = k; const c = k >> 2; cells.push({ x: X[c % W], y: Y[(c / W) | 0] }); k = from[k]; }
  cells.reverse();
  const start = S[startOf.get(first)];
  if (!start) return null;
  return { pts: simplify([start.p, ...cells, goal.p]), start: start.p, goal: goal.p };
}

// ---------- nudging: parallel lines kept apart ----------

// routes: [{ id, bus, pts }] (bus: lines that share a trunk on purpose count as one). pts are changed in place.
// obstacles (optional): rectangles a spread segment must not enter.
export function nudge(routes, { SEP = 10, obstacles = [] } = {}) {
  const segs = [];
  for (const r of routes) {
    const P = r.pts;
    for (let k = 1; k < P.length - 2; k++) {
      const a = P[k], b = P[k + 1];
      if (Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) > 0.01) segs.push({ r, k, ax: 'y', c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), turn: Math.sign(P[k + 2].y - b.y) - Math.sign(P[k - 1].y - a.y) });
      else if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) > 0.01) segs.push({ r, k, ax: 'x', c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), turn: Math.sign(P[k + 2].x - b.x) - Math.sign(P[k - 1].x - a.x) });
    }
  }
  for (const ax of ['x', 'y']) {
    const L = segs.filter((s) => s.ax === ax).sort((u, v) => u.c - v.c || u.lo - v.lo);
    for (let i = 0; i < L.length;) {
      let j = i + 1;
      while (j < L.length && Math.abs(L[j].c - L[j - 1].c) < SEP - 0.5) j++;   // lines closer than SEP are one bundle
      const row = L.slice(i, j).sort((u, v) => u.lo - v.lo);
      i = j;
      if (row.length < 2) continue;
      let cl = [row[0]], end = row[0].hi;
      const spread = () => {
        const lanes = [];
        for (const s of cl) { const key = s.r.bus ?? s.r.id; let l = lanes.find((x) => x.key === key); if (!l) lanes.push((l = { key, segs: [], turn: 0 })); l.segs.push(s); l.turn += s.turn; }
        if (lanes.length < 2) return;
        lanes.sort((u, v) => u.turn - v.turn);
        let sep = SEP;
        const c0 = cl[0].c, span = { lo: Math.min(...cl.map((s) => s.lo)), hi: Math.max(...cl.map((s) => s.hi)) };
        const free = (off) => !obstacles.some((o) => ax === 'y'
          ? (c0 + off > o.y && c0 + off < o.y + o.h && span.hi > o.x && span.lo < o.x + o.w)
          : (c0 + off > o.x && c0 + off < o.x + o.w && span.hi > o.y && span.lo < o.y + o.h));
        const half = ((lanes.length - 1) / 2) * sep;
        if (!free(-half) || !free(half)) sep = 4;
        lanes.forEach((l, n) => {
          const off = (n - (lanes.length - 1) / 2) * sep;
          for (const s of l.segs) { s.r.pts[s.k][ax] = s.c + off; s.r.pts[s.k + 1][ax] = s.c + off; }
        });
      };
      for (let n = 1; n < row.length; n++) {
        if (row[n].lo < end - 1) { cl.push(row[n]); end = Math.max(end, row[n].hi); } else { spread(); cl = [row[n]]; end = row[n].hi; }
      }
      spread();
    }
  }
}

// ---------- labels ----------

// labels: [{ id, w, h, pts, curve }] in route order; blockers: SpatialHash of rectangles labels must not touch;
// lines: all route polylines. Returns Map id → { x, y, anchor:'middle' } (centre of the label).
export function placeLabels(labels, blockers, lines) {
  const placed = [], out = new Map();
  const cands = (L) => {
    const c = [], P = L.pts;
    let total = 0;
    for (let i = 1; i < P.length; i++) total += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
    let run = 0;
    const mid = total / 2;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      const horiz = Math.abs(a.y - b.y) < Math.abs(a.x - b.x);
      const need = (horiz ? L.w : L.h) + 16;
      if (L.curve || len >= need || P.length === 2) {
        for (const t of L.curve ? [0.5] : [0.5, 1 / 3, 2 / 3, 0.2, 0.8]) {
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, along = Math.abs(run + len * t - mid);
          if (horiz) {
            c.push({ x, y: y - 9 - L.h / 2 + 4, d: along, pen: 0 }, { x, y: y + 9 + L.h / 2 - 4, d: along, pen: 10 });
          } else {
            c.push({ x: x + 9 + L.w / 2, y, d: along, pen: 0 }, { x: x - 9 - L.w / 2, y, d: along, pen: 10 });
          }
        }
      }
      run += len;
    }
    if (!c.length) {                                  // nothing long enough: the middle of the longest stretch
      let best = 0, bi = 1;
      for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); if (l > best) { best = l; bi = i; } }
      const a = P[bi - 1], b = P[bi], horiz = Math.abs(a.y - b.y) < 1;
      c.push(horiz ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 9 - L.h / 2 + 4, d: 0, pen: 0 } : { x: (a.x + b.x) / 2 + 9 + L.w / 2, y: (a.y + b.y) / 2, d: 0, pen: 0 });
    }
    return c;
  };
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const score = (L, c) => {
    const r = { x: c.x - L.w / 2, y: c.y - L.h / 2, w: L.w, h: L.h };
    let s = 0.5 * c.d + c.pen;
    for (const id of blockers.queryRect(r)) s += 1000 * area(r, blockers.rect(id)) / (L.w * L.h) * 10;
    for (const p of placed) { s += 400 * area(r, p) / (L.w * L.h) * 10; if (area({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 }, p) > 0) s += 40; }   // two labels touching read as one
    // crossing another line is bad; sitting right beside one reads as that line's label, nearly as bad
    const near = { x: r.x - 9, y: r.y - 9, w: r.w + 18, h: r.h + 18 };
    for (const ln of lines) {
      if (ln === L.pts) continue;
      let hit = 0;
      for (let i = 1; i < ln.length && hit < 200; i++) { if (segHitsRect(ln[i - 1], ln[i], r)) hit = 200; else if (!hit && segHitsRect(ln[i - 1], ln[i], near)) hit = 70; }
      s += hit;
    }
    return { s, r };
  };
  const all = labels.map((L) => ({ L, c: cands(L) }));
  // the most constrained first: fewest candidates without any overlap
  const free = (o) => o.c.filter((c) => score(o.L, c).s < 60).length;
  all.forEach((o) => { o.free = free(o); });
  all.sort((a, b) => a.free - b.free);
  for (const { L, c } of all) {
    let best = null;
    for (const cand of c) { const sc = score(L, cand); if (!best || sc.s < best.s) best = { ...sc, cand }; }
    placed.push(best.r);
    out.set(L.id, { x: best.cand.x, y: best.cand.y });
  }
  return out;
}

// ---------- pushing things out of the way ----------

// movers: [{ id, r }] where they are now; others: [{ id, r }] at their ORIGINAL positions (never the pushed ones), so dragging
// back returns everything. fixed: ids that never move (locked). axis: 'x' | 'y' | null (the drag's dominant axis).
// gap(a, b): the clearance between two particular things (two pieces joined by an arrow need room for it), at most CMax.
// Returns Map id → { dx, dy } for every pushed thing.
export function pushApart(movers, others, { C: C0 = 16, axis = null, fixed = new Set(), maxDepth = 6, maxCount = 60, block = null, gap = null, CMax = C0 } = {}) {
  const hash = new SpatialHash();
  const rect = new Map();
  for (const o of others) { hash.insert(o.id, o.r); rect.set(o.id, o.r); }
  const moverIds = new Set(movers.map((m) => m.id));
  const disp = new Map();
  const queue = movers.map((m) => ({ id: m.id, r: m.r, depth: 0, mover: true }));
  let count = 0;
  while (queue.length) {
    const q = queue.shift();
    if (q.depth >= maxDepth) continue;
    for (const id of hash.queryRect(q.r, Math.max(C0, CMax))) {
      if (id === q.id || moverIds.has(id) || fixed.has(id)) continue;
      const C = gap ? gap(q.id, id) : C0;
      const base = rect.get(id), cur0 = disp.get(id) || { dx: 0, dy: 0 };
      const cur = { x: base.x + cur0.dx, y: base.y + cur0.dy, w: base.w, h: base.h };
      if (!overlaps(q.r, cur, C - 0.01)) continue;
      // how far it has to go on each axis, away from the pusher's centre
      const pcx = q.r.x + q.r.w / 2, pcy = q.r.y + q.r.h / 2, ccx = cur.x + cur.w / 2, ccy = cur.y + cur.h / 2;
      const sx = ccx >= pcx ? 1 : -1, sy = ccy >= pcy ? 1 : -1;
      const penX = sx > 0 ? q.r.x + q.r.w + C - cur.x : cur.x + cur.w + C - q.r.x;
      const penY = sy > 0 ? q.r.y + q.r.h + C - cur.y : cur.y + cur.h + C - q.r.y;
      let ax = axis;
      if (!ax || (ax === 'x' && penY < penX * (2 / 3)) || (ax === 'y' && penX < penY * (2 / 3))) ax = penX <= penY ? 'x' : 'y';
      if (block && ax === 'y' && block(id, cur, sy * penY)) ax = 'x';
      const nd = { dx: cur0.dx, dy: cur0.dy };
      if (ax === 'x') nd.dx = cur0.dx + sx * penX; else nd.dy = cur0.dy + sy * penY;
      if (Math.abs(nd.dx) < Math.abs(cur0.dx)) nd.dx = cur0.dx;
      if (Math.abs(nd.dy) < Math.abs(cur0.dy)) nd.dy = cur0.dy;
      if (!disp.has(id)) { if (++count > maxCount) return disp; }
      disp.set(id, nd);
      queue.push({ id, r: { x: base.x + nd.dx, y: base.y + nd.dy, w: base.w, h: base.h }, depth: q.depth + 1 });
    }
  }
  return disp;
}

// ---------- a free spot ----------

// The nearest position for rect (x, y = wanted top-left) where it touches nothing in `hash` (with clearance C), searched on
// a grid of `step` in growing rings. Ties: right, then down, then left, then up.
export function findFree(rect, hash, { C = 24, step = 12, rings = 40, exclude = new Set(), ok = null } = {}) {
  const busy = (x, y) => {
    const r = { x, y, w: rect.w, h: rect.h };
    for (const id of hash.queryRect(r, C)) if (!exclude.has(id) && overlaps(r, hash.rect(id), C - 0.01)) return true;
    return ok ? !ok(r) : false;
  };
  if (!busy(rect.x, rect.y)) return { x: rect.x, y: rect.y };
  for (let ring = 1; ring <= rings; ring++) {
    const c = [];
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const pref = i > 0 && j === 0 ? 0 : j > 0 && i === 0 ? 1 : i < 0 && j === 0 ? 2 : j < 0 && i === 0 ? 3 : 4;
      c.push({ i, j, d: Math.hypot(i, j), pref });
    }
    c.sort((a, b) => a.d - b.d || a.pref - b.pref);
    for (const { i, j } of c) { const x = rect.x + i * step, y = rect.y + j * step; if (!busy(x, y)) return { x, y }; }
  }
  return { x: rect.x, y: rect.y };
}

// ---------- snapping and guides ----------

// Candidate lines from the pieces that are not moving: x ∈ {left, centre, right}, y ∈ {top, middle, bottom}.
// boxes: [{ id, x, y, w, h, link }] (link: connected to what moves, which makes straightening an arrow win).
export function snapLines(boxes) {
  const xs = [], ys = [];
  for (const b of boxes) {
    xs.push({ v: b.x, b, k: 'e' }, { v: b.x + b.w / 2, b, k: 'c' }, { v: b.x + b.w, b, k: 'e' });
    ys.push({ v: b.y, b, k: 'e' }, { v: b.y + b.h / 2, b, k: 'c' }, { v: b.y + b.h, b, k: 'e' });
  }
  xs.sort((a, b) => a.v - b.v); ys.sort((a, b) => a.v - b.v);
  return { xs, ys, boxes };
}

// Where a moving box (x, y, w, h) wants to go, given the candidates. thr: threshold in units (6 screen px / zoom).
// Returns { dx, dy, gx: [guide], gy: [guide], gaps: [tick] }.
export function snapTo(box, lines, { thr = 6, linkThr = 10, grid = 12 } = {}) {
  const pick = (own, cands, horizontal) => {
    let best = null;
    for (const [o, kind] of own) {
      const lo = lowerBoundBy(cands, o - linkThr);
      for (let i = lo; i < cands.length && cands[i].v <= o + linkThr; i++) {
        const c = cands[i], d = Math.abs(c.v - o);
        const linked = c.b.link && c.k === 'c' && kind === 'c';
        if (d > (linked ? linkThr : thr)) continue;
        const rank = linked ? 0 : c.k === 'c' && kind === 'c' ? 1 : 2;
        if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { rank, d, delta: c.v - o, v: c.v, kind };
      }
    }
    if (!best) return null;
    const hits = cands.filter((c) => Math.abs(c.v - best.v) < 0.5);
    return { delta: best.delta, v: best.v, hits, horizontal };
  };
  const ownX = [[box.x, 'e'], [box.x + box.w / 2, 'c'], [box.x + box.w, 'e']];
  const ownY = [[box.y, 'e'], [box.y + box.h / 2, 'c'], [box.y + box.h, 'e']];
  const sx = pick(ownX, lines.xs, false), sy = pick(ownY, lines.ys, true);
  let dx = sx ? sx.delta : null, dy = sy ? sy.delta : null;
  const gaps = [];
  // equal spacing along a row (or column): between two neighbours, or matching a gap that already exists
  const eq = (axis) => {
    const along = axis === 'x', b = box;
    const row = lines.boxes.filter((o) => (along ? o.y < b.y + b.h && o.y + o.h > b.y : o.x < b.x + b.w && o.x + o.w > b.x));
    if (row.length < 1) return null;
    const lo = along ? b.x : b.y, size = along ? b.w : b.h;
    const before = row.filter((o) => (along ? o.x + o.w : o.y + o.h) <= lo + thr).sort((p, q) => (along ? q.x + q.w - p.x - p.w : q.y + q.h - p.y - p.h))[0];
    const after = row.filter((o) => (along ? o.x : o.y) >= lo + size - thr).sort((p, q) => (along ? p.x - q.x : p.y - q.y))[0];
    const end = (o) => (along ? o.x + o.w : o.y + o.h), start = (o) => (along ? o.x : o.y);
    if (before && after) {                       // centred between the two
      const gap = (start(after) - end(before) - size) / 2, want = end(before) + gap;
      if (gap > 0 && Math.abs(want - lo) <= thr) return { delta: want - lo, ticks: [[end(before), want], [want + size, start(after)]] };
    }
    // the same gap as two others in the row
    const sorted = row.slice().sort((p, q) => start(p) - start(q)), have = [];
    for (let i = 1; i < sorted.length; i++) { const g = start(sorted[i]) - end(sorted[i - 1]); if (g > 4) have.push([end(sorted[i - 1]), start(sorted[i])]); }
    for (const [a, c] of have) {
      const g = c - a;
      if (before && Math.abs(lo - end(before) - g) <= thr) return { delta: end(before) + g - lo, ticks: [[a, c], [end(before), end(before) + g]] };
      if (after && Math.abs(start(after) - (lo + size) - g) <= thr) return { delta: start(after) - g - size - lo, ticks: [[a, c], [start(after) - g, start(after)]] };
    }
    return null;
  };
  if (dx === null) { const e = eq('x'); if (e) { dx = e.delta; for (const [a, c] of e.ticks) gaps.push({ axis: 'x', a, c, at: box.y + box.h / 2 }); } }
  if (dy === null) { const e = eq('y'); if (e) { dy = e.delta; for (const [a, c] of e.ticks) gaps.push({ axis: 'y', a, c, at: box.x + box.w / 2 }); } }
  if (dx === null) dx = grid ? Math.round(box.x / grid) * grid - box.x : 0;
  if (dy === null) dy = grid ? Math.round(box.y / grid) * grid - box.y : 0;
  return { dx, dy, gx: sx, gy: sy, gaps };
}
function lowerBoundBy(A, v) { let lo = 0, hi = A.length; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m].v < v) lo = m + 1; else hi = m; } return lo; }
