/* ============================================================
   CREATION TOOLS — the glue between main.js and the two editors:
     · the INSTRUMENT MAP (mapping.js + panel.js): who plays what
     · STAGE EDIT (placement.js + stage-edit.js): where it stands
   Both are DATA over the song: a mapping turns into a song (the same
   format as every other song), a placement into a pinned slot. main asks
   this module for the effective song and each station's slot when it
   builds the world; nothing here touches a solve.

   Persistence: localStorage, per song (cascade:map:<id>, cascade:stage:<id>).
   A share link's id is a hash of ITS OWN content (shared:<fnv1a>): two links
   of the same tune never share an edit slot, so a link always opens as its
   author made it until you edit it yourself.
   Share links: the share payload is the EFFECTIVE song (a mapping is baked
   into it) + song.stage = the layout.

   iOS (CLAUDE.md §5): a re-map rebuilds SYNCHRONOUSLY inside the select's
   change event and primes the new sample bank there (a gesture); the panel
   never opens over the play veil (it waits for the veil tap).
   ============================================================ */
import { makeMapPanel } from './panel.js';
import { makeStageEdit } from './stage-edit.js';
import { midiSources, midiSourcesIn, defaultMidiMapping, applyMidiMapping, songSources, defaultSongMapping, applySongMapping,
         setTarget, sameMapping, loadMapping, saveMapping, sanitizeMapping, targetsFor, machineOf } from './mapping.js';
import { convertToSong } from '../midi/convert.js';
import { placeSlot, placeEntry, sanitizeLayout, encodeLayout, loadLayout, saveLayout, makeHistory, liftOnlyUndo } from './placement.js';

/** "bars 33–48 (0:41 of 3:27) — the chorus" — a phrase window in words */
export function loopText(p, short = false){
  const t = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return short ? `one ${t(p.songSec)} loop`
               : `bars ${p.fromBar}–${p.fromBar + p.bars - 1} (${t(p.sec)} of ${t(p.songSec)})${p.label ? ` — ${p.label}` : ''}`;
}

/** a short stable hash of a string (FNV-1a 32 → base36) */
export function fnv1a(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

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
 *   floorY           the room floor's world y (the grid + the belt's footprint lie on it)
 *   lift(key)        the HEIGHT the user gave a machine (undefined: the layout decides)
 *   height(key)      its height now { lift, user, deck, bottom, top, floor, ceil, open } (null: none to give)
 *   liftLive(key, u, {fresh}) set it live, mid-gesture (u undefined: forget the user's — fresh: back to the
 *                    SOLVED stage, an undo to the empty layout) · liftSettle() the gesture is over
 *   footing()        the live footing plan (rooms/footing.js) · fixed() what can't move here, and why
 */
