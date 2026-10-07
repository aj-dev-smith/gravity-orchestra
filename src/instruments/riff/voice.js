/* ============================================================
   RIFF FORGE — the voice. Pure DSP, deterministic, no AudioContext.

   A high-gain metal rhythm guitar, rendered sample by sample:
     strings  extended Karplus–Strong (one-pole loop damping + a first-order
              allpass for fine tuning, a triangle excitation with its apex at the
              pick point + seeded pick noise, a two-coil bridge-pickup comb); a
              PALM MUTE raises the loop damping and pulls the ring toward ~.08 s
     click    the hit's transient off the wound strings (band-passed noise) —
              what the gain turns into the "djent"
     amp      tight pre-boost (lows out, upper mids in) → three asymmetric tanh
              stages with DC blockers + Miller one-poles → a scooped tone stack →
              a power stage, all at 4× oversampling (half-band Kaiser resamplers)
     cab      a mic'd 4×12 as a fixed chain of EQs, then the guitar-bus EQ
     gate     a keyed noise gate closes the tail (metal is tight)

   Ported from AJ's own Claw'd-o-Matic engine (MIT: vendor/pop-punk/engine.js
   pluck / ampSim / AMPS, packs/metal.js hgAmp / takeDI / gateCurve, blocks.js
   gtrEQ), re-entrant and seeded per id (no module-global noise state, so the bake
   order can never change a sample).

   WHY A WHOLE CHORD IS ONE VOICE: distortion is nonlinear — a power chord through
   one drive stage intermodulates (that grit IS the sound); summing three separately
   distorted notes is a different, thinner instrument. So the id is the whole HIT:
       'E2+B2+E3'      an open power chord (rings ~1.5 s, released at `dur` live)
       'E2:m'          palm-muted (a tight ~.3 s chug)
       'G3:c'          clean channel (GM 27 — the amp barely breaks up)
       'E2+B2:cm'      flags combine
   Notes are sharps-only names, low → high, joined by '+'.
   ============================================================ */
import { noteNum } from '../../engine.js';

export const SR = 32000;
export const OPEN_LEN = 1.6;          // s: an open hit's render (the live path releases at `dur`)
export const MUTE_LEN = .34;          // s: a palm-muted chug
export const RMS_T = .2;              // the body's target RMS (≈ −14 dBFS)
const TAU = Math.PI * 2;

/* ---- id grammar ---- */
export function parseId(id){
  const [ns, flags = ''] = String(id).split(':');
  const notes = ns.split('+').filter(Boolean);
  return { notes, mute: flags.includes('m'), clean: flags.includes('c') };
}
export function makeId(notes, { mute = false, clean = false } = {}){
  const f = (clean ? 'c' : '') + (mute ? 'm' : '');
  return notes.join('+') + (f ? ':' + f : '');
}

