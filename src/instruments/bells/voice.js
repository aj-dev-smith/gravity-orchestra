/* ============================================================
   TUBULAR BELL voice — pure DSP, deterministic (seeded noise).

   A chime tube is a free–free bar: its bending modes sit at
   f_n ∝ (2n+1)², i.e. 9 : 25 : 49 : 81 : 121 : 169 : 225. The note you
   HEAR (the "strike tone") is a virtual pitch: modes 4, 5, 6 fall at
   almost exactly 2 : 3 : 4 of a missing fundamental, and the ear fills
   it in. So we place mode 4 at 2·f, and every other mode follows from
   the (2n+1)² law — the result is the real tubular-bell timbre: a clear
   pitch with a cloud of inharmonic shimmer above and a low hum below.

   Higher modes decay faster; each mode is a slowly-beating PAIR (a real
   tube is never perfectly round), and a short bright noise "tink" from the
   marble's impact sits on the attack. Long ring (~4.4 s), cosine-faded to zero.
   ============================================================ */
import { noteHz } from '../../engine.js';

export const SR = 32000;
export const DUR = 4.4;
export const FADE = 1.5;                             // raised-cosine tail (the wet echo carries the rest)

/* mode n → (ratio to the strike-tone pitch, amplitude, decay τ — the e-folding time, s) */
const MODES = [
  [2, .10, 2.0],   //  25/40.5 — the low hum (quiet)
  [3, .12, 1.8],   //  49/40.5 — a sharp minor third above: kept low so it colours, not muddies
  [4, .62, 1.55],   //  81/40.5 = 2.000  ┐
  [5, .48, 1.2],   // 121/40.5 ≈ 2.988  ├ the strike tone (virtual pitch = f)
  [6, .34, .85],   // 169/40.5 ≈ 4.173  ┘
  [7, .16, .5],    // 225/40.5 — sparkle
  [8, .07, .3],   // 289/40.5
].map(([n, a, tau]) => [(2 * n + 1) ** 2 / 40.5, a, tau]);

function rng(seed){ let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

const cache = new Map();
export function bellVoice(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note), N = Math.round(SR * DUR);
  const out = new Float32Array(N);
  const nyq = SR / 2 - 400;
  MODES.forEach(([ratio, amp, tau], m) => {
    const fm = f * ratio;
    if (fm > nyq) return;
    // high notes ring a touch shorter (real tubes: shorter tube, more radiation per cycle)
    const tauN = tau * Math.pow(523 / Math.max(f, 120), .25);
    const beat = .25 + .15 * m;                          // the beating pair's split (Hz): a slow shimmer
    const w1 = 2 * Math.PI * (fm - beat / 2) / SR, w2 = 2 * Math.PI * (fm + beat / 2) / SR;
    const ph = m * 1.7;
    const dec = Math.exp(-1 / (tauN * SR));
    // two sine oscillators by the 2cos(w) recurrence (no per-sample trig: song load stays fast)
    const c1 = 2 * Math.cos(w1), c2 = 2 * Math.cos(w2);
    let a1 = Math.sin(ph - w1), b1 = Math.sin(ph - 2 * w1), a2 = Math.sin(ph * .3 - w2), b2 = Math.sin(ph * .3 - 2 * w2);
    let env = amp / 1.22;
    for (let i = 0; i < N && env > 1e-5; i++){
      const y1 = c1 * a1 - b1, y2 = c2 * a2 - b2;
      b1 = a1; a1 = y1; b2 = a2; a2 = y2;
      out[i] += env * (y1 + .22 * y2);               // UNEQUAL pair: a gentle shimmer, never a full null
      env *= dec;
    }
  });
  // the marble's TINK: a few ms of bright, band-limited noise + a high partial click
  const R = rng(f * 1000);
  let lp = 0, prev = 0;
  const nT = Math.round(SR * .03);
  for (let i = 0; i < nT; i++){
    const x = R();
    lp += .55 * (x - lp);                                // gentle low-pass…
    const hp = lp - prev; prev = lp;                     // …then a high-pass: a bright band
    out[i] += .5 * hp * Math.exp(-i / (SR * .006));
  }
  // attack: a 2 ms ramp (no click); tail: a raised-cosine fade over the last FADE seconds
  const a = Math.round(SR * .002), z = Math.round(SR * FADE);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  for (let i = 0; i < z; i++) out[N - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / z);
  out[N - 1] = 0;                                      // exactly silent (not −0)
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = .82 / (peak || 1);
  for (let i = 0; i < N; i++) out[i] *= gain;
  const r = { samples: out, sr: SR };
  cache.set(note, r);
  return r;
}
