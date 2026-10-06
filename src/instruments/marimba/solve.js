/* ============================================================
   MARIMBA — THE ROBOT MARIMBIST. Pure math (no THREE scene, no DOM, no audio).

   THE PERFORMER: a gantry RAIL over the keyboard carries TWO CARRIAGES (left
   hand / right hand), each belt-driven. Each carriage holds TWO MALLETS on a
   SCISSOR YOKE (lazy tongs) whose spread sets the interval — a real four-mallet
   grip. Each mallet hangs from a z-TRACK on its yoke end: a forearm slides
   along it (reaching for the back row = the sharps) and a WRIST MOTOR at its
   foot swings the shaft. The mallet head is a glowing MARBLE.

   EVERYTHING IS SOLVED ONCE, UP FRONT, CYCLIC OVER THE LOOP:
   · ALLOCATION (deterministic): chords → lowest notes left, highest right
     (≤ 2 per hand; extras dropped with a warning; a two-note chord may be one
     hand's dyad); single lines → the hand that can REACH within its limits,
     preferring low→left / high→right except in fast runs, where the hands
     alternate. A small beam search with one onset of lookahead, pricing every
     move the way buildPath will draw it; an idle partner mallet may WAIT on a
     note to come. The built paths are then MEASURED and any overrun leg's grips
     are penalised and re-solved (verify, then repair). A note of ≥ 1 beat is a
     ROLL: the chord attacked together, then a softer two-mallet tremolo (a
     second rolling hand interleaves), released in time for the hand's next
     move. The loop seam is just another move (two passes, the second seeded by
     the first's end state).
   · MOTION: each carriage's x(t) and yoke spread s(t) pass through every
     required pose EXACTLY at its strike times — quintic Hermite segments
     (C², zero accel at every knot), departing as late as the limits allow.
     A hands-never-cross guard (smooth, weighted toward whichever hand is
     furthest from a strike) can never move a hand at its own strike.
   · THE STROKE (per mallet, a pure fn of time since/until its strikes):
     prep lift (∝ velocity — louder = higher, because IMPACT SPEED IS THE
     LOUDNESS: a constant-acceleration down-stroke from height H lands at
     v = √(2·A·H)); a fast stroke has no time for the full lift, so the wrist
     motor WHIPS it (lower, thrown harder — its coil glows brighter) and it
     still lands at the asked speed; only past the motor's peak would the
     sound follow the weaker impact → down-stroke → CONTACT (head exactly on
     the bar top) → LOSSY REBOUND (keeps E of its speed) → caught by the wrist
     motor and carried to the next prep height.
   Time is the only state.
   ============================================================ */
import { noteHz, noteNum } from '../../engine.js';
import { laneClock, at, wrapP, lastIndex } from '../clock.js';

/* ---- the rig ---------------------------------------------------------- */
export const HEAD_R  = .085;          // marble mallet head radius (u)
export const LS      = 1.95;          // shaft length, wrist pivot → head centre
export const Y_W     = 4.1;           // wrist pivot height (local y; bars top at ≈3.3/3.48)
export const FOREARM = 1.62;          // the forearm column, wrist pivot → its z-track
export const Y_TRACK = Y_W + FOREARM; // the z-tracks (the forearms' slides)
export const Y_YOKE  = Y_TRACK + .1;  // the scissor yoke plane
export const Y_RAIL  = Y_YOKE + 1.25; // the gantry beam (carriage guide)
export const RAIL_X0 = -6.3, RAIL_X1 = 5.8;           // pulley centres (rail ends)
export const TRAVEL  = [RAIL_X0 + .45, RAIL_X1 - .45]; // carriage-centre travel
export const MAL_X   = [RAIL_X0 + .2, RAIL_X1 - .2];   // every mallet stays inside the towers
export const CAR_W   = .5;            // carriage body width (x)
export const RH      = HEAD_R + .01;  // a head's x half-extent for the no-cross guard
export const S_MIN   = .22;           // tightest yoke (both heads on ONE bar — a unison roll); the wrists clear by .05
export const S_REL   = 1.0;           // a relaxed grip (≈ a third)
export const GAP_MIN = .01;           // hands' inner extents never closer than this (u)
export const GAP_M   = .025;          // the guard's soft margin
export const GAP_REQ = GAP_MIN + 2 * GAP_M;   // the allocator keeps this at every knot
export const SEP_SOFT = .06;          // a mid-leg overlap this deep is left to the guard's smooth push

/* ---- the GANTRY's static geometry (local frame). The render draws exactly these
   boxes, and test/inst-marimba proves no two of them ever interpenetrate: each
   carriage is a SADDLE under the beam — a shoe riding the linear guide, a plate up
   the beam's outer face (the left hand in front, the right behind), nothing above the
   beam top but a thin L-bracket that reaches over the chain-tray wall to its own chain. */
export const Z_G = -1.85;             // the gantry's z (centre of the forearm tracks)
export const BEAM_H = .3, BEAM_D = .34;
export const Y_TOP = Y_RAIL + BEAM_H / 2;
export const RP = .17, BELT_DZ = .36; // belt pulley radius; belts either side of the beam (left hand front)
export const RC = .17, LINK = .13;    // drag-chain bend radius, link pitch
export const CH_H = .075, CH_W = .13, CH_ZC = .09;            // a link's height / width; its lane's z offset
export const CH_Y0 = Y_TOP + .02 + CH_H / 2 + .004;          // the lower run lies ON the tray floor
export const CH_YU = CH_Y0 + 2 * RC;                          // the upper run (back to the carriage)
const TRAY_W = .18, WALL_T = .015, WALL_H = .1;
const bx = (name, x0, x1, y0, y1, z0, z1) => ({ name, min: [x0, y0, z0], max: [x1, y1, z1] });
export const CH_X = [RAIL_X0 - .1, RAIL_X1 + .1];            // the tray's length
/** The chain tray: a floor on the beam top, a wall each side. */
export function trayBoxes(){
  return [bx('floor', ...CH_X, Y_TOP, Y_TOP + .02, Z_G - TRAY_W, Z_G + TRAY_W),
          ...[-1, 1].map(sd => bx('wall', ...CH_X, Y_TOP + .01, Y_TOP + .01 + WALL_H, Z_G + sd * TRAY_W - WALL_T / 2, Z_G + sd * TRAY_W + WALL_T / 2))];
}
/** The band a hand's drag chain can occupy (run 0 = the lower run, 1 = the upper). */
export function chainBand(h, run){
  const zc = Z_G + (h ? -CH_ZC : CH_ZC), y = run ? CH_YU : CH_Y0;
  return bx('chain', ...CH_X, y - CH_H / 2, y + CH_H / 2, zc - CH_W / 2, zc + CH_W / 2);
}
/** Hand h's carriage (a saddle) at carriage-centre cx: its boxes, by part. */
export function carriageBoxes(h, cx){
  const sg = h ? -1 : 1, z = (a, b) => sg > 0 ? [Z_G + a, Z_G + b] : [Z_G - b, Z_G - a];
  const x = w => [cx - w, cx + w], yB = Y_RAIL - BEAM_H / 2;
  const zIn = sg > 0 ? [Z_G - .15, Z_G + .24] : [Z_G - .24, Z_G + .15];
  return [
    bx('shoe',  ...x(CAR_W / 2), yB - .15, yB - .05, ...zIn),                  // rides under the chrome guide
    bx('plate', ...x(CAR_W / 2), yB - .15, Y_RAIL + .12, ...z(BEAM_D / 2 + .01, BEAM_D / 2 + .07)),
    bx('cap',   ...x(CAR_W / 2 - .05), Y_RAIL + .12, Y_RAIL + .14, ...z(BEAM_D / 2 + .005, BEAM_D / 2 + .075)),
    bx('clamp', ...x(.08), Y_RAIL - RP - .055, Y_RAIL - RP + .03, ...z(BEAM_D / 2 + .07, BELT_DZ + .05)),
    bx('post',  ...x(.035), Y_RAIL + .14, CH_YU + CH_H / 2 + .045, ...z(BEAM_D / 2 + .03, BEAM_D / 2 + .07)),
    bx('arm',   ...x(.035), CH_YU + CH_H / 2 + .01, CH_YU + CH_H / 2 + .045, ...z(CH_ZC - CH_W / 2 + .01, BEAM_D / 2 + .07)),
  ];
}
export const boxesHit = (a, b, eps = 1e-9) => [0, 1, 2].every(i => a.min[i] < b.max[i] - eps && b.min[i] < a.max[i] - eps);

