/* ============================================================
   SINGING BOWL voice — pure DSP (no AudioContext). note → {samples, sr}.

   A RUBBED bronze/crystal bowl (the marble drives the rim for the whole
   note): three inharmonic modes at the classic singing-bowl ratios
   1 : 2.71 : 5.15 (+ a faint 8.3 touch-down shimmer),
   each split into TWO slightly detuned components so it BEATS slowly (the
   bowl is never perfectly round — the doublet "wah-wah" is the signature
   of a real one). Soft ~120 ms swell (the marble settles into the rim),
   a whisper of contact tick, then the driven modes HOLD (with a slow
   seeded rubbing grain) for SOUND_MAX s — the longest a note's orbit can
   last (solve.js clamps it) — so the sound never dies under a rolling
   marble. main's playVoice({dur}) releases it at the note's end.
   Low bowls get a gentle 2× partial so phone speakers (which roll off
   below ~200 Hz) still hear the pitch. Deterministic: seeded PRNG.
   ============================================================ */
import { noteHz } from '../../engine.js';
import { SOUND_MAX } from './solve.js';

const SR = 22050;
const LEN = 5.98;                                        // seconds rendered (contract: < 6 s)
const HOLD = SOUND_MAX;                                  // the rubbed tone holds full this long, then dies away

function mulberry32(a){
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const cache = new Map();
export function bowlVoice(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note);
  const n = Math.round(SR * LEN), out = new Float32Array(n);
  const low = f < 200;
  // [ratio, level, decay τ (s), beat Hz, doublet split (strong share)]
  // The marble RUBS the rim for the whole note, so the body modes are DRIVEN (τ ≫ the
  // note: they hold); only the strike shimmer of the touch-down rings away. Real
  // doublets are unequal → a gentle 20–50 % "wah", never a full null.
  const modes = [
    [1,    1.00, 40,  .45 + f / 1100, .72],
    [2.71, .40,  26,  .9 + f / 700,   .75],
    [5.15, .07,  30,  1.6,            .75],              // rubbed overtone, held low
    [5.15, .15,  1.6, 1.9,            .7],               // …plus the touch-down shimmer
    [8.3,  .05,  .8,  2.7,            .7],
  ];
  if (low) modes.push([2.0, .28, 30, .7, .75]);           // phone-speaker presence for the low bowls
  const rnd = mulberry32(noteHzSeed(f));
  const ph = modes.map(() => [rnd() * 6.283, rnd() * 6.283]);
  // the rubbing grain: a slow seeded random walk (±8 %, ~.2 Hz) on the driven modes, and a
  // gentle build as the marble settles into its groove (the rubbed bowl blooms)
  const KN = Math.ceil(LEN / 1.6) + 2, knots = Array.from({ length: KN }, () => rnd() * 2 - 1);
  const grain = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const x = i / (SR * 1.6), k = Math.floor(x), u = x - k, w = (1 - Math.cos(Math.PI * u)) / 2;
    const t = i / SR;
    grain[i] = (1 + .08 * (knots[k] * (1 - w) + knots[k + 1] * w)) * (.8 + .2 * (1 - Math.exp(-t / .9)));
  }
  const ATT = .11;
  // each component is a rotating phasor (no per-sample sin/exp: cheap enough to pre-render
  // a whole chord on song load, even on a phone)
  for (let m = 0; m < modes.length; m++){
    const [r, a, tau, bt, share] = modes[m];
    const fr = f * r;
    if (fr > SR * .45) continue;
    const driven = tau > 10;
    const decay = Math.exp(-1 / (SR * tau)), attK = Math.exp(-1 / (SR * ATT * (r > 1 ? .7 : 1)));
    for (let c = 0; c < 2; c++){
      const w = 6.283185307 * (fr + (c ? .5 : -.5) * bt) / SR;
      const cw = Math.cos(w), sw = Math.sin(w);
      let x = Math.cos(ph[m][c]), y = Math.sin(ph[m][c]), env = a * (c ? 1 - share : share), att = 1;
      for (let i = 0; i < n; i++){
        out[i] += env * (1 - att) * y * (driven ? grain[i] : 1);   // soft swell (1 − e^−t/ATT) × e^−t/τ
        const nx = x * cw - y * sw; y = x * sw + y * cw; x = nx;
        env *= decay; att *= attK;
        if ((i & 4095) === 0){ const k = 1 / Math.hypot(x, y); x *= k; y *= k; }   // keep the phasor on the circle
      }
    }
  }
  // contact tick: the marble meeting the rim — a tiny band-limited noise blip
  let lp = 0;
  for (let i = 0; i < SR * .03; i++){
    const t = i / SR;
    lp += (rnd() * 2 - 1 - lp) * .35;
    out[i] += lp * .06 * Math.exp(-t / .006);
  }
  // past HOLD the rubbing has stopped: a natural (fast-ish) ring-down to true zero.
  // (main's playVoice releases at the note's end anyway; this is the iOS-sample tail.)
  const h0 = Math.round(SR * HOLD);
  for (let i = h0; i < n; i++){
    const x = (i - h0) / (n - 1 - h0);
    out[i] *= Math.exp(-x * 3) * (1 - x * x);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = (low ? .78 : .7) / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= k;
  const v = { samples: out, sr: SR };
  cache.set(note, v);
  return v;
}
const noteHzSeed = f => Math.round(f * 1000) ^ 0x5bd1e995;
