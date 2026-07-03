import { describe, it, expect } from 'vitest';
import { allocateJuggle } from '../src/engine.js';

/* ---------------------------------------------------------------------------
   The juggle allocator — the drum kit's buildTrack. These tests pin down the
   schedule invariants the render layer builds on: full coverage, cyclic legs
   that sum to exactly P, MRU dribbling, dead-zone spawning, seam wrapping.
--------------------------------------------------------------------------- */

const OPTS = { dtMax: 1.7, minTransit: 2.2, minHop: 0.05 };
const hit = (lane, s, vel = 1) => ({ lane, s, vel });

/** flatten a schedule back to (lane, s) pairs for coverage checks */
const covered = balls => balls.flatMap(b => b.strikes.map(k => `${k.lane}@${k.s.toFixed(6)}`)).sort();

describe('allocateJuggle — coverage & cycle invariants', () => {
  // a backbeat at 120bpm (beat = .5s), P = 4 beats = 2s
  const P = 2;
  const groove = [
    hit('kick', 0), hit('kick', 1),                       // beats 1 & 3
    hit('snare', 0.5), hit('snare', 1.5),                 // beats 2 & 4
    ...[0, .25, .5, .75, 1, 1.25, 1.5, 1.75].map(s => hit('hat', s)),   // eighths
  ];

  it('covers every non-beater hit exactly once', () => {
    const balls = allocateJuggle(groove, P, { ...OPTS, beaterLanes: ['kick'] });
    const want = groove.filter(h => h.lane !== 'kick')
      .map(k => `${k.lane}@${k.s.toFixed(6)}`).sort();
    expect(covered(balls)).toEqual(want);
  });

  it('every ball is cyclic: legs sum to exactly P, one leg per strike', () => {
    const balls = allocateJuggle(groove, P, { ...OPTS, beaterLanes: ['kick'] });
    for (const b of balls){
      expect(b.legs.length).toBe(b.strikes.length);
      const total = b.legs.reduce((s, l) => s + l.dt, 0);
      expect(total).toBeCloseTo(P, 9);
      for (const l of b.legs) expect(l.dt).toBeGreaterThan(0);
    }
  });

  it('a backbeat needs two balls: one dribbling the hat, one on the snare', () => {
    const balls = allocateJuggle(groove, P, { ...OPTS, beaterLanes: ['kick'] });
    expect(balls.length).toBe(2);
    const hat = balls.find(b => b.strikes[0].lane === 'hat');
    expect(hat.strikes.every(k => k.lane === 'hat')).toBe(true);
    expect(hat.legs.every(l => l.mode === 'air')).toBe(true);   // incl. the seam wrap
  });

  it('beater lanes never enter the schedule', () => {
    const balls = allocateJuggle(groove, P, { ...OPTS, beaterLanes: ['kick'] });
    expect(balls.some(b => b.strikes.some(k => k.lane === 'kick'))).toBe(false);
  });
});

describe('allocateJuggle — chaining behavior', () => {
  it('an even run dribbles on ONE ball (MRU keeps runs together)', () => {
    const run = [0, .25, .5, .75, 1, 1.25].map(s => hit('hat', s));
    const balls = allocateJuggle(run, 2, OPTS);
    expect(balls.length).toBe(1);
  });

  it('cross-drum gaps within dtMax chain as air legs', () => {
    const balls = allocateJuggle([hit('snare', 0), hit('tomLow', 1), hit('floorHigh', 2)], 6, OPTS);
    const b = balls[0];
    expect(balls.length).toBe(1);
    expect(b.legs[0]).toMatchObject({ mode: 'air', dt: 1 });
    expect(b.legs[1]).toMatchObject({ mode: 'air', dt: 1 });
    expect(b.legs[2]).toMatchObject({ mode: 'plumb', dt: 4 });  // seam wrap: too long to fly
  });

  it('simultaneous hits on different drums force separate balls', () => {
    const balls = allocateJuggle([hit('snare', 1), hit('crash', 1)], 4, OPTS);
    expect(balls.length).toBe(2);
  });

  it('duplicate (lane, s) hits collapse to one', () => {
    const balls = allocateJuggle([hit('snare', 1), hit('snare', 1)], 4, OPTS);
    expect(balls.length).toBe(1);
    expect(balls[0].strikes.length).toBe(1);
  });

  it('gaps beyond minTransit reuse a resting ball via the plumbing', () => {
    const balls = allocateJuggle([hit('crash', 0), hit('crash', 3)], 8, OPTS);
    expect(balls.length).toBe(1);
    expect(balls[0].legs[0]).toMatchObject({ mode: 'plumb', dt: 3 });
  });

  it('dead-zone gaps (between dtMax and minTransit) spawn a fresh ball', () => {
    const balls = allocateJuggle([hit('snare', 0), hit('crash', 2)], 8, OPTS);
    expect(balls.length).toBe(2);                        // 2s gap: too long to fly, too short to ride
  });

  it('a once-per-loop hit rides the plumbing the whole way home', () => {
    const balls = allocateJuggle([hit('crash', 1)], 8, OPTS);
    expect(balls.length).toBe(1);
    expect(balls[0].legs).toEqual([{ mode: 'plumb', dt: 8 }]);
  });

  it('the seam wrap can be an air dribble (continuous run across the loop)', () => {
    const run = [0, .5, 1, 1.5].map(s => hit('hat', s));  // P=2 → wrap gap .5 ≤ dtMax
    const balls = allocateJuggle(run, 2, OPTS);
    expect(balls[0].legs.every(l => l.mode === 'air')).toBe(true);
  });

  it('negative pickup-beat times normalize into the loop', () => {
    const balls = allocateJuggle([hit('tomHigh', -0.5), hit('tomLow', 0.5)], 4, OPTS);
    expect(balls.length).toBe(1);                        // -0.5 wraps to 3.5; 0.5→3.5 is a 3s plumb leg
    const times = balls.flatMap(b => b.strikes.map(k => k.s));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...times)).toBeLessThan(4);
  });
});
