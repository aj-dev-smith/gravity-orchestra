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
     • A gap up to KISS_MAX_K·dtFree is an APEX KISS: the marble flies a real
       ballistic arc (horizontal speed D/gap, constant all the way); at its apex
       (vy = 0) the magnet — already running alongside at the SAME horizontal
       speed — takes it (relative speed zero: an honest dock, the clack), glides it
       level, and lets go so the descending half-arc lands on the next pad on the
       beat. A flat-topped arc: the gesture of the note survives, the height is
       capped. Apex height is continuous in the gap (≥ H_FREE), so "longer note =
       higher" holds right across the free → hop boundary.
     • A longer gap is a CRANE HOP: the pad lobs the marble STRAIGHT UP to the
       voice's electromagnet, arriving at the apex with v = 0 (it docks — the
       clack); the carriage carries it to hang over the NEXT pad, holds, and
       releases so the free fall lands on that pad exactly on the beat:
       release = strike − √(2h/g). The loop seam (last pad → pad 0 of the next
       loop, the conserved marble) is always the loop's last vertical hop.

   Why H_FREE = 5.25 (dtFree ≈ 1.70 s): a catch/release magnet must hang ENTIRELY
   below the top housing's lip (band + 7.0) at any depth — face (h + r + UPY) + the
   magnet body (.58) ≤ 7.0 ⇒ h ≤ 5.78 for the bass marble (r .36); HOLD_H = 5.6. The
   free arcs stay just under that (H_FREE = HOLD_H − .35), and no free arc ever leaves
   the open run.

   THE LANE: a loaded magnet on a long vertical hop does its travelling ABOVE the lip,
   in front of the housing (z ≥ Z_SAFE) — the plates are stowed behind the skirt up
   there, so nothing can be in its way: dock → step forward → winch up past the lip →
   along the lane → (wait) → down over the next pad → step back → a still hang →
   release. Hops too short for that fly a DIRECT carry below the lip.

   THE PLATES: every choreography (the marble, the magnet body and its cable, loaded or
   returning empty) is checked against the voice's own tone-plates (plateField: every
   plate on its belt, unfolding and stowing — the pads keep moving while the crane
   works). Where a plate would pass through, the planner first tries another
   choreography; failing that it gives the plate a VISIBLE reason to get out of the
   way — an EARLY STOW (it folds flat onto the belt sooner after its strike) or a LATE
   UNFOLD (it deploys later on its way up). That is the plate's own deploy animation,
   just with a nearer edge (edgeLo/edgeHi, per plate, exported for the render) and a quick
   FOLD, so it is still a pure fn of songTime and never touches the strike itself: a plate
   folds only once its follow-through has rung out, and is up before its wind-up.

   One crane per voice, and it carries one marble — its own. Between hops it RETURNS
   empty: up into the housing, along the rail, out and down (the PARK route) when
   there's time; otherwise over the lane; back-to-back hops on one pad are a YO-YO (only
   the winch moves). Every crane move is a quintic Hermite (smootherstep when it starts
   and ends at rest) whose peak speed and acceleration stay under V_MAX / A_MAX — never
   a teleport. If a song is too dense for the crane the plan says so in `warnings`
   (the tests hold the catalog to zero).

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
  H_MIN:    1.4,   // lowest catch the winch goes down to (squeezed hops)
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
  MAG_BODY: .2,    // plate probe: the magnet body's centre above its face
  CABLE_TOP: 7.6,  // plate probe: the winch cable is checked up to here (no plate reaches higher)
  STRIKE_C: .08,   // a plate within this many seconds of its own strike is IN contact, by design
  KISS_MAX_K: 2,   // apex kisses for gaps up to this × dtFree; longer rests hop vertically
  KISS_GL:  .12,   // the apex-kiss height leaves at least this much glide (once above H_FREE)
  KISS_RAMP: .35,  // the carriage's run-up to (and run-out from) the marble's speed
  STOW_PAD: .12,   // an early-stowing plate is flat this long (phase, s) before the marble reaches it
  FOLD:     .35,   // an early stow / late unfold folds over this long (s) — a quick, readable flip
  STOW_MIN: .7,    // … never before the strike's follow-through has rung out (≤ 6% left at .35 s) + FOLD
  UNFOLD_MIN: 1.25,// … and is fully deployed before the flipper's wind-up begins (≤ .86 s) + FOLD
};

