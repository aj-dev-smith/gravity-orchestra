/* ============================================================
   BELLOWS HORNS — the pure math (no THREE scene, no DOM, no audio).

   THE MECHANISM (one lane = one pitch = one horn + its own bellows + its own marble):
   · every horn is fed by a BELLOWS under a brass LID. The lane's marble hangs on an
     ELECTROMAGNET exactly H above the lid; the coil cuts and the marble free-falls
     onto the lid ON THE BEAT (the lid is at rest at its top stop — honest contact).
   · the marble's WEIGHT then drives the lid down for the note's whole duration — the
     bellows exhausting through the horn's reed. The lid takes the marble's momentum and
     sinks at a near-constant rate that eases to rest exactly at note-off (speed ∝
     1 − (s/h)³ — never accelerating downward, so the marble stays seated): a STAB slams
     the lid down, a long note sinks it slowly. The articulation is visible motion.
     Stroke depth grows with velocity (forte = more air).
   · at note-off the bellows' return SPRING (a visible pneumatic ram) snaps the lid back
     up to its stop under constant acceleration, lobbing the marble straight up. With
     time to spare it rises to the magnet and arrives AT ZERO SPEED (apex = H) — caught
     and held, then released so the fall lands on the next beat. A DENSE repeat lobs it
     on a lower solved arc that lands back on the lid exactly on the next beat.
   · lossy + visible energy source: the landing is inelastic (the bellows soak the
     marble's speed — it rides the lid off at ≤ .95 of it), the ram supplies the lob.

   Vertical only: the marble lives on its lane's own plumb line (lanes never interact).
   Time is the only state: every function here is a pure fn of songTime.
   ============================================================ */
import { laneClock, at, wrapP } from '../clock.js';
import { noteNum } from '../../engine.js';

export const g = 14.5;              // |G| — engine.js gravity
export const BALL_R = .26;          // marble radius (unscaled)
export const H = 2.4;               // magnet apex height above the contact point (unscaled)
export const HOLD_MIN = .06;        // shortest note the bellows can speak (s)
export const HOLD_MAX = 2.6;        // longest held note (s) — the bellows' full exhaust; the voice holds this long
export const STAB_T = .2;           // a STAB (durBeats ≤ STAB_BEATS) speaks at most this long — the voice's stab render
export const STAB_BEATS = .5;
export const R_MIN = .12;           // shortest snap + lob between two notes on one lane (s)
export const MIN_GAP = HOLD_MIN + R_MIN;   // same-pitch retrigger floor (s)
export const D_MIN = .1, D_MAX = .48;      // lid stroke at vel 0 … 1 (unscaled)
export const RIDE = .95;            // the lid takes the marble off at ≤ this fraction of its landing speed
export const DENSE_SAFE = .9;       // a dense lob's stroke keeps this margin under its solvability bound

/** The PART LIMITS this machine honours (orchestrator routing; pure data). One lane per
    pitch, so true polyphony = lanes; `poly` is the section size it is happiest at. */
export const PART_LIMITS = {
  lo: 40, hi: 86, center: 62,       // E2 … D6 (MIDI) — tuba to trumpet
  pitches: 12,                      // ≤ 12 horns on the deck (the rarest pitches beyond are dropped)
  poly: 4, voices: 3,               // a horn section: 3–4 at once (tutti chords of 8+ still honest)
  gap: MIN_GAP,                     // same-pitch retrigger floor (s); closer repeats are thinned
  ioi: 0,                           // different pitches never interact
  sustain: true, minDur: HOLD_MIN, maxDur: HOLD_MAX,
  maxEvents: 320,                   // beyond this the loudest are kept (evenly thinned)
};

/* ---- the per-gap plan ---- */
const tFall = Hs => Math.sqrt(2 * Hs / g);          // magnet → contact
export const dForVel = v => D_MIN + (D_MAX - D_MIN) * Math.max(0, Math.min(1, v));
/* the dense lob: snap TS = 2d/v0 (constant accel from rest at −d to the stop at v0) + flight
   2v0/g must fill R. 2v0²/g − R·v0 + 2d = 0 → the larger root (the higher, shorter-snap lob). */
const denseV0 = (R, d) => g / 4 * (R + Math.sqrt(Math.max(0, R * R - 16 * d / g)));

/** Hold length (s) for an event: stabs speak at most STAB_T; everything clamps to the gap. */
export function holdFor(durBeats, beat, gap){
  const raw = isStab(durBeats) ? Math.min(STAB_T, Math.max(HOLD_MIN, (durBeats || STAB_BEATS) * beat)) : durBeats * beat;
  const room = Math.max(gap - R_MIN, Math.min(gap * .35, HOLD_MIN));   // (a too-dense lane — fitPart thins these — still never crashes)
  return Math.max(Math.min(HOLD_MIN, room), Math.min(raw, HOLD_MAX, room));
}
export const isStab = durBeats => !(durBeats > STAB_BEATS);

