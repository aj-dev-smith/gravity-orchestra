/* ============================================================
   BOW WHEEL voice — pure DSP (no AudioContext). note → {samples, sr}.

   A bowed string, after AJ's overdub `core.strings` (Music Stands), cut
   down to what a pre-rendered sample can carry:
     BOWS     a bowed string moves in a sawtooth (Helmholtz motion) — three
              band-limited (polyBLEP) saws a few cents apart (the wheel bows
              the string and its two sympathetic neighbours in the box), each
              with its OWN delayed vibrato (arrives after ~.25 s, 5.1–6 Hz,
              ±~11 cents — solve.js's VIB_HZ/VIB_ONSET drive the visible
              shimmer from the same numbers) and its own slow drift.
     BOW      a resonant low-pass that follows the bow's level (a swell gets
              brighter as it bites), plus rosin: hiss on the bow, a scratch
              at the bite.
     BODY     the box's wood: a hollow (~280 Hz), the main wood resonance
              (~500 Hz) and the bridge hill (~2.8 kHz), scaled down for the
              low strings (cello / bass bodies are bigger).
   The note holds full for HOLD_MAX (solve.js clamps every stroke to it, so
   the visible press never outlives the sound), then the bow lifts: a short
   release to exactly 0. main's playVoice({dur}) releases the live path at
   the stroke's end; the iOS sample path plays the stroke's DURATION BUCKET
   ('C4~0.5' / '~1' / '~2' — this render cut at that hold with the bow-lift
   baked in, ../sustain.js), so a short stroke stops short there too. Control-rate
   (16-sample) pitch/filter updates keep a song's whole id set cheap to bake.
   Deterministic: seeded PRNG only.
   ============================================================ */
import { noteHz, noteNum } from '../../engine.js';
import { HOLD_MAX } from './solve.js';
import { splitBucket, cutHold, relFor } from '../sustain.js';
import { voiceCache } from '../voicecache.js';

export const SR = 22050;
const REL = .42;                                         // bow-lift release after HOLD_MAX (s)
export const LEN = HOLD_MAX + REL;                       // 4.32 s

