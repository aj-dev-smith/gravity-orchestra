/* ============================================================
   JUGGLER — the melody belt as a MULTIBALL JUGGLING MACHINE (pure math: no THREE
   scene, no DOM, no audio — test/juggle.test.js; catalog report: scripts/juggle-report.mjs).

   WHY. The first belt flew ONE marble through every note of a voice. Every strike
   happens on the strike line (the static band), so a hop of F seconds leaves its plate
   at g·F/2 — while the plate under it rises at DESCENT. Below F* = 2·DESCENT/g ≈ 0.30 s
   the marble rises SLOWER than its own plate: it can't bounce, it gets swept off
   sideways (the "skim" — 56–82 % of the notes in the fastest songs). And every voice
   got its own machine, side by side (Dies Irae: three machines, 56 units wide).

   THE MACHINE. One paternoster per song, shared by every belt voice:
     · LANES — K fixed slots across the strike line, laid out like a KEYBOARD: a note's
       plate rises into the slot for its pitch (low left, high right — a pure fn of the
       note, like its size), so the tune reads side to side. Each voice spreads over
       ≥ W_MIN lanes around its register. A plate that would crowd its slot is NUDGED
       one over (its last plate there hasn't folded away yet).
     · ROWS — each voice works its own depth row (melody in front, bass at the back), and
       each row has two HANDS: a front and a back line, a ball's width apart. A plate rises
       on the line its ball needs; a ball may cross from one hand to the other in flight
       (its depth moves at constant speed, like any free flight). Balls of different voices
       never meet.
     · BALLS — a voice owns M identical balls; each note is struck by exactly one. A
       ball's flight from note i to its next note j is the solved arc for s_j − s_i. Dense
       music JUGGLES: more balls, each flying longer (Shannon: balls = flight ÷ note
       spacing), instead of one ball flying faster. A beam search picks who strikes what
       and on which hand (cost: short flights, skipped notes, steep plates, hard flipper
       strokes, fast sideways throws, crane work, extra balls). Under one gravity two
       balls' RELATIVE motion is a straight line, so the no-collision check between two
       flights is exact.
     · THE CRANE — each voice keeps its crane, now one CARRIAGE per ball (a magnet on a
       winch, the old crane's head) on two rails, one over each hand. A ball that rests is
       thrown STRAIGHT UP to an empty carriage waiting over its plate (it arrives at v = 0 —
       the clack); a ball entering play is released from rest and free-falls onto its plate
       on the beat. Every ball is home at the loop's breath, so a voice's ball count IS its
       carriage count. Carriages on one rail keep their order; every move is smootherstep
       keys under the crane's V/A limits, with the crane's dwell around each event.
     · PLATES — each tilted along Δv = vOut − vIn (a smooth plate can only push along its
       normal; the rest of the velocity carries through), its flipper's stroke speed at
       contact solved from restitution: (vOut − U)·n = −e·(vIn − U)·n. The flipper WINDS UP
       (pulls back along −n, further for a harder throw — the old belt's pad swing) and
       SWINGS into the ball, arriving at exactly that speed. The moment it is struck it
       RECOILS (faster than gravity — the ball can't follow); the plate stays out, rising
       with its chain, for as long as nothing comes near it (the HOLD), then FOLDS (snaps
       back onto its chain, tips flat). The search plans every plate folding at once —
       always clear: every flight runs between two points on the strike line, so it stays
       above it, and only a plate struck a moment ago can be in a ball's way.

   Frame: the machine's BAND frame — x across the machine (lane 0 left), y up from the
   contact level (a ball's centre at its strike), z toward the audience. Time is the only
   state: every ball, plate and carriage pose is a pure fn of songTime (period P).
   ============================================================ */
import { G, DESCENT, ROLL_T, noteNum, beltPhase, deployPose, padRadius, PAD_R } from './engine.js';
import { CRANE, dtFree, minMoveT, segEval } from './crane.js';
import { beltVel } from './dynamics.js';

const g = -G.y;
const DEG = Math.PI / 180;

export const JUGGLE = {
  LANES:  9,       // slots across the strike line (the keyboard)
  LANE_D: 1.5,     // lane pitch — the melody's biggest plate (1.41) fits between neighbours
  W_MIN:  5,       // a voice spreads over at least this many lanes
  Z_BACK: .25,     // the back hand of the back row (in front of the housing face, −.6)
  R: { lead: .26, alto: .21, bass: .36 },   // ball radii (main.js RIG_OPT)
  E: .6,           // plate restitution (the drums' e)
  F_HARD: .22,     // no flight shorter than this (the plate drops away from under the ball)
  F_TARGET: .45,   // below this a flight costs — the multiball target (a soft floor)
  HS: [4.6, 3.6, 2.6, 1.6],                 // catch / release heights (ball centre over contact), high first
  TILT_SOFT: 25 * DEG, TILT_MAX: 52 * DEG,  // plate tilt from level
  W_SOFT: 4, W_MAX: 8,                      // flipper stroke speed at contact (u/s, relative to its carrier)
  VH_SOFT: 4.5, VH_MAX: 10,                 // sideways speed of a flight (u/s)
  STROKE_S: .1,    // the flipper's swing into contact (s): from rest, pulled back by its AMP, to the strike at w …
  WIND_T: .3, WIND_K: .35,                  // … after a wind-up of WIND_T + WIND_K·AMP (s): a bigger throw telegraphs longer
  AMP_K: .07, AMP_MIN: .06, AMP_MAX: .6,    // the pull-back AMP = AMP_K × the throw's speed along n (the old pad's swing), clamped
  A_DROP: 40,      // after contact the flipper RECOILS along −n at this (> g: the ball can't keep up) …
  DROP_T: .05,     // … for this long (s), then brakes to rest by REST_T and eases home by HOME_T
  REST_T: .12, HOME_T: .34,
  HOLD_MAX: .8,    // after its strike a plate stays out (rising with its chain) up to this long, while nothing comes near it …
  FOLD_T: .32,     // … then folds: snaps back onto the chain, tips flat (s)
  PLATE_PRE: .55,  // a rising plate is checked against the balls from this long before its strike (s — covers the wind-up)
  ARM: { Z: -2, HUB: .3, R: .05 },          // a plate's arm: its shoe on the chain (depth Z: the chain's front strand PTGEO.CZ + .2) to its hub, HUB·scale (HUB_BACK) behind its face
  CLEAR: .04,      // a HELD plate (and its arm) keeps this clear of every ball, plate and arm (u)
  T_SAME: .36,     // a lane's next plate (same voice) comes no sooner than this after its last
  T_CROSS: .25,    // a back-row plate keeps this clear of a front-row plate in its lane (the arm)
  NUDGE: 2,        // lanes a plate may move off its home slot
  BEAM: 40,        // beam width of the ball search …
  DIV: 4,          // … keeping at most this many nodes per set of balls in the air (diversity beats width) …
  BEAMS: [3],      // … retried this many times wider when a voice's plan still breaks a hard limit
  M_MAX: 4,        // carriages (= balls) per voice
  HIT_GAP: .03,    // balls keep at least this clear of each other (u)
  MAG_R: .24, MAG_H: .58,                   // a magnet body (radius, height above its face)
  SEP: .1,         // carriages on one rail keep this clear of each other (beyond their bodies)
  plate: { L: 1.1, T: .12, W: .44 },        // tone-plate (paternoster BAR) at scale 1
  STOW_Z: -1.75, INNER: 3, CULL: 7.65,      // stowed depth, fully-out band ± INNER, cull band ± CULL (the retired paternoster's window)
  C: { short: 40, skip: 1, swap: .5, entry: 10, exit: 10, ball: 25, tilt: 30, w: .6, vh: .3, low: .4,
       hit: 1e4, hard: 1e3, late: 1e6, order: 1e7 },
};

/* ---- small vector / quaternion kit (plain objects — this module stays THREE-free) ---- */
const v3 = (x, y, z) => ({ x, y, z });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function quatFromUnit(a, b){                                // rotation taking unit a onto unit b
  const d = dot3(a, b);
  if (d < -1 + 1e-9) return { x: 1, y: 0, z: 0, w: 0 };
  const c = v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x), w = 1 + d;
  const l = Math.hypot(c.x, c.y, c.z, w);
  return { x: c.x / l, y: c.y / l, z: c.z / l, w: w / l };
}
function slerp(a, b, t){
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, s = 1;
  if (d < 0){ d = -d; s = -1; }
  if (d > .9995){
    const q = { x: a.x + (s * b.x - a.x) * t, y: a.y + (s * b.y - a.y) * t, z: a.z + (s * b.z - a.z) * t, w: a.w + (s * b.w - a.w) * t };
    const l = Math.hypot(q.x, q.y, q.z, q.w); return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
  }
  const th = Math.acos(d), k0 = Math.sin((1 - t) * th) / Math.sin(th), k1 = s * Math.sin(t * th) / Math.sin(th);
  return { x: a.x * k0 + b.x * k1, y: a.y * k0 + b.y * k1, z: a.z * k0 + b.z * k1, w: a.w * k0 + b.w * k1 };
}
export function rotate(q, v){                               // q · v
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return v3(v.x + q.w * tx + (q.y * tz - q.z * ty), v.y + q.w * ty + (q.z * tx - q.x * tz), v.z + q.w * tz + (q.x * ty - q.y * tx));
}
const UPV = v3(0, 1, 0), Q_ID = { x: 0, y: 0, z: 0, w: 1 };
export const Q_FLAT = quatFromUnit(UPV, v3(0, 0, 1));       // stowed: the plate stands against its chain, face forward
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const fallT = h => Math.sqrt(2 * h / g);
const F_FREE = dtFree(g);                                   // the longest free flight (apex H_FREE, under the lip)
const PRE = { drop: CRANE.MIN_HOLD, catch: CRANE.LEAD, shift: 0 };   // a carriage is still this long before its event …
const POST = { drop: CRANE.POST, catch: CRANE.DOCK, shift: 0 };       // … and this long after it

/* ---- the song's belt voices (mirrors main.js buildWorld) ---- */
export function beltVoices(song){
  const out = [{ role: 'lead', notes: song.melody, delay: 0, deep: false }];
  for (const role of ['alto', 'bass']){
    const p = song[role];
    if (!p) continue;
    const d = Array.isArray(p) ? { notes: p, delay: 0 } : p;
    if (d.notes && d.notes.length) out.push({ role, notes: d.notes, delay: d.delay || 0, deep: role === 'bass' || !!d.deep });
  }
  return out;
}

export const laneX = (k, o = JUGGLE) => (k - (o.LANES - 1) / 2) * o.LANE_D;

