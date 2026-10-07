/* ============================================================
   STRUM (the Marble Autoharp) — the pure math. No THREE scene, no
   DOM, no audio. Everything here is solved once per song (prepPart →
   layoutStrings → solveStrum), then read back as pure functions of
   songTime (pickAt / stringAt / damperAt / lastSounding).

   THE MACHINE, in the harp's own plane:
     x  across the fan (low → high), s  up each string from the bridge,
     n  out of the string plane toward the audience.
   · A FAN of open strings, one per pitch the part uses (≤ 24), each
     its own length (L ∝ f^−½ — a pure function of the note).
   · ONE conserved PLECTRUM: a gold marble on a telescoping arm, riding
     a rail BEHIND the strings at the pick height S_PICK. A cable loop
     on a motor pulley drives the carriage (the visible energy source);
     its x is the only "strumming hand" the machine has.
   · Per string, a felt DAMPER on a solenoid plunger in FRONT at S_DAMP.
     Every strum crosses the WHOLE fan (autoharp-true): a damped string
     is plucked and dies under its felt; an OPEN string rings. The chord
     is literally "which felts are lifted".

   ONE STRUM (a pass):
     the marble crosses the fan at constant speed v, timed so that it
     RELEASES the chord's first string exactly on the beat. String j
     releases at  τ_j = t + d·(x_j − x_first)/v  — the strum spread is
     the marble's flight time between strings (8–26 ms between chord
     tones: louder = faster, as a real hand).
   THE PLUCK (2-D, in the cross-section at S_PICK):
     the marble's tip rides H behind the string plane; contact begins
     when the string's rest point lies on the marble's surface; the
     string is DRAGGED (stick) around the marble — its centre stays
     exactly R = r_tip + r_string from the marble's — from angle φ0 to
     the top (φ = 0), where it slips off with deflection (d·δ, R − H)
     and rings, released from rest. At rest at contact, never inside.
   BETWEEN STRUMS (piecewise-parabolic, no integrator):
     · flip — a fast reversal: constant decel to an apex short of the
       dock, constant accel back (down-up-down: the hand never stops);
     · dock — a longer reversal: brake to REST on the dock magnet (D past
       the fan edge), hold, launch;
     · ret  — same direction again (a gap long enough for another
       DOWN-strum): brake into the far dock, retract the arm, travel
       back behind the strings, re-engage, hold, launch.
   Direction rule (a guitarist's right hand): ON the beat wants a DOWN,
   on the "and" an UP, anything else alternates; a strum that wants the
   same direction as the last gets it only if the silent return fits —
   else the hand alternates (fast down-downs become down-ups, as real).
   ============================================================ */
import { noteNum } from '../../engine.js';
import { eventTimes, wrapP } from '../clock.js';

/* ---- the plectrum + pluck geometry ---- */
export const R_TIP   = .16;          // the marble plectrum's radius
export const H_TIP   = .15;          // tip-centre depth BEHIND the string plane (< R → it catches)
export const DELTA   = .09;          // drag past the string before it slips off (the stored pluck)
export const S_PICK  = .55;          // pick height up the strings (from the bridge)
export const S_DAMP  = 1.2;          // felt height up the strings
export const C_EDGE  = .45;          // constant-speed run beyond the outer strings
export const D_DOCK  = .75;          // dock magnets: this far past each fan edge
export const N_RET   = .23;          // arm retraction (extra depth) for a silent return (the marble then sits just
                                     //   in front of the carriage's collar — retracted, never inside it)
/* the harp's PILLAR stands in the string plane beyond the bass dock: the marble's whole run
   (out to the dock, E_lo − D_DOCK) must clear it and its brass rings */