/* carriage (x) and yoke-spread limits */
export const V_MAX = 12, A_MAX = 240;          // u/s, u/s² (1 u ≈ 22 cm: 2.6 m/s, 5.4 g — a light, brisk gantry)
export const VS_MAX = 16, AS_MAX = 480;     // the scissor is light: it opens faster than the carriage runs
export const PEAK = 1.15;             // the drives' short-term peak over their continuous rating
/* the stroke */
export const A_ST   = 80;             // down-stroke acceleration (the wrist motor's throw)
export const E      = .35;            // restitution: marble head ↔ rosewood (lossy)
export const HP_MIN = .32, HP_MAX = 1.15;      // prep height at vel 0 / vel 1
export const H_ARMED = 1.35;          // mallets raised at the count-in / when idle
export const SIG_R  = .055;           // rebound rise time (the motor catches it at the top)
export const T_XFER = .22;            // catch → next prep height
export const T_REC  = .07;            // a mallet's fastest re-strike
export const T_COMFY = .22;           // below this a mallet would rather let its partner play
export const ROLL_BEATS = 1;          // notes this long (beats) become a ROLL
export const ROLL_DT = .085;          // roll stroke spacing (s), alternating mallets
export const ROLL_SUS = .58;          // a roll's sustaining strokes, × the note's velocity
export const ROLL_KEEP = .25;         // a roll is never cut shorter than this (s)
export const T_ENTER = .6;            // count-in: the least time to glide in from the park
export const VZ_MAX = 30, AZ_MAX = 600;       // a forearm's slide along its track (light: it's only the arm)
export const EDGE_IN = .12;           // the sharps are struck near their FRONT edge (fraction of the
                                      // bar length in from the end — past the node, real technique)

/* the bar's bend-shiver (kept from the dribbling machine) */
export const FLEX_K  = .0032;         // bar-centre deflection per unit impact speed…
export const FLEX_MAX = .035;         // …capped (u): a rosewood SHIVER, not a rubber bend
export const FLEX_W  = 2 * Math.PI * 14;
export const FLEX_DECAY = 10;
export const NODE    = .2242;         // first-mode node, fraction of length from each end (βL = 4.730)
/* the shaft's flex on impact (render-only: the head is where the math says) */
export const BEND_K = .0045, BEND_MAX = .055, BEND_W = 2 * Math.PI * 9, BEND_DECAY = 11;

const q5 = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 + u * (-15 + 6 * u));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth01 = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

/** Rest-to-rest move time for distance d within (V, A) — min-jerk peaks: v = 1.875 d/T, a = 5.7735 d/T². */
export function tNeed(d, V = V_MAX, A = A_MAX){
  d = Math.abs(d);
  return d < 1e-9 ? 0 : Math.max(1.875 * d / V, Math.sqrt(5.7735 * d / A));
}

/* ---- quintic Hermite paths (cyclic) ------------------------------------- */
function herm(sg, t){
  const T = sg.t1 - sg.t0;
  if (T <= 1e-12) return sg.x1;
  const u = clamp((t - sg.t0) / T, 0, 1), u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
  return (1 - 10 * u3 + 15 * u4 - 6 * u5) * sg.x0 + (u - 6 * u3 + 8 * u4 - 3 * u5) * T * sg.v0
       + (-4 * u3 + 7 * u4 - 3 * u5) * T * sg.v1 + (10 * u3 - 15 * u4 + 6 * u5) * sg.x1;
}

/** knots [{t ∈ [0,P), x}] (sorted) → a cyclic path through every knot. Long gaps HOLD,
    then move as late as the limits allow (×1.25 slack); short gaps flow (knot
    velocities = harmonic mean of the neighbouring slopes, 0 at a turn or a hold). */
export function buildPath(knots, P, V, A, fallback = 0, still = null){
  const ks = [];
  for (const k of knots) if (!ks.length || k.t - ks[ks.length - 1].t > 1e-9) ks.push({ t: k.t, x: k.x, still: !!k.still, ref: k.ref });
  if (!ks.length) return { segs: [{ t0: 0, t1: P, x0: fallback, x1: fallback, v0: 0, v1: 0 }], knots: [], vAt: [], pts: [{}] };
  if (ks.length === 1) return { segs: [{ t0: ks[0].t, t1: ks[0].t + P, x0: ks[0].x, x1: ks[0].x, v0: 0, v1: 0 }], knots: ks, vAt: [0], pts: [ks[0]] };
  const pts = [];
  ks.forEach((a, k) => {
    const b = ks[(k + 1) % ks.length], t1 = b.t + (k + 1 === ks.length ? P : 0);
    const dt = t1 - a.t, d = b.x - a.x;
    pts.push({ t: a.t, x: a.x, knot: k, still: a.still, ref: a.ref });
    if (Math.abs(d) > 1e-9){
      const Tm = Math.min(dt, Math.max(.1, 1.25 * tNeed(d, V, A)));
      if (dt > 2 * Tm && dt - Tm > .1) pts.push({ t: t1 - Tm, x: a.x, split: true, ref: a.ref });   // a real rest, then a late move
    }
  });
  const n = pts.length;
  const nxt = i => (i + 1) % n, prv = i => (i - 1 + n) % n;
  const dtTo = (i, j) => { let d = pts[j].t - pts[i].t; if (d <= 0) d += P; return d; };
  // tangents: a run FLOWS through its knots (harmonic mean of the slopes); a turn, or
  // a knot next to a hold, stops there (a servo never overshoots and comes back)
  const base = pts.map((p, i) => {
    if (p.split || p.still || still?.has(i)) return 0;
    const a = pts[prv(i)], b = pts[nxt(i)], d0 = p.x - a.x, d1 = b.x - p.x;
    const m0 = d0 / dtTo(prv(i), i), m1 = d1 / dtTo(i, nxt(i));
    return d0 * d1 > 1e-18 ? clamp(2 * m0 * m1 / (m0 + m1), -.7 * V, .7 * V) : 0;
  });
  const v = pts.map((p, i) => {
    const a = pts[prv(i)], b = pts[nxt(i)];
    return (p.x - a.x) * (b.x - p.x) > 1e-18 ? base[i] : 0;
  });
  const seg = (i, vi, vj) => { const j = nxt(i); return { t0: pts[i].t, t1: pts[i].t + dtTo(i, j), x0: pts[i].x, x1: pts[j].x, v0: vi, v1: vj }; };
  // the tangents are a guess: pick each one (0, .3, .6 or 1 × its base) to keep its two
  // neighbouring legs furthest inside the limits (two sweeps)
  for (let sweep = 0; sweep < 2; sweep++) for (let i = 0; i < n; i++){
    if (!base[i]) continue;
    const p = prv(i);
    let bestV = v[i], bestE = Math.max(legLoad(seg(p, v[p], v[i]), V, A), legLoad(seg(i, v[i], v[nxt(i)]), V, A));
    for (const f of [0, .3, .6, 1]){
      const c = base[i] * f;
      const e = Math.max(legLoad(seg(p, v[p], c), V, A), legLoad(seg(i, c, v[nxt(i)]), V, A));
      if (e < bestE - 1e-6){ bestE = e; bestV = c; }
    }
    v[i] = bestV;
  }
  const segs = pts.map((p, i) => seg(i, v[i], v[nxt(i)]));
  const vAt = ks.map((_, k) => v[pts.findIndex(p => p.knot === k)]);
  return { segs, knots: ks, vAt, pts };
}

/** A leg's peak |v|/V and |a|/A (whichever is worse) — EXACT, in closed form: the
    quintic's acceleration is u·(c1 + c2·u + c3·u²), so |a| peaks at an end or where its
    derivative's quadratic vanishes, and |v| at an end or where that quadratic does. */
export function legLoad(sg, V, A){
  const T = sg.t1 - sg.t0;
  if (T <= 1e-9) return Math.abs(sg.x1 - sg.x0) > 1e-9 ? 1e3 : 0;
  return quinticLoad(sg.x0 - sg.x1, T * sg.v0, T * sg.v1, T, V, A);
}
function quinticLoad(D, a0, a1, T, V, A){
  const c1 = -60 * D - 36 * a0 - 24 * a1, c2 = 180 * D + 96 * a0 + 84 * a1, c3 = -120 * D - 60 * a0 - 60 * a1;
  const kV = 1 / (T * V), kA = 1 / (T * T * A);
  let e = Math.max(Math.abs(a0), Math.abs(a1)) * kV, u = 0;
  e = Math.max(e, Math.abs(c1 + c2 + c3) * kA);
  // |v| extremes where a = 0 (c1 + c2·u + c3·u² = 0), |a| extremes where a' = 0
  for (let pass = 0; pass < 2; pass++){
    const qa = pass ? 3 * c3 : c3, qb = pass ? 2 * c2 : c2, qc = c1;
    let r0 = -1, r1 = -1;
    if (Math.abs(qa) < 1e-12){ if (Math.abs(qb) > 1e-12) r0 = -qc / qb; }
    else { const d = qb * qb - 4 * qa * qc; if (d >= 0){ const r = Math.sqrt(d); r0 = (-qb - r) / (2 * qa); r1 = (-qb + r) / (2 * qa); } }
    for (let k = 0; k < 2; k++){
      u = k ? r1 : r0;
      if (!(u > 0 && u < 1)) continue;
      const u2 = u * u, u3 = u2 * u, u4 = u3 * u;
      e = pass ? Math.max(e, Math.abs(u * (c1 + u * (c2 + u * c3))) * kA)
               : Math.max(e, Math.abs((-30 * u2 + 60 * u3 - 30 * u4) * D + (1 - 18 * u2 + 32 * u3 - 15 * u4) * a0 + (-12 * u2 + 28 * u3 - 15 * u4) * a1) * kV);
    }
  }
  return e;
}

