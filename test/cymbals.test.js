import { describe, it, expect } from 'vitest';
import { dribbleAt, firstStrike } from '../src/engine.js';
import { GM_DRUMS, drumByGm, normalizeHit, isCymbal } from '../src/drumkit.js';
import { metalVoice, METAL_VOICES, METAL, VARIANTS, PEAK } from '../src/cymbals.js';
import { SONGS } from '../src/songs/index.js';
import { kitPieces, pieceLane, styleOf, CYMBALS, STYLE, STANDS, cymbalSchedule, cymbalPose, cymbalPiston,
         cymbalSurface, cymbalUnder, cymbalPivot, clampLip, clampAt, CLAMP, SWING, DT_MAX, MAG_H, DROP_V } from '../src/drumparts.js';

/* ---------------------------------------------------------------------------
   REAL CYMBALS — the registry, the voices, and the hung-cymbal mechanism's
   honesty: every ball lands on a cymbal that is LEVEL, AT REST and exactly where
   the dribble solve says (its piston quiet, its swing clamped out); the clamp's
   felt never passes through the bronze; nothing teleports; a choke grabs it.
--------------------------------------------------------------------------- */

describe('registry: the real cymbals', () => {
  it('GM numbers land on the right piece', () => {
    const want = { 49: 'crash', 57: 'crash', 51: 'ride', 59: 'ride', 53: 'rideBell', 52: 'china', 55: 'splash', 46: 'hatOpen' };
    for (const [gm, lane] of Object.entries(want)) expect(drumByGm(+gm), `GM ${gm}`).toBe(lane);
  });
  it('every cymbal lane has a zone, a style and a stand for its cymbal', () => {
    for (const [name, d] of Object.entries(GM_DRUMS)) if (d.cymbal){
      expect(isCymbal(name)).toBe(true);
      const z = CYMBALS[name];
      expect(z, name).toBeTruthy();
      expect(STYLE[name]?.kind).toBe('cymbal');
      expect(STANDS[z.on], name).toBeTruthy();
      expect(d.metal).toBe(true);
    }
    expect(isCymbal('kick')).toBe(false);
    expect(isCymbal('hat')).toBe(false);
  });
  it('the zones read right: crash on the edge, ride on the bow, the bell on the bell (same cymbal)', () => {
    expect(CYMBALS.crash.rho).toBeGreaterThan(.78);
    expect(CYMBALS.ride.rho).toBeGreaterThan(.4); expect(CYMBALS.ride.rho).toBeLessThan(.75);
    expect(CYMBALS.rideBell.on).toBe('ride');
    const rb = .21;                                                     // cymbalProfile: the bell's radius / R
    expect(CYMBALS.rideBell.rho).toBeLessThan(rb);
  });
  it('cymbals sit under the shells in the mix (loud + bright by nature)', () => {
    for (const [, d] of Object.entries(GM_DRUMS)) if (d.cymbal) expect(d.gain).toBeLessThanOrEqual(GM_DRUMS.snare.gain * .7);
  });
  it('normalizeHit carries an optional choke (beats after the hit)', () => {
    expect(normalizeHit([4, .8, .5])).toEqual({ beat: 4, vel: .8, choke: .5 });
    expect(normalizeHit([4, .8])).toEqual({ beat: 4, vel: .8 });
    expect(normalizeHit(4)).toEqual({ beat: 4, vel: 1 });
  });
});

