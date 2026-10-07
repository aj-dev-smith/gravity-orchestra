/* ============================================================
   STRUM — the voice. Pure DSP, deterministic, no AudioContext.
   One render per string id feeds both audio paths (live AudioBuffer
   with gain = vel and a `dur` release where the felt lands; the iOS
   <audio> bank as a WAV that rings its whole render).

   A waveguide STRING (after AJ's overdub core.guitar, MIT, simplified):
     · a delay loop one period long, fine-tuned by a first-order allpass;
     · a one-pole LOSS filter designed per pitch through TWO decay points
       (Bank & Välimäki 2003): T60 at the fundamental and at 3 kHz, so a
       high string stays as bright as a low one and each rings its time;
     · the EXCITATION is the string's own shape where the marble lets go:
       a rounded triangle with its apex at the PICK POINT β = S_PICK / L
       — the very same point the render plucks (solve.js pickU), so the
       pick-position notch in the harmonics is the machine's geometry;
     · what's heard is the string's velocity at the bridge (harmonics
       fall as 1/n), through a BODY: three bells (air ~100 Hz, top
       ~210 Hz, wood above) — STEEL (dreadnought), '|n' NYLON (warm,
       short), '|h' HARP (long, round, soundboard-y);
     · a tiny plectrum click (the marble on the string).
   Peak ≤ .86, ends in exact zero, ≤ 3 s.
   ============================================================ */
import { parseId, pickU } from './solve.js';

export const SR = 44100;
const TAU = 2 * Math.PI;