/** Index of the leg of a cyclic path holding loop-local time t (+ the wrapped τ). O(log n). */
export function legAt(path, t, P){
  const S = path.segs;
  let tau = wrapP(t, P);
  if (tau < S[0].t0) tau += P;
  let lo = 0, hi = S.length - 1;
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (S[m].t0 <= tau) lo = m; else hi = m - 1; }
  return [lo, tau];
}
/** Evaluate a cyclic path at loop-local time. O(log n). */
export function pathAt(path, t, P){
  const [i, tau] = legAt(path, t, P);
  return herm(path.segs[i], tau);
}

/* ---- the keyboard layout (local frame, x = low → high) ------------------ */
const NAT = new Set([0, 2, 4, 5, 7, 9, 11]);
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const nameOf = m => NAMES[m % 12] + (Math.floor(m / 12) - 1);

/** Build the keyboard for a set of notes: full chromatic C → C covering them.
    Bar length L ∝ f^−½ (free-free bar of constant section: f ∝ 1/L²), resonator
    ∝ 1/f (quarter wave), both scaled to the station. Returns
    { bars:[{note, m, natural, x, z, top, len, w, thick, res, rank}], lo, hi, slot } */
export function keyboard(notes, { width = 12, x0 = 0, zNat = 1.5, zAcc = -1.5, topNat = 3.3, topAcc = 3.48,
                                  lenMax = 2.75, resMax = 2.75 } = {}){
  const nums = notes.map(noteNum);
  let lo = Math.min(...nums), hi = Math.max(...nums);
  lo -= lo % 12;                                          // down to a C
  hi += (12 - hi % 12) % 12;                              // up to a C
  if (hi - lo < 12) hi = lo + 12;
  const ms = []; for (let m = lo; m <= hi; m++) ms.push(m);
  const nNat = ms.filter(m => NAT.has(m % 12)).length;
  const slot = width / nNat;
  const fLo = noteHz(nameOf(lo));
  let k = 0, lastNatX = x0 - width / 2 - slot / 2;
  const bars = ms.map(m => {
    const natural = NAT.has(m % 12), note = nameOf(m), f = noteHz(note);
    const rank = (m - lo) / Math.max(1, hi - lo);
    let x;
    if (natural){ x = x0 - width / 2 + slot * (k + .5); k++; lastNatX = x; }
    else x = lastNatX + slot / 2;
    const len = Math.max(.6, lenMax * Math.sqrt(fLo / f));
    return { note, m, natural, x, z: natural ? zNat : zAcc, top: natural ? topNat : topAcc,
             len, w: slot * (.9 - .1 * rank), thick: natural ? .17 : .15,
             res: Math.max(.28, resMax * fLo / f), rank };
  });
  return { bars, lo, hi, slot };
}

/** Lane colour hue: rose-magenta in the bass → violet → ice-cyan in the treble. */
export const laneHue = rank => .94 - .42 * rank;

/** The rig geometry for a keyboard: per-row contact heights + the wrist z that puts
    the head exactly on the row's centre line at contact, and the yoke's reach. */
export function rigFor(kb){
  const nat = kb.bars.find(b => b.natural), acc = kb.bars.find(b => !b.natural) || nat;
  const row = b => {
    const yc = b.top + HEAD_R, dy = Y_W - yc;
    return { z: b.z, top: b.top, yc, zw: b.z - Math.sqrt(LS * LS - dy * dy) };
  };
  const F = row(nat), B = row(acc);
  // where each bar is struck: a natural at its centre, a sharp near its front edge
  const contact = kb.bars.map(b => {
    const R = b.natural ? F : B, z = b.natural ? b.z : b.z + b.len * (.5 - EDGE_IN);
    return { z, u: (z - b.z) / b.len, yc: R.yc, zw: z - Math.sqrt(LS * LS - (Y_W - R.yc) ** 2) };
  });
  const sMax = Math.min(7 * kb.slot + .05, 4.4);         // an octave, as far as the tongs reach
  const nCell = 2 * Math.ceil(sMax / (2 * .9));           // lazy-tong cells (even: the carriage holds the middle joint)
  const xs = kb.bars.map(b => b.x);
  return { F, B, contact, sMax, nCell, link: Math.hypot(sMax / nCell, .32), mid: (Math.min(...xs) + Math.max(...xs)) / 2,
           barW: kb.bars.map(b => b.w) };
}

/* ---- allocation ------------------------------------------------------- */
const inner = (h, cx, s) => h === 0 ? cx + Math.max(s / 2 + RH, CAR_W / 2) : cx - Math.max(s / 2 + RH, CAR_W / 2);
const sepOK = (L, R, req = GAP_REQ) => inner(1, R.cx, R.s) - inner(0, L.cx, L.s) >= req - 1e-9;
export const innerExtent = inner;

/** The count-in effective start: a strike in the loop's last instants wraps to just
    after `start` and would open the piece with its own ending — start after it, but
    never so late that the hands can't glide in for a real first strike. */
export function effectiveStart(times, P, start){
  if (!times.length || !isFinite(start)) return start;
  const tail = Math.max(...times) - P + 1e-6;
  const head = Math.min(...times) - T_ENTER - 1e-6;
  return Math.max(start, Math.min(tail, head));
}

/**
 * Solve the whole performance. events = clock.eventTimes(part) (loop-local t, tDur, dur
 * in beats). Returns the plan every pure query below reads.
 */
