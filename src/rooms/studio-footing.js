import * as THREE from 'three';
import { FOOT, railed, sideNormal } from './footing.js';
import { studioAtlas } from './studio-atlas.js';
import { AUDIENCE } from './studio-props.js';
/* ============================================================
   MIDNIGHT STUDIO — what the machines stand on, in a live room's idiom (a style for
   rooms/footing3d.js: its header is the contract). Every band reads as studio + touring gear:

     flush  a RUG RISER — a low black kickboard riser under a worn Persian rug (its border, corners
            and medallion keep their size whatever the rug's; ivory fringe over the ends the audience
            sees at left and right). The belt stands in a plain black riser with an aluminium cap.
     low    a CARPETED RISER — charcoal carpet, an aluminium nosing, a black kickboard; solid black
            stage steps with carpet treads.
     mid    ROAD-CASE PIERS — stacks of black flight cases (aluminium valance, ball corners, lid
            seam, butterfly latches, handles, stencils) strapped with orange ratchet straps, under
            a carpeted black stage deck; an open black stair or a black ladder.
     high   a black GROUND-SUPPORT truss tower: box-truss columns on splayed outriggers + jacks, the
            deck on truss beams, a caged ladder, a few cases left at its foot.
     loft   a MEZZANINE CATWALK — a grating deck, black rails; on ground support a cable tray hangs
            under its front with a few cables sagging out of it.
     open   (the turntable: something hangs below what it stands on) the kit's posts in black, and
            an amp case between them that carries its panel.
   THE PANEL (the reaction — the edge hook claims every pad): on the support's audience face, just
   under the machine, a red TALLY lamp that glows while it plays, a 12-segment VU meter (8 green,
   2 amber, 2 red, a falling peak-hold) that fills with its strikes, and its NAME, stencilled. All of
   it is ONE additive draw (the kit's edge buffer: aPulse = slot + code — segCode / TALLY_CODE),
   lit by three uniform arrays the ROOM writes every frame (style.vu: level / peak / tally, pure fns
   of songTime from makePulse — studio.js place / update).
   Cost: every painted surface (rugs, carpet, cases, stencils, grating, straps, alu) is ONE merged
   slot ('studio') in one atlas material (studio-atlas.js); black steel / deck / kickboard are the
   kit's slots in this room's materials; + the edge — ≤ 5 draws a song.
   Envelope: every part stays inside its support's footingBoxes envelope (the panel's LEDs stand
   ≤ .024 proud of a face inset ≥ .025; the rug's top is .012 under the pad's top).
   ============================================================ */

