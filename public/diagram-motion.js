// Meadow diagrams: how things move. One vocabulary (motion.js's EASE and DUR), and the few pure helpers the editor needs
// to make data visibly travel along arrows, to walk a chain step by step, and to acknowledge what a hand just did.
//
// · bezier(str) → t ↦ eased t, so JS tweens move exactly like the CSS curves; EASES holds motion.js's three.
// · reducedMotion() → the viewer asked for less motion; everything that moves then has a still equivalent.
// · phaseDelay(ms) → a negative animation-delay that keeps a looping CSS animation in phase with the clock, so a line
//   rebuilt during a drag never jumps and every line at one speed moves in lockstep.
// · flowOf(e) → { speed, dir } or null: what an edge's optional `flow` field asks for (true | 'slow' | 'fast' |
//   { speed, dir: 'back'|'both', rate }).
// · packetPath(g, route) → the arrow's path, trimmed so packets start clear of the piece and stop short of the chevron.
// · tourSteps(d, isFrame) → the order a presentation walks the chain in (or the diagram's own `tour`).
// · tactile(kind, el) → the small acknowledgements: a piece landing, a port clicking in, a frame accepting.
// Nothing here touches focus or the data: motion is visual only.

import { EASE, DUR } from './motion.js';
export { EASE, DUR };

export function bezier(str) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(str);
  if (!m) return (t) => t;
  const [x1, y1, x2, y2] = m[1].split(',').map(Number);
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-4) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;
    if (Math.abs(X(t) - x) > 1e-3) { t = x; for (let i = 0; i < 30; i++) { const v = X(t); if (Math.abs(v - x) < 1e-4) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return Y(t);
  };
}
export const EASES = { snap: bezier(EASE.snap), smooth: bezier(EASE.smooth), out: bezier(EASE.out) };
export const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export function phaseDelay(ms) {
  const t = (typeof document !== 'undefined' && document.timeline?.currentTime) || (typeof performance !== 'undefined' ? performance.now() : 0);
  return -(t % ms);
}

// ---------- data travelling along arrows ----------

// A packet is a capsule 8 units long, one every 84 units; speeds are diagram units per second, so long and short
// lines look equally fast.
export const PACKET = { len: 8, gap: 76 };
export const PERIOD = PACKET.len + PACKET.gap;
export const SPEED = { slow: 36, normal: 70, fast: 140 };
export function flowOf(e) {
  const v = e?.flow;
  if (!v) return null;
  if (v === true || v === 'normal') return { speed: 'normal', dir: 'fwd', ups: SPEED.normal };
  if (v === 'slow' || v === 'fast') return { speed: v, dir: 'fwd', ups: SPEED[v] };
  if (typeof v === 'object') {
    const dir = v.dir === 'back' || v.dir === 'both' ? v.dir : 'fwd';
    if (Number.isFinite(+v.rate) && +v.rate > 0) {         // events per minute, on a log scale, 30–160 u/s
      const ups = Math.max(30, Math.min(160, 30 + 26 * Math.log2(1 + +v.rate)));
      return { speed: ups < 50 ? 'slow' : ups > 110 ? 'fast' : 'normal', dir, ups };
    }
    const speed = SPEED[v.speed] ? v.speed : 'normal';
    return { speed, dir, ups: SPEED[speed] };
  }
  return { speed: 'normal', dir: 'fwd', ups: SPEED.normal };
}
// The value the bar writes back: the plain forms when they say it all, the object form only for a direction.
export function flowValue(speed, dir) {
  if (!speed) return undefined;
  if (dir && dir !== 'fwd') return { speed, dir };
  return speed === 'normal' ? true : speed;
}

const ff = (v) => Math.round(v * 10) / 10;
export function polyLength(P) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
  return L;
}
// The part of a polyline between arc lengths a and b.
export function trimPoly(P, a, b) {
  const out = [];
  let s = 0;
  for (let i = 1; i < P.length; i++) {
    const A = P[i - 1], B = P[i], l = Math.hypot(B.x - A.x, B.y - A.y);
    if (!l) continue;
    const at = (d) => ({ x: A.x + ((B.x - A.x) * (d - s)) / l, y: A.y + ((B.y - A.y) * (d - s)) / l });
    if (s + l >= a && s <= b) {
      if (!out.length) out.push(a > s ? at(a) : { x: A.x, y: A.y });
      if (s + l <= b) out.push({ x: B.x, y: B.y });
      else { out.push(at(b)); break; }
    }
    s += l;
  }
  return out;
}
function roundedD(pts, r) {
  let d = `M${ff(pts[0].x)},${ff(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], B = pts[i], C = pts[i + 1], l1 = Math.hypot(B.x - A.x, B.y - A.y) || 1, l2 = Math.hypot(C.x - B.x, C.y - B.y) || 1, rr = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${ff(B.x - ((B.x - A.x) / l1) * rr)},${ff(B.y - ((B.y - A.y) / l1) * rr)} Q${ff(B.x)},${ff(B.y)} ${ff(B.x + ((C.x - B.x) / l2) * rr)},${ff(B.y + ((C.y - B.y) / l2) * rr)}`;
  }
  const L = pts[pts.length - 1];
  return d + ` L${ff(L.x)},${ff(L.y)}`;
}
// The arrow's own path, 5 units clear of its start and 14 short of the tip (packets pass under the label's halo and
// never over the chevron). Curves are sampled finely already; square routes keep their rounded corners.
export function packetPath(g, route, head = 'end') {
  const P = g.poly;
  if (!P || P.length < 2) return null;
  const L = polyLength(P), a = head === 'both' ? 14 : 5, b = L - (head === 'none' ? 5 : 14);
  if (b - a < 10) return null;
  const pts = trimPoly(P, a, b);
  if (pts.length < 2) return null;
  return { d: g.curve ? 'M' + pts.map((p) => `${ff(p.x)},${ff(p.y)}`).join('L') : roundedD(pts, route === 'curve' ? 28 : 7), len: b - a };
}
const rgbOf = (hex) => { let h = String(hex).slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&'); const v = parseInt(h, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
export function mixHex(a, b, t) {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a) || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(b)) return a;
  const p = rgbOf(a), q = rgbOf(b);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