export const PILLAR_OFF = 1.65, PILLAR_R = .15, PILLAR_RING = .185;   // pillar x = xs[0] − PILLAR_OFF
/* ---- the strumming hand ---- */
export const V_LO = 30, V_HI = 200;  // marble speed across the fan (u/s)
export const SP_MIN = .008, SP_MAX = .026, SP_SOLO = .012;   // spread between chord tones (s): ff … pp
export const T_MIN   = .03;          // shortest reversal the hand may take between passes (s)
export const T_ENG   = .07;          // arm engage / retract time (s)
export const A_RET   = 900;          // return-travel peak-ish accel (u/s²) → min-jerk travel time
/* ---- dampers ---- */
export const T_D = .07, T_D_MIN = .016;   // felt travel time (nominal / squeezed)
export const GUARD = .005;           // felt must be settled this long around a crossing
export const LIFT_LEAD = .1;         // felts lift a little EARLY: the next chord's shape reads before it sounds
export const FELT_LIFT = .22;        // plunger travel (felt face off the string)
/* ---- the visible ring (readable, not audio-rate) ---- */
export const K_OPEN = 2.2, K_DAMP = 30, KILL = 45;   // ring decay (1/s): open, under felt, felt landing
export const TAU_N  = .006;          // the slip's out-of-plane component dies fast (Gaussian, s)
export const TAU_B  = .035;          // V-shape → fundamental blend time (s)
export const GLOW_T = 1.1;           // string glow decay (s) while open
export const CHORD_EPS = .04;        // notes this close together are ONE strum (s)
const PRE_GAP = .08;                 // strums closer than this are thinned away before the solve even tries
export const BRUSH = .32;            // a ringing string the marble brushes past: re-plucked this soft (× its note's vel)

/** What the machine can honestly play — for the MIDI orchestrator (orchestra.js PART_SPEC).
    gap = the shortest strum-to-strum time the solver ALWAYS fits (tested on dense random
    chords over a full 24-string fan); denser strums are thinned (never crash). */
export const PART_LIMITS = Object.freeze({
  lo: 40, hi: 88, center: 60,        // E2 … E6 (MIDI); outside folds by octaves
  pitches: 24,                       // strings (one per pitch used; the rarest fold/merge)
  poly: 6,                           // notes per strum (outer voices kept, inner thinned evenly)
  gap: .2,                           // strum-to-strum (s) ALWAYS fit, even sweeping a full 24-string fan;
  ioi: .2,                           //   a smaller fan fits denser (down to ~.08 s) — the solver thins only what can't
  chordEps: CHORD_EPS,               // onsets within 40 ms = one strum (a MIDI pre-strummed chord merges)
  maxEvents: 480,                    // strums per loop
  voices: 2,
  sustain: true, maxDur: 3, minDur: 0,   // dur = felt drop (0 → let ring until the chord changes)
});