/* ---------------------------------------------------------------------------- voices */
const zcr = (s, sr, a, b) => { let n = 0; for (let i = (a * sr) | 0; i < Math.min(s.length, (b * sr) | 0) - 1; i++) if ((s[i] >= 0) !== (s[i + 1] >= 0)) n++; return n / (b - a); };
const rms = (s, sr, a, b) => { let q = 0, n = 0; for (let i = (a * sr) | 0; i < Math.min(s.length, (b * sr) | 0); i++){ q += s[i] * s[i]; n++; } return Math.sqrt(q / Math.max(1, n)); };
describe('metal voices (cymbals.js)', () => {
  for (const name of METAL_VOICES) it(`${name}: deterministic, finite, bounded, decays to an exact 0`, () => {
    for (let v = 0; v < (VARIANTS[name] || 1); v++){
      const a = metalVoice(name, v), b = metalVoice(name, v);
      expect(a).toBe(b);                                                // cached: the same array
      const s = a.samples;
      expect(a.sr).toBeGreaterThanOrEqual(22050);
      expect(s.length).toBeLessThan(4 * a.sr);
      let pk = 0; for (const x of s){ expect(Number.isFinite(x)).toBe(true); pk = Math.max(pk, Math.abs(x)); }
      expect(pk).toBeCloseTo(PEAK, 6);
      expect(s[s.length - 1]).toBe(0);
      const T = s.length / a.sr;
      expect(rms(s, a.sr, 0, .05)).toBeGreaterThan(.05);                 // a real hit
      expect(rms(s, a.sr, T * .85, T)).toBeLessThan(rms(s, a.sr, 0, .1) * .15);   // and it dies away
      // …and is never GATED: the last 60 ms sit ≥ 40 dB under the attack (a fade, not a cut)
      if (name !== 'clap') expect(rms(s, a.sr, T - .06, T)).toBeLessThan(rms(s, a.sr, 0, .1) * .01);
    }
  });
  it('variants are distinct strokes, not copies', () => {
    const a = metalVoice('ride', 0).samples, b = metalVoice('ride', 1).samples;
    let d = 0; for (let i = 0; i < 4000; i++) d += Math.abs(a[i] - b[i]);
    expect(d / 4000).toBeGreaterThan(.01);
  });
  it('sustain reads by size: crash rings longest, then ride/china, splash short, open hat shortest', () => {
    const tail = n => { const { samples: s, sr } = metalVoice(n); return rms(s, sr, .6, 1.0) / rms(s, sr, 0, .1); };
    expect(tail('crash')).toBeGreaterThan(tail('splash'));
    expect(tail('splash')).toBeGreaterThan(tail('hatOpen'));
    expect(METAL.crash.dur).toBeGreaterThan(METAL.splash.dur);
  });
  it('brightness reads right: the open hat and splash are brighter than the china', () => {
    const z = n => { const { samples: s, sr } = metalVoice(n); return zcr(s, sr, .02, .2); };
    expect(z('hatOpen')).toBeGreaterThan(z('china'));
    expect(z('splash')).toBeGreaterThan(z('china'));
  });
});

/* ---------------------------------------------------------------------------- the mechanism */
const BEAT = .5, ROLL = 2.6, START = -2.4;
function build(spec, P){
  const ps = kitPieces(spec), cy = new Map();
  for (const p of ps){
    if (!p.cym) continue;
    const meta = pieceLane(p, spec, { rollT: ROLL, beat: BEAT, P, dtMax: DT_MAX });
    const vInMax = Math.max(DROP_V(DT_MAX), ...meta.L.vIn);
    const c = cy.get(p.cym) || cy.set(p.cym, { on: p.cym, ms: [] }).get(p.cym);
    c.ms.push({ p, L: meta.L, meta, rho: p.rho, dir: p.dir, vInMax });
  }
  for (const c of cy.values()) c.C = cymbalSchedule(c.on, c.ms, P, { dtMax: DT_MAX });
  return [...cy.values()];
}
/* the cymbal's surface height at a member's contact, relative to rest: piston + the tilt's dip there */
const dipAt = (q, m) => { const x = m.rho * Math.sin(m.dir), z = m.rho * Math.cos(m.dir); return -q.rx * z + q.rz * x; };

const SPECS = [
  ['ride + its bell + crash + choke', { ride: [0, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7], rideBell: [.5, 2.5, 3.5, 6.5, 7.5],
     crash: [[0, 1], [4, .8, 1.5]], china: [[2, .9], [6, 1, .25]], splash: [[3, .7]], kick: [0, 4] }, 8],
  ['bell alone builds the ride cymbal', { rideBell: [0, 1, 2.5, 3], kick: [0] }, 4],
  ['dense eighth ride', { ride: Array.from({ length: 16 }, (_, i) => i / 2) }, 8],
  ...Object.entries(SONGS).filter(([, s]) => s.drums && Object.keys(s.drums).some(isCymbal))
    .map(([k, s]) => [k, s.drums, s.melody.reduce((a, n) => a + n[1], 0)]),
];

