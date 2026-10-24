import { describe, it, expect } from 'vitest';
import { G } from '../src/engine.js';
import { segEval, dtFree, minMoveT, CRANE, EV, EA } from '../src/crane.js';

/* ---------------------------------------------------------------------------
   MAGNET CRANE — the carriages' motion primitives (src/crane.js). The belt's
   plans (src/juggle.js) are built from these and audited against them in
   test/juggle.test.js; this suite pins the primitives themselves: the free-flight
   cap, the quintic move's ends and peaks, and the least move time under the limits.
   --------------------------------------------------------------------------- */
const g = -G.y;
const P0 = { x: 1, y: 2, z: -.5 }, P1 = { x: 4, y: -1, z: .5 };
const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

describe('magnet crane — motion primitives', () => {
  it('dtFree: the longest free flight peaks at exactly H_FREE (apex = g·F²/8)', () => {
    const F = dtFree(g);
    expect(g * F * F / 8).toBeCloseTo(CRANE.H_FREE, 12);
    expect(F).toBeCloseTo(1.702, 3);
  });

  it('segEval: a rest-to-rest move starts and ends at its keys, at rest', () => {
    const k0 = [2, P0], k1 = [2.8, P1];
    for (const [t, p] of [[2, P0], [2.8, P1], [1, P0], [9, P1]]){      // (clamped outside its span)
      const e = segEval(k0, k1, t);
      expect(Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z)).toBeLessThan(1e-12);
      expect(Math.hypot(e.vx, e.vy, e.vz)).toBeLessThan(1e-12);
    }
  });

  it('segEval: rest to rest is smootherstep — peak |v|·T/D = EV, peak |a|·T²/D = EA', () => {
    const T = .8, D = len(P0, P1), k0 = [0, P0], k1 = [T, P1];
    let vMax = 0, aMax = 0, h = 1e-5;
    for (let q = 0; q <= 4000; q++){
      const t = T * q / 4000, e = segEval(k0, k1, t);
      vMax = Math.max(vMax, Math.hypot(e.vx, e.vy, e.vz));
      if (t > h && t < T - h){
        const a = segEval(k0, k1, t - h), b = segEval(k0, k1, t + h);
        aMax = Math.max(aMax, Math.hypot(b.vx - a.vx, b.vy - a.vy, b.vz - a.vz) / (2 * h));
      }
    }
    expect(vMax * T / D).toBeCloseTo(EV, 4);
    expect(aMax * T * T / D).toBeCloseTo(EA, 3);
  });

  it('segEval: end velocities are honoured, and a constant-velocity glide is exactly linear', () => {
    const v0 = { x: 3, y: 0, z: 0 }, v1 = { x: 0, y: -2, z: 1 };
    const s = segEval([0, P0, v0], [1, P1, v1], 0), e = segEval([0, P0, v0], [1, P1, v1], 1);
    expect([s.vx, s.vy, s.vz]).toEqual([3, 0, 0]);
    expect(e.vx).toBeCloseTo(0, 12); expect(e.vy).toBeCloseTo(-2, 12); expect(e.vz).toBeCloseTo(1, 12);
    const v = { x: P1.x - P0.x, y: P1.y - P0.y, z: P1.z - P0.z };      // P0 → P1 in 1 s at constant speed
    for (const t of [.1, .37, .5, .92]){
      const q = segEval([0, P0, v], [1, P1, v], t);
      expect(q.x).toBeCloseTo(P0.x + v.x * t, 12); expect(q.y).toBeCloseTo(P0.y + v.y * t, 12); expect(q.z).toBeCloseTo(P0.z + v.z * t, 12);
      expect(q.vx).toBeCloseTo(v.x, 12); expect(q.vy).toBeCloseTo(v.y, 12); expect(q.vz).toBeCloseTo(v.z, 12);
    }
  });

  it('minMoveT: the least time keeps a smootherstep move under V_MAX and A_MAX, one of them exactly', () => {
    expect(minMoveT(0)).toBe(0);
    for (const D of [.05, .3, 1, 2.5, 8, 30]){
      const T = minMoveT(D), v = EV * D / T, a = EA * D / (T * T);
      expect(v).toBeLessThanOrEqual(CRANE.V_MAX + 1e-9);
      expect(a).toBeLessThanOrEqual(CRANE.A_MAX + 1e-9);
      expect(Math.max(v / CRANE.V_MAX, a / CRANE.A_MAX)).toBeCloseTo(1, 9);
    }
    expect(minMoveT(2)).toBeGreaterThan(minMoveT(1));                    // longer moves take longer
  });
});
