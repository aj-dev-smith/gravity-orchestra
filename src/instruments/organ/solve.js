/* ============================================================
   LIGHT ORGAN — pure timing/physics (no THREE scene, no DOM, no audio).

   The SUSTAINED voice home: organ / choir / pad chords. A façade of chrome
   flue pipes, one per pitch (a lane). Each pipe is fed by its OWN little
   BELLOWS standing in front of its foot, and owns ONE conserved marble —
   the bellows' weight. Lanes never interact (each marble only ever moves
   straight up and down over its own bellows), so polyphony is free.

   A NOTE IS A BELLOWS STROKE. The marble's weight on the bellows lid
   pushes the wind out through the pipe: the pipe speaks exactly while the
   lid SINKS, and the lid sinks at the constant rate s/dur, so the stroke
   ends exactly at note-off. Duration is a visible distance travelled —
   a long note is a slow, deep breath; a staccato chord, a quick nod.
   (And the wind leaving the mouth is drawn as a packet of light that runs
   up the pipe and out of its top at SPEED: its LENGTH is the duration.)

   BETWEEN NOTES the empty-of-weight bellows refills on its spring — the
   visible energy source — and what the marble does depends on the gap Δ
   from note-off to the next note-on (solved per gap, up front):
     · RIDE  (Δ < hopMin)  the lid refills under the marble, carrying it
             back up, at rest at the top exactly at the next note-on.
             (legato re-press: an organist's fast repeated note)
     · HOP   (Δ ≤ Δ*)      the bellows' spring is unlatched: the lid snaps
             UP at v0 and KICKS the marble off on a solved ballistic arc
             v0 = (s + ½gΔ²)/Δ that lands it back on the (refilled, at-rest)
             lid exactly at the next note-on. The lid itself is braked at a
             constant a = v0²/2s, so it comes to rest exactly at the top
             (after 2s/v0). Since v0 ≥ √(2gs) (AM-GM), a ≥ g: lid and marble
             leave together at v0 and the lid falls behind at once — it can
             never touch the arc again (same start, same speed, harder
             deceleration).
     · PARK  (Δ > Δ*)      the kick throws it up to its ELECTROMAGNET at
             H_MAG, arriving at zero speed; held; released T_DOWN before
             the note so the free fall lands on the beat. Δ* = tUp + T_DOWN
             is exactly the hop whose apex kisses the magnet, so the two
             modes meet continuously and a hop can never strike the magnet.
   Landing is a real, lossy (inelastic) catch: the bellows' air cushion
   absorbs the fall; the lid is AT REST at the top at every landing.

   Count-in: every marble hangs ARMED on its magnet (a row of lit marbles),
   and the first note of every lane arrives by the drop.

   Everything is a closed-form function of songTime. Time is the only state.
   ============================================================ */
import { G, noteNum } from '../../engine.js';
import { laneClock, at, wrapP, normalizeEvent } from '../clock.js';
import { bucketId, planLadder, LADDER, LADDERS, BUCKET_CAP } from '../sustain.js';

export const g = -G.y;                         // |gravity| = 14.5

// ---- the lane machine (all lanes identical: geometry here is NOT a function of pitch) ----
export const RB      = .1;                     // marble radius
export const S_MAX   = .3;                     // full bellows stroke (a long note)
export const H_MAG   = 1.1;                    // park height: marble BOTTOM above the lid's rest top
export const HOP_MIN = .2;                     // shortest gap that can be a kicked hop (else RIDE)
export const T_DOWN  = Math.sqrt(2 * H_MAG / g);           // magnet → lid free fall (≈ .39 s)
export const tUp     = s => Math.sqrt(2 * (H_MAG + s) / g);   // lid bottom → magnet (v = 0 at the face)
/* stroke depth: long notes breathe the full stroke, short ones a shallower nod (a pure fn of
   the note's duration — it's motion, never geometry) */
