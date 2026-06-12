import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { G, solveLaunch, arcPos, arcVel, padOffset, noteHz } from '../src/engine.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

describe('solveLaunch — the closed-form ballistic solver', () => {
  it('lands `from` exactly on `to` after time dt (no drift)', () => {
    const cases = [
      [v(0, 0, 0), v(3, -2, 1), 0.5],
      [v(-1, 5, 2), v(4, 5, -3), 1.0],
      [v(0, 0, 0), v(0, -9, 0), 2.5],     // a steep long lob (Toccata-style)
      [v(2, -3, 1), v(2, -3, 1), 0.7],    // degenerate: same point
    ];
    for (const [from, to, dt] of cases) {
      const v0 = solveLaunch(from, to, dt);
      const landed = arcPos(from, v0, dt);
      expect(landed.distanceTo(to)).toBeLessThan(1e-9);
    }
  });

  it('arcPos at t=0 is the start point', () => {
    const from = v(1, 2, 3), v0 = v(4, 5, 6);
    expect(arcPos(from, v0, 0).distanceTo(from)).toBeLessThan(1e-12);
  });

  it('arcVel applies gravity over time: V(t) = v0 + g·t', () => {
    const v0 = v(1, 8, -2), t = 1.3;
    const expected = v0.clone().addScaledVector(G, t);
    expect(arcVel(v0, t).distanceTo(expected)).toBeLessThan(1e-12);
  });

  it('does not mutate its inputs', () => {
    const from = v(0, 0, 0), to = v(1, 1, 1);
    const fromCopy = from.clone();
    const v0 = solveLaunch(from, to, 0.5);
    arcPos(from, v0, 0.5);
    arcVel(v0, 0.5);
    expect(from.distanceTo(fromCopy)).toBe(0);
  });
});

describe('padOffset — the flipper swing', () => {
  it('is EXACTLY 0 at phase 0 (honest contact — the pad meets the marble at rest)', () => {
    for (const A of [0.05, 0.3, 0.8, 1.6]) {
      expect(padOffset(0, A)).toBe(0);
    }
  });

  it('is 0 well before the wind-up and well after the follow-through', () => {
    expect(padOffset(-5, 0.8)).toBe(0);
    expect(padOffset(0.7, 0.8)).toBe(0);
  });

  it('retracts (negative offset) during the wind-up and stroke', () => {
    const A = 0.8;
    expect(padOffset(-0.4, A)).toBeLessThan(0);   // wind-up
    expect(padOffset(-0.05, A)).toBeLessThan(0);  // stroke
  });
});

describe('noteHz — equal temperament, A4 = 440', () => {
  it('anchors A4 at 440 Hz', () => {
    expect(noteHz('A4')).toBeCloseTo(440, 6);
  });
  it('octave up doubles, octave down halves', () => {
    expect(noteHz('A5')).toBeCloseTo(880, 6);
    expect(noteHz('A3')).toBeCloseTo(220, 6);
  });
  it('places middle C and a sharp correctly', () => {
    expect(noteHz('C4')).toBeCloseTo(261.6256, 3);
    expect(noteHz('F#5')).toBeCloseTo(739.989, 2);
  });
});