/* A plate's deploy pose at belt phase c with its (planned) edge: the engine's deployPose,
   but a pulled-in edge folds over FOLD seconds instead of the long screen-edge unfold. */
export const plateDeploy = (c, inner, edge) => deployPose(c, Math.min(inner, edge - CRANE.FOLD), edge);

/* The longest gap flown as a free arc (its apex is exactly H_FREE). */
export const dtFree = (g, o = CRANE) => Math.sqrt(8 * o.H_FREE / g);
/* layoutPads options for a crane-hopping voice: a hop's x step no longer grows with dt
   (the magnet carries it), and the weave folds back early past ±X_MAX so a long import
   can't wander off across the room (the hand-authored catalog stays inside ±13 already). */
export const X_MAX = 13;
export const hopLayout = g => ({ hopOver: dtFree(g), xMax: X_MAX });

export const EV = 1.875, EA = 5.7735;                  // smootherstep peak |v|·T/D and peak |a|·T²/D
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const pt = (x, y, z) => ({ x, y, z });
const Z3 = pt(0, 0, 0);
const sum = segs => segs.reduce((q, w) => q + w.dur, 0);
/* least time a smootherstep move of length D may take under the carriage limits */
export const minMoveT = (D, o = CRANE) => D < 1e-9 ? 0 : Math.max(EV * D / o.V_MAX, Math.sqrt(EA * D / o.A_MAX));

/* One crane segment between keys [t, p, v?] (v = velocity, default at rest): the quintic
   Hermite with zero end accelerations — exactly smootherstep when both ends are at rest,
   exactly linear when it is a constant-velocity glide. */
export function segEval(k0, k1, t){
  const [t0, a, va = Z3] = k0, [t1, b, vb = Z3] = k1, T = t1 - t0;
  if (!(T > 0)) return { x: b.x, y: b.y, z: b.z, vx: vb.x, vy: vb.y, vz: vb.z };
  const u = Math.min(1, Math.max(0, (t - t0) / T)), u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
  const S = 10 * u3 - 15 * u4 + 6 * u5, dS = (30 * u2 - 60 * u3 + 30 * u4) / T;
  const h0 = T * (u - 6 * u3 + 8 * u4 - 3 * u5), d0 = 1 - 18 * u2 + 32 * u3 - 15 * u4;
  const h1 = T * (-4 * u3 + 7 * u4 - 3 * u5), d1 = -12 * u2 + 28 * u3 - 15 * u4;
  return {
    x: a.x + (b.x - a.x) * S + va.x * h0 + vb.x * h1, vx: (b.x - a.x) * dS + va.x * d0 + vb.x * d1,
    y: a.y + (b.y - a.y) * S + va.y * h0 + vb.y * h1, vy: (b.y - a.y) * dS + va.y * d0 + vb.y * d1,
    z: a.z + (b.z - a.z) * S + va.z * h0 + vb.z * h1, vz: (b.z - a.z) * dS + va.z * d0 + vb.z * d1,
  };
}
function evalKeys(K, KT, t){
  const i = Math.min(Math.max(0, floorIdx(KT, t)), K.length - 2);
  return segEval(K[i], K[i + 1], t);
}

/* The voice's TONE-PLATES as obstacles. clear(τ, x, y, z, r) is true when no plate of the
   voice (riding its belt — beltPhase — and unfolding/stowing — deployPose, up to its own
   edge) overlaps a ball of radius r at that point (contact-level band frame); .clash(…)
   returns the offending { k, c } instead. Plate = box of half-extents plate·s, telescoped
   from stowed (flat on the belt at stowZ) to deployed (level, at its rest z); the tilt to its
   catch normal is ignored. edgeLo/edgeHi (phase units, per plate) are where it starts to
   unfold on the way up / is fully stowed again after its strike — the planner pulls them in
   (LATE UNFOLD / EARLY STOW) to clear the crane's path. O(log n + plates in view). */
