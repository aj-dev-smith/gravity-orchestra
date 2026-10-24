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
   · WHO PLAYS IT — phrases, traded. A gap is a candidate VOLLEY (the
     marble crosses the court on a long ballistic arc: solveLaunch's closed
     form, dt = the gap) only if that arc clears the net in closed form
     (height over the net ≥ NET_H + RM + NET_CLR, and dt ≥ T_XMIN). Every
     long gap (≥ T_CROSS — a phrase end) volleys. Then a RUN CAP: no wall
     plays more than RUN_BEATS beats or RUN_N strikes without serving —
     the longest candidate gap inside an over-long run serves (the phrase
     breath). The loop must end on the side it started, so volleys per loop
     are EVEN; and the walls share the line (each takes BAL of the strikes:
     a too-quiet wall gets a short answer flipped to it, two serves at the
     run's best candidate gaps). DATA FIRST: an event may pin its wall —
     [beat, note, vel, dur, 'L'|'R'] — and then the composer's call and
     response is the law (an unpinned event stays on the wall before it).
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
   · THE LINKAGE NEVER CROSSES THE BALL. A pad is shoe (on its slat) →
     boom (horizontal, into the court) → knuckle → arm (along −n) → disc.
     A FOREHAND pad (its face looks into the court) runs its boom straight
     at knuckle height. A BACKHAND pad (a far→near step: its face looks
     back at its own wall, the marble between the disc and the wall) — or
     any pad whose straight boom would clip its own disc — DOG-LEGS: the
     shoe clamps lower on the slat, the boom runs out UNDER the disc and the
     ball, and a riser climbs to the knuckle behind the disc. The disc
     shields the whole linkage (tested as capsules, not just the disc).
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
import { G, ROLL_T, noteNum, PAD_R, PITCH_AMP, pitchSize } from '../../engine.js';
import { normalizeEvent, laneClock, at, wrapP, lastIndex, smooth } from '../clock.js';
import { ARM_AT } from '../../transport.js';

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
  T_CROSS: .95,     // s: a gap at least this long is a VOLLEY (crosses the court) — a phrase end
  T_XMIN: .5,       // s: the quickest volley (a ~28 u/s smash: any quicker stops reading as a throw)
  NET_CLR: .2,      // a volley's ball clears the net cable by this (closed form)
  RUN_BEATS: 4,     // a wall plays at most this many beats…
  RUN_N: 8,         // …or this many strikes before it serves (the longest net-clearing gap in the run)
  BAL: .35,         // each wall plays at least this share of the strikes (when the gaps allow)
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
  COWL_IN: 0,       // (set below: 2·ρmax + STOW_GAP + .1 — a stowed disc's edge stays inside its cowl)
  BOOM_R: .055,     // the linkage's capsule radii (boom, riser / arm)
  ARM_R: .04,
  LINK_CLR: .1,     // a dog-leg boom passes this far under the disc + the ball
  Y_BOOM_MIN: 2.25, // the lowest a shoe may clamp (the bottom chain runs at 1.95)
  MIN_HOP: .2,      // s: the quickest hop the walls play honestly at V_MAX (measured over dense lines;
                    // the MAP panel thins a volley line to this — editor/mapping.js LINE_SPEC)
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
/** the largest pad any part can have (pitchSize peaks at 1 + PITCH_AMP) */
export const RHO_MAX = PAD_R * GEOM.PAD_SCALE * (1 + PITCH_AMP);
GEOM.COWL_IN = +(2 * RHO_MAX + GEOM.STOW_GAP + .1).toFixed(3);
const { XF, Y_LO, H_STAFF, RM, Y_M, E, STROKE_S, NET_H } = GEOM;
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
    velocity); events closer than MIN_GAP merge into the earlier one. An event may PIN its wall
    with an 'L' / 'R' anywhere after the note ([beat, note, vel, dur, 'L']) → e.pin = −1 / +1. */
