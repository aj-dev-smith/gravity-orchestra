/* ============================================================
   RICOCHET voice — a CRYSTALLOPHONE / glass-plate ping. PURE DSP
   (no AudioContext), deterministic (seeded noise).

   A hung glass plate struck by a steel marble: a clear tuned
   fundamental, the free-plate's INHARMONIC upper modes (a bar-like
   2.76× and 5.40×, a plate-like 2.30× and 3.92× — that unresolved
   cluster above the pitch is what reads as "glass"), each a slowly
   beating unequal PAIR (a real plate is never perfectly symmetric →
   shimmer), higher modes dying faster. On the attack: the marble's
   bright TICK (a few ms of high-passed noise + a very high glint).
   ~2.2 s, raised-cosine tail; the melody's echo (wet) carries the rest.
   ============================================================ */
import { noteHz } from '../../engine.js';
import { voiceCache } from '../voicecache.js';

export const SR = 32000;
export const DUR = 2.2;
const FADE = .9;

/* [ratio to f, amplitude, decay τ (s), beat Hz of the pair] */
const MODES = [
  [1,    1.00, .95, .35],
  [2.0,  .16,  .55, .6],     // a whisper of tuned octave (crystallophone bars are tuned)
  [2.30, .22,  .42, .9],
  [2.76, .30,  .34, 1.3],
  [3.92, .16,  .22, 1.7],
  [5.40, .13,  .14, 2.3],
  [8.93, .06,  .07, 3.1],
];

function rng(seed){ let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

const cache = voiceCache();   // (bounded to the song in use — ../voicecache.js)
export function glassVoice(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note), N = Math.round(SR * DUR);
  const out = new Float32Array(N);
  const nyq = SR / 2 - 500;
  const ref = Math.pow(523.25 / Math.max(f, 100), .3);     // lower plates ring a touch longer
  MODES.forEach(([ratio, amp, tau, beat], m) => {
    const fm = f * ratio;
    if (fm > nyq) return;
    const tauN = tau * ref * (m === 0 ? 1.1 : 1);
    const w1 = 2 * Math.PI * (fm - beat / 2) / SR, w2 = 2 * Math.PI * (fm + beat / 2) / SR;
    const c1 = 2 * Math.cos(w1), c2 = 2 * Math.cos(w2);
    const ph = m * 2.1;
    let a1 = Math.sin(ph - w1), b1 = Math.sin(ph - 2 * w1), a2 = Math.sin(ph * .4 - w2), b2 = Math.sin(ph * .4 - 2 * w2);
    const dec = Math.exp(-1 / (tauN * SR));
    let env = amp;
    for (let i = 0; i < N && env > 1e-5; i++){
      const y1 = c1 * a1 - b1, y2 = c2 * a2 - b2;
      b1 = a1; a1 = y1; b2 = a2; a2 = y2;
      out[i] += env * (y1 + .3 * y2);                      // UNEQUAL pair: shimmer, never a full null
      env *= dec;
    }
  });
  // the marble's TICK: bright band-limited noise + a high glint
  const R = rng(Math.round(f * 977));
  let lp = 0, prev = 0;
  const nT = Math.round(SR * .02), fg = Math.min(f * 13.1, nyq), wg = 2 * Math.PI * fg / SR;
  for (let i = 0; i < nT; i++){
    lp += .6 * (R() - lp);
    const hp = lp - prev; prev = lp;
    out[i] += .45 * hp * Math.exp(-i / (SR * .004)) + .1 * Math.sin(wg * i) * Math.exp(-i / (SR * .006));
  }
  const a = Math.round(SR * .0015), z = Math.round(SR * FADE);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  for (let i = 0; i < z; i++) out[N - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / z);
  out[N - 1] = 0;
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = .8 / (peak || 1);
  for (let i = 0; i < N; i++) out[i] *= gain;
  const r = { samples: out, sr: SR };
  cache.set(note, r);
  return r;
}

/* the starter gate's CLINK (count-in only): a small steel mirror struck once — a short,
   bright, metallic tick (inharmonic, ~.45 s) — short and unpitched so it reads as hardware,
   not a note (it shares the instrument's wet routing: `wet` is per-instrument) */
let clink = null;
export function gateClink(){
  if (clink) return clink;
  const N = Math.round(SR * .45), out = new Float32Array(N);
  const parts = [[2450, .5, .09], [3910, .35, .06], [5870, .25, .04], [1630, .2, .12]];
  for (const [fq, a, tau] of parts){
    const w = 2 * Math.PI * fq / SR;
    for (let i = 0; i < N; i++) out[i] += a * Math.sin(w * i) * Math.exp(-i / (SR * tau));
  }
  const R = rng(4242);
  let lp = 0, prev = 0;
  for (let i = 0; i < SR * .01; i++){ lp += .7 * (R() - lp); const hp = lp - prev; prev = lp; out[i] += .5 * hp * Math.exp(-i / (SR * .002)); }
  const z = Math.round(SR * .1);
  for (let i = 0; i < z; i++) out[N - 1 - i] *= i / z;
  out[N - 1] = 0;
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < N; i++) out[i] *= .6 / (peak || 1);
  return (clink = { samples: out, sr: SR });
}

/* a RELAY mirror's TOCK: a dark obsidian plate struck by the steel marble — no pitch to
   speak of, just a soft, low, heavily damped knock (two stiff modes + a felted click),
   ~.25 s, so the seam's collisions are heard (visuals drive audio) without reading as notes */
let tock = null;
export function relayTock(){
  if (tock) return tock;
  const N = Math.round(SR * .26), out = new Float32Array(N);
  for (const [fq, a, tau] of [[310, .8, .045], [737, .35, .022], [1490, .12, .01]]){
    const w = 2 * Math.PI * fq / SR;
    for (let i = 0; i < N; i++) out[i] += a * Math.sin(w * i) * Math.exp(-i / (SR * tau));
  }
  const R = rng(1717);
  let lp = 0;
  for (let i = 0; i < SR * .008; i++){ lp += .25 * (R() - lp); out[i] += .4 * lp * Math.exp(-i / (SR * .0025)); }
  const a = Math.round(SR * .001), z = Math.round(SR * .06);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  for (let i = 0; i < z; i++) out[N - 1 - i] *= i / z;
  out[N - 1] = 0;
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < N; i++) out[i] *= .45 / (peak || 1);
  return (tock = { samples: out, sr: SR });
}
