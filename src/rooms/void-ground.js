import * as THREE from 'three';
import { FOOT } from './footing.js';
import { newBuf, toGeometry } from './footing3d.js';
import { face, glyph } from './void-footing.js';
import { runeSpots, crystalSpots, machinesOf, hash2, outOf, ISLE } from './void-isles.js';
/* ============================================================
   THE VOID's GROUND — the islands' bodies, their runes, the crystals (render: THREE, no scene).
   void-isles.js decides WHERE (pure, tested); this writes WHAT, in the room's materials:

     an ISLAND   a slab of dressed stone at the floor (STAGE.FLOOR: the machines' ground — its top is
                 the floor contract), a chamfer, a stone fascia carved with RUNES, then rough rock
                 tapering under it to a keel along the island's long axis (an island reads as a
                 piece of ground torn out of somewhere, not a tray) — a few crystals hang under it
     the RUNES   round every fascia, each lit by the nearest machine on its island (rooms/pulse.js
                 over that machine's strike cue: its strikes run round its own stretch of the rim);
                 the organ's island answers the organ
     a SKY ROCK  the same body turned over at the ceiling, where a chandelier's rods end (its runes
                 answer the chandelier; nothing hangs off it)
     CRYSTALS    shards hovering off each machine's stretch of rim, breathing, lifting on its
                 strikes: ONE instanced draw, every pose a pure fn of songTime in the vertex shader
                 (+ the static ones hanging under the islands, breathing only)
   Cost per song: stone + rock + runes + crystals = 4 draws, built in a few ms at place().
   ============================================================ */

export const GROUND = {
  INSET: ISLE.INSET,   // the stone PLATFORM sits this far inside the island's outline: a ledge of rough rock round it
  CH: .1,              // the platform's chamfer
  FASC: .55,           // its stone slab's depth (the fascia carries the runes)
  RUNE_Y: .3, RUNE_H: .28,
  LEDGE_IN: .28,       // the rock ledge's outline pulls in by up to this (rough), and drops by up to…
  LEDGE_DY: .16,
  SEG: 1.5,            // the rock's outline: a point at least this often along the hull
  DEPTH: [4, 13],      // how far a keel hangs under the platform (by the island's width)
  GLINT: 5,            // crystals hanging under an island, at most
};
/* the rock under the ledge: [t (0 → the keel), s (scale of the ledge's outline)] */
const PROFILE = [[0, 1], [.05, .97], [.2, .87], [.42, .66], [.62, .44], [.8, .24], [.92, .1], [1, .02]];
const UP = [0, 1, 0], DOWN = [0, -1, 0];

/** a convex CCW (x, z) polygon offset INWARD by d (mitred, the miter capped) */
export function insetPoly(H, d){
  const n = H.length, out = [];
  for (let i = 0; i < n; i++){
    const p = H[(i + n - 1) % n], c = H[i], q = H[(i + 1) % n];
    const e0x = c[0] - p[0], e0z = c[1] - p[1], L0 = Math.hypot(e0x, e0z) || 1, e1x = q[0] - c[0], e1z = q[1] - c[1], L1 = Math.hypot(e1x, e1z) || 1;
    const n0x = -e0z / L0, n0z = e0x / L0, n1x = -e1z / L1, n1z = e1x / L1;          // (inward: the interior is on the left)
    const k = Math.min(2.5, 1 / Math.max(.2, (1 + n0x * n1x + n0z * n1z) / 2)) * d / 2;
    out.push([c[0] + (n0x + n1x) * k, c[1] + (n0z + n1z) * k]);
  }
  return out;
}
/** the hull's outline with a point at least every `seg` (its corners kept); with `B` (a polygon of the
    same count, e.g. its inset), the matching points along B's edges too */