export const sinkDepth = dur => S_MAX * Math.min(1, Math.max(.3, dur / .6));

// ---- the score limits (an imported part is FITTED to these — fitPart — never crashes) ----
export const DUR_MIN = .06;                    // shortest stroke (s)
export const GAP_MIN = .06;                    // shortest refill between two notes on one pipe (s)
export const IOI_MIN = DUR_MIN + GAP_MIN;      // fastest same-pitch retrigger (.12 s)
export const MAX_DUR = 8;                      // longest held note (s) — the voice re-sources past CONT_AT
export const DEFAULT_BEATS = 1;                // an event with no duration holds one beat

// ---- the light: wind leaves the mouth as a packet travelling up the pipe and into the sky ----
export const SPEED = 7;                        // u/s
export const PACKETS = 3;                      // packets drawn per pipe (the current note + 2 still rising)

// ---- the voice tiers (voice.js renders them; see index.js voiceIds) ----
export const SHORT_MAX = 1.0;                  // a note this short plays the SHORT render (iOS rings ~1.4 s, not 5)
export const CONT_AT   = 4.2;                  // a note longer than CONT_AT + .1 is re-sourced here (seamless)
export const XFADE     = 0;                    // the first voice starts releasing (τ .12) as the continuation fades in
                                               // (equal-power .12 s): ~flat. A later release stacked both at full
                                               // gain (+3 dB, up to +6 dB where they happen to be in phase)

export const TIMBRES = ['organ', 'choir', 'pad'];
const ALIAS = { organ: 'organ', pipe: 'organ', principal: 'organ', choir: 'choir', vox: 'choir', voice: 'choir',
  aah: 'choir', pad: 'pad', strings: 'pad', synth: 'pad', ensemble: 'pad' };

/** The constraints an imported part must meet (src/midi/orchestra.js PART_SPEC shape). Pure data.
    poly is honest-free (one lane per pitch); 12 keeps the mix sane. gap = fastest same-pitch
    ONSET spacing; ioi = part-wide (none). Durations in seconds. */
export const PART_LIMITS = Object.freeze({
  lo: 36, hi: 84, center: 60,                  // C2 … C6
  pitches: 36,                                 // lanes (pipes) — the façade fits 36 at any mix of pitches
  poly: 12,                                    // notes per onset
  gap: IOI_MIN, ioi: 0,
  sustain: true, minDur: DUR_MIN, maxDur: MAX_DUR,
  maxEvents: 768,                              // per loop (cost is O(lanes) per frame; this caps bake + build)
  voices: 3,                                   // source voices the orchestrator may merge onto it
  timbres: TIMBRES,                            // event id suffix: 'C4|choir'
});

