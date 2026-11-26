// Meadow's text editor: a plain, Notepad-like CodeMirror with a few readings on top (links between documents, tags,
// rules, post-it lines, coloured brackets, Markdown titles that make sections). Clicking the «#» of a title splits the
// text into the sections of that level, each one movable, foldable, copyable. setPlain(true) leaves the bare text.
import { EditorState, Compartment, Prec, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { codeFolding, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';

export const LINK_RE = /\[([^\[\]\n]*?)\*(\d+)\]/g;          // [label*N]: a link to document N
const NEW_RE = /\[([^\[\]\n*]*\S[^\[\]\n*]*)\*\]/g;           // [label*]: a new document to create
export const TAG_RE = /^(\s*)\[([^\[\]\n*]+)\]/;                // [TAG] at the start of a line
const RULE_RE = /^\s*-{3,}\s*$/;                                // ------ a rule drawn across the page
const HEAD_RE = /^(#{1,6})(\s+)(?=\S)/;                         // # Title · ## Title · ### Title: sections
const POSTIT_RE = /^(\s*)>(?!>)\s?/;                            // > a small note
export const TOKEN_RE = /\{(idea|tarea) (\d+)\}/g;              // {idea 3} · {tarea 5}: the same idea or task wherever it is pasted

export function hue(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }

class LinkRefWidget extends WidgetType {
  constructor(n) { super(); this.n = n; }
  eq(o) { return o.n === this.n; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-linkref'; s.dataset.n = this.n; s.title = 'Abrir'; s.textContent = '↗'; return s; }
  ignoreEvent() { return false; }
}
class PostitWidget extends WidgetType {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-postit-ico'; s.textContent = '🗒️'; return s; }
  eq() { return true; }
}

const mk = (cls) => Decoration.mark({ class: cls });
const M = { brk: mk('cm-brk'), par: mk('cm-par'), arrow: mk('cm-arrow'), colons: mk('cm-colons'), linkb: mk('cm-linkb'), tag: mk('cm-tag') };
const RULE_LINE = Decoration.line({ class: 'cm-rule' });
const POSTIT_LINE = Decoration.line({ class: 'cm-postit' });
const POSTIT_ICO = Decoration.replace({ widget: new PostitWidget() });

// An idea or a task inside the text: one object shown in place. Ticking or renaming it changes it everywhere.
class ChipWidget extends WidgetType {
  constructor(kind, n, item, api) {
    super(); this.kind = kind; this.n = n; this.api = api;
    this.text = item ? item.text : 'ya no existe'; this.done = !!item?.done; this.missing = !item;
  }
  eq(o) { return o.kind === this.kind && o.n === this.n && o.text === this.text && o.done === this.done && o.missing === this.missing; }
  toDOM() {
    const s = document.createElement('span');
    s.className = `cm-chip cm-chip-${this.kind}${this.done ? ' done' : ''}${this.missing ? ' missing' : ''}`;
    const ico = document.createElement('span'); ico.className = 'cm-chip-ico';
    ico.textContent = this.kind === 'idea' ? '💡' : this.done ? '✔' : '';
    if (this.kind === 'tarea' && !this.missing) {
      ico.title = this.done ? 'Reabrir' : 'Hecha';
      ico.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.api.toggleTask?.(this.n); });
    }
    const t = document.createElement('span'); t.className = 'cm-chip-text'; t.textContent = this.text || '…';
    if (!this.missing) {
      t.title = 'Clic para cambiar el texto';
      t.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.api.editItem?.(this.kind, this.n, s); });
    }
    s.append(ico, t); return s;
  }
  ignoreEvent() { return true; }
}
export const refreshEffect = StateEffect.define();
function chipsPlugin(api) {
  const build = (view) => {
    const out = [];
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.sliceDoc(from, to); TOKEN_RE.lastIndex = 0; let m;
      while ((m = TOKEN_RE.exec(text))) {
        out.push(Decoration.replace({ widget: new ChipWidget(m[1], +m[2], api.getItem?.(m[1], +m[2]), api) })
          .range(from + m.index, from + m.index + m[0].length));
      }
    }
    return Decoration.set(out, true);
  };
  return ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = build(v); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshEffect)))) this.decorations = build(u.view);
    }
  }, { decorations: (v) => v.decorations, provide: (pl) => EditorView.atomicRanges.of((v) => v.plugin(pl)?.decorations ?? Decoration.none) });
}

