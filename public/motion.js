// Meadow's motion: one place for how things move, so every element moves the same way.
//
// · EASE / DUR — the few curves and durations the app uses. «snap» is the sticky, magnetic one (a thing landing in
//   its place: docking, pinning, dropping, undo); «smooth» for growing and appearing; «out» for leaving.
// · measure(root) → where every [data-k] thing is now (screen rects), before a redraw.
// · flip(root, before, scaleOf) → after the redraw, each thing glides from its old place and size to the new one
//   (First-Last-Invert-Play). New things appear softly. Nothing moves when nothing changed.
// · grow(el, fromW) → an element that changed width (a circle opening to be written in) eases to its new width.

export const EASE = {
  snap: 'cubic-bezier(.34, 1.56, .64, 1)',
  smooth: 'cubic-bezier(.22, 1, .36, 1)',
  out: 'cubic-bezier(.4, 0, .2, 1)',
};
export const DUR = { snap: 340, smooth: 260, quick: 160 };
const MAX_ANIMATED = 400;            // beyond this many things, redraws do not animate (keeps big boards fast)

export function measure(root, sel = '[data-k]') {
  const m = new Map();
  for (const el of root.querySelectorAll(sel)) m.set(el.dataset.id, el.getBoundingClientRect());
  return m;
}

// scaleOf(el): how much the element's own coordinates are magnified on screen (plane zoom × its own scale), so a
// screen offset can be turned into a transform in its own space.
export function flip(root, before, scaleOf, { sel = '[data-k]', ease = EASE.snap, dur = DUR.snap, appear = true } = {}) {
  const els = [...root.querySelectorAll(sel)];
  if (!before || els.length > MAX_ANIMATED) return;
  for (const el of els) {
    const a = before.get(el.dataset.id), b = el.getBoundingClientRect();
    if (!a) {
      if (appear) el.animate([{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'none' }], { duration: DUR.smooth, easing: EASE.smooth });
      continue;
    }
    const dx = a.left - b.left, dy = a.top - b.top;
    const sx = b.width ? a.width / b.width : 1, sy = b.height ? a.height / b.height : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
    const k = scaleOf(el) || 1;
    el.animate([
      { transformOrigin: '0 0', transform: `translate(${dx / k}px, ${dy / k}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: dur, easing: ease });
  }
}

export function grow(el, fromW, { ease = EASE.smooth, dur = DUR.smooth } = {}) {
  const to = el.offsetWidth;
  if (Math.abs(to - fromW) < 1) return;
  el.animate([{ width: fromW + 'px' }, { width: to + 'px' }], { duration: dur, easing: ease });
}
