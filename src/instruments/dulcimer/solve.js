/* ============================================================
   MARBLE GRAND — the pure math (no THREE scene, no DOM, no audio).

   An open grand piano whose ACTION is made of marbles. One lane = one
   pitch = one string + its own conserved marble hammer + its own felt
   cup on a piston + its own damper + its own key. Lanes never touch.

   THE STRIKE (a piano action, honestly): the marble rests in its felt
   CUP. The piston KICKS — a constant-acceleration stroke, the ball
   pressed into the felt the whole way (the cup only ever pushes) — and
   lets go: the ball flies a pure vertical arc (a solved launch:
   u = √(v² + 2g·Δh)) and meets the string from BELOW exactly on the beat,
   still rising at the hammer speed v (v grows with the note's velocity:
   a harder key throws a faster hammer — the piano's own dynamics). The
   bounce is lossy (e): it rebounds down at e·v and falls back into the
   cup, which waits AT REST at the catch level. The felt + piston take the
   landing on a constant deceleration (dip depth d), hold at the bottom of
   the dip, then kick again — every bounce's lost energy is the piston's.

   REPETITION (the double escapement, made of marbles): a long gap parks
   the ball at the cradle floor (Y_BOT) — rest, visible, waiting. A short
   gap can't afford the trip down: the cup rises to catch the ball HIGHER
   (the repetition lever), so the falls and flights shorten. The catch
   level is solved per gap: the LOWEST level whose dip fits under the cup's
   acceleration limit. Below MIN_GAP (≈ .2 s, a pure consequence of g, H
   and A_CUP) a same-pitch repeat is thinned (never a crash).

   THE CUP between a launch and the next catch: it brakes at the piston's
   limit (A_CUP ≫ g, so the ball separates — the only reason it leaves),
   stops a hair above the launch level, then glides (smoothstep, rest →
   rest) to the next catch level — waiting, if that level is higher, until
   the ball is above it — and is there at rest before the ball comes down.

   THE DAMPER (and the key that holds it): lifts LIFT_LEAD before the
   strike, stays up for the note's duration, drops at note-off and kills
   the string's motion and light. A same-pitch note that re-strikes before
   the drop keeps it up (legato). Duration is visible three ways: the key
   held down, the damper up, the string singing.

   Time is the only state: every function here is a pure fn of songTime.
   ============================================================ */
import { laneClock, at, wrapP } from '../clock.js';
import { noteNum } from '../../engine.js';

export const g = 14.5;                 // |G| — engine.js gravity
export const BALL_R = .16;             // marble hammer radius
export const H = 1.5;                  // ball-centre rise from the cradle floor (Y_BOT) to the strike
export const E = .55;                  // restitution: marble ↔ string
export const V_LO = 2.2, V_HI = 4.2;   // hammer speed at the string (u/s) at vel 0 … 1
export const Y_BOT = 0;                // the cradle floor (ball centre, resting)
export const Y_LO = .35;               // the normal catch / launch level (the felt's resting height)
export const Y_HI = H - .22;           // the repetition lever's highest catch level
export const C_TOP = Y_HI + .1;        // the cup never rises above this (stays clear of the string)
export const A_CUP = 400;              // the piston's acceleration limit (u/s²) — both ways
export const CUP_RIM = .07;            // cup rim height above the ball's centre (a shallow felt cup)
export const STR_R0 = .028;            // treble string radius …
export const STR_R1 = .062;            // … bass (copper-wound) string radius
export const STRIKE_U = 1 / 7;         // the strike point, as a fraction of the speaking length (the 7th-partial notch)

// the DAMPER
export const LIFT = .42;               // how far the felt rises off the string
export const LIFT_LEAD = .085;         // starts lifting this long before the strike …
export const LIFT_T = .06;             // … and is fully up after this (≥ .025 s before the strike)
export const DROP_T = .075;            // note-off: the felt falls back onto the string over this
export const DEF_HOLD = 1.0;           // a note with no duration rings this long
export const MIN_HOLD = .08, MAX_HOLD = 4.5;