/* ---- per-string geometry: PURE functions of the note (never of layout) ---- */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const nameOf = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
/** 'E3', 'E3|n' (nylon), 'E3|h' (harp) → { name, m, variant } (null if unparseable). */
export function parseId(id){
  const [name, variant = ''] = String(id).split('|');
  if (!/^[A-G]#?\d$/.test(name)) return null;
  return { name, m: noteNum(name), variant };
}
const hzOf = m => 440 * Math.pow(2, (m - 69) / 12);
export const L_REF = 6.2, F_REF = 82.4069;          // E2 → 6.2 u; L ∝ f^−½ (harp-like taper)
export function stringLength(id){ const p = parseId(id); return L_REF * Math.sqrt(F_REF / hzOf(p.m)); }
export function stringRadius(id){
  const p = parseId(id);
  return Math.max(.022, Math.min(.05, .05 * Math.pow(F_REF / hzOf(p.m), .35)));
}
export const isWound = id => parseId(id).m < 55;     // bronze-wound below G3, plain steel above
export const pickU = id => S_PICK / stringLength(id);
export const dampU = id => S_DAMP / stringLength(id);

/* ---- PART → strums (graceful: fold, merge, thin — never throw) ---- */
export function prepPart(part, { rollT, beat, P }, lim = PART_LIMITS){
  const stats = { notes: 0, folded: 0, merged: 0, thinned: 0, dropped: 0, unparsed: 0 };
  let ev = [];
  try { ev = eventTimes((Array.isArray(part) ? part : []).filter(e => Array.isArray(e) && isFinite(e[0])), { rollT, beat }); } catch { ev = []; }
  const notes = [];
  for (const e of ev){
    const p = parseId(e.note);
    if (!p || !isFinite(e.t)){ stats.unparsed++; continue; }
    let m = p.m;
    while (m < lim.lo){ m += 12; stats.folded++; }
    while (m > lim.hi){ m -= 12; stats.folded++; }
    const id = nameOf(m) + (p.variant ? '|' + p.variant : '');
    notes.push({ t: wrapP(e.t, P), beat: e.beat, id, m, vel: Math.max(.05, Math.min(1, +e.vel || 1)), dur: Math.max(0, +e.tDur || 0) });
  }
  stats.notes = notes.length;
  // the string budget: the most-used pitches keep a string; a rare one moves to the same pitch
  // class on a kept string (nearest octave) or, failing that, is dropped
  const use = new Map();
  for (const n of notes) use.set(n.id, (use.get(n.id) || 0) + 1);
  if (use.size > lim.pitches){
    const keep = new Set([...use.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, lim.pitches).map(e => e[0]));
    for (const n of notes){
      if (keep.has(n.id)) continue;
      let best = null;
      for (const k of keep){ const q = parseId(k); if ((q.m - n.m) % 12 === 0 && (!best || Math.abs(q.m - n.m) < Math.abs(best.m - n.m))) best = { id: k, m: q.m }; }
      if (best){ n.id = best.id; n.m = best.m; stats.merged++; } else { n.id = null; stats.dropped++; }
    }
  }
  const live = notes.filter(n => n.id).sort((a, b) => a.t - b.t || a.m - b.m);
  // group into strums (onsets within chordEps of the strum's first)
  let strums = [];
  for (const n of live){
    const g = strums[strums.length - 1];
    if (g && n.t - g.t <= lim.chordEps){
      const o = g.notes.get(n.id);
      if (o){ o.vel = Math.max(o.vel, n.vel); o.dur = Math.max(o.dur, n.dur); }
      else g.notes.set(n.id, { id: n.id, m: n.m, vel: n.vel, dur: n.dur });
    } else strums.push({ t: n.t, beat: n.beat, notes: new Map([[n.id, { id: n.id, m: n.m, vel: n.vel, dur: n.dur }]]) });
  }
  // a chord that wraps the seam (its notes straddle P) merges into the first strum
  if (strums.length > 1){
    const a = strums[0], z = strums[strums.length - 1];
    if (a.t + P - z.t <= lim.chordEps){ for (const [k, v] of z.notes) if (!a.notes.has(k)) a.notes.set(k, v); a.t = z.t - P; strums.pop(); a.t = wrapP(a.t, P); strums.sort((x, y) => x.t - y.t); }
  }
  // polyphony: keep the outer voices, thin the inner ones evenly
  for (const g of strums){
    let ns = [...g.notes.values()].sort((a, b) => a.m - b.m);
    if (ns.length > lim.poly){
      const keep = [];
      for (let i = 0; i < lim.poly; i++) keep.push(ns[Math.round(i * (ns.length - 1) / (lim.poly - 1))]);
      stats.thinned += ns.length - keep.length;
      ns = [...new Set(keep)];
    }
    g.notes = ns;
    g.vel = Math.max(...ns.map(n => n.vel));
  }
  // density: a strum closer than PRE_GAP to the previous kept one is dropped (a much louder one replaces it)
  strums = thinGaps(strums, PRE_GAP, P, stats);
  // budget: drop the most crowded strum until it fits
  while (strums.length > lim.maxEvents){
    let worst = 0, wg = Infinity;
    for (let i = 0; i < strums.length; i++){
      const a = strums[(i - 1 + strums.length) % strums.length].t, b = strums[(i + 1) % strums.length].t, t = strums[i].t;
      const g = Math.min(wrapP(t - a, P), wrapP(b - t, P)) + .01 * strums[i].vel;
      if (g < wg){ wg = g; worst = i; }
    }
    strums.splice(worst, 1); stats.dropped++;
  }
  const ids = [...new Set(strums.flatMap(g => g.notes.map(n => n.id)))]
    .sort((a, b) => parseId(a).m - parseId(b).m || (a < b ? -1 : 1));
  return { strums, ids, stats };
}
function thinGaps(strums, gap, P, stats){
  const out = [];
  for (const g of strums){
    const prev = out[out.length - 1];
    if (prev && g.t - prev.t < gap){
      if (g.vel > prev.vel * 1.25){ out[out.length - 1] = g; } stats.dropped++;
      continue;
    }
    out.push(g);
  }
  while (out.length > 1 && out[0].t + P - out[out.length - 1].t < gap){ out.pop(); stats.dropped++; }
  return out;
}

/* ---- string positions across the fan (layout: spacing only; lengths stay the note's) ---- */
export const SX_NOM = .5, SX_MIN = .42;
export const PULLEY_R = .26, CAR_HW = .3;
/** x of each string (centred on 0), the fan edges, and the WHOLE machine's half-width
    (rail + docks + pulleys). scale < 1 when it must shrink to fit `W` — the bed is
    scaled UNIFORMLY at render time (the solve itself never changes). */
export function layoutStrings(ids, { W = 12 } = {}){
  const n = ids.length;
  const sx = SX_NOM;
  const F = Math.max(0, n - 1) * sx;
  const xs = ids.map((_, i) => -F / 2 + i * sx);
  const E_lo = -F / 2 - C_EDGE, E_hi = F / 2 + C_EDGE;
  const half = F / 2 + C_EDGE + D_DOCK + CAR_HW + .2 + 2 * PULLEY_R + .5;
  const scale = Math.min(1, (W / 2 - .2) / half);
  return { xs, sx, F, E_lo, E_hi, half, scale };
}

/* ---- the solve ---- */
const travelT = dist => Math.sqrt(6 * Math.abs(dist) / A_RET);    // smoothstep rest→rest, peak accel A_RET

export function solveStrum(prep, P, lay){
  const { ids } = prep;
  const xs = lay.xs, E_lo = lay.E_lo, E_hi = lay.E_hi;
  const N = ids.length;
  const rs = ids.map(stringRadius), Rj = rs.map(r => R_TIP + r);
  const sq = Rj.map(R => Math.sqrt(R * R - H_TIP * H_TIP));
  const lift = Rj.map(R => R - H_TIP);
  const idx = new Map(ids.map((id, j) => [id, j]));
  const TR = travelT(E_hi - E_lo + 2 * D_DOCK);
  const stats = { infeasible: 0, forced: 0, brushed: 0 };
  let strums = prep.strums.map(g => ({ ...g }));

  for (let attempt = 0; attempt < 400; attempt++){
    const K = strums.length;
    if (!K) break;
    const passes = strums.map(g => {
      const js = g.notes.map(n => idx.get(n.id));
      const lo = Math.min(...js), hi = Math.max(...js);
      const sp = js.length > 1 ? SP_MAX - (SP_MAX - SP_MIN) * g.vel : SP_SOLO;
      const mean = js.length > 1 ? (xs[hi] - xs[lo]) / (js.length - 1) : lay.sx || SX_NOM;
      const fr = (((g.beat ?? 0) % 1) + 1) % 1;
      const want = fr < .08 || fr > .92 ? 1 : Math.abs(fr - .5) < .08 ? -1 : 0;   // on the beat: down; the "and": up
      return { t: g.t, g, js, lo, hi, vel: g.vel, want, v: Math.max(V_LO, Math.min(V_HI, mean / sp)), d: 1 };
    });
    const geom = (p, d = p.d) => {
      const f = d > 0 ? p.lo : p.hi, xr = xs[f] + d * DELTA;
      const Ein = d > 0 ? E_lo : E_hi, Eout = d > 0 ? E_hi : E_lo;
      return { f, xr, Ein, Eout, ts: p.t - Math.abs(xr - Ein) / p.v, te: p.t + Math.abs(Eout - xr) / p.v };
    };
    const nxt = k => (k + 1) % K;
    const turnT = (k, dk = passes[k].d, dn = passes[nxt(k)].d) =>
      geom(passes[nxt(k)], dn).ts + (k === K - 1 ? P : 0) - geom(passes[k], dk).te;
    const retNeed = (a, b) => 2 * D_DOCK / a + 2 * D_DOCK / b + 2 * T_ENG + TR;
    const gapT = k => (k === K - 1 ? passes[0].t + P : passes[nxt(k)].t) - passes[k].t;
    // directions: start after the longest gap (the loop's breath) with a DOWN strum
    let r = 0, lg = -1;
    for (let k = 0; k < K; k++){ const g = gapT((k - 1 + K) % K); if (g > lg){ lg = g; r = k; } }
    passes[r].d = passes[r].want || 1;
    for (let i = 1; i < K; i++){
      const k = (r + i) % K, pk = (k - 1 + K) % K, dp = passes[pk].d;
      const des = passes[k].want || -dp;
      passes[k].d = des !== dp ? des : turnT(pk, dp, dp) >= retNeed(passes[pk].v, passes[k].v) ? des : -dp;
    }
    // speed up the hand where a turn doesn't fit (monotone: faster passes only lengthen turns)
    const need = k => passes[k].d === passes[nxt(k)].d ? retNeed(passes[k].v, passes[nxt(k)].v) : T_MIN;
    let bad = -1;
    for (let sweep = 0; sweep < 80; sweep++){
      bad = -1;
      for (let k = 0; k < K; k++){
        if (turnT(k) >= need(k) - 1e-12) continue;
        const a = passes[k], b = passes[nxt(k)];
        if (a.v >= V_HI && b.v >= V_HI){ bad = k; break; }
        a.v = Math.min(V_HI, a.v * 1.12); b.v = Math.min(V_HI, b.v * 1.12);
        bad = -2;
      }
      if (bad !== -2) break;
    }
    if (bad >= 0 || bad === -2){
      // infeasible even at full speed: thin (drop the quieter strum of the pair) and re-solve
      const k = bad >= 0 ? bad : 0, j = nxt(k);
      const drop = K === 1 ? 0 : (strums[k].vel < strums[j].vel ? k : j);
      strums.splice(drop, 1); stats.infeasible++;
      continue;
    }
    return finish(passes, geom, turnT, K);
  }
  return finish([], null, null, 0);

  function finish(passes, geom, turnT, K){
    const S = { P, N, K, ids, xs, rs, Rj, sq, lift, E_lo, E_hi, TR, stats, passes: [], strings: [], prep };
    S.up = ids.map(pickU); S.ud = ids.map(dampU);
    if (!K){ S.strings = ids.map(() => ({ cr: [], moves: [], snd: [] })); return S; }
    for (let k = 0; k < K; k++){
      const p = passes[k], G = geom(p);
      S.passes.push({ k, t: p.t, d: p.d, v: p.v, vel: p.vel, js: p.js, lo: p.lo, hi: p.hi, ...G, notes: p.g.notes });
    }
    for (let k = 0; k < K; k++){
      const a = S.passes[k], b = S.passes[(k + 1) % K];
      const T = turnT(k);
      let tr;
      if (a.d === b.d) tr = { type: 'ret', T, Db: D_DOCK, Tb: 2 * D_DOCK / a.v, TL: 2 * D_DOCK / b.v };
      else if (T >= 2 * D_DOCK / a.v + 2 * D_DOCK / b.v) tr = { type: 'dock', T, Db: D_DOCK, Tb: 2 * D_DOCK / a.v, TL: 2 * D_DOCK / b.v };
      else { const Db = a.v * b.v * T / (2 * (a.v + b.v)); tr = { type: 'flip', T, Db, Tb: 2 * Db / a.v, TL: 2 * Db / b.v }; }
      a.turn = tr;
    }
    // the first pass that really happens after the count-in starts (set per start in firstPass)
    // ---- crossings: every pass crosses every string ----
    for (let j = 0; j < N; j++){
      const cr = [];
      for (const p of S.passes){
        const tau = p.t + p.d * (xs[j] - xs[p.d > 0 ? p.lo : p.hi]) / p.v;
        const tc = tau - (DELTA + sq[j]) / p.v;
        const nt = p.notes.find(n => idx.get(n.id) === j);
        cr.push({ k: p.k, d: p.d, v: p.v, tau, tc, sigma: !!nt, want: !!nt, vel: nt ? nt.vel : 0, ndur: nt && nt.dur > 0 ? nt.dur : Infinity });
      }
      S.strings.push({ cr, moves: [], snd: [] });
    }
    for (let j = 0; j < N; j++) scheduleDampers(S, j);
    return S;
  }
}

/* The felt schedule for string j: UP (open) at every crossing that should sound, DOWN at every
   crossing that shouldn't, settled ±GUARD around each; drops at the note's end (dur) — the felt
   landing is when the sound stops. A felt that can't move in time between two crossings stays
   OPEN (the earlier crossing then sounds too: honest physics, counted in stats.forced). */
function scheduleDampers(S, j){
  const { P } = S, st = S.strings[j], cr = st.cr, K = cr.length;
  const nextOf = i => { const n = (i + 1) % K; return { n, tc: cr[n].tc + (n <= i ? P : 0), tau: cr[n].tau + (n <= i ? P : 0) }; };
  // a note whose DURATION outlasts the next strum stays open: the marble BRUSHES it as it passes
  // (a soft re-pluck — an open string can't be crossed silently). Let-ring notes (no duration)
  // ring until the chord changes. Twice round the loop so a long note carries across the seam.
  if (K){
    let until = -Infinity, vel = 0;
    for (let r = 0; r < 2 * K; r++){
      const i = r % K, c = cr[i], off = r >= K ? P : 0;
      if (c.want){ if (isFinite(c.ndur)){ until = c.tau + off + c.ndur; vel = c.vel; } else until = -Infinity; continue; }
      if (until > c.tc + off + GUARD && !c.sigma){
        c.sigma = true; c.brush = true; c.vel = BRUSH * vel; c.ndur = until - (c.tau + off);
      }
    }
  }
  for (let changed = true, it = 0; changed && it < 4 * K + 4; it++){
    changed = false;
    for (let i = 0; i < K; i++){
      const { n, tc } = nextOf(i), a = cr[i].tau + GUARD, b = tc - GUARD;
      if (b - a >= T_D_MIN) continue;
      const force = c => { c.sigma = true; c.forced = true; c.vel = Math.max(c.vel, BRUSH); changed = true; };
      if (cr[i].sigma && !cr[n].sigma) force(cr[n]);
      else if (!cr[i].sigma && cr[n].sigma) force(cr[i]);
    }
  }
  const moves = [];
  for (let i = 0; i < K; i++){
    const c = cr[i], { n, tc, tau: tauN } = nextOf(i), a = c.tau + GUARD, b = tc - GUARD, w = b - a;
    const s0 = c.sigma, s1 = cr[n].sigma;
    c.touch = Infinity; c.tcNext = tc;
    // the visible ring is gone (and still) before the next marble comes within reach of the string
    c.restIn = Math.max(.004, tc - Math.max(2 * DELTA / cr[n].v, .004) - c.tau);
    if (s0 && s1){
      const off = c.tau + c.ndur, d0 = Math.max(a, off);
      if (d0 + 2 * T_D + .02 <= b){
        moves.push({ t0: d0, T: T_D, to: 0 });
        const ls = Math.max(d0 + T_D + .02, b - T_D - LIFT_LEAD);
        moves.push({ t0: ls, T: T_D, to: 1 });
        c.touch = d0 + T_D;
      }
    } else if (s0 && !s1){
      const Td = Math.min(T_D, w), d0 = Math.min(Math.max(c.tau + c.ndur, a), b - Td);
      moves.push({ t0: d0, T: Td, to: 0 });
      c.touch = d0 + Td;
    } else if (!s0 && s1){
      const Td = Math.min(T_D, w), ls = Math.max(a, b - Td - LIFT_LEAD);
      moves.push({ t0: ls, T: Td, to: 1 });
    }
    // what the ear gets: an open crossing rings until its felt lands, or until the marble re-plucks it
    c.dur = c.sigma ? (isFinite(c.touch) ? c.touch - c.tau : tauN - c.tau) : 0;
    if (c.forced) S.stats.forced++;
    if (c.brush) S.stats.brushed++;
  }
  moves.sort((x, y) => x.t0 - y.t0);
  // each move starts from the previous move's end state (cyclic)
  for (let i = 0; i < moves.length; i++) moves[i].from = moves[(i - 1 + moves.length) % moves.length].to;
  st.moves = moves;
  st.rest = cr.length ? (cr[0].sigma ? 1 : 0) : 0;
  st.snd = cr.filter(c => c.sigma);
}

/* ---- reading the solve back: pure functions of songTime ---- */

/** latest index i in sorted (unwrapped, span < P) times arr with arr[i] ≤ t (cyclic): {i, since}. */
function cyc(arr, t, P, key){
  const n = arr.length, base = key(arr[0]);
  const tau = wrapP(t - base, P);
  let lo = 0, hi = n - 1;
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (key(arr[m]) - base <= tau) lo = m; else hi = m - 1; }
  return { i: lo, since: tau - (key(arr[lo]) - base) };
}

