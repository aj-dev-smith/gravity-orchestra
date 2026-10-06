/* ============================================================
   STRING BASS — the pure math. No THREE scene, no DOM, no audio.

   THE MACHINE (one LANE per pitch; lanes never interact):
     · a thick horizontal string under tension between two anchor
       blocks — its length ∝ 1/f, a pure function of the note;
     · ONE heavy chrome ball that only ever touches THAT string;
     · an electromagnet on a winch carriage above the string's centre.

   One cycle, strike i → strike j (= i+1, cyclic):
     1. CONTACT  [0, Tc]       the ball meets the string AT REST and sinks
                               into it (a stiff spring: quarter-sine in at ω1,
                               quarter-sine out at ω2 = e·ω1 — velocity is
                               continuous, the string is LOSSY: it throws the
                               ball back with only e of its speed).
     2. RISE     [Tc, catch]   free flight up to the rebound apex hr = e²·h.
                               Meanwhile the carriage has been winched DOWN
                               (it starts at the strike) to arrive at that apex
                               with zero velocity — ball and magnet meet at rest.
     3. WINCH    [catch, +W]   the coil grabs; the winch hauls the ball back up
                               (or lowers it) to the next drop height h_j. THIS
                               is the visible energy supply for the lossy bounce.
     4. HOLD                   parked on the magnet, waiting.
     5. FALL     [Δ−tf_j, Δ]   the coil cuts; honest free fall under G from h_j:
                               tf = √(2h/g) — it lands EXACTLY on the beat.

   Every lane is solved up front: each strike's impact speed v_i (and so its
   drop height h_i = v²/2g) is the largest that fits its neighbouring gaps
   (Tc + rise + winch + fall ≤ gap). Long gaps → the full drop; a fast repeat
   → the magnet waits lower. Time is the only state: poseAt() is a pure fn.
   ============================================================ */
import { G, noteHz } from '../../engine.js';
import { laneClock, wrapP } from '../clock.js';

export const g      = -G.y;          // |gravity| = 14.5
export const E      = .6;            // string restitution: rebound keeps e of the speed
export const H_MAX  = 3.2;           // tallest drop (ball underside above the string)
export const V_MAX  = Math.sqrt(2 * g * H_MAX);
export const V_MIN  = .5;            // the gentlest tap a dense run can fall back to
export const OMEGA1 = 26;            // contact stiffness (rad/s): compression quarter-sine
export const TC     = Math.PI / (2 * OMEGA1) * (1 + 1 / E);   // full contact time (~.16 s)
export const A_W    = 26;            // winch: peak-ish acceleration (u/s²) → move time
export const BALL_R = .38;           // the heavyweight: big chrome ball
export const VIS_F  = 6;             // the string's VISIBLE ring (Hz) — slow enough to read (the blur hull
                                     // in index.js draws the fast vibration's envelope)
export const OMEGA  = 2 * Math.PI * VIS_F;
export const RING_K = 1.7;           // visible ring decay (1/s)

const hOf = v => v * v / (2 * g);
/** Winch move time for a height change dh: a cosine-eased move with accel ≈ A_W. */
export const winchT = dh => { const a = Math.abs(dh); return a < 1e-9 ? 0 : Math.PI * Math.sqrt(a / (2 * A_W)); };

/* String length ∝ 1/f — a PURE function of the note (never of layout). E1 → 8.6 u. */
export const L_REF = 8.6, F_REF = 41.2034;
export function stringLength(note){
  return Math.max(1.6, Math.min(10.4, L_REF * F_REF / noteHz(note)));
}
/* Thickness: wound low strings are fat (still a pure fn of the note). Thick enough to
   read from across the room (the station is ~30 u from the stage camera). */
export function stringRadius(note){
  return Math.max(.05, Math.min(.11, .11 * Math.sqrt(F_REF / noteHz(note))));
}

/* ---- solve a lane ----------------------------------------------------------
   times: loop-local strike times (s); P: loop period; opt.u0 = where along the
   string the ball lands (0..1 — off-centre like a real pluck point, so mode 2 is
   honestly excited), opt.Ls = string length (for the ring-clearance check).
   Returns the lane struct poseAt() reads: per strike i — v (impact speed), h (drop
   height), Tc/w1 (contact), vOut, hr (rebound apex), catchT, W (winch), A1/A2
   (visible ring mode amplitudes, VERIFIED never to catch the departing ball). */
