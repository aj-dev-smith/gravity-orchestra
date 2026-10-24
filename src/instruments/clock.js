/* ============================================================
   INSTRUMENT CLOCK — the time bookkeeping every instrument repeats,
   extracted once (the drum machine's lesson: lastStrike / since /
   until / firstStrike / armed count-in / fired-dedupe edges were
   re-derived inline; every new instrument would copy them again).

   PURE: no THREE scene, no DOM, no audio. Unit-tested in
   test/instruments.test.js. Time is the only state — every query is
   a function of songTime; the only mutable thing is the edge
   detector's "last fired" stamp, which exists purely so a strike
   fires ONCE (and skipStrikes can swallow a scrub jump).

   Timeline facts (same as the drums):
     · a beat b strikes at absolute loop time  rollT + b·beat
     · the loop period is P = ROLL_T + LOOP_T
     · songTime starts at −LEAD_IN (the count-in); `start` = ARM_AT
       (transport.js, −.6 s — in the loop's strike-free breath tail): a
       strike before `start` never happened (no sound, no envelope), so
       every machine sits ARMED through the count-in
   ============================================================ */

export const wrapP = (t, P) => ((t % P) + P) % P;

/* ---- part data → events ------------------------------------------------
   Song data for a new instrument lives at song.parts[<key>] as a list of
   ABSOLUTE-beat events (like drums: pinned, never chained → no lock rule):
       [beat, note]                 a hit at full velocity
       [beat, note, vel]            vel 0..1 (dynamics, NOT impact geometry)
       [beat, note, vel, durBeats]  sustained instruments read the duration
   A note is a pitch name ('C4', sharps only) or, for unpitched lanes, any
   lane name the instrument understands. Hand-authored beats ∈ [0, loopBeats). */
export function normalizeEvent(e){
  if (!Array.isArray(e)) throw new Error(`instrument event must be an array, got ${JSON.stringify(e)}`);
  const [beat, note, vel = 1, dur = 0] = e;
  return { beat, note, vel, dur };
}

/** Events → [{beat, note, vel, dur, t, tDur}] sorted by time. t = loop-local strike
    time (s, rollT + beat·beat), tDur = duration in seconds. */
export function eventTimes(part, { rollT, beat }){
  return (part || []).map(normalizeEvent)
    .map(ev => ({ ...ev, t: rollT + ev.beat * beat, tDur: ev.dur * beat }))
    .sort((a, b) => a.t - b.t);
}

/** Group events by note → { note: [events…] } (one lane per pitch, the dribble lesson:
    a lane that owns its own ball/striker never interacts with any other lane). */
export function lanesByNote(events){
  const out = {};
  for (const ev of events) (out[ev.note] ||= []).push(ev);
  return out;
}

/* ---- the LANE CLOCK ------------------------------------------------------
   A lane = a sorted set of strike times within one loop. laneClock(times, P)
   wraps (pickups may be negative) + dedups; at(L, t, start) answers "where are
   we in this lane's cycle at songTime t":
     { i, since, until, gap, armed, first, abs }
       i      index of the strike we most recently LEFT (−1 while armed)
       since  seconds since that strike (Infinity while armed)
       until  seconds to the next strike
       gap    the cyclic gap from strike i to strike i+1
       armed  true before the lane's first strike after `start` (count-in):
              nothing has struck yet — render the loaded/waiting pose
       first  absolute time of the first strike at/after `start`
       abs    absolute songTime of strike i (for edge dedupe) */
export function laneClock(times, P){
  const s = [...new Set(times.map(t => +wrapP(t, P).toFixed(9)))].sort((a, b) => a - b);
  const gaps = s.map((si, i) => (i + 1 < s.length ? s[i + 1] : s[0] + P) - si);
  return { s, gaps, P };
}

/** Index of the strike most recently at/before wrapped time tau (binary search). */
export function lastIndex(s, tau){
  let lo = 0, hi = s.length - 1;
  if (tau < s[0]) return hi;                             // before the first → the last one (previous loop)
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (s[m] <= tau) lo = m; else hi = m - 1; }
  return lo;
}

/** Absolute time of the lane's first strike at/after `start` (memoized on L). */
export function firstAt(L, start){
  if (!isFinite(start) || !L.s.length) return -Infinity;
  if (L._fsStart === start) return L._fs;
  let first = Infinity;
  for (const si of L.s){ const a = si + Math.ceil((start - si) / L.P) * L.P; if (a < first) first = a; }
  L._fsStart = start; L._fs = first;
  return first;
}

export function at(L, t, start = -Infinity){
  const { s, gaps, P } = L;
  if (!s.length) return { i: -1, since: Infinity, until: Infinity, gap: Infinity, armed: true, first: Infinity, abs: -Infinity };
  if (t < start) t = start;
  const first = firstAt(L, start);
  if (t < first){
    const j = s.indexOf(+wrapP(first, P).toFixed(9));
    return { i: -1, since: Infinity, until: first - t, gap: Infinity, armed: true, first, abs: -Infinity, next: j < 0 ? 0 : j };
  }
  const tau = wrapP(t, P);
  const i = lastIndex(s, tau);
  const since = wrapP(tau - s[i], P), gap = gaps[i];
  return { i, since, until: gap - since, gap, armed: false, first, abs: t - since, next: (i + 1) % s.length };
}

/** Absolute songTime of the NEXT occurrence of loop-local time `s` at or after t. */
export function nextAbs(s, t, P){ return s + Math.ceil((t - s - 1e-9) / P) * P; }

/* ---- the STRIKE EDGE -----------------------------------------------------
   Fires once per strike: call check(abs, since) each frame with the clock's
   abs/since for the strike just left. Returns true exactly once per strike if
   we're within `window` seconds of it (a slow frame can't skip one) and not
   suppressed (skip = a scrub jump or the first frame: record, don't fire). */
export function makeEdge(window = .25){
  let fired = -Infinity, seen = -Infinity;
  return {
    check(abs, since, skip = false){
      // time went BACKWARDS (a scrub, a rebuild, or main's merge sweep posing the whole loop
      // with skip on): what fired "later" hasn't happened yet — forget it, or the first loop
      // after the jump plays silent until it passes that point again. Judged on the STRIKE
      // (abs) and on the CLOCK (abs + since = the songTime of the call): a sweep pose that
      // last looked just after a lane's FIRST strike leaves fired === that very strike, so
      // playback arriving at it from the count-in saw "already fired" and the first loop
      // lost it (a lane with one strike per loop, inside .25 s before one of the 48 poses)
      const now = abs + since;
      if (abs < fired - 1e-6 || now < seen - 1e-6) fired = -Infinity;
      if (Number.isFinite(now)) seen = now;
      if (!(since <= window) || !(abs > fired + 1e-6)) return false;
      fired = abs;
      return !skip;
    },
    reset(){ fired = -Infinity; seen = -Infinity; },
  };
}

/* ---- tiny shared curves (all pure fns of time-since-event) ---- */
/** A struck-object ring-down: 0 at s=0 rising instantly, decaying — for flashes/wobbles. */
export const ring = (s, decay = 6) => (s < 0 || !isFinite(s)) ? 0 : Math.exp(-s * decay);
/** Smoothstep 0→1 over [a,b]. */
export const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
