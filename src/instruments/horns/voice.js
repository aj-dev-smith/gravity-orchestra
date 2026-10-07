/* ============================================================
   BELLOWS HORNS voice — pure DSP, deterministic (seeded noise). id → {samples, sr}.

   Ported from Claw'd-o-Matic's ska horn section (web/packs/ska.js hornNote, AJ's own
   MIT code): a harmonic source read from band-limited wavetables — one per octave band
   and per dynamic level — then a fixed body (formant) EQ.
   · the spectral slope FLATTENS with dynamics (≈ −20 dB/oct at pp → −6 at ff): a louder
     note is a brighter note. Here the dynamic index rides the note's own envelope through
     a lag (the highs BLOOM after the fundamental, the way lips lock in), and the render's
     dynamic is fixed (the live path scales gain by velocity — one render per id serves
     every hit, so brightness is baked at a confident mezzo-forte… forte for the stabs).
   · attack: a tongue burst (band-passed noise), a lip-settle SCOOP (a little flat, then in
     tune, τ 28 ms), an accent overshoot on stabs.
   · breath noise gated by the waveform (pitch-synchronous); vibrato only on held notes
     (after 220 ms); a slow seeded pitch drift.
   · the family follows the register (layout.js family): TUBA (< C3 — so a Bb2 is a tuba), TROMBONE (< D4),
     TRUMPET — each its own spectrum + body formants.

   ids: 'C4'      = a held note (speaks HOLD_MAX s, then exhales; the live path releases at dur)
        'stab:C4' = a STAB (STAB_T s, accented, short exhale — also right on the iOS sample path,
                which can't release early)
   ============================================================ */
import { noteNum } from '../../engine.js';
import { HOLD_MAX, STAB_T, STAB_ID } from './solve.js';
import { family } from './layout.js';

export const SR = 32000;
const TAU = 2 * Math.PI;
const TN = 2048, ND = 8, NB = 8, FB0 = 40;            // table size, dynamic levels, octave bands from 40 Hz

const HORN = {
  tpt: { s0: 2.6, s1: .7, fund: .6, ripple: .12, phase: .23, atk: .013, rel: .045, settle: -.32, vib: .1, rate: 5.8, lag: .022,
    nz: .03, nzF: 2400, nzQ: .9, burst: .5, burstF: 3200, dyn: .78,
    body: [['hp', 220, .7], ['peak', 1250, 1, 5], ['peak', 2700, 1.6, 3.5], ['hs', 5000, .7, -3], ['lp', 9000, .7]] },
  tbn: { s0: 2.9, s1: .75, fund: .72, ripple: .1, phase: .19, atk: .024, rel: .07, settle: -.25, vib: .05, rate: 5.2, lag: .03,
    nz: .022, nzF: 1300, nzQ: .8, burst: .35, burstF: 1800, dyn: .8,
    body: [['hp', 65, .7], ['peak', 520, .9, 4.5], ['peak', 1200, 1.3, 3], ['hs', 3500, .7, -4], ['lp', 6500, .7]] },
  // the tuba: a darker, rounder slope, its fundamental kept (it IS the floor) — but its body
  // lifts the 2nd–4th partials so ~35 % of an E2's energy sits above 200 Hz (phone speakers
  // roll off below that — CLAUDE.md §5; a fundamental-heavy tuba vanished on a phone)
  tba: { s0: 3.3, s1: .85, fund: .6, ripple: .08, phase: .17, atk: .032, rel: .09, settle: -.2, vib: .03, rate: 4.8, lag: .036,
    nz: .016, nzF: 700, nzQ: .7, burst: .28, burstF: 900, dyn: .85,
    body: [['hp', 45, .7], ['peak', 320, .9, 4.5], ['peak', 640, 1.2, 4], ['hs', 2400, .7, -5], ['lp', 4200, .7]] },
};

const TABLES = {};
function tables(id, b){
  const k = id + b;
  if (TABLES[k]) return TABLES[k];
  const I = HORN[id], maxH = Math.max(1, Math.floor(15000 / (FB0 * Math.pow(2, b + 1)))), Hn = Math.min(maxH, TN / 2 - 1);
  const out = [];
  for (let di = 0; di < ND; di++){
    const d = di / (ND - 1), s = I.s0 + (I.s1 - I.s0) * d, tab = new Float32Array(TN + 1);
    let pw = 0;
    for (let h = 1; h <= Hn; h++){
      const a = Math.pow(h, -s) * (h === 1 ? 1 - I.fund * d : 1) * (1 + I.ripple * Math.sin(h * 2.1 + .5));
      if (a < 1e-5) continue;
      pw += a * a / 2;
      // fixed quadratic phases: a crest factor of ~5–7 dB, a buzzing lip rather than a pulse train
      const ph = I.phase * Math.PI * h * h, w = TAU * h / TN, cw = Math.cos(w), sw = Math.sin(w);
      let c = Math.cos(ph), sn = Math.sin(ph);
      for (let i = 0; i < TN; i++){ tab[i] += a * c; const c2 = c * cw - sn * sw; sn = sn * cw + c * sw; c = c2; }
    }
    const gn = .5 / Math.sqrt(pw || 1);
    for (let i = 0; i < TN; i++) tab[i] *= gn;
    tab[TN] = tab[0];
    out.push(tab);
  }
  return (TABLES[k] = out);
}
const bandOf = f => Math.max(0, Math.min(NB - 1, Math.floor(Math.log2(f / FB0))));