function mulberry32(a){
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const blep = (q, d) => {                                 // polyBLEP residual for a rising saw that wraps at q = 0
  if (q < d){ const x = q / d; return x + x - x * x - 1; }
  if (q > 1 - d){ const x = (q - 1) / d; return x * x + x + x + 1; }
  return 0;
};
/* RBJ biquad (direct form I) — peaking EQ */
function peak(f, q, dB){
  const A = Math.pow(10, dB / 40), w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + al / A;
  return { b0: (1 + al * A) / a0, b1: -2 * c / a0, b2: (1 - al * A) / a0, a1: -2 * c / a0, a2: (1 - al / A) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
const run = (b, x) => { const y = b.b0 * x + b.b1 * b.x1 + b.b2 * b.x2 - b.a1 * b.y1 - b.a2 * b.y2; b.x2 = b.x1; b.x1 = x; b.y2 = b.y1; b.y1 = y; return y; };

const cache = voiceCache();   // (bounded to the song in use — ../voicecache.js)
export function bowVoice(note){
  if (cache.has(note)) return cache.get(note);
  const bk = splitBucket(note);
  if (bk.hold){                                          // a DURATION BUCKET ('C4~1'): the bow lifts at `hold`
    const v = { samples: cutHold(bowVoice(bk.base).samples, SR, bk.hold, relFor(bk.hold, REL)), sr: SR };
    cache.set(note, v);
    return v;
  }
  const f0 = noteHz(note), n = Math.round(SR * LEN), m = noteNum(note);
  const out = new Float32Array(n);
  const rnd = mulberry32((m * 2654435761) ^ 0x9e3779b9);
  const NP = 3, DET = [-5.5, .8, 6.2];
  const ph = [], vph = [], vrate = [], vdep = [], drift = [], dly = [], atk = [];
  for (let j = 0; j < NP; j++){
    ph.push(rnd()); vph.push(rnd()); vrate.push(5.1 + .9 * rnd()); vdep.push(9 + 4 * rnd());
    drift.push((rnd() * 2 - 1) * 1.5);
    dly.push(j ? Math.round((.006 + .02 * rnd()) * SR) : 0);   // the players don't start together
    atk.push(.06 + .04 * rnd());
  }
  // body: bigger boxes for the low strings
  const bs = m < 48 ? .5 : m < 60 ? .72 : 1;
  const body = [peak(280 * bs, 1.4, -2.5), peak(520 * bs, 1.1, 4), peak(2800 * Math.max(.8, bs), .9, 4.5), peak(7000, .7, -6)];
  // bow low-pass (Chamberlin/Simper SVF, resonant), state per sample, coefficients per block
  let l1 = 0, l2 = 0, fa1 = 1, fa2 = 0, fa3 = 0;
  const K_SVF = 1 / .7;
  const setLP = fc => { const gg = Math.tan(Math.PI * Math.min(fc, SR * .45) / SR); fa1 = 1 / (1 + gg * (gg + K_SVF)); fa2 = gg * fa1; fa3 = gg * fa2; };
  let ns = (m * 977) ^ 0x6b1d, ny = 0;
  const env = new Float64Array(NP), dt = new Float64Array(NP);
  let hpX = 0, hpY = 0;
  const holdN = Math.round(SR * HOLD_MAX);
  for (let i0 = 0; i0 < n; i0 += 16){
    const t = i0 / SR;
    // control rate: pitch (vibrato + drift), bow level, filter
    let e = 0;
    const vibA = Math.min(1, Math.max(0, (t - .25) / .5));
    for (let j = 0; j < NP; j++){
      const on = t - dly[j] / SR;
      const target = on <= 0 ? 0 : (1 - Math.exp(-on / atk[j])) * (.86 + .14 * (1 - Math.exp(-on / 1.1)));
      env[j] = target;
      const cents = DET[j] + drift[j] * Math.sin(.31 * t + j) + vibA * vdep[j] * Math.sin(2 * Math.PI * (vph[j] + vrate[j] * t));
      dt[j] = f0 * Math.pow(2, cents / 1200) / SR;
      e += target;
    }
    e /= NP;
    setLP(Math.max(260, f0 * (2.2 + 9 * Math.sqrt(e + 1e-4))));
    const nzA = .018 * e + .1 * Math.exp(-t / .035) * (t > 0 ? 1 : 0);   // rosin hiss + the bite's scratch
    const end = Math.min(n, i0 + 16);
    for (let i = i0; i < end; i++){
      let y = 0;
      for (let j = 0; j < NP; j++){
        let q = ph[j] + dt[j]; if (q >= 1) q -= 1; ph[j] = q;
        y += (2 * q - 1 - blep(q, dt[j])) * env[j];
      }
      y *= .42;
      ns = (Math.imul(ns, 1664525) + 1013904223) | 0;
      const w = ns * 4.656612873077393e-10;
      ny += (w - ny) * .35;                              // a soft hiss
      hpY = .97 * (hpY + ny - hpX); hpX = ny;            // …high-passed
      const x = y + hpY * nzA;
      const v3 = x - l2, v1 = fa1 * l1 + fa2 * v3, v2 = l2 + fa2 * l1 + fa3 * v3;
      l1 = 2 * v1 - l1; l2 = 2 * v2 - l2;
      let s = v2;
      for (let b = 0; b < 4; b++) s = run(body[b], s);
      out[i] = s;
    }
  }
  // dc-block, then the bow lifts: release to EXACTLY zero
  let px = 0, py = 0;
  for (let i = 0; i < n; i++){ const x = out[i]; py = x - px + .995 * py; px = x; out[i] = py; }
  for (let i = holdN; i < n; i++){
    const x = (i - holdN) / (n - 1 - holdN);
    out[i] *= Math.exp(-x * 4) * (1 - x * x);
  }
  out[n - 1] = 0;
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  const k = .82 / (pk || 1);
  for (let i = 0; i < n; i++) out[i] *= k;
  const v = { samples: out, sr: SR };
  cache.set(note, v);
  return v;
}
