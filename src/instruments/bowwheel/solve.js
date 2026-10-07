/* ============================================================
   BOW WHEEL — pure timing/physics (no THREE scene, no DOM, no audio).

   A HURDY-GURDY built for marbles. One big rosined WHEEL turns at a
   constant ω about an axle that runs front→back (local +z); every string
   runs PARALLEL to that axle, fanned across the top of the rim like a
   violin's curved bridge, resting a hair (GAP) above it. The rim's
   surface moves across each string (perpendicular to it) — a bow that
   never runs out. A string sounds exactly while it is PRESSED onto the
   rim, and only then: contact = sound.

   THE PRESS (the visible cause). Over each string, right above the rim,
   stands a TANGENT: a vertical rod whose felt shoe rests on the string,
   with a cup on top, held up by a light spring. Each string owns ONE
   conserved marble. A note:
     land   the marble drops into the cup (cup at rest — honest contact);
     press  its weight sinks the damped rod by D (smoothstep, T_PRESS),
            pushing the string straight down until it touches the rim —
            exactly ON THE BEAT, arriving at rest (honest contact);
     hold   the marble sits; the wheel bows the string for the note's
            whole duration (vibrato shimmers on the string);
     kick   at note-off the rod's solenoid fires: the rod springs back up
            (the string lifts off the rim — the sound stops) and the
            marble is LOBBED. Lossy: the landing's speed is absorbed in
            the dashpot; the coil supplies every launch (a visible flash).
   The flight from one note-off to the next landing is a solved vertical
   arc (solveLaunch's grammar: apex height ∝ gap²):
     hop     gap ≤ F_MAX: a free arc straight back into the cup (a re-bow);
     magnet  longer: the kick sends it EXACTLY to the electromagnet above
             (v = 0 at the face), it is held, and released so the free fall
             lands in the cup T_PRESS before the next note.
   Lanes never interact (one string, one rod, one marble, one magnet —
   spaced so nothing overlaps); polyphony is free. Wheel angle = ω·t.
   Everything is a closed-form function of songTime.
   ============================================================ */
import { G, noteNum } from '../../engine.js';
import { laneClock, at, firstAt, lastIndex, wrapP } from '../clock.js';

export const g = -G.y;                                   // |gravity| = 14.5
const TAU = Math.PI * 2;

// ---- the wheel (local frame: axle along z at x = 0) ----
export const WHEEL_R = 4.0;          // rim radius
export const WHEEL_Y = 4.3;          // axle height above the deck (the rim's bottom clears the deck by .3)
export const WHEEL_Z = 0;            // the rim's mid-plane (strings cross it here)
export const RIM_W   = .6;           // rim width along the axle
export const OMEGA   = 1.15;         // rad/s, constant (rim speed ≈ 4.6 u/s)
export const wheelAngle = t => OMEGA * t;

// ---- strings & tangents ----
export const GAP      = .1;          // string → rim clearance at rest (vertical, at the contact line)
export const SPACING  = .38;         // string pitch across x (lanes never interact: see LANE_HW)
export const MAX_STRINGS = 12;       // ±2.09 across → ≤ 31.5° round the rim: a vertical press still meets it squarely
export const BALL_R   = .13;         // marble radius
export const CUP_R    = .16;         // cup outer radius
export const LANE_HW  = Math.max(BALL_R, CUP_R, .17);   // a lane's widest moving part (cup / coil) half-width
export const CUP_Y    = 10.0;        // marble-centre height when seated at rest (same for every lane)
export const MAG_H    = 2.3;         // magnet face height above the seated marble's centre
export const MAG_Y    = CUP_Y + MAG_H;                   // marble centre while held by the magnet

// ---- choreography (seconds) ----
export const T_PRESS  = .12;         // landing → string meets the rim (the weight sinks the rod)
export const T_UP     = .12;         // the rod's spring-back after the kick
export const F_MIN    = .2;          // shortest flight (a re-bow hop) — the cup is back at rest by T_UP
export const HOLD_MIN = .08;         // shortest bow stroke
export const HOLD_MAX = 3.9;         // longest bow stroke (the voice sustains this long; visual never outlives sound)
export const DEF_HOLD = .45;
export const PARK_MIN = .06;        // a forced magnet park holds at least this long (it reads as a catch)         // a note with no duration gets a short bow stroke
export const MIN_REPEAT = HOLD_MIN + T_PRESS + F_MIN;    // same-string onsets closer than this MERGE (one long stroke)