export function solve(events, { P, start, kb, debug }){
  const rig = rigFor(kb);
  const warns = new Map();
  const warn = (k, msg) => { const w = warns.get(k) || { msg, n: 0 }; w.n++; warns.set(k, w); };
  const barOf = Object.fromEntries(kb.bars.map((b, i) => [b.note, i]));

  // 1. onsets (wrapped loop time; one note per pitch per onset)
  const byT = new Map();
  for (const ev of events){
    if (!(ev.note in barOf)){ warn('range', `note ${ev.note} is not on the keyboard — dropped`); continue; }
    const tw = +wrapP(ev.t, P).toFixed(9);
    let o = byT.get(tw); if (!o){ o = { t: tw, notes: new Map() }; byT.set(tw, o); }
    const prev = o.notes.get(ev.note);
    o.notes.set(ev.note, { note: ev.note, vel: Math.max(prev?.vel ?? 0, ev.vel ?? 1), tDur: Math.max(prev?.tDur ?? 0, ev.tDur || 0),
      roll: (ev.dur || 0) >= ROLL_BEATS - 1e-9 || !!prev?.roll });
  }
  const onsets = [...byT.values()].sort((a, b) => a.t - b.t).map(o => {
    let ns = [...o.notes.values()].map(n => ({ ...n, bar: barOf[n.note], x: kb.bars[barOf[n.note]].x, zw: rig.contact[barOf[n.note]].zw }))
      .sort((a, b) => kb.bars[a.bar].m - kb.bars[b.bar].m);
    if (ns.length > 4){ warn('poly', 'chords of more than 4 notes: inner voices dropped (4 mallets)'); ns = [ns[0], ns[1], ns[ns.length - 2], ns[ns.length - 1]]; }
    return { t: o.t, ns };
  });
  if (!onsets.length) warn('empty', 'no playable notes');

  // 2. allocate: a small deterministic BEAM SEARCH over the onsets. Each step expands every
  //    grip of every hand (incl. a partner mallet WAITING on a note to come, or caught
  //    halfway there), prices each move the way buildPath will draw it, looks ONE onset
  //    ahead, and keeps the BEAM best histories (diverse in sticking). Two cyclic passes,
  //    the second seeded with the first's end state (the seam is just another move).
  for (const o of onsets){ o.roll = Math.max(...o.ns.map(n => n.roll ? n.tDur : 0)); o.groups = groupsOf(o, rig, warn); }
  // what's coming (cyclic): the notes of the next few onsets — where an idle mallet can
  // already be WAITING (the partner pre-positions while its twin strikes)
  onsets.forEach((o, i) => {
    o.future = [];
    for (let j = 1; j <= Math.min(LOOK, onsets.length - 1); j++){
      const f = onsets[(i + j) % onsets.length];
      for (const n of f.ns) o.future.push(n.x);
    }
  });
  onsets.forEach((o, i) => { o.i = i; });
  const groupWarns = new Map(warns);

  // 2b. VERIFY, THEN REPAIR: the beam prices moves with an estimate; the real paths are
  //     then built and measured. Any leg that overruns the drives penalises the grips at
  //     its two ends and the beam runs again — the best measured plan wins.
  const pen = new Map();
  let best = null;
  for (let it = 0; it < REPAIRS; it++){
    const plan = attempt(pen);
    if (!best || plan.score < best.score - 1e-6) best = plan;
    if (plan.score <= 1 + 1e-6) break;
    let any = false;
    for (const H of plan.hands) for (const [path, V, A] of [[H.cxPath, V_MAX, A_MAX], [H.sPath, VS_MAX, AS_MAX]])
      path.segs.forEach((sg, i) => {
        const L = legLoad(sg, V, A);
        if (L <= 1.001) return;
        for (const kn of [path.pts[i].ref, path.pts[(i + 1) % path.pts.length].ref]){
          if (!kn?.key) continue;
          pen.set(kn.key, (pen.get(kn.key) || 0) + 6 + 30 * (L - 1)); any = true;
        }
      });
    if (!any) break;
  }
  return best;

  function attempt(pen){
  const warns = new Map(groupWarns);
  const warn = (k, msg) => { const w = warns.get(k) || { msg, n: 0 }; w.n++; warns.set(k, w); };
  const park = [{ cx: TRAVEL[0] + .3, s: .6 }, { cx: TRAVEL[1] - .3, s: .6 }];
  let seed = park.map(p => ({ t: -1e9, cx: p.cx, s: p.s, still: true, prev: null, estPen: 0, hist: [], last: [-1e9, -1e9], lastZ: [null, null], busy: -1e9 })), bestNode = null;
  for (let pass = 0; pass < PASSES; pass++){
    let beam = [{ H: seed, cost: 0, parent: null, opt: null, o: null }];
    for (const o of onsets){
      const next = [];
      for (const nd of beam) for (const op of options(o, nd.H, rig, o.future, pen))
        next.push({ H: applyPoses(nd.H, op.poses, o), cost: nd.cost + op.cost, parent: nd, opt: op, o });
      next.sort((x, y) => x.cost - y.cost);
      // one node per distinct state (the cheapest history to it)
      const seen = new Set(), uniq = [];
      for (const nd of next){
        const k = nd.H.map(h => `${Math.round(h.cx * 8)}:${Math.round(h.s * 8)}:${(o.t - h.last[0] < T_COMFY) | 0}${(o.t - h.last[1] < T_COMFY) | 0}:${h.lastZ[0] === null ? '-' : Math.round(h.lastZ[0] * 50)}:${h.lastZ[1] === null ? '-' : Math.round(h.lastZ[1] * 50)}`).join('|');
        if (!seen.has(k)){ seen.add(k); uniq.push(nd); if (uniq.length >= 4 * BEAM) break; }
      }
      // ONE STEP OF LOOKAHEAD for the front-runners: what the next onset would cost from
      // here (a grip that's cheap now but leaves the next note out of reach sinks)
      const on = onsets[(o.i + 1) % onsets.length];
      const oN = { ...on, t: o.t + ((on.t - o.t + P) % P || P) };          // the next onset, unwrapped
      uniq.forEach((nd, i) => {
        if (i >= LA_N){ nd.rank = Infinity; return; }
        let m = Infinity;
        for (const op of options(oN, nd.H, rig, on.future, pen)) m = Math.min(m, op.cost);
        nd.rank = nd.cost + LA_W * m;
      });
      uniq.sort((x, y) => x.rank - y.rank || x.cost - y.cost);
      // keep the beam DIVERSE: at most a third of it may share this onset's sticking
      // (which mallets struck), so a cheap-now dead end can't crowd out the way through
      const per = new Map(); beam = [];
      for (const nd of uniq){
        const sig = nd.opt.poses.map(p => p.h + p.hits.map(x => x.m).join('')).join('|');
        if ((per.get(sig) || 0) >= BEAM / 3) continue;
        beam.push(nd); per.set(sig, (per.get(sig) || 0) + 1);
        if (beam.length >= BEAM) break;
      }
    }
    bestNode = beam[0];
    seed = bestNode.H.map(h => ({ ...h, t: h.t - P, prev: h.prev && { ...h.prev, t: h.prev.t - P }, hist: h.hist.map(k => ({ ...k, t: k.t - P })), last: h.last.map(x => x - P), lastZ: [...h.lastZ], busy: h.busy - P,
      rollT0: h.rollT0 === undefined ? undefined : h.rollT0 - P, rollEnd: h.rollEnd === undefined ? undefined : h.rollEnd - P }));
  }
  const chosen = [];
  for (let nd = bestNode; nd && nd.o; nd = nd.parent) chosen.push(nd);
  chosen.reverse();
  const out = { knots: [[], []], rolls: [] };
  for (const { o, opt } of chosen){
    if (opt.drop) warn(opt.drop, opt.drop === 'drop' ? 'a note no hand could reach without crossing — dropped'
      : 'a chord could not be voiced without the hands colliding — dropped');
    else if (!opt.ok) warn('reach', 'a note asked a carriage for more than its limits (played anyway)');
    if (!opt.ok && debug) debug({ t: o.t, notes: o.ns.map(n => n.note), opt });
    for (const ps of opt.poses){
      const kn = { t: o.t, cx: ps.cx, s: ps.s, strike: true, hits: ps.hits, key: poseKey(o.i, ps) };
      out.knots[ps.h].push(kn);
      if (ps.roll){ kn.roll = true; out.rolls.push({ h: ps.h, t: o.t, end: o.t + ps.roll, strokes: rollStrokes(ps, o.t), knot: kn }); }
    }
  }

  // 3. rolls: cut before the hand's next onset; a HOLD knot keeps the hand still while it rolls
  const hands = [0, 1].map(h => ({ h, knots: out.knots[h] }));
  for (const r of out.rolls){
    const ks = out.knots[r.h], i = ks.indexOf(r.knot);
    const nk = ks.length > 1 ? ks[(i + 1) % ks.length] : null;
    const nx = nk ? nk.t + (i + 1 === ks.length ? P : 0) : r.t + P;
    const lim = nx - (nk ? rollRelease(r.knot, nk) : T_REC), kept = r.strokes.filter(s => s.t <= lim - T_REC + 1e-9);
    if (lim - r.t < .5 * (r.end - r.t)) warn('roll', 'a roll was cut short (its hand is needed next)');
    r.strokes = kept.length ? kept : r.strokes.slice(0, 1);
    r.hold = Math.max(r.t, Math.min(r.end, lim));
  }
  for (const r of out.rolls) if (r.hold - r.t > .02)
    hands[r.h].knots = [...hands[r.h].knots, { t: wrapP(r.hold, P), cx: r.knot.cx, s: r.knot.s, strike: false }];

  // 4. per-mallet strike lists (wrapped, sorted) + per-hand paths
  const mallets = [0, 1, 2, 3].map(k => ({ k, h: k >> 1, m: k & 1, strikes: [] }));
  for (const H of hands) for (const kn of H.knots){
    if (!kn.strike || kn.roll) continue;
    for (const ht of kn.hits) mallets[H.h * 2 + ht.m].strikes.push({ t: kn.t, bar: ht.bar, x: ht.x, vel: ht.vel });
  }
  for (const r of out.rolls) for (const s of r.strokes)
    mallets[r.h * 2 + s.m].strikes.push({ t: +wrapP(s.t, P).toFixed(9), bar: s.bar, x: s.x, vel: s.vel, roll: true });
  for (const M of mallets){
    M.strikes.sort((a, b) => a.t - b.t);
    M.strikes = M.strikes.filter((s, i, a) => !(i > 0 && s.t - a[i - 1].t < 1e-7));
    const n = M.strikes.length;
    for (let i = 0; i < n && n > 1; i++){
      const g = i + 1 < n ? M.strikes[i + 1].t - M.strikes[i].t : M.strikes[0].t + P - M.strikes[i].t;
      if (g < T_REC - 1e-9) warn('rec', `a mallet was asked to re-strike faster than ${T_REC} s`);
    }
  }
  for (const H of hands){
    const ts = [...mallets[H.h * 2].strikes, ...mallets[H.h * 2 + 1].strikes].map(s => s.t).sort((a, b) => a - b);
    H.strikeT = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-9);
  }

  const s0 = effectiveStart([...events.filter(ev => ev.note in barOf).map(ev => ev.t),
    ...out.rolls.flatMap(r => r.strokes.map(x => x.t))], P, start);
  for (const H of hands) H.first = H.strikeT.length ? Math.min(...H.strikeT.map(s => s + Math.ceil((s0 - s) / P - 1e-12) * P)) : Infinity;
  for (const H of hands){
    H.knots = H.knots.map(k => ({ ...k, t: +wrapP(k.t, P).toFixed(9) })).sort((a, b) => a.t - b.t || b.strike - a.strike);
    H.knots = H.knots.filter((k, i, a) => !(i > 0 && Math.abs(k.t - a[i - 1].t) < 1e-9));
    H.park = park[H.h]; H.still = [new Set(), new Set()];
    const tf = wrapP(H.first, P);
    // a rolling hand is pinned (its roll's first and last knots never coast), and so is the
    // first note after the count-in (the glide in from the park arrives at rest)
    const still = k => k.roll || !k.strike || Math.abs(k.t - tf) < 1e-6;
    H.build = () => {
      H.cxPath = buildPath(H.knots.map(k => ({ t: k.t, x: k.cx, still: still(k), ref: k })), P, V_MAX, A_MAX, H.park.cx, H.still[0]);
      H.sPath = buildPath(H.knots.map(k => ({ t: k.t, x: k.s, still: still(k), ref: k })), P, VS_MAX, AS_MAX, H.park.s, H.still[1]);
    };
    H.build();
  }
  // a flowing tangent must never carry a hand into the other one (or a yoke out of its
  // range, or a mallet past a tower): wherever it would, those legs' knots stop dead
  // instead; same wherever a flowing leg overruns the limits but a rest-to-rest one wouldn't
  const freeze = (H, k, path, i) => {
    if (path.knots.length < 2) return false;
    let hit = false;
    for (const j of [i, (i + 1) % path.segs.length]) if (!H.still[k].has(j)){ H.still[k].add(j); hit = true; }
    return hit;
  };
  for (let round = 0; round < 6; round++){
    let hit = false;
    for (let t = 0; t < P; t += .005){
      const pose = hands.map(H => ({ cx: pathAt(H.cxPath, t, P), s: pathAt(H.sPath, t, P) }));
      // a small mid-leg brush is the guard's job (handsAt: a smooth push); only a real
      // collision course stops the flowing legs dead
      const sep = !sepOK(pose[0], pose[1], GAP_MIN + GAP_M - SEP_SOFT);
      for (const H of hands){
        const p = pose[H.h];
        const xBad = p.cx - p.s / 2 < MAL_X[0] - 1e-6 || p.cx + p.s / 2 > MAL_X[1] + 1e-6;
        const sBad = p.s < S_MIN - 1e-4 || p.s > rig.sMax + 1e-4;
        if (sep || xBad) hit = freeze(H, 0, H.cxPath, legAt(H.cxPath, t, P)[0]) || hit;
        if (sep || xBad || sBad) hit = freeze(H, 1, H.sPath, legAt(H.sPath, t, P)[0]) || hit;
      }
    }
    for (const H of hands) for (const [path, k, V, A] of [[H.cxPath, 0, V_MAX, A_MAX], [H.sPath, 1, VS_MAX, AS_MAX]])
      path.segs.forEach((sg, i) => {
        if (legLoad(sg, V, A) > 1.001 && legLoad({ ...sg, v0: 0, v1: 0 }, V, A) <= 1.001) hit = freeze(H, k, path, i) || hit;
      });
    if (!hit) break;
    for (const H of hands) H.build();
  }
  // 5. stroke data, and each hand's glide in from its park
  for (const M of mallets) strokeData(M, rig, kb, P);
  for (const H of hands){
    const k = H.cxPath.knots.findIndex(k => Math.abs(k.t - wrapP(H.first, P)) < 1e-6);
    H.firstX = k >= 0 ? H.cxPath.knots[k].x : H.park.cx;
    H.firstS = k >= 0 ? H.sPath.knots[k].x : H.park.s;
    H.firstV = k >= 0 ? H.cxPath.vAt[k] : 0; H.firstVs = k >= 0 ? H.sPath.vAt[k] : 0;
    const need = Math.max(tNeed(H.firstX - H.park.cx), tNeed(H.firstS - H.park.s, VS_MAX, AS_MAX));
    H.depart = Math.max(s0, H.first - Math.max(.35, 1.4 * need));
    if (isFinite(H.first) && H.first - s0 < need - 1e-9) warn('enter', 'a hand cannot glide in from its park in time for its first note');
  }

  // 6. per-bar lanes (any mallet) for the shiver + resonator glow
  const barHits = kb.bars.map(() => []);
  for (const M of mallets) M.strikes.forEach((s, i) => barHits[s.bar].push({ t: s.t, vin: M.vin[i], vel: M.velOut[i], u: rig.contact[s.bar].u }));
  const bars = barHits.map(hs => {
    hs.sort((a, b) => a.t - b.t);
    const u = hs.filter((h, i) => !(i > 0 && h.t - hs[i - 1].t < 1e-7));
    return { hits: u, L: u.length ? laneClock(u.map(h => h.t), P) : null };
  });

  const plan = { P, start: s0, kb, rig, hands, mallets, bars, warnings: [] };
  // 7. verify the motion limits (after the no-cross guard) — warn, don't hide
  const lim = motionStats(plan, .004);
  const over = lim.v > V_MAX * PEAK || lim.a > A_MAX * PEAK || lim.vs > VS_MAX * PEAK || lim.as > AS_MAX * PEAK;
  if (!over) warns.delete('reach');                     // the estimate was cautious: the real motion fits
  plan.warnings = [...warns.values()].map(w => `${w.msg}${w.n > 1 ? ` (×${w.n})` : ''}`);
  if (over) plan.warnings.push(`carriage limits exceeded: |v| ${lim.v.toFixed(1)} |a| ${lim.a.toFixed(0)} · yoke |v| ${lim.vs.toFixed(1)} |a| ${lim.as.toFixed(0)}`);
  plan.stats = lim;
  plan.score = Math.max(lim.v / V_MAX, lim.a / A_MAX, lim.vs / VS_MAX, lim.as / AS_MAX);
  return plan;
  }
}

