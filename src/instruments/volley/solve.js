/* ============================================================
   VOLLEY — pure math (no THREE scene, no DOM, no audio).

   The conveyor family's TRADED PROTAGONIST: two slat-paternoster walls
   FACE EACH OTHER across a court, and ONE immortal marble is volleyed
   between them.

   · THE STAFF IS VERTICAL. A note's contact height is its pitch (the
     same staff on both walls — a note lands at the same height on either
     side), so a call climbing the left wall and a response falling down
     the right one read as written. Pad SIZE encodes register through the
     engine's pitchSize law (a pure fn of the note, never of layout).
   · WHO PLAYS IT. A gap of at least T_CROSS is a VOLLEY: the marble
     crosses the court on a long ballistic arc (solveLaunch's closed form,
     dt = the gap). A shorter gap stays on the wall it's on — a quick
     figure dribbled up and down that wall's staff. So a phrase is played
     by one wall and the held note that ends it serves the marble over the
     net to the other: call and response. The loop must end on the side it
     started, so the number of volleys per loop is EVEN (an odd count keeps
     its shortest volley on its own wall).
   · EVERY ARC LIES IN ONE PLANE (z = 0, facing the audience): every
     contact sits on its wall's STRIKE COLUMN at z = 0, so the whole game
     reads flat-on from the stage — no depth to guess.
   · THE WALLS MANUFACTURE THE PADS. Each wall is a paternoster stood on
     its side: vertical SLATS ride an endless pair of chains (top + bottom)
     along the wall's court face toward the audience at one constant belt
     speed V, wrap round the front cowl and return behind. Every strike
     OCCURRENCE owns a pad clamped to its own slat at its pitch height. It
     slides out of the back cowl folded flat against the wall, its BOOM
     telescopes into the court and its KNUCKLE tips the disc to the bounce
     normal, and it crosses the strike column exactly on its beat — then
     folds flat and slides into the front cowl to be re-tuned.
       WHY SIDEWAYS (not rising): a pad that is moving ALONG its normal at
     contact is not at rest there — it would push the marble. Every normal
     here lies in the x–y plane, so the one belt direction that is never
     along any normal is z: the slats move tangentially to every face (the
     turntable's lesson: the platter carries its pads ACROSS the strike
     line). A frictionless face moving along itself exerts nothing — every
     pad is exactly at rest at contact but for its own stroke.
   · HONEST CONTACT. A frictionless face only pushes along its normal, so
     n ∥ (vout − vin). The lossy bounce (restitution E) is topped up by a
     flipper STROKE along n whose contact speed w is the moving-wall solve
     vout·n = E·(vin·n) + (1+E)·w. Offset exactly 0 at contact.
   · SAME-WALL FIGURES skip between two RANKS (near / far reach into the
     court) only when they must: a hop on one rank is a vertical dribble
     (flat pads, the slats slide the next pad under the marble — the
     turntable's repeated-note dribble); when that can't clear (a fast
     downward step: the last pad must slide out of the column before the
     marble falls past it; a fast upward one: the next must slide in under
     a marble that's still above it), the marble steps to the other rank.
     The slowest belt speed V that clears every pad on every wall wins
     (geometry, never shrinking).
   · LONG GAPS ride the SHUTTLE. A bridge rail spans the two walls' crowns
     over the strike plane; its electromagnet shuttle catches a lob AT ITS
     APEX: the marble rises to the hold height Y_M with zero vertical speed,
     the shuttle — already running alongside at the arc's own horizontal
     speed u — docks it (relative speed zero), carries it level at that
     same u (no horizontal impulse anywhere in the gap) and lets go so the
     free fall lands on the beat. Every free arc stays under Y_M by
     construction (a gap that would rise past it IS a park).
   · COUNT-IN: the marble hangs ARMED on the shuttle; the shuttle
     accelerates from rest to the first park's u and releases it exactly
     as in steady state (or, if no park leads into the first strike, drops
     it straight down from rest — that one occurrence's pad is tilted for
     the drop).

   Local frame (stations.js): +x across the court (left wall at −x),
   +y up, +z toward the audience. side = −1 (left) / +1 (right).
   Time is the only state: everything is a pure fn of songTime, lookups
   are binary searches (O(log n) per frame).
   ============================================================ */
import { G, noteNum, PAD_R, pitchSize } from '../../engine.js';
import { eventTimes, laneClock, at, wrapP, lastIndex, smooth } from '../clock.js';

export const g = -G.y;

