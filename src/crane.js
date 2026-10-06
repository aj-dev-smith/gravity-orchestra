/* ============================================================
   MAGNET CRANE — CRANE HOPS (pure math, no THREE scene, unit-tested
   in test/crane.test.js).

   The belt's grammar is apex ∝ dt²: a level hop of dt seconds peaks at
   |G|·dt²/8. That is the rhythm made visible — and it is also what blew
   the paternoster up on MIDI imports: one 8-beat note is a 30-unit lob,
   the marble leaves the machine and the layout's x step (∝ dt) stretches
   the bay across the room. The fix is the room's magnet pattern (the
   drums' DT_MAX, generalised):

     • A gap whose free arc fits the OPEN RUN under the top housing
       (dt ≤ dtFree(g), apex ≤ H_FREE) is flown as its free solved arc —
       untouched, the belt's rhythm grammar stays.
     • A longer gap is a CRANE HOP: the pad lobs the marble STRAIGHT UP to
       the voice's electromagnet, arriving at the apex with v = 0 (it docks
       — the clack); the carriage carries it to hang over the NEXT pad, holds,
       and releases so the free fall lands on that pad exactly on the beat:
       release = strike − √(2h/g). The loop seam (last pad → pad 0 of the
       next loop, the conserved marble) is simply the loop's last hop.

   Why H_FREE = 5.25 (dtFree ≈ 1.70 s): a catch/release magnet must hang ENTIRELY
   below the top housing's lip (band + 7.0) at any depth — face (h + r + UPY) + the
   magnet body (.58) ≤ 7.0 ⇒ h ≤ 5.78 for the bass marble (r .36); HOLD_H = 5.6. The
   free arcs stay just under that (H_FREE = HOLD_H − .35), so "longer note = higher"
   still reads across the free → hop boundary for a full-height hop, and no free arc
   ever leaves the open run.

   THE LANE: a loaded magnet does its travelling ABOVE the lip, in front of the
   housing (z ≥ Z_SAFE) — the plates are stowed behind the skirt up there, so nothing
   can be in its way: dock → step forward → winch up past the lip → along the lane →
   (wait) → down over the next pad → step back → a still hang → release. Hops too
   short for that fly a DIRECT carry below the lip. The plan tries heights high → low
   and lane → direct, and keeps the first choreography that (a) fits the gap and (b)
   never passes the marble through one of the voice's own tone-plates (plateField:
   every plate on its belt, unfolding and stowing — the pads keep moving while the
   crane works).

   One crane per voice, and it carries one marble — its own. Between hops it RETURNS
   empty: up into the housing, along the rail, out and down (the PARK route) when
   there's time; otherwise over the lane; back-to-back hops on one pad are a YO-YO (only
   the winch moves: up early while the marble falls away, down late while it rises
   below). Every crane move is a smootherstep whose peak speed and acceleration stay
   under V_MAX / A_MAX — never a teleport. If a song is too dense for the crane the plan
   says so in `warnings` (the tests hold the catalog to zero).

   Heights are measured from the CONTACT level (the marble's centre at a
   strike, band + UP) in a track's local band frame; x/z are the pads' local
   x/z. Magnet positions are the magnet FACE (the point the marble's top
   touches), so a docked ball centre = face − r.

   Time is the only state: everything here is a pure fn of songTime; lookups
   are binary searches (O(log n) per frame).
   ============================================================ */

import { DESCENT, beltPhase, deployPose } from './engine.js';

export const CRANE = {
  HOLD_H:   5.6,   // highest catch / release (ball centre over contact) — the magnet hangs fully below the lip
  H_FREE:   5.25,  // highest free-arc apex (→ dtFree) — just under the hop height, inside the open run
  H_MIN:    1.4,   // lowest catch the winch goes down to (squeezed hops just above dtFree)
  LIP_C:    6.74,  // the top housing's lip over the contact level (paternoster PT.LIP − UPY)
  LANE_CLEAR: .1,  // the LANE: a loaded marble rides ABOVE the lip, in front of the housing (no plates there)
  PARK_H:   8.04,  // magnet FACE when parked inside the top housing (behind its window)
  PARK_Z:  -1.05,  // the rail depth (inside the housing)
  Z_SAFE:  -.1,    // the magnet crosses the lip only in front of the skirt (FRONT −.6 + its radius)
  DOCK:     .18,   // dwell after the clack before the carry starts …
  DOCK_MIN: .08,   // … squeezed
  MIN_HOLD: .2,    // it hangs still over the landing pad this long before a release …
  HOLD_MIN: .1,    // … squeezed
  POST:     .3,    // the empty magnet stays put this long after a release (recoil + discharge) …
  POST_MIN: .1,
  LEAD:     .12,   // … and is in place this long before the marble rises into it
  LEAD_MIN: .05,
  V_NOM:    6,     // nominal carry speed (u/s)
  V_MAX:    25,    // carriage speed limit (peak)
  A_MAX:    90,    // carriage acceleration limit (peak)
  MAG_H:    .58,   // magnet body height above its face (paternoster's magnet geometry)
  STRIKE_C: .08,   // a plate within this many seconds of its own strike is IN contact, by design
};