// the visible string motion (tiny — the light does the talking) and its glow
export const F_VIS = 11;               // Hz: the string's visible shiver
export const AMP_VIS = v => .018 + .03 * v;   // antinode amplitude (u) by velocity
export const VIB_D = 2.2;              // 1/s: free decay of the visible motion

// ---- lane layout (the SLAB rule): every lane part lives within ±SLAB_HW of the lane's x ----
export const CUP_R = .2;               // felt cup outer radius (≥ BALL_R)
export const SLEEVE_R = .21;           // piston sleeve radius
export const DAMP_HW = .19;            // damper head half-width (x)
export const SLAB_HW = .23;
export const PLANE_MIN = 2 * SLAB_HW + .02;
export const SP_MAX = .82;             // widest string spacing (a sparse part doesn't sprawl)

/* ---- what this machine can play (the orchestrator routes by these) ----
   lo/hi: MIDI range (out-of-range notes fold by octaves) · pitches: strings (more distinct
   pitches fold onto a same-pitch-class string, else drop) · poly: notes per onset ·
   gap: the worst-case same-pitch retrigger (s) — closer repeats are thinned · maxEvents ·
   sustain: durations are honoured (dampers) up to maxDur. Computed below from the solve. */
export const LO = 33, HI = 96;         // A1 … C7
export const MAX_STRINGS = 20;
export const MAX_POLY = 8;
export const MAX_EVENTS = 384;

/* ============================================================ the ballistics */
export const vHit = vel => V_LO + (V_HI - V_LO) * Math.max(0, Math.min(1, vel ?? 1));
/** launch from level y to arrive at the string still rising at v: { u, tau } */
export function flight(y, v){ const u = Math.sqrt(v * v + 2 * g * (H - y)); return { u, tau: (u - v) / g }; }
/** rebound off the string at e·v, falling to level y: { w (speed, > 0), tf } */
export function fallTo(y, v){ const ev = E * v, w = Math.sqrt(ev * ev + 2 * g * (H - y)); return { w, tf: (w - ev) / g }; }

const LEVELS = 64;
/** Solve one gap (strike A → strike B, `gap` seconds): the catch level y, the dip d and the
    coupled timing. null = infeasible (too fast to repeat honestly). */
export function solveGap(gap, vA, vB){
  for (let k = 0; k <= LEVELS; k++){
    const y = Y_LO + (Y_HI - Y_LO) * k / LEVELS;
    const { w, tf } = fallTo(y, vA), { u, tau } = flight(y, vB);
    const D = gap - tf - tau;
    if (!(D > 0)) continue;
    const d = Math.min(y - Y_BOT, D / (2 / w + 2 / u));
    const dmin = Math.max(w, u) ** 2 / (2 * A_CUP);
    if (d < dmin) continue;
    const T1 = 2 * d / w, T2 = 2 * d / u;
    return { gap, y, w, tf, u, tau, D, d, a1: w * w / (2 * d), a2: u * u / (2 * d), T1, T2, Th: Math.max(0, D - T1 - T2),
             mode: y === Y_LO && d >= y - Y_BOT - 1e-12 ? 'park' : 'repeat' };
  }
  return null;
}

/** The fastest honest same-pitch repeat for these two velocities (bisection on the gap). */
export function minGap(vA, vB){
  let lo = 0, hi = 2;
  for (let k = 0; k < 40; k++){ const m = (lo + hi) / 2; if (solveGap(m, vA, vB)) hi = m; else lo = m; }
  return hi;
}
/* the worst case over the velocity range (what the orchestrator must respect) */
const MIN_GAP = (() => { let m = 0; for (const a of [0, .5, 1]) for (const b of [0, .5, 1]) m = Math.max(m, minGap(vHit(a), vHit(b))); return m; })();

export const PART_LIMITS = Object.freeze({
  lo: LO, hi: HI, center: 62, pitches: MAX_STRINGS, poly: MAX_POLY,
  gap: Math.ceil(MIN_GAP * 1000) / 1000,   // s, same-pitch retrigger
  ioi: 0,                                  // lanes are independent: any onset spacing across pitches
  voices: 2, maxEvents: MAX_EVENTS, sustain: true, minDur: 0, maxDur: MAX_HOLD,
});