export const GEOM = {
  XF: 8.5,          // wall face |x| (the slats' court side): the court between the faces is 17 u
  REACH: [1.6, 2.8], // contact centre this far into the court from the face: the NEAR / FAR rank
  ZW_MIN: 2.0,      // the slats' open run is z ∈ [−ZW, ZW] between the back and front cowls: long
                    // enough at this song's belt speed for every pad to unfold before the column
  Y_LO: 3.5,        // contact height (ball centre) of the part's lowest note…
  H_STAFF: 3.2,     // …and the staff's height (highest note at Y_LO + H_STAFF)
  RM: .26,          // marble radius
  Y_M: 10.2,        // ball centre while held on the shuttle magnet (every free arc peaks below it)
  T_CROSS: .95,     // s: a gap at least this long is a VOLLEY (crosses the court)
  E: .7,            // restitution marble ↔ pad
  STROKE_S: .14,    // the stroke's final swing into contact (s)
  RECOIL: .06,      // after contact the arm gives a touch along −n (then settles)
  ARM: .34,         // knuckle → face along n
  STOW_GAP: .08,    // a stowed disc (edge-on, facing the audience) clears its slat by this
  PAD_T: .09,       // disc thickness
  PAD_SCALE: .86,   // pad radius = PAD_R·PAD_SCALE·pitchSize
  RISE: .34,        // s: boom out + knuckle tip (sequenced), done READY before the strike
  RISE_MIN: .12,    // the quickest unfold a pad may be squeezed to (it must clear the back cowl first)
  STAY: .24,        // s fully out after the strike (the follow-through + the marble's exit)
  FOLD: .42,        // s to fold back (edge-on) against the wall
  COWL_IN: 1.3,     // the cowls' court faces sit this far court-side of the slats (they hide stowed pads)
  NET_H: 4.6,       // the net's top cable (every volley clears it)
  V_MIN: 1.6,       // belt speed search range (u/s)
  V_MAX: 7.0,
  T_NEAR: 1.4,      // s: pads of one wall closer than this in time are out together — they clear by geometry
  CLR: .1,          // pads keep ≥ ρa + ρb + CLR apart
  W_RANK: 1,        // the V search's taste: a rank step (a rattle) costs this much…
  W_SPEED: 10,      // …and each u/s of belt speed this much: the SLOWEST clean belt wins (calm, compact)
  HOP_CLR: .06,     // extra air a dribble keeps from the pads sliding past it
  VY_MIN: .25,      // a dribble leaves its pad at least this fast upward
  MIN_GAP: .06,     // events closer than this (s) merge (monophonic chain)
  ACC: 14,          // the shuttle's brake / launch acceleration (u/s²)
  RAIL_IN: .6,      // the shuttle's travel stops this far inside the faces
  REST_X: 0,        // where an idle shuttle waits (mid-court, over the net)
};
const { XF, Y_LO, H_STAFF, RM, Y_M, E, STROKE_S } = GEOM;
export const X_RAIL = XF - GEOM.RAIL_IN;               // the shuttle's |x| limit
/** |x| of a contact centre on rank r */
export const xOfRank = r => XF - GEOM.REACH[r];

/** A stroke of contact speed w (along n) has amplitude A = w·S/3 (the u³ swing). */
export const strokeAmp = w => w * STROKE_S / 3;
/** The moving-wall bounce: the face speed along n that turns vin·n into vout·n. */
export const wallSpeed = (vinN, voutN) => (voutN - E * vinN) / (1 + E);
/** The stroke's wind-up lead (s) for amplitude A (bigger hits telegraph longer). */
export const strokeWindow = A => .2 + Math.abs(A) * .25 + STROKE_S;

/* ---- tiny vec3 helpers ---- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/* ---- the staff ---- */
export function staff(notes){
  const nums = notes.map(noteNum);
  const loN = Math.min(...nums), hiN = Math.max(...nums), span = Math.max(1, hiN - loN);
  const yOf = note => hiN === loN ? Y_LO + H_STAFF / 2 : Y_LO + (noteNum(note) - loN) / span * H_STAFF;
  const padR = note => PAD_R * GEOM.PAD_SCALE * pitchSize(note, loN, span);   // layout-invariant
  return { loN, hiN, span, yOf, padR };
}

/** The monophonic chain: one event per strike time (a chord keeps its TOP note, the loudest
    velocity); events closer than MIN_GAP merge into the earlier one. */