const SLOT = 'studio';
const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;
const MAXP = FOOT.MAX_PULSE;
const RUG_T = .035, RUG_DROP = .012, RUG_B = .5, FIELD_T = 2.4, FRINGE = .22, KICK_IN = .04;   // a rug: thickness, under the top, border, field tile, fringe
const CARPET_T = 2, GRATE_T = 1.6, STRAP_W = .2, STRAP_T = .8, CASE_H = 1.45;   // tiles (u per tile) · a case's nominal height
const DECAL = .012;                                                             // how proud a painted decal stands (depth-safe at 100 u)
const N_SEG = 12;                                                               // the VU meter (8 green, 2 amber, 2 red)
const LED = { green: 0x3dff72, amber: 0xffb02a, red: 0xff2b2b };
const HAND = 1.3;                                                               // a stair's handrail over its nosing line

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(s){ s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed){ let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* the kit's own rules (rooms/footing3d.js), restated so the studio's decks meet its ladders + rails */
const deckDepth = (r, DIM) => Math.max(r.keys || r.band === 'high' ? DIM.DECK_HI : DIM.DECK, (r.well || 0) + DIM.WELL);
const landings = (r, F) => { const nf = r.access?.flights || Math.max(1, Math.ceil((r.top - F) / FOOT.LAND_DY)), out = [];
  for (let f = 1; f < nf; f++) out.push(F + (r.top - F) * f / nf); return out; };
const gapOf = (acc, DIM) => !acc ? [null, 0, 0] : acc.kind === 'stair' ? [acc.side, acc.a1 - acc.out, acc.a1] : (() => {
  const mid = (acc.a0 + acc.a1) / 2, off = acc.flights > 1 ? ((acc.flights - 1) % 2 ? .45 : -.45) : 0;
  return [acc.side, mid + off - DIM.LAD_HALF - .15, mid + off + DIM.LAD_HALF + .15]; })();
function ring(hu, hv, span){
  const nu = Math.max(1, Math.ceil(2 * hu / span - 1e-9)), nv = Math.max(1, Math.ceil(2 * hv / span - 1e-9)), out = [];
  for (let i = 0; i < nu; i++) out.push([-hu + 2 * hu * i / nu, -hv]);
  for (let i = 0; i < nv; i++) out.push([hu, -hv + 2 * hv * i / nv]);
  for (let i = 0; i < nu; i++) out.push([hu - 2 * hu * i / nu, hv]);
  for (let i = 0; i < nv; i++) out.push([-hu, hv - 2 * hv * i / nv]);
  return out;
}
/* (along a, out o) on one side of a rect → local [u, v] (footing.js access: a ±u side runs along v) */
const onSide = (r, side) => { const k = side[0] === '+' ? 1 : -1;
  return side[1] === 'u' ? (a, o) => [k * (r.hw + o), a] : (a, o) => [a, k * (r.hd + o)]; };

/* ---- the WRITER: the studio's own slot in the kit's merged buffers, with uvs into the atlas
   (the kit's writer projects world uvs — a rug's border or a case's corner needs its own) ---- */
const FACE = {
  [PZ]: { N: [0, 0, 1], A: [1, 0, 0], B: [0, 1, 0] }, [NZ]: { N: [0, 0, -1], A: [-1, 0, 0], B: [0, 1, 0] },
  [PX]: { N: [1, 0, 0], A: [0, 0, -1], B: [0, 1, 0] }, [NX]: { N: [-1, 0, 0], A: [0, 0, 1], B: [0, 1, 0] },
  [PY]: { N: [0, 1, 0], A: [1, 0, 0], B: [0, 0, -1] }, [NY]: { N: [0, -1, 0], A: [1, 0, 0], B: [0, 0, 1] },
};
function writer(kit){
  if (kit.__studio) return kit.__studio;
  const b = kit._bufs[SLOT] || (kit._bufs[SLOT] = { edge: false, p: new Float32Array(3 * 4096), n: new Float32Array(3 * 4096), uv: new Float32Array(2 * 4096),
    c: null, k: null, i: new Uint32Array(6 * 4096), nv: 0, ni: 0, units: new Set() });
  let FX = 0, FZ = 0, C = 1, Sn = 0, unit = null, seen = null;
  const grow = (nv, ni) => {
    if ((b.nv + nv) * 3 > b.p.length){ const cap = Math.max(b.p.length * 2, (b.nv + nv) * 3);
      const up = (a, per) => { const q = new Float32Array(cap / 3 * per); q.set(a); return q; }; b.p = up(b.p, 3); b.n = up(b.n, 3); b.uv = up(b.uv, 2); }
    if (b.ni + ni > b.i.length){ const q = new Uint32Array(Math.max(b.i.length * 2, b.ni + ni)); q.set(b.i); b.i = q; }
  };
  /* (scratch: the writer runs a few thousand faces a build — no arrays per face) */
  const BC = [0, 0, 0], RX = [0, 0, 0], RY = [0, 0, 0], RZ = [0, 0, 0], NXv = [0, 0, 0], NZv = [0, 0, 0], RC = [0, 0, 0];
  const W = {
    frame(r){ FX = r.x; FZ = r.z; C = Math.cos(r.yaw || 0); Sn = Math.sin(r.yaw || 0); unit = r.loft || r.id || r.key; return W; },
    /* one quad: 4 local points [u, y, v] counter-clockwise seen from its local normal N, uvs [s, t] */
    quad(P, N, UV){
      grow(4, 6); if (unit !== seen){ b.units.add(unit); seen = unit; }
      const v = b.nv, nx = C * N[0] + Sn * N[2], nz = -Sn * N[0] + C * N[2];
      for (let j = 0; j < 4; j++){
        const Pj = P[j], u = Pj[0], w = Pj[2], o = (v + j) * 3, q = (v + j) * 2;
        b.p[o] = FX + C * u + Sn * w; b.p[o + 1] = Pj[1]; b.p[o + 2] = FZ - Sn * u + C * w;
        b.n[o] = nx; b.n[o + 1] = N[1]; b.n[o + 2] = nz;
        b.uv[q] = UV[j][0]; b.uv[q + 1] = UV[j][1];
      }
      const i = b.ni; b.i[i] = v; b.i[i + 1] = v + 1; b.i[i + 2] = v + 2; b.i[i + 3] = v; b.i[i + 4] = v + 2; b.i[i + 5] = v + 3;
      b.nv += 4; b.ni += 6;
    },
    /* a face: centre Cc, in-plane unit axes A (half ha) × B (half hb) — A × B is its normal; uv(pa, pb, ha, hb) → [s, t] per corner */
    face(Cc, A, ha, B, hb, uv){
      grow(4, 6); if (unit !== seen){ b.units.add(unit); seen = unit; }
      const Nx = A[1] * B[2] - A[2] * B[1], Ny = A[2] * B[0] - A[0] * B[2], Nz = A[0] * B[1] - A[1] * B[0];
      const v = b.nv, nx = C * Nx + Sn * Nz, nz = -Sn * Nx + C * Nz;
      for (let j = 0; j < 4; j++){
        const sa = j === 1 || j === 2 ? ha : -ha, sb = j >= 2 ? hb : -hb;          // (−,−) (+,−) (+,+) (−,+)
        const u = Cc[0] + A[0] * sa + B[0] * sb, w = Cc[2] + A[2] * sa + B[2] * sb, o = (v + j) * 3, q = (v + j) * 2;
        b.p[o] = FX + C * u + Sn * w; b.p[o + 1] = Cc[1] + A[1] * sa + B[1] * sb; b.p[o + 2] = FZ - Sn * u + C * w;
        b.n[o] = nx; b.n[o + 1] = Ny; b.n[o + 2] = nz;
        const t = uv(sa, sb, ha, hb); b.uv[q] = t[0]; b.uv[q + 1] = t[1];
      }
      const i = b.ni; b.i[i] = v; b.i[i + 1] = v + 1; b.i[i + 2] = v + 2; b.i[i + 3] = v; b.i[i + 4] = v + 2; b.i[i + 5] = v + 3;
      b.nv += 4; b.ni += 6;
    },
    /* an axis-aligned local box, each face's uvs from uvOf(face) */
    box(u0, u1, y0, y1, v0, v1, faces, uvOf){
      if (!(u1 > u0 && y1 > y0 && v1 > v0)) return;
      const uc = (u0 + u1) / 2, yc = (y0 + y1) / 2, vc = (v0 + v1) / 2, hu = (u1 - u0) / 2, hy = (y1 - y0) / 2, hv = (v1 - v0) / 2, c = BC;
      if (faces & PZ){ c[0] = uc; c[1] = yc; c[2] = v1; W.face(c, FACE[PZ].A, hu, FACE[PZ].B, hy, uvOf(PZ)); }
      if (faces & NZ){ c[0] = uc; c[1] = yc; c[2] = v0; W.face(c, FACE[NZ].A, hu, FACE[NZ].B, hy, uvOf(NZ)); }
      if (faces & PX){ c[0] = u1; c[1] = yc; c[2] = vc; W.face(c, FACE[PX].A, hv, FACE[PX].B, hy, uvOf(PX)); }
      if (faces & NX){ c[0] = u0; c[1] = yc; c[2] = vc; W.face(c, FACE[NX].A, hv, FACE[NX].B, hy, uvOf(NX)); }
      if (faces & PY){ c[0] = uc; c[1] = y1; c[2] = vc; W.face(c, FACE[PY].A, hu, FACE[PY].B, hv, uvOf(PY)); }
      if (faces & NY){ c[0] = uc; c[1] = y0; c[2] = vc; W.face(c, FACE[NY].A, hu, FACE[NY].B, hv, uvOf(NY)); }
    },
    /* a square-section bar a → b ([u, y, v]), level across, w × d, one swatch (a uv fn, or an [s, t]) */
    bar(a, c, w, d, uv, faces = SIDES){
      let ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2];
      const L = Math.hypot(ex, ey, ez); if (L < 1e-6) return;
      ex /= L; ey /= L; ez /= L;
      let px = -ez, pz = ex, pl = Math.hypot(px, pz); if (pl < 1e-4){ px = 1; pz = 0; pl = 1; } px /= pl; pz /= pl;
      const X = RX, Y = RY, Z = RZ, nX = NXv, nZ = NZv, o = RC;
      X[0] = px; X[1] = 0; X[2] = pz; Y[0] = ex; Y[1] = ey; Y[2] = ez; Z[0] = -pz * ey; Z[1] = pz * ex - px * ez; Z[2] = px * ey;
      nX[0] = -px; nX[1] = 0; nX[2] = -pz; nZ[0] = -Z[0]; nZ[1] = -Z[1]; nZ[2] = -Z[2];
      const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2, mz = (a[2] + c[2]) / 2, hx = w / 2, hy = L / 2, hz = d / 2;
      const sw = typeof uv === 'function' ? uv : () => uv;
      const at = (V, k) => { o[0] = mx + V[0] * k; o[1] = my + V[1] * k; o[2] = mz + V[2] * k; return o; };
      if (faces & PX) W.face(at(X, hx), nZ, hz, Y, hy, sw);
      if (faces & NX) W.face(at(X, -hx), Z, hz, Y, hy, sw);
      if (faces & PZ) W.face(at(Z, hz), X, hx, Y, hy, sw);
      if (faces & NZ) W.face(at(Z, -hz), nX, hx, Y, hy, sw);
      if (faces & PY) W.face(at(Y, hy), X, hx, nZ, hz, sw);
      if (faces & NY) W.face(at(Y, -hy), X, hx, Z, hz, sw);
    },
  };
  kit.__studio = W;
  return W;
}
/* uv makers: a flat swatch · a region stretched over a face */
const swatch = R => { const c = [(R.s0 + R.s1) / 2, (R.t0 + R.t1) / 2]; return () => c; };
const stretch = R => (pa, pb, ha, hb) => [lerp(R.s0, R.s1, (pa + ha) / (2 * ha)), lerp(R.t0, R.t1, (pb + hb) / (2 * hb))];
/* a face in cells about t big, each the whole (seamless) tile; a face smaller than one tile shows a piece of it */
function tiled(W, Cc, A, ha, B, hb, R, ta, tb = ta){
  const na = Math.max(1, Math.round(2 * ha / ta)), nb = Math.max(1, Math.round(2 * hb / tb));
  const ca = 2 * ha / na, cb = 2 * hb / nb, fa = na > 1 ? 1 : Math.min(1, ca / ta), fb = nb > 1 ? 1 : Math.min(1, cb / tb);
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++){
    const oa = -ha + ca * (i + .5), ob = -hb + cb * (j + .5);
    const Ci = [Cc[0] + A[0] * oa + B[0] * ob, Cc[1] + A[1] * oa + B[1] * ob, Cc[2] + A[2] * oa + B[2] * ob];
    W.face(Ci, A, ca / 2, B, cb / 2, (pa, pb, h1, h2) => [lerp(R.s0, R.s0 + (R.s1 - R.s0) * fa, (pa + h1) / (2 * h1)), lerp(R.t0, R.t0 + (R.t1 - R.t0) * fb, (pb + h2) / (2 * h2))]);
  }
}
/* a 9-slice face: corner cells cb square from U.corner (its outer corner at the region's top-left),
   edge strips from U.edge (its top row = the outer lip), the middle from U.mid */
