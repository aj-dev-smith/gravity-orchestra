import * as THREE from 'three';
import { FOOT, railed } from './footing.js';
import { gridPatch, LINE } from './grid-shade.js';
/* ============================================================
   GREYBOX FOOTING — what the machines stand on in ROOM ZERO (a rooms/footing3d.js STYLE: grid.js
   hands it to the host as `footing`). The grid folds up out of the floor: every support is a dark
   GRAPHITE volume carrying the floor's own world grid (grid-shade.js — a plinth's top shows the
   floor's cells, its sides the floor's lines climbing them), its edges traced by crisp LIGHT LINES.
   Calm, precise: one blue for the room's structure, the machine's own colour for its reactive edge.

     flush  a graphite slab; its top edge is the machine's light (the kit's edge: one draw for all)
     low    a stepped riser — tiers inset within the pad's margin (never on the stair's side, never
            smaller than the machine), each tier's nosing lit — climbed by solid stepped slabs
     mid    a graphite deck on slim legs, X-braced in light, behind a smoked-glass balustrade capped
            by a light rail; floating treads on a spine stair, or a ladder of light rungs
     high   a lattice tower drawn in light: graphite chords laced with light, light ties + braces at
            every landing level, a caged ladder of light rungs resting on thin lit landings
     loft   a smoked-glass mezzanine on a graphite frame (its joists seen through the glass) over the
            band's structure, a light-line balustrade
     open   (the turntable's stand: something hangs below what it rests on) graphite posts under its
            feet, ties + braces in light, kept out of what hangs
   Everything is written into the kit's merged slots — 'deck' (graphite: the kit's own slot name,
   so a loft member's shim lands in it too), 'gline' (bright light lines), 'glace' (the dim light
   lattice), 'gglass' (smoked glass) — plus the kit's EDGE: ≤ 5 draws for a whole song's footing.
   Every form stays inside its support's envelope (footingBoxes) — test/room-grid.test.js.
   1 u ≈ .677 m: a tier ≈ 60 cm, a guard rail 1 m, ladder rungs 30 cm apart.
   ============================================================ */

/* face flags (rooms/footing3d.js obox) */
const PY = 1, NY = 2, PX = 4, NX = 8, PZ = 16, NZ = 32, ALL = 63, NOBOT = ALL & ~NY, SIDES = PX | NX | PZ | NZ;

export const GDIM = {
  NOSE: .055,                                   // a lit nosing (a slab's top edge)
  LINE: .05,                                    // a light rail / tie
  LACE: .042,                                   // the lattice's light lacing
  TIER: .85,                                    // a riser's course (≈ 58 cm)
  STEP_IN: .17,                                 // a riser tier's inset (the most: the pad's margin bounds it)
  DECK: .32, DECK_HI: .38, WELL: .04,           // deck slabs · a machine's least deck under its deepest dip
  LEG: .24, LEG_IN: .3, LEG_SPAN: 5.5,          // a platform's legs (≈ 16 cm square)
  COL: .72, COL_IN: .55, COL_SPAN: 14,          // a lattice column's width, inset, most apart
  CHORD: .1, PITCH: 1.05,                       // its chords, its lacing's zig pitch
  BEAM: .56, BEAM_W: .42,                       // a lattice beam under the deck
  POST: .07, RAIL_SPAN: 2.2, GLASS: .035,       // balustrade posts, their spacing, its glass
  STILE: .085, RUNG: .045, RUNG_DY: .45, LAD_HALF: .33, LAD_OUT: .34,
  OPEN_TIER: 6,                                 // an open stand's posts: tied + braced every ≤ this
};
const RAIL_H = FOOT.RAIL, HAND = 1.3, JOIST = .16;          // (a glass loft's frame reaches JOIST under its glass: the joists)
const F_OF = kit => kit.floor;

/* ---- helpers (the kit's own, restyled: rooms/footing3d.js keeps them private) ---- */
const deckDepth = r => Math.max(r.keys || r.band === 'high' ? GDIM.DECK_HI : GDIM.DECK, (r.well || 0) + GDIM.WELL);
/* points round a rect's perimeter (±hu, ±hv), corners included, at most `span` apart — in order */
function ring(hu, hv, span){
  const nu = Math.max(1, Math.ceil(2 * hu / span - 1e-9)), nv = Math.max(1, Math.ceil(2 * hv / span - 1e-9)), out = [];
  for (let i = 0; i < nu; i++) out.push([-hu + 2 * hu * i / nu, -hv]);
  for (let i = 0; i < nv; i++) out.push([hu, -hv + 2 * hv * i / nv]);
  for (let i = 0; i < nu; i++) out.push([hu - 2 * hu * i / nu, hv]);
  for (let i = 0; i < nv; i++) out.push([-hu, hv - 2 * hv * i / nv]);
  return out;
}
/* (along a, out o) on one side of a rect → local [u, v] */
const onSide = (r, side) => { const k = side[0] === '+' ? 1 : -1;
  return side[1] === 'u' ? (a, o) => [k * (r.hw + o), a] : (a, o) => [a, k * (r.hd + o)]; };