for (const [name, spec, beats] of SPECS) describe(`hung cymbals — ${name}`, () => {
  const P = ROLL + beats * BEAT + 1.2;
  const cys = build(spec, P);
  const strikes = cys.flatMap(c => c.ms.flatMap(m => {
    const out = [], f = firstStrike(m.L, START);
    for (let loop = 0; loop < 3; loop++) for (const s of m.L.s){ const a = s + Math.ceil((f - s) / P) * P + loop * P; if (a >= f - 1e-9) out.push({ c, m, a }); }
    return out;
  }));

  it('has cymbals to test', () => { expect(cys.length).toBeGreaterThan(0); expect(strikes.length).toBeGreaterThan(0); });

  it('every ball lands on a LEVEL cymbal at rest, exactly where the solve says', () => {
    for (const { c, m, a } of strikes){
      const q = cymbalPose(c.C, a, START);
      expect(Math.abs(q.rx) + Math.abs(q.rz), `${m.p.key} @${a.toFixed(3)}`).toBeLessThan(1e-9);
      expect(Math.abs(cymbalPiston(c.ms, a, START)), `piston ${m.p.key} @${a.toFixed(3)}`).toBeLessThan(1e-9);
      expect(Math.abs(dribbleAt(m.L, a, START).y)).toBeLessThan(1e-9);       // the ball is on it
      // just before: the cymbal is still (no swing, the piston only strokes for its OWN ball)
      const qb = cymbalPose(c.C, a - 1e-4, START);
      expect(Math.abs(qb.rx) + Math.abs(qb.rz)).toBeLessThan(1e-6);
    }
  });

  it('the clamp felt never passes through the bronze; the ball never passes through the cymbal', () => {
    for (const c of cys){
      const lip = clampLip(c.on);
      for (let t = START; t < START + 2.2 * P; t += .001){
        const q = cymbalPose(c.C, t, START);
        expect(Math.hypot(q.rx, q.rz) * lip, `clamp @${t.toFixed(3)}`).toBeLessThanOrEqual(CLAMP.gap * (1 - q.k) + 1e-9);
        const pist = cymbalPiston(c.ms, t, START);
        for (const m of c.ms){
          const d = dribbleAt(m.L, t, START);
          expect(d.y - (pist + dipAt(q, m)), `${m.p.key} ball @${t.toFixed(3)}`).toBeGreaterThan(-2e-3);
        }
      }
    }
  });

  it('nothing teleports: swing, clamp and piston are continuous (count-in, strikes, chokes, the seam)', () => {
    for (const c of cys){
      let q0 = cymbalPose(c.C, START, START), y0 = cymbalPiston(c.ms, START, START);
      for (let t = START + .0005; t < START + 2.2 * P; t += .0005){
        const q = cymbalPose(c.C, t, START), y = cymbalPiston(c.ms, t, START);
        expect(Math.abs(q.rx - q0.rx) + Math.abs(q.rz - q0.rz), `swing @${t.toFixed(4)}`).toBeLessThan(.012);
        expect(Math.abs(q.k - q0.k), `clamp @${t.toFixed(4)}`).toBeLessThan(.06);
        expect(Math.abs(y - y0), `piston @${t.toFixed(4)}`).toBeLessThan(.03);
        q0 = q; y0 = y;
      }
    }
  });

  it('ARMED through the count-in: clamped, level, still', () => {
    for (const c of cys) for (let t = START; t < START + .5; t += .01){
      const q = cymbalPose(c.C, t, START);
      if (q.i >= 0) break;
      expect(q.k).toBe(1); expect(q.rx).toBe(0); expect(q.rz).toBe(0);
    }
  });

  it('it really swings after a hit (when the gap gives it room)', () => {
    let seen = 0;
    for (const c of cys) c.C.Lm.s.forEach((s, j) => {
      if (c.C.Lm.gaps[j] < .5 || c.C.amp[j] < .02 || c.C.choke[j] < .3) return;
      let mx = 0;
      for (let u = .02; u < .4; u += .005){ const q = cymbalPose(c.C, s + P + u, START); mx = Math.max(mx, Math.hypot(q.rx, q.rz)); }
      expect(mx).toBeGreaterThan(c.C.amp[j] * .25);
      seen++;
    });
    if (!/dense|bell alone/.test(name)) expect(seen).toBeGreaterThan(0);   // (a bell hit barely rocks it; dense eighths never leave it room)
  });

  it('a choke grabs it: clamp shut and the swing gone until the next hit', () => {
    for (const c of cys) c.C.Lm.s.forEach((s, j) => {
      const ck = c.C.choke[j];
      if (!(ck < Infinity)) return;
      for (let u = ck + CLAMP.choke; u < c.C.Lm.gaps[j] - .005; u += .005){
        const q = cymbalPose(c.C, s + P + u, START);
        expect(q.k).toBeCloseTo(1, 9); expect(Math.hypot(q.rx, q.rz)).toBeLessThan(1e-9);
      }
    });
  });
});

