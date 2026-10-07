/* ============================================================
   RIFF FORGE — the pure math. No THREE scene, no DOM, no audio.

   THE MACHINE — a six-string electric guitar neck laid flat, worked
   by a DROP FORGE. Lanes = STRINGS (not pitches: a riff uses ~30
   pitches, a guitar has 6 strings). Every string owns, and only ever
   touches, its own:
     · FRET CARRIAGE — a brass slider in a groove under the string whose
       chrome hook reaches over it. It LIFTS, slides to the fret, and
       PRESSES the string onto the fret wire before the note. The pitch
       IS the position: the fret wires stand at the luthier's
       x = L·(1 − 2^(−f/12)), so the vibrating length (fret → bridge) is
       exactly ∝ 1/f. An open string = the hook stays lifted.
     · STAMP — a chrome-marble drop hammer on a vertical rod, driven by a
       solenoid in the forge beam above. It strikes the string over the
       bridge pickup (lands EXACTLY on the beat, moving down at V_IN),
       rebounds LOSSY (e·V_IN — the solenoid supplies the rest: the
       visible energy source, it glows with its drive), and flies a
       solved Hermite arc to the next strike: fast chugs are short sharp
       hops, longer gaps taller ones (apex ∝ gap — rhythm reads as
       height, the belt's grammar). A gap longer than T_PARK parks the
       stamp on its LATCH at H_PARK (arrives at zero speed, held,
       released to drive down onto the beat).
   And one shared (non-lane) part: the PALM-MUTE BAR — a felt bar on a
   hinge that lowers onto all six strings at the bridge before a muted
   hit and lifts before an open one (a real palm). It touches only the
   strings, never a stamp or a carriage (they live in other x bands).

   THE SOLVE (all up front, in build):
     1. normalizeHits(part) — TEMPO-FREE: simultaneous events → one HIT
        (a chord), notes folded into range, at most one note per string
        (a bipartite matching: a chord the six strings can't voice keeps
        root + top + whatever fits), flags (palm mute / clean). The voice
        id of a hit depends only on the part → voiceIds(part) == the ids
        the machine fires, whatever the tempo.
     2. assignStrings — a BEAM SEARCH over the hits (the marimbist's
        allocation in miniature): which string plays each note. Cost =
        carriage travel + position + chord compactness; drive limits
        (carriage move time, stamp re-strike gap) are hard-ish (a large
        penalty — a dense import still gets a fingering, never a crash).
        Run twice so the loop seam is consistent (the second pass starts
        from where the first ended).
     3. per string: the stamp lane (laneClock) and the carriage keyframes
        (lift → slide → hover → press, compressed only if the budget is
        short, never late, never a teleport). The mute bar's keyframes.
   Time is the only state: stampAt / carriageAt / muteAt / ringAt are
   pure functions of songTime.
   ============================================================ */
import { noteNum } from '../../engine.js';
import { laneClock, wrapP, firstAt, lastIndex } from '../clock.js';
import { makeId } from './voice.js';

/* ---- the guitar (geometry is FIXED — never a function of the part) ---- */
export const OPEN     = [40, 45, 50, 55, 59, 64];   // E2 A2 D3 G3 B3 E4 — standard tuning, low → high
export const STRINGS  = OPEN.length;
export const MAX_FRET = 20;
export const LO = OPEN[0], HI = OPEN[STRINGS - 1] + MAX_FRET;   // E2 … C6
export const NUT_X    = -6.0;                       // local x of the nut
export const SCALE_L  = 11.6;                       // nut → bridge (the scale length)
export const BRIDGE_X = NUT_X + SCALE_L;
/* the strike points run on a SLANT (like a slanted bridge pickup): treble nearest the bridge. From the
   audience's eye the six stamps then stand side by side, never behind one another. */
