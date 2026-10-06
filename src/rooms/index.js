import * as THREE from 'three';
import { STAGE, disposeTree } from './common.js';
import grid from './grid.js';
import cathedral from './cathedral.js';
import studio from './studio.js';
import voidRoom from './void.js';
/* ============================================================
   ROOM HOST — the one seam main.js talks to. A Room module is
       { key, label, build(scene, {envMap, renderer}) → {
           group, FLOOR, CEIL, HW, BACK, FRONT,      // surfaces + bounds (world y / x / z)
           fog: FogExp2, background: Color|Texture,  // atmosphere
           mood?: { ambient:[hex,int], hemi:[sky,ground,int] },   // re-tint the global fills
           place?(anchors),                          // anchor points: where things stand
           update?(dt, songTime, camera, energy),    // pure-ish ambience; no allocation
           dispose() } }
   Rooms are built LAZILY on first visit and CACHED (hidden, not destroyed), so
   cycling with R is instant after the first pass and shaders compile once.
   FLOOR is identical in every room (common.js — the floor contract), so a
   swap never rebuilds the song's world or restarts the timeline.
   'off' = no room: the original bare dark void + fog.
   ============================================================ */

export const ROOMS = [grid, cathedral, studio, voidRoom];
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

  function set(k, { announce = false } = {}){
    const R = ROOMS.find(r => r.key === k);
    if (cur) cur.group.visible = false;
    key = R ? k : 'off';
    if (!R){
      cur = null;
      fog.color.copy(BASE.fogColor); fog.density = BASE.fogDensity;
      scene.background = BASE.background; applyMood(null);
    } else {
      if (!built[k]){
        const b = R.build(scene, { envMap, renderer });
        if (b.FLOOR !== STAGE.FLOOR) console.warn(`room ${k}: FLOOR ${b.FLOOR} breaks the floor contract (${STAGE.FLOOR})`);
        b.anchorGen = -1; b.label = R.label;
        scene.add(b.group);
        built[k] = b;
      }
      cur = built[k];
      if (cur.place && cur.anchorGen !== anchorGen){ cur.place(anchors); cur.anchorGen = anchorGen; }
      cur.group.visible = true;
      fog.color.copy(cur.fog.color); fog.density = cur.fog.density;
      scene.background = cur.background; applyMood(cur.mood);
    }
    if (announce) flashTag(cur ? cur.label : 'no room');
    return key;
  }

  /* where things stand this song: [{x, z, w, d, yaw, y}] in world space (y = deck top).
     Only rooms that grow anchor geometry (the Void's plinths) care. */
  function place(list){
    anchors = list; anchorGen++;
    if (cur && cur.place){ cur.place(anchors); cur.anchorGen = anchorGen; }
  }

  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('room') : null;
  set(initial ?? (q && ROOM_KEYS.includes(q) ? q : 'grid'));

  return {
    frame: STAGE,                                             // FLOOR etc. — identical across rooms
    get key(){ return key; },
    set, place,
    cycle(){ return set(ROOM_KEYS[(ROOM_KEYS.indexOf(key) + 1) % ROOM_KEYS.length], { announce: true }); },
    update(dt, songTime, camera, energy){ if (cur && cur.update) cur.update(dt, songTime, camera, energy); },
    dispose(){ for (const b of Object.values(built)){ scene.remove(b.group); disposeTree(b.group); b.dispose?.(); } },
  };
}