export function resample(H, seg, B = null){
  const out = [], on = [];
  for (let i = 0; i < H.length; i++){
    const j = (i + 1) % H.length, a = H[i], b = H[j], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / seg));
    for (let k = 0; k < n; k++){
      const f = k / n; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      if (B) on.push([B[i][0] + (B[j][0] - B[i][0]) * f, B[i][1] + (B[j][1] - B[i][1]) * f]);
    }
  }
  return B ? [out, on] : out;
}
/** principal axes of an outline: centre, major unit a, minor unit b, the half extents along them */
export function axesOf(P, cx, cz){
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of P){ const dx = x - cx, dz = z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const th = .5 * Math.atan2(2 * sxz, sxx - szz), a = [Math.cos(th), Math.sin(th)], b = [-a[1], a[0]];
  let ea = 0, eb = 0;
  for (const [x, z] of P){ ea = Math.max(ea, Math.abs((x - cx) * a[0] + (z - cz) * a[1])); eb = Math.max(eb, Math.abs((x - cx) * b[0] + (z - cz) * b[1])); }
  return { a, b, ea, eb };
}
/** how deep an island's keel hangs (by its width) */
export const keelDepth = eb => Math.max(GROUND.DEPTH[0], Math.min(GROUND.DEPTH[1], 1.5 * eb + 2.5));
/** the ledge's rough outline (ring 0 of the rock: inside the hull, outside the platform) + where it sits */
function ledgeOf(I, T){
  const Pf = insetPoly(I.hull, GROUND.INSET), [Hs, Ps] = resample(I.hull, GROUND.SEG, Pf), y = T - GROUND.FASC;
  const R0 = Hs.map(([x, z], k) => {
    const h = hash2(Math.round(x * 2) / 2, Math.round(z * 2) / 2, 29), f = GROUND.LEDGE_IN / GROUND.INSET * h;
    return [x + (Ps[k][0] - x) * f, y - GROUND.LEDGE_DY * hash2(x, z, 33), z + (Ps[k][1] - z) * f];
  });
  return { Pf, Ps: Ps.map(([x, z]) => [x, y, z]), R0 };
}
/* the rock's rings under the ledge: [[x, y, z] per outline point] per PROFILE row — scaled toward the
   island's long axis (a keel, not a cone), every point pulled in (never out) by a hash of where it is */
function rockRings(I, R0, T){
  const { a, b, eb } = axesOf(R0.map(p => [p[0], p[2]]), I.cx, I.cz), D = keelDepth(eb) * (I.depthK ?? 1), y0 = T - GROUND.FASC;
  return PROFILE.map(([t, s], j) => {
    if (j === 0) return R0;
    const sA = Math.pow(s, .55), J = j === PROFILE.length - 1 ? .02 : .14, dy = j === PROFILE.length - 1 ? 0 : D * .035;
    return R0.map(([x, , z]) => {
      const dx = x - I.cx, dz = z - I.cz, al = dx * a[0] + dz * a[1], ac = dx * b[0] + dz * b[1];
      const f = 1 - J * hash2(Math.round(x * 2) / 2, Math.round(z * 2) / 2, 31 + j);
      return [I.cx + (a[0] * al * sA + b[0] * ac * s) * f, y0 - GROUND.LEDGE_DY - t * D + dy * (hash2(x, z, 47 + j) - .5) * 2, I.cz + (a[1] * al * sA + b[1] * ac * s) * f];
    });
  });
}

/* turn what was just written for one island over, about its own top (y0): heights mirrored, normals
   with them, every triangle's winding reversed (a mirror turns them inside out) */
function flipY(b, v0, i0, y0){
  for (let v = v0; v < b.nv; v++){ b.p[v * 3 + 1] = 2 * y0 - b.p[v * 3 + 1]; if (b.n) b.n[v * 3 + 1] = -b.n[v * 3 + 1]; }
  for (let t = i0; t < b.ni; t += 3){ const q = b.i[t + 1]; b.i[t + 1] = b.i[t + 2]; b.i[t + 2] = q; }
}
/** the islands' bodies: { stone, rock } geometries (world space) + the crystals hanging under them; a
    sky rock (void-isles.js skyRocks: `sky` = its soffit) is the same body turned over */
