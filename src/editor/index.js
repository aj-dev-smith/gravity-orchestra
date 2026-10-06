/* ============================================================
   CREATION TOOLS — the glue between main.js and the two editors:
     · the INSTRUMENT MAP (mapping.js + panel.js): who plays what
     · STAGE EDIT (placement.js + stage-edit.js): where it stands
   Both are DATA over the song: a mapping turns into a song (the same
   format as every other song), a placement into a pinned slot. main asks
   this module for the effective song and each station's slot when it
   builds the world; nothing here touches a solve.

   Persistence: localStorage, per song (cascade:map:<id>, cascade:stage:<id>).
   Share links: the share payload is the EFFECTIVE song (a mapping is baked
   into it) + song.stage = the layout.
   ============================================================ */
import { makeMapPanel } from './panel.js';
import { makeStageEdit } from './stage-edit.js';
import { midiSources, defaultMidiMapping, applyMidiMapping, songSources, defaultSongMapping, applySongMapping,
         setTarget, sameMapping, loadMapping, saveMapping } from './mapping.js';
import { placeSlot, sanitizeLayout, encodeLayout, loadLayout, saveLayout } from './placement.js';

const store = (() => { try { return window.localStorage; } catch (e){ return null; } })();

/**
 * songs     the song registry (SONGS) — originals, never mutated here
 * machines  [{ key, label, color }] — the instrument plugins, in menu order
 * host      main's side of the seam:
 *   key()            the selected song key
 *   rebuild(keep)    rebuild the world for it (keep = hold songTime: a placement reset)
 *   restage()        a station moved: re-anchor the room, re-solve the director
 *   pieces()         [{ key, label, color, obj, kind: 'station'|'kit', canRotate, deckY? }]
 *   wall()           the belt's world Box3 · cx() its centre x · kitPivot() the kit's slot point (world)
 *   visBox(obj)      drawn world bounds · room {x0,x1,z0,z1} where footprints may go · roomBox eye limits
 */