// ---- what the machine can honestly take (the orchestrator routes on this) ----
export const LO = 36, HI = 96;       // C2 … C7 (outside: folded by octaves into range)
export const MAX_EVENTS = 600;       // per loop, after merging (beyond: the quietest are thinned)
export const PART_LIMITS = Object.freeze({
  key: 'bowwheel',
  lo: LO, hi: HI,                    // MIDI range played (others octave-folded)
  pitches: MAX_STRINGS,              // distinct pitches (strings) per song — extras are dropped (least-used first)
  poly: MAX_STRINGS,                 // simultaneous notes (every string can bow at once); musically ≤ ~4–6
  gap: +MIN_REPEAT.toFixed(3),       // min onset gap on ONE pitch (s) — closer repeats merge into one stroke
  minDur: HOLD_MIN, maxDur: HOLD_MAX,// held duration clamp (s)
  sustain: true,                     // reads durBeats: the string is bowed for exactly the note
  maxEvents: MAX_EVENTS,
  programs: [40, 41, 42, 43, 44, 48, 49, 50, 51],   // violin…contrabass, tremolo, string ensembles 1/2, synth strings 1/2
});

const sm  = x => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const smd = x => (x <= 0 || x >= 1) ? 0 : 6 * x * (1 - x);

/* ---- a string's geometry: a PURE FUNCTION OF THE NOTE ----
   Vibrating length ∝ f^−½ (a real string bank would be ∝ 1/f — 32× over this range;
   the square root keeps the bass string on the stage), thickness likewise. */
export function stringLen(note){ return 7.2 * Math.pow(2, -(noteNum(note) - LO) / 24); }   // C2 7.2 · C4 3.6 · C6 1.8
export function stringR(note){ return .018 + .03 * Math.pow(2, -(noteNum(note) - LO) / 24); }

/* ---- lane layout: pitch order across x (low → high), centred. Spacing is fixed;
   only the string's own size depends on its note. ---- */
export function laneX(i, n){ return (i - (n - 1) / 2) * SPACING; }

/* The vertical geometry of one lane at x: the rim top under the string, the string's rest
   height, the press depth D (string pushed straight down until it touches the rim). */
export function laneGeom(note, x){
  const rs = stringR(note);
  const rimTop = WHEEL_Y + Math.sqrt(WHEEL_R * WHEEL_R - x * x);
  const yRest = rimTop + GAP + rs;                       // string centre at rest
  const yPress = WHEEL_Y + Math.sqrt((WHEEL_R + rs) ** 2 - x * x);   // string centre touching the rim
  const D = yRest - yPress;                              // rod travel = string deflection at the rim
  const yLow = CUP_Y - D;                                // seated marble centre while pressed
  const Tr = Math.sqrt(2 * (MAG_Y - yLow) / g);          // kick → magnet (arrive at rest)
  const Tf = Math.sqrt(2 * (MAG_Y - CUP_Y) / g);         // magnet release → cup
  const phi = Math.asin(x / (WHEEL_R + rs));             // contact angle from the rim's top
  return { note, x, rs, rimTop, yRest, yPress, D, yLow, Tr, Tf, F_MAX: Tr + Tf, phi, len: stringLen(note) };
}

/* ---- PART PREP (pure): fold, thin, clamp — never throw. Imported parts can be anything. ----
   Returns { events: [[beat, note, vel, durBeats]…], dropped: {range, pitches, events, bad} }. */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nameOf = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
export function prepPart(part){
  const dropped = { range: 0, pitches: 0, events: 0, bad: 0 };
  const ev = [];
  for (const e of part || []){
    if (!Array.isArray(e) || !isFinite(e[0]) || typeof e[1] !== 'string' || !/^[A-G]#?\d$/.test(e[1])){ dropped.bad++; continue; }
    let n = noteNum(e[1]);
    if (n < LO || n > HI){ dropped.range++; while (n < LO) n += 12; while (n > HI) n -= 12; }
    const vel = isFinite(e[2]) ? Math.min(1, Math.max(.05, e[2])) : 1;
    const dur = isFinite(e[3]) && e[3] > 0 ? e[3] : 0;
    ev.push([+e[0], nameOf(n), vel, dur]);
  }
  // too many strings: keep the pitches that carry the most music (count × held length)
  const w = new Map();
  for (const e of ev) w.set(e[1], (w.get(e[1]) || 0) + 1 + e[3]);
  let out = ev;
  if (w.size > MAX_STRINGS){
    const keep = new Set([...w.entries()].sort((a, b) => b[1] - a[1] || noteNum(a[0]) - noteNum(b[0])).slice(0, MAX_STRINGS).map(x => x[0]));
    out = ev.filter(e => keep.has(e[1]));
    dropped.pitches = w.size - MAX_STRINGS;
  }
  if (out.length > MAX_EVENTS){
    const keep = new Set(out.map((e, i) => [e[2], -i, i]).sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, MAX_EVENTS).map(x => x[2]));
    dropped.events = out.length - MAX_EVENTS;
    out = out.filter((e, i) => keep.has(i));
  }
  return { events: out.sort((a, b) => a[0] - b[0]), dropped };
}

