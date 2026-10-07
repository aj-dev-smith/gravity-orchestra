/* ============================================================
   CYMBALS — the drum machine's METAL voices. Pure, deterministic
   DSP (no DOM, no Web Audio): name → {samples: Float32Array, sr}.

   One render feeds BOTH audio paths (audio.js): the live path wraps
   it in an AudioBuffer (velocity → level + darkness, per hit), the
   iOS path bakes the same samples into the drum's <audio> WAV. So
   the two paths can't drift apart.

   The model is clawd-o-matic's metal() (vendor/pop-punk/engine.js),
   ported: a bed of 40–160 INHARMONIC two-pole resonator modes — the
   pitched ping and gong tones a struck bronze plate rings with — with
   random frequencies in [fLo, fHi] (seeded), decays τ·(f/3000)^−slope
   so the highs die first, amplitude a Lorentzian round `peak`; plus
   NOISE BANDS (4th-order hp/lp) that carry the dense wash, each with
   its own decay and a "bloom" (1 − e^(−t/bloom): the energy climbing
   through the plate a few ms late), and a slow random AM shimmer.
   The china is metal() through a soft clipper (the trashy bark);
   the ride bell adds a few strong bell partials over a short bed.

   Determinism: every render runs on its OWN seeded rng + noise state
   (seeded from the name), so bake order never changes a sample.
   ============================================================ */

export const SR = 32000;                   // 16 kHz Nyquist: room for the 15 kHz air band, ~27 % cheaper than 44.1k
const TAU = Math.PI * 2;

function rng(seed){                        // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noise(seed){                      // xorshift32 white noise in [−1, 1)
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s * 4.656612873077393e-10; };
}
const hashStr = str => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
// rational tanh: exact at 0, reaches ±1 with zero slope at ±3
const tanh = x => x <= -3 ? -1 : x >= 3 ? 1 : x * (27 + x * x) / (27 + 9 * x * x);