export function islandGeometry(isles, { floor, stagger = .003 } = {}){
  const S = newBuf(), R = newBuf(), glints = [];
  isles.forEach(I => {
    const T = I.sky ?? floor + stagger * (I.group ?? 0), H = I.hull, n = H.length;     // (one landmass: one height — its parts' tops coincide)
    if (n < 3) return;
    const s0 = S.nv, si0 = S.ni, r0 = R.nv, ri0 = R.ni;
    const { Pf, Ps, R0 } = ledgeOf(I, T), Pt = insetPoly(H, GROUND.INSET + GROUND.CH), C = [I.cx, T, I.cz];
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n, ex = H[j][0] - H[i][0], ez = H[j][1] - H[i][1], L = Math.hypot(ex, ez) || 1, N = [ez / L, 0, -ex / L];
      face(S, [C, [Pt[i][0], T, Pt[i][1]], [Pt[j][0], T, Pt[j][1]]], UP);                                            // the platform's top (a fan)
      face(S, [[Pt[i][0], T, Pt[i][1]], [Pt[j][0], T, Pt[j][1]], [Pf[j][0], T - GROUND.CH, Pf[j][1]], [Pf[i][0], T - GROUND.CH, Pf[i][1]]], [N[0], 1, N[2]]);   // its chamfer
      face(S, [[Pf[i][0], T - GROUND.CH, Pf[i][1]], [Pf[j][0], T - GROUND.CH, Pf[j][1]], [Pf[j][0], T - GROUND.FASC, Pf[j][1]], [Pf[i][0], T - GROUND.FASC, Pf[i][1]]], N);   // the fascia
    }
    // the ledge of rough rock round the platform, then the rock tapering to a keel along the island's long axis
    const m = R0.length;
    for (let k = 0; k < m; k++){ const l = (k + 1) % m; face(R, [Ps[k], Ps[l], R0[l], R0[k]], UP); }
    const rings = rockRings(I, R0, T);
    for (let r = 0; r + 1 < rings.length; r++){
      const A = rings[r], B = rings[r + 1];
      for (let k = 0; k < m; k++){
        const l = (k + 1) % m, mx = (A[k][0] + A[l][0] + B[k][0] + B[l][0]) / 4 - I.cx, mz = (A[k][2] + A[l][2] + B[k][2] + B[l][2]) / 4 - I.cz;
        face(R, [A[k], A[l], B[l], B[k]], [mx, -.35 * Math.hypot(mx, mz), mz]);
      }
    }
    const last = rings[rings.length - 1], K = [last.reduce((s, p) => s + p[0], 0) / m, last.reduce((s, p) => s + p[1], 0) / m - .3, last.reduce((s, p) => s + p[2], 0) / m];
    for (let k = 0; k < m; k++) face(R, [K, last[(k + 1) % m], last[k]], DOWN);
    // a sky rock: all of it turned over about its soffit (its keel points up) — and nothing hangs off it
    if (I.sky != null){ flipY(S, s0, si0, T); flipY(R, r0, ri0, T); return; }
    // a few crystals hanging under it, on its middle rings, pointing down and out
    const want = Math.min(GROUND.GLINT, 1 + Math.floor(I.area / 40));
    for (let k = 0, got = 0; k < m && got < want; k++){
      const q = rings[3 + (k % 3)][(k * 7) % m], h = hash2(q[0], q[2], 61);
      if (h > want / m * 2.2 + .08) continue;
      const ox = q[0] - I.cx, oz = q[2] - I.cz, ol = Math.hypot(ox, oz) || 1;
      glints.push({ x: q[0] + ox / ol * .1, y: q[1] - .15, z: q[2] + oz / ol * .1, r: .16 + .14 * hash2(q[0], q[2], 63),
        phase: hash2(q[0], q[2], 65), tilt: Math.PI - .35 - .3 * h, spin: Math.atan2(ox, oz), len: 1.6 + 1.2 * hash2(q[0], q[2], 67) });
      got++;
    }
  });
  return { stone: S.nv ? toGeometry(S) : new THREE.BufferGeometry(), rock: R.nv ? toGeometry(R) : new THREE.BufferGeometry(), glints };
}

/** who lights the room (one pulse slot each, ≤ FOOT.MAX_PULSE − 1 — the last slot stays dark: an island
    nothing answers keeps its runes at rest): every standing machine in machinesOf order (runeSpots'
    slots), then each hung machine that has an island of its own (the organ: its columns reach the floor) */