export function chainEvents(part, { rollT, beat, P }){
  const evs = eventTimes(part, { rollT, beat }).map(e => ({ ...e, s: +wrapP(e.t, P).toFixed(9) }))
    .sort((a, b) => a.s - b.s || noteNum(b.note) - noteNum(a.note));
  const out = [];
  for (const e of evs){
    const last = out[out.length - 1];
    if (last && e.s - last.s < GEOM.MIN_GAP){ last.vel = Math.max(last.vel, e.vel); continue; }
    out.push({ note: e.note, vel: e.vel, s: e.s, beat: e.beat });
  }
  if (out.length > 1 && out[0].s + P - out[out.length - 1].s < GEOM.MIN_GAP) out.pop();
  return out;
}

/** Which wall plays each event: a gap ≥ T_CROSS volleys across, an even number of volleys per
    loop (an odd count keeps its SHORTEST volley on its own wall). Event 0 is on the left. */
export function assignSides(gaps){
  const n = gaps.length;
  const cross = gaps.map(T => n > 1 && T >= GEOM.T_CROSS - 1e-12);
  if (cross.filter(Boolean).length % 2){
    let j = -1; cross.forEach((c, i) => { if (c && (j < 0 || gaps[i] < gaps[j])) j = i; });
    cross[j] = false;
  }
  const side = new Array(n);
  side[0] = -1;
  for (let i = 0; i + 1 < n; i++) side[i + 1] = cross[i] ? -side[i] : side[i];
  return { side, cross };
}

/* ---- the build ---- */
/** Build the volley. part = [[beat, note, vel?]…]. Returns the record R every query reads. */
export function buildVolley(part, { rollT, beat, P, start = -Infinity }){
  const evs = chainEvents(part, { rollT, beat, P });
  const n = evs.length;
  const R = { evs, n, P, start, warnings: [] };
  if (!n) return Object.assign(R, { V: GEOM.V_MIN, L: laneClock([], P), first: Infinity, holds: [], holdStarts: [],
    tRel: Infinity, ok: true, PRE: 0, POST: 0 });
  const st = staff(evs.map(e => e.note));
  R.staff = st;
  R.L = laneClock(evs.map(e => e.s), P);              // same order as evs (sorted, unique)
  const gaps = R.L.gaps;
  const { side, cross } = assignSides(gaps);
  evs.forEach((e, i) => {
    e.i = i; e.y = st.yOf(e.note); e.rho = st.padR(e.note); e.gap = gaps[i];
    e.side = side[i]; e.cross = cross[i];
    e.tUp = Math.sqrt(2 * (Y_M - e.y) / g);             // rise from this contact to the magnet
    e.tDn = e.tUp;                                     // fall from the magnet onto it
  });
  for (let i = 0; i < n; i++){ const a = evs[i], b = evs[(i + 1) % n]; a.park = a.gap > a.tUp + b.tDn + 1e-9; }

  // ---- the count-in: the first strike at songTime ≥ 0 (+ its drop) whose incoming gap is a
  //      park (then the count-in IS that park's tail — the steady state exactly); else the first ----
  const t0 = Math.max(isFinite(start) ? start : 0, 0);
  const firstAbs = k => evs[k].s + Math.ceil((t0 + evs[k].tDn - evs[k].s) / P) * P;
  let firstIdx = -1, first = Infinity;
  for (let k = 0; k < n; k++){
    if (!evs[(k - 1 + n) % n].park) continue;
    const a = firstAbs(k); if (a < first){ first = a; firstIdx = k; }
  }
  R.cntPark = firstIdx >= 0;
  if (firstIdx < 0) for (let k = 0; k < n; k++){ const a = firstAbs(k); if (a < first){ first = a; firstIdx = k; } }
  R.first = first; R.firstIdx = firstIdx;

  // ---- ranks + belt speed: the slowest V whose pads all clear ----
  let best = null;
  for (let V = GEOM.V_MIN; V <= GEOM.V_MAX + 1e-9; V = +(V + .1).toFixed(2)){
    const rank = assignRanks(evs, V);
    const sol = solveKinematics(evs, rank);
    const bad = checkSpeed(evs, sol, V, P);
    let steps = 0; for (let i = 0; i < n; i++) if (evs[i].side === evs[(i + 1) % n].side && rank[i] !== rank[(i + 1) % n]) steps++;
    const score = bad.length * 100 + steps * GEOM.W_RANK + V * GEOM.W_SPEED;
    if (!best || score < best.score) best = { V, rank, sol, bad, score };
  }
  R.V = best.V;
  evs.forEach((e, i) => Object.assign(e, best.sol[i], { rank: best.rank[i] }));
  R.ok = !best.bad.length;
  R.warnings.push(...best.bad);
  evs.forEach((e, i) => { if (!(e.vinN > 0) || !(e.voutN > 0)) R.warnings.push(`pad ${i} can't bounce honestly`); });

  // ---- each pad's unfold window (s, centred on its strike), and the wall's open run: long
  //      enough at V for the slowest unfold to finish before the column ----
  for (const e of evs) e.win = padWindow(e);
  // the count-in's own occurrence (a drop from rest, if it isn't a park's tail)
  const fe = evs[firstIdx], pe = evs[(firstIdx - 1 + n) % n];
  R.cnt = R.cntPark ? null : { ...padSolution(fe.C, [0, -g * fe.tDn, 0], fe.vOut), C: fe.C };
  if (R.cnt) R.cnt.win = padWindow({ ...fe, ...R.cnt });
  const lead = Math.max(...evs.map(e => Math.max(e.win.up0, e.win.dn1)), R.cnt ? R.cnt.win.up0 : 0);
  R.ZW = Math.max(GEOM.ZW_MIN, R.V * lead + Math.max(...evs.map(e => e.rho)) + .1);

  // ---- the count-in release: held on the shuttle, accelerated from rest to the park's u ----
  R.tRel = first - fe.tDn;
  R.uIn = R.cntPark ? pe.u : 0;
  R.xRel = fe.C[0] - R.uIn * fe.tDn;
  R.tArm = isFinite(start) ? Math.min(start, R.tRel) : R.tRel - 2;
  // a constant-acceleration launch from rest over Ta (≤ the count-in), short enough that the
  // shuttle starts on its rail
  let Ta = Math.min(R.tRel - R.tArm, 2.4);
  if (R.uIn){ const room = R.uIn > 0 ? R.xRel + X_RAIL : X_RAIL - R.xRel; Ta = Math.max(0, Math.min(Ta, 2 * room / Math.abs(R.uIn))); }
  R.Ta = Ta;
  R.xArm = R.xRel - .5 * R.uIn * Ta;

  // ---- the shuttle's holds (loop-local): park k holds from its apex to its release ----
  R.holds = [];
  evs.forEach((e, k) => { if (!e.park) return;
    const b = evs[(k + 1) % n];
    R.holds.push({ k, t0: +wrapP(e.s + e.tUp, P).toFixed(9), dur: e.gap - e.tUp - b.tDn,
                   x0: e.C[0] + e.u * e.tUp, u: e.u }); });
  R.holds.sort((a, b) => a.t0 - b.t0);
  R.holdStarts = R.holds.map(h => h.t0);

  // ---- how long each pad is in sight on its run (out of the back cowl → into the front one) ----
  for (const e of evs) e.pre = e.post = (R.ZW + e.rho) / R.V;
  R.PRE = R.POST = Math.max(...evs.map(e => e.pre));
  return R;
}

