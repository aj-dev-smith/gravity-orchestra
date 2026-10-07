/* ============================================================
   LIGHT ORGAN voices — pure deterministic DSP (no AudioContext).
   id → {samples, sr}. One expensive render per (pitch, timbre); every
   TIER is cut from it, so the tiers are level-matched and cost nothing:

     '<pitch>[|<timbre>]'       LONG   speaks, HOLDS full to HOLD (4.5 s),
                                       then a .7 s release to exact 0 (5.2 s)
     '<…>/s'                    SHORT  the same, released at 1.05 s (1.4 s):
                                       what an iOS <audio> element rings for a
                                       staccato note (the sample path can't
                                       release at `dur` — §5), so short chords
                                       don't smear into a 5-second wash
     '<…>/c'                    CONT   the SAME voice rendered from CONT_AT on
                                       (every time-varying part — the pad's
                                       bloom, the choir's vibrato onset, the
                                       organ's chorus beat — continues where the
                                       first voice is; same seed, same gain),
                                       with an equal-power .12 s fade-in.
                                       index.js fires it at CONT_AT under a note
                                       held longer than the render while the
                                       first voice releases (live path) → a
                                       level- and timbre-matched crossfade to
                                       MAX_DUR holds

   The live path releases every voice at the note's `dur` (main → playVoice).

   TIMBRES (the part's id suffix):
     organ  a principal chorus: 8' + 4' + 2⅔' + 2' + a touch of mixture —
            additive harmonics with a second, ¾-cent-sharp rank (the slow
            chorus beat of two ranks drawing together), a pipe's SPEECH
            (upper harmonics speak first, the fundamental blooms in ~50 ms),
            a bandpassed CHIFF of wind at the mouth, faint wind flutter.
     choir  three singers ("aah" leaning to "oh"), each a glottal harmonic
            series shaped by the 5 vowel formants of its register (bass /
            tenor / alto / soprano tables), detuned −9/0/+7 cents, with a
            delayed vibrato (5.1–5.6 Hz) and a breath of formant noise.
     pad    a warm string/synth ensemble: three detuned band-limited saws
            whose lowpass opens over ~1.5 s (the bloom), slow attack.
   All additive via the Chebyshev recurrence sin(kφ) = 2cosφ·sin((k−1)φ) −
   sin((k−2)φ) — one sin/cos per sample per source, no per-partial trig.
   ============================================================ */
import { noteHz } from '../../engine.js';
import { parseId, CONT_AT, MAX_DUR } from './solve.js';

export const SR = 22050;
export const HOLD = 4.5, REL = .7, LEN = HOLD + REL;            // the LONG render
export const S_HOLD = 1.05, S_REL = .35;                        // the SHORT tier
export const C_FADE = .12, C_HOLD = MAX_DUR - CONT_AT + .2;    // the CONTINUATION tier (C_HOLD + REL long)
const PEAK = { organ: .76, choir: .72, pad: .7 };
const TAU = 2 * Math.PI;