/* The KEYBOARD: every voice's home slots. One shared pitch axis over all belt voices
   (semitones per lane = range / (K − 1)); a voice spreads over max(W_MIN, its span) lanes
   centred on its register, so a narrow line still has room to move. */
export function keyboard(voices, o = JUGGLE){
  const K = o.LANES;
  const ms = voices.map(v => v.notes.map(([n]) => noteNum(n)));
  const all = ms.flat(), lo = Math.min(...all), hi = Math.max(...all);
  const per = Math.max(1, (hi - lo) / (K - 1));
  return voices.map((v, i) => {
    const a = Math.min(...ms[i]), b = Math.max(...ms[i]), span = b - a;
    const width = Math.max(Math.min(o.W_MIN, K), Math.min(K, Math.round(span / per) + 1));
    const centre = ((a + b) / 2 - lo) / per;
    const start = Math.max(0, Math.min(K - width, Math.round(centre - (width - 1) / 2)));
    return { lo: a, hi: b, start, width,
      home: m => start + (span ? Math.round((m - a) / span * (width - 1)) : (width - 1) >> 1) };
  });
}

/* ---- plates: contact physics + pose ---------------------------------------------------
   Plate k is struck at s_k by a ball arriving at vIn and leaving at vOut (band frame).
   Frictionless contact → the impulse is along the normal: n ∝ Δv = vOut − vIn. Its carrier
   rises at DESCENT; the flipper strokes along n so that, at contact, the plate's normal
   speed U·n satisfies restitution: U·n = (vOut·n + e·vIn·n)/(1 + e). w = U·n − DESCENT·n_y is
   the flipper's own stroke speed at contact (> 0 a kick, < 0 a catch — it gives under the
   ball like a hand under an egg). (vOut − vIn)·n = |Δv| > 0, so the ball always approaches
   before and separates after. */
export function contact(vIn, vOut, o = JUGGLE){
  const d = v3(vOut.x - vIn.x, vOut.y - vIn.y, vOut.z - vIn.z), l = Math.hypot(d.x, d.y, d.z);
  const n = l > 1e-9 ? v3(d.x / l, d.y / l, d.z / l) : v3(0, 1, 0);
  const Un = (dot3(vOut, n) + o.E * dot3(vIn, n)) / (1 + o.E);
  return { n, tilt: Math.acos(Math.min(1, Math.max(-1, n.y))), w: Un - DESCENT * n.y,
           amp: Math.min(o.AMP_MAX, Math.max(o.AMP_MIN, o.AMP_K * dot3(vOut, n))) };   // the swing: a harder throw, a bigger wind-up
}

/* The flipper's travel along its normal, relative to its carrier, at belt phase c (s from
   the strike), for a swing of amplitude amp: it WINDS UP — eases back to −amp, at rest at
   both ends, over windT(amp) − STROKE_S — then SWINGS into the ball over STROKE_S, from rest
   at −amp to the strike (0) moving at exactly w (a Hermite: never past the plate's face
   before contact when w ≥ 0). Then it RECOILS — accelerates back along −n at A_DROP (> g, so
   the ball, which only has gravity, can't follow it down) for DROP_T, brakes to rest by
   REST_T, and eases home by HOME_T. That is what lets a short hop leave a plate that rises
   faster than the ball. */
export const windT = (amp, o = JUGGLE) => o.WIND_T + o.WIND_K * amp;
export function flipper(c, w, amp, o = JUGGLE){
  const I = windT(amp, o), S = o.STROKE_S;
  if (c <= -I || c >= o.HOME_T) return 0;
  if (c <= -S){ const u = (c + I) / (I - S); return -amp * u * u * (3 - 2 * u); }
  if (c <= 0){ const u = (c + S) / S, u2 = u * u, u3 = u2 * u; return -amp * (2 * u3 - 3 * u2 + 1) + w * S * (u3 - u2); }
  const A = o.A_DROP, T1 = o.DROP_T, T2 = o.REST_T;
  if (c <= T1) return w * c - .5 * A * c * c;
  const p1 = w * T1 - .5 * A * T1 * T1, v1 = w - A * T1, D = T2 - T1;
  if (c <= T2){ const u = c - T1; return p1 + v1 * u - v1 * u * u / (2 * D); }
  return (p1 + v1 * D / 2) * (1 - smooth(T2, o.HOME_T, c));
}

/* Fold progress, c s after the plate's HOLD ended (c ≤ 0: still out): the arm SNAPS back
   toward the chain (from the moment of contact when it has no hold — the contact impulse is
   along n, the snap can't disturb it), the plate tips flat behind it. */
export function foldPose(c, o = JUGGLE){
  return { extend: 1 - smooth(0, o.FOLD_T * .8, c), tilt: 1 - smooth(o.FOLD_T * .15, o.FOLD_T, c) };
}

/* Plate p's box at belt phase c (p: { x, z, n, q, w, d, scale }): centre, orientation, half
   extents. Unfolding on the way up = the belt's deployPose; folding after = foldPose; the
   flipper rides along the live normal. At contact the top face touches the ball:
   centre = strike point − n·(r + T/2). */
function plateBox(V, p, c, o, hold = p.hold || 0){
  const dep = c < 0 ? deployPose(c, V.innerC, V.cullC) : foldPose(c - hold, o);
  const q = slerp(Q_FLAT, p.q, dep.tilt);
  const nn = rotate(q, UPV), off = flipper(c, p.w, p.amp ?? 0, o) * dep.tilt;
  const cx = p.x - p.n.x * p.d * dep.tilt, cy = DESCENT * c - p.n.y * p.d;
  const cz = o.STOW_Z + (p.z - p.n.z * p.d * dep.tilt - o.STOW_Z) * dep.extend;
  const x = cx + nn.x * off, y = cy + nn.y * off, z = cz + nn.z * off, hb = o.ARM.HUB * p.scale;
  return { x, y, z, q, n: nn, c, extend: dep.extend, tilt: dep.tilt,
           hx: o.plate.L * p.scale / 2, hy: o.plate.T * p.scale / 2, hz: o.plate.W * p.scale / 2,
           hub: v3(x - nn.x * hb, y - nn.y * hb, z - nn.z * hb), shoe: v3(p.x, DESCENT * c - p.d, o.ARM.Z) };   // the arm: shoe (on its chain) → hub
}

/* Plate k's pose at songTime t; null while it is out of sight (inside the housings). */
export function plateAt(V, k, t){
  const p = V.plates[k], c = beltPhase(t, p.s, V.P);
  if (Math.abs(DESCENT * c) > V.cullD) return null;
  return plateBox(V, p, c, V.o);
}

/* Sphere (centre x,y,z, radius r) vs a plate box: separation (< 0 = overlap). */
export function plateGap(B, x, y, z, r){
  const ax = rotate(B.q, v3(1, 0, 0)), ay = B.n, az = rotate(B.q, v3(0, 0, 1));
  const d = v3(x - B.x, y - B.y, z - B.z);
  const lx = dot3(d, ax), ly = dot3(d, ay), lz = dot3(d, az);
  const ex = Math.max(0, Math.abs(lx) - B.hx), ey = Math.max(0, Math.abs(ly) - B.hy), ez = Math.max(0, Math.abs(lz) - B.hz);
  const out = Math.hypot(ex, ey, ez);
  if (out > 0) return out - r;
  return -Math.min(B.hx - Math.abs(lx), B.hy - Math.abs(ly), B.hz - Math.abs(lz)) - r;
}

/* ---- segments -----------------------------------------------------------------------------
   A ball in free flight: { t0, t1, x0, y0, z0, vx, vy, vz } — p = p0 + v·u, y − ½·g·u²;
   kind 'flight' (plate a → plate b), 'drop' (a carriage → plate b), 'rise' (plate a → a
   carriage). The search also prices the crane's bodies: a 'still' one (a carriage waiting,
   its ball or its empty magnet) and a 'lift' (a carriage moving on a smootherstep from
   (x0, y0) to (x1 ?? x0, y1) at its rail depth z0). `rad` is the body's radius; segments
   sharing an `ev` belong to one catch / release and may touch, as may one carriage's own
   (`cid`). */
export const segPos = (s, t) => {
  if (s.still) return { x: s.x0, y: s.y0, z: s.z0, vx: 0, vy: 0, vz: 0 };
  if (s.lift){
    const T = s.t1 - s.t0, u = Math.min(1, Math.max(0, (t - s.t0) / T)), S = u * u * u * (10 - 15 * u + 6 * u * u);
    const dS = 30 * u * u * (1 - u) * (1 - u) / T, x1 = s.x1 ?? s.x0;
    return { x: s.x0 + (x1 - s.x0) * S, y: s.y0 + (s.y1 - s.y0) * S, z: s.z0, vx: (x1 - s.x0) * dS, vy: (s.y1 - s.y0) * dS, vz: 0 };
  }
  const u = t - s.t0;
  return { x: s.x0 + s.vx * u, y: s.y0 + s.vy * u - .5 * g * u * u, z: s.z0 + s.vz * u, vx: s.vx, vy: s.vy - g * u, vz: s.vz };
};
/* the box a segment sweeps over [lo, hi] */
function segBox(s, lo, hi){
  const a = segPos(s, lo), b = segPos(s, hi);
  let y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  if (!s.still && !s.lift && s.vy > 0){ const ta = s.t0 + s.vy / g; if (ta > lo && ta < hi) y1 = segPos(s, ta).y; }
  return [Math.min(a.x, b.x), Math.max(a.x, b.x), y0, y1, Math.min(a.z, b.z), Math.max(a.z, b.z)];
}
/* least centre distance between two segments over their common time, or Infinity when their
   swept boxes stay more than `reach` apart. Two free flights: exact (one g — their RELATIVE
   motion is a straight line); otherwise sampled every 10 ms, refined to 1 ms. */
