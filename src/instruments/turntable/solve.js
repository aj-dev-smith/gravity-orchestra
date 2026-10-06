/* ============================================================
   TURNTABLE — pure math (no THREE scene, no DOM, no audio).

   The conveyor belt's sibling, in a circle: ONE immortal marble
   READS A RECORD like a stylus.

   · A platter spins at CONSTANT ω (after a C¹ spin-up in the count-in)
     with an INTEGER number N of revolutions per loop P — so it loops by
     construction. Concentric RINGS are a pitch staff: radius encodes
     pitch (low = outer). Pad SIZE encodes register through the engine's
     pitchSize law (a pure fn of the note — never of layout).
   · Every note OCCURRENCE owns a pad seated on its ring at platter angle
     φ = A_S − ω·tₛ, so the platter's own rotation carries it onto the
     STRIKE LINE (the radial ray at azimuth A_S) at exactly tₛ, every loop
     (the belt's beltPhase, in angular form: δ = ω·(t − tₛ) = 0 at a strike).
   · The marble chains the (monophonic) part like the belt: each arc is
     solveLaunch(Cᵢ, Cᵢ₊₁, gap) in the vertical plane of the strike line,
     so it only ever moves RADIALLY (hopping rings) and vertically. The
     chain is CYCLIC (last → first closes the seam) — it reads forever.
   · A gap too long to fly (> DT_MAX) is a PARK: the marble rises to an
     electromagnet on the tonearm CARRIAGE at exactly the max apex, kissing
     it at zero vertical speed, is carried at the arc's own constant radial
     speed u (no horizontal impulse anywhere in the gap), and released so the
     free fall lands on the beat. The seam is always a park, and the count-in
     is the same park: the marble hangs ARMED on the magnet, the carriage
     accelerates from rest to u, and releases it exactly as in steady state.
   · Pads are tilted to the bounce normal (bisects in/out) and ride a
     flipper stroke along it (padOffset: 0 at contact) sized by the energy
     a lossy bounce can't supply: Δv = vout·n − e·vin·n.
   · RECIRCULATION: a pad only exists for its pass. It slides out flush from
     under the rear COWL, telescopes up + tips to its normal, strikes, then
     retracts flush and goes back under the cowl to be re-tuned (hidden).
   · Fast runs: pads deployed together must clear. Solved like the belt —
     by GEOMETRY (choose the smallest integer N whose rim speed separates
     them), never by shrinking pads.

   Local frame (stations.js): +x across, +y up, +z toward the audience.
   World azimuth a: x = r·cos a, z = r·sin a; a increases CLOCKWISE seen
   from above (a real record). 2-D strike-plane coords: s = radius along
   the strike ray, y = height.
   ============================================================ */
import { G, noteNum, PAD_R, pitchSize, padOffset } from '../../engine.js';
import { eventTimes, laneClock, at, wrapP, lastIndex, smooth } from '../clock.js';

export const g = -G.y;
const TAU = Math.PI * 2;

export const GEOM = {
  R_IN: 2.0,        // innermost ring (highest note)
  R_OUT: 5.1,       // outermost ring (lowest note)
  R_PLAT: 5.95,     // platter radius
  R_LABEL: 1.45,    // centre label radius
  Y_PLAT: 1.6,      // platter top surface (local y)
  LIFT: .78,        // deployed pad top above the platter
  PAD_T: .09,       // pad disc thickness
  RM: .24,          // marble radius
  A_S: Math.PI,     // strike azimuth: the ray toward −x (hops read left↔right)
  A_COWL: -Math.PI / 2,   // the cowl sits at the back (−z)
  COWL_HALF: .52,   // its half-width (rad)
  DT_MAX: 1.45,     // longest flown gap (s); longer gaps park on the magnet
  PAD_SCALE: .74,   // pad radius = PAD_R·PAD_SCALE·pitchSize
  CLEAR: 1.1,       // deployed neighbours keep ≥ (ρa+ρb)·CLEAR apart
  RIM_MIN: 2.4,     // slowest allowed rim speed at the mid ring (u/s)
  RIM_MAX: 10,      // fastest allowed rim speed at the outer ring (u/s)
  DEPLOY: .75,      // rad of travel after leaving the cowl to rise + tip
  RETRACT: .5,      // rad of travel to fold flush before the cowl
  E: .7,            // restitution marble ↔ pad
  KICK_K: .07,      // stroke amplitude per unit Δv
  KICK_MAX: .45,    // stroke clamp (u)
  SPIN: 2.0,        // seconds the platter takes to spin up in the count-in
  MIN_GAP: .06,     // events closer than this (s) are merged (monophonic chain)
};
const { R_IN, R_OUT, Y_PLAT, LIFT, RM, DT_MAX } = GEOM;
export const Y_S = Y_PLAT + LIFT;                       // pad top at the strike
export const H_ARC = g * DT_MAX * DT_MAX / 8;           // max flown apex above a contact
export const Y_C = Y_S + RM;                            // marble centre at every strike
export const Y_M = Y_C + H_ARC;                         // marble centre when held on the magnet
/** The tonearm rail along the strike ray: the carriage's travel (s, from the spindle). */
export const RAIL = { S0: 1.0, S1: 6.4 };
export const PRE  = 3 * Math.PI / 2 - GEOM.COWL_HALF;   // rad from leaving the cowl to the strike line
export const POST = Math.PI / 2 - GEOM.COWL_HALF;       // rad from the strike line to the cowl

