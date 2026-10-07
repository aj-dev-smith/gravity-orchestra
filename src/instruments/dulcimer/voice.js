/* ============================================================
   MARBLE GRAND voice — pure DSP, deterministic (seeded noise), no
   AudioContext. Ported from AJ's clawd-o-matic (web/plug/keys.js, MIT):
   the worklet's real-time piano + tine e-piano, rendered offline here.

   PIANO (id 'C4', soft layer 'C4:p') — a MODAL stiff string:
   · up to 14 partials at f_k = k·f0·√(1 + B·k²) (stiffness stretches
     the overtones; B grows up the keyboard);
   · amplitudes k^−(1.75 − .95·hardness): a harder hammer is brighter;
   · the 7th and 14th partials ×.35 — the hammer strikes 1/7 of the way
     along the string (solve.js STRIKE_U: the same 1/7 the render uses),
     where those modes have a node and barely get excited;
   · TWO-STAGE decay per partial (a fast "prompt" sound + a slow
     "aftersound"), higher partials dying first;
   · a detuned unison twin on partials 1–2 (+.9 / −.7 cents): the slow
     beat of a real double-strung note;
   · the hammer itself: 5 ms of felt-dulled noise.
   The DAMPER is the live path's `dur` release (onStrike dur = the note's
   hold — the felt dropping on the string). The iOS sample path, which can't
   release early, plays the strike's DURATION BUCKET ('C4~1': this render
   with the damper's drop baked in at .5 / 1 / 2 s — ../sustain.js).

   TINE E-PIANO (id 'C4:e', 'C4:e:p') — keys.js ep(): 1:1 FM with a bright
   bark at the strike settling to a mellow bell, a 13.9× tine partial for
   the first few tens of ms, two-stage decay, a touch of tanh drive when
   you dig in. Same strings, same machine — a timbre flag on the event.

   Oscillators: the 2cos(w) recurrence (no per-sample trig: every unique id
   is baked at song load). FM needs phase modulation → a sine table.
   ============================================================ */
import { noteNum } from '../../engine.js';
import { splitBucket, cutHold, relFor } from '../sustain.js';

export const SR = 32000;
export const PEAK = .8;
const HARD = .85, SOFTV = .42;              // the two baked velocity layers
const SOFT_TRIM = .78;                       // the soft piano layer's baked level (≈ −2.2 dB; see grandVoice)

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
/** render length by register: bass rings longer (cosine-faded to exactly 0) */
export const durFor = m => Math.max(1.6, Math.min(4.2, 4.2 - (m - 36) * .042));

function lcg(seed){ let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function piano(m, vel, N, out, R){
  const f0 = mtof(m), B = 1.2e-4 * Math.pow(2, (m - 60) / 24);
  const ts = Math.max(.6, Math.min(14, 14 * Math.pow(2, -(m - 21) / 18)));
  const parts = [];
  for (let k = 1; k <= 14; k++){
    const f = f0 * k * Math.sqrt(1 + B * k * k);
    if (f > SR * .45) break;
    const a = Math.pow(k, -(1.75 - .95 * vel)) * (k === 7 || k === 14 ? .35 : 1);
    const tk = ts / (1 + .32 * (k - 1));
    parts.push({ f, af: a * .55, as: a * .45, tk });
    if (k <= 2) parts.push({ f: f * Math.pow(2, (k === 1 ? .9 : -.7) / 1200), af: a * .55 * .6, as: a * .45 * .6, tk });
  }
  // all partials advanced together, sample-outer (state in registers-ish typed arrays); the
  // envelopes step once per BLK samples (exact: the per-block factor is df^BLK) and are
  // linearly interpolated inside the block — inaudible, and ~3× cheaper than per-sample
  const K = parts.length, BLK = 16;
  const C = new Float64Array(K), Y1 = new Float64Array(K), Y2 = new Float64Array(K);
  const AF = new Float64Array(K), AS = new Float64Array(K), DF = new Float64Array(K), DS = new Float64Array(K);
  parts.forEach((p, j) => {
    const w = 2 * Math.PI * p.f / SR, ph = j * 1.31;
    C[j] = 2 * Math.cos(w); Y1[j] = Math.sin(ph - w); Y2[j] = Math.sin(ph - 2 * w);
    AF[j] = p.af; AS[j] = p.as;
    DF[j] = Math.exp(-BLK / (p.tk * .16 * SR)); DS[j] = Math.exp(-BLK / (p.tk * SR));
  });
  const E0 = new Float64Array(K), E1 = new Float64Array(K);
  for (let b = 0; b < N; b += BLK){
    for (let j = 0; j < K; j++){ E0[j] = AF[j] + AS[j]; AF[j] *= DF[j]; AS[j] *= DS[j]; E1[j] = (AF[j] + AS[j] - E0[j]) / BLK; }
    const n = Math.min(BLK, N - b);
    for (let q = 0; q < n; q++){
      let acc = 0;
      for (let j = 0; j < K; j++){
        const y = C[j] * Y1[j] - Y2[j]; Y2[j] = Y1[j]; Y1[j] = y;
        acc += y * (E0[j] + E1[j] * q);
      }
      out[b + q] += acc;
    }
  }
  // the hammer: a few ms of felt-dulled noise
  const hk = .15 + .6 * vel, nT = Math.round(.005 * SR);
  let lp = 0;
  for (let i = 0; i < nT; i++){ lp += hk * (R() - lp); out[i] += lp * .35 * vel * vel * (1 - i / nT); }
}

const TAB = 4096, SIN = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) SIN[i] = Math.sin(2 * Math.PI * i / TAB);
const sinT = ph => { ph -= Math.floor(ph); const x = ph * TAB, i = x | 0, f = x - i; return SIN[i] + (SIN[i + 1] - SIN[i]) * f; };

