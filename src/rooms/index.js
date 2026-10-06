import * as THREE from 'three';
import { STAGE, disposeTree } from './common.js';
import grid from './grid.js';
import cathedral from './cathedral.js';
import studio from './studio.js';
import voidRoom from './void.js';
import graveyard from './graveyard.js';
/* ============================================================
   ROOM HOST — the one seam main.js talks to. A Room module is
       { key, label, build(scene, {envMap, renderer}) → {
           group, FLOOR, CEIL, HW, BACK, FRONT,      // surfaces + bounds (world y / x / z)
           fog: FogExp2, background: Color|Texture,  // atmosphere
           mood?: { ambient:[hex,int], hemi:[sky,ground,int] },   // re-tint the global fills
           place?(anchors),                          // anchor points: where things stand
           update?(dt, songTime, camera, energy, cues),   // pure-ish ambience; no allocation.
                                                     // cues = the song's weather (see cue())
           resize?(w, h, pixelRatio),                // render-target rooms (the studio mirror)
           dispose() } }
   Rooms are built LAZILY on first visit and CACHED (hidden, not destroyed), so
   cycling with R is instant after the first pass and shaders compile once.
   FLOOR is identical in every room (common.js — the floor contract), so a
   swap never rebuilds the song's world or restarts the timeline.
   'off' = no room: the original bare dark void + fog.
   Choosing: ?room=<key>  >  a pick made THIS session (R / ROOM)  >  the song's own
   `room` field (features-as-data; suggest())  >  the viewer's remembered pick
   (localStorage — it still opens the page and dresses songs that name no room)  >
   'grid'. So a song staged for its room (the October pack's graveyard) opens there
   even for a viewer who once pressed R, until they press it again. R cycles; on touch
   devices the ROOM button does the same (it sits UNDER the play veil, so it can
   never swallow the iOS priming tap — same rule as the free cam).
   ============================================================ */

export const ROOMS = [grid, cathedral, studio, voidRoom, graveyard];
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
      if (cur.place && cur.anchorGen !== anchorGen){ cur.place(anchors); cur.anchorGen = anchorGen; }
      cur.group.visible = true;
      fog.color.copy(cur.fog.color); fog.density = cur.fog.density;
      scene.background = cur.background; applyMood(cur.mood);
    }
    if (announce) flashTag(cur ? cur.label : 'no room');
    btnText();
    return key;
  }

  /* where things stand this song: [{x, z, w, d, yaw, y}] in world space (y = deck top).
     Only rooms that grow anchor geometry (the Void's plinths) care. */
  function place(list){
    anchors = list; anchorGen++;
    if (cur && cur.place){ cur.place(anchors); cur.anchorGen = anchorGen; }
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
    'color:#5a6178;font:11px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.2em;padding:6px;text-transform:uppercase';
  const btnText = () => { btn.textContent = 'ROOM: ' + (cur ? cur.label : 'none'); };
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
        /* a REAL render into a tiny offscreen target, room visible: compiles programs with the
           exact keys the composer's RenderPass will use (render-target → no tone-map/sRGB
           variant — renderer.compile() to the canvas would key them differently and the first
           visible frame would recompile), and uploads geometry + textures. */
        const prevBg = scene.background, vis = cur ? cur.group.visible : false;
        if (cur) cur.group.visible = false;
        b.group.visible = true; scene.background = b.background;
        try {
          warmRT ||= new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
          const prevRT = renderer.getRenderTarget();
          renderer.setRenderTarget(warmRT);
          renderer.compile(scene, camera);                       // everything, culled or not, keyed for a render target
          renderer.render(scene, camera);                        // + buffer uploads for what is in view
          const seen = new Set(), up = t => { if (t && t.isTexture && !seen.has(t)){ seen.add(t); renderer.initTexture(t); } };
          up(b.background);                                      // + every texture, in view or not (the void sky is 2048²)
          b.group.traverse(o => { for (const m of [].concat(o.material || [])){
            for (const v of Object.values(m)) up(v);
            if (m.uniforms) for (const u of Object.values(m.uniforms)) up(u.value); } });
          renderer.setRenderTarget(prevRT);
        } catch(e){}
        scene.background = prevBg; if (cur) cur.group.visible = vis;
        b.group.visible = false;
      }
      idle(step);
    };
    idle(step);
  }

  const host = {
    frame: STAGE,                                             // FLOOR etc. — identical across rooms
    get key(){ return key; },
    get group(){ return cur ? cur.group : null; },             // the live room's group (the director's shot solve sees its piers / graves)
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
    update(dt, songTime, camera, energy){ if (cur && cur.update) cur.update(dt, songTime, camera, energy, weather); },
    resize(w, h, pr){ for (const b of Object.values(built)) b.resize?.(w, h, pr); },
    dispose(){
      for (const b of Object.values(built)){ scene.remove(b.group); disposeTree(b.group); b.dispose?.(); }
      tag.remove(); btn.remove(); warmRT?.dispose();
    },
  };
  return host;

}