export function litOf(anchors, isles){
  const lit = machinesOf(anchors).slice(0, FOOT.MAX_PULSE - 1);
  for (const I of isles) for (const k of I.keys){
    const a = (anchors || []).find(x => x && x.kind === 'hung' && x.key === k);
    if (a && !lit.includes(a) && lit.length < FOOT.MAX_PULSE - 1) lit.push(a);
  }
  return lit;
}
export const QUIET = FOOT.MAX_PULSE - 1;
/** each rune's slot in litOf: its nearest machine's, else (an island with none) the hung machine it holds */
export function runeSlots(spots, isles, anchors, lit){
  return spots.map(r => {
    if (r.slot >= 0) return r.slot < QUIET ? r.slot : QUIET;
    const h = isles[r.isle].keys.map(k => lit.findIndex(a => a.kind === 'hung' && a.key === k)).find(i => i >= 0);
    return h ?? QUIET;
  });
}
const _c = new THREE.Color(), REST = new THREE.Color(0x8a7cff);
/** the runes round every fascia: one geometry (aColor / aPulse: makeRuneMat) */
export function runeGeometry(isles, anchors, lit, { floor, stagger = .003 } = {}){
  const E = newBuf(true), spots = runeSpots(isles, anchors), slots = runeSlots(spots, isles, anchors, lit);
  spots.forEach((r, i) => {
    const I = isles[r.isle], s = slots[i], a = lit[s];
    const T = I.sky != null ? I.sky + 2 * GROUND.RUNE_Y : floor + stagger * (I.group ?? 0);   // (a sky rock's fascia runs UP from its soffit)
    const col = a ? _c.set(a.color ?? '#8fa6c8').clone() : REST.clone().multiplyScalar(.7);
    const N = [r.nx, 0, r.nz];
    glyph(E, [r.x, T - GROUND.RUNE_Y, r.z], [N[2], 0, -N[0]], UP, N, GROUND.RUNE_H, r.g, col, s, .018);
  });
  return { geometry: E.nv ? toGeometry(E) : new THREE.BufferGeometry(), count: spots.length };
}

/* ---- CRYSTALS: one instanced draw. A shard = a six-sided bipyramid (flat facets) of radius 1: its
   tip at +len·.62, its root at −len·.38 (len per instance). Per instance (static, set at place()):
   iPos, iA = (r, slot, phase, tilt), iB = (spin, mobile, len, 0), iCol. The vertex shader poses it
   from uTime (= songTime: scrub-exact) and its machine's slot of uPulse — mobile 1 breathes, bobs, turns
   and LIFTS on a strike; mobile 0 (hanging under an island) only breathes ---- */