export function makeEditor({ THREE, scene, cam, dom, songs, machines, host }){
  let midi = null;                                   // { parsed, label, id } — the last MIDI import
  let curKey = null, curId = null, lastWarnings = [], status = '', busy = false, panelWanted = false;
  let builtId = null, builtKeys = '';                // what the last build was (song id + its movable pieces)
  const memo = new Map();                            // `${id}|${mapping}` → { song, warnings }
  const ignoreSongStage = new Set();                 // ids whose shipped song.stage was reset this session
  const history = makeHistory();                     // stage edit's undo (layout snapshots, this song)
  const sharedIds = new WeakMap();                   // a shared song object → its content hash

  // a share link is keyed by ITS CONTENT, not its label: friend A's Für Elise and friend B's are
  // different slots (and an unedited link is always exactly what its author sent)
  const sharedId = S => { if (!sharedIds.has(S)) sharedIds.set(S, `shared:${fnv1a(JSON.stringify(S))}`); return sharedIds.get(S); };
  const idOf = key => key === 'imported' && midi ? midi.id : key === 'shared' && songs.shared ? sharedId(songs.shared) : key;

  /* the instruments' own build-time complaints (the marimba's carriage solve logs "carriage limits
     exceeded" when a part asks more of the robot than it can do): tapped while a world builds, so
     the MAP panel can say which machine is straining — the log itself still goes to the console */
  let building = false, strain = [];
  const machineKeys = new Set(machines.map(m => m.key));
  {
    const warn = console.warn.bind(console);
    console.warn = (...a) => {
      const m = building && typeof a[0] === 'string' && /^\[([a-z][\w-]*)\]$/i.exec(a[0]);
      if (m && machineKeys.has(m[1])) strain.push({ key: m[1], msg: a.slice(1).join(' ') });
      warn(...a);
    };
  }
  const isMidi = key => key === 'imported' && !!midi;
  const labels = Object.fromEntries(machines.map(m => [m.key, m.label]));

  // (looping: each row shows what the voice plays IN the loop — a voice that sits it out says so)
  function sources(key){
    if (!isMidi(key)) return songSources(songs[key], labels);
    return midi.phrase && midi.win !== 'whole' ? midiSourcesIn(midi.parsed, midi.phrase) : midiSources(midi.parsed);
  }
  /* PHRASE LOOP (src/midi/phrase.js): a long import loops its best window; the panel can swap to the
     whole song. midi.win: 'loop' | 'whole' — the convert opts every re-solve of this import uses */
  const winOpts = () => !midi?.phrase ? {} : midi.win === 'whole' ? { window: 'full' }
    : { window: { fromBar: midi.phrase.fromBar, bars: midi.phrase.bars, label: midi.phrase.label } };
  const winDefault = () => !midi?.phrase || midi.win !== 'whole';     // the import as registered
  function defaults(key){
    if (!isMidi(key)) return defaultSongMapping(songs[key]);
    const k = midi.win || 'loop';                    // the orchestra routes the LOOP's material: one default per window
    return (midi.def[k] ||= defaultMidiMapping(midi.parsed, { label: midi.label, ...winOpts() }));
  }
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
    building = true; strain = [];                    // (main builds the world right after asking: see built())
    const orig = songs[key];
    if (!orig) return orig;
    const m = loadMapping(store, curId);
    const mapping = m ? mappingFor(key) : null, plain = !mapping || sameMapping(mapping, defaults(key));
    if (plain && (!isMidi(key) || winDefault())){ lastWarnings = isMidi(key) ? midi.warnings : []; return orig; }
    const mk = `${curId}|${isMidi(key) ? midi.win || 'loop' : ''}|${plain ? 'auto' : JSON.stringify(mapping)}`;
    if (!memo.has(mk)){
      try { memo.set(mk, !isMidi(key) ? applySongMapping(orig, mapping)
                        : plain ? convertToSong(midi.parsed, { label: midi.label, ...winOpts() })
                        : applyMidiMapping(midi.parsed, mapping, { label: midi.label, ...winOpts() })); }
      catch (e){ status = `couldn't apply the saved map: ${e.message}`; return orig; }
    }
    const r = memo.get(mk);
    // a saved map whose lead never plays in the loop: convert played the whole song — say so, and
    // show WHOLE SONG (not a LOOP the room isn't playing)
    if (isMidi(key) && midi.phrase && midi.win !== 'whole' && !r.phrase){
      midi.win = 'whole';
      status = 'the saved map’s lead never plays in the loop — playing the whole song';
    }
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
  const kitSlot = base => placeSlot(base, layout().drums);   // (the kit faces the audience: main ignores its yaw)

  /* ---- the map panel ---- */
  const panel = makeMapPanel({
    machines,
    onPick(id, target){
      const key = host.key(), src = sources(key), source = src.find(s => s.id === id);
      // only what the row actually offers (a stray value — '' from a select set to nothing — is refused)
      const offered = source && targetsFor(source, machines, { authored: !isMidi(key) }).some(g => g.options.some(o => o.value === target));
      if (!offered){ status = `can't route "${source?.name ?? id}" there`; renderPanel(); return; }
      const r = setTarget(mappingFor(key), id, target, src);
      r.mapping = { ...defaults(key), ...sanitizeMapping(r.mapping) };
      if (sameMapping(r.mapping, mappingFor(key))){ status = r.note; renderPanel(); return; }
      if (isMidi(key)){                              // try it before committing: a map that can't make a song is refused
        let t;
        try { t = applyMidiMapping(midi.parsed, r.mapping, { label: midi.label, ...winOpts() }); }
        catch (e){ status = e.message; renderPanel(); return; }
        // …and so is a LEAD that never plays in the loop (convert would quietly play the whole song)
        if (midi.phrase && midi.win !== 'whole' && !t.phrase){
          status = `${source.name} never plays in the loop (bars ${midi.phrase.fromBar}–${midi.phrase.fromBar + midi.phrase.bars - 1}) — can't lead it; WHOLE SONG can`;
          renderPanel(); return;
        }
      }
      saveMapping(store, idOf(key), r.mapping, defaults(key));
      status = r.note || `${src.find(s => s.id === id)?.name} → ${target === 'off' ? 'off' : labelOf(target)}`;
      resolve();
    },
    onAuto(){ saveMapping(store, idOf(host.key()), null); status = 'back to the importer’s routing'; resolve(); },
    onWindow(mode){
      if (!isMidi(host.key()) || !midi.phrase || (midi.win || 'loop') === mode) return;
      midi.win = mode;
      try { store?.setItem(`cascade:win:${midi.id}`, mode); } catch (e){}
      status = mode === 'whole' ? `the whole song (${loopText(midi.phrase, true)})` : `looping ${loopText(midi.phrase)}`;
      resolve();
    },
    onClose(){ panel.show(false); syncButtons(); },
  });
  const labelOf = t => t === 'lead' ? 'the belt lead' : t === 'belt' ? 'a harmony belt' : t.startsWith('lead+') ? `the belt lead + ${labels[t.slice(5)] || t.slice(5)}` : labels[t] || t;
  /* the re-solve runs SYNCHRONOUSLY, inside the select's change event (or the AUTO click): that is a
     user gesture, so host.rebuild's primeSamples() unlocks the new machine's sample bank right here —
     on the iOS element path (§5 round 4) a bank primed outside a gesture stays silent until the next
     tap. (~0.4–0.8 s on a big import: the panel shows it in the cursor, not a painted spinner.) */
  function resolve(){
    busy = true; document.body.classList.add('ed-busy');
    try { host.rebuild(false); }
    finally { busy = false; document.body.classList.remove('ed-busy'); renderPanel(); }
  }
  function renderPanel(){
    if (!panel.open) return;
    const key = host.key();
    if (!songs[key]) return;
    const m = mappingFor(key);
    const strained = new Set(strain.map(w => w.key));
    const loop = isMidi(key) && midi.phrase ? { mode: midi.win || 'loop', text: loopText(midi.phrase) } : null;
    panel.render({ title: `${songs[key].label}${isMidi(key) ? ' · MIDI import' : ''}`, loop, sources: sources(key), mapping: m,
                   authored: !isMidi(key), custom: !sameMapping(m, defaults(key)), warnings: lastWarnings, status, busy,
                   strain: strain.map(w => `${labels[w.key] || w.key} is straining: ${w.msg}`),
                   strained: id => strained.has(machineOf(m[id])) });
  }
  function openPanel(v = !panel.open){ if (v && stage?.on) stage.toggle(false); panel.show(v); status = ''; renderPanel(); syncButtons(); }
  const veilUp = () => { const o = document.getElementById('overlay'); return !!o && !o.classList.contains('gone'); };

  /* ---- stage edit ---- */
  /* the layout with `key` placed at `entry` (placement.js placeEntry: the first edit pins the room as it
     stands; heights the user gave are kept; entry.lift a number / null (AUTO) / absent) */
  const placed = (key, entry, all) => placeEntry(layout(), key, entry, all, { cx: host.cx(), liftOf: k => host.lift?.(k) });
  const stage = makeStageEdit({ THREE, scene, cam, dom, onChange: syncButtons, host: {
    pieces: host.pieces, wall: host.wall, cx: host.cx, kitPivot: host.kitPivot, visBox: host.visBox, room: host.room, roomBox: host.roomBox, roomGroup: host.roomGroup,
    floorY: host.floorY, height: host.height, liftLive: host.liftLive, footing: host.footing, fixed: host.fixed,
    place(key, entry, all){
      history.push(curId, layout());                 // (undo: the layout as it was before this move)
      saveLayout(store, curId, placed(key, entry, all));
      // a machine whose height the LAYOUT decides (no user lift) takes the height the room solve gives its new
      // spot — what a reload would (stations.js: one the user parks behind the belt goes up on the gallery;
      // one brought out from there comes down) — live, before the room re-anchors
      if (key !== 'drums' && host.lift?.(key) === undefined) host.liftLive?.(key, undefined);
      host.restage({ director: false });             // (the director catches up on the way out: leave)
      stage.refresh();
    },
    leave(){ host.directorNow?.(); },
    // one tool at a time: the MAP panel covered a third of the 3/4 view (desktop) and sat on the height dock
    // (a phone's bottom sheet) — entering stage edit closes it; opening it leaves stage edit (openPanel)
    enter(){ if (panel.open) openPanel(false); },
    /* HEIGHT (the handle — height.js): a gesture opens ONE undo step (liftBegin: the layout as it was),
       writes as it goes (liftWrite — cheap: the machine already moved live, only the stored layout
       follows) and settles once, at its end (liftSettle: the kit rebuilt at its deck, the room
       re-anchored, the director re-solved) */
    liftBegin(){ history.push(curId, layout()); syncButtons(); },
    liftWrite(key, entry, all){ saveLayout(store, curId, placed(key, entry, all)); },
    liftSettle(){ host.liftSettle(); stage.refresh(); syncButtons(); },   // (refresh: a kit rebuilt at its deck is a new group)
    /* AUTO: the user's height is forgotten — the layout decides again (a station: the room is solved
       afresh — the gallery raise is the solve's; the kit: back on its plinth, live) */
    liftAuto(key, entry, all){
      history.push(curId, layout());
      saveLayout(store, curId, placed(key, { ...entry, lift: null }, all));
      // live: the room solve asked again where it stands now, every machine pinned as the stored layout now
      // pins them — the height a reload would give (main's autoLiftOf); none to give: the world is rebuilt
      if (host.liftLive(key, undefined)){ host.liftSettle(); stage.refresh(); } else host.rebuild(true);
      syncButtons();
    },
    resetLayout(){ stage.cancel(); history.push(curId, layout()); saveLayout(store, curId, {}); ignoreSongStage.add(curId); host.rebuild(true); },
    undo, redo,
  } });
  /* undo the last stage move (or reset, or height gesture): back to the layout before it — a rebuild
     holding songTime (each station is re-placed from its slot; an empty layout = the solved stage
     again). A burst of height taps still settling is simply dropped: the rebuild re-derives it all */
  function undo(){
    stage.finish();                                  // (a gesture still running / settling ends first: it is the step undone)
    const prev = history.pop(curId);
    if (!prev) return false;
    history.stash(curId, layout());                  // (redo: the layout this undo leaves)
    goToLayout(prev);
    return true;
  }
  /* REDO (⌘⇧Z / Ctrl+Y, ↷): the last undone step again — until a new edit starts another branch */
  function redo(){
    stage.finish();                                  // (a gesture still open ends first: a new edit — nothing to redo)
    const next = history.unstash(curId);
    if (!next) return false;
    history.keep(curId, layout());
    goToLayout(next);
    return true;
  }
  /* the stage to layout `to` (an undo's or a redo's): a HEIGHT-only step comes back live (the machines move, the
     room re-anchors — no rebuild, the music runs on); anything else, or a height only a fresh solve can give,
     rebuilds holding songTime. (To the empty layout: the SOLVED stage — an AUTO there is the build's own solve,
     not a pinned one.) */
  function goToLayout(to){
    const cur = layout(), lifts = liftOnlyUndo(to, cur), fresh = !Object.keys(to).length;
    if (fresh) ignoreSongStage.add(curId); else ignoreSongStage.delete(curId);
    saveLayout(store, curId, to);
    if (lifts && lifts.every(l => host.liftLive?.(l.key, l.lift, { fresh }))){ if (lifts.length) host.liftSettle(); stage.refresh(); syncButtons(); }
    else host.rebuild(true);
  }

  /* ---- the HUD pills: MAP · EDIT (next to SHARE LINK) ---- */
  const row = document.createElement('div'); row.className = 'ed-row';
  const mapBtn = Object.assign(document.createElement('button'), { className: 'ed-pill', textContent: 'MAP', title: 'instrument map — who plays what' });
  const editBtn = Object.assign(document.createElement('button'), { className: 'ed-pill', textContent: 'EDIT STAGE', title: 'move, turn and raise the machines (E)' });
  row.append(mapBtn, editBtn);
  const share = document.getElementById('share');
  (share?.parentNode || document.getElementById('hud') || document.body).insertBefore(row, share ? share.nextSibling : null);
  mapBtn.addEventListener('click', () => openPanel());
  editBtn.addEventListener('click', () => stage.toggle());
  /* the pills say when THIS song is no longer as authored/imported: a dot on MAP (re-mapped) /
     EDIT STAGE (re-placed) — and SHARE LINK shows, so a customised authored song can be shared */
  const customMap = () => !!curId && !!loadMapping(store, curId) && !sameMapping(mappingFor(curKey), defaults(curKey));
  const customStage = () => !!curId && Object.keys(loadLayout(store, curId)).length > 0;
  function syncButtons(){
    mapBtn.classList.toggle('on', panel.open); editBtn.classList.toggle('on', stage.on);
    const cm = curKey && songs[curKey] ? customMap() : false, cs = curKey ? customStage() : false;
    mapBtn.classList.toggle('custom', cm); editBtn.classList.toggle('custom', cs);
    mapBtn.title = cm ? 'instrument map — re-mapped (AUTO in the panel puts it back)' : 'instrument map — who plays what';
    editBtn.title = cs ? 'move, turn and raise the machines (E) — this song’s stage is hand-placed' : 'move, turn and raise the machines (E)';
    if (share) share.hidden = !(curKey === 'imported' || curKey === 'shared' || cm || cs);
    stage.syncUndo(history.size(curId), history.redoSize(curId));
  }
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.open && !stage.on) openPanel(false);
    // ⌘Z / Ctrl+Z: undo the last stage move (while stage edit is open; never inside a text field)
    // ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y: redo it
    if (!stage.on || !(e.metaKey || e.ctrlKey) || /^(input|textarea)$/i.test(e.target?.tagName || '')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); undo(); }
    else if ((k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.metaKey)){ e.preventDefault(); e.stopPropagation(); redo(); }
  }, { capture: true });
  injectStyles();
  /* the import's panel opens on its own — but never over the play veil: the first tap on a ?midi= boot
     must reach the veil (it builds the AudioContext inside that gesture, §5). It waits, then opens. */
  function openWanted(){
    if (!panelWanted || host.key() !== 'imported' || veilUp()) return;
    panelWanted = false; openPanel(true);
  }

  return {
    song, slot, kitSlot,
    /** after every buildWorld: the editors re-read the room */
    built(){
      building = false;
      stage.measureAll();                            // each machine's local box, at the count-in pose (just built)
      const keys = host.pieces().map(p => p.key).sort().join(',');
      const newSong = curId !== builtId, newCast = keys !== builtKeys;
      builtId = curId; builtKeys = keys;
      if (newSong){ status = ''; stage.cancel(); }
      if (stage.on){ stage.refresh({ reset: newSong }); if (newSong || newCast) stage.overview(); }
      if (panelWanted && host.key() !== 'imported') panelWanted = false;
      openWanted();
      renderPanel(); syncButtons();
    },
    update(){ if (panelWanted) openWanted(); stage.update(); },
    /** does this song differ from the authored/imported one (a stored map or layout) */
    get custom(){ return customMap() || customStage(); },
    /** a MIDI import landed (main registers its default song as 'imported') */
    midiLoaded(parsed, label, warnings = [], phrase = null){
      const n = parsed.tracks.reduce((s, t) => s + t.notes.length, 0);
      midi = { parsed, label, id: `midi:${label}:${n}`, warnings, def: {}, phrase, win: 'loop' };
      /* a whole-song choice sticks to this file (per id); main registered the LOOP, so a stored
         'whole' is applied by the effective song (song()) like a stored mapping */
      try { if (phrase && store?.getItem(`cascade:win:${midi.id}`) === 'whole') midi.win = 'whole'; } catch (e){}
      memo.clear();
      panelWanted = true;                            // opens on the import's own build — once the veil is gone
    },
    /** what a share link carries for this key: the effective song + its stage */
    shareable(key){
      const S = song(key), L = layout();
      return Object.keys(L).length ? { ...S, stage: encodeLayout(L) } : S;
    },
    openMap: openPanel, toggleEdit: v => stage.toggle(v), undo, redo,
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
  .ed-pill.custom::after{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--amber);
    margin-left:7px;vertical-align:1px;box-shadow:0 0 6px rgba(255,183,100,.8)}
  #share[hidden]{display:none!important}
  #overlay:not(.gone) ~ .map-panel{display:none!important}
  body.ed-busy,body.ed-busy *{cursor:progress!important}
  .mp-row.strain{background:rgba(255,183,100,.1);box-shadow:inset 0 0 0 1px rgba(255,183,100,.35)}
  .mp-row.strain .mp-meta{color:var(--amber)}
  .mp-strain{margin-top:8px;color:var(--amber);font-size:9.5px;line-height:1.45}
  .mp-strain[hidden]{display:none}
  .map-panel{position:fixed;top:78px;right:16px;width:min(470px,calc(100vw - 32px));max-height:calc(100vh - 190px);overflow:auto;z-index:9;
    background:rgba(7,6,14,.88);border:1px solid rgba(90,97,120,.45);border-radius:12px;padding:14px 14px 10px;color:var(--ink);
    font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    box-shadow:0 18px 60px rgba(0,0,0,.45)}
  .map-panel header{display:flex;justify-content:space-between;align-items:center}
  .map-panel header b{font-size:11px;letter-spacing:.3em;color:var(--amber);font-weight:600}
  .map-panel .x{background:none;border:none;color:var(--dim);font:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
  .map-panel .x:hover{color:var(--ink)}
  .mp-song{margin-top:6px;letter-spacing:.12em;color:var(--ink)}
  .mp-lede{margin-top:3px;color:var(--dim);font-size:10px;letter-spacing:.06em}
  .mp-loop[hidden]{display:none}
  .mp-loop{margin-top:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:var(--dim)}
  .mp-loop .mp-lt{flex:1 1 180px;letter-spacing:.04em;line-height:1.4}
  .mp-loop .mp-lt b{color:var(--ink);font-weight:500}
  .mp-loop button{background:none;border:1px solid rgba(90,97,120,.45);color:var(--dim);font:inherit;font-size:9.5px;letter-spacing:.16em;
    padding:3px 10px;border-radius:999px;cursor:pointer}
  .mp-loop button.on{color:var(--amber);border-color:var(--amber);background:rgba(255,183,100,.08)}
  .mp-loop button:hover:not(.on):not(:disabled){color:var(--ink)}
  .mp-rows{margin-top:10px;display:flex;flex-direction:column;gap:6px}
  .mp-row.idle{opacity:.5}
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
  .se-btns button[hidden]{display:none}
  .se-btns button.on{color:var(--amber);border-color:rgba(255,183,100,.5)}
  .se-btns button.done{color:var(--amber);border-color:var(--amber)}
  .se-btns button:disabled{opacity:.35;cursor:default}
  .se-btns i{font-style:normal}
  .se-tags{position:fixed;inset:0;pointer-events:none;z-index:4}
  .se-tag{position:absolute;left:0;top:0;white-space:nowrap;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:9.5px;letter-spacing:.16em;
    text-transform:uppercase;color:var(--c);background:rgba(7,6,14,.72);border:1px solid rgba(90,97,120,.45);border-radius:999px;padding:3px 9px}
  .se-tag.hov{border-color:var(--ink)}
  .se-tag i{font-style:normal;opacity:.75;margin-left:7px;letter-spacing:.06em;text-transform:none}
  .se-tag i:empty{display:none}
  .se-tag.sel{border-color:var(--amber);color:var(--amber);box-shadow:0 0 18px rgba(255,183,100,.3)}
  .se-tag.bad{border-color:#ff4d5e;color:#ff6b7a}
  body.stage-editing #cams{opacity:0;pointer-events:none}
  .se-view{display:inline-flex;border:1px solid rgba(90,97,120,.45);border-radius:999px}
  .se-btns .se-view button{border:none;border-radius:0;padding:4px 10px;background:none;position:relative}
  .se-btns .se-view button:first-child{border-radius:999px 0 0 999px}.se-btns .se-view button:last-child{border-radius:0 999px 999px 0}
  .se-btns .se-view button::after{content:'';position:absolute;inset:-9px -6px}
  .se-btns .se-view button.on{color:var(--amber);background:rgba(255,183,100,.1)}
  /* the selection DOCK (stage-edit.js): who it is · ▼ height ▲ · FLOOR · AUTO · turn */
  .se-dock{position:fixed;left:50%;bottom:46px;transform:translateX(-50%);z-index:12;display:flex;align-items:center;gap:14px;
    max-width:calc(100vw - 32px);background:rgba(7,6,14,.9);border:1px solid rgba(90,97,120,.5);border-left:3px solid var(--c);border-radius:16px;
    padding:8px 10px 8px 14px;color:var(--dim);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:10px;letter-spacing:.1em;
    box-shadow:0 14px 44px rgba(0,0,0,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);user-select:none;-webkit-user-select:none}
  .se-dock[hidden]{display:none!important}
  .sd-name{display:grid;grid-template-columns:auto 1fr;column-gap:8px;row-gap:3px;align-items:center;min-width:0}
  .sd-name i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c)}
  .sd-name b{color:var(--c);font-weight:600;letter-spacing:.2em;text-transform:uppercase;white-space:nowrap;font-size:10.5px;overflow:hidden;text-overflow:ellipsis}
  .sd-loft{grid-column:2;font-style:normal;color:#7fe3c8;font-size:9px;letter-spacing:.18em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}
  .se-dock:not(.loft) .sd-loft{display:none}
  .sd-h,.sd-more,.sd-turn{display:flex;align-items:center;gap:6px;flex:none}
  .se-dock button{min-width:44px;height:44px;background:rgba(7,6,14,.6);border:1px solid rgba(90,97,120,.5);color:var(--ink);font:inherit;
    font-size:10px;letter-spacing:.16em;border-radius:12px;cursor:pointer;padding:0 12px;transition:border-color .15s,color .15s,background .15s;touch-action:manipulation}
  .se-dock button:hover:not(:disabled){border-color:rgba(255,183,100,.7);color:var(--amber)}
  .se-dock button:active:not(:disabled){background:rgba(255,183,100,.14)}
  .se-dock button:focus-visible{outline:none;border-color:var(--ink)}
  .se-dock button:disabled{opacity:.28;cursor:default}
  .se-dock .sd-step{font-size:13px;letter-spacing:0;color:var(--amber);border-color:rgba(255,183,100,.45);padding:0 12px}
  .se-dock .sd-step i{font-style:normal;font-size:9.5px;letter-spacing:.18em}
  .se-dock .sd-turn button{font-size:15px;letter-spacing:0;padding:0}
  .sd-read{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:13ch;line-height:1.1}
  .sd-read b{color:var(--ink);font-size:14px;font-weight:600;letter-spacing:.05em;white-space:nowrap}
  .sd-read i{font-style:normal;color:var(--amber);font-size:8.5px;letter-spacing:.24em;margin-top:4px;white-space:nowrap}
  .sd-why{display:none;color:var(--ink);opacity:.85;letter-spacing:.08em;white-space:nowrap}
  .se-dock.fixed{border-left-color:var(--dim)}
  .se-dock.fixed .sd-why{display:block}
  .se-dock.fixed .sd-h,.se-dock.fixed .sd-more,.se-dock.fixed .sd-turn{display:none}
  .se-dock.nolift .sd-h,.se-dock.nolift .sd-more{display:none}
  /* the HEIGHT handle on the screen: the pole + its metre scale, the knob, its readout, the first-time hint */
  .se-pole{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:6;overflow:visible}
  .se-pole .sp-rail{stroke:rgba(255,183,100,.42);stroke-width:2;fill:none}
  .se-pole .sp-run{stroke:var(--amber);stroke-width:4;stroke-linecap:round;fill:none;filter:drop-shadow(0 0 5px rgba(255,183,100,.75))}
  .se-pole .sp-ticks{stroke:rgba(255,183,100,.6);stroke-width:1.3;fill:none}
  .se-pole .sp-major{stroke:rgba(255,214,160,.95);stroke-width:2;fill:none}
  .se-pole text{fill:var(--amber);font:600 9px ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.1em;paint-order:stroke;stroke:rgba(7,6,14,.9);stroke-width:3px}
  .se-knob{position:fixed;left:0;top:0;z-index:8;width:30px;height:40px;border-radius:15px;box-sizing:border-box;background:rgba(22,15,8,.94);
    border:2px solid var(--amber);color:var(--amber);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
    font:9px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;cursor:ns-resize;touch-action:none;user-select:none;-webkit-user-select:none;
    box-shadow:0 0 0 4px rgba(255,183,100,.13),0 0 22px rgba(255,183,100,.5);transition:box-shadow .15s,background .15s}
  .se-knob::before{content:'';position:absolute;inset:-14px -16px;border-radius:24px}
  .se-knob span{pointer-events:none}
  .se-knob:hover,.se-knob.drag{background:rgba(52,34,14,.97);box-shadow:0 0 0 7px rgba(255,183,100,.22),0 0 34px rgba(255,183,100,.8)}
  .se-knob[hidden],.se-chip[hidden],.se-tip[hidden]{display:none!important}
  .se-chip{position:fixed;left:0;top:0;z-index:7;pointer-events:none;display:flex;flex-direction:column;gap:3px;padding:6px 10px 6px 10px;border-radius:10px;
    background:rgba(7,6,14,.84);border:1px solid rgba(255,183,100,.42);font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;white-space:nowrap;
    box-shadow:0 6px 22px rgba(0,0,0,.4)}
  .se-chip b{color:var(--ink);font-size:13px;font-weight:600;letter-spacing:.05em}
  .se-chip i{font-style:normal;color:var(--amber);font-size:8.5px;letter-spacing:.26em}
  .se-chip i:empty{display:none}
  .se-chip em{font-style:normal;color:#7fe3c8;font-size:8.5px;letter-spacing:.18em;text-transform:uppercase}
  .se-chip:not(.loft) em{display:none}
  .se-chip.loft{border-color:rgba(127,227,200,.55)}
  .se-chip.plan{display:none}
  .se-knob:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
  .se-chip.nudge{animation:se-nudge .32s ease}
  @keyframes se-nudge{0%,100%{margin-left:0}25%{margin-left:-5px}75%{margin-left:5px}}
  .se-tip{position:fixed;left:0;top:0;z-index:7;display:flex;align-items:center;gap:6px;padding:4px 4px 4px 10px;border-radius:9px;
    background:rgba(30,20,8,.82);border:1px dashed rgba(255,183,100,.5);color:var(--amber);font:9.5px ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    letter-spacing:.08em;white-space:nowrap}
  .se-tip button{background:none;border:none;color:var(--amber);font:inherit;font-size:15px;line-height:1;cursor:pointer;min-width:28px;min-height:28px;padding:0;position:relative}
  .se-tip button::after{content:'';position:absolute;inset:-8px}
  body.se-lifting .se-tag:not(.sel){opacity:.3}
  body.se-lifting,body.se-lifting *{cursor:ns-resize!important}
  @media (pointer:coarse){
    .se-knob{width:36px;height:48px;border-radius:18px;font-size:11px}
    .se-knob::before{inset:-16px -18px}
  }
  @media (max-width:640px){
    .map-panel{top:auto;bottom:12px;right:8px;left:8px;width:auto;max-height:58vh}
    .mp-row{grid-template-columns:minmax(0,1fr) 128px;grid-template-areas:"info sel" "spark spark"}
    .mp-info{grid-area:info}.mp-row select{grid-area:sel;width:128px}.mp-spark{grid-area:spark;width:100%;height:22px}
    .se-bar{top:10px;left:8px;right:8px;transform:none;max-width:none;border-radius:14px;gap:6px 10px;padding:7px 8px 7px 12px}
    .se-bar .se-hint{order:3;flex-basis:100%;min-width:0;font-size:9.5px}
    .se-btns{gap:4px}.se-btns button{padding:6px 10px;font-size:13px;letter-spacing:0}
    .se-btns .se-view button{font-size:10px;letter-spacing:.12em;padding:6px 9px}
    .se-btns i{display:none}
    .se-dock{left:8px;right:8px;bottom:42px;transform:none;max-width:none;display:grid;grid-template-columns:minmax(0,1fr) auto;
      grid-template-areas:"name turn" "h more" "why why";gap:8px 8px;padding:8px 8px 8px 12px;border-radius:16px}
    .sd-name{grid-area:name}.sd-turn{grid-area:turn}.sd-h{grid-area:h}.sd-more{grid-area:more}.sd-why{grid-area:why;white-space:normal}
    .sd-read{min-width:11ch}
    .se-dock .sd-step{padding:0}.se-dock .sd-step i{display:none}
    .se-dock.fixed{grid-template-areas:"name" "why";grid-template-columns:1fr}
    body.stage-editing #note{opacity:0}
    body.stage-editing #hud{opacity:0;pointer-events:none}
    body.stage-editing #hud *{pointer-events:none!important}
  }
  /* a phone on its side (short AND wider than the bottom-sheet breakpoint): the map stands beside
     the SOUND / REC / ROOM column from the top down to the camera row, not a 200px slot under them */
  @media (max-height:520px) and (min-width:641px){
    .map-panel{top:8px;right:120px;width:min(470px,calc(100vw - 136px));max-height:calc(100vh - 92px)}
  }`;
  document.head.appendChild(css);
}