/* RBJ biquad (lp / hp / bp at 0 dB peak) */
function biquad(type, f, q, sr){
  const w = TAU * Math.min(Math.max(f, 5), sr * .49) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if (type === 'lp'){ b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === 'hp'){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  let z1 = 0, z2 = 0;
  return x => { const y = B0 * x + z1; z1 = B1 * x - A1 * y + z2; z2 = B2 * x - A2 * y; return y; };
}

/* metal(): the modal bed + the noise bands. `o` = a preset below. */
export function metal(r, wn, o, sr = SR){
  const n = Math.round(o.dur * sr), y = new Float32Array(n);
  const M = o.modes;
  for (let m = 0; m < M; m++){
    const f = o.fLo + (o.fHi - o.fLo) * Math.pow(r(), o.skew ?? 1);
    const w = TAU * f / sr;
    const tau = o.tau * Math.pow(f / 3000, -(o.slope ?? .5)) * (.5 + r());
    const rr = Math.exp(-1 / (tau * sr));
    const lf = Math.log2(f / o.peak);
    const amp = (o.partials * (.3 + r()) / Math.sqrt(M)) / (1 + lf * lf / (o.width * o.width));
    const c1 = 2 * rr * Math.cos(w), c2 = rr * rr, phi = r() * TAU;
    let y1 = amp * Math.sin(phi), y0 = amp * rr * Math.sin(w + phi);
    y[0] += y1; if (n > 1) y[1] += y0;
    const lim = Math.min(n, Math.round(tau * 7 * sr));
    for (let i = 2; i < lim; i++){ const v = c1 * y0 - c2 * y1; y1 = y0; y0 = v; y[i] += v; }
  }
  for (const [f, a, tau] of o.ping || []){                 // strong bell partials (the ride bell's clang)
    const w = TAU * f / sr, ph = r() * TAU;
    for (let i = 0; i < n; i++){ const e = Math.exp(-i / (tau * sr)); if (e < 1e-5) break; y[i] += a * e * Math.sin(w * i + ph); }
  }
  for (const [lo, hi, gain, tau, bloom] of o.bands){
    const h1 = biquad('hp', lo, .7, sr), h2 = biquad('hp', lo, .7, sr), l1 = biquad('lp', hi, .7, sr), l2 = biquad('lp', hi, .7, sr);
    const amA = 1 - Math.exp(-TAU * (o.shimmer ?? 14) / sr);
    const rate = 1 / (tau * sr);
    let e = 1, amv = 0;
    for (let i = 0; i < n; i++){
      const t = i / sr;
      amv += amA * (wn() - amv);                           // slow random AM — the wash moves
      const b = l2(l1(h2(h1(wn()))));
      y[i] += b * gain * e * (1 + 2.2 * amv) * (bloom ? 1 - Math.exp(-t / bloom) : 1);
      e -= e * rate;
      if (e < 1e-5) break;
    }
  }
  // the render is finite but bronze isn't: the tail is still ~20–30 dB under the attack when
  // `dur` runs out, so a 30 ms cut there reads as a GATE on an exposed crash. Fade the last
  // 15 % (≤ .5 s) on a smoothstep instead — it lands as the ring dying away.
  const atk = Math.max(1, Math.round(.0004 * sr)), fade = Math.max(1, Math.round(Math.min(.5, .15 * o.dur) * sr));
  for (let i = 0; i < n; i++){ const u = Math.min(1, (n - 1 - i) / fade); y[i] *= Math.min(1, i / atk) * u * u * (3 - 2 * u); }
  return y;
}

/* The presets. crash / ride / hatOpen are clawd-o-matic's METAL table; china is its
   extraKit() china (metal → tanh); the splash is a small, fast crash; the ride bell is
   a short, bright bed under a few strong bell partials. */
export const METAL = {
  crash:   { dur: 3.4, modes: 120, fLo: 350, fHi: 7000, tau: 1.0, slope: .4, peak: 3000, width: 1.6, partials: .35, shimmer: 16,
             bands: [[1800, 4500, .5, 1.1, 0], [4500, 9000, .9, .85, .008], [9000, 15000, .7, .5, .012]] },
  ride:    { dur: 2.6, modes: 80, fLo: 500, fHi: 9000, skew: 1.2, tau: 1.0, slope: .3, peak: 3800, width: 1.2, partials: 1.0, shimmer: 10,
             bands: [[3000, 7000, .12, .08, 0], [5000, 12000, .14, .6, .004]] },
  rideBell:{ dur: 2.4, modes: 48, fLo: 900, fHi: 8000, skew: 1.1, tau: .9, slope: .25, peak: 3200, width: 1.0, partials: .6, shimmer: 8,
             ping: [[742, .16, 1.5], [1563, .11, 1.1], [2219, .08, .8], [3091, .05, .6], [4152, .03, .4]],
             bands: [[3500, 9000, .08, .05, 0]] },
  china:   { dur: 2.4, modes: 160, fLo: 260, fHi: 6200, skew: 1.4, tau: .55, slope: .55, peak: 1700, width: 1.3, partials: .6, shimmer: 38,
             bands: [[700, 2600, 1.0, .6, 0], [2600, 6500, .75, .4, .003], [6500, 12000, .3, .22, .005]], drive: 2.2 },
  splash:  { dur: 1.5, modes: 90, fLo: 700, fHi: 9500, tau: .42, slope: .45, peak: 4400, width: 1.4, partials: .35, shimmer: 22,
             bands: [[2600, 6000, .45, .42, 0], [6000, 11000, .9, .34, .004], [11000, 15000, .6, .2, .006]] },
  hatOpen: { dur: 1.1, modes: 40, fLo: 3500, fHi: 14000, tau: .3, slope: .25, peak: 7500, width: 1.3, partials: .35, shimmer: 22,
             bands: [[6000, 15000, .9, .28, .002], [3500, 8000, .35, .2, 0]] },
};

/* the hand CLAP (clawd-o-matic extraKit): four hands a few ms apart through two bandpasses, then a short room */
function clap(r, wn, sr = SR){
  const n = Math.round(.4 * sr), y = new Float32Array(n);
  const b1 = biquad('bp', 1150 + 150 * r(), 1.3, sr), b2 = biquad('bp', 2400, 1.1, sr), hp = biquad('hp', 500, .7, sr);
  const taps = [0, .008 + .003 * r(), .017 + .004 * r(), .027 + .004 * r()], amp = [.7 + .3 * r(), .7 + .3 * r(), .7 + .3 * r(), .8];
  for (let i = 0; i < n; i++){
    const t = i / sr;
    let env = 0;
    for (let k = 0; k < 4; k++) if (t >= taps[k]) env += Math.exp(-(t - taps[k]) / (k === 3 ? .07 : .004)) * amp[k];
    const nz = wn();
    y[i] = hp(tanh((b1(nz) * 2.2 + b2(nz) * 1.2) * env * 1.6) * Math.min(1, (n - 1 - i) / 600));
  }
  return y;
}

/** The voices this module renders (audio.js routes these lanes here). */
export const METAL_VOICES = new Set([...Object.keys(METAL), 'clap']);
/** Round-robin variants per voice: a ride ridden on eighths wants two strokes, not one machine-gun sample. */
export const VARIANTS = { ride: 2 };
export const PEAK = .9;                                      // every render is peak-normalized here; the mix gain lives in drumkit.js

const cache = new Map();
/** name, variant → {samples, sr}. Cached: the same array every call. */
export function metalVoice(name, variant = 0){
  const v = Math.max(0, Math.min((VARIANTS[name] || 1) - 1, variant | 0));
  const key = name + '#' + v;
  let out = cache.get(key);
  if (out) return out;
  const seed = hashStr(key);
  const r = rng(seed), wn = noise(seed ^ 0x9e3779b9);
  let y;
  if (name === 'clap') y = clap(r, wn);
  else {
    const o = METAL[name];
    if (!o) throw new Error('cymbals: no metal voice "' + name + '"');
    y = metal(r, wn, o);
    if (o.drive) for (let i = 0; i < y.length; i++) y[i] = tanh(y[i] * o.drive) / o.drive * 1.4;
  }
  let pk = 0; for (let i = 0; i < y.length; i++) pk = Math.max(pk, Math.abs(y[i]));
  const k = PEAK / Math.max(pk, 1e-9);
  for (let i = 0; i < y.length; i++) y[i] *= k;
  y[y.length - 1] = 0;
  out = { samples: y, sr: SR };
  cache.set(key, out);
  return out;
}
