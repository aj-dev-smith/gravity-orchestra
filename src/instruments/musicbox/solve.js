/* ============================================================
   MUSIC BOX — pure math (no THREE scene, no DOM, no audio).

   THE ONE IDEA: the brass cylinder turns exactly ONE revolution
   per loop, so the cylinder IS the score. A pin for a strike at
   loop time tₛ is seated at drum angle  φ = ψₛ − ω·tₛ  (ω = 2π/P):
   the drum's own rotation θ(t) = ω·t carries it to the slip angle
   ψₛ at exactly tₛ, every loop, forever. No integrator, no drift,
   and the loop seam is a full revolution — seamless by construction.

   One TINE per lane (pitch). A pin only ever touches its own tine;
   tines never touch each other. Fast repeats of one pitch go to a
   TWIN tine tuned the same — exactly what real music-box combs do
   (a tine can't be re-plucked before the last pin has cleared it).

   THE PLUCK, honestly (2-D, in the plane perpendicular to the axis,
   coordinates (y, z), angle ψ measured from +y toward +z — the drum
   turns so its top runs toward the audience):
     · the tine is a steel cantilever whose underside rests on a line
       through its tip T, direction b (tip → base) and normal n (the
       side the pin pushes toward). The line is tilted KAPPA off the
       pin's path, so a rising pin meets it and DRAGS IT UP;
     · pins are FINE STEEL WIRES (seated in glowing beads sunk in the
       drum skin — the beads are the visible score, the wire does the
       work). While a wire is under the tine its tip is the tine's
       floor: the tine takes the cantilever shape for a point load at
       the contact (the lift grows ~linearly as the drum turns);
     · at tₛ the wire's tip passes the tine's END (u = 0) and the tine
       slips off a sharp edge and rings: a damped oscillation released
       from the exact pose AND velocity it had on the wire (C¹: no snap
       in position or speed — the honest snap is in acceleration). (A
       round bead was tried first: the tip rides its back down for a
       tenth of a second, so the "pluck" lands late. Wires are what
       real music boxes use for exactly that reason.)
     · the next pin rising beneath it is the damper: once its tip
       climbs into the tine's swing (REACH below the rest line) it
       touches the ringing tine and kills the ring by the time it reaches
       the rest line, so every pluck starts with the tine resting on its
       pin (contact honest, by construction; no uncaused decay).
     · COUNT-IN: a stop-pin holds the governor fan; it lifts and the
       train spins up from rest (driveTime, C¹) to the score's phase.

   ENERGY: the spring barrel drives the drum; the air-brake governor
   (geared ×GOV to the drum) holds the speed constant; each pluck takes
   a sliver of the drum's energy into the tine. All visible.
   ============================================================ */
import { laneClock, at, eventTimes, wrapP } from '../clock.js';
import { noteHz, noteNum } from '../../engine.js';

export const GEOM = {
  R:     1.5,      // drum surface radius
  RT:    1.88,     // radius of a pin's TIP (a short steel wire standing out of the drum)
  RW:    .026,     // pin wire radius (render)
  BEAD:  .075,     // the glowing bead each pin is seated in, sunk in the drum skin (render)
  DELTA: .14,      // pin tip above the tine's rest line at the slip (the pluck's lift)
  KAPPA: .6,       // tine tilt off the pin's tangent at the slip (rad)
  PSI_S: -.6,      // world angle where pins slip off their tines (back-top of the drum)
  MIN_ANGLE: .13,  // closest two pins may sit on one tine (beads clear + a visible drop)
  L_MAX: 2.8,      // longest (lowest) tine
  L_MIN: 1.15,     // shortest allowed
  GOV: 64,         // governor shaft turns per drum turn
  REACH: .1,       // the incoming pin starts touching (damping) the ringing tine this far below its rest line
  SPIN: 2.0,       // seconds the drive takes to spin up from the brake at the end of the count-in
};

const { RT, DELTA, KAPPA, PSI_S } = GEOM;
const TAU = Math.PI * 2;

/* ---- the tine-line frame (2-D vectors in (y, z)) ---- */
const tau  = [-Math.sin(PSI_S), Math.cos(PSI_S)];         // pin's direction of travel at the slip
const rhat = [ Math.cos(PSI_S), Math.sin(PSI_S)];         // outward radial at the slip
const ck = Math.cos(KAPPA), sk = Math.sin(KAPPA);
export const B = [ck * -tau[0] + sk * rhat[0], ck * -tau[1] + sk * rhat[1]];   // tip → base
export const N = [ck * rhat[0] + sk * tau[0],  ck * rhat[1] + sk * tau[1]];    // the pin pushes along +N
const CS = [RT * rhat[0], RT * rhat[1]];                  // pin tip at the slip
export const T = [CS[0] - DELTA * N[0], CS[1] - DELTA * N[1]];   // tine tip (underside), axis-relative
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Drum rotation at DRIVE time t (about +x; +y turns toward +z). One revolution per loop. */
export const cylAngle = (t, P) => TAU * t / P;