/* ============================================================ the string bed */
/** Speaking length of a pitch's string: a pure fn of the note (bass long, treble short). */
export const stringLen = m => 6.6 * Math.pow(2, -(m - LO) * .3 / 12);
/** String radius: wound bass → plain treble, a pure fn of the note. */
export const stringR = m => STR_R1 + (STR_R0 - STR_R1) * Math.max(0, Math.min(1, (m - LO) / (HI - LO)));
/** How long the string visibly sings (s, its glow's e-folding) — longer in the bass. */
export const singTau = m => 2.6 * Math.pow(2, -(m - LO) / 30);

/** Lane x positions for n strings on a bed of usable width W (low → high, centred). */
export function layoutStrings(n, W){
  if (n <= 1) return { SP: 0, xs: n ? [0] : [] };
  const SP = Math.max(PLANE_MIN, Math.min(SP_MAX, W / (n - 1)));
  const x0 = -(n - 1) * SP / 2;
  return { SP, xs: Array.from({ length: n }, (_, k) => x0 + k * SP) };
}

/* ============================================================ parsing the part */
const PITCH = /^([A-G]#?\d)((?::[a-z])*)$/;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const nameOf = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
/** 'C4' / 'C4:e' → { m, ep } (ep = the FM electric-piano timbre flag). null = unparsable. */
export function parseNote(s){
  const k = typeof s === 'string' && s.match(PITCH);
  if (!k) return null;
  return { m: noteNum(k[1]), ep: /:e/.test(k[2]) };
}
/** The baked voice id for an event: pitch [+ ':e' tine timbre] [+ ':p' soft layer]. */
export const SOFT = .6;
export const voiceIdOf = (m, ep, vel) => nameOf(m) + (ep ? ':e' : '') + ((vel ?? 1) < SOFT ? ':p' : '');

/** Make ANY part playable (hand-authored or a dense MIDI import) — pure, never throws.
    Returns { part: [[beat, note, vel, dur]…] (note = canonical pitch [+ ':e']), warnings }.
      1. unparsable events dropped; vel clamped to (0, 1]; dur to [0, MAX_HOLD in beats → caller]
      2. pitches outside [LO, HI] fold by octaves
      3. same pitch at the same beat → one strike (loudest vel, longest dur)
      4. more than MAX_STRINGS distinct pitches: the most-used strings are built; a rarer pitch
         moves to the nearest-octave string of its pitch class, else it is dropped
      5. more than MAX_POLY notes at one onset: keep the outer voices, then the loudest
      6. more than MAX_EVENTS: the softest go first
    Per-lane retrigger thinning needs seconds — dulcimerLane does it (and reports). */
export function fitPart(part, { maxDurBeats = Infinity } = {}){
  const warnings = [];
  let ev = [];
  let bad = 0, folded = 0;
  for (const e of Array.isArray(part) ? part : []){
    if (!Array.isArray(e)) { bad++; continue; }
    const [beat, note, vel = 1, dur = 0] = e;
    const p = parseNote(note);
    if (!p || !Number.isFinite(beat)) { bad++; continue; }
    let m = p.m;
    while (m < LO){ m += 12; folded++; }
    while (m > HI){ m -= 12; folded++; }
    const v = Number.isFinite(vel) ? Math.max(.01, Math.min(1, vel)) : 1;
    const d = Number.isFinite(dur) ? Math.max(0, Math.min(maxDurBeats, dur)) : 0;
    ev.push({ beat, m, ep: p.ep, vel: v, dur: d });
  }
  if (bad) warnings.push(`${bad} unreadable event${bad > 1 ? 's' : ''} dropped`);
  if (folded) warnings.push(`${folded} octave fold${folded > 1 ? 's' : ''} into A1–C7`);
  // 3. one strike per (pitch, beat)
  const dedupe = list => {
    const key = new Map();
    for (const e of list){
      const k = `${e.m}|${+e.beat.toFixed(6)}`, o = key.get(k);
      if (!o) key.set(k, { ...e });
      else { o.vel = Math.max(o.vel, e.vel); o.dur = Math.max(o.dur, e.dur); o.ep = o.ep || e.ep; }
    }
    return [...key.values()];
  };
  ev = dedupe(ev);
  // 4. the string budget
  const count = new Map();
  for (const e of ev) count.set(e.m, (count.get(e.m) || 0) + 1);
  if (count.size > MAX_STRINGS){
    const ranked = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || Math.abs(a - 62) - Math.abs(b - 62) || a - b);
    const kept = new Set(ranked.slice(0, MAX_STRINGS));
    let moved = 0, lost = 0;
    ev = ev.flatMap(e => {
      if (kept.has(e.m)) return [e];
      let best = null;
      for (const k of kept) if ((k - e.m) % 12 === 0 && (best === null || Math.abs(k - e.m) < Math.abs(best - e.m))) best = k;
      if (best === null){ lost++; return []; }
      moved++; return [{ ...e, m: best }];
    });
    ev = dedupe(ev);
    warnings.push(`${count.size} pitches > ${MAX_STRINGS} strings: ${moved} moved an octave, ${lost} dropped`);
  }
  // 5. the chord cap
  const byOnset = new Map();
  for (const e of ev){ const k = +e.beat.toFixed(6); (byOnset.get(k) || byOnset.set(k, []).get(k)).push(e); }
  let capped = 0;
  ev = [...byOnset.values()].flatMap(ch => {
    if (ch.length <= MAX_POLY) return ch;
    ch.sort((a, b) => a.m - b.m);
    const outer = [ch[0], ch[ch.length - 1]];
    const inner = ch.slice(1, -1).sort((a, b) => b.vel - a.vel || a.m - b.m).slice(0, MAX_POLY - 2);
    capped += ch.length - MAX_POLY;
    return [...outer, ...inner];
  });
  if (capped) warnings.push(`${capped} chord note${capped > 1 ? 's' : ''} over ${MAX_POLY}-note polyphony dropped`);
  // 6. the event budget
  if (ev.length > MAX_EVENTS){
    const n = ev.length;
    ev = ev.map((e, i) => ({ e, i })).sort((a, b) => b.e.vel - a.e.vel || a.i - b.i).slice(0, MAX_EVENTS).map(o => o.e);
    warnings.push(`${n} events > ${MAX_EVENTS}: the ${n - MAX_EVENTS} softest dropped`);
  }
  ev.sort((a, b) => a.beat - b.beat || a.m - b.m);
  return { part: ev.map(e => [e.beat, nameOf(e.m) + (e.ep ? ':e' : ''), e.vel, e.dur]), warnings };
}