export function segMinDist(a, b, reach = Infinity){
  const lo = Math.max(a.t0, b.t0), hi = Math.min(a.t1, b.t1);
  if (hi - lo < 1e-9) return Infinity;                      // touching ends only (one ball's own chain)
  if (reach < Infinity){
    const A = segBox(a, lo, hi), B = segBox(b, lo, hi);
    if (A[0] - B[1] > reach || B[0] - A[1] > reach || A[2] - B[3] > reach || B[2] - A[3] > reach ||
        A[4] - B[5] > reach || B[4] - A[5] > reach) return Infinity;
  }
  const d = t => { const p = segPos(a, t), q = segPos(b, t); return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); };
  if (a.still || b.still || a.lift || b.lift){
    const n = Math.max(2, Math.ceil((hi - lo) / .01));
    let m = Infinity, tm = lo;
    for (let k = 0; k <= n; k++){ const t = lo + (hi - lo) * k / n, v = d(t); if (v < m){ m = v; tm = t; } }
    for (let t = Math.max(lo, tm - .01); t <= Math.min(hi, tm + .01); t += .001) m = Math.min(m, d(t));
    return m;
  }
  const p0 = segPos(a, lo), q0 = segPos(b, lo), p1 = segPos(a, hi), q1 = segPos(b, hi);
  const D0 = v3(p0.x - q0.x, p0.y - q0.y, p0.z - q0.z), E = v3(p1.x - q1.x - D0.x, p1.y - q1.y - D0.y, p1.z - q1.z - D0.z);
  const ee = dot3(E, E), lam = ee > 1e-12 ? Math.min(1, Math.max(0, -dot3(D0, E) / ee)) : 0;
  return Math.hypot(D0.x + lam * E.x, D0.y + lam * E.y, D0.z + lam * E.z);
}

function lowerBound(a, v){ let lo = 0, hi = a.length; while (lo < hi){ const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }
function upperBound(a, v){ let lo = 0, hi = a.length; while (lo < hi){ const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; } return lo; }

/* ---- the plan --------------------------------------------------------------------------------
   Two stages. The LAYOUT (fast: the voices, the keyboard, the depth rows, the lanes) fixes the
   machine's shape; the SOLVE (the beam search: who strikes what, on which hand) is the slow part
   — up to seconds on a dense song — so it can come from somewhere else: a baked plan (the
   catalog), a worker (an import). Its result is plain data ({decs, carr, cost, bad, beam} per
   voice). assembleJuggler turns layout + solve into the plan every pose function reads. */
export function planJuggler(song, opt = {}){
  const L = layoutJuggler(song, opt);
  return assembleJuggler(L, opt.solved || solveJuggler(L));
}

export function layoutJuggler(song, opt = {}){
  const o = { ...JUGGLE, ...opt, C: { ...JUGGLE.C, ...(opt.C || {}) } };
  delete o.solved;
  const beat = 60 / song.bpm;
  const voices = beltVoices(song);
  const leadTotal = voices[0].notes.reduce((a, e) => a + e[1], 0) * beat;
  const P = ROLL_T + leadTotal + 1.2;
  const kb = keyboard(voices, o);
  const cullD = Math.min(o.CULL, DESCENT * P * .5 - .5);

  const VJS = voices.map((v, vi) => {
    const r = o.R[v.role] ?? .26, radOf = padRadius(v.notes, v.role);
    let s = ROLL_T + v.delay * beat;
    const notes = v.notes.map((e, j) => {
      const q = { j, note: e[0], m: noteNum(e[0]), s, dt: e[1] * beat, vel: beltVel(e), scale: radOf(e[0]) / PAD_R };
      s += e[1] * beat;
      return q;
    });
    return { role: v.role, deep: v.deep, delay: v.delay, r, kb: kb[vi], notes, P, o, warn: [],
             hand: r + o.HIT_GAP / 2 + .05,                 // half the spacing of its two hands
             reach: Math.max(r, o.plate.W * Math.max(...notes.map(q => q.scale)) / 2),
             cullD, cullC: cullD / DESCENT, innerC: Math.min(o.INNER, cullD * .64) / DESCENT };
  });
  // depth: the back row's back hand at Z_BACK, each row's two hands 2·hand apart, rows a ball +
  // a plate's half depth apart — so no ball or plate of one voice can reach another's
  let zb = o.Z_BACK;
  for (let vi = VJS.length - 1; vi >= 0; vi--){
    const V = VJS[vi];
    if (vi < VJS.length - 1) zb += VJS[vi + 1].reach + V.reach + .05;
    V.hands = [zb + 2 * V.hand, zb];                        // [front, back]
    V.z = zb + V.hand;
    zb += 2 * V.hand;
  }

  // lanes, front row first: a back row keeps clear of the arms of the plates in front of it
  const front = Array.from({ length: o.LANES }, () => []);
  VJS.forEach(V => {
    assignLanes(V, front, o);
    V.notes.forEach(q => front[q.lane].push(q.s));
  });
  const maxPlate = Math.max(...VJS.flatMap(V => V.notes.map(q => o.plate.L * q.scale)));
  return { P, beat, o, lanes: o.LANES, laneD: o.LANE_D, voices: VJS, warnings: [], key: jugglerKey(song),
           width: (o.LANES - 1) * o.LANE_D + maxPlate, depth: [o.Z_BACK, VJS[0].hands[0]] };
}

/* the search, per voice: a voice whose plan still breaks a hard limit (a contact, a limit, a
   carriage late or out of order) is searched again with a wider beam; the cheapest plan wins.
   Plain data out (a worker posts it back, the bake stores it). Each (voice, width) search is its
   own pure job — solveVoiceAt — so a page can run them side by side (jugglejobs.js: a worker each);
   settleVoice over the jobs' results, in width order, is exactly this loop's choice. */
export const BEAM_STEPS = L => [1, ...L.o.BEAMS];
export function solveJuggler(L){
  const steps = BEAM_STEPS(L);
  return L.voices.map((V, vi) => {
    const tried = [];
    for (const m of steps){
      tried.push(solveVoiceAt(L, vi, m));
      const best = settleVoice(tried, steps.length);
      if (best) return best;
    }
    return pickBest(tried);
  });
}
export function solveVoiceAt(L, vi, m = 1){
  const plan = solveVoice(L.voices[vi], { ...L.o, BEAM: L.o.BEAM * m });
  return { decs: plan.decs, carr: plan.carr.map(k => ({ id: k.id, hand: k.hand, home: k.home })), cost: plan.cost, bad: plan.bad, beam: plan.beam };
}
/* the better of the plans tried for one voice, in the order tried (wider beams later): fewer
   broken limits, then cheaper — an earlier plan keeps a tie */
export function pickBest(plans){
  let best = null;
  for (const p of plans) if (p && (!best || p.bad < best.bad || (p.bad === best.bad && p.cost < best.cost))) best = p;
  return best;
}
/* results[i] = the plan of width step i (undefined while still running), n = how many steps
   there are: the voice's answer once it is decided — the first prefix whose best is clean, or
   the best of all — else null (keep waiting) */
export function settleVoice(results, n){
  for (let i = 0; i < n; i++){
    if (!results[i]) return null;
    const best = pickBest(results.slice(0, i + 1));
    if (!best.bad || i === n - 1) return best;
  }
  return null;
}

/* The BAKE's compact form of a solve (src/juggle-baked.json holds the catalog's, so a page load
   never searches): per voice { c: [[id, hand, home]…], d: [[src, hand, drop, exit]…] (one per
   note, in order), h: [each plate's hold, in hundredths], cost, bad, beam }, with drop / exit =
   0 or [h, cid, …shifts as cid, t, x]. Pass the assembled plan J to keep its holds (the hold
   pass is the other slow part). Lossless — JSON keeps doubles exact: a baked plan is the solved
   plan, bit for bit. */
export function packSolve(solved, J = null){
  const ev = e => e ? [e.h, e.cid, ...e.shifts.flatMap(q => [q.cid, q.t, q.x])] : 0;
  return solved.map((v, vi) => ({ c: v.carr.map(k => [k.id, k.hand, k.home]), d: v.decs.map(d => [d.src, d.hand, ev(d.drop), ev(d.exit)]),
                                  ...(J ? { h: holdsOf(J)[vi] } : v.hold ? { h: v.hold } : {}), cost: v.cost, bad: v.bad, beam: v.beam }));
}
export function unpackSolve(packed){
  const ev = a => { if (!a) return null; const shifts = []; for (let i = 2; i < a.length; i += 3) shifts.push({ cid: a[i], t: a[i + 1], x: a[i + 2] }); return { h: a[0], cid: a[1], shifts }; };
  return packed.map(v => ({ carr: v.c.map(([id, hand, home]) => ({ id, hand, home })),
                            decs: v.d.map(([src, hand, drop, exit], j) => ({ j, src, hand, drop: ev(drop), exit: ev(exit) })),
                            ...(v.h ? { hold: v.h } : {}), cost: v.cost, bad: v.bad, beam: v.beam }));
}
/* every plate's hold per voice, in whole hundredths (what the bake and the worker carry) */
export const holdsOf = J => J.voices.map(V => V.plates.map(p => Math.round(p.hold * 100)));

export function assembleJuggler(L, solved){
  if (!solved || solved.length !== L.voices.length) throw new Error('juggler: the solve does not match the layout');
  L.voices.forEach((V, vi) => {
    const sv = solved[vi];
    V.bad = sv.bad; V.beam = sv.beam;
    assemble(V, sv.decs, sv.carr, sv.cost, L.o);
    ballChains(V);
    L.warnings.push(...V.warn);
    if (sv.bad) L.warnings.push(`${V.role}: ${sv.bad} hard-limit decision(s) left`);
  });
  if (solved.every((sv, vi) => sv.hold && sv.hold.length === L.voices[vi].plates.length))
    L.voices.forEach((V, vi) => V.plates.forEach((p, k) => { p.hold = solved[vi].hold[k] / 100; }));
  else holdPlates(L);
  L.solved = true;
  return L;
}

/* ---- the HOLD ------------------------------------------------------------------------------
   After its strike a plate stays out — rising with its chain, its flipper settling — while
   nothing comes near it, up to HOLD_MAX; then it folds (foldPose, FOLD_T). The search plans every
   plate folding at once (hold 0: always clear), so this only ever LENGTHENS a hold that keeps
   CLEAR of every ball (any voice, held ones too), every other plate and every arm of the whole
   machine — through the hold AND the fold after it: it never costs the plan anything. Plates go
   in strike order and check the holds already fixed (a later plate is posed with hold 0 here; it
   checks this one when its turn comes). Holds are whole hundredths (the bake stores them). */
const HOLD_STEP = 5, HOLD_DT = .01;                          // a hold's grain (hundredths); the check's time step (s)
function holdPlates(L){
  const o = L.o, P = L.P, A = o.ARM, all = [];
  L.voices.forEach((V, vi) => V.plates.forEach((p, k) => { p.hold = 0; all.push({ V, vi, p, k }); }));
  all.sort((a, b) => a.p.s - b.p.s || a.vi - b.vi || a.k - b.k);
  const lanes = new Map();
  for (const e of all){ if (!lanes.has(e.p.lane)) lanes.set(e.p.lane, []); lanes.get(e.p.lane).push(e); }
  const span = o.HOLD_MAX + o.FOLD_T;
  for (const e of all){
    const { V, p, k } = e;
    // the plates that can meet it: its own and the neighbouring lanes, out at the same time
    const near = [];
    for (const l of [p.lane - 1, p.lane, p.lane + 1]) for (const f of lanes.get(l) || []){
      if (f === e) continue;
      const dt = f.p.s - p.s;
      if (dt > -span - .2 && dt < span + o.PLATE_PRE + .2) near.push(f);
    }
    const clearAt = (c, hold) => {                           // plate e posed at c (with this hold) clear at s + c?
      const t = p.s + c, B = plateBox(V, p, c, o, hold), m = o.CLEAR;
      for (const W of L.voices) for (const b of voiceBallsAt(W, t)){
        if (W === V && b.seg && b.seg.a === k && c < .03) continue;          // its own ball, leaving it
        const R = W.r + m;
        if (Math.abs(b.x - B.x) < B.hx + R && plateGap(B, b.x, b.y, b.z, W.r) < m) return false;
        if (Math.abs(b.x - B.shoe.x) < Math.abs(B.hub.x - B.shoe.x) + R + A.R && pointSegDist(b, B.shoe, B.hub) < W.r + A.R + m) return false;
      }
      for (const f of near){
        const cf = beltPhase(t, f.p.s, P);
        if (Math.abs(DESCENT * cf) > f.V.cullD) continue;
        const F = plateBox(f.V, f.p, cf, o);
        if (Math.abs(F.y - B.y) > F.hx + B.hx + 1 && Math.abs(F.shoe.y - B.shoe.y) > 1.5) continue;
        if (boxGap(B, F) < m) return false;
        if (f.p.lane === p.lane && (segBoxDist(B.shoe, B.hub, F) < A.R + m || segBoxDist(F.shoe, F.hub, B) < A.R + m)) return false;
      }
      return true;
    };
    // how long could it stay out, never folding? then fit the fold in before that, and check the fold
    let cStar = span + HOLD_DT;
    for (let c = HOLD_DT; c <= span + 1e-9; c += HOLD_DT) if (!clearAt(c, Infinity)){ cStar = c; break; }
    let h = Math.floor(Math.min(o.HOLD_MAX, cStar - o.FOLD_T - HOLD_DT) * 100 / HOLD_STEP + 1e-9) * HOLD_STEP;
    for (; h > 0; h -= HOLD_STEP){
      let ok = true;
      for (let c = h / 100; c <= h / 100 + o.FOLD_T + 1e-9 && ok; c += HOLD_DT) ok = clearAt(c, h / 100);
      if (ok) break;
    }
    p.hold = Math.max(0, h) / 100;
  }
}
/* geometry for the hold: a point to a segment; a segment to a box (its distance along the
   segment is convex: a ternary search); two boxes (the separating-axis test — the best axis'
   gap, a lower bound on their distance; ≤ 0 when they may touch) */
function pointSegDist(q, a, b){
  const ab = v3(b.x - a.x, b.y - a.y, b.z - a.z), L2 = dot3(ab, ab);
  const t = L2 > 1e-12 ? Math.min(1, Math.max(0, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y + (q.z - a.z) * ab.z) / L2)) : 0;
  return Math.hypot(q.x - a.x - ab.x * t, q.y - a.y - ab.y * t, q.z - a.z - ab.z * t);
}
const boxAxes = B => [rotate(B.q, v3(1, 0, 0)), B.n, rotate(B.q, v3(0, 0, 1))];
function segBoxDist(a, b, B){
  const ax = boxAxes(B), loc = q => { const d = v3(q.x - B.x, q.y - B.y, q.z - B.z); return [dot3(d, ax[0]), dot3(d, ax[1]), dot3(d, ax[2])]; };
  const la = loc(a), lb = loc(b), h = [B.hx, B.hy, B.hz];
  const dist = t => { let s2 = 0; for (let i = 0; i < 3; i++){ const e = Math.max(0, Math.abs(la[i] + (lb[i] - la[i]) * t) - h[i]); s2 += e * e; } return Math.sqrt(s2); };
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++){ const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (dist(m1) <= dist(m2)) hi = m2; else lo = m1; }
  return Math.min(dist((lo + hi) / 2), dist(0), dist(1));
}
function boxGap(A, B){
  const a = boxAxes(A), b = boxAxes(B), ea = [A.hx, A.hy, A.hz], eb = [B.hx, B.hy, B.hz], d = v3(B.x - A.x, B.y - A.y, B.z - A.z);
  let best = -Infinity;
  const test = (x, y, z) => {
    const l = Math.hypot(x, y, z); if (l < 1e-6) return;
    const n = v3(x / l, y / l, z / l);
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++){ ra += ea[i] * Math.abs(dot3(a[i], n)); rb += eb[i] * Math.abs(dot3(b[i], n)); }
    best = Math.max(best, Math.abs(dot3(d, n)) - ra - rb);
  };
  for (const u of a) test(u.x, u.y, u.z);
  for (const u of b) test(u.x, u.y, u.z);
  for (const u of a) for (const w of b) test(u.y * w.z - u.z * w.y, u.z * w.x - u.x * w.z, u.x * w.y - u.y * w.x);
  return best;
}