/* ---- the COUNT-IN: parked on the governor's brake, then a constant-torque spin-up ----
   During the count-in the stop-pin holds the governor fan, so the whole train is parked.
   The brake lifts at t = −Ts and the mainspring spins it up with constant acceleration,
   reaching exactly full speed AND exactly the score's phase at t = 0:
       g(t) = −Ts/2                       t ≤ −Ts   (parked)
       g(t) = (t + Ts)²/(2Ts) − Ts/2      −Ts < t < 0
       g(t) = t                           t ≥ 0
   g is C¹ (g' = 0 at the release, 1 at t = 0), so every wheel starts from rest — no
   instant jump in speed. The drive time g(t) replaces songTime everywhere (cylinder,
   pins, tines, gears). Ts = min(SPIN, −start): the spin-up always fits in the count-in. */
export const spinTime = start => (start < 0 ? Math.min(GEOM.SPIN, -start) : 0);
export function driveTime(t, Ts){
  if (!(Ts > 0) || t >= 0) return t;
  if (t <= -Ts) return -Ts / 2;
  return (t + Ts) * (t + Ts) / (2 * Ts) - Ts / 2;
}
/** d(driveTime)/dt: the drive's speed as a fraction of full (0 parked → 1 running). */
export const driveRate = (t, Ts) => (!(Ts > 0) || t >= 0) ? 1 : t <= -Ts ? 0 : (t + Ts) / Ts;
/** The drive time at which the parked box sits (strikes before it never happened). */
export const driveStart = (start, Ts) => (Ts > 0 ? -Ts / 2 : start);
/** The release angle: a pin's tip passes the tine's END here (u = 0). */
export const PSI_R = PSI_S;
/** Drum-frame angle at which the pin for loop time ts is seated: it reaches the release
    angle exactly at ts. */
export const pinPhase = (ts, P) => PSI_R - TAU * ts / P;
/** World angle of a pin seated at phase φ, at songTime t. */
export const pinWorld = (phi, t, P) => phi + cylAngle(t, P);

/** A pin TIP at angle offset D from its release (D < 0: still coming) in the tine frame:
    u = distance from the tine's tip measured toward the base (u > 0: under the tine),
    hc = height above the tine's rest line. Pins are fine wires: the contact is their tip. */
export function pinGeo(D){
  const p = PSI_R + D, c = [RT * Math.cos(p) - T[0], RT * Math.sin(p) - T[1]];
  return { u: dot(c, B), hc: dot(c, N) };
}

/* ---- cantilever shapes: deflection of the underside at x (0 = clamped base, Lt = tip) ---- */
/** Tip-load (first-mode) shape, normalised to 1 at the tip. */
export const phi1 = (x, Lt) => x * x * (3 * Lt - x) / (2 * Lt * Lt * Lt);
/** Deflection under a point load that lifts the tine by ya at x = a. */
export function pointLoad(x, a, ya){
  if (x <= a) return ya * x * x * (3 * a - x) / (2 * a * a * a);
  return ya * (1 + 1.5 * (x - a) / a);
}
/** The tine's underside deflection at x for a state from tineAt. */
export function shapeAt(x, st, Lt){
  return st.mode === 'pin' ? pointLoad(x, st.a, st.ya) : st.w * phi1(x, Lt);
}

/* ---- the comb: events → tines (lanes) ---- */
/** Tine length for a pitch: a cantilever's f ∝ 1/L², so L ∝ f^−½ (lowest = L_MAX). */
export const tineLen = (f, fLo) => Math.max(GEOM.L_MIN, GEOM.L_MAX * Math.sqrt(fLo / f));

/** Split one pitch's sorted unique strike times across k ≥ 1 twin tines (round-robin)
    so every tine's cyclic gaps are ≥ minGap. Returns [[times…]…]. */
export function splitTwins(times, P, minGap){
  const n = times.length;
  for (let k = 1; k <= 4; k++){
    const sets = Array.from({ length: k }, (_, j) => times.filter((_, i) => i % k === j)).filter(s => s.length);
    const ok = sets.every(s => s.every((si, i) => ((i + 1 < s.length ? s[i + 1] : s[0] + P) - si) >= minGap - 1e-9));
    if (ok || k === 4 || k >= n) return sets;
  }
}

/** The whole comb. part = [[beat, note, vel?]…]. Returns { lanes, omega }: each lane is a
    tine { note, twin, f, rank, len, L (lane clock), vel[] (per L.s), fv, kd }. */