/** The first pass whose launch happens at/after `start` (memoized): its index + abs ts. */
export function firstPass(S, start){
  if (S._fpStart === start) return S._fp;
  let best = { k: -1, ts: Infinity };
  if (!isFinite(start)) best = { k: 0, ts: -Infinity };
  else for (const p of S.passes){
    const lead = 2 * D_DOCK / p.v;
    const a = p.ts + Math.ceil((start + lead - p.ts) / S.P) * S.P;
    if (a < best.ts) best = { k: p.k, ts: a };
  }
  S._fpStart = start; S._fp = best;
  return best;
}

const NE = -H_TIP, NR = -H_TIP - N_RET;
const sstep = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);

/** The plectrum at songTime t: { x, n, vx, mode, k, armed } — x along the rail, n the tip
    centre's depth (−H_TIP engaged). mode: 'armed' | 'pass' | 'brake' | 'hold' | 'dock' |
    'retract' | 'travel' | 'engage' | 'launch' | 'flip'. */
export function pickAt(S, t, start = -Infinity){
  if (!S.K) return { x: S.E_lo - D_DOCK, n: NE, vx: 0, mode: 'armed', k: -1, armed: true };
  if (t < start) t = start;
  const fp = firstPass(S, start);
  if (t < fp.ts){
    const p = S.passes[fp.k], TL = 2 * D_DOCK / p.v, w = 1 - (fp.ts - t) / TL;
    if (w <= 0) return { x: p.Ein - p.d * D_DOCK, n: NE, vx: 0, mode: 'armed', k: -1, armed: true };
    return { x: p.Ein - p.d * D_DOCK * (1 - w * w), n: NE, vx: 2 * p.d * D_DOCK * w / TL, mode: 'launch', k: -1, armed: true };
  }
  const { i, since } = cyc(S.passes, t, S.P, p => p.ts);
  const p = S.passes[i], cross = p.te - p.ts;
  if (since <= cross) return { x: p.Ein + p.d * p.v * since, n: NE, vx: p.d * p.v, mode: 'pass', k: i, armed: false };
  const tr = p.turn, s = since - cross, d = p.d, E = p.Eout;
  if (s < tr.Tb){
    const w = s / tr.Tb;
    return { x: E + d * tr.Db * (2 * w - w * w), n: NE, vx: d * tr.Db * 2 * (1 - w) / tr.Tb, mode: tr.type === 'flip' ? 'flip' : 'brake', k: i, armed: false };
  }
  if (s > tr.T - tr.TL){
    const w = (s - (tr.T - tr.TL)) / tr.TL, nx = S.passes[(i + 1) % S.K];
    if (tr.type === 'ret')
      return { x: nx.Ein - d * D_DOCK * (1 - w * w), n: NE, vx: 2 * d * D_DOCK * w / tr.TL, mode: 'launch', k: i, armed: false };
    return { x: E + d * tr.Db * (1 - w * w), n: NE, vx: -2 * d * tr.Db * w / tr.TL, mode: tr.type === 'flip' ? 'flip' : 'launch', k: i, armed: false };
  }
  if (tr.type !== 'ret') return { x: E + d * tr.Db, n: NE, vx: 0, mode: 'dock', k: i, armed: false };
  // the return: retract → travel behind the strings → engage → hold at the start dock
  const nx = S.passes[(i + 1) % S.K];
  const xa = E + d * D_DOCK, xb = nx.Ein - d * D_DOCK;
  const u = s - tr.Tb;
  if (u < T_ENG) return { x: xa, n: NE + (NR - NE) * sstep(u / T_ENG), vx: 0, mode: 'retract', k: i, armed: false };
  if (u < T_ENG + S.TR){
    const w = (u - T_ENG) / S.TR;
    return { x: xa + (xb - xa) * sstep(w), n: NR, vx: (xb - xa) * 6 * w * (1 - w) / S.TR, mode: 'travel', k: i, armed: false };
  }
  if (u < 2 * T_ENG + S.TR) return { x: xb, n: NR + (NE - NR) * sstep((u - T_ENG - S.TR) / T_ENG), vx: 0, mode: 'engage', k: i, armed: false };
  return { x: xb, n: NE, vx: 0, mode: 'dock', k: i, armed: false };
}

