import { FOOT, footingBoxes, toWorld, railed } from './footing.js';
import { makePulse } from './pulse.js';
/* ============================================================
   STARSHIP DECK — the pure half of the Starship's answer to its machines. PURE (no THREE, no DOM):
   test/room-starship.test.js.

   SHIP: the deck hardware's dimensions, shared by the footing forms (starship-footing.js draws them)
   and the lamps that live in them (laid out here) — so a running light always sits in the channel
   the form left for it.

   makeDeckLights(plan) → { write(t, S, B) }: every machine's lights at songTime t, into the lamp
   material's uniforms (per pulse slot: S = its chase, B = its beacon) — no allocation, scrub-exact.
   makeStrikeClock(cue, { P, start }) → { read(t, out, o) }: where the machine's strikes are at
   songTime t — the seconds since its latest two strikes (+ their weights) and until its next one.
   The RUNNING LIGHTS race round a machine's deck plate from each strike (a chase whose phase IS the
   seconds since that strike); the STATUS BEACON reads the gap to the next one (a cue light before an
   entrance). A pure fn of songTime like rooms/pulse.js: the loop wraps honestly, nothing happened
   before `start` (ARM_AT — the count-in is dark), no allocation per call.

   lampLayout(plan) → the lamps (rooms/footing.js plan): per pad a ring of running lights in its
   deck plate's light channel (a loft member: its stretch of the catwalk's fascia; an open stand:
   deck lights on the floor round its feet), one status beacon per machine (a lens in the plate's
   front, or a lamp on a rail post), the catwalks' own dim strip. All inside the plan's envelopes.

   deckProps(anchors, plan, spots) → which deck furniture stands: every prop keeps CLEAR (≥ 1 u) of
   every machine's footprint (hung ones too) and of everything the machines stand on — pads, lofts,
   stairs and ladders (footingBoxes) — deterministically, a pure fn of anchors + plan.
   1 u ≈ .677 m.
   ============================================================ */

export const SHIP = {
  LIP: .035,                // the steel angle round a plate's / deck's top edge
  CH0: .13, CH1: .045,      // a raised deck's light channel: from T − CH0 to T − CH1 (the lamps' slot)
  FCH0: .14, FCH1: .05,     // a deck plate's (flush) channel
  KCH0: .095, KCH1: .03,    // the belt's kerb channel (it is FOOT.KERB tall)
  INSET: .015,              // the channel's face, in from the pad's edge (the lamps sit .005 proud of it)
  BORDER: .24,              // a deck plate's hazard border (on top, round the machine)
  LAMP: .17, GAP: .4,       // a running light's length · the pitch between lamps
  BEACON: .26,              // a lens beacon's length (in a kerb's / a fascia's front); a post beacon's size is .16
  POST: .16,
  EDGE: .045,               // a deck plate's steel edge strip (on top, outside its hazard border)
  POCKET: .3,               // a low dais's beacon pocket (a plate's is its border's corner square)
  FLOOR_IN: .75,            // an open stand's deck lights: this far round its feet
  CLEAR: 1,                 // props keep this clear of machines + their footing
};
const NONE = 1e4;            // "no strike": an age / a wait no light ever reaches