/* The ranks — an exact DP (a Viterbi pass over consecutive rank pairs, cyclic): a same-wall hop
   keeps its rank only as a clean vertical dribble (dribbleOK), else it steps to the other rank
   (W_RANK, a rattle); a volley prefers the NEAR rank; and EVERY pad must be able to bounce
   honestly (the marble arrives INTO its face and leaves OFF it) — that is what decides a rank
   when the figure could go either way. O(n). */
const HARD = 1000;
function hopVel(a, b, ra, rb){
  const xa = a.side * xOfRank(ra), xb = b.side * xOfRank(rb), T = a.gap;
  if (a.park){ const u = (xb - xa) / T; return { vOut: [u, g * a.tUp, 0], vIn: [u, -g * b.tDn, 0] }; }
  const vy = (b.y - a.y + .5 * g * T * T) / T;
  return { vOut: [(xb - xa) / T, vy, 0], vIn: [(xb - xa) / T, vy - g * T, 0] };
}
function hopCost(a, b, ra, rb, V){
  if (a.side !== b.side) return (rb ? .3 : 0);
  if (ra === rb) return dribbleOK(a, b, V) ? 0 : HARD;
  return GEOM.W_RANK;
}
function padCost(vIn, vOut){
  const n = nrm(sub(vOut, vIn));
  return (-dot(vIn, n) > .3 && dot(vOut, n) > .3) ? 0 : HARD;
}
function assignRanks(evs, V){
  const n = evs.length;
  if (n === 1) return [0];
  const E = i => evs[((i % n) + n) % n];
  let best = null;
  for (const r1 of [0, 1]){
    // state after placing r_0..r_{i+1}: key (r_i, r_{i+1}); r_0 = 0, r_1 = r1
    let dp = new Map([[`0${r1}`, { c: hopCost(E(0), E(1), 0, r1, V), path: [0, r1] }]]);
    for (let i = 1; i < n; i++){                        // choose r_{i+1}; pay hop i and pad i
      const next = new Map();
      for (const [key, st] of dp){
        const ra = +key[0], rb = +key[1];
        const cands = i + 1 === n ? [0] : [0, 1];        // r_n = r_0 closes the loop
        for (const rc of cands){
          const vin = hopVel(E(i - 1), E(i), ra, rb).vIn, vout = hopVel(E(i), E(i + 1), rb, rc).vOut;
          const c = st.c + hopCost(E(i), E(i + 1), rb, rc, V) + padCost(vin, vout);
          const k2 = `${rb}${rc}`;
          if (!next.has(k2) || c < next.get(k2).c) next.set(k2, { c, path: [...st.path, rc] });
        }
      }
      dp = next;
    }
    for (const [key, st] of dp){                        // pad 0: from r_{n−1} → r_0 = 0 → r_1
      const ra = +key[0];
      const c = st.c + padCost(hopVel(E(-1), E(0), ra, 0).vIn, hopVel(E(0), E(1), 0, r1).vOut);
      if (!best || c < best.c) best = { c, path: st.path };
    }
  }
  return best.path.slice(0, n);
}
/** Can a ↦ b (same wall, same rank, gap a.gap) be a straight vertical dribble? */
export function dribbleOK(a, b, V){
  const T = a.gap, dy = b.y - a.y;
  if (a.park) return true;                                  // (a park: the marble leaves the column on the shuttle)
  const vyOut = (dy + .5 * g * T * T) / T, vyIn = vyOut - g * T;
  if (vyOut < GEOM.VY_MIN) return false;                    // it must leave its pad upward
  // a falls behind: before the marble drops back past a's face, a's disc has slid out of the column
  if (dy < 0 && V * (2 * vyOut / g) < a.rho + RM + GEOM.HOP_CLR) return false;
  // b slides in under it: the disc's edge reaches the column while the marble is still above it
  const te = (b.rho + RM + GEOM.HOP_CLR) / V;
  if (-vyIn * te - .5 * g * te * te < 0) return false;
  // a and b pass each other on the wall (same rank: same reach) — apart in z or in height
  if (V * T < a.rho + b.rho + GEOM.CLR && Math.abs(dy) < a.rho + b.rho + GEOM.CLR) return false;
  return true;
}
/* Pads of one wall that are out together and would clash. Every slat moves at V, so a pair's
   offset along the wall is fixed (V·Δt): two pads close in time must be apart ALONG the wall or
   in HEIGHT (a deployed disc's plane contains z — it spans ±ρ along the wall; stowed, a disc
   stands edge-on, PAD_T thin). Geometry, never shrinking: that is what sets V. */
