// Free post-its: a translucent layer of paper notes over the project screen, attached to nothing.
//
// · The layer is fixed below the top bar; it never moves with what scrolls or navigates underneath. Only the notes
//   take the pointer, and a wheel over a note is passed on to what lies beneath, so they hide as little as possible.
// · x / y are fractions of the layer (a note keeps its place when the window resizes); w / h are pixels. On screen a
//   note is clamped so it never goes under the top bar and always keeps at least EDGE px inside the layer.
// · The app owns the data: it passes the notes in and gets a copy back through onChange after every change.

import { EASE, DUR } from './motion.js';

export const COLORS = ['#fff3b0', '#ffd9e2', '#d9ecff', '#dcf5d7', '#eadcff'];
const MIN_W = 120, MIN_H = 90, EDGE = 40, DRAG_SLOP = 4, TYPE_DEBOUNCE = 300;
const TOP = 8;                        // room for the tape above a note at the very top
const FOLD_W = 150, FOLD_H = 32;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const firstWords = (t) => (t || '').trim().split(/\s+/).slice(0, 5).join(' ');

export function createPostits(layerEl, { notes = [], onChange = () => {}, topOffset = 56 } = {}) {
  let list = notes.map((n) => ({ ...n }));
  const els = new Map();              // id → note element
  let typeTimer = 0, lastColor = COLORS[0], visible = true;

  Object.assign(layerEl.style, { position: 'fixed', inset: `${topOffset}px 0 0 0`, pointerEvents: 'none' });
  layerEl.classList.add('pi-layer');
  layerEl.style.setProperty('--pi-snap', EASE.snap);
  layerEl.style.setProperty('--pi-smooth', EASE.smooth);
  layerEl.style.setProperty('--pi-dur', DUR.snap + 'ms');

  const size = () => ({ W: layerEl.clientWidth || innerWidth, H: layerEl.clientHeight || innerHeight - topOffset });
  const find = (id) => list.find((n) => n.id === id);
  const topZ = () => list.reduce((m, n) => Math.max(m, n.z || 0), 0);
  const emit = () => { clearTimeout(typeTimer); typeTimer = 0; onChange(list.map((n) => ({ ...n }))); };
  const emitSoon = () => { clearTimeout(typeTimer); typeTimer = setTimeout(emit, TYPE_DEBOUNCE); };

  // On-screen box of a note, clamped to the layer.
  function box(n) {
    const { W, H } = size();
    const w = n.fold ? Math.min(n.w, FOLD_W) : Math.min(n.w, W), h = n.fold ? FOLD_H : Math.min(n.h, H);
    const left = clamp(n.x * W, EDGE - w, W - EDGE), top = clamp(n.y * H, TOP, Math.max(TOP, H - EDGE));
    return { left, top, w, h };
  }

  function place(el, n) {
    const b = box(n);
    el.style.left = b.left + 'px'; el.style.top = b.top + 'px';
    el.style.width = b.w + 'px'; el.style.height = b.h + 'px';
    el.style.zIndex = n.z || 1;
    el.style.setProperty('--rot', (n.rot || 0) + 'deg');
    el.style.setProperty('--c', n.color || COLORS[0]);
    el.classList.toggle('fold', !!n.fold);
    el.querySelector('.pi-peek').textContent = firstWords(n.text) || '…';
    for (const d of el.querySelectorAll('.pi-dot')) d.classList.toggle('on', d.dataset.c === n.color);
  }

  function build(n) {
    const el = document.createElement('div');
    el.className = 'pi'; el.dataset.id = n.id;
    el.innerHTML = `<div class="pi-tape"></div>
      <div class="pi-tools">${COLORS.map((c) => `<button class="pi-dot" data-c="${c}" style="--d:${c}" tabindex="-1"></button>`).join('')}<button class="pi-del" tabindex="-1" title="Quitar">×</button></div>
      <div class="pi-text" spellcheck="false"></div><div class="pi-peek"></div><div class="pi-grip"></div>`;
    const text = el.querySelector('.pi-text');
    try { text.contentEditable = 'plaintext-only'; } catch { text.contentEditable = 'true'; }
    text.textContent = n.text || '';
    wire(el, text);
    return el;
  }

  function render() {
    const seen = new Set();
    for (const n of list) {
      seen.add(n.id);
      let el = els.get(n.id);
      if (!el) { el = build(n); els.set(n.id, el); layerEl.append(el); }
      const text = el.querySelector('.pi-text');
      if (document.activeElement !== text && text.innerText !== (n.text || '')) text.textContent = n.text || '';
      place(el, n);
    }
    for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); }
  }

  function front(n, el) {
    const z = topZ();
    if ((n.z || 0) < z || list.filter((m) => (m.z || 0) === z).length > 1) { n.z = z + 1; el.style.zIndex = n.z; return true; }
    return false;
  }

  function remove(id, animate = true) {
    const el = els.get(id);
    list = list.filter((n) => n.id !== id);
    els.delete(id);
    emit();
    if (!el) return;
    el.classList.add('gone');
    if (!animate) { el.remove(); return; }
    el.animate([{ opacity: 1, transform: getComputedStyle(el).transform }, { opacity: 0, transform: 'scale(.6) rotate(0deg)' }],
      { duration: DUR.quick + 40, easing: EASE.out, fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
  }

  function setFold(n, el, fold) {
    const a = el.getBoundingClientRect();
    n.fold = fold || undefined;
    if (!fold) delete n.fold;
    if (fold && document.activeElement === el.querySelector('.pi-text')) el.querySelector('.pi-text').blur();
    place(el, n);
    const b = el.getBoundingClientRect();
    el.animate([{ width: a.width + 'px', height: a.height + 'px' }, { width: b.width + 'px', height: b.height + 'px' }],
      { duration: DUR.smooth, easing: EASE.smooth });
    emit();
  }

  function wire(el, text) {
    const note = () => find(el.dataset.id);

    // Drag: press anywhere and move. A plain click on the text puts the caret; while the text is being edited,
    // pressing on it selects text (the paper border and the tape still drag).
    el.addEventListener('pointerdown', (e) => {
      const n = note(); if (!n || e.button !== 0) return;
      if (e.target.closest('.pi-tools, .pi-grip')) return;
      const editing = document.activeElement === text && text.contains(e.target);
      if (front(n, el)) emit();
      if (editing) return;
      const sx = e.clientX, sy = e.clientY, b0 = box(n);
      let dragging = false;
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!dragging) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          dragging = true; el.dataset.dragging = '1';
          getSelection()?.removeAllRanges();
          if (document.activeElement === text) text.blur();
          el.setPointerCapture?.(e.pointerId);
          el.classList.add('drag'); document.body.classList.add('pi-dragging');
        }
        ev.preventDefault();
        const { W, H } = size();
        const left = clamp(b0.left + dx, EDGE - b0.w, W - EDGE), top = clamp(b0.top + dy, TOP, Math.max(TOP, H - EDGE));
        n.x = left / W; n.y = top / H;
        el.style.left = left + 'px'; el.style.top = top + 'px';
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        if (!dragging) return;
        delete el.dataset.dragging;
        el.classList.remove('drag'); document.body.classList.remove('pi-dragging');
        if (!n.text?.trim()) text.focus();   // an empty note was just made: keep writing on it
        emit();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });

    // Resize from the corner.
    el.querySelector('.pi-grip').addEventListener('pointerdown', (e) => {
      const n = note(); if (!n || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      front(n, el);
      const sx = e.clientX, sy = e.clientY, w0 = n.w, h0 = n.h, b0 = box(n);
      el.classList.add('sizing'); document.body.classList.add('pi-dragging');
      const move = (ev) => {
        const { W, H } = size();
        n.w = Math.round(clamp(w0 + ev.clientX - sx, MIN_W, W - Math.max(0, b0.left)));
        n.h = Math.round(clamp(h0 + ev.clientY - sy, MIN_H, H - b0.top));
        el.style.width = n.w + 'px'; el.style.height = n.h + 'px';
      };
      const up = () => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        el.classList.remove('sizing'); document.body.classList.remove('pi-dragging');
        emit();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    });

    // Colour dots and delete: they never steal the caret.
    const tools = el.querySelector('.pi-tools');
    tools.addEventListener('pointerdown', (e) => e.preventDefault());
    tools.addEventListener('click', (e) => {
      const n = note(); if (!n) return;
      const dot = e.target.closest('.pi-dot');
      if (dot) { n.color = lastColor = dot.dataset.c; place(el, n); emit(); return; }
      if (e.target.closest('.pi-del')) remove(n.id);
    });

    // Fold to a peek and back: double click on the tape (or on the peek itself).
    el.addEventListener('dblclick', (e) => {
      const n = note(); if (!n) return;
      if (e.target.closest('.pi-tape') || (n.fold && e.target.closest('.pi-peek'))) {
        e.preventDefault(); getSelection()?.removeAllRanges();
        setFold(n, el, !n.fold);
      }
    });

    text.addEventListener('input', () => {
      const n = note(); if (!n) return;
      n.text = text.innerText.replace(/\n$/, '');
      emitSoon();
    });
    text.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = e.clipboardData?.getData('text/plain') || '';
      if (t) document.execCommand('insertText', false, t);
    });
    text.addEventListener('keydown', (e) => {
      e.stopPropagation();             // the app's shortcuts do not fire while writing on a note
      if (e.key === 'Escape') { e.preventDefault(); text.blur(); }
      else if (e.key === 'Delete' && !text.innerText.trim()) { e.preventDefault(); remove(el.dataset.id); }
    });
    for (const t of ['keyup', 'keypress']) text.addEventListener(t, (e) => e.stopPropagation());
    text.addEventListener('focus', () => { const n = note(); if (n && front(n, el)) emit(); });
    text.addEventListener('blur', () => {
      if (typeTimer) emit();
      setTimeout(() => {
        const n = note();
        if (!n || el.dataset.dragging || document.activeElement === text) return;   // dragging, or the window lost focus
        if (!text.innerText.trim()) remove(n.id);
      }, 0);
    });

    // A wheel over a note goes to what lies beneath (unless the note's own text is scrolling).
    el.addEventListener('wheel', (e) => {
      if (text.contains(e.target) && text.scrollHeight > text.clientHeight + 1) return;
      e.preventDefault();
      el.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      el.style.pointerEvents = '';
      if (!under || layerEl.contains(under)) return;
      const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY,
        deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey });
      if (!under.dispatchEvent(ev)) return;
      for (let s = under; s && s !== document.documentElement; s = s.parentElement) {
        const cs = getComputedStyle(s);
        if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (s.scrollHeight > s.clientHeight || s.scrollWidth > s.clientWidth)) {
          s.scrollBy(e.deltaX, e.deltaY); return;
        }
      }
      document.scrollingElement?.scrollBy(e.deltaX, e.deltaY);
    }, { passive: false });
  }

  const ro = new ResizeObserver(() => { for (const n of list) { const el = els.get(n.id); if (el) place(el, n); } });
  ro.observe(layerEl);
  render();

  return {
    add(clientX, clientY) {
      const r = layerEl.getBoundingClientRect(), { W, H } = size();
      const w = 190, h = 150;
      const left = clamp(clientX - r.left - w / 2, EDGE - w, W - EDGE), top = clamp(clientY - r.top - h / 2, TOP, Math.max(TOP, H - EDGE));
      const n = { id: newId(), x: left / W, y: top / H, w, h, text: '', color: lastColor,
        rot: Math.round((Math.random() * 5 - 2.5) * 10) / 10, z: topZ() + 1 };
      list.push(n);
      render();
      const el = els.get(n.id);
      el.animate([{ opacity: 0, transform: `rotate(${n.rot}deg) scale(.86)` }, { opacity: .88, transform: `rotate(${n.rot}deg)` }],
        { duration: DUR.smooth, easing: EASE.smooth });
      el.querySelector('.pi-text').focus();
      emit();
      return n.id;
    },
    setNotes(arr) { list = (arr || []).map((n) => ({ ...n })); render(); },
    setVisible(v) { visible = !!v; layerEl.style.display = visible ? '' : 'none'; if (!visible) document.activeElement?.closest?.('.pi')?.querySelector('.pi-text')?.blur(); },
    destroy() {
      if (typeTimer) emit();
      ro.disconnect();
      for (const el of els.values()) el.remove();
      els.clear(); layerEl.classList.remove('pi-layer');
    },
  };
}