function decorateLine(line, out) {
  const t = line.text, base = line.from;
  if (RULE_RE.test(t)) { out.push(RULE_LINE.range(base)); return; }
  let skip = 0;
  const tm = t.match(TAG_RE), hm = t.match(HEAD_RE);
  if (hm) {
    const d = Math.min(3, hm[1].length);
    out.push(Decoration.line({ class: `cm-h cm-h${d}${line.number === 1 ? ' cm-hfirst' : ''}` }).range(base));
    out.push(Decoration.mark({ class: 'cm-hmark', attributes: { 'data-d': String(hm[1].length), title: 'Clic: dividir en secciones de este nivel' } })
      .range(base, base + hm[1].length));
    skip = hm[0].length;
  } else if (tm) {
    out.push(Decoration.line({ class: 'cm-tagline', attributes: { style: `--h:${hue(tm[2].trim().toUpperCase())}` } }).range(base));
    out.push(M.tag.range(base + tm[1].length, base + tm[0].length));
    skip = tm[0].length;
  } else {
    const pm = t.match(POSTIT_RE);
    if (pm) { out.push(POSTIT_LINE.range(base)); out.push(POSTIT_ICO.range(base + pm[1].length, base + pm[0].length)); skip = pm[0].length; }
  }
  const spans = [];
  LINK_RE.lastIndex = 0; let m;
  while ((m = LINK_RE.exec(t))) {
    if (m.index < skip) continue;
    const a = base + m.index, b = a + m[0].length, star = a + 1 + m[1].length;
    spans.push([m.index, m.index + m[0].length]);
    out.push(M.linkb.range(a, a + 1));
    if (star > a + 1) out.push(Decoration.mark({ class: 'cm-link', attributes: { 'data-n': m[2] } }).range(a + 1, star));
    out.push(Decoration.replace({ widget: new LinkRefWidget(m[2]) }).range(star, b - 1));   // the number is internal: an arrow opens it
    out.push(M.linkb.range(b - 1, b));
  }
  const inLink = (i) => spans.some(([s, e]) => i >= s && i < e);
  for (let i = skip; i < t.length; i++) {
    if (inLink(i)) continue;
    const c = t[i];
    if (c === '[' || c === ']') out.push(M.brk.range(base + i, base + i + 1));
    else if (c === '(' || c === ')') out.push(M.par.range(base + i, base + i + 1));
    else if (c === '>' && t[i + 1] === '>') { out.push(M.arrow.range(base + i, base + i + 2)); i++; }
    else if (c === ':' && t[i + 1] === ':') { out.push(M.colons.range(base + i, base + i + 2)); i++; }
  }
}

function buildDecos(view) {
  const out = [], doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) { const line = doc.lineAt(pos); decorateLine(line, out); pos = line.to + 1; }
  }
  return Decoration.set(out, true);
}

const richDecos = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = buildDecos(v); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = buildDecos(u.view); }
}, { decorations: (v) => v.decorations });

// ---- sections ------------------------------------------------------------------------------------------------------
export function headsOf(doc) {
  const out = [];
  for (let i = 1; i <= doc.lines; i++) { const t = doc.line(i).text, m = t.match(HEAD_RE); if (m) out.push({ line: i, d: m[1].length, text: t.slice(m[0].length).trim() }); }
  return out;
}
// Level n (1–6): every «#…# Title» with n hashes opens a section that runs until the next title of level n or higher.
// What sits before the first title, or between sections (a higher title and its intro), stays where it is.
export function computeBlocks(doc) {
  const heads = [];
  for (let i = 1; i <= doc.lines; i++) { const m = doc.line(i).text.match(HEAD_RE); if (m) heads.push({ line: i, d: m[1].length }); }
  const levels = [];
  for (let n = 1; n <= 6; n++) {
    const L = [];
    heads.forEach((h, k) => {
      if (h.d !== n) return;
      const next = heads.slice(k + 1).find((x) => x.d <= n);
      let to = next ? next.line - 1 : doc.lines;
      while (to > h.line && doc.line(to).text.trim() === '') to--;     // trailing blank lines belong to the gap
      L.push({ from: h.line, to });
    });
    levels.push(L);
  }
  return levels;
}