export function chainEvents(part, { rollT, beat, P }){
  const evs = (part || []).map(raw => {
    const pinS = raw.slice(2).find(x => x === 'L' || x === 'R');
    const e = normalizeEvent(raw.filter((x, i) => i < 2 || typeof x !== 'string'));
    return { ...e, pin: pinS ? (pinS === 'L' ? -1 : 1) : 0, s: +wrapP(rollT + e.beat * beat, P).toFixed(9) };
  }).sort((a, b) => a.s - b.s || noteNum(b.note) - noteNum(a.note));
  const out = [];
  for (const e of evs){
    const last = out[out.length - 1];
    if (last && e.s - last.s < GEOM.MIN_GAP){ last.vel = Math.max(last.vel, e.vel); last.pin ||= e.pin; continue; }
    out.push({ note: e.note, vel: e.vel, s: e.s, beat: e.beat, pin: e.pin });
  }
  if (out.length > 1 && out[0].s + P - out[out.length - 1].s < GEOM.MIN_GAP) out.pop();
  return out;
}

/** The ball's least clearance over the net cable (above NET_H + RM) for a free arc from
    (xa, ya) to (xb, yb) in T — closed form: y(x) is a parabola in x (x is linear in t), so its
    minimum over the net's window |x| ≤ RM + .03 is at a window edge. −Infinity if it doesn't cross. */
export function netClear(xa, ya, xb, yb, T){
  if (xa * xb >= 0 || !(T > 0)) return -Infinity;
  const vy = (yb - ya + .5 * g * T * T) / T, u = (xb - xa) / T, w = RM + .03;
  const yAt = x => { const t = (x - xa) / u; return ya + vy * t - .5 * g * t * t; };
  return Math.min(yAt(-w), yAt(w)) - RM - NET_H;
}
/** Can the gap from a (height ya) to b (height yb) be a volley? (near rank → near rank: the
    widest court, the one the rank DP always keeps open) */
export const crossOK = (T, ya, yb) => T >= GEOM.T_XMIN - 1e-12 && T > 0 &&
  netClear(-xOfRank(0), ya, xOfRank(0), yb, T) >= GEOM.NET_CLR - 1e-12;

/** Which wall plays each event. gaps[i] = event i → i+1 (cyclic), ys = contact heights, pins =
    −1 / +1 / 0 per event (the composer's own sides). Returns { side, cross } (cross[i]: the hop
    out of i volleys). Deterministic. See the header (WHO PLAYS IT). */