/* The longest gap flown as a free arc (its apex is exactly H_FREE). */
export const dtFree = (g, o = CRANE) => Math.sqrt(8 * o.H_FREE / g);
/* layoutPads options for a crane-hopping voice: a hop's x step no longer grows with dt
   (the magnet carries it), and the weave folds back early past ±X_MAX so a long import
   can't wander off across the room (the hand-authored catalog stays inside ±13 already). */
export const X_MAX = 13;
export const hopLayout = g => ({ hopOver: dtFree(g), xMax: X_MAX });

const ease  = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10);   // smootherstep
const dease = u => u <= 0 || u >= 1 ? 0 : 30 * u * u * (u - 1) * (u - 1);
export const EV = 1.875, EA = 5.7735;                  // smootherstep peak |v|·T/D and peak |a|·T²/D
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const pt = (x, y, z) => ({ x, y, z });
const sum = segs => segs.reduce((q, w) => q + w.dur, 0);
/* least time a smootherstep move of length D may take under the carriage limits */
export const minMoveT = (D, o = CRANE) => D < 1e-9 ? 0 : Math.max(EV * D / o.V_MAX, Math.sqrt(EA * D / o.A_MAX));

/* The voice's TONE-PLATES as obstacles: clear(τ, x, y, z, r) is true when no plate of the
   voice (riding its belt — beltPhase — and unfolding/stowing — deployPose) overlaps a ball
   of radius r at that point (contact-level band frame). Plate = box of half-extents
   plate·s, telescoped from stowed (flat on the belt at stowZ) to deployed (level, at its
   rest z); the tilt to its catch normal is ignored. O(log n + plates in view). */
export function plateField({ padT, P, plates, plate = { L: 1.1, T: .12, W: .44 }, stowZ = -1.75, inner = 3, cull = 7.65, o = CRANE }){
  const innerC = inner / DESCENT, cullC = Math.min(cull, DESCENT * P * .5 - .5) / DESCENT, n = padT.length;
  return (t, x, y, z, r, margin = 0) => {
    const u = padT[0] + ((t - padT[0]) % P + P) % P;  // ∈ [padT0, padT0 + P)
    for (const m of [-1, 0, 1]){
      const lo = u - cullC - m * P, hi = u + cullC - m * P;
      for (let k = floorIdx(padT, lo - 1e-12) + 1; k < n && padT[k] <= hi; k++){
        const c = beltPhase(t, padT[k], P);
        if (Math.abs(c) > cullC || Math.abs(c) < o.STRIKE_C) continue;
        const q = plates[k], s = q.s, dep = deployPose(c, innerC, cullC);
        const hx = plate.L / 2 * s, hy = (plate.T / 2 + (plate.W - plate.T) / 2 * (1 - dep.tilt)) * s,
              hz = (plate.W / 2 + (plate.T - plate.W) / 2 * (1 - dep.tilt)) * s;
        const pz = stowZ + (q.z - stowZ) * dep.extend, py = DESCENT * c - .38;   // plate centre (belt −.12, contact +.26)
        const dx = Math.max(0, Math.abs(x - q.x) - hx), dy = Math.max(0, Math.abs(y - py) - hy), dz = Math.max(0, Math.abs(z - pz) - hz);
        if (dx * dx + dy * dy + dz * dz < (r + margin) ** 2) return false;
      }
    }
    return true;
  };
}

/* Solve one voice's crane timeline.
     pads:  [{ t, dt, x, z }] — strike offsets (s, from the first strike), gaps, local x/z
     clear: optional plateField(…) — hops are then choreographed AROUND the voice's plates
   Times are in the ball's own clock (τ = songTime − k·P for the ball born at k·P);
   pad i is struck at τ = rollT + t_i. The crane repeats every P. */
