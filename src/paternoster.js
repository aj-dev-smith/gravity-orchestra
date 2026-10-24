import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ============================================================
   THE BELT'S PARTS KIT (render subsystem, THREE only). What is left of the
   PATERNOSTER — the classic belt body (one machine per voice: two open roller
   chains between a top and a bottom housing, the tone-plates on carrier rods),
   retired 2026-10-24 when the JUGGLER (src/jugglebelt.js) became THE belt.
   The juggler is built from these parts and dimensions, so it keeps the family
   look: the glockenspiel TONE-PLATE (makeToneBarParts), its brass node CRADLE,
   the chain SPROCKET and drive GEAR, the housing window's warm wash, and the
   merge / still-bake helpers.

   HONESTY (the contract the original belt wall set): the machine only draws what
   the math implies — a chain scrolls at DESCENT because every plate rises at
   DESCENT; a shaft turns at DESCENT / r of its sprocket. Render-time only — the
   engine is never touched.
   ============================================================ */

/* the open run between the housings: band ± LIP */
export const PT = {
  LIP:    7.0,     // housing faces: band ± LIP — the open run between them
};

const CZ     = -2.2;   // front (rising) chain strand depth
const RC     = .5;     // chain-sprocket pitch radius → back strand at CZ − 2·RC
const TEETH  = 14;     // sprocket teeth; the chain pitch is 2π·RC / TEETH so links seat in the valleys
const SPROCK = 8.85;   // chain sprocket centres at ≈ band ± SPROCK (snapped to whole links)
const SKIRT  = 8.2;    // solid skirt LIP → SKIRT hides the stowing plates; above it the open window
const CROWN  = 9.55;   // window top / crown underside
const FRONT  = -.6;    // housing front face — behind every ball
const BACK   = -3.9;
const END    = .4;     // housing overhang past the chains
const GEAR_R = .95;    // outboard drive gear (same shaft as the chain sprocket)
const COL_W  = .26;
const HUB_BACK = .3;   // a tone-plate cradle's hub, under the bar (cradleGeometry)

/* the machine's shared dimensions — the belt (src/jugglebelt.js) builds its housings, chains
   and sprockets from these numbers */
export const PTGEO = { CZ, RC, TEETH, SPROCK, SKIRT, CROWN, FRONT, BACK, END, GEAR_R, COL_W, HUB_BACK };

/* merge anything (indexed or not) — normalise to non-indexed position/normal/uv first */
export function merge(list){
  const flat = list.map(g => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(f.attributes)) if (!['position', 'normal', 'uv'].includes(k)) f.deleteAttribute(k);
    return f;
  });
  const out = mergeGeometries(flat);
  list.forEach(g => g.dispose()); flat.forEach(g => g.dispose());
  return out;
}
/* bake still meshes (direct children of group) into one mesh per material — same look, one draw */
export function bakeStill(group, list){
  const by = new Map();
  for (const o of list){
    const k = o.material.uuid + '|' + ('uv' in o.geometry.attributes) + '|' + ('normal' in o.geometry.attributes);
    (by.get(k) || by.set(k, []).get(k)).push(o);
  }
  for (const objs of by.values()){
    if (objs.length < 2) continue;
    const geo = merge(objs.map(o => { o.updateMatrix(); return o.geometry.clone().applyMatrix4(o.matrix); }));
    if (!geo) continue;
    const m = new THREE.Mesh(geo, objs[0].material); m.name = 'merged-static';
    objs.forEach(o => group.remove(o));
    group.add(m);
  }
}
const ZAXIS = new THREE.Vector3(0, 0, 1);

/* ---- TONE-PLATE: a glockenspiel bar (it replaced the old disc pad). Length along local x,
   inside the pad's catch circle (half-length .55 < PAD_R). Brass pins at the two vibration
   NODES (22.4% in from each end — where a real bar is supported); the cradle holds the bar
   exactly there. Built in the plate's local frame (up = +y); the belt scales it by the
   note's radius (juggle.js: radOf / PAD_R), so size stays a pure fn of the note. ---- */