function mulberry32(seed){
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
/** RBJ peaking EQ (direct form I) → a per-sample tick fn. */
function bell(f, q, db, sr){
  const A = Math.pow(10, db / 40), w = TAU * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const a0 = 1 + al / A;
  const b0 = (1 + al * A) / a0, b1 = -2 * c / a0, b2 = (1 - al * A) / a0, a1 = -2 * c / a0, a2 = (1 - al / A) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
const BODY = {
  '':  { T0: 4.6, Thi: .42, hard: .55, bells: [[104, 1.3, 5.5], [215, 1.4, 3], [3600, .7, 2]], click: .05 },
  n:   { T0: 3.2, Thi: .22, hard: .28, bells: [[98, 1.4, 5], [205, 1.6, 3.5], [2800, .8, -3]], click: .025 },
  h:   { T0: 5.4, Thi: .3,  hard: .32, bells: [[180, 1.1, 3], [520, 1.2, 2], [2000, .8, -2.5]], click: .02, clickF: 3000 },
};
export const durOf = m => Math.max(1.8, Math.min(3, 3 - (m - 40) * .02));

const cache = new Map();
export function strumVoice(id){
  if (cache.has(id)) return cache.get(id);
  const p = parseId(id) || parseId('A3');
  const B = BODY[p.variant] || BODY[''];
  const sr = SR, f0 = 440 * Math.pow(2, (p.m - 69) / 12), N = Math.round(durOf(p.m) * sr);
  const out = new Float32Array(N);
  const per = sr / f0, w0 = TAU * f0 / sr, w1 = TAU * Math.max(3000, 2.5 * f0) / sr;
  const reg = Math.pow(2, -(p.m - 40) / 24);
  const T0 = B.T0 * reg, Thi = Math.min(B.Thi, T0 * .9);
  const perPass = t60 => Math.pow(10, -3 / (Math.max(.01, t60) * f0));
  // the one-pole loss through both decay points: DC gain gd, pole al
  const g0 = perPass(T0), g1 = perPass(Thi), rr = Math.min(.9999, g1 / g0), r2 = rr * rr, c1 = Math.cos(w1);
  const qa = 1 - r2 * c1, qd = Math.sqrt(Math.max(0, qa * qa - (1 - r2) * (1 - r2)));
  const al = Math.max(0, Math.min(.98, (qa - qd) / Math.max(1e-9, 1 - r2)));
  const gl = g0 * (1 - al);
  const lossDelay = Math.atan2(al * Math.sin(w0), 1 - al * Math.cos(w0)) / w0;
  // integer loop + first-order allpass for the fraction (Jaffe–Smith)
  const want = per - lossDelay;
  const M = Math.max(2, Math.floor(want - .5)), frac = want - M, apc = (1 - frac) / (1 + frac);
  // excitation: the string's shape where the marble lets go (apex at the pick point), smoothed
  const beta = Math.max(.07, Math.min(.42, pickU(p.name)));
  const rnd = mulberry32(0x57A11 ^ Math.round(f0 * 1000) ^ (p.variant.charCodeAt(0) || 0) * 977);
  const lp = Math.min(.95, 1 - Math.pow(1 - B.hard, Math.max(1, f0 / 165)));
  const buf = new Float32Array(M);
  let y = 0, y2 = 0;
  for (let i = 0; i < 2 * M; i++){
    const u = (i % M) / M, tri = u < beta ? u / beta : (1 - u) / (1 - beta);
    y += (.97 * tri + (i < M ? 0 : .03 * (rnd() * 2 - 1)) - y) * lp; y2 += (y - y2) * lp;
    if (i >= M) buf[i - M] = y2;
  }
  let mean = 0; for (let i = 0; i < M; i++) mean += buf[i]; mean /= M;
  for (let i = 0; i < M; i++) buf[i] -= mean;
  // the loop
  let idx = 0, lz = 0, ax = 0, ay = 0, prev = buf[M - 1];   // (the shape is periodic: no step into the first sample)
  // warm the loop's filters on one lap, as if the string had been ringing: started from rest they'd
  // write a seam into the loop that comes round as a click every period
  for (let i = 0; i < M; i++){ lz = gl * buf[i] + al * lz; const a = apc * lz + ax - apc * ay; ax = lz; ay = a; }
  const vNorm = 1 / (2 * Math.sin(Math.PI * f0 / sr));
  const eq = B.bells.map(([f, q, db]) => bell(f, q, db, sr));
  const clickN = Math.round(.004 * sr), FADE_IN = Math.round(.0007 * sr);
  for (let n = 0; n < N; n++){
    const s = buf[idx];
    lz = gl * s + al * lz;                          // loss
    const a = apc * lz + ax - apc * ay; ax = lz; ay = a;   // fine tuning
    buf[idx] = a;
    idx = (idx + 1) % M;
    let o = .62 * (s - prev) * vNorm + .38 * s; prev = s;   // velocity at the bridge (+ some displacement: a round low end)
    if (n < FADE_IN) o *= .5 - .5 * Math.cos(Math.PI * n / FADE_IN);   // the displacement term starts off zero: no step out of silence
    for (const e of eq) o = e(o);
    out[n] = o;
  }
  // the marble's tick: a highpassed seeded burst, set RELATIVE to the ring (added after the level
  // below) — mixed in raw it sat 10 dB over the string and became the voice's peak
  // level: the RING (20–300 ms) sets the gain; the marble's first Helmholtz pulse (a pluck near the
  // bridge is a tall narrow velocity pulse) is rounded by a soft knee instead of setting the level —
  // otherwise the string itself would sit 15 dB under its own attack
  let ring = 0; for (let n = Math.round(.02 * sr); n < Math.min(N, Math.round(.3 * sr)); n++) ring = Math.max(ring, Math.abs(out[n]));
  const gain = .62 / Math.max(ring, 1e-9), KN = .62, HR = .26;
  const fade = Math.round(N * .15);
  let peak = 0, cx1 = 0, cy1 = 0;
  for (let n = 0; n < N; n++){
    let x = out[n] * gain;
    if (n < clickN){
      const x0 = rnd() * 2 - 1, hp = .82 * (cy1 + x0 - cx1); cx1 = x0; cy1 = hp;
      x += B.click * 2.4 * hp * Math.sin(Math.PI * Math.min(1, n / 8)) * Math.exp(-n / (.0012 * sr));
    }
    const ax2 = Math.abs(x);
    if (ax2 > KN) x = Math.sign(x) * (KN + HR * Math.tanh((ax2 - KN) / HR));
    const k = N - 1 - n;
    out[n] = x * (k < fade ? Math.pow(k / fade, 1.5) : 1);
    peak = Math.max(peak, Math.abs(out[n]));
  }
  if (peak > .86) for (let n = 0; n < N; n++) out[n] *= .86 / peak;
  out[N - 1] = 0;
  const r = { samples: out, sr };
  cache.set(id, r);
  return r;
}