function checkSpeed(evs, sol, V, P){
  const bad = [];
  for (let i = 0; i < evs.length; i++){
    const a = evs[i], sa = sol[i];
    for (let j = i + 1; j < evs.length; j++){
      const b = evs[j], sb = sol[j];
      if (a.side !== b.side) continue;
      for (const m of [-1, 0, 1]){
        const dt = Math.abs(b.s + m * P - a.s);
        if (dt > GEOM.T_NEAR) continue;
        const need = a.rho + b.rho + GEOM.CLR;
        if (V * dt < need && Math.abs(sa.K[1] - sb.K[1]) < need){ bad.push(`pads ${i}/${j} crowd at V=${V}`); break; }
      }
    }
  }
  // a same-rank same-wall hop must be a clean dribble at this V (the loop seam may force one)
  for (let i = 0; i < evs.length; i++){
    const a = evs[i], b = evs[(i + 1) % evs.length];
    if (evs.length > 1 && a.side === b.side && sol[i].rank === sol[(i + 1) % evs.length].rank && !dribbleOK(a, b, V))
      bad.push(`dribble ${i} can't clear at V=${V}`);
  }
  return bad;
}

/* the arcs, the normals, the strokes — for one rank choice */
function solveKinematics(evs, rank){
  const n = evs.length;
  const sol = evs.map((e, i) => ({ rank: rank[i], C: [e.side * xOfRank(rank[i]), e.y, 0] }));
  for (let i = 0; i < n; i++){
    const a = evs[i], b = evs[(i + 1) % n], A = sol[i], B = sol[(i + 1) % n], T = a.gap;
    if (a.park){
      const u = (B.C[0] - A.C[0]) / T;                  // the arc's horizontal speed: constant all gap
      A.u = u;
      A.vOut = [u, g * a.tUp, 0];
      B.vIn = [u, -g * b.tDn, 0];
    } else {
      // solveLaunch: v0 = (ΔP − ½·G·T²) / T  (G = (0, −g, 0))
      const v0 = [(B.C[0] - A.C[0]) / T, (B.C[1] - A.C[1] + .5 * g * T * T) / T, 0];
      A.u = v0[0];
      A.vOut = v0;
      B.vIn = [v0[0], v0[1] - g * T, 0];
    }
  }
  for (const s of sol) Object.assign(s, padSolution(s.C, s.vIn, s.vOut));
  return sol;
}
/* one contact: the face normal is the push direction; face + knuckle placed under the marble */
function padSolution(C, vIn, vOut){
  const nn = nrm(sub(vOut, vIn));
  const S = sub(C, mul(nn, RM));                       // face centre: the marble touches it along n
  const K = sub(S, mul(nn, GEOM.ARM));                 // knuckle: ARM back along n
  const vinN = -dot(vIn, nn), voutN = dot(vOut, nn);
  const w = wallSpeed(vinN, voutN);
  return { nrm: nn, S, K, vinN, voutN, w, A: strokeAmp(w), vIn: vIn.slice(), vOut: vOut.slice() };
}
/* the unfold window: fully out READY (the wind-up) before the strike, only once clear of the
   back cowl; flat again before the front one */