export function planCrane({ g, P, rollT, r = .26, pads, clear = null, opt = {} }){
  const o = { ...CRANE, ...opt };
  const n = pads.length, dtF = dtFree(g, o), warnings = [];
  const fallT = h => Math.sqrt(2 * h / g);
  const YL = o.LIP_C + 2 * r + o.LANE_CLEAR;           // lane face height: the loaded marble clears the lip
  const zf = z => Math.max(z, o.Z_SAFE);
  const moves = (pts, nom) => pts.slice(1).map((p, k) => {
    const len = dist(pts[k], p);
    return { p, len, dur: len < 1e-9 ? 0 : Math.max(nom ? nom[k] : 0, minMoveT(len, o)) };
  });
  const HS = [o.HOLD_H, 4.6, 3.6, 2.6, o.H_MIN].filter((h, k, a) => h <= o.HOLD_H && h >= o.H_MIN && a.indexOf(h) === k);
  const pairs = [];
  for (const hc of HS) for (const hr of HS) pairs.push([hc, hr]);
  pairs.sort((p, q) => (q[0] + q[1]) - (p[0] + p[1]) || q[1] - p[1]);

  /* one hop's LOADED choreography, or null if it can't fit the gap.
       lane:   dock → (step forward) → lift above the lip → along the lane → (wait) → down → (step back) → hold → release
       direct: dock → one straight carry to the hold point → hold → release                       */
  function build(i, j, s, land, mode, Hc, Hr, tight){
    const a = pads[i], b = pads[j], Tr = fallT(Hc), Tf = fallT(Hr), C = s + Tr, rel = land - Tf;
    let d = tight ? o.DOCK_MIN : o.DOCK, mh = tight ? o.HOLD_MIN : o.MIN_HOLD;
    const CATCH = pt(a.x, Hc + r, a.z), HOLD = pt(b.x, Hr + r, b.z), D = Math.hypot(b.x - a.x, b.z - a.z);
    let segs, nom, waitAfter, main;                    // main = the carry leg that soaks up spare time
    if (mode === 'lane'){
      nom = [.25, .45, Math.max(.9, D / o.V_NOM), .45, .25];
      segs = moves([CATCH, pt(a.x, Hc + r, zf(a.z)), pt(a.x, YL, zf(a.z)), pt(b.x, YL, zf(b.z)), pt(b.x, Hr + r, zf(b.z)), HOLD], tight ? null : nom);
      waitAfter = 2; main = 2;
    } else {
      nom = [Math.max(.9, D / o.V_NOM)];
      segs = moves([CATCH, HOLD], tight ? null : nom);
      waitAfter = -1; main = 0;
    }
    let slack = (land - s) - (Tr + d + sum(segs) + mh + Tf);
    if (slack < -1e-9) return null;
    if (tight){                                        // a squeezed hop spends what it has: an unhurried
      const grow = (cur, want) => { const add = Math.max(0, Math.min(slack, want - cur)); slack -= add; return cur + add; };
      if (segs[main].len > 1e-9) segs[main].dur = grow(segs[main].dur, nom[main]);   // carry first,
      d = grow(d, o.DOCK); mh = grow(mh, o.MIN_HOLD);  // then the dock dwell and the still hang
    }
    if (waitAfter < 0){ mh += slack; slack = 0; }       // direct: the spare time is the hang over the next pad
    const keys = [[C, CATCH], [C + d, CATCH]];
    let t = C + d;
    segs.forEach((w, k) => { t += w.dur; keys.push([t, w.p]); if (k === waitAfter){ t += slack; keys.push([t, w.p]); } });
    const carryEnd = t;
    keys.push([rel, HOLD]);
    return { i, j, seam: i === n - 1, s, land, gap: land - s, D, mode, tight, hc: Hc, hr: Hr, H: Math.max(Hc, Hr), Tr, Tf, dock: d,
             C, carryStart: C + d, carryEnd, rel, CATCH, HOLD, keys, fits: true };
  }
  /* the marble along a candidate hop (rise → docked keys → fall), sampled against the plates;
     the stretches it spends in the lane (above the lip, in front: no plates) are skipped */
  function clearHop(h){
    if (!clear) return true;
    const st = 1 / 60, ok = (t, x, y, z) => clear(t, x, y, z, r, .03);
    for (let t = h.s; t < h.C; t += st){ const u = t - h.s; if (!ok(t, h.CATCH.x, g * h.Tr * u - .5 * g * u * u, h.CATCH.z)) return false; }
    const K = h.keys;
    for (let k = 0; k + 1 < K.length; k++){
      const [t0, A] = K[k], [t1, B] = K[k + 1];
      if (A.y >= YL - 1e-9 && B.y >= YL - 1e-9) continue;
      for (let t = t0; t < t1; t += st){
        const e = ease((t - t0) / (t1 - t0));
        if (!ok(t, A.x + (B.x - A.x) * e, A.y + (B.y - A.y) * e - r, A.z + (B.z - A.z) * e)) return false;
      }
    }
    for (let t = h.rel; t < h.land - o.STRIKE_C; t += st){ const u = t - h.rel; if (!ok(t, h.HOLD.x, h.hr - .5 * g * u * u, h.HOLD.z)) return false; }
    return true;
  }

  const hopAt = new Array(n).fill(-1), hops = [];
  for (let i = 0; i < n; i++){
    const seam = i === n - 1;
    if (!seam && pads[i].dt <= dtF) continue;          // a free solved arc: the belt's grammar
    const j = seam ? 0 : i + 1;
    const s = rollT + pads[i].t, land = seam ? P + rollT : s + pads[i].dt;
    let best = null, firstFit = null;
    search: for (const [hc, hr] of pairs) for (const mode of ['lane', 'direct']) for (const tight of [false, true]){
      const h = build(i, j, s, land, mode, hc, hr, tight);
      if (!h) continue;
      firstFit ||= h;
      if (clearHop(h)){ best = h; break search; }
    }
    if (!best && firstFit){ best = firstFit; warnings.push(`hop ${i}→${j}: no plate-clear choreography`); }
    if (!best){                                        // squeezed below every discrete height: winch to fit
      const gap = land - s, D = Math.hypot(pads[j].x - pads[i].x, pads[j].z - pads[i].z);
      const Tm = (gap - o.DOCK_MIN - minMoveT(D, o) - o.HOLD_MIN) / 2;
      const H = Math.max(o.H_MIN, .5 * g * Math.max(0, Tm) ** 2);
      best = build(i, j, s, land, 'direct', H, H, true);
      if (!best){
        warnings.push(`hop ${i}→${j}: gap ${gap.toFixed(2)}s too short for the crane`);
        const Tf = fallT(o.H_MIN), C = s + Tf, rel = land - Tf;
        const CATCH = pt(pads[i].x, o.H_MIN + r, pads[i].z), HOLD = pt(pads[j].x, o.H_MIN + r, pads[j].z);
        best = { i, j, seam, s, land, gap, D, mode: 'direct', tight: true, hc: o.H_MIN, hr: o.H_MIN, H: o.H_MIN, Tr: Tf, Tf, dock: 0,
                 C, carryStart: C, carryEnd: Math.max(C, rel), rel: Math.max(C, rel), CATCH, HOLD, fits: false,
                 keys: [[C, CATCH], [Math.max(C, rel), HOLD]] };
      }
    }
    hopAt[i] = hops.length;
    hops.push(best);
  }
  const seamHop = hops[hops.length - 1];
  const rel0 = seamHop.rel - P;                        // the seam release, in the newborn's clock (τ)

  /* ---- the crane's keyframes over one period [rel0, rel0 + P) ---- */
  const key = [[rel0, seamHop.HOLD]];
  const push = (t, p) => key.push([t, p]);
  let prevRel = rel0, prevPt = seamHop.HOLD;
  hops.forEach(h => {
    route(prevRel, prevPt, h.C, h.CATCH, h);
    h.keys.forEach(([t, p]) => push(t, p));
    prevRel = h.rel; prevPt = h.HOLD;
  });

  /* the EMPTY return from a release point A (at t0) to the next catch point B (in place by C − lead) */
  function route(t0, A, C, B, h){
    const za = zf(A.z), zb = zf(B.z);
    // PARK: step out in front of the skirt, up into the housing, along the rail, (wait), out, down, in
    const park = moves([A, pt(A.x, A.y, za), pt(A.x, o.PARK_H, za), pt(A.x, o.PARK_H, o.PARK_Z),
                        pt(B.x, o.PARK_H, o.PARK_Z), pt(B.x, o.PARK_H, zb), pt(B.x, B.y, zb), B],
                       [.25, .45, .4, Math.max(.6, Math.abs(B.x - A.x) / 5), .4, .45, .25]);
    let W = (C - o.LEAD) - (t0 + o.POST);
    if (sum(park) <= W){
      let t = t0 + o.POST; push(t, A);
      park.forEach((w, k) => { t += w.dur; push(t, w.p); if (k === 3){ t += W - sum(park); push(t, w.p); } });
      return;
    }
    const t1 = Math.min(t0 + o.POST_MIN, Math.max(t0, C - o.LEAD_MIN));
    W = Math.max(0, (C - o.LEAD_MIN) - t1);
    const same = Math.abs(A.x - B.x) < 1e-9 && Math.abs(A.z - B.z) < 1e-9;
    // YO-YO (same pad): only the winch moves — as late as it can, while the marble is below
    // LANE: up above the lip, along, (wait), down; STRAIGHT: the last resort
    const plans = same ? [moves([A, B])]
      : [moves([A, pt(A.x, A.y, za), pt(A.x, YL, za), pt(B.x, YL, zb), pt(B.x, B.y, zb), B], [.25, .45, 0, .45, .25]),
         moves([A, pt(A.x, A.y, za), pt(A.x, YL, za), pt(B.x, YL, zb), pt(B.x, B.y, zb), B]),
         moves([A, B])];
    let segs = plans.find(p => sum(p) <= W + 1e-9);
    if (!segs){
      segs = plans[plans.length - 1];
      warnings.push(`crane late for hop ${h.i}→${h.j}: needs ${sum(segs).toFixed(2)}s, has ${W.toFixed(2)}s`);
      const k = W / Math.max(1e-9, sum(segs));
      segs.forEach(w => { w.dur *= k; });
    }
    // the slack waits in the lane (before the descent); a yo-yo winches UP early (while the marble
    // falls away beneath it) and DOWN late (once it is rising below the catch point)
    const slack = Math.max(0, W - sum(segs));
    const waitAt = same ? (B.y > A.y ? 0 : -1) : segs.length < 3 ? -1 : 2;
    let t = t1; push(t, A);
    if (waitAt < 0){ t += slack; push(t, A); }
    segs.forEach((w, k) => { t += w.dur; push(t, w.p); if (k === waitAt){ t += slack; push(t, w.p); } });
  }

  // the COUNT-IN: before the very first release the marble is pre-loaded, ARMED where the seam
  // hop waits for its descent (in the lane over pad 0 — no plates up there), then follows the
  // seam choreography down onto pad 0. armT = when that wait ends (≤ rel0, in the newborn's clock).
  const sk = seamHop.keys, kArm = seamHop.mode === 'lane' ? 5 : sk.length - 2;
  const armT = sk[kArm][0] - P, armPt = sk[kArm][1];

  const padT = pads.map(p => rollT + p.t);             // strike times (τ), ascending
  return { g, P, rollT, r, n, pads, padT, hopAt, hops, rel0, armT, armPt, key, keyT: key.map(k => k[0]),
           dtFree: dtF, laneY: YL, warnings, fits: warnings.length === 0, opt: o };
}

