import { describe, it, expect } from 'vitest';
import { G, dribbleLane, dribbleAt, dribblePiston, firstStrike } from '../src/engine.js';

/* ---------------------------------------------------------------------------
   The dribble — one immortal ball per drum, bouncing only on that drum. These
   pin the honesty invariants the render builds on: the ball touches the head at
   EXACTLY every strike and never otherwise goes below it, never rises above the
   magnet, never teleports (seam, hold, release, count-in), and the piston is at
   rest at every contact.
--------------------------------------------------------------------------- */

const g = -G.y;
const DT = 1.2;
const P = 4;
// a lane with every kind of gap: dribble (.25), mid arcs, and a long magnet hold
const lane = dribbleLane([0, .25, .5, 1.5, 3.4], P, { dtMax: DT });

const sweep = (L, t0, t1, step, start) => {
  const out = [];
  for (let t = t0; t <= t1; t += step) out.push({ t, ...dribbleAt(L, t, start) });
  return out;
};

describe('dribbleLane — schedule', () => {
  it('sorts, wraps negative pickup beats, and closes the seam', () => {
    const L = dribbleLane([2, -0.5, 0], P);
    expect(L.s).toEqual([0, 2, 3.5]);
    expect(L.gaps.reduce((a, b) => a + b, 0)).toBeCloseTo(P, 12);
  });
  it('magnet height is the max apex', () => {
    expect(lane.H).toBeCloseTo(g * DT * DT / 8, 12);
  });
});

describe('dribbleAt — contact honesty', () => {
  it('the ball is on the head at every strike, every loop', () => {
    for (let k = 0; k < 3; k++)
      for (const s of lane.s)
        expect(dribbleAt(lane, s + k * P).y).toBeCloseTo(0, 9);
  });

  it('never below the head, never above the magnet', () => {
    for (const p of sweep(lane, 0, 2 * P, .0037)){
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(lane.H + 1e-9);
    }
  });

  it('a short gap is a plain arc with apex |G|·gap²/8', () => {
    const mid = dribbleAt(lane, 1.0);                 // gap .5 → 1.5 is 1.0 s, apex at .5 in
    expect(mid.y).toBeCloseTo(g * 1 / 8, 9);
    expect(mid.vy).toBeCloseTo(0, 9);
  });

  it('a long gap kisses the magnet at zero speed, holds, then free-falls onto the beat', () => {
    // 1.5 → 3.4 is a 1.9 s gap > dtMax
    const arrive = dribbleAt(lane, 1.5 + DT / 2);
    expect(arrive.y).toBeCloseTo(lane.H, 9);
    expect(arrive.vy).toBeCloseTo(0, 9);
    const held = dribbleAt(lane, 2.4);
    expect(held.mode).toBe('hold');
    expect(held.y).toBeCloseTo(lane.H, 12);
    const land = dribbleAt(lane, 3.4 - 1e-7);
    expect(land.mode).toBe('drop');
    expect(land.y).toBeCloseTo(0, 5);
    expect(-land.vy).toBeCloseTo(g * DT / 2, 4);    // lands at the full drop speed
  });

  it('is continuous everywhere — no teleports across seam, hold, or release', () => {
    const step = .0005;
    const ps = sweep(lane, -1, 2 * P + 1, step);
    const vmax = g * DT / 2;                          // fastest the ball ever moves
    for (let i = 1; i < ps.length; i++)
      expect(Math.abs(ps[i].y - ps[i - 1].y)).toBeLessThanOrEqual(vmax * step * 1.01 + 1e-9);
  });

  it('binary search agrees with a brute-force scan on a dense lane', () => {
    const hits = Array.from({ length: 300 }, (_, i) => (i * 0.0617) % 16);
    const L = dribbleLane(hits, 16);
    for (let t = 0; t < 32; t += .0371){
      const tau = t % 16;
      let i = L.s.length - 1;
      for (let j = 0; j < L.s.length; j++) if (L.s[j] <= tau) i = j;
      expect(dribbleAt(L, t).i).toBe(i);
    }
  });
});

describe('dribbleAt — the armed count-in', () => {
  const start = -2.4;
  it('hangs on the magnet until it must drop, then lands on the first strike', () => {
    const first = firstStrike(lane, start);
    expect(first).toBeCloseTo(lane.s.find(s => s - P >= start) - P, 12);   // 3.4 − 4 = −.6
    const a = dribbleAt(lane, start, start);
    expect(a.mode).toBe('hold');
    expect(a.y).toBeCloseTo(lane.H, 12);
    expect(dribbleAt(lane, first, start).y).toBeCloseTo(0, 9);
  });
  it('is continuous from the count-in into the groove', () => {
    const step = .0005, vmax = g * DT / 2;
    const ps = sweep(lane, start, P, step, start);
    for (let i = 1; i < ps.length; i++)
      expect(Math.abs(ps[i].y - ps[i - 1].y)).toBeLessThanOrEqual(vmax * step * 1.01 + 1e-9);
  });
});

describe('dribblePiston — the visible force', () => {
  it('is exactly at rest at every strike', () => {
    for (let k = 0; k < 2; k++)
      for (const s of lane.s) expect(dribblePiston(lane, s + k * P)).toBeCloseTo(0, 12);
  });
  it('a steady groove still kicks every hit — a real bounce is lossy', () => {
    const hat = dribbleLane([0, .5, 1, 1.5], 2);
    // just before each strike the piston is wound DOWN (loading the kick)
    for (const s of hat.s) expect(dribblePiston(hat, s + 2 - .06)).toBeLessThan(0);
    // a perfectly elastic ball (e = 1) needs nothing
    for (let t = 0; t < 4; t += .013) expect(dribblePiston(hat, t, { e: 1 })).toBe(0);
  });
  it('kicks harder before a taller arc', () => {
    const peak = (L, s) => { let m = 0; for (let c = -.4; c < 0; c += .002) m = Math.min(m, dribblePiston(L, s + c)); return -m; };
    // strike .5 launches the 1 s arc; strike .25 launches a .25 s dribble — same incoming speed
    expect(peak(lane, .5)).toBeGreaterThan(peak(lane, .25));
  });
  it('gives (catches) when even a lossy bounce would overshoot', () => {
    // strike 0 follows the long magnet drop (vIn = full) and launches a .25 s dribble
    expect(dribblePiston(lane, P - .05)).toBeGreaterThan(0);
  });
});

describe('dribble × piston — no penetration', () => {
  it('the head never rises through the ball (dense, sparse, and count-in)', () => {
    const lanes = [
      lane,
      dribbleLane([0, .06, .12, .5, 2.9, 3.0, 3.05], P),        // flams + a roll after a hold
      dribbleLane(Array.from({ length: 64 }, (_, i) => i / 16), P),   // 16th-note buzz
    ];
    for (const L of lanes) for (const start of [-Infinity, -2.4])
      for (let t = -2.4; t < 2 * P; t += .0011){
        const ball = dribbleAt(L, t, start).y, head = dribblePiston(L, t, { start });
        expect(ball - head).toBeGreaterThanOrEqual(-1e-9);
      }
  });
});