/* ---------------- the strike clock ---------------- */
export function makeStrikeClock(cue, { P, start = -Infinity } = {}){
  const n = Array.isArray(cue) ? cue.length : 0;
  if (!n || !(P > 0)) return { n: 0, read(t, out, o = 0){ out[o] = NONE; out[o + 1] = 0; out[o + 2] = NONE; out[o + 3] = 0; out[o + 4] = NONE; out[o + 5] = 0; } };
  const ev = cue.map(c => ({ t: (((+c.t || 0) % P) + P) % P, w: Math.max(0, Math.min(1, c.w ?? 1)) })).sort((a, b) => a.t - b.t);
  const T = new Float64Array(n), W = new Float64Array(n);
  ev.forEach((e, i) => { T[i] = e.t; W[i] = e.w; });
  const upto = x => { let lo = 0, hi = n; while (lo < hi){ const m = (lo + hi) >> 1; if (T[m] <= x) lo = m + 1; else hi = m; } return lo - 1; };
  return {
    n,
    /* out[o..o+5] = age1, w1, age2, w2 (the latest two strikes at or before t, newest first), eta, wNext */
    read(t, out, o = 0){
      const tau = ((t % P) + P) % P, base = t - tau;
      let i = upto(tau), off = 0;
      if (i < 0){ i = n - 1; off = -P; }
      const s1 = base + off + T[i];
      if (s1 < start){ out[o] = NONE; out[o + 1] = 0; out[o + 2] = NONE; out[o + 3] = 0; }
      else {
        out[o] = t - s1; out[o + 1] = W[i];
        let j = i - 1, off2 = off;                            // (the one before: a lone strike's is itself, a loop ago)
        if (j < 0){ j = n - 1; off2 -= P; }
        const s2 = base + off2 + T[j];
        if (s2 < start){ out[o + 2] = NONE; out[o + 3] = 0; } else { out[o + 2] = t - s2; out[o + 3] = W[j]; }
      }
      // the next strike that happens (at or after start)
      const q = start > t ? start - 1e-9 : t;
      const tq = ((q % P) + P) % P, bq = q - tq;
      let j = upto(tq) + 1, jo = 0;
      if (j >= n){ j = 0; jo = P; }
      out[o + 4] = bq + jo + T[j] - t; out[o + 5] = W[j];
    },
  };
}

/* the status beacon's CUE light: ONE soft rise (no blinking — a section re-entering together must never
   strobe in phase) over the last CUE.T before a machine comes back in after a rest (≥ REST since its last
   strike), 1 exactly at the entrance — a pure fn of (age, eta, t). A FIRST entrance (no strike yet: age is
   NONE) cues only when its whole rise lies after songTime 0: the count-in stays dark, whatever the song */
export const CUE = { REST: 2.4, T: 1.6 };
export function cueLight(age, eta, t = Infinity){
  if (!(age >= CUE.REST) || !(eta < CUE.T) || eta < 0) return 0;
  if (age >= NONE && t + eta - CUE.T < 0) return 0;
  const ramp = 1 - eta / CUE.T;
  return ramp * ramp;
}

/* every machine's lights at songTime t (per plan pulse slot i, into vec4 uniforms): S[4i..] = the
   chase (age1, w1, age2, w2: the latest two strikes), B[4i..] = the beacon (x: its afterglow — slow,
   so a machine that is playing reads as ON; y: the cue light before an entrance after a rest) */
export const BEACON = { decay: 1.4 };
export function makeDeckLights(plan){
  const slots = plan?.pulses || [];
  const clocks = slots.map(s => makeStrikeClock(s.cue, { P: s.P, start: s.start }));
  const glows = slots.map(s => makePulse(s.cue, { P: s.P, start: s.start, decay: BEACON.decay }));
  const r = new Float64Array(6);
  return {
    n: slots.length,
    write(t, S, B){
      for (let i = 0; i < clocks.length; i++){
        clocks[i].read(t, r, 0);
        const o = 4 * i;
        S[o] = r[0]; S[o + 1] = r[1]; S[o + 2] = r[2]; S[o + 3] = r[3];
        B[o] = glows[i].at(t); B[o + 1] = cueLight(r[0], r[4], t); B[o + 2] = 0; B[o + 3] = 0;
      }
    },
  };
}

/* ---------------- the lamps (pure layout from the footing plan) ---------------- */
/* a pad's light channel (world y): where its running lights sit — the same rule the forms follow */
export function channelOf(p, floor){
  if (p.fixed) return [floor + FOOT.KERB - SHIP.KCH0, floor + FOOT.KERB - SHIP.KCH1];
  if (p.band === 'flush') return [p.top - SHIP.FCH0, p.top - SHIP.FCH1];
  return [p.top - SHIP.CH0, p.top - SHIP.CH1];
}
/* the STATUS BEACON's pocket in a deck's top (a flush plate's front-left corner square, inside its hazard
   border — where the other corners carry tie-down rings; a low dais's front-left corner): local centre
   (u, v), half size, how deep. null: the pad's beacon stands elsewhere (a rail post, the kerb's face, the
   floor round an open stand). The form cuts the pocket (starship-footing.js), the lamp lies in it. */