/** IDLE (../idle.js): while the plectrum sits still on a dock magnet (pickAt's 'armed' / 'dock'
    stretches), how long it has sat there and how long until it launches: { since, until } — or
    null anywhere else (passes, brakes, flips, the retract / travel / engage of a return). */
export function dockRest(S, t, start = -Infinity){
  if (!S.K) return null;
  if (t < start) t = start;
  const fp = firstPass(S, start);
  if (t < fp.ts){
    const until = fp.ts - 2 * D_DOCK / S.passes[fp.k].v - t;
    return until >= 0 ? { since: Infinity, until } : null;
  }
  const { i, since } = cyc(S.passes, t, S.P, p => p.ts);
  const p = S.passes[i], tr = p.turn, s = since - (p.te - p.ts);
  if (s < tr.Tb || s > tr.T - tr.TL || tr.type === 'flip') return null;
  const until = tr.T - tr.TL - s;
  if (tr.type === 'dock') return { since: s - tr.Tb, until };
  const u = s - tr.Tb - 2 * T_ENG - S.TR;                // a return: docked once it has re-engaged
  return u >= 0 ? { since: u, until } : null;
}

/** Is the crossing (string j, at abs contact time) one that really happened (after the count-in)? */
function happened(S, c, absTc, start){
  const fp = firstPass(S, start);
  const p = S.passes[c.k];
  return absTc - (c.tc - p.ts) >= fp.ts - 1e-9;
}