export const STAMP_DX = .27;
export const stampX   = s => BRIDGE_X - 1.05 - STAMP_DX * (5 - s);   // per string: ~9–19 % of the scale from the bridge
export const STAMP_X  = stampX(2.5);                // the forge's centre line (at z = 0)
export const MUTE_X   = BRIDGE_X - .5;              // the palm-mute bar's line on the strings
export const STR_DZ   = .46;                        // string spacing (z)
export const STRING_Y = .2;                         // string centre-line height above the board top
export const FRET_H   = .07;                        // fret wire height above the board top
export const HEAD_R   = .18;                        // the stamp's marble head
export const MUTE_R   = .085;                       // the felt bar's radius
export const HOOK_W   = .3;                         // the carriage hook's width (z)
export const strZ     = s => (s - (STRINGS - 1) / 2) * STR_DZ;   // low E at the back (−z), high E toward the audience
export const gauge    = s => [.05, .044, .037, .03, .025, .021][s];  // string radius: wound lows are fat
export const strTop   = s => STRING_Y + gauge(s);
export const fretX    = f => NUT_X + SCALE_L * (1 - Math.pow(2, -f / 12));
/** where the hook presses for fret f: just behind the fret wire (toward the nut), like a fingertip */
export const pressX   = f => f <= 0 ? fretX(.35) : fretX(f) - .32 * (fretX(f) - fretX(f - 1));
/** the vibrating length for a note on string s: fret wire → bridge, ∝ 1/f — the pitch IS the geometry */
export const vibLen   = (m, s) => BRIDGE_X - fretX(m - OPEN[s]);

/* ---- the stamp (drop hammer) ---- */
export const V_IN    = 12;          // impact speed (u/s), every strike — dynamics live in the glow + the gain, never the geometry
export const E       = .55;         // restitution: the rebound keeps e of it; the solenoid supplies the rest
export const H_PARK  = 1.3;         // the latch height (head underside above the string top)
export const T_PARK  = .5;          // a gap longer than this parks on the latch
export const T_UP    = .24;         // parked gaps: rise to the latch …
export const T_DN    = .24;         // … and drive down from it
export const MIN_GAP = .06;         // the stamp's fastest honest re-strike on one string (s)

/* ---- the fret carriage ---- */
export const A_CAR   = 2600;        // carriage drive limit (u/s², cosine-eased move) — a chromatic power-chord walk at 8ths @ 220 fits
export const SETTLE  = .015;        // pressed and still this long before the strike
export const T_LIFT  = .02;         // hook lift / press time
export const MIN_HOLD = .02;        // pressed at least this long after the strike
export const LIFT_Y  = .13;         // hook travel above its pressing pose
export const moveT   = dx => { const a = Math.abs(dx); return a < 1e-9 ? 0 : Math.PI * Math.sqrt(a / (2 * A_CAR)); };

/* ---- the mute bar ---- */
export const T_BAR   = .07;
export const BAR_EPS = .012;        // settled this long before/after the hit it serves

/* ---- the string ring (render + honesty) ---- */
export const RING_OPEN = 1.6, RING_MUTE = 16;     // visible ring decay (1/s)

/* ---- what the machine can play — for the orchestrator (src/midi/orchestra.js PART_SPEC) ----
   lo/hi      MIDI range (folds by octaves outside it)
   poly       notes per hit (one per string; a chord the strings can't voice is thinned to fit,
              root + top kept first). Power chords (2–4) are the idiom.
   gap        fastest re-strike of ONE string (s) — a same-pitch chug at ≥ .13 s is comfortable;
              ≥ .06 s is honest (the stamp's fastest hop); denser is accepted but clamps nothing —
              the stamp just hops lower
   ioi        fastest onset-to-onset on the machine (s) — different strings are independent lanes
   maxEvents  hits (chords count once) solved per loop; extras are dropped (latest first)
   strings    the lanes
   flags      ':m' palm mute, ':c' clean amp (GM 27) — on the note: 'E2:m'; or durBeats ≤ MUTE_BEATS */