/* ---- the count-in spin-up (constant torque, C¹; full speed + score phase at t = 0) ---- */
export const spinTime = start => (start < 0 ? Math.min(GEOM.SPIN, -start) : 0);
export function driveTime(t, Ts){
  if (!(Ts > 0) || t >= 0) return t;
  if (t <= -Ts) return -Ts / 2;
  return (t + Ts) * (t + Ts) / (2 * Ts) - Ts / 2;
}
export const driveRate = (t, Ts) => (!(Ts > 0) || t >= 0) ? 1 : t <= -Ts ? 0 : (t + Ts) / Ts;

/* ---- the staff ---- */
export function staff(notes){
  const nums = notes.map(noteNum);
  const loN = Math.min(...nums), hiN = Math.max(...nums), span = Math.max(1, hiN - loN);
  const ringR = note => hiN === loN ? (R_IN + R_OUT) / 2 : R_OUT - (noteNum(note) - loN) / span * (R_OUT - R_IN);
  const padR = note => PAD_R * GEOM.PAD_SCALE * pitchSize(note, loN, span);   // layout-invariant
  return { loN, hiN, span, ringR, padR };
}

/** The monophonic chain: one event per strike time (a chord keeps its TOP note, the
    loudest velocity); events closer than MIN_GAP merge into the earlier one. */
export function chainEvents(part, { rollT, beat, P }){
  const evs = eventTimes(part, { rollT, beat }).map(e => ({ ...e, s: +wrapP(e.t, P).toFixed(9) }))
    .sort((a, b) => a.s - b.s || noteNum(b.note) - noteNum(a.note));
  const out = [];
  for (const e of evs){
    const last = out[out.length - 1];
    if (last && e.s - last.s < GEOM.MIN_GAP){ last.vel = Math.max(last.vel, e.vel); continue; }
    out.push({ note: e.note, vel: e.vel, s: e.s, tDur: e.tDur });
  }
  if (out.length > 1 && out[0].s + P - out[out.length - 1].s < GEOM.MIN_GAP) out.pop();
  return out;
}

/** Chord between two pads on rings ra, rb whose platter angles differ by dφ. */
const chord = (ra, rb, dphi) => Math.sqrt(Math.max(0, ra * ra + rb * rb - 2 * ra * rb * Math.cos(dphi)));

/** Every pair of pads that are ever deployed together, with their separation for a given ω.
    A pad is out for δ ∈ [−PRE, POST]; two pads whose strikes are Δ apart (any loop shift)
    coexist iff ω·|Δ| < PRE + POST. They ride the platter rigidly, so their distance is the
    constant chord. Returns the worst clearance ratio (≥ 1 = clear). */
export function clearance(evs, P, omega){
  let worst = Infinity, pair = null;
  const W = PRE + POST, n = evs.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++){
    const d0 = evs[j].s - evs[i].s;
    for (const D of [d0, d0 - P, d0 + P]){
      const dphi = omega * Math.abs(D);
      if (dphi >= W) continue;
      const need = (evs[i].rho + evs[j].rho) * GEOM.CLEAR;
      const ratio = chord(evs[i].S[0], evs[j].S[0], dphi) / need;
      if (ratio < worst){ worst = ratio; pair = [i, j]; }
    }
  }
  return { worst, pair };
}