function padWindow(e){
  const ready = strokeWindow(e.A) + .05;
  return { ready, up0: ready + GEOM.RISE, stay: GEOM.STAY, dn1: GEOM.STAY + GEOM.FOLD };
}

/* ---- the marble ---- */
/** The marble centre at songTime t: { p: [x,y,z], v: [x,y,z], mode: 'held'|'arc'|'rise'|'hold'|'fall',
    i, since, until, abs, armed }. */
export function ballAt(R, t){
  const { evs, n } = R;
  if (!n) return { p: [0, Y_M, 0], v: [0, 0, 0], mode: 'held', i: -1, since: Infinity, until: Infinity, armed: true };
  if (t < R.start) t = R.start;
  if (t < R.first){
    if (t < R.tRel){
      const c = shuttleAt(R, t);
      return { p: [c.x, Y_M, 0], v: [c.v, 0, 0], mode: 'held', i: -1, since: Infinity, until: R.first - t, armed: true };
    }
    const f = t - R.tRel;
    return { p: [R.xRel + R.uIn * f, Y_M - .5 * g * f * f, 0], v: [R.uIn, -g * f, 0], mode: 'fall',
             i: -1, since: Infinity, until: R.first - t, armed: true };
  }
  const c = at(R.L, t, R.first);
  const e = evs[c.i], b = evs[(c.i + 1) % n], s = c.since;
  const out = { i: c.i, since: s, until: c.until, armed: false, abs: c.abs };
  if (!e.park){
    out.p = [e.C[0] + e.vOut[0] * s, e.C[1] + e.vOut[1] * s - .5 * g * s * s, 0];
    out.v = [e.vOut[0], e.vOut[1] - g * s, 0];
    out.mode = 'arc';
    return out;
  }
  const x = e.C[0] + e.u * s;
  if (s < e.tUp){ out.p = [x, e.C[1] + g * e.tUp * s - .5 * g * s * s, 0]; out.v = [e.u, g * (e.tUp - s), 0]; out.mode = 'rise'; }
  else if (c.until > b.tDn){ out.p = [x, Y_M, 0]; out.v = [e.u, 0, 0]; out.mode = 'hold'; }
  else { const f = b.tDn - c.until; out.p = [x, Y_M - .5 * g * f * f, 0]; out.v = [e.u, -g * f, 0]; out.mode = 'fall'; }
  return out;
}

/* ---- the shuttle (rides the bridge rail over the strike plane) ---- */
const hermite = (p0, v0, p1, v1, T, x) => {
  const u = Math.min(1, Math.max(0, x / T)), u2 = u * u, u3 = u2 * u;
  const p = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * T * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * T * v1;
  const v = ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * T * v0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * T * v1) / T;
  return { x: p, v };
};
/** The empty shuttle between a release (xA moving uA at tA) and the next catch (xB moving uB at
    tB): BRAKE at ACC to rest, a rest-to-rest quintic move, then LAUNCH at ACC up to uB — every
    change of speed has a constant-acceleration cause. Too little time → a C¹ Hermite. */