export const MUTE_BEATS = .3;
export const PART_LIMITS = Object.freeze({
  lo: LO, hi: HI, center: 52, poly: STRINGS, polyIdiom: 4, gap: MIN_GAP, gapComfort: .13, ioi: 0,
  maxEvents: 640, strings: STRINGS, openStrings: OPEN, maxFret: MAX_FRET, muteBeats: MUTE_BEATS,
  programs: [27, 28, 29, 30], flags: { mute: ':m', clean: ':c' },
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const fold = m => { while (m < LO) m += 12; while (m > HI) m -= 12; return m; };
const cands = m => { const c = []; for (let s = 0; s < STRINGS; s++){ const f = m - OPEN[s]; if (f >= 0 && f <= MAX_FRET) c.push(s); } return c; };

/* ---- 1. the HITS (tempo-free) ------------------------------------------------ */
/** part → [{beat, notes:[midi] (asc), id, vel, durBeats, mute, clean, dropped}] sorted by beat.
    Events within 1/96 beat are one hit. Never throws on junk: unparseable notes are skipped. */
export function normalizeHits(part, { maxHits = PART_LIMITS.maxEvents } = {}){
  const ev = [];
  for (const e of part || []){
    if (!Array.isArray(e) || !Number.isFinite(e[0])) continue;
    const [beat, raw, vel = 1, dur = 0] = e;
    const [nm, fl = ''] = String(raw ?? '').split(':');
    let m;
    try { m = noteNum(nm); } catch (_){ m = NaN; }
    if (!Number.isFinite(m)) continue;
    ev.push({ beat, m: fold(m), vel: Number.isFinite(vel) ? Math.max(.05, Math.min(1, vel)) : 1,
              dur: Number.isFinite(dur) ? Math.max(0, dur) : 0, mute: fl.includes('m'), clean: fl.includes('c') });
  }
  ev.sort((a, b) => a.beat - b.beat || a.m - b.m);
  const hits = [];
  for (const e of ev){
    const h = hits[hits.length - 1];
    if (h && e.beat - h.beat < 1 / 96) h.ev.push(e);
    else hits.push({ beat: e.beat, ev: [e] });
  }
  const out = hits.slice(0, maxHits).map(h => {
    const ms = [...new Set(h.ev.map(e => e.m))].sort((a, b) => a - b);
    const keep = voiceable(ms);
    const notes = ms.filter(m => keep.has(m));
    const durs = h.ev.map(e => e.dur);
    const mute = h.ev.some(e => e.mute) || (durs.every(d => d > 0) && Math.max(...durs) <= MUTE_BEATS);
    const clean = h.ev.some(e => e.clean);
    return { beat: h.beat, notes, vel: Math.max(...h.ev.map(e => e.vel)), durBeats: Math.max(...durs), mute, clean,
             dropped: ms.length - notes.length, id: makeId(notes.map(midiName), { mute, clean }) };
  });
  return out.filter(h => h.notes.length);
}
/* which notes of a chord the six strings can voice at once (one per string): augmenting-path
   matching in priority order — root, top, then the rest low → high */
function voiceable(ms){
  const order = ms.length > 1 ? [ms[0], ms[ms.length - 1], ...ms.slice(1, -1)] : ms;
  const owner = new Array(STRINGS).fill(-1), keep = new Set();
  const tryAdd = (m, seen) => {
    for (const s of cands(m)){
      if (seen.has(s)) continue;
      seen.add(s);
      if (owner[s] < 0 || tryAdd(owner[s], seen)){ owner[s] = m; return true; }
    }
    return false;
  };
  for (const m of order){ if (keep.size >= STRINGS) break; if (tryAdd(m, new Set())) keep.add(m); }
  return keep;
}

/** The ids the machine will fire for a part (= main's pre-render list). Tempo-free. */
export function voiceIdsFor(part){ return [...new Set(normalizeHits(part).map(h => h.id))]; }

/* ---- 2. STRING ASSIGNMENT (beam search) --------------------------------------- */
const W_TRAVEL = .4, W_FRET = .035, W_SPAN = .06, W_SPREAD = .6, W_JUMP = .5, W_OPENIN = .7, BIG = 60, BEAM = 10;

/** every injective note → string map for a hit (notes asc) */
function assignments(notes){
  const out = [], cur = new Array(notes.length), used = new Array(STRINGS).fill(false);
  const rec = k => {
    if (k === notes.length){ out.push(cur.slice()); return; }
    for (const s of cands(notes[k])){ if (used[s]) continue; used[s] = true; cur[k] = s; rec(k + 1); used[s] = false; }
  };
  rec(0);
  return out;
}

export function stepCost(st, hit, asg, t){
  let c = 0, viol = 0;
  const fr = [];
  for (let k = 0; k < asg.length; k++){
    const s = asg[k], f = hit.notes[k] - OPEN[s];
    if (t - st.last[s] < MIN_GAP - 1e-9) viol++;
    if (f > 0){
      const X = pressX(f);
      if (Number.isFinite(st.car[s])){
        const d = Math.abs(X - st.car[s]);
        c += W_TRAVEL * d;
        if (moveT(d) > (t - SETTLE - T_LIFT) - st.free[s] + 1e-9) viol++;
      } else if (Number.isFinite(st.pos)) c += W_TRAVEL * .5 * Math.abs(X - st.pos);
      c += W_FRET * f;
      fr.push(f);
    } else if (st.free[s] > t - SETTLE + 1e-9) viol++;     // an open string needs its hook lifted in time
  }
  // a chord with fretted notes reads (and plays) as a SHAPE: an open string above a fretted root breaks it
  if (fr.length) for (let k = 1; k < asg.length; k++) if (hit.notes[k] - OPEN[asg[k]] === 0) c += W_OPENIN;
  if (fr.length > 1){ const sp = Math.max(...fr) - Math.min(...fr); c += W_SPAN * sp + (sp > 4 ? 1 : 0); }
  if (asg.length > 1){ const lo = Math.min(...asg), hi = Math.max(...asg); c += W_SPREAD * (hi - lo + 1 - asg.length); }
  if (fr.length && Number.isFinite(st.pos)){
    const mx = fr.reduce((a, f) => a + pressX(f), 0) / fr.length;
    if (Math.abs(mx - st.pos) > 2.5) c += W_JUMP;            // a big position shift costs a little extra
  }
  return { c: c + BIG * viol, viol };
}
function stepState(st, hit, asg, t){
  const car = st.car.slice(), free = st.free.slice(), last = st.last.slice();
  let sx = 0, nf = 0;
  for (let k = 0; k < asg.length; k++){
    const s = asg[k], f = hit.notes[k] - OPEN[s];
    last[s] = t;
    if (f > 0){ car[s] = pressX(f); free[s] = t + MIN_HOLD + T_LIFT; sx += car[s]; nf++; }
  }
  return { car, free, last, pos: nf ? sx / nf : st.pos };
}
function beamPass(hits, init){
  let beam = [{ cost: 0, viol: 0, st: init, path: [] }];
  for (const h of hits){
    const opts = h._asg;
    const next = [];
    for (const b of beam) for (const a of opts){
      const { c, viol } = stepCost(b.st, h, a, h.t);
      next.push({ cost: b.cost + c, viol: b.viol + viol, b, a });
    }
    next.sort((x, y) => x.cost - y.cost);
    const seen = new Set(), nb = [];
    for (const n of next){
      const st = stepState(n.b.st, h, n.a, h.t);
      const key = st.car.map(x => Number.isFinite(x) ? x.toFixed(3) : '-').join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      nb.push({ cost: n.cost, viol: n.viol, st, path: n.b.path.concat([n.a]) });
      if (nb.length >= BEAM) break;
    }
    beam = nb;
  }
  return beam[0];
}

/* ---- 3. the SOLVE ------------------------------------------------------------- */
/** part + timing → the machine. R = { hits, strings[6], bar, P, stats }.
    hits[k] = {…normalizeHits, t (loop-local, wrapped), asg: [{m, s, f}], dur (s, the sounding time —
    for the voice's live release)}. */
export function solveRiff(part, { rollT = 2.6, beat = .5, P = 20 } = {}){
  let hits = normalizeHits(part).map(h => ({ ...h, t: wrapP(rollT + h.beat * beat, P) }));
  hits.sort((a, b) => a.t - b.t);
  // two hits landing on the same wrapped instant (a beat and its loop twin) → keep the first
  hits = hits.filter((h, i) => i === 0 || h.t - hits[i - 1].t > 1e-6);
  for (const h of hits){
    h._asg = assignments(h.notes);
    h.durS = h.durBeats * beat;
  }
  const init = { car: new Array(STRINGS).fill(NaN), free: new Array(STRINGS).fill(-Infinity),
                 last: new Array(STRINGS).fill(-Infinity), pos: NaN };
  let best = hits.length ? beamPass(hits, init) : { path: [], viol: 0, st: init };
  if (hits.length){                                        // the seam: start where the loop ends
    const st = best.st;
    const wrapped = { car: st.car.slice(), free: st.free.map(x => x - P), last: st.last.map(x => x - P), pos: st.pos };
    const second = beamPass(hits, wrapped);
    if (second) best = second;
  }
  hits.forEach((h, k) => { h.asg = best.path[k].map((s, j) => ({ m: h.notes[j], s, f: h.notes[j] - OPEN[s] })); delete h._asg; });

  const strings = Array.from({ length: STRINGS }, (_, s) => buildString(s, hits, P));
  // a hit's sounding time = the shortest of its strings' (a lifted hook / the next stamp chokes it)
  hits.forEach(h => {
    let d = Infinity;
    for (const a of h.asg){ const S = strings[a.s], e = S.ev.find(x => x.hit === h); if (e) d = Math.min(d, e.sound); }
    h.dur = Math.min(d, 4);
  });
  const bar = buildBar(hits, P);
  const stats = { hits: hits.length, viol: best.viol, dropped: hits.reduce((a, h) => a + h.dropped, 0),
                  carOver: strings.reduce((a, S) => a + S.over, 0) };
  return { hits, strings, bar, P, stats };
}

/* one string: its events, its stamp lane, its carriage keyframes */
function buildString(s, hits, P){
  const ev = [];
  for (const h of hits) for (const a of h.asg) if (a.s === s)
    ev.push({ t: h.t, f: a.f, X: a.f > 0 ? pressX(a.f) : null, hit: h, vel: h.vel, mute: h.mute, durS: h.durS });
  ev.sort((a, b) => a.t - b.t);
  const S = { s, ev, P, n: ev.length, L: laneClock(ev.map(e => e.t), P), over: 0 };
  S.keys = carriageKeys(S);
  return S;
}

/* carriage keyframes for one string: [{t, x, p}] (p = 1 pressed on the fret, 0 lifted), cosine-eased
   between, cyclic over P. Per consecutive pair (k → next event) a canonical budget — hold, lift,
   move, press, settle — compressed by σ ≤ 1 only if the gap is short (σ < 1 is a drive overrun,
   counted in S.over). The hook is ALWAYS pressed at a fretted strike and lifted at an open one. */
function carriageKeys(S){
  const { ev, P, n } = S;
  const fretted = ev.map((e, k) => k).filter(k => ev[k].X !== null);
  const park = pressX(0);
  if (!fretted.length){
    ev.forEach((e, k) => { let g = (k + 1 < n ? ev[k + 1].t : ev[0].t + P) - e.t; if (g <= 1e-12) g += P;
      e.sound = e.durS > 0 ? Math.min(e.durS, g) : g; });
    return [{ t: 0, x: park, p: 0 }];
  }
  const next = k => (k + 1) % n;
  const gapTo = (k, j) => { let g = ev[j].t - ev[k].t; if (g <= 1e-12) g += P; return g; };
  const nextFretted = k => { for (let i = 1; i <= n; i++){ const j = (k + i) % n; if (ev[j].X !== null) return j; } return k; };
  // per pair: is it pressed-through (same fret, rings on), and its compression σ
  const pair = ev.map((e, k) => {
    const j = next(k), g = gapTo(k, j), nx = ev[j];
    const fr = e.X !== null, fn = nx.X !== null;
    const through = fr && fn && Math.abs(nx.X - e.X) < 1e-9 && !(e.durS > 0 && e.durS < g - SETTLE);
    let need = 0;
    if (through) need = 0;
    else {
      if (fr) need += MIN_HOLD + T_LIFT;
      if (fn) need += T_LIFT + SETTLE + (fr ? moveT(nx.X - e.X) : 0);
      else need += SETTLE;
    }
    const sig = need > 0 ? Math.min(1, .98 * g / need) : 1;
    if (sig < 1) S.over++;
    return { j, g, through, sig };
  });
  const prevOf = k => (k - 1 + n) % n;
  const K = [];
  for (const k of fretted){
    const e = ev[k], pin = pair[prevOf(k)], pout = pair[k];
    const sIn = pin.sig, sOut = pout.sig;
    const a = e.t - SETTLE * sIn;                         // pressed + still from here …
    if (!pin.through || n === 1){ K.push({ t: a - T_LIFT * sIn, x: e.X, p: 0 }); K.push({ t: a, x: e.X, p: 1 }); }
    if (pout.through && n > 1) continue;                   // … and stays pressed into the next strike
    // the latest it may lift: the next event's needs (an open string: lifted by its settle; a fretted
    // one: lifted + moved before its press ramp)
    const j = pout.j, nx = ev[j], tj = e.t + pout.g;
    // … and the next FRETTED note's move (maybe across open strikes) must fit before its press ramp
    const m = nextFretted(k), Xm = ev[m].X, moving = Math.abs(Xm - e.X) > 1e-9;
    const pm = pair[prevOf(m)], tm = e.t + gapTo(k, m);
    const inStart = tm - SETTLE * pm.sig - T_LIFT * pm.sig;
    let lat = nx.X === null ? tj - SETTLE * sOut - T_LIFT * sOut
                            : tj - SETTLE * sOut - T_LIFT * sOut - moveT(nx.X - e.X) * sOut - T_LIFT * sOut;
    if (moving && m !== j) lat = Math.min(lat, inStart - moveT(Xm - e.X) - T_LIFT * sOut);
    let b = e.durS > 0 ? Math.min(e.t + e.durS, lat) : lat;
    b = Math.max(b, e.t + MIN_HOLD * sOut);
    e.liftAt = b;
    K.push({ t: b, x: e.X, p: 1 });
    K.push({ t: b + T_LIFT * sOut, x: e.X, p: 0 });
    // the move: early, then hover over the next fret
    if (moving){
      const w0 = b + T_LIFT * sOut, W = inStart - w0, need = moveT(Xm - e.X);
      let Dm = Math.min(W, Math.max(1.25 * need, Math.min(.1, W)));
      if (Dm < need - 1e-9) S.over++;
      Dm = Math.max(1e-4, Dm);
      K.push({ t: w0 + Dm, x: Xm, p: 0 });
    }
  }
  // the sounding time of each event: until its hook lifts (fretted), or the next strike on the string
  ev.forEach((e, k) => {
    const g = pair[k].g;
    if (e.X === null) e.sound = e.durS > 0 ? Math.min(e.durS, g) : g;
    else {
      let d = 0, kk = k;                                   // pressed-through notes ring on to the next lift
      while (pair[kk].through && n > 1 && d < P){ d += pair[kk].g; kk = pair[kk].j; if (kk === k) break; }
      e.sound = ev[kk].liftAt !== undefined ? d + (ev[kk].liftAt - ev[kk].t) : d + pair[kk].g;
      if (e.durS > 0) e.sound = Math.min(e.sound, e.durS);
    }
  });
  if (!K.length) return [{ t: 0, x: ev[fretted[0]].X, p: 1 }];   // one fret, pressed all loop (it rings on)
  K.sort((a, b) => a.t - b.t);
  return unroll(K, P);
}
/* keyframes of one loop → an unrolled, sorted track over ~[−P, 2P] (cyclic lookup by binary search) */
function unroll(K, P){
  const t0 = K[0].t;
  const base = K.map(k => ({ ...k, t: k.t - t0 }));       // shift so the loop's keys span [0, P)
  const all = [];
  for (const off of [-2, -1, 0, 1, 2]) for (const k of base) all.push({ t: k.t + t0 + off * P, x: k.x, p: k.p });
  return all;
}
const cosEase = u => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
function sampleKeys(K, t, P){
  // bring t near the middle copy
  const t0 = K[2 * (K.length / 5)].t;                      // first key of the middle (off = 0) copy
  let tt = t0 + wrapP(t - t0, P);
  let lo = 0, hi = K.length - 1;
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (K[m].t <= tt) lo = m; else hi = m - 1; }
  const a = K[lo], b = K[Math.min(K.length - 1, lo + 1)];
  if (b === a || b.t - a.t < 1e-12) return { x: a.x, p: a.p, vx: 0, vp: 0 };
  const u = (tt - a.t) / (b.t - a.t), e = cosEase(u);
  const de = Math.PI / 2 * Math.sin(Math.PI * u) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * e, p: a.p + (b.p - a.p) * e, vx: (b.x - a.x) * de, vp: (b.p - a.p) * de };
}