/** A lane: strike times (loop-local s), parallel vels + durBeats; `beat` = seconds/beat;
    `scale` = the machine's uniform size (H, stroke, marble all scale; g does not). */
export function hornLane(strikes, vels, durs, P, { beat = .5, scale = 1 } = {}){
  const L = laneClock(strikes, P);
  const n = L.s.length;
  const pick = (arr, dflt) => L.s.map(si => {
    let v = undefined;
    strikes.forEach((t, k) => { if (Math.abs(+wrapP(t, P).toFixed(9) - si) < 1e-9){ const x = arr[k] ?? dflt; v = v === undefined ? x : Math.max(v, x); } });
    return v ?? dflt;
  });
  const vel = pick(vels, 1), dur = pick(durs, 0);
  const Hs = H * scale, tf = tFall(Hs), vF = g * tf;   // vF = √(2gH): the landing speed off the magnet
  const h = L.gaps.map((gap, i) => holdFor(dur[i], beat, gap));
  const R = L.gaps.map((gap, i) => gap - h[i]);
  const dProv = vel.map((v, i) => Math.min(dForVel(v) * scale, DENSE_SAFE * g * R[i] * R[i] / 16));
  const lob = (d, Ri) => {                            // → { free, v0, TS, dwell }
    const TSf = 2 * d / vF;
    if (Ri >= TSf + 2 * tf - 1e-12) return { free: true, v0: vF, TS: TSf, dwell: Ri - TSf - 2 * tf };
    const v0 = denseV0(Ri, d);
    return { free: false, v0, TS: 2 * d / v0, dwell: 0 };
  };
  const prov = dProv.map((d, i) => lob(d, R[i]));
  // the lid must not run away from the marble: its initial sink speed 4d/3h ≤ RIDE·(landing speed)
  // (landing speed = the previous gap's lob speed; the count-in drop falls the full H — faster)
  const d = dProv.map((dp, i) => Math.min(dp, RIDE * prov[(i - 1 + n) % n].v0 * h[i] * .75));
  const plan = L.gaps.map((gap, i) => ({ gap, h: h[i], R: R[i], d: d[i], ...lob(d[i], R[i]) }));
  // (d only shrank → every lob got faster → every landing speed only grew: the ride bound still holds)
  return { L, n, vel, dur, plan, Hs, tf, vF, scale, rBall: BALL_R * scale };
}

/** The lane at songTime t:
    { y, v, lid, lidV, onLid, held, armed, i, since, until, gap, abs, first, h, breath }
    y/v     marble height above the contact point (its centre when resting on the lid at its
            top stop) and its velocity
    lid     the lid's offset from its top stop (≤ 0) and lidV its velocity
    onLid   the marble is riding the lid (the note is speaking or the ram is lobbing)
    held    the marble is on the magnet (y = Hs, at rest)
    breath  0..1 — the air through the horn (the sound's envelope) */
export function hornAt(lane, t, start = -Infinity){
  const { L, n, plan, Hs, tf } = lane;
  const c = at(L, t, start);
  if (c.armed){                                       // count-in: held on the magnet, dropped tf before the first strike
    const u = c.until;
    if (u >= tf) return { y: Hs, v: 0, lid: 0, lidV: 0, onLid: false, held: true, armed: true, ...c, h: 0, breath: 0 };
    const s = tf - u;
    return { y: Hs - g * s * s / 2, v: -g * s, lid: 0, lidV: 0, onLid: false, held: false, armed: true, ...c, h: 0, breath: 0 };
  }
  const p = plan[c.i], s = c.since;
  const breath = breathAt(s, p.h);
  if (s < p.h){                                       // SPEAKING: the marble's weight drives the lid down
    const u = s / p.h, v1 = 4 * p.d / (3 * p.h), lid = -v1 * s * (1 - u * u * u / 4), lidV = -v1 * (1 - u * u * u);
    return { y: lid, v: lidV, lid, lidV, onLid: true, held: false, armed: false, ...c, h: p.h, breath };
  }
  const s1 = s - p.h;
  if (s1 < p.TS){                                     // the RAM snaps the lid back up, lobbing the marble
    const a = p.v0 * p.v0 / (2 * p.d || 1), lid = -p.d + a * s1 * s1 / 2;
    return { y: lid, v: a * s1, lid, lidV: a * s1, onLid: true, held: false, armed: false, ...c, h: p.h, breath };
  }
  const s2 = s1 - p.TS;
  if (!p.free){                                       // DENSE: one solved arc back onto the lid
    return { y: p.v0 * s2 - g * s2 * s2 / 2, v: p.v0 - g * s2, lid: 0, lidV: 0, onLid: false, held: false, armed: false, ...c, h: p.h, breath };
  }
  if (s2 < tf)                                        // FREE: up to the magnet, arriving at zero speed
    return { y: p.v0 * s2 - g * s2 * s2 / 2, v: p.v0 - g * s2, lid: 0, lidV: 0, onLid: false, held: false, armed: false, ...c, h: p.h, breath };
  const s3 = s2 - tf;
  if (s3 < p.dwell)                                   // held on the magnet
    return { y: Hs, v: 0, lid: 0, lidV: 0, onLid: false, held: true, armed: false, ...c, h: p.h, breath };
  const s4 = s3 - p.dwell;                            // released: the honest fall onto the next beat
  return { y: Hs - g * s4 * s4 / 2, v: -g * s4, lid: 0, lidV: 0, onLid: false, held: false, armed: false, ...c, h: p.h, breath };
}