export function makeEditor({ THREE, scene, cam, dom, songs, machines, host }){
  let midi = null;                                   // { parsed, label, id } — the last MIDI import
  let curKey = null, curId = null, lastWarnings = [], status = '', busy = false, panelWanted = false;
  const memo = new Map();                            // `${id}|${mapping}` → { song, warnings }
  const ignoreSongStage = new Set();                 // ids whose shipped song.stage was reset this session

  const idOf = key => key === 'imported' && midi ? midi.id : key === 'shared' ? `shared:${songs[key]?.label}` : key;
  const isMidi = key => key === 'imported' && !!midi;
  const labels = Object.fromEntries(machines.map(m => [m.key, m.label]));

  function sources(key){ return isMidi(key) ? midiSources(midi.parsed) : songSources(songs[key], labels); }
  function defaults(key){ return isMidi(key) ? (midi.def ||= defaultMidiMapping(midi.parsed, { label: midi.label })) : defaultSongMapping(songs[key]); }
  function mappingFor(key){
    const d = defaults(key), m = loadMapping(store, idOf(key));
    if (!m) return d;
    const out = { ...d };                            // stored ids that still exist win
    for (const k of Object.keys(out)) if (k in m) out[k] = m[k];
    return out;
  }

  /** the EFFECTIVE song for a key: the original, or re-mapped (memoised) */
  function song(key){
    curKey = key; curId = idOf(key);
    const orig = songs[key];
    if (!orig) return orig;
    const m = loadMapping(store, curId);
    if (!m){ lastWarnings = isMidi(key) ? midi.warnings : []; return orig; }
    const mapping = mappingFor(key);
    if (sameMapping(mapping, defaults(key))){ lastWarnings = isMidi(key) ? midi.warnings : []; return orig; }
    const mk = `${curId}|${JSON.stringify(mapping)}`;
    if (!memo.has(mk)){
      try { memo.set(mk, isMidi(key) ? applyMidiMapping(midi.parsed, mapping, { label: midi.label }) : applySongMapping(orig, mapping)); }
      catch (e){ status = `couldn't apply the saved map: ${e.message}`; return orig; }
    }
    const r = memo.get(mk);
    lastWarnings = r.warnings;
    return r.song;
  }

  /* ---- placement ---- */
  function layout(){
    const saved = loadLayout(store, curId);
    if (Object.keys(saved).length) return saved;
    if (ignoreSongStage.has(curId)) return {};
    return sanitizeLayout(songs[curKey]?.stage);
  }
  const slot = (key, base) => base.hang ? base : placeSlot(base, layout()[key]);
  const kitSlot = base => { const p = layout().drums; return p ? { x: p.x, z: p.z, pin: true } : base; };

  /* ---- the map panel ---- */
  const panel = makeMapPanel({
    machines,
    onPick(id, target){
      const key = host.key(), src = sources(key);
      const r = setTarget(mappingFor(key), id, target, src);
      if (sameMapping(r.mapping, mappingFor(key))){ status = r.note; renderPanel(); return; }
      if (isMidi(key)){                              // try it before committing: a map that can't make a song is refused
        try { applyMidiMapping(midi.parsed, r.mapping, { label: midi.label }); }
        catch (e){ status = e.message; renderPanel(); return; }
      }
      saveMapping(store, idOf(key), r.mapping, defaults(key));
      status = r.note || `${src.find(s => s.id === id)?.name} → ${target === 'off' ? 'off' : labelOf(target)}`;
      resolve();
    },
    onAuto(){ saveMapping(store, idOf(host.key()), null); status = 'back to the importer’s routing'; resolve(); },
    onClose(){ panel.show(false); syncButtons(); },
  });
  const labelOf = t => t === 'lead' ? 'the belt lead' : t === 'belt' ? 'a harmony belt' : t.startsWith('lead+') ? `the belt lead + ${labels[t.slice(5)] || t.slice(5)}` : labels[t] || t;
  function resolve(){
    busy = true; renderPanel();
    // two frames: the "re-solving" state paints before the (synchronous) rebuild
    requestAnimationFrame(() => requestAnimationFrame(() => { try { host.rebuild(false); } finally { busy = false; renderPanel(); } }));
  }
  function renderPanel(){
    if (!panel.open) return;
    const key = host.key();
    if (!songs[key]) return;
    const m = mappingFor(key);
    panel.render({ title: `${songs[key].label}${isMidi(key) ? ' · MIDI import' : ''}`, sources: sources(key), mapping: m,
                   authored: !isMidi(key), custom: !sameMapping(m, defaults(key)), warnings: lastWarnings, status, busy });
  }
  function openPanel(v = !panel.open){ panel.show(v); status = ''; renderPanel(); syncButtons(); }

  /* ---- stage edit ---- */
  const stage = makeStageEdit({ THREE, scene, cam, dom, onChange: syncButtons, host: {
    pieces: host.pieces, wall: host.wall, cx: host.cx, kitPivot: host.kitPivot, visBox: host.visBox, room: host.room, roomBox: host.roomBox,
    place(key, entry, all){
      let L = layout();
      if (!Object.keys(L).length)                    // the first move PINS the whole room as it stands:
        for (const p of all) L[p.key] = { x: p.x - host.cx(), z: p.z, yaw: p.yaw };   // what you see is what stays
      L = { ...L, [key]: entry };
      saveLayout(store, curId, L);
      host.restage();
      stage.refresh();
    },
    resetLayout(){ saveLayout(store, curId, {}); ignoreSongStage.add(curId); host.rebuild(true); },
  } });

  /* ---- the HUD pills: MAP · EDIT (next to SHARE LINK) ---- */
  const row = document.createElement('div'); row.className = 'ed-row';
  const mapBtn = Object.assign(document.createElement('button'), { className: 'ed-pill', textContent: 'MAP', title: 'instrument map — who plays what' });
  const editBtn = Object.assign(document.createElement('button'), { className: 'ed-pill', textContent: 'EDIT STAGE', title: 'move the machines around the room (E)' });
  row.append(mapBtn, editBtn);
  const share = document.getElementById('share');
  (share?.parentNode || document.getElementById('hud') || document.body).insertBefore(row, share ? share.nextSibling : null);
  mapBtn.addEventListener('click', () => openPanel());
  editBtn.addEventListener('click', () => stage.toggle());
  function syncButtons(){ mapBtn.classList.toggle('on', panel.open); editBtn.classList.toggle('on', stage.on); }
  addEventListener('keydown', e => { if (e.key === 'Escape' && panel.open && !stage.on) openPanel(false); });
  injectStyles();

  return {
    song, slot, kitSlot,
    /** after every buildWorld: the editors re-read the room */
    built(){
      if (stage.on) stage.refresh();
      if (panelWanted && host.key() === 'imported'){ panelWanted = false; openPanel(true); } else renderPanel();
    },
    update: () => stage.update(),
    /** a MIDI import landed (main registers its default song as 'imported') */
    midiLoaded(parsed, label, warnings = []){
      const n = parsed.tracks.reduce((s, t) => s + t.notes.length, 0);
      midi = { parsed, label, id: `midi:${label}:${n}`, warnings, def: null };
      memo.clear();
      panelWanted = true;                            // opens on the import's own build (built())
    },
    /** what a share link carries for this key: the effective song + its stage */
    shareable(key){
      const S = song(key), L = layout();
      return Object.keys(L).length ? { ...S, stage: encodeLayout(L) } : S;
    },
    openMap: openPanel, toggleEdit: v => stage.toggle(v),
    get stage(){ return stage; }, get panel(){ return panel; },
    get id(){ return curId; },
  };
}