function epiano(m, vel, N, out){
  const f0 = mtof(m), fc = f0 / SR;
  const fb2 = f0 * 13.9 < SR * .45 ? f0 * 13.9 / SR : 0;
  const hi = Math.max(0, Math.min(1, (m - 48) / 48));
  const I0 = vel * (2.2 - 1.2 * hi), Ik = Math.exp(-1 / (.14 * SR));
  let Ie = 1, Ib = .2 * vel * vel;
  const Ibk = Math.exp(-1 / (.035 * SR));
  const ts = 3.8 * Math.pow(2, -(m - 48) / 26);
  let af = .4, as = .6;
  const df = Math.exp(-1 / (.4 * SR)), ds = Math.exp(-1 / (ts * SR));
  const drv = 1 + 2.4 * Math.max(0, vel - .55), dn = Math.tanh(drv);
  let pc = 0, pb = 0;
  for (let i = 0; i < N; i++){
    pc += fc; if (pc >= 1) pc -= 1;
    Ie *= Ik;
    let x = sinT(pc + I0 * (.25 + .75 * Ie) * sinT(pc) / (2 * Math.PI));
    if (fb2){ pb += fb2; if (pb >= 1) pb -= 1; Ib *= Ibk; x += sinT(pb) * Ib; }
    const e = af + as; af *= df; as *= ds;
    out[i] = Math.tanh(x * e * vel * drv) / dn;
  }
}

const ID = /^([A-G]#?\d)((?::[a-z])*)$/;
const TAIL = .34;                            // the render's raised-cosine tail (the last third)
/** the seconds an id's render rings before its own tail fades it — a damper later than this is moot,
    so a hold nearer it than any rung fires the bare id (../sustain.js bucketOf) */
export function nativeHold(id){
  const k = String(splitBucket(id).base).match(ID);
  const m = k ? noteNum(k[1]) : 60, ep = k ? k[2].includes(':e') : false;
  return durFor(m) * (ep ? .85 : 1) * (1 - TAIL);
}
const DAMP_REL = .3;                         // the felt landing: ≈ the live path's τ .12 release
const cache = new Map();
/** id = pitch [':e' tine e-piano] [':p' soft layer] [~hold: the DAMPER drops at hold s — a duration
    bucket, the iOS sample's baked note-off]  →  { samples: Float32Array, sr } */
export function grandVoice(id){
  if (cache.has(id)) return cache.get(id);
  const bk = splitBucket(id);
  if (bk.hold){
    const r = { samples: cutHold(grandVoice(bk.base).samples, SR, bk.hold, relFor(bk.hold, DAMP_REL)), sr: SR };
    cache.set(id, r);
    return r;
  }
  const k = String(id).match(ID);
  const m = k ? noteNum(k[1]) : 60;
  const flags = k ? k[2] : '';
  const ep = flags.includes(':e'), soft = flags.includes(':p'), vel = soft ? SOFTV : HARD;
  const N = Math.round(SR * durFor(m) * (ep ? .85 : 1));
  const out = new Float32Array(N);
  if (ep) epiano(m, vel, N, out); else piano(m, vel, N, out, lcg(hash(String(id))));
  // attack ramp (no click), raised-cosine tail over the last third, exactly 0 at the end
  const a = Math.round(SR * .0015), z = Math.round(N * TAIL);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  for (let i = 0; i < z; i++) out[N - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / z);
  let peak = 0;
  for (let i = 0; i < N; i++){ const x = Math.abs(out[i]); if (x > peak) peak = x; }
  // the soft PIANO layer is baked quieter: peak-normalising a dark, hammer-less render would make it
  // LOUDER (higher RMS) than the hard layer, so at the vel .6 crossover a softer key sounded louder.
  // At SOFT_TRIM the crossover is monotone (and the iOS bank, which ignores el.volume, keeps a real p).
  const gain = (soft && !ep ? PEAK * SOFT_TRIM : PEAK) / (peak || 1);
  for (let i = 0; i < N; i++) out[i] *= gain;
  out[N - 1] = 0;
  const r = { samples: out, sr: SR };
  cache.set(id, r);
  return r;
}
