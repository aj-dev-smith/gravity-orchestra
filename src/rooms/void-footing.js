import * as THREE from 'three';
import { FOOT, railed } from './footing.js';
import { newBuf, quad } from './footing3d.js';
import { GLYPHS, hash2, glyphOf } from './void-isles.js';
/* ============================================================
   THE VOID's FOOTING — what the machines stand on, in the Void's own idiom (a rooms/footing3d.js
   STYLE: the room's build() returns voidFootingStyle(mats) as `footing`). No steel here: the
   islands are stone, so is everything that grows out of them — and it GROWS WITH HEIGHT:

     flush  a dais cut from the island's own stone (the island's rim runes are its light)
     low    a TERRACE of island rock under a stone cap, climbed by steps carved out of the rock,
            a stone cheek wall along their open side; runes round the rock under the cap
     mid    a rock PILLAR (a hoodoo: a root, a waist, a flared capital) carrying a stone deck, crystal
            veins climbing it; a stair of floating STEPPING STONES — each a little island of its
            own, a glowing tip under its keel — or, past FOOT.STAIR_MAX, a ladder of light
     high   a STACK of levitating stones, a cushion of crystal light in every gap, faint runes on
            each; a stone deck on a rock corbel; a LADDER OF LIGHT (hoops of light for its cage,
            floating stone landings)
     open   (the turntable: something hangs below what it rests on) a rock column under every foot —
            a stack of small levitating stones once it is tall — nothing crossing what hangs; a ring
            of runes on the island round its feet
     loft   a FLOATING RIDGE: one long stone deck on a rock keel, carried by the band's own support
            (a terrace · rock pillars · levitating stacks) spaced along it
   Every walkable deck above the low band has rails of light on stone posts (FOOT.RAIL envelope).
   The machine's own light (one per machine, a pure fn of songTime via the kit's pulse slots — the
   room's `rune` material IS the footing's edge material): runes carved round its deck's fascia /
   its terrace, faint on a stack's stones, a ring round an open stand's feet.

   Cost: everything is written into the kit's merged slot buffers (footing3d newBuf / quad) —
   'base' = ROCK, 'deck' = dressed STONE, 'glow' = crystal, 'haze' = soft light, + the kit's edge
   (the runes): ≤ 5 draws for a whole song's footing, whatever it holds. Everything stays inside
   footingBoxes(plan) (test/room-void.test.js): the shot solve, the director's glide test and XR
   treat those as solid.
   ============================================================ */

export const VD = {
  CUT: .22,                 // a slab's corner cut
  CH: .05,                  // a dais's top chamfer
  CAP: .16,                 // a terrace's stone cap
  DECK: .46, DECK_LOFT: .52,// a raised deck's depth (deeper where a machine dips into it: pad.well)
  RUNE_H: .26, RUNE_STEP: .62,                    // fascia runes: glyph height, spacing
  GAP: .34, STONE: 3.9,     // a levitating cairn: the air between stones (varied ±), a stone's mean height
  POST: .11, RAIL_Y: 1.02, RAIL_SPAN: 2.2,        // rails of light on stone posts (≤ FOOT.RAIL)
  STEP_T: .32,              // a stepping stone's slab
  BAR: .055, RUNG: .042,    // a ladder of light: stile, rung
  VEIN: .075,               // a crystal vein's width
  TIER: 5.5,                // an open stand's columns: tied by stone lintels every ≤ this (≤ kit.DIM.OPEN_TIER)
};
const UP = [0, 1, 0], DOWN = [0, -1, 0];
/* runes carved FLAT into an island sit above its highest top (islands stagger by .003 per landmass group,
   void-ground.js; up to 3 groups and a margin) */
const RING_Y = .014;
const _P = new Float32Array(12), _col = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);

/* ---- the writer: faces in WORLD space, each with its own flat normal, turned to face `want` ----
   (a quad whose corners don't lie in one plane — rock is jittered — is written as its two flat triangles:
   faceted, and every triangle's winding agrees with its normal) */
const UVK = .25;                                                       // (the kit's 4 u texture tile, box-projected)
function tri(b, A, B, C, nx, ny, nz, col, pulse){
  if ((b.nv + 3) * 3 > b.p.length){                                   // (the kit's growth rule: footing3d.js grow)
    const capN = Math.max(b.p.length * 2, (b.nv + 3) * 3), up = (a, per) => { if (!a) return a; const q = new Float32Array(capN / 3 * per); q.set(a); return q; };
    b.p = up(b.p, 3); b.n = up(b.n, 3); b.uv = up(b.uv, 2); b.c = up(b.c, 3); b.k = up(b.k, 1);
  }
  if (b.ni + 3 > b.i.length){ const q = new Uint32Array(Math.max(b.i.length * 2, b.ni + 3)); q.set(b.i); b.i = q; }
  const v = b.nv, ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), P = [A, B, C];
  for (let j = 0; j < 3; j++){
    const [x, y, z] = P[j], o = (v + j) * 3;
    b.p[o] = x; b.p[o + 1] = y; b.p[o + 2] = z;
    if (b.n){ b.n[o] = nx; b.n[o + 1] = ny; b.n[o + 2] = nz;
      const q = (v + j) * 2;
      if (ay >= ax && ay >= az){ b.uv[q] = x * UVK; b.uv[q + 1] = z * UVK; }
      else if (ax >= az){ b.uv[q] = z * UVK; b.uv[q + 1] = y * UVK; }
      else { b.uv[q] = x * UVK; b.uv[q + 1] = y * UVK; } }
    if (b.c){ b.c[o] = col.r; b.c[o + 1] = col.g; b.c[o + 2] = col.b; b.k[v + j] = pulse; }
  }
  b.i[b.ni] = v; b.i[b.ni + 1] = v + 1; b.i[b.ni + 2] = v + 2;
  b.nv += 3; b.ni += 3;
}
const triN = (A, B, C) => {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, L = Math.hypot(x, y, z);
  return L < 1e-10 ? null : [x / L, y / L, z / L];
};
function tri1(b, A, B, C, want, col, pulse){
  const n = triN(A, B, C); if (!n) return;
  if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) tri(b, A, C, B, -n[0], -n[1], -n[2], col, pulse);
  else tri(b, A, B, C, n[0], n[1], n[2], col, pulse);
}
export function face(b, pts, want, col = WHITE, pulse = 0){
  const A = pts[0], B = pts[1], C = pts[2];
  if (pts.length < 4){ tri1(b, A, B, C, want, col, pulse); return; }
  const D = pts[3], n1 = triN(A, B, C), n2 = triN(A, C, D);
  if (!n1 || !n2 || n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < .985){       // (not flat: two triangles)
    tri1(b, A, B, C, want, col, pulse); tri1(b, A, C, D, want, col, pulse); return;
  }
  let nx = n1[0] + n2[0], ny = n1[1] + n2[1], nz = n1[2] + n2[2];
  const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
  const flip = want && nx * want[0] + ny * want[1] + nz * want[2] < 0;
  const Q = flip ? [A, D, C, B] : [A, B, C, D];
  if (flip){ nx = -nx; ny = -ny; nz = -nz; }
  for (let j = 0; j < 4; j++){ _P[j * 3] = Q[j][0]; _P[j * 3 + 1] = Q[j][1]; _P[j * 3 + 2] = Q[j][2]; }
  quad(b, _P, nx, ny, nz, col, pulse);
}
/* a glowing STROKE from a to c (world), w wide, lying in the plane whose normal is N */
export function stroke(b, a, c, w, N, col, pulse){
  let dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const L = Math.hypot(dx, dy, dz); if (L < 1e-6) return;
  dx /= L; dy /= L; dz /= L;
  const h = w / 2, sx = (N[1] * dz - N[2] * dy) * h, sy = (N[2] * dx - N[0] * dz) * h, sz = (N[0] * dy - N[1] * dx) * h;
  face(b, [[a[0] - dx * h - sx, a[1] - dy * h - sy, a[2] - dz * h - sz], [c[0] + dx * h - sx, c[1] + dy * h - sy, c[2] + dz * h - sz],
           [c[0] + dx * h + sx, c[1] + dy * h + sy, c[2] + dz * h + sz], [a[0] - dx * h + sx, a[1] - dy * h + sy, a[2] - dz * h + sz]], N, col, pulse);
}
/* a RUNE (GLYPHS[g]) centred at C, its right U and up V (unit, world), standing proud of a face whose
   outward normal is N; h tall */
