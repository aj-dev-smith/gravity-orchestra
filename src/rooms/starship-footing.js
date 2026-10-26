import * as THREE from 'three';
import { FOOT, railed, sideNormal } from './footing.js';
import { quad, ring, onSide, gapOf, landings } from './footing3d.js';
import { SHIP, lampLayout, beaconPocket } from './starship-deck.js';
/* ============================================================
   STARSHIP FOOTING — what the machines stand on, as SHIP HARDWARE (a room style for
   rooms/footing3d.js: its header is the contract). Every form writes into the kit's merged slots —
   steel · deck (diamond plate) · hazard (yellow/black) · chrome · grate — so a whole song's footing is
   five draws, whatever stands on it. The running lights and the status beacons that live in these
   forms' light channels are the ROOM's (starship.js: one additive draw, lit by the machines' strikes),
   so every form leaves its edge to the room (the `edge` hook).

     flush  a DECK PLATE set into the hull: hazard-striped sides under a steel lip, a hazard border round
            the machine on top, recessed tie-down rings at its corners, a dark channel for its lights
     low    a HYDRAULIC LIFT: the deck on scissor arms (tandem units along its length) over a base sill,
            a ram per unit; a low one stands on squat rams; grip-plate steps with yellow nosings
     mid    a deck on TELESCOPING RAMS: a painted housing, two chrome stages, a gland block at each joint,
            a frame under the deck; ship's rails; a stair or a ladder
     high   a GANTRY TOWER: an open steel lattice (posts, girts, X-braced panels on every face), grated
            service decks ringing it at each ladder landing, an umbilical clamped up a corner to the
            deck on swing arms; a caged ladder; ship's rails
     loft   an UPPER CATWALK: a grated deck on joists (solid plate where a machine dips into it), on the
            band's structure (scissor / rams / gantry), the ship's rails, the light strip along its edge
     open   a post under each foot as a telescoping ram, ties kept out of what hangs (footing.js open)
   Everything stays inside footingBoxes(plan). Materials: light painted steel, mid-grey diamond plate,
   amber/black hazard paint, env-carried chrome — read in the Starship's dim blue (no near-black albedo).
   1 u ≈ .677 m.
   ============================================================ */

const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;
const RAIL_H = FOOT.RAIL, HAND = 1.3;
/* a raised support's deck depth (footing3d.js deckDepth): its band's slab, or deeper over a machine's WELL */
const deckDepth = r => Math.max(r.keys || r.band === 'high' ? .38 : .32, (r.well || 0) + .04);

/* ---------------- materials (made once per room, on first use) ---------------- */
function tex(w, h, draw, repeat = 1){
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  return t;
}
/* hazard paint: amber / black 45° bands (the kit's world uv: a 4 u tile → 8 pairs ≈ .25 u each), worn */
function hazardTex(){
  return tex(256, 256, (x, w) => {
    x.fillStyle = '#17191e'; x.fillRect(0, 0, w, w);
    x.fillStyle = '#d6a224';
    for (let k = -16; k < 16; k++){ x.beginPath(); const a = k * 32;
      x.moveTo(a, 0); x.lineTo(a + 16, 0); x.lineTo(a + 16 + w, w); x.lineTo(a + w, w); x.closePath(); x.fill(); }
    let s = 11; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 900; i++){ x.fillStyle = `rgba(${R() < .5 ? '20,20,24' : '120,110,90'},${.08 + R() * .18})`; x.fillRect(R() * w, R() * w, 1 + R() * 3, 1 + R() * 2); }
  });
}
/* diamond (tread) plate: raised lozenges in alternating directions — map + bump */
function diamondTex(){
  return tex(128, 128, (x, w) => {
    x.fillStyle = '#6a6f78'; x.fillRect(0, 0, w, w);
    const n = 8, c = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
      x.save(); x.translate((i + .5) * c, (j + .5) * c); x.rotate((i + j) % 2 ? Math.PI / 4 : -Math.PI / 4);
      const g = x.createLinearGradient(0, -2, 0, 2); g.addColorStop(0, '#c2c7cf'); g.addColorStop(1, '#3d4148');
      x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, c * .38, c * .09, 0, 0, Math.PI * 2); x.fill(); x.restore();
    }
  }, 4);
}
/* bar grating: bearing bars one way, cross rods the other — alpha (≈ 65 % steel: solid from afar, open close up) */
function grateTex(){
  return tex(128, 128, (x, w) => {
    x.clearRect(0, 0, w, w);
    x.fillStyle = '#ffffff';
    for (let i = 0; i < 8; i++) x.fillRect(i * 16, 0, 9, w);               // bearing bars
    for (let j = 0; j < 4; j++) x.fillRect(0, j * 32 + 13, w, 6);           // cross rods
  }, 2);
}
export function shipMats(envMap = null){
  const hz = hazardTex(), dm = diamondTex(), gr = grateTex();
  const m = {
    steel: new THREE.MeshStandardMaterial({ color: 0x87817a, metalness: .35, roughness: .5, envMap, envMapIntensity: .4 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x9c9fa5, map: dm, bumpMap: dm, bumpScale: 1.2, metalness: .5, roughness: .46, envMap, envMapIntensity: .5 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xffffff, map: hz, metalness: .2, roughness: .62, envMap, envMapIntensity: .35 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe2e7ef, metalness: .92, roughness: .14, envMap, envMapIntensity: 1.3 }),
    grate: new THREE.MeshStandardMaterial({ color: 0x8a857e, alphaMap: gr, alphaTest: .5, side: THREE.DoubleSide, metalness: .5, roughness: .45, envMap, envMapIntensity: .5 }),
  };
  if (hz) hz.colorSpace = THREE.SRGBColorSpace;
  if (dm) dm.colorSpace = THREE.SRGBColorSpace;
  m.dispose = () => { for (const k of ['steel', 'deck', 'hazard', 'chrome', 'grate']) m[k].dispose(); hz?.dispose(); dm?.dispose(); gr?.dispose(); };
  return m;
}

/* ---------------- shared bits (all in the current frame: the pad's / loft's) ---------------- */
/* a vertical n-gon's sides at local (u, v), corner radius r, y0 → y1 (no caps: a gland block / a plate covers each end).
   Each side is one quad written straight into the slot's merged buffer (kit.slot), without turning the kit's frame
   n times: the rams' prisms were a third of a tall footing's build. Its normals are SMOOTH (each edge's vertices
   take the radial direction there), so a ram reads as a turned cylinder up close, not a faceted column — the
   same vertex count. */