/** The fret carriage at songTime t: { x, p (1 = pressing on the fret), vx, vp, armed }.
    ARMED (before the string's first strike after `start`): it has already moved to that strike's
    fret and hovers, lifted, waiting — then the same press as every loop. */
export function carriageAt(S, t, start = -Infinity){
  if (t < start) t = start;
  if (S.keys.length === 1) return { x: S.keys[0].x, p: S.keys[0].p, vx: 0, vp: 0, armed: true };
  const first = S.n ? firstAt(S.L, start) : Infinity;
  if (t < first){
    const e0 = S.ev[S.L.s.indexOf(+wrapP(first, S.P).toFixed(9))] || S.ev[0];
    const lead = (e0.X !== null ? SETTLE + T_LIFT : SETTLE) + .002;
    if (t < first - lead){ const q = sampleKeys(S.keys, first - lead, S.P); return { x: q.x, p: q.p, vx: 0, vp: 0, armed: true }; }
  }
  return { ...sampleKeys(S.keys, t, S.P), armed: t < first };
}

/* ---- the stamp --------------------------------------------------------------- */
function herm(p0, m0, p1, m1, T, s){
  const u = Math.min(1, Math.max(0, s / T)), u2 = u * u, u3 = u2 * u;
  const y = p0 * (2 * u3 - 3 * u2 + 1) + T * m0 * (u3 - 2 * u2 + u) + p1 * (-2 * u3 + 3 * u2) + T * m1 * (u3 - u2);
  const d = p0 * (6 * u2 - 6 * u) + T * m0 * (3 * u2 - 4 * u + 1) + p1 * (-6 * u2 + 6 * u) + T * m1 * (3 * u2 - 2 * u);
  const dd = p0 * (12 * u - 6) + T * m0 * (6 * u - 4) + p1 * (-12 * u + 6) + T * m1 * (6 * u - 2);
  return { y, vy: d / T, ay: dd / (T * T) };
}
/** The stamp of string S at songTime t: { y (head underside above the string top, ≥ 0), vy, ay,
    mode: 'arc' | 'rise' | 'hold' | 'drive', i, since, until, gap, armed, abs }. */