export function glyph(b, C, U, V, N, h, g, col, pulse, off = .014){
  const w = Math.max(.03, h * .13);
  for (const [u0, v0, u1, v1] of GLYPHS[g % GLYPHS.length]){
    const P = (u, v) => [C[0] + U[0] * (u - .35) * h + V[0] * (v - .5) * h + N[0] * off,
                         C[1] + U[1] * (u - .35) * h + V[1] * (v - .5) * h + N[1] * off,
                         C[2] + U[2] * (u - .35) * h + V[2] * (v - .5) * h + N[2] * off];
    stroke(b, P(u0, v0), P(u1, v1), w, N, col, pulse);
  }
}

/* ---- local frame helpers (the kit's frame is the spec's: u along hw, v along hd) ---- */
const W = (kit, u, y, v) => { const q = kit.w(u, v); return [q[0], y, q[1]]; };
const dirW = (kit, du, dv) => { const a = kit.w(du, dv), o = kit.w(0, 0); return [a[0] - o[0], 0, a[1] - o[1]]; };
/** a rect's outline with its corners cut (c), CCW-ish in (u, v); c ≤ 0: its four corners */
export const oct = (hw, hd, c = 0, cu = 0, cv = 0) => c <= 1e-6 ? [[cu - hw, cv - hd], [cu + hw, cv - hd], [cu + hw, cv + hd], [cu - hw, cv + hd]]
  : [[cu - hw + c, cv - hd], [cu + hw - c, cv - hd], [cu + hw, cv - hd + c], [cu + hw, cv + hd - c], [cu + hw - c, cv + hd], [cu - hw + c, cv + hd], [cu - hw, cv + hd - c], [cu - hw, cv - hd + c]];