const _Q = new Float32Array(12);
function smooth(b, n0x, n0y, n0z, n1x, n1y, n1z){                 // the last quad: verts 0, 3 → n0; 1, 2 → n1
  const o = (b.nv - 4) * 3, N = b.n;
  N[o] = N[o + 9] = n0x; N[o + 1] = N[o + 10] = n0y; N[o + 2] = N[o + 11] = n0z;
  N[o + 3] = N[o + 6] = n1x; N[o + 4] = N[o + 7] = n1y; N[o + 5] = N[o + 8] = n1z;
}
function prism(k, spec, slot, u, v, r, y0, y1, n = 16){
  if (!(y1 > y0)) return;
  const [x, z] = k.w(u, v), h = Math.PI / n, a = r * Math.cos(h), s = r * Math.sin(h), yaw = spec.yaw || 0, b = k.slot(slot);
  for (let i = 0; i < n; i++){
    const t = yaw + (i + .5) * 2 * h, C = Math.cos(t), S = Math.sin(t);
    const fx = x + S * a, fz = z + C * a, ux = C * s, uz = -S * s;            // the face's centre line, its half-width along u
    _Q[0] = fx - ux; _Q[1] = y0; _Q[2] = fz - uz;  _Q[3] = fx + ux; _Q[4] = y0; _Q[5] = fz + uz;
    _Q[6] = fx + ux; _Q[7] = y1; _Q[8] = fz + uz;  _Q[9] = fx - ux; _Q[10] = y1; _Q[11] = fz - uz;
    quad(b, _Q, S, 0, C, null, 0);
    smooth(b, Math.sin(t - h), 0, Math.cos(t - h), Math.sin(t + h), 0, Math.cos(t + h));
  }
}
/* a round TUBE from a to b ([u, y, v] in the frame), radius r, n smooth sides, open ends (a clevis block caps
   each: the caller's) — a scissor lift's ram barrel and rod */
function tube(k, slot, A, B, r, n = 12){
  const [ax, az] = k.w(A[0], A[2]), [bx, bz] = k.w(B[0], B[2]), ay = A[1], by = B[1];
  let ex = bx - ax, ey = by - ay, ez = bz - az; const L = Math.hypot(ex, ey, ez); if (L < 1e-6) return;
  ex /= L; ey /= L; ez /= L;
  // p1 ⟂ e (level when it can be), p2 = e × p1; a side's direction d(t) = sin t·p2 + cos t·p1 (outward winding)
  let p1x = -ez, p1y = 0, p1z = ex, pl = Math.hypot(p1x, p1z); if (pl < 1e-4){ p1x = 1; p1z = 0; pl = 1; }
  p1x /= pl; p1z /= pl;
  const p2x = ey * p1z - ez * p1y, p2y = ez * p1x - ex * p1z, p2z = ex * p1y - ey * p1x;
  const b = k.slot(slot), h = Math.PI / n;
  const D = t => { const S = Math.sin(t), C = Math.cos(t); return [S * p2x + C * p1x, S * p2y + C * p1y, S * p2z + C * p1z]; };
  for (let i = 0; i < n; i++){
    const t = (i + .5) * 2 * h, d0 = D(t - h), d1 = D(t + h), dc = D(t);
    _Q[0] = ax + r * d0[0]; _Q[1] = ay + r * d0[1]; _Q[2] = az + r * d0[2];
    _Q[3] = ax + r * d1[0]; _Q[4] = ay + r * d1[1]; _Q[5] = az + r * d1[2];
    _Q[6] = bx + r * d1[0]; _Q[7] = by + r * d1[1]; _Q[8] = bz + r * d1[2];
    _Q[9] = bx + r * d0[0]; _Q[10] = by + r * d0[1]; _Q[11] = bz + r * d0[2];
    quad(b, _Q, dc[0], dc[1], dc[2], null, 0);
    smooth(b, d0[0], d0[1], d0[2], d1[0], d1[1], d1[2]);
  }
}
/* a telescoping hydraulic RAM at (u, v) from y0 up to y1: a painted housing, two chrome stages, a gland
   block at each joint, a foot plate (hazard) and a head plate; r = the housing's radius */
function ram(k, spec, u, v, y0, y1, r = .3, plate = true){
  const H = y1 - y0; if (H < .3) return;
  const g = (rr, y, hgt) => k.box('steel', u - rr, u + rr, y, y + hgt, v - rr, v + rr, SIDES | PY);
  if (plate){ k.box('hazard', u - r - .22, u + r + .22, y0, y0 + .06, v - r - .22, v + r + .22, NOBOT); y0 += .06; }
  const h = y1 - y0, l1 = h * .44, l2 = h * .3;
  prism(k, spec, 'steel', u, v, r, y0, y0 + l1);
  g(r + .07, y0 + l1, .14);                                       // gland 1
  prism(k, spec, 'chrome', u, v, r * .72, y0 + l1 + .14, y0 + l1 + l2);
  g(r * .72 + .05, y0 + l1 + l2, .1);                             // gland 2
  prism(k, spec, 'chrome', u, v, r * .5, y0 + l1 + l2 + .1, y1 - .08);
  k.box('steel', u - r - .1, u + r + .1, y1 - .08, y1, v - r - .1, v + r + .1, ALL);   // head plate
}
/* the deck slab of a raised support: a steel lip round its top edge, a diamond-plate (or grated) top, the
   dark light channel under the lip (the room's running lights sit in it), hazard paint below, a steel underside */
function slab(k, r, T, D, top = 'deck', pocket = null){
  const hw = r.hw, hd = r.hd, L = SHIP.LIP, I = SHIP.INSET;
  k.box('steel', -hw, hw, T - L, T, -hd, hd, SIDES);
  k.box('steel', -hw, hw, T - .004, T, hd - .05, hd, PY); k.box('steel', -hw, hw, T - .004, T, -hd, -hd + .05, PY);
  k.box('steel', -hw, -hw + .05, T - .004, T, -hd + .05, hd - .05, PY); k.box('steel', hw - .05, hw, T - .004, T, -hd + .05, hd - .05, PY);
  if (pocket){                                                    // (the top round the beacon's pocket, then the pocket)
    const s = 2 * pocket.half;
    k.box(top, -hw + .05, hw - .05, T - .03, T, -hd + .05, hd - .05 - s, PY);
    k.box(top, -hw + .05 + s, hw - .05, T - .03, T, hd - .05 - s, hd - .05, PY);
    pit(k, pocket.u, pocket.v, pocket.half, T, pocket.depth);
  } else k.box(top, -hw + .05, hw - .05, T - .03, T, -hd + .05, hd - .05, PY);
  k.box('deck', -hw + I, hw - I, T - SHIP.CH0, T - L, -hd + I, hd - I, SIDES);          // the light channel
  k.box('hazard', -hw + .004, hw - .004, T - D, T - SHIP.CH0, -hd + .004, hd - .004, SIDES);
  if (top !== 'grate') k.box('steel', -hw + .004, hw - .004, T - D, T - D + .02, -hd + .004, hd - .004, NY);
  else {                                                          // (a grating is open below: the fascia's inner faces)
    const y0 = T - D, y1 = T - .03, t = .03;
    k.box('steel', -hw + t, hw - t, y0, y1, hd - t, hd - .004, NZ); k.box('steel', -hw + t, hw - t, y0, y1, -hd + .004, -hd + t, PZ);
    k.box('steel', hw - t, hw - .004, y0, y1, -hd + t, hd - t, NX); k.box('steel', -hw + .004, -hw + t, y0, y1, -hd + t, hd - t, PX);
  }
}
/* a square pocket let into a deck's top at (cu, cv): its floor `depth` down, its four walls */
function pit(k, cu, cv, h, T, depth){
  k.box('steel', cu - h, cu + h, T - depth, T - depth + .02, cv - h, cv + h, PY);
  k.box('steel', cu + h, cu + h + .01, T - depth + .02, T, cv - h, cv + h, NX); k.box('steel', cu - h - .01, cu - h, T - depth + .02, T, cv - h, cv + h, PX);
  k.box('steel', cu - h, cu + h, T - depth + .02, T, cv + h, cv + h + .01, NZ); k.box('steel', cu - h, cu + h, T - depth + .02, T, cv - h - .01, cv - h, PZ);
}
/* the SHIP'S RAILS round a deck at T (inset .1): steel stanchions, a chrome top rail, a steel mid rail,
   a hazard toe board — open over [g0, g1] on the access side */