// The packet's colour: the line's own colour pushed toward contrast, so it reads on the line without a halo.
export const packetColour = (c, dark, ink) => (dark ? mixHex(c, '#ffffff', 0.35) : mixHex(c, ink, 0.3));

// ---------- walking the chain ----------

// Rounds of pieces: first what nothing feeds, then what everything already shown feeds; pieces with the same
// predecessors make one step (a fork is shown together). Cycles are broken by taking what has at least one shown
// predecessor. Disconnected parts follow in reading order. Frames are never steps.
export function tourSteps(d, isFrame) {
  const nodes = d.nodes.filter((n) => !isFrame(n)), ids = new Set(nodes.map((n) => n.id)), byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const caption = (n) => [n.text, n.sub].filter(Boolean).map((s) => String(s).replace(/\n/g, ' ')).join(' · ');
  const stepOf = (show) => {
    const ns = show.filter((id) => byId.has(id));
    return { nodes: ns, say: ns.map((id) => caption(byId.get(id))).filter(Boolean).join(' · ') };
  };
  if (Array.isArray(d.tour) && d.tour.length) {
    const steps = [];
    for (const s of d.tour) {
      if (typeof s === 'string') { if (byId.has(s)) steps.push(stepOf([s])); else { const e = edges.find((x) => x.id === s); if (e) steps.push(stepOf([e.to])); } continue; }
      if (s && typeof s === 'object') {
        const show = (Array.isArray(s.show) ? s.show : []).flatMap((id) => (byId.has(id) ? [id] : edges.filter((x) => x.id === id).map((x) => x.to)));
        if (!show.length) continue;
        const st = stepOf(show);
        if (s.say) st.say = String(s.say);
        if (s.reading !== undefined) st.reading = s.reading;
        steps.push(st);
      }
    }
    if (steps.length) return steps;
  }
  const preds = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of edges) preds.get(e.to).add(e.from);
  const shown = new Set(), steps = [];
  const order = (a, b) => (byId.get(a).y - byId.get(b).y) || (byId.get(a).x - byId.get(b).x);
  const push = (round) => {
    const bySet = new Map();
    for (const id of round.sort(order)) { const k = [...preds.get(id)].sort().join('|') || '·' + id; if (!bySet.has(k)) bySet.set(k, []); bySet.get(k).push(id); }
    for (const grp of bySet.values()) steps.push(stepOf(grp));
    for (const id of round) shown.add(id);
  };
  while (shown.size < nodes.length) {
    let round = nodes.filter((n) => !shown.has(n.id) && [...preds.get(n.id)].every((p) => shown.has(p)) && (shown.size || !preds.get(n.id).size)).map((n) => n.id);
    if (!round.length) round = nodes.filter((n) => !shown.has(n.id) && [...preds.get(n.id)].some((p) => shown.has(p))).map((n) => n.id);
    if (!round.length) {                                   // a new part (or a cycle with no way in): its top-left piece
      const rest = nodes.filter((n) => !shown.has(n.id)).sort((a, b) => (a.y + a.x * 0.5) - (b.y + b.x * 0.5));
      round = [rest[0].id];
    }
    push(round);
  }
  return steps;
}

// ---------- small acknowledgements ----------

// Fired only by a hand, never on load. el is a node's inner wrapper (or any element), animated with WAAPI.
export function tactile(kind, el) {
  if (!el?.animate || reducedMotion()) return null;
  const o = { transformBox: 'fill-box', transformOrigin: 'center' };
  if (kind === 'settle') return el.animate([{ ...o, transform: 'scale(1.025)' }, { ...o, transform: 'none' }], { duration: DUR.quick, easing: EASE.snap });
  if (kind === 'appear') return el.animate([{ ...o, opacity: 0, transform: 'scale(.86)' }, { ...o, opacity: 1, transform: 'none' }], { duration: DUR.smooth, easing: EASE.smooth });
  if (kind === 'fadein') return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR.quick, easing: EASE.smooth });
  if (kind === 'pop') return el.animate([{ ...o, opacity: 1, transform: 'scale(0)' }, { ...o, opacity: 1, transform: 'scale(1.4)', offset: 0.45 }, { ...o, opacity: 0, transform: 'scale(1)' }], { duration: DUR.snap, easing: EASE.out });
  if (kind === 'breathe') return el.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.5 }, { opacity: 1 }], { duration: DUR.snap, easing: EASE.smooth });
  if (kind === 'beat') return el.animate([{ ...o, transform: 'none' }, { ...o, transform: 'scale(1.15)', offset: 0.45 }, { ...o, transform: 'none' }], { duration: DUR.snap, easing: EASE.snap });
  return null;
}