export function assignSides(gaps, { ys = gaps.map(() => Y_LO + H_STAFF), pins = [], runT = Infinity, runN = GEOM.RUN_N } = {}){
  const n = gaps.length;
  const side = new Array(n).fill(-1);
  if (n < 2) return { side, cross: new Array(n).fill(false), double: false };
  // the composer's sides are the law: an unpinned event stays on the wall before it
  const p0 = pins.findIndex(x => x);
  if (p0 >= 0){
    let cur = pins[p0];
    for (let k = 0; k < n; k++){ const i = (p0 + k) % n; if (pins[i]) cur = pins[i]; side[i] = cur; }
    return { side, cross: side.map((s, i) => s !== side[(i + 1) % n]), double: false };
  }
  const feas = gaps.map((T, i) => crossOK(T, ys[i], ys[(i + 1) % n]));
  const cross = gaps.map((T, i) => feas[i] && T >= GEOM.T_CROSS - 1e-12);
  const cyc = i => ((i % n) + n) % n;
  // the runs between volleys: { gaps: [internal gap indices], dur, count, start }
  const runs = () => {
    const cs = []; for (let i = 0; i < n; i++) if (cross[i]) cs.push(i);
    if (!cs.length) return [{ gaps: [...Array(n).keys()], dur: gaps.reduce((a, b) => a + b, 0), count: n, start: 0 }];
    return cs.map((c, j) => {
      const c2 = cs[(j + 1) % cs.length], count = cyc(c2 - c) || n, g2 = [];
      let dur = 0; for (let k = 1; k < count; k++){ const i = cyc(c + k); g2.push(i); dur += gaps[i]; }
      return { gaps: g2, dur, count, start: cyc(c + 1) };
    });
  };
  // the best place to serve inside a run: its longest net-clearing gap (ties → nearest the middle)
  const bestIn = r => {
    let j = -1, best = -Infinity, t = 0;
    r.gaps.forEach(i => { t += gaps[i]; if (!feas[i] || cross[i]) return;
      const sc = gaps[i] - 1e-6 * Math.abs(t - r.dur / 2); if (sc > best){ best = sc; j = i; } });
    return j;
  };
  // 1. the RUN CAP
  for (let it = 0; it < n; it++){
    const over = runs().filter(r => r.dur > runT + 1e-9 || r.count > runN).map(r => bestIn(r)).filter(j => j >= 0);
    if (!over.length) break;
    cross[over[0]] = true;
  }
  // 2. PARITY: the marble must come home — an even number of volleys per loop (serve once more
  //    in the longest run). If no run has a gap to serve on, the loop DOUBLES instead: it is
  //    played once on each wall, the odd volley handing the whole phrase across (the answer is
  //    the reprise) — period 2P, still a pure function of songTime.
  let double = false;
  if (cross.filter(Boolean).length % 2){
    const rs = runs().sort((a, b) => b.dur - a.dur);
    let j = -1; for (const r of rs){ j = bestIn(r); if (j >= 0) break; }
    if (j >= 0) cross[j] = true; else double = true;
  }
  const sidesOf = () => { side[0] = -1; for (let i = 0; i + 1 < n; i++) side[i + 1] = cross[i] ? -side[i] : side[i]; return side; };
  if (double){ sidesOf(); return { side, cross, double }; }
  // 3. BALANCE: a wall that plays less than BAL of the line gets an answer — two serves inside
  //    one of the busy wall's runs flip the strikes between them to it (parity kept)
  for (let it = 0; it < 2 * n; it++){
    sidesOf();
    const L = side.filter(x => x < 0).length, share = L / n;
    if (share >= GEOM.BAL && share <= 1 - GEOM.BAL) break;
    const dom = share > .5 ? -1 : 1, cur = Math.abs(share - .5);
    let best = null;
    for (const r of runs()){
      if (side[r.start] !== dom || r.gaps.length > 64) continue;
      const g2 = r.gaps;
      for (let a = 0; a < g2.length; a++){ if (!feas[g2[a]] || cross[g2[a]]) continue;
        for (let b = a + 1; b < g2.length; b++){ if (!feas[g2[b]] || cross[g2[b]]) continue;
          const flip = b - a, nl = L + (dom < 0 ? -flip : flip), d = Math.abs(nl / n - .5);
          const sc = d - 1e-4 * Math.min(gaps[g2[a]], gaps[g2[b]]);
          if (d < cur - 1e-12 && (!best || sc < best.sc)) best = { sc, a: g2[a], b: g2[b] };
        } }
    }
    if (!best) break;
    cross[best.a] = cross[best.b] = true;
  }
  sidesOf();
  // still lopsided (the busy wall's runs have nowhere left to serve)? Keep the shortest volley
  // home and DOUBLE: each wall plays the whole loop once — exactly even
  const L = side.filter(x => x < 0).length / n;
  if ((L < GEOM.BAL || L > 1 - GEOM.BAL) && cross.some(Boolean)){
    let k = -1; cross.forEach((c, i) => { if (c && (k < 0 || gaps[i] < gaps[k])) k = i; }); cross[k] = false;
    sidesOf(); return { side, cross, double: true };
  }
  return { side, cross, double: false };
}

/* ---- the build ---- */
/** Build the volley. part = [[beat, note, vel?, dur?, 'L'|'R'?]…]. Returns the record R every
    query reads. HONEST OR THINNED: a note the walls can't play honestly (pads that would crowd,
    a bounce that can't happen, a dribble that can't clear) is merged into its neighbour — the
    line is thinned, never drawn interpenetrating — and R.thinned / R.warnings say so. */
