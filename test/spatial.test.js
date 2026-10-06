import { describe, it, expect } from 'vitest';
import { panFor, gainFor, airFor, spatialize, PAN_MAX, REF_DIST, MIN_GAIN, AIR_MIN } from '../src/spatial.js';

describe('spatial: pan from camera space', () => {
  it('dead ahead is centre; on-axis and the listener origin are 0', () => {
    expect(panFor(0, -20)).toBe(0);
    expect(panFor(0, 0)).toBe(0);
    expect(spatialize(0, 5, -20).pan).toBe(0);
  });
  it('right is positive, left is negative, and it is odd-symmetric', () => {
    expect(panFor(5, -20)).toBeGreaterThan(0);
    expect(panFor(-5, -20)).toBeLessThan(0);
    for (const x of [.5, 3, 9, 30]) expect(panFor(-x, -15)).toBeCloseTo(-panFor(x, -15), 12);
  });
  it('never hard-pans: clamped to ±PAN_MAX, reaching it only at 90°', () => {
    expect(panFor(100, 0)).toBeCloseTo(PAN_MAX, 12);
    expect(panFor(-100, 0)).toBeCloseTo(-PAN_MAX, 12);
    for (let a = -Math.PI; a <= Math.PI; a += .05){
      const p = panFor(Math.sin(a) * 20, -Math.cos(a) * 20);
      expect(Math.abs(p)).toBeLessThanOrEqual(PAN_MAX + 1e-12);
    }
  });
  it('is monotone in bearing across the front half-plane', () => {
    let prev = -Infinity;
    for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-9; a += .02){
      const p = panFor(Math.sin(a) * 20, -Math.cos(a) * 20);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });
  it('depends on bearing, not distance (a near and far voice on one ray pan alike)', () => {
    expect(panFor(3, -10)).toBeCloseTo(panFor(30, -100), 12);
  });
  it('something behind the camera keeps its side but drifts toward centre', () => {
    expect(panFor(5, 20)).toBeGreaterThan(0);
    expect(panFor(5, 20)).toBeLessThan(panFor(20, 5));
  });
});

describe('spatial: distance gain + air', () => {
  it('full level inside REF_DIST, gentle and floored beyond', () => {
    expect(gainFor(0)).toBe(1);
    expect(gainFor(REF_DIST)).toBe(1);
    expect(gainFor(REF_DIST * 2)).toBeLessThan(1);
    expect(gainFor(REF_DIST * 2)).toBeGreaterThan(MIN_GAIN);
    expect(gainFor(1e6)).toBe(MIN_GAIN);
    let prev = 1;
    for (let d = 0; d < 200; d += 3){ const g = gainFor(d); expect(g).toBeLessThanOrEqual(prev); prev = g; }
  });
  it('near voices are unfiltered; far ones lose top, never below AIR_MIN', () => {
    expect(airFor(10)).toBe(0);
    expect(airFor(REF_DIST)).toBe(0);
    const a = airFor(45), b = airFor(80);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThanOrEqual(AIR_MIN);
    expect(airFor(1e6)).toBe(AIR_MIN);
  });
  it('bad input degrades to a centred, unfiltered, full-level voice', () => {
    expect(spatialize(NaN, 0, 0)).toEqual({ pan: 0, gain: 1, lp: 0 });
    expect(spatialize(Infinity, 0, -3)).toEqual({ pan: 0, gain: 1, lp: 0 });
  });
});