/** an ellipse of n points (local), phase a0 */
export const ell = (ru, rv, n, cu = 0, cv = 0, a0 = 0) => Array.from({ length: n }, (_, i) => { const a = a0 + i / n * Math.PI * 2; return [cu + ru * Math.cos(a), cv + rv * Math.sin(a)]; });
/* side faces between two rings of [u, v, y] (same count), turned away from the axis (cu, cv) */
function band(kit, b, A, B, cu = 0, cv = 0, col, pulse){
  const n = A.length;
  for (let i = 0; i < n; i++){
    const j = (i + 1) % n, mu = (A[i][0] + A[j][0] + B[i][0] + B[j][0]) / 4 - cu, mv = (A[i][1] + A[j][1] + B[i][1] + B[j][1]) / 4 - cv;
    face(b, [W(kit, A[i][0], A[i][2], A[i][1]), W(kit, A[j][0], A[j][2], A[j][1]), W(kit, B[j][0], B[j][2], B[j][1]), W(kit, B[i][0], B[i][2], B[i][1])], dirW(kit, mu, mv), col, pulse);
  }
}
/* a cap (a fan round its centre) over a ring of [u, v, y], facing `want` */
function cap(kit, b, R, want){
  let cu = 0, cv = 0, cy = 0; for (const p of R){ cu += p[0]; cv += p[1]; cy += p[2]; }
  cu /= R.length; cv /= R.length; cy /= R.length;
  const C = W(kit, cu, cy, cv);
  for (let i = 0; i < R.length; i++){ const p = R[i], q = R[(i + 1) % R.length]; face(b, [C, W(kit, p[0], p[2], p[1]), W(kit, q[0], q[2], q[1])], want); }
}
const at = (poly, y) => poly.map(([u, v]) => [u, v, y]);
/* a straight prism (a slab): sides, top, optional bottom */
function slab(kit, bSide, bTop, poly, y0, y1, { bottom = false, bBot = bSide } = {}){
  band(kit, bSide, at(poly, y0), at(poly, y1));
  cap(kit, bTop, at(poly, y1), UP);
  if (bottom) cap(kit, bBot, at(poly, y0), DOWN);
}
/* a slab with a chamfered top edge (inset ch) */
function chamferSlab(kit, bSide, bTop, poly, y0, y1, ch, inset){
  band(kit, bSide, at(poly, y0), at(poly, y1 - ch));
  band(kit, bTop, at(poly, y1 - ch), at(inset, y1));
  cap(kit, bTop, at(inset, y1), UP);
}
/* a ROCK ring: poly scaled about (cu, cv) by s, every vertex nudged by a hash of where it is (k: its ring) */
function rockRing(kit, poly, s, y, k, cu = 0, cv = 0, j = .09, jy = 0){
  return poly.map(([u, v]) => {
    const q = kit.w(cu + (u - cu) * s, cv + (v - cv) * s), h = hash2(Math.round(q[0] * 4) / 4, Math.round(q[1] * 4) / 4, k);
    const f = s * (1 + j * (h - .5) * 2);
    return [cu + (u - cu) * f, cv + (v - cv) * f, y + jy * (hash2(q[0], q[1], k + 9) - .5) * 2];
  });
}
/* a rock body through a profile [[t, s], …] (t 0..1 from y0 to y1, s its scale of poly) — no caps */
function rockBody(kit, b, poly, y0, y1, profile, k, cu = 0, cv = 0, j = .09){
  const R = profile.map(([t, s], i) => rockRing(kit, poly, s, y0 + (y1 - y0) * t, k + i * 3, cu, cv, (i === 0 || i === profile.length - 1) ? j * .4 : j));
  for (let i = 0; i + 1 < R.length; i++) band(kit, b, R[i], R[i + 1], cu, cv);
  return R;
}
/* a pointed rock KEEL under a ring R (its centre dropping depth): the underside of a floating stone */
function keel(kit, b, R, depth, k, tip = null){
  let cu = 0, cv = 0, cy = 0; for (const p of R){ cu += p[0]; cv += p[1]; cy += p[2]; }
  cu /= R.length; cv /= R.length; cy /= R.length;
  const mid = R.map(([u, v, y], i) => { const q = kit.w(u, v), h = hash2(q[0], q[1], k + i);
    return [cu + (u - cu) * (.55 + .12 * h), cv + (v - cv) * (.55 + .12 * h), y - depth * (.45 + .15 * h)]; });
  band(kit, b, mid, R, cu, cv);
  const T = W(kit, cu, cy - depth, cv);
  for (let i = 0; i < mid.length; i++){ const p = mid[i], q = mid[(i + 1) % mid.length];
    face(b, [T, W(kit, q[0], q[2], q[1]), W(kit, p[0], p[2], p[1])], DOWN); }
  if (tip) crystal(kit, tip, cu, cy - depth - .02, cv, .07, .26, DOWN);
}
/* a small CRYSTAL (a six-sided bipyramid) at local (u, y, v), radius r, length L, pointing along dir */
function crystal(kit, b, u, y, v, r, L, dir = UP, k = 0){
  const c = W(kit, u, y, v), d = dir, ax = Math.abs(d[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
  // an orthonormal pair across d
  let px = d[1] * ax[2] - d[2] * ax[1], py = d[2] * ax[0] - d[0] * ax[2], pz = d[0] * ax[1] - d[1] * ax[0];
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const qx = d[1] * pz - d[2] * py, qy = d[2] * px - d[0] * pz, qz = d[0] * py - d[1] * px;
  const ring = Array.from({ length: 6 }, (_, i) => { const a = i / 6 * Math.PI * 2 + k; const cs = Math.cos(a) * r, sn = Math.sin(a) * r;
    return [c[0] + px * cs + qx * sn + d[0] * L * .3, c[1] + py * cs + qy * sn + d[1] * L * .3, c[2] + pz * cs + qz * sn + d[2] * L * .3]; });
  const tipF = [c[0] + d[0] * L, c[1] + d[1] * L, c[2] + d[2] * L], tipB = [c[0] - d[0] * L * .12, c[1] - d[1] * L * .12, c[2] - d[2] * L * .12];
  for (let i = 0; i < 6; i++){
    const p = ring[i], q = ring[(i + 1) % 6], m = [(p[0] + q[0]) / 2 - c[0], (p[1] + q[1]) / 2 - c[1], (p[2] + q[2]) / 2 - c[2]];
    face(b, [p, q, tipF], [m[0] + d[0] * .4, m[1] + d[1] * .4, m[2] + d[2] * .4]);
    face(b, [q, p, tipB], [m[0] - d[0] * .4, m[1] - d[1] * .4, m[2] - d[2] * .4]);
  }
}

/* ---- the slots a form writes into (lazy: a slot it never touches never learns about its support) ---- */
function slotsOf(kit, spec){
  const unit = spec.loft || spec.id || spec.key, got = {};
  const get = name => got[name] || (got[name] = (() => { const b = kit._bufs[name] || (kit._bufs[name] = newBuf()); (b.units ||= new Set()).add(unit); return b; })());
  return { get rock(){ return get('base'); }, get stone(){ return get('deck'); }, get glow(){ return get('glow'); }, get haze(){ return get('haze'); }, edge: kit._edge };
}
const colOf = (spec, k = 1) => _col.set(spec.color ?? '#8fa6c8').multiplyScalar(k).clone();

/* RUNES round a ring's faces (a slab's fascia): every RUNE_STEP along each edge ≥ .6, centred at y */
function fasciaRunes(kit, S, poly, y, h, col, pulse, cu = 0, cv = 0, closed = true){
  for (let i = 0; i < (closed ? poly.length : poly.length - 1); i++){
    const p = poly[i], q = poly[(i + 1) % poly.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < .6) continue;
    const n = Math.max(1, Math.floor((L - .3) / VD.RUNE_STEP)), du = (q[0] - p[0]) / L, dv = (q[1] - p[1]) / L;
    // outward (local) = away from the axis
    let nu = dv, nv = -du; const mu = (p[0] + q[0]) / 2 - cu, mv = (p[1] + q[1]) / 2 - cv; if (nu * mu + nv * mv < 0){ nu = -nu; nv = -nv; }
    const N = dirW(kit, nu, nv), nl = Math.hypot(N[0], N[2]); N[0] /= nl; N[2] /= nl;
    const U = [N[2], 0, -N[0]];                                         // (the glyph's right, seen from outside)
    for (let k = 0; k < n; k++){
      const s = (k + .5) * L / n, C = W(kit, p[0] + du * s, y, p[1] + dv * s);
      glyph(S.edge, C, U, UP, N, h, glyphOf(C[0], C[2]), col, pulse);
    }
  }
}

/* RAILS OF LIGHT round a deck at T: stone posts, a soft bar of light on top — open over [g0, g1] on gapSide */
function rails(kit, r, T, acc){
  const DIM = kit.DIM, hu = r.hw - .12, hv = r.hd - .12;
  const [gs, g0, g1] = !acc ? [null, 0, 0] : acc.kind === 'stair' ? [acc.side, acc.a1 - acc.out - .05, acc.a1 + .05] : (() => {
    const mid = (acc.a0 + acc.a1) / 2, off = acc.flights > 1 ? ((acc.flights - 1) % 2 ? .45 : -.45) : 0;
    return [acc.side, mid + off - DIM.LAD_HALF - .2, mid + off + DIM.LAD_HALF + .2]; })();
  const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
  for (const [side, p, q] of runs){
    const along = side[1] === 'u' ? 1 : 0;                              // (a ±u side runs along v)
    let segs = [[p, q]];
    if (side === gs){
      const lo = Math.min(p[along], q[along]), hi = Math.max(p[along], q[along]), mk = a => along ? [p[0], a] : [a, p[1]];
      segs = [];
      if (g0 > lo + .3) segs.push([mk(lo), mk(Math.min(hi, g0))]);
      if (g1 < hi - .3) segs.push([mk(Math.max(lo, g1)), mk(hi)]);
    }
    for (const [a, b] of segs){
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .25) continue;
      const n = Math.max(1, Math.ceil(L / VD.RAIL_SPAN)), s = VD.POST / 2;
      for (let i = 0; i <= n; i++){ const u = a[0] + (b[0] - a[0]) * i / n, v = a[1] + (b[1] - a[1]) * i / n;
        kit.box('deck', u - s, u + s, T, T + VD.RAIL_Y - .02, v - s, v + s, 4 | 8 | 16 | 32 | 1);
        kit.box('glow', u - s * .7, u + s * .7, T + VD.RAIL_Y - .02, T + VD.RAIL_Y + .05, v - s * .7, v + s * .7, 63); }
      kit.bar('haze', [a[0], T + VD.RAIL_Y, a[1]], [b[0], T + VD.RAIL_Y, b[1]], .045, .045, 63);
      kit.bar('haze', [a[0], T + VD.RAIL_Y * .5, a[1]], [b[0], T + VD.RAIL_Y * .5, b[1]], .03, .03, 63);
    }
  }
}

/* ---- the forms ---- */
const deckDepth = (r, loft) => Math.max(loft ? VD.DECK_LOFT : VD.DECK, (r.well || 0) + .06);
const cutOf = r => Math.min(VD.CUT, r.hw * .25, r.hd * .25);

/* a DECK: a stone slab (chamfered) at T, depth D — its fascia carries the machine's runes */
function deck(kit, S, r, T, D, runes = true){
  const c = cutOf(r), P = oct(r.hw, r.hd, c), I = oct(r.hw - .04, r.hd - .04, Math.max(0, c - .02));
  chamferSlab(kit, S.stone, S.stone, P, T - D, T, .04, I);
  cap(kit, S.stone, at(P, T - D), DOWN);
  if (runes) fasciaRunes(kit, S, P, T - D / 2 - .02, Math.min(VD.RUNE_H, D * .62), colOf(r), r.pulse);
}
/* a rock CORBEL under a deck (s0 → s1 of its rect over depth h): what a pillar / stack carries */
function corbel(kit, S, r, yTop, h, s0, s1, k){
  const poly = ell(r.hw - .05, r.hd - .05, 12, 0, 0, .26);
  const R = rockBody(kit, S.rock, poly, yTop - h, yTop, [[0, s1], [.55, (s0 + s1) / 2 + .02], [1, s0]], k);
  cap(kit, S.rock, R[0], DOWN);
  return R;
}

/* FLUSH: a dais of the island's own stone */
function dais(kit, S, p, T){
  const F = kit.floor, c = cutOf(p), ch = Math.min(VD.CH, (T - F) * .3);
  chamferSlab(kit, S.stone, S.stone, oct(p.hw, p.hd, c), F - .04, T, ch, oct(p.hw - ch, p.hd - ch, Math.max(0, c - ch * .4)));
}

/* LOW: a terrace — a rock body in courses under a stone cap, runes round the rock under the cap */
function terrace(kit, S, r, T, runes = true){
  const F = kit.floor, c = cutOf(r), y1 = T - VD.CAP, H = y1 - (F - .04);
  const body = oct(r.hw - .06, r.hd - .06, c);
  const courses = Math.max(1, Math.round(H / .9)), prof = [];
  for (let i = 0; i <= courses; i++){ const t = i / courses; prof.push([t, i % 2 ? .985 : 1]); }
  rockBody(kit, S.rock, body, F - .04, y1, prof, 41, 0, 0, .012);
  chamferSlab(kit, S.stone, S.stone, oct(r.hw, r.hd, c), y1, T, .04, oct(r.hw - .04, r.hd - .04, Math.max(0, c - .02)));
  if (runes && H > .5) fasciaRunes(kit, S, body, y1 - .24, Math.min(.26, H * .4), colOf(r), r.pulse);
}
/* carved STEPS (a terrace's): solid rock risers with stone treads, a landing, a sloped stone cheek wall */
function carvedSteps(kit, r, T, acc){
  const F = kit.floor, k = acc.side[0] === '+' ? 1 : -1, ow = acc.out, tr = acc.tread;
  const box = (slotS, slotT, a0, a1, o0, o1, y0, y1) => {           // (a, o) on its side → the frame's (u, v)
    const [u0, u1, v0, v1] = acc.side[1] === 'u' ? [k * (r.hw + o0), k * (r.hw + o1), a0, a1] : [a0, a1, k * (r.hd + o0), k * (r.hd + o1)];
    kit.box(slotS, Math.min(u0, u1), Math.max(u0, u1), y0, y1 - .05, Math.min(v0, v1), Math.max(v0, v1), 4 | 8 | 16 | 32);
    kit.box(slotT, Math.min(u0, u1) - .01, Math.max(u0, u1) + .01, y1 - .05, y1, Math.min(v0, v1) - .01, Math.max(v0, v1) + .01, 1 | 4 | 8 | 16 | 32);
  };
  const aL = acc.a1 - ow;
  for (let i = 1; i < acc.n; i++){ const a0 = acc.a0 + (i - 1) * tr; box('base', 'deck', a0, Math.min(aL, a0 + tr + .02), .03, ow - .2, F - .04, F + i * acc.rise); }
  box('base', 'deck', aL, acc.a1, .02, ow - .2, F - .04, T);
  // the cheek wall: up the flight's open side and along the landing's (stone, its top sloping with the nosings)
  const o0 = ow - .2, o1 = ow - .02, rise = acc.rise, top = (a) => Math.min(T + .5, F + rise + .5 + (a - acc.a0) / Math.max(.01, aL - acc.a0) * (T - F - rise));
  const Wp = (a, o, y) => { const [u, v] = acc.side[1] === 'u' ? [k * (r.hw + o), a] : [a, k * (r.hd + o)]; return W(kit, u, y, v); };
  const S = slotsOf(kit, r), b = S.stone, nO = acc.side[1] === 'u' ? dirW(kit, k, 0) : dirW(kit, 0, k);
  const A0 = acc.a0 + .02, A1 = acc.a1 - .02, Fb = F - .04;
  const ya = top(A0), yb = top(aL), yc = T + .5;
  face(b, [Wp(A0, o1, Fb), Wp(aL, o1, Fb), Wp(aL, o1, yb), Wp(A0, o1, ya)], nO);                       // outer face
  face(b, [Wp(aL, o1, Fb), Wp(A1, o1, Fb), Wp(A1, o1, yc), Wp(aL, o1, yb)], nO);
  face(b, [Wp(A0, o0, ya), Wp(aL, o0, yb), Wp(aL, o1, yb), Wp(A0, o1, ya)], [0, 1, 0]);                // sloped top
  face(b, [Wp(aL, o0, yb), Wp(A1, o0, yc), Wp(A1, o1, yc), Wp(aL, o1, yb)], [0, 1, 0]);
  const nI = [-nO[0], 0, -nO[2]];
  face(b, [Wp(A0, o0, Fb), Wp(aL, o0, Fb), Wp(aL, o0, yb), Wp(A0, o0, ya)], nI);                       // inner face (over the treads)
  face(b, [Wp(aL, o0, Fb), Wp(A1, o0, Fb), Wp(A1, o0, yc), Wp(aL, o0, yb)], nI);
  const nA = acc.side[1] === 'u' ? dirW(kit, 0, -1) : dirW(kit, -1, 0), nB = [-nA[0], 0, -nA[2]];
  face(b, [Wp(A0, o0, Fb), Wp(A0, o1, Fb), Wp(A0, o1, ya), Wp(A0, o0, ya)], nA);
  face(b, [Wp(A1, o0, Fb), Wp(A1, o1, Fb), Wp(A1, o1, yc), Wp(A1, o0, yc)], nB);
}

/* MID: a rock pillar (a hoodoo) with crystal veins under a deck — or, for a loft, several (opts.at) */
const HOODOO = [[0, .84], [.1, .67], [.42, .53], [.72, .57], [.9, .74], [1, .9]];
function pillar(kit, S, r, yTop, { cu = 0, cv = 0, ru = r.hw, rv = r.hd, k = 7, veins = 3 } = {}){
  const F = kit.floor, poly = ell(ru - .08, rv - .08, 11, cu, cv, .3);
  const R = rockBody(kit, S.rock, poly, F - .04, yTop, HOODOO, k, cu, cv, .1);
  // crystal veins: jagged lines of crystal climbing a few of its faces
  const n = poly.length, q0 = kit.w(cu, cv);
  for (let j = 0; j < veins; j++){
    const i = Math.floor(hash2(q0[0], q0[1], k + j * 5) * n + j * n / veins) % n, i1 = (i + 1) % n;
    let prev = null;
    for (let s = 1; s < R.length - 1; s++){
      const t = .5 + (hash2(i, s, k + j) - .5) * .5, A = R[s][i], B = R[s][i1];
      const u = A[0] + (B[0] - A[0]) * t, v = A[1] + (B[1] - A[1]) * t, y = A[2] + (B[2] - A[2]) * t;
      const nu = u - cu, nv = v - cv, nl = Math.hypot(nu, nv) || 1, pnt = W(kit, u + nu / nl * .03, y, v + nv / nl * .03);
      if (prev) stroke(S.glow, prev, pnt, VD.VEIN, dirW(kit, nu / nl, nv / nl));
      prev = pnt;
    }
  }
  return R;
}

/* HIGH: a CAIRN of levitating stones from the floor to yTop — a big rooted base stone, then fewer, smaller,
   rougher boulders toward the top: every one its own height and outline, turned, a little off-centre and
   tilted a few degrees, hovering over the one below on a small core of crystal light (pebbles orbit the
   wider gaps). Everything stays inside the support's (ru, rv) rect, between the floor and yTop. */
const BOULDERS = [
  [[0, .66], [.13, .92], [.46, 1.04], [.82, .96], [1, .7]],
  [[0, .72], [.2, .97], [.58, 1.03], [.88, .9], [1, .62]],
  [[0, .62], [.1, .86], [.36, 1.03], [.76, .99], [1, .74]],
];
const ROOTSTONE = [[0, 1], [.1, 1.03], [.42, .97], [.8, .84], [1, .62]];     // the ground stone: planted, broad at its foot
const MAXB = 1.17;                                                       // (a boulder's widest: bulge 1.04 × jitter 1.12)
function stack(kit, S, r, yTop, { cu = 0, cv = 0, ru = r.hw, rv = r.hd, k = 11, s0 = .72, runes = true, lit = r } = {}){
  const F = kit.floor, y00 = F - .04, H = yTop - y00, q0 = kit.w(cu, cv), hs = (i, j) => hash2(q0[0], q0[1], k + i * 13 + j);
  const K = Math.max(2, Math.round(H / VD.STONE)), col = colOf(lit, .38), RU = Math.max(.12, ru - .1), RV = Math.max(.12, rv - .1);
  // heights: the base stone the tallest, the rest 0.6–1.5 × by hash; the gaps between them vary too
  const wt = Array.from({ length: K }, (_, i) => i === 0 ? 1.45 : .62 + .85 * hs(i, 1));
  const gap = Array.from({ length: K - 1 }, (_, i) => VD.GAP * (.75 + .6 * hs(i, 2)));
  const hSum = H - gap.reduce((s, g) => s + g, 0), wSum = wt.reduce((s, w) => s + w, 0);
  const sBase = Math.min(.84, s0 + .14), sTop = Math.max(.4, s0 - .3);
  let y0 = y00, prev = null;
  for (let i = 0; i < K; i++){
    const h = hSum * wt[i] / wSum, y1 = y0 + h, t = K > 1 ? i / (K - 1) : 0;
    const sc = Math.min(sBase, sBase + (sTop - sBase) * t + (i ? (hs(i, 3) - .5) * .12 : 0));
    const room = Math.max(0, 1 - MAXB * sc) * .95;                      // (how far it may sit off-centre and stay inside)
    const ou = cu + (hs(i, 4) - .5) * 2 * room * RU, ov = cv + (hs(i, 5) - .5) * 2 * room * RV;
    const ra = RU * sc, rb = RV * sc, a0 = hs(i, 6) * 6.283, poly = ell(ra, rb, 9, ou, ov, a0);
    // a tilt (a few degrees, not the ground stone, not the one carrying the deck): sheared rings inside [y0, y1]
    const tilt = i && i < K - 1 ? .045 + .05 * hs(i, 7) : 0, ta = hs(i, 8) * 6.283, tu = Math.cos(ta) * tilt, tv = Math.sin(ta) * tilt;
    const lean = Math.min(h * .2, (Math.abs(tu) * ra + Math.abs(tv) * rb) * MAXB);
    const prof = i ? BOULDERS[Math.floor(hs(i, 9) * BOULDERS.length) % BOULDERS.length] : ROOTSTONE;
    const yb = y0 + lean, ye = y1 - lean, sh = (p, y) => [p[0], p[1], y + Math.max(-lean, Math.min(lean, (p[0] - ou) * tu + (p[1] - ov) * tv))];
    const R = prof.map(([tt, f], j) => rockRing(kit, poly, f, yb + tt * (ye - yb), k + i * 11 + j * 3, ou, ov, j === 2 ? .12 : .08, j && j < 4 ? h * .03 : 0).map(p => sh(p, p[2])));
    for (let j = 0; j + 1 < R.length; j++) band(kit, S.rock, R[j], R[j + 1], ou, ov);
    const dome = (ring, y, want) => { let mu = 0, mv = 0; for (const p of ring){ mu += p[0]; mv += p[1]; } mu /= ring.length; mv /= ring.length;
      const C = W(kit, mu, Math.min(y1, Math.max(y0, sh([mu, mv], y)[2])), mv); for (let a = 0; a < ring.length; a++){ const p = ring[a], q = ring[(a + 1) % ring.length]; face(S.rock, [C, W(kit, p[0], p[2], p[1]), W(kit, q[0], q[2], q[1])], want); } };
    dome(R[R.length - 1], Math.min(y1, ye + h * .04), UP); dome(R[0], i ? Math.max(y0, yb - h * .04) : y0 + .02, DOWN);
    if (runes && (i === 0 || hs(i, 10) < .5)){                            // faint runes on the base stone and on some others
      const mid = R[2];
      for (let f = 0; f < 9; f += 3){
        const A = mid[f], B = mid[(f + 1) % 9], mu = (A[0] + B[0]) / 2, mv = (A[1] + B[1]) / 2, nu = mu - ou, nv = mv - ov, nl = Math.hypot(nu, nv) || 1;
        const N = dirW(kit, nu / nl, nv / nl), C = W(kit, mu, (A[2] + B[2]) / 2, mv);
        glyph(S.edge, C, [N[2], 0, -N[0]], UP, N, Math.min(.5, h * .16), glyphOf(C[0], C[2], i), col, lit.pulse ?? 0, .06);
      }
    }
    if (prev){                                                            // a small core of light in the air between them
      const g0 = prev.y1, g1 = y0, mu = (prev.ou + ou) / 2, mv = (prev.ov + ov) / 2, rr = Math.min(prev.ra, ra) * .26, rs = Math.min(prev.rb, rb) * .26;
      glowGap(kit, S, mu, mv, rr, rs, g0 - .04, g1 + .04, .06);
      // a pebble or two orbiting the gap, just outside the stones' tapered ends
      const np = g1 - g0 > .3 ? 1 + (hs(i, 11) > .55 ? 1 : 0) : 0;
      for (let p = 0; p < np; p++){
        const a = hs(i, 12 + p) * 6.283 + p * 2.6, pr = Math.min(.2, .06 + .05 * Math.min(ra, rb));
        const lim = (d, R) => Math.max(-(R - pr), Math.min(R - pr, d));
        const pu = cu + lim(mu - cu + Math.cos(a) * Math.min(prev.ra, ra) * .82, RU), pv = cv + lim(mv - cv + Math.sin(a) * Math.min(prev.rb, rb) * .82, RV);
        const yp = (g0 + g1) / 2 + (hs(i, 14 + p) - .5) * .08;
        crystal(kit, S.rock, pu, yp - pr * .3, pv, pr, pr * 1.3, UP, a);
      }
    }
    prev = { ou, ov, ra, rb, y1 };
    y0 = y1 + (i < K - 1 ? gap[i] : 0);
  }
  return y00 + H;
}

/* a STAIR of floating STEPPING STONES (a mid platform's): each a little island with a glowing tip */
function steppingStones(kit, S, r, T, acc){
  const F = kit.floor, k = acc.side[0] === '+' ? 1 : -1, ow = acc.out, tr = acc.tread, aL = acc.a1 - ow;
  const loc = (a, o) => acc.side[1] === 'u' ? [k * (r.hw + o), a] : [a, k * (r.hd + o)];
  const stone = (a0, a1, o0, o1, y, t, depth, kk, tip = false) => {
    const [u0, v0] = loc(a0, o0), [u1, v1] = loc(a1, o1), cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, hu = Math.abs(u1 - u0) / 2, hv = Math.abs(v1 - v0) / 2;
    const poly = oct(hu, hv, Math.min(hu, hv) * .3, cu, cv), inset = oct(hu - .03, hv - .03, Math.max(0, Math.min(hu, hv) * .3 - .01), cu, cv);
    const air = y - t - F;                                              // (what's under it: near the ground a stone rests on it)
    // a soft line of light along its nosing (the edge you step up onto): the stair reads as treads
    const [nu0, nv0] = loc(a0 + .05, o0 + .06), [nu1, nv1] = loc(a0 + .05, o1 - .06);
    kit.bar('haze', [nu0, y - .015, nv0], [nu1, y - .015, nv1], .05, .04, 63);
    if (air < depth + .45){ chamferSlab(kit, S.stone, S.stone, poly, F - .04, y, .03, inset); return; }
    chamferSlab(kit, S.stone, S.stone, poly, y - t, y, .03, inset);
    keel(kit, S.rock, rockRing(kit, poly, 1, y - t, kk, cu, cv, .02), depth, kk, tip ? S.glow : null);
  };
  for (let i = 1; i < acc.n; i++){
    const a0 = acc.a0 + (i - 1) * tr;
    stone(a0 + .03, Math.min(aL - .03, a0 + tr - .03), .1, ow - .1, F + i * acc.rise, VD.STEP_T, .34, 50 + i);
  }
  stone(aL + .02, acc.a1 - .02, .02, ow - .05, T, .3, .55, 49, true);
}

/* a LADDER OF LIGHT (footing.js access: flights, landings, a cage past FOOT.CAGE) */
function lightLadder(kit, S, r, T, acc){
  const F = kit.floor, DIM = kit.DIM, k = acc.side[0] === '+' ? 1 : -1;
  const P = (a, o, y) => { const [u, v] = acc.side[1] === 'u' ? [k * (r.hw + o), a] : [a, k * (r.hd + o)]; return [u, y, v]; };
  const nf = acc.flights, mid = (acc.a0 + acc.a1) / 2, off = nf > 1 ? .45 : 0, O = DIM.LAD_OUT, hh = DIM.LAD_HALF;
  for (let f = 0; f < nf; f++){
    const y0 = F + (T - F) * f / nf, y1 = F + (T - F) * (f + 1) / nf, ac = mid + (f % 2 ? off : -off), top = f === nf - 1;
    for (const s of [-hh, hh]) kit.bar('haze', P(ac + s, O, f ? y0 + .02 : F), P(ac + s, O, y1 + (top ? 1.15 : .95)), VD.BAR, VD.BAR, 63);
    for (let y = y0 + DIM.RUNG_DY; y < y1 - .05; y += DIM.RUNG_DY) kit.bar('glow', P(ac - hh, O, y), P(ac + hh, O, y), VD.RUNG, VD.RUNG, 63);
    if (acc.cage){
      const c0 = y0 + (f ? 1.3 : 3.2), c1 = y1 + (top ? 1.1 : .9), R1 = O + .74, hw = hh + .2;
      if (c1 > c0 + .3){
        const n = Math.max(1, Math.round((c1 - c0) / 1.5));
        for (let i = 0; i <= n; i++){ const y = c0 + (c1 - c0) * i / n;
          kit.bar('haze', P(ac - hw, O - .02, y), P(ac - hw, R1, y), .028, .028, 63);
          kit.bar('haze', P(ac - hw, R1, y), P(ac + hw, R1, y), .028, .028, 63);
          kit.bar('haze', P(ac + hw, R1, y), P(ac + hw, O - .02, y), .028, .028, 63); }
        for (const [a, o] of [[-hw, R1], [hw, R1], [0, R1]]) kit.bar('haze', P(ac + a, o, c0), P(ac + a, o, c1), .024, .024);
      }
    }
    if (!top){                                                            // a floating stone landing where this flight meets the next
      const [u0, , v0] = P(acc.a0 + .05, -.2, 0), [u1, , v1] = P(acc.a1 - .05, acc.out - .06, 0);
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, hu = Math.abs(u1 - u0) / 2, hv = Math.abs(v1 - v0) / 2;
      const poly = oct(hu, hv, Math.min(hu, hv) * .3, cu, cv);
      chamferSlab(kit, S.stone, S.stone, poly, y1 - .24, y1, .03, oct(hu - .03, hv - .03, Math.max(0, Math.min(hu, hv) * .3 - .01), cu, cv));
      keel(kit, S.rock, rockRing(kit, poly, 1, y1 - .24, 60 + f, cu, cv, .02), .55, 60 + f, S.glow);
    }
  }
}
function access(kit, S, r, T, acc, solid){
  if (!acc) return;
  if (acc.kind === 'ladder') lightLadder(kit, S, r, T, acc);
  else if (solid) carvedSteps(kit, r, T, acc);
  else steppingStones(kit, S, r, T, acc);
}

/* OPEN: a rock column under every foot, a ring of runes on the island round its feet; nothing crosses what
   hangs (pad.hang). A tall one is built in TIERS (≤ VD.TIER): its columns grow stouter with height, and at
   every tier a dressed-stone collar rings each column and a stone LINTEL with a seam of crystal light under
   it ties each column to the next — an aqueduct of the island's stone — except where a lintel would pass
   what hangs (then only below its lowest part, pad.hangY). A lifted one is climbed by a ladder of light. */
function segHits(p, q, R, g){                                           // (footing3d's: does p → q cross R grown by g?)
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
const COLUMN = [[0, 1.12], [.15, .96], [.6, .9], [.88, .98], [1, 1.1]];
function openStand(kit, S, p){
  const F = kit.floor, T = p.top, H = T - F;
  const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6), .3]);
  const HG = p.hang, clip = (u, v, s, rr) => {                          // (as the kit's: a post slides off what hangs, never off its foot)
    if (!HG) return [u, v];
    const x0 = HG[0] - .05, x1 = HG[1] + .05, z0 = HG[2] - .05, z1 = HG[3] + .05;
    if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
    const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
    return Math.abs(du + dv) <= rr ? [u + du, v + dv] : null;
  };
  const yA = F + .16, yB = T - .1, nT = H > VD.TIER + 1 ? Math.ceil((yB - yA) / VD.TIER) : 1;
  const yT = Array.from({ length: nT + 1 }, (_, t) => yA + (yB - yA) * t / nT);
  const grow = 1 + Math.min(.45, Math.max(0, H - 4) / 30);              // (a taller column is a stouter one)
  const cu0 = feet.reduce((s, f) => s + f[0], 0) / feet.length, cv0 = feet.reduce((s, f) => s + f[1], 0) / feet.length;
  const hull = [];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  feet.slice().sort((f, g) => Math.atan2(f[1] - cv0, f[0] - cu0) - Math.atan2(g[1] - cv0, g[0] - cu0)).forEach(([fu, fv, rr = .3], i) => {
    u0 = Math.min(u0, fu); u1 = Math.max(u1, fu); v0 = Math.min(v0, fv); v1 = Math.max(v1, fv);
    const s0 = Math.max(.2, Math.min(.36, rr * .55)), s = Math.min(s0 * grow, .5), q = clip(fu, fv, s + .06, rr);
    if (!q) return;
    const [u, v] = q;
    hull.push([u, v, s]);
    kit.box('deck', u - s0 - .16, u + s0 + .16, T - .1, T, v - s0 - .16, v + s0 + .16, 63);          // the cap under the foot
    kit.box('deck', u - s - .24, u + s + .24, F - .04, F + .16, v - s - .24, v + s + .24, 1 | 4 | 8 | 16 | 32);   // its base stone
    const poly = ell(s + .06, s + .06, 7, u, v, .4 + i);
    for (let t = 0; t < nT; t++){
      const c0 = yT[t] + (t ? .14 : -.06), c1 = yT[t + 1] - (t < nT - 1 ? .14 : 0);
      const R = rockBody(kit, S.rock, poly, c0, c1, COLUMN, 80 + i * 6 + t * 17, u, v, .08);
      // a vein up its outer face
      const n = poly.length, j = Math.floor(hash2(u, v, 81 + t) * n), j1 = (j + 1) % n;
      let prev = null;
      for (let k = 1; k < R.length - 1; k++){ const A = R[k][j], B = R[k][j1], mu = (A[0] + B[0]) / 2, mv = (A[1] + B[1]) / 2, my = (A[2] + B[2]) / 2;
        const nu = mu - u, nv = mv - v, nl = Math.hypot(nu, nv) || 1, P = W(kit, mu + nu / nl * .03, my, mv + nv / nl * .03);
        if (prev) stroke(S.glow, prev, P, VD.VEIN * .8, dirW(kit, nu / nl, nv / nl)); prev = P; }
      if (t){ const c = s + .2;                                           // the collar where two tiers meet
        chamferSlab(kit, S.stone, S.stone, oct(c, c, c * .3, u, v), yT[t] - .16, yT[t] + .16, .03, oct(c - .03, c - .03, c * .3 - .01, u, v));
        cap(kit, S.stone, at(oct(c, c, c * .3, u, v), yT[t] - .16), DOWN); }
    }
  });
  // the lintels: each column to the next at every tier, a seam of crystal light under each
  if (nT > 1 && hull.length > 1){
    const clearY = Number.isFinite(p.hangY) ? p.hangY - .3 : -Infinity;
    for (let i = 0; i < hull.length; i++){
      if (hull.length === 2 && i) break;
      const a = hull[i], b = hull[(i + 1) % hull.length], near = segHits(a, b, HG, .4);
      for (let t = 1; t < nT; t++){
        const y = yT[t];
        if (near && y + .2 > clearY) continue;                            // (a lintel never crosses what hangs)
        kit.bar('deck', [a[0], y, a[1]], [b[0], y, b[1]], .3, .3, 63);
        kit.bar('glow', [a[0], y - .19, a[1]], [b[0], y - .19, b[1]], .1, .05, 63);
      }
    }
  }
  // the ring of runes round its feet, carved flat into the island
  const ru0 = Math.max(-p.hw + .2, u0 - .75), ru1 = Math.min(p.hw - .2, u1 + .75), rv0 = Math.max(-p.hd + .2, v0 - .75), rv1 = Math.min(p.hd - .2, v1 + .75);
  const col = colOf(p), edges = [[[ru0, rv0], [ru1, rv0]], [[ru1, rv0], [ru1, rv1]], [[ru1, rv1], [ru0, rv1]], [[ru0, rv1], [ru0, rv0]]];
  for (const [a, b] of edges){
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.floor(L / .85));
    const du = (b[0] - a[0]) / L, dv = (b[1] - a[1]) / L, inU = -dv, inV = du;    // (the ring runs CCW in (u, v): inward is its left)
    for (let i = 0; i < n; i++){
      const s = (i + .5) * L / n, C = W(kit, a[0] + du * s, F + RING_Y, a[1] + dv * s);
      const Vw = dirW(kit, inU, inV), Uw = dirW(kit, du, dv);
      glyph(S.edge, C, Uw, Vw, UP, .34, glyphOf(C[0], C[2], 2), col, p.pulse, .004);
    }
  }
  access(kit, S, p, T, p.access, false);                                // (lifted off the island: a ladder of light)
}

