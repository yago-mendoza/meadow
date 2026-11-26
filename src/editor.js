// Meadow's text editor: a plain, Notepad-like CodeMirror with a few readings on top (links between documents, tags,
// rules, post-it lines, coloured brackets) and three block columns on the right. Everything on top can be switched
// off with setPlain(true), which leaves the bare text.
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { codeFolding, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';

export const LINK_RE = /\[([^\[\]\n]*?)\*(\d+)\]/g;          // [label*N]: a link to document N
const NEW_RE = /\[([^\[\]\n*]*\S[^\[\]\n*]*)\*\]/g;           // [label*]: a new document to create
export const TAG_RE = /^(\s*)\[([^\[\]\n*]+)\]/;                // [TAG] at the start of a line
const RULE_RE = /^\s*-{3,}\s*$/;                                // ------ a section rule
const POSTIT_RE = /^(\s*)>(?!>)\s?/;                            // > a small note

export function hue(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }

class PostitWidget extends WidgetType {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-postit-ico'; s.textContent = '🗒️'; return s; }
  eq() { return true; }
}

const mk = (cls) => Decoration.mark({ class: cls });
const M = { brk: mk('cm-brk'), par: mk('cm-par'), arrow: mk('cm-arrow'), colons: mk('cm-colons'), linkb: mk('cm-linkb'), tag: mk('cm-tag') };
const RULE_LINE = Decoration.line({ class: 'cm-rule' });
const POSTIT_LINE = Decoration.line({ class: 'cm-postit' });
const POSTIT_ICO = Decoration.replace({ widget: new PostitWidget() });

function decorateLine(line, out) {
  const t = line.text, base = line.from;
  if (RULE_RE.test(t)) { out.push(RULE_LINE.range(base)); return; }
  let skip = 0;
  const tm = t.match(TAG_RE);
  if (tm) {
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
    out.push(Decoration.mark({ class: 'cm-linkref', attributes: { 'data-n': m[2], title: 'Abrir' } }).range(star, b - 1));
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

// ---- the three block columns ---------------------------------------------------------------------------------------
// level 1: paragraphs (split by one blank line) · level 2: groups (split by two blank lines) · level 3: sections (------)
export function computeBlocks(doc) {
  const n = doc.lines, kind = [];
  for (let i = 1; i <= n; i++) { const t = doc.line(i).text; kind[i] = RULE_RE.test(t) ? 'r' : t.trim() === '' ? 'b' : 't'; }
  const L1 = [];
  for (let i = 1; i <= n;) {
    if (kind[i] !== 't') { i++; continue; }
    let j = i; while (j + 1 <= n && kind[j + 1] === 't') j++;
    L1.push({ from: i, to: j }); i = j + 1;
  }
  const group = (split) => {
    const out = []; let cur = null;
    for (const p of L1) {
      if (!cur) { cur = { ...p }; continue; }
      let blanks = 0, rule = false;
      for (let k = cur.to + 1; k < p.from; k++) kind[k] === 'r' ? (rule = true) : blanks++;
      if (split(blanks, rule)) { out.push(cur); cur = { ...p }; } else cur.to = p.to;
    }
    if (cur) out.push(cur);
    return out;
  };
  return [L1, group((b, r) => r || b >= 2), group((b, r) => r)];
}

const COL_X = [58, 34, 10];                       // right offset of each level's column
const LEVEL_NAME = ['Párrafos', 'Grupos', 'Secciones'];

class Blocks {
  constructor(view, api) {
    this.view = view; this.api = api; this.level = 0; this.keep = 2; this.naming = -1;
    this.layer = document.createElement('div'); this.layer.className = 'mw-layer';
    this.cols = document.createElement('div'); this.cols.className = 'mw-cols';
    view.scrollDOM.append(this.layer, this.cols);
    this.blocks = computeBlocks(view.state.doc);
    this.cols.addEventListener('mousedown', (e) => {
      const c = e.target.closest('.mw-col'); if (!c) return;
      e.preventDefault(); this.setLevel(this.level === +c.dataset.l ? 0 : +c.dataset.l);
    });
    this.layer.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    this.layer.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      this.act(b.dataset.act, +b.closest('.mw-bar-tools').dataset.i);
    });
    this.schedule();
  }
  setLevel(l) {
    this.level = l; this.naming = -1;
    this.view.dom.classList.toggle('mw-active', l > 0);
    this.api.onLevel?.(l);
    this.schedule();
  }
  update(u) {
    if (u.docChanged) { this.blocks = computeBlocks(u.state.doc); }
    if (u.docChanged || u.geometryChanged || u.viewportChanged || u.heightChanged || u.transactions.some((t) => t.effects.length)) this.schedule();
  }
  schedule() { this.view.requestMeasure({ key: this, read: (v) => this.read(v), write: (m) => this.write(m) }); }
  read(v) {
    const doc = v.state.doc, sr = v.scrollDOM.getBoundingClientRect();
    const off = v.documentTop - sr.top + v.scrollDOM.scrollTop;
    const folded = foldedRanges(v.state);
    const geo = (b) => {
      const from = doc.line(b.from).from, to = doc.line(b.to).to;
      let f = false; folded.between(from, to + 1, () => { f = true; return false; });
      return { ...b, top: v.lineBlockAt(from).top + off, bot: v.lineBlockAt(doc.line(b.to).from).bottom + off, folded: f };
    };
    return { levels: this.blocks.map((L) => L.map(geo)), h: Math.max(v.contentHeight, v.scrollDOM.clientHeight) };
  }
  write(m) {
    this.cols.style.height = m.h + 'px'; this.layer.style.height = m.h + 'px';
    let html = '';
    m.levels.forEach((L, li) => {
      html += `<div class="mw-col${this.level === li + 1 ? ' on' : ''}" data-l="${li + 1}" style="right:${COL_X[li]}px" title="${LEVEL_NAME[li]}">`;
      for (const b of L) html += `<i style="top:${b.top + 3}px;height:${Math.max(4, b.bot - b.top - 6)}px"></i>`;
      html += '</div>';
    });
    this.cols.innerHTML = html;
    if (!this.level) { this.layer.innerHTML = ''; return; }
    const L = m.levels[this.level - 1];
    let lay = '';
    L.forEach((b, i) => {
      if (i > 0) lay += `<div class="mw-sep" style="top:${Math.round((L[i - 1].bot + b.top) / 2)}px"></div>`;
      if (this.naming === i) {
        lay += `<div class="mw-bar-tools naming" data-i="${i}" style="top:${b.top}px"><input class="mw-name" placeholder="Nombre del documento…"></div>`;
      } else {
        lay += `<div class="mw-bar-tools" data-i="${i}" style="top:${b.top}px">
          <button data-act="copy" title="Copiar el bloque">⧉</button>
          <button data-act="paste" title="Pegar encima (reemplaza el bloque)">⎘</button>
          <button data-act="note" title="Guardar como documento">📄</button>
          <button data-act="fold" title="${b.folded ? 'Expandir' : 'Plegar'}">${b.folded ? '▸' : '▾'}</button>
          <button data-act="up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-act="down" title="Bajar" ${i === L.length - 1 ? 'disabled' : ''}>↓</button></div>`;
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
    } else if (name === 'up' || name === 'down') {
      const j = name === 'up' ? i - 1 : i + 1; if (j < 0 || j >= L.length) return;
      const [A, B] = j < i ? [L[j], b] : [b, L[j]];
      const ra = this.range(A), rb = this.range(B);
      const ta = v.state.sliceDoc(ra.from, ra.to), tb = v.state.sliceDoc(rb.from, rb.to), gap = v.state.sliceDoc(ra.to, rb.from);
      v.dispatch({ effects: this.unfoldIn(ra.from, rb.to) });
      v.dispatch({ changes: { from: ra.from, to: rb.to, insert: tb + gap + ta }, userEvent: 'move.block' });
    }
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
  destroy() { this.layer.remove(); this.cols.remove(); this.view.dom.classList.remove('mw-active'); }
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
      opts.push({ label: m.text + '​' + d.n, displayLabel: `${d.icon || '📄'} ${d.name}`, detail: `*${d.n}`, type: 'doc',
        apply: (view) => view.dispatch({ changes: { from: m.from, to: end, insert: `[${d.name}*${d.n}]` },
          selection: { anchor: m.from + 1, head: m.from + 1 + d.name.length }, userEvent: 'input.complete' }) });
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
    mousedown(e) {
      const el = e.target.closest?.('.cm-link, .cm-linkref'); if (!el) return false;
      if (e.ctrlKey || e.metaKey || el.classList.contains('cm-linkref')) { e.preventDefault(); api.openDoc?.(+el.dataset.n); return true; }
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

  const richExt = () => [richDecos, autoCreate, linkClicks, linkEnter, blocks,
    autocompletion({ override: [completions], icons: false, activateOnTyping: true, closeOnBlur: true })];

  const changes = EditorView.updateListener.of((u) => { if (u.docChanged) api.onChange?.(u.state.doc.toString()); });

  let plain = false;
  const makeState = (text) => EditorState.create({
    doc: text,
    extensions: [history(), drawSelection(), EditorView.lineWrapping, codeFolding({ placeholderText: '⋯' }),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]), changes, rich.of(plain ? [] : richExt())],
  });

  const view = new EditorView({ state: makeState(''), parent });
  view.dom.classList.add('mw-rich');

  return {
    view,
    setDoc(text) { blocksPlugin = null; view.setState(makeState(text)); view.dom.classList.toggle('mw-rich', !plain); view.dom.classList.remove('mw-active'); api.onLevel?.(0); },
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
      view.dom.classList.toggle('mw-rich', !p);
      if (p) { view.dom.classList.remove('mw-active'); api.onLevel?.(0); }
    },
    setLevel(l) { blocksPlugin?.setLevel(l); },
    setKeep(k) { if (blocksPlugin) { blocksPlugin.keep = k; } },
    foldAll(f) { blocksPlugin?.foldAll(f); },
    focus() { view.focus(); },
  };
}