/** Choose the integer revolutions per loop: the slowest that clears every deployed pair. */
export function chooseOmega(evs, P){
  const rMid = (R_IN + R_OUT) / 2;
  const nMin = Math.max(1, Math.ceil(GEOM.RIM_MIN / rMid * P / TAU));
  const nMax = Math.max(nMin, Math.floor(GEOM.RIM_MAX / R_OUT * P / TAU));
  let best = null;
  for (let N = nMin; N <= nMax; N++){
    const omega = TAU * N / P, c = clearance(evs, P, omega);
    if (!best || c.worst > best.worst) best = { N, omega, worst: c.worst };
    if (c.worst >= 1) return { N, omega, worst: c.worst, ok: true };
  }
  return { ...best, ok: false };
}

/* 2-D helpers (s, y) */
const nrm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Build the record. part = [[beat, note, vel?]…]. */
export function buildRecord(part, { rollT, beat, P, start = -Infinity }){
  const evs = chainEvents(part, { rollT, beat, P });
  const n = evs.length;
  const R = { evs, n, P, start, Ts: spinTime(start) };
  if (!n) return Object.assign(R, { omega: TAU / P, N: 1, L: laneClock([], P), first: Infinity });
  const st = staff(evs.map(e => e.note));
  R.staff = st;
  for (const e of evs){ e.r = st.ringR(e.note); e.rho = st.padR(e.note); }
  R.L = laneClock(evs.map(e => e.s), P);              // same order as evs (sorted, unique)
  const gaps = R.L.gaps;

  // ---- the chain: the marble's centre at every strike sits ON its ring, at one height
  //      (Cᵢ = (rᵢ, Y_C)); the pad is placed under it along its bounce normal
  //      (top-face centre Sᵢ = Cᵢ − RM·nᵢ), so the arcs never depend on the tilt ----
  for (const e of evs) e.C = [e.r, Y_C];
  for (let i = 0; i < n; i++){
    const a = evs[i], b = evs[(i + 1) % n], T = gaps[i];
    a.gap = T;
    a.tUp = Math.sqrt(2 * (Y_M - a.C[1]) / g);
    b.tDn = Math.sqrt(2 * (Y_M - b.C[1]) / g);
    a.park = T > a.tUp + b.tDn + 1e-9;
    a.u = (b.C[0] - a.C[0]) / T;                          // radial speed: constant over the whole gap
    if (a.park){
      a.vOut = [a.u, g * a.tUp];
      b.vIn = [a.u, -g * b.tDn];
    } else {
      a.vOut = [a.u, (b.C[1] - a.C[1] + .5 * g * T * T) / T];
      b.vIn = [a.u, a.vOut[1] - g * T];
    }
  }
  for (const e of evs){
    const vo = nrm(e.vOut), vi = nrm(e.vIn);
    e.nrm = nrm([vo[0] - vi[0], vo[1] - vi[1]]);           // the reflection normal: bisects −in and out
    e.th = Math.atan2(e.nrm[0], e.nrm[1]);                 // its tilt off vertical, in the strike plane
    e.S = [e.C[0] - RM * e.nrm[0], e.C[1] - RM * e.nrm[1]];
  }
  Object.assign(R, chooseOmega(evs, P));              // the spin: slowest integer N that clears
  // the stroke: what a lossy bounce can't supply, along the normal (catch-capped)
  for (const e of evs){
    const vin = -dot(e.vIn, e.nrm), vout = dot(e.vOut, e.nrm);
    e.vinN = vin; e.voutN = vout;
    let A = GEOM.KICK_K * (vout - GEOM.E * vin);
    A = Math.max(-GEOM.KICK_MAX, Math.min(GEOM.KICK_MAX, A));
    if (A < 0) A = Math.max(A, -.3 * vin * .1);          // a reach-up must stay slower than the ball
    e.A = A;
  }

  // ---- the count-in: the first strike whose incoming gap is a park, at songTime ≥ 0 ----
  // (the platter is at score phase from t = 0; earlier strikes never happened)
  let first = Infinity, firstIdx = -1;
  const t0 = Math.max(isFinite(start) ? start : 0, 0);
  for (let k = 0; k < n; k++){
    const e = evs[k], prev = evs[(k - 1 + n) % n];
    if (!prev.park) continue;
    const abs = e.s + Math.ceil((t0 + e.tDn - e.s) / P) * P;
    if (abs < first){ first = abs; firstIdx = k; }
  }
  if (firstIdx < 0){ firstIdx = 0; first = evs[0].s + Math.ceil((t0 + 1 - evs[0].s) / P) * P; }
  R.first = first; R.firstIdx = firstIdx;
  const pe = evs[(firstIdx - 1 + n) % n], fe = evs[firstIdx];
  R.tRel = first - fe.tDn;                              // the count-in release
  R.uIn = pe.park ? pe.u : 0;
  R.sRel = fe.C[0] - R.uIn * fe.tDn;
  R.tArm = isFinite(start) ? Math.min(start, R.tRel) : R.tRel - 2;
  // constant-acceleration launch of the carriage from rest at tArm to (sRel, uIn) at tRel
  R.sArm = R.sRel - .5 * R.uIn * (R.tRel - R.tArm);

  // ---- parks: for every event, the nearest park at/before and after (carriage segments) ----
  const parks = evs.map((e, i) => e.park ? i : -1).filter(i => i >= 0);
  R.parks = parks;
  for (let i = 0; i < n; i++){
    let p = i; while (!evs[p].park) p = (p - 1 + n) % n; evs[i].prevPark = parks.length ? p : -1;
    let q = (i + 1) % n; while (parks.length && !evs[q].park) q = (q + 1) % n; evs[i].nextPark = parks.length ? q : -1;
  }
  return R;
}

