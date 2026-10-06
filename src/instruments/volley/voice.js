/* ============================================================
   VOLLEY — the STEEL PAN voice. PURE DSP (no AudioContext),
   deterministic. note → { samples: Float32Array, sr }.

   A pan's note is a hammered dome of steel tuned so its first modes
   sit at HARMONIC ratios — 1 : 2 : 3 (the octave and the twelfth are
   tuned in by the tuner's hammer). That is what makes it sing like a
   bell that is somehow in tune with itself. Two signatures:
     · the OCTAVE BLOOM — the 2f mode is fed by the fundamental's own
       motion, so it swells a beat after the strike instead of starting
       at full strength;
     · the SHIMMER — a dome is never perfectly round; its fundamental is
       a near-degenerate pair a fraction of a hertz apart, and the two
       beat slowly against each other.
   The marble is a rubber-tipped stick: a soft, bright tick on top.
   High notes are small, stiff domes: they ring shorter.
   ============================================================ */
import { noteHz, noteNum } from '../../engine.js';

export const SR = 44100;
const cache = new Map();

function mulberry32(a){
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function steelpanVoice(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note), m = noteNum(note);
  const rank = Math.min(1, Math.max(0, (m - 48) / 40));    // C3 → 0 … E6 → 1
  const tau = .95 - .5 * rank;                               // fundamental decay (s)
  const dur = Math.min(2.6, tau * 2.9 + .25);
  const FADE = .25;
  const N = Math.round(dur * SR), out = new Float32Array(N), tick = new Float32Array(N);
  const nyq = SR * .45, TW = Math.PI * 2;
  const rnd = mulberry32(m * 7919 + 1013);
  const beat = .6 + 1.6 * rank;                              // the shimmer's beat (Hz): a quicker flutter up high
  const parts = [                                            // ratio, level, decay ×tau, bloom (s)
    [1, 1, 1, 0],
    [2, .62, .62, .045],                                     // the octave blooms in
    [3, .26, .4, .02],                                       // the tuned twelfth
    [4.02, .09, .26, 0],                                     // a faint, slightly sharp double octave
  ].filter(p => f * p[0] < nyq);
  const ph = parts.map(() => rnd() * TW);
  let lp = 0, hp = 0;
  for (let i = 0; i < N; i++){
    const s = i / SR;
    const atk = Math.min(1, s / .0015);
    let x = 0;
    parts.forEach(([r, a, k, bloom], j) => {
      const env = Math.exp(-s / (tau * k)) * (bloom ? 1 - Math.exp(-s / bloom) : 1);
      let osc = Math.sin(TW * f * r * s + ph[j]);
      if (j === 0) osc = .72 * osc + .28 * Math.sin(TW * (f + beat) * s + ph[j]);   // the near-degenerate pair
      x += a * env * osc;
    });
    // the stick: a short, bright tick (band-passed seeded noise, ~4 ms)
    const nz = rnd() * 2 - 1;
    lp += .35 * (nz - lp); hp = nz - lp;
    const rel = Math.min(1, (N - i) / (SR * FADE)), fade = .5 - .5 * Math.cos(Math.PI * rel);
    out[i] = x * atk * fade;
    tick[i] = (.6 * lp + .4 * hp) * Math.exp(-s / .004) * atk;
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gn = .78 / (peak || 1);
  let tot = 0;
  for (let i = 0; i < N; i++){ out[i] = (out[i] + tick[i] * .5) * gn; tot = Math.max(tot, Math.abs(out[i])); }
  if (tot > .9) for (let i = 0; i < N; i++) out[i] *= .9 / tot;
  const v = { samples: out, sr: SR };
  cache.set(note, v);
  return v;
}
