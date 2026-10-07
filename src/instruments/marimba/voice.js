/* ============================================================
   MARIMBA VOICE — pure DSP. note → { samples: Float32Array, sr }.
   Deterministic (seeded PRNG), no AudioContext.

   A real rosewood marimba bar is tuned so its bending modes sit at
   1 : 4 : 10 (the "tuned 4th partial" is two octaves up; the third
   mode is tuned near 10×). The brass resonator under the bar is a
   quarter-wave tube tuned to the FUNDAMENTAL, so it swells a beat
   after the strike and sustains it — that is the marimba's warmth.
   The yarn mallet (here: a marble) adds a soft, quick knock.
   Higher bars ring shorter. Dry — no echo (wet: false).

   Two baked velocity LAYERS per note (id 'E5' and 'E5|h'): a harder
   strike is not just louder, it is BRIGHTER — more 4th/10th partial and
   more knock (a real marimba's timbre opens up with force). The layers
   are peak-matched; loudness still comes from vel on the live path.
   ============================================================ */
import { noteHz, noteNum } from '../../engine.js';
import { voiceCache } from '../voicecache.js';

export const SR = 44100;

function mulberry32(a){
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const cache = voiceCache();   // (bounded to the song in use — ../voicecache.js)

/** Velocity → layer id (the hard layer above .75). */
export const layerId = (note, vel) => vel > .75 ? note + '|h' : note;

export function marimbaVoice(id){
  if (cache.has(id)) return cache.get(id);
  const [note, layer] = id.split('|');
  const hard = layer === 'h';
  const f = noteHz(note), m = noteNum(note);
  const rank = Math.min(1, Math.max(0, (m - 48) / 36));     // C3 → 0 … C6 → 1
  const ring = 1.15 - .62 * rank;                            // fundamental decay time constant (s)
  const dur = Math.min(3.0, ring * 3.6 + .15);
  const FADE = .35;                                          // a natural-sounding release, not a gate
  const N = (SR * dur) | 0, s = new Float32Array(N);
  const nyq = SR * .45;
  const rnd = mulberry32(m * 7919 + 17 + (hard ? 101 : 0));

  // bar modes: [ratio, amp, decay rate (1/s)]
  // the fundamental is two-stage: a quick strike component that drops ~6 dB in the
  // first 150 ms, then the long bloom (with the resonator below) — the marimba envelope
  const B = hard ? 1.4 : 1;
  const modes = [
    [1,     .45,                  1 / ring],
    [1,     .17,                  6],
    [3.99,  (.30 - .1 * rank) * B, 3.2 / ring],              // the tuned 4th partial
    [9.93,  .07 * B,              9 / ring],                 // the faint 10×
  ].filter(p => f * p[0] < nyq);
  // a hair of inharmonic spread in the upper modes (real bars are never perfect)
  const ph = modes.map(() => rnd() * .4); ph[1] = ph[0];          // the two fundamental stages share a phase

  // mallet knock: lowpassed noise, a few ms
  let lp = 0;
  const lpA = Math.min(.9, 2 * Math.PI * (1800 + 2600 * rank) / SR);
  const knockT = .006;

  for (let n = 0; n < N; n++){
    const t = n / SR;
    const atk = Math.min(1, t / .0012);
    let y = 0;
    for (let k = 0; k < modes.length; k++){
      const [r, a, d] = modes[k];
      y += a * Math.exp(-t * d) * Math.sin(2 * Math.PI * f * r * t + ph[k]);
    }
    y *= atk;
    // resonator: the tube rings up at the fundamental (a soft swell) and holds it a bit longer
    const resEnv = (1 - Math.exp(-t / .018)) * Math.exp(-t / (ring * 1.25));
    y += .34 * resEnv * Math.sin(2 * Math.PI * f * t + .3);
    // a whisper of the 2nd harmonic from the tube's coupling — helps phone speakers find the bass
    if (rank < .5) y += .05 * (1 - 2 * rank) * resEnv * Math.sin(4 * Math.PI * f * t);
    // the knock
    if (t < knockT * 4){
      lp += lpA * ((rnd() * 2 - 1) - lp);
      y += (hard ? .8 : .5) * lp * Math.exp(-t / knockT);
    }
    // release fade so the tail ends at exactly zero
    const tail = (dur - t) / FADE;
    if (tail < 1) y *= Math.max(0, tail) ** 2;
    s[n] = y;
  }
  let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(s[n]));
  const kN = (.82 - .1 * rank) / Math.max(peak, 1e-6);
  for (let n = 0; n < N; n++) s[n] *= kN;
  const out = { samples: s, sr: SR };
  cache.set(id, out);
  return out;
}
