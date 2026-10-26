import * as THREE from 'three';
import { FOOT, railed } from './footing.js';
import { makePulse } from './pulse.js';
/* ============================================================
   FOOTING 3D — the render KIT for rooms/footing.js's plan: what every machine stands on.

     buildFooting(plan, style, ctx) → { group, update(songTime), dispose(), ms }

   Everything the kit draws is written straight into ONE buffer per material SLOT ('base' concrete,
   'steel', 'deck' plate — a style may add its own) and merged: the whole song's footing costs one
   draw per slot, plus ONE for every machine's glowing EDGE. It is rebuilt (a few ms) whenever the
   anchors change — the stage editor drags a height live — and per room (each styles its own).

   The forms, by band (footing.js): FLUSH a concrete plinth under a steel cap; LOW a dais of the
   same, climbed by a stepped stair hugging one side; MID a deck on braced steel legs, guard-railed,
   with a stair or a ladder; HIGH a deck on box-truss columns and truss beams, tied and braced, rails
   all round, climbed by a caged ladder that rests on a landing every LAND_DY; a LOFT one shared deck
   (and one structure) for neighbours at one height; an OPEN stand (something hangs below what the
   machine rests on — the turntable's resonator rank): a post under every foot, beams and braces
   kept out of what hangs. The belt keeps its own posts: a low kerb under them.
   Scale: 1 u ≈ .677 m — a stair rise ≈ .28, a guard rail 1.5, ladder rungs .45 apart.

   THE EDGE: a strip of the machine's colour round its pad (under the plinth's cap, on a deck's
   fascia, as tape round its spot on a loft, on the floor round an open stand) that answers its own
   strikes — rooms/pulse.js over the anchor's cue, a pure fn of songTime, one uniform array slot per
   pad (pad.pulse), so every machine's edge is the same single draw. A dim outline at rest, an accent
   on a strike — never a strobe (a dense run holds a steady light).

   A room STYLE: { mats?(kit, ctx) → { slot: Material }, flush?, low?, mid?, high?, loft?, edge? }
   — mats: materials for the kit's slots (or new slots) — the ROOM's: it may cache them, the footing
   never disposes them; each form hook (spec, kit) → Object3D | null (null: the kit's own form;
   spec.open: keep it open; edge: a pad's light — anything non-null and the form draws no strip).
   A hook may write into the merged slots itself (kit.frame is set to its spec; kit.box / bar / edge;
   kit.forms.* are the defaults, kit.DIM their sizes) and return an empty Group. Whatever a style
   draws stays inside footingBoxes(plan): the envelope the shot solve keeps an eye out of.
   DEFAULT_STYLE (every form the kit's own) is what room 'off' and every unstyled room shows. Every
   footing mesh carries userData.footing = true; each merged one carries userData.boxes — the
   envelopes of the supports it has a part in (ctx.boxes: rooms/index.js hands them to the shot solve
   — an eye is never solved inside a tower, a ray through one raycasts its real bars).
   ============================================================ */

export const DEFAULT_STYLE = Object.freeze({ key: 'default' });

const DIM = {
  CAP: .06,                                   // a plinth's steel cap plate
  DECK: .32, DECK_HI: .38,                    // a platform's deck slab · a tower's / loft's
  LEG: .34, LEG_IN: .32, LEG_SPAN: 5.5,       // platform legs (≈ 23 cm box section): inset, most apart
  COL: .82, COL_IN: .6, COL_SPAN: 14,         // a box-truss column's width, inset, most apart
  CHORD: .11, LACE: .055, PITCH: 1.05,        // its chords, lacing, zig pitch
  BEAM: .62, BEAM_W: .46,                     // a truss beam under the deck: depth, width
  BRACE: .085,                                // a brace bar
  POST: .08, BAR: .07, RAIL_SPAN: 2.2, TOE: .16,   // guard rails
  STILE: .09, RUNG: .05, RUNG_DY: .45, LAD_HALF: .33, LAD_OUT: .34,   // ladders
  EDGE: .09, EDGE_OUT: .02,                   // the glowing strip: height, how proud of its face
  WELL: .04,                                  // a deck's least depth under a machine's deepest dip (footing.js well)
  OPEN_TIER: 6,                               // an open stand's posts: tied + X-braced every ≤ this (a tall one reads braced)
};
/* a raised support's deck depth: its band's slab, or deeper where its machine dips into it (the kit's
   pistons stroke under its deck slab — footing.js pad.well) — what dips stays inside the deck plate */
export const deckDepth = r => Math.max(r.keys || r.band === 'high' ? DIM.DECK_HI : DIM.DECK, (r.well || 0) + DIM.WELL);
const RAIL_H = FOOT.RAIL, HAND = 1.3;          // guard rail · stair handrail (over the nosing line)