/* ---- the marble ---- */
/** The marble centre at songTime t in strike-plane coords:
    { s, y, vs, vy, mode: 'held'|'arc'|'rise'|'hold'|'fall', i, since, until, armed } */
export function ballAt(R, t){
  const { evs, n } = R;
  if (!n) return { s: R_IN, y: Y_M, vs: 0, vy: 0, mode: 'held', i: -1, since: Infinity, until: Infinity, armed: true };
  if (t < R.start) t = R.start;
  if (t < R.first){
    if (t < R.tRel){
      const c = carriageAt(R, t);
      return { s: c.s, y: Y_M, vs: c.v, vy: 0, mode: 'held', i: -1, since: Infinity, until: R.first - t, armed: true };
    }
    const f = t - R.tRel;
    return { s: R.sRel + R.uIn * f, y: Y_M - .5 * g * f * f, vs: R.uIn, vy: -g * f, mode: 'fall',
             i: -1, since: Infinity, until: R.first - t, armed: true };
  }
  const c = at(R.L, t, R.first);
  const e = evs[c.i], b = evs[(c.i + 1) % n], s = c.since;
  const out = { i: c.i, since: s, until: c.until, armed: false, abs: c.abs };
  if (!e.park){
    out.s = e.C[0] + e.vOut[0] * s; out.vs = e.vOut[0];
    out.y = e.C[1] + e.vOut[1] * s - .5 * g * s * s; out.vy = e.vOut[1] - g * s;
    out.mode = 'arc';
    return out;
  }
  out.s = e.C[0] + e.u * s; out.vs = e.u;
  if (s < e.tUp){ out.y = e.C[1] + g * e.tUp * s - .5 * g * s * s; out.vy = g * (e.tUp - s); out.mode = 'rise'; }
  else if (c.until > b.tDn){ out.y = Y_M; out.vy = 0; out.mode = 'hold'; }
  else { const f = b.tDn - c.until; out.y = Y_M - .5 * g * f * f; out.vy = -g * f; out.mode = 'fall'; }
  return out;
}

/* ---- the tonearm carriage (rides the gantry rail along the strike ray) ---- */
const hermite = (p0, v0, p1, v1, T, x) => {
  const u = Math.min(1, Math.max(0, x / T)), u2 = u * u, u3 = u2 * u;
  const p = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * T * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * T * v1;
  const v = ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * T * v0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * T * v1) / T;
  return { p, v };
};