function nine(W, Cc, A, ha, B, hb, cb, U){
  cb = Math.min(cb, ha * .45, hb * .45);
  const cols = [[-ha, -ha + cb], [-ha + cb, ha - cb], [ha - cb, ha]], rows = [[-hb, -hb + cb], [-hb + cb, hb - cb], [hb - cb, hb]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++){
    const [a0, a1] = cols[i], [b0, b1] = rows[j], ca = (a0 + a1) / 2, cbb = (b0 + b1) / 2, h1 = (a1 - a0) / 2, h2 = (b1 - b0) / 2;
    if (h1 <= 1e-4 || h2 <= 1e-4) continue;
    const Ci = [Cc[0] + A[0] * ca + B[0] * cbb, Cc[1] + A[1] * ca + B[1] * cbb, Cc[2] + A[2] * ca + B[2] * cbb];
    W.face(Ci, A, h1, B, h2, (pa, pb) => {
      const a = ca + pa, bb = cbb + pb, dA = Math.min(a + ha, ha - a), dB = Math.min(bb + hb, hb - bb);
      if (i !== 1 && j !== 1) return [lerp(U.corner.s0, U.corner.s1, dA / cb), lerp(U.corner.t1, U.corner.t0, dB / cb)];
      if (j !== 1) return [lerp(U.edge.s0, U.edge.s1, (a + ha) / (2 * ha)), lerp(U.edge.t1, U.edge.t0, dB / cb)];
      if (i !== 1) return [lerp(U.edge.s0, U.edge.s1, (bb + hb) / (2 * hb)), lerp(U.edge.t1, U.edge.t0, dA / cb)];
      return [lerp(U.mid.s0, U.mid.s1, (a + ha) / (2 * ha)), lerp(U.mid.t0, U.mid.t1, (bb + hb) / (2 * hb))];
    });
  }
}

/* ---- the panel's light: LEDs + tally lamps, one additive draw. aPulse = slot + code: code < .5 a
   VU segment (lit while the level reaches 2·code), TALLY_CODE the tally. (uPulse: the kit's own
   envelope, written by footing3d — unused here, kept so the kit takes this material for its edge) ---- */