export function beaconPocket(p){
  if (!p || p.fixed || p.open || p.loft) return null;
  if (p.band === 'flush'){
    const b = Math.min(SHIP.BORDER, Math.min(p.hw, p.hd) * .3), e = SHIP.EDGE;
    return { u: -(p.hw - e - b / 2), v: p.hd - e - b / 2, half: b / 2, depth: .05 };
  }
  if (p.band === 'low') return { u: -(p.hw - .05 - SHIP.POCKET / 2), v: p.hd - .05 - SHIP.POCKET / 2, half: SHIP.POCKET / 2, depth: .05 };
  return null;
}
/* every lamp: { kind: 0 run | 1 beacon | 2 strip, slot, c: [x, y, z] centre, n: [x, y, z] facing,
   t: [x, z] along (level), hl, hh (half length / height), d, half (the chase: path distance from the
   front-centre · half the path), color, cube (a beacon on a post: a small lamp, all round) } */
export function lampLayout(plan){
  const out = [], F = plan.floor;
  const lofts = new Map((plan.lofts || []).map(L => [L.id, L]));
  for (const p of plan.pads || []){
    if (p.loft) continue;                                   // (a member: its loft lights it, below)
    const col = p.color ?? null, slot = p.pulse;
    if (p.open){ openLamps(out, p, F, col, slot); continue; }
    const [y0, y1] = channelOf(p, F);
    ringLamps(out, p, y0, y1, col, slot);
    // the status beacon: a lens lying in its pocket in the deck's top (a plate, a dais: seen from every
    // shot that sees the deck); a lamp on the front-left rail post of a railed deck (inside its envelope:
    // the rails' height); a lens in the belt kerb's face
    const bp = beaconPocket(p);
    if (bp) push(out, 1, slot, p, bp.u, bp.v, p.top - bp.depth + .028, null, [1, 0], bp.half - .03, bp.half - .03, 0, 1, col);
    else if (railed(p.band) && !p.fixed) postBeacon(out, p, p.hw - .1, p.hd - .1, p.top + FOOT.RAIL, col, slot);
    else lensBeacon(out, p, (y0 + y1) / 2, (y1 - y0) / 2, col, slot);
  }
  for (const L of plan.lofts || []){
    const members = (plan.pads || []).filter(p => p.loft === L.id).sort((a, b) => a.x - b.x);
    const [y0, y1] = channelOf({ band: L.band, top: L.top }, F), yc = (y0 + y1) / 2, hh = (y1 - y0) / 2 - .008;
    const spans = [];
    for (const m of members){
      let u0 = Infinity, u1 = -Infinity;
      const c = Math.cos(m.yaw || 0), s = Math.sin(m.yaw || 0);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){ const x = m.x + c * a * m.hw + s * b * m.hd - L.x; u0 = Math.min(u0, x); u1 = Math.max(u1, x); }
      u0 = Math.max(-L.hw, u0); u1 = Math.min(L.hw, u1);
      spans.push([u0, u1]);
      // its running lights: its stretch of the catwalk's fascia, front and back, racing out from its middle
      for (const side of [1, -1]) runLamps(out, L, u0, u1, side * (L.hd - SHIP.INSET + .005), side, yc, hh, m.color ?? null, m.pulse);
      if (railed(L.band)) postBeacon(out, { x: L.x, z: L.z, yaw: 0 }, null, null, L.top + FOOT.RAIL, m.color ?? null, m.pulse, [Math.max(-L.hw + .1, u0 + .35), L.hd - .1]);
      else lensBeacon(out, { x: L.x, z: L.z, yaw: 0, hw: L.hw, hd: L.hd }, yc, hh, m.color ?? null, m.pulse, u0 + .45);
    }
    // the catwalk's own dim strip wherever no member stands (the ship's light strips): its ends, the gaps
    const free = gaps(-L.hw, L.hw, spans.sort((a, b) => a[0] - b[0]), .25);
    for (const [u0, u1] of free) for (const side of [1, -1]) stripRun(out, L, u0, u1, side * (L.hd - SHIP.INSET + .005), side, yc, hh);
    for (const side of [1, -1]) stripEnd(out, L, side, yc, hh);
  }
  return out;
}
/* the uncovered stretches of [a, b] (spans sorted) */
function gaps(a, b, spans, pad){
  const out = []; let x = a;
  for (const [u0, u1] of spans){ if (u0 - pad > x + .3) out.push([x, u0 - pad]); x = Math.max(x, u1 + pad); }
  if (b > x + .3) out.push([x, b]);
  return out;
}
/* lamps round a rect's channel: the path starts at the FRONT-centre (+v) and runs both ways to the back */
function ringLamps(out, p, y0, y1, col, slot){
  const hw = p.hw - SHIP.INSET + .005, hd = p.hd - SHIP.INSET + .005, yc = (y0 + y1) / 2, hh = (y1 - y0) / 2 - .008;
  const per = 4 * (p.hw + p.hd), half = per / 2;
  // the four sides: (start [u, v], end [u, v], outward local normal, path coordinate at start)
  const sides = [
    [[-p.hw, hd], [p.hw, hd], [0, 1]], [[hw, p.hd], [hw, -p.hd], [1, 0]],
    [[p.hw, -hd], [-p.hw, -hd], [0, -1]], [[-hw, -p.hd], [-hw, p.hd], [-1, 0]],
  ];
  // the ring's path coordinate of a local point on the perimeter (from the front-centre, going +u first)
  const pathC = (u, v) => {
    if (v >= p.hd - 1e-6) return u >= 0 ? u : per + u;                        // front
    if (u >= p.hw - 1e-6) return p.hw + (p.hd - v);                           // right
    if (v <= -p.hd + 1e-6) return p.hw + 2 * p.hd + (p.hw - u);               // back
    return 3 * p.hw + 2 * p.hd + (v + p.hd);                                  // left
  };
  for (const [a, b, n] of sides){
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.floor((L - .2) / SHIP.GAP));
    const tu = (b[0] - a[0]) / L, tv = (b[1] - a[1]) / L, step = (L - .2) / k;
    for (let i = 0; i <= k; i++){
      const s = .1 + i * step, u = a[0] + tu * s, v = a[1] + tv * s;
      // (the corner lamps of the two sides would overlap: skip a lamp within .15 of a corner)
      if (s < .14 || s > L - .14) continue;
      const pu = n[0] ? Math.sign(n[0]) * p.hw : u, pv = n[1] ? Math.sign(n[1]) * p.hd : v;
      const c = pathC(pu, pv), d = Math.min(c, per - c);
      push(out, 0, slot, p, u, v, yc, n, [tu, tv], Math.min(SHIP.LAMP / 2, step / 2 - .03), hh, d, half, col);
    }
  }
}
/* lamps along one face of an axis-aligned rect (a loft): u0..u1 at local v, facing ±v, racing out from the middle */
function runLamps(out, L, u0, u1, v, side, yc, hh, col, slot){
  const len = u1 - u0; if (len < .4) return;
  const k = Math.max(1, Math.floor((len - .2) / SHIP.GAP)), step = (len - .2) / k, mid = (u0 + u1) / 2, half = len / 2;
  for (let i = 0; i <= k; i++){
    const u = u0 + .1 + i * step;
    push(out, 0, slot, L, u, v, yc, [0, side], [1, 0], Math.min(SHIP.LAMP / 2, step / 2 - .03), hh, Math.abs(u - mid), half, col);
  }
}
/* the catwalk's own strip: one long dim light (kind 2) */
function stripRun(out, L, u0, u1, v, side, yc, hh){
  push(out, 2, -1, L, (u0 + u1) / 2, v, yc, [0, side], [1, 0], (u1 - u0) / 2, hh * .55, 0, 1, null);
}
function stripEnd(out, L, side, yc, hh){
  const u = side * (L.hw - SHIP.INSET + .005);
  push(out, 2, -1, L, u, 0, yc, [side, 0], [0, -side], L.hd - .1, hh * .55, 0, 1, null);
}
/* a lens beacon set into a plate's / dais's front face (+v), near its left end */
function lensBeacon(out, p, yc, hh, col, slot, uAt = null){
  const u = uAt ?? (-p.hw + Math.min(.55, p.hw * .3));
  push(out, 1, slot, p, u, p.hd - SHIP.INSET + .006, yc, [0, 1], [1, 0], SHIP.BEACON / 2, hh + .004, 0, 1, col);
}
/* a beacon lamp on a rail post: a small cube of light just under the post's head */
function postBeacon(out, p, hu, hv, yTop, col, slot, uv = null){
  const [u, v] = uv ?? [-hu, hv], s = SHIP.POST / 2;
  push(out, 1, slot, p, u, v, yTop - s - .012, [0, 1], [1, 0], s, s, 0, 1, col, true);
}
/* an open stand: deck lights on the floor round its feet (+ FLOOR_IN), inside its pad */
function openLamps(out, p, F, col, slot){
  const feet = p.feet?.length ? p.feet : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * (p.hw - .6), b * (p.hd - .6)]);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of feet){ u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const lim = (x, h) => Math.max(-h + .12, Math.min(h - .12, x));
  u0 = lim(u0 - SHIP.FLOOR_IN, p.hw); u1 = lim(u1 + SHIP.FLOOR_IN, p.hw); v0 = lim(v0 - SHIP.FLOOR_IN, p.hd); v1 = lim(v1 + SHIP.FLOOR_IN, p.hd);
  const R = { x: p.x, z: p.z, yaw: p.yaw, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2 };
  const [cx, cz] = toWorld(p, (u0 + u1) / 2, (v0 + v1) / 2);
  const Q = { ...R, x: cx, z: cz };
  // a floor ring (lamps lying flat, facing up), the same front-centre chase
  const per = 4 * (R.hw + R.hd), half = per / 2, y = F + .012;
  const sides = [[[-R.hw, R.hd], [R.hw, R.hd]], [[R.hw, R.hd], [R.hw, -R.hd]], [[R.hw, -R.hd], [-R.hw, -R.hd]], [[-R.hw, -R.hd], [-R.hw, R.hd]]];
  const cs = [-R.hw, R.hw, R.hw + 2 * R.hd, 3 * R.hw + 2 * R.hd];   // path coordinate at each side's start (from the front-centre, +u first)
  for (let si = 0; si < 4; si++){
    const [a, b] = sides[si], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.floor((L - .2) / SHIP.GAP));
    const tu = (b[0] - a[0]) / L, tv = (b[1] - a[1]) / L, step = (L - .2) / k;
    for (let i = 0; i <= k; i++){
      const s = .1 + i * step; if (s < .14 || s > L - .14) continue;
      const cc = (((cs[si] + s) % per) + per) % per, d = Math.min(cc, per - cc);
      push(out, 0, slot, Q, a[0] + tu * s, a[1] + tv * s, y, null, [tu, tv], Math.min(SHIP.LAMP / 2, step / 2 - .03), .045, d, half, col);
    }
  }
  // its beacon: a floor lens at the front-left corner
  push(out, 1, slot, Q, -R.hw + .3, R.hd - .3, y + .001, null, [1, 0], .16, .16, 0, 1, col);
}
/* one lamp, from a rect's local frame (u, v) — n: the local outward normal [nu, nv] (null: facing up),
   t: the local along-direction [tu, tv] */