export function plateField({ padT, P, plates, plate = { L: 1.1, T: .12, W: .44 }, stowZ = -1.75, inner = 3, cull = 7.65, o = CRANE }){
  const innerC = inner / DESCENT, cullC = Math.min(cull, DESCENT * P * .5 - .5) / DESCENT, n = padT.length;
  const edgeLo = new Array(n).fill(cullC), edgeHi = new Array(n).fill(cullC);
  const clash = (t, x, y, z, r, margin = 0) => {
    const u = padT[0] + ((t - padT[0]) % P + P) % P;  // ∈ [padT0, padT0 + P)
    for (const m of [-1, 0, 1]){
      const lo = u - cullC - m * P, hi = u + cullC - m * P;
      for (let k = floorIdx(padT, lo - 1e-12) + 1; k < n && padT[k] <= hi; k++){
        const c = beltPhase(t, padT[k], P);
        if (Math.abs(c) > cullC || Math.abs(c) < o.STRIKE_C) continue;
        const q = plates[k], s = q.s, dep = plateDeploy(c, innerC, c >= 0 ? edgeHi[k] : edgeLo[k]);
        const hx = plate.L / 2 * s, hy = (plate.T / 2 + (plate.W - plate.T) / 2 * (1 - dep.tilt)) * s,
              hz = (plate.W / 2 + (plate.T - plate.W) / 2 * (1 - dep.tilt)) * s;
        const pz = stowZ + (q.z - stowZ) * dep.extend, py = DESCENT * c - .38;   // plate centre (belt −.12, contact +.26)
        const dx = Math.max(0, Math.abs(x - q.x) - hx), dy = Math.max(0, Math.abs(y - py) - hy), dz = Math.max(0, Math.abs(z - pz) - hz);
        if (dx * dx + dy * dy + dz * dz < (r + margin) ** 2) return { k, c };
      }
    }
    return null;
  };
  const clear = (t, x, y, z, r, margin = 0) => !clash(t, x, y, z, r, margin);
  return Object.assign(clear, { clash, edgeLo, edgeHi, innerC, cullC,
    edgeMinHi: Math.min(cullC, o.STOW_MIN), edgeMinLo: Math.min(cullC, o.UNFOLD_MIN) });
}

/* The deploy edge (phase units) plate k uses at belt phase c — what the render passes to
   deployPose so it shows exactly the plate the planner cleared. */