function rails(k, r, T, gapSide = null, g0 = 0, g1 = 0){
  const hu = r.hw - .1, hv = r.hd - .1;
  const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
  for (const [side, p, q] of runs){
    const al = pt => side[1] === 'u' ? pt[1] : pt[0], segs = [];
    if (side === gapSide){
      const a0 = al(p), a1 = al(q), lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      const cut = x => side[1] === 'u' ? [p[0], x] : [x, p[1]];
      if (g0 - .05 > lo + .3) segs.push([cut(lo), cut(g0 - .05)]);
      if (g1 + .05 < hi - .3) segs.push([cut(g1 + .05), cut(hi)]);
    } else segs.push([p, q]);
    for (const [a, b] of segs) railRun(k, a, b, T);
  }
}
function railRun(k, a, b, T){
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .2) return;
  const n = Math.max(1, Math.ceil(L / 2.2));
  for (let i = 0; i <= n; i++){ const t = i / n, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
    k.box('steel', u - .045, u + .045, T, T + RAIL_H - .02, v - .045, v + .045, SIDES | PY); }
  k.bar('chrome', [a[0], T + RAIL_H - .04, a[1]], [b[0], T + RAIL_H - .04, b[1]], .075, .075, ALL);
  k.bar('steel', [a[0], T + RAIL_H * .52, a[1]], [b[0], T + RAIL_H * .52, b[1]], .055, .055);
  k.bar('hazard', [a[0], T + .08, a[1]], [b[0], T + .08, b[1]], .025, .16, ALL);
}

/* an open steel STAIR hugging one side (footing.js access): diamond-plate treads with amber nosings on
   steel stringers, a landing at the deck's height, a chrome handrail on the open side */
function stair(k, r, T, acc){
  const F = k.floor, S = onSide(r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread;
  const W2 = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; };
  const boxSide = (slot, a0, a1, o0, o1, y0, y1, faces) => { const p = S(a0, o0), q = S(a1, o1);
    k.box(slot, Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), faces); };
  const aL = acc.a1 - ow;
  for (let i = 1; i < n; i++){
    const a0 = acc.a0 + (i - 1) * tr, a1 = a0 + tr, y = F + i * rise;
    boxSide('deck', a0 + .06, a1 + .03, .1, ow - .1, y - .05, y, ALL);
    boxSide('hazard', a0, a0 + .065, .1, ow - .1, y - .055, y + .002, ALL);              // the nosing
  }
  boxSide('deck', aL, acc.a1, 0, ow, T - .16, T - .004, ALL);
  boxSide('hazard', aL - .06, aL, 0, ow, T - .16, T, ALL);
  for (const o of [.12, ow - .12]) k.bar('steel', W2(acc.a0 + .25, o, F + .14), W2(aL + .15, o, T - .12), .07, .26);   // stringers (their heels on the floor, never through it)
  for (const a of [aL + .12, acc.a1 - .12]) k.bar('steel', W2(a, ow - .12, F), W2(a, ow - .12, T - .16), .12, .12, ALL);
  for (const a of [aL + .12, acc.a1 - .12]){ const [u, , v] = W2(a, ow - .12, F); k.box('hazard', u - .1, u + .1, F, F + .05, v - .1, v + .1, NOBOT); }
  const o = ow - .06, y0 = F + rise + HAND, y1 = T + HAND;
  k.bar('chrome', W2(acc.a0 + .12, o, y0), W2(aL, o, y1), .06, .06, ALL);
  k.bar('chrome', W2(aL, o, y1), W2(acc.a1 - .04, o, y1), .06, .06, ALL);
  k.bar('chrome', W2(acc.a1 - .04, o, y1), W2(acc.a1 - .04, .1, y1), .06, .06, ALL);
  for (const [a, y] of [[acc.a0 + .12, F + rise], [aL, T], [acc.a1 - .04, T]]) k.bar('steel', W2(a, o, y), W2(a, o, y + HAND - .02), .06, .06, SIDES);
  k.bar('steel', W2(acc.a1 - .04, .1, T), W2(acc.a1 - .04, .1, y1 - .02), .06, .06, SIDES);
}
function access(k, r, T, acc){ if (!acc) return; acc.kind === 'stair' ? stair(k, r, T, acc) : k.forms.ladder(r, T, acc); }
/* ---------------- the forms ---------------- */
/* FLUSH: a deck plate let into the hull. (The belt's kerb: the same, FOOT.KERB tall, no border.) */
function plate(k, p){
  const F = k.floor, kerb = !!p.fixed, T = kerb ? F + FOOT.KERB : p.top, hw = p.hw, hd = p.hd, I = SHIP.INSET;
  const c0 = kerb ? SHIP.KCH0 : SHIP.FCH0, c1 = kerb ? SHIP.KCH1 : SHIP.FCH1, L = Math.min(SHIP.LIP, c1);
  k.box('hazard', -hw + .02, hw - .02, F, T - c0, -hd + .02, hd - .02, SIDES);
  k.box('deck', -hw + I, hw - I, T - c0, T - L, -hd + I, hd - I, SIDES);                 // the light channel
  k.box('steel', -hw, hw, T - L, T, -hd, hd, SIDES);                                       // the lip
  if (kerb){                                                                              // a launch pad set into the hull
    const e = SHIP.EDGE, b = .16;
    k.box('steel', -hw, hw, T - .01, T, hd - e, hd, PY); k.box('steel', -hw, hw, T - .01, T, -hd, -hd + e, PY);
    k.box('steel', -hw, -hw + e, T - .01, T, -hd + e, hd - e, PY); k.box('steel', hw - e, hw, T - .01, T, -hd + e, hd - e, PY);
    k.box('hazard', -hw + e, hw - e, T - .01, T, hd - e - b, hd - e, PY); k.box('hazard', -hw + e, hw - e, T - .01, T, -hd + e, -hd + e + b, PY);
    k.box('hazard', -hw + e, -hw + e + b, T - .01, T, -hd + e + b, hd - e - b, PY); k.box('hazard', hw - e - b, hw - e, T - .01, T, -hd + e + b, hd - e - b, PY);
    k.box('deck', -hw + e + b, hw - e - b, T - .01, T, -hd + e + b, hd - e - b, PY);
    return;
  }
  // on top: a hazard border round the machine (a steel edge strip outside it), the plate inside — and a
  // recessed tie-down ring in each corner
  const b = Math.min(SHIP.BORDER, Math.min(hw, hd) * .3), e = SHIP.EDGE, R = b * .42, bp = beaconPocket(p);
  k.box('steel', -hw, hw, T - .01, T, hd - e, hd, PY); k.box('steel', -hw, hw, T - .01, T, -hd, -hd + e, PY);
  k.box('steel', -hw, -hw + e, T - .01, T, -hd + e, hd - e, PY); k.box('steel', hw - e, hw, T - .01, T, -hd + e, hd - e, PY);
  const i0 = e, i1 = e + b;                                                                // the border band, in from the edge
  k.box('hazard', -hw + i0 + b, hw - i0 - b, T - .01, T, hd - i1, hd - i0, PY);
  k.box('hazard', -hw + i0 + b, hw - i0 - b, T - .01, T, -hd + i0, -hd + i1, PY);
  k.box('hazard', -hw + i0, -hw + i1, T - .01, T, -hd + i1, hd - i1, PY);
  k.box('hazard', hw - i1, hw - i0, T - .01, T, -hd + i1, hd - i1, PY);
  k.box('deck', -hw + i1, hw - i1, T - .01, T, -hd + i1, hd - i1, PY);
  for (const su of [-1, 1]) for (const sv of [-1, 1]){
    const cu = su * (hw - i0 - b / 2), cv = sv * (hd - i0 - b / 2);
    pit(k, cu, cv, b / 2, T, .05);                                                         // a corner pocket
    if (bp && Math.abs(bp.u - cu) < 1e-9 && Math.abs(bp.v - cv) < 1e-9) continue;         // (the front-left one: the beacon's lens)
    for (const [a0, a1, o] of [[-1, 1, -1], [-1, 1, 1]]){                                // the ring: a square loop lying in it
      k.bar('chrome', [cu + a0 * R, T - .02, cv + o * R], [cu + a1 * R, T - .02, cv + o * R], .028, .028, ALL);
      k.bar('chrome', [cu + o * R, T - .02, cv + a0 * R], [cu + o * R, T - .02, cv + a1 * R], .028, .028, ALL);
    }
  }
}
/* LOW: a hydraulic lift — the deck on tandem scissor units over a base sill (a ram in each), or, when it
   hardly rises, on squat rams; climbed by grip-plate steps */