/* ---- tiny deterministic kernel (no AudioContext) ---- */
function rng(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(TAU * r());
const sstep = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
class Biquad {
  constructor(){ this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, gain = 0){
    const w = TAU * Math.max(5, Math.min(f, SR * .49)) / SR, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, gain / 40), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp'){ b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp'){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp'){ b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'peak'){ b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    else {                                               // 'hs' high shelf
      const sA = 2 * Math.sqrt(A) * (s / 2) * Math.SQRT2;
      b0 = A * (A + 1 + (A - 1) * c + sA); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - sA);
      a0 = A + 1 - (A - 1) * c + sA; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - sA;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x){ const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}

/* one note of one horn into M (hornNote, trimmed to the articulations a marble can play:
   held / stab+accent). o: { m, dur, vel, stab, seed } */
function hornNote(M, id, o){
  const I = HORN[id], r = rng(o.seed >>> 0), vel = o.vel, x = { st: o.stab, acc: o.stab };
  let ns = (o.seed ^ 0x2545f491) >>> 0 || 1;
  const white = () => { ns ^= ns << 13; ns >>>= 0; ns ^= ns >>> 17; ns ^= ns << 5; ns >>>= 0; return ns / 2147483648 - 1; };
  const rel = I.rel * (x.st ? .7 : 1), n = Math.min(M.length, Math.round((o.dur + 6 * rel) * SR));
  const atk = I.atk * (1.25 - .4 * vel);
  const bp = new Biquad().set('bp', I.nzF, I.nzQ), bz = new Biquad().set('bp', I.burstF, 1.1);
  const vibD = o.dur > .32 ? I.vib : 0, vibR = I.rate * (.96 + .08 * r()), vph = r() * 6.28;
  const fp = x.st ? .75 : .88, lagA = 1 - Math.exp(-16 / (I.lag * SR));
  let ph = r(), drift = 0, ab = 0, A0 = 0, A1 = 0;
  for (let i = 0; i < n; i += 16){
    const t = i / SR;
    let p = o.m + I.settle * Math.exp(-t / .028);
    if (vibD) p += vibD * sstep((t - .22) / .35) * Math.sin(TAU * vibR * t + vph);
    drift += gauss(r) * .0025; drift *= .998;
    p += drift + gauss(r) * .003;
    const f = 440 * Math.pow(2, (p - 69) / 12), inc = f / SR;
    let A;
    if (t < o.dur){
      const on = 1 - Math.exp(-t / atk);
      A = on * (fp + (1 - fp) * Math.exp(-t / .13)) * (1 + (x.acc ? .35 : 0) * Math.exp(-t / .06));
      A1 = A;
    } else A = A1 * Math.exp(-(t - o.dur) / rel);
    ab += (A - ab) * lagA;
    const D = Math.max(0, Math.min(1, vel * (.3 + .7 * Math.min(1.2, ab)) + (x.acc ? .2 * Math.exp(-t / .08) : 0)));
    const dd = D * (ND - 1), di = Math.min(ND - 2, Math.floor(dd)), dfr = dd - di;
    const TB = tables(id, bandOf(f)), t1 = TB[di], t2 = TB[di + 1];
    const Aend = A * Math.pow(vel, 1.3), mm = Math.min(16, n - i);
    for (let k = 0; k < mm; k++){
      const a = A0 + (Aend - A0) * (k / 16);
      ph += inc; if (ph >= 1) ph -= 1;
      const q = ph * TN, qi = q | 0, qf = q - qi;
      const w1 = t1[qi] + (t1[qi + 1] - t1[qi]) * qf, w2 = t2[qi] + (t2[qi + 1] - t2[qi]) * qf;
      let y = w1 + (w2 - w1) * dfr;
      const nz = bp.tick(white()) * (.3 + .7 * Math.max(0, y)) * I.nz;
      y = y * a + nz * Math.sqrt(a);
      const tt = t + k / SR;
      if (tt < .03) y += bz.tick(white()) * I.burst * vel * Math.exp(-tt / .006);
      M[i + k] += y;
    }
    A0 = Aend;
  }
}

const cache = new Map();
/** id = 'C4' (held) | 'stab:C4' (stab) → { samples, sr } */
export function hornVoice(id){
  if (cache.has(id)) return cache.get(id);
  const stab = id.startsWith(STAB_ID), note = stab ? id.slice(STAB_ID.length) : id;
  const m = noteNum(note), fam = family(m), I = HORN[fam];
  const dur = stab ? STAB_T : HOLD_MAX;
  const N = Math.round((dur + 6 * I.rel * (stab ? .7 : 1) + .03) * SR);
  const dry = new Float32Array(N);
  hornNote(dry, fam, { m, dur, vel: stab ? .95 : I.dyn, stab, seed: (m * 7919 + (stab ? 101 : 0)) >>> 0 });
  // the body: fixed formant EQ per horn
  const chain = I.body.map(([type, f, q, gn]) => new Biquad().set(type, f, q, gn || 0));
  for (let i = 0; i < N; i++){ let y = dry[i]; for (const b of chain) y = b.tick(y); dry[i] = y; }
  // exactly silent at the end: a 25 ms raised-cosine tail (the release already took it to ~−50 dB)
  const z = Math.round(SR * .025);
  for (let i = 0; i < z; i++) dry[N - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / z);
  dry[N - 1] = 0;
  // …and exactly silent at the start: a 1 ms fade-in (the tongue burst starts on a non-zero sample)
  const zi = Math.round(SR * .001);
  for (let i = 0; i < zi; i++) dry[i] *= .5 - .5 * Math.cos(Math.PI * i / zi);
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(dry[i]));
  const k = (stab ? .86 : .8) / (peak || 1);
  for (let i = 0; i < N; i++) dry[i] *= k;
  dry[N - 1] = 0;
  const v = { samples: dry, sr: SR };
  cache.set(id, v);
  return v;
}