export const plateEdge = (pl, k, c) => (c >= 0 ? pl.edgeHi : pl.edgeLo)?.[k] ?? Infinity;

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
  const mr = Math.max(.24, r * 1.15);                  // magnet body radius (paternoster's magnet)
  const zf = z => Math.max(z, o.Z_SAFE);
  const moves = (pts, nom) => pts.slice(1).map((p, k) => {
    const len = dist(pts[k], p);
    return { p, len, dur: len < 1e-9 ? 0 : Math.max(nom ? nom[k] : 0, minMoveT(len, o)) };
  });
  let stows = 0;

  /* ---- the plates: probes + the early-stow settle ---- */
  // the magnet body + its winch cable at face m (skipped above the lip: the plates are stowed behind the skirt)
  function magProbe(t, m, visit){
    if (m.y >= o.LIP_C) return null;
    let x = visit(t, m.x, m.y + o.MAG_BODY, m.z, mr, 0); if (x) return x;
    for (let y = m.y + o.MAG_H; y < o.CABLE_TOP; y += .3){ x = visit(t, m.x, y, m.z, .03, 0); if (x) return x; }
    return null;
  }
  /* sweep a probe set; if a plate is in the way, pull that plate's edge in (EARLY STOW after its
     strike / LATE UNFOLD before it) and sweep again. Edges only ever shrink, so a plate pulled
     in for one hop can never spoil another. On failure every edge is put back. */
  function settle(probes){
    if (!clear) return true;
    const visit = (t, x, y, z, rad, margin) => clear.clash(t, x, y, z, rad, margin);
    const undo = [];
    for (let round = 0; round < 24; round++){
      const hit = probes(visit);
      if (!hit) { stows += undo.length; return true; }
      const arr = hit.c >= 0 ? clear.edgeHi : clear.edgeLo, want = Math.abs(hit.c) - o.STOW_PAD;
      if (want < (hit.c >= 0 ? clear.edgeMinHi : clear.edgeMinLo) || want >= arr[hit.k] - 1e-6) break;
      undo.push([arr, hit.k, arr[hit.k]]); arr[hit.k] = want;
    }
    for (let q = undo.length - 1; q >= 0; q--){ const [arr, k, v] = undo[q]; arr[k] = v; }
    return false;
  }

  /* the marble along a hop, at τ ∈ [s, land) (the seam's hand-off is craneBall's business) */
  function hopBall(h, t, magAt){
    if (t < h.C){ const u = t - h.s;
      return { x: h.a.x + h.vh.x * u, y: g * h.Tr * u - .5 * g * u * u, z: h.a.z + h.vh.z * u, vx: h.vh.x, vy: g * h.Tr - g * u, vz: h.vh.z, mode: 'rise' }; }
    if (t < h.rel){ const m = magAt(t); return { x: m.x, y: m.y - r, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, mode: 'docked', m }; }
    const u = t - h.rel;
    return { x: h.HOLD.x + h.vh.x * u, y: h.hr - .5 * g * u * u, z: h.HOLD.z + h.vh.z * u, vx: h.vh.x, vy: -g * u, vz: h.vh.z, mode: 'fall' };
  }
  const hopProbes = h => visit => {
    const st = 1 / 60, KT = h.keys.map(k => k[0]), magAt = t => evalKeys(h.keys, KT, t);
    for (let t = h.s; t < h.land - o.STRIKE_C; t += st){
      const b = hopBall(h, t, magAt);
      if (b.mode === 'docked' && b.m.y >= YL - 1e-9) continue;   // riding the lane: above the lip, in front
      const x = visit(t, b.x, b.y, b.z, r, .03); if (x) return x;
    }
    for (let t = h.entry.t; t <= h.exit.t; t += st){ const x = magProbe(t, magAt(t), visit); if (x) return x; }
    return null;
  };

  /* ---- candidate choreographies ---- */
  const base = (i, j, s, land) => ({ i, j, seam: i === n - 1, s, land, gap: land - s,
    a: pt(pads[i].x, 0, pads[i].z), b: pt(pads[j].x, 0, pads[j].z), D: Math.hypot(pads[j].x - pads[i].x, pads[j].z - pads[i].z) });
  const finish = h => Object.assign(h, { H: Math.max(h.hc, h.hr),
    vOut: pt(h.vh.x, g * h.Tr, h.vh.z), vIn: pt(h.vh.x, -g * h.Tf, h.vh.z) });

  /* APEX KISS: one ballistic arc with a flat, magnet-held top */
  function buildKiss(i, j, s, land){
    const h = base(i, j, s, land), gap = h.gap;
    const H = Math.max(o.H_FREE, Math.min(o.HOLD_H, g / 8 * (gap - o.KISS_GL) ** 2));
    const T = fallT(H), glide = gap - 2 * T;
    if (glide < -1e-9) return null;
    const vh = pt((h.b.x - h.a.x) / gap, 0, (h.b.z - h.a.z) / gap), sp = Math.hypot(vh.x, vh.z);
    if (sp > o.V_MAX * .9) return null;
    const C = s + T, rel = land - T, Ta = Math.max(o.KISS_RAMP, 1.5 * sp / o.A_MAX * 1.05);
    const CATCH = pt(h.a.x + vh.x * T, H + r, h.a.z + vh.z * T), HOLD = pt(h.b.x - vh.x * T, H + r, h.b.z - vh.z * T);
    const IN = pt(CATCH.x - vh.x * Ta / 2, CATCH.y, CATCH.z - vh.z * Ta / 2), OUT = pt(HOLD.x + vh.x * Ta / 2, HOLD.y, HOLD.z + vh.z * Ta / 2);
    return finish(Object.assign(h, { mode: 'kiss', tight: false, hc: H, hr: H, Tr: T, Tf: T, dock: 0, glide, vh,
      C, carryStart: C, carryEnd: rel, rel, CATCH, HOLD, fits: true,
      keys: [[C - Ta, IN], [C, CATCH, vh], [rel, HOLD, vh], [rel + Ta, OUT]],
      entry: { t: C - Ta, p: IN }, exit: { t: rel + Ta, p: OUT } }));
  }
  /* VERTICAL hop's LOADED choreography, or null if it can't fit the gap.
       lane:   dock → (step forward) → lift above the lip → along the lane → (wait) → down → (step back) → hold → release
       direct: dock → one straight carry to the hold point → hold → release                       */
  function build(i, j, s, land, mode, Hc, Hr, tight){
    const h = base(i, j, s, land), Tr = fallT(Hc), Tf = fallT(Hr), C = s + Tr, rel = land - Tf;
    let d = tight ? o.DOCK_MIN : o.DOCK, mh = tight ? o.HOLD_MIN : o.MIN_HOLD;
    const CATCH = pt(h.a.x, Hc + r, h.a.z), HOLD = pt(h.b.x, Hr + r, h.b.z), D = h.D;
    let segs, nom, waitAfter, main;                    // main = the carry leg that soaks up spare time
    if (mode === 'lane'){
      nom = [.25, .45, Math.max(.9, D / o.V_NOM), .45, .25];
      segs = moves([CATCH, pt(h.a.x, Hc + r, zf(h.a.z)), pt(h.a.x, YL, zf(h.a.z)), pt(h.b.x, YL, zf(h.b.z)), pt(h.b.x, Hr + r, zf(h.b.z)), HOLD], tight ? null : nom);
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
    return finish(Object.assign(h, { mode, tight, hc: Hc, hr: Hr, Tr, Tf, dock: d, vh: pt(0, 0, 0),
      C, carryStart: C + d, carryEnd, rel, CATCH, HOLD, keys, fits: true,
      entry: { t: C, p: CATCH }, exit: { t: rel, p: HOLD } }));
  }
  // can the empty crane get from one hop's exit to another's entry in time (straight, at the limits)?
  const reachable = (ex, en) => en.t - o.LEAD_MIN - (ex.t + o.POST_MIN) >= minMoveT(dist(ex.p, en.p), o) - 1e-9;

  const hopAt = new Array(n).fill(-1), hops = [];
  const HS0 = [o.HOLD_H, 4.6, 3.6, 2.6, o.H_MIN];
  for (let i = 0; i < n; i++){
    const seam = i === n - 1;
    if (!seam && pads[i].dt <= dtF) continue;          // a free solved arc: the belt's grammar
    const j = seam ? 0 : i + 1;
    const s = rollT + pads[i].t, land = seam ? P + rollT : s + pads[i].dt, gap = land - s;
    const D = Math.hypot(pads[j].x - pads[i].x, pads[j].z - pads[i].z);
    // heights: the discrete ladder plus the highest a squeezed direct hop can reach (continuous in the gap)
    const Tm = (gap - o.DOCK_MIN - o.HOLD_MIN - minMoveT(D, o)) / 2;
    const Hfit = Tm > 0 ? Math.min(o.HOLD_H, .5 * g * Tm * Tm) : 0;
    const HS = [...HS0, Hfit].filter(h => h <= o.HOLD_H && h >= o.H_MIN).sort((p, q) => q - p).filter((h, k, a) => k === 0 || a[k - 1] - h > 1e-6);
    const pairs = [];
    for (const hc of HS) for (const hr of HS) pairs.push([hc, hr]);
    pairs.sort((p, q) => (q[0] + q[1]) - (p[0] + p[1]) || q[1] - p[1]);
    const prev = hops[hops.length - 1];
    const timely = h => (!prev || reachable(prev.exit, h.entry)) &&
      (!seam || !hops.length || reachable(h.exit.t !== undefined ? { t: h.exit.t - P, p: h.exit.p } : h.exit, hops[0].entry));
    function* candidates(){
      if (!seam && gap <= o.KISS_MAX_K * dtF) yield buildKiss(i, j, s, land);
      for (const [hc, hr] of pairs) for (const mode of ['lane', 'direct']) for (const tight of [false, true])
        yield build(i, j, s, land, mode, hc, hr, tight);
    }
    let best = null, firstFit = null;
    for (const h of candidates()){
      if (!h || !timely(h)) continue;
      firstFit ||= h;
      if (settle(hopProbes(h))){ best = h; break; }
    }
    if (!best && firstFit){ best = firstFit; warnings.push(`hop ${i}→${j}: no plate-clear choreography`); }
    if (!best){                                        // squeezed below every height: winch to fit
      const H = Math.max(o.H_MIN, Hfit);
      best = build(i, j, s, land, 'direct', H, H, true);
      if (!best){
        warnings.push(`hop ${i}→${j}: gap ${gap.toFixed(2)}s too short for the crane`);
        const Tf = fallT(o.H_MIN), C = s + Tf, rel = land - Tf;
        const CATCH = pt(pads[i].x, o.H_MIN + r, pads[i].z), HOLD = pt(pads[j].x, o.H_MIN + r, pads[j].z);
        best = finish(Object.assign(base(i, j, s, land), { mode: 'direct', tight: true, hc: o.H_MIN, hr: o.H_MIN, Tr: Tf, Tf, dock: 0, vh: pt(0, 0, 0),
                 C, carryStart: C, carryEnd: Math.max(C, rel), rel: Math.max(C, rel), CATCH, HOLD, fits: false,
                 keys: [[C, CATCH], [Math.max(C, rel), HOLD]], entry: { t: C, p: CATCH }, exit: { t: Math.max(C, rel), p: HOLD } }));
      } else warnings.push(`hop ${i}→${j}: crane can't reach it in time`);
    }
    hopAt[i] = hops.length;
    hops.push(best);
  }
  const seamHop = hops[hops.length - 1];
  const rel0 = seamHop.rel - P;                        // the seam release, in the newborn's clock (τ)

  /* ---- the crane's keyframes over one period [rel0, rel0 + P) ---- */
  const key = [[rel0, seamHop.HOLD]];
  let prevEx = { t: rel0, p: seamHop.HOLD };
  hops.forEach(h => {
    route(prevEx.t, prevEx.p, h.entry.t, h.entry.p, h);
    h.keys.forEach(k => key.push(k));
    prevEx = h.exit;
  });

  /* the EMPTY return from a hop's exit A (at t0) to the next hop's entry B (in place by tE − lead) */
  function route(t0, A, tE, B, h){
    const za = zf(A.z), zb = zf(B.z);
    const same = Math.abs(A.x - B.x) < 1e-9 && Math.abs(A.z - B.z) < 1e-9;
    // PARK: step out in front of the skirt, up into the housing, along the rail, (wait), out, down, in
    const park = moves([A, pt(A.x, A.y, za), pt(A.x, o.PARK_H, za), pt(A.x, o.PARK_H, o.PARK_Z),
                        pt(B.x, o.PARK_H, o.PARK_Z), pt(B.x, o.PARK_H, zb), pt(B.x, B.y, zb), B],
                       [.25, .45, .4, Math.max(.6, Math.abs(B.x - A.x) / 5), .4, .45, .25]);
    // YO-YO (same pad): only the winch moves — as late as it can, while the marble is below
    // LANE: up above the lip, along, (wait), down; STRAIGHT: the last resort
    const quick = same ? [moves([A, B])]
      : [moves([A, pt(A.x, A.y, za), pt(A.x, YL, za), pt(B.x, YL, zb), pt(B.x, B.y, zb), B], [.25, .45, 0, .45, .25]),
         moves([A, pt(A.x, A.y, za), pt(A.x, YL, za), pt(B.x, YL, zb), pt(B.x, B.y, zb), B]),
         moves([A, B])];
    const plans = [];
    const Wp = (tE - o.LEAD) - (t0 + o.POST);
    if (sum(park) <= Wp){                              // lay one plan out as keys
      const K = []; let t = t0 + o.POST; K.push([t, A]);
      park.forEach((w, k) => { t += w.dur; K.push([t, w.p]); if (k === 3){ t += Wp - sum(park); K.push([t, w.p]); } });
      plans.push(K);
    }
    const t1 = Math.min(t0 + o.POST_MIN, Math.max(t0, tE - o.LEAD_MIN));
    const W = Math.max(0, (tE - o.LEAD_MIN) - t1);
    for (const segs of quick){
      if (sum(segs) > W + 1e-9) continue;
      // the slack waits in the lane (before the descent); a yo-yo winches UP early (while the marble
      // falls away beneath it) and DOWN late (once it is rising below the catch point)
      const slack = Math.max(0, W - sum(segs));
      const waitAt = same ? (B.y > A.y ? 0 : -1) : segs.length < 3 ? -1 : 2;
      const K = []; let t = t1; K.push([t, A]);
      if (waitAt < 0){ t += slack; K.push([t, A]); }
      segs.forEach((w, k) => { t += w.dur; K.push([t, w.p]); if (k === waitAt){ t += slack; K.push([t, w.p]); } });
      plans.push(K);
    }
    if (!plans.length){
      const segs = quick[quick.length - 1];
      warnings.push(`crane late for hop ${h.i}→${h.j}: needs ${sum(segs).toFixed(2)}s, has ${W.toFixed(2)}s`);
      const k = W / Math.max(1e-9, sum(segs)), K = []; let t = t1; K.push([t, A]);
      segs.forEach(w => { t += w.dur * k; K.push([t, w.p]); });
      plans.push(K);
    }
    // the first plan whose EMPTY magnet (body + cable) never meets a plate — early-stowing if it must
    const probe = K => visit => {
      const KK = [[t0, A], ...K, [tE, B]], KT = KK.map(k => k[0]);
      for (let t = t0; t <= tE; t += 1 / 60){ const x = magProbe(t, evalKeys(KK, KT, t), visit); if (x) return x; }
      return null;
    };
    let pick = plans.find(K => settle(probe(K)));
    if (!pick){ pick = plans[0]; if (clear) warnings.push(`crane return before hop ${h.i}→${h.j}: no plate-clear route`); }
    pick.forEach(k => key.push(k));
  }

  // the COUNT-IN: before the very first release the marble is pre-loaded, ARMED where the seam
  // hop waits for its descent (in the lane over pad 0 — no plates up there), then follows the
  // seam choreography down onto pad 0. armT = when that wait ends (≤ rel0, in the newborn's clock).
  const sk = seamHop.keys, kArm = seamHop.mode === 'lane' ? 5 : sk.length - 2;
  const armT = sk[kArm][0] - P, armPt = sk[kArm][1];

  const padT = pads.map(p => rollT + p.t);             // strike times (τ), ascending
  return { g, P, rollT, r, n, pads, padT, hopAt, hops, rel0, armT, armPt, key, keyT: key.map(k => k[0]),
           retireT: P + rel0,                          // a ball retires (and the next shows) at the next seam release
           edgeLo: clear ? clear.edgeLo.slice() : null, edgeHi: clear ? clear.edgeHi.slice() : null, stows,
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
  const { x, y, z, vx, vy, vz } = evalKeys(pl.key, pl.keyT, u);
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
     a hop's strike s → C     → the launch up to the magnet (vy → 0; a kiss keeps its vh) 'rise'
     C → rel                  → docked: rides the magnet (dock, carry/glide, hold)    'docked'
     rel → land               → released: free fall onto the next pad, on its beat    'fall'
   The seam hop's docked phase runs on to the next ball's release (retireT = P + rel0). */
export function craneBall(pl, tau, birthT){
  const last = pl.hops.length - 1;
  if (tau < pl.rel0){                                  // the seam hop's marble, seen from the newborn's clock
    const m = craneAt(pl, birthT + tau);
    return { x: m.x, y: m.y - pl.r, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, mode: 'hang', hop: last, seg: -1 };
  }
  if (tau < pl.rollT){
    const s = tau - pl.rel0, H = pl.hops[last];
    return { x: H.HOLD.x + H.vh.x * s, y: H.hr - .5 * pl.g * s * s, z: H.HOLD.z + H.vh.z * s, vx: H.vh.x, vy: -pl.g * s, vz: H.vh.z, mode: 'fall', hop: last, seg: -1 };
  }
  const i = floorIdx(pl.padT, tau);
  const hi = pl.hopAt[i];
  if (hi < 0) return null;
  const h = pl.hops[hi];
  if (tau < h.C){
    const u = tau - h.s, v0 = pl.g * h.Tr;
    return { x: h.a.x + h.vh.x * u, y: v0 * u - .5 * pl.g * u * u, z: h.a.z + h.vh.z * u, vx: h.vh.x, vy: v0 - pl.g * u, vz: h.vh.z, mode: 'rise', hop: hi, seg: i };
  }
  if (tau < h.rel || h.seam){
    const m = craneAt(pl, birthT + tau);
    return { x: m.x, y: m.y - pl.r, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, mode: 'docked', hop: hi, seg: i };
  }
  const s = tau - h.rel;
  return { x: h.HOLD.x + h.vh.x * s, y: h.hr - .5 * pl.g * s * s, z: h.HOLD.z + h.vh.z * s, vx: h.vh.x, vy: -pl.g * s, vz: h.vh.z, mode: 'fall', hop: hi, seg: i };
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