export function glide(xA, uA, tA, xB, uB, tB, t){
  const a = GEOM.ACC, tb = Math.abs(uA) / a, tl = Math.abs(uB) / a;
  const x1 = xA + uA * tb / 2, x2 = xB - uB * tl / 2;
  const T = (tB - tl) - (tA + tb);
  if (T < .2 || 5.78 * Math.abs(x2 - x1) / (T * T) > 1.5 * a){
    const h = hermite(xA, uA, xB, uB, tB - tA, t - tA);
    return { x: h.x, v: h.v, holding: false };
  }
  if (t < tA + tb){ const s = t - tA; return { x: xA + uA * s - .5 * Math.sign(uA) * a * s * s, v: uA - Math.sign(uA) * a * s, holding: false }; }
  if (t < tB - tl){
    const u = (t - tA - tb) / T, d = x2 - x1;
    const p = u * u * u * (10 - 15 * u + 6 * u * u), dp = 30 * u * u * (1 - u) * (1 - u) / T;
    return { x: x1 + d * p, v: d * dp, holding: false };
  }
  const s = t - (tB - tl);
  return { x: x2 + .5 * Math.sign(uB) * a * s * s, v: Math.sign(uB) * a * s, holding: false };
}
/** The shuttle at songTime t: { x, v, holding }. While holding it carries the marble. */
export function shuttleAt(R, t){
  const { P } = R;
  if (!R.n) return { x: GEOM.REST_X, v: 0, holding: true };
  if (t < R.start) t = R.start;
  if (t < R.tRel){                                     // count-in: still, then a constant-acceleration launch
    const t1 = R.tRel - R.Ta, x = Math.max(0, t - t1), acc = R.Ta > 0 ? R.uIn / R.Ta : 0;
    return { x: R.xArm + .5 * acc * x * x, v: acc * x, holding: true };
  }
  const H = R.holds;
  if (!H.length){                                      // no parks: after the count-in drop it goes to rest
    const T = 2.5;
    return t >= R.tRel + T ? { x: GEOM.REST_X, v: 0, holding: false } : glide(R.xRel, R.uIn, R.tRel, GEOM.REST_X, 0, R.tRel + T, t);
  }
  const tau = wrapP(t, P), j = lastIndex(R.holdStarts, tau), h = H[j];
  const since = wrapP(tau - h.t0, P), absStart = t - since;
  if (since <= h.dur) return { x: h.x0 + h.u * since, v: h.u, holding: true };
  // gliding to the next catch: from this hold's release — or, if that hold never happened (it
  // ended before the count-in let the marble go), from the count-in release
  const h2 = H[(j + 1) % H.length];
  const fwd = H.length === 1 ? P : (wrapP(h2.t0 - h.t0, P) || P);
  let xA = h.x0 + h.u * h.dur, uA = h.u, tA = absStart + h.dur;
  if (tA < R.tRel - 1e-9){ xA = R.xRel; uA = R.uIn; tA = R.tRel; }
  return glide(xA, uA, tA, h2.x0, h2.u, absStart + fwd, t);
}

/* ---- the pads ---- */
/** Flipper stroke along the normal at c = t − tₛ (the belt's padOffset grammar, both signs):
    a wind-up eases the face back by A, the final STROKE_S swings it into contact — offset
    exactly 0 at c = 0, moving at exactly w = 3A/STROKE_S (the moving-wall solve) — then a
    small recoil and a decaying follow-through, back to rest by c = .5. */
export function stroke(c, A){
  const S = STROKE_S, W = strokeWindow(A);
  if (c >= .5 || c < -W) return 0;
  if (c >= 0){
    const fade = 1 - smooth(.34, .5, c);
    return (A * .33 * Math.sin(c * 18) * Math.exp(-c * 9) - GEOM.RECOIL * (1 - Math.exp(-c / .035)) * Math.exp(-c / .12)) * fade;
  }
  if (c < -S){ const u = (c + W) / (W - S); return -A * u * u; }
  const u = (c + S) / S; return -A * (1 - u * u * u);
}
/** Unfold envelope at c = t − tₛ: {extend, tilt} ∈ [0,1]. The boom telescopes out, THEN the
    knuckle tips (sequenced); fully out READY before the strike, folds after STAY. */