function push(out, kind, slot, R, u, v, y, n, t, hl, hh, d, half, color, cube = false){
  // (local → world inline: toWorld's turn, for the point and the two directions — ~1k lamps a full deck)
  const c = Math.cos(R.yaw || 0), s = Math.sin(R.yaw || 0);
  out.push({ kind, slot, c: [R.x + c * u + s * v, y, R.z - s * u + c * v], n: n ? [c * n[0] + s * n[1], 0, -s * n[0] + c * n[1]] : [0, 1, 0],
    t: [c * t[0] + s * t[1], -s * t[0] + c * t[1]], hl, hh, d, half, color, cube });
}

/* ---------------- the deck furniture ---------------- */
/* where it may stand (fixed, pure): HATCHES let into the deck plates across the stage — on the 4 u plate
   grid's centres (x, z ≡ 2 mod 4: between the deck's seams and its inlaid light strips), a seeded scatter
   kept ≥ 8 u apart — and CARGO lashed in the side bays, outboard of the stage (|x| > STAGE.HW = 38: never
   in a machine's way, never in a shot's: the eyes stay inside ±36.5), stacked one or two high. Each spot is a
   turned rect { x, z, yaw, hw, hd } + its height h and (cargo) the y it stands on. */
export const DECK_PROPS = { HATCH: 1.7, HATCH_GAP: 8, BAY_X: 42.2, CRATE: [1.2, 1.8, 2.4] };
export function deckSpots(){
  let s = 4242 >>> 0;
  const R = () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hatches = [], H = DECK_PROPS.HATCH;
  for (let x = -34; x <= 34; x += 4) for (let z = -30; z <= 38; z += 4){
    const r = R(), turn = R();
    if (r > .15) continue;
    if (hatches.some(h => Math.hypot(h.x - x, h.z - z) < DECK_PROPS.HATCH_GAP)) continue;
    hatches.push({ kind: 'hatch', x, z, yaw: (turn * 4 | 0) * Math.PI / 2, hw: H, hd: H, h: .03, y: 0 });
  }
  const [cw, cd, ch] = DECK_PROPS.CRATE, cargo = [];
  // (z, how many in the row, which of them carry a second crate) — starboard and port, not mirror images
  const rows = { 1: [[-27, 2, [0]], [-6, 3, [1]], [17, 2, []]], [-1]: [[-20, 2, [1]], [3, 2, []], [21, 3, [0, 2]]] };
  for (const sx of [1, -1]) for (const [z0, n, up] of rows[sx]) for (let i = 0; i < n; i++){
    const z = z0 + (i - (n - 1) / 2) * (2 * cd + .25), x = sx * (DECK_PROPS.BAY_X + (i % 2 ? .18 : -.1)), yaw = (i % 2 ? .04 : -.03) * sx;
    cargo.push({ kind: 'crate', x, z, yaw, hw: cw, hd: cd, h: ch, y: 0 });
    if (up.includes(i)) cargo.push({ kind: 'crate', x: x - sx * .1, z: z + .15, yaw: yaw + Math.PI / 2 + .05 * sx, hw: cw, hd: cd, h: ch, y: ch });
  }
  return { hatches, cargo };
}