const ringC = (u, k, w) => Math.exp(-k * u) * (Math.cos(w * u) + (k / w) * Math.sin(w * u));
/** visible ring frequency (Hz) — slow enough to read, higher for higher strings */
export const visHz = id => 7 + 4.5 * Math.max(0, Math.min(1, (parseId(id).m - 40) / 48));

/** String j at songTime t: displacement AT THE PICK POINT (dx along x, dn out of plane),
    the shape blend b (0 = the plucked V, 1 = the fundamental), uTop (1, or the felt's u when
    the felt is down for this crossing — the felt is the string's node), glow, contact flag. */
export function stringAt(S, j, t, start = -Infinity){
  const st = S.strings[j];
  const rest = { dx: 0, dn: 0, b: 0, uTop: 1, glow: 0, contact: false, c: null, since: Infinity };
  if (!st || !st.cr.length) return rest;
  if (t < start) t = start;
  const { i, since } = cyc(st.cr, t, S.P, c => c.tc);
  const c = st.cr[i], absTc = t - since;
  if (!happened(S, c, absTc, start)) return rest;
  const R = S.Rj[j], x = S.xs[j];
  const uTop = c.sigma ? 1 : S.ud[j];
  const span = c.tau - c.tc;
  if (since < span){
    // CONTACT: dragged round the marble (stick), centre exactly R from the marble's
    const xp = S.passes[c.k].xr + c.d * c.v * (since - (c.tau - c.tc) + (c.tau - S.passes[c.k].t));
    const phi0 = Math.asin(S.sq[j] / R), phi = phi0 * (span - since) / span;
    return { dx: xp - x + c.d * R * Math.sin(phi), dn: -H_TIP + R * Math.cos(phi), b: 0, uTop, glow: c.sigma ? c.vel * .6 : 0,
             contact: true, c, since };
  }
  const u = since - span, tNext = c.restIn;
  const taper = 1 - sstep(u / tNext);          // flat at the slip (the marble is still beside it), gone + still before the next contact
  const absTau = absTc + span, kill = (absTau - c.tau + c.touch) < t ? Math.exp(-KILL * (t - (absTau - c.tau + c.touch))) : 1;
  const w = 2 * Math.PI * visHz(S.ids[j]);
  const cc = ringC(u, c.sigma ? K_OPEN : K_DAMP, w) * taper * kill;
  const nf = Math.exp(-((u / TAU_N) ** 2));
  return { dx: c.d * DELTA * cc, dn: S.lift[j] * cc * nf, b: 1 - Math.exp(-((u / TAU_B) ** 2)), uTop,
           glow: c.sigma ? c.vel * Math.exp(-u / GLOW_T) * kill : 0, contact: false, c, since };
}

