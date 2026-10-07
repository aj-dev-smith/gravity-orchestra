/* ============================================================
   POGO BASS — the pure math. No THREE scene, no DOM, no audio.

   An Animusic "Pogo Sticks" homage for ELECTRIC / SYNTH BASS (GM 33–39).

   THE MACHINE — a four-string electric bass laid on a stand (tilted toward
   the audience). Lanes = STRINGS (E1 A1 D2 G2). Every string owns, and only
   ever touches, its own:
     · FRET CARRIAGE — a brass slider in a groove under the string whose
       chrome hook reaches over it. It LIFTS, slides to the fret and PRESSES
       the string onto the fret wire before the note. The pitch IS the
       position: the wires stand at the luthier's x = L·(1 − 2^(−f/12)), so
       the vibrating length (fret → bridge) is exactly ∝ 1/f. An open string
       = the hook stays lifted. (The Riff Forge's carriage, re-solved for a
       long-scale four-string — same keyframe grammar, same honesty.)
     · POGO STICK — a chrome pogo stick standing on the string over the
       pickup. It BOUNCES on the string: every landing of its rubber foot is
       the pluck (a slap, really), exactly on the beat. Its flight is HONEST
       BALLISTICS under the room's gravity — the drum machine's dribble lane
       (engine.js dribbleLane / dribbleAt): the flight between strikes is the
       solved vertical arc for the gap (apex = |G|·gap²/8 — a held note is a
       tall hop, a 220-bpm 8th chug a jittering buzz), a gap longer than
       DT_MAX rises to a MAGNET on the overhead gantry (arrives at zero
       speed, held, released DT_MAX/2 before the beat: the free fall lands
       on it). The bounce is LOSSY (restitution E): the pogo's PUMP — an air
       piston between its foot and its body, the visible energy source —
       fires at every landing and supplies Δv = vOut − E·vIn (it glows with
       it; the body visibly kicks up off the spring).

   THE SOLVE (all up front, in build):
     1. normalizeHits(part) — TEMPO-FREE: simultaneous events → one HIT (a
        double stop), notes folded into E1–G3, at most one note per string
        (bipartite matching: root + top first), articulation flags per note
        (':s' slap, ':p' pick, ':y' synth). The voice id is the NOTE + its
        flags → voiceIds(part) == the ids the machine fires, at any tempo.
     2. assignStrings — a BEAM SEARCH over the hits (the Riff Forge's
        fingering): which string plays each note. Cost = carriage travel +
        position + compactness; the drive limits (carriage move time, the
        pogo's MIN_GAP re-strike) are a large penalty — a dense import still
        gets a fingering, never a crash. Run twice so the loop seam agrees.
     3. per string: the pogo lane (dribbleLane), its pump amplitudes, the
        carriage keyframes (lift → slide → hover → press; compressed only if
        the budget is short — never late, never a teleport).
   Time is the only state: pogoAt / carriageAt / ringAt are pure fns of songTime.
   ============================================================ */
import { noteNum, dribbleLane, dribbleAt, firstStrike, G } from '../../engine.js';
import { laneClock, wrapP, firstAt, lastIndex } from '../clock.js';

/* ---- the bass (geometry is FIXED — never a function of the part) ---- */
export const OPEN     = [28, 33, 38, 43];           // E1 A1 D2 G2 — standard four-string tuning, low → high
export const STRINGS  = OPEN.length;
export const MAX_FRET = 15;
export const LO = 28, HI = 55;                      // E1 … G3 (the line folds by octaves into it)
export const NUT_X    = -6.4;                       // local x of the nut
export const SCALE_L  = 12.4;                       // nut → bridge (a long scale)
export const BRIDGE_X = NUT_X + SCALE_L;
/* the pogos stand on a SLANT (like a P-bass's split pickup): treble nearest the bridge. From the
   audience's eye the four sticks then stand side by side, never behind one another. */