export function deployAt(c, win){
  const uIn = smooth(-win.up0, -win.ready, c), uOut = smooth(win.dn1, win.stay, c);
  const u = Math.min(uIn, uOut);
  return { extend: smooth(0, .6, u), tilt: smooth(.4, 1, u), u };
}
/** The solution an occurrence strikes with (the count-in's own drop, else its event's). */
export function solOf(R, k, abs){
  return (R.cnt && k === R.firstIdx && Math.abs(abs - R.first) < 1e-6) ? R.cnt : R.evs[k];
}
/** Every pad in sight at songTime t → fn(k, abs). O(log n + active). */
export function forPads(R, t, fn){
  const { evs, n, P } = R;
  if (!n) return 0;
  if (t < R.start) t = R.start;
  const lo = t - R.POST, hi = t + R.PRE;
  let k = lastIndex(R.L.s, wrapP(lo, P));
  let abs = R.L.s[k] + Math.floor((lo - R.L.s[k]) / P) * P;
  if (abs + P <= lo + 1e-12) abs += P;
  let count = 0;
  for (let step = 0; step < 2 * n + 2; step++){
    if (abs > hi) break;
    if (abs >= lo - 1e-12){
      const e = evs[k];
      if (t >= abs - e.pre && t <= abs + e.post){ fn(k, abs); count++; }
    }
    const k2 = (k + 1) % n;
    abs += k2 === 0 ? (R.L.s[0] + P - R.L.s[n - 1]) : (R.L.s[k2] - R.L.s[k]);
    k = k2;
  }
  return count;
}
/* slerp between unit vectors a → b (angle < π) */
function slerp(a, b, u){
  if (u <= 0) return a.slice(); if (u >= 1) return b.slice();
  const th = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
  if (th < 1e-6) return b.slice();
  const s = Math.sin(th), ka = Math.sin((1 - u) * th) / s, kb = Math.sin(u * th) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}
/** A pad's pose at songTime t for its occurrence striking at absolute `abs`:
    { top (face centre), n (face normal), knuckle, shoe (on its slat), z, extend, tilt, off, live, side, rho }.
    Stowed: the boom retracted to a stub (the disc clears its slat), the disc edge-on facing +z.
    Pure. Fully out at the strike: top = Sₖ = Cₖ − RM·nₖ exactly; its slat slides it along z (⟂ n). */
export function padPose(R, k, abs, t){
  const e = R.evs[k], sol = solOf(R, k, abs);
  const c = t - abs, side = e.side;
  const live = abs >= R.first - 1e-9;
  const z = R.V * c;                                   // the slat carries it along the wall at V
  const d = live ? deployAt(c, sol.win || e.win) : { extend: 0, tilt: 0, u: 0 };
  const face = [0, 0, 1];                              // a stowed disc stands edge-on, facing the audience
  const ky = sol.K[1];
  const k0 = [side * (XF - e.rho - GEOM.STOW_GAP), ky, z], k1 = [sol.K[0], ky, z];
  const knuckle = add(k0, mul(sub(k1, k0), d.extend));
  const nn = nrm(slerp(face, sol.nrm, d.tilt));
  const off = live ? stroke(c, sol.A) : 0;
  const top = add(knuckle, mul(nn, GEOM.ARM + off));
  return { top, n: nn, knuckle, shoe: [side * XF, ky, z], z, extend: d.extend, tilt: d.tilt, off, live, side, rho: e.rho };
}

/** The most pads ever in sight at once (an interval sweep over the loop): sizes the pool. */
export function maxPads(R){
  if (!R.n) return 0;
  const ev = [];
  R.evs.forEach(e => { for (const m of [-1, 0, 1]){ const s = e.s + m * R.P; ev.push([s - e.pre, 1], [s + e.post, -1]); } });
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, best = 0; for (const [, d] of ev){ c += d; best = Math.max(best, c); }
  return best;
}

/** Distance from point c to the solid disc (face centre top, normal n, radius ρ, thickness PAD_T). */
export function discDistance(c, top, n, rho){
  const d = sub(c, top);
  const h = dot(d, n);
  const q = Math.hypot(d[0] - h * n[0], d[1] - h * n[1], d[2] - h * n[2]);
  const ez = h > 0 ? h : (h < -GEOM.PAD_T ? -GEOM.PAD_T - h : 0), er = Math.max(0, q - rho);
  return Math.hypot(ez, er);
}