/** The air through the horn s seconds after a strike whose note speaks for h: a tongued
    attack, a hold, an exhale release. Pure; drives the bell's light. */
export const ATTACK = .025, RELEASE = .09;
export function breathAt(s, h){
  if (!(s >= 0) || !isFinite(s)) return 0;
  const a = 1 - Math.exp(-s / ATTACK);
  if (s <= h) return a;
  return (1 - Math.exp(-h / ATTACK)) * Math.exp(-(s - h) / RELEASE);
}

/* ---- the part, made safe for the machine (imports: thin / clamp, never crash) ----
   · bad events (no beat / bad note) dropped; vel clamped to (0, 1]; dur ≥ 0
   · pitches outside [lo, hi] are octave-folded in; beyond `pitches` distinct pitches the
     rarest are folded onto a kept pitch of the same pitch class, else dropped
   · same-pitch repeats closer than MIN_GAP s are thinned (the louder survives)
   · beyond maxEvents the quietest are dropped
   Pure; returns a new part. beat = seconds per beat. */
const NOTE = /^([A-G]#?)(-?\d)$/;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const nameOf = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export function fitPart(part, { beat = .5, loopBeats = Infinity, limits = PART_LIMITS } = {}){
  let ev = [];
  for (const e of part || []){
    if (!Array.isArray(e) || !Number.isFinite(e[0]) || typeof e[1] !== 'string' || !NOTE.test(e[1])) continue;
    let m = noteNum(e[1]);
    while (m < limits.lo) m += 12;
    while (m > limits.hi) m -= 12;
    const vel = Number.isFinite(e[2]) ? Math.max(.05, Math.min(1, e[2])) : 1;
    const dur = Number.isFinite(e[3]) ? Math.max(0, e[3]) : 0;
    ev.push([e[0], m, vel, dur]);
  }
  // ≤ `pitches` horns: keep the most-played, fold the rest onto a kept same-pitch-class horn
  const count = new Map();
  for (const e of ev) count.set(e[1], (count.get(e[1]) || 0) + 1);
  const keep = new Set([...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limits.pitches).map(x => x[0]));
  ev = ev.flatMap(e => {
    if (keep.has(e[1])) return [e];
    let best = null;
    for (const k of keep) if ((k - e[1]) % 12 === 0 && (best === null || Math.abs(k - e[1]) < Math.abs(best - e[1]))) best = k;
    return best === null ? [] : [[e[0], best, e[2], e[3]]];
  });
  // same-pitch repeats (cyclically, across the loop seam too) at least MIN_GAP apart
  const minB = (limits.gap ?? MIN_GAP) / beat;
  const byP = new Map();
  for (const e of ev) (byP.get(e[1]) || byP.set(e[1], []).get(e[1])).push(e);
  ev = [];
  for (const list of byP.values()){
    list.sort((a, b) => a[0] - b[0] || b[2] - a[2]);
    const kept = [];
    for (const e of list){
      const last = kept[kept.length - 1];
      if (last && e[0] - last[0] < minB - 1e-9){ if (e[2] > last[2]) kept[kept.length - 1] = e; continue; }
      kept.push(e);
    }
    while (kept.length > 1 && isFinite(loopBeats) && kept[0][0] + loopBeats - kept[kept.length - 1][0] < minB - 1e-9) kept.pop();
    ev.push(...kept);
  }
  if (ev.length > limits.maxEvents){
    const order = ev.map((e, i) => [e[2], -i, i]).sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, limits.maxEvents).map(x => x[2]);
    const ok = new Set(order);
    ev = ev.filter((_, i) => ok.has(i));
  }
  return ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([b, m, v, d]) => [b, nameOf(m), v, d]);
}

/** Voice id for an event: the pitch, or 'stab:<pitch>' for a STAB (its own short, accented
    render — the iOS sample path can't release a long one early). The id ENDS in the note, so
    audio.js's spatial voiceHz still reads its pitch. */
export const STAB_ID = 'stab:';
export const voiceIdOf = (note, durBeats) => isStab(durBeats) ? STAB_ID + note : note;