export const BEAM = 24;
export const REPAIRS = 4;            // verify-and-repair rounds of the allocation
export const PASSES = 2;              // cyclic passes (the seam is just another move)
export const LA_N = 48, LA_W = .8;    // lookahead: how many front-runners, how much the next step weighs
export const HIST = 6;               // knots of the other hand a move is checked against
export const LOOK = 3;               // onsets of lookahead for a waiting partner mallet

/** The static voicing of an onset: null = a single note; else [low group, high group]
    (the closer pair shares a hand; a pair wider than the tongs loses its inner note). */
function groupsOf(o, rig, warn){
  const ns = o.ns;
  if (ns.length < 2) return null;
  let gl, gr;
  if (ns.length === 2){ gl = [ns[0]]; gr = [ns[1]]; }
  else if (ns.length === 3){ if (ns[1].x - ns[0].x <= ns[2].x - ns[1].x){ gl = [ns[0], ns[1]]; gr = [ns[2]]; } else { gl = [ns[0]]; gr = [ns[1], ns[2]]; } }
  else { gl = [ns[0], ns[1]]; gr = [ns[2], ns[3]]; }
  const fix = (g, keep) => {
    if (g.length === 2 && g[1].x - g[0].x > rig.sMax){ warn('span', 'a hand was asked to span more than an octave — inner note dropped'); return [g[keep]]; }
    return g;
  };
  return [fix(gl, 0), fix(gr, 1)];
}

/** Every way the two hands (states H) could play onset o:
    [{ poses:[{h, cx, s, hits, roll}], ok, cost, drop? }] */
function options(o, H, rig, future, pen){
  const P_ = ps => pen.size ? ps.reduce((a, p) => a + (pen.get(poseKey(o.i, p)) || 0), 0) : 0;
  const t = o.t, roll = o.roll, out = [];
  if (!o.groups){
    const n = o.ns[0], pref = n.x < rig.mid ? 0 : 1;
    // low → left, high → right — but in a FAST line the hands simply alternate (how a
    // four-mallet player runs 16ths), so the preference all but vanishes
    const busy = Math.min(t - Math.max(...H[0].last), t - Math.max(...H[1].last));
    const prefW = busy < T_COMFY ? .12 : .8;
    let cands = [0, 1].map(h => grips(n, H[h], rig, roll, undefined, future)), r = roll;
    if (roll && !cands[0].length && !cands[1].length){ r = 0; cands = [0, 1].map(h => grips(n, H[h], rig, 0, undefined, future)); }
    for (const h of [0, 1]) for (const c of cands[h]){
      const oth = { cx: H[1 - h].cx, s: H[1 - h].s };
      if (!(h === 0 ? sepOK(c, oth) : sepOK(oth, c))) continue;
      const f = feas(H[h], c, t, r, H[1 - h], h);
      const poses = [{ h, cx: c.cx, s: c.s, hits: c.hits, roll: r, f }];
      out.push({ poses, ok: f.ok, cost: f.cost + (h !== pref ? prefW : 0) + P_(poses) });
    }
    if (!out.length) out.push({ poses: [], ok: false, cost: 200, drop: 'drop' });
    return out;
  }
  const [gl, gr] = o.groups;
  const rollOf = g => Math.max(...g.map(n => n.roll ? n.tDur : 0));   // each hand rolls only its own long notes
  const rl = rollOf(gl), rr = rollOf(gr);
  const optsL = gl.length === 2 ? [dyad(gl, rig)].filter(Boolean) : grips(gl[0], H[0], rig, rl, 1, future);
  const optsR = gr.length === 2 ? [dyad(gr, rig)].filter(Boolean) : grips(gr[0], H[1], rig, rr, 0, future);
  const ph = rl && rr ? .5 : 0;                        // two hands rolling interleave
  // a two-note chord may also be ONE hand's dyad (thirds in one hand — how it's played),
  // the other hand staying where it is
  const one = o.ns.length === 2 ? dyad(o.ns, rig) : null;
  for (const a of optsL) for (const b of optsR){
    if (!sepOK(a, b)) continue;
    const fa = feas(H[0], a, t, rl, H[1], 0), fb = feas(H[1], b, t, rr, H[0], 1), ok = fa.ok && fb.ok;
    const poses = [{ h: 0, cx: a.cx, s: a.s, hits: a.hits, roll: rl, f: fa }, { h: 1, cx: b.cx, s: b.s, hits: b.hits, roll: rr, f: fb, phase: ph }];
    out.push({ poses, ok, cost: fa.cost + fb.cost + P_(poses) + (one && one.s <= 2 * S_REL ? .3 : 0) });
  }
  if (one) for (const h of [0, 1]){
    const oth = { cx: H[1 - h].cx, s: H[1 - h].s };
    if (!(h === 0 ? sepOK(one, oth) : sepOK(oth, one))) continue;
    const r = o.roll, f = feas(H[h], one, t, r, H[1 - h], h);
    const poses = [{ h, cx: one.cx, s: one.s, hits: one.hits, roll: r, f }];
    out.push({ poses, ok: f.ok, cost: f.cost + P_(poses) + (h !== (one.cx < rig.mid ? 0 : 1) ? .4 : 0) });
  }
  if (!out.length) out.push({ poses: [], ok: false, cost: 400, drop: 'chord' });
  return out;
}