export const STAMP_DX = .42;
export const stampX   = s => BRIDGE_X - 1.5 - STAMP_DX * (STRINGS - 1 - s);
export const STAMP_X  = stampX((STRINGS - 1) / 2);  // the gantry's centre line (at z = 0)
export const STR_DZ   = .62;                        // string spacing (z)
export const STRING_Y = .26;                        // string centre-line height above the board top
export const FRET_H   = .08;                        // fret wire height above the board top
export const HOOK_W   = .34;                        // the carriage hook's width (z)
export const strZ     = s => (s - (STRINGS - 1) / 2) * STR_DZ;   // low E at the back (−z), G toward the audience
export const gauge    = s => [.07, .06, .05, .042][s];           // round-wound: fat lows
export const strTop   = s => STRING_Y + gauge(s);
export const fretX    = f => NUT_X + SCALE_L * (1 - Math.pow(2, -f / 12));
/** where the hook presses for fret f: just behind the fret wire (toward the nut), like a fingertip */
export const pressX   = f => f <= 0 ? fretX(.35) : fretX(f) - .32 * (fretX(f) - fretX(f - 1));
/** the vibrating length of note m on string s: fret wire → bridge, ∝ 1/f — the pitch IS the geometry */
export const vibLen   = (m, s) => BRIDGE_X - fretX(m - OPEN[s]);

/* ---- the pogo ---- */
export const g        = -G.y;          // |gravity| (14.5) — the pogo flies honest ballistics
export const DT_MAX   = 1.0;           // a flight longer than this parks on the gantry magnet
export const H_MAG    = g * DT_MAX * DT_MAX / 8;   // the max apex: foot tip above the string when parked (≈ 1.81)
export const E        = .55;           // restitution of the rubber foot on a wound string
export const MIN_GAP  = .1;            // the pogo's fastest honest re-strike on one string (s): a .018 u buzz
export const FOOT_R   = .13;           // the rubber foot's radius (a hemisphere: its bottom = the tip)
export const PLUNGE   = .62;           // foot tip → the body's spring seat, at rest (the pump's stroke centre)
export const POGO_TOP = 2.35;          // foot tip → the steel top cap that meets the magnet (at rest)
export const BAR_Y    = 1.95;          // foot tip → the handlebar
export const PUMP_K   = .16;           // pump travel per unit Δv (u per u/s)
export const PUMP_MAX = .2;            // the pump's stroke limit (u): the spring never goes solid (5 turns × .04)
export const PUMP_T   = .16;           // the pump's kick lasts this long (or less in a dense run)

/* ---- the fret carriage ---- */
export const A_CAR   = 2600;        // carriage drive limit (u/s², cosine-eased move)
export const SETTLE  = .015;        // pressed and still this long before the strike
export const T_LIFT  = .02;         // hook lift / press time
export const MIN_HOLD = .02;        // pressed at least this long after the strike
export const LIFT_Y  = .14;         // hook travel above its pressing pose
export const moveT   = dx => { const a = Math.abs(dx); return a < 1e-9 ? 0 : Math.PI * Math.sqrt(a / (2 * A_CAR)); };

/* ---- the string ring (render + honesty) ---- */
export const RING_DECAY = 1.1;      // visible ring decay (1/s)

/* ---- what the machine can play — for the orchestrator (src/midi/orchestra.js PART_SPEC) ----
   lo/hi      MIDI range (folds by octaves outside it) — E1–G3
   poly       notes per hit the orchestrator should send (a bass line + the odd double stop);
              the machine itself voices up to `strings` (one per string)
   gap        fastest re-strike of ONE pitch (s): a same-pitch 8th chug at 220 bpm is .136 s ≥ gap
              (the pogo buzzes a .02 u hop). Faster repeats still play (they move to another
              string or just hop lower) — never a crash
   ioi        fastest onset-to-onset on the machine (s) — different strings are independent lanes
   maxEvents  hits (a double stop counts once) solved per loop; extras are dropped (latest first)
   flags      ':s' slap (GM 36/37), ':p' pick (GM 34), ':y' synth (GM 38/39) — on the note: 'E1:s' */
