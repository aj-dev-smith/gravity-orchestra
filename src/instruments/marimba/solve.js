/* ============================================================
   MARIMBA — THE ROBOT MARIMBIST. Pure math (no THREE scene, no DOM, no audio).

   THE PERFORMER: a gantry RAIL over the keyboard carries TWO CARRIAGES (left
   hand / right hand), each belt-driven. Each carriage holds TWO MALLETS on a
   SCISSOR YOKE (lazy tongs) whose spread sets the interval — a real four-mallet
   grip. Each mallet hangs from a z-TRACK on its yoke end: a forearm slides
   along it (reaching for the back row = the sharps) and a WRIST MOTOR at its
   foot swings the shaft. The mallet head is a glowing MARBLE.

   EVERYTHING IS SOLVED ONCE, UP FRONT, CYCLIC OVER THE LOOP:
   · ALLOCATION (dumb + deterministic): chords → lowest notes left, highest
     right (≤ 2 per hand; extras dropped with a warning); single lines → the
     hand that can REACH within its speed/accel limits, preferring low→left /
     high→right; a note of ≥ 1 beat becomes a ROLL (tremolo between the hand's
     two mallets, every stroke re-sounds the bar). The loop seam is just
     another move (three passes, each seeded by the last one's end state).
   · MOTION: each carriage's x(t) and yoke spread s(t) pass through every
     required pose EXACTLY at its strike times — quintic Hermite segments
     (C², zero accel at every knot), departing as late as the limits allow.
     A hands-never-cross guard (smooth, weighted toward whichever hand is
     furthest from a strike) can never move a hand at its own strike.
   · THE STROKE (per mallet, a pure fn of time since/until its strikes):
     prep lift (∝ velocity — louder = higher, because stroke height IS the
     energy: a constant-acceleration down-stroke from height H lands at
     v = √(2·A·H)) → down-stroke → CONTACT (head exactly on the bar top) →
     LOSSY REBOUND (keeps E of its speed) → caught by the wrist motor and
     carried to the next prep height.
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
export const S_MIN   = .2;            // tightest yoke (both heads on ONE bar — a unison roll)
export const S_REL   = 1.0;           // a relaxed grip (≈ a third)
export const GAP_MIN = .01;           // hands' inner extents never closer than this (u)
export const GAP_M   = .025;          // the guard's soft margin
export const GAP_REQ = GAP_MIN + 2 * GAP_M;   // the allocator keeps this at every knot

/* carriage (x) and yoke-spread limits */
export const V_MAX = 12, A_MAX = 160;          // u/s, u/s² (1 u ≈ 22 cm: 2.6 m/s, 3.6 g — a brisk gantry)
export const VS_MAX = 16, AS_MAX = 320;     // the scissor is light: it opens faster than the carriage runs
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
  for (const k of knots) if (!ks.length || k.t - ks[ks.length - 1].t > 1e-9) ks.push({ t: k.t, x: k.x, still: !!k.still });
  if (!ks.length) return { segs: [{ t0: 0, t1: P, x0: fallback, x1: fallback, v0: 0, v1: 0 }], knots: [], vAt: [] };
  if (ks.length === 1) return { segs: [{ t0: ks[0].t, t1: ks[0].t + P, x0: ks[0].x, x1: ks[0].x, v0: 0, v1: 0 }], knots: ks, vAt: [0] };
  const pts = [];
  ks.forEach((a, k) => {
    const b = ks[(k + 1) % ks.length], t1 = b.t + (k + 1 === ks.length ? P : 0);
    const dt = t1 - a.t, d = b.x - a.x;
    pts.push({ t: a.t, x: a.x, knot: k, still: a.still });
    if (Math.abs(d) > 1e-9){
      const Tm = Math.min(dt, Math.max(.1, 1.25 * tNeed(d, V, A)));
      if (dt > 2 * Tm && dt - Tm > .1) pts.push({ t: t1 - Tm, x: a.x, split: true });   // a real rest, then a late move
    }
  });
  const n = pts.length;
  const nxt = i => (i + 1) % n, prv = i => (i - 1 + n) % n;
  const dtTo = (i, j) => { let d = pts[j].t - pts[i].t; if (d <= 0) d += P; return d; };
  // tangents: a run FLOWS through its knots (harmonic mean of the slopes); a turn
  // stops; a knot next to a hold may coast through and settle (overshoot-and-return)
  const base = pts.map((p, i) => {
    if (p.split || p.still || still?.has(i)) return 0;
    const a = pts[prv(i)], b = pts[nxt(i)], d0 = p.x - a.x, d1 = b.x - p.x;
    const m0 = d0 / dtTo(prv(i), i), m1 = d1 / dtTo(i, nxt(i));
    if (Math.abs(d0) > 1e-9 && Math.abs(d1) > 1e-9) return d0 * d1 > 0 ? clamp(2 * m0 * m1 / (m0 + m1), -.7 * V, .7 * V) : 0;
    return Math.abs(d0) > 1e-9 ? m0 : Math.abs(d1) > 1e-9 ? m1 : 0;
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
  return { segs, knots: ks, vAt };
}

/** A leg's peak |v|/V and |a|/A (whichever is worse) — sampled from the exact derivatives. */
function legLoad(sg, V, A){
  const T = sg.t1 - sg.t0;
  if (T <= 1e-9) return 0;
  const { x0, x1 } = sg, a0 = T * sg.v0, a1 = T * sg.v1;
  let e = 0;
  for (let k = 0; k <= 16; k++){
    const u = k / 16, u2 = u * u, u3 = u2 * u, u4 = u3 * u;
    const d0 = -30 * u2 + 60 * u3 - 30 * u4;
    const vel = (d0 * (x0 - x1) + (1 - 18 * u2 + 32 * u3 - 15 * u4) * a0 + (-12 * u2 + 28 * u3 - 15 * u4) * a1) / T;
    const e0 = -60 * u + 180 * u2 - 120 * u3;
    const acc = (e0 * (x0 - x1) + (-36 * u + 96 * u2 - 60 * u3) * a0 + (-24 * u + 84 * u2 - 60 * u3) * a1) / (T * T);
    e = Math.max(e, Math.abs(vel) / V, Math.abs(acc) / A);
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
  return { F, B, contact, sMax, nCell, link: Math.hypot(sMax / nCell, .32), mid: (Math.min(...xs) + Math.max(...xs)) / 2 };
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

  // 2. allocate: a small deterministic BEAM SEARCH over the onsets (each step expands
  //    every grip of every hand; the BEAM cheapest histories survive), three cyclic passes,
  //    each seeded with the previous pass's best end state (the seam is just another move)
  for (const o of onsets){ o.roll = Math.max(...o.ns.map(n => n.roll ? n.tDur : 0)); o.groups = groupsOf(o, rig, warn); }
  const park = [{ cx: TRAVEL[0] + .3, s: .6 }, { cx: TRAVEL[1] - .3, s: .6 }];
  let seed = park.map(p => ({ t: -1e9, cx: p.cx, s: p.s, v: 0, vs: 0, last: [-1e9, -1e9], lastZ: [null, null], busy: -1e9 })), bestNode = null;
  for (let pass = 0; pass < 3; pass++){
    let beam = [{ H: seed, cost: 0, parent: null, opt: null, o: null }];
    for (const o of onsets){
      const next = [];
      for (const nd of beam) for (const op of options(o, nd.H, rig))
        next.push({ H: applyPoses(nd.H, op.poses, o), cost: nd.cost + op.cost, parent: nd, opt: op, o });
      next.sort((x, y) => x.cost - y.cost);
      const seen = new Set(); beam = [];
      for (const nd of next){
        const k = nd.H.map(h => `${h.cx.toFixed(2)}:${h.s.toFixed(2)}:${(o.t - h.last[0] < T_COMFY) | 0}${(o.t - h.last[1] < T_COMFY) | 0}`).join('|');
        if (seen.has(k)) continue;
        seen.add(k); beam.push(nd);
        if (beam.length >= BEAM) break;
      }
    }
    bestNode = beam[0];
    seed = bestNode.H.map(h => ({ ...h, t: h.t - P, last: h.last.map(x => x - P), lastZ: [...h.lastZ], busy: h.busy - P }));
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
      const kn = { t: o.t, cx: ps.cx, s: ps.s, strike: true, hits: ps.hits };
      out.knots[ps.h].push(kn);
      if (ps.roll){ kn.roll = true; out.rolls.push({ h: ps.h, t: o.t, end: o.t + ps.roll, strokes: rollStrokes(ps, o.t), knot: kn }); }
    }
  }

  // 3. rolls: cut before the hand's next onset; a HOLD knot keeps the hand still while it rolls
  const hands = [0, 1].map(h => ({ h, knots: out.knots[h] }));
  for (const r of out.rolls){
    const ks = out.knots[r.h], i = ks.indexOf(r.knot);
    const nx = ks.length > 1 ? ks[(i + 1) % ks.length].t + (i + 1 === ks.length ? P : 0) : r.t + P;
    const lim = nx - T_REC, kept = r.strokes.filter(s => s.t <= lim + 1e-9);
    if (r.strokes.length - kept.length > 1) warn('roll', 'a roll was cut short (its hand is needed next)');
    r.strokes = kept;
    r.hold = Math.min(r.end, lim);
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
      H.cxPath = buildPath(H.knots.map(k => ({ t: k.t, x: k.cx, still: still(k) })), P, V_MAX, A_MAX, H.park.cx, H.still[0]);
      H.sPath = buildPath(H.knots.map(k => ({ t: k.t, x: k.s, still: still(k) })), P, VS_MAX, AS_MAX, H.park.s, H.still[1]);
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
      const sep = !sepOK(pose[0], pose[1], GAP_MIN + GAP_M);
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
  for (const M of mallets) M.strikes.forEach((s, i) => barHits[s.bar].push({ t: s.t, vin: M.vin[i], vel: s.vel, u: rig.contact[s.bar].u }));
  const bars = barHits.map(hs => {
    hs.sort((a, b) => a.t - b.t);
    const u = hs.filter((h, i) => !(i > 0 && h.t - hs[i - 1].t < 1e-7));
    return { hits: u, L: u.length ? laneClock(u.map(h => h.t), P) : null };
  });

  const plan = { P, start: s0, kb, rig, hands, mallets, bars,
    warnings: [...warns.values()].map(w => `${w.msg}${w.n > 1 ? ` (×${w.n})` : ''}`) };
  // 7. verify the motion limits (after the no-cross guard) — warn, don't hide
  const lim = motionStats(plan, .01);
  if (lim.v > V_MAX * PEAK || lim.a > A_MAX * PEAK || lim.vs > VS_MAX * PEAK || lim.as > AS_MAX * PEAK)
    plan.warnings.push(`carriage limits exceeded: |v| ${lim.v.toFixed(1)} |a| ${lim.a.toFixed(0)} · yoke |v| ${lim.vs.toFixed(1)} |a| ${lim.as.toFixed(0)}`);
  plan.stats = lim;
  return plan;
}

export const BEAM = 24;

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
function options(o, H, rig){
  const t = o.t, roll = o.roll, out = [];
  if (!o.groups){
    const n = o.ns[0], pref = n.x < rig.mid ? 0 : 1;
    for (const h of [0, 1]) for (const c of grips(n, H[h], rig, roll)){
      const oth = { cx: H[1 - h].cx, s: H[1 - h].s };
      if (!(h === 0 ? sepOK(c, oth) : sepOK(oth, c))) continue;
      const f = feas(H[h], c, t);
      out.push({ poses: [{ h, cx: c.cx, s: c.s, hits: c.hits, roll }], ok: f.ok, cost: f.cost + (h !== pref ? .8 : 0) + (f.ok ? 0 : 40) });
    }
    if (!out.length) out.push({ poses: [], ok: false, cost: 200, drop: 'drop' });
    return out;
  }
  const [gl, gr] = o.groups;
  const rollOf = g => Math.max(...g.map(n => n.roll ? n.tDur : 0));   // each hand rolls only its own long notes
  const rl = rollOf(gl), rr = rollOf(gr);
  const optsL = gl.length === 2 ? [dyad(gl)] : grips(gl[0], H[0], rig, rl, 1);
  const optsR = gr.length === 2 ? [dyad(gr)] : grips(gr[0], H[1], rig, rr, 0);
  for (const a of optsL) for (const b of optsR){
    if (!sepOK(a, b)) continue;
    const fa = feas(H[0], a, t), fb = feas(H[1], b, t), ok = fa.ok && fb.ok;
    out.push({ poses: [{ h: 0, cx: a.cx, s: a.s, hits: a.hits, roll: rl }, { h: 1, cx: b.cx, s: b.s, hits: b.hits, roll: rr }],
               ok, cost: fa.cost + fb.cost + (ok ? 0 : 40) });
  }
  if (!out.length) out.push({ poses: [], ok: false, cost: 400, drop: 'chord' });
  return out;
}

/** A roll's strokes: alternating mallets, evenly through the note's duration. */
function rollStrokes(ps, t0){
  const n = Math.max(2, Math.round(ps.roll / ROLL_DT)), dt = ps.roll / n, out = [];
  for (let k = 0; k < n; k++){
    const hh = ps.hits.find(x => x.m === k % 2) || ps.hits[0];
    out.push({ t: t0 + k * dt, m: hh.m, bar: hh.bar, x: hh.x, vel: hh.vel * (k % 2 ? .9 : 1) });
  }
  return out;
}

/** New hand states after playing poses at onset o (states are never mutated). */
function applyPoses(H, poses, o){
  const out = H.slice();
  for (const ps of poses){
    const S = H[ps.h], dt = o.t - S.t, N = { ...S, last: [...S.last], lastZ: [...S.lastZ] };
    for (const ht of ps.hits) N.lastZ[ht.m] = ht.zw;
    N.v = dt < .6 && dt > 0 ? (ps.cx - S.cx) / dt : 0; N.vs = dt < .6 && dt > 0 ? (ps.s - S.s) / dt : 0;
    N.t = o.t; N.cx = ps.cx; N.s = ps.s;
    if (ps.roll){
      const st = rollStrokes(ps, o.t);
      N.busy = o.t + ps.roll; N.t = o.t + ps.roll; N.v = N.vs = 0;
      for (const m of [0, 1]){ const ls = st.filter(x => x.m === m); if (ls.length) N.last[m] = ls[ls.length - 1].t; }
    } else for (const ht of ps.hits) N.last[ht.m] = o.t;
    out[ps.h] = N;
  }
  return out;
}

const best = cs => cs.reduce((a, c) => (!a || c.cost < a.cost - 1e-12 ? c : a), null);

function dyad(g){
  return { cx: (g[0].x + g[1].x) / 2, s: g[1].x - g[0].x,
           hits: [{ m: 0, bar: g[0].bar, x: g[0].x, vel: g[0].vel, zw: g[0].zw }, { m: 1, bar: g[1].bar, x: g[1].x, vel: g[1].vel, zw: g[1].zw }] };
}

/** Every way a hand in state S can play ONE note n: the partner mallet stays put (the
    grip opens/closes), the whole hand shifts at its current grip, a relaxed grip, a
    tight grip — or, for a ROLL, both heads on the one bar. onlyM restricts the mallet. */
function grips(n, S, rig, roll, onlyM){
  if (roll) return [{ cx: n.x, s: S_MIN,
    hits: [{ m: 0, bar: n.bar, x: n.x - S_MIN / 2, vel: n.vel, zw: n.zw }, { m: 1, bar: n.bar, x: n.x + S_MIN / 2, vel: n.vel, zw: n.zw }] }];
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
    add(S_REL);                                 // relaxed grip
    add(S_MIN + .12);                           // tight grip (crowded chords)
  }
  return out;
}

/** Can hand state S reach pose c by time t? Either as a rest-to-rest move, or by
    FLOWING on from the velocity it already has (a run). cost = how hard it works. */
function canMove(d, dt, v0, V, A){
  if (Math.abs(d) < 1e-9) return { ok: true, r: 0 };
  if (dt <= 0) return { ok: false, r: 9 };
  const rest = tNeed(d, V, A) / dt;
  // a quintic leg that starts at v0 and averages u peaks near |u| + .875·|u − v0|
  const u = d / dt, flow = u * v0 >= 0 && Math.abs(u) + .875 * Math.abs(u - v0) <= .9 * V && Math.abs(u - v0) <= .35 * A * dt;
  return { ok: rest <= 1 + 1e-9 || flow, r: Math.min(rest, flow ? .8 : 9) };
}
function feas(S, c, t){
  const dt = t - S.t;
  const mx = canMove(c.cx - S.cx, dt, S.v, V_MAX, A_MAX), ms = canMove(c.s - S.s, dt, S.vs, VS_MAX, AS_MAX);
  let ok = mx.ok && ms.ok;
  let cost = Math.max(mx.r, ms.r) * .6 + .15 * Math.abs(c.cx - S.cx) + .05 * Math.abs(c.s - S.s);
  for (const ht of c.hits){
    const dm = t - S.last[ht.m], lz = S.lastZ[ht.m];
    if (dm < T_REC - 1e-9) ok = false;
    if (lz !== null && Math.abs(lz - ht.zw) > 1e-6){
      // the forearm moves between the rebound's catch and the first third of the down-stroke (see wristAt)
      const Td = Math.sqrt(2 * prepH(ht.vel, dm) / A_ST);
      if (tNeed(lz - ht.zw, VZ_MAX, AZ_MAX) > dm - .35 * Td - Math.min(SIG_R, .3 * dm) - 1e-9) ok = false;
      else cost += .1;
    }
    else if (dm < T_COMFY) cost += .5 * (1 - dm / T_COMFY);
  }
  if (S.busy > t + 1e-9) ok = false;
  return { ok, cost };
}

/* ---- per-mallet stroke data ------------------------------------------------ */
/** Prep height for a strike of velocity vel whose mallet had `gap` s to get ready:
    ∝ velocity, compressed so the down-stroke fits in .45 of the gap. */
export function prepH(vel, gap){
  const H = HP_MIN + (HP_MAX - HP_MIN) * clamp(vel, 0, 1);
  return Math.min(H, .5 * A_ST * (.45 * gap) ** 2);
}

function strokeData(M, rig, kb, P){
  const S = M.strikes, n = S.length;
  M.Hp = []; M.Td = []; M.vin = []; M.sigR = []; M.vr = []; M.Ac = []; M.hpk = []; M.zw = []; M.yc = [];
  if (!n){ M.L = null; return; }
  M.L = laneClock(S.map(s => s.t), P);
  const gap = i => n === 1 ? P : (i + 1 < n ? S[i + 1].t - S[i].t : S[0].t + P - S[i].t);
  for (let i = 0; i < n; i++){
    const gPrev = gap((i - 1 + n) % n), g = gap(i);
    const Hp = prepH(S[i].vel, gPrev), Td = Math.sqrt(2 * Hp / A_ST);
    M.Hp.push(Hp); M.Td.push(Td); M.vin.push(A_ST * Td);
    const sr = Math.min(SIG_R, .3 * g), vr = E * A_ST * Td;
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

/** The strike mallet M most recently left: { d (clock), vin, since, s (strike) }. */
export function lastHit(plan, M, t){
  if (!M.L) return null;
  const d = at(M.L, t, plan.start);
  if (d.armed) return { d, vin: 0, since: Infinity, s: null };
  return { d, vin: M.vin[d.i], since: d.since, s: M.strikes[d.i] };
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