function lift(k, p){
  const T = p.top, D = deckDepth(p);
  slab(k, p, T, D, 'deck', beaconPocket(p));
  under(k, p, T - D, 'low');
  access(k, p, T, p.access);
}
/* the structure under a deck whose underside is at yB: by band (a loft uses it too) */
function under(k, r, yB, band){
  if (band === 'low') return yB - k.floor > 1.25 ? scissors(k, r, yB) : jacks(k, r, yB);
  if (band === 'mid') return columns(k, r, yB);
  return lattice(k, r, yB);
}
function scissors(k, r, yB){
  const F = k.floor, long = r.hw >= r.hd, A = (long ? r.hw : r.hd) - .4, O = (long ? r.hd : r.hw) - .42;
  const at = (a, y, o) => long ? [a, y, o] : [o, y, a];
  const sill = .2, yLo = F + sill + .08, yHi = yB - .08, rise = yHi - yLo;
  // the base sill (a steel frame, hazard sides) and the deck's carrier rails
  k.box('hazard', -r.hw + .3, r.hw - .3, F, F + sill, -r.hd + .3, r.hd - .3, SIDES);
  k.box('deck', -r.hw + .3, r.hw - .3, F + sill - .02, F + sill, -r.hd + .3, r.hd - .3, PY);
  for (const s of [-1, 1]) k.bar('steel', at(-A, yHi + .02, s * O), at(A, yHi + .02, s * O), .14, .12, ALL);
  const n = Math.max(1, Math.min(4, Math.round(2 * A / Math.max(3.2, rise * 1.6)))), seg = 2 * A / n;      // (tandem units: long, shallow arms)
  for (let i = 0; i < n; i++){
    const a0 = -A + i * seg, a1 = a0 + seg, am = (a0 + a1) / 2, ym = (yLo + yHi) / 2;
    for (const s of [-1, 1]){
      const o = s * O;
      k.bar('steel', at(a0, yLo, o - .07), at(a1, yHi, o - .07), .07, .15, ALL);       // inner arm
      k.bar('steel', at(a1, yLo, o + .07), at(a0, yHi, o + .07), .07, .15, ALL);       // outer arm
      k.bar('chrome', at(am, ym, o - .17), at(am, ym, o + .17), .07, .07, ALL);        // the pivot pin
    }
    k.bar('steel', at(am, ym, -O), at(am, ym, O), .09, .09, ALL);                     // the centre tube
    // its ram: from the sill under a0 up to the centre tube (painted barrel, chrome rod)
    const p0 = at(a0 + seg * .12, F + sill + .1, 0), p1 = at(am, ym, 0);
    const mid = (f) => [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f];
    tube(k, 'steel', p0, mid(.58), .095);
    tube(k, 'chrome', mid(.5), p1, .045, 10);
    k.bar('steel', mid(-.04), mid(.03), .2, .2, ALL);                                  // the clevis at its foot
    k.bar('steel', mid(.55), mid(.6), .21, .21, ALL);                                  // the gland at the barrel's head
  }
  for (let i = 0; i <= n; i++){ const a = -A + i * seg;                                 // the cross tubes at the arms' ends
    k.bar('steel', at(a, yLo, -O - .07), at(a, yLo, O + .07), .08, .08, ALL);
    k.bar('steel', at(a, yHi, -O - .07), at(a, yHi, O + .07), .08, .08, ALL); }
}
/* squat rams under a deck that hardly rises (h ≤ 1.25): a ring of short cylinders in a steel sill */
function jacks(k, r, yB){
  const F = k.floor, hu = r.hw - .55, hv = r.hd - .55, P = ring(hu, hv, 3.4), H = yB - F;
  k.box('hazard', -r.hw + .3, r.hw - .3, F, F + .1, -r.hd + .3, r.hd - .3, SIDES);
  k.box('steel', -r.hw + .3, r.hw - .3, F + .08, F + .1, -r.hd + .3, r.hd - .3, PY);
  for (const [u, v] of P){
    const y0 = F + .1;
    prism(k, r, 'steel', u, v, .26, y0, y0 + H * .45);
    k.box('steel', u - .32, u + .32, y0 + H * .45, y0 + H * .45 + .08, v - .32, v + .32, SIDES | PY);
    prism(k, r, 'chrome', u, v, .18, y0 + H * .45 + .08, yB - .05);
    k.box('steel', u - .36, u + .36, yB - .05, yB, v - .36, v + .36, ALL);
  }
}
/* MID: a deck on telescoping rams, a frame under it, the ship's rails, a stair / ladder */
function rams(k, p){
  const T = p.top, D = deckDepth(p);
  slab(k, p, T, D);
  columns(k, p, T - D);
  const [s, g0, g1] = gapOf(p.access); rails(k, p, T, s, g0, g1);
  access(k, p, T, p.access);
}
function columns(k, r, yB){
  const loft = !!r.keys, F = k.floor, hu = r.hw - .6, hv = r.hd - .6, P = ring(hu, hv, loft ? 7.6 : 5.2), H = yB - F;
  const R = Math.min(loft ? .4 : .36, (loft ? .28 : .24) + H * .012), BD = loft ? .45 : .3;
  const corner = q => Math.abs(Math.abs(q[0]) - hu) < 1e-6 && Math.abs(Math.abs(q[1]) - hv) < 1e-6;
  for (const [u, v] of P) ram(k, r, u, v, F, yB - BD, R);
  // the frame under the deck: a box beam from head to head, knee braces down to each ram's upper stage
  for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length];
    k.bar('steel', [a[0], yB - BD / 2, a[1]], [b[0], yB - BD / 2, b[1]], loft ? .26 : .22, BD, ALL);
    if (H < 2.4) continue;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, kb = Math.min(loft ? 1.5 : 1.1, L * .22);
    const y0 = yB - BD - .9 - kb * .2;
    if (!loft || corner(a)) k.bar('steel', [a[0] + dx * .2, y0, a[1] + dz * .2], [a[0] + dx * kb, yB - BD, a[1] + dz * kb], .1, .1, ALL);
    if (!loft || corner(b)) k.bar('steel', [b[0] - dx * .2, y0, b[1] - dz * .2], [b[0] - dx * kb, yB - BD, b[1] - dz * kb], .1, .1, ALL);
  }
}
/* HIGH: a gantry tower */
function gantry(k, p){
  const T = p.top, D = deckDepth(p);
  slab(k, p, T, D);
  lattice(k, p, T - D, landings(p, k.floor));
  const [s, g0, g1] = gapOf(p.access); rails(k, p, T, s, g0, g1);
  access(k, p, T, p.access);
}
/* the UMBILICAL TOWER under a deck (underside yB): a few heavy box columns (at the corners, and between
   them only where a face spans more than COL_SPAN), each standing on a hydraulic jack — the mid band's ram,
   so the tower reads as the rams grown tall — with a painted band over it; a base frame on the jack heads,
   girts only at the service levels and under the deck, every bay braced by ONE diagonal (a Warren zigzag:
   the faces read as a few big panels, never a mesh); a grated SERVICE WALKWAY ringing the tower at each
   ladder landing (railed, open where the ladder's rest landing meets it); and the UMBILICAL — a chrome hose
   up the front face, held on hazard-painted swing arms near the top, bent onto the deck. */