export const segCode = k => .5 * (k + 1) / (N_SEG + 1);
export const TALLY_CODE = .75;
function vuMaterial(vu){
  return new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: new Float32Array(MAXP) }, uLevel: { value: vu.level }, uPeak: { value: vu.peak }, uTally: { value: vu.tally } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPulse;
      uniform float uLevel[${MAXP}], uPeak[${MAXP}], uTally[${MAXP}];
      varying vec3 vC;
      void main(){
        float s = floor(aPulse + 1e-3); int i = int(s); float f = aPulse - s, b;
        if (f > .6) b = .1 + 1.25 * uTally[i];
        else {
          float th = f * 2.;
          float lit = step(th - .002, uLevel[i]);
          float pk = step(abs(uPeak[i] - th), ${(.5 / (N_SEG + 1)).toFixed(4)}) * step(.06, uPeak[i]);
          b = .07 + 1.6 * max(lit, .65 * pk);
        }
        vC = aColor * b;
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

/* ---------------------------------------------------------------- the style */
/* an open stand's stage box: the first spot (pad frame) on the audience's side that keeps out of
   every post + base plate, what hangs, and the posts' brace planes (fully inside the feet's hull by
   .5, or outside it by .3) — inside the pad. null: no room */
export function openSpot(p, side = null){
  const feet = p.feet?.length ? p.feet : null;
  if (!feet) return null;
  side ??= (() => { let best = '+v', bz = -Infinity, ax = AUDIENCE[0] - p.x, az = AUDIENCE[1] - p.z; const n = Math.hypot(ax, az) || 1;
    for (const s of ['+v', '+u', '-u', '-v']){ const [nx, nz] = sideNormal(p, s), d = (nx * ax + nz * az) / n; if (d > bz + 1e-6){ bz = d; best = s; } } return best; })();
  let h0 = Infinity, h1 = -Infinity, k0 = Infinity, k1 = -Infinity;
  for (const [fu, fv] of feet){ h0 = Math.min(h0, fu); h1 = Math.max(h1, fu); k0 = Math.min(k0, fv); k1 = Math.max(k1, fv); }
  const HG = p.hang, ch = Math.min(1.3, p.h - .5);
  if (!(ch > .6)) return null;
  const fits = (u, v, cw, cd) => {
    const u0 = u - cw / 2, u1 = u + cw / 2, v0 = v - cd / 2, v1 = v + cd / 2;
    if (u0 < -p.hw + .1 || u1 > p.hw - .1 || v0 < -p.hd + .1 || v1 > p.hd - .1) return false;
    for (const [fu, fv, rr = .3] of feet){ const s = Math.max(.2, Math.min(.36, rr * .55)) + .2 + .15;
      if (u1 > fu - s && u0 < fu + s && v1 > fv - s && v0 < fv + s) return false; }
    if (HG && u1 > HG[0] - .25 && u0 < HG[1] + .25 && v1 > HG[2] - .25 && v0 < HG[3] + .25) return false;
    const inside = u0 >= h0 + .5 && u1 <= h1 - .5 && v0 >= k0 + .5 && v1 <= k1 - .5;
    const outside = u1 <= h0 - .3 || u0 >= h1 + .3 || v1 <= k0 - .3 || v0 >= k1 + .3;
    return inside || outside;
  };
  // along the audience side's edge of the pad, from the corners in (the corners first: beside what hangs)
  const k = side[0] === '+' ? 1 : -1, alongU = side[1] === 'v';
  const [cw, cd] = alongU ? [1.4, 1] : [1, 1.4];
  const len = alongU ? p.hw : p.hd, depth = alongU ? p.hd : p.hw;
  for (const inset of [.1, .6, 1.2, 2]){
    const o = k * (depth - inset - (alongU ? cd : cw) / 2);
    for (let t = 1; t >= -1; t -= .125){
      for (const sgn of [1, -1]){
        const a = sgn * t * (len - .1 - (alongU ? cw : cd) / 2);
        const [u, v] = alongU ? [a, o] : [o, a];
        if (fits(u, v, cw, cd)) return { u, v, cw, cd, ch, side };
      }
    }
  }
  return null;
}

/* a claimed form's placeholder: ONE empty group per build (the hooks draw into the merged slots) */
const claim = K => K.__studioClaim || (K.__studioClaim = Object.assign(new THREE.Group(), { name: 'footing:studio' }));

export function studioFooting(){
  let A = null, U = null, made = null;
  const vu = { level: new Float32Array(MAXP), peak: new Float32Array(MAXP), tally: new Float32Array(MAXP) };
  const sw = {};
  const S = k => sw[k] || (sw[k] = swatch(U[k]));
  const atlas = () => { if (!A){ A = studioAtlas(); U = A.uv; } return A; };

  /* a side's frame (r may carry ou / ov: a rect offset inside its pad's frame): along a (left → right
     seen from outside), up y, out o from the face at `inset` */
  function sideFrame(r, side, inset){
    const k = side[0] === '+' ? 1 : -1, ou = r.ou || 0, ov = r.ov || 0;
    if (side[1] === 'v'){ const f = k * (r.hd - inset);
      return { P: (a, y, o) => [ou + k * a, y, ov + f + k * o], len: r.hw, A: [k, 0, 0], faces: k > 0 ? PZ : NZ, aOf: x => k * x }; }
    const f = k * (r.hw - inset);
    return { P: (a, y, o) => [ou + f + k * o, y, ov - k * a], len: r.hd, A: [0, 0, -k], faces: k > 0 ? PX : NX, aOf: x => -k * x };
  }
  /* the side the audience sees best: its outward normal toward the house (AUDIENCE: the wide's
     side of the room, front and centre) */
  function frontSide(r){
    let best = '+v', bz = -Infinity, ax = AUDIENCE[0] - r.x, az = AUDIENCE[1] - r.z;
    const n = Math.hypot(ax, az) || 1; ax /= n; az /= n;
    for (const s of ['+v', '+u', '-u', '-v']){ const [nx, nz] = sideNormal(r, s), d = nx * ax + nz * az; if (d > bz + 1e-6){ bz = d; best = s; } }
    return best;
  }
  const sideBox = (Fm, a0, a1, y0, y1, o0, o1) => {
    const p = Fm.P(a0, y0, o0), q = Fm.P(a1, y1, o1);
    return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[2], q[2]), Math.max(p[2], q[2])];
  };

  /* THE PANEL: one gloss-black plate carrying the tally, the VU meter and the machine's name (its
     cell is painted on the plate's own black), centred on the along-range [a0, a1] (kept clear of
     this side's stair / ladder), between heights y0 and y1 */
  function panel(K, W, r, side, inset, y0, y1, key, pulse, a0 = null, a1 = null, { name = true } = {}){
    const Fm = sideFrame(r, side, inset), hb = y1 - y0;
    if (hb < .06) return;
    a0 ??= -Fm.len + .3; a1 ??= Fm.len - .3;
    const acc = r.access;
    if (acc && acc.side === side){
      const g0 = Math.min(Fm.aOf(acc.a0), Fm.aOf(acc.a1)) - .3, g1 = Math.max(Fm.aOf(acc.a0), Fm.aOf(acc.a1)) + .3;
      if (g1 > a0 && g0 < a1){ if (g0 - a0 >= a1 - g1) a1 = Math.min(a1, g0); else a0 = Math.max(a0, g1); }
    }
    const L = a1 - a0;
    if (L < .7) return;
    let sH = clamp(hb * .42, .06, .17), sW = sH * .8, gp = sH * .26, tl = sH * 1.1;
    let meter = tl + gp * 3 + N_SEG * sW + (N_SEG - 1) * gp;
    if (meter > L - .3){ const k = (L - .3) / meter; sH *= k; sW *= k; gp *= k; tl *= k; meter *= k; }
    const pad = gp * 1.6, nm = U.name[key] || U.name.house;
    const ph = Math.min(hb, Math.max(sH + 2 * pad, Math.min(.3, hb * .55) + .05));       // the plate's height
    const lh = Math.min(.3, ph - .05, hb * .55), lw = lh * nm.aspect, nGap = Math.max(.25, sH * 1.5);
    const showName = name && lh > .07 && meter + nGap + lw + 2 * pad <= L;
    const total = showName ? meter + nGap + lw : meter, ga = (a0 + a1) / 2 - total / 2, yc = (y0 + y1) / 2;
    const bz = sideBox(Fm, ga - pad, ga + total + pad, yc - ph / 2, yc + ph / 2, 0, DECAL);
    W.box(...bz, Fm.faces | PY | NY | (Fm.faces === PZ || Fm.faces === NZ ? PX | NX : PZ | NZ), () => S('black'));
    const th = Math.min(tl, ph - .02), tb = sideBox(Fm, ga, ga + tl, yc - th / 2, yc + th / 2, DECAL, .024);
    K.edge(tb[0], tb[1], tb[2], tb[3], tb[4], tb[5], LED.red, pulse + TALLY_CODE, Fm.faces | PY);
    for (let s = 0; s < N_SEG; s++){
      const sa = ga + tl + gp * 3 + s * (sW + gp), c = s < 8 ? LED.green : s < 10 ? LED.amber : LED.red;
      const e = sideBox(Fm, sa, sa + sW, yc - sH / 2, yc + sH / 2, DECAL, .022);
      K.edge(e[0], e[1], e[2], e[3], e[4], e[5], c, pulse + segCode(s), Fm.faces);
    }
    if (showName) W.face(Fm.P(ga + meter + nGap + lw / 2, yc, DECAL + .004), Fm.A, lw / 2, [0, 1, 0], lh / 2, stretch(nm));
  }

  /* a Persian rug over the pad (top at y, its thickness below), fringe on the two ends `across`
     the audience's view ('u': the ±u ends, 'v': the ±v ends) */
  function rug(W, r, y, design, across){
    const hw = r.hw, hd = r.hd, B = Math.min(RUG_B, hw * .3, hd * .3), y0 = y - RUG_T;
    const Cn = U['corner' + design], Bd = U['border' + design], Fd = U['field' + design], Md = U['med' + design];
    const top = (ua, ub, va, vb, uv) => W.quad([[ua, y, vb], [ub, y, vb], [ub, y, va], [ua, y, va]], [0, 1, 0], [uv(ua, vb), uv(ub, vb), uv(ub, va), uv(ua, va)]);
    for (const [su, sv] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]){
      const ua = su > 0 ? hw - B : -hw, ub = su > 0 ? hw : -hw + B, va = sv > 0 ? hd - B : -hd, vb = sv > 0 ? hd : -hd + B;
      top(ua, ub, va, vb, (u, v) => [lerp(Cn.s0, Cn.s1, (su > 0 ? hw - u : u + hw) / B), lerp(Cn.t1, Cn.t0, (sv > 0 ? hd - v : v + hd) / B)]);
    }
    const strip = (along0, along1, mk) => { const n = Math.max(1, Math.round((along1 - along0) / (4 * B)));
      for (let i = 0; i < n; i++) mk(lerp(along0, along1, i / n), lerp(along0, along1, (i + 1) / n)); };
    strip(-hw + B, hw - B, (a, b) => {
      top(a, b, hd - B, hd, (u, v) => [lerp(Bd.s0, Bd.s1, (u - a) / (b - a)), lerp(Bd.t1, Bd.t0, (hd - v) / B)]);
      top(a, b, -hd, -hd + B, (u, v) => [lerp(Bd.s0, Bd.s1, (u - a) / (b - a)), lerp(Bd.t1, Bd.t0, (v + hd) / B)]); });
    strip(-hd + B, hd - B, (a, b) => {
      top(hw - B, hw, a, b, (u, v) => [lerp(Bd.s0, Bd.s1, (v - a) / (b - a)), lerp(Bd.t1, Bd.t0, (hw - u) / B)]);
      top(-hw, -hw + B, a, b, (u, v) => [lerp(Bd.s0, Bd.s1, (v - a) / (b - a)), lerp(Bd.t1, Bd.t0, (u + hw) / B)]); });
    const fw = hw - B, fh = hd - B;
    if (fw > .05 && fh > .05) tiled(W, [0, y, 0], [1, 0, 0], fw, [0, 0, -1], fh, Fd, FIELD_T);
    // the medallion, its pendants along the rug's long axis (an alpha-cut decal over the field)
    const sh = Math.min(fw, fh) * .9, lg = Math.min(Math.max(fw, fh) * .9, sh * 1.3);
    if (sh > .7){
      if (fw >= fh) W.face([0, y + DECAL, 0], [0, 0, -1], sh, [-1, 0, 0], lg, stretch(Md));
      else W.face([0, y + DECAL, 0], [1, 0, 0], sh, [0, 0, -1], lg, stretch(Md));
    }
    W.box(-hw, hw, y0, y, -hd, hd, SIDES, () => S('bind' + design));
    for (const k of [1, -1]){
      const f = FACE[across === 'u' ? (k > 0 ? PX : NX) : (k > 0 ? PZ : NZ)];
      const len = (across === 'u' ? hd : hw) - .06, n = Math.max(1, Math.round(2 * len / 1.8));
      for (let i = 0; i < n; i++){
        const a = -len + 2 * len * (i + .5) / n, yc = y0 - FRINGE / 2 + .012;
        const Cc = across === 'u' ? [k * hw, yc, -k * a] : [k * a, yc, k * hd];
        W.face(Cc, f.A, len / n, f.B, FRINGE / 2, stretch(U.fringe));
      }
    }
  }
  /* pleated stage skirting round a riser (its four faces, floor → y1), in tiles 1.6 u wide */
  function skirt(W, hw, hd, y0, y1){
    const yc = (y0 + y1) / 2, hy = (y1 - y0) / 2;
    for (const f of [PZ, NZ, PX, NX]){
      const Fd = FACE[f], ha = f === PZ || f === NZ ? hw : hd;
      const Cc = f === PZ ? [0, yc, hd] : f === NZ ? [0, yc, -hd] : f === PX ? [hw, yc, 0] : [-hw, yc, 0];
      tiled(W, Cc, Fd.A, ha, Fd.B, hy, U.skirt, 1.6, 2 * hy);
    }
  }
  const carpet = (W, u0, u1, v0, v1, y) => tiled(W, [(u0 + u1) / 2, y, (v0 + v1) / 2], [1, 0, 0], (u1 - u0) / 2, [0, 0, -1], (v1 - v0) / 2, U.carpet, CARPET_T);
  /* an aluminium nosing round a top's edge (a strip on top + down the face) */
  function nosing(W, hw, hd, y, w = .06, drop = .07){
    const alu = S('alu');
    W.box(-hw, hw, y - drop, y + .004, hd - w, hd, PY | PZ, () => alu); W.box(-hw, hw, y - drop, y + .004, -hd, -hd + w, PY | NZ, () => alu);
    W.box(hw - w, hw, y - drop, y + .004, -hd + w, hd - w, PY | PX, () => alu); W.box(-hw, -hw + w, y - drop, y + .004, -hd + w, hd - w, PY | NX, () => alu);
  }

  /* ONE FLIGHT CASE: its sides 9-sliced (ball corners, valance, laminate), an aluminium lid seam,
     butterfly latches on two faces and handles on the others, now and then a stencil */
  function flightCase(W, u, v, cw, cd, y0, y1, Rn, { top = false, turn = false, bare = 0 } = {}){
    const hu = cw / 2, hv = cd / 2, hy = (y1 - y0) / 2, yc = (y0 + y1) / 2, cb = .12;
    const NIN = { corner: U.ball, edge: U.alu, mid: U.laminate };
    const seamY = y0 + (y1 - y0) * .72, latchFaces = turn ? [PX, NX] : [PZ, NZ], stencilFace = Rn() < .5 ? (turn ? PZ : PX) : (turn ? NZ : NX);
    for (const f of [PZ, NZ, PX, NX]){
      const Fd = FACE[f], ha = (f === PZ || f === NZ) ? hu : hv;
      const Cc = f === PZ ? [u, yc, v + hv] : f === NZ ? [u, yc, v - hv] : f === PX ? [u + hu, yc, v] : [u - hu, yc, v];
      nine(W, Cc, Fd.A, ha, Fd.B, hy, cb, NIN);
      const off = (d, y, a = 0) => [Cc[0] + Fd.N[0] * d + Fd.A[0] * a, y, Cc[2] + Fd.N[2] * d + Fd.A[2] * a];
      W.face(off(.01, seamY), Fd.A, ha - cb * .5, [0, 1, 0], .035, stretch(U.alu));
      if (f === bare) continue;
      if (latchFaces.includes(f)) for (const t of [-.5, .5]) W.face(off(.016, seamY, t * ha), Fd.A, Math.min(.16, ha * .22), [0, 1, 0], .08, stretch(U.latch));
      else W.face(off(.014, y0 + (y1 - y0) * .45), Fd.A, Math.min(.2, ha * .3), [0, 1, 0], .1, stretch(U.handle));
      if (f === stencilFace && ha > .5 && hy > .3){
        const st = U.stencil[Math.floor(Rn() * U.stencil.length)], hh = Math.min(.12, hy * .2), half = Math.min(ha * .75, hh * st.aspect);
        W.face(off(.014, y0 + (y1 - y0) * .3), Fd.A, half, [0, 1, 0], half / st.aspect, stretch(st));
      }
    }
    if (top) nine(W, [u, y1, v], FACE[PY].A, hu, FACE[PY].B, hv, cb, NIN);
  }
  /* a pier of cases, the floor → yB, strapped (orange ratchet straps round its ±v faces) */
  function caseStack(W, F, u, v, pw, pd, yB, seed){
    const H = yB - F; if (H < .3) return;
    const Rn = rnd(seed), n = Math.max(1, Math.round(H / CASE_H)), ch = H / n;
    for (let k = 0; k < n; k++){
      const s = k === n - 1 ? 0 : .04 + Rn() * .1;               // (the top case carries the deck: full size)
      flightCase(W, u + (Rn() - .5) * s, v + (Rn() - .5) * s, pw - s, pd - s, F + k * ch, F + (k + 1) * ch, Rn, { turn: k % 2 === 1 });
    }
    for (const sv of [1, -1]){
      const Cc = [u + (Rn() - .5) * pw * .3, (F + yB) / 2, v + sv * (pd / 2 + .014)], f = FACE[sv > 0 ? PZ : NZ];
      tiled(W, Cc, f.A, STRAP_W / 2, f.B, H / 2 - .02, U.strap, STRAP_W, STRAP_T);
      const by = F + H * (.38 + Rn() * .1);
      W.box(Cc[0] - .13, Cc[0] + .13, by - .09, by + .09, Cc[2] - (sv > 0 ? .012 : .045), Cc[2] + (sv > 0 ? .045 : .012), ALL, () => S('alu'));
    }
  }
  /* ROAD-CASE PIERS under a deck (bottom yB): a grid of strapped stacks, ≤ 4.2 apart */
  function casePiers(W, F, r, yB, seed){
    const pw = Math.min(clamp(2 * r.hw / 6, 1.3, 2), 2 * r.hw - .2), pd = Math.min(clamp(2 * r.hd / 4.5, 1.1, 1.6), 2 * r.hd - .2), span = 4.2;
    const nu = 2 * r.hw - pw < .8 ? 1 : Math.max(2, Math.ceil((2 * r.hw - pw) / span) + 1);
    const nv = 2 * r.hd - pd < .8 ? 1 : Math.max(2, Math.ceil((2 * r.hd - pd) / span) + 1);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++){
      const u = nu === 1 ? 0 : lerp(-r.hw + pw / 2 + .05, r.hw - pw / 2 - .05, i / (nu - 1));
      const v = nv === 1 ? 0 : lerp(-r.hd + pd / 2 + .06, r.hd - pd / 2 - .06, j / (nv - 1));
      caseStack(W, F, u, v, pw, pd, yB, seed + i * 31 + j * 7);
    }
  }
  /* a black stage deck (inset a hair) under carpet — or grating — with an aluminium nosing */
  function stageDeck(K, W, r, T, D, { grate = false } = {}){
    const hw = r.hw - .025, hd = r.hd - .025;
    K.box('deck', -hw, hw, T - D, T - .04, -hd, hd, ALL);
    if (grate) tiled(W, [0, T - .003, 0], [1, 0, 0], hw - .06, [0, 0, -1], hd - .06, U.grating, GRATE_T);
    else carpet(W, -hw + .06, hw - .06, -hd + .06, hd - .06, T - .003);
    nosing(W, hw, hd, T - .003, .06, .09);
  }
  /* BLACK STAGE STEPS hugging a side (footing.js access): solid units (low) or an open stair (mid) */
  function stageSteps(K, W, F, r, T, acc, solid){
    const S2 = onSide(r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread, aL = acc.a1 - ow;
    const W2 = (a, o, y) => { const [u, v] = S2(a, o); return [u, y, v]; };
    const rect = (a0, a1, o0, o1) => { const p = S2(a0, o0), q = S2(a1, o1); return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])]; };
    const alu = S('alu'), o0 = solid ? .02 : .1, o1 = solid ? ow : ow - .1;
    for (let i = 1; i < n; i++){
      const a0 = acc.a0 + (i - 1) * tr, a1 = a0 + tr, y = F + i * rise, [u0, u1, v0, v1] = rect(a0, a1 + .02, o0, o1);
      if (solid) K.box('base', u0, u1, F - .04, y - .004, v0, v1, SIDES);
      else K.box('deck', u0, u1, y - .07, y - .004, v0, v1, ALL & ~PY);
      carpet(W, u0, u1, v0, v1, y - .003);
      const [n0, n1, m0, m1] = rect(a0, a0 + .05, o0, o1);
      W.box(n0, n1, y - .06, y + .002, m0, m1, ALL & ~NY, () => alu);                          // the nosing
    }
    const [u0, u1, v0, v1] = rect(aL, acc.a1, solid ? .02 : 0, ow);
    if (solid) K.box('base', u0, u1, F - .04, T - .004, v0, v1, SIDES);
    else {
      K.box('deck', u0, u1, T - .2, T - .004, v0, v1, ALL & ~PY);
      for (const o of [.12, ow - .12]) K.bar('steel', W2(acc.a0 + .1, o, F), W2(aL + .15, o, T - .12), .08, .3);           // stringers
      for (const a of [aL + .12, acc.a1 - .12]) K.bar('steel', W2(a, ow - .12, F), W2(a, ow - .12, T - .2), .14, .14, ALL);   // landing posts
    }
    carpet(W, u0, u1, v0, v1, T - .003);
    const o = ow - .06, y0 = F + rise + HAND, y1 = T + HAND;                                     // the handrail
    K.bar('steel', W2(acc.a0 + .12, o, y0), W2(aL, o, y1), .07, .07, ALL);
    K.bar('steel', W2(aL, o, y1), W2(acc.a1 - .04, o, y1), .07, .07, ALL);
    K.bar('steel', W2(acc.a1 - .04, o, y1), W2(acc.a1 - .04, .1, y1), .07, .07, ALL);
    for (const [a, y] of [[acc.a0 + .12, F + rise], [aL, T], [acc.a1 - .04, T]]) K.bar('steel', W2(a, o, y), W2(a, o, y + HAND + .03), .07, .07, PY | SIDES);
    K.bar('steel', W2(acc.a1 - .04, .1, T), W2(acc.a1 - .04, .1, y1), .07, .07, SIDES);
  }
  function access(K, W, F, r, T, solid){
    const acc = r.access; if (!acc) return;
    if (acc.kind === 'stair') stageSteps(K, W, F, r, T, acc, solid);
    else K.forms.ladder(r, T, acc);
  }
  /* GROUND SUPPORT: the kit's box-truss columns + beams (black), each column on a base plate with
     splayed outriggers to levelling jacks — all inside the support */
  function groundSupport(K, F, r, yB){
    const D = K.DIM;
    K.forms.trussFrame(r, yB, landings(r, F));
    const hu = r.hw - D.COL_IN, hv = r.hd - D.COL_IN, h = D.COL / 2;
    for (const [u, v] of ring(hu, hv, D.COL_SPAN)){
      K.box('steel', u - .5, u + .5, F - .02, F + .05, v - .5, v + .5, NOBOT);                              // the base plate
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
        const ju = clamp(u + su * 1.15, -r.hw + .14, r.hw - .14), jv = clamp(v + sv * 1.15, -r.hd + .14, r.hd - .14);
        if (Math.hypot(ju - u, jv - v) < .75) continue;                                                    // (no room to splay that way)
        K.bar('steel', [u + su * h, F + 1.3, v + sv * h], [ju, F + .16, jv], .08, .08, ALL);                 // the outrigger
        K.box('steel', ju - .09, ju + .09, F, F + .2, jv - .09, jv + .09, NOBOT);                            // its jack
      }
    }
  }
  /* a few cases left at a tower's foot: inside its columns, on a side without its ladder */
  function footCases(W, F, r, seed){
    if (r.hw < 2.6 || r.hd < 2.2) return;
    const Rn = rnd(seed), side = ['-v', '+v'].find(s => r.access?.side !== s), k = side[0] === '+' ? 1 : -1;
    const cw = 1.5, cd = 1.05, v = k * (r.hd - 1.3 - cd / 2), u0 = -r.hw + 1.35 + cw / 2;
    flightCase(W, u0, v, cw, cd, F, F + 1.35, Rn);
    flightCase(W, u0 + .03, v, cw - .1, cd - .06, F + 1.35, F + 2.45, Rn, { top: true, turn: true });
    if (2 * r.hw > 7.5) flightCase(W, u0 + cw + .3, v, 1.2, .95, F, F + 1.15, Rn, { top: true });
  }

  /* ---------------- the forms ---------------- */
  const style = {
    key: 'studio', vu,
    /* the materials (made once, the room's: build() calls this early so the atlas is painted then) */
    mats(kit, ctx = {}){
      if (made) return made;
      const T = atlas(), env = ctx.envMap ?? null;
      made = {
        [SLOT]: new THREE.MeshStandardMaterial({ map: T.map, roughnessMap: T.orm, metalnessMap: T.orm, roughness: 1, metalness: 1, envMap: env, envMapIntensity: .8, alphaTest: .5 }),
        base: new THREE.MeshStandardMaterial({ color: 0x55565f, roughness: .5, metalness: .1, envMap: env, envMapIntensity: .6 }),     // black satin kickboards
        steel: new THREE.MeshStandardMaterial({ color: 0x5a5e68, roughness: .38, metalness: .5, envMap: env, envMapIntensity: 1 }),   // black powder-coat truss
        deck: new THREE.MeshStandardMaterial({ color: 0x4a4b53, roughness: .7, metalness: .1, envMap: env, envMapIntensity: .45 }),   // black stage decking
        edge: vuMaterial(vu),
      };
      return made;
    },
    get atlasMat(){ return made?.[SLOT] || null; },
    get atlas(){ return atlas(); },                             // (its uv rects: the room paints its props from it)
    edge: (p, K) => claim(K),                                         // (every pad's light is its panel)
    flush(p, K){
      atlas();
      const W = writer(K).frame(p), F = K.floor, side = frontSide(p);
      if (p.fixed){                                              // the belt: a plain black riser under its posts, an aluminium cap
        const T = F + FOOT.KERB;
        K.box('base', -p.hw + .03, p.hw - .03, F - .04, T - .025, -p.hd + .03, p.hd - .03, NOBOT);
        W.box(-p.hw + .01, p.hw - .01, T - .025, T, -p.hd + .01, p.hd - .01, ALL & ~NY, () => S('alu'));
        panel(K, W, p, side, .03, F + .012, T - .03, p.key, p.pulse, null, null, { name: false });
        return claim(K);
      }
      const T = p.top - RUG_DROP, design = hash(p.key) & 1 ? 'B' : 'A';
      K.box('base', -p.hw + KICK_IN, p.hw - KICK_IN, F - .04, T - RUG_T, -p.hd + KICK_IN, p.hd - KICK_IN, NOBOT);
      rug(W, p, T, design, side[1] === 'v' ? 'u' : 'v');
      panel(K, W, p, side, KICK_IN, F + .03, T - RUG_T - .02, p.key, p.pulse);
      return claim(K);
    },
    low(p, K){
      atlas();
      const W = writer(K).frame(p), F = K.floor, T = p.top, CT = .07;
      skirt(W, p.hw - .05, p.hd - .05, F, T - CT);
      carpet(W, -p.hw + .06, p.hw - .06, -p.hd + .06, p.hd - .06, T - .003);
      W.box(-p.hw + .05, p.hw - .05, T - CT, T - .006, -p.hd + .05, p.hd - .05, SIDES, () => S('black'));
      nosing(W, p.hw - .04, p.hd - .04, T - .003, .06, CT);
      const h = T - CT - F;
      panel(K, W, p, frontSide(p), .05, Math.max(F + .05, T - CT - Math.min(1.1, h * .6)), T - CT - .05, p.key, p.pulse);
      access(K, W, F, p, T, true);
      return claim(K);
    },
    mid(p, K){
      if (p.open) return style.open(p, K);
      atlas();
      const W = writer(K).frame(p), F = K.floor, T = p.top, D = deckDepth(p, K.DIM), yB = T - D;
      stageDeck(K, W, p, T, D);
      casePiers(W, F, p, yB, hash(p.key));
      if (railed('mid')){ const [s, g0, g1] = gapOf(p.access, K.DIM); K.forms.rails(p, T, s, g0, g1); }
      panel(K, W, p, frontSide(p), .025, yB + .03, T - .1, p.key, p.pulse);
      access(K, W, F, p, T, false);
      return claim(K);
    },
    high(p, K){
      if (p.open) return style.open(p, K);
      atlas();
      const W = writer(K).frame(p), F = K.floor, T = p.top, D = deckDepth(p, K.DIM), yB = T - D;
      stageDeck(K, W, p, T, D);
      groundSupport(K, F, p, yB);
      footCases(W, F, p, hash(p.key));
      const [s, g0, g1] = gapOf(p.access, K.DIM); K.forms.rails(p, T, s, g0, g1);
      panel(K, W, p, frontSide(p), .025, yB + .03, T - .1, p.key, p.pulse);
      access(K, W, F, p, T, false);
      return claim(K);
    },
    /* an OPEN stand: the kit's posts (black) — and a stage box on the floor carrying its panel, on the
       audience's side, clear of every post (and its base plate), every brace plane and what hangs */
    open(p, K){
      atlas();
      K.forms.open(p);
      const W = writer(K).frame(p), F = K.floor;
      const spot = openSpot(p);
      if (!spot) return claim(K);
      const { u, v, cw, cd, ch, side } = spot, turn = side[1] === 'u';
      const face = side === '+v' ? PZ : side === '-v' ? NZ : side === '+u' ? PX : NX;
      flightCase(W, u, v, cw, cd, F, F + ch, rnd(hash(p.key)), { top: true, turn: !turn, bare: face });
      panel(K, W, { hw: cw / 2, hd: cd / 2, ou: u, ov: v }, side, -.003, F + ch * .4, F + ch * .72, p.key, p.pulse, null, null, { name: false });
      return claim(K);
    },
    /* the MEZZANINE CATWALK */
    loft(L, K){
      atlas();
      const W = writer(K).frame(L), F = K.floor, T = L.top, D = deckDepth(L, K.DIM), yB = T - D;
      stageDeck(K, W, L, T, D, { grate: true });
      if (L.band === 'low') K.box('base', -L.hw + .05, L.hw - .05, F - .04, yB, -L.hd + .05, L.hd - .05, NOBOT);
      else if (L.band === 'mid') casePiers(W, F, L, yB, hash(L.id));
      else { groundSupport(K, F, L, yB); footCases(W, F, L, hash(L.id)); }
      if (railed(L.band)){ const [s, g0, g1] = gapOf(L.access, K.DIM); K.forms.rails(L, T, s, g0, g1); }
      access(K, W, F, L, T, L.band === 'low');
      // ground support: a cable tray hung under the deck (behind the front columns, below the beam),
      // a few cables sagging out of it
      if (L.band === 'high' && L.hw > 2.5 && L.hd > 2){
        const tv = L.hd - K.DIM.COL_IN - K.DIM.COL / 2 - .45, ty = yB - K.DIM.BEAM - .35, alu = S('alu'), cab = S('cable'), Rn = rnd(hash(L.id) + 9);
        const a0 = -L.hw + K.DIM.COL_IN + .6, a1 = L.hw - K.DIM.COL_IN - .6;
        for (const sv of [-.2, .2]) W.box(a0, a1, ty - .1, ty + .1, tv + sv - .02, tv + sv + .02, ALL, () => alu);
        for (let a = a0 + .1; a < a1; a += .7) W.box(a - .03, a + .03, ty - .1, ty - .07, tv - .2, tv + .2, PY | NY | PZ | NZ, () => alu);
        for (let a = a0 + .3; a < a1; a += 2.6) K.bar('steel', [a, ty + .1, tv], [a, yB, tv], .045, .045, SIDES);
        for (const dv of [-.11, 0, .1]) W.bar([a0 + .05, ty - .04, tv + dv], [a1 - .05, ty - .04, tv + dv], .07, .07, cab);
        let a = a0 + .6 + Rn() * 1.5;
        while (a < a1 - 2){
          const b = Math.min(a1 - .4, a + 1.8 + Rn() * 2.6), sag = .6 + Rn() * 1.1, n = 10;
          let prev = null;
          for (let i = 0; i <= n; i++){ const t = i / n, pt = [lerp(a, b, t), ty - .06 - sag * 4 * t * (1 - t), tv + .08];
            if (prev) W.bar(prev, pt, .06, .06, cab, ALL); prev = pt; }
          a = b + 1.2 + Rn() * 2.4;
        }
      }
      for (const m of K.plan.pads) if (m.loft === L.id){
        let mu0 = Infinity, mu1 = -Infinity;
        const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0);
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){ const x = m.x + c * a * m.hw + s * b * m.hd - L.x; mu0 = Math.min(mu0, x); mu1 = Math.max(mu1, x); }
        panel(K, W, L, '+v', .025, yB + .03, T - .1, m.key, m.pulse, Math.max(-L.hw + .3, mu0 + .2), Math.min(L.hw - .3, mu1 - .2));
      }
      return claim(K);
    },
    dispose(){ if (made){ for (const m of Object.values(made)) m.dispose?.(); made = null; } },
  };
  return style;
}