/* ---- one lane: a string's notes → bow STROKES → the marble's CYCLES ----
   notes: [{t, tDur, vel}] loop-local seconds. Each cycle k runs from the previous
   stroke's note-off c (the kick) through flight → landing → press → hold → its own
   note-off. Cyclic over the loop period P. */
export function bowLane(notes, P, geom){
  const pre = T_PRESS + F_MIN;
  // strokes: wrapped onsets, held length clamped; same-string repeats too close merge
  let st = notes.map(n => ({ on: +wrapP(n.t, P).toFixed(9), hold: Math.min(HOLD_MAX, Math.max(HOLD_MIN, n.tDur > 0 ? n.tDur : DEF_HOLD)), vel: n.vel ?? 1, merged: 0 }))
    .sort((a, b) => a.on - b.on);
  const merged = [];
  for (const s of st){
    const last = merged[merged.length - 1];
    if (last && s.on - last.on < MIN_REPEAT){
      last.hold = Math.min(HOLD_MAX, Math.max(last.hold, s.on - last.on + s.hold)); last.vel = Math.max(last.vel, s.vel); last.merged++;
    } else merged.push({ ...s });
  }
  st = merged;
  while (st.length > 1 && st[0].on + P - st[st.length - 1].on < MIN_REPEAT){   // across the loop seam
    const a = st.pop(), b = st[0];
    a.hold = Math.min(HOLD_MAX, Math.max(a.hold, b.on + P - a.on + b.hold)); a.vel = Math.max(a.vel, b.vel); a.merged += 1 + b.merged;
    st[0] = a; a.on = +wrapP(a.on, P).toFixed(9);      // (the merged stroke keeps the earlier onset)
    st.sort((x, y) => x.on - y.on);
  }
  // every stroke ends early enough for the marble to make the next landing
  const fit = () => {
    const n = st.length;
    st.forEach((s, k) => {
      const nx = (k + 1 < n ? st[k + 1].on : st[0].on + P);
      s.off = s.on + Math.max(HOLD_MIN, Math.min(s.hold, nx - pre - s.on));
    });
  };
  fit();
  // …and at least ONE flight per loop parks at the magnet (that's where the count-in waits):
  // the longest gap is stretched by shortening the stroke before it; if even that can't
  // reach F_MAX, the note after it is dropped (thinned) and we try again.
  for (;;){
    const n = st.length;
    let best = -1, bestF = -Infinity;
    st.forEach((s, k) => { const nx = (k + 1 < n ? st[k + 1].on : st[0].on + P); const F = nx - T_PRESS - s.off; if (F > bestF){ bestF = F; best = k; } });
    if (bestF > geom.F_MAX + 1e-9) break;
    const s = st[best], nx = (best + 1 < n ? st[best + 1].on : st[0].on + P);
    const off = nx - T_PRESS - geom.F_MAX - PARK_MIN;
    if (off - s.on >= HOLD_MIN){ s.off = off; break; }
    if (n === 1){ s.off = s.on + HOLD_MIN; break; }       // (P too short for this machine: degenerate, still continuous)
    st.splice((best + 1) % n, 1); fit();
  }
  // cycles
  const n = st.length;
  const cyc = st.map((s, k) => {
    const pv = st[(k - 1 + n) % n];
    const c = k ? pv.off : pv.off - P;                   // the kick that starts this cycle (may be < 0: wraps)
    const land = s.on - T_PRESS, F = land - c;
    const mag = F > geom.F_MAX + 1e-9;
    const D = geom.D;
    const v0 = mag ? g * geom.Tr : (D + .5 * g * F * F) / F;   // launch speed (up)
    return { k, c: +wrapP(c, P).toFixed(9), on: s.on, off: s.off, hold: s.off - s.on, vel: s.vel, merged: s.merged,
             F, mag, v0, W: s.off - c, rel: mag ? F - geom.Tf : NaN };
  }).sort((a, b) => a.c - b.c);
  const cs = cyc.map(q => q.c);
  const Lon = laneClock(cyc.map(q => q.on), P);
  const onIdx = Lon.s.map(s => cyc.find(q => Math.abs(q.on - s) < 1e-6));
  const Lrel = laneClock(cyc.filter(q => q.mag).map(q => q.c + q.rel), P);
  return { geom, P, cyc, cs, Lon, onIdx, Lrel, strokes: st };
}