/** A roll's strokes: alternating mallets, evenly through the note's duration. */
function rollStrokes(ps, t0){
  const n = Math.max(2, Math.round(ps.roll / ROLL_DT)), dt = ps.roll / n, ph = ps.phase || 0, out = [];
  const hm = m => ps.hits.find(x => x.m === m) || ps.hits[0];
  const unison = ps.hits.length < 2 || ps.hits[0].bar === ps.hits[1].bar;
  // the ATTACK: the note (both notes of a rolled dyad) struck together at full velocity…
  for (const hh of unison ? [hm(0)] : ps.hits) out.push({ t: t0, m: hh.m, bar: hh.bar, x: hh.x, vel: hh.vel });
  // …then the tremolo SUSTAINS it: alternating mallets, softer (a real roll is felt more
  // than heard), a gentle swell through the middle; a second rolling hand interleaves
  // (after a two-mallet attack both mallets need a breath: the tremolo starts half a stroke late)
  const lag = ph + (unison ? 0 : .5);
  for (let k = 1; k < n; k++){
    if (k + lag > n - .25) break;
    const hh = hm(k % 2);
    out.push({ t: t0 + (k + lag) * dt, m: hh.m, bar: hh.bar, x: hh.x,
               vel: hh.vel * (ROLL_SUS + .1 * Math.sin(Math.PI * k / n)) * (k % 2 ? .94 : 1) });
  }
  return out;
}

const poseKey = (i, p) => `${i}|${p.h}|${p.cx.toFixed(3)}|${p.s.toFixed(3)}`;

/** Both of a hand's mallets on a pair of notes. A pair closer than the tightest grip
    (a natural against its neighbouring sharp, on a wide keyboard) is struck a touch
    off-centre — each head still wholly on its bar — or, if even that won't fit, can't
    be a one-hand dyad (null). */
function dyad(g, rig){
  let x0 = g[0].x, x1 = g[1].x;
  if (x1 - x0 < S_MIN){
    const off = (S_MIN - (x1 - x0)) / 2, room = Math.min(rig.barW[g[0].bar], rig.barW[g[1].bar]) / 2 - HEAD_R - .005;
    if (off > room) return null;
    x0 -= off; x1 += off;
  }
  if (x1 - x0 > rig.sMax + 1e-9) return null;
  return { cx: (x0 + x1) / 2, s: x1 - x0,
           hits: [{ m: 0, bar: g[0].bar, x: x0, vel: g[0].vel, zw: g[0].zw }, { m: 1, bar: g[1].bar, x: x1, vel: g[1].vel, zw: g[1].zw }] };
}

/** Every way a hand in state S can play ONE note n: the partner mallet stays put (the
    grip opens/closes), the whole hand shifts at its current grip, a relaxed grip, a
    tight grip — or, for a ROLL, both heads on the one bar. onlyM restricts the mallet. */
function grips(n, S, rig, roll, onlyM, future = []){
  if (roll){
    if (S_MIN / 2 > rig.barW[n.bar] / 2 - HEAD_R - .005) return [];       // the bar is too narrow for two heads
    return [{ cx: n.x, s: S_MIN,
      hits: [{ m: 0, bar: n.bar, x: n.x - S_MIN / 2, vel: n.vel, zw: n.zw }, { m: 1, bar: n.bar, x: n.x + S_MIN / 2, vel: n.vel, zw: n.zw }] }];
  }
  const out = [], xm = [S.cx - S.s / 2, S.cx + S.s / 2];
  for (const m of [0, 1]){
    if (onlyM !== undefined && m !== onlyM) continue;
    const add = s => {
      if (s < S_MIN - 1e-9 || s > rig.sMax + 1e-9) return;
      const cx = m === 0 ? n.x + s / 2 : n.x - s / 2;
      if (cx < TRAVEL[0] - 1e-9 || cx > TRAVEL[1] + 1e-9 || cx - s / 2 < MAL_X[0] - 1e-9 || cx + s / 2 > MAL_X[1] + 1e-9) return;
      out.push({ cx, s, hits: [{ m, bar: n.bar, x: n.x, vel: n.vel, zw: n.zw }] });
    };
    add(m === 0 ? xm[1] - n.x : n.x - xm[0]);   // partner stays put
    add(S.s);                                   // shift at the current grip
    const D = n.x - xm[m];                      // SHARE the move: the carriage runs .6 of it, the
    add(S.s + (m ? .8 : -.8) * D);              // scissor the rest (both drives equally loaded)
    add(S_REL);                                 // relaxed grip
    add(S_MIN + .12);                           // tight grip (crowded chords)
    const sStay = m === 0 ? xm[1] - n.x : n.x - xm[0];
    for (const xf of future){                   // the partner pre-positions on a note to come…
      const s = m === 0 ? xf - n.x : n.x - xf;
      if (s < S_MIN - 1e-9) continue;
      for (const s2 of [s, (s + sStay) / 2])    // …or is caught halfway there (its move spans two strikes)
        if (out.every(c => c.hits[0].m !== m || Math.abs(c.s - s2) > .02)) add(s2);
    }
  }
  return out;
}

/* ---- pricing a move, the way buildPath will actually draw it ---------------
   The beam prices each new knot with the SAME rules buildPath uses (a long gap rests,
   then moves late; a run flows through its knots at the harmonic-mean slope, a turn
   stops), so the price is the real leg's peak load (legLoad) — no guessing about
   "flow". Adding knot n fixes the tangent at the previous knot c, which makes the leg
   into c EXACT; the leg c → n is an estimate until the next knot arrives. */
function splitT(t0, x0, t1, x1, V, A){
  const dt = t1 - t0, d = x1 - x0;
  if (Math.abs(d) <= 1e-9) return 0;
  const Tm = Math.min(dt, Math.max(.1, 1.25 * tNeed(d, V, A)));
  return dt > 2 * Tm && dt - Tm > .1 ? Tm : 0;
}
/** p = {t, x, v} the knot before (tangent known; null = rested long ago), c = {t, x, still}
    the current knot, n = {t, x, still} the new one → { v (c's tangent), exact, est } */
function axisStep(p, c, n, V, A){
  const sL = p ? splitT(p.t, p.x, c.t, c.x, V, A) : 0, sR = splitT(c.t, c.x, n.t, n.x, V, A);
  const L = !p ? null : sL ? { t: c.t - sL, x: p.x, v: 0 } : p;
  const R = sR ? { t: n.t - sR, x: c.x } : n;
  let base = 0;
  if (!c.still && L){
    const d0 = c.x - L.x, d1 = R.x - c.x;
    if (d0 * d1 > 1e-18){ const m0 = d0 / (c.t - L.t), m1 = d1 / (R.t - c.t); base = clamp(2 * m0 * m1 / (m0 + m1), -.7 * V, .7 * V); }
  }
  const vn = n.still || sR ? 0 : .6 * (n.x - c.x) / Math.max(1e-6, n.t - c.t);
  const legL = v => L ? legLoad({ t0: L.t, t1: c.t, x0: L.x, x1: c.x, v0: L.v, v1: v }, V, A) : 0;
  const legR = v => sR ? legLoad({ t0: R.t, t1: n.t, x0: c.x, x1: n.x, v0: 0, v1: 0 }, V, A)
                       : legLoad({ t0: c.t, t1: n.t, x0: c.x, x1: n.x, v0: v, v1: vn }, V, A);
  let v = 0, e = Infinity, ex = 0, es = 0;
  for (const f of base ? FS : F0){
    const l = legL(f * base), r = legR(f * base), c2 = Math.max(l, r);
    if (c2 < e - 1e-9){ e = c2; v = f * base; ex = l; es = r; }
  }
  return { v, exact: ex, est: es };
}
const FS = [0, .3, .6, 1], F0 = [0];
const loadPen = L => L <= 1 ? .6 * L : 40 + 60 * (L - 1);

/** Can hand state S reach pose c by time t, and at what price? */
function feas(S, c, t, roll, O, h){
  const p = S.prev;
  // a ROLLING hand lets go early when it's needed elsewhere: its hold ends in time to move
  let hold = S.t, cut = 0;
  if (S.rollEnd !== undefined){
    hold = Math.min(S.rollEnd, t - rollRelease(S, c));
    cut = (S.rollEnd - hold) / (S.rollEnd - S.rollT0);
  }
  const ax = axisStep(p && { t: p.t, x: p.cx, v: p.vcx }, { t: hold, x: S.cx, still: S.still }, { t, x: c.cx, still: !!roll }, V_MAX, A_MAX);
  const as = axisStep(p && { t: p.t, x: p.s, v: p.vs }, { t: hold, x: S.s, still: S.still }, { t, x: c.s, still: !!roll }, VS_MAX, AS_MAX);
  const exact = Math.max(ax.exact, as.exact), est = Math.max(ax.est, as.est), estPen = loadPen(est);
  let ok = exact <= 1 + 1e-6 && est <= 1 + 1e-6, hard = false;
  let cost = loadPen(exact) + estPen - (S.estPen || 0) + .08 * Math.abs(c.cx - S.cx) + .02 * Math.abs(c.s - S.s) + 3 * cut;
  for (const ht of c.hits){
    const dm = t - S.last[ht.m], lz = S.lastZ[ht.m];
    if (dm < T_REC - 1e-9) hard = true;
    if (lz !== null && Math.abs(lz - ht.zw) > 1e-6){
      // the forearm moves between the rebound's catch and the first third of the down-stroke (see wristAt)
      const Td = stroke(ht.vel, dm).Td;
      if (tNeed(lz - ht.zw, VZ_MAX, AZ_MAX) > dm - .35 * Td - Math.min(SIG_R, .3 * dm) - 1e-9) hard = true;
      else cost += .1;
    }
    else if (dm < T_COMFY) cost += .5 * (1 - dm / T_COMFY);
  }
  if (S.busy > hold + 1e-9) hard = true;                // a roll keeps at least its first strokes
  if (O && !legClear(S, c, t, O, h)) hard = true;     // the move would run into the other hand
  if (hard){ ok = false; cost += 160; }               // a mallet that can't recover: never, if anything else will do
  return { ok, cost, vcx: ax.v, vs: as.v, estPen, hold };
}