export const PART_LIMITS = Object.freeze({
  lo: LO, hi: HI, center: 38, poly: 2, gap: MIN_GAP, ioi: 0, voices: 1,
  maxEvents: 512, strings: STRINGS, openStrings: OPEN, maxFret: MAX_FRET,
  programs: [33, 34, 35, 36, 37, 38, 39], flags: { slap: ':s', pick: ':p', synth: ':y' },
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const fold = m => { while (m < LO) m += 12; while (m > HI) m -= 12; return m; };
const cands = m => { const c = []; for (let s = 0; s < STRINGS; s++){ const f = m - OPEN[s]; if (f >= 0 && f <= MAX_FRET) c.push(s); } return c; };

/* ---- the voice id grammar (shared with voice.js) ----
   'E1' fingered · 'E1:s' slap · 'E1:p' pick · 'E1:y' synth (one flag wins: s > y > p) */
export function flagOf(raw){
  const fl = String(raw ?? '').split(':')[1] || '';
  return fl.includes('s') ? 's' : fl.includes('y') ? 'y' : fl.includes('p') ? 'p' : '';
}
export const makeId = (m, flag = '') => midiName(m) + (flag ? ':' + flag : '');

/* ---- 1. the HITS (tempo-free) ------------------------------------------------ */
/** part → [{beat, notes:[midi] (asc), flags:[…] (per note), ids:[…], vel, durBeats, dropped}] sorted by
    beat. Events within 1/96 beat are one hit. Never throws on junk: unparseable notes are skipped. */
export function normalizeHits(part, { maxHits = PART_LIMITS.maxEvents } = {}){
  const ev = [];
  for (const e of part || []){
    if (!Array.isArray(e) || !Number.isFinite(e[0])) continue;
    const [beat, raw, vel = 1, dur = 0] = e;
    const nm = String(raw ?? '').split(':')[0];
    let m;
    try { m = noteNum(nm); } catch (_){ m = NaN; }
    if (!Number.isFinite(m)) continue;
    ev.push({ beat, m: fold(m), flag: flagOf(raw), vel: Number.isFinite(vel) ? Math.max(.05, Math.min(1, vel)) : 1,
              dur: Number.isFinite(dur) ? Math.max(0, dur) : 0 });
  }
  ev.sort((a, b) => a.beat - b.beat || a.m - b.m);
  const hits = [];
  for (const e of ev){
    const h = hits[hits.length - 1];
    if (h && e.beat - h.beat < 1 / 96) h.ev.push(e);
    else hits.push({ beat: e.beat, ev: [e] });
  }
  const out = hits.slice(0, maxHits).map(h => {
    const first = new Map();                              // (a folded duplicate keeps the first one's flag)
    for (const e of h.ev) if (!first.has(e.m)) first.set(e.m, e);
    const ms = [...first.keys()].sort((a, b) => a - b);
    const keep = voiceable(ms);
    const notes = ms.filter(m => keep.has(m));
    const flags = notes.map(m => first.get(m).flag);
    return { beat: h.beat, notes, flags, ids: notes.map((m, k) => makeId(m, flags[k])),
             vel: Math.max(...h.ev.map(e => e.vel)), durBeats: Math.max(...h.ev.map(e => e.dur)), dropped: ms.length - notes.length };
  });
  return out.filter(h => h.notes.length);
}
/* which notes of a chord the four strings can voice at once (one per string): augmenting-path
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
export function voiceIdsFor(part){ return [...new Set(normalizeHits(part).flatMap(h => h.ids))]; }

/* ---- 2. STRING ASSIGNMENT (beam search) --------------------------------------- */
const W_TRAVEL = .4, W_FRET = .03, W_SPAN = .06, W_SPREAD = .5, W_JUMP = .4, W_OPENIN = .5, W_STAY = .25, BIG = 60, BEAM = 10;

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
    // a bassist keeps a repeated note where it is (same string, same fret): the pogo just buzzes
    if (Number.isFinite(st.lastM[s]) && st.lastM[s] !== hit.notes[k] && t - st.last[s] < .2) c += W_STAY;
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
  if (fr.length) for (let k = 1; k < asg.length; k++) if (hit.notes[k] - OPEN[asg[k]] === 0) c += W_OPENIN;
  if (fr.length > 1){ const sp = Math.max(...fr) - Math.min(...fr); c += W_SPAN * sp + (sp > 4 ? 1 : 0); }
  if (asg.length > 1){ const lo = Math.min(...asg), hi = Math.max(...asg); c += W_SPREAD * (hi - lo + 1 - asg.length); }
  if (fr.length && Number.isFinite(st.pos)){
    const mx = fr.reduce((a, f) => a + pressX(f), 0) / fr.length;
    if (Math.abs(mx - st.pos) > 3) c += W_JUMP;
  }
  return { c: c + BIG * viol, viol };
}
function stepState(st, hit, asg, t){
  const car = st.car.slice(), free = st.free.slice(), last = st.last.slice(), lastM = st.lastM.slice();
  let sx = 0, nf = 0;
  for (let k = 0; k < asg.length; k++){
    const s = asg[k], f = hit.notes[k] - OPEN[s];
    last[s] = t; lastM[s] = hit.notes[k];
    if (f > 0){ car[s] = pressX(f); free[s] = t + MIN_HOLD + T_LIFT; sx += car[s]; nf++; }
  }
  return { car, free, last, lastM, pos: nf ? sx / nf : st.pos };
}
function beamPass(hits, init){
  let beam = [{ cost: 0, viol: 0, st: init, path: [] }];
  for (const h of hits){
    const next = [];
    for (const b of beam) for (const a of h._asg){
      const { c, viol } = stepCost(b.st, h, a, h.t);
      next.push({ cost: b.cost + c, viol: b.viol + viol, b, a });
    }
    next.sort((x, y) => x.cost - y.cost);
    const seen = new Set(), nb = [];
    for (const n of next){
      const st = stepState(n.b.st, h, n.a, h.t);
      const key = st.car.map(x => Number.isFinite(x) ? x.toFixed(3) : '-').join(',') + '|' + n.a.join(',');
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
/** part + timing → the machine. R = { hits, strings[4], P, stats }.
    hits[k] = {…normalizeHits, t (loop-local, wrapped), asg: [{m, s, f, id, flag}]}.
    strings[s] = { s, ev: [{t, f, X, id, flag, vel, durS, sound}], L (laneClock), D (dribbleLane),
                   pump: [A per strike], keys (carriage) }. */
export function solvePogo(part, { rollT = 2.6, beat = .5, P = 20 } = {}){
  let hits = normalizeHits(part).map(h => ({ ...h, t: +wrapP(rollT + h.beat * beat, P).toFixed(9) }));
  hits.sort((a, b) => a.t - b.t);
  hits = hits.filter((h, i) => i === 0 || h.t - hits[i - 1].t > 1e-6);   // a beat and its loop twin → the first
  for (const h of hits){ h._asg = assignments(h.notes); h.durS = h.durBeats * beat; }
  const init = { car: new Array(STRINGS).fill(NaN), free: new Array(STRINGS).fill(-Infinity),
                 last: new Array(STRINGS).fill(-Infinity), lastM: new Array(STRINGS).fill(NaN), pos: NaN };
  let best = hits.length ? beamPass(hits, init) : { path: [], viol: 0, st: init };
  if (hits.length){                                        // the seam: start where the loop ends
    const st = best.st;
    const wrapped = { car: st.car.slice(), free: st.free.map(x => x - P), last: st.last.map(x => x - P), lastM: st.lastM.slice(), pos: st.pos };
    const second = beamPass(hits, wrapped);
    if (second) best = second;
  }
  hits.forEach((h, k) => {
    h.asg = best.path[k].map((s, j) => ({ m: h.notes[j], s, f: h.notes[j] - OPEN[s], id: h.ids[j], flag: h.flags[j] }));
    delete h._asg;
  });
  const strings = Array.from({ length: STRINGS }, (_, s) => buildString(s, hits, P));
  const stats = { hits: hits.length, viol: best.viol, dropped: hits.reduce((a, h) => a + h.dropped, 0),
                  carOver: strings.reduce((a, S) => a + S.over, 0), parked: strings.reduce((a, S) => a + S.D.gaps.filter(x => x > DT_MAX).length, 0) };
  return { hits, strings, P, stats };
}

/* one string: its events, its pogo lane + pump, its carriage keyframes */
function buildString(s, hits, P){
  const ev = [];
  for (const h of hits) for (const a of h.asg) if (a.s === s)
    ev.push({ t: h.t, f: a.f, m: a.m, X: a.f > 0 ? pressX(a.f) : null, id: a.id, flag: a.flag, vel: h.vel, durS: h.durS });
  ev.sort((a, b) => a.t - b.t);
  const times = ev.map(e => e.t);
  const S = { s, ev, P, n: ev.length, L: laneClock(times, P), D: dribbleLane(times, P, { dtMax: DT_MAX }), over: 0 };
  // the PUMP: per strike, the travel that supplies the lossy bounce's missing speed (Δv = vOut − E·vIn);
  // the first strike after the count-in lands from the magnet at the full drop speed
  const D = S.D;
  S.dv = D.s.map((_, i) => D.vOut[i] - E * D.vIn[i]);
  S.pumpT = D.gaps.map(gp => Math.min(PUMP_T, .45 * Math.min(gp, DT_MAX)));
  S.keys = carriageKeys(S);
  return S;
}
const pumpAmp = dv => Math.max(-PUMP_MAX, Math.min(PUMP_MAX, PUMP_K * dv));

/* carriage keyframes for one string (the Riff Forge's grammar): [{t, x, p}] (p = 1 pressed on the
   fret, 0 lifted), cosine-eased between, cyclic over P. Per consecutive pair (k → next event) a
   canonical budget — hold, lift, move, press, settle — compressed by σ ≤ 1 only if the gap is short
   (σ < 1 is a drive overrun, counted in S.over). The hook is ALWAYS pressed at a fretted strike and
   lifted at an open one. */
function carriageKeys(S){
  const { ev, P, n } = S;
  const fretted = ev.map((e, k) => k).filter(k => ev[k].X !== null);
  const park = pressX(0);
  if (!fretted.length){
    ev.forEach((e, k) => { let g0 = (k + 1 < n ? ev[k + 1].t : ev[0].t + P) - e.t; if (g0 <= 1e-12) g0 += P;
      e.sound = e.durS > 0 ? Math.min(e.durS, g0) : g0; });
    return [{ t: 0, x: park, p: 0 }];
  }
  const next = k => (k + 1) % n;
  const gapTo = (k, j) => { let g0 = ev[j].t - ev[k].t; if (g0 <= 1e-12) g0 += P; return g0; };
  const nextFretted = k => { for (let i = 1; i <= n; i++){ const j = (k + i) % n; if (ev[j].X !== null) return j; } return k; };
  const pair = ev.map((e, k) => {
    const j = next(k), g0 = gapTo(k, j), nx = ev[j];
    const fr = e.X !== null, fn = nx.X !== null;
    const through = fr && fn && Math.abs(nx.X - e.X) < 1e-9 && !(e.durS > 0 && e.durS < g0 - SETTLE);
    let need = 0;
    if (!through){
      if (fr) need += MIN_HOLD + T_LIFT;
      if (fn) need += T_LIFT + SETTLE + (fr ? moveT(nx.X - e.X) : 0);
      else need += SETTLE;
    }
    const sig = need > 0 ? Math.min(1, .98 * g0 / need) : 1;
    if (sig < 1) S.over++;
    return { j, g: g0, through, sig };
  });
  const prevOf = k => (k - 1 + n) % n;
  const K = [];
  for (const k of fretted){
    const e = ev[k], pin = pair[prevOf(k)], pout = pair[k];
    const sIn = pin.sig, sOut = pout.sig;
    const a = e.t - SETTLE * sIn;
    if (!pin.through || n === 1){ K.push({ t: a - T_LIFT * sIn, x: e.X, p: 0 }); K.push({ t: a, x: e.X, p: 1 }); }
    if (pout.through && n > 1) continue;
    const j = pout.j, nx = ev[j], tj = e.t + pout.g;
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
    if (moving){
      const w0 = b + T_LIFT * sOut, W = inStart - w0, need = moveT(Xm - e.X);
      let Dm = Math.min(W, Math.max(1.25 * need, Math.min(.12, W)));
      if (Dm < need - 1e-9) S.over++;
      Dm = Math.max(1e-4, Dm);
      K.push({ t: w0 + Dm, x: Xm, p: 0 });
    }
  }
  ev.forEach((e, k) => {
    const g0 = pair[k].g;
    if (e.X === null) e.sound = e.durS > 0 ? Math.min(e.durS, g0) : g0;
    else {
      let d = 0, kk = k;
      while (pair[kk].through && n > 1 && d < P){ d += pair[kk].g; kk = pair[kk].j; if (kk === k) break; }
      e.sound = ev[kk].liftAt !== undefined ? d + (ev[kk].liftAt - ev[kk].t) : d + pair[kk].g;
      if (e.durS > 0) e.sound = Math.min(e.sound, e.durS);
    }
  });
  if (!K.length) return [{ t: 0, x: ev[fretted[0]].X, p: 1 }];   // one fret, pressed all loop
  K.sort((a, b) => a.t - b.t);
  return unroll(K, P);
}
function unroll(K, P){
  const t0 = K[0].t;
  const base = K.map(k => ({ ...k, t: k.t - t0 }));
  const all = [];
  for (const off of [-2, -1, 0, 1, 2]) for (const k of base) all.push({ t: k.t + t0 + off * P, x: k.x, p: k.p });
  return all;
}
const cosEase = u => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
function sampleKeys(K, t, P){
  const t0 = K[2 * (K.length / 5)].t;
  const tt = t0 + wrapP(t - t0, P);
  let lo = 0, hi = K.length - 1;
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (K[m].t <= tt) lo = m; else hi = m - 1; }
  const a = K[lo], b = K[Math.min(K.length - 1, lo + 1)];
  if (b === a || b.t - a.t < 1e-12) return { x: a.x, p: a.p, vx: 0, vp: 0 };
  const u = (tt - a.t) / (b.t - a.t), e = cosEase(u);
  const de = Math.PI / 2 * Math.sin(Math.PI * u) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * e, p: a.p + (b.p - a.p) * e, vx: (b.x - a.x) * de, vp: (b.p - a.p) * de };
}

/** The fret carriage at songTime t: { x, p (1 = pressing on the fret), vx, vp, armed }.
    ARMED (before the string's first strike after `start`): already at that strike's fret, hovering
    lifted — then the same press as every loop. */
export function carriageAt(S, t, start = -Infinity){
  if (t < start) t = start;
  if (S.keys.length === 1) return { x: S.keys[0].x, p: S.keys[0].p, vx: 0, vp: 0, armed: true };
  const first = S.n ? firstAt(S.L, start) : Infinity;
  if (t < first){
    const e0 = S.ev[lastIndex(S.L.s, wrapP(first + 1e-7, S.P))] || S.ev[0];
    const lead = (e0.X !== null ? SETTLE + T_LIFT : SETTLE) + .002;
    if (t < first - lead){ const q = sampleKeys(S.keys, first - lead, S.P); return { x: q.x, p: q.p, vx: 0, vp: 0, armed: true }; }
  }
  return { ...sampleKeys(S.keys, t, S.P), armed: t < first };
}

/* ---- the pogo ----------------------------------------------------------------- */
/** The pogo of string S at songTime t:
      y      its foot TIP above the string's strike surface (≥ 0; 0 = on the string)
      vy     its velocity
      pump   the pump's extension (body above foot, beyond PLUNGE): + kicks the body up
      vp     the pump's rate
      drive  the pump's working fraction (0..1, |Δv| of the strike it serves) — its glow
      mode   'arc' | 'hold' (on the gantry magnet) | 'drop' (released, falling)
      i, since, until, armed, abs
    The flight is engine.dribbleAt (honest ballistics). The pump fires only in the air: it is 0 at
    every contact and all the while the pogo hangs on its magnet. */
export function pogoAt(S, t, start = -Infinity){
  const D = S.D;
  if (!D.s.length) return { y: H_MAG, vy: 0, pump: 0, vp: 0, drive: 0, mode: 'hold', i: -1, since: Infinity, until: Infinity, armed: true, abs: -Infinity };
  if (t < start) t = start;
  const q = dribbleAt(D, t, start);
  const armed = q.i < 0;
  let pump = 0, vp = 0, drive = 0;
  if (!armed){
    // (the first strike after the count-in lands from the magnet: its vIn is the full drop speed)
    const dv = Math.abs(t - q.since - firstStrike(D, start)) < 1e-6 ? D.vOut[q.i] - E * g * DT_MAX / 2 : S.dv[q.i];
    const A = pumpAmp(dv), T = S.pumpT[q.i];
    if (q.since < T){
      const w = Math.PI / T;
      pump = A * Math.sin(w * q.since); vp = A * w * Math.cos(w * q.since);
      drive = Math.min(1, Math.abs(A) / PUMP_MAX) * Math.sin(Math.PI * q.since / T);
    }
  }
  return { y: Math.max(0, q.y), vy: q.vy, pump, vp, drive, mode: q.mode, i: q.i, since: q.since, until: q.until, armed,
           abs: armed ? -Infinity : t - q.since };
}
/** the pump's amplitude for strike i (for the tests + the render's glow) */
export const pumpOf = (S, i) => pumpAmp(S.dv[i]);
/** absolute time of the string's first strike at/after start */
export const firstPogo = (S, start) => firstStrike(S.D, start);

/** The string's visible ring at songTime t (0..1): decays, dies when the hook lifts, and is tapered
    to EXACTLY 0 by the next strike — the string is at rest at every contact. */
export function ringAt(S, t, start = -Infinity){
  const p = pogoAt(S, t, start);
  if (p.armed || p.i < 0) return { a: 0, x0: NUT_X, f: 0, i: -1, since: Infinity };
  const e = S.ev[p.i], gap = S.D.gaps[p.i];
  const taper = Math.max(0, 1 - p.since / gap) ** 2;
  const life = Math.min(1, Math.max(0, (e.sound + .06 - p.since) / .06));
  return { a: Math.exp(-RING_DECAY * p.since) * taper * life, x0: fretX(e.f), f: e.f, i: p.i, since: p.since };
}

/* ---- the pressed string's shape (render + the contact honesty) ---------------------------- */
export const CLEAR_UP = .1;
export const crossBottom = (s, p) => (strTop(s) + CLEAR_UP) + ((FRET_H + 2 * gauge(s)) - (strTop(s) + CLEAR_UP)) * p;
export const pressDepth = (s, c) => Math.max(0, strTop(s) - crossBottom(s, c.p));
export function stringDrop(s, x, c){
  const d = pressDepth(s, c);
  if (d <= 0 || x <= NUT_X || x >= BRIDGE_X) return 0;
  return x <= c.x ? d * (x - NUT_X) / (c.x - NUT_X) : d * (BRIDGE_X - x) / (BRIDGE_X - c.x);
}
/** the string top's height at the POGO's strike point (board-top frame) — the contact surface */
export const strikeSurface = (s, c) => strTop(s) - stringDrop(s, stampX(s), c);
/** the gantry magnet's face (board-top frame) over string s for a carriage pose c: exactly the parked
    pogo's top cap. It hangs from a sprung arm that rides the string's pickup saddle, so it keeps
    station over the struck surface as the fret carriage presses (≤ .05 u). */
export const magnetFace = (s, c) => strikeSurface(s, c) + H_MAG + POGO_TOP;
