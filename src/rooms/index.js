import * as THREE from 'three';
import { STAGE, disposeTree } from './common.js';
import { planFooting, footingBoxes } from './footing.js';
import { buildFooting, makeFootingMats, DEFAULT_STYLE } from './footing3d.js';
import { singlePassFlats } from '../perftune.js';
import grid from './grid.js';
import cathedral from './cathedral.js';
import studio from './studio.js';
import voidRoom from './void.js';
import graveyard from './graveyard.js';
import arena from './arena.js';
import starship from './starship.js';
/* ============================================================
   ROOM HOST — the one seam main.js talks to. A Room module is
       { key, label, build(scene, {envMap, renderer}) → {
           group, FLOOR, CEIL, HW, BACK, FRONT,      // surfaces + bounds (world y / x / z)
           fog: FogExp2, background: Color|Texture,  // atmosphere
           mood?: { ambient:[hex,int], hemi:[sky,ground,int] },   // re-tint the global fills
           place?(anchors, plan),                    // where the machines stand (world space), one per
                                                     // machine: { key, kind: 'belt'|'kit'|'station'|'hung',
                                                     //   label, color, x, z, yaw, w, d (footprint), y (deck),
                                                     //   ground, lift (deck = ground + lift — footing.js),
                                                     //   bottom (the y it stands on), low (its lowest solid
                                                     //   part), box [x0,x1,y0,y1,z0,z1], cue [{t, w}] (its
                                                     //   strikes: sorted loop times, weights), P, start,
                                                     //   fixed (the belt: its own posts, never moves),
                                                     //   feet / hang (an open `stand`: footing.js) }
                                                     // 'hung' (the organ loft, the chandelier, the court):
                                                     //   no footing — its solid box is an obstacle (the
                                                     //   organ loft's posts reach the floor); `plan` = what
                                                     //   they stand on (rooms/footing.js planFooting: pads,
                                                     //   lofts, stairs / ladders — accessRect): what a room
                                                     //   that builds its own ground under them must carry
           footing?: Style,                          // how its supports look (rooms/footing3d.js) — else
                                                     //   the kit's DEFAULT_STYLE
           update?(dt, songTime, camera, energy, cues),   // pure-ish ambience; no allocation.
                                                     // cues = the song's weather (see cue())
           resize?(w, h, pixelRatio),                // render-target rooms (the studio mirror)
           xr?(on),                                  // WebXR headset variant (lighter / comfier)
           dispose() } }
   Rooms are built LAZILY on first visit and CACHED (hidden, not destroyed), so
   cycling with R is instant after the first pass and shaders compile once.
   FLOOR is identical in every room (common.js — the floor contract), so a
   swap never rebuilds the song's world or restarts the timeline.
   'arena' (the Metal Arena) also reads cues.drums / melody / loopBeats / start: its
   pyro + CO2 + blinder cue sheet is solved from them at song load (arena-cues.js).
   'off' = no room: the original bare dark void + fog (the machines still stand on DEFAULT_STYLE).
   FOOTING (rooms/footing.js plans it, rooms/footing3d.js builds it): what every machine stands on —
   one PLAN per set of anchors, one built footing per room (its style), the live room's shown; a swap
   re-dresses the supports (cached for the anchors it was built on), a new place() rebuilds the live
   room's and drops the others. Its group lives at scene level (room 'off' has one too) — `footGroup`
   for the shot solve, `footing` (the plan), `footBoxes` (its envelopes); its reactive edge is updated
   from update(). Rooms still own no lights: the footing is lit like any machine.
   A room's OWN reaction to a machine (a candle row, a grave's glow) reads the anchor's cue the same
   way: makePulse(a.cue, a) (rooms/pulse.js) in place(), then .at(songTime) / .next(songTime) in
   update() — a pure envelope of songTime, silent in the count-in, allocation-free.
   PREWARM (idle, after the first frames): every room not yet visited is built, PLACED on the current
   anchors, given its footing, single-passed (perftune.js) and rendered once offscreen — so its first
   visible frame compiles no program. What that needs from a room: everything that changes a program
   must exist by the end of place() — an InstancedMesh coloured in place() must carry instanceColor
   from build() (setColorAt creates it lazily, and it is a program define); a material's defines /
   onBeforeCompile / map presence must not flip on the first update(). A merged mesh that spans the
   floor AND the ceiling sets userData.boxes (shotrig roomSolids reads them; without them a mesh under
   40 u falls back to its world AABB — a solid slab from floor to sky).
   Choosing: ?room=<key>  >  a pick made THIS session (R / ROOM)  >  the song's own
   `room` field (features-as-data; suggest())  >  the viewer's remembered pick
   (localStorage — it still opens the page and dresses songs that name no room)  >
   'grid'. So a song staged for its room (the October pack's graveyard) opens there
   even for a viewer who once pressed R, until they press it again. R cycles; on touch
   devices the ROOM button does the same (it sits UNDER the play veil, so it can
   never swallow the iOS priming tap — same rule as the free cam).
   ============================================================ */