/* What a plan depends on: the belt voices' notes and the tempo, and the solver itself
   (JUGGLE_VERSION — bump it whenever a change to this file can change a plan; the catalog
   test then sends you to re-bake). FNV-1a over the canonical JSON. */
export const JUGGLE_VERSION = 2;
export function jugglerKey(song){
  const json = JSON.stringify({ v: JUGGLE_VERSION, bpm: song.bpm,
    voices: beltVoices(song).map(v => [v.role, v.delay, v.deep, v.notes.map(e => [e[0], e[1], e[2] ?? null])]) });
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < json.length; i++){
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + json.length.toString(36);
}

/* ---- lanes ----------------------------------------------------------------------------- */
function assignLanes(V, front, o){
  const K = o.LANES, last = new Array(K).fill(-Infinity), lastLen = new Array(K).fill(0);
  let prevM = null;
  for (const q of V.notes){
    const home = V.kb.home(q.m), dir = prevM == null ? 0 : Math.sign(q.m - prevM), len = o.plate.L * q.scale;
    let best = -1, bestC = Infinity;
    for (let d = -o.NUDGE; d <= o.NUDGE; d++){
      const L = home + d;
      if (L < 0 || L >= K) continue;
      let c = Math.abs(d) + (d && Math.sign(d) !== dir ? .5 : 0);
      if (q.s - last[L] < o.T_SAME) c += 100;                // the lane's last plate hasn't folded away yet
      for (const n of [L - 1, L + 1]){                       // a big plate next door at nearly the same time
        if (n < 0 || n >= K) continue;
        if ((len + lastLen[n]) / 2 > o.LANE_D - .04 && q.s - last[n] < .2) c += 100;
      }
      if (front[L].some(s => Math.abs(s - q.s) < o.T_CROSS)) c += 100;   // a front plate's arm is in the way
      if (c < bestC){ bestC = c; best = L; }
    }
    if (bestC >= 100) V.warn.push(`${V.role}: note ${q.j} (${q.note}) has no clear lane`);
    q.lane = best; q.nudge = best - home; q.x = laneX(best, o);
    last[best] = q.s; lastLen[best] = len; prevM = q.m;
  }
}

/* ---- who strikes what, on which hand: the beam search -------------------------------------
   Notes in time order. A node's OPEN balls are in play: each has struck its last note and
   will strike exactly one later note (inside its flight window [F_HARD, F_FREE]). At note j
   the striker is an open ball (a free flight) or a ball released by a loaded carriage (a
   drop), and the plate rises on the front or the back hand; after the strike that ball
   either stays in play or rises to an empty carriage over that hand (a catch). Open balls
   must stay matchable to distinct later notes (Hall's condition, greedy by deadline) or
   the node is dead.
   Carriages on one rail keep their order across it: a carriage takes an event only between
   its neighbours (as they last stood) and only if it can get there in time from its own last
   event — POST dwell, winch up to the park height (above every free flight), across, down,
   PRE dwell; or, squeezed, one direct move. Every new segment — the ball's, and the carriage
   body (its ball, or its empty magnet) on the way to, at and away from each catch / release
   — is checked against everything already decided (a later decision checks back against
   this one, so each pair meets once). */
export const parkY = V => CRANE.H_FREE + 2 * V.r + .35;      // a held ball's centre when parked: over every free flight
export const railX = o => laneX(o.LANES - 1, o) + 2.5 * o.LANE_D;   // half the rail's length
/* Where each carriage of a rail waits across the breath: at the end it came in from, in rail
   order (the newest at the very end), SEP apart — so the whole rack resets without crossing. */
function breathSpots(carr, hand, sep, rail){
  const on = carr.filter(k => k.hand === hand), spot = new Map();
  const left = on.filter(k => k.home < 0), right = on.filter(k => k.home > 0);
  left.forEach((k, i) => spot.set(k.id, -rail + i * sep));
  right.forEach((k, i) => spot.set(k.id, rail - (right.length - 1 - i) * sep));
  return spot;
}