/** How long before its next strike a rolling hand must let go to make the move to c. */
function rollRelease(S, c){
  return Math.max(T_REC, 1.15 * Math.max(tNeed(c.cx - S.cx), tNeed(c.s - S.s, VS_MAX, AS_MAX)));
}

/** Does hand h's move from its last knot to pose c (at t) keep clear of the other hand O
    (its recent knots, held in between)? The move is drawn the way buildPath draws it: a
    long gap rests, then moves late. */
function legClear(S, c, t, O, h){
  const t0 = S.t, dt = t - t0;
  if (!(dt > 1e-6) || !O.hist.length) return true;
  const Tm = Math.max(splitT(t0, S.cx, t, c.cx, V_MAX, A_MAX), splitT(t0, S.s, t, c.s, VS_MAX, AS_MAX));
  const ta = Tm ? t - Tm : t0;
  const H = O.hist;
  // far apart all along? (inner extents are monotone along the move, ≈ the endpoints)
  const sgn = h === 0 ? 1 : -1, mine = Math.max(sgn * inner(h, S.cx, S.s), sgn * inner(h, c.cx, c.s));
  let theirs = Infinity;
  for (let j = 0; j < H.length; j++) if (H[j].t > ta - 2 || j === H.length - 1) theirs = Math.min(theirs, sgn * inner(1 - h, H[j].cx, H[j].s));
  if (theirs - mine > GAP_REQ + .3) return true;
  for (let k = 1; k < 16; k++){
    const tk = ta + (t - ta) * k / 16;
    if (tk < H[0].t) continue;
    let j = H.length - 1; while (j > 0 && H[j].t > tk) j--;
    const a = H[j], b = H[j + 1];
    const f = b ? q5((tk - a.t) / (b.t - a.t)) : 0;
    const po = { cx: a.cx + (b ? (b.cx - a.cx) * f : 0), s: a.s + (b ? (b.s - a.s) * f : 0) };
    const g = q5((tk - ta) / (t - ta));
    const pm = { cx: S.cx + (c.cx - S.cx) * g, s: S.s + (c.s - S.s) * g };
    if (!(h === 0 ? sepOK(pm, po, GAP_REQ + .05) : sepOK(po, pm, GAP_REQ + .05))) return false;   // clear of the guard's zone
  }
  return true;
}

/** New hand states after playing poses at onset o (states are never mutated). */
function applyPoses(H, poses, o){
  const out = H.slice();
  for (const ps of poses){
    const S = H[ps.h], f = ps.f, N = { ...S, last: [...S.last], lastZ: [...S.lastZ] };
    for (const ht of ps.hits) N.lastZ[ht.m] = ht.zw;
    N.prev = { t: f.hold, cx: S.cx, s: S.s, vcx: f.vcx, vs: f.vs };
    N.rollEnd = N.rollT0 = undefined;
    N.hist = [...S.hist.slice(-(HIST - 1)), { t: o.t, cx: ps.cx, s: ps.s }];
    N.t = o.t; N.cx = ps.cx; N.s = ps.s; N.still = false; N.estPen = f.estPen;
    if (ps.roll){
      // a roll pins the hand (a still knot) until its HOLD knot at the roll's end
      const st = rollStrokes(ps, o.t);
      N.busy = o.t + Math.min(ps.roll, ROLL_KEEP); N.prev = { t: o.t, cx: ps.cx, s: ps.s, vcx: 0, vs: 0 };
      N.t = o.t + ps.roll; N.still = true; N.estPen = 0; N.rollT0 = o.t; N.rollEnd = o.t + ps.roll;
      N.hist = [...N.hist, { t: o.t + ps.roll, cx: ps.cx, s: ps.s }];
      for (const m of [0, 1]){ const ls = st.filter(x => x.m === m); if (ls.length) N.last[m] = ls[ls.length - 1].t; }
    } else for (const ht of ps.hits) N.last[ht.m] = o.t;
    out[ps.h] = N;
  }
  return out;
}

/* ---- per-mallet stroke data ------------------------------------------------ */
/** The prep height a strike of velocity vel WANTS (louder = higher): the down-stroke
    from it under the wrist motor's rated throw A_ST lands at vWant = √(2·A_ST·H). */
export const hpWant = vel => HP_MIN + (HP_MAX - HP_MIN) * clamp(vel, 0, 1);
export const A_CAP = 3.5 * A_ST;      // the wrist motor's whip: its peak throw, for fast strokes

/** The stroke into a strike of velocity vel whose mallet had `gap` s since its last
    one. IMPACT SPEED IS THE LOUDNESS: a slow stroke drops from hpWant(vel) at A_ST; a
    fast one has no time for that lift, so the motor WHIPS — a lower prep, thrown harder
    (A = vWant²/2H, the coil shows it) — and still lands at vWant. Only past the motor's
    peak (A_CAP) does the impact fall short, and then the SOUND follows the impact:
    velOut = vel · vin / vWant. The down-stroke gets the share of the gap that keeps the
    rise to the prep no faster than the stroke itself.
    → { Hp, A, Td, vin, vWant, velOut } */
export function stroke(vel, gap){
  const Hu = hpWant(vel), vWant = Math.sqrt(2 * A_ST * Hu);
  const sr = Math.min(SIG_R, .3 * gap);
  const Tb = gap * clamp((gap - sr) / (1.94 * gap), .3, .45);
  let Hp = Math.min(Hu, vWant * Tb / 2), A = vWant * vWant / (2 * Hp), vin = vWant, velOut = clamp(vel, 0, 1);
  if (A > A_CAP){ A = A_CAP; Hp = .5 * A * Tb * Tb; vin = A * Tb; velOut *= vin / vWant; }
  return { Hp, A, Td: 2 * Hp / vin, vin, vWant, velOut };
}
/** Prep height for a strike of velocity vel after `gap` s (see stroke). */
export const prepH = (vel, gap) => stroke(vel, gap).Hp;

function strokeData(M, rig, kb, P){
  const S = M.strikes, n = S.length;
  M.Hp = []; M.Td = []; M.vin = []; M.A = []; M.velOut = []; M.sigR = []; M.vr = []; M.Ac = []; M.hpk = []; M.zw = []; M.yc = [];
  if (!n){ M.L = null; return; }
  M.L = laneClock(S.map(s => s.t), P);
  const gap = i => n === 1 ? P : (i + 1 < n ? S[i + 1].t - S[i].t : S[0].t + P - S[i].t);
  for (let i = 0; i < n; i++){
    const gPrev = gap((i - 1 + n) % n), g = gap(i);
    const k = stroke(S[i].vel, gPrev);
    M.Hp.push(k.Hp); M.Td.push(k.Td); M.vin.push(k.vin); M.A.push(k.A); M.velOut.push(k.velOut);
    const sr = Math.min(SIG_R, .3 * g), vr = E * k.vin;
    M.sigR.push(sr); M.vr.push(vr); M.Ac.push(vr / sr); M.hpk.push(vr * sr / 2);
    const C = rig.contact[S[i].bar];
    M.zw.push(C.zw); M.yc.push(C.yc); S[i].z = C.z;
  }
}

/* ---- pure queries (all fns of songTime t) ----------------------------------- */
/** A hand's raw (unguarded) pose: count-in glide from the park, then the cyclic path. */
function handRaw(plan, H, t){
  const { P } = plan;
  if (t < plan.start) t = plan.start;
  if (t >= H.first) return { cx: pathAt(H.cxPath, t, P), s: pathAt(H.sPath, t, P) };
  if (t <= H.depart) return { cx: H.park.cx, s: H.park.s };
  return { cx: herm({ t0: H.depart, t1: H.first, x0: H.park.cx, x1: H.firstX, v0: 0, v1: H.firstV }, t),
           s: herm({ t0: H.depart, t1: H.first, x0: H.park.s, x1: H.firstS, v0: 0, v1: H.firstVs }, t) };
}

/** Seconds from t to this hand's nearest strike (its "pinnedness"). */
function pinDist(plan, H, t){
  if (!H.strikeT.length) return Infinity;
  if (t < H.first) return H.first - t;
  const s = H.strikeT, P = plan.P, tau = wrapP(t, P), i = lastIndex(s, tau);
  return Math.min(wrapP(tau - s[i], P), wrapP(s[(i + 1) % s.length] - tau, P));
}