const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
class Blocks {
  constructor(view, api) {
    this.view = view; this.api = api; this.level = 0; this.keep = 1; this.naming = -1;
    this.layer = document.createElement('div'); this.layer.className = 'mw-layer';
    this.folds = document.createElement('div'); this.folds.className = 'mw-folds';
    view.scrollDOM.append(this.layer, this.folds);
    // above the column of fold buttons, one that folds or unfolds every title at once (it does not scroll away)
    this.allBtn = document.createElement('button'); this.allBtn.className = 'mw-foldall'; this.allBtn.title = 'Plegar o desplegar todos los títulos';
    this.allBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 3l4 4 4-4M4 9l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    view.dom.append(this.allBtn);
    this.allBtn.addEventListener('mousedown', (e) => { e.preventDefault(); this.foldHeads(!foldedRanges(this.view.state).size); });
    this.folds.addEventListener('mousedown', (e) => {
      const b = e.target.closest('.mw-fold'); if (!b) return;
      e.preventDefault(); this.toggleHead(+b.dataset.line);
    });
    this.onScroll = () => this.schedule();
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    this.blocks = computeBlocks(view.state.doc);
    this.heads = headsOf(view.state.doc);
    this.layer.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    this.layer.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('.mw-grip'); if (!g || e.button !== 0) return;
      e.preventDefault(); this.startDrag(e, +g.dataset.i);
    });
    this.layer.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      this.act(b.dataset.act, +b.closest('.mw-bar-tools').dataset.i);
    });
    this.schedule();
  }
  setLevel(l) {
    this.level = l; this.naming = -1;
    this.view.dom.parentNode?.classList.toggle('mw-active', l > 0);
    this.api.onLevel?.(l);
    this.schedule();
  }
  update(u) {
    if (u.docChanged) { this.blocks = computeBlocks(u.state.doc); this.heads = headsOf(u.state.doc); }
    if (u.docChanged || u.geometryChanged || u.viewportChanged || u.heightChanged || u.transactions.some((t) => t.effects.length)) this.schedule();
  }
  schedule() { this.view.requestMeasure({ key: this, read: (v) => this.read(v), write: (m) => this.write(m) }); }
  read(v) {
    const doc = v.state.doc, sr = v.scrollDOM.getBoundingClientRect();
    const off = v.documentTop - sr.top + v.scrollDOM.scrollTop;
    const folded = foldedRanges(v.state);
    const geo = (b) => {
      const from = doc.line(b.from).from, to = doc.line(b.to).to;
      const at = doc.line(b.from).to; let f = false;              // its own fold, not a subsection's
      folded.between(at, at, (x) => { if (x === at) { f = true; return false; } });
      return { ...b, top: v.lineBlockAt(from).top + off, bot: v.lineBlockAt(doc.line(b.to).from).bottom + off, folded: f };
    };
    const heads = this.heads.map((h) => {
      const s = this.sectionOf(h.line), lb = v.lineBlockAt(doc.line(h.line).from);
      let f = false;
      // folded means its own fold (starting at the end of its title line), not one of a subsection inside it
      if (s && s.to > s.from) { const at = doc.line(s.from).to; folded.between(at, at, (from) => { if (from === at) { f = true; return false; } }); }
      return { ...h, y: lb.bottom + off, body: !!s && s.to > s.from, folded: f };
    });
    const at = v.lineBlockAtHeight(v.scrollDOM.scrollTop - off + 24);
    const topLine = doc.lineAt(at.from).number;
    let current = -1; for (const h of this.heads) if (h.line <= topLine) current = h.line;
    return { levels: this.blocks.map((L, i) => (i === this.level - 1 ? L.map(geo) : [])), heads, current, h: Math.max(v.contentHeight, v.scrollDOM.clientHeight) };
  }
  sectionOf(line) { const h = this.heads.find((x) => x.line === line); return h && this.blocks[h.d - 1].find((b) => b.from === line); }
  toggleHead(line) {
    const s = this.sectionOf(line); if (!s || s.to <= s.from) return;
    const d = this.view.state.doc, from = d.line(s.from).to, to = d.line(s.to).to;
    const eff = this.unfoldIn(from, to);
    if (!eff.length) eff.push(foldEffect.of({ from, to }));
    this.view.dispatch({ effects: eff });
  }
  foldHeads(fold) {
    const st = this.view.state, d = st.doc, eff = [];
    foldedRanges(st).between(0, d.length, (f, t) => { eff.push(unfoldEffect.of({ from: f, to: t })); });
    if (eff.length) this.view.dispatch({ effects: eff });
    if (!fold) return;
    const top = Math.min(...this.heads.map((h) => h.d));          // fold the highest titles: everything else hides inside
    const e2 = [];
    for (const h of this.heads.filter((x) => x.d === top)) { const s = this.sectionOf(h.line); if (s && s.to > s.from) e2.push(foldEffect.of({ from: d.line(s.from).to, to: d.line(s.to).to })); }
    if (e2.length) this.view.dispatch({ effects: e2 });
  }
  write(m) {
    this.last = m;
    if (this.drag) return;                          // the layout holds still while a block is being dragged
    this.layer.style.height = m.h + 'px'; this.folds.style.height = m.h + 'px';
    const want = m.heads.filter((h) => h.body), have = new Map([...this.folds.children].map((b) => [b.dataset.line, b]));
    for (const h of want) {
      let b = have.get(String(h.line)); have.delete(String(h.line));
      if (!b) { b = document.createElement('button'); b.className = 'mw-fold'; b.dataset.line = h.line; b.innerHTML = CHEVRON; this.folds.append(b); }
      b.style.top = (h.y - 24) + 'px'; b.classList.toggle('shut', h.folded); b.title = h.folded ? 'Desplegar' : 'Plegar';
    }
    for (const b of have.values()) b.remove();
    this.allBtn.style.display = m.heads.some((h) => h.body) ? '' : 'none';
    this.api.onOutline?.(this.heads, m.current);
    if (!this.level) { this.layer.innerHTML = ''; return; }
    const L = m.levels[this.level - 1];
    let lay = '';
    L.forEach((b, i) => {
      lay += `<div class="mw-band${i % 2 ? ' odd' : ''}" style="top:${b.top - 4}px;height:${b.bot - b.top + 8}px"></div>`;
      if (L.length > 1) lay += `<div class="mw-grip" data-i="${i}" style="top:${b.top}px;height:${Math.max(22, b.bot - b.top)}px" title="Arrastra para mover el bloque">⠿</div>`;
      if (this.naming === i) {
        lay += `<div class="mw-bar-tools naming" data-i="${i}" style="top:${b.top}px"><input class="mw-name" placeholder="Nombre del documento…"></div>`;
      } else {
        lay += `<div class="mw-bar-tools" data-i="${i}" style="top:${b.top}px">
          <button data-act="copy" title="Copiar el bloque">⧉</button>
          <button data-act="paste" title="Pegar encima (reemplaza el bloque)">⎘</button>
          <button data-act="note" title="Guardar como documento">📄</button>
          <button data-act="fold" title="${b.folded ? 'Expandir' : 'Plegar'}">${b.folded ? '▸' : '▾'}</button></div>`;
      }
    });
    this.layer.innerHTML = lay;
    const inp = this.layer.querySelector('.mw-name');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inp.value.trim()) {
          const b = this.blocks[this.level - 1][this.naming];
          this.api.createDoc?.(inp.value.trim(), this.text(b), { announce: true });
          this.naming = -1; this.schedule(); this.view.focus();
        } else if (e.key === 'Escape') { e.stopPropagation(); this.naming = -1; this.schedule(); this.view.focus(); }
      });
      inp.addEventListener('blur', () => { if (this.naming >= 0) { this.naming = -1; this.schedule(); } });
    }
  }
  range(b) { const d = this.view.state.doc; return { from: d.line(b.from).from, to: d.line(b.to).to }; }
  text(b) { const r = this.range(b); return this.view.state.sliceDoc(r.from, r.to); }
  unfoldIn(from, to) {
    const effects = [];
    foldedRanges(this.view.state).between(from, to + 1, (f, t) => { effects.push(unfoldEffect.of({ from: f, to: t })); });
    return effects;
  }
  foldOne(b, effects) {
    const d = this.view.state.doc, r = this.range(b);
    if (b.to - b.from + 1 <= this.keep) return;
    effects.push(foldEffect.of({ from: d.line(b.from + this.keep - 1).to, to: r.to }));
  }
  async act(name, i) {
    const v = this.view, L = this.blocks[this.level - 1], b = L[i]; if (!b) return;
    const r = this.range(b);
    if (name === 'copy') { await navigator.clipboard.writeText(this.text(b)); this.api.toast?.('Bloque copiado'); }
    else if (name === 'paste') {
      let t = ''; try { t = await navigator.clipboard.readText(); } catch { this.api.toast?.('El navegador no deja leer el portapapeles'); return; }
      v.dispatch({ changes: { from: r.from, to: r.to, insert: t.replace(/\r\n/g, '\n') }, userEvent: 'input.paste' });
    } else if (name === 'note') { this.naming = i; this.schedule(); }
    else if (name === 'fold') {
      const eff = this.unfoldIn(r.from, r.to);
      if (!eff.length) this.foldOne(b, eff);
      if (eff.length) v.dispatch({ effects: eff });
    }
  }

  // ---- dragging a block by its grip, and moving blocks with an animation that keeps the eye on them ----------------
  startDrag(e, i) {
    const m = this.last; if (!m || !this.level) return;
    const L = m.levels[this.level - 1], b = L[i]; if (!b) return;
    const sd = this.view.scrollDOM;
    const ghost = document.createElement('div'); ghost.className = 'mw-ghost';
    ghost.style.cssText = `top:${b.top - 4}px;left:36px;right:220px`;
    for (let n = b.from; n <= b.to; n++) { const el = this.lineEl(n); if (el) ghost.append(el.cloneNode(true)); }
    const hole = document.createElement('div'); hole.className = 'mw-hole';
    hole.style.cssText = `top:${b.top - 2}px;height:${b.bot - b.top + 4}px`;
    const mark = document.createElement('div'); mark.className = 'mw-drop';
    this.layer.append(hole, ghost, mark);
    this.layer.classList.add('dragging');
    const docY = (cy) => cy - sd.getBoundingClientRect().top + sd.scrollTop;
    const y0 = docY(e.clientY);
    let target = i, scrollV = 0, lastY = e.clientY;
    const place = () => {
      const y = docY(lastY);
      ghost.style.transform = `translateY(${y - y0}px)`;
      target = L.length;
      for (let k = 0; k < L.length; k++) if (y < (L[k].top + L[k].bot) / 2) { target = k; break; }
      const my = target === 0 ? L[0].top - 6 : target === L.length ? L[L.length - 1].bot + 6 : (L[target - 1].bot + L[target].top) / 2;
      mark.style.top = Math.round(my) + 'px';
      mark.style.display = target === i || target === i + 1 ? 'none' : 'block';
    };
    const tick = () => { if (!this.drag) return; if (scrollV) { sd.scrollTop += scrollV; place(); } requestAnimationFrame(tick); };
    const move = (ev) => {
      lastY = ev.clientY;
      const r = sd.getBoundingClientRect();
      scrollV = ev.clientY < r.top + 40 ? -12 : ev.clientY > r.bottom - 40 ? 12 : 0;
      place();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      this.drag = null; ghost.remove(); hole.remove(); mark.remove(); this.layer.classList.remove('dragging');
      if (target !== i && target !== i + 1) {
        const order = L.map((_, k) => k).filter((k) => k !== i);
        order.splice(target > i ? target - 1 : target, 0, i);
        this.reorder(order, i);
      } else this.schedule();
    };
    this.drag = { i };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    place(); tick();
  }
  lineEl(n) {
    const v = this.view, pos = v.state.doc.line(n).from;
    if (pos < v.viewport.from || pos > v.viewport.to) return null;
    const { node } = v.domAtPos(pos);
    return (node.nodeType === 1 ? node : node.parentElement)?.closest('.cm-line') || null;
  }
  // order[p] = which old block goes to place p. The gaps between blocks (blank lines, rules) stay where they are.
  reorder(order, moved) {
    const v = this.view, lv = this.level, L0 = this.blocks[lv - 1];
    const R0 = L0.map((b) => this.range(b));
    v.dispatch({ effects: this.unfoldIn(R0[0].from, R0[R0.length - 1].to) });
    const L = this.blocks[lv - 1], R = L.map((b) => this.range(b));
    const tops = L.map((b) => { const t = []; for (let n = b.from; n <= b.to; n++) t.push(this.lineEl(n)?.getBoundingClientRect().top ?? null); return t; });
    const texts = R.map((r) => v.state.sliceDoc(r.from, r.to));
    let ins = '';
    order.forEach((k, p) => { ins += texts[k]; if (p < order.length - 1) ins += v.state.sliceDoc(R[p].to, R[p + 1].from); });
    v.dispatch({ changes: { from: R[0].from, to: R[R.length - 1].to, insert: ins }, userEvent: 'move.block' });
    const NL = this.blocks[lv - 1], pos = order.indexOf(moved);
    if (NL[pos]) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(NL[pos].from).from, { y: 'nearest', yMargin: 60 }) });
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    order.forEach((k, p) => {
      const b = NL[p]; if (!b) return;
      for (let n = b.from; n <= b.to; n++) {
        const el = this.lineEl(n); if (!el) continue;
        const old = tops[k][n - b.from];
        const frames = [];
        if (old != null) { const d = old - el.getBoundingClientRect().top; if (Math.abs(d) > 1) frames.push({ transform: `translateY(${d}px)` }, { transform: 'translateY(0)' }); }
        if (frames.length) el.animate(frames, { duration: 380, easing: ease });
        if (k === moved) el.animate([{ backgroundColor: 'rgba(113,75,103,.18)' }, { backgroundColor: 'rgba(113,75,103,0)' }], { duration: 1200, easing: 'ease-out' });
      }
    });
  }
  foldAll(fold) {
    if (!this.level) return;
    const effects = [];
    for (const b of this.blocks[this.level - 1]) {
      const r = this.range(b); effects.push(...this.unfoldIn(r.from, r.to));
    }
    if (effects.length) this.view.dispatch({ effects });
    if (fold) { const e2 = []; for (const b of this.blocks[this.level - 1]) this.foldOne(b, e2); if (e2.length) this.view.dispatch({ effects: e2 }); }
  }
  destroy() {
    this.folds.remove(); this.allBtn.remove(); this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.api.onOutline?.([], -1);
    this.layer.remove(); this.view.dom.parentNode?.classList.remove('mw-active'); }
}