function solveVoice(V, o){
  const N = V.notes.length, S = V.notes.map(q => q.s), X = V.notes.map(q => q.x), sc = V.notes.map(q => q.scale);
  const r = V.r, C = o.C, HS = o.HS, FT = HS.map(fallT), Y = parkY(V), Z = V.hands;
  const MAGY = r + o.MAG_R, MAGR = o.MAG_R + .05, SEPX = 2 * Math.max(r, o.MAG_R) + o.SEP;
  const body = loaded => loaded ? [0, r] : [MAGY, MAGR];    // [centre above the ball's, radius]
  const plateRec = (k, z, ct) => ({ x: X[k], z, n: ct.n, q: quatFromUnit(UPV, ct.n), w: ct.w, amp: ct.amp, d: r + o.plate.T * sc[k] / 2, scale: sc[k], hold: 0 });

  const flightCost = (F, skip) => (F < o.F_TARGET ? C.short * ((o.F_TARGET - F) / o.F_TARGET) ** 2 : 0) + C.skip * skip * skip;
  const vhCost = vx => { const a = Math.abs(vx); return (a > o.VH_SOFT ? C.vh * (a - o.VH_SOFT) ** 2 : 0) + (a > o.VH_MAX ? C.hard : 0); };
  const plateCost = (vin, vout) => {
    const k = contact(vin, vout, o);
    let c = 0;
    if (k.tilt > o.TILT_SOFT) c += C.tilt * (k.tilt - o.TILT_SOFT) ** 2;
    if (k.tilt > o.TILT_MAX) c += C.hard;
    const aw = Math.abs(k.w);
    if (aw > o.W_SOFT) c += C.w * (aw - o.W_SOFT) ** 2;
    if (aw > o.W_MAX) c += C.hard;
    return c;
  };
  // plates in the way of a ball, posed EXACTLY: a plate's pose (tilt, stroke, drop-away) needs
  // both its ball's arrival and departure, so a plate joins the node's list of known plates when
  // its ball leaves it — and is then checked back against every ball segment already decided
  // near it. Every later segment checks against the known plates. Each (segment, plate) pair
  // meets once, posed as it will be built.
  // (the caches below key on INTERNED ids — a segment's key string → sk, a pose's → pk — nested
  //  Maps of small ints: the same entries the strings named, without building a string per check)
  const DTS = .005, hitCache = new Map(), segIds = new Map(), poseIds = new Map();
  const idOf = (ids, key) => { let i = ids.get(key); if (i === undefined){ i = ids.size; ids.set(key, i); } return i; };
  const sub = (m, k) => { let n = m.get(k); if (!n) m.set(k, n = new Map()); return n; };
  const poseOf = (k, hand, vin, vout) => {
    const ct = contact(vin, vout, o), f = v => v.x.toFixed(4) + ',' + v.y.toFixed(4) + ',' + v.z.toFixed(4);
    return { p: plateRec(k, Z[hand], ct), pk: idOf(poseIds, hand + '|' + f(vin) + '|' + f(vout)) };
  };
  const exactHit = (seg, k, p, pk) => {
    const own = k === seg.a;
    const a = Math.max(seg.t0, S[k] - o.PLATE_PRE) + (own ? .002 : 0), b = Math.min(seg.t1, S[k] + o.FOLD_T);
    if (b <= a) return 0;
    const pa = segPos(seg, a), pb = segPos(seg, b), hx = o.plate.L * sc[k] / 2 + r + .4;
    if (Math.min(pa.x, pb.x) > X[k] + hx || Math.max(pa.x, pb.x) < X[k] - hx) return 0;
    if (Math.min(pa.y, pb.y) - r > DESCENT * (b - S[k]) + .8) return 0;   // above anywhere it can reach
    const memo = sub(sub(hitCache, seg.sk), k);
    let h = memo.get(pk);
    if (h !== undefined) return h;
    h = 0;
    for (let t = a; t <= b + 1e-9; t += DTS){
      const B = plateBox(V, p, t - S[k], o), q = segPos(seg, t);
      if (plateGap(B, q.x, q.y, q.z, r) < -2e-3){ h = 1; break; }
      if (t > S[k] && B.extend < .4 && Math.abs(B.z - q.z) > B.hz + B.hy + r) break;   // snapped back off the row
    }
    memo.set(pk, h);
    return h;
  };
  const knownHits = (seg, pl) => {                           // a new ball segment vs the known plates
    let hits = 0;
    const lo = seg.t0 - o.FOLD_T, hi = seg.t1 + o.PLATE_PRE;
    for (let l = pl; l && l.stepS >= lo - .01; l = l.next){  // an entry is pushed no sooner than its strike
      const k = l.k;
      if (k === seg.a || k === seg.b || S[k] < lo || S[k] > hi) continue;
      hits += exactHit(seg, k, l.p, l.pk);
    }
    return hits;
  };
  const plateBack = (k, p, pk, list) => {                    // a newly known plate vs the ball segments decided before
    let hits = 0;
    const lo = S[k] - o.PLATE_PRE, hi = S[k] + o.FOLD_T;
    for (let l = list; l && l.stepS >= lo - 1.5; l = l.next){
      const sg = l.seg;
      if (!sg.kind || sg.b === k || sg.a === k || sg.t1 <= lo || sg.t0 >= hi) continue;
      hits += exactHit(sg, k, p, pk);
    }
    return hits;
  };
  const pushPlate = (pl, k, pose, stepS) => ({ k, p: pose.p, pk: pose.pk, stepS, next: pl });
  const pairCache = new Map();                               // two ball segments → too close?
  const ballHits = (seg, list) => {
    let hits = 0;
    for (let l = list; l && l.stepS >= seg.t0 - 2.5; l = l.next){
      const s = l.seg;
      if (s.t1 <= seg.t0 || s.t0 >= seg.t1) continue;
      if ((seg.ev != null && s.ev === seg.ev) || (seg.cid != null && s.cid === seg.cid)) continue;
      const need = seg.rad + s.rad + o.HIT_GAP;
      if (seg.key && s.key){                                 // (a pair is one entry, whichever comes first)
        const memo = sub(pairCache, seg.sk < s.sk ? seg.sk : s.sk), other = seg.sk < s.sk ? s.sk : seg.sk;
        let h = memo.get(other);
        if (h === undefined){ h = segMinDist(seg, s, need) < need ? 1 : 0; memo.set(other, h); }
        hits += h;
      } else if (segMinDist(seg, s, need) < need) hits++;
    }
    return hits;
  };
  const push = (list, segs, stepS) => { for (const seg of segs) list = { seg, stepS, next: list }; return list; };

  // a carriage's way to event e from its last one (k): up over the juggling, across and down
  // when it fits, else one direct move. Its body segments come along: the link, still before
  // (PRE), still after (POST), and the way back up (assumed — a later direct link only ever
  // replaces it with a lower, shorter path that is checked itself).
  const route = (k, e, cid, ev) => {
    const drop = e.kind === 'drop', t0 = e.t - PRE[e.kind], t1 = e.t + POST[e.kind], z = Z[e.hand];
    const [bo, br] = body(drop), [ao, ar] = body(!drop), mv = minMoveT(Y - e.y), dx = Math.abs(e.x - k.x);
    const segs = [], add = q => segs.push({ ...q, z0: z, cid, ev });
    let slack, tl, ta;                                        // [tl, ta]: its move across, x0 → e.x
    if (!k.kind){                                             // parked at a rail end since the breath
      slack = Infinity; ta = t0 - mv; tl = ta - minMoveT(dx);
      add({ t0: t0 - mv, t1: t0, x0: e.x, y0: Y + bo, y1: e.y + bo, lift: true, rad: br });
    } else {
      const free = k.t + POST[k.kind], avail = t0 - free;
      const viaPark = dx < 1e-6 && avail < minMoveT(Y - k.y) + mv + .2 ? Infinity : minMoveT(Y - k.y) + minMoveT(dx) + mv;
      const direct = minMoveT(Math.hypot(e.x - k.x, e.y - k.y));
      if (avail >= viaPark){
        slack = avail - viaPark; ta = t0 - mv; tl = ta - minMoveT(dx);
        add({ t0: t0 - mv, t1: t0, x0: e.x, y0: Y + bo, y1: e.y + bo, lift: true, rad: br });
      } else {                                                // squeezed: one direct move, at once
        slack = avail - direct; tl = free; ta = free + Math.max(direct, 1e-3);
        add({ t0: free, t1: ta, x0: k.x, y0: k.y + bo, x1: e.x, y1: e.y + bo, lift: true, rad: br });
        if (avail > direct) add({ t0: ta, t1: t0, x0: e.x, y0: e.y + bo, still: true, rad: br });
      }
    }
    add({ t0, t1: e.t, x0: e.x, y0: e.y + bo, still: true, rad: br });
    add({ t0: e.t, t1, x0: e.x, y0: e.y + ao, still: true, rad: ar });
    add({ t0: t1, t1: t1 + mv, x0: e.x, y0: e.y + ao, y1: Y + ao, lift: true, rad: ar });
    return { slack, segs, tl, ta };
  };
  // carriages: [{ id, hand, home, loaded, t, x, y, kind, x0, tl, ta }] — where it is now (x, since
  // ta), where it was (x0, until tl), its last event (t, kind). On each rail (hand) their order
  // never changes. A carriage in the way STEPS ASIDE along its rail (at park height, once its own
  // last event is done) — the rail runs past the keyboard so the end ones have somewhere to go.
  const RAIL = railX(o), PUSH = RAIL - o.M_MAX * SEPX;      // the rail's ends are the carriages' parking (the breath)
  const makeRoom = (carr, idx, from, e, tNeed) => {        // idx: this rail's carriages in order; e's carriage is at `from`
    const out = carr.slice(), shifts = [];                 // everyone in the way is clear by tNeed (it starts across)
    const step = (u, edge) => {
      const p = idx[u], k = out[p];
      if (Math.abs(edge) > PUSH) return false;
      const free = k.kind ? k.t + POST[k.kind] + minMoveT(Math.max(0, Y - k.y)) : -Infinity, across = minMoveT(Math.abs(edge - k.x));
      if (free + across > tNeed + 1e-9) return false;
      out[p] = { ...k, x0: k.x, tl: tNeed - across, ta: tNeed, x: edge, y: Y, t: tNeed, kind: 'shift' };
      shifts.push({ cid: k.id, t: tNeed, x: edge });
      return true;
    };
    for (let u = from + 1, edge = e.x + SEPX; u < idx.length; u++, edge += SEPX){
      if (out[idx[u]].x >= edge - 1e-9) break;
      if (!step(u, edge)) return null;
    }
    for (let u = from - 1, edge = e.x - SEPX; u >= 0; u--, edge -= SEPX){
      if (out[idx[u]].x <= edge + 1e-9) break;
      if (!step(u, edge)) return null;
    }
    return { out, shifts };
  };
  // neighbours on a rail stay SEPX apart through every move just made (each carriage's latest
  // move is known as x0 → x over [tl, ta]; while moving it may be anywhere in between)
  const span = (k, A, B, hi) => {
    const f = hi ? Math.max : Math.min;
    let v = hi ? -Infinity : Infinity;
    if (A < k.tl) v = f(v, k.x0);
    if (A <= k.ta && B >= k.tl) v = f(v, k.x0, k.x);
    if (B > k.ta) v = f(v, k.x);
    return v;
  };
  const orderOK = (out, idx, upd) => {
    for (let u = 0; u + 1 < idx.length; u++){
      const L = out[idx[u]], R = out[idx[u + 1]];
      if (!upd.has(L.id) && !upd.has(R.id)) continue;
      const T0 = Math.min(upd.has(L.id) ? L.tl : Infinity, upd.has(R.id) ? R.tl : Infinity);
      const bs = [L.tl, L.ta, R.tl, R.ta].filter(t => t > T0 && t < Infinity).sort((a, b) => a - b);
      let A = T0;
      for (const B of [...bs, Infinity]){
        if (span(L, A, B, true) + SEPX > span(R, A, B, false) + 1e-6) return false;
        A = B;
      }
    }
    return true;
  };
  const railOf = (carr, hand) => carr.map((k, p) => k.hand === hand ? p : -1).filter(p => p >= 0);
  const pickCarriage = (carr, nid, e, ev) => {
    const drop = e.kind === 'drop';
    const attempt = (base, idx, q, k) => {                   // carriage k (rail index q) takes event e
      const rt = route(k, e, k.id, ev), rm = makeRoom(base, idx, q, e, rt.tl);
      const out = rm ? rm.out : base.slice(), p = idx[q];
      out[p] = { ...out[p], x0: k.x, tl: rt.tl, ta: rt.ta, loaded: !drop, t: e.t, x: e.x, y: e.y, kind: e.kind };
      const ok = !!rm && orderOK(out, idx, new Set([k.id, ...rm.shifts.map(sh => sh.cid)]));
      return { out, rt, ok, shifts: rm ? rm.shifts : [], cid: k.id };
    };
    const result = (a, cost, nid2) => ({ carr: a.out, cost, cid: a.cid, nid: nid2, segs: a.rt.segs, shifts: a.shifts });
    const idx = railOf(carr, e.hand);
    let best = null, worst = null;
    idx.forEach((p, q) => {
      const k = carr[p];
      if (k.loaded !== drop) return;
      const a = attempt(carr, idx, q, k);
      if (a.rt.slack >= 0 && a.ok){
        const score = Math.abs(e.x - k.x) + a.shifts.length * .5;
        if (!best || score < best.score) best = { ...a, score };
      } else {
        const score = (a.ok ? 0 : 1e3) - Math.min(a.rt.slack, 0);
        if (!worst || score < worst.score) worst = { ...a, score };
      }
    });
    if (best) return result(best, 0, nid);
    if (drop && carr.length < o.M_MAX){                      // a new ball: a carriage parked at a rail end since the breath
      let fresh = null;
      for (const end of e.x > 0 ? [1, -1] : [-1, 1]){
        const at = end < 0 ? (idx.length ? idx[0] : carr.length) : carr.length;
        const k = { id: nid, hand: e.hand, home: end, loaded: true, t: -Infinity, x: end * RAIL, y: Y, kind: null, x0: end * RAIL, tl: -Infinity, ta: -Infinity };
        const withK = carr.slice(); withK.splice(at, 0, k);
        const idx2 = railOf(withK, e.hand), a = attempt(withK, idx2, end < 0 ? 0 : idx2.length - 1, k);
        if (a.ok){ fresh = result(a, C.ball, nid + 1); break; }
        if (!fresh) fresh = result(a, C.ball + C.order, nid + 1);
      }
      if (fresh.cost < C.order || !worst) return fresh;
    }
    if (!worst) return null;
    return result(worst, (worst.rt.slack < 0 ? C.late * (1 - worst.rt.slack) : 0) + (worst.ok ? 0 : C.order), nid);
  };
  // can every open ball still be given its own later note inside its flight window?
  const hallOK = (open, j) => {
    if (!open.length) return true;
    const w = open.map(b => [S[b.i] + o.F_HARD, S[b.i] + F_FREE]).sort((a, b) => a[1] - b[1]);
    const taken = [];
    for (const [lo, hi] of w){
      let k = Math.max(j + 1, lowerBound(S, lo - 1e-9));
      while (k < N && taken.includes(k)) k++;
      if (k >= N || S[k] > hi + 1e-9) return false;
      taken.push(k);
    }
    return true;
  };

  const root = { cost: 0, bad: 0, open: [], carr: [], segs: null, pl: null, parent: null, dec: null, nid: 0, nev: 0 };
  let beam = [root];
  for (let j = 0; j < N; j++){
    const kids = new Map();
    const add = (node, cost, st, dec) => {                   // st: { open, carr, segs, pl, nid, nev }
      const sig = st.open.map(b => b.i + ':' + b.hand).sort().join(',');
      const key = sig + '|' +
        st.carr.map(k => (k.loaded ? 'L' : 'E') + k.hand + Math.round(k.x / o.LANE_D) + '@' + (k.kind ? Math.round((k.t + POST[k.kind]) * 10) : '')).join(',');
      const had = kids.get(key);
      if (!had || had.cost > cost) kids.set(key, { ...st, sig, cost, bad: node.bad + (cost - node.cost >= C.hard ? 1 : 0), parent: node, dec });
    };
    for (const node of beam){
      const strikers = [];
      for (let hand = 0; hand < 2; hand++){
        const zj = Z[hand];
        // a) an open ball flies to j (crossing hands if it must) — and the plate it leaves is now known
        node.open.forEach((b, k) => {
          const F = S[j] - S[b.i];
          if (F < o.F_HARD - 1e-9 || F > F_FREE + 1e-9) return;
          const vx = (X[j] - X[b.i]) / F, vy = g * F / 2, vz = (zj - Z[b.hand]) / F, vout = v3(vx, vy, vz);
          const seg = { t0: S[b.i], t1: S[j], x0: X[b.i], y0: 0, z0: Z[b.hand], vx, vy, vz, kind: 'flight', a: b.i, b: j, rad: r, key: `f${b.i},${j},${b.hand}${hand}` };
          seg.sk = idOf(segIds, seg.key);
          const pose = poseOf(b.i, b.hand, b.vin, vout);
          const hits = ballHits(seg, node.segs) + exactHit(seg, b.i, pose.p, pose.pk) + knownHits(seg, node.pl) + plateBack(b.i, pose.p, pose.pk, node.segs);
          const c = flightCost(F, j - b.i - 1) + vhCost(vx) + plateCost(b.vin, vout) + (b.hand !== hand ? C.swap : 0) + C.hit * hits;
          strikers.push({ c, hand, open: node.open.filter((_, q) => q !== k), carr: node.carr, segs: push(node.segs, [seg], S[j]),
                          pl: pushPlate(node.pl, b.i, pose, S[j]), vin: v3(vx, -vy, vz), src: b.i, drop: null, nid: node.nid, nev: node.nev });
        });
        // b) a carriage over this hand releases a ball onto j (highest clean height wins)
        let best = null;
        for (let h = 0; h < HS.length; h++){
          const e = { t: S[j] - FT[h], x: X[j], y: HS[h], kind: 'drop', hand }, ev = node.nev;
          const pick = pickCarriage(node.carr, node.nid, e, ev);
          if (!pick) continue;
          const seg = { t0: e.t, t1: S[j], x0: X[j], y0: HS[h], z0: zj, vx: 0, vy: 0, vz: 0, kind: 'drop', b: j, rad: r, ev, key: `d${j},${h},${hand}` };
          seg.sk = idOf(segIds, seg.key);
          const hits = ballHits(seg, node.segs) + knownHits(seg, node.pl) + pick.segs.reduce((n, q) => n + ballHits(q, node.segs), 0);
          const c = C.entry + pick.cost + C.low * (HS[0] - HS[h]) + C.hit * hits;
          if (!best || c < best.c) best = { c, hand, open: node.open, carr: pick.carr, segs: push(node.segs, [...pick.segs, seg], S[j]), pl: node.pl,
                                            vin: v3(0, -g * FT[h], 0), src: -1, drop: { h, cid: pick.cid, shifts: pick.shifts }, nid: pick.nid, nev: ev + 1 };
          if (!hits && pick.cost < C.late) break;
        }
        if (best) strikers.push(best);
      }
      // after the strike: stay in play, or rise to a carriage over its hand (each clean height
      // is its own branch — a low catch is what lets one carriage turn a long note round in time)
      for (const st of strikers){
        const open = [...st.open, { i: j, vin: st.vin, src: st.src, hand: st.hand }];
        const dec = exit => ({ j, src: st.src, hand: st.hand, drop: st.drop, exit });
        if (hallOK(open, j)) add(node, node.cost + st.c, { ...st, open }, dec(null));
        if (!hallOK(st.open, j)) continue;
        let fallback = null, clean = 0;
        for (let h = 0; h < HS.length; h++){
          const e = { t: S[j] + FT[h], x: X[j], y: HS[h], kind: 'catch', hand: st.hand }, ev = st.nev;
          const pick = pickCarriage(st.carr, st.nid, e, ev);
          if (!pick) continue;
          const vout = v3(0, g * FT[h], 0), pose = poseOf(j, st.hand, st.vin, vout);
          const seg = { t0: S[j], t1: e.t, x0: X[j], y0: 0, z0: Z[st.hand], vx: 0, vy: g * FT[h], vz: 0, kind: 'rise', a: j, b: -1, rad: r, ev, key: `r${j},${h},${st.hand}` };
          seg.sk = idOf(segIds, seg.key);
          const hits = ballHits(seg, st.segs) + exactHit(seg, j, pose.p, pose.pk) + knownHits(seg, st.pl) + plateBack(j, pose.p, pose.pk, st.segs) +
            pick.segs.reduce((n, q) => n + ballHits(q, st.segs), 0);
          const c = C.exit + pick.cost + plateCost(st.vin, vout) + C.low * (HS[0] - HS[h]) + C.hit * hits;
          const kid = [node, node.cost + st.c + c, { open: st.open, carr: pick.carr, segs: push(st.segs, [seg, ...pick.segs], S[j]),
                       pl: pushPlate(st.pl, j, pose, S[j]), nid: pick.nid, nev: ev + 1 }, dec({ h, cid: pick.cid, shifts: pick.shifts })];
          if (!hits && pick.cost < C.late){ add(...kid); clean++; }
          else if (!fallback || kid[1] < fallback[1]) fallback = kid;
        }
        if (!clean && fallback) add(...fallback);
      }
    }
    const ranked = [...kids.values()].sort((a, b) => a.cost - b.cost);
    if (o.DIV){                                              // at most DIV nodes per set of balls in the air
      const per = new Map(), keep = [], rest = [];
      for (const nd of ranked){ const n = per.get(nd.sig) || 0; if (n < o.DIV){ per.set(nd.sig, n + 1); keep.push(nd); } else rest.push(nd); }
      beam = keep.slice(0, o.BEAM);
      if (beam.length < o.BEAM) beam.push(...rest.slice(0, o.BEAM - beam.length));
    } else beam = ranked.slice(0, o.BEAM);
    if (!beam.length) throw new Error(`juggler: ${V.role} has no plan at note ${j}`);
  }
  // across the breath every carriage goes up, crosses with its rail to its parking spot, and
  // comes back out to its first event — all of that has to fit the breath
  let win = null, winCost = Infinity;
  for (const node of beam){
    if (node.open.length) continue;
    const first = new Map();
    for (let nd = node; nd && nd.dec; nd = nd.parent){
      const d = nd.dec;
      if (d.exit) first.set(d.exit.cid, { t: S[d.j] + FT[d.exit.h], x: X[d.j], y: HS[d.exit.h], kind: 'catch' });
      if (d.drop) first.set(d.drop.cid, { t: S[d.j] - FT[d.drop.h], x: X[d.j], y: HS[d.drop.h], kind: 'drop' });
    }
    let c = node.cost, bad = node.bad;
    for (const hand of [0, 1]){
      const spot = breathSpots(node.carr, hand, SEPX, RAIL), on = node.carr.filter(k => k.hand === hand);
      if (!on.length) continue;
      let ws = -Infinity, we = Infinity, need = 0;
      for (const k of on){
        const f = first.get(k.id), sx = spot.get(k.id);
        ws = Math.max(ws, k.t - V.P + POST[k.kind] + minMoveT(Math.max(0, Y - k.y)));
        we = Math.min(we, f.t - PRE[f.kind] - minMoveT(Y - f.y) - minMoveT(Math.abs(f.x - sx)));
        need = Math.max(need, minMoveT(Math.abs(sx - k.x)));
      }
      if (we - ws < need){ c += C.late * (1 + need - (we - ws)); bad++; }
    }
    if (!win || bad < win.bad2 || (bad === win.bad2 && c < winCost)){ winCost = c; win = node; win.bad2 = bad; }
  }
  if (!win) throw new Error(`juggler: ${V.role} can't bring every ball home`);
  const decs = [];
  for (let nd = win; nd && nd.dec; nd = nd.parent) decs.push(nd.dec);
  decs.reverse();
  return { decs, carr: win.carr, cost: winCost, bad: win.bad2, beam: o.BEAM };
}

