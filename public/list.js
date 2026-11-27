// A list: many things of one kind, as rows with a few columns you choose (text, options, a tick, a date).
// Data, plain JSON an agent can write: { v: 1, cols: [{ id, name, type: 'text'|'choice'|'check'|'date', opts? }], rows: [{ id, <colId>: value }] }
// createList(container, { data, onChange }) → { destroy(), getData() } · listSummaryHTML(data) → a small preview for cards.

const uid = () => Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPES = [['text', 'Texto'], ['choice', 'Opciones'], ['check', 'Casilla'], ['date', 'Fecha']];
// a soft colour per option word, always the same for the same word
const HUES = { bien: 140, hecho: 140, ok: 140, sí: 140, mal: 4, falla: 4, no: 4, 'por ver': 265, pendiente: 265, duda: 35 };
const hueOf = (w) => { const k = String(w).toLowerCase(); if (HUES[k] != null) return HUES[k]; let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const pill = (w) => (w ? `<span class="ls-pill" style="--h:${hueOf(w)}">${esc(w)}</span>` : '<span class="ls-pill empty">—</span>');

export function blankList() {
  return { v: 1, cols: [{ id: 'c1', name: 'Nombre', type: 'text' }, { id: 'c2', name: 'Estado', type: 'choice', opts: ['Por ver', 'Bien', 'Mal'] }, { id: 'c3', name: 'Nota', type: 'text' }], rows: [] };
}
function normalise(d) {
  d = typeof d === 'string' ? JSON.parse(d) : JSON.parse(JSON.stringify(d || {}));
  if (!Array.isArray(d.cols) || !d.cols.length) d.cols = blankList().cols;
  d.cols.forEach((c, i) => { c.id ||= 'c' + (i + 1); c.type = TYPES.some((t) => t[0] === c.type) ? c.type : 'text'; if (c.type === 'choice') c.opts ||= []; });
  d.rows = (Array.isArray(d.rows) ? d.rows : []).map((r) => ({ id: r.id || uid(), ...r }));
  // an agent may write rows by column NAME: map them to ids
  for (const r of d.rows) for (const c of d.cols) if (r[c.id] == null && r[c.name] != null) { r[c.id] = r[c.name]; delete r[c.name]; }
  for (const c of d.cols) if (c.type === 'choice') for (const r of d.rows) if (r[c.id] && !c.opts.includes(r[c.id])) c.opts.push(r[c.id]);
  d.v = 1; return d;
}

export function listSummaryHTML(data) {
  const d = normalise(data), name = d.cols[0], st = d.cols.find((c) => c.type === 'choice'), ck = d.cols.find((c) => c.type === 'check');
  if (!d.rows.length) return '<span class="ls-sum-empty">Lista vacía</span>';
  const counts = st ? st.opts.map((o) => [o, d.rows.filter((r) => r[st.id] === o).length]).filter(([, n]) => n) : [];
  const done = ck ? d.rows.filter((r) => r[ck.id]).length : null;
  return `<div class="ls-sum"><div class="ls-sum-n"><b>${d.rows.length}</b> ${d.rows.length === 1 ? 'fila' : 'filas'}${done != null ? ` · ${done} ✓` : ''}</div>`
    + (counts.length ? `<div class="ls-sum-bar">${counts.map(([o, n]) => `<i style="--h:${hueOf(o)};flex:${n}" title="${esc(o)}: ${n}"></i>`).join('')}</div>` : '')
    + `<ul>${d.rows.slice(0, 7).map((r) => `<li>${st && r[st.id] ? `<i class="dot" style="--h:${hueOf(r[st.id])}"></i>` : '<i class="dot none"></i>'}${esc(r[name.id] || '…')}</li>`).join('')}</ul></div>`;
}

export function createList(container, { data, onChange = () => {} } = {}) {
  let d = normalise(data), q = '', sort = null, hist = [], fut = [], saveT = null, drag = null;
  const root = document.createElement('div'); root.className = 'ls'; container.append(root);
  const emit = () => { clearTimeout(saveT); saveT = setTimeout(() => onChange(JSON.parse(JSON.stringify(d))), 250); };
  const edit = (fn, repaint = true) => { hist.push(JSON.stringify(d)); if (hist.length > 100) hist.shift(); fut = []; fn(); emit(); if (repaint) paint(); };
  const undo = () => { if (!hist.length) return; fut.push(JSON.stringify(d)); d = JSON.parse(hist.pop()); emit(); paint(); };
  const redo = () => { if (!fut.length) return; hist.push(JSON.stringify(d)); d = JSON.parse(fut.pop()); emit(); paint(); };

  const visible = () => {
    let rows = d.rows.map((r, i) => ({ r, i }));
    const ql = q.trim().toLowerCase();
    if (ql) rows = rows.filter(({ r }) => d.cols.some((c) => String(r[c.id] ?? '').toLowerCase().includes(ql)));
    if (sort) { const c = d.cols.find((x) => x.id === sort.id); if (c) rows.sort((a, b) => { const va = a.r[c.id] ?? '', vb = b.r[c.id] ?? ''; const o = c.type === 'choice' ? c.opts.indexOf(va) - c.opts.indexOf(vb) : String(va).localeCompare(String(vb), 'es', { numeric: true }); return sort.dir * o; }); }
    return rows;
  };
  function cell(c, r) {
    const v = r[c.id];
    if (c.type === 'check') return `<td class="ls-c ck" data-c="${c.id}"><button class="ls-ck${v ? ' on' : ''}" data-tick></button></td>`;
    if (c.type === 'choice') return `<td class="ls-c ch" data-c="${c.id}"><button class="ls-pick" data-pick>${pill(v)}</button></td>`;
    if (c.type === 'date') return `<td class="ls-c dt" data-c="${c.id}"><input type="date" value="${esc(v || '')}"></td>`;
    return `<td class="ls-c tx" data-c="${c.id}"><div class="ls-tx" contenteditable="true" spellcheck="false">${esc(v || '')}</div></td>`;
  }
  function paint() {
    const rows = visible(), focus = document.activeElement?.closest?.('.ls td[data-c]'), fr = focus?.closest('tr')?.dataset.r, fc = focus?.dataset.c;
    root.innerHTML = `<div class="ls-bar"><input class="ls-q" placeholder="Buscar en la lista…" value="${esc(q)}"><span class="ls-n">${d.rows.length} ${d.rows.length === 1 ? 'fila' : 'filas'}</span></div>
      <div class="ls-wrap"><table><thead><tr><th class="ls-hd"></th>${d.cols.map((c) => `<th data-c="${c.id}" class="${sort?.id === c.id ? 'sorted' : ''}"><span class="ls-cn" contenteditable="true" spellcheck="false">${esc(c.name)}</span><button class="ls-sort" title="Ordenar">${sort?.id === c.id ? (sort.dir > 0 ? '↑' : '↓') : '↕'}</button><button class="ls-cm" title="Tipo de columna">⋯</button></th>`).join('')}<th class="ls-addc"><button title="Nueva columna">＋</button></th><th class="ls-end"></th></tr></thead>
      <tbody>${rows.map(({ r }) => `<tr data-r="${r.id}"><td class="ls-hd"><span class="ls-grip" title="Arrastra para mover">⋮⋮</span></td>${d.cols.map((c) => cell(c, r)).join('')}<td></td><td class="ls-end"><button class="ls-x" title="Borrar la fila">×</button></td></tr>`).join('')}</tbody></table>
      <button class="ls-addr">＋ Nueva fila</button>${!d.rows.length ? '<p class="ls-empty">Escribe la primera fila: Enter añade la siguiente.</p>' : ''}</div>`;
    if (fr && fc) { const el = root.querySelector(`tr[data-r="${fr}"] td[data-c="${fc}"] .ls-tx, tr[data-r="${fr}"] td[data-c="${fc}"] input`); el?.focus(); }
  }
  const rowOf = (el) => d.rows.find((r) => r.id === el.closest('tr')?.dataset.r);
  const colOf = (el) => d.cols.find((c) => c.id === el.closest('[data-c]')?.dataset.c);
  function addRow(after) {
    const r = { id: uid() }; edit(() => { const i = after ? d.rows.indexOf(after) + 1 : d.rows.length; d.rows.splice(i, 0, r); });
    root.querySelector(`tr[data-r="${r.id}"] .ls-tx`)?.focus();
  }
  function menu(anchor, items) {   // a small menu under an element
    root.querySelector('.ls-menu')?.remove();
    const m = document.createElement('div'); m.className = 'ls-menu';
    m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.on ? 'on' : ''}${it.danger ? ' danger' : ''}">${it.label}</button>`).join('');
    root.append(m); const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    m.style.left = Math.min(rr.width - 200, r.left - rr.left) + 'px'; m.style.top = r.bottom - rr.top + 4 + 'px';
    m.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; m.remove(); items[+b.dataset.i].run(); };
    setTimeout(() => addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }, true));
  }

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('.ls-q')) { q = t.value; const at = t.selectionStart; paint(); const n = root.querySelector('.ls-q'); n.focus(); n.setSelectionRange(at, at); return; }
    if (t.matches('.ls-tx')) { const r = rowOf(t), c = colOf(t); hist.push(JSON.stringify(d)); r[c.id] = t.innerText.replace(/\n$/, ''); emit(); return; }
    if (t.matches('.ls-cn')) { const c = colOf(t); c.name = t.innerText.trim() || c.name; emit(); return; }
    if (t.matches('input[type=date]')) edit(() => { rowOf(t)[colOf(t).id] = t.value; }, false);
  });
  root.addEventListener('keydown', (e) => {
    const t = e.target, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !t.matches('.ls-q')) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (t.matches('.ls-tx') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return addRow(rowOf(t)); }
    if (t.matches('.ls-tx') && e.key === 'Backspace' && !t.innerText && d.cols[0].id === colOf(t).id && d.cols.every((c) => !rowOf(t)[c.id])) {
      e.preventDefault(); const r = rowOf(t), i = d.rows.indexOf(r); edit(() => d.rows.splice(i, 1)); root.querySelectorAll('tbody .ls-tx')[Math.max(0, i - 1)]?.focus(); return;
    }
    if (t.matches('.ls-cn') && e.key === 'Enter') { e.preventDefault(); t.blur(); }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && t.matches('.ls-tx')) {
      const td = t.closest('td'), tr = td.closest('tr'), next = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      const el = next?.querySelector(`td[data-c="${td.dataset.c}"] .ls-tx`); if (el) { e.preventDefault(); el.focus(); }
    }
    if (e.key === 'Escape' && t.closest('.ls')) { t.blur?.(); e.stopPropagation(); }
  });
  root.addEventListener('paste', (e) => { if (!e.target.matches('.ls-tx, .ls-cn')) return; e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\r?\n/g, ' ')); });
  root.addEventListener('focusout', (e) => { if (e.target.matches('.ls-tx, .ls-cn')) paintLater(); });
  let pT = null; const paintLater = () => { clearTimeout(pT); pT = setTimeout(() => { if (!root.contains(document.activeElement) || !document.activeElement.matches('.ls-tx, .ls-cn, input')) paint(); }, 120); };
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('.ls-addr')) return addRow(null);
    if (t.closest('.ls-x')) { const r = rowOf(t); return edit(() => d.rows.splice(d.rows.indexOf(r), 1)); }
    if (t.closest('[data-tick]')) { const r = rowOf(t), c = colOf(t); return edit(() => { r[c.id] = !r[c.id]; }); }
    if (t.closest('[data-pick]')) {
      const r = rowOf(t), c = colOf(t), b = t.closest('[data-pick]');
      return menu(b, [...c.opts.map((o) => ({ label: pill(o), on: r[c.id] === o, run: () => edit(() => { r[c.id] = o; }) })), { label: pill(''), run: () => edit(() => { delete r[c.id]; }) }, '-',
        { label: '＋ Nueva opción…', run: () => { const v = prompt('Nueva opción'); if (v?.trim()) edit(() => { c.opts.push(v.trim()); r[c.id] = v.trim(); }); } }]);
    }
    if (t.closest('.ls-sort')) { const c = colOf(t); sort = sort?.id === c.id ? (sort.dir > 0 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 }; return paint(); }
    if (t.closest('.ls-cm')) {
      const c = colOf(t), b = t.closest('.ls-cm');
      return menu(b, [...TYPES.map(([k, l]) => ({ label: l, on: c.type === k, run: () => edit(() => { c.type = k; if (k === 'choice') { c.opts ||= []; for (const r of d.rows) if (r[c.id] && typeof r[c.id] === 'string' && !c.opts.includes(r[c.id])) c.opts.push(r[c.id]); } }) })), '-',
        { label: 'Mover a la izquierda', run: () => edit(() => { const i = d.cols.indexOf(c); if (i > 0) d.cols.splice(i - 1, 0, d.cols.splice(i, 1)[0]); }) },
        { label: 'Mover a la derecha', run: () => edit(() => { const i = d.cols.indexOf(c); if (i < d.cols.length - 1) d.cols.splice(i + 1, 0, d.cols.splice(i, 1)[0]); }) },
        ...(d.cols.length > 1 ? [{ label: 'Borrar la columna', danger: true, run: () => edit(() => { d.cols.splice(d.cols.indexOf(c), 1); for (const r of d.rows) delete r[c.id]; }) }] : [])]);
    }
    if (t.closest('.ls-addc button')) { const id = 'c' + uid(); edit(() => d.cols.push({ id, name: 'Columna', type: 'text' })); const el = root.querySelector(`th[data-c="${id}"] .ls-cn`); el?.focus(); document.getSelection().selectAllChildren(el); }
  });
  // rows move by their grip
  root.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.ls-grip'); if (!g) return; e.preventDefault();
    const tr = g.closest('tr'); drag = { id: tr.dataset.r }; tr.classList.add('lifted');
    const mv = (ev) => { for (const x of root.querySelectorAll('tbody tr')) { const r = x.getBoundingClientRect(); x.classList.toggle('drop-a', ev.clientY > r.top && ev.clientY < r.top + r.height / 2 && x.dataset.r !== drag.id); x.classList.toggle('drop-b', ev.clientY >= r.top + r.height / 2 && ev.clientY < r.bottom && x.dataset.r !== drag.id); } };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const over = root.querySelector('tr.drop-a, tr.drop-b'); tr.classList.remove('lifted');
      if (over && !q && !sort) { const after = over.classList.contains('drop-b'); edit(() => { const r = d.rows.find((x) => x.id === drag.id); d.rows.splice(d.rows.indexOf(r), 1); const j = d.rows.findIndex((x) => x.id === over.dataset.r); d.rows.splice(after ? j + 1 : j, 0, r); }); }
      else for (const x of root.querySelectorAll('tbody tr')) x.classList.remove('drop-a', 'drop-b');
      drag = null;
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  paint();
  if (!d.rows.length) setTimeout(() => addRow(null), 0);
  return { destroy() { clearTimeout(saveT); onChange(JSON.parse(JSON.stringify(d))); root.remove(); }, getData: () => JSON.parse(JSON.stringify(d)) };
}
