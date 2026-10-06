/* ============================================================
   TURNTABLE — the VIBRAPHONE voice. PURE DSP (no AudioContext),
   deterministic. note → { samples: Float32Array, sr }.

   A vibraphone bar is aluminium, undercut so its bending modes sit at
   1 : 4 : ~10 (the tuned "double octave" 4th partial is what makes a
   vibe sound like a vibe rather than a sine). The marble is a soft
   mallet: a short, dull knock under a clean, singing tone that rings
   for seconds (shorter up high — a shorter, stiffer bar loses energy
   faster). Under each bar a resonator tube swells the fundamental a
   beat after the strike.

   THE MOTOR: real vibes have a motor turning discs in the resonator
   tops — the TREMOLO, an amplitude wobble of the resonated fundamental.
   Here the turntable's motor is that motor: its tremolo is the record
   turning. (Baked at a fixed TREM_HZ — every note is pre-rendered once
   per song, so the tremolo can't track ω live; ~5 Hz is the classic
   vibes "medium" speed.)
   ============================================================ */
import { noteHz, noteNum } from '../../engine.js';

export const SR = 44100;
export const TREM_HZ = 5.2;
const cache = new Map();

function mulberry32(a){
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function vibesVoice(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note), m = noteNum(note);
  const rank = Math.min(1, Math.max(0, (m - 53) / 36));    // F3 → 0 … F6 → 1
  const tau = 1.05 - .55 * rank;                           // fundamental decay constant (s)
  const dur = Math.min(3.0, tau * 4.4 + .2);               // ≈ 2.9 s low … 2.4 s high (to ≈ −40 dB)
  const N = Math.round(dur * SR), out = new Float32Array(N);
  const nyq = SR * .45, TW = Math.PI * 2;
  const rnd = mulberry32(m * 9301 + 49297);
  const f4 = f * 3.98, f10 = f * 9.9;                      // tuned 4th partial, faint 10th
  const tau4 = tau / 3.2, tau10 = tau / 9;
  const ph4 = rnd() * TW, ph10 = rnd() * TW;
  let lp = 0;                                              // one-pole low-pass for the dull knock
  for (let i = 0; i < N; i++){
    const s = i / SR;
    const atk = Math.min(1, s / .002);
    // the resonator: the fundamental swells a touch after the strike (tube fills), and the
    // motor's discs open/close its mouth — the tremolo rides the RESONATED part only
    const swell = 1 - .35 * Math.exp(-s / .06);
    const trem = 1 - .32 * (.5 - .5 * Math.cos(TW * TREM_HZ * s));
    let x = Math.sin(TW * f * s) * Math.exp(-s / tau) * swell * trem;
    if (f4 < nyq) x += .22 * Math.sin(TW * f4 * s + ph4) * Math.exp(-s / tau4);
    if (f10 < nyq) x += .05 * Math.sin(TW * f10 * s + ph10) * Math.exp(-s / tau10);
    // the mallet: a soft knock (low-passed seeded noise, a few ms)
    lp += .18 * ((rnd() * 2 - 1) - lp);
    x += 1.4 * lp * Math.exp(-s / .006);
    const fade = Math.min(1, (N - i) / (SR * .08));
    out[i] = x * atk * fade;
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gn = .8 / (peak || 1);
  for (let i = 0; i < N; i++) out[i] *= gn;
  const v = { samples: out, sr: SR };
  cache.set(note, v);
  return v;
}