/* ============================================================ a lane */
/* cubic Hermite (value + derivative) over duration D, at local time s */
export function herm(p0, m0, p1, m1, D, s){
  const u = Math.max(0, Math.min(1, s / D)), u2 = u * u, u3 = u2 * u;
  const p = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * D * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * D * m1;
  const v = ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * D * m0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * D * m1) / D;
  return [p, v];
}
const sstep = (p0, p1, D, s) => {
  const u = Math.max(0, Math.min(1, s / D));
  return [p0 + (p1 - p0) * u * u * (3 - 2 * u), (p1 - p0) * 6 * u * (1 - u) / D];
};

/** Build one string's lane. strikes = [{t (loop-local s), vel, hold (s)}…]. P = loop period.
    Strikes closer than the solve allows are thinned (the later one goes) — lane.dropped. */
export function dulcimerLane(strikes, P, { m = 60 } = {}){
  // wrap, sort, merge coincident strikes
  let S = strikes.map(s => ({ t: +wrapP(s.t, P).toFixed(9), vel: s.vel ?? 1, hold: s.hold, id: s.id }))
    .sort((a, b) => a.t - b.t);
  S = S.reduce((o, s) => {
    const l = o[o.length - 1];
    if (l && Math.abs(l.t - s.t) < 1e-9){ if (s.vel > l.vel){ l.vel = s.vel; l.id = s.id; } l.hold = Math.max(l.hold ?? 0, s.hold ?? 0); }
    else o.push({ ...s });
    return o;
  }, []);
  // thin: any gap (cyclic) too short to repeat honestly loses its LATER strike
  // (one pass, O(n): keep a strike only if the last KEPT one can reach it; then close the seam)
  const ok = (a, b, gap) => !!solveGap(gap, vHit(a.vel), vHit(b.vel));
  const n0 = S.length;
  S = S.reduce((kept, s) => { const l = kept[kept.length - 1]; if (!l || ok(l, s, s.t - l.t)) kept.push(s); return kept; }, []);
  while (S.length > 1 && !ok(S[S.length - 1], S[0], S[0].t + P - S[S.length - 1].t)) S.pop();
  const dropped = n0 - S.length;
  const L = laneClock(S.map(s => s.t), P);
  const n = L.s.length;
  const v = S.map(s => vHit(s.vel));
  const hold = S.map(s => Math.max(MIN_HOLD, Math.min(MAX_HOLD, s.hold > 0 ? s.hold : DEF_HOLD)));
  const plan = L.gaps.map((gap, i) => solveGap(gap, v[i], v[(i + 1) % n]));
  // the cup's free path after each launch: plan[i] launches ball i+1 at level plan[i].y with speed
  // plan[i].u; it must wait at rest at plan[i+1].y (the next catch level) before the ball comes down
  plan.forEach((p, i) => {
    const q = plan[(i + 1) % n];
    const a = p.y, u = p.u, b = q.y;
    const Tc = p.tau + q.tf;                                     // launch → the next catch
    const A = A_CUP;                                             // the piston stops HARD (≫ g: the ball leaves at once)
    const rs = u / A, c = a + u * u / (2 * A);                    // the cup stops here
    // a rising glide waits until the ball is above the target level (it passes b at r1)
    let r1 = rs;
    if (b > c){ const disc = u * u - 2 * g * (b - a); r1 = Math.max(rs, disc > 0 ? (u - Math.sqrt(disc)) / g : rs); }
    const g0 = r1, g1 = g0 + .7 * Math.max(1e-3, Tc - g0);
    p.ret = { a, u, A, rs, c, b, g0, g1, Tc };
    // the damper over this gap: legato (stays up) when the next lift comes before this drop lands
    p.legato = p.gap - LIFT_LEAD < hold[i] + DROP_T + .02;
  });
  return { L, n, m, v, vel: S.map(s => s.vel), ids: S.map(s => s.id), hold, plan, dropped, len: stringLen(m), amp: S.map(s => AMP_VIS(s.vel)) };
}