/* ---- the voice's plan from the winning decisions: segments, plates, carriage timelines ---- */
function assemble(V, decs, carr, cost, o){
  const N = V.notes.length, S = V.notes.map(q => q.s), X = V.notes.map(q => q.x), HS = o.HS, FT = HS.map(fallT), Z = V.hands;
  const segs = [], vin = new Array(N), vout = new Array(N), src = new Array(N).fill(-1), exit = new Array(N).fill(false);
  const hand = decs.map(d => d.hand);
  const cOf = new Map(carr.map((k, c) => [k.id, c]));
  const evs = carr.map(() => []);
  for (const d of decs){
    const j = d.j, zj = Z[d.hand];
    src[j] = d.src;
    if (d.src >= 0){
      const i = d.src, F = S[j] - S[i], vx = (X[j] - X[i]) / F, vz = (zj - Z[hand[i]]) / F;
      segs.push({ t0: S[i], t1: S[j], x0: X[i], y0: 0, z0: Z[hand[i]], vx, vy: g * F / 2, vz, kind: 'flight', a: i, b: j });
      vout[i] = v3(vx, g * F / 2, vz); vin[j] = v3(vx, -g * F / 2, vz);
    } else {
      const h = HS[d.drop.h], ft = FT[d.drop.h], c = cOf.get(d.drop.cid);
      segs.push({ t0: S[j] - ft, t1: S[j], x0: X[j], y0: h, z0: zj, vx: 0, vy: 0, vz: 0, kind: 'drop', a: -1, b: j, c });
      vin[j] = v3(0, -g * ft, 0);
      evs[c].push({ t: S[j] - ft, x: X[j], y: h, kind: 'drop', note: j });
      for (const sh of d.drop.shifts) evs[cOf.get(sh.cid)].push({ t: sh.t, x: sh.x, y: parkY(V), kind: 'shift' });
    }
    if (d.exit){
      const h = HS[d.exit.h], ft = FT[d.exit.h], c = cOf.get(d.exit.cid);
      exit[j] = true;
      segs.push({ t0: S[j], t1: S[j] + ft, x0: X[j], y0: 0, z0: zj, vx: 0, vy: g * ft, vz: 0, kind: 'rise', a: j, b: -1, c });
      vout[j] = v3(0, g * ft, 0);
      evs[c].push({ t: S[j] + ft, x: X[j], y: h, kind: 'catch', note: j });
      for (const sh of d.exit.shifts) evs[cOf.get(sh.cid)].push({ t: sh.t, x: sh.x, y: parkY(V), kind: 'shift' });
    }
  }
  segs.sort((a, b) => a.t0 - b.t0);
  V.segs = segs;
  V.segT0 = segs.map(s => s.t0);
  V.maxSeg = Math.max(0, ...segs.map(s => s.t1 - s.t0));
  V.cost = cost;
  V.plates = V.notes.map((q, k) => {
    const ct = contact(vin[k], vout[k], o);
    return { s: q.s, x: q.x, z: Z[hand[k]], hand: hand[k], lane: q.lane, nudge: q.nudge, note: q.note, vel: q.vel, scale: q.scale,
             n: ct.n, q: quatFromUnit(UPV, ct.n), tilt: ct.tilt, w: ct.w, amp: ct.amp, hold: 0, vin: vin[k], vout: vout[k],
             d: V.r + o.plate.T * q.scale / 2, src: src[k], exit: exit[k] };
  });
  V.park = parkY(V);
  evs.forEach(ev => ev.sort((a, b) => a.t - b.t));
  V.carriages = carriagePlans(V, evs, carr, o);
  V.balls = carr.length;
}