function injectStyles(){
  if (document.getElementById('editor-css')) return;
  const css = document.createElement('style'); css.id = 'editor-css';
  css.textContent = `
  .map-panel[hidden],.se-bar[hidden],.se-tags[hidden],.mp-notes[hidden]{display:none!important}
  .ed-row{display:flex;gap:8px;margin-top:8px;pointer-events:auto}
  .ed-pill{background:rgba(7,6,14,.55);border:1px solid rgba(90,97,120,.45);color:var(--dim);font:inherit;font-size:10px;letter-spacing:.18em;
    padding:5px 12px;border-radius:999px;cursor:pointer;transition:all .2s ease}
  .ed-pill:hover{color:var(--amber);border-color:rgba(255,183,100,.5)}
  .ed-pill.on{color:var(--amber);border-color:var(--amber);background:rgba(255,183,100,.08)}
  .map-panel{position:fixed;top:78px;right:16px;width:min(470px,calc(100vw - 32px));max-height:calc(100vh - 190px);overflow:auto;z-index:12;
    background:rgba(7,6,14,.88);border:1px solid rgba(90,97,120,.45);border-radius:12px;padding:14px 14px 10px;color:var(--ink);
    font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    box-shadow:0 18px 60px rgba(0,0,0,.45)}
  .map-panel header{display:flex;justify-content:space-between;align-items:center}
  .map-panel header b{font-size:11px;letter-spacing:.3em;color:var(--amber);font-weight:600}
  .map-panel .x{background:none;border:none;color:var(--dim);font:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
  .map-panel .x:hover{color:var(--ink)}
  .mp-song{margin-top:6px;letter-spacing:.12em;color:var(--ink)}
  .mp-lede{margin-top:3px;color:var(--dim);font-size:10px;letter-spacing:.06em}
  .mp-rows{margin-top:10px;display:flex;flex-direction:column;gap:6px}
  .mp-row{display:grid;grid-template-columns:minmax(0,1fr) 96px 150px;gap:10px;align-items:center;padding:7px 8px 7px 10px;border-radius:8px;
    background:rgba(90,97,120,.08);border-left:2px solid var(--c)}
  .mp-row.off{opacity:.62}
  .mp-info{display:flex;flex-direction:column;min-width:0}
  .mp-name{color:var(--ink);letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mp-meta{color:var(--dim);font-size:9.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mp-spark{width:96px;height:26px;border-radius:4px}
  .mp-row select{width:150px;background:rgba(7,6,14,.7);color:var(--c);border:1px solid rgba(90,97,120,.5);border-radius:6px;
    font:inherit;font-size:10.5px;letter-spacing:.04em;padding:5px 6px;cursor:pointer}
  .mp-row select:focus-visible{outline:none;border-color:var(--c)}
  .map-panel footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;min-height:22px}
  .mp-status{color:var(--dim);font-size:10px;letter-spacing:.05em}
  .mp-status.warn{color:#ff8a7a}
  .map-panel.busy .mp-status{color:var(--amber)}
  .mp-auto{background:none;border:1px solid rgba(90,97,120,.45);color:var(--dim);font:inherit;font-size:10px;letter-spacing:.18em;padding:4px 11px;border-radius:999px;cursor:pointer}
  .mp-auto:hover:not(:disabled){color:var(--amber);border-color:rgba(255,183,100,.5)}
  .mp-auto:disabled{opacity:.35;cursor:default}
  .mp-notes{margin-top:8px;color:var(--dim);font-size:9.5px}
  .mp-notes summary{cursor:pointer;letter-spacing:.06em}
  .mp-notes ul{margin:6px 0 0 14px;max-height:140px;overflow:auto}
  .mp-notes li{margin:2px 0}
  .se-bar{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:12;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;
    max-width:calc(100vw - 32px);background:rgba(7,6,14,.85);border:1px solid rgba(255,183,100,.45);border-radius:999px;padding:7px 10px 7px 16px;
    color:var(--dim);font-size:10px;letter-spacing:.08em;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
  .se-bar b{color:var(--amber);letter-spacing:.3em;font-weight:600}
  .se-hint{color:var(--ink);opacity:.8;min-width:18ch}
  .se-hint.bad{color:#ff6b7a;opacity:1}
  .se-btns{display:flex;gap:6px}
  .se-btns button{background:rgba(7,6,14,.6);border:1px solid rgba(90,97,120,.45);color:var(--dim);font:inherit;font-size:10px;letter-spacing:.14em;
    padding:4px 10px;border-radius:999px;cursor:pointer}
  .se-btns button:hover{color:var(--ink)}
  .se-btns button.on{color:var(--amber);border-color:rgba(255,183,100,.5)}
  .se-btns button.done{color:var(--amber);border-color:var(--amber)}
  .se-tags{position:fixed;inset:0;pointer-events:none;z-index:4}
  .se-tag{position:absolute;left:0;top:0;white-space:nowrap;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:9.5px;letter-spacing:.16em;
    text-transform:uppercase;color:var(--c);background:rgba(7,6,14,.72);border:1px solid rgba(90,97,120,.45);border-radius:999px;padding:3px 9px}
  .se-tag.hov{border-color:var(--ink)}
  .se-tag.sel{border-color:var(--amber);color:var(--amber);box-shadow:0 0 18px rgba(255,183,100,.3)}
  .se-tag.bad{border-color:#ff4d5e;color:#ff6b7a}
  body.stage-editing #cams{opacity:.35;pointer-events:none}
  @media (max-width:640px){
    .map-panel{top:auto;bottom:12px;right:8px;left:8px;width:auto;max-height:58vh}
    .mp-row{grid-template-columns:minmax(0,1fr) 128px;grid-template-areas:"info sel" "spark spark"}
    .mp-info{grid-area:info}.mp-row select{grid-area:sel;width:128px}.mp-spark{grid-area:spark;width:100%;height:22px}
    .se-bar{top:auto;bottom:12px;border-radius:14px}
  }`;
  document.head.appendChild(css);
}