/* ---------------- the deck furniture's clearance ---------------- */
/* a prop spot: { kind, x, z, yaw, hw, hd, h } (h: its height over the deck). Visible iff it keeps CLEAR of
   every machine's turned footprint (hung ones too) and every footing envelope (pads, lofts, stairs /
   ladders) — and, for the props that stand in the machines' zone, of each other's hidden twins: none */
export function deckProps(anchors = [], plan = null, spots = [], clear = SHIP.CLEAR){
  const rects = [];
  for (const a of anchors || []) if (a && a.w > 0 && a.d > 0 && Number.isFinite(a.x) && Number.isFinite(a.z))
    rects.push({ x: a.x, z: a.z, yaw: a.yaw || 0, hw: a.w / 2, hd: a.d / 2 });
  if (plan) for (const e of footingBoxes(plan)){ const b = e.box; rects.push({ x: (b[0] + b[1]) / 2, z: (b[4] + b[5]) / 2, yaw: 0, hw: (b[1] - b[0]) / 2, hd: (b[5] - b[4]) / 2 }); }
  return spots.map(sp => !rects.some(r => rectsWithin(sp, r, clear)));
}
/* do two turned rects come within `gap` of each other? (separating axes on the rects grown by gap / 2) */
export function rectsWithin(A, B, gap = 0){
  const pa = corners(A, gap / 2), pb = corners(B, gap / 2);
  for (const P of [pa, pb]) for (let i = 0; i < 2; i++){
    const ax = P[i + 1][0] - P[i][0], az = P[i + 1][1] - P[i][1];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of pa){ const d = q[0] * ax + q[1] * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const q of pb){ const d = q[0] * ax + q[1] * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
function corners(r, pad){
  const hw = r.hw + pad, hd = r.hd + pad;
  return [toWorld(r, -hw, -hd), toWorld(r, hw, -hd), toWorld(r, hw, hd), toWorld(r, -hw, hd)];
}