const TOWER = { SPAN: 8, CW: .24, PANEL: 2.6, GIRT_MAX: 8.5, WALK_IN: .3 };
function lattice(k, r, yB, levels = null, acc = r.access){
  const F = k.floor, hu = r.hw - .55, hv = r.hd - .55, H = yB - F, CW = TOWER.CW;
  const P = ring(hu, hv, TOWER.SPAN);
  const base = Math.max(1.6, Math.min(3.4, H * .2));            // (the jacks' height)
  const lv = (levels ?? landings(r, F)).filter(y => y > F + base + 1.2 && y < yB - 1.6);
  // the girt levels: the base frame, every service level, the deck's beam — split where a bay runs too tall
  const ys = [F + base + .1];
  for (const y of [...lv, yB - .17]){
    const y0 = ys[ys.length - 1], n = Math.max(1, Math.ceil((y - y0) / TOWER.GIRT_MAX - 1e-9));
    for (let i = 1; i <= n; i++) ys.push(y0 + (y - y0) * i / n);
  }
  for (const [u, v] of P){
    ram(k, r, u, v, F, F + base, .32);
    k.box('steel', u - CW, u + CW, F + base, yB - .02, v - CW, v + CW, SIDES);
    k.box('hazard', u - CW - .025, u + CW + .025, F + base, F + base + .6, v - CW - .025, v + CW + .025, SIDES);   // the painted band
  }
  for (let i = 0; i < P.length; i++){
    const a = P[i], b = P[(i + 1) % P.length], w = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let j = 0; j < ys.length; j++){
      const top = j === ys.length - 1;
      k.bar('steel', [a[0], ys[j], a[1]], [b[0], ys[j], b[1]], top ? .24 : .17, top ? .34 : .2, ALL);
    }
    for (let j = 0; j + 1 < ys.length; j++){                      // ONE diagonal per panel, zigzagging up the bay
      const h = ys[j + 1] - ys[j], m = Math.max(1, Math.round(h / Math.max(TOWER.PANEL, w * .9)));
      for (let q = 0; q < m; q++){
        const y0 = ys[j] + h * q / m, y1 = ys[j] + h * (q + 1) / m, flip = (i + j + q) % 2;
        const p0 = flip ? a : b, p1 = flip ? b : a;
        k.bar('steel', [p0[0], y0 + .1, p0[1]], [p1[0], y1 - .1, p1[1]], .13, .09, ALL);
      }
    }
  }
  // the service walkways: a grated ring between the tower's columns and the support's edge, railed outside
  const gu = r.hw - .04, gv = r.hd - .04, iu = hu - TOWER.WALK_IN, iv = hv - TOWER.WALK_IN;
  const [gs, g0, g1] = acc?.kind === 'ladder' ? [acc.side, acc.a0, acc.a1] : [null, 0, 0];
  for (const y of lv){
    for (const [u0, u1, v0, v1] of [[-gu, gu, iv, gv], [-gu, gu, -gv, -iv], [iu, gu, -iv, iv], [-gu, -iu, -iv, iv]]){
      k.box('grate', u0, u1, y - .05, y, v0, v1, PY | NY);
    }
    // the walkway's edge channel (steel, under the grating's rim) and its toe line
    k.box('steel', -gu, gu, y - .2, y - .05, gv - .06, gv, ALL); k.box('steel', -gu, gu, y - .2, y - .05, -gv, -gv + .06, ALL);
    k.box('steel', gu - .06, gu, y - .2, y - .05, -gv + .06, gv - .06, ALL); k.box('steel', -gu, -gu + .06, y - .2, y - .05, -gv + .06, gv - .06, ALL);
    walkRails(k, gu - .05, gv - .05, y, gs, g0, g1, walkSides(r, gs));
  }
  // the umbilical: a chrome hose up the front face from its floor connector, held off the tower by
  // swing arms (hazard paint, chunky clamps) near the top, bent in onto the deck
  if (H > 4 && hu > 1.4){
    const cu = -hu + Math.min(1.7, hu * .6), cv = hv + .3, R = .17, yT = yB - .55;
    k.box('steel', cu - .38, cu + .38, F, F + .55, cv - .3, cv + .22, NOBOT);                  // the connector box
    k.box('hazard', cu - .39, cu + .39, F + .4, F + .55, cv - .31, cv + .23, SIDES | PY);
    prism(k, r, 'chrome', cu, cv, R, F + .55, yT, 12);
    tube(k, 'chrome', [cu, yT - .12, cv], [cu + .85, yB - .12, cv - .3], R);                    // (round, like the hose it bends from)
    k.box('steel', cu - .24, cu + .24, yT - .2, yT + .02, cv - .24, cv + .24, ALL);               // the elbow's coupling
    const arms = [yB - 1.3, yB - 1.3 - Math.min(3.2, (H - 3) * .3)];
    if (H > 12) arms.push(arms[1] - Math.min(3.2, (H - 3) * .3));
    for (const y of arms){
      if (y < F + base + .8) continue;
      k.box('hazard', -hu, cu + .12, y - .14, y + .14, cv - .13, cv + .13, ALL);                  // the arm
      k.box('steel', -hu - .02, -hu + .32, y - .3, y + .3, cv - .2, cv + .2, ALL);                // its hinge on the column
      k.box('steel', cu - .3, cu + .3, y - .22, y + .22, cv - .26, cv + .23, ALL);               // the clamp
    }
  }
}
/* which sides of a tower's service walkways carry a rail: the FRONT (the side facing the house, +z — the audience)
   whole, and the ladder's side as a short GUARD either side of where its rest landing meets the walkway (unless the
   ladder is on the front) — a tall tower has a walkway every LAND_DY, and rails on all four faces of every one read
   from the wide as a cage of thin lines; the far faces (seen, if at all, through the lattice) go without */