export function solveLane(times, P, { u0 = .5, Ls = 4 } = {}){
  const L = laneClock(times, P);
  const n = L.s.length, gaps = L.gaps;
  const Tc = gaps.map(d => Math.min(TC, .4 * d));            // a very dense gap squeezes the contact
  const need = (i, vi, vj) => Tc[i] + E * vi / g + winchT(hOf(vj) - hOf(E * vi)) + vj / g;
  const ok = (i, vi, vj) => need(i, vi, vj) <= gaps[i] + 1e-12;
  const v = new Array(n).fill(V_MAX);
  // bisection for the largest x in [lo, hi] with pred(x) true (pred(lo) assumed true)
  const maxOk = (lo, hi, pred) => {
    if (pred(hi)) return hi;
    for (let k = 0; k < 60; k++){ const m = (lo + hi) / 2; if (pred(m)) lo = m; else hi = m; }
    return lo;
  };
  for (let pass = 0; pass < 200; pass++){
    let changed = false;
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n;
      if (ok(i, v[i], v[j])) continue;
      changed = true;
      if (i === j){ v[i] = maxOk(V_MIN, v[i], x => ok(i, x, x)); continue; }
      // shrink BOTH ends of the gap together (scale λ): a fast pair shares the cut, so the
      // second note isn't starved to a tap while the first keeps its full drop
      const vi = v[i], vj = v[j], at = l => [Math.max(V_MIN, l * vi), Math.max(V_MIN, l * vj)];
      const lam = maxOk(0, 1, l => ok(i, ...at(l)));
      [v[i], v[j]] = at(lam);
    }
    if (!changed) break;
  }
  const S = { L, n, s: L.s, gaps, P, v, Tc, u0, Ls };
  S.h = v.map(hOf);
  S.tf = v.map(x => x / g);
  S.w1 = Tc.map(t => Math.PI * (1 + 1 / E) / (2 * t));
  S.vOut = v.map(x => E * x);
  S.hr = S.vOut.map(hOf);
  S.catchT = v.map((x, i) => Tc[i] + S.vOut[i] / g);
  S.W = v.map((x, i) => winchT(S.h[(i + 1) % n] - S.hr[i]));
  // the visible ring: a strike at u0 excites mode k ∝ sin(kπu0)/k² (a struck/plucked
  // string's spectrum). Start from a generous amplitude ∝ impact speed, then VERIFY
  // against the departing ball's whole footprint (sampled) and shrink until the string
  // never touches the ball after it leaves — honest contact, by construction.
  const k1 = Math.abs(Math.sin(Math.PI * u0)), k2 = Math.sin(2 * Math.PI * u0) / 4;
  S.A1 = v.map(x => .05 * x * k1);
  S.A2 = v.map(x => .05 * x * k2);
  for (let i = 0; i < n; i++){
    if (clear(S, i)) continue;
    const a1 = S.A1[i], a2 = S.A2[i], at = l => { S.A1[i] = l * a1; S.A2[i] = l * a2; };
    let lo = 0, hi = 1;                                   // bisect the largest safe scale
    for (let it = 0; it < 12; it++){ const m = (lo + hi) / 2; at(m); if (clear(S, i)) lo = m; else hi = m; }
    at(lo * .98);
  }
  return S;
}

/** Cosine ease a→b over [0,T] at time s; returns [y, dy/ds]. Zero velocity at both ends. */
function ease(a, b, s, T){
  if (T <= 0 || s >= T) return [b, 0];
  if (s <= 0) return [a, 0];
  const k = Math.PI / T;
  return [b + (a - b) * (1 + Math.cos(k * s)) / 2, -(a - b) * k * Math.sin(k * s) / 2];
}

/* ---- the lane at songTime t -------------------------------------------------
   Returns { y, vy, cy, cvy, mode, i, j, since, until, gap, armed, abs,
             def, c1, c2, vIn, ring }:
     y/vy    ball UNDERSIDE height above the string's rest line (and its velocity)
     cy/cvy  carriage height, expressed as the underside of a ball hanging on it
             (the magnet face is at cy + 2·BALL_R)
     mode    'hold' | 'fall' | 'contact' | 'rise' | 'winch'
     def     the string's contact deflection under the ball (≤ 0; 0 off contact)
     c1, c2  the string's ring: displacement = def·V(u) + c1·sin(πu) + c2·sin(2πu),
             u ∈ [0,1] along the string (contact at u = ½) */