export function stampAt(S, t, start = -Infinity){
  const L = S.L;
  if (!L.s.length) return { y: H_PARK, vy: 0, ay: 0, mode: 'hold', i: -1, since: Infinity, until: Infinity, gap: Infinity, armed: true, abs: -Infinity };
  if (t < start) t = start;
  const first = firstAt(L, start);
  if (t < first){                                          // ARMED: on the latch, then the same drive as any parked gap
    const until = first - t;
    const base = { i: -1, since: Infinity, until, gap: Infinity, armed: true, abs: -Infinity };
    if (until >= T_DN) return { ...base, y: H_PARK, vy: 0, ay: 0, mode: 'hold' };
    return { ...base, ...herm(H_PARK, 0, 0, -V_IN, T_DN, T_DN - until), mode: 'drive' };
  }
  const tau = wrapP(t, L.P), i = lastIndex(L.s, tau);
  const since = wrapP(tau - L.s[i], L.P), gap = L.gaps[i], until = gap - since;
  const base = { i, since, until, gap, armed: false, abs: t - since };
  const u0 = E * V_IN;
  if (gap <= T_PARK) return { ...base, ...herm(0, u0, 0, -V_IN, gap, since), mode: 'arc' };
  if (since < T_UP) return { ...base, ...herm(0, u0, H_PARK, 0, T_UP, since), mode: 'rise' };
  if (until > T_DN) return { ...base, y: H_PARK, vy: 0, ay: 0, mode: 'hold' };
  return { ...base, ...herm(H_PARK, 0, 0, -V_IN, T_DN, T_DN - until), mode: 'drive' };
}