export const BAR = { L: 1.1, T: .12, W: .44 };
export const NODE_X = BAR.L / 2 - .224 * BAR.L;
export function makeToneBarParts({ envMap }){
  const barGeo = new RoundedBoxGeometry(BAR.L, BAR.T, BAR.W, 2, .045);
  // rim = a glowing frame hugging the bar's top edge (the old torus's job: hue + prog² anticipation)
  const rr = (w, h, r) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };
  const outer = rr(BAR.L + .1, BAR.W + .1, .09);
  outer.holes.push(rr(BAR.L - .06, BAR.W - .06, .04));
  const rimGeo = new THREE.ShapeGeometry(outer, 6);
  rimGeo.rotateX(-Math.PI / 2);                          // lie in the bar's top plane, facing +y
  const pins = [-1, 1].map(s => new THREE.CylinderGeometry(.045, .045, .03, 12).translate(s * NODE_X, BAR.T / 2 + .012, 0));
  const pinGeo = merge(pins);
  const brass = new THREE.MeshStandardMaterial({ color: 0xd2a04a, metalness: 1, roughness: .28, envMap, envMapIntensity: 1.3 });
  return { barGeo, rimGeo, pinGeo, brass };
}

/* A toothed drive gear with five spoke windows, axis along x (baked). */
export function gearGeometry(R, teeth, thick){
  const s = new THREE.Shape(), rIn = R * .86, n = teeth * 4;
  for (let i = 0; i <= n; i++){
    const a = i / n * Math.PI * 2, ph = i % 4;
    const r = (ph === 1 || ph === 2) ? R : rIn;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const rimIn = R * .7, hubR = R * .28;
  for (let k = 0; k < 5; k++){                        // spoke windows (annular sectors)
    const a0 = k / 5 * Math.PI * 2 + .2, a1 = (k + 1) / 5 * Math.PI * 2 - .2;
    const h = new THREE.Path();
    h.absarc(0, 0, rimIn, a0, a1, false);
    h.absarc(0, 0, hubR, a1 - .05, a0 + .05, true);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);                              // axis → x
  return g;
}

/* the window's back wall: a warm wash, hot at the sill, falling to dark under the crown,
   with faint vertical panel seams (both mirrored housings flip it via their own UVs) */
export function warmTex(){
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.35, '#6a6a6a'); gr.addColorStop(1, '#0c0c0c');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 128);
  x.fillStyle = 'rgba(0,0,0,.45)'; for (let i = 0; i < 64; i += 16) x.fillRect(i, 0, 2, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(6, 1);
  return t;
}

/* A chain sprocket at pitch radius rc: the roller SEATS (valleys) sit at shape angles
   k·2π/N, teeth between them; a five-spoke web. Axis along x (baked, like the gear). */
export function sprocketGeometry(rc, N, thick){
  const s = new THREE.Shape(), M = 10, rv = rc - .05, rt = rc + .1;
  for (let k = 0; k < N; k++){
    for (let j = 0; j < M; j++){
      const f = j / M, a = (k + f) / N * Math.PI * 2;
      const d = Math.abs(f - .5);                       // 0 at the tooth tip, .5 at a valley
      const r = d > .3 ? rv + (rc - rv) * (1 - Math.cos((.5 - d) / .2 * Math.PI / 2)) * .4
              : d > .14 ? rc + (rt - rc) * (.3 - d) / .16 : rt;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      (k || j) ? s.lineTo(x, y) : s.moveTo(x, y);
    }
  }
  for (let k = 0; k < 5; k++){
    const a0 = k / 5 * Math.PI * 2 + .22, a1 = (k + 1) / 5 * Math.PI * 2 - .22;
    const h = new THREE.Path();
    h.absarc(0, 0, rc * .72, a0, a1, false);
    h.absarc(0, 0, rc * .3, a1 - .05, a0 + .05, true);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/* The brass V-cradle under a tone-plate, in the plate's local frame scaled to world:
   a hub under the bar and two posts up to the vibration nodes. */
export function cradleGeometry(s){
  const hub = new THREE.Vector3(0, -HUB_BACK, 0), geos = [];
  for (const sx of [-1, 1]){
    const node = new THREE.Vector3(sx * NODE_X * s, -BAR.T / 2 * s, 0);
    geos.push(strut(hub, node, .05));
  }
  geos.push(new THREE.SphereGeometry(.07, 12, 8).translate(0, -HUB_BACK, 0));
  const g = merge(geos);
  return g;
}
export function strut(a, b, w){
  const dir = b.clone().sub(a), len = dir.length() || 1e-3;
  const geo = new THREE.BoxGeometry(w, w, len);
  const q = new THREE.Quaternion().setFromUnitVectors(ZAXIS, dir.clone().normalize());
  return geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, .5), q, new THREE.Vector3(1, 1, 1)));
}