/* index of the last element of a sorted array ≤ v (−1 if none) — binary search */
function floorIdx(arr, v){
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (arr[m] <= v){ ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
/* index of the last hop whose dock time ≤ u (hops are in time order) */
function lastDock(pl, u){
  let lo = 0, hi = pl.hops.length - 1, ans = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (pl.hops[m].C <= u){ ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/* The magnet at songTime t: face position + velocity + coil state. Before the first
   release (the count-in) it is simply where the loop's seam hop has it: loaded, ARMED.
     loaded       — a marble is docked on it
     sinceDock    — s since the current marble docked (loaded only, else −1)
     sinceRelease — s since the last release (−1 while armed)
     coil         — 0..1: energises as a marble rises into it (1 while loaded)
     hop          — index of the hop it is serving (or about to) */
export function craneAt(pl, t){
  if (t < pl.armT) return { ...pl.armPt, vx: 0, vy: 0, vz: 0, coil: 1, loaded: true, sinceDock: 9, sinceRelease: -1, phase: 'armed', hop: pl.hops.length - 1 };
  const k = Math.floor((t - pl.rel0) / pl.P);
  const u = t - k * pl.P;                              // ∈ [rel0, rel0 + P)
  const K = pl.key;
  const i = Math.min(Math.max(0, floorIdx(pl.keyT, u)), K.length - 2);
  const [t0, a] = K[i], [t1, b] = K[i + 1];
  const span = t1 - t0, f = span > 0 ? (u - t0) / span : 1;
  const e = ease(f), de = span > 0 ? dease(f) / span : 0;
  const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e, z = a.z + (b.z - a.z) * e;
  const vx = (b.x - a.x) * de, vy = (b.y - a.y) * de, vz = (b.z - a.z) * de;
  const hi = lastDock(pl, u), h = hi >= 0 ? pl.hops[hi] : null;
  const loaded = !!h && u < h.rel;
  const lastRel = loaded ? (hi > 0 ? pl.hops[hi - 1].rel : pl.rel0) : (h ? h.rel : pl.rel0);
  const next = pl.hops[hi + 1] || null;
  const coil = loaded ? 1 : next ? Math.max(0, 1 - (next.C - u) / .12) : 0;
  const phase = loaded ? (u < h.carryStart ? 'dock' : u < h.carryEnd ? 'carry' : 'hold')
                       : (next && u >= next.C - .12 ? 'wait' : 'return');
  return { x, y, z, vx, vy, vz, coil, loaded, sinceDock: loaded ? u - h.C : -1, sinceRelease: u - lastRel,
           phase: t < pl.rel0 ? 'armed' : phase, hop: loaded ? hi : hi + 1 };
}

/* The marble (ball CENTRE, band frame, heights from contact) during the crane's part of
   its loop, for the ball born at k·P at its own clock τ. null while it flies a FREE arc
   (main's solved arcs own it there).
     τ < rel0                → on the magnet: the seam hop's marble (count-in / hand-off)
     rel0 ≤ τ < rollT         → free fall onto pad 0 (lands at τ = rollT, on the beat)
     a hop's strike s → C     → the vertical launch up to the magnet (v → 0)          'rise'
     C → rel                  → docked: rides the magnet (dock, carry, hold)           'docked'
     rel → land               → released: free fall onto the next pad, on its beat    'fall'
   The seam hop's docked phase runs on to the next ball's release (P + rel0). */
export function craneBall(pl, tau, birthT){
  const last = pl.hops.length - 1;
  if (tau < pl.rel0){                                  // the seam hop's marble, seen from the newborn's clock
    const m = craneAt(pl, birthT + tau);
    return { x: m.x, y: m.y - pl.r, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, mode: 'hang', hop: last, seg: -1 };
  }
  if (tau < pl.rollT){
    const s = tau - pl.rel0, H = pl.hops[last];
    return { x: H.HOLD.x, y: H.hr - .5 * pl.g * s * s, z: H.HOLD.z, vx: 0, vy: -pl.g * s, vz: 0, mode: 'fall', hop: last, seg: -1 };
  }
  const i = floorIdx(pl.padT, tau);
  const hi = pl.hopAt[i];
  if (hi < 0) return null;
  const h = pl.hops[hi];
  if (tau < h.C){
    const u = tau - h.s, v0 = pl.g * h.Tr;
    return { x: h.CATCH.x, y: v0 * u - .5 * pl.g * u * u, z: h.CATCH.z, vx: 0, vy: v0 - pl.g * u, vz: 0, mode: 'rise', hop: hi, seg: i };
  }
  if (tau < h.rel || h.seam){
    const m = craneAt(pl, birthT + tau);
    return { x: m.x, y: m.y - pl.r, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, mode: 'docked', hop: hi, seg: i };
  }
  const s = tau - h.rel;
  return { x: h.HOLD.x, y: h.hr - .5 * pl.g * s * s, z: h.HOLD.z, vx: 0, vy: -pl.g * s, vz: 0, mode: 'fall', hop: hi, seg: i };
}

/* The whole marble in the band frame (free arcs included) — what the render shows,
   for honesty tests: a free arc from pad i to i+1 is x/z linear, y = ½·g·u·(dt − u). */
export function marbleAt(pl, tau, birthT = 0){
  const c = craneBall(pl, tau, birthT);
  if (c) return c;
  const i = floorIdx(pl.padT, tau), a = pl.pads[i], b = pl.pads[i + 1], u = tau - pl.padT[i], f = u / a.dt;
  return { x: a.x + (b.x - a.x) * f, y: .5 * pl.g * u * (a.dt - u), z: a.z + (b.z - a.z) * f,
           vx: (b.x - a.x) / a.dt, vy: .5 * pl.g * (a.dt - 2 * u), vz: (b.z - a.z) / a.dt, mode: 'free', seg: i, hop: -1 };
}

/* The segment (last struck pad index) at τ — binary search; −1 before the first strike. */
export const segAt = (pl, tau) => floorIdx(pl.padT, tau);