/** The string's visible ring at songTime t (0..1, × the struck hit's loudness in the render):
    decays (fast under the mute bar), dies when the hook lifts, and is tapered to EXACTLY 0 by the
    next strike — the string is at rest at every contact. Also returns the vibrating span. */
export function ringAt(S, t, start = -Infinity){
  const p = stampAt(S, t, start);
  if (p.armed || p.i < 0) return { a: 0, x0: NUT_X, f: 0, i: -1, since: Infinity };
  const e = S.ev[p.i];
  const dec = e.mute ? RING_MUTE : RING_OPEN;
  const taper = Math.max(0, 1 - p.since / p.gap) ** 2;
  const life = Math.min(1, Math.max(0, (e.sound + .06 - p.since) / .06));   // choked by the lift (a short release)
  return { a: Math.exp(-dec * p.since) * taper * life, x0: fretX(e.f), f: e.f, i: p.i, since: p.since, mute: e.mute };
}

/* ---- the palm-mute bar --------------------------------------------------------- */
function buildBar(hits, P){
  const n = hits.length;
  if (!n) return { keys: [{ t: 0, x: 0, p: 0 }], hits, P, L: laneClock([], P) };
  const K = [];
  for (let k = 0; k < n; k++){
    const j = (k + 1) % n, a = hits[k], b = hits[j];
    if (a.mute === b.mute) continue;
    let g = b.t - a.t; if (g <= 1e-12) g += P;
    const D = Math.max(1e-4, Math.min(T_BAR, g - 2 * BAR_EPS));
    const t0 = a.mute ? a.t + BAR_EPS : a.t + g - BAR_EPS - D;   // lift right after a muted hit; land just before one
    K.push({ t: t0, x: 0, p: a.mute ? 1 : 0 }, { t: t0 + D, x: 0, p: b.mute ? 1 : 0 });
  }
  if (!K.length) K.push({ t: 0, x: 0, p: hits[0].mute ? 1 : 0 });
  K.sort((x, y) => x.t - y.t);
  return { keys: K.length === 1 ? K : unroll(K, P), hits, P, L: laneClock(hits.map(h => h.t), P) };
}
/** The mute bar at songTime t: { d (1 = down on the strings, 0 = up), vd }. Armed: holds the
    first hit's state. */
