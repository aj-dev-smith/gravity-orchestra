/* ============================================================
   MUSIC BOX — the tine voice. PURE DSP (no AudioContext), deterministic.

   A steel cantilever tine rings almost as a pure sine. Its 2nd bending
   mode sits INHARMONICALLY high (≈ 6.27× for a bare cantilever; a tuned
   comb tine with its tip ground lands nearer 5.9×) and dies fast — that
   glassy overtone at the attack is what makes a music box a music box.
   On top: the pin's TICK (a few ms of bright, seeded noise + a very high
   partial), and a whisper of detuned chorus (the twin-ish shimmer of a
   comb where neighbouring tines sympathetically ring) — a FIXED-Hz beat, so
   high notes shimmer at the same slow rate as low ones instead of warbling.
   Higher tines are shorter and stiffer → shorter ring.
   ============================================================ */
import { noteHz } from '../../engine.js';
import { voiceCache } from '../voicecache.js';

export const SR = 44100;
const cache = voiceCache();   // (bounded to the song in use — ../voicecache.js)

/* tiny seeded PRNG (mulberry32) — deterministic noise for the pin tick */
function rng(seed){
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function renderTine(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note);
  const ref = Math.sqrt(523.25 / f);                      // 1 at C5, .5 at C7
  const dur = Math.min(2.9, Math.max(1.1, 2.7 * ref));    // seconds of ring
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const tau1 = dur / 4.6;                                 // fundamental decay (≈ −40 dB by the end)
  const f2 = f * 5.93, tau2 = tau1 / 4.5;                 // 2nd bending mode: glassy, quick
  const fTick = Math.min(f * 11.4, SR * .42);             // the pin's tick partial
  const nyq = SR * .45;
  const rand = rng(Math.round(f * 7));
  const TW = Math.PI * 2;
  let hp = 0, prevN = 0;
  for (let i = 0; i < n; i++){
    const s = i / SR;
    const atk = Math.min(1, s / .0015);                   // 1.5 ms: hard, not clicky-broken
    const e1 = Math.exp(-s / tau1);
    let x = Math.sin(TW * f * s) * e1
          + .18 * Math.sin(TW * (f + .75) * s + .9) * Math.exp(-s / (tau1 * .8))    // chorus: a fixed .75 Hz beat (shimmer, not warble, at any pitch)
          + .05 * Math.sin(TW * f * 2 * s) * Math.exp(-s / (tau1 * .5));             // comb-plate warmth
    if (f2 < nyq) x += .2 * Math.sin(TW * f2 * s + .3) * Math.exp(-s / tau2);
    x += .12 * Math.sin(TW * fTick * s) * Math.exp(-s / .012);
    // the pin's tick: seeded white noise, high-passed (one-pole difference), ~3 ms
    const w = rand() * 2 - 1;
    hp = .6 * (hp + w - prevN); prevN = w;
    x += .35 * hp * Math.exp(-s / .0018);
    const fade = Math.min(1, (n - i) / (SR * .06));       // clean tail
    out[i] = x * atk * fade;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = .78 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  const v = { samples: out, sr: SR };
  cache.set(note, v);
  return v;
}
