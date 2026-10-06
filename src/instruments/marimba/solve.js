/* ============================================================
   MARIMBA — pure math (no THREE scene, no DOM, no audio).

   THE MECHANISM (one conserved marble per pitch — lanes never touch):
   · Every played bar owns ONE small marble that only ever bounces on
     the CENTRE of that bar (its antinode — where a real mallet strikes).
     The flight between two strikes of that pitch is the solved vertical
     arc for the gap (engine dribbleAt: apex = |G|·gap²/8).
   · A gap too long to fly ends on an ELECTROMAGNET hung on the overhead
     gantry at exactly the max apex H: the marble arrives at v = 0, is
     held, and is released so its free fall lands on the beat. At the
     count-in every marble hangs there, loaded (ARMED).
   · Real = lossy: a bounce keeps only e of its speed. The difference is
     supplied by the bar's own SUSPENSION — each bar rests on its two NODE
     points (22.4 % in from each end, where its first bending mode doesn't
     move — the real marimba cord points) and each node rides a tiny
     SOLENOID plunger. Both plungers kick together (engine dribblePiston:
     exactly 0 at contact, per-gap compressed, catch-capped).
   · The bar then RINGS: its first free-free bending mode (centre down,
     ends up), a pure fn of time since the strike, tapered to exactly
     zero by the next contact so every landing meets a flat, still bar.
   Time is the only state.
   ============================================================ */
import { G, dribbleLane, dribbleAt, dribblePiston, firstStrike, noteHz, noteNum } from '../../engine.js';

export const g       = -G.y;          // |gravity|
export const DT_MAX  = 1.3;           // longest flown gap (s) — 2-beat gaps at 100 bpm still FLY
export const H       = g * DT_MAX * DT_MAX / 8;   // magnet height above the bar top (ball underside) ≈ 3.06
export const E       = .6;            // restitution marble ↔ rosewood
export const KICK_K  = .05;           // plunger travel per unit Δv
export const KICK_MAX = .16;          // plunger travel clamp (u) — |kick| never exceeds this
export const FLEX_K  = .0045;         // bar-centre deflection per unit impact speed…
export const FLEX_MAX = .035;         // …capped (u): a rosewood SHIVER, not a rubber bend
export const FLEX_W  = 2 * Math.PI * 14;    // visible stand-in for the (audio-rate) first mode (rad/s)
export const FLEX_DECAY = 10;         // ring-down (1/s)
export const NODE    = .2242;         // first-mode node, fraction of length from each end (βL = 4.730)

/* The node SOLENOID stack under each bar (u). The plunger pad carries the bar's
   underside; the rod slides in the barrel. Sized so that over the full kick travel
   (|off| ≤ KICK_MAX) the pad never meets the barrel and the rod never leaves it
   through either end (tested). */
export const PAD_T   = .03;           // rubber pad on the plunger tip
export const PLUNGE  = .2;            // plunger exposed between pad and barrel at rest
export const SOL_H   = .4;            // solenoid barrel height
export const ROD     = .4;            // plunger rod length

/* ---- lanes ---------------------------------------------------------- */
/** part events (from clock.eventTimes) → one lane per note:
    { note, L (dribble lane), vel[i] (per unique strike), first (abs) } */
/** The count-in start the lanes actually use. A strike near the END of the loop wraps
    to just after `start` (songTime starts at −LEAD_IN), which would open the piece with
    its own final chord. So start the lanes after the last wrapped-tail strike — but never
    so late that a lane's real first strike (incl. negative-beat pickups) can't drop from
    its magnet. Before it, every marble hangs loaded on its magnet (ARMED). */
export function effectiveStart(events, P, start){
  if (!events.length || !isFinite(start)) return start;
  const ts = events.map(e => e.t);
  const tail = Math.max(...ts) - P + 1e-6;               // after this, every wrapped tail strike is gone
  const head = Math.min(...ts) - DT_MAX / 2 - 1e-6;      // …and every real first strike still drops from H
  return Math.max(start, Math.min(tail, head));
}