export function muteAt(B, t, start = -Infinity){
  if (t < start) t = start;
  if (B.keys.length === 1) return { d: B.keys[0].p, vd: 0 };
  const first = firstAt(B.L, start);
  if (t < first){ const j = (B.L.s.indexOf(+wrapP(first, B.P).toFixed(9)) + B.hits.length) % B.hits.length;
    return { d: B.hits[j].mute ? 1 : 0, vd: 0 }; }
  const q = sampleKeys(B.keys, t, B.P);
  return { d: q.p, vd: q.vp };
}

/** The HIT clock (chords): which hit we most recently left at songTime t (for the strike edge,
    the amp's cones, the glow). */
export function hitAt(R, t, start = -Infinity){
  const L = R.bar.L;
  if (!L.s.length) return { i: -1, since: Infinity, armed: true, abs: -Infinity };
  if (t < start) t = start;
  const first = firstAt(L, start);
  if (t < first) return { i: -1, since: Infinity, armed: true, abs: -Infinity, until: first - t };
  const tau = wrapP(t, L.P), i = lastIndex(L.s, tau), since = wrapP(tau - L.s[i], L.P);
  return { i, since, armed: false, abs: t - since, gap: L.gaps[i] };
}

/* ---- the pressed string's shape (render + the contact honesty) ----------------------------
   The hook's crossbar BOTTOM rides from CLEAR_UP above the string top (lifted, p = 0) down to
   the fret wire + the string's diameter (pressed, p = 1). Once it reaches the string it carries
   it: the string kinks into two straight runs, nut → hook → bridge (the crossbar never cuts in —
   the string's top under it IS the crossbar's bottom). */
export const CLEAR_UP = .1;
export const crossBottom = (s, p) => (strTop(s) + CLEAR_UP) + ((FRET_H + 2 * gauge(s)) - (strTop(s) + CLEAR_UP)) * p;
/** the kink depth under the hook (≥ 0) for a carriage pose c = {x, p} */
export const pressDepth = (s, c) => Math.max(0, strTop(s) - crossBottom(s, c.p));
/** how far the string's top is pushed down at x (≥ 0) by its carriage pose c */
export function stringDrop(s, x, c){
  const d = pressDepth(s, c);
  if (d <= 0 || x <= NUT_X || x >= BRIDGE_X) return 0;
  return x <= c.x ? d * (x - NUT_X) / (c.x - NUT_X) : d * (BRIDGE_X - x) / (BRIDGE_X - c.x);
}
/** the string top's height at the STAMP's strike point (board-top frame) — the contact surface */
export const strikeSurface = (s, c) => strTop(s) - stringDrop(s, stampX(s), c);