/* ---- the STYLE (rooms/footing3d.js): the room hands over its materials ---- */
export function voidFootingStyle(M){
  const NONE = new THREE.Group(); NONE.name = 'void-footing';           // (handled: every form writes into the merged slots)
  const raised = (p, kit, S) => {
    const T = p.top, D = deckDepth(p, false), F = kit.floor, H = T - F;
    if (p.band === 'low'){ terrace(kit, S, p, T); access(kit, S, p, T, p.access, true); return; }
    deck(kit, S, p, T, D);
    const cb = Math.min(1.2, H * .18);
    if (p.band === 'mid') for (const [cu, cv, ru, rv, i] of supports(p)) pillar(kit, S, p, T - D, { cu, cv, ru, rv, k: 7 + i * 5, veins: ru * rv > 4 ? 3 : 2 });
    else {
      corbel(kit, S, p, T - D, cb, .92, .62, 13);
      for (const [cu, cv, ru, rv, i] of supports(p)){
        stack(kit, S, p, T - D - cb - VD.GAP, { cu, cv, ru, rv, k: 11 + i * 7 });
        glowGap(kit, S, cu, cv, (ru - .1) * .24, (rv - .1) * .24, T - D - cb - VD.GAP, T - D - cb, .06);
      }
    }
    rails(kit, p, T, p.access);
    access(kit, S, p, T, p.access, false);
  };
  return {
    key: 'void',
    mats: () => ({ base: M.rock, deck: M.stone, steel: M.rock, glow: M.glow, haze: M.haze, edge: M.rune }),
    edge: () => NONE,                                                   // (its light is the forms' own runes)
    flush(p, kit){ dais(kit, slotsOf(kit, p), p, p.fixed ? kit.floor + FOOT.KERB : p.top); return NONE; },
    low(p, kit){ const S = slotsOf(kit, p); p.open ? openStand(kit, S, p) : raised(p, kit, S); return NONE; },
    mid(p, kit){ const S = slotsOf(kit, p); p.open ? openStand(kit, S, p) : raised(p, kit, S); return NONE; },
    high(p, kit){ const S = slotsOf(kit, p); p.open ? openStand(kit, S, p) : raised(p, kit, S); return NONE; },
    /* a FLOATING RIDGE: the deck on a rock keel, carried by the band's support spaced along it */
    loft(L, kit){
      const S = slotsOf(kit, L), F = kit.floor, T = L.top, D = deckDepth(L, true), members = kit.plan.pads.filter(p => p.loft === L.id);
      if (L.band === 'low'){ terrace(kit, S, L, T, false); access(kit, S, L, T, L.access, true); }
      else {
        deck(kit, S, L, T, D, false);
        const keelH = Math.min(2.2, (T - D - F) * .3), yK = T - D - keelH;
        corbel(kit, S, L, T - D, keelH, .94, .5, 17);
        const along = L.hw >= L.hd, span = 2 * (along ? L.hw : L.hd), n = Math.max(L.band === 'high' ? 2 : 1, Math.round(span / 10));
        for (let i = 0; i < n; i++){
          const c = n === 1 ? 0 : (-span / 2 + span * (i + .5) / n) * .92, w = Math.min(2.4, span / n * .32);
          const [cu, cv, ru, rv] = along ? [c, 0, w, L.hd * .7] : [0, c, L.hw * .7, w];
          if (L.band === 'mid') pillar(kit, S, L, yK + .2, { cu, cv, ru: ru + .1, rv: rv + .1, k: 21 + i * 4, veins: 2 });
          else {
            const yT = yK - VD.GAP, q = kit.w(cu, cv), lit = members.reduce((b, m) => !b || Math.hypot(m.x - q[0], m.z - q[1]) < Math.hypot(b.x - q[0], b.z - q[1]) ? m : b, null) || L;
            stack(kit, S, L, yT, { cu, cv, ru: ru + .1, rv: rv + .1, k: 31 + i * 4, s0: .9, lit }); glowGap(kit, S, cu, cv, ru * .24, rv * .24, yT, yK, .06);
          }
        }
        rails(kit, L, T, L.access);
        access(kit, S, L, T, L.access, false);
      }
      // each member's runes: its stretch of the deck's fascia (front + back), and round its ends
      const yR = L.band === 'low' ? T - VD.CAP - .24 : T - D / 2 - .02, hR = L.band === 'low' ? .26 : Math.min(VD.RUNE_H, D * .62);
      const along = L.hw >= L.hd;                                         // (a loft is axis-aligned: its long faces carry its members' runes)
      for (const m of members){
        let m0 = Infinity, m1 = -Infinity;
        const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0);
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
          const x = m.x + c * a * m.hw + s * b * m.hd - L.x, z = m.z - s * a * m.hw + c * b * m.hd - L.z, q = along ? x : z;
          m0 = Math.min(m0, q); m1 = Math.max(m1, q);
        }
        const lim = (along ? L.hw : L.hd) - .3;
        m0 = Math.max(-lim, m0 + .15); m1 = Math.min(lim, m1 - .15);
        if (m1 <= m0) continue;
        const e = (along ? L.hd : L.hw) - (L.band === 'low' ? .06 : 0);
        const runs = along ? [[[m0, -e], [m1, -e]], [[m1, e], [m0, e]]] : [[[e, m0], [e, m1]], [[-e, m1], [-e, m0]]];
        for (const run of runs) fasciaRunes(kit, S, run, yR, hR, colOf(m), m.pulse, 0, 0, false);
      }
      return NONE;
    },
  };
}
/* a long pad stands on several supports along its long side (one per ~1.5 × its depth): [cu, cv, ru, rv, i] */
function supports(r){
  const along = r.hw >= r.hd, ratio = along ? r.hw / r.hd : r.hd / r.hw, n = ratio > 1.9 ? Math.min(4, Math.round(ratio / 1.4)) : 1;
  return Array.from({ length: n }, (_, i) => {
    const c = n === 1 ? 0 : -1 + (2 * i + 1) / n;
    return along ? [c * r.hw, 0, r.hw / n, r.hd, i] : [0, c * r.hd, r.hw, r.hd / n, i];
  });
}
/* the cushion of light between a stack's top stone and what it carries */
function glowGap(kit, S, cu, cv, ru, rv, y0, y1, ins = .1){
  if (y1 - y0 < 2 * ins + .08 || ru < .05 || rv < .05) return;
  slab(kit, S.glow, S.glow, ell(ru, rv, 8, cu, cv, .3), y0 + ins, y1 - ins, { bottom: true });
}