/* The voice's carriages over one loop: still at each event (PRE before, POST after);
   between, up to the PARK height (above every free flight), across, down — or one direct
   move when that doesn't fit (or straight up/down over the same plate). Across the breath
   each rail's carriages cross together, on one shared smootherstep, so their order holds.
   Keys repeat every P; a carriage holds its ball across the breath and `loaded` flips at
   each event. */
function carriagePlans(V, evs, carr, o){
  const P = V.P, Y = V.park, at = (e, z) => v3(e.x, e.y, z), hands = carr.map(k => k.hand);
  const SEPX = 2 * Math.max(V.r, o.MAG_R) + o.SEP, RAIL = railX(o);
  // from a (free from ta) to b (in place by tb) — the same moves the search priced (solveVoice route)
  const link = (keys, a, ta, b, tb) => {
    const up = minMoveT(Y - a.y), across = minMoveT(Math.abs(b.x - a.x)), down = minMoveT(Y - b.y);
    const same = Math.abs(b.x - a.x) < 1e-6;
    if (Y - Math.min(a.y, b.y) <= .05){                      // along the park line (a step aside): across, just in time
      if (!same && tb - ta > across) keys.push([tb - across, a]);
    } else if (tb - ta >= up + across + down + (same ? .2 : 0)){   // up over the juggling, across, down
      keys.push([ta + up, v3(a.x, Y, a.z)]);
      if (!same) keys.push([tb - down - across, v3(a.x, Y, a.z)], [tb - down, v3(b.x, Y, a.z)]);
      else keys.push([tb - down, v3(b.x, Y, a.z)]);
    } else {                                                 // squeezed: one direct move, at once — then wait
      const mv = minMoveT(Math.hypot(b.x - a.x, b.y - a.y));
      if (tb - ta > mv) keys.push([ta + mv, b]);
    }
    keys.push([tb, b]);
  };
  // the breath: everyone up after their last event, then ONE shared move per rail to the parking
  // spots at the rail ends (order kept), then each back out to its first event in time
  const spots = [0, 1].map(hd => breathSpots(carr, hd, SEPX, RAIL));
  const windows = [0, 1].map(hd => {
    const used = evs.map((ev, c) => hands[c] === hd ? c : -1).filter(c => c >= 0);
    if (!used.length) return null;
    const L = c => evs[c][evs[c].length - 1], F = c => evs[c][0], sx = c => spots[hd].get(carr[c].id);
    const ws = Math.max(...used.map(c => L(c).t - P + POST[L(c).kind] + minMoveT(Math.max(0, Y - L(c).y))));
    const we = Math.min(...used.map(c => F(c).t - PRE[F(c).kind] - minMoveT(Y - F(c).y) - minMoveT(Math.abs(F(c).x - sx(c)))));
    return we - ws >= Math.max(...used.map(c => minMoveT(Math.abs(sx(c) - L(c).x)))) ? [ws, we] : null;
  });
  return evs.map((ev, c) => {
    const hd = hands[c], z = V.hands[hd], keys = [], win = windows[hd], sx = spots[hd].get(carr[c].id);
    const first = ev[0], last = ev[ev.length - 1];
    const t0 = last.t - P + POST[last.kind], breath = [[t0, at(last, z)]];
    if (win){
      const arrive = first.t - PRE[first.kind] - minMoveT(Y - first.y);
      breath.push([t0 + minMoveT(Math.max(0, Y - last.y)), v3(last.x, Y, z)], [win[0], v3(last.x, Y, z)], [win[1], v3(sx, Y, z)],
                  [arrive - minMoveT(Math.abs(first.x - sx)), v3(sx, Y, z)], [arrive, v3(first.x, Y, z)], [first.t - PRE[first.kind], at(first, z)]);
    } else link(breath, at(last, z), t0, at(first, z), first.t - PRE[first.kind]);
    keys.push(...breath);
    ev.forEach((e, k) => {
      if (k) keys.push([e.t, at(e, z)]);
      keys.push([e.t + POST[e.kind], at(e, z)]);
      const nx = ev[k + 1];
      if (nx) link(keys, at(e, z), e.t + POST[e.kind], at(nx, z), nx.t - PRE[nx.kind]);
    });
    keys.push(...breath.slice(1).map(([t, p]) => [t + P, p]));   // the same breath, at this loop's end
    for (let k = 1; k < keys.length; k++) if (keys[k][0] < keys[k - 1][0]) keys[k][0] = keys[k - 1][0];   // a squeezed link
    const loadEv = ev.filter(e => e.kind !== 'shift');
    return { hand: hd, z, home: carr[c].home, ev, evT: ev.map(e => e.t), loadEv, loadT: loadEv.map(e => e.t), keys, keyT: keys.map(k => k[0]) };
  });
}

/* ---- ball identity -----------------------------------------------------------------------
   The plan knows flights and carriages, not balls. A render needs balls: one marble each,
   followed through a loop. At the loop's start every ball hangs on a carriage, so ball b is
   the one carriage b holds then. Its chain: carriage b's first release → its flights → the
   rise into some carriage c → c's next release → … → the last rise of the loop (it hangs there
   across the breath; next loop that carriage's index names it). Every segment and every hold
   belongs to exactly one ball; V.pieces[b] tiles [0, P) for ball b. Also: which ball strikes
   each plate (plate.ball), how long its way in took (plate.F — the anticipation glow), and the
   docks (each rise's arrival: the clack). */