/* The first moment the lane goes live after `start`: the first magnet release. Until then
   the marble hangs ARMED on its magnet, the rod up, the string quiet. */
export const liveFrom = (L, start) => firstAt(L.Lrel, start);

/* ---- the lane at songTime t ----
   { s (rod/string travel 0..D), sv (its speed, +down), y (marble centre), vy, phase
     ('armed'|'mag'|'fall'|'hop'|'rise'|'press'|'hold'), held (marble on the magnet),
     onCup, contact (string on the rim), cyc } */
export function laneAt(L, t, start = -Infinity){
  const { geom, cyc, cs, P } = L;
  if (t < start) t = start;
  const live = liveFrom(L, start);
  if (!cyc.length || t < live) return { s: 0, sv: 0, y: MAG_Y, vy: 0, phase: 'armed', held: true, onCup: false, contact: false, cyc: null };
  const tau = wrapP(t, P);
  const k = lastIndex(cs, tau);
  const q = cyc[k];
  const u = wrapP(tau - q.c, P);
  return cycleAt(q, u, geom);
}

export function cycleAt(q, u, geom){
  const { D, yLow, Tr, Tf } = geom;
  const F = q.F;
  if (u < F){                                            // in the air (the rod springs back meanwhile)
    const s = u < T_UP ? D * (1 - sm(u / T_UP)) : 0;
    const sv = u < T_UP ? -D * smd(u / T_UP) / T_UP : 0;
    if (!q.mag) return { s, sv, y: yLow + q.v0 * u - .5 * g * u * u, vy: q.v0 - g * u, phase: 'hop', held: false, onCup: false, contact: false, cyc: q };
    if (u < Tr) return { s, sv, y: yLow + q.v0 * u - .5 * g * u * u, vy: q.v0 - g * u, phase: 'rise', held: false, onCup: false, contact: false, cyc: q };
    const r = F - Tf;
    if (u < r) return { s, sv, y: MAG_Y, vy: 0, phase: 'mag', held: true, onCup: false, contact: false, cyc: q };
    const w = u - r;
    return { s, sv, y: MAG_Y - .5 * g * w * w, vy: -g * w, phase: 'fall', held: false, onCup: false, contact: false, cyc: q };
  }
  const a = u - F;
  if (a < T_PRESS){                                      // seated: the weight sinks the rod
    const s = D * sm(a / T_PRESS), sv = D * smd(a / T_PRESS) / T_PRESS;
    return { s, sv, y: CUP_Y - s, vy: -sv, phase: 'press', held: false, onCup: true, contact: false, cyc: q };
  }
  return { s: D, sv: 0, y: yLow, vy: 0, phase: 'hold', held: false, onCup: true, contact: true, cyc: q };
}

/* ---- the strokes (strike = the string touches the rim) ----
   { live, abs, since, cyc } — live only once the lane is live (count-in: armed). */
export function strokeAt(L, t, start = -Infinity){
  const c = at(L.Lon, t, start);
  if (c.armed) return { live: false, since: Infinity, abs: -Infinity, cyc: null };
  const q = L.onIdx[c.i];
  return { live: c.abs >= liveFrom(L, start) - 1e-9, since: c.since, abs: c.abs, cyc: q };
}

/* The bowed string's visible vibration (0..1 × vel): it exists only while the string is on
   the rim — a fast bite, a slight bloom, delayed vibrato (5.5 Hz, matching the voice). */
export const VIB_HZ = 5.5, VIB_ONSET = .25;
export function bowEnv(since, hold){
  if (!(since >= 0) || since > hold) return 0;
  const att = sm(since / .09), bloom = .85 + .15 * sm(since / 1.2);
  const vib = 1 + .22 * sm((since - VIB_ONSET) / .5) * Math.sin(TAU * VIB_HZ * since);
  return att * bloom * vib;
}

/* Clearance helpers for the honesty tests (≥ 0 = no penetration). */
export function clearances(L, st){
  const { geom } = L;
  const cupSeat = CUP_Y - st.s;                          // where a seated marble's centre would be
  return {
    cup: st.y - cupSeat,                                 // marble never inside its cup
    magnet: MAG_Y - st.y,                                // never through the magnet face
    rim: Math.hypot(geom.x, geom.yRest - st.s - WHEEL_Y) - (WHEEL_R + geom.rs),   // string never inside the wheel
  };
}