export function crystalGeometry(){
  const pos = [], nrm = [], ring = 6;
  const P = i => { const a = i / ring * Math.PI * 2; return [Math.cos(a), .0, Math.sin(a)]; };
  for (let i = 0; i < ring; i++){
    const p = P(i), q = P(i + 1), T = [0, .62, 0], B = [0, -.38, 0];
    for (const [A, Bv, Cv] of [[p, T, q], [q, B, p]]){
      const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], vx = Cv[0] - A[0], vy = Cv[1] - A[1], vz = Cv[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
      pos.push(...A, ...Bv, ...Cv); nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
export const CRYSTAL_MAX = 160;
/** the light falling from a keel: common.js beamMat's look (Fresnel-soft, fading away from its source) with
    its first few units faded IN — it starts inside the rock, and a faceted keel would show a hard rim */
export function makeKeelBeamMat({ gain = .42, falloff = 2.2, edge = 1.4, fadeIn = .07 } = {}){
  return new THREE.ShaderMaterial({
    uniforms: { uGain: { value: gain }, uFall: { value: falloff }, uEdge: { value: edge }, uIn: { value: fadeIn } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vC;
      void main(){
        vec4 p = vec4(position, 1.); vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        vC = vec3(1.);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz); vY = uv.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uGain, uFall, uEdge, uIn;
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vC;
      void main(){
        float y = clamp(vY, 0., 1.);
        float a = pow(abs(dot(vN, vV)), uEdge) * pow(y, uFall) * smoothstep(1., 1. - uIn, y) * uGain;
        gl_FragColor = vec4(vC, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
export function makeCrystalMat(U){
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLift: { value: .5 } }]),
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute vec4 iA; attribute vec4 iB; attribute vec3 iCol;
      uniform float uPulse[${FOOT.MAX_PULSE}]; uniform float uTime, uLift;
      varying vec3 vN, vC, vV; varying float vG, vFog;
      vec3 turn(vec3 q, float ct, float st, float cs, float sn){
        q = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct);
        return vec3(q.x * cs + q.z * sn, q.y, -q.x * sn + q.z * cs);
      }
      void main(){
        float r = iA.x, ph = iA.z, mob = iB.y, len = iB.z;
        float p = uPulse[int(clamp(iA.y + .5, 0., ${(FOOT.MAX_PULSE - 1).toFixed(1)}))] * mob;
        float spin = iB.x + mob * uTime * (.18 + .14 * ph);
        float ct = cos(iA.w), st = sin(iA.w), cs = cos(spin), sn = sin(spin);
        vec3 q = turn(vec3(position.x * r, position.y * r * len, position.z * r), ct, st, cs, sn);
        float bob = mob * (sin(uTime * (.55 + .3 * ph) + ph * 6.2832) * .07 + p * uLift);
        vec4 mv = modelViewMatrix * vec4(iPos + q + vec3(0., bob, 0.), 1.);
        vN = normalize(normalMatrix * turn(normal, ct, st, cs, sn));
        vC = iCol;
        vG = .62 + .22 * sin(uTime * .5 + ph * 6.2832) + .9 * p;
        vFog = -mv.z; vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 fogColor; uniform float fogDensity;
      varying vec3 vN, vC, vV; varying float vG, vFog;
      void main(){
        vec3 N = normalize(vN);
        float f = abs(dot(N, normalize(vec3(-.35, .8, .5)))), fr = pow(1. - abs(dot(N, normalize(vV))), 2.);
        vec3 col = vC * (.08 + .3 * f) + vC * vG * (.3 + 1.1 * fr) + vec3(.9, .95, 1.) * pow(f, 16.) * .45 * vG;
        col = mix(col, fogColor, 1. - exp(-fogDensity * fogDensity * vFog * vFog));
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    fog: true,
  });
  m.uniforms.uPulse = { value: U };
  return m;
}
/** fill the instanced crystal geometry (a pure fn of anchors + plan + islands) */
export function fillCrystals(geo, isles, anchors, plan, lit, glints){
  const spots = crystalSpots(isles, anchors, plan), ms = machinesOf(anchors), n = Math.min(CRYSTAL_MAX, spots.length + glints.length);
  const P = new Float32Array(n * 3), A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 3);
  let i = 0;
  for (const s of spots){
    if (i >= n) break;
    const a = ms[s.slot], slot = lit.indexOf(a);
    _c.set(a?.color ?? '#7fd6ff').getHSL(_hsl); _c.setHSL(_hsl.h, Math.max(.7, _hsl.s), .5).lerp(_glass, .15);
    P.set([s.x, s.y, s.z], i * 3); A.set([s.r, slot >= 0 ? slot : QUIET, s.phase, s.tilt], i * 4); B.set([s.spin, 1, 1.7 + .8 * s.phase, 0], i * 4);
    C.set([_c.r, _c.g, _c.b], i * 3); i++;
  }
  for (const g of glints){
    if (i >= n) break;
    _c.copy(_glass).multiplyScalar(.8);
    P.set([g.x, g.y, g.z], i * 3); A.set([g.r, QUIET, g.phase, g.tilt], i * 4); B.set([g.spin, 0, g.len, 0], i * 4);
    C.set([_c.r, _c.g, _c.b], i * 3); i++;
  }
  for (const [k, arr, w] of [['iPos', P, 3], ['iA', A, 4], ['iB', B, 4], ['iCol', C, 3]]){
    geo.setAttribute(k, new THREE.InstancedBufferAttribute(arr, w));
  }
  geo.instanceCount = i;
  return { spots, count: i };
}
const _glass = new THREE.Color(0x7fe0ff), _hsl = { h: 0, s: 0, l: 0 };
/** is (x, z) on any island (with a margin)? (dev / tests: what hovers must not) */
export const onIsland = (isles, x, z, m = 0) => isles.some(I => outOf(I.hull, x, z) <= m);