const TAU_PIN = .12;
/** Both hands at t, with the NO-CROSS guard: if the inner extents come within the
    margin, push them apart, smoothly (C¹), weighted toward the hand furthest from
    a strike — a hand AT its strike has weight 0, so contact is never moved. */
export function handsAt(plan, t){
  const [HL, HR] = plan.hands;
  const L = handRaw(plan, HL, t), R = handRaw(plan, HR, t);
  const gap = inner(1, R.cx, R.s) - inner(0, L.cx, L.s);
  const def = GAP_MIN + GAP_M - gap;
  if (def > 0){
    const push = def >= 2 * GAP_M ? def - GAP_M : def * def / (4 * GAP_M);
    const fL = smooth01(pinDist(plan, HL, t) / TAU_PIN), fR = smooth01(pinDist(plan, HR, t) / TAU_PIN);
    const wL = fL + fR > 1e-9 ? fL / (fL + fR) : .5;
    L.cx -= wL * push; R.cx += (1 - wL) * push;
  }
  return [L, R];
}

/** The lift of mallet M's head above its contact height (h ≥ 0; exactly 0 at a strike). */
export function liftAt(plan, M, t){
  if (!M.L) return H_ARMED;
  const d = at(M.L, t, plan.start);
  if (d.armed){
    const j = d.next, Hp = M.Hp[j], Td = M.Td[j];
    if (d.until <= Td){ const s = 1 - d.until / Td; return Hp * (1 - s * s); }
    return H_ARMED + (Hp - H_ARMED) * q5(1 - (d.until - Td) / T_XFER);   // raised → the prep
  }
  const i = d.i, j = d.next, Hp = M.Hp[j], Td = M.Td[j], s = d.since;
  if (d.until <= Td){ const p = 1 - d.until / Td; return Hp * (1 - p * p); }   // the down-stroke
  const sr = M.sigR[i];
  if (s <= sr) return M.vr[i] * s - .5 * M.Ac[i] * s * s;                     // lossy rebound, braked
  const T = Math.min(T_XFER, (d.gap - Td) - sr);
  return M.hpk[i] + (Hp - M.hpk[i]) * q5((s - sr) / T);                        // caught → carried to the next prep
}

/** The forearm on its track: { zw (wrist pivot z), yc (the contact height it is
    heading for) } — holds at the strike, moves (a rest-to-rest quintic within the
    slide's limits) only as late as it can while the head is up for the next stroke. */
export function wristAt(plan, M, t){
  if (!M.L) return { zw: plan.rig.F.zw, yc: plan.rig.F.yc };
  const d = at(M.L, t, plan.start);
  if (d.armed) return { zw: M.zw[d.next], yc: M.yc[d.next] };
  const i = d.i, j = d.next;
  if (M.zw[i] === M.zw[j]) return { zw: M.zw[i], yc: M.yc[i] };
  const w1 = Math.max(M.sigR[i] + .02, d.gap - .35 * M.Td[j]);
  const T = Math.min(w1 - M.sigR[i], Math.max(.05, 1.3 * tNeed(M.zw[j] - M.zw[i], VZ_MAX, AZ_MAX)));
  const f = q5((d.since - (w1 - T)) / T);
  return { zw: M.zw[i] + (M.zw[j] - M.zw[i]) * f, yc: M.yc[i] + (M.yc[j] - M.yc[i]) * f };
}

/** Mallet head (x,y,z) + wrist z + lift + shaft angle at t. hs = handsAt(plan, t). */
export function malletAt(plan, k, t, hs = handsAt(plan, t)){
  const M = plan.mallets[k], H = hs[M.h];
  const x = H.cx + (M.m ? .5 : -.5) * H.s;
  const { zw, yc } = wristAt(plan, M, t);
  const h = liftAt(plan, M, t), y = yc + h;
  const sb = clamp((Y_W - y) / LS, -1, 1);
  return { x, y, z: zw + LS * Math.sqrt(1 - sb * sb), zw, h, beta: Math.asin(sb) };
}

/** The strike mallet M most recently left: { d (clock), vin, vel (as SOUNDED: the
    impact's own velocity), since, s (strike) }. */
export function lastHit(plan, M, t){
  if (!M.L) return null;
  const d = at(M.L, t, plan.start);
  if (d.armed) return { d, vin: 0, vel: 0, since: Infinity, s: null };
  return { d, vin: M.vin[d.i], vel: M.velOut[d.i], since: d.since, s: M.strikes[d.i] };
}

/** The wrist motor's drive at t (0…≈1.6): it throws the down-stroke (harder for a whip:
    ∝ its throw A/A_ST) and brakes the rebound as it catches. The coil's glow. */
export function wristDrive(plan, M, t){
  if (!M.L) return 0;
  const d = at(M.L, t, plan.start), j = d.next;
  let drive = 0;
  if (d.until <= M.Td[j]) drive = (1 - .4 * d.until / M.Td[j]) * Math.sqrt(M.A[j] / A_ST);
  if (!d.armed && d.since <= M.sigR[d.i] * 1.6) drive = Math.max(drive, .7 * (1 - d.since / (M.sigR[d.i] * 1.6)));
  return drive;
}

/** Shaft bow (u, perpendicular to the shaft in the stroke plane) — render-only. */
export function bendAt(plan, M, t){
  const lh = lastHit(plan, M, t);
  if (!lh || lh.d.armed) return 0;
  const s = lh.since, F = Math.min(BEND_MAX, BEND_K * lh.vin);
  return F * Math.sin(BEND_W * s) * Math.exp(-s * BEND_DECAY) * Math.max(0, 1 - s / lh.d.gap) ** 2;
}

/** Bar-centre bending deflection (u, negative = down) — the bar's shape is
    centre · −modeShape(u). The STRUCK point goes down first (a sharp struck near its
    end lifts its centre); exactly 0 at every contact, tapered to 0 by the next one. */
export function flexAt(plan, bi, t){
  const B = plan.bars[bi];
  if (!B.L) return 0;
  const d = at(B.L, t, plan.start);
  if (d.armed) return 0;
  const hit = B.hits[d.i], phi = -modeShape(hit.u);           // 1 at the centre, ≈ −1.4 near the ends
  const F = Math.min(FLEX_MAX * Math.min(1, Math.abs(phi)), FLEX_K * hit.vin);
  return -F / phi * Math.sin(FLEX_W * d.since) * Math.exp(-d.since * FLEX_DECAY) * Math.max(0, 1 - d.since / d.gap) ** 2;
}

/** Max |v|, |a| of both carriages (and of both yokes' spread) over the count-in + one
    full loop (after the guard), and the tightest gap between the hands' inner extents. */
export function motionStats(plan, dt = .002){
  let v = 0, a = 0, vs = 0, as = 0, gap = Infinity, sLo = Infinity, sHi = 0, p1 = null, p2 = null;
  const fin = plan.hands.map(H => H.first).filter(isFinite);
  const t1 = Math.max(plan.start, ...fin) + plan.P;
  for (let t = plan.start; t <= t1; t += dt){
    const hs = handsAt(plan, t);
    gap = Math.min(gap, inner(1, hs[1].cx, hs[1].s) - inner(0, hs[0].cx, hs[0].s));
    const p = [hs[0].cx, hs[1].cx, hs[0].s, hs[1].s];
    sLo = Math.min(sLo, p[2], p[3]); sHi = Math.max(sHi, p[2], p[3]);
    if (p1) for (let k = 0; k < 4; k++){
      const vk = Math.abs(p[k] - p1[k]) / dt, ak = p2 ? Math.abs(p[k] - 2 * p1[k] + p2[k]) / (dt * dt) : 0;
      if (k < 2){ v = Math.max(v, vk); a = Math.max(a, ak); } else { vs = Math.max(vs, vk); as = Math.max(as, ak); }
    }
    p2 = p1; p1 = p;
  }
  return { v, a, vs, as, gap, sLo, sHi };
}

/* ---- the bar's true free-free first bending mode -------------------------- */
/** u ∈ [−.5, .5] (0 = centre), normalised so the centre is −1: 0 at the nodes
    (22.4 % from each end), the ends swing the other way at 1.64× the centre.
    (Mirrored in the bar shader as MODE_GLSL.) */
export const BETA_L = 4.730040745;
export const SIGMA = (Math.cosh(BETA_L) - Math.cos(BETA_L)) / (Math.sinh(BETA_L) - Math.sin(BETA_L));
const phi = x => Math.cosh(BETA_L * x) + Math.cos(BETA_L * x) - SIGMA * (Math.sinh(BETA_L * x) + Math.sin(BETA_L * x));
const PHI_C = -phi(.5);
export const modeShape = u => phi(u + .5) / PHI_C;
export const MODE_GLSL = `float modeShape(float u){
  float x = ${BETA_L.toFixed(8)} * (u + .5);
  float e = exp(x), ie = 1. / e;
  return (.5 * (e + ie) + cos(x) - ${SIGMA.toFixed(8)} * (.5 * (e - ie) + sin(x))) / ${PHI_C.toFixed(6)};
}`;