/* does the segment p → q (local u, v) cross the rect [u0, u1, v0, v1] grown by g? */
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
/* where a deck's rails open for its access: the along-range on its side */
const gapOf = acc => !acc ? [null, 0, 0] : acc.kind === 'stair' ? [acc.side, acc.a1 - acc.out, acc.a1] : (() => {
  const mid = (acc.a0 + acc.a1) / 2, off = acc.flights > 1 ? ((acc.flights - 1) % 2 ? .45 : -.45) : 0;
  return [acc.side, mid + off - GDIM.LAD_HALF - .15, mid + off + GDIM.LAD_HALF + .15]; })();
/* the landing levels of a support's ladder (ties + braces meet them): every LAND_DY of its climb */
function landings(r, F){ const nf = r.access?.flights || Math.max(1, Math.ceil((r.top - F) / FOOT.LAND_DY)), out = [];
  for (let f = 1; f < nf; f++) out.push(F + (r.top - F) * f / nf); return out; }

/* a lit rim: light bars along the top edges of a slab u0..u1 × v0..v1 whose top is y (a hair proud) —
   `skip`: a side left dark (where a stair lands, or a tier above stands flush) */
function rim(k, slot, u0, u1, v0, v1, y, t = GDIM.NOSE, skip = null){
  const o = .006, y0 = y - t, y1 = y + .004;
  if (skip !== '-v') k.box(slot, u0 - o, u1 + o, y0, y1, v0 - o, v0 - o + t, NOBOT);
  if (skip !== '+v') k.box(slot, u0 - o, u1 + o, y0, y1, v1 + o - t, v1 + o, NOBOT);
  if (skip !== '-u') k.box(slot, u0 - o, u0 - o + t, y0, y1, v0 - o + t, v1 + o - t, NOBOT);
  if (skip !== '+u') k.box(slot, u1 + o - t, u1 + o, y0, y1, v0 - o + t, v1 + o - t, NOBOT);
}