/* ---- ids: '<pitch>[|<timbre>]' (the part's note field) ---- */
const ID_RE = /^([A-G]#?)(-?\d)(?:\|([a-z]+))?$/i;
export function parseId(id){
  const m = ID_RE.exec(String(id ?? '').trim());
  if (!m) return null;
  const pitch = m[1].toUpperCase() + m[2];
  const timbre = (m[3] && ALIAS[m[3].toLowerCase()]) || 'organ';   // an unknown suffix degrades to the organ (never drops the note)
  return { pitch, timbre, base: timbre === 'organ' ? pitch : `${pitch}|${timbre}` };
}
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/* ---- geometry: a PURE FUNCTION OF THE NOTE (lower = taller and wider) ----
   Real flue pipes: speaking length ∝ 1/f; drawn ∝ f^−.55 (a 4-octave rank would be 16× tall
   otherwise) — C2 6.2 · C4 2.9 · C6 1.35. Pipe-local: y = 0 on the windchest, axis x = z = 0. */
export function pipeGeom(note){
  const n = noteNum(note), k = (n - 36) / 12;
  const r = .26 * Math.pow(2, -.3 * k);
  const body = 6.2 * Math.pow(2, -.55 * k);
  const foot = .5 + 1.2 * r;                   // the conical foot, up to the mouth
  return { note, n, r, body, foot, mouthY: foot, top: foot + body, mouthW: 1.25 * r, mouthH: .42 * r + .05 };
}
export const PIPE_GAP = .1;                    // clear air between neighbouring pipes
export const BELLOWS_R = .13;                  // every bellows (and its lid) — narrower than the narrowest pitch spacing

/** The façade: lowest pipe in the CENTRE, then outward alternately right / left (the organ
    builder's C-side / C#-side split): an arpeggio ripples out from the middle. Pipes are spaced
    apart, NEVER shrunk. notes: pitch names. Returns [{note, x, G}] in input order. */
export function layoutPipes(notes){
  const sorted = [...new Set(notes)].sort((a, b) => noteNum(a) - noteNum(b));
  const G = Object.fromEntries(sorted.map(n => [n, pipeGeom(n)]));
  const pos = {};
  let right = null, left = null;
  sorted.forEach((n, i) => {
    const r = G[n].r;
    if (i === 0){ pos[n] = 0; right = { x: 0, r }; left = { x: 0, r }; return; }
    if (i % 2){ pos[n] = right.x + right.r + PIPE_GAP + r; right = { x: pos[n], r }; }
    else { pos[n] = left.x - left.r - PIPE_GAP - r; left = { x: pos[n], r }; }
  });
  const lo = left ? left.x - left.r : 0, hi = right ? right.x + right.r : 0, mid = (lo + hi) / 2;
  return { pipes: notes.map(n => ({ note: n, x: pos[n] - mid, G: G[n] })), span: hi - lo };
}

/* ---- FIT a part to the machine (imports can be anything): pure, never throws ----
   part: [[beat, id, vel?, durBeats?], …]. Returns { events, report } — events are
   {t (loop-local, wrapped), tDur (s), vel, pitch, timbre, base} sorted by t; report counts
   what was folded / dropped / clipped. Steps: parse → fold into C2–C6 → cap the pitch count
   (keep every pitch class first) → seconds + clamp durations → ≤ poly per onset (outer voices
   first) → ≤ maxEvents (loudest kept) → per pipe: dedupe, thin retriggers < IOI_MIN (seam
   too), clip each stroke to leave GAP_MIN before the next. */
export function fitPart(part, { rollT, beat, P }, L = PART_LIMITS){
  const report = { bad: 0, folded: 0, foldedPitch: 0, droppedPitch: 0, thinnedChord: 0, droppedMax: 0, thinned: 0, clipped: 0 };
  let ev = [];
  for (const e of (Array.isArray(part) ? part : [])){
    let n;
    try { n = normalizeEvent(e); } catch(err){ report.bad++; continue; }
    const id = parseId(n.note);
    if (!id || !Number.isFinite(n.beat)){ report.bad++; continue; }
    const pc = NAMES.indexOf(id.pitch.replace(/-?\d$/, ''));
    if (pc < 0){ report.bad++; continue; }                // (E#, B# … are not names here: sharps of black keys only)
    let m = pc + 12 * (+id.pitch.match(/-?\d$/)[0] + 1);
    while (m < L.lo){ m += 12; report.folded++; }
    while (m > L.hi){ m -= 12; report.folded++; }
    const vel = Number.isFinite(n.vel) && n.vel > 0 ? Math.min(1, n.vel) : 1;
    const db = Number.isFinite(n.dur) && n.dur > 0 ? n.dur : DEFAULT_BEATS;
    ev.push({ beat: n.beat, m, timbre: id.timbre, vel, tDur: Math.min(MAX_DUR, Math.max(DUR_MIN, db * beat)) });
  }
  // the pitch cap: every pitch class first (its most-used octave), then by use; others fold onto
  // a kept pitch of their class, or drop
  const use = new Map();
  for (const e of ev) use.set(e.m, (use.get(e.m) || 0) + 1);
  if (use.size > L.pitches){
    const near = (a, b) => (use.get(b) - use.get(a)) || (Math.abs(a - L.center) - Math.abs(b - L.center)) || a - b;
    const pcw = new Map();
    for (const [m, c] of use) pcw.set(m % 12, (pcw.get(m % 12) || 0) + c);
    const kept = new Set();
    for (const pc of [...pcw.keys()].sort((a, b) => pcw.get(b) - pcw.get(a) || a - b)){
      if (kept.size >= L.pitches) break;
      kept.add([...use.keys()].filter(m => m % 12 === pc).sort(near)[0]);
    }
    for (const m of [...use.keys()].sort(near)){ if (kept.size >= L.pitches) break; kept.add(m); }
    ev = ev.flatMap(e => {
      if (kept.has(e.m)) return [e];
      const twin = [...kept].filter(k => (k - e.m) % 12 === 0).sort((a, b) => Math.abs(a - e.m) - Math.abs(b - e.m))[0];
      if (twin === undefined){ report.droppedPitch++; return []; }
      report.foldedPitch++; return [{ ...e, m: twin }];
    });
  }
  // ≤ poly per onset: lowest + highest, then the loudest inner voices
  const byBeat = new Map();
  for (const e of ev){ const k = +e.beat.toFixed(6); (byBeat.get(k) || byBeat.set(k, []).get(k)).push(e); }
  ev = [];
  for (const grp of byBeat.values()){
    grp.sort((a, b) => a.m - b.m);
    if (grp.length > L.poly){
      const inner = grp.slice(1, -1).sort((a, b) => b.vel - a.vel).slice(0, L.poly - 2);
      report.thinnedChord += grp.length - 2 - inner.length;
      ev.push(grp[0], ...inner, grp[grp.length - 1]);
    } else ev.push(...grp);
  }
  // ≤ maxEvents: the loudest survive (ties: earliest)
  if (ev.length > L.maxEvents){
    const keep = new Set([...ev].sort((a, b) => b.vel - a.vel || a.beat - b.beat).slice(0, L.maxEvents));
    report.droppedMax = ev.length - keep.size;
    ev = ev.filter(e => keep.has(e));
  }
  // per pipe: wrap into the loop, dedupe, thin, clip
  const lanes = new Map();
  for (const e of ev){
    const t = +wrapP(rollT + e.beat * beat, P).toFixed(9);
    (lanes.get(e.m) || lanes.set(e.m, []).get(e.m)).push({ ...e, t });
  }
  const out = [];
  for (const [m, list] of lanes){
    list.sort((a, b) => a.t - b.t || b.vel - a.vel || b.tDur - a.tDur);
    const kept = [];
    for (const e of list){
      const last = kept[kept.length - 1];
      if (last && e.t - last.t < 1e-6){ last.vel = Math.max(last.vel, e.vel); last.tDur = Math.max(last.tDur, e.tDur); continue; }
      if (last && e.t - last.t < IOI_MIN - 1e-9){ report.thinned++; continue; }
      kept.push({ ...e });
    }
    while (kept.length > 1 && kept[0].t + P - kept[kept.length - 1].t < IOI_MIN - 1e-9){ kept.pop(); report.thinned++; }
    kept.forEach((e, i) => {
      const nextOn = i + 1 < kept.length ? kept[i + 1].t : kept[0].t + P;
      const cap = Math.min(MAX_DUR, nextOn - e.t - GAP_MIN);
      if (e.tDur > cap + 1e-9){ e.tDur = cap; report.clipped++; }
      e.tDur = Math.max(DUR_MIN, e.tDur);
      const pitch = midiName(m);
      out.push({ t: e.t, tDur: e.tDur, vel: e.vel, pitch, timbre: e.timbre, base: e.timbre === 'organ' ? pitch : `${pitch}|${e.timbre}` });
    });
  }
  out.sort((a, b) => a.t - b.t || noteNum(a.pitch) - noteNum(b.pitch));
  return { events: out, report };
}

/** The voice id a fitted note plays at its strike (index.js) — and the tier ids voiceIds bakes.
    A note the render covers fires a DURATION BUCKET ('C4~0.5', 'C4|pad~2' — ../sustain.js: the
    release baked into the sample, so the iOS <audio> path stops near the note's end too), or the
    bare LONG id when it is nearer the render's own HOLD; a note held past CONT_AT fires the LONG id
    and is re-sourced by its CONTINUATION. `ladder` = the part's planned rungs (organLadder). */
export const VOICE_HOLD = 4.5;                 // the LONG render's full hold (voice.js HOLD)
export function strikeIds(n, ladder = LADDER){
  if (n.tDur > CONT_AT + .1) return { first: n.base, cont: `${n.base}/c` };
  return { first: bucketId(n.base, n.tDur, VOICE_HOLD, ladder), cont: null };
}
/** one ladder for a whole fitted part (build and voiceIds both plan it from fitPart's events) */
export const organLadder = events => planLadder(events.filter(e => e.tDur <= CONT_AT + .1).map(e => [e.base, e.tDur]), () => VOICE_HOLD,
  BUCKET_CAP, LADDERS[LADDERS.length - 2]);     // floor: one rung (.6 s) — never below the old '/s' tier's per-base staccato

/* ---- one pipe's lane: its fitted notes → per-gap solved motion ----
   notes: [{t (wrapped), tDur, vel, timbre, base}] for ONE pitch, already fitted (spaced ≥
   IOI_MIN cyclically, each stroke leaving ≥ GAP_MIN). */
const sm  = x => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const smd = x => (x <= 0 || x >= 1) ? 0 : 6 * x * (1 - x);
export function organLane(notes, P, ladder = LADDER){
  const ns = [...notes].sort((a, b) => a.t - b.t).map(n => ({ ...n, t: +wrapP(n.t, P).toFixed(9) }));
  const L = laneClock(ns.map(n => n.t), P);
  const N = ns.length;
  const rec = ns.map((n, i) => {
    const dur = n.tDur, s = sinkDepth(dur);
    const nextOn = i + 1 < N ? ns[i + 1].t : ns[0].t + P;
    const D = nextOn - n.t - dur;                         // the gap after this note (cyclic)
    const r = { t: n.t, dur, s, vel: n.vel, timbre: n.timbre, base: n.base, ids: strikeIds(n, ladder), D, sinkV: s / dur };
    const tu = tUp(s), dStar = tu + T_DOWN;
    const hopMin = Math.max(HOP_MIN, Math.sqrt(3 * s / g) * 1.02);
    if (D < hopMin) r.mode = 'ride';
    else if (D <= dStar){
      r.mode = 'hop';
      r.v0 = (s + .5 * g * D * D) / D;
    } else {
      r.mode = 'park';
      r.v0 = Math.sqrt(2 * g * (H_MAG + s));
      r.tUp = tu; r.hold = D - dStar;
    }
    if (r.mode !== 'ride'){ r.aLid = r.v0 * r.v0 / (2 * s); r.tLid = 2 * s / r.v0; }   // the kick stroke: braked to rest at the top
    return r;
  });
  // how each note ARRIVES (the gap before it), for the strike's character
  rec.forEach((r, i) => { r.arrive = rec[(i - 1 + N) % N].mode; });
  return { L, rec, P };
}

/* The lane at songTime t:
     { mode: 'armed'|'drop'|'hold'|'ride'|'hop'|'up'|'park'|'fall',
       y, vy   marble BOTTOM height above the lid's rest top (+ its velocity)
       lid, lidV   lid top height (≤ 0) + velocity
       i, since, abs, armed, first   the clock (since = s since note i's onset)
       sounding (the pipe speaks), held (on the magnet), sinceKick, sinceLand } */
export function laneAt(lane, t, start = -Infinity){
  const c = at(lane.L, t, start);
  const base = { i: c.i, since: c.since, abs: c.abs, armed: c.armed, first: c.first, sounding: false, held: false,
    sinceKick: Infinity, sinceLand: Infinity, lid: 0, lidV: 0 };
  if (c.armed){
    const u = c.until;
    if (u >= T_DOWN) return { ...base, mode: 'armed', y: H_MAG, vy: 0, held: true };
    const tau = T_DOWN - u;
    return { ...base, mode: 'drop', y: H_MAG - .5 * g * tau * tau, vy: -g * tau };
  }
  const r = lane.rec[c.i], since = c.since;
  // a landing just happened (the note's arrival was an impact: the first note ever, a hop or a park)
  const impact = (c.abs <= c.first + 1e-9) || r.arrive !== 'ride';
  if (since < r.dur){
    const lid = -r.s * since / r.dur;
    return { ...base, mode: 'hold', y: lid, vy: -r.sinkV, lid, lidV: -r.sinkV, sounding: true, sinceLand: impact ? since : Infinity };
  }
  const tau = since - r.dur, D = r.D;
  base.sinceKick = r.mode === 'ride' ? Infinity : tau;
  if (r.mode === 'ride'){
    const lid = -r.s + r.s * sm(tau / D), lidV = r.s * smd(tau / D) / D;
    return { ...base, mode: 'ride', y: lid, vy: lidV, lid, lidV };
  }
  const k = Math.min(tau, r.tLid);
  base.lid = -r.s + r.v0 * k - .5 * r.aLid * k * k; base.lidV = tau < r.tLid ? r.v0 - r.aLid * tau : 0;
  if (r.mode === 'hop')
    return { ...base, mode: 'hop', y: -r.s + r.v0 * tau - .5 * g * tau * tau, vy: r.v0 - g * tau };
  if (tau < r.tUp) return { ...base, mode: 'up', y: -r.s + r.v0 * tau - .5 * g * tau * tau, vy: r.v0 - g * tau };
  if (tau < r.tUp + r.hold) return { ...base, mode: 'park', y: H_MAG, vy: 0, held: true };
  const f = tau - r.tUp - r.hold;
  return { ...base, mode: 'fall', y: H_MAG - .5 * g * f * f, vy: -g * f };
}

/** The light packets in flight above one pipe's mouth at t: up to PACKETS × {front, tail, vel,
    timbre} (heights above the mouth: the wind of note k occupies [SPEED·(t−off), SPEED·(t−on)]).
    Only notes that HAPPENED (at/after the lane's first strike since `start`). */
export function packetsAt(lane, t, start = -Infinity, out = []){
  out.length = 0;
  const c = at(lane.L, t, start);
  if (c.armed) return out;
  const { rec, P } = lane, N = rec.length;
  let i = c.i, abs = c.abs;
  for (let k = 0; k < PACKETS && k < N; k++){
    if (abs < c.first - 1e-9) break;
    const r = rec[i];
    out.push({ front: SPEED * (t - abs), tail: SPEED * Math.max(0, t - abs - r.dur), vel: r.vel, timbre: r.timbre, i });
    const j = (i - 1 + N) % N;
    abs -= wrapP(r.t - rec[j].t, P) || P;
    i = j;
  }
  return out;
}

/** The clearance (marble bottom − lid top) τ seconds into the gap after note i — 0 while it
    rides, > 0 through every flight (tests sample it). */
export function clearance(lane, i, tau){
  const r = lane.rec[i];
  if (r.mode === 'ride') return 0;
  const k = Math.min(tau, r.tLid), lid = -r.s + r.v0 * k - .5 * r.aLid * k * k;
  let y;
  if (r.mode === 'hop' || tau < r.tUp) y = -r.s + r.v0 * tau - .5 * g * tau * tau;
  else if (tau < r.tUp + r.hold) y = H_MAG;
  else { const f = tau - r.tUp - r.hold; y = H_MAG - .5 * g * f * f; }
  return y - lid;
}