/* the cup after a launch (r s since the launch of the ball it just threw) */
function cupFree(ret, r){
  if (r <= ret.rs) return [ret.a + ret.u * r - .5 * ret.A * r * r, ret.u - ret.A * r];
  if (r <= ret.g0) return [ret.c, 0];
  return sstep(ret.c, ret.b, ret.g1 - ret.g0, r - ret.g0);
}
/* the seated (coupled) phase of gap plan p, x s since the catch */
function seated(p, x){
  if (x <= p.T1) return [p.y - p.w * x + .5 * p.a1 * x * x, -p.w + p.a1 * x, p.a1];
  if (x <= p.T1 + p.Th) return [p.y - p.d, 0, 0];
  const x2 = Math.min(p.T2, x - p.T1 - p.Th);
  return [p.y - p.d + .5 * p.a2 * x2 * x2, p.a2 * x2, p.a2];
}

/* the damper position (1 = up) over gap i at s since strike i */
const smooth01 = x => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
function damperIn(lane, i, s){
  const p = lane.plan[i], gap = p.gap;
  if (p.legato) return 1;
  const h = lane.hold[i];
  if (s < h) return 1;
  if (s < h + DROP_T) return 1 - smooth01((s - h) / DROP_T);
  return smooth01((s - (gap - LIFT_LEAD)) / LIFT_T);
}
/** the damper ramp before a strike, `until` seconds ahead (0 = down) */
const lifting = until => smooth01((LIFT_LEAD - until) / LIFT_T);