/* ---- the default materials (one set per room host: shared by every footing it builds) ---- */
function concreteTex(){
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#80838a'; x.fillRect(0, 0, 256, 256);
  let s = 7; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++){                                     // soft mottling
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1), cx = R() * 256, cy = R() * 256, r = 18 + R() * 50, a = .05 + R() * .06;
    g.addColorStop(0, `rgba(${R() < .5 ? '40,42,48' : '170,172,178'},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]){ x.save(); x.translate(cx + ox, cy + oy); x.scale(r, r); x.fillStyle = g; x.fillRect(-1, -1, 2, 2); x.restore(); }
  }
  for (let i = 0; i < 2600; i++){ const v = R() < .5 ? 50 : 190; x.fillStyle = `rgba(${v},${v},${v + 4},${.05 + R() * .08})`; x.fillRect(R() * 256, R() * 256, 1 + R() * 1.4, 1 + R() * 1.4); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
export function makeFootingMats({ envMap = null } = {}){
  const tex = concreteTex();
  return {
    // (painted steel, not chrome: a dark room's env would turn a mirror-steel scaffold into a silhouette)
    // (the concrete's colour MULTIPLIES its grain, itself a mid grey ≈ .22 linear: a light tint keeps it
    //  concrete — ≈ .14 albedo; the old mid-grey tint left ≈ .03, a black box in every dim room)
    base: new THREE.MeshStandardMaterial({ color: 0xc8cbd2, map: tex, roughness: .92, metalness: .02 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x7c8594, metalness: .45, roughness: .48, envMap, envMapIntensity: .6 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x353a44, metalness: .4, roughness: .6, envMap, envMapIntensity: .4 }),
    edge: edgeMat(),
    dispose(){ tex?.dispose(); for (const k of ['base', 'steel', 'deck', 'edge']) this[k].dispose(); },
  };
}
/* A room's TINT of the kit (a room's build() → `footing`): the default forms in the room's own materials —
   { base?, steel?, deck? }, each MeshStandardMaterial params; `grain: true` keeps the kit's concrete grain
   on it (its map: the colour multiplies a ≈ .22 linear grey). Made once, on first use (the host's env
   map), shared by every footing the room builds; the room disposes them (style.dispose()). */
export function tintStyle({ key = 'tint', ...spec }){
  let made = null;
  return {
    key,
    mats(kit, ctx = {}){
      if (made) return made;
      made = {};
      for (const slot of ['base', 'steel', 'deck']){
        if (!spec[slot]) continue;
        const { grain, ...p } = spec[slot];
        made[slot] = new THREE.MeshStandardMaterial({ map: grain ? kit.mats[slot]?.map ?? null : null, envMap: ctx.envMap ?? null, envMapIntensity: .5, ...p });
      }
      return made;
    },
    dispose(){ if (made) for (const m of Object.values(made)) m.dispose(); made = null; },
  };
}
/* the reactive edge: additive, unlit, fog-free; each vertex reads its machine's slot of uPulse */
function edgeMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: new Float32Array(FOOT.MAX_PULSE) }, uBase: { value: .16 }, uGain: { value: 1.15 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPulse;
      uniform float uPulse[${FOOT.MAX_PULSE}]; uniform float uBase, uGain;
      varying vec3 vC;
      void main(){
        vC = aColor * (uBase + uGain * uPulse[int(aPulse + .5)]);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){
        gl_FragColor = vec4(vC, 1.);                           // additive (SrcAlpha·One): adds vC
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/* ---- the WRITER: growable buffers, quads with flat normals + world-space (box-projected) uvs ---- */
export function newBuf(edge = false){
  return { edge, p: new Float32Array(3 * 2048), n: edge ? null : new Float32Array(3 * 2048), uv: edge ? null : new Float32Array(2 * 2048),
           c: edge ? new Float32Array(3 * 2048) : null, k: edge ? new Float32Array(2048) : null, i: new Uint32Array(3 * 2048), nv: 0, ni: 0 };
}
function grow(b, nv, ni){
  if ((b.nv + nv) * 3 > b.p.length){
    const cap = Math.max(b.p.length * 2, (b.nv + nv) * 3);
    const up = (a, per) => { if (!a) return a; const q = new Float32Array(cap / 3 * per); q.set(a); return q; };
    b.p = up(b.p, 3); b.n = up(b.n, 3); b.uv = up(b.uv, 2); b.c = up(b.c, 3); b.k = up(b.k, 1);
  }
  if (b.ni + ni > b.i.length){ const q = new Uint32Array(Math.max(b.i.length * 2, b.ni + ni)); q.set(b.i); b.i = q; }
}
const UVK = .25;                                                     // a 4 u texture tile
/* one quad a b c d (counter-clockwise seen from its normal n) */
export function quad(b, P, nx, ny, nz, col, pulse){
  grow(b, 4, 6);
  const v = b.nv, ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  for (let j = 0; j < 4; j++){
    const x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2], o = (v + j) * 3;
    b.p[o] = x; b.p[o + 1] = y; b.p[o + 2] = z;
    if (b.n){ b.n[o] = nx; b.n[o + 1] = ny; b.n[o + 2] = nz;
      const q = (v + j) * 2;
      if (ay >= ax && ay >= az){ b.uv[q] = x * UVK; b.uv[q + 1] = z * UVK; }
      else if (ax >= az){ b.uv[q] = z * UVK; b.uv[q + 1] = y * UVK; }
      else { b.uv[q] = x * UVK; b.uv[q + 1] = y * UVK; } }
    if (b.c){ b.c[o] = col.r; b.c[o + 1] = col.g; b.c[o + 2] = col.b; b.k[v + j] = pulse; }
  }
  const i = b.ni; b.i[i] = v; b.i[i + 1] = v + 1; b.i[i + 2] = v + 2; b.i[i + 3] = v; b.i[i + 4] = v + 2; b.i[i + 5] = v + 3;
  b.nv += 4; b.ni += 6;
}
/* faces of a box, by its own axes */
const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;
const _P = new Float32Array(12);
/* an oriented box: centre c, half-axes X, Y, Z (right-handed: X × Y ∥ +Z) — six faces, or those in `faces` */
function obox(b, cx, cy, cz, X, Y, Z, faces, col, pulse){
  const put = (j, sx, sy, sz) => { _P[j * 3] = cx + sx * X[0] + sy * Y[0] + sz * Z[0]; _P[j * 3 + 1] = cy + sx * X[1] + sy * Y[1] + sz * Z[1]; _P[j * 3 + 2] = cz + sx * X[2] + sy * Y[2] + sz * Z[2]; };
  const nrm = (A, k) => { const L = Math.hypot(A[0], A[1], A[2]) || 1; return [k * A[0] / L, k * A[1] / L, k * A[2] / L]; };
  const face = (n, s) => { quad(b, _P, n[0], n[1], n[2], col, pulse); };
  if (faces & PY){ put(0, -1, 1, -1); put(1, -1, 1, 1); put(2, 1, 1, 1); put(3, 1, 1, -1); face(nrm(Y, 1)); }
  if (faces & NY){ put(0, -1, -1, -1); put(1, 1, -1, -1); put(2, 1, -1, 1); put(3, -1, -1, 1); face(nrm(Y, -1)); }
  if (faces & PX){ put(0, 1, -1, -1); put(1, 1, 1, -1); put(2, 1, 1, 1); put(3, 1, -1, 1); face(nrm(X, 1)); }
  if (faces & NX){ put(0, -1, -1, -1); put(1, -1, -1, 1); put(2, -1, 1, 1); put(3, -1, 1, -1); face(nrm(X, -1)); }
  if (faces & PZ){ put(0, -1, -1, 1); put(1, 1, -1, 1); put(2, 1, 1, 1); put(3, -1, 1, 1); face(nrm(Z, 1)); }
  if (faces & NZ){ put(0, -1, -1, -1); put(1, -1, 1, -1); put(2, 1, 1, -1); put(3, 1, -1, -1); face(nrm(Z, -1)); }
}
export function toGeometry(b){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(b.p.slice(0, b.nv * 3), 3));
  if (b.n){ g.setAttribute('normal', new THREE.BufferAttribute(b.n.slice(0, b.nv * 3), 3)); g.setAttribute('uv', new THREE.BufferAttribute(b.uv.slice(0, b.nv * 2), 2)); }
  if (b.c){ g.setAttribute('aColor', new THREE.BufferAttribute(b.c.slice(0, b.nv * 3), 3)); g.setAttribute('aPulse', new THREE.BufferAttribute(b.k.slice(0, b.nv), 1)); }
  g.setIndex(new THREE.BufferAttribute(b.nv < 65536 ? Uint16Array.from(b.i.subarray(0, b.ni)) : b.i.slice(0, b.ni), 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* ---- the KIT: a local frame (a pad's / loft's rect) + boxes, bars and glowing strips written in it ---- */
function makeKit({ floor, mats, plan }){
  const bufs = {}, edgeBuf = newBuf(true);
  let FX = 0, FZ = 0, FC = 1, FS = 0, unit = null;
  const W = (u, v) => [FX + FC * u + FS * v, FZ - FS * u + FC * v];
  // (each slot remembers whose support it holds parts of: its mesh's envelopes for the shot solve)
  const buf = slot => { const b = bufs[slot] || (bufs[slot] = newBuf()); (b.units ||= new Set()).add(unit); return b; };
  const _c = new THREE.Color();
  const kit = {
    floor, mats, plan, THREE, DIM,
    /** write in this rect's frame (x, z, yaw) — null: the world's. Its parts belong to its support
        (a loft member's to its loft) */
    frame(r){ FX = r ? r.x : 0; FZ = r ? r.z : 0; FC = Math.cos(r?.yaw || 0); FS = Math.sin(r?.yaw || 0);
      unit = r ? r.loft || r.id || r.key : null; return kit; },
    /** local (u, v) → world [x, z] */
    w: W,
    /** a box in the frame: u0..u1 × y0..y1 × v0..v1 */
    box(slot, u0, u1, y0, y1, v0, v1, faces = ALL){
      if (!(u1 > u0 && y1 > y0 && v1 > v0)) return;
      const [cx, cz] = W((u0 + u1) / 2, (v0 + v1) / 2), hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
      obox(buf(slot), cx, (y0 + y1) / 2, cz, [FC * hu, 0, -FS * hu], [0, (y1 - y0) / 2, 0], [FS * hv, 0, FC * hv], faces);
    },
    /** a square-section bar from a to b ([u, y, v] in the frame), w wide (across, level) × d deep */
    bar(slot, a, b, w, d = w, faces = SIDES){
      const [ax, az] = W(a[0], a[2]), [bx, bz] = W(b[0], b[2]);
      barW(buf(slot), ax, a[1], az, bx, b[1], bz, w, d, faces);
    },
    /** a glowing strip (the machine's colour, its pulse slot): a box in the frame, no underside */
    edge(u0, u1, y0, y1, v0, v1, color, pulse, faces = NOBOT){
      if (!(u1 > u0 && y1 > y0 && v1 > v0)) return;
      _c.set(color ?? '#8fa6c8');
      const [cx, cz] = W((u0 + u1) / 2, (v0 + v1) / 2), hu = (u1 - u0) / 2, hv = (v1 - v0) / 2;
      obox(edgeBuf, cx, (y0 + y1) / 2, cz, [FC * hu, 0, -FS * hu], [0, (y1 - y0) / 2, 0], [FS * hv, 0, FC * hv], faces, _c, pulse);
    },
    forms: null, ownEdge: new Set(),                 // (pads whose light the style drew itself)
    _bufs: bufs, _edge: edgeBuf,
  };
  kit.forms = makeForms(kit);
  return kit;
}
function barW(b, ax, ay, az, bx, by, bz, w, d, faces){
  let ex = bx - ax, ey = by - ay, ez = bz - az;
  const L = Math.hypot(ex, ey, ez); if (L < 1e-6) return;
  ex /= L; ey /= L; ez /= L;
  // across: level and square to the bar (a vertical bar: world x)
  let px = -ez, pz = ex, pl = Math.hypot(px, pz);
  if (pl < 1e-4){ px = 1; pz = 0; pl = 1; }
  px /= pl; pz /= pl;
  // X = across, Y = along, Z = X × Y (right-handed)
  const zx = 0 * ez - pz * ey, zy = pz * ex - px * ez, zz = px * ey - 0 * ex;
  obox(b, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, [px * w / 2, 0, pz * w / 2], [ex * L / 2, ey * L / 2, ez * L / 2], [zx * d / 2, zy * d / 2, zz * d / 2], faces);
}

/* points round a rect's perimeter (±hu, ±hv), corners included, at most `span` apart — in order */
export function ring(hu, hv, span){
  const nu = Math.max(1, Math.ceil(2 * hu / span - 1e-9)), nv = Math.max(1, Math.ceil(2 * hv / span - 1e-9)), out = [];
  for (let i = 0; i < nu; i++) out.push([-hu + 2 * hu * i / nu, -hv]);
  for (let i = 0; i < nv; i++) out.push([hu, -hv + 2 * hv * i / nv]);
  for (let i = 0; i < nu; i++) out.push([hu - 2 * hu * i / nu, hv]);
  for (let i = 0; i < nv; i++) out.push([-hu, hv - 2 * hv * i / nv]);
  return out;
}
/* (along a, out o) on one side of a rect → local [u, v] */
export const onSide = (r, side) => { const k = side[0] === '+' ? 1 : -1;
  return side[1] === 'u' ? (a, o) => [k * (r.hw + o), a] : (a, o) => [a, k * (r.hd + o)]; };
/* does the segment p → q (local u, v) cross the rect [u0, u1, v0, v1] grown by g? (slab clip) */
function segHits(p, q, R, g){
  if (!R) return false;
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]], lo = [R[0] - g, R[2] - g], hi = [R[1] + g, R[3] + g];
  for (let k = 0; k < 2; k++){
    if (Math.abs(d[k]) < 1e-12){ if (p[k] < lo[k] || p[k] > hi[k]) return false; continue; }
    let a = (lo[k] - p[k]) / d[k], b = (hi[k] - p[k]) / d[k]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
  }
  return true;
}

/* ---- the default FORMS (all in the pad's / loft's frame — the caller sets it) ---- */
function makeForms(k){
  const F = k.floor;
  /* a slab's glowing strip: four runs just proud of its faces (y0..y1), round u0..u1 × v0..v1 */
  function band(u0, u1, v0, v1, y0, y1, col, pulse){
    if (k.skipEdge) return;
    const o = DIM.EDGE_OUT;
    k.edge(u0 - o, u1 + o, y0, y1, v1 - .01, v1 + o, col, pulse, PY | PZ | PX | NX);
    k.edge(u0 - o, u1 + o, y0, y1, v0 - o, v0 + .01, col, pulse, PY | NZ | PX | NX);
    k.edge(u1 - .01, u1 + o, y0, y1, v0, v1, col, pulse, PY | PX);
    k.edge(u0 - o, u0 + .01, y0, y1, v0, v1, col, pulse, PY | NX);
  }
  /* tape on a surface at y: a thin ring round u0..u1 × v0..v1 */
  function tape(u0, u1, v0, v1, y, col, pulse, w = .07){
    if (k.skipEdge) return;
    k.edge(u0, u1, y + .004, y + .03, v1 - w, v1, col, pulse); k.edge(u0, u1, y + .004, y + .03, v0, v0 + w, col, pulse);
    k.edge(u0, u0 + w, y + .004, y + .03, v0 + w, v1 - w, col, pulse); k.edge(u1 - w, u1, y + .004, y + .03, v0 + w, v1 - w, col, pulse);
  }
  /* a solid block under a steel cap, its strip tucked under the cap's lip (plinth / dais / the belt's kerb) */
  function block(r, T, col, pulse){
    const hw = r.hw, hd = r.hd, cap = Math.min(DIM.CAP, (T - F) * .4);
    k.box('base', -hw + .03, hw - .03, F - .04, T - cap, -hd + .03, hd - .03, NOBOT);
    k.box('steel', -hw, hw, T - cap, T, -hd, hd, NOBOT);
    const y1 = T - cap - .02, y0 = Math.max(F + .02, y1 - DIM.EDGE);
    band(-hw + .03 + .005, hw - .03 - .005, -hd + .03 + .005, hd - .03 - .005, y0, y1, col, pulse);
  }
  /* a deck slab (deck plate, a steel nosing along its top edge) with its strip on the fascia */
  function deck(r, T, D, col, pulse, strip = true){
    const hw = r.hw, hd = r.hd;
    k.box('deck', -hw, hw, T - D, T - .03, -hd, hd);
    k.box('steel', -hw - .015, hw + .015, T - .03, T, -hd - .015, hd + .015, PY | PX | NX | PZ | NZ);
    if (strip) band(-hw, hw, -hd, hd, T - D + .07, T - D + .07 + DIM.EDGE, col, pulse);
  }
  /* guard rails round a deck at T (inset .1), with a gap over [g0, g1] along the access side */
  function rails(r, T, gapSide = null, g0 = 0, g1 = 0){
    const hu = r.hw - .1, hv = r.hd - .1;
    const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
    for (const [side, p, q] of runs){
      // the along-coordinate of each end: ±v sides run along u, ±u sides along v
      const al = pt => side[1] === 'u' ? pt[1] : pt[0];
      const segs = [];
      if (side === gapSide){
        const a0 = al(p), a1 = al(q), lo = Math.min(a0, a1), hi = Math.max(a0, a1);
        const cut = (x, y) => [side[1] === 'u' ? p[0] : x, side[1] === 'u' ? x : p[1], y];
        if (g0 - .05 > lo + .3) segs.push([cut(lo, 0), cut(g0 - .05, 0)]);
        if (g1 + .05 < hi - .3) segs.push([cut(g1 + .05, 0), cut(hi, 0)]);
        for (const s of segs) for (const e of s) e.length = 2;
      } else segs.push([p, q]);
      for (const [a, b] of segs) railRun(a, b, T);
    }
  }
  function railRun(a, b, T){
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .2) return;
    const n = Math.max(1, Math.ceil(L / DIM.RAIL_SPAN));
    for (let i = 0; i <= n; i++){ const t = i / n, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      k.box('steel', u - DIM.POST / 2, u + DIM.POST / 2, T, T + RAIL_H, v - DIM.POST / 2, v + DIM.POST / 2, SIDES | PY); }
    k.bar('steel', [a[0], T + RAIL_H - DIM.BAR / 2, a[1]], [b[0], T + RAIL_H - DIM.BAR / 2, b[1]], DIM.BAR, DIM.BAR, ALL);
    k.bar('steel', [a[0], T + RAIL_H / 2, a[1]], [b[0], T + RAIL_H / 2, b[1]], DIM.BAR * .8, DIM.BAR * .8);
    k.bar('deck', [a[0], T + DIM.TOE / 2, a[1]], [b[0], T + DIM.TOE / 2, b[1]], .03, DIM.TOE);
  }
  /* braced steel legs under a deck (bottom at yB): a ring of legs, a beam round the top, a tie at the
     foot, X-braces in every bay (stacked panels on a tall one) */
  function legs(r, yB){
    const hu = r.hw - DIM.LEG_IN, hv = r.hd - DIM.LEG_IN, P = ring(hu, hv, DIM.LEG_SPAN), L = DIM.LEG, H = yB - F;
    for (const [u, v] of P){
      k.box('steel', u - L / 2, u + L / 2, F, yB, v - L / 2, v + L / 2, SIDES);
      k.box('steel', u - .29, u + .29, F, F + .05, v - .29, v + .29, NOBOT);              // base plate
    }
    const yBeam = yB - .3, yTie = F + .32;
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i + 1) % P.length];
      k.bar('steel', [a[0], yB - .15, a[1]], [b[0], yB - .15, b[1]], .2, .3, ALL);       // the beam under the deck
      if (H < 1.6) continue;
      k.bar('steel', [a[0], yTie, a[1]], [b[0], yTie, b[1]], .13, .13);
      const S = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round((yBeam - yTie) / Math.max(2.2, S * .9)));
      for (let j = 0; j < n; j++){
        const y0 = yTie + (yBeam - yTie) * j / n, y1 = yTie + (yBeam - yTie) * (j + 1) / n;
        if (j) k.bar('steel', [a[0], y0, a[1]], [b[0], y0, b[1]], .11, .11);
        k.bar('steel', [a[0], y0, a[1]], [b[0], y1, b[1]], DIM.BRACE, DIM.BRACE * .6);
        k.bar('steel', [b[0], y0, b[1]], [a[0], y1, a[1]], DIM.BRACE, DIM.BRACE * .6);
      }
    }
  }
  /* a box-truss column (four chords, zig-zag lacing on every face, end plates) at (u, v), y0 → y1 */
  function column(u, v, y0, y1){
    const h = DIM.COL / 2, c = DIM.CHORD, Hc = y1 - y0;
    const C = [[u - h, v - h], [u + h, v - h], [u + h, v + h], [u - h, v + h]];
    for (const [x, z] of C) k.box('steel', x - c / 2, x + c / 2, y0 + .06, y1 - .06, z - c / 2, z + c / 2, SIDES);
    k.box('steel', u - h - .14, u + h + .14, y0, y0 + .07, v - h - .14, v + h + .14, NOBOT);   // foot plate
    k.box('steel', u - h - .08, u + h + .08, y1 - .07, y1, v - h - .08, v + h + .08, ALL);     // head plate
    const n = Math.max(1, Math.round((Hc - .14) / DIM.PITCH)), dy = (Hc - .14) / n;
    for (let f = 0; f < 4; f++){
      const A = C[f], B = C[(f + 1) % 4];
      for (let j = 0; j < n; j++){
        const ya = y0 + .07 + j * dy, [p, q] = (j + f) % 2 ? [A, B] : [B, A];
        k.bar('steel', [p[0], ya, p[1]], [q[0], ya + dy, q[1]], DIM.LACE, DIM.LACE);
      }
    }
  }
  /* a truss beam between two column heads a → b ([u, v]), its top at yT, depth DIM.BEAM */
  function beam(a, b, yT){
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < DIM.COL + .2) return;
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx, h = DIM.BEAM_W / 2, c = DIM.CHORD * .9;
    const s0 = DIM.COL / 2 + .02, s1 = L - DIM.COL / 2 - .02, yb = yT - DIM.BEAM, yc = [yb + c / 2, yT - c / 2];
    const P = (s, o, y) => [a[0] + dx * s + nx * o, y, a[1] + dz * s + nz * o];
    for (const o of [-h, h]) for (const y of yc) k.bar('steel', P(s0, o, y), P(s1, o, y), c, c, ALL);
    const n = Math.max(1, Math.round((s1 - s0) / (DIM.BEAM * 1.1))), ds = (s1 - s0) / n;
    for (const o of [-h, h]) for (let j = 0; j < n; j++){
      const sa = s0 + j * ds, [y0, y1] = j % 2 ? [yc[0], yc[1]] : [yc[1], yc[0]];
      k.bar('steel', P(sa, o, y0), P(sa + ds, o, y1), DIM.LACE, DIM.LACE);
    }
  }
  /* box-truss columns round a deck (bottom at yB): truss beams between their heads, ties + braces at
     the landing levels */
  function trussFrame(r, yB, levels){
    const hu = r.hw - DIM.COL_IN, hv = r.hd - DIM.COL_IN, P = ring(hu, hv, DIM.COL_SPAN), yH = yB - DIM.BEAM;
    for (const [u, v] of P) column(u, v, F, yH);
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i + 1) % P.length];
      beam(a, b, yB);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, s = DIM.COL / 2;
      const A = [a[0] + dx * s, a[1] + dz * s], B = [b[0] - dx * s, b[1] - dz * s];
      let yPrev = F + .4;
      for (const y of [...levels.filter(y => y > F + 2 && y < yH - 1.5), yH - .05]){
        if (y < yH - .2) k.bar('steel', [A[0], y, A[1]], [B[0], y, B[1]], .14, .14);
        // X-braced between ties — a long bay in panels about as wide as the tier is tall (never a flat X),
        // a slim strut between panels: every face of a tower reads braced, however wide
        const n = Math.max(1, Math.round(L / Math.max(y - yPrev, 3))), at = j => [A[0] + (B[0] - A[0]) * j / n, A[1] + (B[1] - A[1]) * j / n];
        for (let j = 0; j < n; j++){
          const p = at(j), q = at(j + 1);
          k.bar('steel', [p[0], yPrev, p[1]], [q[0], y, q[1]], DIM.BRACE * .8, DIM.BRACE * .5);
          k.bar('steel', [q[0], yPrev, q[1]], [p[0], y, p[1]], DIM.BRACE * .8, DIM.BRACE * .5);
          if (j) k.bar('steel', [p[0], yPrev, p[1]], [p[0], y, p[1]], DIM.BRACE, DIM.BRACE);
        }
        yPrev = y;
      }
    }
  }
  /* a STAIR hugging one side (footing.js access): its steps rising along the side to a landing at
     the deck's height. solid: concrete steps (a dais); else an open steel stair on stringers */
  function stair(r, T, acc, solid){
    const S = onSide(r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread;
    const W2 = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; };
    const boxSide = (slot, a0, a1, o0, o1, y0, y1, faces) => { const p = S(a0, o0), q = S(a1, o1);
      k.box(slot, Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), faces); };
    const aL = acc.a1 - ow;                                    // the landing starts here (the last tread ends here)
    for (let i = 1; i < n; i++){
      const a0 = acc.a0 + (i - 1) * tr, a1 = a0 + tr, y = F + i * rise;
      if (solid) boxSide('base', a0, a1 + .02, .02, ow, F - .04, y, NOBOT);
      else boxSide('deck', a0, a1 + .03, .1, ow - .1, y - .06, y, ALL);
      boxSide('steel', a0, a0 + .05, solid ? .02 : .1, solid ? ow : ow - .1, y - .05, y + .005, ALL);   // the nosing
    }
    if (solid) boxSide('base', aL, acc.a1, .02, ow, F - .04, T - .05, NOBOT);
    else {
      boxSide('deck', aL, acc.a1, 0, ow, T - .2, T - .03, ALL);
      for (const o of [.12, ow - .12]) k.bar('steel', W2(acc.a0 + .1, o, F), W2(aL + .15, o, T - .12), .08, .3);    // stringers
      for (const a of [aL + .12, acc.a1 - .12]) k.bar('steel', W2(a, ow - .12, F), W2(a, ow - .12, T - .2), .14, .14, ALL);   // landing posts
    }
    boxSide('steel', aL, acc.a1, solid ? .02 : 0, ow, T - .05, T, PY | PX | NX | PZ | NZ);
    // the handrail on the open side: up the flight, along the landing, round its end
    const o = ow - .06, y0 = F + rise + HAND, y1 = T + HAND;
    k.bar('steel', W2(acc.a0 + .12, o, y0), W2(aL, o, y1), .07, .07, ALL);
    k.bar('steel', W2(aL, o, y1), W2(acc.a1 - .04, o, y1), .07, .07, ALL);
    k.bar('steel', W2(acc.a1 - .04, o, y1), W2(acc.a1 - .04, .1, y1), .07, .07, ALL);
    for (const [a, y] of [[acc.a0 + .12, F + rise], [aL, T], [acc.a1 - .04, T]]) k.bar('steel', W2(a, o, y), W2(a, o, y + HAND + .03), .07, .07, PY | SIDES);
    k.bar('steel', W2(acc.a1 - .04, .1, T), W2(acc.a1 - .04, .1, y1), .07, .07, SIDES);
  }
  /* a LADDER up one face (footing.js access): stiles, rungs, brackets back to a pair of masts in
     the structure's own plane (the leg ring / the column ring — its ties meet them); caged past
     FOOT.CAGE, its flights stepping sideways at a rest landing every LAND_DY */
  function ladder(r, T, acc){
    const S = onSide(r, acc.side), W2 = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; };
    const nf = acc.flights, mid = (acc.a0 + acc.a1) / 2, off = nf > 1 ? .45 : 0, O = DIM.LAD_OUT, hh = DIM.LAD_HALF;
    const oM = -(r.band === 'high' ? DIM.COL_IN : DIM.LEG_IN), yTop = T - deckDepth(r);
    for (let f = 0; f < nf; f++){
      const y0 = F + (T - F) * f / nf, y1 = F + (T - F) * (f + 1) / nf, ac = mid + (f % 2 ? off : -off), top = f === nf - 1;
      for (const s of [-hh, hh]) k.bar('steel', W2(ac + s, O, y0), W2(ac + s, O, y1 + (top ? 1.15 : 1)), DIM.STILE, DIM.STILE * .7, ALL);
      for (let y = y0 + DIM.RUNG_DY; y < y1 - .05; y += DIM.RUNG_DY) k.bar('steel', W2(ac - hh, O, y), W2(ac + hh, O, y), DIM.RUNG, DIM.RUNG);
      const m1 = top ? yTop : y1 - .12;                        // (the masts: floor / landing → the deck's / landing's underside)
      for (const s of [-hh, hh]){
        k.bar('steel', W2(ac + s, oM, y0), W2(ac + s, oM, m1), .1, .1, f ? SIDES : SIDES | PY);
        for (let y = y0 + 1.6; y < m1 - .3; y += 3) k.bar('steel', W2(ac + s, O, y), W2(ac + s, oM, y), .06, .06);   // brackets
        k.bar('steel', W2(ac + s, O, m1 - .25), W2(ac + s, oM, m1 - .25), .06, .06);
      }
      if (acc.cage){
        const c0 = y0 + (f ? 1.3 : 3.2), c1 = y1 + (top ? 1.1 : .9), R0 = O - .02, R1 = O + .78, hw = hh + .2;
        if (c1 > c0 + .3){
          for (let y = c0; y <= c1 + 1e-6; y += Math.max(.9, (c1 - c0) / Math.max(1, Math.round((c1 - c0) / 1.35)))){
            k.bar('steel', W2(ac - hw, R0, y), W2(ac - hw, R1, y), .05, .06, ALL);
            k.bar('steel', W2(ac - hw, R1, y), W2(ac + hw, R1, y), .05, .06, ALL);
            k.bar('steel', W2(ac + hw, R1, y), W2(ac + hw, R0, y), .05, .06, ALL);
          }
          for (const [a, o] of [[-hw, R1 - .3], [-hw, R1], [0, R1], [hw, R1], [hw, R1 - .3]]) k.bar('steel', W2(ac + a, o, c0), W2(ac + a, o, c1), .045, .045);
        }
      }
      if (!top){                                               // the rest landing (where this flight meets the next), back to the masts
        const a0 = acc.a0, a1 = acc.a1, yl = y1, o1 = acc.out;
        const p = S(a0, oM), q = S(a1, o1);
        k.box('deck', Math.min(p[0], q[0]), Math.max(p[0], q[0]), yl - .12, yl, Math.min(p[1], q[1]), Math.max(p[1], q[1]));
        for (const [a, o] of [[a0 + .05, o1 - .05], [a1 - .05, o1 - .05]]) k.bar('steel', W2(a, o, yl), W2(a, o, yl + RAIL_H), DIM.POST, DIM.POST, PY | SIDES);
        k.bar('steel', W2(a0 + .05, o1 - .05, yl + RAIL_H), W2(a1 - .05, o1 - .05, yl + RAIL_H), DIM.BAR, DIM.BAR, ALL);
        k.bar('steel', W2(a0 + .05, o1 - .05, yl + RAIL_H / 2), W2(a1 - .05, o1 - .05, yl + RAIL_H / 2), DIM.BAR * .8, DIM.BAR * .8);
      }
    }
  }
  /* where the deck's rails open for the access: the along-range on its side */
  const gapOf = acc => !acc ? [null, 0, 0] : acc.kind === 'stair' ? [acc.side, acc.a1 - acc.out, acc.a1] : (() => {
    const mid = (acc.a0 + acc.a1) / 2, off = acc.flights > 1 ? ((acc.flights - 1) % 2 ? .45 : -.45) : 0;
    return [acc.side, mid + off - DIM.LAD_HALF - .15, mid + off + DIM.LAD_HALF + .15]; })();
  function access(r, T, acc, solid){ if (!acc) return; acc.kind === 'stair' ? stair(r, T, acc, solid) : ladder(r, T, acc); }

  return {
    band, tape, block, deck, rails, legs, column, beam, trussFrame, stair, ladder,
    /* the forms by band: the pad's frame is set by the caller */
    flush(p){ block(p, p.fixed ? F + FOOT.KERB : p.top, p.color, p.pulse); },
    low(p){ block(p, p.top, p.color, p.pulse); access(p, p.top, p.access, true); },
    mid(p){
      const D = deckDepth(p);
      deck(p, p.top, D, p.color, p.pulse);
      legs(p, p.top - D);
      if (railed('mid')){ const [s, g0, g1] = gapOf(p.access); rails(p, p.top, s, g0, g1); }
      access(p, p.top, p.access, false);
    },
    high(p){
      const D = deckDepth(p);
      deck(p, p.top, D, p.color, p.pulse);
      trussFrame(p, p.top - D, landings(p));
      const [s, g0, g1] = gapOf(p.access); rails(p, p.top, s, g0, g1);
      access(p, p.top, p.access, false);
    },
    /* an OPEN stand: a post under every foot, beams + braces only where they keep out of what hangs */
    open(p){
      const T = p.top, H = T - F;
      const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6), .3]);
      const cu = feet.reduce((s, f) => s + f[0], 0) / feet.length, cv = feet.reduce((s, f) => s + f[1], 0) / feet.length;
      // (a post is slid off what hangs along its shallower side — never off its foot)
      const HG = p.hang, clip = (u, v, s, r) => {
        if (!HG) return [u, v];
        const x0 = HG[0] - .05, x1 = HG[1] + .05, z0 = HG[2] - .05, z1 = HG[3] + .05;
        if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
        const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
        return Math.abs(du + dv) <= r ? [u + du, v + dv] : null;
      };
      const hull = [];
      for (const [fu, fv, rr = .3] of feet.slice().sort((f, g) => Math.atan2(f[1] - cv, f[0] - cu) - Math.atan2(g[1] - cv, g[0] - cu))){
        const s = Math.max(.2, Math.min(.36, rr * .55)), at = clip(fu, fv, s, rr);
        if (!at) continue;                                     // (a foot over what hangs: no post can reach it)
        const [u, v] = at;
        hull.push([u, v]);
        k.box('steel', u - s, u + s, F, T - .06, v - s, v + s, SIDES);
        k.box('steel', u - s - .12, u + s + .12, T - .06, T, v - s - .12, v + s + .12, ALL);   // the head plate under the foot
        k.box('steel', u - s - .2, u + s + .2, F, F + .05, v - s - .2, v + s + .2, NOBOT);
      }
      // each face: a head beam + a foot tie, and — above 1.4 — X-braced TIERS (≤ OPEN_TIER each, tied
      // between): a face that passes what hangs is braced only below its lowest part (hangY)
      const y0 = F + .3, y1 = T - .4, nT = Math.max(1, Math.ceil((y1 - y0) / DIM.OPEN_TIER));
      const yT = Array.from({ length: nT + 1 }, (_, t) => y0 + (y1 - y0) * t / nT), clearY = Number.isFinite(p.hangY) ? p.hangY - .3 : -Infinity;
      if (hull.length > 1) for (let i = 0; i < hull.length; i++){
        const a = hull[i], b = hull[(i + 1) % hull.length];
        if (hull.length === 2 && i) break;
        if (segHits(a, b, p.hang, .15)) continue;
        k.bar('steel', [a[0], T - .24, a[1]], [b[0], T - .24, b[1]], .18, .26, ALL);
        k.bar('steel', [a[0], F + .2, a[1]], [b[0], F + .2, b[1]], .14, .14, ALL);
        if (H <= 1.4) continue;
        const near = segHits(a, b, p.hang, 1);
        for (let t = 0; t < nT; t++){
          if (near && yT[t + 1] > clearY) break;               // (a brace never crosses what hangs)
          if (t) k.bar('steel', [a[0], yT[t], a[1]], [b[0], yT[t], b[1]], .12, .12, ALL);
          k.bar('steel', [a[0], yT[t], a[1]], [b[0], yT[t + 1], b[1]], DIM.BRACE, DIM.BRACE * .6);
          k.bar('steel', [b[0], yT[t], b[1]], [a[0], yT[t + 1], a[1]], DIM.BRACE, DIM.BRACE * .6);
        }
      }
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [u, v] of feet){ u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      tape(u0 - .75, u1 + .75, v0 - .75, v1 + .75, F, p.color, p.pulse, .09);
      access(p, p.top, p.access, false);                       // (lifted off its own legs: a service ladder — footing.js)
    },
    loft(L, members){
      const T = L.top, D = deckDepth(L), yB = T - D;
      deck(L, T, D, null, 0, false);
      if (L.band === 'low') k.box('base', -L.hw + .03, L.hw - .03, F - .04, yB, -L.hd + .03, L.hd - .03, NOBOT);
      else if (L.band === 'mid') legs(L, yB);
      else trussFrame(L, yB, landings(L));
      if (railed(L.band)){ const [s, g0, g1] = gapOf(L.access); rails(L, T, s, g0, g1); }
      access(L, T, L.access, L.band === 'low');
      // each member's light: its stretch of the deck's fascia (front + back) and tape round its spot
      for (const m of members){
        if (k.ownEdge.has(m.key)) continue;
        let mu0 = Infinity, mu1 = -Infinity;
        const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0);
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){ const x = m.x + c * a * m.hw + s * b * m.hd - L.x; mu0 = Math.min(mu0, x); mu1 = Math.max(mu1, x); }
        mu0 = Math.max(-L.hw, mu0); mu1 = Math.min(L.hw, mu1);
        const o = DIM.EDGE_OUT, y0 = yB + .07, y1 = y0 + DIM.EDGE;
        k.edge(mu0, mu1, y0, y1, L.hd - .01, L.hd + o, m.color, m.pulse, PY | PZ);
        k.edge(mu0, mu1, y0, y1, -L.hd - o, -L.hd + .01, m.color, m.pulse, PY | NZ);
        if (mu0 <= -L.hw + .01) k.edge(-L.hw - o, -L.hw + .01, y0, y1, -L.hd, L.hd, m.color, m.pulse, PY | NX);
        if (mu1 >= L.hw - .01) k.edge(L.hw - .01, L.hw + o, y0, y1, -L.hd, L.hd, m.color, m.pulse, PY | PX);
      }
    },
    /* a member standing higher than its loft's deck: a shim of deck plate (in the member's frame) */
    shim(m, T){ k.box('deck', -m.hw + .15, m.hw - .15, T - .01, m.top, -m.hd + .15, m.hd - .15, NOBOT); },
    memberTape(m, T){ tape(-m.hw + .12, m.hw - .12, -m.hd + .12, m.hd - .12, Math.max(T, m.top), m.color, m.pulse); },
  };
  /* the landing levels of a support's ladder (ties + braces meet them): every LAND_DY of its climb */
  function landings(r){ const nf = r.access?.flights || Math.max(1, Math.ceil((r.top - F) / FOOT.LAND_DY)), out = [];
    for (let f = 1; f < nf; f++) out.push(F + (r.top - F) * f / nf); return out; }
}

/** build a plan's footing in a style: { group, update(songTime), dispose(), ms } */
export function buildFooting(plan, style = DEFAULT_STYLE, ctx = {}){
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const ownMats = !ctx.mats;
  const mats = ctx.mats || makeFootingMats(ctx);
  const group = new THREE.Group(); group.name = 'footing';
  const kit = makeKit({ floor: plan.floor, mats, plan });
  const extra = (style.mats && style.mats(kit, ctx)) || {};
  const slotMat = slot => extra[slot] || mats[slot] || mats.steel;
  const hooked = (fn, spec) => {
    if (typeof fn !== 'function') return false;
    const o = fn(spec, kit);
    if (!o) return false;
    o.traverse(m => { if (m.isMesh || m.isInstancedMesh) m.userData.footing = true; });
    group.add(o);
    return true;
  };
  const byId = new Map(plan.lofts.map(L => [L.id, L]));
  for (const p of plan.pads){
    kit.frame(p);
    kit.skipEdge = hooked(style.edge, p);                      // (the style lit this pad its own way)
    if (kit.skipEdge) kit.ownEdge.add(p.key);
    const L = p.loft && byId.get(p.loft);
    if (L){                                                    // a loft member: its shim + its tape (the loft draws the rest)
      if (p.top > L.top + .01) kit.forms.shim(p, L.top);
      kit.forms.memberTape(p, L.top);
      continue;
    }
    if (!hooked(style[p.band], p)) kit.forms[p.open ? 'open' : p.band](p);
  }
  kit.skipEdge = false;
  for (const L of plan.lofts){
    kit.frame(L);
    if (!hooked(style.loft, L)) kit.forms.loft(L, plan.pads.filter(p => p.loft === L.id));
  }
  // one mesh per slot (its envelopes: the supports it has parts in), one for every edge
  const boxes = ctx.boxes || null;
  for (const [slot, b] of Object.entries(kit._bufs)){
    if (!b.nv) continue;
    const m = new THREE.Mesh(toGeometry(b), slotMat(slot));
    m.name = 'footing:' + slot; m.userData.footing = true;
    if (boxes) m.userData.boxes = boxes.filter(e => b.units.has(e.unit)).map(e => e.box);
    m.matrixAutoUpdate = false; group.add(m);
  }
  let edgeMesh = null;
  if (kit._edge.nv){
    edgeMesh = new THREE.Mesh(toGeometry(kit._edge), extra.edge?.uniforms?.uPulse ? extra.edge : mats.edge);
    edgeMesh.name = 'footing:edge'; edgeMesh.userData.footing = true; edgeMesh.matrixAutoUpdate = false; edgeMesh.renderOrder = 2;
    group.add(edgeMesh);
  }
  group.updateMatrixWorld(true);
  group.matrixAutoUpdate = false;
  group.userData.footing = true;
  // the edge's light: one envelope per pulse slot (pure fns of songTime)
  const pulses = plan.pulses.map(s => makePulse(s.cue, { P: s.P, start: s.start }));
  const U = edgeMesh ? edgeMesh.material.uniforms.uPulse.value : new Float32Array(FOOT.MAX_PULSE);
  const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  group.userData.ms = +ms.toFixed(2);                        // (dev: what the build cost — __dev.footStats)
  return {
    group, plan, ms, tris: group.children.reduce((s, m) => s + (m.geometry?.index ? m.geometry.index.count / 3 : 0), 0),
    update(songTime){
      for (let i = 0; i < pulses.length; i++){ const v = pulses[i].at(songTime) + .35 * pulses[i].next(songTime); U[i] = v > 1 ? 1 : v; }
    },
    dispose(){
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      group.removeFromParent();
      if (ownMats) mats.dispose?.();                         // (a style's materials are its room's)
    },
  };
}
