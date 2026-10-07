/* ============================================================
   POGO BASS — the voice. Pure DSP, deterministic, no AudioContext.

   A growly ELECTRIC bass, rendered sample by sample, one id per note:
       'E1'    fingered (GM 33 / 35 / the default) — round, warm, a soft attack
       'E1:p'  picked   (GM 34) — a plectrum click, brighter, a touch more drive
       'E1:s'  SLAP     (GM 36 / 37) — the thumb's POP: a hard fret-slap transient,
                        a bright, scooped string (odd harmonics up), shorter ring
       'E1:y'  SYNTH    (GM 38 / 39) — a PolyBLEP saw + a detuned square through a resonant
                        ladder-ish lowpass whose cutoff snaps down (the classic squelch)
   The string is an extended Karplus–Strong loop (a one-pole loss filter whose
   brightness is the articulation, a first-order allpass for exact tuning — at
   G3 a plain integer delay would be ~5 cents flat), excited at the pluck point
   (a triangle + seeded noise), read through a two-coil split-pickup COMB (the
   P-bass honk). Then the amp: a gentle asymmetric tanh (the growl — it writes
   the upper harmonics a phone speaker CAN play, CLAUDE.md §5: below ~200 Hz
   the fundamental is gone and the ear rebuilds it from them) and a mid "clank"
   band at ~800 Hz that makes a line read on a laptop.
   DRY (wet:false): a bass line should punch, not smear. Seeded per id: the
   bake order can never change a sample.
   ============================================================ */
import { noteNum } from '../../engine.js';
import { voiceCache } from '../voicecache.js';

export const SR = 32000;
export const LEN = { '': 1.9, p: 1.7, s: 1.25, y: 1.5 };   // s: render length per articulation
const TAU = Math.PI * 2;

/* ---- id grammar (the same as solve.js makeId / flagOf) ---- */
export function parseId(id){
  const [nm, fl = ''] = String(id).split(':');
  const flag = fl.includes('s') ? 's' : fl.includes('y') ? 'y' : fl.includes('p') ? 'p' : '';
  return { note: nm, flag };
}