/* ---- the Void's MATERIALS (one set per room: the islands AND the footing wear them) ---- */
const canvas = (n, draw) => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
};
const prng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
/* rock: a mid grey (the colour multiplies it) in soft strata, mottled, speckled — its rows run along y on a
   wall (the kit's box-projected uvs: a 4 u tile) */
function rockTex(){
  return canvas(256, (x, n) => {
    const R = prng(91);
    x.fillStyle = '#a7a3b4'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 26; i++){                                       // strata: soft bands of varying tone
      const y = R() * n, h = 3 + R() * 18, v = R() < .5 ? '70,66,88' : '200,196,214';
      x.fillStyle = `rgba(${v},${.08 + R() * .12})`;
      for (const oy of [-n, 0, n]) x.fillRect(0, y + oy, n, h);
    }
    for (let i = 0; i < 70; i++){                                       // mottling
      const cx = R() * n, cy = R() * n, r = 10 + R() * 40;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${R() < .5 ? '60,56,80' : '210,206,224'},${.06 + R() * .08})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    for (let i = 0; i < 9; i++){                                        // a few fine cracks, mostly across the strata
      x.strokeStyle = `rgba(40,36,56,${.25 + R() * .2})`; x.lineWidth = .8 + R(); x.beginPath();
      let px = R() * n, py = R() * n; x.moveTo(px, py);
      for (let k = 0; k < 6; k++){ px += (R() - .5) * 26; py += (R() - .3) * 18; x.lineTo(px, py); }
      x.stroke();
    }
    for (let i = 0; i < 2400; i++){ const v = R() < .5 ? 70 : 215; x.fillStyle = `rgba(${v},${v},${v + 8},${.05 + R() * .08})`; x.fillRect(R() * n, R() * n, 1 + R() * 1.5, 1 + R() * 1.5); }
  });
}
/* dressed stone: flags of slightly differing tone, fine dark joints (a 4 u tile: 2 × 2 flags ≈ 1.35 m each) */
function stoneTex(){
  return canvas(256, (x, n) => {
    const R = prng(57), half = n / 2;
    x.fillStyle = '#8f8ca2'; x.fillRect(0, 0, n, n);
    const flags = [[0, 0, half, half], [half, 0, half, half * .62], [half, half * .62, half, half * 1.38], [0, half, half * .7, half], [half * .7, half, half * .3, half]];
    for (const [fx, fy, fw, fh] of flags){
      const t = 128 + (R() - .5) * 34; x.fillStyle = `rgb(${t},${t - 2},${t + 14})`; x.fillRect(fx, fy, fw, fh);
      for (let i = 0; i < 14; i++){ const cx = fx + R() * fw, cy = fy + R() * fh, r = 6 + R() * 26;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, `rgba(${R() < .5 ? '80,76,100' : '200,198,220'},.07)`); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
      x.strokeStyle = 'rgba(30,28,44,.55)'; x.lineWidth = 2; x.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
      x.strokeStyle = 'rgba(220,218,236,.12)'; x.lineWidth = 1; x.strokeRect(fx + 3, fy + 3, fw - 6, fh - 6);
    }
    for (let i = 0; i < 1800; i++){ const v = R() < .5 ? 80 : 210; x.fillStyle = `rgba(${v},${v},${v + 10},${.04 + R() * .06})`; x.fillRect(R() * n, R() * n, 1, 1); }
  });
}
/* the RUNES' light: additive, unlit, fog-free — each vertex reads its machine's slot of uPulse (the
   footing's edge: buildFooting writes it), uBase at rest, + uGain on a strike */