function ballChains(V){
  const P = V.P, M = V.carriages.length, outOf = new Map(), drops = V.carriages.map(() => []);
  for (const s of V.segs){
    if (s.a >= 0) outOf.set(s.a, s);
    if (s.kind === 'drop') drops[s.c].push(s);
  }
  drops.forEach(l => l.sort((a, b) => a.t0 - b.t0));
  V.pieces = Array.from({ length: M }, () => []);
  V.docks = [];
  for (let b = 0; b < M; b++){
    const pc = V.pieces[b];
    let c = b, t = 0;
    for (let guard = 0; guard <= V.segs.length; guard++){
      const d = drops[c].find(q => q.t0 >= t - 1e-9);         // the carriage's next release: this ball's
      if (!d){ pc.push({ t0: t, t1: P, c }); break; }
      if (d.t0 > t) pc.push({ t0: t, t1: d.t0, c });
      let q = d;
      for (;;){
        q.ball = b; pc.push({ t0: q.t0, t1: q.t1, seg: q });
        if (q.kind === 'rise') break;
        q = outOf.get(q.b);
        if (!q) throw new Error(`juggler: ${V.role} ball ${b} loses its way`);
      }
      V.docks.push({ t: q.t1, c: q.c, ball: b, k: q.a });
      c = q.c; t = q.t1;
    }
  }
  V.pieceT0 = V.pieces.map(pc => pc.map(q => q.t0));
  V.docks.sort((a, b) => a.t - b.t);
  V.dockT = V.docks.map(d => d.t);
  for (const s of V.segs) if (s.b >= 0){ const p = V.plates[s.b]; p.ball = s.ball; p.F = s.t1 - s.t0; }
  V.strikeT = V.plates.map(p => p.s);
}

/* ---- evaluation (pure fns of songTime) -------------------------------------------------- */
const wrap = (t, P) => ((t % P) + P) % P;
function floorIdx(arr, v){
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (arr[m] <= v){ ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

/* Carriage c of voice V at songTime t: where its ball's centre is / would be (the magnet
   face is r above), its velocity, and whether it holds a ball. */
export function carriageAt(V, c, t){
  const C = V.carriages[c], P = V.P, K = C.keys, KT = C.keyT;
  let u = wrap(t, P);
  if (u < KT[0]) u += P;
  if (u > KT[KT.length - 1]) u -= P;
  const i = Math.min(Math.max(0, floorIdx(KT, u)), K.length - 2);
  const p = segEval(K[i], K[i + 1], u);
  const k = floorIdx(C.loadT, wrap(t, P));
  return { x: p.x, y: p.y, z: C.z, vx: p.vx, vy: p.vy, loaded: k < 0 || C.loadEv[k].kind === 'catch' };
}

/* Every ball of a voice at songTime t: the ones in free flight (their segment) and the ones
   hanging on a carriage. { x, y, z, vx, vy, vz, mode: 'flight'|'drop'|'rise'|'held', seg?, c? } */
export function voiceBallsAt(V, t){
  const u = wrap(t, V.P), out = [];
  for (const uu of [u, u + V.P]){                           // + a flight that began before the wrap
    for (let k = floorIdx(V.segT0, uu); k >= 0 && V.segs[k].t0 >= uu - V.maxSeg - 1e-9; k--){
      const s = V.segs[k];
      if (uu >= s.t0 && uu < s.t1){ const p = segPos(s, uu); out.push({ ...p, mode: s.kind, seg: s }); }
    }
  }
  V.carriages.forEach((_, c) => {
    const k = carriageAt(V, c, t);
    if (k.loaded) out.push({ x: k.x, y: k.y, z: k.z, vx: k.vx, vy: k.vy, vz: 0, mode: 'held', c });
  });
  return out;
}

/* Ball b of voice V at songTime t (b: ballChains' identity). Same answer as voiceBallsAt,
   one ball at a time: { x, y, z, vx, vy, vz, mode, seg?, c? }. */
export function ballAt(V, b, t){
  const u = wrap(t, V.P), i = Math.max(0, floorIdx(V.pieceT0[b], u)), p = V.pieces[b][i];
  if (p.seg){ const q = segPos(p.seg, u); return { x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz, mode: p.seg.kind, seg: p.seg }; }
  const k = carriageAt(V, p.c, t);
  return { x: k.x, y: k.y, z: k.z, vx: k.vx, vy: k.vy, vz: 0, mode: 'held', c: p.c };
}

/* Events in the loop-local window (a, b] (b < a: across the wrap) from a sorted time list. */
export function eventsIn(T, a, b, P){
  const out = [];
  if (b >= a){ for (let i = upperBound(T, a); i < T.length && T[i] <= b; i++) out.push(i); }
  else { for (let i = upperBound(T, a); i < T.length; i++) out.push(i); for (let i = 0; i < T.length && T[i] <= b; i++) out.push(i); }
  return out;
}

/* ---- the honesty audit (tests + the catalog report) --------------------------------------
   Everything the search only priced, measured on the finished plan: flight bounds, plate
   tilt / flipper stroke / sideways speed limits, ball–ball contacts (free flights exact),
   ball–plate contacts against the true posed plates, carriage bodies (a held ball or an
   empty magnet) against the balls, carriages of one rail touching, and carriage moves that
   break the crane's limits — all sampled every `dt`. Each list holds the offenders. */
export function auditJuggler(J, { dt = .004 } = {}){
  const out = [];
  for (const V of J.voices){
    const o = V.o, r = V.r, S = V.plates.map(p => p.s), MAGY = r + o.MAG_R;
    const A = { role: V.role, struck: [], flights: [], limits: [], ballBall: [], crane: [], ballPlate: [], ballArm: [], carriages: [], late: [] };
    const hit = new Array(V.plates.length).fill(0);
    V.segs.forEach(s => { if (s.b >= 0) hit[s.b]++; });
    hit.forEach((n, k) => { if (n !== 1) A.struck.push({ k, n }); });
    for (const s of V.segs){
      if (s.kind !== 'flight') continue;
      const F = s.t1 - s.t0;
      if (F < o.F_HARD - 1e-9 || F > F_FREE + 1e-9) A.flights.push({ a: s.a, b: s.b, F });
      if (Math.abs(s.vx) > o.VH_MAX + 1e-9) A.limits.push({ k: s.a, what: 'vh', v: Math.abs(s.vx) });
    }
    V.plates.forEach((p, k) => {
      if (p.tilt > o.TILT_MAX + 1e-9) A.limits.push({ k, what: 'tilt', v: p.tilt / DEG });
      if (Math.abs(p.w) > o.W_MAX + 1e-9) A.limits.push({ k, what: 'w', v: Math.abs(p.w) });
    });
    const fs = V.segs;
    for (let i = 0; i < fs.length; i++) for (let k = i + 1; k < fs.length && fs[k].t0 < fs[i].t1; k++){
      const d = segMinDist(fs[i], fs[k], 2 * r);
      if (d < 2 * r - 1e-6) A.ballBall.push({ t: Math.max(fs[i].t0, fs[k].t0), a: fs[i], b: fs[k], d });
    }
    const nC = V.carriages.length;
    for (let t = 0; t < V.P; t += dt){
      const all = voiceBallsAt(V, t), balls = all.filter(b => b.mode !== 'held');
      const cs = V.carriages.map((_, c) => carriageAt(V, c, t));
      cs.forEach((k, c) => {
        const by = k.loaded ? k.y : k.y + MAGY, br = k.loaded ? r : o.MAG_R;
        for (const b of balls){
          if (b.seg.c === c && (b.mode === 'rise' ? t > b.seg.t1 - .02 : t < b.seg.t0 + .02)) continue;   // its own ball at the clack
          const d = Math.hypot(b.x - k.x, b.y - by, b.z - k.z);
          if (d < r + br - 1e-3) A.crane.push({ t, c, mode: b.mode, d });
        }
      });
      for (let a = 0; a < nC; a++) for (let c = a + 1; c < nC; c++)
        if (Math.abs(cs[a].z - cs[c].z) < 2 * Math.max(r, o.MAG_R) && Math.abs(cs[a].x - cs[c].x) < 2 * Math.max(r, o.MAG_R) + .02 &&
            Math.abs(cs[a].y - cs[c].y) < o.MAG_H + 2 * r) A.carriages.push({ t, a, c });
      // the plates out now (wound up, struck, held, folding) and their arms against every ball
      // near them — this voice's (held ones too), and after a strike every other voice's: a plate
      // holds out over the rows behind it and folds back through them
      const kLo = lowerBound(S, t - (o.HOLD_MAX + o.FOLD_T + .02)), kHi = upperBound(S, t + o.PLATE_PRE);
      for (let k = kLo; k < kHi; k++){
        if (Math.abs(t - S[k]) < 1e-4) continue;
        const B = plateAt(V, k, t);
        if (!B) continue;
        for (const W of J.voices){
          if (W !== V && t < S[k]) continue;
          for (const b of (W === V ? all : voiceBallsAt(W, t))){
            const gp = plateGap(B, b.x, b.y, b.z, W.r), ga = pointSegDist(b, B.shoe, B.hub) - W.r - o.ARM.R;
            if (gp < -2e-3) A.ballPlate.push({ t, k, gap: gp, mode: b.mode, c: t - S[k], ...(W !== V ? { voice: W.role } : {}) });
            if (ga < -2e-3) A.ballArm.push({ t, k, gap: ga, mode: b.mode, c: t - S[k], ...(W !== V ? { voice: W.role } : {}) });
          }
        }
      }
    }
    V.carriages.forEach((C, c) => {
      for (let k = 0; k + 1 < C.keys.length; k++){
        const [t0, p0] = C.keys[k], [t1, p1] = C.keys[k + 1], D = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        if (D > 1e-6 && t1 - t0 < minMoveT(D) - 1e-6) A.late.push({ c, t: t0, need: minMoveT(D), got: t1 - t0 });
      }
    });
    const dedupe = (list, id) => list.filter((e, i) => !i || e.t - list[i - 1].t > .05 || id(e) !== id(list[i - 1]));
    A.crane = dedupe(A.crane, e => e.c); A.ballPlate = dedupe(A.ballPlate, e => e.k); A.ballArm = dedupe(A.ballArm, e => e.k);
    A.carriages = dedupe(A.carriages, e => e.a * 9 + e.c);
    out.push(A);
  }
  return out;
}