export function makeLanes(events, P, start){
  start = effectiveStart(events, P, start);
  const by = {};
  for (const ev of events) (by[ev.note] ||= []).push(ev);
  const wrap = t => ((t % P) + P) % P;
  return Object.entries(by).map(([note, evs]) => {
    const L = dribbleLane(evs.map(e => e.t), P, { dtMax: DT_MAX });
    const vel = L.s.map(s => Math.max(...evs.filter(e => Math.abs(wrap(e.t) - s) < 1e-7).map(e => e.vel)));
    return { note, L, vel, start, first: firstStrike(L, start) };
  });
}

/** The marble: { y (underside above the bar's REST top), vy, mode, i, since, until } */
export const ballAt = (L, t, start) => dribbleAt(L, t, start);

/** The node plungers' travel (both nodes move together = the whole bar lifts). */
export const kickAt = (L, t, start) => dribblePiston(L, t, { e: E, k: KICK_K, maxA: KICK_MAX, start });

/** Impact speed of the strike the marble most recently left (d = ballAt result). */
export function impactSpeed(L, d, t, start){
  if (d.i < 0) return 0;
  const first = firstStrike(L, start);
  return Math.abs(t - d.since - first) < 1e-6 ? g * DT_MAX / 2 : L.vIn[d.i];
}

/** Bar-centre bending deflection (u, negative = centre down) at songTime t.
    Starts at exactly 0 on contact (sin), first lobe DOWN (the marble pushes it),
    decays, and is tapered to exactly 0 by the next strike. */
export function flexAt(L, t, start, d = ballAt(L, t, start)){
  if (d.i < 0) return 0;
  const s = d.since, gap = d.since + d.until;
  const F = Math.min(FLEX_MAX, FLEX_K * impactSpeed(L, d, t, start));
  const taper = Math.max(0, 1 - s / gap) ** 2;
  return -F * Math.sin(FLEX_W * s) * Math.exp(-s * FLEX_DECAY) * taper;
}

/** The TRUE free-free first bending mode along the bar (Euler–Bernoulli, βL = 4.7300),
    u ∈ [−.5, .5] (0 = centre), normalised so the centre is −1: 0 at the nodes
    (22.4 % from each end), the ends swing the other way at 1.64× the centre.
    (Mirrored in the bar shader as MODE_GLSL.) */
export const BETA_L = 4.730040745;                       // root of cos·cosh = 1
export const SIGMA = (Math.cosh(BETA_L) - Math.cos(BETA_L)) / (Math.sinh(BETA_L) - Math.sin(BETA_L));
const phi = x => Math.cosh(BETA_L * x) + Math.cos(BETA_L * x) - SIGMA * (Math.sinh(BETA_L * x) + Math.sin(BETA_L * x));
const PHI_C = -phi(.5);                                  // ≈ 1.2178
export const modeShape = u => phi(u + .5) / PHI_C;
export const MODE_GLSL = `float modeShape(float u){
  float x = ${BETA_L.toFixed(8)} * (u + .5);
  float e = exp(x), ie = 1. / e;
  return (.5 * (e + ie) + cos(x) - ${SIGMA.toFixed(8)} * (.5 * (e - ie) + sin(x))) / ${PHI_C.toFixed(6)};
}`;

/** The bar's TOP surface at the centre (where the marble lands), relative to rest. */
export const barTopAt = (L, t, start, d) => kickAt(L, t, start) + flexAt(L, t, start, d);

/* ---- the keyboard layout (local frame, x = low → high) ------------- */
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

/** Marble radius for a bar (a heavier marble for the bass — mass reads as size). */
export const ballR = rank => .18 - .06 * rank;

/** Lane colour hue: rose-magenta in the bass → violet → ice-cyan in the treble. */
export const laneHue = rank => .94 - .42 * rank;