/* GUEST ROOMS — a contributed room is NEW FILES ONLY (src/rooms/README.md; `npm run new:room <key>`):
   src/rooms/<key>.js, whose default export is the Room module above with key === '<key>', plus any
   <key>-*.js helpers of its own (a hyphen marks a helper: the glob never imports one directly). It is
   picked up here — no line of this file to edit — and comes AFTER the shipped rooms (sorted by key),
   so the shipped R order is unchanged; 'off' stays last. The glob names every shipped / shared file
   so that, with no guest present, it imports nothing at all. A guest must never import this file
   (a cycle: import ./common.js for STAGE). test/room-contract.test.js covers every room, guests too. */
const SHIPPED = [grid, cathedral, studio, voidRoom, graveyard, arena, starship];
const GUEST_MODS = import.meta.glob(['./*.js', '!./*-*.js', '!./index.js', '!./common.js', '!./footing.js', '!./footing3d.js',
  '!./pulse.js', '!./grid.js', '!./cathedral.js', '!./studio.js', '!./void.js', '!./graveyard.js', '!./arena.js', '!./starship.js'], { eager: true });
export const GUESTS = Object.entries(GUEST_MODS)
  .map(([p, m]) => [p.slice(2, -3), m.default])                // ['<file>', descriptor]
  .filter(([file, R]) => R && R.key === file && R.key !== 'off' && typeof R.build === 'function' && !SHIPPED.some(S => S.key === R.key))
  .map(([, R]) => R)
  .sort((a, b) => a.key.localeCompare(b.key));
export const ROOMS = [...SHIPPED, ...GUESTS];
export const ROOM_KEYS = [...ROOMS.map(r => r.key), 'off'];
export { STAGE };