const WALK_GUARD = 1.6;
export function walkSides(r, ladderSide = null){
  let front = null, bz = -Infinity;
  for (const side of ['+v', '-v', '+u', '-u']){ const z = sideNormal(r, side)[1]; if (z > bz + 1e-9){ bz = z; front = side; } }
  return { front, guard: ladderSide && ladderSide !== front ? ladderSide : null };
}
/* a walkway's rail at deck height y: chrome top rail on steel stanchions, a thin hazard toe line — on the front
   side (open over [g0, g1] if the ladder's rest landing meets it there) and, on the ladder's side gs, a guard
   WALK_GUARD long either side of that opening (walkSides) */
function walkRails(k, hu, hv, y, gs, g0, g1, { front = null, guard = null } = {}){
  const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
  const RH = 1.1;
  for (const [side, p, q] of runs){
    const all = front === null || side === front;
    if (!all && side !== guard) continue;
    const segs = [];
    if (side === gs){
      const al = pt => side[1] === 'u' ? pt[1] : pt[0], cut = x => side[1] === 'u' ? [p[0], x] : [x, p[1]];
      const lo = Math.min(al(p), al(q)), hi = Math.max(al(p), al(q));
      const l0 = all ? lo : Math.max(lo, g0 - .05 - WALK_GUARD), h1 = all ? hi : Math.min(hi, g1 + .05 + WALK_GUARD);
      if (g0 - .05 > l0 + .3) segs.push([cut(l0), cut(g0 - .05)]);
      if (g1 + .05 < h1 - .3) segs.push([cut(g1 + .05), cut(h1)]);
    } else if (all) segs.push([p, q]);
    for (const [a, b] of segs){
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .2) continue;
      const n = Math.max(1, Math.ceil(L / 2.6));
      for (let i = 0; i <= n; i++){ const t = i / n, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
        k.box('steel', u - .04, u + .04, y, y + RH - .02, v - .04, v + .04, SIDES | PY); }
      k.bar('chrome', [a[0], y + RH - .035, a[1]], [b[0], y + RH - .035, b[1]], .065, .065, ALL);
      k.bar('hazard', [a[0], y + .05, a[1]], [b[0], y + .05, b[1]], .02, .07, ALL);
    }
  }
}
/* the LOFT: an upper catwalk */
function catwalk(k, L){
  const F = k.floor, T = L.top, D = deckDepth(L), solid = L.well > 0 || L.band === 'low';
  slab(k, L, T, D, solid ? 'deck' : 'grate');
  if (!solid){                                                   // joists under the grating (seen through it)
    const n = Math.max(2, Math.round(2 * L.hw / 1.5));
    for (let i = 1; i < n; i++){ const u = -L.hw + 2 * L.hw * i / n; k.box('steel', u - .05, u + .05, T - D + .04, T - .035, -L.hd + .05, L.hd - .05, SIDES | NY); }
    k.box('steel', -L.hw + .05, L.hw - .05, T - D + .04, T - .035, -.05, .05, SIDES | NY);
  }
  under(k, L, T - D, L.band);
  if (railed(L.band)){ const [s, g0, g1] = gapOf(L.access); rails(k, L, T, s, g0, g1); }
  access(k, L, T, L.access);
}
/* an OPEN stand: under every foot (slid off what hangs along its shallower side, never off its foot) a
   telescoping ram while it rises ≤ OPEN_RAM — past that no ram telescopes so far: a slim box-lattice LEG
   (four chords, one diagonal per panel, a ram-housing foot) — head + foot ties and braced tiers (one
   diagonal each) only where they keep out of what hangs (footing3d.js open); its ladder lands on a grated
   landing at the stand's head, run in to the nearest leg */