describe('hung cymbal geometry', () => {
  it('every ball strikes its own cymbal — and a guest ball (the bell) never shares air with the host ball', () => {
    const ps = kitPieces({ ride: [0], rideBell: [1], crash: [0], china: [0], splash: [0] });
    const ride = ps.find(p => p.key === 'ride'), bell = ps.find(p => p.key === 'rideBell');
    expect(bell.host).toBe('ride');
    expect([bell.cx, bell.cz]).toEqual([ride.cx, ride.cz]);
    // the two magnets (radius ≥ .2, × 1.04) sit side by side over the one cymbal
    const mr = p => Math.max(.2, styleOf(p.key).ball * 1.6) * 1.04;
    expect(Math.hypot(ride.x - bell.x, ride.z - bell.z)).toBeGreaterThan(mr(ride) + mr(bell));
    for (const p of ps){
      expect(Math.hypot(p.x - p.cx, p.z - p.cz) + styleOf(p.key).ball).toBeLessThanOrEqual(styleOf(p.cym).r);   // on the bronze
      expect(p.lift).toBeCloseTo(p.bell + cymbalSurface(p.cym, p.rho), 12);
    }
  });
  it('the china hangs inverted: its edge sits above its bell; the others dish down', () => {
    expect(cymbalSurface('china', .8)).toBeGreaterThan(cymbalSurface('china', 0));
    for (const on of ['crash', 'ride', 'splash']) expect(cymbalSurface(on, .3)).toBeLessThan(cymbalSurface(on, 0));
  });
  it('the clamp lip meets the underside inside the bell mouth, below the pivot side of the bronze', () => {
    for (const on of ['crash', 'ride', 'china', 'splash']){
      const lip = clampLip(on);
      expect(cymbalUnder(on, lip)).toBeLessThan(cymbalSurface(on, lip));
      // the worst free swing stays inside the clamp's travel (so the lip can always reach it)
      expect((SWING.amp[on] ?? .15) * Math.hypot(1, SWING.a2) * lip).toBeLessThan(CLAMP.gap);
      expect(cymbalPivot(on)).toBeLessThanOrEqual(cymbalSurface(on, 0));
    }
  });
  it('bigger cymbals sway slower (frequency a pure fn of size)', () => {
    expect(SWING.f(styleOf('crash').r)).toBeLessThan(SWING.f(styleOf('splash').r));
  });
  it('clampAt is 1 at every strike, 0 somewhere in a roomy gap, and in [0, 1]', () => {
    for (const gap of [.25, .5, 1.2, 4]){
      expect(clampAt(0, gap, 1)).toBe(1); expect(clampAt(gap, gap, 1)).toBe(1);
      let mn = 1; for (let s = 0; s <= gap; s += .001){ const k = clampAt(s, gap, 1); expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(1); mn = Math.min(mn, k); }
      if (gap >= .5) expect(mn).toBe(0);
    }
  });
  it('magnets still hang at the max apex over each ball', () => { expect(MAG_H).toBeCloseTo(14.5 * DT_MAX * DT_MAX / 8, 9); });
});