// ---- the editor ----------------------------------------------------------------------------------------------------
export function createEditor(parent, api) {
  const rich = new Compartment();
  let blocksPlugin = null;

  const completions = (ctx) => {
    const m = ctx.matchBefore(/\[[^\[\]\n*]*$/); if (!m) return null;
    const line = ctx.state.doc.lineAt(m.from);
    const rest = line.text.slice(ctx.pos - line.from);
    if (/^[^\[\]\n]*\*\d*\]/.test(rest)) return null;          // editing the label of a link that exists
    const q = m.text.slice(1), ql = q.trim().toLowerCase();
    const end = rest[0] === ']' ? ctx.pos + 1 : ctx.pos;
    const atStart = /^\s*$/.test(line.text.slice(0, m.from - line.from));
    const opts = [];
    if (atStart) {
      const tags = api.getTags?.() || [];
      for (const t of tags.filter((t) => t.toLowerCase().includes(ql)).slice(0, 8)) {
        opts.push({ label: m.text + ' ', displayLabel: t, detail: 'etiqueta', type: 'tag', boost: 2,
          apply: (view) => view.dispatch({ changes: { from: m.from, to: end, insert: `[${t}] ` }, selection: { anchor: m.from + t.length + 3 } }) });
      }
      if (ql && !tags.some((t) => t.toLowerCase() === ql)) {
        opts.push({ label: m.text + '  ', displayLabel: `Nueva etiqueta «${q.trim()}»`, type: 'tag', boost: 1,
          apply: (view) => view.dispatch({ changes: { from: m.from, to: end, insert: `[${q.trim()}] ` }, selection: { anchor: m.from + q.trim().length + 3 } }) });
      }
    }
    const docs = (api.getDocs?.() || []).filter((d) => d.name.toLowerCase().includes(ql)).slice(0, 12);
    for (const d of docs) {
      opts.push({ label: m.text + '​' + d.n, displayLabel: `${d.icon || '📄'} ${d.name}`, detail: 'documento', type: 'doc',
        apply: (view) => view.dispatch({ changes: { from: m.from, to: end, insert: `[${d.name}*${d.n}]` },
          selection: { anchor: m.from + 1, head: m.from + 1 + d.name.length }, userEvent: 'input.complete' }) });
    }
    const items = (api.getItems?.() || []).filter((it) => it.text.toLowerCase().includes(ql)).slice(0, 8);
    for (const it of items) {
      opts.push({ label: m.text + '​' + it.kind + it.n, displayLabel: `${it.kind === 'idea' ? '💡' : it.done ? '☑' : '☐'} ${it.text}`, detail: it.kind, type: it.kind,
        apply: (view) => { const ins = `{${it.kind} ${it.n}}`; view.dispatch({ changes: { from: m.from, to: end, insert: ins }, selection: { anchor: m.from + ins.length } }); } });
    }
    if (ql) for (const kind of ['tarea', 'idea']) {
      opts.push({ label: m.text + '​+' + kind, displayLabel: `＋ Nueva ${kind} «${q.trim()}»`, type: 'new',
        apply: (view) => {
          const n = api.createItem?.(kind, q.trim()); if (!n) return;
          const ins = `{${kind} ${n}}`;
          view.dispatch({ changes: { from: m.from, to: end, insert: ins }, selection: { anchor: m.from + ins.length } });
        } });
    }
    if (ql && !docs.some((d) => d.name.toLowerCase() === ql)) {
      opts.push({ label: m.text + '​+', displayLabel: `＋ Nuevo documento «${q.trim()}»`, type: 'new',
        apply: (view) => {
          const n = api.createDoc?.(q.trim(), '', { announce: true }); if (!n) return;
          const ins = `[${q.trim()}*${n}]`;
          view.dispatch({ changes: { from: m.from, to: end, insert: ins }, selection: { anchor: m.from + ins.length } });
        } });
    }
    return opts.length ? { from: m.from, to: end, options: opts, filter: false } : null;
  };

  const autoCreate = EditorView.updateListener.of((u) => {
    if (!u.docChanged || !u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('paste'))) return;
    const doc = u.state.doc, lines = new Set();
    u.changes.iterChangedRanges((fa, ta, fb, tb) => {
      for (let l = doc.lineAt(fb).number; l <= doc.lineAt(tb).number; l++) lines.add(l);
    });
    const changes = [];
    for (const l of lines) {
      const line = doc.line(l); NEW_RE.lastIndex = 0; let m;
      while ((m = NEW_RE.exec(line.text))) {
        const n = api.createDoc?.(m[1].trim(), '', { announce: true });
        if (n) changes.push({ from: line.from + m.index + m[0].length - 1, insert: String(n) });
      }
    }
    if (changes.length) setTimeout(() => { if (u.view.state.doc === doc) u.view.dispatch({ changes, userEvent: 'meadow.link' }); }, 0);
  });

  const linkClicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      const h = e.target.closest?.('.cm-hmark');
      if (h) { e.preventDefault(); const d = +h.dataset.d; blocksPlugin?.setLevel(blocksPlugin.level === d ? 0 : d); return true; }
      const el = e.target.closest?.('.cm-link, .cm-linkref'); if (!el) return false;
      if (e.ctrlKey || e.metaKey || el.classList.contains('cm-linkref')) {
        e.preventDefault();
        try { view.dispatch({ selection: { anchor: view.posAtDOM(el) } }); } catch { /* keep the caret */ }   // the trail remembers this link
        api.openDoc?.(+el.dataset.n); return true;
      }
      return false;
    },
  });

  // Enter while naming a link ([label|*N]) accepts the name and jumps past the «]» instead of breaking the line.
  const linkEnter = Prec.high(keymap.of([{ key: 'Enter', run: (view) => {
    const sel = view.state.selection.main, line = view.state.doc.lineAt(sel.head);
    const before = line.text.slice(0, sel.from - line.from), after = line.text.slice(sel.to - line.from);
    const m = after.match(/^[^\[\]\n]*\*\d+\]/);
    if (!m || !/\[[^\[\]\n]*$/.test(before)) return false;
    view.dispatch({ selection: { anchor: sel.to + m[0].length } });
    return true;
  } }]));

  const blocks = ViewPlugin.define((v) => (blocksPlugin = new Blocks(v, api)));

  const chips = chipsPlugin(api);
  const richExt = () => [richDecos, chips, autoCreate, linkClicks, linkEnter, blocks,
    autocompletion({ override: [completions], icons: false, activateOnTyping: true, closeOnBlur: true })];

  const changes = EditorView.updateListener.of((u) => { if (u.docChanged) api.onChange?.(u.state.doc.toString()); });

  let plain = false;
  const makeState = (text) => EditorState.create({
    doc: text,
    extensions: [history(), drawSelection(), EditorView.lineWrapping, codeFolding({
      // a quiet label set apart from the title: how many lines are folded; a click unfolds
      preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
      placeholderDOM: (view, onclick, n) => { const s = document.createElement('span'); s.className = 'mw-fph'; s.textContent = n + (n === 1 ? ' línea' : ' líneas'); s.title = 'Desplegar'; s.onclick = onclick; return s; },
    }),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]), changes, rich.of(plain ? [] : richExt())],
  });

  const view = new EditorView({ state: makeState(''), parent });
  parent.classList.add('mw-rich');

  return {
    view,
    setDoc(text) { blocksPlugin = null; view.setState(makeState(text)); parent.classList.toggle('mw-rich', !plain); parent.classList.remove('mw-active'); api.onLevel?.(0); },
    replaceText(text) {
      if (text === view.state.doc.toString()) return;
      const sel = view.state.selection.main.head;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: Math.min(sel, text.length) }, userEvent: 'meadow.sync' });
    },
    getText: () => view.state.doc.toString(),
    setPlain(p) {
      plain = p;
      const eff = []; foldedRanges(view.state).between(0, view.state.doc.length, (f, t) => { eff.push(unfoldEffect.of({ from: f, to: t })); });
      if (eff.length) view.dispatch({ effects: eff });
      if (p) blocksPlugin = null;
      view.dispatch({ effects: rich.reconfigure(p ? [] : richExt()) });
      parent.classList.toggle('mw-rich', !p);
      if (p) { parent.classList.remove('mw-active'); api.onLevel?.(0); }
    },
    setLevel(l) { blocksPlugin?.setLevel(l); },
    setKeep(k) { if (blocksPlugin) { blocksPlugin.keep = k; } },
    foldAll(f) { blocksPlugin?.foldAll(f); },
    focus() { view.focus(); },
    refresh() { view.dispatch({ effects: refreshEffect.of(null) }); },
    foldHeads(f) { blocksPlugin?.foldHeads(f); },
    gotoLine(n) {
      const line = view.state.doc.line(Math.min(n, view.state.doc.lines));
      const eff = []; foldedRanges(view.state).between(line.from, line.to, (f, t) => { eff.push(unfoldEffect.of({ from: f, to: t })); });
      view.dispatch({ selection: { anchor: line.to }, effects: [...eff, EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 30 })] });
      view.focus();
    },
  };
}