export function buildVolley(part, { rollT, beat, P, start = -Infinity, thin = true }){
  let chain = chainEvents(part, { rollT, beat, P });
  const total = chain.length;
  let R; const why = [];
  for (let it = 0; it < 96; it++){
    R = buildCore(chain.map(e => ({ ...e })), { beat, P, start });
    if (!thin || !R.drop.size || chain.length - R.drop.size < 1) break;
    why.push(...[...R.drop].map(i => `${chain[i].note}@${chain[i].beat}: ${R.dropWhy.get(i)}`));
    chain = chain.filter((e, i) => !R.drop.has(i));
  }
  R.total = total; R.thinnedNotes = why; R.thinned = total - R.n / R.loops;
  if (R.thinned) R.notes.unshift(`thinned ${R.thinned} of ${total} notes the walls can't play honestly (merged into their neighbours)`);
  return R;
}
function buildCore(evs, { beat, P, start }){
  let n = evs.length;
  const n1 = n, R = { evs, n, P, start, warnings: [], notes: [], drop: new Set(), loops: 1 };
  if (!n) return Object.assign(R, { V: GEOM.V_MIN, L: laneClock([], P), first: Infinity, holds: [], holdStarts: [],
    tRel: Infinity, ok: true, PRE: 0, POST: 0, ZW: GEOM.ZW_MIN });
  const st = staff(evs.map(e => e.note));
  R.staff = st;
  evs.forEach(e => { e.y = st.yOf(e.note); });
  let { side, cross, double } = assignSides(laneClock(evs.map(e => e.s), P).gaps,
    { ys: evs.map(e => e.y), pins: evs.map(e => e.pin), runT: GEOM.RUN_BEATS * beat });
  if (double){                                         // the loop played twice: once on each wall
    evs.push(...evs.map(e => ({ ...e, s: e.s + P })));
    side = [...side, ...side.map(x => -x)];
    R.n = n = evs.length; R.P = P = 2 * P; R.loops = 2;
  }
  R.L = laneClock(evs.map(e => e.s), P);              // same order as evs (sorted, unique)
  const gaps = R.L.gaps;
  cross = evs.map((e, i) => side[i] !== side[(i + 1) % n]);
  evs.forEach((e, i) => {
    e.i = i; e.rho = st.padR(e.note); e.gap = gaps[i];
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

  // ---- ranks + belt speed: the slowest V whose pads all clear (score ≥ V·W_SPEED, so the scan
  //      stops once no faster belt can win) ----
  let best = null;
  const pc = evs.map(() => new Float64Array(8).fill(NaN));   // pad costs don't depend on V: once per build
  for (let V = GEOM.V_MIN; V <= GEOM.V_MAX + 1e-9; V = +(V + .1).toFixed(2)){
    if (best && V * GEOM.W_SPEED >= best.score) break;
    const { path: rank, hard } = assignRanks(evs, V, pc);
    const sol = solveKinematics(evs, rank);
    const bad = checkSpeed(evs, sol, V, P);
    let steps = 0; for (let i = 0; i < n; i++) if (evs[i].side === evs[(i + 1) % n].side && rank[i] !== rank[(i + 1) % n]) steps++;
    const score = (bad.length + hard) * 100 + steps * GEOM.W_RANK + V * GEOM.W_SPEED;   // (a pad that can't be honest counts as bad)
    if (!best || score < best.score) best = { V, rank, sol, bad, score };
  }
  R.V = best.V;
  evs.forEach((e, i) => Object.assign(e, best.sol[i], { rank: best.rank[i] }));
  const bad = best.bad.slice();
  evs.forEach((e, i) => {
    if (!(e.vinN > 0) || !(e.voutN > 0)) bad.push({ msg: `pad ${i} can't bounce honestly`, drop: i });
    else if (!e.linkOK) bad.push({ msg: `pad ${i}'s linkage can't clear the ball`, drop: i });
    const b = evs[(i + 1) % n];
    if (n > 1 && e.side !== b.side && !e.park && netClear(e.C[0], e.C[1], b.C[0], b.C[1], e.gap) < GEOM.NET_CLR - 1e-9)
      bad.push({ msg: `volley ${i} can't clear the net`, drop: e.pin || b.pin ? -1 : (e.vel < b.vel ? i : (i + 1) % n) });
  });
  R.dropWhy = new Map();
  for (const x of bad){ R.warnings.push(x.msg); if (x.drop >= 0){ R.drop.add(x.drop % n1); R.dropWhy.set(x.drop % n1, x.msg); } }
  R.ok = !bad.length;

  // ---- each pad's unfold window (s, centred on its strike), and the wall's open run: long
  //      enough at V for the slowest unfold to finish before the column ----
  for (const e of evs) e.win = padWindow(e);
  // the count-in's own occurrence (a drop from rest, if it isn't a park's tail)
  const fe = evs[firstIdx], pe = evs[(firstIdx - 1 + n) % n];
  R.cnt = R.cntPark ? null : { ...padSolution(fe.C, [0, -g * fe.tDn, 0], fe.vOut, fe.rho), C: fe.C };
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
   (W_RANK, a rattle); a volley prefers the NEAR rank and must clear the net; and EVERY pad must
   be able to bounce honestly (the marble arrives INTO its face and leaves OFF it) with a linkage
   that clears the ball — that is what decides a rank when the figure could go either way.
   O(n) with back-pointers. */
const HARD = 1000;
function hopVel(a, b, ra, rb){
  const xa = a.side * xOfRank(ra), xb = b.side * xOfRank(rb), T = a.gap;
  if (a.park){ const u = (xb - xa) / T; return { vOut: [u, g * a.tUp, 0], vIn: [u, -g * b.tDn, 0] }; }
  const vy = (b.y - a.y + .5 * g * T * T) / T;
  return { vOut: [(xb - xa) / T, vy, 0], vIn: [(xb - xa) / T, vy - g * T, 0] };
}
function hopCost(a, b, ra, rb, V){
  if (a.side !== b.side){
    if (!a.park && netClear(a.side * xOfRank(ra), a.y, b.side * xOfRank(rb), b.y, a.gap) < GEOM.NET_CLR) return HARD;
    return rb ? .3 : 0;
  }
  if (ra === rb) return dribbleOK(a, b, V) ? 0 : HARD;
  return GEOM.W_RANK;
}
function padCost(vIn, vOut, e, r){
  const n = nrm(sub(vOut, vIn));
  if (!(-dot(vIn, n) > .3 && dot(vOut, n) > .3)) return HARD;
  return linkage([e.side * xOfRank(r), e.y, 0], n, e.rho, armLen(strokeAmp(wallSpeed(-dot(vIn, n), dot(vOut, n))))).ok ? 0 : HARD;
}
function assignRanks(evs, V, pc){
  const n = evs.length;
  if (n === 1) return { path: [0], hard: 0 };
  const E = i => evs[((i % n) + n) % n];
  // pad i struck from rank ra (the hop in) on rank rb, leaving for rank rc (cached per build)
  const pcost = (i, ra, rb, rc) => {
    const j = ((i % n) + n) % n, k = 4 * ra + 2 * rb + rc;
    if (Number.isNaN(pc[j][k])) pc[j][k] = padCost(hopVel(E(i - 1), E(i), ra, rb).vIn, hopVel(E(i), E(i + 1), rb, rc).vOut, E(i), rb);
    return pc[j][k];
  };
  let best = null;
  for (const r1 of [0, 1]){
    // state after placing r_0..r_{i+1}: key = 2·r_i + r_{i+1}; r_0 = 0, r_1 = r1
    let cost = [Infinity, Infinity, Infinity, Infinity];
    cost[r1] = hopCost(E(0), E(1), 0, r1, V);
    const back = [];                                    // back[i−1][key(r_i, r_{i+1})] = r_{i−1}
    for (let i = 1; i < n; i++){                        // choose r_{i+1}; pay hop i and pad i
      const next = [Infinity, Infinity, Infinity, Infinity], bp = [-1, -1, -1, -1];
      for (let key = 0; key < 4; key++){
        if (!(cost[key] < Infinity)) continue;
        const ra = key >> 1, rb = key & 1;
        for (let rc = 0; rc < (i + 1 === n ? 1 : 2); rc++){   // r_n = r_0 closes the loop
          const c = cost[key] + hopCost(E(i), E(i + 1), rb, rc, V) + pcost(i, ra, rb, rc);
          const k2 = 2 * rb + rc;
          if (c < next[k2]){ next[k2] = c; bp[k2] = ra; }
        }
      }
      back.push(bp); cost = next;
    }
    for (let key = 0; key < 4; key++){                 // pad 0: from r_{n−1} → r_0 = 0 → r_1
      if (!(cost[key] < Infinity) || (key & 1)) continue;
      const ra = key >> 1;
      const c = cost[key] + pcost(0, ra, 0, r1);
      if (!best || c < best.c){
        const path = new Array(n + 1); path[n] = 0; path[n - 1] = ra;
        for (let i = n - 1; i >= 1; i--) path[i - 1] = back[i - 1][2 * path[i] + path[i + 1]];
        best = { c, path };
      }
    }
  }
  return { path: best.path.slice(0, n), hard: Math.floor(best.c / HARD + 1e-9) };
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
   stands edge-on, PAD_T thin; a dog-leg boom reaches down to its shoe). Geometry, never
   shrinking: that is what sets V. A forward sweep per pad over the next T_NEAR (cyclic):
   O(n · pads per T_NEAR). Each clash names the note to thin (the softer). */
function checkSpeed(evs, sol, V, P){
  const bad = [], n = evs.length;
  const span = i => [Math.min(sol[i].K[1] - evs[i].rho, sol[i].yb - GEOM.BOOM_R), sol[i].K[1] + evs[i].rho];
  for (let i = 0; i < n; i++){
    const a = evs[i], sa = span(i);
    for (let k = 1; k < n; k++){
      const j = (i + k) % n, b = evs[j];
      const dt = b.s - a.s + (j <= i ? P : 0);
      if (dt > GEOM.T_NEAR) break;
      if (a.side !== b.side) continue;
      const sb = span(j);
      if (V * dt < a.rho + b.rho + GEOM.CLR && Math.min(sa[1], sb[1]) - Math.max(sa[0], sb[0]) > -GEOM.CLR){
        bad.push({ msg: `pads ${i}/${j} crowd at V=${V}`, drop: b.vel < a.vel ? j : i });
      }
    }
  }
  // a same-rank same-wall hop must be a clean dribble at this V (the loop seam may force one)
  for (let i = 0; i < n; i++){
    const a = evs[i], b = evs[(i + 1) % n];
    if (n > 1 && a.side === b.side && sol[i].rank === sol[(i + 1) % n].rank && !dribbleOK(a, b, V))
      bad.push({ msg: `dribble ${i} can't clear at V=${V}`, drop: (i + 1) % n });
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
  sol.forEach((s, i) => Object.assign(s, padSolution(s.C, s.vIn, s.vOut, evs[i].rho)));
  return sol;
}

/* ---- the linkage: 2-D (the strike plane, at the pad's own z — where its disc is widest) ---- */
const d2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function ptSeg(p, a, b){
  const ab = [b[0] - a[0], b[1] - a[1]], L2 = ab[0] * ab[0] + ab[1] * ab[1];
  const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2)) : 0;
  return d2(p, [a[0] + u * ab[0], a[1] + u * ab[1]]);
}
const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segSeg(a, b, c, d){
  const d1 = cr(c, d, a), d2_ = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
  if (((d1 > 0 && d2_ < 0) || (d1 < 0 && d2_ > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
}
function segPoly(a, b, poly){
  const inside = p => { let pos = 0, neg = 0; for (let i = 0; i < poly.length; i++){ const c = cr(poly[i], poly[(i + 1) % poly.length], p); if (c > 0) pos++; else if (c < 0) neg++; } return !(pos && neg); };
  if (inside(a) || inside(b)) return 0;
  let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, segSeg(a, b, poly[i], poly[(i + 1) % poly.length]));
  return m;
}
/** The arm (knuckle → face) a stroke of amplitude A needs: the wind-up draws the disc back by
    A (and the follow-through + recoil by a little), so the knuckle sits that much further back
    — the disc never reaches its own knuckle. */
export const armLen = A => GEOM.ARM + Math.max(0, A, .25 * Math.abs(A) + GEOM.RECOIL);
/** A pad's linkage for contact centre C, face normal n, radius ρ, arm length armL:
    { S, K, yb, back, ok }. The boom runs straight at knuckle height when that clears the disc
    (at rest AND wound back) and the ball; else it DOG-LEGS under them (yb) and a riser climbs
    to the knuckle. ok: it all clears. */
export function linkage(C, nn, rho, armL = GEOM.ARM){
  const side = Math.sign(C[0]) || -1;
  const S = sub(C, mul(nn, RM)), K = sub(S, mul(nn, armL));
  const t = [-nn[1], nn[0]], T = GEOM.PAD_T;
  const discAt = c => [[c[0] + rho * t[0], c[1] + rho * t[1]], [c[0] - rho * t[0], c[1] - rho * t[1]],
                [c[0] - rho * t[0] - T * nn[0], c[1] - rho * t[1] - T * nn[1]], [c[0] + rho * t[0] - T * nn[0], c[1] + rho * t[1] - T * nn[1]]];
  const discs = [discAt(S), discAt(add(K, mul(nn, GEOM.ARM)))];          // at rest; wound fully back
  const ball = [C[0], C[1]], shoeX = side * XF, BR = GEOM.BOOM_R;
  const clear = (a, b) => discs.every(d => segPoly(a, b, d) >= BR + .03) && ptSeg(ball, a, b) >= BR + RM + .03;
  let yb = K[1];
  if (!clear([shoeX, yb], [K[0], yb])) yb = Math.min(...discs.flat().map(p => p[1]), C[1] - RM) - BR - GEOM.LINK_CLR;
  const ok = yb >= GEOM.Y_BOOM_MIN - 1e-9 && (yb === K[1] || (clear([shoeX, yb], [K[0], yb]) && clear([K[0], yb], [K[0], K[1]])));
  return { S, K, yb, back: side * nn[0] > 0, ok };
}
/* one contact: the face normal is the push direction; face + knuckle placed under the marble */
function padSolution(C, vIn, vOut, rho){
  const nn = nrm(sub(vOut, vIn));
  const vinN = -dot(vIn, nn), voutN = dot(vOut, nn);
  const w = wallSpeed(vinN, voutN), A = strokeAmp(w), armL = armLen(A);
  const lk = linkage(C, nn, rho, armL);
  return { nrm: nn, S: lk.S, K: lk.K, yb: lk.yb, back: lk.back, linkOK: lk.ok, armL, vinN, voutN, w, A, vIn: vIn.slice(), vOut: vOut.slice() };
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
    { top (face centre), n (face normal), knuckle, shoe (on its slat), elbow (the boom's end:
    the riser climbs from it to the knuckle — the same point when the boom runs straight), z, extend, tilt, off, live, side, rho }.
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
  // the arm telescopes to its stroke length only once the disc has tipped into the strike plane
  // (a half-tipped disc leans along the wall: a long arm then would swing it into a neighbour)
  const arm = GEOM.ARM + ((sol.armL ?? GEOM.ARM) - GEOM.ARM) * smooth(.7, 1, d.tilt);
  const top = add(knuckle, mul(nn, arm + off));
  const yb = sol.yb ?? ky;                             // the boom's height: a dog-leg runs under the disc
  return { top, n: nn, knuckle, shoe: [side * XF, yb, z], elbow: [knuckle[0], yb, z], z, extend: d.extend, tilt: d.tilt,
           off, arm, live, side, rho: e.rho };
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

/** The MAP panel's honesty pass (editor/mapping.js LINE_SPEC.volley.refine): build the line as
    the room will (P = ROLL_T + loop + 1.2, main's loop; start = main's ARM_AT) and keep only what the walls can play —
    the thinned notes are named in the warnings, so the panel shows what will actually sound. */
export function refineLine(part, { bpm, loopBeats }){
  const beat = 60 / bpm, P = ROLL_T + loopBeats * beat + 1.2;
  const R = buildVolley(part, { rollT: ROLL_T, beat, P, start: ARM_AT });
  if (!R.thinned) return { part, warnings: R.ok ? [] : R.warnings.slice(0, 3) };
  const keep = new Set(R.evs.slice(0, R.n / R.loops).map(e => e.beat));
  return { part: part.filter(e => keep.has(e[0])),
    warnings: [`thinned ${R.thinned} of ${R.total} notes the walls can't play honestly (pads would crowd or a bounce can't happen)`] };
}
