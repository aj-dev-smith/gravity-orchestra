/* ============================================================
   MAP PANEL — the instrument-mapping UI (creation mode 1). One row per
   source track: its name, what it is (GM program / belt role), how many
   notes, a tiny piano-roll sparkline, and WHO PLAYS IT — a dropdown of
   every machine in the room. Change one → onPick(id, target); the host
   re-solves the room. DOM only; the decisions live in mapping.js.
   ============================================================ */
import { targetsFor, machineOf, isLead, LEAD, BELT, DRUMS, OFF } from './mapping.js';

const BELT_COL = { [LEAD]: '#ffb764', [BELT]: '#c08bff', [DRUMS]: '#ff8a3d', [OFF]: '#3a4158' };

export function makeMapPanel({ machines, onPick, onAuto, onClose }){
  const colorOf = t => BELT_COL[t] || machines.find(m => m.key === machineOf(t))?.color || '#cfd6e6';
  const el = document.createElement('div'); el.className = 'map-panel'; el.hidden = true;
  el.innerHTML = `<header><b>INSTRUMENT MAP</b><button class="x" title="close (Esc)" aria-label="close">×</button></header>
    <p class="mp-song"></p><p class="mp-lede">who plays what — change one and the whole room re-solves</p>
    <div class="mp-rows"></div>
    <footer><span class="mp-status"></span><button class="mp-auto" title="back to the importer's own routing">AUTO</button></footer>
    <details class="mp-notes"><summary></summary><ul></ul></details>`;
  document.body.appendChild(el);
  const rowsEl = el.querySelector('.mp-rows'), statusEl = el.querySelector('.mp-status'), notesEl = el.querySelector('.mp-notes');
  el.querySelector('.x').addEventListener('click', () => onClose());
  el.querySelector('.mp-auto').addEventListener('click', () => onAuto());
  let cur = null;

  function render({ title, sources, mapping, authored, custom, warnings = [], status = '', busy = false }){
    cur = { sources, mapping };
    el.querySelector('.mp-song').textContent = title;
    el.querySelector('.mp-auto').disabled = !custom || busy;
    el.classList.toggle('busy', busy);
    rowsEl.textContent = '';
    for (const s of sources){
      const t = mapping[s.id] ?? OFF;
      const row = document.createElement('div'); row.className = 'mp-row' + (t === OFF ? ' off' : '');
      row.style.setProperty('--c', colorOf(t));
      const info = document.createElement('div'); info.className = 'mp-info';
      const nm = document.createElement('span'); nm.className = 'mp-name'; nm.textContent = s.name; nm.title = s.name;
      const meta = document.createElement('span'); meta.className = 'mp-meta'; meta.textContent = `${s.gm} · ${s.count} note${s.count === 1 ? '' : 's'}`;
      info.append(nm, meta);
      const cv = document.createElement('canvas'); cv.className = 'mp-spark'; cv.width = 192; cv.height = 52;
      spark(cv, s, colorOf(t), t === OFF);
      const selEl = document.createElement('select'); selEl.disabled = busy; selEl.setAttribute('aria-label', `who plays ${s.name}`);
      for (const g of targetsFor(s, machines, { authored })){
        const parent = g.group ? Object.assign(document.createElement('optgroup'), { label: g.group }) : selEl;
        for (const o of g.options) parent.appendChild(Object.assign(document.createElement('option'), { value: o.value, textContent: o.label }));
        if (parent !== selEl) selEl.appendChild(parent);
      }
      if (![...selEl.options].some(o => o.value === t)) selEl.appendChild(Object.assign(document.createElement('option'), { value: t, textContent: t }));
      selEl.value = t;
      selEl.addEventListener('change', () => onPick(s.id, selEl.value));
      row.append(info, cv, selEl);
      rowsEl.appendChild(row);
    }
    statusEl.textContent = busy ? 're-solving the room…' : status;
    statusEl.classList.toggle('warn', /needs|room for|can't|couldn/.test(status));
    notesEl.hidden = !warnings.length;
    notesEl.querySelector('summary').textContent = `${warnings.length} fitting note${warnings.length === 1 ? '' : 's'} — how each machine was made to fit`;
    const ul = notesEl.querySelector('ul'); ul.textContent = '';
    for (const w of warnings.slice(0, 80)) ul.appendChild(Object.assign(document.createElement('li'), { textContent: w }));
  }
  return {
    el, render,
    show(v){ el.hidden = !v; },
    get open(){ return !el.hidden; },
    get mapping(){ return cur?.mapping; },
  };
}

/* the piano-roll sparkline: time → x across the source's span, pitch → y (drums: lanes) */
function spark(cv, s, color, dim){
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, ev = s.events;
  x.clearRect(0, 0, W, H);
  if (!ev.length) return;
  let b0 = Infinity, b1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const e of ev){ b0 = Math.min(b0, e.beat); b1 = Math.max(b1, e.beat + (e.dur || 0)); lo = Math.min(lo, e.midi); hi = Math.max(hi, e.midi); }
  const span = Math.max(1, b1 - b0), rng = Math.max(4, hi - lo), pad = 4;
  x.fillStyle = 'rgba(90,97,120,.14)'; x.fillRect(0, 0, W, H);
  x.globalAlpha = dim ? .35 : 1;
  x.fillStyle = color;
  for (const e of ev){
    const px = pad + (e.beat - b0) / span * (W - 2 * pad);
    const py = H - pad - (e.midi - lo) / rng * (H - 2 * pad);
    const w = Math.max(2, (e.dur || .25) / span * (W - 2 * pad));
    x.globalAlpha = (dim ? .35 : 1) * (.45 + .55 * Math.min(1, e.vel ?? 1));
    x.fillRect(px, py - 1.5, Math.min(w, 26), 3);
  }
  x.globalAlpha = 1;
}