/** Shape factor along the string (u ∈ [0,1] from the bridge) for a pose: 1 at the pick point
    while plucked (a V to the bridge and to the node uTop), blending into the fundamental
    sin(π u/uTop) with the triangle's own first-mode weight. 0 above the felt node. */
export function shapeAt(S, j, p, u){
  const up = S.up[j], ut = p.uTop;
  if (u <= 0 || u >= ut) return 0;
  const V = u <= up ? u / up : (ut - u) / (ut - up);
  if (!p.b) return V;
  const q = up / ut, k1 = 2 * Math.sin(Math.PI * q) / (Math.PI * Math.PI * q * (1 - q));
  return (1 - p.b) * V + p.b * k1 * Math.sin(Math.PI * u / ut);
}

/** The felt for string j: θ ∈ [0,1] (0 = down on the string, 1 = lifted). Pure fn of t;
    during the count-in it holds still until just before the first pass. */
export function damperAt(S, j, t, start = -Infinity){
  const st = S.strings[j];
  if (!st || !st.moves.length) return st ? st.rest : 0;
  if (t < start) t = start;
  if (S.K){ const fp = firstPass(S, start); t = Math.max(t, fp.ts - .35); }
  const { i, since } = cyc(st.moves, t, S.P, m => m.t0);
  const m = st.moves[i];
  if (since >= m.T) return m.to;
  return m.from + (m.to - m.from) * sstep(since / m.T);
}
/** The felt face's distance out from the string's FRONT surface (u ≥ 0 never inside it). */
export const feltFace = th => FELT_LIFT * th;

/** The latest SOUNDING crossing of string j at/before t (null if none yet): {c, abs, since}. */
export function lastSounding(S, j, t, start = -Infinity){
  const st = S.strings[j];
  if (!st || !st.snd.length) return null;
  if (t < start) t = start;
  const { i, since } = cyc(st.snd, t, S.P, c => c.tau);
  const c = st.snd[i], abs = t - since;
  if (!happened(S, c, abs - (c.tau - c.tc), start)) return null;
  return { c, abs, since };
}