function rng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s){
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
/* RBJ biquad (direct form I), deterministic */
function biquad(type, f, q, gainDb, sr){
  const w = TAU * Math.min(f, sr * .45) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), A = Math.pow(10, (gainDb || 0) / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'bp'){ b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'peak'){ b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else if (type === 'hp'){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }   // lp
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
const sat = (x, k) => { const y = x * k; return (y > 0 ? Math.tanh(y) : Math.tanh(y * .85) / .85) / Math.tanh(k); };   // asymmetric: even harmonics too

/* ---- the STRING (extended Karplus–Strong) ---- */
function pluckString(f, N, sr, { bright, t60, pos, noise, seed }){
  const period = sr / f;
  const b = 1 - bright;                                       // loss filter: 0 = bright … 1 = dark
  const a0 = .5 + .5 * (1 - b), a1 = 1 - a0;                  // its low-frequency delay is a1 samples
  const M = Math.max(2, Math.floor(period - a1 - .1));
  const frac = period - a1 - M;                               // the allpass carries the fractional delay (.1 … 1.1)
  const apc = (1 - frac) / (1 + frac);
  const rho = Math.exp(Math.log(.001) / (f * t60));
  const buf = new Float64Array(M);
  const r = rng(seed);
  let lp = 0, mean = 0;
  for (let k = 0; k < M; k++){
    const u = k / M;
    const tri = u < pos ? u / pos : (1 - u) / (1 - pos);    // the string's shape at the pluck point
    lp += (bright * .9 + .08) * ((r() * 2 - 1) - lp);
    buf[k] = .85 * (tri - .5) + noise * lp;
    mean += buf[k];
  }
  mean /= M; for (let k = 0; k < M; k++) buf[k] -= mean;    // no DC in the loop
  const out = new Float64Array(N);
  let idx = 0, prev = 0, apx = 0, apy = 0;
  for (let n = 0; n < N; n++){
    const x = buf[idx];
    const lpY = a0 * x + a1 * prev; prev = x;
    const ap = apc * lpY + apx - apc * apy; apx = lpY; apy = ap;   // first-order allpass (fractional tuning)
    buf[idx] = rho * ap;
    out[n] = x;
    idx = idx + 1 === M ? 0 : idx + 1;
  }
  return { out, M };
}

const cache = voiceCache();   // (bounded to the song in use — ../voicecache.js)
export function pogoVoice(id){
  if (cache.has(id)) return cache.get(id);
  const { note, flag } = parseId(id);
  let m;
  try { m = noteNum(note); } catch (_){ m = 40; }
  if (!Number.isFinite(m)) m = 40;
  const f = 440 * Math.pow(2, (m - 69) / 12), sr = SR, N = Math.round(LEN[flag] * sr);
  const r = rng(strHash(id));
  const x = new Float64Array(N);
  const low = f < 80;

  if (flag === 'y'){
    // ---- SYNTH: PolyBLEP saw + a square a hair sharp, through a resonant LP sweep ----
    const blep = (ph, dt) => ph < dt ? (ph /= dt, ph + ph - ph * ph - 1) : ph > 1 - dt ? (ph = (ph - 1) / dt, ph * ph + ph + ph + 1) : 0;
    let p1 = 0, p2 = .25;
    const dt1 = f / sr, dt2 = f * 1.004 / sr;              // (the square a hair sharp: a slow beat, the width)
    // a 2-pole state-variable lowpass, cutoff from ~2.6 kHz → ~f·3 with a snap (the squelch), resonance .55
    let lo = 0, band = 0;
    for (let n = 0; n < N; n++){
      const t = n / sr;
      const saw = 2 * p1 - 1 - blep(p1, dt1);
      let sq = p2 < .5 ? 1 : -1; sq += blep(p2, dt2); sq -= blep((p2 + .5) % 1, dt2);
      p1 += dt1; if (p1 >= 1) p1 -= 1;
      p2 += dt2; if (p2 >= 1) p2 -= 1;
      const fc = Math.max(f * 3, 140) + 2600 * Math.exp(-t * 11);
      const F = 2 * Math.sin(Math.PI * Math.min(fc, sr / 6) / sr), Q = .45;
      const inp = .7 * saw + .35 * sq;
      lo += F * band; const hi = inp - lo - Q * band; band += F * hi;
      const env = Math.min(1, n / (.004 * sr)) * (.62 + .38 * Math.exp(-t * 3)) * Math.exp(-t * .9);
      x[n] = sat(lo * env, 1.6);
    }
  } else {
    // ---- the STRING ----
    const art = flag === 's' ? { bright: .82, t60: 1.25, pos: .1, noise: .5, drive: 1.5 }
              : flag === 'p' ? { bright: .62, t60: 2.2, pos: .14, noise: .35, drive: 2.2 }
              : { bright: .38, t60: 2.6, pos: .22, noise: .12, drive: 1.9 };
    const { out: ks, M } = pluckString(f, N, sr, { ...art, seed: strHash(id) ^ 0x9e3779b9 });
    // the split pickup: two coils under the string read it at slightly different points → a comb
    const pk = Math.max(1, Math.round(M * (flag === 's' ? .09 : .16)));
    let pkKS = 0;
    const body = new Float64Array(N);
    for (let n = 0; n < N; n++){ body[n] = ks[n] - .55 * (n >= pk ? ks[n - pk] : 0); pkKS = Math.max(pkKS, Math.abs(body[n])); }
    const g0 = .7 / Math.max(pkKS, 1e-9);
    // a clean fundamental + 2nd under the string (the round "thump" that a KS loop alone lacks); a low note
    // leans on its 2nd–4th partials instead (phones can't play 41 Hz; the ear rebuilds it from them)
    const P = low ? [[1, .22, 2.2], [2, .3, 2.6], [3, .16, 3.5], [4, .08, 5]] : [[1, .32, 2], [2, .16, 3]];
    const mids = biquad('peak', flag === 's' ? 1500 : 800, 1.1, flag === 's' ? 7 : 5, sr);   // the "clank" / the slap's scoop-and-snap
    const hp = biquad('hp', 32, .7, 0, sr);
    // the GRIT: a parallel overdriven copy of everything above ~260 Hz (a bassist's blend pedal) — the
    // band a phone speaker plays, so an E1 still reads where its 41 Hz fundamental can't
    const gHp1 = biquad('hp', 260, .7, 0, sr), gHp2 = biquad('hp', 260, .7, 0, sr);
    const GRIT = flag === 's' ? .2 : flag === 'p' ? .3 : .55, G_K = low ? 4 : 3;
    // the transient: fingered = a soft thud; pick = a click; SLAP = the thumb's pop + the string slapping the frets
    const tr = biquad('bp', flag === 's' ? 3200 : flag === 'p' ? 2400 : 900, flag === 's' ? 1.4 : 2, 0, sr);
    const trLen = (flag === 's' ? .05 : flag === 'p' ? .025 : .02) * sr, trAmp = flag === 's' ? 1.1 : flag === 'p' ? .45 : .12;
    const att = (flag === 's' ? .0008 : flag === 'p' ? .0015 : .005) * sr;
    for (let n = 0; n < N; n++){
      const t = n / sr, a = Math.min(1, n / att);
      let s = body[n] * g0;
      let ph = 0; for (const [k, amp, dk] of P) ph += amp * Math.sin(TAU * f * k * t) * Math.exp(-t * dk);
      s = a * (s + ph);
      let tx = 0;
      if (n < trLen){ tx = trAmp * tr(r() * 2 - 1) * Math.exp(-n / trLen * 5); }
      const core = hp(mids(s + tx));
      x[n] = sat(core + GRIT * Math.tanh(G_K * gHp2(gHp1(core))), art.drive);
    }
  }
  // the release: a cosine fade over the last 25 % (the cut is never a click; it decays to exactly 0)
  const fade = Math.round(N * .25);
  for (let k = 0; k < fade; k++) x[N - 1 - k] *= .5 - .5 * Math.cos(Math.PI * k / fade);
  let peak = 0; for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(x[n]));
  const gain = .86 / Math.max(peak, 1e-9);
  const samples = new Float32Array(N);
  for (let n = 0; n < N; n++) samples[n] = x[n] * gain;
  samples[N - 1] = 0;
  const res = { samples, sr };
  cache.set(id, res);
  return res;
}