export function poseAt(S, t, start = -Infinity){
  const { L, s: ss, gaps, P, n } = S;
  if (t < start) t = start;
  const first = firstAbs(S, start);
  if (!n) return { y: H_MAX, vy: 0, cy: H_MAX, cvy: 0, mode: 'hold', i: -1, j: -1, since: Infinity, until: Infinity,
                   gap: Infinity, armed: true, abs: -Infinity, def: 0, c1: 0, c2: 0, vIn: 0, ring: 0 };
  if (t < first){                                          // ARMED: loaded on the magnet, waiting
    const j = S._firstIdx, until = first - t, hj = S.h[j], tf = S.tf[j];
    const base = { cy: hj, cvy: 0, i: -1, j, since: Infinity, until, gap: Infinity, armed: true, abs: -Infinity,
                   def: 0, c1: 0, c2: 0, vIn: 0, ring: 0 };
    if (until >= tf) return { ...base, y: hj, vy: 0, mode: 'hold' };
    const f = tf - until;
    return { ...base, y: hj - .5 * g * f * f, vy: -g * f, mode: 'fall' };
  }
  const tau = wrapP(t, P);
  let i = lastIdx(ss, tau);
  const since = wrapP(tau - ss[i], P), gap = gaps[i], j = (i + 1) % n, until = gap - since;
  const vi = S.v[i], Tc = S.Tc[i], w1 = S.w1[i], w2 = E * w1, s1 = Math.PI / (2 * w1), D = vi / w1;
  const catchT = S.catchT[i], W = S.W[i], hj = S.h[j], tfj = S.tf[j];
  const rel = Math.max(gap - tfj, catchT + W);
  // carriage
  let cy, cvy;
  if (since < catchT) [cy, cvy] = ease(S.h[i], S.hr[i], since, catchT);
  else if (since < catchT + W) [cy, cvy] = ease(S.hr[i], hj, since - catchT, W);
  else { cy = hj; cvy = 0; }
  // ball
  let y, vy, mode;
  if (since < s1){ y = -D * Math.sin(w1 * since); vy = -D * w1 * Math.cos(w1 * since); mode = 'contact'; }
  else if (since < Tc){ const u = since - s1; y = -D * Math.cos(w2 * u); vy = D * w2 * Math.sin(w2 * u); mode = 'contact'; }
  else if (since < catchT){ const u = since - Tc, vo = S.vOut[i]; y = vo * u - .5 * g * u * u; vy = vo - g * u; mode = 'rise'; }
  else if (since < catchT + W){ y = cy; vy = cvy; mode = 'winch'; }
  else if (since < rel){ y = hj; vy = 0; mode = 'hold'; }
  else { const f = since - rel; y = hj - .5 * g * f * f; vy = -g * f; mode = 'fall'; }
  // string
  const def = mode === 'contact' ? Math.min(0, y) : 0;
  let c1 = 0, c2 = 0, ring = 0;
  if (since >= Tc){
    const u = since - Tc, taper = Math.max(0, 1 - since / gap) ** 2;
    ring = Math.exp(-RING_K * u) * taper;
    c1 = S.A1[i] * ring * Math.sin(OMEGA * u);
    c2 = S.A2[i] * ring * Math.sin(2 * OMEGA * u);
  } else ring = Math.min(1, -def / Math.max(1e-6, D));
  return { y, vy, cy, cvy, mode, i, j, since, until, gap, armed: false, abs: t - since, def, c1, c2, vIn: vi, ring };
}

/** The contact V's shape at u for a strike at u0: 1 at the contact point, 0 at both anchors. */
export const vShape = (u, u0) => u <= u0 ? u / u0 : (1 - u) / (1 - u0);

/** The string's displacement (top surface, relative to rest) at u ∈ [0,1] for a pose.
    u0 = the lane's strike point. (During contact the renderer additionally wraps the
    string round the ball's underside — min(V, sphere) — so it never cuts into it.) */
export function stringDisp(p, u, u0 = .5){
  return p.def * vShape(u, u0) + p.c1 * Math.sin(Math.PI * u) + p.c2 * Math.sin(2 * Math.PI * u);
}

const FOOT = 11;
/** Ball-vs-ringing-string clearance over the ball's whole FOOTPRINT (x ∈ ±r around the
    strike point): sphere underside − string top. Off contact only (in contact the string
    carries the ball and wraps its underside). ≥ 0 means no penetration. */
export function footClearance(S, p){
  if (p.mode === 'contact') return 0;
  let m = Infinity;
  for (let k = 0; k < FOOT; k++){
    const dx = BALL_R * (2 * k / (FOOT - 1) - 1);
    const u = S.u0 + dx / S.Ls;
    if (u <= 0 || u >= 1) continue;
    const under = p.y + BALL_R - Math.sqrt(Math.max(0, BALL_R * BALL_R - dx * dx));
    m = Math.min(m, under - stringDisp(p, u, S.u0));
  }
  return m;
}
/* does strike i's ring clear the departing ball over its whole gap? (sampled; finer
   just after departure, where the string and the ball are closest) */
function clear(S, i){
  const t0 = S.s[i] + S.P * 4, end = Math.min(S.gaps[i], 3.5);
  for (let s = S.Tc[i]; s < end; s += (s - S.Tc[i] < .15 ? .0004 : .003))
    if (footClearance(S, poseAt(S, t0 + s)) < 0) return false;
  return true;
}

function lastIdx(s, tau){
  let lo = 0, hi = s.length - 1;
  if (tau < s[0]) return hi;
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (s[m] <= tau) lo = m; else hi = m - 1; }
  return lo;
}
/* Absolute time of the lane's first strike at/after `start` (memoized; also its index). */
export function firstAbs(S, start){
  if (S._fStart === start) return S._f;
  let first = Infinity, idx = 0;
  if (!isFinite(start)) first = -Infinity;
  else S.s.forEach((si, k) => { const a = si + Math.ceil((start - si) / S.P) * S.P; if (a < first){ first = a; idx = k; } });
  S._fStart = start; S._f = first; S._firstIdx = idx;
  return first;
}