function mulberry32(a){
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const seedOf = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/* one additive source: a fundamental phase φ(t) (freq fn per sample-block), harmonic weights
   w[k] (k = 1..K, may be re-set per block by `reweigh`), summed into out with gain env[i]. */
function additive(out, n, f0, w, { detune = 0, vib = null, reweigh = null, phase = 0, t0 = 0 } = {}){
  const K = w.length - 1;
  // rendering from t0: a steady oscillator is exactly where the t = 0 render has it by then
  // (so the chorus / ensemble beat pattern continues); a vibrato'd one only keeps its character
  let phi = vib ? phase : (phase + TAU * f0 * (1 + detune) * t0) % TAU;
  const BL = 64;
  for (let b = 0; b < n; b += BL){
    const t = t0 + b / SR;
    let f = f0 * (1 + detune);
    if (vib) f *= Math.pow(2, vib(t) / 1200);
    if (reweigh) reweigh(t, w);
    const dphi = TAU * f / SR, e = Math.min(n, b + BL);
    for (let i = b; i < e; i++){
      const s1 = Math.sin(phi), c2 = 2 * Math.cos(phi);
      let sp = 0, sc = s1, acc = w[1] * s1;
      for (let k = 2; k <= K; k++){ const sn = c2 * sc - sp; sp = sc; sc = sn; acc += w[k] * sn; }
      out[i] += acc;
      phi += dphi; if (phi > TAU) phi -= TAU;
    }
  }
}

/* RBJ bandpass biquad over a buffer (constant-skirt), in place */
function bandpass(x, f, Q){
  const w0 = TAU * Math.min(f, SR * .45) / SR, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
  const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++){
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

/* ---- ORGAN: principal chorus ---- */
function renderOrgan(f, rnd, n, t0){
  const out = new Float32Array(n);
  const nyq = SR * .45;
  // 8' principal harmonics (gentle rolloff) + the 4' / 2⅔' / 2' ranks folded onto it
  const H = [0, 1, .62, .30, .34, .10, .16, .05, .14, .03, .05, 0, .06];
  const K = Math.max(1, Math.min(H.length - 1, Math.floor(nyq / f)));
  const w = new Float64Array(K + 1); for (let k = 1; k <= K; k++) w[k] = H[k];
  // the pipe SPEAKS: harmonic k's amplitude rises with τ_k (upper first), so render each rank
  // as the steady sum and shape the attack with a separate brightening "speech" layer below
  additive(out, n, f, w, { phase: rnd() * TAU, t0 });
  const w2 = new Float64Array(Math.min(K, 6) + 1);            // the second rank, a hair sharp (chorus)
  for (let k = 1; k < w2.length; k++) w2[k] = H[k] * (k === 1 ? .35 : .5);
  additive(out, n, f, w2, { detune: .00045, phase: rnd() * TAU, t0 });
  // attack envelope: the fundamental blooms in ~55 ms (low pipes slower); upper partials
  // overshoot slightly (the chiff's tonal half) — approximated as one envelope + a bright blip
  const tA = .028 + .045 * Math.min(1, 220 / f);
  const blip = new Float32Array(n);
  const wb = new Float64Array(Math.min(K, 10) + 1); for (let k = 3; k < wb.length; k++) wb[k] = .5 / k;
  additive(blip, Math.min(n, Math.round(SR * .2)), f, wb, { phase: rnd() * TAU });
  // the CHIFF: wind noise at the mouth, bandpassed around the 3rd–4th harmonic
  const nz = new Float32Array(Math.round(SR * .12));
  for (let i = 0; i < nz.length; i++) nz[i] = rnd() * 2 - 1;
  bandpass(nz, Math.min(3.4 * f, 5200), 3.2);
  // faint wind flutter (seeded, ~3 Hz, ±1.2 %)
  const ph1 = rnd() * TAU, ph2 = rnd() * TAU;
  for (let i = 0; i < n; i++){
    const t = t0 + i / SR;
    const att = 1 - Math.exp(-t / tA);
    const flut = 1 + .008 * Math.sin(TAU * 2.9 * t + ph1) + .005 * Math.sin(TAU * 5.3 * t + ph2);
    let v = out[i] * att * att * flut;
    if (i < blip.length) v += blip[i] * Math.exp(-t / .045) * (1 - Math.exp(-t / .004));
    if (i < nz.length) v += nz[i] * 1.6 * Math.exp(-t / .03) * (1 - Math.exp(-t / .003));
    out[i] = v;
  }
  return out;
}

/* ---- CHOIR: three singers through register-appropriate "aah/oh" formants ---- */
// [F Hz, amp (lin), bandwidth Hz] × 5 — after the classic Csound vowel tables
const VOWEL = {
  bass:    { a: [[600, 1, 60], [1040, .45, 70], [2250, .35, 110], [2450, .35, 120], [2750, .1, 130]],
             o: [[400, 1, 40], [750, .28, 80], [2400, .08, 100], [2600, .1, 120], [2900, .01, 120]] },
  tenor:   { a: [[650, 1, 80], [1080, .5, 90], [2650, .45, 120], [2900, .4, 130], [3250, .08, 140]],
             o: [[400, 1, 40], [800, .32, 80], [2600, .25, 100], [2800, .25, 120], [3000, .05, 120]] },
  alto:    { a: [[800, 1, 80], [1150, .63, 90], [2800, .1, 120], [3500, .016, 130], [4950, .001, 140]],
             o: [[450, 1, 70], [800, .35, 80], [2830, .035, 100], [3500, .005, 130], [4950, .0003, 135]] },
  soprano: { a: [[800, 1, 80], [1150, .5, 90], [2900, .025, 120], [3900, .1, 130], [4950, .003, 140]],
             o: [[450, 1, 70], [800, .28, 80], [2830, .08, 100], [3800, .08, 130], [4950, .003, 135]] },
};
const register = f => f < 150 ? 'bass' : f < 260 ? 'tenor' : f < 420 ? 'alto' : 'soprano';
function formantGain(fr, tab, mixO){
  let g = .012;
  for (let j = 0; j < 5; j++){
    const [Fa, Aa, Ba] = tab.a[j], [Fo, Ao, Bo] = tab.o[j];
    const F = Fa + (Fo - Fa) * mixO, A = Aa + (Ao - Aa) * mixO, B = Ba + (Bo - Ba) * mixO;
    const d = (fr - F) / B; g += A / (1 + d * d);
  }
  return g;
}
function renderChoir(f, rnd, n, t0){
  const out = new Float32Array(n);
  const tab = VOWEL[register(f)];
  const K = Math.max(1, Math.min(36, Math.floor(Math.min(5200, SR * .45) / f)));
  const singers = [[-.0052, .9], [0, 1], [.004, .85]];       // detune (≈ −9/0/+7 cents), level
  for (const [dt, lvl] of singers){
    const rate = 5.1 + rnd() * .5, vph = rnd() * TAU, depth = 14 + rnd() * 8, onset = .25 + rnd() * .15;
    const jph = rnd() * TAU;
    const mixO = .3 + .15 * rnd();
    const w = new Float64Array(K + 1);
    for (let k = 1; k <= K; k++) w[k] = lvl * formantGain(k * f, tab, mixO) / Math.pow(k, .55);
    const vib = t => {
      const ramp = Math.min(1, Math.max(0, (t - onset) / .7));
      return depth * ramp * Math.sin(TAU * rate * t + vph) + 3 * Math.sin(TAU * .37 * t + jph);
    };
    additive(out, n, f, w, { detune: dt, vib, phase: rnd() * TAU, t0 });
  }
  // breath: noise through the 2nd formant, a little at the onset, a whisper throughout
  const nz = new Float32Array(n);
  for (let i = 0; i < n; i++) nz[i] = rnd() * 2 - 1;
  bandpass(nz, tab.a[1][0], 2.5);
  const tA = .16 + .08 * Math.min(1, 200 / f);
  for (let i = 0; i < n; i++){
    const t = t0 + i / SR, att = 1 - Math.exp(-t / tA);
    out[i] = out[i] * att * att + nz[i] * .18 * (.25 + .75 * Math.exp(-t / .12)) * att;
  }
  return out;
}

/* ---- PAD: three detuned saws, a blooming lowpass ---- */
function renderPad(f, rnd, n, t0){
  const out = new Float32Array(n);
  const K = Math.max(1, Math.min(30, Math.floor(Math.min(6000, SR * .45) / f)));
  for (const dt of [-.0068, 0, .0061]){
    const w = new Float64Array(K + 1);
    const reweigh = (t, w) => {
      const fc = 700 + 1900 * (1 - Math.exp(-t / 1.1)) * (1 + .08 * Math.sin(TAU * .21 * t));
      for (let k = 1; k <= K; k++){ const x = k * f / fc; w[k] = (1 / k) / (1 + x * x * x * x); }
    };
    additive(out, n, f, w, { detune: dt, reweigh, phase: rnd() * TAU, t0 });
  }
  // a soft sub-octave body for the low notes (phones still hear the 2nd+ harmonics)
  if (f < 260){
    const w = new Float64Array(2); w[1] = .35;
    additive(out, n, f / 2, w, { phase: rnd() * TAU, t0 });
  }
  const tA = .32;
  for (let i = 0; i < n; i++){ const t = t0 + i / SR, att = 1 - Math.exp(-t / tA); out[i] *= att * att; }
  return out;
}

/* release window: from i0 to the last sample, exp(−3x)·(1 − x²) → exactly 0 at the end */
function release(x, i0){
  const n = x.length, L = n - 1 - i0;
  for (let i = i0; i < n; i++){ const u = (i - i0) / L; x[i] *= Math.exp(-3 * u) * (1 - u * u); }
  x[n - 1] = 0;
  return x;
}

/* the raw voice, seconds [t0, t0 + n/SR) of the same performance (same seed → same singers,
   same phases; every envelope / bloom / vibrato is a function of absolute t) */
function renderRaw(base, n, t0){
  const id = parseId(base) || parseId('C4');
  const f = noteHz(id.pitch), rnd = mulberry32(seedOf(base));
  const fn = id.timbre === 'choir' ? renderChoir : id.timbre === 'pad' ? renderPad : renderOrgan;
  return { raw: fn(f, rnd, n, t0), timbre: id.timbre };
}
const longCache = new Map(), cache = new Map();
function longRender(base){
  if (longCache.has(base)) return longCache.get(base);
  const n = Math.round(SR * LEN), { raw, timbre } = renderRaw(base, n, 0);
  release(raw, Math.round(SR * HOLD));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(raw[i]));
  const k = PEAK[timbre] / (peak || 1);
  for (let i = 0; i < n; i++) raw[i] *= k;
  const L = { samples: raw, k };
  longCache.set(base, L);
  return L;
}

/** id → {samples, sr}. Cached (the same Float32Array every call — deterministic). */
export function organVoice(id){
  if (cache.has(id)) return cache.get(id);
  const m = /^(.*?)(?:\/([sc]))?$/.exec(String(id));
  const base = m[1], tier = m[2] || '';
  const L = longRender(base);
  let samples;
  if (tier === 's'){
    samples = L.samples.slice(0, Math.round(SR * (S_HOLD + S_REL)));
    release(samples, Math.round(SR * S_HOLD));
  } else if (tier === 'c'){
    // the steady state at CONT_AT, at the LONG render's gain (level-matched by construction)
    samples = renderRaw(base, Math.round(SR * (C_HOLD + REL)), CONT_AT).raw;
    release(samples, Math.round(SR * C_HOLD));
    for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-.95, Math.min(.95, samples[i] * L.k));
    const nf = Math.round(SR * C_FADE);
    for (let i = 0; i < nf; i++) samples[i] *= Math.sin(.5 * Math.PI * i / nf);   // equal-power (the first voice is releasing under it)
  } else samples = L.samples;
  const v = { samples, sr: SR };
  cache.set(id, v);
  return v;
}
