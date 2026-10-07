/* ============================================================
   STRING BASS — the voice. Pure DSP, deterministic, no AudioContext.

   A heavy ball dropped on a thick wound string: Karplus–Strong for the
   string itself (a delay line one period long, a gentle lowpass loop
   filter, a per-pitch loss tuned to a ~2.2 s ring) excited by SEEDED
   noise that is lowpassed (a soft, round strike — the ball, not a pick)
   and comb-filtered at the strike position (centre-ish: odd harmonics lead,
   that hollow upright growl). On top: a sine fundamental + 2nd/3rd
   partials so the line still reads on a phone speaker (which rolls off
   below ~200 Hz), and a short low "thock" — the ball's mass landing.
   DRY: no echo baked (wet:false) — bass should punch, not smear.
   ============================================================ */
import { noteHz } from '../../engine.js';
import { voiceCache } from '../voicecache.js';

export const SR = 32000;
export const DUR = 2.6;
const T60 = 2.3;                       // ring time of the string (s)

function mulberry32(seed){
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const cache = voiceCache();   // (bounded to the song in use — ../voicecache.js)
export function bassVoice(note){
  if (cache.has(note)) return cache.get(note);
  const f = noteHz(note), sr = SR, N = (sr * DUR) | 0;
  const out = new Float32Array(N);

  // ---- Karplus–Strong string ----
  // loop = delay(M) → 2-tap average (½-sample delay) → loss ρ; period = M + ½
  const M = Math.max(2, Math.round(sr / f - .5));
  const rho = Math.exp(Math.log(.001) / (f * T60));        // −60 dB over T60
  const buf = new Float32Array(M);
  const rnd = mulberry32(0xB455 ^ Math.round(f * 100));
  // excitation: lowpassed noise (a soft round striker), comb at the strike point
  let lp = 0;
  const raw = new Float32Array(M);
  for (let k = 0; k < M; k++){ lp += .35 * ((rnd() * 2 - 1) - lp); raw[k] = lp; }
  const pk = Math.max(1, Math.round(M * .42));             // struck a bit off-centre
  let mean = 0;
  for (let k = 0; k < M; k++){ buf[k] = raw[k] - .85 * raw[(k + pk) % M]; mean += buf[k]; }
  mean /= M; for (let k = 0; k < M; k++) buf[k] -= mean;   // no DC thump in the loop
  let idx = 0, prev = 0;
  const ks = new Float32Array(N);
  for (let n = 0; n < N; n++){
    const x = buf[idx];
    const y = rho * (.5 * x + .5 * prev);                  // the loop filter: warm, slowly darkening
    prev = x; buf[idx] = y; ks[n] = x;
    idx = (idx + 1) % M;
  }
  let pkKS = 0; for (let n = 0; n < N; n++) pkKS = Math.max(pkKS, Math.abs(ks[n]));
  const ksG = .55 / Math.max(pkKS, 1e-6);

  // ---- body: a clean fundamental + audible upper partials (phone speakers) ----
  // Below ~90 Hz the fundamental and 2nd/3rd harmonics all sit under a phone's ~200 Hz
  // roll-off, so a low note leans harder on its upper partials (the ear rebuilds the
  // missing fundamental from them).
  const low = f < 90;
  const P = [[1, low ? .3 : .42, 1.5], [2.001, low ? .36 : .26, 2.2], [3.003, low ? .22 : .13, 3.4], [4.006, low ? .1 : .05, 6]];
  if (low) P.push([5.01, .13, 6.5], [6.015, .09, 8], [7.02, .05, 10], [8.03, .035, 12]);
  const att = .006 * sr;
  // the ball meeting a wound string: a short bright metallic "zing" (bandpassed seeded noise ~2.5 kHz)
  const zr = mulberry32(0x21A6 ^ Math.round(f * 10));
  const bw = 2 * Math.PI * 2500 / sr, bq = .5 * Math.sin(bw) / 4;   // RBJ bandpass, Q = 4
  const b0 = bq, b2 = -bq, a0 = 1 + bq, a1 = -2 * Math.cos(bw), a2 = 1 - bq;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const zN = (.06 * sr) | 0;
  for (let n = 0; n < N; n++){
    const t = n / sr, a = Math.min(1, n / att);
    let body = 0;
    for (const [m, amp, dk] of P) body += amp * Math.sin(6.2832 * f * m * t) * Math.exp(-t * dk);
    // the ball's mass landing: a short low knock with a quick pitch drop
    const thock = .22 * Math.sin(6.2832 * (70 * t + 55 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 28);
    let zing = 0;
    if (n < zN){
      const x0 = zr() * 2 - 1;
      const yz = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x0; y2 = y1; y1 = yz;
      zing = .5 * yz * Math.exp(-t * 120);
    }
    // gentle saturation: the string's growl — creates audible harmonics on small speakers
    out[n] = Math.tanh(2.2 * (a * (ks[n] * ksG + body) + thock)) / Math.tanh(2.2) + zing;
  }
  // tail fade (last 120 ms) so the cut is never a click
  const fade = (.12 * sr) | 0;
  for (let k = 0; k < fade; k++) out[N - 1 - k] *= k / fade;
  let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(out[n]));
  const gain = .85 / Math.max(peak, 1e-6);
  for (let n = 0; n < N; n++) out[n] *= gain;
  const r = { samples: out, sr };
  cache.set(note, r);
  return r;
}