/* ---- the forms (each in its spec's frame: the kit sets it) ---- */
function makeForms(k, marginOf){
  const F = F_OF(k);
  /* a box on one side of a rect: along a0..a1, out o0..o1 */
  const sideBox = (r, side) => { const S = onSide(r, side);
    return (slot, a0, a1, o0, o1, y0, y1, faces = ALL) => { const p = S(a0, o0), q = S(a1, o1);
      k.box(slot, Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[1], q[1]), Math.max(p[1], q[1]), faces); }; };

  /* FLUSH: a graphite slab (the floor's grid on it) — its top edge the machine's light */
  function flush(p){
    const T = p.fixed ? F + FOOT.KERB : p.top, hw = p.hw, hd = p.hd;
    k.box('deck', -hw, hw, F - .04, T, -hd, hd, NOBOT);
    const t = Math.min(.075, (T - F) * .5);
    k.forms.band(-hw, hw, -hd, hd, T - t, T + .002, p.color, p.pulse);
  }

  /* LOW: a stepped riser. Tiers of about GDIM.TIER, each inset STEP_IN more than the one under it —
     within the pad's margin (the top tier never smaller than the machine) and never on the side the
     stair climbs (it lands flush against the top). A lit nosing on every tier; the top edge is the
     machine's light. */
  function low(p){
    const T = p.top, h = T - F, side = p.access?.kind === 'stair' ? p.access.side : null;
    const nt = Math.max(1, Math.min(4, Math.round(h / GDIM.TIER)));
    const step = nt > 1 ? Math.min(GDIM.STEP_IN, marginOf(p) / (nt - 1)) : 0;
    const rect = ins => [side === '-u' ? -p.hw : -p.hw + ins, side === '+u' ? p.hw : p.hw - ins,
                         side === '-v' ? -p.hd : -p.hd + ins, side === '+v' ? p.hd : p.hd - ins];
    for (let i = 0; i < nt; i++){
      const y0 = i ? F + h * i / nt : F - .04, y1 = F + h * (i + 1) / nt, [u0, u1, v0, v1] = rect(step * i);
      k.box('deck', u0, u1, y0, y1, v0, v1, NOBOT);
      if (i < nt - 1) rim(k, 'gline', u0, u1, v0, v1, y1, .045, side);
    }
    const [u0, u1, v0, v1] = rect(step * (nt - 1));
    k.forms.band(u0, u1, v0, v1, T - .075, T + .002, p.color, p.pulse);
    access(p, T, p.access, true);
  }

  /* a raised DECK: graphite slab, its top edges lit, the machine's light along its fascia */
  function deck(r, T, D, col, pulse, strip = true){
    const hw = r.hw, hd = r.hd;
    k.box('deck', -hw, hw, T - D, T, -hd, hd, ALL);
    rim(k, 'gline', -hw, hw, -hd, hd, T);
    if (strip) k.forms.band(-hw, hw, -hd, hd, T - D + .06, T - D + .06 + .085, col, pulse);
  }
  /* the BALUSTRADE round a deck at T (inset .1): slim graphite posts, smoked-glass panels, a light cap
     rail — open over [g0, g1] on the access side */
  function rails(r, T, gapSide = null, g0 = 0, g1 = 0){
    const hu = r.hw - .1, hv = r.hd - .1;
    const runs = [['-v', [-hu, -hv], [hu, -hv]], ['+u', [hu, -hv], [hu, hv]], ['+v', [hu, hv], [-hu, hv]], ['-u', [-hu, hv], [-hu, -hv]]];
    for (const [side, p, q] of runs){
      const al = pt => side[1] === 'u' ? pt[1] : pt[0];
      const segs = [];
      if (side === gapSide){
        const a0 = al(p), a1 = al(q), lo = Math.min(a0, a1), hi = Math.max(a0, a1);
        const cut = x => side[1] === 'u' ? [p[0], x] : [x, p[1]];
        if (g0 - .05 > lo + .3) segs.push([cut(lo), cut(g0 - .05)]);
        if (g1 + .05 < hi - .3) segs.push([cut(g1 + .05), cut(hi)]);
      } else segs.push([p, q]);
      for (const [a, b] of segs) railRun(a, b, T);
    }
  }
  function railRun(a, b, T){
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .2) return;
    const n = Math.max(1, Math.ceil(L / GDIM.RAIL_SPAN)), P = GDIM.POST;
    for (let i = 0; i <= n; i++){ const t = i / n, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      k.box('deck', u - P / 2, u + P / 2, T, T + RAIL_H - .05, v - P / 2, v + P / 2, SIDES | PY); }
    const yG = (T + .14 + T + RAIL_H - .12) / 2, hG = RAIL_H - .26;
    k.bar('gglass', [a[0], yG, a[1]], [b[0], yG, b[1]], GDIM.GLASS, hG, ALL);
    k.bar('gline', [a[0], T + RAIL_H - .03, a[1]], [b[0], T + RAIL_H - .03, b[1]], GDIM.LINE, GDIM.LINE, ALL);
    k.bar('glace', [a[0], T + .07, a[1]], [b[0], T + .07, b[1]], .035, .035, ALL);
  }
  /* slim graphite LEGS under a deck (bottom at yB): a beam round their heads, light ties at the foot and
     at each tier, every bay X-braced in light */
  function legs(r, yB){
    const hu = r.hw - GDIM.LEG_IN, hv = r.hd - GDIM.LEG_IN, P = ring(hu, hv, GDIM.LEG_SPAN), L = GDIM.LEG, H = yB - F;
    for (const [u, v] of P){
      k.box('deck', u - L / 2, u + L / 2, F, yB, v - L / 2, v + L / 2, SIDES);
      k.box('deck', u - .24, u + .24, F, F + .05, v - .24, v + .24, NOBOT);              // base plate
      k.box('gline', u - L / 2 - .006, u + L / 2 + .006, F + .05, F + .085, v - L / 2 - .006, v + L / 2 + .006, NOBOT);   // a lit collar at its foot
    }
    const yBeam = yB - .26, yTie = F + .32;
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i + 1) % P.length];
      k.bar('deck', [a[0], yB - .13, a[1]], [b[0], yB - .13, b[1]], .18, .26, ALL);        // the beam under the deck
      if (H < 1.6) continue;
      k.bar('glace', [a[0], yTie, a[1]], [b[0], yTie, b[1]], .05, .05);
      const S = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round((yBeam - yTie) / Math.max(2.2, S * .9)));
      for (let j = 0; j < n; j++){
        const y0 = yTie + (yBeam - yTie) * j / n, y1 = yTie + (yBeam - yTie) * (j + 1) / n;
        if (j) k.bar('glace', [a[0], y0, a[1]], [b[0], y0, b[1]], .045, .045);
        k.bar('glace', [a[0], y0, a[1]], [b[0], y1, b[1]], GDIM.LACE, GDIM.LACE);
        k.bar('glace', [b[0], y0, b[1]], [a[0], y1, a[1]], GDIM.LACE, GDIM.LACE);
      }
    }
  }
  /* a LATTICE column at (u, v), y0 → y1: four graphite chords, every face laced in light */
  function column(u, v, y0, y1){
    const h = GDIM.COL / 2, c = GDIM.CHORD, Hc = y1 - y0;
    const C = [[u - h, v - h], [u + h, v - h], [u + h, v + h], [u - h, v + h]];
    for (const [x, z] of C) k.box('deck', x - c / 2, x + c / 2, y0 + .06, y1 - .06, z - c / 2, z + c / 2, SIDES);
    k.box('deck', u - h - .12, u + h + .12, y0, y0 + .07, v - h - .12, v + h + .12, NOBOT);   // foot plate
    k.box('gline', u - h - .126, u + h + .126, y0 + .07, y0 + .1, v - h - .126, v + h + .126, NOBOT);   // its lit lip
    k.box('deck', u - h - .06, u + h + .06, y1 - .07, y1, v - h - .06, v + h + .06, ALL);     // head plate
    const n = Math.max(1, Math.round((Hc - .14) / GDIM.PITCH)), dy = (Hc - .14) / n;
    for (let f = 0; f < 4; f++){
      const A = C[f], B = C[(f + 1) % 4];
      for (let j = 0; j < n; j++){
        const ya = y0 + .07 + j * dy, [p, q] = (j + f) % 2 ? [A, B] : [B, A];
        k.bar('glace', [p[0], ya, p[1]], [q[0], ya + dy, q[1]], GDIM.LACE, GDIM.LACE);
      }
    }
  }
  /* a lattice BEAM between two column heads a → b ([u, v]), its top at yT: graphite chords, light lacing */
  function beam(a, b, yT){
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < GDIM.COL + .2) return;
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx, h = GDIM.BEAM_W / 2, c = GDIM.CHORD * .9;
    const s0 = GDIM.COL / 2 + .02, s1 = L - GDIM.COL / 2 - .02, yb = yT - GDIM.BEAM, yc = [yb + c / 2, yT - c / 2];
    const P = (s, o, y) => [a[0] + dx * s + nx * o, y, a[1] + dz * s + nz * o];
    for (const o of [-h, h]) for (const y of yc) k.bar('deck', P(s0, o, y), P(s1, o, y), c, c, ALL);
    const n = Math.max(1, Math.round((s1 - s0) / (GDIM.BEAM * 1.1))), ds = (s1 - s0) / n;
    for (const o of [-h, h]) for (let j = 0; j < n; j++){
      const sa = s0 + j * ds, [y0, y1] = j % 2 ? [yc[0], yc[1]] : [yc[1], yc[0]];
      k.bar('glace', P(sa, o, y0), P(sa + ds, o, y1), GDIM.LACE, GDIM.LACE);
    }
  }
  /* lattice columns round a deck (bottom at yB), beams between their heads, light ties + X-braces in
     panels at every landing level */
  function trussFrame(r, yB, levels){
    const hu = r.hw - GDIM.COL_IN, hv = r.hd - GDIM.COL_IN, P = ring(hu, hv, GDIM.COL_SPAN), yH = yB - GDIM.BEAM;
    for (const [u, v] of P) column(u, v, F, yH);
    for (let i = 0; i < P.length; i++){
      const a = P[i], b = P[(i + 1) % P.length];
      beam(a, b, yB);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, s = GDIM.COL / 2;
      const A = [a[0] + dx * s, a[1] + dz * s], B = [b[0] - dx * s, b[1] - dz * s];
      let yPrev = F + .4;
      for (const y of [...levels.filter(y => y > F + 2 && y < yH - 1.5), yH - .05]){
        if (y < yH - .2) k.bar('gline', [A[0], y, A[1]], [B[0], y, B[1]], GDIM.LINE, GDIM.LINE);
        const n = Math.max(1, Math.round(L / Math.max(y - yPrev, 3))), at = j => [A[0] + (B[0] - A[0]) * j / n, A[1] + (B[1] - A[1]) * j / n];
        for (let j = 0; j < n; j++){
          const p = at(j), q = at(j + 1);
          k.bar('glace', [p[0], yPrev, p[1]], [q[0], y, q[1]], GDIM.LACE, GDIM.LACE);
          k.bar('glace', [q[0], yPrev, q[1]], [p[0], y, p[1]], GDIM.LACE, GDIM.LACE);
          if (j) k.bar('deck', [p[0], yPrev, p[1]], [p[0], y, p[1]], .08, .08);
        }
        yPrev = y;
      }
    }
  }
  /* a STAIR hugging one side (footing.js access), rising along it to a landing at the deck. solid:
     stepped graphite slabs from the floor (a riser); else floating treads on a graphite spine. Every
     tread's nosing lit; a light handrail on slim posts. */
  function stair(r, T, acc, solid){
    const sb = sideBox(r, acc.side), S = onSide(r, acc.side), ow = acc.out, n = acc.n, rise = acc.rise, tr = acc.tread;
    const W2 = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; };
    const aL = acc.a1 - ow;                                    // the landing starts here (the last tread ends here)
    for (let i = 1; i < n; i++){
      const a0 = acc.a0 + (i - 1) * tr, a1 = a0 + tr, y = F + i * rise;
      if (solid) sb('deck', a0, a1 + .02, .02, ow, F - .04, y, NOBOT);
      else sb('deck', a0, a1 + .03, .1, ow - .1, y - .09, y, ALL);
      sb('gline', a0 - .006, a0 + .05, solid ? .02 : .1, solid ? ow : ow - .1, y - .045, y + .004, NOBOT);   // the lit nosing
    }
    if (solid) sb('deck', aL, acc.a1, .02, ow, F - .04, T, NOBOT);
    else {
      sb('deck', aL, acc.a1, 0, ow, T - .2, T, ALL);
      k.bar('deck', W2(acc.a0 + .12, ow / 2, F), W2(aL + .2, ow / 2, T - .2), .16, .3);           // the spine
      k.bar('deck', W2(aL + .14, ow - .14, F), W2(aL + .14, ow - .14, T - .2), .12, .12, ALL);     // landing posts
      k.bar('deck', W2(acc.a1 - .14, ow - .14, F), W2(acc.a1 - .14, ow - .14, T - .2), .12, .12, ALL);
    }
    sb('gline', aL - .006, acc.a1 + .006, ow - .05, ow + .006, T - .045, T + .004, NOBOT);         // the landing's outer edge, lit
    // the handrail on the open side: up the flight, along the landing, round its end — light on slim posts
    const o = ow - .07, y0 = F + rise + HAND, y1 = T + HAND;
    k.bar('gline', W2(acc.a0 + .12, o, y0), W2(aL, o, y1), GDIM.LINE, GDIM.LINE, ALL);
    k.bar('gline', W2(aL, o, y1), W2(acc.a1 - .05, o, y1), GDIM.LINE, GDIM.LINE, ALL);
    k.bar('gline', W2(acc.a1 - .05, o, y1), W2(acc.a1 - .05, .1, y1), GDIM.LINE, GDIM.LINE, ALL);
    for (const [a, y] of [[acc.a0 + .12, F + rise], [aL, T], [acc.a1 - .05, T]]) k.bar('deck', W2(a, o, y), W2(a, o, y + HAND - .03), .06, .06, PY | SIDES);
    k.bar('deck', W2(acc.a1 - .05, .1, T), W2(acc.a1 - .05, .1, y1 - .03), .06, .06, SIDES);
  }
  /* a LADDER up one face: graphite stiles, LIGHT rungs, brackets back to a pair of masts in the
     structure's own plane; past FOOT.CAGE a cage of light hoops, its flights stepping sideways at a
     thin lit rest landing every LAND_DY */
  function ladder(r, T, acc){
    const S = onSide(r, acc.side), W2 = (a, o, y) => { const [u, v] = S(a, o); return [u, y, v]; }, sb = sideBox(r, acc.side);
    const nf = acc.flights, mid = (acc.a0 + acc.a1) / 2, off = nf > 1 ? .45 : 0, O = GDIM.LAD_OUT, hh = GDIM.LAD_HALF;
    const oM = -(r.band === 'high' ? GDIM.COL_IN : GDIM.LEG_IN), yTop = T - deckDepth(r) - (r.keys && r.band !== 'low' ? JOIST : 0);
    for (let f = 0; f < nf; f++){
      const y0 = F + (T - F) * f / nf, y1 = F + (T - F) * (f + 1) / nf, ac = mid + (f % 2 ? off : -off), top = f === nf - 1;
      for (const s of [-hh, hh]) k.bar('deck', W2(ac + s, O, y0), W2(ac + s, O, y1 + (top ? 1.15 : 1)), GDIM.STILE, GDIM.STILE * .7, ALL);
      for (let y = y0 + GDIM.RUNG_DY; y < y1 - .05; y += GDIM.RUNG_DY) k.bar('gline', W2(ac - hh, O, y), W2(ac + hh, O, y), GDIM.RUNG, GDIM.RUNG);
      const m1 = top ? yTop : y1 - .12;
      for (const s of [-hh, hh]){
        k.bar('deck', W2(ac + s, oM, y0), W2(ac + s, oM, m1), .1, .1, f ? SIDES : SIDES | PY);
        for (let y = y0 + 1.6; y < m1 - .3; y += 3) k.bar('deck', W2(ac + s, O, y), W2(ac + s, oM, y), .06, .06);   // brackets
        k.bar('deck', W2(ac + s, O, m1 - .25), W2(ac + s, oM, m1 - .25), .06, .06);
      }
      if (acc.cage){
        const c0 = y0 + (f ? 1.3 : 3.2), c1 = y1 + (top ? 1.1 : .9), R0 = O - .02, R1 = O + .78, hw = hh + .2;
        if (c1 > c0 + .3){
          for (let y = c0; y <= c1 + 1e-6; y += Math.max(.9, (c1 - c0) / Math.max(1, Math.round((c1 - c0) / 1.35)))){
            k.bar('glace', W2(ac - hw, R0, y), W2(ac - hw, R1, y), .045, .045, ALL);
            k.bar('glace', W2(ac - hw, R1, y), W2(ac + hw, R1, y), .045, .045, ALL);
            k.bar('glace', W2(ac + hw, R1, y), W2(ac + hw, R0, y), .045, .045, ALL);
          }
          for (const [a, o] of [[-hw, R1 - .3], [-hw, R1], [0, R1], [hw, R1], [hw, R1 - .3]]) k.bar('glace', W2(ac + a, o, c0), W2(ac + a, o, c1), .035, .035);
        }
      }
      if (!top){                                               // a thin lit rest landing, back to the masts, railed in light
        const a0 = acc.a0, a1 = acc.a1, yl = y1, o1 = acc.out;
        sb('deck', a0, a1, oM, o1, yl - .1, yl, ALL);
        sb('gline', a0 - .006, a1 + .006, o1 - .045, o1 + .006, yl - .04, yl + .004, NOBOT);
        for (const a of [a0 + .05, a1 - .05]) k.bar('deck', W2(a, o1 - .05, yl), W2(a, o1 - .05, yl + RAIL_H - .04), GDIM.POST, GDIM.POST, PY | SIDES);
        k.bar('gline', W2(a0 + .05, o1 - .05, yl + RAIL_H - .03), W2(a1 - .05, o1 - .05, yl + RAIL_H - .03), GDIM.LINE, GDIM.LINE, ALL);
        k.bar('glace', W2(a0 + .05, o1 - .05, yl + RAIL_H / 2), W2(a1 - .05, o1 - .05, yl + RAIL_H / 2), .035, .035);
      }
    }
  }
  function access(r, T, acc, solid){ if (!acc) return; acc.kind === 'stair' ? stair(r, T, acc, solid) : ladder(r, T, acc); }

  /* OPEN: a graphite post under every foot (slid off what hangs, never off its foot), a graphite head
     beam, light ties + X-braced tiers — a face that passes what hangs is braced only below it */
  function open(p){
    const T = p.top, H = T - F;
    const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6), .3]);
    const cu = feet.reduce((s, f) => s + f[0], 0) / feet.length, cv = feet.reduce((s, f) => s + f[1], 0) / feet.length;
    const HG = p.hang, clip = (u, v, s, r) => {
      if (!HG) return [u, v];
      const x0 = HG[0] - .05, x1 = HG[1] + .05, z0 = HG[2] - .05, z1 = HG[3] + .05;
      if (u + s <= x0 || u - s >= x1 || v + s <= z0 || v - s >= z1) return [u, v];
      const [du, dv] = [[x0 - u - s, 0], [x1 - u + s, 0], [0, z0 - v - s], [0, z1 - v + s]].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
      return Math.abs(du + dv) <= r ? [u + du, v + dv] : null;
    };
    const hull = [];
    for (const [fu, fv, rr = .3] of feet.slice().sort((f, g) => Math.atan2(f[1] - cv, f[0] - cu) - Math.atan2(g[1] - cv, g[0] - cu))){
      const s = Math.max(.18, Math.min(.3, rr * .45)), at = clip(fu, fv, s, rr);
      if (!at) continue;
      const [u, v] = at;
      hull.push([u, v]);
      k.box('deck', u - s, u + s, F, T - .06, v - s, v + s, SIDES);
      k.box('deck', u - s - .1, u + s + .1, T - .06, T, v - s - .1, v + s + .1, ALL);         // the head plate under the foot
      k.box('deck', u - s - .18, u + s + .18, F, F + .05, v - s - .18, v + s + .18, NOBOT);
      k.box('gline', u - s - .006, u + s + .006, F + .05, F + .085, v - s - .006, v + s + .006, NOBOT);   // a lit collar
      k.box('gline', u - s - .106, u + s + .106, T - .1, T - .06, v - s - .106, v + s + .106, NOBOT);     // the head plate's lit lip
    }
    const y0 = F + .3, y1 = T - .4, nT = Math.max(1, Math.ceil((y1 - y0) / GDIM.OPEN_TIER));
    const yT = Array.from({ length: nT + 1 }, (_, t) => y0 + (y1 - y0) * t / nT), clearY = Number.isFinite(p.hangY) ? p.hangY - .3 : -Infinity;
    if (hull.length > 1) for (let i = 0; i < hull.length; i++){
      const a = hull[i], b = hull[(i + 1) % hull.length];
      if (hull.length === 2 && i) break;
      if (segHits(a, b, p.hang, .15)) continue;
      k.bar('deck', [a[0], T - .22, a[1]], [b[0], T - .22, b[1]], .16, .24, ALL);
      k.bar('glace', [a[0], F + .2, a[1]], [b[0], F + .2, b[1]], .05, .05, ALL);
      if (H <= 1.4) continue;
      const near = segHits(a, b, p.hang, 1);
      for (let t = 0; t < nT; t++){
        if (near && yT[t + 1] > clearY) break;               // (a brace never crosses what hangs)
        if (t) k.bar('glace', [a[0], yT[t], a[1]], [b[0], yT[t], b[1]], .045, .045, ALL);
        k.bar('glace', [a[0], yT[t], a[1]], [b[0], yT[t + 1], b[1]], GDIM.LACE, GDIM.LACE);
        k.bar('glace', [b[0], yT[t], b[1]], [a[0], yT[t + 1], a[1]], GDIM.LACE, GDIM.LACE);
      }
    }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [u, v] of feet){ u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    k.forms.tape(u0 - .75, u1 + .75, v0 - .75, v1 + .75, F, p.color, p.pulse, .09);
    access(p, p.top, p.access, false);
  }

  /* MID: a graphite deck on slim legs, X-braced in light, behind a glass balustrade */
  function mid(p){
    const D = deckDepth(p);
    deck(p, p.top, D, p.color, p.pulse);
    legs(p, p.top - D);
    const [s, g0, g1] = gapOf(p.access); rails(p, p.top, s, g0, g1);
    access(p, p.top, p.access, false);
  }
  /* HIGH: the lattice tower */
  function high(p){
    const D = deckDepth(p);
    deck(p, p.top, D, p.color, p.pulse);
    trussFrame(p, p.top - D, landings(p, F));
    const [s, g0, g1] = gapOf(p.access); rails(p, p.top, s, g0, g1);
    access(p, p.top, p.access, false);
  }
  /* LOFT: a smoked-glass deck in a graphite frame (joists seen through it) over the band's structure;
     each member's light along its stretch of the fascia (+ the kit's tape round its spot) */
  function loft(L, members){
    const T = L.top, D = deckDepth(L), yB = T - D, hw = L.hw, hd = L.hd, FR = .24;
    if (L.band === 'low'){
      // a low loft is a riser: one graphite slab from the floor (the glass would only show its own base)
      k.box('deck', -hw, hw, F - .04, T, -hd, hd, NOBOT);
      rim(k, 'gline', -hw, hw, -hd, hd, T, GDIM.NOSE, L.access?.kind === 'stair' ? L.access.side : null);
    } else {
      // the glass deck (its full depth: a machine that dips into it dips into glass) in a graphite frame,
      // its joists under the glass — seen through it from the floor and from the deck
      const yJ = yB - JOIST;
      k.box('gglass', -hw + FR, hw - FR, yB, T - .004, -hd + FR, hd - FR, ALL);
      for (const [u0, u1, v0, v1] of [[-hw, hw, -hd, -hd + FR], [-hw, hw, hd - FR, hd], [-hw, -hw + FR, -hd + FR, hd - FR], [hw - FR, hw, -hd + FR, hd - FR]])
        k.box('deck', u0, u1, yJ, T, v0, v1, ALL);                                                       // the frame
      const nJ = Math.max(1, Math.round(2 * hw / 3.2));
      for (let j = 1; j < nJ; j++){ const u = -hw + 2 * hw * j / nJ; k.box('deck', u - .07, u + .07, yJ, yB, -hd + FR, hd - FR, PY | NY | PX | NX); }
      rim(k, 'gline', -hw, hw, -hd, hd, T);
      if (L.band === 'mid') legs(L, yJ);
      else trussFrame(L, yJ, landings(L, F));
    }
    if (railed(L.band)){ const [s, g0, g1] = gapOf(L.access); rails(L, T, s, g0, g1); }
    access(L, T, L.access, L.band === 'low');
    // each member's light: its stretch of the frame's fascia (front + back, the ends it reaches)
    for (const m of members){
      if (k.ownEdge.has(m.key)) continue;
      let mu0 = Infinity, mu1 = -Infinity;
      const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){ const x = m.x + c * a * m.hw + s * b * m.hd - L.x; mu0 = Math.min(mu0, x); mu1 = Math.max(mu1, x); }
      mu0 = Math.max(-hw, mu0); mu1 = Math.min(hw, mu1);
      const o = .02, y0 = (L.band === 'low' ? T - .2 : yB - JOIST + .05), y1 = y0 + .085;
      k.edge(mu0, mu1, y0, y1, hd - .01, hd + o, m.color, m.pulse, PY | PZ);
      k.edge(mu0, mu1, y0, y1, -hd - o, -hd + .01, m.color, m.pulse, PY | NZ);
      if (mu0 <= -hw + .01) k.edge(-hw - o, -hw + .01, y0, y1, -hd, hd, m.color, m.pulse, PY | NX);
      if (mu1 >= hw - .01) k.edge(hw - .01, hw + o, y0, y1, -hd, hd, m.color, m.pulse, PY | PX);
    }
  }
  return { flush, low, mid, high, open, loft };
}