/** Park k's hold, relative to strike k: [tUp, gap − tDn(next)], radial s = C.s + u·since. */
function holdOf(R, k){
  const e = R.evs[k], b = R.evs[(k + 1) % R.n];
  return { t0: e.tUp, t1: e.gap - b.tDn, s0: e.C[0] + e.u * e.tUp, s1: e.C[0] + e.u * (e.gap - b.tDn), u: e.u };
}

/** The carriage at songTime t: { s, v, holding }. During a hold it carries the marble;
    between holds it glides (C¹ Hermite) from one release to the next catch. */
export function carriageAt(R, t){
  const { evs, n, P } = R;
  if (!n) return { s: R_IN, v: 0, holding: true };
  if (t < R.start) t = R.start;
  if (t < R.tRel){                                       // count-in: from rest, constant acceleration
    const T = R.tRel - R.tArm, x = Math.max(0, t - R.tArm);
    return { s: R.sArm + .5 * (R.uIn / T) * x * x, v: R.uIn * x / T, holding: true };
  }
  if (t < R.first){
    // just released for the first strike: glide to the next catch
    const fi = R.firstIdx, q = !R.parks.length ? -1 : evs[fi].park ? fi : evs[fi].nextPark;
    return glide(R, R.tRel, R.sRel, R.uIn, q, R.first, fi, t);
  }
  const c = at(R.L, t, R.first);
  const i = c.i, e = evs[i], absI = c.abs;
  if (e.park){
    const h = holdOf(R, i);
    if (c.since >= h.t0 && c.since <= h.t1) return { s: e.C[0] + e.u * c.since, v: e.u, holding: true };
    if (c.since < h.t0){                                  // heading to this park's catch from the last release
      const p = prevParkBefore(R, i);
      const back = wrapP(evs[i].s - evs[p].s, P) || P;
      const hp = holdOf(R, p), tEnd = absI - back + hp.t1;
      return glideTo(hp.s1, hp.u, tEnd, h.s0, h.u, absI + h.t0, t);
    }
    const q = e.nextPark, hq = holdOf(R, q);
    const fwd = wrapP(evs[q].s - evs[i].s, P) || P;
    return glideTo(h.s1, h.u, absI + h.t1, hq.s0, hq.u, absI + fwd + hq.t0, t);
  }
  const p = e.prevPark, q = e.nextPark, hp = holdOf(R, p), hq = holdOf(R, q);
  const back = wrapP(evs[i].s - evs[p].s, P) || P, fwd = wrapP(evs[q].s - evs[i].s, P) || P;
  return glideTo(hp.s1, hp.u, absI - back + hp.t1, hq.s0, hq.u, absI + fwd + hq.t0, t);
}
function prevParkBefore(R, i){
  const { evs, n } = R;
  let p = (i - 1 + n) % n; while (!evs[p].park) p = (p - 1 + n) % n;
  return p;
}
function glide(R, tA, sA, uA, q, absFirst, fi, t){
  const { evs, P } = R;
  if (q < 0) return { s: sA, v: 0, holding: false };
  const hq = holdOf(R, q), fwd = wrapP(evs[q].s - evs[fi].s, P);
  return glideTo(sA, uA, tA, hq.s0, hq.u, absFirst + fwd + hq.t0, t);
}
function glideTo(s0, u0, tA, s1, u1, tB, t){
  const h = hermite(s0, u0, s1, u1, tB - tA, t - tA);
  return { s: h.p, v: h.v, holding: false };
}

/* ---- the pads ---- */
/** Flipper stroke along the normal at c = t − tₛ: a kick (A > 0) retracts then strokes up
    THROUGH contact (padOffset, 0 at c = 0); a catch (A < 0) reaches up then gives. */
export function stroke(c, A){
  if (A >= 0) return padOffset(c, A);
  const W = .3 + Math.abs(A) * .35, S = .1;
  if (c > .6 || c < -W) return 0;
  if (c >= 0) return A * .33 * Math.sin(c * 16) * Math.exp(-c * 8);
  if (c < -S){ const u = (c + W) / (W - S); return -A * u * u; }
  const u = (c + S) / S; return -A * (1 - u * u * u);
}

/** Deploy envelope at angle-from-strike δ ∈ [−PRE, POST]: {extend, tilt} ∈ [0,1], sequenced
    (rise first, then tip — and on the way out, level first, then sink). */