/* ---- DSP kit (deterministic) ---- */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
// rational tanh: exact at 0, reaches ±1 with zero slope at ±3 (cheap, identical on every engine)
function tanh(x){
  if (x <= -3) return -1;
  if (x >= 3) return 1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
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
class Biquad {
  constructor(){ this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, gain, sr){
    const w = TAU * clamp(f, 5, sr * .49) / sr, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, (gain || 0) / 40);
    const al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp'){ b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp'){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp'){ b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'peak'){ b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    else {
      const sA = 2 * Math.sqrt(A) * (s / 2) * Math.SQRT2;
      if (type === 'hs'){
        b0 = A * (A + 1 + (A - 1) * c + sA); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - sA);
        a0 = A + 1 - (A - 1) * c + sA; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - sA;
      } else {
        b0 = A * (A + 1 - (A - 1) * c + sA); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - sA);
        a0 = A + 1 + (A - 1) * c + sA; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - sA;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x){
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
function chain(spec, sr){
  const fs = spec.map(s => new Biquad().set(s[0], s[1], s[2], s[3], sr)), n = fs.length;
  return x => { for (let k = 0; k < n; k++) x = fs[k].tick(x); return x; };
}
class OnePole {
  constructor(){ this.y = 0; this.a = 1; }
  set(fc, sr){ this.a = 1 - Math.exp(-TAU * fc / sr); return this; }
  lp(x){ return (this.y += this.a * (x - this.y)); }
  hp(x){ this.y += this.a * (x - this.y); return x - this.y; }
}

/* streaming 2× half-band resampling (63-tap Kaiser) — the waveshapers run above Nyquist */
const HB = (() => {
  const N = 63, M = 31, beta = 8;
  const bessel = x => { let s = 1, t = 1; for (let k = 1; k < 40; k++){ t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const h = []; let sum = 0;
  for (let n = 0; n < N; n++){
    const m = n - M;
    const s = m === 0 ? .5 : Math.sin(Math.PI * m / 2) / (Math.PI * m);
    const w = bessel(beta * Math.sqrt(1 - (m / M) ** 2)) / bessel(beta);
    h.push(s * w); sum += s * w;
  }
  const off = [], co = [];
  for (let m = 1; m <= M; m += 2){ off.push(m); co.push(h[M + m] / sum); }
  return { c: h[M] / sum, off: Int32Array.from(off), co: Float64Array.from(co) };
})();
class Up2 {
  constructor(){ this.ext = new Float32Array(0); this.h = new Float32Array(32); }
  process(x, y){
    const n = x.length, H = 32;
    if (this.ext.length !== H + n) this.ext = new Float32Array(H + n);
    const ext = this.ext; ext.set(this.h); ext.set(x, H);
    const c2 = 2 * HB.c, off = HB.off, co = HB.co, K = off.length;
    for (let m = 0; m < n; m++){
      const p = m + 16;
      let acc = 0;
      for (let k = 0; k < K; k++){ const o = off[k]; acc += co[k] * (ext[p - ((o - 1) >> 1)] + ext[p + ((o + 1) >> 1)]); }
      y[2 * m] = c2 * ext[p]; y[2 * m + 1] = 2 * acc;
    }
    this.h.set(ext.subarray(n, n + H));
  }
}
class Down2 {
  constructor(){ this.ext = new Float32Array(0); this.h = new Float32Array(62); }
  process(z, w){
    const n2 = z.length, H = 62, n = n2 >> 1;
    if (this.ext.length !== H + n2) this.ext = new Float32Array(H + n2);
    const ext = this.ext; ext.set(this.h); ext.set(z, H);
    const c = HB.c, off = HB.off, co = HB.co, K = off.length;
    for (let m = 0; m < n; m++){
      const p = 2 * m + 31;
      let acc = c * ext[p];
      for (let k = 0; k < K; k++){ const o = off[k]; acc += co[k] * (ext[p - o] + ext[p + o]); }
      w[m] = acc;
    }
    this.h.set(ext.subarray(n2, n2 + H));
  }
}

/* ---- one plucked string (extended Karplus–Strong), added into `out` at sample i0 ---- */
function pluck(out, o, sr){
  const f = o.f, i0 = Math.round(o.t * sr), r = rng(o.seed >>> 0);
  const mute = o.mute || 0, vel = o.vel ?? 1;
  const P = sr / f;
  const damp = clamp((o.damp ?? .12) + mute * .5, 0, .9);
  const t60 = lerp(o.ring ?? 4, o.muteRing ?? .16, Math.pow(mute, .5));
  const g = Math.pow(10, -3 / (t60 * f));
  const w = TAU * f / sr;
  const pd = Math.atan2(damp * Math.sin(w), 1 - damp * Math.cos(w)) / w;
  const N = Math.max(2, Math.floor(P - pd - .2)), frac = P - pd - N, apc = (1 - frac) / (1 + frac);
  const d = new Float32Array(N);
  const apex = clamp(Math.round((o.pick ?? .14) * N), 1, N - 1);
  for (let k = 0; k < N; k++) d[k] = k < apex ? k / apex : (N - k) / (N - apex);
  const bright = clamp(.2 + .8 * vel - .55 * mute, .05, 1);
  const ex = new OnePole().set(500 + 9000 * bright * bright, sr);
  let mean = 0;
  for (let k = 0; k < N; k++){ d[k] = ex.lp(d[k] + (r() - .5) * .5 * bright); mean += d[k]; }
  mean /= N;
  for (let k = 0; k < N; k++) d[k] = (d[k] - mean) * vel;
  const M1 = Math.max(1, Math.round((o.pu ?? .08) * P)), M2 = Math.max(1, Math.round((o.pu2 ?? .115) * P));
  const H = M2 + 1, hist = new Float32Array(H);
  const rel = Math.max(1, Math.round((o.rel ?? .014) * sr)), nLen = Math.round(o.len * sr), n = nLen + rel;
  let p = 0, lp = 0, apx = 0, apy = 0, hp = 0;
  for (let i = 0; i < n; i++){
    const j = i0 + i;
    if (j >= out.length) break;
    const y = d[p];
    lp += (1 - damp) * (y - lp);
    const ap = apc * lp + apx - apc * apy; apx = lp; apy = ap;
    d[p] = ap * g;
    if (++p === N) p = 0;
    hist[hp] = y;
    let a = hp - M1; if (a < 0) a += H;
    let b = hp - M2; if (b < 0) b += H;
    if (++hp === H) hp = 0;
    let s = y - .5 * (hist[a] + hist[b]);
    if (i >= nLen) s *= 1 - (i - nLen) / rel;
    if (j >= 0) out[j] += s;
  }
}

/* ---- the amp: metal high-gain channel (packs/metal.js hgAmp on the engine's 'R' amp) or clean ---- */
const CAB_R = [['peak', 95, 1.1, 2.5], ['hp', 85, .9], ['peak', 120, 1.4, 3], ['peak', 380, 1.1, -3.5], ['peak', 1250, 1.4, 1.5],
  ['peak', 2850, 2.5, 5], ['peak', 4200, 3.2, -4.5], ['peak', 5300, 2.8, 2.5], ['lp', 5900, .8], ['lp', 7200, .6], ['lp', 11500, .7]];
const AMP_HG = { hp: 360, hump: [900, .8, 7], lpIn: 7400, g1: 34, b1: .22, lp1: 7600, g2: 9, b2: -.26, lp2: 6200,
  tone: [['ls', 110, .7, 5], ['peak', 650, .7, -6.5], ['hs', 3000, .7, 3]], g3: 2, cab: CAB_R };
const AMP_CLEAN = { hp: 90, hump: [700, .7, 1], lpIn: 11000, g1: .6, b1: .05, lp1: 12000, g2: 1, b2: 0, lp2: 11000,
  tone: [['ls', 200, .7, -2], ['peak', 550, .8, -2.5], ['hs', 2600, .7, 4]], g3: 1,
  cab: [['hp', 90, .7], ['peak', 2300, 1, 2], ['lp', 8500, .7]] };

function ampSim(di, A, sr){
  const n = di.length, out = new Float32Array(n), S4 = sr * 4, CH = 1024, LAT = 47;
  const pre = chain([['hp', A.hp, .7], ['peak', A.hump[0], A.hump[1], A.hump[2]], ['lp', A.lpIn, .7]], sr);
  const c1 = new OnePole().set(A.lp1, S4), c2 = new OnePole().set(A.lp2, S4);
  const dc1 = new OnePole().set(20, S4), dc2 = new OnePole().set(20, S4);
  const tone = chain(A.tone, S4);
  const { g1, b1, g2, b2, g3 } = A, o1 = tanh(b1), o2 = tanh(b2), n3 = 1 / tanh(g3);
  const u1 = new Up2(), u2 = new Up2(), d1 = new Down2(), d2 = new Down2();
  const X = new Float32Array(CH), Y = new Float32Array(2 * CH), Q = new Float32Array(4 * CH), Y2 = new Float32Array(2 * CH), Z = new Float32Array(CH);
  for (let s = 0; s < n + LAT; s += CH){
    for (let i = 0; i < CH; i++){ const k = s + i; X[i] = k < n ? pre(di[k]) : 0; }
    u1.process(X, Y); u2.process(Y, Q);                   // 4× oversampled: the tanh stages alias far less
    for (let i = 0; i < 4 * CH; i++){
      let x = Q[i];
      x = c1.lp(dc1.hp(tanh(x * g1 + b1) - o1));
      x = c2.lp(dc2.hp(tanh(x * g2 + b2) - o2));
      Q[i] = tanh(tone(x) * g3) * n3;
    }
    d1.process(Q, Y2); d2.process(Y2, Z);
    for (let i = 0; i < CH; i++){ const k = s + i - LAT; if (k >= 0 && k < n) out[k] = Z[i]; }
  }
  const cab = chain(A.cab, sr);
  // the guitar bus EQ (blocks.js gtrEQ): tame the sub, scoop the mud, leave a pocket for the lead
  const bus = chain([['hp', 95, .6], ['hp', 95, 1.2], ['lp', 11500, .7], ['peak', 300, 1, -3], ['peak', 3000, .8, -3]], sr);
  for (let i = 0; i < n; i++) out[i] = bus(cab(out[i]));
  return out;
}

/* keyed noise gate (packs/metal.js gateCurve): opens in .3 ms, holds, closes fast */
function gate(key, sr, { open = .02, close = .008, hold = .012, rel = .016 } = {}){
  const n = key.length, g = new Float32Array(n), look = Math.round(.0015 * sr), H = Math.round(hold * sr);
  const er = Math.exp(-1 / (.004 * sr)), at = 1 - Math.exp(-1 / (.0003 * sr)), rl = 1 - Math.exp(-1 / (rel * sr));
  let env = 0, h = 0, v = 0, on = false;
  for (let i = 0; i < n; i++){
    const a = i + look < n ? Math.abs(key[i + look]) : 0;
    env = a > env ? a : env * er;
    on = env > (on ? close : open);
    if (on) h = H; else if (h > 0) h--;
    const tg = h > 0 ? 1 : 0;
    v += (tg - v) * (tg > v ? at : rl);
    g[i] = v < 1e-5 ? 0 : v;
  }
  return g;
}

const cache = new Map();
/** One whole HIT (a chord or single note, open / muted / clean) → { samples, sr }. Cached per id. */
export function riffVoice(id){
  if (cache.has(id)) return cache.get(id);
  const { notes, mute, clean } = parseId(id);
  const midis = notes.map(noteNum).filter(Number.isFinite).sort((a, b) => a - b);
  const sr = SR, len = mute ? MUTE_LEN : OPEN_LEN, N = Math.round(len * sr);
  const r = rng(strHash(id) ^ 0x9e3779b9);
  const di = new Float32Array(N);
  const k = midis.length || 1;
  midis.forEach((m, s) => {
    const low = Math.max(0, (45 - m) / 13);
    // the stamps fall together; a hair of spread (≤ 2 ms) is just six real hammers, not a strum
    const t = .0015 + .0004 * s + .0006 * r();
    const vel = .9 * (1 - .05 * s) * (.93 + .14 * r()) * (k > 1 ? 1 : 1.1);
    pluck(di, { t, len: len - t - .01, f: mtof(m + (r() - .5) * .05), vel, mute: mute ? 1 : 0,
      seed: (r() * 4294967296) >>> 0, pick: .07 + .04 * r(), ring: 3.2 - .8 * low, damp: .1 + .08 * low,
      muteRing: .075 + .02 * r(), rel: .008 }, sr);
  });
  // the strike's click off the wound strings: what the gain turns into the "djent"
  { const bp = new Biquad().set('bp', 3000 + 800 * r(), .9, 0, sr), cl = mute ? .35 : .22, i0 = Math.round(.0015 * sr);
    let ns = (strHash(id) | 1) >>> 0;
    for (let i = 0; i < .006 * sr && i0 + i < N; i++){
      ns ^= ns << 13; ns >>>= 0; ns ^= ns >>> 17; ns ^= ns << 5; ns >>>= 0;
      di[i0 + i] += bp.tick(ns / 2147483648 - 1) * cl * Math.exp(-i / (.0012 * sr));
    } }
  const y = ampSim(di, clean ? AMP_CLEAN : AMP_HG, sr);
  if (!clean){ const g = gate(di, sr, mute ? { open: .01, close: .004, hold: .02, rel: .03 } : {}); for (let i = 0; i < N; i++) y[i] *= g[i]; }
  // level: a saturated guitar is DENSE (crest ≈ 3), so it is set by its body's RMS — peak-normalising it
  // would sit it ~8 dB over the mallets — capped so the peak never passes .86. Then a short fade to exactly 0.
  let pk = 0, ss = 0;
  const nb = Math.min(N, Math.round(.5 * sr));
  for (let i = 0; i < N; i++){ const a = Math.abs(y[i]); if (a > pk) pk = a; if (i < nb) ss += a * a; }
  const rms = Math.sqrt(ss / nb);
  const target = RMS_T * (midis.length > 1 ? 1 : 1.2);     // a single (lead) note sits a touch forward
  const gain = pk > 0 ? Math.min(.86 / pk, target / Math.max(rms, 1e-9)) : 0, fade = Math.round((mute ? .04 : .25) * sr);
  for (let i = 0; i < N; i++){
    const u = i > N - fade ? (N - 1 - i) / fade : 1;
    y[i] *= gain * (u * u);
  }
  y[N - 1] = 0;
  const v = { samples: y, sr };
  cache.set(id, v);
  return v;
}