export function makeRuneMat({ slots = FOOT.MAX_PULSE, base = .22, gain = 1.7 } = {}){
  return new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: new Float32Array(slots) }, uBase: { value: base }, uGain: { value: gain } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPulse;
      uniform float uPulse[${slots}]; uniform float uBase, uGain;
      varying vec3 vC;
      void main(){
        vC = aColor * (uBase + uGain * uPulse[int(clamp(aPulse + .5, 0., ${(slots - 1).toFixed(1)}))]);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){
        gl_FragColor = vec4(vC, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
export const GLOW_I = 1.15;                                           // the crystals' resting glow (the room breathes it)
export function makeVoidMats({ envMap = null, floor = -5.5 } = {}){
  const rt = rockTex(), st = stoneTex();
  const M = {
    rock: new THREE.MeshStandardMaterial({ color: 0xc4b6bc, map: rt, roughness: .88, metalness: .04, emissive: 0x2c2444, emissiveMap: rt, emissiveIntensity: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xb2aac4, map: st, roughness: .72, metalness: .12, envMap, envMapIntensity: .3, emissive: 0x231d3a, emissiveMap: st, emissiveIntensity: 1 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x101830, emissive: 0x63d2ff, emissiveIntensity: GLOW_I, roughness: .3, metalness: .1 }),
    haze: new THREE.MeshBasicMaterial({ color: 0x4f5fb4 }),
    rune: makeRuneMat(),
    dispose(){ rt?.dispose(); st?.dispose(); for (const k of ['rock', 'stone', 'glow', 'haze', 'rune']) M[k].dispose(); },
  };
  /* the rock's UNDERSIDE glows: the haze and the pillars of light below light it from beneath (a pure fn
     of height: nothing over the floor changes) — rooms own no lights */
  const under = { uUnder: { value: new THREE.Color(0x3a3a9a) }, uY0: { value: floor - 1.5 }, uY1: { value: floor - 13 } };
  M.rock.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, under);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWy = (modelMatrix * vec4(transformed, 1.)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWy; uniform vec3 uUnder; uniform float uY0, uY1;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uUnder * smoothstep(uY0, uY1, vWy) * (.55 + .45 * diffuseColor.g);');
  };
  M.rock.customProgramCacheKey = () => 'void-rock-under';
  return M;
}