export function makeRoomHost({ scene, envMap, renderer, lights = {}, initial }){
  const { ambient, hemi } = lights;
  // the bare look ('off') = whatever main set up before the host took over
  const BASE = {
    fogColor: scene.fog ? scene.fog.color.clone() : new THREE.Color(0x07060e),
    fogDensity: scene.fog ? scene.fog.density : .026,
    background: scene.background,
    ambient: ambient ? [ambient.color.getHex(), ambient.intensity] : null,
    hemi: hemi ? [hemi.color.getHex(), hemi.groundColor.getHex(), hemi.intensity] : null,
  };
  // ONE FogExp2 for the life of the page: rooms only change its colour/density, so the
  // fog type never flips and no material recompiles on a swap
  const fog = scene.fog && scene.fog.isFogExp2 ? scene.fog : new THREE.FogExp2(BASE.fogColor, BASE.fogDensity);
  scene.fog = fog;

  const built = {};                                           // key → built room (cached)
  let cur = null, key = 'off', anchors = [], anchorGen = 0;
  // the FOOTING: one plan per anchorGen; per room key (incl. 'off') the footing built on it
  const footRoot = new THREE.Group(); footRoot.name = 'footing'; footRoot.matrixAutoUpdate = false;
  scene.add(footRoot);
  const foots = {};                                           // key → { gen, f }
  let plan = null, boxes = [], planGen = -1, footMats = null;
  const FOOT_ROOM = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };   // (the smallest room's walls: one plan for every room)
  function footPlan(){
    if (planGen !== anchorGen){
      plan = planFooting(anchors, { floor: STAGE.FLOOR, room: FOOT_ROOM }); boxes = footingBoxes(plan); planGen = anchorGen;
      // each pad keeps its machine's own footprint (a style sizing a riser tier to the machine, not the pad)
      const byKey = new Map(anchors.map(a => [a.key, a]));
      for (const p of plan.pads){ const a = byKey.get(p.key); if (a && p.foot == null && Number.isFinite(a.w) && Number.isFinite(a.d)) p.foot = [a.w, a.d]; }
    }
    return plan;
  }
  /* a room's footing on the current anchors (built if it isn't: lazily — a set() during a song build sees
     stale anchors); the live room's by default, any built room's for the prewarm */
  function footFor(k, b){
    let e = foots[k];
    if (!e || e.gen !== anchorGen){
      e?.f.dispose();
      const p = footPlan();
      footMats ||= makeFootingMats({ envMap });
      const f = buildFooting(p, b?.footing || DEFAULT_STYLE, { mats: footMats, envMap, renderer, boxes, room: k });
      footRoot.add(f.group);
      e = foots[k] = { gen: anchorGen, f };
      showFoot();
    }
    return e.f;
  }
  const foot = () => footFor(key, cur);
  const showFoot = () => { for (const k in foots) foots[k].f.group.visible = k === key && foots[k].gen === anchorGen; };

  // a small fading label when the room changes (R) — self-contained, no CSS file
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;' +
    'pointer-events:none;color:#cfd6e6;font:600 13px/1 ui-monospace,monospace;letter-spacing:.3em;' +
    'text-transform:uppercase;opacity:0;transition:opacity .6s;text-shadow:0 0 12px rgba(0,0,0,.9)';
  document.body.appendChild(tag);
  let tagTimer = 0;
  const flashTag = txt => { tag.textContent = txt; tag.style.opacity = 1; clearTimeout(tagTimer);
    tagTimer = setTimeout(() => { tag.style.opacity = 0; }, 900); };

  function applyMood(m){
    if (ambient){ const a = m?.ambient || BASE.ambient; if (a){ ambient.color.setHex(a[0]); ambient.intensity = a[1]; } }
    if (hemi){ const h = m?.hemi || BASE.hemi; if (h){ hemi.color.setHex(h[0]); hemi.groundColor.setHex(h[1]); hemi.intensity = h[2]; } }
  }

  function buildRoom(R){
    const b = R.build(scene, { envMap, renderer });
    if (b.FLOOR !== STAGE.FLOOR) console.warn(`room ${R.key}: FLOOR ${b.FLOOR} breaks the floor contract (${STAGE.FLOOR})`);
    b.anchorGen = -1; b.label = R.label; b.group.visible = false;
    scene.add(b.group);
    return (built[R.key] = b);
  }

  let userPicked = false;
  let xrOn = false;                                           // presenting in a headset (main: xrSession)
  let weather = null;                                         // the current song's {storm, sky, rollT, beat, P}
  function set(k, { announce = false } = {}){
    if (announce) userPicked = true;
    const R = ROOMS.find(r => r.key === k);
    if (cur) cur.group.visible = false;
    key = R ? k : 'off';
    if (!R){
      cur = null;
      fog.color.copy(BASE.fogColor); fog.density = BASE.fogDensity;
      scene.background = BASE.background; applyMood(null);
    } else {
      cur = built[k] || buildRoom(R);
      if (cur.place && cur.anchorGen !== anchorGen){ cur.place(anchors, footPlan()); cur.anchorGen = anchorGen; }
      cur.group.visible = true;
      if (cur.xrOn !== xrOn){ cur.xr?.(xrOn); cur.xrOn = xrOn; }   // the headset variant follows the room in
      fog.color.copy(cur.fog.color); fog.density = cur.fog.density;
      scene.background = cur.background; applyMood(cur.mood);
    }
    showFoot();
    if (announce) flashTag(cur ? cur.label : 'no room');
    btnText();
    return key;
  }

  /* where things stand this song (the anchors, world space — see the header): the live room's
     footing is rebuilt on them now (a stale one for another room is dropped: rebuilt on its swap) */
  function place(list){
    anchors = list; anchorGen++;
    if (cur && cur.place){ cur.place(anchors, footPlan()); cur.anchorGen = anchorGen; }
    for (const k in foots) if (k !== key){ foots[k].f.dispose(); delete foots[k]; }
    foot();
  }

  // per-viewer memory (a convenience only — storage can throw / be empty; the page works without it)
  const LS = 'cascade.room';
  const load = () => { try { return localStorage.getItem(LS); } catch(e){ return null; } };
  const save = k => { try { localStorage.setItem(LS, k); } catch(e){} };
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('room') : null;
  const stored = load();
  const urlPick = (q && ROOM_KEYS.includes(q)) ? q : null;
  const remembered = (stored && ROOM_KEYS.includes(stored)) ? stored : null;
  const pinned = urlPick ?? remembered;                       // what the page opens on

  // ROOM button (touch path to R). z-index below the play veil (#overlay z 10) → inert until play.
  const btn = document.createElement('button');
  btn.setAttribute('aria-label', 'change room');
  btn.style.cssText = 'position:fixed;top:74px;right:20px;z-index:5;background:none;border:none;cursor:pointer;' +
    'color:#5a6178;font:11px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.2em;padding:6px;text-transform:uppercase;' +
    'text-align:right;line-height:1.35;text-shadow:0 0 8px #07060e';
  btn.title = 'cycle rooms (R)';
  // two lines: a dim 'ROOM ›' caption over the room's own name. Capped width so a long
  // name wraps onto right-aligned lines instead of crowding the HUD subtitle on a phone.
  btn.style.maxWidth = 'max(120px, calc(100vw - 600px))'; btn.style.whiteSpace = 'normal';
  const btnCap = document.createElement('span'), btnName = document.createElement('span');
  btnCap.style.cssText = 'display:block;font-size:9px;opacity:.75'; btnCap.textContent = 'ROOM\u00a0›';
  btnName.style.cssText = 'display:block;color:#cfd6e6;opacity:.7';
  btn.append(btnCap, btnName);
  const btnText = () => { btnName.textContent = cur ? cur.label : 'none'; };
  btn.addEventListener('click', () => { host.cycle(); });
  btn.addEventListener('pointerenter', () => { btn.style.color = '#cfd6e6'; });
  btn.addEventListener('pointerleave', () => { btn.style.color = '#5a6178'; });
  document.body.appendChild(btn);
  set(initial ?? pinned ?? 'grid');

  /* Build the rooms we're NOT in during idle time, one per idle slice, hidden, and compile
     their shaders — so the first R / ROOM tap never stalls a frame (which would slip the
     clamped-dt timeline). Kicked by main after the first frames. */
  let warmRT = null;
  function prewarm(camera){
    const todo = ROOMS.filter(R => !built[R.key]);
    const idle = typeof requestIdleCallback === 'function' ? cb => requestIdleCallback(cb, { timeout: 2500 }) : cb => setTimeout(cb, 200);
    const step = () => {
      const R = todo.shift(); if (!R) return;
      if (!built[R.key]){
        const b = buildRoom(R);
        // placed + footed on the current anchors (a swap then has nothing left to build or compile —
        // a later place() re-places the live room and drops the other footings, as before)
        let wf = null;
        if (anchors.length){
          try {
            if (b.place){ b.place(anchors, footPlan()); b.anchorGen = anchorGen; }
            wf = footFor(R.key, b);
          } catch(e){ console.warn(`room ${R.key}: prewarm place / footing failed`, e); }
        }
        /* a REAL render into a tiny offscreen target, room visible: compiles programs with the
           exact keys the composer's RenderPass will use (render-target → no tone-map/sRGB
           variant — renderer.compile() to the canvas would key them differently and the first
           visible frame would recompile), and uploads geometry + textures. */
        const prevBg = scene.background, vis = cur ? cur.group.visible : false;
        if (cur) cur.group.visible = false;
        b.group.visible = true; scene.background = b.background;
        if (wf) wf.group.visible = true;
        // the one-pass flats FIRST: main's perftune pass would flip them after this compile (a 2-pass
        // pair compiled here, the 1-pass program on the room's first visible frame)
        singlePassFlats(b.group); if (wf) singlePassFlats(wf.group);
        try {
          warmRT ||= new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
          const prevRT = renderer.getRenderTarget();
          renderer.setRenderTarget(warmRT);
          renderer.compile(scene, camera);                       // everything, culled or not, keyed for a render target
          renderer.render(scene, camera);                        // + buffer uploads for what is in view
          const seen = new Set(), up = t => { if (t && t.isTexture && !seen.has(t)){ seen.add(t); renderer.initTexture(t); } };
          up(b.background);                                      // + every texture, in view or not (the void sky is 2048²)
          const upMats = o => { for (const m of [].concat(o.material || [])){
            for (const v of Object.values(m)) up(v);
            if (m.uniforms) for (const u of Object.values(m.uniforms)) up(u.value); } };
          b.group.traverse(upMats); if (wf) wf.group.traverse(upMats);
          renderer.setRenderTarget(prevRT);
        } catch(e){}
        scene.background = prevBg; if (cur) cur.group.visible = vis;
        b.group.visible = false;
        showFoot();
      }
      idle(step);
    };
    idle(step);
  }

  const host = {
    frame: STAGE,                                             // FLOOR etc. — identical across rooms
    get key(){ return key; },
    get group(){ return cur ? cur.group : null; },             // the live room's group (stage edit lifts its ceiling for the plan view; the director's shot solve sees its piers / graves)
    get room(){ return cur; },                                 // the live room object itself (dev probes: __dev.room())
    get footGroup(){ return foot().group; },                   // the live footing (the shot solve sees its towers: userData.boxes)
    get footing(){ return footPlan(); },                       // the plan (rooms/footing.js)
    get footBoxes(){ footPlan(); return boxes; },              // its envelopes (footingBoxes)
    set, place, prewarm,
    cycle(){ const k = set(ROOM_KEYS[(ROOM_KEYS.indexOf(key) + 1) % ROOM_KEYS.length], { announce: true }); save(k); return k; },
    /* a song's preferred room (song data `room` field). ?room and a pick made this session
       win; otherwise the song's room, and a song that names none returns to the viewer's
       remembered room (or the default) — so one song's staging never leaks into the next. */
    suggest(k){
      if (urlPick || userPicked) return;
      const want = (k && ROOM_KEYS.includes(k)) ? k : (remembered ?? 'grid');
      if (want !== key) set(want);
    },
    /* the song's weather (data): storm beats + sky phases, for rooms that stage them */
    cue(w){ weather = w; },
    /* WebXR: rooms may offer a lighter / comfier HEADSET variant via an optional xr(on) — the
       studio drops its per-eye mirror pass, the arena tames its blinders, the starship banks
       its sky less. Applied to the live room now and to any room set while presenting. */
    xr(on){ xrOn = !!on; if (cur && cur.xrOn !== xrOn){ cur.xr?.(xrOn); cur.xrOn = xrOn; } },
    update(dt, songTime, camera, energy){
      foot().update(songTime);                                 // the reactive edge (uniforms only)
      if (cur && cur.update) cur.update(dt, songTime, camera, energy, weather);
    },
    resize(w, h, pr){ for (const b of Object.values(built)) b.resize?.(w, h, pr); },
    dispose(){
      for (const b of Object.values(built)){ scene.remove(b.group); disposeTree(b.group); b.dispose?.(); }
      for (const k in foots) foots[k].f.dispose();
      scene.remove(footRoot); footMats?.dispose();
      tag.remove(); btn.remove(); warmRT?.dispose();
    },
  };
  return host;

}