/* THE STYLE. One per built Greybox (its materials are the room's: style.dispose()). `known(list)`:
   the anchors the room was last placed on (rooms/index.js places a room before it builds its
   footing) — a riser's tiers step in only as far as the pad's MARGIN round its machine; unknown → 0. */
export function gridFootStyle(){
  let made = null, anchors = new Map();
  const shared = new THREE.Group(); shared.name = 'footing:grid';          // (what every hook returns: one empty child)
  const marginOf = p => {
    const a = anchors.get(p.key);
    if (!a || !(a.w > 0) || !(a.d > 0)) return 0;
    return Math.max(0, Math.min(FOOT.MARGIN, p.hw - a.w / 2, p.hd - a.d / 2));
  };
  const cache = new WeakMap();                                             // kit → its forms (one build)
  const forms = k => { let f = cache.get(k); if (!f){ f = makeForms(k, marginOf); cache.set(k, f); } return f; };
  const hook = name => (spec, k) => {
    const f = forms(k);
    if (name !== 'loft' && spec.open){ f.open(spec); return shared; }   // (an open stand arrives under its band's hook)
    if (name === 'loft') f.loft(spec, k.plan.pads.filter(p => p.loft === spec.id));
    else f[name](spec);
    return shared;
  };
  return {
    key: 'grid',
    known(list){ anchors = new Map((list || []).filter(a => a && a.key).map(a => [a.key, a])); },
    mats(kit, ctx = {}){
      if (made) return made;
      const env = ctx.envMap ?? null;
      const body = new THREE.MeshStandardMaterial({ color: 0x4c5568, roughness: .44, metalness: .32, envMap: env, envMapIntensity: .55 });
      gridPatch(body, { key: 'foot-body', minorW: .03, majorW: .07, minorAlb: 0x5a6a90, majorAlb: 0x7fa4e0, minorEmi: [LINE, .05], majorEmi: [LINE, .22] });
      const glass = new THREE.MeshStandardMaterial({ color: 0x1e2c44, roughness: .1, metalness: .5, envMap: env, envMapIntensity: 1.1,
        transparent: true, opacity: .52, depthWrite: true });
      gridPatch(glass, { key: 'foot-glass', minorW: .03, majorW: .07, minorAlb: 0x3a5585, majorAlb: 0x7fa4e0, minorEmi: [LINE, .06], majorEmi: [LINE, .25] });
      made = {
        deck: body, gglass: glass,
        gline: new THREE.MeshBasicMaterial({ color: new THREE.Color(LINE).multiplyScalar(1.9) }),
        glace: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6e9cff).multiplyScalar(.58) }),
      };
      return made;
    },
    flush: hook('flush'), low: hook('low'), mid: hook('mid'), high: hook('high'), loft: hook('loft'),
    dispose(){ if (made) for (const m of Object.values(made)) m.dispose(); made = null; },
  };
}