const OPEN_RAM = 6.5;
function open(k, p){
  const F = k.floor, T = p.top, H = T - F;
  const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6), .3]);
  const cu = feet.reduce((s, f) => s + f[0], 0) / feet.length, cv = feet.reduce((s, f) => s + f[1], 0) / feet.length;
  const HG = p.hang, clip = (u, v, s, rr) => {
    if (!HG) return [u, v];
    const x0 = HG[0] - .05, x1 = HG[1] + .05, z0 = HG[2] - .05, z1 = HG[3] + .05;
    if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
    const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
    return Math.abs(du + dv) <= rr ? [u + du, v + dv] : null;
  };
  const hull = [];
  for (const [fu, fv, rr = .3] of feet.slice().sort((f, g) => Math.atan2(f[1] - cv, f[0] - cu) - Math.atan2(g[1] - cv, g[0] - cu))){
    const s = Math.max(.24, Math.min(.36, rr * .55)), at = clip(fu, fv, s + .14, rr);
    if (!at) continue;
    const [u, v] = at;
    hull.push([u, v]);
    if (H <= OPEN_RAM) ram(k, p, u, v, F, T, s);
    else leg(k, p, u, v, F, T, s + .06);
  }
  const segHits = (a, b, R, g) => {
    if (!R) return false;
    let t0 = 0, t1 = 1; const d = [b[0] - a[0], b[1] - a[1]], lo = [R[0] - g, R[2] - g], hi = [R[1] + g, R[3] + g];
    for (let q = 0; q < 2; q++){
      if (Math.abs(d[q]) < 1e-12){ if (a[q] < lo[q] || a[q] > hi[q]) return false; continue; }
      let x = (lo[q] - a[q]) / d[q], y = (hi[q] - a[q]) / d[q]; if (x > y) [x, y] = [y, x];
      t0 = Math.max(t0, x); t1 = Math.min(t1, y); if (t0 > t1) return false;
    }
    return true;
  };
  const y0 = F + .3, y1 = T - .4, nT = Math.max(1, Math.ceil((y1 - y0) / 6));
  const yT = Array.from({ length: nT + 1 }, (_, t) => y0 + (y1 - y0) * t / nT), clearY = Number.isFinite(p.hangY) ? p.hangY - .3 : -Infinity;
  if (hull.length > 1) for (let i = 0; i < hull.length; i++){
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if (hull.length === 2 && i) break;
    if (segHits(a, b, p.hang, .15)) continue;
    k.bar('steel', [a[0], T - .24, a[1]], [b[0], T - .24, b[1]], .16, .24, ALL);
    k.bar('steel', [a[0], F + .22, a[1]], [b[0], F + .22, b[1]], .13, .13, ALL);
    if (H <= 1.4) continue;
    const near = segHits(a, b, p.hang, 1), tall = H > OPEN_RAM;
    for (let t = 0; t < nT; t++){
      if (near && yT[t + 1] > clearY) break;
      if (t) k.bar('steel', [a[0], yT[t], a[1]], [b[0], yT[t], b[1]], tall ? .15 : .11, tall ? .15 : .11, ALL);
      const [p0, p1] = (i + t) % 2 ? [a, b] : [b, a];
      k.bar('steel', [p0[0], yT[t] + .08, p0[1]], [p1[0], yT[t + 1] - .08, p1[1]], tall ? .12 : .09, tall ? .09 : .06, ALL);
    }
  }
  access(k, p, T, p.access);
  if (p.access?.kind === 'ladder' && hull.length) ladderHead(k, p, T, p.access, hull);
}
/* a slim box-lattice LEG at (u, v) from the floor to y1: a ram-housing foot, four chords, one diagonal per
   panel on each face (a Warren zigzag), a head block under the stand's foot */
function leg(k, spec, u, v, F, y1, s){
  const c = s - .06, yF = F + 1.1, pane = 2 * c * 1.7;
  ram(k, spec, u, v, F, yF, s + .04);                              // its foot: the ram housing it grew out of
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box('steel', u + a * c - .06, u + a * c + .06, yF, y1 - .2, v + b * c - .06, v + b * c + .06, SIDES);
  const n = Math.max(1, Math.round((y1 - .2 - yF) / pane)), dy = (y1 - .2 - yF) / n;
  const faces = [[[-c, -c], [c, -c]], [[c, -c], [c, c]], [[c, c], [-c, c]], [[-c, c], [-c, -c]]];
  for (let f = 0; f < 4; f++){
    const [a, b] = faces[f];
    for (let j = 0; j < n; j++){
      const y0 = yF + j * dy, [p0, p1] = (j + f) % 2 ? [a, b] : [b, a];
      k.bar('steel', [u + p0[0], y0 + .04, v + p0[1]], [u + p1[0], y0 + dy - .04, v + p1[1]], .06, .05, ALL);
      if (j % 3 === 0) k.bar('steel', [u + a[0], y0, v + a[1]], [u + b[0], y0, v + b[1]], .07, .07, ALL);
    }
  }
  k.box('steel', u - s - .06, u + s + .06, y1 - .2, y1, v - s - .06, v + s + .06, ALL);   // the head block
  k.box('hazard', u - c - .08, u + c + .08, yF + .08, yF + .5, v - c - .08, v + c + .08, SIDES);   // the painted band over the foot
}
/* the open stand's LADDER HEAD: a grated landing at the top of the climb (in the ladder's own envelope,
   railed), run in under the stand's head to the nearest leg (inside the pad: no rail, no higher than its top) */
function ladderHead(k, p, T, acc, hull){
  const S = onSide(p, acc.side), along = acc.side[1] === 'u' ? 1 : 0, sg = acc.side[0] === '+' ? 1 : -1;
  const half = along ? p.hw : p.hd;
  // the nearest leg, in (along a, out o) — o < 0 inside the pad
  let best = null;
  for (const [u, v] of hull){ const a = along ? v : u, o = sg * (along ? u : v) - half, d = Math.hypot(a - (acc.a0 + acc.a1) / 2, o); if (!best || d < best.d) best = { a, o, d }; }
  const box = (slot, a0, a1, o0, o1, y0, y1, faces) => { const P = S(a0, o0), Q = S(a1, o1);
    k.box(slot, Math.min(P[0], Q[0]), Math.max(P[0], Q[0]), y0, y1, Math.min(P[1], Q[1]), Math.max(P[1], Q[1]), faces); };
  const y = T - .3, ow = .24;                                       // (the ladder climbs at .34 out: the landing is its inner side)
  const a0 = Math.max(-half + .05, Math.min(acc.a0 + .05, best.a - .35)), a1 = Math.min(half - .05, Math.max(acc.a1 - .05, best.a + .35));
  box('grate', acc.a0 + .05, acc.a1 - .05, 0, ow, y - .05, y, PY | NY);               // the landing, outside the pad
  box('grate', a0, a1, Math.min(best.o, -.05), 0, y - .05, y, PY | NY);              // run in under the head to the leg
  for (const e of [a0 + .04, a1 - .04]) box('steel', e - .04, e + .04, Math.min(best.o, -.05), 0, y - .2, y - .05, ALL);   // its stringers
  box('steel', acc.a0 + .05, acc.a1 - .05, ow - .06, ow, y - .2, y - .05, ALL);
}

/* ---------------- THE RUNNING LIGHTS + STATUS BEACONS ----------------
   One additive draw for every machine, built with the footing it lives in: lamps laid out from the plan
   (starship-deck.js lampLayout), each vertex reading its machine's pulse slot — uS: the seconds since its
   latest two strikes + their weights (the chase: two heads race from the plate's front-centre round to
   the back), uB: its beacon (x: playing — a slow afterglow, which also lifts the whole channel's resting
   glow, so a playing machine's plate edge reads ON from the wide; y: the cue light before an entrance). The
   material is the ROOM's (one per room, its uniforms written from the room's update — starship.js). */