/** The lane at songTime t.
    { y, vy, cup, cupV, cupA, seated, phase, damp, vib, sing, hot, i, since, until, gap, armed, abs, first }
    y/vy   ball centre height above the cradle floor + its velocity
    cup    the felt seat's height (the ball sits on it when seated: y === cup)
    damp   damper lift 0 (resting on the string) … 1 (fully up)
    vib    the string's displacement at its antinode (u, + = up), sing = its glow level 0..1 */
export function dulcimerAt(lane, t, start = -Infinity){
  const { L, n, plan, v } = lane;
  const c = at(L, t, start);
  if (!n) return { y: Y_BOT, vy: 0, cup: Y_BOT, cupV: 0, cupA: 0, seated: true, phase: 'idle', damp: 0, vib: 0, sing: 0, hot: Infinity, ...c };
  if (c.armed){
    const j = c.next, pp = plan[(j - 1 + n) % n];               // the launch that will carry strike j
    const until = c.until, damp = lifting(until);
    const base = { damp, vib: 0, sing: 0, hot: Infinity, ...c, armed: true };
    if (until > pp.tau){                                        // still in the cradle: resting, then the kick
      const T2 = 2 * (pp.y - Y_BOT) / pp.u, a2 = pp.u * pp.u / (2 * (pp.y - Y_BOT));
      const k = until - pp.tau;
      if (k >= T2) return { y: Y_BOT, vy: 0, cup: Y_BOT, cupV: 0, cupA: 0, seated: true, phase: 'rest', ...base };
      const x = T2 - k, y = Y_BOT + .5 * a2 * x * x;
      return { y, vy: a2 * x, cup: y, cupV: a2 * x, cupA: a2, seated: true, phase: 'kick', ...base };
    }
    const r = pp.tau - until;
    const [cup, cupV] = cupFree(pp.ret, r);
    return { y: pp.y + pp.u * r - .5 * g * r * r, vy: pp.u - g * r, cup, cupV, cupA: 0, seated: false, phase: 'fly', ...base };
  }
  const i = c.i, p = plan[i], s = c.since;
  const damp = damperIn(lane, i, s);
  // the string: shiver up (pushed by the hammer), decaying, tapered to rest by the next contact,
  // and held to the damper (a dropped felt kills it — and never cuts through it)
  const taper = Math.max(0, 1 - s / p.gap) ** 2;
  const vib = lane.amp[i] * Math.exp(-VIB_D * s) * Math.sin(2 * Math.PI * F_VIS * s) * taper * damp;
  const sing = Math.exp(-s / singTau(lane.m)) * damp;
  const base = { damp, vib, sing, hot: s, ...c };
  if (s < p.tf){                                                // rebound: falling back toward the waiting cup
    const pr = plan[(i - 1 + n) % n];                           // the launch that threw this strike
    const [cup, cupV] = cupFree(pr.ret, pr.tau + s);
    return { y: H - E * v[i] * s - .5 * g * s * s, vy: -E * v[i] - g * s, cup, cupV, cupA: 0, seated: false, phase: 'fall', ...base };
  }
  if (s < p.tf + p.D){                                          // caught: dip, hold, kick
    const [y, vy, a] = seated(p, s - p.tf);
    return { y, vy, cup: y, cupV: vy, cupA: a, seated: true, phase: s - p.tf <= p.T1 + p.Th ? 'catch' : 'kick', ...base };
  }
  const r = s - p.tf - p.D;                                     // launched: the solved arc onto strike i+1
  const [cup, cupV] = cupFree(p.ret, r);
  return { y: p.y + p.u * r - .5 * g * r * r, vy: p.u - g * r, cup, cupV, cupA: 0, seated: false, phase: 'fly', ...base };
}

/** Clearance (≥ 0 = no penetration) between the marble and its string at the strike point
    (the string's bottom sits at H + BALL_R when at rest; vib shifts it by sin(π·STRIKE_U)·vib). */
export const stringClear = (y, vib) => (H + Math.sin(Math.PI * STRIKE_U) * vib) - y;
/** The damper felt's bottom above the string's top at the damper point (≥ 0: never cuts in). */
export const damperClear = (damp, vib, uDamp) => LIFT * damp - Math.max(0, Math.sin(Math.PI * uDamp) * vib);