export function buildComb(part, { rollT, beat, P }){
  const omega = TAU / P, minGap = GEOM.MIN_ANGLE / omega;
  const evs = eventTimes(part, { rollT, beat });
  const byNote = {};
  for (const e of evs){
    const s = +wrapP(e.t, P).toFixed(9);
    const m = (byNote[e.note] ||= new Map());
    m.set(s, Math.max(m.get(s) ?? 0, e.vel));
  }
  const notes = Object.keys(byNote).sort((a, b) => noteNum(a) - noteNum(b));
  if (!notes.length) return { lanes: [], omega };
  const fLo = noteHz(notes[0]), fHi = noteHz(notes[notes.length - 1]);
  const lanes = [];
  for (const note of notes){
    const m = byNote[note], times = [...m.keys()].sort((a, b) => a - b);
    const f = noteHz(note);
    const rank = fHi > fLo ? Math.log(f / fLo) / Math.log(fHi / fLo) : .5;
    splitTwins(times, P, minGap).forEach((set, twin) => {
      const L = laneClock(set, P);
      lanes.push({ note, twin, f, rank, len: tineLen(f, fLo), L, vel: L.s.map(s => m.get(s) ?? 1),
        fv: 18 + 10 * rank,               // visible ring (Hz): fast enough to alias into a steel shimmer at 60 fps
        kd: 2.2 + 2.2 * rank });          // ring decay (1/s) — high tines die quicker, like the voice
    });
  }
  return { lanes, omega };
}

/* ---- the tine at songTime t ---- */

/** A pin under the tine (0 < u < Lt) is a point load lifting x = a to ya; else null. */
function contact(D, Lt){
  if (D > 1e-9 || D < -1.2) return null;                   // (a hair of slack: float noise at the strike instant)
  const { u, hc } = pinGeo(D);
  if (u < -1e-9 || u >= Lt) return null;
  const a = Lt - Math.max(0, u);
  return { a, ya: hc, tip: hc * (3 * Lt - a) / (2 * a) };
}
/** Tip velocity per unit drum angle the instant before the release (the ring inherits it). */
function releaseRate(Lt){
  const h = 1e-6;
  return (contact(-h, Lt).tip - contact(-3 * h, Lt).tip) / (2 * h);
}

/** The next pin (angle offset Dn from its release; Dg = where it was at the last release)
    damping the ring: 1 = free, 0 = fully damped. It touches the swing from REACH below the
    rest line (or from wherever it already was at the release, so the release stays C¹). */
export function damper(Dn, Dg, Lt){
  const g = pinGeo(Dn);
  if (g.u <= 0 || g.u >= Lt) return 1;
  const g0 = pinGeo(Dg);
  const lo = Math.max(-GEOM.REACH, (g0.u > 0 && g0.u < Lt) ? g0.hc : -Infinity);
  if (lo >= -1e-6) return 1;                               // already on the rest line: the floor takes it
  const x = Math.min(1, Math.max(0, (g.hc - lo) / -lo));
  return 1 - x * x * (3 - 2 * x);
}

/** The tine for `lane` at DRIVE time t (see driveTime).
    → { w (tip deflection), mode: 'rest'|'ring'|'pin', a, ya (load point/height), env (ring
        envelope 0..1, for glow), i, since, until, armed, next }. Pure fn of t. */
export function tineAt(lane, t, start, omega){
  const { L, len } = lane;
  const c = at(L, t, start);
  let st = { w: 0, mode: 'rest', a: len, ya: 0 }, env = 0;
  if (!c.armed){
    // the RING: released from the pin's tip with exactly the pose and velocity it had
    // riding it (C¹), decaying. The only extra damping has a visible cause: the NEXT pin
    // rising into the tine's swing touches it (from REACH below the rest line) and kills
    // the ring by the time it reaches the rest line — so every pluck starts with the tine
    // resting on its pin (contact honest, by construction).
    const s = c.since, Om = TAU * lane.fv, k = lane.kd;
    const V = ((lane._V ||= new Map()).get(omega)) ?? (lane._V.set(omega, releaseRate(len) * omega), lane._V.get(omega));
    const dec = Math.exp(-k * s);
    env = dec * damper(-omega * c.until, -omega * c.gap, len);
    const w = env * (DELTA * Math.cos(Om * s) + (V + k * DELTA) / Om * Math.sin(Om * s));
    st = { w, mode: 'ring', a: len, ya: w, amp: env * Math.hypot(DELTA, (V + k * DELTA) / Om) };
  }
  // the next pin rising beneath is the tine's floor: it rests on the pin if the pin is higher
  const kk = contact(-omega * c.until, len);
  if (kk && shapeAt(kk.a, st, len) < kk.ya) st = { w: kk.tip, mode: 'pin', a: kk.a, ya: kk.ya };
  return { ...st, amp: st.mode === 'ring' ? st.amp : 0, env, i: c.i, since: c.since, until: c.until, armed: c.armed, next: c.next };
}

/** Tip position (axis-relative (y, z)) for a tip deflection w. */
export const tipPos = w => [T[0] + w * N[0], T[1] + w * N[1]];
/** Point of the tine underside at x (from base) for a state — axis-relative (y, z). */
export function tinePoint(x, st, Lt){
  const y = shapeAt(x, st, Lt), back = Lt - x;
  return [T[0] + back * B[0] + y * N[0], T[1] + back * B[1] + y * N[1]];
}