export function deployAt(delta){
  const uIn = smooth(-PRE, -PRE + GEOM.DEPLOY, delta), uOut = smooth(POST, POST - GEOM.RETRACT, delta);
  const u = Math.min(uIn, uOut);
  return { extend: smooth(0, .55, u), tilt: smooth(.45, 1, u), u };
}

/** Active pads at songTime t → calls fn(k, abs, delta) for every occurrence whose pass
    (−PRE ≤ δ ≤ POST) covers the platter's drive time. O(log n + active). */
export function forActivePads(R, t, fn){
  const { evs, n, P, omega } = R;
  if (!n) return 0;
  const gt = driveTime(Math.max(t, R.start), R.Ts);
  const lo = gt - POST / omega, hi = gt + PRE / omega;
  let k = lastIndex(R.L.s, wrapP(lo, P));
  let abs = R.L.s[k] + Math.floor((lo - R.L.s[k]) / P) * P;
  if (abs + P <= lo + 1e-12) abs += P;                     // (float guard)
  let count = 0;
  for (let step = 0; step < n + 1; step++){
    if (abs >= lo - 1e-12){
      if (abs > hi) break;
      fn(k, abs, omega * (gt - abs));
      count++;
    }
    const k2 = (k + 1) % n;
    abs += k2 === 0 ? (R.L.s[0] + P - R.L.s[n - 1]) : (R.L.s[k2] - R.L.s[k]);
    k = k2;
  }
  return count;
}

/** A pad's pose at songTime t for its pass striking at absolute `abs`:
    { top: [x,y,z] (top-face centre, local), n: [x,y,z] (face normal), a (azimuth),
      extend, tilt, off (stroke), live (its strike is real) }. Pure. */
export function padPose(R, k, abs, t){
  const e = R.evs[k];
  const gt = driveTime(Math.max(t, R.start), R.Ts);
  const delta = R.omega * (gt - abs), a = GEOM.A_S + delta;
  const live = abs >= R.first - 1e-9;
  const d = live ? deployAt(delta) : { extend: 0, tilt: 0, u: 0 };
  // tilt: rotate from +y toward the strike normal, in the pad's radial-vertical plane; the
  // face rides up/in by RM·(1−cos θ, sin θ) as it tips so that, fully deployed, its top-face
  // centre is exactly Sᵢ = Cᵢ − RM·nᵢ (the marble's centre stays on the ring)
  const th = e.th * d.tilt;
  const ns = Math.sin(th), ny = Math.cos(th);
  const off = live ? stroke(t - abs, e.A) : 0;
  const ca = Math.cos(a), sa = Math.sin(a);
  const rs = e.r - RM * ns + ns * off, y = Y_PLAT + LIFT * d.extend + RM * (1 - ny) + ny * off;
  return { top: [rs * ca, y, rs * sa], n: [ns * ca, ny, ns * sa], a, delta, extend: d.extend, tilt: d.tilt, off, live };
}

/** Strike-plane (s, y) → local (x, y, z) on the strike ray. */
export const toLocal = (s, y) => [s * Math.cos(GEOM.A_S), y, s * Math.sin(GEOM.A_S)];

/** The most pads ever out at once: the max number of strikes inside any window of
    (PRE + POST)/ω (two pointers over the cyclic strike list). Sizes the pad pool. */
export function maxActive(R){
  const { n, P, omega } = R;
  if (!n) return 0;
  const s = R.L.s, W = (PRE + POST) / omega;
  let best = 0, j = 0;
  for (let i = 0; i < n; i++){
    if (j < i) j = i;
    while (j + 1 < i + n && (s[(j + 1) % n] + (j + 1 >= n ? P : 0)) - s[i] <= W + 1e-9) j++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

/** Pad disc vs marble: the distance from the marble's centre to the solid disc (top face
    at `top`, normal `n`, radius ρ, thickness PAD_T). 0 = inside. */
export function discDistance(c, top, n, rho){
  const d = [c[0] - top[0], c[1] - top[1], c[2] - top[2]];
  const h = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  const q = Math.hypot(d[0] - h * n[0], d[1] - h * n[1], d[2] - h * n[2]);
  const ez = h > 0 ? h : (h < -GEOM.PAD_T ? -GEOM.PAD_T - h : 0), er = Math.max(0, q - rho);
  return Math.hypot(ez, er);
}