const MAXS = FOOT.MAX_PULSE;
export const LAMP = { lap: .5, decay: .55, wid: .9, tail: 2.4, base: .13, play: 1.4, gain: 2.1, strip: .32, beacon: 1.5 };
export function lampMaterial(){
  return new THREE.ShaderMaterial({
    uniforms: { uS: { value: new Float32Array(4 * MAXS).fill(1e4) }, uB: { value: new Float32Array(4 * MAXS) },
      uLap: { value: LAMP.lap }, uDecay: { value: LAMP.decay }, uWid: { value: LAMP.wid }, uTail: { value: LAMP.tail },
      uBase: { value: LAMP.base }, uPlay: { value: LAMP.play }, uGain: { value: LAMP.gain }, uStrip: { value: LAMP.strip }, uBeacon: { value: LAMP.beacon } },
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute float aSlot, aD, aHalf, aKind;
      uniform vec4 uS[${MAXS}]; uniform vec4 uB[${MAXS}];
      uniform float uLap, uDecay, uWid, uTail, uBase, uPlay, uGain, uStrip, uBeacon;
      varying vec3 vC;
      float head(float age, float w, float d, float hp){
        float x = d - age / uLap * hp;                       // ahead of the head (+) / its tail (−)
        float s = x > 0. ? exp(-x * x / (uWid * uWid)) : exp(x / uTail);
        return w * exp(-age / uDecay) * s;
      }
      void main(){
        int i = int(max(aSlot, 0.) + .5);
        float L = uStrip;
        if (aKind < .5){ vec4 s = uS[i]; L = uBase * (1. + uPlay * uB[i].x) + uGain * max(head(s.x, s.y, aD, aHalf), head(s.z, s.w, aD, aHalf)); }   // (a playing machine's channel glows ON)
        else if (aKind < 1.5){ vec4 b = uB[i]; L = uBeacon * (.16 + .84 * b.x) + .9 * b.y; }
        vC = aCol * L;
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
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
}
/* the lamps' geometry: a quad per lamp (facing out of its channel, or up from the floor), a 5-faced cube
   for a beacon on a rail post */
const STRIP_COL = new THREE.Color(0x4fc8ff), LAMP_COL = new THREE.Color(0x8fd8ff);
export function lampGeometry(lamps){
  // (presized typed arrays, written in place: the lamps are ~1k quads on a full deck — the old array-spread
  //  pushes were the costliest part of a cold starship footing build)
  let nq = 0; for (const L of lamps) nq += L.cube ? 5 : 1;
  const P = new Float32Array(nq * 12), C = new Float32Array(nq * 12), S = new Float32Array(nq * 4), D = new Float32Array(nq * 4),
    H = new Float32Array(nq * 4), K = new Float32Array(nq * 4), I = nq * 4 < 65536 ? new Uint16Array(nq * 6) : new Uint32Array(nq * 6), col = new THREE.Color();
  let q = 0, L = null, lastCol = null;
  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
    const o = q * 12, v = q * 4, w = q * 6;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
    P[o + 6] = cx; P[o + 7] = cy; P[o + 8] = cz; P[o + 9] = dx; P[o + 10] = dy; P[o + 11] = dz;
    for (let j = 0; j < 4; j++){ C[o + j * 3] = col.r; C[o + j * 3 + 1] = col.g; C[o + j * 3 + 2] = col.b; S[v + j] = L.slot; D[v + j] = L.d; H[v + j] = L.half; K[v + j] = L.kind; }
    I[w] = v; I[w + 1] = v + 1; I[w + 2] = v + 2; I[w + 3] = v; I[w + 4] = v + 2; I[w + 5] = v + 3;
    q++;
  };
  for (L of lamps){
    if (L.kind === 2){ col.copy(STRIP_COL); lastCol = null; }
    else if (L.color){ if (L.color !== lastCol){ lastCol = L.color; col.set(L.color); } }      // (a CSS parse per colour run, not per lamp)
    else { col.copy(LAMP_COL); lastCol = null; }
    const [x, y, z] = L.c, [tx, tz] = L.t, n = L.n;
    if (L.cube){
      const s = L.hl, x0 = x - s, x1 = x + s, y0 = y - s, y1 = y + s, z0 = z - s, z1 = z + s;
      quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0);                                    // top
      quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1); quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0);
      quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1); quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0);
      continue;
    }
    if (n[1] > .5){                                            // lying on the floor, facing up
      const bx = -tz, bz = tx, al = L.hl, bh = L.hh;
      // p(a, b) = [x + tx·a·hl + bx·b·hh, y, z + tz·a·hl + bz·b·hh]: p(−1, 1) p(1, 1) p(1, −1) p(−1, −1)
      quad(x - tx * al + bx * bh, y, z - tz * al + bz * bh, x + tx * al + bx * bh, y, z + tz * al + bz * bh,
           x + tx * al - bx * bh, y, z + tz * al - bz * bh, x - tx * al - bx * bh, y, z - tz * al - bz * bh);
      continue;
    }
    // standing in a channel, facing n: corners along t × up, counter-clockwise seen from n
    const ux = tx * L.hl, uz = tz * L.hl, ya = y - L.hh, yb = y + L.hh;
    const cw = (tz * n[0] - tx * n[2]) > 0;                     // (t × up) · n: which way round faces out
    if (cw) quad(x - ux, ya, z - uz, x - ux, yb, z - uz, x + ux, yb, z + uz, x + ux, ya, z + uz);
    else quad(x - ux, ya, z - uz, x + ux, ya, z + uz, x + ux, yb, z + uz, x - ux, yb, z - uz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aSlot', new THREE.BufferAttribute(S, 1));
  g.setAttribute('aD', new THREE.BufferAttribute(D, 1));
  g.setAttribute('aHalf', new THREE.BufferAttribute(H, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(K, 1));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}

/* ---------------- the style ---------------- */
/* the style. `lamps`: the room's lamp material — each build then carries ONE lamps mesh (its own
   geometry, laid out from that build's plan), and every hook answers with it: the footing adds it once,
   counts it (footStats), and frees its geometry with the rest. No lamps: the hooks answer an empty group. */
export function shipFooting({ lamps = null } = {}){
  let made = null, kitOf = null, mesh = null;
  const drew = k => {
    if (k !== kitOf){
      kitOf = k; mesh = null;
      if (lamps){
        mesh = new THREE.Mesh(lampGeometry(lampLayout(k.plan)), lamps);
        mesh.name = 'footing:lamps'; mesh.renderOrder = 2; mesh.matrixAutoUpdate = false;
      }
    }
    return mesh || true;                                         // (no lamps: drawn into the slots, nothing to add)
  };
  return {
    key: 'starship',
    mats(kit, ctx = {}){ return made ||= shipMats(ctx.envMap ?? null); },
    flush(p, k){ p.open ? open(k, p) : plate(k, p); return drew(k); },
    low(p, k){ p.open ? open(k, p) : lift(k, p); return drew(k); },
    mid(p, k){ p.open ? open(k, p) : rams(k, p); return drew(k); },
    high(p, k){ p.open ? open(k, p) : gantry(k, p); return drew(k); },
    loft(L, k){ catwalk(k, L); return drew(k); },
    edge(p, k){ return drew(k); },                               // (every machine's light is the lamps')
    dispose(){ made?.dispose(); made = null; kitOf = mesh = null; },
  };
}
